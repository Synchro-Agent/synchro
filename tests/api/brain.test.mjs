// Bộ não tổng hợp (npm run dev:mock): ghi chú nối bằng [[liên kết]] như Obsidian — trung tâm, ba bán cầu, nhánh đoạn chat được chưng cất,
// chủ đề, liên kết đến (backlink), nhắc tên chưa nối, ghi chú chưa có (nút mờ trên đồ thị); model nào cũng nhận trung tâm và ghi chú liên quan.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (cookie = "") => {
  const f = async (m, p, b, raw = false) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  // Tải tệp lên (multipart) kèm phiên đăng nhập.
  f.form = async (p, fd) => { const r = await fetch(B + p, { method: "POST", headers: { origin: B, cookie }, body: fd }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  return f;
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

console.log("6. Cơ chế Obsidian: bí danh, nối chỗ nhắc tên, đổi tên, gộp, thẻ, tìm có toán tử, nhật ký, Bases, nhập thư mục");
r = await me("PUT", "/api/brain/note", { title: "Cyber security", aliases: ["An ninh mạng", "ATTT"] });
ok(r.s === 200 && r.j.note.props.aliases.includes("An ninh mạng"), "thêm bí danh cho ghi chú", JSON.stringify(r.j?.note?.props));
r = await me("PUT", "/api/brain/note", { title: "Lộ trình học", body: "Tuần này học [[An ninh mạng]] cơ bản, sau đó luyện IELTS. #ke-hoach/tuan" });
g = await graph();
ok(linked(g, "Lộ trình học", "Cyber security") && !g.nodes.some((n) => n.kind === "ghost" && n.title === "An ninh mạng"), "[[bí danh]] trỏ đúng ghi chú gốc (không thành ghi chú chưa có)");
const cs = await note("ATTT");
ok(cs?.note?.title === "Cyber security" && cs.backlinks.some((b) => b.title === "Lộ trình học"), "mở ghi chú bằng bí danh; liên kết qua bí danh tính là liên kết đến", JSON.stringify(cs?.backlinks));
const lt = await note("Lộ trình học");
ok(lt.outUnlinked?.some((o) => o.title === "IELTS"), "liên kết đi chưa nối: ghi chú nhắc “IELTS” mà chưa nối", JSON.stringify(lt.outUnlinked));
r = await me("POST", "/api/brain/link", { source: "Lộ trình học", target: "IELTS", view: "Lộ trình học" });
ok(r.s === 200 && /\[\[IELTS\]\]/.test(r.j.note.body) && !r.j.outUnlinked.some((o) => o.title === "IELTS"), "nút Nối: biến chỗ nhắc tên thành [[liên kết]]", r.j?.note?.body);
const lpBefore = (await note("Lập trình")).backlinks.length;
r = await me("PUT", "/api/brain/note", { title: "Lập trình", newTitle: "Lập trình Python" });
const lp = await note("Lập trình Python");
g = await graph();
ok(r.s === 200 && lpBefore > 0 && lp.backlinks.length === lpBefore && !g.nodes.some((n) => n.title === "Lập trình"), "đổi tên ghi chú: mọi liên kết tới nó tự đổi theo", JSON.stringify({ before: lpBefore, after: lp?.backlinks?.length }));
await me("PUT", "/api/brain/note", { title: "Luyện viết", body: "Viết mỗi ngày một bài [[Ôn thi THPT]]." });
await me("PUT", "/api/brain/note", { title: "Nhắc nhở", body: "Xem lại [[Luyện viết]] tối nay." });
r = await me("POST", "/api/brain/merge", { from: "Luyện viết", into: "Lộ trình học" });
const nh = await note("Nhắc nhở");
ok(r.s === 200 && /## Gộp từ Luyện viết/.test(r.j.note.body) && r.j.note.props.aliases.includes("Luyện viết") && /\[\[Lộ trình học\]\]/.test(nh.note.body), "gộp ghi chú: nội dung nối vào, tên cũ thành bí danh, liên kết trỏ về ghi chú đích", JSON.stringify({ body: r.j?.note?.body, nh: nh?.note?.body }));
const tg = (await me("GET", "/api/brain?tags=1")).j.tags;
ok(tg.some((x) => x.tag === "ke-hoach") && tg.some((x) => x.tag === "ke-hoach/tuan") && tg.some((x) => x.tag === "chu-de"), "thẻ lồng nhau: #ke-hoach/tuan tính cả cho #ke-hoach", JSON.stringify(tg.slice(0, 8)));
const q1 = (await me("GET", `/api/brain?q=${encodeURIComponent("tag:ke-hoach")}`)).j.results, q2 = (await me("GET", `/api/brain?q=${encodeURIComponent("loai:chu-de ielts")}`)).j.results;
ok(q1.some((x) => x.title === "Lộ trình học") && q2.length && q2.every((x) => x.kind === "topic") && q2[0].title === "IELTS", "tìm có toán tử: tag:, loai:", JSON.stringify({ q1, q2 }));
await run("Mai mình làm tiếp bài tập Toán chương đạo hàm nhé, hôm nay chưa xong", { conv: `br-task-${Date.now()}` });
await me("POST", "/api/brain/distill", {});
const tasks = (await me("GET", "/api/brain?table=tasks")).j.rows;
const open1 = tasks.find((x) => !x.done);
ok(!!open1 && (await me("GET", `/api/brain?q=${encodeURIComponent("task-todo:")}`)).j.results.some((x) => x.title === open1.title), "Bases: bảng việc còn dang dở trên khắp bộ não; tìm task-todo:", JSON.stringify(tasks));
r = await me("POST", "/api/brain/task", { title: open1?.title, task: open1?.task, done: true });
ok(r.s === 200 && r.j.rows.some((x) => x.task === open1?.task && x.done) && /\[x\]/.test((await note(open1?.title)).note.body), "đánh dấu xong một việc: ghi chú hiện [x]", JSON.stringify(r.j));
const chats = (await me("GET", "/api/brain?table=chats")).j.rows;
ok(chats.length >= 3 && chats.every((c) => "models" in c && "topics" in c), "Bases: bảng đoạn chat theo thuộc tính (ngày, model, chủ đề, độ quan trọng)", JSON.stringify(chats[0]));
g = await graph();
const daily = g.nodes.find((n) => n.kind === "daily");
ok(!!daily && /^Nhật ký \d{4}-\d{2}-\d{2}$/.test(daily.title) && linked(g, chatA?.title, daily.title) && linked(g, daily.title, "Bộ não"), "nhật ký hằng ngày: đoạn chat nối tới ngày của nó", JSON.stringify(daily));
const JSZip = (await import("jszip")).default;
const zip = new JSZip();
zip.file("Vault/Ý tưởng du học.md", "---\ntags: [y-tuong, du-hoc]\naliases:\n  - Kế hoạch du học\n---\n# Ý tưởng du học\n\nCần [[IELTS]] 7.0 và hồ sơ [[Học bổng Orange Tulip]].\n");
zip.file("Vault/.obsidian/app.json", "{}");
const fd = new FormData();
fd.append("file", new Blob([await zip.generateAsync({ type: "uint8array" })], { type: "application/zip" }), "vault.zip");
const vr = await me.form("/api/brain/vault", fd);
const yt = await note("Kế hoạch du học");
ok(vr.s === 200 && vr.j.created === 1 && yt?.note?.title === "Ý tưởng du học" && yt.note.tags.includes("du-hoc") && (await note("IELTS")).backlinks.some((b) => b.title === "Ý tưởng du học"), "nhập thư mục Obsidian (.zip): ghi chú, thẻ, bí danh, liên kết đều nối vào bộ não", JSON.stringify({ vr: vr.j, yt: yt?.note?.props }));

console.log("7. Model dùng bộ não như người dùng Obsidian: tìm, đọc theo liên kết, ghi vào");
let rr = await run('Nhớ lại giúp mình #tool=brain_search #args={"query":"ielts"}');
ok(JSON.stringify(rr?.result ?? "").includes("IELTS") && rr?.events?.some((e) => e.kind === "tool" && /Đang nhớ lại/.test(e.text)), "model tìm trong bộ não (brain_search)", JSON.stringify(rr?.result).slice(0, 300));
rr = await run('Đọc ghi chú #tool=brain_read #args={"title":"ATTT"}');
ok(JSON.stringify(rr?.result ?? "").includes("Cyber security"), "model đọc ghi chú theo tên hoặc bí danh (brain_read)", JSON.stringify(rr?.result).slice(0, 300));
rr = await run('Ghi nhớ giúp mình #tool=brain_write #args={"title":"Mục tiêu IELTS","content":"Đạt 7.0 trước tháng 6, liên quan [[IELTS]]."}');
const mt = await note("Mục tiêu IELTS");
ok(mt?.note?.kind === "note" && mt.outgoing.some((o) => o.title === "IELTS"), "model ghi vào bộ não khi được nhờ (brain_write), ghi chú tự nối vào mạng lưới", JSON.stringify(mt?.note));
L = await last();
ok((L?.tools ?? []).some((t0) => t0.name === "brain_search") && JSON.stringify(L?.system ?? "").includes("<synchro_brain>"), "mọi lượt chat (khi bật bộ não) có công cụ brain_* và hướng dẫn dùng bộ não", JSON.stringify((L?.tools ?? []).map((t0) => t0.name)));

console.log("8. Nạp đoạn chat cũ, tắt học, ẩn danh, xuất cho Obsidian");
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
