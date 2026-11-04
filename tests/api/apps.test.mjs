// Ứng dụng nội bộ: xuất bản artifact, quyền xem (riêng / cả tổ chức), kho dữ liệu chung và riêng, giới hạn, gỡ ứng dụng.
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
const a = client(), b = client(), anon = client();
for (const [c, email] of [[a, "apps-a@synchro.test"], [b, "apps-b@synchro.test"]]) {
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: email.split("@")[0], birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
}
// Dọn ứng dụng của lần chạy trước.
for (const x of (await a("GET", "/api/apps")).j?.apps ?? []) if (x.mine) await a("DELETE", `/api/apps/${x.id}`);
const HTML = "<!doctype html><html><body><h1>Bảng tin</h1><script>window.storage</script></body></html>";
const store = (c, ref, op, extra = {}) => c("POST", "/api/apps/data", { ref, op, ...extra });

console.log("1. Xuất bản");
let r = await a("POST", "/api/apps", { conv: "c1", ident: "bang-tin", title: "Bảng tin nhóm", type: "html", content: HTML, visibility: "org" });
ok(r.s === 200 && r.j.created && r.j.id, "xuất bản artifact thành ứng dụng cho cả tổ chức", JSON.stringify(r.j));
const id = r.j.id;
r = await a("POST", "/api/apps", { conv: "c1", ident: "bang-tin", title: "Bảng tin nhóm v2", type: "html", content: HTML + "<!-- v2 -->", visibility: "org" });
ok(r.j.id === id && !r.j.created, "xuất bản lại cùng artifact: cập nhật, giữ nguyên địa chỉ");
r = await a("POST", "/api/apps", { conv: "c1", ident: "tai-lieu", title: "Tài liệu", type: "markdown", content: "# x", visibility: "org" });
ok(r.s === 400, "tài liệu Markdown không xuất bản thành ứng dụng được", JSON.stringify(r.j));
r = await anon("POST", "/api/apps", { conv: "c1", ident: "x", title: "x", type: "html", content: HTML });
ok(r.s === 401 || r.s === 403, "chưa đăng nhập thì không xuất bản được");

console.log("2. Quyền xem");
r = await b("GET", "/api/apps");
ok(!r.j.apps.some((x) => x.id === id), "người chưa mở không thấy ứng dụng dùng chung trong danh sách (đăng ký đang mở, người lạ không dò được)", JSON.stringify(r.j).slice(0, 200));
r = await b("GET", `/api/apps/${id}?open=1`);
ok(r.s === 200 && r.j.app.content.includes("v2") && r.j.app.title === "Bảng tin nhóm v2", "có đường dẫn: mở ứng dụng nhận đúng phiên bản mới nhất");
r = await b("GET", "/api/apps");
const seen = r.j.apps.find((x) => x.id === id);
ok(seen && !seen.mine && seen.ownerName && !seen.ownerName.includes("@"), "đã mở: ứng dụng hiện trong danh sách, kèm tên chủ, không lộ email", JSON.stringify(seen));
r = await a("POST", "/api/apps", { conv: "c2", ident: "rieng", title: "Ứng dụng riêng", type: "html", content: HTML, visibility: "private" });
const pid = r.j.id;
ok((await b("GET", `/api/apps/${pid}`)).s === 404 && !(await b("GET", "/api/apps")).j.apps.some((x) => x.id === pid), "ứng dụng riêng: người khác không thấy, không mở được");
ok((await b("DELETE", `/api/apps/${id}`)).s === 404 && (await b("PATCH", `/api/apps/${id}`, { visibility: "private" })).s === 404, "người khác không sửa hay gỡ được ứng dụng");

console.log("3. Kho dữ liệu");
r = await store(a, { app: id }, "set", { key: "notes", value: JSON.stringify([{ text: "Họp 9h" }]), shared: true });
ok(r.s === 200 && r.j.result.shared, "lưu dữ liệu chung", JSON.stringify(r.j));
r = await store(b, { app: id }, "get", { key: "notes", shared: true });
ok(r.j?.result?.value?.includes("Họp 9h"), "tài khoản khác đọc được dữ liệu chung", JSON.stringify(r.j));
await store(b, { app: id }, "set", { key: "notes", value: JSON.stringify([{ text: "Họp 9h" }, { text: "Gửi báo cáo" }]), shared: true });
r = await store(a, { app: id }, "get", { key: "notes", shared: true });
ok(JSON.parse(r.j.result.value).length === 2, "ghi của người này, người kia thấy ngay");
await store(a, { app: id }, "set", { key: "nhap", value: "của A", shared: false });
r = await store(b, { app: id }, "get", { key: "nhap", shared: false });
ok(r.s === 200 && r.j.result === null, "dữ liệu riêng của A, B không thấy");
r = await store(a, { app: id }, "list", { prefix: "", shared: true });
ok(JSON.stringify(r.j.result.keys) === '["notes"]', "liệt kê khóa theo tiền tố", JSON.stringify(r.j));
r = await store(a, { app: id }, "set", { key: "lon", value: "x".repeat(100_001), shared: true });
ok(r.s === 400, "giá trị trên 100 KB bị chặn", JSON.stringify(r.j));
r = await store(a, { app: id }, "set", { key: "so", value: 5, shared: true });
ok(r.s === 400, "giá trị không phải chuỗi bị chặn (phải JSON.stringify)");
ok((await store(b, { app: pid }, "get", { key: "notes", shared: true })).s === 404, "không đọc được dữ liệu của ứng dụng riêng người khác");
ok((await store(a, { app: id }, "xoa-het")).s === 400, "thao tác lạ bị chặn");

console.log("4. Artifact chưa xuất bản (thử trong chat)");
await store(a, { art: { conv: "c9", ident: "nhap" } }, "set", { key: "k", value: "của A", shared: true });
r = await store(b, { art: { conv: "c9", ident: "nhap" } }, "get", { key: "k", shared: true });
ok(r.s === 200 && r.j.result === null, "dữ liệu thử của artifact chỉ thuộc về chủ (người khác cùng mã cũng không đọc được)");
r = await store(a, { art: { conv: "c9", ident: "nhap" } }, "get", { key: "k", shared: true });
ok(r.j.result?.value === "của A", "chủ đọc lại được dữ liệu thử");

console.log("5. Đổi phạm vi và gỡ");
await a("PATCH", `/api/apps/${id}`, { visibility: "private" });
ok((await b("GET", `/api/apps/${id}`)).s === 404 && (await store(b, { app: id }, "get", { key: "notes", shared: true })).s === 404, "chuyển về riêng tư: người khác mất quyền ngay");
r = await a("DELETE", `/api/apps/${id}`);
ok(r.s === 200 && (await a("GET", `/api/apps/${id}`)).s === 404, "gỡ ứng dụng");
r = await a("POST", "/api/apps", { conv: "c1", ident: "bang-tin", title: "Bảng tin nhóm", type: "html", content: HTML, visibility: "org" });
r = await store(a, { app: r.j.id }, "get", { key: "notes", shared: true });
ok(r.j.result === null, "xuất bản lại sau khi gỡ: dữ liệu cũ đã được xóa");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
