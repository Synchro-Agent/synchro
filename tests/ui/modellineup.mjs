// Đội hình model ở bộ chọn model (ảnh chụp của chủ dự án 24/11: menu Gemini / ChatGPT liệt kê mọi model kèm nhãn
// Mới). Trên mock, danh sách /api/models được thay bằng danh sách giống thật của gói Gemini (Antigravity), gói ChatGPT
// và khóa API Claude, rồi kiểm: mỗi hãng chỉ hiện đội hình nhẹ → chuẩn → khó, nhãn Mới chỉ ở model vừa ra,
// "Xem tất cả model" mở các model còn lại mà không đóng menu, chọn model đời cũ thì nó ở lại danh sách chính;
// model hãng khác mang logo của chính hãng đó, nút Thu gọn luôn thấy khi danh sách dài, ô của bậc ưu tiên model
// người dùng được phép dùng; giao diện sáng / tối, màn hình hẹp.
// Chạy tay: node tests/ui/modellineup.mjs (mock ở cổng 3200).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-lineup";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const login = await fetch(B + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }),
});
for (const c of login.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
if (!cookie) throw new Error("login failed");
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeBin = process.env.CHROME_PATH ?? (process.platform === "darwin" ? MAC_CHROME : "google-chrome");
const chrome = spawn(chromeBin, ["--headless=new", "--remote-debugging-port=9395", `--user-data-dir=${PROF}`,
  "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50 && !ver; i++) {
  await sleep(200);
  // Chrome chưa mở xong cổng gỡ lỗi thì lần hỏi này lỗi: chờ rồi hỏi lại.
  ver = await fetch("http://127.0.0.1:9395/json/version").then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !waits.has(m.id)) return;
  const [ok, no] = waits.get(m.id); waits.delete(m.id);
  m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 30000, what = expr) => {
  const t = Date.now();
  // Trang đang tải lại thì biểu thức lỗi: coi như chưa đạt và hỏi lại tới hết hạn.
  while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); }
  throw new Error("timeout: " + what);
};
const at = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  return r;
};
const click = async (expr, what) => {
  const [x, y] = await at(expr, what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
};
const hover = async (expr, what) => {
  const [x, y] = await at(expr, what);
  await P("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
};

const results = [];
const ok = (c, n, x = "") => { results.push(c); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const shot = async (n) => {
  const { data } = await P("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SCR}lineup-${n}.png`, Buffer.from(data, "base64"));
};

// Danh sách giống thật: gói Gemini như ảnh chụp (Neon vừa ra, mang nhãn Mới), gói ChatGPT, khóa API Claude (không có
// gói Claude nên Claude qua Antigravity thành mục riêng).
const NOW = Date.now(), OLD = NOW - 60 * 86_400_000;
const m = (prov, [id, name], extra = {}) => ({ key: `${prov}/${id}`, id, name, since: OLD, ...extra });
const AGY = [
  m("sub-agy", ["gemini-4-neon", "Gemini 4 Neon"], { isNew: true, since: NOW }),
  ...[["gemini-4-carbon", "Gemini 4 Carbon"], ["gemini-4-argon", "Gemini 4 Argon"],
    ["gemini-4-hydrogen", "Gemini 4 Hydrogen"], ["gemini-4-orchestrator-neon", "Orchestrator (Neon)"],
    ["gemini-4-orchestrator-carbon", "Orchestrator (Carbon)"],
    ["gemini-4-orchestrator-hydrogen", "Orchestrator (Hydrogen)"], ["gemini-3.8-flash", "Gemini 3.8 Flash"],
    ["claude-opus-5-5", "Claude Opus 5.5 (Antigravity)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 (Antigravity)"],
    ["gpt-oss-120b", "GPT-OSS 120B (Antigravity)"]].map((x) => m("sub-agy", x)),
];
const CODEX = [["gpt-6.2-sol", "GPT-6.2 Sol"], ["gpt-6.2-astra", "GPT-6.2 Astra"], ["gpt-6.1-terra", "GPT-6.1 Terra"],
  ["gpt-6.1-sol", "GPT-6.1 Sol"], ["gpt-6-astra", "GPT-6 Astra"], ["gpt-6-sol", "GPT-6 Sol"],
  ["gpt-6-luna", "GPT-6 Luna"], ["gpt-5.6-sol", "GPT-5.6 Sol"], ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.6-luna", "GPT-5.6 Luna"]]
  .map((x) => m("sub-codex", x));
const ANT = [["claude-fable-5-1", "Claude Fable 5.1"], ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-opus-5", "Claude Opus 5"], ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"]].map((x) => m("anthropic", x));
const plan = (cli) => ({ cli, models: [], blockedUntil: null, usingApiUntil: null, relogin: false });
const PROVIDERS = [
  { id: "anthropic", name: "Claude", kind: "anthropic", source: "api", models: ANT },
  { id: "openai", name: "ChatGPT", kind: "openai", source: "plan", plan: plan("codex"), models: CODEX },
  { id: "google", name: "Gemini", kind: "google", source: "plan", plan: plan("agy"), models: AGY },
];
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch;
  window.fetch = async (...a) => { const r = await f(...a); if (!String(a[0]).includes("/api/models")) return r;
  // Phản hồi không phải JSON (trang lỗi của máy chủ) thì để nguyên cho ứng dụng tự xử lý như bình thường.
  const j = await r.clone().json().catch(() => null); if (!j) return r;
  j.providers = ${JSON.stringify(PROVIDERS)}; j.allowed = window.__lineupAllowed || ["*"]; j.default = null;
  window.__lineupLoads = (window.__lineupLoads || 0) + 1;
  return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }; })()` });

const openSub = `[...document.querySelectorAll(".msub-models")].find((e) => !e.classList.contains("out"))`;
/** Các dòng của menu con đang mở: tên model (kèm [Mới] / [✓]), tiêu đề mục (#), đường kẻ (--), nút Xem tất cả (>). */
const rows = `(() => { const s = ${openSub}; if (!s) return null;
  const t = (e, q) => e.querySelector(q)?.textContent.trim() ?? "";
  return [...s.querySelectorAll(".msub-scroll > *, .mall-foot > *")].map((e) => e.classList.contains("msub-sec")
    ? "# " + e.textContent.trim() : e.classList.contains("mall") ? "> " + e.textContent.trim()
    : e.tagName === "HR" ? "--"
    : t(e, ".mname-t") + (e.querySelector(".mnew") ? " [Mới]" : "") + (e.querySelector(".ck") ? " [✓]" : "")); })()`;
const fits = `(() => { const r = ${openSub}.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`;
const provRow = (name) => `[...document.querySelectorAll(".model-menu .mprov")]
  .find((x) => x.textContent.trim().startsWith(${JSON.stringify(name)}))`;
const menuOpen = `!!document.querySelector(".model-menu:not(.out)")`;
/** Nút Thu gọn nằm trọn trong menu con và trong màn hình (không bị khung cắt mất). */
const toggleSeen = `(() => { const s = ${openSub}, b = s.querySelector(".mall").getBoundingClientRect();
  const p = s.getBoundingClientRect();
  return b.height > 0 && b.top >= p.top && b.bottom <= p.bottom + 0.5 && b.bottom <= innerHeight; })()`;
/** Vùng cuộn: còn dòng ẩn thì có dấu mờ ở đáy (lớp more); cuộn xuống hết thì dòng cuối thấy được, hết dấu mờ. */
const scrollCue = `(async () => { const sc = ${openSub}.querySelector(".msub-scroll");
  const over = sc.scrollHeight > sc.clientHeight + 2, cue = sc.classList.contains("more");
  sc.scrollTop = sc.scrollHeight; await new Promise((r) => setTimeout(r, 120));
  const last = sc.lastElementChild.getBoundingClientRect(), box = sc.getBoundingClientRect();
  const r = { over, cue, end: last.bottom <= box.bottom + 0.5, after: sc.classList.contains("more") };
  sc.scrollTop = 0; return r; })()`;
const cueOk = (c) => c && (!c.over || c.cue) && c.end && !c.after;
/** Logo (SVG) của dòng model có tên này trong menu con đang mở, và của dòng hãng trong menu chính. */
const logoOf = (name) => `[...${openSub}.querySelectorAll(".mline")]
  .find((x) => x.textContent.includes(${JSON.stringify(name)}))?.querySelector(".vlogo")?.innerHTML ?? ""`;
const provLogo = (name) => `${provRow(name)}?.querySelector(".vlogo")?.innerHTML ?? ""`;
// Trang đầu tiên dùng danh sách model của gói khởi động (danh sách thật của mock); mở menu thì trang hỏi lại
// /api/models, và chỉ lần hỏi đó mới mang danh sách giả ở trên. Mock chạy chế độ dev trả lời chậm, nên chờ
// lần hỏi ấy xong rồi mới đọc menu.
const loads = `window.__lineupLoads || 0`;
const openPicker = async () => {
  const n = await ev(loads);
  if (!(await ev(menuOpen))) await click(`document.querySelector(".model-btn")`, "nút model");
  await until(menuOpen, 5000, "menu model");
  await until(`${loads} > ${n}`, 60000, "danh sách model giả");
  await sleep(250);
};
const showProv = async (name) => { await hover(provRow(name), name); await sleep(450); return ev(rows); };
const expand = async () => { await click(`${openSub}.querySelector(".mall")`, "Xem tất cả model"); await sleep(400); };
const app = `!!document.querySelector("textarea") && !!document.querySelector(".model-btn")`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let startAuto = false;
try {
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Page.navigate", { url: B + "/" });
  await until(app, 30000, "app");
  await sleep(1200);
  startAuto = await ev(`document.querySelector(".model-btn").textContent.includes("Tự động")`);
  await openPicker();

  console.log("1. Gói Gemini: đội hình Hydrogen → Neon → Carbon, Claude qua Antigravity thành mục riêng");
  let r = await showProv("Gemini");
  ok(same(r, ["Gemini 4 Hydrogen", "Gemini 4 Neon [Mới]", "Gemini 4 Carbon", "# Qua Antigravity",
    "Claude Sonnet 5.5", "Claude Opus 5.5", "--", "> Xem tất cả model6"]),
  "menu Gemini ngắn, nhãn Mới chỉ ở Neon, mục Qua Antigravity không lặp chữ (Antigravity), 6 model sau Xem tất cả",
  JSON.stringify(r));
  ok(await ev(fits), "menu con nằm trọn trong màn hình");
  const [viaLogo, gemLogo, claudeLogo] = [await ev(logoOf("Claude Sonnet 5.5")), await ev(logoOf("Gemini 4 Neon")),
    await ev(provLogo("Claude"))];
  ok(viaLogo && viaLogo !== gemLogo && viaLogo === claudeLogo,
    "Claude qua Antigravity mang logo Claude, không phải logo Gemini");
  await shot("gemini-light");

  console.log("2. Xem tất cả model mở thêm mà không đóng menu");
  await expand();
  r = await ev(rows);
  ok(r && r.includes("# Model khác") && r.includes("Gemini 4 Argon") && r.includes("Orchestrator (Neon)")
    && r.at(-1) === "> Thu gọn", "hiện mục Model khác với Argon, model điều phối…; nút đổi thành Thu gọn",
  JSON.stringify(r));
  ok(await ev(menuOpen), "menu vẫn mở");
  ok(await ev(fits), "menu con mở rộng vẫn nằm trọn trong màn hình");
  ok(await ev(toggleSeen), "nút Thu gọn thấy được ở đáy menu con");
  let cue = await ev(scrollCue);
  ok(cueOk(cue), "danh sách dài: có dấu mờ báo còn dòng, cuộn xuống thấy dòng cuối (GPT-OSS)", JSON.stringify(cue));
  await shot("gemini-all");

  console.log("3. Chọn model đời cũ: nó ở lại danh sách chính");
  const argon = `[...${openSub}.querySelectorAll(".menu-item")].find((x) => x.textContent.includes("Gemini 4 Argon"))`;
  await click(argon, "Argon");
  await until(`document.querySelector(".model-btn").textContent.includes("Gemini 4 Argon")`, 5000, "đã chọn Argon");
  await openPicker();
  r = await showProv("Gemini");
  ok(r && r.slice(0, 4).join("|") === "Gemini 4 Hydrogen|Gemini 4 Neon [Mới]|Gemini 4 Carbon|Gemini 4 Argon [✓]"
    && r.at(-1) === "> Xem tất cả model5",
  "Argon đang chọn ở cuối đội hình, có dấu chọn; mở lại menu thì về danh sách ngắn", JSON.stringify(r));

  console.log("4. Gói ChatGPT và khóa API Claude");
  r = await showProv("ChatGPT");
  ok(r?.join("|") === "GPT-6 Luna|GPT-6.2 Sol|GPT-6.2 Astra|--|> Xem tất cả model7", "ChatGPT: Luna → Sol → Astra",
    JSON.stringify(r));
  r = await showProv("Claude");
  ok(r?.join("|") === "Claude Haiku 5.5|Claude Sonnet 5.5|Claude Opus 5.5|Claude Fable 5.1|--|> Xem tất cả model3",
    "Claude: Haiku → Sonnet → Opus → Fable", JSON.stringify(r));

  console.log("4b. Quản trị viên chỉ cho Haiku 4.5: ô nhẹ là Haiku 4.5, không phải Haiku 5.5 bị khóa");
  const keys = PROVIDERS.flatMap((p) => p.models.map((x) => x.key)).filter((k) => k !== "anthropic/claude-haiku-5-5");
  await ev(`window.__lineupAllowed = ${JSON.stringify(keys)}`);
  await click(`document.querySelector(".model-btn")`, "đóng menu");
  await sleep(300);
  await openPicker();
  r = await showProv("Claude");
  ok(r?.[0] === "Claude Haiku 4.5" && !r.includes("Claude Haiku 5.5"),
    "đội hình Claude bắt đầu bằng Haiku 4.5 (model được dùng)", JSON.stringify(r));
  await ev(`window.__lineupAllowed = null`);
  await click(`document.querySelector(".model-btn")`, "đóng menu");
  await sleep(300);
  await openPicker();

  console.log("5. Giao diện tối, màn hình hẹp");
  await ev(`document.documentElement.dataset.theme = "dark"`);
  await showProv("Gemini");
  await shot("gemini-dark");
  await expand();
  ok(await ev(fits), "tối: menu con mở rộng nằm trọn trong màn hình");
  ok(await ev(toggleSeen), "tối: nút Thu gọn thấy được");
  await shot("gemini-dark-all");
  await ev(`document.documentElement.dataset.theme = "light"`);
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await P("Page.reload");
  await until(app, 30000, "app hẹp");
  await sleep(1200);
  await openPicker();
  await click(provRow("Gemini"), "Gemini");
  await sleep(450);
  r = await ev(rows);
  ok(r && r[0] === "Gemini 4 Hydrogen" && r.at(-1).startsWith("> Xem tất cả model"), "điện thoại: cùng đội hình",
    JSON.stringify(r));
  ok(await ev(`(() => { const s = ${openSub}.getBoundingClientRect();
    return s.left >= 0 && s.right <= innerWidth; })()`),
    "điện thoại: menu con không tràn ngang");
  await shot("gemini-phone");
  const phoneAll = async (theme) => {
    await expand();
    r = await ev(rows);
    ok(r?.at(-1) === "> Thu gọn" && r.includes("Gemini 4 Argon"), `điện thoại ${theme}: Xem tất cả mở thêm model`,
      JSON.stringify(r));
    ok(await ev(fits), `điện thoại ${theme}: menu con mở rộng nằm trọn trong màn hình`);
    ok(await ev(toggleSeen), `điện thoại ${theme}: nút Thu gọn thấy được`);
    cue = await ev(scrollCue);
    ok(cueOk(cue), `điện thoại ${theme}: dấu mờ khi còn dòng, cuộn thấy dòng cuối`, JSON.stringify(cue));
    await shot(`gemini-phone-${theme}-all`);
  };
  await phoneAll("light");
  await ev(`document.documentElement.dataset.theme = "dark"`);
  await expand();
  await phoneAll("dark");
  await ev(`document.documentElement.dataset.theme = "light"`);
} catch (e) {
  ok(false, "lỗi khi chạy " + e.message);
  await shot("loi").catch((x) => console.log("không chụp được ảnh lỗi:", x.message));
}
finally {
  // Trả lựa chọn model của tài khoản mock về Tự động như lúc đầu.
  if (startAuto) {
    const desk = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
    await P("Emulation.setDeviceMetricsOverride", desk)
      .catch((e) => console.log("không đổi lại cỡ màn hình:", e.message));
    await openPicker().then(() => click(`document.querySelector(".model-menu .mauto")`, "Tự động"))
      .catch((e) => console.log("không trả được model về Tự động:", e.message));
    await sleep(500);
  }
  chrome.kill();
}
const bad = results.filter((c) => !c).length;
console.log(`\n${results.length - bad} đạt, ${bad} lỗi`);
process.exit(bad ? 1 : 0);
