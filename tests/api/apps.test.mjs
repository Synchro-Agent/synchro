// Ứng dụng: xuất bản artifact thành ứng dụng có địa chỉ riêng, kho dữ liệu (window.storage), giới hạn, gỡ ứng dụng.
// Web dùng cá nhân: chỉ chủ sở hữu đăng nhập và dùng được; tài khoản khác (còn lại từ bản dùng nhiều người) không đăng nhập được.
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
const a = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), anon = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await a("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
// Dọn ứng dụng của lần chạy trước.
for (const x of (await a("GET", "/api/apps")).j?.apps ?? []) if (/^c(1|2)$/.test(x.conv)) await a("DELETE", `/api/apps/${x.id}`);
const HTML = "<!doctype html><html><body><h1>Sổ ghi chú</h1><script>window.storage</script></body></html>";
const store = (c, ref, op, extra = {}) => c("POST", "/api/apps/data", { ref, op, ...extra });

console.log("1. Xuất bản");
let r = await a("POST", "/api/apps", { conv: "c1", ident: "so-ghi-chu", title: "Sổ ghi chú", type: "html", content: HTML });
ok(r.s === 200 && r.j.created && r.j.id, "xuất bản artifact thành ứng dụng", JSON.stringify(r.j));
const id = r.j.id;
r = await a("POST", "/api/apps", { conv: "c1", ident: "so-ghi-chu", title: "Sổ ghi chú v2", type: "html", content: HTML + "<!-- v2 -->" });
ok(r.j.id === id && !r.j.created, "xuất bản lại cùng artifact: cập nhật, giữ nguyên địa chỉ");
r = await a("POST", "/api/apps", { conv: "c1", ident: "tai-lieu", title: "Tài liệu", type: "markdown", content: "# x" });
ok(r.s === 400, "tài liệu Markdown không xuất bản thành ứng dụng được", JSON.stringify(r.j));
r = await anon("POST", "/api/apps", { conv: "c1", ident: "x", title: "x", type: "html", content: HTML });
ok(r.s === 401 || r.s === 403, "chưa đăng nhập thì không xuất bản được");
r = await a("GET", "/api/apps");
const mine = r.j.apps.find((x) => x.id === id);
ok(mine && !("visibility" in mine) && !("ownerName" in mine) && !("mine" in mine), "danh sách ứng dụng không còn phạm vi chia sẻ hay tên chủ", JSON.stringify(mine));
r = await a("GET", `/api/apps/${id}?open=1`);
ok(r.s === 200 && r.j.app.content.includes("v2") && r.j.app.title === "Sổ ghi chú v2", "mở ứng dụng nhận đúng phiên bản mới nhất");
ok((await anon("GET", `/api/apps/${id}`)).s === 401, "chưa đăng nhập thì không mở được ứng dụng");

console.log("2. Kho dữ liệu");
r = await store(a, { app: id }, "set", { key: "notes", value: JSON.stringify([{ text: "Mua sữa" }]) });
ok(r.s === 200 && r.j.result.key === "notes", "lưu dữ liệu", JSON.stringify(r.j));
r = await store(a, { app: id }, "get", { key: "notes" });
ok(r.j?.result?.value?.includes("Mua sữa"), "đọc lại dữ liệu", JSON.stringify(r.j));
// Ứng dụng tạo từ bản cũ còn truyền shared: vẫn cùng một kho.
r = await store(a, { app: id }, "get", { key: "notes", shared: true });
ok(r.j?.result?.value?.includes("Mua sữa"), "tham số shared của bản cũ không còn tách kho", JSON.stringify(r.j));
r = await store(a, { app: id }, "list", { prefix: "" });
ok(JSON.stringify(r.j.result.keys) === '["notes"]', "liệt kê khóa theo tiền tố", JSON.stringify(r.j));
r = await store(a, { app: id }, "set", { key: "lon", value: "x".repeat(100_001) });
ok(r.s === 400, "giá trị trên 100 KB bị chặn", JSON.stringify(r.j));
r = await store(a, { app: id }, "set", { key: "so", value: 5 });
ok(r.s === 400, "giá trị không phải chuỗi bị chặn (phải JSON.stringify)");
ok((await store(a, { app: id }, "xoa-het")).s === 400, "thao tác lạ bị chặn");
ok((await store(anon, { app: id }, "get", { key: "notes" })).s === 401, "chưa đăng nhập thì không đọc được dữ liệu");

console.log("3. Artifact chưa xuất bản (thử trong chat)");
await store(a, { art: { conv: "c9", ident: "nhap" } }, "set", { key: "k", value: "bản thử" });
r = await store(a, { art: { conv: "c9", ident: "nhap" } }, "get", { key: "k" });
ok(r.j.result?.value === "bản thử", "đọc lại được dữ liệu thử của artifact");

console.log("4. Đổi tên và gỡ");
await a("PATCH", `/api/apps/${id}`, { title: "Sổ tay" });
ok((await a("GET", `/api/apps/${id}`)).j.app.title === "Sổ tay", "đổi tên ứng dụng");
r = await a("DELETE", `/api/apps/${id}`);
ok(r.s === 200 && (await a("GET", `/api/apps/${id}`)).s === 404, "gỡ ứng dụng");
r = await a("POST", "/api/apps", { conv: "c1", ident: "so-ghi-chu", title: "Sổ ghi chú", type: "html", content: HTML });
r = await store(a, { app: r.j.id }, "get", { key: "notes" });
ok(r.j.result === null, "xuất bản lại sau khi gỡ: dữ liệu cũ đã được xóa");

console.log("5. Chỉ chủ sở hữu đăng nhập được");
const other = client();
r = await other("POST", "/api/auth/check", { email: "apps-b@synchro.test" });
ok(r.s === 200 && r.j.owner === false, "email khác không phải chủ sở hữu", JSON.stringify(r.j));
r = await other("POST", "/api/auth/login", { email: "apps-b@synchro.test", password: "Member-pass-123" });
ok(r.s === 401 || r.s === 403, "tài khoản khác không đăng nhập được", JSON.stringify(r.j));
r = await other("POST", "/api/auth/signup", { email: "moi@synchro.test", password: "Member-pass-123", profile: { fullName: "x", birthDate: "2000-01-01" } });
ok(r.s === 404 || r.s === 405, "không còn đăng ký tài khoản mới", r.s);

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
