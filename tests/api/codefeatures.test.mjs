// Tính năng Synchro Code lấy cảm hứng từ tab Code của Claude, chạy thật trên dev:mock (workspace giả lập có Chrome thật, GitHub giả lập):
// cài đặt ở máy chủ, đồng bộ phiên giữa thiết bị, chế độ quyền (hỏi trước / tự sửa tệp / tự động) với khóa API lẫn gói subscription,
// suy nghĩ của model, phân loại phiên + gợi ý câu nhắn, trang web được phép (Code và chat), cookie của trình duyệt Synchro,
// tự tạo pull request theo tiền tố nhánh, tự sửa PR khi CI lỗi / có góp ý, tự lưu trữ phiên khi PR được gộp.
import Database from "better-sqlite3";
import path from "node:path";
import { findChrome } from "../../scripts/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010", GH = process.env.GH_URL ?? "http://127.0.0.1:4013";
const DB = path.resolve(process.env.DATA_DIR ?? "data-mock", "synchro.db");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body, extra = {}) => {
  const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie, ...(extra.headers ?? {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j, h: r.headers };
};
const gh = async (p, body) => { const r = await fetch(GH + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => null); };
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const HAIKU = "anthropic/claude-haiku-5-5";
const newSid = () => String(1795000000000 + Math.floor(Math.random() * 1e9));
// Một lượt Synchro Code: đọc NDJSON tới khi xong; onEvent nhận từng sự kiện (trả lời câu hỏi duyệt ngay khi nó tới).
const turn = async (text, sid, o = {}) => {
  const ac = new AbortController();
  const r = await fetch(`${B}/api/agent`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", origin: B, cookie },
    body: JSON.stringify({ sid, model: o.model ?? HAIKU, messages: [{ role: "user", content: text }], skills: false, perm: o.perm }) });
  if (!r.ok) return { status: r.status, events: [], error: (await r.json().catch(() => ({}))).error };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  const events = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const e = JSON.parse(l); events.push(e); await o.onEvent?.(e, ac); } }
    }
  } catch (e) { if (!ac.signal.aborted) throw e; }
  return { status: r.status, events, done: events.find((e) => e.t === "done"), meta: events.find((e) => e.t === "meta"), error: events.find((e) => e.t === "error")?.error };
};
const approve = (id, ok2, o = {}) => api("POST", "/api/approve", { id, ok: ok2, ...o });
const seq = (steps, extra = "") => `Làm theo các bước ${extra} #seq=${JSON.stringify(steps)}`;
const prefs = (p) => api("PATCH", "/api/code/prefs", p);
const ws = (b) => api("POST", "/api/ws", b);
const readFile = async (sid, p) => (await ws({ op: "read", sid, path: p })).j?.content;
const until = async (f, ms = 60_000, step = 500) => { const t = Date.now(); for (;;) { const v = await f(); if (v || Date.now() - t > ms) return v; await sleep(step); } };

const orig = (await api("GET", "/api/code/prefs")).j;

console.log("1. Cài đặt Synchro Code lưu ở máy chủ");
let r = await api("GET", "/api/code/prefs");
ok(r.s === 200 && r.j.classify === true && r.j.sync === true && r.j.allowBypass === true && r.j.permMode === "auto" && r.j.cookies === "keep" && r.j.siteAsk === false && r.j.branchPrefix === "synchro" && r.j.autoPr === false, "mặc định đúng", r.j);
r = await prefs({ permMode: "bogus", archiveAfter: 5, cookies: "x", sites: ["https://Example.com/a?b", "khong hop le", "*.foo.org", "example.com"], branchPrefix: " my team/ " });
ok(r.j.permMode === "auto" && r.j.archiveAfter === 0 && r.j.cookies === "keep" && JSON.stringify(r.j.sites) === '["example.com","foo.org"]' && r.j.branchPrefix === "my-team", "giá trị sai bị bỏ, trang được chuẩn hóa, tiền tố nhánh làm sạch", r.j);
r = await prefs({ allowBypass: false });
ok(r.j.allowBypass === false && r.j.permMode === "edits", "tắt cho phép Tự động: chế độ mặc định hạ xuống Tự sửa tệp", r.j);
await prefs({ allowBypass: true, permMode: "auto", sites: [], branchPrefix: "synchro" });

console.log("2. Đồng bộ phiên giữa các thiết bị");
const S1 = Number(newSid());
r = await api("PUT", "/api/code/sessions", { id: S1, title: "Phiên đồng bộ", data: { nodes: [{ id: 1, parent: 0, user: "xin chào", ai: "chào bạn", done: true }], sel: {} }, base: 0 });
ok(r.s === 200 && r.j.updated > 0 && !r.j.merged, "thiết bị A lưu phiên", r.j);
const baseA = r.j.updated;
r = await api("GET", "/api/code/sessions");
ok(r.j.sessions.some((x) => x.id === S1 && x.title === "Phiên đồng bộ" && !x.deleted), "danh sách có phiên mới", r.j.sessions?.slice(0, 2));
r = await api("GET", `/api/code/sessions?id=${S1}&since=${baseA}`);
ok(r.j.same === true && !r.j.data, "thiết bị đã có bản mới nhất: không gửi lại nội dung", r.j);
r = await api("PUT", "/api/code/sessions", { id: S1, title: "Phiên đồng bộ", data: { nodes: [{ id: 2, parent: 1, user: "từ thiết bị B", ai: "", done: false }], sel: {} }, base: 0 });
ok(r.j.merged && r.j.data.nodes.map((n) => n.id).join(",") === "1,2", "thiết bị B lưu bản cũ hơn: máy chủ gộp, không mất lượt của A", r.j);
r = await api("PATCH", "/api/code/sessions", { id: S1, archived: true });
r = await api("GET", "/api/code/sessions");
ok(r.j.sessions.find((x) => x.id === S1)?.archived === true, "lưu trữ phiên đồng bộ sang thiết bị khác");
await api("DELETE", `/api/code/sessions?id=${S1}`);
r = await api("GET", "/api/code/sessions");
ok(r.j.sessions.find((x) => x.id === S1)?.deleted === true && (await api("GET", `/api/code/sessions?id=${S1}`)).s === 404, "xóa: thiết bị khác thấy dấu đã xóa, không mở lại được");
await prefs({ sync: false });
ok((await api("PUT", "/api/code/sessions", { id: S1, title: "x", data: { nodes: [] } })).s === 409, "tắt đồng bộ: máy chủ không nhận phiên");
await prefs({ sync: true });
// Tự lưu trữ phiên không hoạt động: phiên chạm lần cuối 2 ngày trước, ngưỡng 1 ngày.
const S2 = Number(newSid());
await api("PUT", "/api/code/sessions", { id: S2, title: "Phiên cũ", data: { nodes: [] } });
{ const d = new Database(DB); d.prepare("UPDATE code_sessions SET touched_at = ? WHERE id = ?").run(Date.now() - 2 * 86_400_000, S2); d.close(); }
await prefs({ archiveAfter: 1 });
r = await api("GET", "/api/code/sessions");
ok(r.j.sessions.find((x) => x.id === S2)?.archived === true, "phiên không hoạt động quá 1 ngày được tự lưu trữ", r.j.sessions.find((x) => x.id === S2));
await prefs({ archiveAfter: 0 });

console.log("3. Chế độ quyền: hỏi trước");
const S3 = newSid();
let asks = [];
r = await turn(seq([
  { tool: "write_file", args: { path: "a.txt", content: "xin chao" } },
  { tool: "bash", args: { command: "echo hi > b.txt", description: "Ghi tệp b" } },
  { tool: "bash", args: { command: "git status", description: "Xem git" } },
  { tool: "bash", args: { command: "ls | head -5", description: "Liệt kê" } },
], "#think"), S3, { perm: { mode: "ask", allow: [] }, onEvent: async (e) => {
  if (e.t !== "ask") return;
  asks.push(e);
  if (e.kind === "edit") await approve(e.id, true);
  else await approve(e.id, false, { note: "đừng ghi b.txt, dùng c.txt" });
} });
ok(asks.length === 2 && asks[0].kind === "edit" && /a\.txt/.test(asks[0].title) && asks[1].kind === "bash" && asks[1].detail === "echo hi > b.txt", "hỏi trước khi sửa tệp và chạy lệnh có ghi; lệnh chỉ đọc (git status, ls | head) không hỏi", asks);
const asked = r.events.filter((e) => e.t === "asked");
ok(asked.length === 2 && asked[0].ok && !asked[1].ok, "giao diện nhận câu trả lời của từng câu hỏi", asked);
const res3 = r.events.filter((e) => e.t === "result");
ok(res3.length === 4 && res3[0].ok && !res3[1].ok && res3[1].summary === "Không được phép" && res3[2].ok && res3[3].ok, "bước bị từ chối không chạy, bước khác chạy bình thường", res3.map((x) => [x.ok, x.summary]));
ok(/Bị từ chối 1 bước/.test(r.done?.text ?? ""), "model nhận lý do từ chối (kèm lời nhắn) và trả lời theo", r.done?.text);
ok((await readFile(S3, "a.txt")) === "xin chao" && (await ws({ op: "read", sid: S3, path: "b.txt" })).s !== 200, "tệp được cho phép đã ghi, lệnh bị từ chối không chạy");
ok(r.events.filter((e) => e.t === "think").length >= 3, "suy nghĩ của model gửi về giao diện (kiểu xem Suy nghĩ / Chi tiết)", r.events.filter((e) => e.t === "think").length);
ok(r.meta?.state === "review" && /tệp/.test(r.meta.reason ?? "") && !!r.meta.suggest, "cuối lượt: phân loại phiên (chờ xem lại) và gợi ý câu nhắn tiếp", r.meta);
r = await api("GET", "/api/code/sessions");
ok(r.j.sessions.find((x) => String(x.id) === S3)?.state === "review" && r.j.sessions.find((x) => String(x.id) === S3)?.running === false, "trạng thái phiên lưu ở máy chủ cho thanh bên ở mọi thiết bị", r.j.sessions.find((x) => String(x.id) === S3));

console.log("4. Tự sửa tệp, luôn cho phép trong phiên, tắt chế độ Tự động");
asks = [];
let permEv = null;
r = await turn(seq([{ tool: "write_file", args: { path: "c.txt", content: "c" } }, { tool: "bash", args: { command: "echo 1 > d.txt", description: "Ghi d" } }]), S3, {
  perm: { mode: "edits", allow: [] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await approve(e.id, true, { always: true }); } if (e.t === "perm") permEv = e; } });
ok(asks.length === 1 && asks[0].kind === "bash" && JSON.stringify(permEv?.allow) === '["bash:echo"]', "Tự sửa tệp: sửa tệp không hỏi, lệnh ghi thì hỏi; luôn cho phép lưu khóa lệnh vào phiên", { asks, permEv });
asks = [];
r = await turn(seq([{ tool: "bash", args: { command: "echo 2 > e.txt", description: "Ghi e" } }]), S3, { perm: { mode: "edits", allow: ["bash:echo"] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await approve(e.id, true); } } });
ok(asks.length === 0 && r.events.some((e) => e.t === "result" && e.ok), "lượt sau của phiên: lệnh đã luôn cho phép không hỏi lại");
asks = [];
r = await turn(seq([{ tool: "bash", args: { command: "echo 3 > f.txt", description: "Ghi f" } }]), S3, { perm: { mode: "auto", allow: [] }, onEvent: async (e) => { if (e.t === "ask") asks.push(e); } });
ok(asks.length === 0 && r.events.some((e) => e.t === "result" && e.ok), "Tự động: không hỏi gì");
await prefs({ allowBypass: false });
asks = [];
r = await turn(seq([{ tool: "bash", args: { command: "echo 4 > g.txt", description: "Ghi g" } }]), S3, { perm: { mode: "auto", allow: [] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await approve(e.id, true); } } });
ok(asks.length === 1, "tắt cho phép Tự động: máy chủ không chạy chế độ Tự động dù trình duyệt xin", asks.length);
await prefs({ allowBypass: true });
// Bấm Dừng khi đang chờ duyệt: lượt thôi chờ, câu hỏi không còn trả lời được.
let pendingId = null;
await turn(seq([{ tool: "write_file", args: { path: "h.txt", content: "h" } }]), S3, { perm: { mode: "ask", allow: [] }, onEvent: async (e, ac) => { if (e.t === "ask") { pendingId = e.id; ac.abort(); } } });
await sleep(400);
ok(pendingId && (await approve(pendingId, true)).s === 409, "bấm Dừng khi đang chờ duyệt: câu hỏi hết hiệu lực", pendingId);

console.log("5. Chế độ quyền với gói subscription (Claude Code qua cầu nối MCP)");
const codeOf = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];
await api("POST", "/api/engines/claude/login/start", {});
await api("POST", "/api/engines/claude/login/code", { code: await codeOf("claude") });
asks = [];
r = await turn('Tạo tệp #tool=write_file #args={"path":"sub.txt","content":"tu goi"}', S3, { model: "sub-claude/sonnet", perm: { mode: "ask", allow: [] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await sleep(1500); await approve(e.id, true); } } });
ok(asks.length === 1 && asks[0].kind === "edit" && r.events.some((e) => e.t === "result" && e.ok) && (await readFile(S3, "sub.txt")) === "tu goi", "gói Claude chờ bạn duyệt rồi mới ghi tệp (cùng chốt với khóa API)", { asks, done: r.done?.text, err: r.error });
await api("POST", "/api/engines/claude/logout");

console.log("6. Trang web được phép");
await prefs({ siteAsk: true, sites: [], blocked: ["blocked.test"] });
asks = [];
r = await turn(seq([{ tool: "browser_navigate", args: { url: "https://cho-phep.test/trang" } }, { tool: "browser_navigate", args: { url: "https://blocked.test/" } }, { tool: "browser_navigate", args: { url: `${M}/_fixture/browser-quiz` } }]), S3, {
  perm: { mode: "auto", allow: [] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await approve(e.id, true, { always: true }); } } });
ok(asks.length === 1 && asks[0].kind === "site" && asks[0].host === "cho-phep.test", "trang lạ: hỏi trước khi dùng trình duyệt; trang máy cục bộ không hỏi", asks);
const res6 = r.events.filter((e) => e.t === "result");
ok(res6[1] && !res6[1].ok && res6[1].summary === "Không được phép" && res6[2]?.ok, "trang bị chặn luôn bị từ chối; trang cục bộ mở bình thường", res6.map((x) => [x.ok, x.summary]));
ok((await api("GET", "/api/code/prefs")).j.sites.includes("cho-phep.test"), "\"Luôn cho phép trang này\" thêm vào danh sách trang được phép");
// Chat thường (lượt chạy nền): thẻ hỏi trong đoạn chat.
r = await api("POST", "/api/llm", { async: true, conv: "c" + newSid(), model: HAIKU, skills: true, system: "", messages: [{ role: "user", content: '#browser #tool=browser_navigate #args={"url":"https://chat-moi.test/"}' }] });
const run = r.j?.run;
const askEv = await until(async () => (await api("GET", `/api/runs/${run}?json=1`)).j?.run?.events?.find((e) => e.kind === "ask"), 30_000, 300);
const askJ = askEv ? JSON.parse(askEv.text) : null;
ok(askJ?.kind === "site" && askJ.host === "chat-moi.test", "chat: lượt dừng chờ, giao diện nhận thẻ hỏi duyệt trang", askEv);
if (askJ) await approve(askJ.id, false, { note: "dùng trang khác" });
const fin = await until(async () => { const x = (await api("GET", `/api/runs/${run}?json=1`)).j?.run; return x?.status !== "running" ? x : null; }, 30_000, 300);
ok(fin?.status === "done" && fin.events.some((e) => e.kind === "asked" && JSON.parse(e.text).ok === false), "chat: từ chối thì lượt chạy tiếp và kết thúc bình thường", fin?.status);
// Lượt chat không chạy nền: không có giao diện để hỏi → từ chối ngay, không treo.
const t0 = Date.now();
r = await api("POST", "/api/llm", { model: HAIKU, skills: true, system: "", messages: [{ role: "user", content: '#browser #tool=browser_navigate #args={"url":"https://khong-hoi.test/"}' }] });
ok(r.s === 200 && Date.now() - t0 < 20_000 && /chưa có trong danh sách trang được phép/.test(JSON.stringify(r.j)), "lượt không có giao diện: từ chối ngay, model được dặn nhờ người dùng thêm trang", JSON.stringify(r.j).slice(0, 300));
await prefs({ siteAsk: false, sites: [], blocked: [] });

if (findChrome()) {
  console.log("7. Cookie của trình duyệt Synchro");
  const setC = (sid, v) => turn(seq([{ tool: "browser_navigate", args: { url: `${M}/_fixture/browser-quiz` } }, { tool: "browser_eval", args: { expression: `document.cookie = "syn=${v}; max-age=86400"; document.cookie` } }]), sid, { perm: { mode: "auto", allow: [] } });
  const getC = async (sid) => { const x = await turn(seq([{ tool: "browser_navigate", args: { url: `${M}/_fixture/browser-quiz` } }, { tool: "browser_eval", args: { expression: "document.cookie" } }]), sid, { perm: { mode: "auto", allow: [] } }); return x.events.filter((e) => e.t === "result").pop()?.output ?? ""; };
  await prefs({ cookies: "keep" });
  const A = newSid(), Bs = newSid();
  await setC(A, "giu");
  ok(/syn=giu/.test(await getC(Bs)), "Luôn giữ: phiên khác vẫn thấy cookie");
  await ws({ op: "stop" });
  ok(/syn=giu/.test(await getC(Bs)), "Luôn giữ: trình duyệt tắt rồi bật lại vẫn còn cookie");
  await prefs({ cookies: "session" });
  await setC(A, "rieng");
  ok(!/syn=/.test(await getC(Bs)), "Riêng từng phiên: phiên khác không thấy đăng nhập / cookie");
  await setC(Bs, "b");
  ok(!/syn=/.test(await getC(A)), "Riêng từng phiên: quay lại phiên trước cũng bắt đầu sạch");
  await prefs({ cookies: "until-stop" });
  await setC(A, "tam");
  ok(/syn=tam/.test(await getC(A)), "Đến khi trình duyệt tắt: còn trong lúc trình duyệt chạy");
  await ws({ op: "stop" });
  ok(!/syn=/.test(await getC(A)), "Đến khi trình duyệt tắt: bật lại thì sạch");
  await prefs({ cookies: "keep" });
  await setC(A, "xoa");
  ok((await api("POST", "/api/browser", { op: "wipe" })).s === 200 && !/syn=/.test(await getC(A)), "Xóa dữ liệu duyệt web ngay");
} else console.log("  (máy này không có Chrome: bỏ qua phần cookie)");

console.log("8. GitHub: kết nối, clone, tự tạo pull request theo tiền tố nhánh");
const REPO = `mock-dev/demo-${Date.now().toString(36)}`;
await gh("/_mock/repo", { repo: REPO, files: { "README.md": "# Demo\n", "app.js": "console.log('xin chao')\n" } });
r = await api("GET", "/api/github/connect");
const authUrl = r.h.get("location");
const stateCookie = (r.h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const page = await fetch(authUrl).then((x) => x.text());
const back = /id="allow" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
const done = await fetch(back, { redirect: "manual", headers: { cookie: `${cookie}; ${stateCookie}` } });
r = await api("GET", "/api/github");
ok(done.status < 400 && r.j?.linked && r.j.login === "mock-dev", "kết nối GitHub (giả lập) qua cửa sổ cấp quyền", { status: done.status, gh: r.j });
const S8 = newSid();
r = await ws({ op: "git", action: "clone", sid: S8, repo: REPO });
ok(r.j?.git && r.j.repo === REPO && r.j.branch === "main", "clone repo vào phiên", r.j);
await api("PUT", "/api/code/sessions", { id: Number(S8), title: "Sửa demo", data: { nodes: [{ id: 1, parent: 0, user: "Thêm tính năng", ai: "Đã thêm", done: true }], sel: {}, model: HAIKU } });
r = await turn(seq([{ tool: "write_file", args: { path: "feature.txt", content: "tinh nang moi\n" } }, { tool: "bash", args: { command: "git add -A && git commit -qm 'Thêm tính năng mới'", description: "Commit" } }]), S8, { perm: { mode: "auto", allow: [] } });
await prefs({ autoPr: true, branchPrefix: "synchro" });
r = await ws({ op: "git", action: "push", sid: S8 });
ok(r.s === 200 && r.j.pr?.number === 1 && r.j.pr.created && /^synchro\/them-tinh-nang-moi-/.test(r.j.branch), "đang ở nhánh chính: đẩy sang nhánh mới theo tiền tố rồi tự mở pull request", r.j);
const branch = r.j.branch;
let st = await gh("/_mock/state");
ok(st.prs[REPO]?.[0]?.head?.ref === branch && st.branches[REPO].includes("main") && !(await gh(`/_mock/file?repo=${REPO}&ref=main&path=feature.txt`))?.content, "PR trỏ đúng nhánh mới, nhánh chính chưa bị đổi", st.prs[REPO]);
r = await ws({ op: "git", action: "push", sid: S8 });
ok(r.s === 200 && r.j.pr?.number === 1 && !r.j.pr.created, "push tiếp: dùng lại PR đang mở, không mở PR trùng", r.j.pr);
r = await ws({ op: "git", action: "prs", sid: S8 });
ok(r.j?.prs?.[0]?.number === 1 && r.j.prs[0].state === "open", "Synchro theo dõi PR của phiên", r.j);

console.log("9. Tự sửa PR: CI lỗi, góp ý review");
await prefs({ autoFix: true, autoArchivePr: true });
r = await turn(seq([{ tool: "write_file", args: { path: "BROKEN", content: "x" } }, { tool: "bash", args: { command: "git add -A && git commit -qm 'Thay đổi làm hỏng CI'", description: "Commit" } }]), S8, { perm: { mode: "auto", allow: [] } });
await ws({ op: "git", action: "push", sid: S8 });
const fixed = await until(async () => { const s = await gh("/_mock/state"); const c = s.comments[`${REPO}#1`]?.issue ?? []; return c.find((x) => /Synchro Code/.test(x.body) && /CI lỗi/.test(x.body)) ? s : null; }, 90_000, 1000);
ok(!!fixed, "CI lỗi: Synchro tự sửa trong phiên, đẩy commit và trả lời trên PR", fixed?.comments);
ok(!(await gh(`/_mock/file?repo=${REPO}&ref=${encodeURIComponent(branch)}&path=BROKEN`))?.content && !!(await gh(`/_mock/file?repo=${REPO}&ref=${encodeURIComponent(branch)}&path=feature.txt`))?.content, "nhánh của PR đã hết tệp gây lỗi, giữ thay đổi cũ");
r = await api("GET", `/api/code/sessions?id=${S8}`);
const autoNode = r.j?.data?.nodes?.find((n) => n.auto && /Tự sửa PR #1/.test(n.user));
ok(autoNode?.done && autoNode.steps?.some((x) => x.k === "tool" && x.name === "bash") && r.j.state === "review", "lượt tự sửa hiện trong phiên như một lượt bình thường (đồng bộ tới mọi thiết bị)", { node: autoNode?.user, state: r.j?.state });
await gh("/_mock/comment", { repo: REPO, number: 1, body: "Hãy thêm tệp CHANGELOG.md mô tả thay đổi", login: "reviewer" });
const replied = await until(async () => (await gh(`/_mock/file?repo=${REPO}&ref=${encodeURIComponent(branch)}&path=CHANGELOG.md`))?.content, 90_000, 1000);
ok(!!replied, "góp ý review: Synchro tự làm theo và đẩy commit", replied);
st = await gh("/_mock/state");
ok((st.comments[`${REPO}#1`]?.issue ?? []).filter((x) => /Synchro Code/.test(x.body)).length === 2, "trả lời góp ý trên PR; lời của chính Synchro không bị coi là góp ý mới", st.comments[`${REPO}#1`]?.issue?.map((x) => x.body.slice(0, 60)));

console.log("10. PR được gộp: tự lưu trữ phiên, xóa nhánh");
await gh("/_mock/merge", { repo: REPO, number: 1 });
const arch = await until(async () => { const x = (await api("GET", "/api/code/sessions")).j?.sessions?.find((y) => String(y.id) === S8); return x?.archived ? x : null; }, 30_000, 1000);
ok(arch?.state === "done" && /PR #1 đã gộp/.test(arch.reason ?? ""), "phiên tự lưu trữ, ghi lý do", arch);
st = await gh("/_mock/state");
ok(st.deleted.includes(`${REPO}:${branch}`) && !st.branches[REPO].includes(branch), "nhánh của PR bị xóa trên GitHub sau khi gộp", st.deleted);

console.log("11. Mở PR từ nhánh chính khi không tự tạo PR");
await prefs({ autoPr: false });
const S11 = newSid();
await ws({ op: "git", action: "clone", sid: S11, repo: REPO });
await turn(seq([{ tool: "write_file", args: { path: "docs.md", content: "# Tài liệu\n" } }, { tool: "bash", args: { command: "git add -A && git commit -qm 'Viết tài liệu'", description: "Commit" } }]), S11, { perm: { mode: "auto", allow: [] } });
r = await ws({ op: "git", action: "pr", sid: S11, title: "Viết tài liệu" });
ok(r.s === 200 && r.j.pr?.number === 2 && /^synchro\/viet-tai-lieu-/.test(r.j.branch), "bấm Tạo PR khi đang ở nhánh chính: tự tạo nhánh theo tiền tố, đẩy lên, mở PR", r.j);

await api("PATCH", "/api/code/prefs", orig);
await api("DELETE", "/api/github").catch(() => {});
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
