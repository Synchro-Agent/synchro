// Bộ não công ty: tài liệu riêng / cả tổ chức, tìm kiếm bỏ dấu, trả lời kèm nguồn trong chat, trí nhớ nhóm, quyền, xóa.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), a = client(), b = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
for (const [c, email] of [[a, "kb-a@synchro.test"], [b, "kb-b@synchro.test"]]) {
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: email.split("@")[0], birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
}
// Dọn dữ liệu của lần chạy trước.
for (const c of [admin, a, b]) { const j = (await c("GET", "/api/kb")).j; for (const d of j?.docs ?? []) if (d.canEdit) await c("DELETE", `/api/kb/${d.id}`); for (const m of j?.memory ?? []) if (m.canEdit) await c("DELETE", `/api/kb/${m.id}`); }
const POLICY = `Quy định nghỉ phép năm 2026\n\nMỗi nhân viên chính thức được nghỉ phép năm 14 ngày có hưởng lương. Nhân viên làm việc đủ 5 năm được cộng thêm 1 ngày.\n\nĐơn xin nghỉ phép gửi trưởng bộ phận duyệt trước ít nhất 3 ngày làm việc qua hệ thống nhân sự.`;
const SALES = `Báo cáo doanh thu quý III\n\nDoanh thu quý III đạt 12,5 tỷ đồng, tăng 18% so với cùng kỳ. Kênh trực tuyến chiếm 41%.`;

console.log("1. Thêm tài liệu và quyền");
let r = await a("POST", "/api/kb", { kind: "doc", title: "Doanh thu quý III", text: SALES, scope: "private" });
ok(r.s === 200 && r.j.doc.chunks >= 1, "thành viên thêm tài liệu riêng", JSON.stringify(r.j));
const salesId = r.j.doc.id;
r = await a("POST", "/api/kb", { kind: "doc", title: "Quy định nghỉ phép", text: POLICY, scope: "org" });
ok(r.s === 403, "thành viên không thêm được tài liệu cho cả tổ chức");
r = await admin("POST", "/api/kb", { kind: "doc", title: "Quy định nghỉ phép", text: POLICY, scope: "org" });
ok(r.s === 200 && r.j.doc.scope === "org", "quản trị viên thêm tài liệu cho cả tổ chức");
const policyId = r.j.doc.id;
ok((await a("POST", "/api/kb", { kind: "doc", title: "x", text: "ngắn" })).s === 400, "nội dung quá ngắn (ảnh scan, tệp rỗng) → báo lỗi");
r = await b("GET", "/api/kb");
ok(r.j.docs.some((d) => d.id === policyId && !d.canEdit) && !r.j.docs.some((d) => d.id === salesId), "người khác thấy tài liệu chung (không sửa được), không thấy tài liệu riêng của A");

console.log("2. Tìm kiếm (bỏ dấu, kể cả chữ đ)");
r = await b("GET", `/api/kb/search?q=${encodeURIComponent("nghi phep nam duoc bao nhieu ngay")}`);
ok(r.j.hits[0]?.doc === policyId, "gõ không dấu vẫn tìm ra \"nghỉ phép\"", JSON.stringify(r.j).slice(0, 200));
r = await b("GET", `/api/kb/search?q=${encodeURIComponent("đơn xin nghỉ gửi ai duyệt")}`);
ok(r.j.hits.some((h) => h.doc === policyId && /trưởng bộ phận/.test(h.text)), "câu hỏi có dấu, có chữ đ");
r = await b("GET", `/api/kb/search?q=${encodeURIComponent("doanh thu quý III")}`);
ok(!r.j.hits.some((h) => h.doc === salesId), "không tìm ra tài liệu riêng của người khác");
r = await b("GET", `/api/kb/search?q=${encodeURIComponent("thời tiết hôm nay")}`);
ok(r.j.hits.length === 0, "câu không liên quan → không có đoạn nào");

console.log("3. Trả lời trong chat kèm nguồn");
const chat = (c, q) => c("POST", "/api/llm", { system: "", model: "anthropic/claude-haiku-5-5", skills: true, messages: [{ role: "user", content: q }] });
r = await chat(b, "Nhân viên được nghỉ phép năm bao nhiêu ngày?");
ok(r.s === 200 && /14 ngày/.test(r.j.text) && /\[1\]/.test(r.j.text), "câu trả lời dùng tài liệu và ghi [1]", (r.j?.text ?? JSON.stringify(r.j)).slice(0, 300));
ok(r.j.sources?.[0]?.doc === policyId && r.j.sources[0].title === "Quy định nghỉ phép", "trả về nguồn để hiện dưới câu trả lời", JSON.stringify(r.j.sources));
r = await chat(a, "Doanh thu quý III tăng bao nhiêu phần trăm?");
ok(r.j.sources?.some((s) => s.doc === salesId) && /18%/.test(r.j.text), "người tải tài liệu riêng thì được dùng nguồn đó");
r = await chat(b, "Doanh thu quý III tăng bao nhiêu phần trăm?");
ok(!(r.j.sources ?? []).some((s) => s.doc === salesId), "người khác hỏi cùng câu không thấy tài liệu riêng của A");

console.log("4. Trí nhớ nhóm");
r = await admin("POST", "/api/kb", { kind: "memory", content: "Báo cáo gửi ban giám đốc luôn có kết luận ở đầu.", scope: "org" });
ok(r.s === 200, "quản trị viên thêm trí nhớ cho cả tổ chức");
ok((await a("POST", "/api/kb", { kind: "memory", content: "x", scope: "org" })).s === 403, "thành viên không thêm trí nhớ cho cả tổ chức");
r = await a("POST", "/api/kb", { kind: "memory", content: "Tôi phụ trách khu vực miền Bắc.", scope: "private" });
ok(r.s === 200, "thành viên thêm trí nhớ riêng");
const mb = (await b("GET", "/api/kb")).j.memory.map((m) => m.content);
ok(mb.some((x) => /ban giám đốc/.test(x)) && !mb.some((x) => /miền Bắc/.test(x)), "người khác thấy trí nhớ chung, không thấy trí nhớ riêng của A");

console.log("5. Xóa");
ok((await b("DELETE", `/api/kb/${policyId}`)).s === 403, "thành viên không xóa được tài liệu chung");
ok((await admin("DELETE", `/api/kb/${policyId}`)).s === 200 && (await b("GET", `/api/kb/search?q=nghi%20phep`)).j.hits.length === 0, "xóa tài liệu thì không còn tìm ra");
ok((await fetch(`${B}/api/kb`)).status === 401, "chưa đăng nhập → 401");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
