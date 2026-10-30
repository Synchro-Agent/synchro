// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/skillzip.mjs
// Tải lên gói skill lớn (vd. "Download ZIP" cả repo, 143 MB) từng bị nginx chặn với "Lỗi 413": trình duyệt chỉ tải lên thư mục các skill
// (app/skillzip.ts), gói vẫn quá lớn / không có SKILL.md thì báo rõ, không gửi; 413 không kèm lời giải thích thì báo "Tệp quá lớn…".
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-skillzip";
rmSync(PROF, { recursive: true, force: true });
const R = createRequire(process.cwd() + "/package.json");
const JSZip = R("jszip");
const MB = 1024 * 1024;

// Gói thử (lưu không nén nên dung lượng đúng như dữ liệu ngẫu nhiên):
// - repo: 2 skill (alpha, beta) + 24 MB tài liệu + .git + skill trong thư mục ẩn .claude (máy chủ bỏ qua) → chỉ còn alpha, beta.
// - noskill: 22 MB, không có SKILL.md. huge: một skill kèm tệp 21 MB (quá 20 MB dù đã lọc).
const zipOf = async (files) => { const z = new JSZip(); for (const [p, d] of Object.entries(files)) z.file(p, d); return z.generateAsync({ type: "nodebuffer", compression: "STORE" }); };
const md = (n) => `---\nname: ${n}\ndescription: Skill thử nghiệm ${n} cho việc tải lên gói lớn trong Kho kỹ năng\n---\n\n# ${n}\n\nĐọc ref.md.\n`;
const P_REPO = SCR + "skillzip-demo-main.zip", P_NO = SCR + "skillzip-noskill.zip", P_HUGE = SCR + "skillzip-huge.zip";
writeFileSync(P_REPO, await zipOf({
  "demo-main/README.md": "# demo\n", "demo-main/docs/video.bin": crypto.randomBytes(24 * MB), "demo-main/.git/objects/pack.bin": crypto.randomBytes(MB),
  "demo-main/skills/zt-alpha/SKILL.md": md("zt-alpha"), "demo-main/skills/zt-alpha/ref.md": "# ref\n",
  "demo-main/skills/zt-beta/SKILL.md": md("zt-beta"), "demo-main/skills/zt-beta/assets/a.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  "demo-main/.claude/skills/zt-gamma/SKILL.md": md("zt-gamma"),
}));
writeFileSync(P_NO, await zipOf({ "repo/README.md": "# no skill\n", "repo/data.bin": crypto.randomBytes(22 * MB) }));
writeFileSync(P_HUGE, await zipOf({ "zt-huge/SKILL.md": md("zt-huge"), "zt-huge/assets/blob.bin": crypto.randomBytes(21 * MB) }));

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
const NAMES = ["zt-alpha", "zt-beta", "zt-gamma", "zt-huge"];
const cleanup = async () => { for (const n of NAMES) await api("DELETE", `/api/skills/${n}`); };
await cleanup();

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9339", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9339/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("DOM.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}skillzip-${n}.png`, Buffer.from(data, "base64")); };
// Chọn tệp qua đúng ô chọn tệp của danh sách skill (như bấm "Tải lên"), rồi chờ kết quả.
const pickFile = async (file) => {
  await ev(`document.querySelector(".sk-err button")?.click(), 1`);
  const { result } = await P("Runtime.evaluate", { expression: `document.querySelector('input[type=file][accept=".zip,.md"]')` });
  await P("DOM.setFileInputFiles", { files: [file], objectId: result.objectId });
};
const err = () => ev(`document.querySelector(".sk-err span")?.textContent ?? ""`);
const sent = () => ev(`window.__up.slice()`);

try {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(800);
  await click(byText(".nav-item", "Kho kỹ năng"), "hub");
  await until(`!!document.querySelector('input[type=file][accept=".zip,.md"]')`, 15000, "skill upload input");
  // Ghi lại dung lượng tệp thật sự gửi lên máy chủ.
  await ev(`window.__up = []; { const f0 = window.fetch; window.fetch = (u, i) => { if (i?.body instanceof FormData) { const f = i.body.get("file"); window.__up.push({ name: f?.name, size: f?.size, pick: i.body.get("pick") }); } return f0(u, i); }; } 1`);

  await pickFile(P_REPO);
  await until(`document.querySelectorAll(".sk-choice").length > 0`, 30000, "choose dialog");
  const names = await ev(`[...document.querySelectorAll(".sk-choice b")].map((e) => e.textContent.trim())`);
  const up = await sent();
  ok(names.includes("zt-alpha") && names.includes("zt-beta") && !names.includes("zt-gamma"), "gói 26 MB cả repo: hiện đúng 2 skill để chọn (bỏ skill trong thư mục ẩn)", JSON.stringify(names));
  ok(up.length >= 1 && up.every((x) => x.name === "skillzip-demo-main.zip" && x.size < 64 * 1024), "chỉ tải lên thư mục các skill (vài KB thay vì 26 MB, giữ tên tệp)", JSON.stringify(up));
  await shot("1-choose");
  await click(`[...document.querySelectorAll(".sk-choice")].find((e) => /zt-alpha/.test(e.textContent))?.querySelector(".btn")`, "preview alpha");
  const addBtn = `[...document.querySelectorAll(".sk-mask button")].find((e) => /^(Thêm và bật|Add and enable)/.test(e.textContent.trim()))`;
  await until(`!!${addBtn}`, 15000, "add modal");
  ok(await ev(`/ref\\.md/.test([...document.querySelectorAll(".sk-mask")].at(-1).textContent)`), "xem trước skill trong gói đã lọc: có ref.md");
  await click(addBtn, "add");
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) { await sleep(250); saved = (await api("GET", "/api/skills")).j?.skills?.find((s) => s.name === "zt-alpha"); }
  ok(saved && saved.fileCount === 1, "thêm skill từ gói đã lọc: lưu zt-alpha kèm ref.md", JSON.stringify(saved));
  const last = (await sent()).at(-1);
  ok(last?.pick === "demo-main/skills/zt-alpha" && last.size < 64 * 1024, "lúc lưu cũng gửi gói đã lọc, đúng thư mục skill", JSON.stringify(last));

  const n0 = (await sent()).length;
  await pickFile(P_NO);
  await until(`!!document.querySelector(".sk-err span")`, 30000, "no-skill error");
  ok(/Không tìm thấy SKILL\.md trong skillzip-noskill\.zip/.test(await err()) && (await sent()).length === n0, "gói 22 MB không có SKILL.md: báo rõ, không tải lên", await err());
  await pickFile(P_HUGE);
  await until(`/vẫn nặng/.test(document.querySelector(".sk-err span")?.textContent ?? "")`, 30000, "too-large error");
  ok(/skillzip-huge\.zip quá lớn: 1 skill bên trong vẫn nặng 21\.0 MB.*tối đa 20\.0 MB/.test(await err()) && (await sent()).length === n0, "skill nặng hơn 20 MB dù đã lọc: báo rõ dung lượng, không tải lên", await err());
  await shot("2-too-large");

  // nginx chặn (413, trang HTML không có lời giải thích): báo "Tệp quá lớn để tải lên" thay vì "Lỗi 413".
  await ev(`{ const f1 = window.fetch; window.__restore = () => { window.fetch = f1; }; window.fetch = (u, i) => String(u).startsWith("/api/skills") && i?.method === "POST" ? Promise.resolve(new Response("<html><body>413 Request Entity Too Large</body></html>", { status: 413, headers: { "content-type": "text/html" } })) : f1(u, i); } 1`);
  writeFileSync(SCR + "SKILL.md", md("zt-small"));
  await pickFile(SCR + "SKILL.md");
  await until(`!!document.querySelector(".sk-err span")`, 15000, "413 error");
  ok(/^Tệp quá lớn để tải lên \(tối đa 40 MB mỗi lần\)\.$/.test(await err()), "413 từ nginx: báo tệp quá lớn kèm giới hạn", await err());
  await ev(`window.__restore(), 1`);
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await cleanup();
for (const f of [P_REPO, P_NO, P_HUGE, SCR + "SKILL.md"]) rmSync(f, { force: true });
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
