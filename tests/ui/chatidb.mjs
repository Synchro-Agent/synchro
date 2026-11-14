// Kho đoạn chat IndexedDB (blueprint B4): tài khoản 500 đoạn chat mở không khựng, chỉ ghi phần đổi, không mất đoạn chat / chỉnh sửa khi tải lại,
// sửa lúc mất mạng, hai tab, đăng xuất / đăng nhập; giữ khóa cũ 7 ngày; trình duyệt không mở được IndexedDB thì dùng localStorage; hết chỗ thì báo.
// Chạy tay: BASE=http://localhost:3200 SHOTS=/tmp/x node tests/ui/chatidb.mjs (đo số nên chạy trên bản production: npm run dev:mock:fast)
import { writeFileSync } from "node:fs";
import { openChrome, sleep } from "../lib/cdp.mjs";
import { tempUser } from "../lib/tempuser.mjs";
import { freshDevice, idbCount, idbMeta, idbRows } from "../lib/idbchats.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const PORT = Number(process.env.CDP_PORT ?? 9394);
// Tab thứ hai trong cùng Chrome: /json/new mở tab, nói chuyện thẳng với WebSocket của tab đó.
async function tab2(port) {
  const j = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(j.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); } });
  const P = (method, params = {}) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch {} await fetch(`http://127.0.0.1:${port}/json/close/${j.id}`).catch(() => {}); };
  return { P, ev, until, close };
}
const N = Number(process.env.CHATS ?? 500);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const nums = {};
const note = (k, v) => { nums[k] = v; console.log(`    · ${k}: ${typeof v === "number" ? Math.round(v * 10) / 10 : JSON.stringify(v)}`); };

const u = await tempUser(B, "chatidb");
const { uid } = u;
const t = await openChrome({ base: B, port: PORT, name: "chatidb", shots: process.env.SHOTS });
const { P, ev, until } = t;
await P("Network.setCookie", { name: "synchro_session", value: u.cookie.split("=")[1], url: B });

// Đo trong trang, trước mọi mã của app: tác vụ dài, JSON.parse > 5ms (luồng chính), lúc dòng đầu tiên của thanh bên hiện ra.
// Cờ trong sessionStorage (giữ qua tải lại trong cùng tab): offline = /api/chats lỗi mạng (500 đoạn chat không bị đẩy lên máy chủ thử),
// noidb = indexedDB.open ném InvalidStateError (Firefox / Safari riêng tư), quota = ghi thân báo QuotaExceededError.
const INIT = `(() => {
  if (location.origin !== ${JSON.stringify(B)} || location.pathname.startsWith("/api/")) return;
  window.__lt = []; window.__jp = []; window.__first = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
  const parse = JSON.parse;
  JSON.parse = function (s, r) { const a = performance.now(); const v = parse.call(this, s, r); const d = performance.now() - a; if (d > 5) __jp.push({ s: a, d, n: typeof s === "string" ? s.length : 0 }); return v; };
  new MutationObserver((ms, o) => { if (document.querySelector(".chat-item")) { __first = performance.now(); o.disconnect(); } }).observe(document, { childList: true, subtree: true });
  const f = sessionStorage.getItem("t:flags") || "";
  if (f.includes("offline")) { const F = window.fetch; window.fetch = (u, o) => (String(u && u.url ? u.url : u).includes("/api/chats") ? Promise.reject(new TypeError("offline")) : F(u, o)); }
  if (f.includes("noidb")) IDBFactory.prototype.open = function () { throw new DOMException("private mode", "InvalidStateError"); };
  if (f.includes("quota")) { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (this.name === "body") throw new DOMException("full", "QuotaExceededError"); return put.call(this, v, k); }; }
})()`;
await P("Page.addScriptToEvaluateOnNewDocument", { source: INIT });

const LSK = `u:${uid}:chats`;
// 500 đoạn chat, 10 tin mỗi đoạn, ~3.5 triệu ký tự: khóa localStorage cũ của một người dùng lâu năm. Đoạn thứ 480 tính từ mới nhất
// ("Đoạn chat số 19") có một từ chỉ nằm trong thân để thử tìm sâu sau khi đọc xong thân.
const OLD = N - 1 - 480, WORD = "ZEBRAQUARTZ480";
const SEED = `(() => {
  const base = Date.now() - 86400000 * 30, lorem = "Synchro ghi chú kế hoạch dự án tuần này gồm nhiều việc cần làm và kết quả mong đợi của cả nhóm. ";
  const chats = [];
  for (let i = 0; i < ${N}; i++) {
    const id = base + i * 1000, msgs = [];
    for (let k = 0; k < 10; k++) msgs.push({ role: k % 2 ? "ai" : "user", text: (k % 2 ? "Trả lời " : "Hỏi ") + i + "-" + k + " " + lorem.repeat(k % 2 ? 12 : 1) + (i === ${OLD} && k === 3 ? " ${WORD} " : ""), time: id + k, done: true });
    chats.push({ id, title: "Đoạn chat số " + i, msgs });
  }
  chats.reverse();
  const s = JSON.stringify(chats);
  localStorage.setItem(${JSON.stringify(LSK)}, s); localStorage.setItem("p:uilang", '"vi"'); localStorage.setItem("theme", "light");
  return s.length;
})()`;
const flags = (f) => ev(`sessionStorage.setItem("t:flags", ${JSON.stringify(f)}); 1`);
const load = () => ev(`window.__chatLoad ? window.__chatLoad() : null`);
const open = async (path = "/") => { await P("Page.navigate", { url: B + path }); return until(`!!document.querySelector("textarea")`, 60000); };
const ready = async (ms = 30000) => until(`!!(window.__chatLoad && window.__chatLoad().ready && window.__chatLoad().kind)`, ms);
const rowOf = (title) => `[...document.querySelectorAll(".chat-item")].find((e) => e.querySelector(".ct-t")?.textContent === ${JSON.stringify(title)})`;
const clickEl = async (expr) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("không thấy: " + expr.slice(0, 120));
  await t.click(r[0], r[1]);
};
const pin = async (title) => {
  await clickEl(`${rowOf(title)}.parentElement.querySelector(".dots")`);
  await until(`!!${rowOf(title)}.parentElement.querySelector(".menu:not(.out)")`, 3000);
  await clickEl(`[...${rowOf(title)}.parentElement.querySelectorAll(".menu-item")].find((b) => /^(Ghim|Bỏ ghim)/.test(b.textContent.trim()))`);
  await sleep(150);
};
const rows = () => ev(idbRows(uid));
const pinnedIn = async (id) => (await rows()).find((r) => r.id === id)?.pinned === true;
// Đo lần mở trang: thời điểm dòng đầu của thanh bên, thân đọc xong, JSON.parse lớn nhất ở luồng chính, tác vụ dài trong 3 giây đầu.
const perf = async (tag) => {
  await ready(60000);
  const m = await ev(`({ first: __first, now: performance.now(), jp: __jp, lt: __lt.filter((x) => x.s < 3000) })`);
  const maxJp = Math.max(0, ...m.jp.map((x) => x.d)), maxLt = Math.max(0, ...m.lt.map((x) => x.d));
  const overlap = m.lt.filter((l) => l.d > 50 && m.jp.some((j) => j.s < l.s + l.d && j.s + j.d > l.s));
  note(`${tag}: thanh bên hiện sau (ms)`, m.first); note(`${tag}: thân đọc xong sau (ms, ≤)`, m.now);
  note(`${tag}: JSON.parse lớn nhất ở luồng chính (ms)`, maxJp); note(`${tag}: tác vụ dài trong 3s đầu`, m.lt.length); note(`${tag}: tác vụ dài lớn nhất (ms)`, maxLt);
  return { ...m, maxJp, maxLt, overlap };
};

try {
  await t.size(1440, 900);
  await open("/");
  const uidOk = await ev(`fetch("/api/auth/me").then((r) => r.json()).then((j) => j.user.id)`);
  ok(uidOk === uid, "đăng nhập đúng tài khoản tạm");

  console.log(`1. Khóa cũ ${N} đoạn chat → IndexedDB (lần mở đầu sau khi cập nhật)`);
  await freshDevice(t, B, uid);
  await flags("offline");
  const size = await ev(SEED);
  note("khóa cũ (ký tự)", size);
  // Mốc so sánh: cách cũ đọc cả khóa bằng một JSON.parse ở luồng chính (hai lần mỗi lần mở trang).
  note("cách cũ: một lần JSON.parse cả khóa (ms)", await ev(`(() => { const s = localStorage.getItem(${JSON.stringify(LSK)}); const a = performance.now(); JSON.parse(s); return performance.now() - a; })()`));
  await open("/");
  const m1 = await perf("lần đầu (chuyển dữ liệu)");
  const st1 = await load();
  ok(st1.kind === "idb", "dùng IndexedDB", st1);
  ok(st1.imported === N, `nhập đủ ${N} đoạn`, st1);
  ok(st1.via === "worker", "khóa cũ đọc ở luồng phụ (chatmigrate.worker.ts tải được)", st1);
  note("lần đầu: đọc khóa cũ ở", st1.via);
  ok(await ev(`document.querySelectorAll(".chat-item").length`) === 20 && await ev(`!!document.querySelector(".adm-pager")`), "thanh bên: 20 dòng + phân trang");
  const c1 = await ev(idbCount(uid));
  ok(c1.idx === N && c1.body === N, `IndexedDB có ${N} chỉ mục + ${N} thân`, c1);
  ok(await ev(`localStorage.getItem(${JSON.stringify(LSK)}) !== null`), "khóa cũ vẫn còn (giữ 7 ngày)");
  const meta1 = await ev(idbMeta(uid));
  ok(!!meta1?.migratedAt && !!meta1?.sig, "đã ghi mốc chuyển dữ liệu", meta1);
  ok(m1.jp.every((x) => x.d < 50 || x.n < 100000), "không JSON.parse cả khóa ở luồng chính (> 50ms)", m1.jp);

  console.log("2. Mở lại (thường ngày): không đọc cả danh sách, không tác vụ dài vì JSON.parse");
  await open("/");
  const m2 = await perf("mở lại");
  ok(m2.maxJp < 50, "JSON.parse lớn nhất < 50ms", m2.jp);
  ok(!m2.overlap.length, "không tác vụ dài > 50ms nào trùng một lần JSON.parse trong 3 giây đầu", m2.overlap);
  ok(m2.first > 0 && m2.first < 3000, "thanh bên hiện trong 3 giây", m2.first);
  // Đoạn ở trang 3 của phân trang (đọc thân lúc mở hoặc ở nền), chữ hiện trong 1 giây.
  for (let i = 0; i < 2; i++) { await clickEl(`document.querySelector(".adm-pager [aria-label='Next page']")`); await sleep(120); }
  const p3 = `Đoạn chat số ${N - 1 - 45}`;
  await until(`!!${rowOf(p3)}`, 3000);
  const tOpen = Date.now();
  await clickEl(rowOf(p3));
  const shown = await until(`document.querySelector(".thread")?.textContent.includes("Hỏi ${N - 1 - 45}-0")`, 1000);
  note("mở đoạn ở trang 3 (ms)", Date.now() - tOpen);
  ok(shown, "mở đoạn ở trang 3: nội dung hiện trong 1 giây");
  // Tìm sâu (bảng lệnh ⌘K) thấy từ chỉ có trong thân của đoạn thứ 480.
  await t.key("k", "KeyK", 75, 2);
  await until(`!!document.querySelector(".pal input")`, 5000);
  await ev(`(() => { const e = document.querySelector(".pal input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(WORD.toLowerCase())}); e.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
  const found = await until(`[...document.querySelectorAll(".pal .s-row")].some((r) => r.textContent.includes("Đoạn chat số ${OLD}"))`, 5000);
  ok(found, "bảng lệnh tìm sâu thấy từ chỉ có trong thân đoạn thứ 480");
  await t.key("Escape", "Escape", 27); await sleep(200);

  console.log("3. Chỉ ghi phần đổi: ghim một đoạn = 1 lần ghi thân + 1 lần ghi chỉ mục");
  await ev(`window.__puts = {}; window.__put0 = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { __puts[this.name] = (__puts[this.name] || 0) + 1; return __put0.call(this, v, k); }; 1`);
  const T3 = `Đoạn chat số ${N - 3}`, id3 = (await rows()).find((r) => r.title === T3)?.id;
  await pin(T3);
  await sleep(1500);
  const puts = await ev(`window.__puts`);
  ok(puts.body === 1 && puts.idx === 1, "đúng 1 thân + 1 chỉ mục", puts);
  ok(await pinnedIn(id3), "dấu ghim nằm trong chỉ mục");
  await ev(`IDBObjectStore.prototype.put = window.__put0; 1`);

  console.log("4. Sửa lúc mất mạng rồi tải lại ngay (chưa kịp lưu): nhật ký lúc rời trang giữ chỉnh sửa");
  const T4 = `Đoạn chat số ${N - 4}`, id4 = (await rows()).find((r) => r.title === T4)?.id;
  await pin(T4);
  await open("/");
  await ready();
  ok(await ev(`!!${rowOf(T4)} && !!document.querySelector(".pin-sec, .chat-list") && [...document.querySelectorAll(".chat-wrap")].some((w) => w.querySelector(".ct-t")?.textContent === ${JSON.stringify(T4)})`), "đoạn vẫn ở thanh bên");
  ok(await pinnedIn(id4), "dấu ghim còn sau khi tải lại ngay");
  ok(await ev(`localStorage.getItem("u:${uid}:chatJournal") === null`), "nhật ký đã được áp và xóa");

  console.log("5. Hai tab cùng sửa: không tab nào ghi đè chỉnh sửa của tab kia");
  const T5a = `Đoạn chat số ${N - 6}`, T5b = `Đoạn chat số ${N - 7}`;
  const id5a = (await rows()).find((r) => r.title === T5a)?.id, id5b = (await rows()).find((r) => r.title === T5b)?.id;
  // Tab B: tab thứ hai của cùng Chrome (cùng hồ sơ, cùng IndexedDB), điều khiển qua WebSocket riêng của tab đó.
  const tb = await tab2(PORT);
  await tb.P("Page.enable"); await tb.P("Runtime.enable");
  await tb.P("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
  await tb.P("Page.navigate", { url: B + "/api/auth/me" }); await sleep(800);
  await tb.ev(`sessionStorage.setItem("t:flags", "offline"); 1`);
  await tb.P("Page.navigate", { url: B + "/" });
  ok(await tb.until(`!!(window.__chatLoad && window.__chatLoad().ready && document.querySelector(".chat-item"))`, 60000), "tab thứ hai mở xong");
  // Tab B ghim T5b (qua kho của tab B), tab A ghim T5a.
  await tb.ev(`(() => { const row = [...document.querySelectorAll(".chat-item")].find((e) => e.querySelector(".ct-t")?.textContent === ${JSON.stringify(T5b)}); row.parentElement.querySelector(".dots").click(); return 1; })()`);
  await sleep(300);
  await tb.ev(`(() => { const row = [...document.querySelectorAll(".chat-item")].find((e) => e.querySelector(".ct-t")?.textContent === ${JSON.stringify(T5b)}); [...row.parentElement.querySelectorAll(".menu-item")].find((b) => /^Ghim/.test(b.textContent.trim())).click(); return 1; })()`);
  await pin(T5a);
  await sleep(1500);
  ok(await pinnedIn(id5a) && await pinnedIn(id5b), "kho có cả hai chỉnh sửa", [await pinnedIn(id5a), await pinnedIn(id5b)]);
  // Tab B đóng, tab A tải lại: cả hai chỉnh sửa còn (tab A không ghi lại bản cũ của đoạn tab B đã sửa).
  await tb.close();
  await open("/");
  await ready();
  await sleep(1500);
  ok(await pinnedIn(id5a) && await pinnedIn(id5b), "tải lại tab A: cả hai dấu ghim còn");

  console.log("6. Đăng xuất (giữ dữ liệu) → đăng nhập lại; đăng xuất kèm xóa khi chưa lên máy chủ thì báo, không xóa");
  const logoutDialog = async () => {
    await clickEl(`document.querySelector(".rail-user .user")`);
    await until(`[...document.querySelectorAll(".usermenu .menu-item")].some((b) => b.textContent.includes("Đăng xuất"))`, 3000);
    await clickEl(`[...document.querySelectorAll(".usermenu .menu-item")].find((b) => b.textContent.includes("Đăng xuất"))`);
    await until(`!!document.querySelector(".modal-foot .btn.danger")`, 3000);
  };
  await logoutDialog();
  await clickEl(`document.querySelector(".modal-foot .btn.danger")`);
  const warned = await until(`!!document.querySelector("[role=alert]") && /Vẫn xóa/.test(document.querySelector(".modal-foot .btn.danger")?.textContent ?? "")`, 20000);
  ok(warned, "đăng xuất kèm xóa khi đoạn chat chưa lên máy chủ (mất mạng): báo và không xóa");
  ok((await ev(idbCount(uid))).idx === N, "kho vẫn đủ sau khi báo", await ev(idbCount(uid)));
  await ev(`(() => { const c = document.querySelector(".sy-modal input[type=checkbox], .modal input[type=checkbox]"); c.click(); return 1; })()`);
  await sleep(150);
  await clickEl(`document.querySelector(".modal-foot .btn.danger")`);
  await until(`!document.querySelector(".chat-item")`, 10000);
  await sleep(500);
  ok((await ev(idbCount(uid))).idx === N, "đăng xuất (giữ dữ liệu): kho còn đủ");
  // Đăng nhập lại (phiên mới của cùng tài khoản).
  const lr = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: u.email, password: u.password }) });
  const ck = (lr.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
  ok(!!ck, "đăng nhập lại được", lr.status);
  await P("Network.setCookie", { name: "synchro_session", value: (ck ?? u.cookie).split("=")[1], url: B });
  await open("/");
  await ready();
  ok(await ev(`document.querySelectorAll(".chat-item").length`) >= 20 && await pinnedIn(id3) && await pinnedIn(id4), "đăng nhập lại: đủ đoạn chat và chỉnh sửa");

  console.log("7. Hết 7 ngày: xóa khóa cũ, đoạn chat vẫn đủ");
  await ev(idbMeta(uid, { migratedAt: Date.now() - 8 * 86400000 }));
  await open("/");
  await ready();
  await sleep(500);
  ok(await ev(`localStorage.getItem(${JSON.stringify(LSK)}) === null`), "khóa cũ đã xóa");
  ok((await ev(idbCount(uid))).idx === N, `vẫn đủ ${N} đoạn trong kho`);
  ok(await ev(`document.querySelectorAll(".chat-item").length`) >= 20, "thanh bên vẫn đủ");

  console.log("8. Hết chỗ khi ghi (và máy chủ chưa nhận): dải cảnh báo");
  await flags("offline,quota");
  await open("/");
  await ready();
  await pin(`Đoạn chat số ${N - 9}`);
  ok(await until(`!!document.querySelector(".sync-warn")`, 8000), "có dải cảnh báo đồng bộ");
  await t.shot("chatidb-quota");

  console.log("9. Điện thoại 375px: mở lại không khựng, mở đoạn chat từ ngăn kéo không chớp khung chờ, #c= mở thẳng đoạn cũ");
  await flags("offline");
  await t.size(375, 812, true);
  await open("/");
  const m9 = await perf("điện thoại");
  ok(m9.maxJp < 50 && !m9.overlap.length, "điện thoại: không JSON.parse dài, không tác vụ dài trùng JSON.parse", { maxJp: m9.maxJp, overlap: m9.overlap });
  // Mở trang rồi bấm ngay một đoạn cũ (còn là bản rút gọn): khung chờ không được hiện (thân đọc trong < 150ms).
  await open("/");
  await until(`!!document.querySelector(".chat-item")`, 10000);
  if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await clickEl(`document.querySelector("[aria-label='Mở thanh bên']")`); await sleep(500); }
  for (let i = 0; i < 4; i++) { await clickEl(`document.querySelector(".adm-pager [aria-label='Next page']")`); await sleep(80); }
  const T9 = await ev(`[...document.querySelectorAll(".chat-item .ct-t")].at(-1)?.textContent`);
  const local9 = await ev(`(() => { const s = window.__chatLoad(); return !s.ready; })()`);
  await clickEl(rowOf(T9));
  await sleep(150);
  const sk = await ev(`!!document.querySelector(".thread .sk-ai")`);
  ok(!sk, "không có khung chờ sau 150ms", { local9 });
  ok(await until(`/Hỏi \\d+-0/.test(document.querySelector(".thread")?.textContent ?? "")`, 1500), "nội dung hiện");
  await open(`/#c=${(await rows()).find((r) => r.title === `Đoạn chat số ${OLD}`)?.id}`);
  ok(await until(`document.querySelector(".thread")?.textContent.includes(${JSON.stringify(WORD)})`, 3000), "#c= mở thẳng đoạn thứ 480 sau khi tải lại");
  await t.shot("chatidb-phone");
  await t.size(1440, 900);

  console.log("10. Trình duyệt không mở được IndexedDB (riêng tư): dùng localStorage, đoạn chat mới còn sau khi tải lại");
  await freshDevice(t, B, uid);
  await ev(`(() => { const now = Date.now(); localStorage.setItem(${JSON.stringify(LSK)}, JSON.stringify([1, 2, 3].map((i) => ({ id: now - i * 1000, title: "Riêng tư " + i, msgs: [{ role: "user", text: "Câu " + i, time: now - i * 1000 }, { role: "ai", text: "Đáp " + i, time: now - i * 1000 + 1, done: true }] })))); localStorage.setItem("p:uilang", '"vi"'); return 1; })()`);
  await flags("offline,noidb");
  await open("/");
  await ready();
  ok((await load()).kind === "ls", "dùng localStorage", await load());
  ok(await ev(`document.querySelectorAll(".chat-item").length`) === 3, "đọc đủ 3 đoạn từ localStorage");
  await clickEl(`document.querySelector("textarea")`);
  await P("Input.insertText", { text: "Tin nhắn riêng tư FALLBACK777" });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await until(`!!document.querySelector(".actions.in") && !document.querySelector(".thinking")`, 60000);
  await sleep(1200);
  await open("/");
  await ready();
  ok(await ev(`(localStorage.getItem(${JSON.stringify(LSK)}) ?? "").includes("FALLBACK777")`), "đoạn chat mới nằm trong localStorage");
  ok(await ev(`document.querySelectorAll(".chat-item").length`) === 4, "tải lại: 4 đoạn");
  // IndexedDB mở lại được (phiên sau): nhập những gì phiên dự phòng đã ghi.
  await flags("offline");
  await open("/");
  await ready();
  ok((await load()).kind === "idb" && (await rows()).some((r) => (r.body ?? "").includes("FALLBACK777")), "phiên sau có IndexedDB: đoạn chat của phiên dự phòng được nhập");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await t.shot("chatidb-fail").catch(() => {}); }
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ pass, fail, nums }, null, 1));
t.close();
await u.remove().catch(() => {});
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
