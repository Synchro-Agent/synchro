// Mục tiêu của dự án tới được model ở mọi engine, đi đúng đường người dùng: tạo dự án bằng hộp thoại
// (ô "Mục tiêu và bối cảnh"), gửi câu hỏi từ trang dự án, rồi một câu nối tiếp trong cùng đoạn chat.
// Kiểm payload trình duyệt gửi lên /api/llm (mã dự án, lời nhắc có mục tiêu) và lời nhắc engine thật sự nhận
// (CLI / khóa API giả lập trả lời "#pjins" bằng phần dự án có trong lời nhắc của nó).
// Engine: gói Claude Code, ChatGPT (Codex), Antigravity (Gemini), Grok; khóa API Anthropic, OpenAI, Google; Tự động.
// Chạy tay (npm run dev:mock đang chạy): node tests/ui/project-ins.mjs
import { login, openChrome, sleep, waitFor } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const M = process.env.MOCK_PROVIDERS ?? "http://127.0.0.1:4010";
const GOAL = "Luôn kết thúc câu trả lời bằng từ KIWI-PROJ";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const { cookie, uid } = await login(B);
// Trả lời không phải JSON (trang lỗi của Next) thì coi như không có dữ liệu: phép kiểm phía sau báo lỗi kèm ngữ cảnh.
const api = (method, p, body) => fetch(B + p, {
  method, headers: { "content-type": "application/json", origin: B, cookie }, body: body && JSON.stringify(body),
}).then((r) => r.json().catch(() => null));

// Đăng nhập gói bằng trang đăng nhập giả lập: Codex và Grok dùng mã thiết bị, Claude và Antigravity dán mã.
const pageCode = async (cli) => {
  // Máy giả lập không trả trang: không có mã, gói không đăng nhập được và phép kiểm đăng nhập báo lỗi.
  const html = await fetch(`${M}/mock-login/${cli}`).then((r) => r.text()).catch(() => "");
  return /id="code"[^>]*>([^<]+)</.exec(html)?.[1];
};
const loggedIn = async (cli) => !!(await api("GET", `/api/engines/${cli}/status?fresh=1`))?.loggedIn;
async function loginPlan(cli) {
  const st = await api("POST", `/api/engines/${cli}/login/start`, {});
  // Lỗi mạng ở bước duyệt mã thì trạng thái đăng nhập không đổi, waitFor bên dưới trả false.
  const approve = `${M}/mock-login/${cli}/approve?code=${st?.userCode}`;
  if (cli === "codex" || cli === "grok") await fetch(approve).catch(() => null);
  else await api("POST", `/api/engines/${cli}/login/code`, { code: await pageCode(cli) });
  return !!(await waitFor(() => loggedIn(cli), 15_000, { every: 500 }));
}

const PLANS = ["claude", "codex", "agy", "grok"];
// Hãng đã đăng nhập gói thì bộ chọn model chỉ hiện model của gói: lượt khóa API chạy khi chưa có gói nào,
// lượt gói chạy sau khi đăng nhập cả bốn. Xong thì trả các gói về đúng trạng thái lúc đầu (render-perf, critic
// chạy với tài khoản quản trị chưa có gói).
const before = [];
for (const cli of PLANS) if (await loggedIn(cli)) before.push(cli);
const keysNow = async () => ((await api("GET", "/api/models"))?.providers ?? [])
  .flatMap((p) => (p.models ?? []).map((m) => m.key));
const pick = (keys, re) => keys.find((k) => re.test(k ?? ""));
const PHASES = [
  { plans: false, engines: (k) => [
    ["Khóa API Anthropic", pick(k, /^anthropic\//)],
    ["Khóa API OpenAI", pick(k, /^openai\//)],
    ["Khóa API Google (Gemini)", pick(k, /^google\/gemini/)],
    ["Tự động, chỉ có khóa API", "auto"],
  ] },
  { plans: true, engines: (k) => [
    ["Gói Claude Code", pick(k, /^sub-claude\//)],
    ["Gói ChatGPT (Codex)", pick(k, /^sub-codex\//)],
    ["Gói Antigravity (Gemini)", pick(k, /^sub-agy\/gemini/)],
    ["Gói Grok", pick(k, /^sub-grok\//)],
    ["Tự động, có gói", "auto"],
  ] },
];

const port = Number(process.env.CDP_PORT ?? 9398);
const t = await openChrome({ base: B, port, name: "project-ins", shots: process.env.SHOTS });
const { P, ev, until } = t;
// Bản sao từng lượt chat gửi lên /api/llm, đọc lại sau khi gửi (chính nội dung trình duyệt gửi, không dựng lại).
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const f = window.fetch; window.__llm = [];
  window.fetch = (u, o) => {
    if (String(u).endsWith("/api/llm") && o?.method === "POST") {
      try { window.__llm.push(JSON.parse(o.body)); } catch (e) { window.__llm.push({ bad: String(e) }); }
    }
    return f(u, o);
  };
})()` });
const tap = async (expr, what) => {
  const at = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" });
    const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!at) throw new Error(`không thấy ${what}`);
  await t.click(at[0], at[1]);
};
const lastChatBody = () => ev(`(window.__llm ?? []).filter((b) => b.skills === true && b.feature === "chat")
  .pop() ?? null`);
const lastAi = () => ev(`[...document.querySelectorAll(".ai-msg")].pop()?.innerText ?? ""`);
const IDLE = `!document.querySelector(".ai-msg.ai-streaming")
  && /PJINS/.test([...document.querySelectorAll(".ai-msg")].pop()?.innerText ?? "")`;
// Gửi một câu ở ô soạn tin đang hiện rồi chờ câu trả lời xong.
async function ask(sel, text, n) {
  await tap(`document.querySelector(${JSON.stringify(sel)})`, "ô soạn tin");
  await t.type(text);
  await sleep(150);
  await t.key("Enter", "Enter", 13);
  await until(`document.querySelectorAll(".ai-msg").length >= ${n}`, 15_000);
  const done = await until(IDLE, 90_000);
  return { done, reply: await lastAi(), body: await lastChatBody() };
}

async function engine(label, key, keys) {
  console.log(`━━ ${label}${key ? ` (${key})` : ""}`);
  if (!key) { ok(false, `${label}: máy giả lập không có model của engine này`, keys.slice(0, 40)); return; }
  // Model đã chọn lưu theo tài khoản và chỉ đọc lúc mở trang: ghi rồi tải lại trang. Ngay sau khi đăng nhập /
  // đăng xuất gói, trang có thể còn danh sách model cũ và đổi lựa chọn về Tự động: ghi lại tới khi giữ được.
  await P("Page.navigate", { url: `${B}/` });
  await until(`!!document.querySelector("textarea")`, 30_000);
  const kept = `localStorage.getItem("u:${uid}:model") === ${JSON.stringify(key)}`;
  for (let i = 0; i < 3; i++) {
    await ev(`localStorage.setItem("u:${uid}:model", ${JSON.stringify(key)}), 1`);
    await P("Page.reload", {});
    await until(`!!document.querySelector("textarea")`, 30_000);
    await sleep(1500);
    if (await ev(kept)) break;
  }
  await P("Page.navigate", { url: `${B}/#v=projects` });
  await until(`!!document.querySelector(".pj-new")`, 30_000);
  // Hộp thoại tạo dự án: chỉ điền tên và ô "Mục tiêu và bối cảnh", không đặt gì ở thẻ Hướng dẫn.
  await tap(`document.querySelector(".pj-new")`, "nút Dự án mới");
  await until(`!!document.querySelector("#sy-pj-desc")`, 8000);
  await tap(`document.querySelector("#sy-pj-name")`, "ô tên dự án");
  await t.type(`Kiwi ${label}`);
  await tap(`document.querySelector("#sy-pj-desc")`, "ô Mục tiêu và bối cảnh");
  await t.type(GOAL);
  await tap(`document.querySelector(".sy-modal .sy-mf .btn.dark")`, "nút Tạo dự án");
  const onPage = await until(`!!document.querySelector(".pj-compose textarea")
    && !document.querySelector("#sy-pj-desc")`, 10_000);
  ok(onPage, `${label}: tạo dự án bằng hộp thoại, đang ở trang dự án`);
  if (!onPage) return;
  const pid = await ev(`(() => { const ps = JSON.parse(localStorage.getItem("u:${uid}:projects") || "[]");
    return ps.find((p) => p.name === ${JSON.stringify(`Kiwi ${label}`)})?.id ?? null; })()`);

  // Câu đầu của đoạn chat mới, gửi từ trang dự án.
  const a = await ask(".pj-compose textarea", "Thủ đô của Pháp là gì? #pjins", 1);
  const b = a.body ?? {};
  ok(b.project === pid && pid !== null, `${label}: câu đầu mang đúng mã dự án`, { sent: b.project, pid });
  ok(typeof b.system === "string" && b.system.includes(GOAL),
    `${label}: lời nhắc trình duyệt gửi có mục tiêu dự án`, b.system);
  ok(b.model === key, `${label}: lượt chạy bằng model đã chọn`, b.model);
  ok(a.done && /^PJINS x1: /.test(a.reply) && a.reply.includes("KIWI-PROJ"),
    `${label}: lời nhắc engine nhận có mục tiêu dự án, đúng một lần`, a.reply);

  // Câu nối tiếp trong cùng đoạn chat (CLI nối tiếp phiên, khóa API gửi lại cả lời nhắc).
  const c = await ask("textarea", "Còn thủ đô của Ý? #pjins", 2);
  const cb = c.body ?? {};
  ok(cb.project === pid && String(cb.system ?? "").includes(GOAL),
    `${label}: câu nối tiếp vẫn mang dự án và mục tiêu`, cb);
  ok(c.done && /^PJINS x1: /.test(c.reply) && c.reply.includes("KIWI-PROJ"),
    `${label}: câu nối tiếp, engine vẫn có mục tiêu dự án`, c.reply);
  await t.shot(`project-ins-${label.replace(/\W+/g, "-")}`);
}

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await t.size(1280, 860);
  for (const phase of PHASES) {
    for (const cli of PLANS) {
      if (phase.plans && !(await loggedIn(cli))) ok(await loginPlan(cli), `đăng nhập gói giả lập ${cli}`);
      if (!phase.plans && (await loggedIn(cli))) await api("POST", `/api/engines/${cli}/logout`);
    }
    const keys = await keysNow();
    for (const [label, key] of phase.engines(keys)) await engine(label, key, keys);
  }
  ok(!t.logs.length, "không có lỗi JavaScript trên trang", t.logs);
} finally {
  t.close();
  for (const cli of PLANS) {
    const want = before.includes(cli), now = await loggedIn(cli);
    if (now && !want) await api("POST", `/api/engines/${cli}/logout`);
    if (!now && want) await loginPlan(cli);
  }
}
console.log(`\n${fail ? `${pass}/${pass + fail} đạt` : `${pass}/${pass} đạt`}`);
process.exit(fail ? 1 : 0);
