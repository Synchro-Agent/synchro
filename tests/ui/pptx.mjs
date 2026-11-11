// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/pptx.mjs
// Xuất bản trình bày thành PowerPoint không cần model: bấm Tải về › PowerPoint (.pptx) như người dùng, tệp tải về phải có đủ slide, mỗi slide
// một ảnh nền (hình, nền giữ nguyên) và chữ của slide nằm trong hộp chữ sửa được (đúng nội dung, đúng phông). Trước đây mục này chỉ gửi một
// tin nhắn nhờ model, model nhỏ từ chối ("phiên chỉ cho đọc tệp") rồi bảo người dùng bấm lại chính nút đó.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/pptx/";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(SCR + "dl", { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-pptx";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9345", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9345/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: SCR + "dl" });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(250); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const key = (k, code, vk) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

await P("Page.navigate", { url: B + "/" });
await until(`!!document.querySelector("textarea")`, 30000, "app");
await sleep(1200);
await click(`[...document.querySelectorAll(".hero-chip")].find((e) => e.textContent.includes("Trang trình bày"))`, "slides");
await sleep(400);
await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm bộ slide giới thiệu quán cà phê" }); await key("Enter", "Enter", 13);
await until(`!!document.querySelector(".art-panel") && !document.querySelector(".wl-status")`, 90000, "deck");
await sleep(2500);
const n = await ev(`(() => { const t = document.querySelector(".art-panel")?.textContent ?? ""; const m = /Slide\\s*\\d+\\s*\\/\\s*(\\d+)/.exec(t); return m ? Number(m[1]) : 0; })()`);
check("bộ slide đã dựng", n > 1, `${n} slide`);
// Chạy xong: danh sách việc, lời giải thích và các bước gom vào một dòng tổng kết (bấm để xem lại); câu trả lời cuối không lặp lại lời giải thích.
{
  const ws = await ev(`(() => { const m = [...document.querySelectorAll(".ai-msg")].pop(); if (!m) return null; const loose = (s) => [...m.querySelectorAll(s)].filter((e) => !e.closest(".wl-sum")).length;
    return { sum: m.querySelectorAll(".wl-sum").length, head: m.querySelector(".wl-sum-h")?.textContent ?? "", live: loose(".wl-status") + loose(".wl-plan") + loose(".wl-say") + loose(".wl-tools-h") }; })()`);
  await click(`[...document.querySelectorAll(".ai-msg")].pop().querySelector(".wl-sum-h")`, "summary"); await sleep(400);
  const says = await ev(`[...[...document.querySelectorAll(".ai-msg")].pop().querySelectorAll(".wl-sum-b .wl-say")].map((e) => e.textContent.trim()).filter((t) => t.length > 20)`);
  const answer = await ev(`(() => { const m = [...document.querySelectorAll(".ai-msg")].pop().cloneNode(true); m.querySelectorAll(".wl-sum").forEach((e) => e.remove()); return m.textContent; })()`);
  const dup = says.filter((t) => answer.includes(t.slice(0, 60)));
  check("chạy xong: còn đúng một dòng tổng kết, không còn danh sách việc / lời giải thích đang chạy", ws?.sum === 1 && ws.live === 0 && /Xong|Đã xong/.test(ws.head), JSON.stringify(ws));
  check("câu trả lời cuối không lặp lại lời giải thích (lời giải thích nằm trong tổng kết)", says.length > 0 && !dup.length, `${says.length} đoạn giải thích · lặp: ${dup.map((t) => t.slice(0, 40)).join(" | ")}`);
  await click(`[...document.querySelectorAll(".ai-msg")].pop().querySelector(".wl-sum-h")`, "summary close"); await sleep(300);
}

const t0 = Date.now();
await click(`document.querySelector(".art-panel [aria-label='Tải về']")`, "download");
await sleep(400);
await click(`[...document.querySelectorAll(".art-dl-menu .menu-item")].find((e) => e.textContent.includes("PowerPoint"))`, "pptx item");
let file = "";
for (let i = 0; i < 240 && !file; i++) { await sleep(500); file = readdirSync(SCR + "dl").find((f) => f.endsWith(".pptx")) ?? ""; }
check("bấm PowerPoint: tệp .pptx tải về, không gửi tin nhắn cho model", !!file && !(await ev(`[...document.querySelectorAll(".user-msg")].some((e) => /PowerPoint/.test(e.textContent))`)), file ? `${file} · ${(statSync(SCR + "dl/" + file).size / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(1)}s` : "không có tệp");
if (file) {
  const path = SCR + "dl/" + file;
  const list = spawnSync("unzip", ["-Z1", path], { encoding: "utf8" }).stdout.split("\n");
  const slides = list.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));
  check("đủ số slide", slides.length === n, `${slides.length}/${n}`);
  const media = list.filter((f) => /^ppt\/media\/.+\.png$/i.test(f));
  check("mỗi slide một ảnh nền", media.length >= n, `${media.length} ảnh`);
  let texts = [], fonts = new Set(), noText = 0, noBg = 0, runFonts = [];
  for (const sl of slides) {
    const xml = spawnSync("unzip", ["-p", path, sl], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
    for (const m of xml.matchAll(/<a:rPr\b[^>]*>([\s\S]*?)<\/a:rPr>/g)) { const l = /<a:latin ([^>]*)\/>/.exec(m[1]); if (l) runFonts.push({ latin: l[1], ea: /<a:ea typeface="([^"]*)"/.exec(m[1])?.[1], cs: /<a:cs typeface="([^"]*)"/.exec(m[1])?.[1] }); }
    const t = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    for (const m of xml.matchAll(/<a:latin typeface="([^"]+)"/g)) fonts.add(m[1]);
    if (!t.join("").trim()) noText++;
    if (!/<p:bg>[\s\S]*?<a:blip /.test(xml)) noBg++;
    texts.push(t.join(" "));
  }
  check("slide nào cũng có hộp chữ sửa được", noText === 0, `${noText} slide không có chữ`);
  check("slide nào cũng có ảnh nền", noBg === 0, `${noBg} slide thiếu nền`);
  check("chữ tiếng Việt giữ nguyên dấu", /[ăâđêôơưạảãáàặẳẵắằậẩẫấầẹẻẽéèệểễếềịỉĩíìọỏõóòộổỗốồợởỡớờụủũúùựửữứừỵỷỹýỳ]/i.test(texts.join(" ")), texts[0].slice(0, 80));
  // Phông khai báo trong mã của bản trình bày (phông hệ thống → Arial, như bộ xuất): tệp chỉ được dùng các phông đó.
  await click(`[...document.querySelectorAll(".art-panel button")].find((e) => e.textContent.trim() === "Mã")`, "code tab"); await sleep(900);
  const src = await ev(`document.querySelector(".art-panel pre, .art-panel .art-code, .art-panel code")?.textContent ?? ""`);
  const map = (f) => { const x = f.split(",")[0].replace(/["']/g, "").trim(); return !x || /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|ui-sans-serif|inherit)$/i.test(x) ? "Arial" : /^(serif|ui-serif)$/i.test(x) ? "Georgia" : /^(monospace|ui-monospace)$/i.test(x) ? "Consolas" : x; };
  const want = new Set([...src.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => map(m[1])));
  if (!want.size) want.add("Arial");
  check("đúng phông của bản trình bày", fonts.size > 0 && [...fonts].every((f) => want.has(f)), `tệp: ${[...fonts].join(", ")} · mã: ${[...want].join(", ")}`);
  // Phông thiết kế kèm phông dự phòng (chủ dự án chốt): hộp chữ ghi đúng tên phông thiết kế, PANOSE + họ phông của phông an toàn cùng dáng để máy thiếu phông
  // thay đúng dáng (không ra Times), chữ Đông Á / phức hợp trỏ thẳng phông an toàn; theme của tệp dùng phông thiết kế.
  const SAFE = new Set(["Arial", "Calibri", "Calibri Light", "Cambria", "Georgia", "Consolas", "Times New Roman", "Courier New", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI"]);
  const FB = { "020B0604020202020204": ["Arial", "34"], "02040502050405020303": ["Georgia", "18"], "020B0609020204030204": ["Consolas", "49"] };
  const design = runFonts.filter((r) => !SAFE.has(/typeface="([^"]+)"/.exec(r.latin)?.[1]));
  const okRun = (r) => { const p = /panose="([0-9A-F]{20})"/.exec(r.latin)?.[1], fb = FB[p]; return !!fb && r.latin.includes(`pitchFamily="${fb[1]}"`) && r.ea === fb[0] && r.cs === fb[0]; };
  // Bản trình bày giả lập dùng phông hệ thống (Arial): phần phông thiết kế kiểm ở tests/ui/media-kit.mjs (phong cách midnight-tech); có phông thiết kế thì kiểm cả ở đây.
  check("phông lạ (nếu có) giữ đúng tên trong hộp chữ", [...fonts].every((f) => SAFE.has(f)) || design.length > 0, `${runFonts.length} đoạn chữ · phông: ${[...fonts].join(", ")}`);
  check("mỗi đoạn chữ phông thiết kế có PANOSE + họ phông của phông dự phòng cùng dáng, chữ Đông Á / phức hợp trỏ phông dự phòng", design.every(okRun), JSON.stringify(design.filter((r) => !okRun(r)).slice(0, 2)));
  const theme = spawnSync("unzip", ["-p", path, "ppt/theme/theme1.xml"], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
  const themeFace = (k) => /<a:latin typeface="([^"]+)"(?: panose="([0-9A-F]{20})")?/.exec(new RegExp(`<a:${k}>([\\s\\S]*?)</a:${k}>`).exec(theme)?.[1] ?? "");
  const mj = themeFace("majorFont"), mn = themeFace("minorFont");
  check("theme của tệp: phông tiêu đề / nội dung là phông của bản trình bày, phông lạ kèm PANOSE", !!mj && !!mn && fonts.has(mj[1]) && fonts.has(mn[1]) && (SAFE.has(mj[1]) || !!mj[2]) && (SAFE.has(mn[1]) || !!mn[2]), `${mj?.[1]} ${mj?.[2]} · ${mn?.[1]} ${mn?.[2]}`);
  writeFileSync(SCR + "texts.txt", texts.map((t, i) => `--- slide ${i + 1}\n${t}`).join("\n"));
  // Ảnh xem trước của macOS (Quick Look) cho slide đầu: xem bằng mắt chữ nằm đúng chỗ trên nền.
  if (process.platform === "darwin") { spawnSync("qlmanage", ["-t", "-s", "1600", "-o", SCR, path], { stdio: "ignore" }); console.log("  ảnh xem trước:", readdirSync(SCR).filter((f) => f.endsWith(".png")).map((f) => SCR + f).join(", ")); }
}
check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
