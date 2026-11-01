// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/bgrun.mjs
// Câu trả lời đang chạy không bị dừng khi người dùng chuyển mục (Speech), bấm lại đoạn chat ở thanh bên, mở đoạn chat khác hay đoạn chat mới:
// trước đây bấm vào một đoạn chat ở thanh bên (kể cả chính đoạn đang chạy, cách duy nhất để quay lại từ Speech) hay bấm "Mới" là hủy lượt
// ở máy chủ, câu trả lời chỉ còn các câu dẫn ghép lại rồi im. Nay: lượt chạy tiếp ở nền, chấm nhịp ở thanh bên, xong thì báo một dòng;
// hai đoạn chat trả lời song song; chỉ nút Dừng mới dừng, và câu trả lời bị dừng ghi rõ "Đã dừng".
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-bgrun";
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
  ["--headless=new", "--remote-debugging-port=9341", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9341/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const key = (k, code, vk) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }));
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const ask = async (text) => { await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text }); await key("Enter", "Enter", 13); };
const shot = async (name) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}bgrun-${name}.png`, Buffer.from(data, "base64")); };
// Hàng của một đoạn chat ở thanh bên (theo tên đầu tiên của nó) và tin trả lời cuối của đoạn chat đang mở.
const row = (t) => `[...document.querySelectorAll(".chat-item")].find((e) => e.textContent.includes(${JSON.stringify(t)}))`;
const lastAi = `[...document.querySelectorAll(".ai-msg")].pop()`;

let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

await P("Page.navigate", { url: B + "/" });
await until(`!!document.querySelector("textarea")`, 30000, "app");
await sleep(1200);

// 1. Câu trả lời chậm (#slow: model giả lập chờ 8 giây) ở đoạn chat A.
const A = "Kể một chuyện vui về con mèo #slow";
await ask(A);
await until(`!!${row("chuyện vui")}`, 10000, "chat A in sidebar");
await until(`!!${row("chuyện vui")}?.querySelector(".ct-run")`, 10000, "running dot");
check("chấm đang trả lời hiện ở thanh bên", true);
await shot("1-running");

// 2. Sang Speech rồi quay lại bằng thanh bên (trước đây bước này hủy lượt).
await click(byText(".nav-item", "Speech"), "speech"); await sleep(1500);
check("ở Speech, lượt vẫn chạy", await ev(`!!${row("chuyện vui")}?.querySelector(".ct-run")`));
await click(row("chuyện vui"), "back to A"); await sleep(800);
const back = await ev(`(() => { const m = ${lastAi}; return { work: !!document.querySelector(".wl-status"), stopped: !!document.querySelector(".msg-stopped"), text: (m?.textContent ?? "").trim().slice(0, 60), dot: !!${row("chuyện vui")}?.querySelector(".ct-run") }; })()`);
check("quay lại đoạn chat A: vẫn đang làm, không bị dừng", back.work && !back.stopped, JSON.stringify(back));
check("ô soạn tin ở chế độ nhắn thêm", await ev(`/Nhắn thêm/.test(document.querySelector("textarea")?.placeholder ?? "")`));

// 3. Mở đoạn chat mới và hỏi tiếp khi A vẫn đang chạy: hai lượt song song.
await click(`document.querySelector(".rail-new")`, "new"); await sleep(800);
check("đoạn chat mới: ô soạn tin bình thường", await ev(`!/Nhắn thêm/.test(document.querySelector("textarea")?.placeholder ?? "x")`));
await ask("Chào bạn, hôm nay thế nào?");
await until(`!!${row("Chào bạn")}`, 10000, "chat B in sidebar");
await until(`(() => { const m = ${lastAi}; return m && !m.querySelector(".wl-status") && m.textContent.trim().length > 5; })()`, 30000, "reply B");
check("đoạn chat B trả lời xong trong khi A còn chạy", await ev(`!!${row("chuyện vui")}?.querySelector(".ct-run")`));
await shot("2-parallel");

// 4. A xong khi người dùng đang ở B: chấm tắt, có dòng báo, câu trả lời đầy đủ (không "Đã dừng").
await until(`!${row("chuyện vui")}?.querySelector(".ct-run")`, 30000, "A finished");
await sleep(300);
check("báo khi đoạn chat khác trả lời xong", await ev(`[...document.querySelectorAll(".toast")].some((t) => /trả lời xong/.test(t.textContent))`));
await click(row("chuyện vui"), "open A"); await sleep(900);
const a = await ev(`(() => { const m = ${lastAi}; return { text: m?.textContent.trim().slice(0, 80) ?? "", stopped: !!document.querySelector(".msg-stopped"), work: !!m?.querySelector(".wl-status") }; })()`);
check("câu trả lời của A đầy đủ, không bị dừng", a.text.length > 5 && !a.stopped && !a.work, JSON.stringify(a));
await shot("3-done");

// 5. Nút Dừng vẫn dừng đúng đoạn chat đó và ghi rõ đã dừng.
await ask("Thêm một đoạn nữa #slow");
await until(`!!${row("chuyện vui")}?.querySelector(".ct-run")`, 10000, "A running again");
await sleep(1200);
await click(`document.querySelector(".dock .send")`, "stop");
await until(`!!document.querySelector(".msg-stopped")`, 10000, "stopped note");
check("Dừng: ghi rõ “Đã dừng”, chấm tắt", await ev(`!${row("chuyện vui")}?.querySelector(".ct-run")`));
await shot("4-stopped");

check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
