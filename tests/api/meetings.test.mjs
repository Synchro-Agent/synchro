// Cuộc họp: ghi chép hoặc tệp ghi âm → chép lời → biên bản, việc cần làm (người phụ trách, hạn chót) → nhắc việc vào Hộp thư.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const fd = body instanceof FormData;
    const r = await fetch(B + p, { method, headers: { ...(fd ? {} : { "content-type": "application/json" }), origin: B, cookie }, body: body === undefined ? undefined : fd ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const a = client(), b = client();
for (const [c, email] of [[a, "meet-a@synchro.test"], [b, "meet-b@synchro.test"]]) {
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: email.split("@")[0], birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
}
for (const m of (await a("GET", "/api/meetings")).j?.meetings ?? []) await a("DELETE", `/api/meetings/${m.id}`);
const MODEL = "anthropic/claude-haiku-5-5";
const NOTES = `Người nói 1: Chào mọi người, hôm nay mình chốt kế hoạch ra mắt ứng dụng Synchro bản di động.
Người nói 2: Bên thiết kế đã xong 80% màn hình, còn màn hình thanh toán. Lan sẽ hoàn thiện màn hình thanh toán trước thứ Sáu tuần này.
Người nói 3: Minh sẽ chạy kiểm thử tải và gửi báo cáo trước ngày 5 tháng sau.
Người nói 1: Vậy mình thống nhất ngày ra mắt là 15 tháng 12. Hùng phụ trách chuẩn bị thông cáo báo chí.
Người nói 2: Còn ngân sách quảng cáo thì chưa chốt, để tuần sau họp tiếp.`;
const wait = async (c, id) => { for (let i = 0; i < 60; i++) { const m = (await c("GET", `/api/meetings/${id}`)).j?.meeting; if (m && (m.status === "done" || m.status === "error")) return m; await sleep(1000); } return null; };

console.log("1. Từ ghi chép dán vào");
let r = await a("POST", "/api/meetings", { title: "Họp kế hoạch ra mắt", date: "2026-10-26", tz: "Asia/Ho_Chi_Minh", transcript: NOTES, model: MODEL });
ok(r.s === 200 && r.j.id && /^run_/.test(r.j.run), "tạo cuộc họp, xử lý bằng lượt chạy bền", JSON.stringify(r.j));
const id = r.j.id;
let m = await wait(a, id);
ok(m?.status === "done" && m.minutes?.tomTat, "lập xong biên bản", JSON.stringify(m).slice(0, 300));
ok(m.minutes.quyetDinh.some((x) => /15 tháng 12/.test(x)) && m.minutes.cauHoiMo.some((x) => /ngân sách/.test(x)), "có quyết định và câu hỏi còn mở", JSON.stringify(m.minutes));
const lan = m.items.find((x) => x.assignee === "Lan"), minh = m.items.find((x) => x.assignee === "Minh"), hung = m.items.find((x) => x.assignee === "Hùng");
ok(m.items.length === 3 && lan && minh && hung, "tách 3 việc với người phụ trách Lan, Minh, Hùng", JSON.stringify(m.items));
ok(lan?.due === "2026-10-30" && minh?.due === "2026-11-05", `hạn chót đổi ra ngày cụ thể: thứ Sáu tuần này = ${lan?.due}, ngày 5 tháng sau = ${minh?.due}`);

console.log("2. Từ tệp ghi âm (chép lời)");
const list0 = (await a("GET", "/api/meetings")).j;
ok(list0.stt === true, "máy chủ có dịch vụ chép lời (giả lập)");
const fd = new FormData();
fd.append("audio", new Blob([new Uint8Array(4096).fill(7)], { type: "audio/mpeg" }), "hop-thu-hai.mp3");
fd.append("title", "Họp thứ Hai"); fd.append("date", "2026-10-26"); fd.append("tz", "Asia/Ho_Chi_Minh"); fd.append("model", MODEL);
r = await a("POST", "/api/meetings", fd);
ok(r.s === 200 && r.j.id, "tải tệp ghi âm lên", JSON.stringify(r.j));
m = await wait(a, r.j.id);
ok(m?.status === "done" && /OpenAI Whisper|ElevenLabs/.test(m.engine ?? "") && /thống nhất ngày ra mắt/.test(m.transcript ?? ""), `chép lời (${m?.engine}) rồi lập biên bản`, JSON.stringify(m).slice(0, 300));
r = await a("POST", "/api/meetings", { title: "Rỗng", transcript: "ngắn" });
ok(r.s === 400, "nội dung quá ngắn → báo lỗi");

console.log("3. Việc cần làm và nhắc việc");
r = await a("PATCH", `/api/meetings/items/${hung.id}`, { done: true });
ok(r.s === 200 && r.j.item.done === 1, "đánh dấu xong");
r = await a("PATCH", `/api/meetings/items/${lan.id}`, { assignee: "Lan Anh", due: "2026-01-01" });
ok(r.j.item.assignee === "Lan Anh" && r.j.item.due === "2026-01-01", "đổi người phụ trách và hạn chót");
let note = null;
for (let i = 0; i < 20 && !note; i++) { await sleep(1000); note = (await a("GET", "/api/inbox")).j.items.find((x) => x.kind === "notice" && /Lan Anh/.test(x.text)); }
ok(note && /Nhắc việc/.test(note.title) && note.link === `meeting:${id}` && /quá hạn/.test(note.text), "việc quá hạn: nhắc vào Hộp thư, kèm đường dẫn mở cuộc họp", JSON.stringify(note));
await sleep(4000);
ok((await a("GET", "/api/inbox")).j.items.filter((x) => x.kind === "notice" && /Lan Anh/.test(x.text)).length === 1, "chỉ nhắc một lần");
ok(!(await a("GET", "/api/inbox")).j.items.some((x) => x.kind === "notice" && x.title.includes("thông cáo")), "việc đã xong thì không nhắc");

console.log("4. Quyền và xóa");
ok((await b("GET", `/api/meetings/${id}`)).s === 404 && (await b("PATCH", `/api/meetings/items/${minh.id}`, { done: true })).s === 404, "người khác không xem, không sửa được");
ok((await b("GET", "/api/meetings")).j.meetings.every((x) => x.id !== id), "danh sách của ai người nấy xem");
ok((await a("DELETE", `/api/meetings/${id}`)).s === 200 && (await a("GET", `/api/meetings/${id}`)).s === 404, "xóa cuộc họp");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
