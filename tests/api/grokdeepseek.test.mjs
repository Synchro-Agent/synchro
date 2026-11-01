// Grok (xAI) và DeepSeek trong Synchro (npm run dev:mock: API giả lập ở 127.0.0.1:4010, Grok CLI giả lập trong data-mock/engine):
// - Khóa API của cả hai hãng: danh sách model (lọc đời cũ / model ảnh), số dư DeepSeek, chat, mức suy nghĩ, công cụ (giữ reasoning_content
//   của DeepSeek, bỏ của Grok), ảnh (DeepSeek V4 Pro chỉ đọc chữ), tìm web, Synchro Code, chi phí theo bảng giá của hãng.
// - Gói Grok (SuperGrok / X Premium+) qua Grok CLI: đăng nhập bằng mã thiết bị, model của gói trong bộ chọn, chat nối tiếp phiên, công cụ của
//   Synchro qua cầu nối MCP, công cụ dựng sẵn bị tắt, tìm web, effort, ảnh / PDF, hết hạn mức → hỏi dùng khóa API, mức dùng, đăng xuất.
// - DeepSeek không có gói đăng nhập: chỉ có khóa API.
import { existsSync, readdirSync, readFileSync } from "node:fs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const hist = async (prov) => ((await (await fetch(`${M}/_debug/hist`)).json())[prov] ?? []);
const lastBody = async (prov, pred = () => true) => [...(await hist(prov))].reverse().find(pred) ?? null;
const run = async (body) => {
  const r0 = await api("POST", "/api/llm", { async: true, skills: true, conv: `gd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...body });
  const id = r0.j?.run;
  if (!id) return { s: r0.s, j: r0.j, text: String(r0.j?.text ?? ""), events: [] };
  let rn = null;
  for (let i = 0; i < 240; i++) { rn = (await api("GET", `/api/runs/${id}?json=1`)).j?.run; if (rn && !["running", "queued", "pending"].includes(rn.status)) break; await sleep(300); }
  return { s: rn?.http ?? 0, j: rn?.result, text: String(rn?.result?.text ?? ""), events: rn?.events ?? [] };
};
// Một lượt Synchro Code: đọc NDJSON tới khi xong.
const turn = async (model, text, sid) => {
  const r = await fetch(`${B}/api/agent`, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ sid, model, messages: [{ role: "user", content: text }] }) });
  if (!r.ok) return { status: r.status, events: [], error: (await r.json().catch(() => ({}))).error };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) events.push(JSON.parse(l)); }
  }
  return { status: r.status, events, done: events.find((e) => e.t === "done"), error: events.find((e) => e.t === "error")?.error };
};
// Ảnh PNG 2×3 thật và một PDF nhỏ (model giả đọc kích thước ảnh từ chính các byte nhận được).
const { deflateSync, crc32 } = await import("node:zlib");
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(3, 4); ihdr[8] = 8; ihdr[9] = 2;
const rows = Buffer.alloc(3 * 7, 200); for (let y = 0; y < 3; y++) rows[y * 7] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
const pdfBuf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"), P = `application/pdf ${pdfBuf.length}B`;
const media = (text) => [{ role: "user", content: [{ type: "text", text }, { type: "image", media_type: "image/png", data: png }, { type: "document", media_type: "application/pdf", data: pdfBuf.toString("base64"), name: "đề bài.pdf", fallbackText: "Câu 1: chọn đáp án đúng" }] }];

// Bắt đầu sạch: hiện mọi model ở màn hình chính (trả lại như cũ khi xong), đăng xuất gói Grok.
const mainBefore = (await api("GET", "/api/admin/apikeys")).j?.main ?? ["*"];
await api("POST", "/api/admin/apikeys", { action: "main", main: ["*"] });
await api("POST", "/api/engines/grok/logout");

console.log("1. Khóa API: danh sách model và số dư");
{
  await api("POST", "/api/admin/apikeys", { action: "refresh", id: "deepseek" });
  const st = (await api("GET", "/api/admin/apikeys")).j;
  const x = st.providers.find((p) => p.id === "xai"), d = st.providers.find((p) => p.id === "deepseek");
  ok(x?.configured && x.kind === "xai" && x.vendor === "xAI" && x.keyUrl === "https://console.x.ai" && x.models.map((m) => m.name).join() === "Grok 4.7,Grok 4.6,Grok 4.5,Grok Build 0.1",
    "xAI: Grok 4.7 → 4.5 và Grok Build; bỏ đời cũ (4.3, 4.20, 3, code-fast…) và model tạo ảnh / video", x?.models);
  ok(d?.configured && d.kind === "deepseek" && d.models.map((m) => m.name).join() === "DeepSeek Flash,DeepSeek V4 Pro" && d.info === "42.10 USD",
    "DeepSeek: Flash, V4 Pro (bỏ deepseek-chat / reasoner đời V3); số dư thật của khóa hiện cạnh tên", d);
  const bad = await api("POST", "/api/admin/apikeys", { id: "xai", key: "xai-sai-khoa-000000000000000" });
  const after = (await api("GET", "/api/admin/apikeys")).j.providers.find((p) => p.id === "xai");
  ok(bad.s >= 400 && /không hợp lệ|401/i.test(bad.j?.error ?? "") && after.status === "ok" && after.models.length === 4, "khóa xAI sai → báo lỗi, giữ nguyên khóa đang dùng", bad.j);
  const md = (await api("GET", "/api/models")).j.providers;
  const ids = md.map((p) => p.id);
  ok(ids.indexOf("xai") > ids.indexOf("google") && ids.indexOf("deepseek") > ids.indexOf("xai") && md.find((p) => p.id === "xai")?.kind === "xai", "bộ chọn model: nhóm Grok rồi DeepSeek sau Claude, ChatGPT, Gemini", ids);
}

console.log("2. Grok qua khóa API");
{
  const a = await api("POST", "/api/llm", { model: "xai/grok-4.7", effort: "high", messages: [{ role: "user", content: "chào Grok" }], skills: true });
  const sent = await lastBody("xai", (b) => b.model === "grok-4.7" && JSON.stringify(b.messages ?? b.input ?? "").includes("chào Grok"));
  ok(a.s === 200 && /Grok 4\.7/.test(a.j?.text ?? "") && sent?.reasoning_effort === "high", "chat bằng Grok 4.7, mức nỗ lực Cao → reasoning_effort high", { s: a.s, j: a.j, eff: sent?.reasoning_effort });
  await api("POST", "/api/llm", { model: "xai/grok-4.7", effort: "extra", messages: [{ role: "user", content: "rất cao" }], skills: true });
  ok((await lastBody("xai", (b) => JSON.stringify(b.messages ?? b.input ?? "").includes("rất cao")))?.reasoning_effort === "xhigh", "mức Rất cao → xhigh");
  const mx = await api("POST", "/api/llm", { model: "xai/grok-4.7", effort: "max", messages: [{ role: "user", content: "tối đa" }], skills: true });
  ok(mx.s === 200 && (await lastBody("xai", (b) => JSON.stringify(b.messages ?? b.input ?? "").includes("tối đa")))?.reasoning_effort === "xhigh", "Grok không có mức Tối đa → hạ về xhigh (không lỗi)");
  const gb = await api("POST", "/api/llm", { model: "xai/grok-build-0.1", effort: "high", messages: [{ role: "user", content: "build thử" }], skills: true });
  ok(gb.s === 200 && (await lastBody("xai", (b) => JSON.stringify(b.messages ?? b.input ?? "").includes("build thử")))?.reasoning_effort === undefined, "Grok Build không nhận reasoning_effort → Synchro không gửi", gb.j);
  // Vòng công cụ: lượt gọi công cụ của Grok có reasoning_content; gửi lại thì bỏ đi (API giả lập từ chối trường này như API thật không nhận).
  const t = await run({ model: "xai/grok-4.7", messages: [{ role: "user", content: 'Ghi việc #tool=update_plan #args={"items":[{"content":"Buoc grok","status":"in_progress"}]}' }] });
  ok(t.s === 200 && /update_plan/.test(t.text) && t.events.some((e) => e.kind === "plan" && /Buoc grok/.test(e.text)), "Grok gọi công cụ của Synchro (danh sách việc) và trả lời tiếp", { s: t.s, text: t.text.slice(0, 200) });
  const w = await api("POST", "/api/llm", { model: "xai/grok-4.7", web: true, messages: [{ role: "user", content: 'Tin mới hôm nay về AI #web #tool=web_search #args={"query":"tin mới AI"}' }], skills: true });
  const ws = await lastBody("xai", (b) => (b.tools ?? []).some((x) => x.type === "web_search"));
  ok(w.s === 200 && /Kết quả tìm web của xAI/.test(w.j?.text ?? "") && /example\.com\/tin-moi/.test(w.j?.text ?? "") && ws?.model === "grok-4.7", "bật Tìm kiếm trên web → web_search của xAI (API Responses), có nguồn", w.j?.text?.slice(0, 300));
  const nw = await api("POST", "/api/llm", { model: "xai/grok-4.7", web: false, messages: [{ role: "user", content: "không tìm web" }], skills: true });
  const nb = await lastBody("xai", (b) => JSON.stringify(b.messages ?? "").includes("không tìm web"));
  ok(nw.s === 200 && !(nb?.tools ?? []).some((x) => x.function?.name === "web_search"), "tắt tìm web → không có công cụ web_search");
  const im = await api("POST", "/api/llm", { model: "xai/grok-4.7", messages: media("#media xem đề bài"), skills: true });
  ok(im.j?.text === "MEDIA: image/png 2x3 (image_url)", "Grok đọc ảnh gửi kèm (PDF kèm chữ trích ra)", im.j);
  const gif = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  const gi = await api("POST", "/api/llm", { model: "xai/grok-4.7", messages: [{ role: "user", content: [{ type: "text", text: "#media ảnh gif" }, { type: "image", media_type: "image/gif", data: gif }] }], skills: true });
  ok(gi.j?.text === "MEDIA: image/png 1x1 (image_url)", "ảnh GIF / WebP đổi sang PNG trước khi gửi Grok (API chỉ nhận JPG / PNG)", gi.j);
}

console.log("3. DeepSeek qua khóa API");
{
  // Lịch sử có lượt trả lời cũ + có công cụ: DeepSeek đòi reasoning_content của mọi lượt trả lời trước.
  const msgs = [{ role: "user", content: "câu một" }, { role: "assistant", content: "Đây là câu trả lời trước." }, { role: "user", content: "câu hai deepseek" }];
  const r = await api("POST", "/api/llm", { model: "deepseek/deepseek-v4-pro", effort: "max", messages: msgs, skills: true });
  const sent = await lastBody("deepseek", (b) => JSON.stringify(b.messages ?? b.input ?? "").includes("câu hai deepseek"));
  ok(r.s === 200 && /DeepSeek v4 pro/i.test(r.j?.text ?? "") && sent?.messages.find((m) => m.role === "assistant")?.reasoning_content === "" && sent.reasoning_effort === "max",
    "lượt cũ trong lịch sử được gửi kèm reasoning_content (rỗng) nên không bị lỗi 400; mức Tối đa → max", { s: r.s, j: r.j, eff: sent?.reasoning_effort });
  const sr = await api("POST", "/api/llm", { model: "deepseek/deepseek-v4-pro", messages: [...msgs.slice(0, 2), { role: "user", content: "câu ba [mock:strictreason]" }], skills: true });
  const h = (await hist("deepseek")).filter((b) => JSON.stringify(b.messages ?? b.input ?? "").includes("câu ba"));
  ok(sr.s === 200 && h.length >= 2 && h.at(-1).thinking?.type === "disabled" && h.at(-1).reasoning_effort === undefined, "API vẫn đòi suy luận gốc của lượt cũ → Synchro tự gửi lại một lần với chế độ suy nghĩ tắt", { s: sr.s, err: sr.j?.error, n: h.length });
  // Vòng công cụ chạy nền (truyền chữ dần): reasoning_content đến từng đoạn phải được nối lại đủ rồi gửi lại ở bước sau.
  const t = await run({ model: "deepseek/deepseek-v4-pro", messages: [{ role: "user", content: 'Ghi việc [mock:strictreason] #tool=update_plan #args={"items":[{"content":"Buoc ds","status":"in_progress"}]}' }] });
  const step2 = await lastBody("deepseek", (b) => (b.messages ?? []).some((m) => m.role === "tool") && JSON.stringify(b.messages ?? b.input ?? "").includes("Buoc ds"));
  const rc = step2?.messages.find((m) => m.role === "assistant" && m.tool_calls)?.reasoning_content ?? "";
  ok(t.s === 200 && t.events.some((e) => e.kind === "plan" && /Buoc ds/.test(e.text)) && /^Suy nghĩ của DeepSeek \(giả lập\) về: /.test(rc) && rc.length > 30, "DeepSeek gọi công cụ: suy luận truyền từng đoạn được nối đủ và gửi lại", { s: t.s, rc, text: t.text.slice(0, 160) });
  const e1 = await api("POST", "/api/llm", { model: "deepseek/deepseek-flash", effort: "medium", messages: [{ role: "user", content: "mức vừa" }], skills: true });
  ok(e1.s === 200 && (await lastBody("deepseek", (b) => JSON.stringify(b.messages ?? b.input ?? "").includes("mức vừa")))?.reasoning_effort === "low", "DeepSeek không có mức Trung bình → hạ về low (không lỗi)");
  const pro = await api("POST", "/api/llm", { model: "deepseek/deepseek-v4-pro", messages: media("#media xem đề bài"), skills: true });
  const pb = await lastBody("deepseek", (b) => b.model === "deepseek-v4-pro" && JSON.stringify(b.messages ?? b.input ?? "").includes("#media"));
  // API giả lập trả lỗi 400 nếu V4 Pro nhận ảnh: lượt chạy được là ảnh đã được thay bằng ghi chú cho model.
  ok(pro.s === 200 && !pro.j?.error && /chỉ đọc chữ/.test(JSON.stringify(pb?.messages ?? "")) && !JSON.stringify(pb?.messages ?? "").includes("image_url"), "DeepSeek V4 Pro (chỉ đọc chữ): ảnh thay bằng ghi chú, không lỗi 400", { s: pro.s, err: pro.j?.error });
  const fl = await api("POST", "/api/llm", { model: "deepseek/deepseek-flash", messages: media("#media xem đề bài"), skills: true });
  ok(fl.j?.text === "MEDIA: image/png 2x3 (image_url)", "DeepSeek Flash đọc được ảnh", fl.j);
  const w = await api("POST", "/api/llm", { model: "deepseek/deepseek-flash", web: true, messages: [{ role: "user", content: 'Tin mới hôm nay về AI #web #tool=web_search #args={"query":"tin mới AI"}' }], skills: true });
  ok(w.s === 200 && /Kết quả tìm web của DeepSeek/.test(w.j?.text ?? ""), "DeepSeek tìm web qua web_search của DeepSeek", w.j?.text?.slice(0, 200));
  const once = await api("POST", "/api/llm", { model: "deepseek/deepseek-flash", messages: [{ role: "user", content: "không công cụ" }] });
  ok(once.s === 200 && /DeepSeek flash/i.test(once.j?.text ?? ""), "lời gọi không công cụ (chatOnce) cũng chạy", once.j);
}

console.log("4. Synchro Code bằng khóa API Grok / DeepSeek");
{
  const sid = String(1790000000000 + Math.floor(Math.random() * 1e6));
  let r = await turn("xai/grok-4.7", 'Tạo tệp #tool=write_file #args={"path":"grok.txt","content":"xin chao grok"}', sid);
  ok(r.status === 200 && r.events.some((e) => e.t === "result" && e.ok && e.diff?.path === "grok.txt") && r.done, "Grok (khóa API) tạo tệp trong workspace", r.error ?? r.events.slice(-3));
  r = await turn("deepseek/deepseek-v4-pro", 'Đọc tệp [mock:strictreason] #tool=read_file #args={"path":"grok.txt"}', sid);
  ok(r.status === 200 && r.events.some((e) => e.t === "result" && e.ok && /xin chao grok/.test(e.output ?? "")) && r.done, "DeepSeek (khóa API) đọc tệp vừa tạo (suy luận gửi lại đủ ở bước sau)", r.error ?? r.events.slice(-3));
}

console.log("5. Gói Grok: đăng nhập bằng mã thiết bị");
const uid = (await api("GET", "/api/auth/me")).j?.user?.id;
{
  const s0 = (await api("GET", "/api/engines/grok/status?fresh=1")).j;
  ok(s0.installed && /mock/.test(s0.version ?? "") && !s0.loggedIn, "Grok CLI đã cài (giả lập), chưa đăng nhập", s0);
  const st = await api("POST", "/api/engines/grok/login/start", {});
  ok(st.s === 200 && st.j.state === "open_url" && !st.j.needsCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(st.j.userCode ?? "") && st.j.url?.startsWith(`${M}/mock-login/grok?user_code=`), "link đăng nhập + mã thiết bị (đọc từ stderr của CLI)", st.j);
  await fetch(`${M}/mock-login/grok/approve?code=${st.j.userCode}`);
  let s = null;
  for (let i = 0; i < 30; i++) { s = (await api("GET", "/api/engines/grok/status?fresh=1")).j; if (s.loggedIn) break; await sleep(500); }
  ok(s?.loggedIn && s.method === "grok" && s.plan === "SuperGrok" && !JSON.stringify(s).includes("owner@example.com"), "cho phép trên trang của xAI → đã đăng nhập gói SuperGrok (không lộ email)", s);
  const md = (await api("GET", "/api/models")).j.providers.find((p) => p.id === "xai");
  ok(md?.source === "plan" && md.plan?.cli === "grok" && md.models.map((m) => `${m.key}=${m.name}`).join() === "sub-grok/grok-4.7=Grok 4.7,sub-grok/grok-4.6=Grok 4.6,sub-grok/grok-build-0.1=Grok Build 0.1", "nhóm Grok hiện model của gói (model mặc định trước)", md);
}

console.log("6. Chat bằng gói Grok");
{
  const conv = `gd-plan-${Date.now()}`;
  const m1 = [{ role: "user", content: "chào" }];
  const r1 = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: m1, conv, skills: true });
  ok(r1.s === 200 && /Grok chạy qua CLI giả lập \(lượt 1/.test(r1.j?.text ?? "") && r1.j.via === "grok", "chat bằng gói Grok", r1.j);
  const r2 = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: [...m1, { role: "assistant", content: r1.j.text }, { role: "user", content: "tiếp" }], conv, skills: true });
  ok(r2.s === 200 && /lượt 2/.test(r2.j?.text ?? ""), "câu tiếp theo nối đúng phiên của Grok CLI (--resume)", r2.j);
  const ar = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", effort: "high", messages: [{ role: "user", content: "#grokargs" }], skills: true });
  ok(/tools=search_tool\|use_tool deny=Bash\|Read\|Edit\|Write\|Grep\|Glob\|WebFetch\|WebSearch web=off model=grok-4\.7 effort=high rules=yes memory=off approve=yes resume=no disallowed=- autoupdate=off/.test(ar.j?.text ?? ""), "công cụ dựng sẵn (shell, đọc / sửa tệp, đọc URL, tìm web) tắt; chỉ còn công cụ MCP; có hướng dẫn hệ thống", ar.j?.text);
  const aw = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", web: true, messages: [{ role: "user", content: "#grokargs" }], skills: true });
  ok(/tools=search_tool\|use_tool\|web_search deny=Bash\|Read\|Edit\|Write\|Grep\|Glob\|WebFetch web=on/.test(aw.j?.text ?? ""), "bật tìm web → Grok được dùng web_search của nó (đọc URL bất kỳ vẫn tắt)", aw.j?.text);
  const ex = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", effort: "extra", messages: [{ role: "user", content: "rất cao" }], skills: true });
  ok(/\[effort xhigh\]/.test(ex.j?.text ?? ""), "mức Rất cao → --effort xhigh", ex.j?.text);
  const ne = await api("POST", "/api/llm", { model: "sub-grok/grok-build-0.1", effort: "high", messages: [{ role: "user", content: "chào [mock:noeffort]" }], skills: true });
  ok(ne.s === 200 && /lượt 1/.test(ne.j?.text ?? "") && !/\[effort/.test(ne.j?.text ?? ""), "model không nhận --effort → tự chạy lại không kèm effort", ne.j);
  const tl = await run({ model: "sub-grok/grok-4.7", messages: [{ role: "user", content: 'Ghi việc #tool=update_plan #args={"items":[{"content":"Buoc goi grok","status":"in_progress"}]}' }] });
  const cfg = `${process.cwd()}/data-mock/engine/logins/grok/${uid}/.grok/config.toml`;
  ok(tl.s === 200 && /\[đã dùng update_plan: Đã cập nhật/.test(tl.text) && tl.events.some((e) => e.kind === "plan" && /Buoc goi grok/.test(e.text)), "gói Grok gọi công cụ của Synchro qua cầu nối MCP (use_tool synchro__…)", { s: tl.s, text: tl.text.slice(0, 200) });
  ok(!existsSync(cfg) || !/mcp_servers\.synchro/.test(readFileSync(cfg, "utf8")), "xong lượt: gỡ cầu nối khỏi cấu hình của Grok");
  await api("POST", "/api/auth/profile", { instructions: "Trả lời thật ngắn bằng tiếng Việt." });
  const pf = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: [{ role: "user", content: "#prefs" }], conv: `${conv}-prefs`, skills: true });
  ok(/PREFS: .*Trả lời thật ngắn bằng tiếng Việt/.test(pf.j?.text ?? ""), "gói Grok nhận Hướng dẫn cho Synchro (qua --rules)", pf.j?.text);
  await api("POST", "/api/auth/profile", { instructions: "" });
  const mi = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: media("#media xem đề bài"), skills: true });
  ok(mi.j?.text === `MEDIA: image/png 2x3 (@file); ${P} (@file)`, "ảnh và PDF gốc tới Grok (đính kèm @tệp trong thư mục làm việc)", mi.j);
  const work = `${process.cwd()}/data-mock/engine/work`;
  ok(!readdirSync(work, { recursive: true }).some((f) => /\.synchro-grok-.*\.txt$/.test(String(f))), "tệp prompt tạm của từng lượt được xóa");
  const sc = String(1790000000000 + Math.floor(Math.random() * 1e6));
  const ct = await turn("sub-grok/grok-4.7", 'Tạo tệp #tool=write_file #args={"path":"plan.txt","content":"grok qua goi"}', sc);
  ok(ct.status === 200 && ct.events.some((e) => e.t === "tool" && e.name === "write_file") && ct.events.some((e) => e.t === "result" && e.ok) && /đã dùng write_file/.test(ct.done?.text ?? ""), "Synchro Code chạy bằng gói Grok (công cụ workspace qua cầu nối)", ct.error ?? ct.events.slice(-3));
}

console.log("7. Hết hạn mức gói Grok, mức dùng");
{
  const q = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: [{ role: "user", content: "chào [mock:quota]" }], skills: true });
  ok(q.s === 429 && q.j?.planLimit === "grok" && q.j.apiModel === "xai/grok-4.7" && q.j.apiModelName === "Grok 4.7", "gói hết hạn mức → hỏi dùng khóa API Grok tương đương (không tự chuyển)", q.j);
  const st = (await api("GET", "/api/engines/grok/status")).j;
  ok(st.blockedUntil > Date.now() && st.apiModel === "xai/grok-4.7", "Providers: gói Grok đang hết hạn mức, có khóa API để dùng thay", st);
  await api("POST", "/api/engines/grok/use-api", { on: true });
  const mg = (await api("GET", "/api/models")).j.providers.find((p) => p.id === "xai");
  ok(mg?.source === "api" && mg.models.some((m) => m.key === "xai/grok-4.7"), "đồng ý dùng khóa API → nhóm Grok hiện model của khóa API", mg);
  await api("POST", "/api/engines/grok/use-api", { on: false });
  const us = (await api("GET", "/api/usage?provider=sub-grok")).j;
  ok(us.sub?.cli === "grok" && us.sub.plan === "SuperGrok" && Array.isArray(us.sub.windows) && /Grok CLI doesn't report/.test(us.sub.note ?? "") && us.sub.turnsToday >= 2, "vòng tròn mức dùng của gói Grok: tên gói, số tin nhắn hôm nay, ghi chú hạn mức", us.sub);
  const all = (await api("GET", "/api/usage?all=1")).j;
  const v = Object.fromEntries((all.vendors ?? []).map((x) => [x.vendor, x]));
  ok(all.vendors?.length === 5 && v.xai?.cli === "grok" && v.deepseek?.cli === null && v.deepseek.mode === "api" && v.deepseek.name === "DeepSeek", "chế độ Tự động: đủ 5 hãng; DeepSeek chạy bằng khóa API", all.vendors?.map((x) => [x.vendor, x.mode, x.cli]));
  const det = (await api("GET", "/api/usage/details?tz=0")).j;
  const today = det.days.at(-1).calls;
  const dsm = det.byModel.find((m) => m.model === "deepseek/deepseek-v4-pro"), xm = det.byModel.find((m) => m.model === "xai/grok-4.7");
  ok((today.xai ?? 0) >= 3 && (today.deepseek ?? 0) >= 2 && det.byPlan.some((m) => m.model === "sub-grok/grok-4.7" && m.turns >= 2), "Cài đặt → Usage: lượt của Grok (gói + khóa API) và DeepSeek theo ngày", { today, plan: det.byPlan.filter((m) => m.cli === "grok") });
  ok(dsm?.cost > 0 && dsm.cacheRead > 0 && xm?.cost > 0 && xm.output > 40, "chi phí theo bảng giá của hãng: DeepSeek đọc phần cache (prompt_cache_hit_tokens), Grok tính cả token suy nghĩ", { dsm, xm });
  const pr = (await api("GET", "/api/admin/usage")).j?.prices ?? (await api("GET", "/api/usage/admin")).j?.prices;
  const rowsP = Array.isArray(pr) ? pr : Object.entries(pr ?? {}).map(([model, p]) => ({ model, ...p }));
  ok(rowsP.some((p) => p.model === "deepseek/deepseek-v4-pro" && p.src === "official" && p.in === 1.32) && rowsP.some((p) => p.model === "xai/grok-4.7" && p.src === "official" && p.out === 6), "bảng giá: Grok 4.7 và DeepSeek V4 Pro theo giá chính thức của hãng", rowsP.filter((p) => /xai|deepseek/.test(p.model)));
}

console.log("8. Chế độ Tự động, bộ não, đăng xuất");
{
  const au = await api("POST", "/api/llm", { model: "auto", messages: [{ role: "user", content: "Viết hàm python tính giai thừa" }], skills: true });
  ok(au.s === 200 && typeof au.j?.text === "string", "chế độ Tự động vẫn chạy khi có thêm Grok và DeepSeek", au.j?.error);
  const g = (await api("GET", "/api/brain")).j;
  ok(["Grok", "DeepSeek"].every((t) => g?.nodes?.some((n) => n.title === t)), "bộ não có bán cầu Grok và DeepSeek", g?.nodes?.map((n) => n.title));
  const lo = await api("POST", "/api/engines/grok/logout");
  ok(lo.s === 200 && !lo.j.loggedIn, "đăng xuất gói Grok", lo.j);
  const md = (await api("GET", "/api/models")).j.providers.find((p) => p.id === "xai");
  ok(md?.source === "api", "sau khi đăng xuất: nhóm Grok quay về model của khóa API", md);
  const no = await api("POST", "/api/llm", { model: "sub-grok/grok-4.7", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(no.s === 409 && /Providers/.test(no.j?.error ?? ""), "chưa đăng nhập gói Grok → 409, nhắc vào Providers", no.j);
}

await api("POST", "/api/admin/apikeys", { action: "main", main: mainBefore });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
