// Bộ não tổng hợp (npm run dev:mock): ghi chú nối bằng [[liên kết]] như Obsidian — trung tâm, ba bán cầu, nhánh đoạn chat được chưng cất,
// chủ đề, liên kết đến (backlink), nhắc tên chưa nối, ghi chú chưa có (nút mờ trên đồ thị); model nào cũng nhận trung tâm và ghi chú liên quan.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (cookie = "") => async (m, p, b, raw = false) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (raw) return r;
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const me = client();
await me("POST", "/api/auth/signup", { email: "brain-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Brain Tester", birthDate: "2007-05-01" } });
await me("POST", "/api/auth/login", { email: "brain-member@synchro.test", password: "Member-pass-123" });
await me("DELETE", "/api/brain");
await me("DELETE", "/api/memory");
await me("POST", "/api/memory", { cfg: { gen: true, sens: false } });
const run = async (text, extra = {}) => {
  const r = await me("POST", "/api/llm", { async: true, skills: true, system: "", model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: text }], conv: `br-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...extra });
  for (let i = 0; i < 60 && r.j?.run; i++) { const x = await me("GET", `/api/runs/${r.j.run}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") return x.j.run; await sleep(300); }
  return null;
};
const graph = async () => (await me("GET", "/api/brain")).j;
const note = async (title) => (await me("GET", `/api/brain/note?title=${encodeURIComponent(title)}`)).j;
const titleOf = (g, id) => g.nodes.find((n) => n.id === id)?.title;
const linked = (g, a, b) => g.edges.some((e) => titleOf(g, e.s) === a && titleOf(g, e.t) === b);

console.log("1. Khung bộ não: trung tâm, ba bán cầu, Về bạn");
let g = await graph();
ok(["Bộ não", "Về bạn", "Claude", "ChatGPT", "Gemini"].every((t) => g.nodes.some((n) => n.title === t)), "có [[Bộ não]], [[Về bạn]] và ba bán cầu", JSON.stringify(g.nodes.map((n) => n.title)));
ok(["Claude", "ChatGPT", "Gemini"].every((h) => linked(g, h, "Bộ não")) && linked(g, "Bộ não", "Claude"), "ba bán cầu nối về trung tâm (và trung tâm nối ra)", JSON.stringify(g.edges));

console.log("2. Mỗi đoạn chat thành một nhánh, nối tới bán cầu của model đã trả lời");
const convA = `br-a-${Date.now()}`, convB = `br-b-${Date.now()}`;
await run("Giúp mình lên kế hoạch ôn IELTS và Toán cho kỳ thi THPT nhé", { conv: convA });
await run("Mình muốn học Python để làm cyber security, bắt đầu từ đâu?", { conv: convB, model: "openai/gpt-6-luna" });
g = await graph();
const stubA = g.nodes.find((n) => n.kind === "chat" && /kế hoạch ôn IELTS/i.test(n.title));
ok(!!stubA && linked(g, stubA.title, "Claude"), "ghi chú nhánh có ngay sau lượt chat, nối tới [[Claude]]", JSON.stringify(g.nodes.filter((n) => n.kind === "chat")));
ok(g.nodes.some((n) => n.kind === "chat" && linked(g, n.title, "ChatGPT")), "đoạn chat bằng model OpenAI nối tới [[ChatGPT]]");
ok(g.stats.pending >= 2, "hai đoạn chat đang chờ chưng cất", JSON.stringify(g.stats));

console.log("3. Chưng cất: tóm tắt, chủ đề, tên riêng, liên kết, trung tâm được tổng hợp lại");
const d = await me("POST", "/api/brain/distill", {});
ok(d.s === 200 && d.j.done >= 2 && d.j.stats.pending === 0, "chưng cất ngay các đoạn chat đang chờ", JSON.stringify({ s: d.s, done: d.j?.done, stats: d.j?.stats }));
g = d.j;
const chatA = g.nodes.find((n) => n.kind === "chat" && /kế hoạch ôn/i.test(n.title));
ok(["IELTS", "Ôn thi THPT", "Toán", "Lập trình", "Cyber security"].every((t) => g.nodes.some((n) => n.kind === "topic" && n.title === t)), "chủ đề thành ghi chú riêng", JSON.stringify(g.nodes.filter((n) => n.kind === "topic").map((n) => n.title)));
ok(!!chatA && linked(g, chatA.title, "IELTS") && linked(g, "IELTS", "Bộ não"), "nhánh đoạn chat → [[IELTS]] → [[Bộ não]]", JSON.stringify(g.edges.filter((e) => e.s === chatA?.id).map((e) => titleOf(g, e.t))));
const nA = await note(chatA?.title ?? "");
ok(/\*\*Tóm tắt:\*\*/.test(nA?.note?.body ?? "") && nA.outgoing.some((o) => o.title === "Claude" && o.exists), "ghi chú nhánh: tóm tắt, điểm chính, liên kết đi", nA?.note?.body);
const ielts = await note("IELTS");
ok(ielts?.backlinks?.some((b) => b.title === chatA?.title && /IELTS/.test(b.context)), "[[IELTS]] biết đoạn chat nào trỏ về nó (liên kết đến đây, kèm ngữ cảnh)", JSON.stringify(ielts?.backlinks));
const hub = await note("Bộ não");
ok(/## Tổng quan/.test(hub?.note?.body ?? "") && hub.outgoing.some((o) => o.title === "IELTS") && hub.outgoing.some((o) => o.title === chatA?.title), "trung tâm tổng hợp lại: tổng quan, chủ đề lớn, đoạn chat gần đây", hub?.note?.body);
ok(hub?.note?.editable === false && hub.note.generated, "trung tâm do Synchro tự viết, người dùng chỉ thêm ghi chú của mình");

console.log("4. Model nào cũng dùng chung bộ não");
const last = async (vendor = "anthropic") => [...((await (await fetch(`${M}/_debug/hist`)).json())[vendor] ?? [])].reverse().find((b) => !/<brain_(distill|core)>|trích xuất bộ nhớ/.test(JSON.stringify(b.system ?? b.instructions ?? "")));
await run("Lịch ôn IELTS của mình đến đâu rồi?");
let L = await last();
const sys = JSON.stringify(L?.system ?? ""), msgs = JSON.stringify(L?.messages ?? "");
ok(sys.includes("Tổng quan bạn đã đúc kết về họ"), "lời nhắc hệ thống có phần trung tâm của bộ não", sys.slice(0, 300));
ok(msgs.includes("<brain_recall>") && msgs.includes(chatA?.title ?? "@@"), "câu hỏi kéo theo ghi chú liên quan (tầng động)", msgs.slice(-700));
await run("Lịch ôn IELTS của mình đến đâu rồi?", { model: "openai/gpt-6-luna" });
const O = await last("openai");
ok(JSON.stringify(O ?? "").includes("<brain_recall>"), "model hãng khác (OpenAI) cũng nhận ghi chú từ cùng bộ não", JSON.stringify(O ?? "").slice(-400));
await run("Lịch ôn IELTS của mình đến đâu rồi?", { incognito: true });
L = await last();
ok(!JSON.stringify(L?.messages ?? "").includes("<brain_recall>"), "đoạn chat ẩn danh không đọc bộ não");

console.log("5. Liên kết kiểu Obsidian: sửa ghi chú, ghi chú chưa có, nhắc tên chưa nối");
let r = await me("PUT", "/api/brain/note", { title: "IELTS", body: "Kỳ thi tiếng Anh để [[Du học Hà Lan]]. Mục tiêu 7.0.\n\nThuộc [[Bộ não]]. #muc-tieu" });
ok(r.s === 200 && r.j.outgoing.some((o) => o.title === "Du học Hà Lan" && !o.exists) && r.j.note.tags.includes("muc-tieu"), "sửa ghi chú chủ đề: liên kết tới ghi chú chưa có, thẻ #", JSON.stringify(r.j));
g = await graph();
ok(g.nodes.some((n) => n.kind === "ghost" && n.title === "Du học Hà Lan") && linked(g, "IELTS", "Du học Hà Lan"), "ghi chú chưa có hiện thành nút mờ trên đồ thị");
r = await me("PUT", "/api/brain/note", { title: "Kế hoạch tuần này", body: "Mỗi tối luyện IELTS 1 tiếng, cuối tuần làm đề Toán." });
ok(r.s === 200 && r.j.note.kind === "note" && r.j.note.editable, "tạo ghi chú riêng của mình");
const un = await note("IELTS");
ok(un.unlinked.some((u) => u.title === "Kế hoạch tuần này"), "[[IELTS]] thấy ghi chú nhắc tên nó mà chưa nối", JSON.stringify(un.unlinked));
r = await me("PUT", "/api/brain/note", { title: chatA?.title, userNote: "Nhớ hỏi lại cô giáo về [[Du học Hà Lan]]." });
ok(r.s === 200 && /## Ghi chú của bạn/.test(r.j.note.body) && r.j.outgoing.some((o) => o.title === "Du học Hà Lan"), "ghi chú nhánh: thêm ghi chú của mình (có liên kết), phần còn lại Synchro giữ", r.j?.note?.body);
ok((await me("DELETE", `/api/brain/note?title=${encodeURIComponent("Bộ não")}`)).s === 400 && (await me("DELETE", `/api/brain/note?title=${encodeURIComponent("Kế hoạch tuần này")}`)).s === 200, "không xóa được trung tâm; xóa được ghi chú riêng");
const sr = (await me("GET", `/api/brain?q=${encodeURIComponent("ielts")}`)).j;
ok(sr.results?.some((x) => x.title === "IELTS"), "tìm ghi chú trong bộ não", JSON.stringify(sr));

console.log("6. Nạp đoạn chat cũ, tắt học, ẩn danh, xuất cho Obsidian");
r = await me("POST", "/api/brain/import", { chats: [{ id: "old-1", title: "Lịch tập gym", msgs: [{ role: "user", text: "Lên lịch tập gym 4 buổi một tuần giúp mình" }, { role: "ai", text: "Đây là lịch tập…" }] }, { id: "old-2", msgs: [{ role: "user", text: "hi" }] }] });
ok(r.s === 200 && r.j.queued === 1, "nạp đoạn chat cũ từ trình duyệt (bỏ đoạn quá ngắn)", JSON.stringify(r.j));
await me("POST", "/api/brain/distill", {});
g = await graph();
ok(g.nodes.some((n) => n.kind === "topic" && n.title === "Gym") && g.nodes.some((n) => n.kind === "chat" && /gym/i.test(n.title)), "đoạn chat cũ cũng thành nhánh có chủ đề", JSON.stringify(g.nodes.filter((n) => n.kind !== "ghost").map((n) => n.title)));
const before = g.nodes.filter((n) => n.kind === "chat").length;
await run("Đoạn chat bí mật về kế hoạch riêng", { incognito: true });
await me("POST", "/api/memory", { cfg: { gen: false } });
await run("Khi tắt học thì không ghi nhận đoạn chat này");
await me("POST", "/api/memory", { cfg: { gen: true } });
ok((await graph()).nodes.filter((n) => n.kind === "chat").length === before, "không học từ đoạn chat ẩn danh hay khi tắt học");
const zr = await me("GET", "/api/brain/export", undefined, true);
const zb = new Uint8Array(await zr.arrayBuffer());
ok(zr.status === 200 && zr.headers.get("content-type") === "application/zip" && zb[0] === 0x50 && zb[1] === 0x4b && new TextDecoder().decode(zb).includes("Chủ đề/IELTS.md"), "tải bộ não về thành thư mục Obsidian (.zip các tệp .md)", `${zr.status} ${zr.headers.get("content-type")}`);
r = await me("DELETE", "/api/brain");
ok(r.s === 200 && r.j.nodes.every((n) => ["hub", "about", "model"].includes(n.kind)), "xóa bộ não: chỉ còn khung trung tâm", JSON.stringify(r.j.nodes.map((n) => n.title)));

await me("DELETE", "/api/brain");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
