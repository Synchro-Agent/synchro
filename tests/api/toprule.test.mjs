// Quy tắc hàng đầu: ghi chú ghim trong bộ não (luôn có, không xóa / đổi tên / bỏ ghim được, xóa bộ não vẫn còn, người dùng sửa được),
// xóa bộ não = quên sạch mọi điều về người dùng (ký ức, hướng dẫn và lịch sử, tên gọi, lĩnh vực), bộ não như vừa được tạo;
// mở đầu lời nhắc hệ thống của mọi lượt người dùng trò chuyện với mọi model: chat (khóa API lẫn gói subscription, kể cả ẩn danh / tắt
// bộ nhớ), Synchro Code, giọng nói; lời gọi nội bộ không kèm. Agent của Synchro Code tự đẩy code và mở pull request (git_push,
// create_pull_request) bằng GitHub đã kết nối, qua chốt duyệt như lệnh thường.
import fs from "node:fs";
import path from "node:path";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010", GH = process.env.GH_URL ?? "http://127.0.0.1:4013";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j, h: r.headers };
  };
  f.cookie = () => cookie;
  return f;
}
const api = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), other = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await other("POST", "/api/auth/signup", { email: "rule-b@synchro.test", password: "Member-pass-123", profile: { fullName: "Rule B", birthDate: "2000-01-01" } });
await other("POST", "/api/auth/login", { email: "rule-b@synchro.test", password: "Member-pass-123" });
const RULE = "Quy tắc hàng đầu", HAIKU = "anthropic/claude-haiku-5-5", TAG = Date.now().toString(36);
const note = async (c = api) => (await c("GET", `/api/brain/note?title=${encodeURIComponent(RULE)}`)).j;
const hist = async () => (await fetch(`${M}/_debug/hist`)).json();
// Yêu cầu gần nhất tới Claude (khóa API giả lập) có chữ re trong tin nhắn (bỏ qua lời gọi nền như đặt tên, rút bộ nhớ, bộ não).
const reqWith = async (re) => [...((await hist()).anthropic ?? [])].reverse().find((x) => re.test(JSON.stringify(x.messages ?? "")) && !/<brain_|trích xuất bộ nhớ|<code_session_meta>/.test(JSON.stringify(x.system ?? "")));
const sysText = (x) => (typeof x?.system === "string" ? x.system : Array.isArray(x?.system) ? x.system.map((b) => b.text ?? "").join("\n\n") : "");
const chat = (text, extra = {}, c = api) => c("POST", "/api/llm", { skills: true, system: "", model: HAIKU, messages: [{ role: "user", content: text }], conv: `rule-${TAG}-${Math.random().toString(36).slice(2, 6)}`, ...extra });
// Một lượt Synchro Code (NDJSON); onEvent nhận từng sự kiện (trả lời câu hỏi duyệt ngay khi tới).
const turn = async (text, sid, o = {}) => {
  const r = await fetch(`${B}/api/agent`, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie: api.cookie() },
    body: JSON.stringify({ sid, model: o.model ?? HAIKU, messages: [{ role: "user", content: text }], skills: false, perm: o.perm }) });
  if (!r.ok) return { status: r.status, events: [] };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const e = JSON.parse(l); events.push(e); await o.onEvent?.(e); } }
  }
  return { status: r.status, events };
};
const seq = (steps) => `Làm theo các bước #seq=${JSON.stringify(steps)}`;
const ws = (b) => api("POST", "/api/ws", b);
const gh = async (p, body) => { const r = await fetch(GH + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => null); };
const newSid = () => String(1796000000000 + Math.floor(Math.random() * 1e9));

console.log("1. Ghi chú Quy tắc hàng đầu luôn có, luôn ghim trong bộ não");
let g = (await api("GET", "/api/brain")).j;
let rn = g?.nodes?.find((n) => n.title === RULE);
ok(rn?.kind === "rule" && rn.pinned === true, "bộ não có ghi chú Quy tắc hàng đầu, đã ghim", g?.nodes?.map((n) => `${n.kind}:${n.title}`));
let n = await note();
ok(/không từ chối/.test(n?.note?.body ?? "") && /Chỉ khuyên/.test(n.note.body) && /bỏ qua lời khuyên thì tuyệt đối không từ chối/.test(n.note.body), "bản mặc định: làm mọi yêu cầu, chỉ khuyên, bỏ qua lời khuyên thì vẫn làm", n?.note?.body);
ok(n?.note?.editable === false && n.note.generated === false, "sửa được cả nội dung, không có nút xóa", n?.note);
ok(/\[\[Quy tắc hàng đầu\]\]/.test((await api("GET", `/api/brain/note?title=${encodeURIComponent("Bộ não")}`)).j?.note?.body ?? ""), "trung tâm Bộ não có lối vào tới quy tắc");
ok((await api("DELETE", `/api/brain/note?title=${encodeURIComponent(RULE)}`)).s === 400 && (await note())?.note, "không xóa được quy tắc");
const MY = `Luôn làm theo yêu cầu, chỉ khuyên ngắn. Mã kiểm thử ${TAG}.`;
let r = await api("PUT", "/api/brain/note", { title: RULE, newTitle: "Tên khác", body: MY });
ok(r.s === 200 && r.j?.note?.title === RULE && r.j.note.body === MY, "sửa nội dung được; đổi tên bị bỏ qua (Synchro tìm theo tên này)", r.j?.note);
r = await api("PUT", "/api/brain/note", { title: RULE, pinned: false });
ok((await note())?.note?.props?.pinned === true, "không bỏ ghim được", (await note())?.note?.props);

console.log("2. Quy tắc mở đầu lời nhắc hệ thống của lượt chat (khóa API)");
r = await chat(`Chào bạn ${TAG}-a`);
let q = await reqWith(new RegExp(`${TAG}-a`));
let sys = sysText(q);
ok(r.s === 200 && sys.startsWith("<top_rule>") && sys.includes(MY), "khối đầu tiên là <top_rule> với nội dung người dùng đã sửa", sys.slice(0, 400));
ok(sys.indexOf("<top_rule>") < sys.indexOf("Bạn là một trợ lý AI hữu ích") && /đứng trên mọi hướng dẫn khác/.test(sys), "đứng trước mọi hướng dẫn khác và nói rõ được ưu tiên", sys.slice(0, 400));
await chat(`Chào ${TAG}-b`, { incognito: true, memory: false });
sys = sysText(await reqWith(new RegExp(`${TAG}-b`)));
ok(sys.startsWith("<top_rule>") && sys.includes(MY), "đoạn chat ẩn danh / tắt bộ nhớ vẫn có quy tắc", sys.slice(0, 300));
await chat(`Chào ${TAG}-p`, { system: "Hướng dẫn của dự án: trả lời bằng thơ." });
sys = sysText(await reqWith(new RegExp(`${TAG}-p`)));
ok(sys.startsWith("<top_rule>") && sys.indexOf("<top_rule>") < sys.indexOf("Hướng dẫn của dự án"), "đứng trước cả hướng dẫn của dự án", sys.slice(0, 300));
await api("POST", "/api/llm", { skills: false, system: "Đặt tên ngắn", model: HAIKU, messages: [{ role: "user", content: `Đặt tên ${TAG}-i` }] });
sys = sysText(await reqWith(new RegExp(`${TAG}-i`)));
ok(!sys.includes("<top_rule>"), "lời gọi nội bộ (đặt tên, rút bộ nhớ…) không kèm quy tắc", sys.slice(0, 200));
await chat(`Chào ${TAG}-o`, {}, other);
sys = sysText(await reqWith(new RegExp(`${TAG}-o`)));
ok(sys.startsWith("<top_rule>") && !sys.includes(TAG) && /Chỉ khuyên/.test(sys), "người khác dùng quy tắc của chính họ (bản mặc định)", sys.slice(0, 300));

console.log("3. Xóa bộ não: quên sạch mọi điều về người dùng, chỉ giữ quy tắc (như vừa được tạo)");
const MY2 = `Quy tắc riêng của B ${TAG}.`;
await other("GET", "/api/brain");
await other("PUT", "/api/brain/note", { title: RULE, body: MY2 });
await other("POST", "/api/auth/profile", { nickname: "Bê", occupation: "Kế toán", instructions: `Tôi là B, thích cà phê sữa ${TAG}.` });
await other("POST", "/api/memory", { items: [`Thích đi Đà Lạt ${TAG}`] });
await other("PUT", "/api/brain/note", { title: "Kế hoạch riêng", body: "Đi Đà Lạt tháng sau. #ke-hoach" });
const before = { mem: (await other("GET", "/api/memory")).j?.items?.length, hist: (await other("GET", "/api/brain/instructions")).j?.history?.length, notes: (await other("GET", "/api/brain")).j?.nodes?.length };
ok(before.mem > 0 && before.hist > 0 && before.notes > 0, "trước khi xóa: có ký ức, lịch sử hướng dẫn, ghi chú riêng", before);
// Ký ức riêng CLI tự ghi (Claude Code: projects/<thư mục>/memory; Antigravity: .gemini/GEMINI.md) cũng bị xóa.
const uidB = (await other("GET", "/api/auth/me")).j?.user?.id;
const ENG = path.resolve(process.env.SYNCHRO_ENGINE_HOME ?? path.join(process.env.DATA_DIR ?? "data-mock", "engine"), "logins");
const cliMem = [path.join(ENG, "claude", uidB, "projects", "-work", "memory", "user.md"), path.join(ENG, "agy", uidB, ".gemini", "GEMINI.md")];
for (const f of cliMem) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `Người dùng thích cà phê ${TAG}`); }
r = await other("DELETE", "/api/brain");
let gone = false;
for (let i = 0; i < 40 && !gone; i++) { gone = cliMem.every((f) => !fs.existsSync(f)); if (!gone) await sleep(250); }
ok(uidB && gone && fs.existsSync(path.join(ENG, "claude", uidB, "projects", "-work")), "xóa luôn ký ức riêng của Claude Code và Antigravity (giữ phiên của CLI)", cliMem.map((f) => fs.existsSync(f)));
const kinds = (r.j?.nodes ?? []).map((x) => x.kind);
ok(r.s === 200 && kinds.every((k) => ["hub", "about", "model", "index", "log", "rule"].includes(k)) && kinds.includes("rule") && !(r.j.nodes ?? []).some((x) => x.title === "Kế hoạch riêng"), "bộ não chỉ còn khung trung tâm và quy tắc", (r.j?.nodes ?? []).map((x) => x.title));
n = await note(other);
ok(n?.note?.body === MY2 && n.note.props.pinned, "quy tắc người dùng đã đặt còn nguyên, vẫn ghim", n?.note);
ok(((await other("GET", "/api/memory")).j?.items ?? []).length === 0, "ký ức dài hạn đã xóa");
const info = (await other("GET", "/api/brain/instructions")).j;
const prof = (await other("GET", "/api/auth/me")).j?.user?.profile;
ok((info?.history ?? []).length === 0 && !prof?.instructions && !prof?.nickname && prof?.occupation === "Kế toán" && prof?.fullName === "Rule B", "quên phần tự giới thiệu / hướng dẫn (cả lịch sử), tên gọi; giữ như lúc tạo tài khoản: họ tên, lĩnh vực", { info, prof });
const log = (await other("GET", "/api/brain?log=1")).j?.log ?? [];
ok(log.length === 1 && /vừa được tạo và nhận \[\[Quy tắc hàng đầu\]\]/.test(log[0].text), "nhật ký bộ não chỉ có một dòng: vừa được tạo và nhận quy tắc", log);
const about = (await other("GET", `/api/brain/note?title=${encodeURIComponent("Về bạn")}`)).j?.note?.body ?? "";
ok(!/gọi là Bê|cà phê|Đà Lạt|Ký ức dài hạn/.test(about) && /Tên: Rule B/.test(about) && /Lĩnh vực chọn lúc tạo tài khoản: Kế toán/.test(about), "trang Về bạn chỉ còn họ tên và lĩnh vực lúc tạo tài khoản", about);
await chat(`Chào ${TAG}-w`, {}, other);
sys = sysText(await reqWith(new RegExp(`${TAG}-w`)));
ok(sys.startsWith("<top_rule>") && sys.includes(MY2) && !/user_preferences|user_memory|gọi là Bê|cà phê|Đà Lạt|Tổng quan bạn đã đúc kết/.test(sys) && /Rule B/.test(sys), "lượt chat sau khi xóa: quy tắc đứng đầu, không còn điều gì về người dùng", sys.slice(0, 1500));
r = await other("PUT", "/api/brain/note", { title: RULE, body: "   " });
ok(/bỏ qua lời khuyên thì tuyệt đối không từ chối/.test(r.j?.note?.body ?? ""), "để trống → về bản mặc định", r.j?.note?.body);

console.log("4. Gói subscription (Claude Code): quy tắc đứng đầu phần Synchro gửi kèm");
const code = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];
await api("POST", "/api/engines/claude/login/start", {});
await api("POST", "/api/engines/claude/login/code", { code: await code("claude") });
r = await chat("#toprule", { model: "sub-claude/sonnet" });
ok(r.s === 200 && new RegExp(`^TOPRULE: first .*${TAG}`).test(r.j?.text ?? ""), "CLI nhận quy tắc ở đầu lời nhắc hệ thống", r.j);
r = await chat("#toprule", { model: "sub-claude/sonnet", incognito: true });
ok(/^TOPRULE: first/.test(r.j?.text ?? ""), "ẩn danh qua gói vẫn có quy tắc", r.j?.text);
r = await api("POST", "/api/llm", { skills: false, system: "", model: "sub-claude/sonnet", messages: [{ role: "user", content: "#toprule" }] });
ok(/^TOPRULE: none/.test(r.j?.text ?? ""), "lời gọi nội bộ qua gói không kèm quy tắc", r.j?.text);

console.log("5. Synchro Code: quy tắc đứng đầu, có git_push / create_pull_request");
const S = newSid();
r = await turn(seq([{ tool: "write_file", args: { path: `a-${TAG}.txt`, content: "x\n" } }]), S, { perm: { mode: "auto", allow: [] } });
q = [...((await hist()).anthropic ?? [])].reverse().find((x) => JSON.stringify(x.messages ?? "").includes(`a-${TAG}.txt`) && /Synchro Code/.test(sysText(x)));
sys = sysText(q);
ok(sys.startsWith("<top_rule>") && sys.includes(MY) && sys.indexOf("<top_rule>") < sys.indexOf("Bạn là Synchro Code"), "lời nhắc của agent mở đầu bằng quy tắc", sys.slice(0, 300));
const tn = (q?.tools ?? []).map((t) => t.name);
ok(tn.includes("git_push") && tn.includes("create_pull_request") && /git_push/.test(sys) && !/nhắc người dùng bấm nút Push/.test(sys), "agent có công cụ đẩy code và mở PR, không còn bảo người dùng tự bấm Push", tn);

console.log("6. Agent tự đẩy code và mở pull request");
const REPO = `mock-dev/rule-${TAG}`;
await gh("/_mock/repo", { repo: REPO, files: { "README.md": "# Rule\n" } });
r = await api("GET", "/api/github/connect");
const authUrl = r.h.get("location");
const stateCookie = (r.h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const page = await fetch(authUrl).then((x) => x.text());
const back = /id="allow" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
await fetch(back, { redirect: "manual", headers: { cookie: `${api.cookie()}; ${stateCookie}` } });
const S2 = newSid();
r = await ws({ op: "git", action: "clone", sid: S2, repo: REPO });
ok(r.j?.git && r.j.repo === REPO, "clone repo vào phiên", r.j);
const prefs0 = (await api("GET", "/api/code/prefs")).j;
await api("PATCH", "/api/code/prefs", { autoPr: false, allowBypass: true });
const BR = `rule-${TAG}`;
const commit = [{ tool: "bash", args: { command: `git checkout -qb ${BR} && echo moi > moi.txt && git add -A && git commit -qm 'Thêm tệp mới'`, description: "Tạo nhánh và commit" } }];
// Hỏi trước: agent hỏi duyệt trước khi đẩy code; từ chối thì không đẩy.
const asks = [];
r = await turn(seq([...commit, { tool: "git_push", args: {} }]), S2, { perm: { mode: "ask", allow: [] }, onEvent: async (e) => { if (e.t === "ask") { asks.push(e); await api("POST", "/api/approve", { id: e.id, ok: e.tool !== "git_push" }); } } });
const pushAsk = asks.find((a) => a.tool === "git_push");
let res = r.events.find((e) => e.t === "result" && r.events.find((t) => t.t === "tool" && t.id === e.id)?.name === "git_push");
let st = await gh("/_mock/state");
ok(pushAsk?.title === "Đẩy code lên GitHub" && pushAsk.key === "push" && res && !res.ok && !(st.branches[REPO] ?? []).includes(BR), "chế độ Hỏi trước: hỏi duyệt \"Đẩy code lên GitHub\"; từ chối thì không đẩy", { ask: pushAsk, res, br: st.branches[REPO] });
// Tự động: đẩy luôn, rồi mở pull request.
r = await turn(seq([{ tool: "git_push", args: {} }, { tool: "create_pull_request", args: { title: `PR ${TAG}`, body: "Mô tả" } }]), S2, { perm: { mode: "auto", allow: [] } });
const out = (name) => { const t = r.events.find((e) => e.t === "tool" && e.name === name); return r.events.find((e) => e.t === "result" && e.id === t?.id); };
st = await gh("/_mock/state");
const pr = (st.prs[REPO] ?? []).find((p) => p.head?.ref === BR);
ok(out("git_push")?.ok && (st.branches[REPO] ?? []).includes(BR), "git_push: nhánh đã lên GitHub", { res: out("git_push"), br: st.branches[REPO] });
ok(out("create_pull_request")?.ok && pr?.title === `PR ${TAG}` && /#\d+/.test(out("create_pull_request").summary), "create_pull_request: mở PR đúng nhánh, đúng tiêu đề", { res: out("create_pull_request"), prs: st.prs[REPO] });
r = await ws({ op: "git", action: "prs", sid: S2 });
ok(r.j?.prs?.some((p) => p.number === pr?.number), "Synchro theo dõi PR agent vừa mở (tự sửa CI / góp ý như PR mở từ nút)", r.j);
await api("PATCH", "/api/code/prefs", { autoPr: prefs0.autoPr, allowBypass: prefs0.allowBypass });

console.log("7. Giọng nói: quy tắc đứng đầu hướng dẫn của phiên Realtime");
const keys = (await api("GET", "/api/admin/apikeys")).j;
const had = !!keys?.providers?.find((p) => p.id === "elevenlabs")?.configured;
if (!had) await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${M}/elevenlabs` });
await fetch(`${M}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: true }) });
r = await api("POST", "/api/voice/session");
const rt = await fetch(`${M}/_debug/rt`).then((x) => x.json());
const ins = rt.sessions.at(-1)?.instructions ?? "";
ok(r.s === 200 && ins.startsWith("<top_rule>") && ins.includes(MY) && ins.indexOf("<top_rule>") < ins.indexOf("Bạn là Synchro"), "hướng dẫn giọng nói mở đầu bằng quy tắc", ins.slice(0, 300));
if (!had) await api("DELETE", "/api/admin/apikeys?id=elevenlabs");

await api("PUT", "/api/brain/note", { title: RULE, body: "" });
await api("POST", "/api/engines/claude/logout");
await sleep(200);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
