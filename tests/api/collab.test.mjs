// Cộng tác trên ứng dụng nội bộ: bình luận, @nhắc tên (thông báo vào Hộp thư), quyền, kênh trực tiếp (ai đang xem, dữ liệu chung vừa đổi, bình luận mới).
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
// Nghe kênh trực tiếp (SSE): gom sự kiện vào mảng cho tới khi đóng.
function listen(c, app) {
  const events = [], ac = new AbortController();
  const done = (async () => {
    const r = await fetch(`${B}/api/apps/${app}/live`, { headers: { cookie: c.cookie() }, signal: ac.signal });
    events.status = r.status;
    if (!r.ok) return;
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    try {
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const d = /^data: (.*)$/m.exec(blk); if (d) events.push(JSON.parse(d[1])); }
      }
    } catch {}
  })().catch(() => {});
  return { events, close: () => { ac.abort(); return done; } };
}
const until = async (f, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(100); } return false; };

const a = client(), b = client(), c = client(), anon = client();
const ids = {};
for (const [cl, email] of [[a, "collab-a@synchro.test"], [b, "collab-b@synchro.test"], [c, "collab-c@synchro.test"]]) {
  await cl("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Người " + email.split("@")[0].slice(-1).toUpperCase(), birthDate: "2000-01-01" } });
  await cl("POST", "/api/auth/login", { email, password: "Member-pass-123" });
  ids[email[7]] = (await cl("GET", "/api/auth/me")).j.user.id;
}
for (const x of (await a("GET", "/api/apps")).j?.apps ?? []) if (x.mine) await a("DELETE", `/api/apps/${x.id}`);
const HTML = "<!doctype html><html><body><h1>Bảng việc</h1></body></html>";
const app = (await a("POST", "/api/apps", { conv: "cl1", ident: "bang-viec", title: "Bảng việc nhóm", type: "html", content: HTML, visibility: "org" })).j.id;
const priv = (await a("POST", "/api/apps", { conv: "cl1", ident: "rieng", title: "Ứng dụng riêng", type: "html", content: HTML, visibility: "private" })).j.id;
const tag = Date.now().toString(36);

console.log("1. Bình luận và @nhắc tên");
let r = await b("GET", `/api/apps/${app}/people?q=${encodeURIComponent("người c")}`);
ok(r.s === 200 && !r.j.people.some((p) => p.id === ids.c), "người chưa từng mở ứng dụng không được gợi ý: không dò được danh sách thành viên", JSON.stringify(r.j));
for (const q of ["a", "e", "n", "@", "collab", "synchro.test"]) ok(!(await b("GET", `/api/apps/${app}/people?q=${encodeURIComponent(q)}`)).j.people.some((p) => p.id === ids.c), `dò theo “${q}” không ra người lạ`);
r = await b("POST", `/api/apps/${app}/comments`, { body: `nhắc người lạ ${tag}-la`, mentions: [ids.c] });
ok(r.s === 200 && !r.j.comment.mentions.length, "nhắc người chưa tham gia: bị bỏ, không gửi được thông báo cho người lạ", JSON.stringify(r.j));
await c("GET", `/api/apps/${app}?open=1`);
r = await b("GET", `/api/apps/${app}/people?q=${encodeURIComponent("người c")}`);
const pc = r.j?.people?.find((p) => p.id === ids.c);
ok(r.s === 200 && pc && pc.name, "đã mở ứng dụng: gõ @ tìm được theo tên (có dấu)", JSON.stringify(r.j));
ok(r.j.people.every((p) => !("email" in p)), "gợi ý không kèm email", JSON.stringify(r.j));
ok(!(await b("GET", `/api/apps/${app}/people?q=collab-b`)).j.people.some((p) => p.id === ids.b), "không tự gợi ý chính mình");
r = await b("POST", `/api/apps/${app}/comments`, { body: `@${pc.name} xem giúp cột hạn chót ${tag}`, mentions: [ids.c] });
ok(r.s === 200 && r.j.comment.mentions.some((m) => m.id === ids.c) && r.j.comment.user.id === ids.b, "thêm bình luận có nhắc tên", JSON.stringify(r.j));
const cm = r.j.comment.id;
const inbox = async (cl) => ((await cl("GET", "/api/inbox")).j?.items ?? []).filter((x) => x.text?.includes(tag));
let ic = await inbox(c);
ok(ic.some((x) => /nhắc bạn trong Bảng việc nhóm/.test(x.title) && x.link === `app:${app}`), "người được nhắc nhận thông báo trong Hộp thư (mở được ứng dụng)", JSON.stringify(ic));
let ia = await inbox(a);
ok(ia.some((x) => /bình luận trong Bảng việc nhóm/.test(x.title)), "chủ ứng dụng nhận thông báo có bình luận mới", JSON.stringify(ia));
ok((await inbox(b)).length === 0, "người viết không tự nhận thông báo");
r = await c("GET", `/api/apps/${app}/comments`);
ok(r.j.comments.some((x) => x.id === cm && x.body.includes(tag)), "người khác trong tổ chức đọc được bình luận");

console.log("2. Ứng dụng riêng");
ok((await a("GET", `/api/apps/${priv}/people?q=collab`)).j.people.length === 0, "ứng dụng riêng: không gợi ý nhắc người không xem được");
r = await a("POST", `/api/apps/${priv}/comments`, { body: `ghi chú riêng ${tag}-p`, mentions: [ids.b] });
ok(r.s === 200 && r.j.comment.mentions.length === 0, "nhắc người không xem được ứng dụng → bị bỏ khỏi danh sách nhắc", JSON.stringify(r.j));
ok(!(await b("GET", "/api/inbox")).j.items.some((x) => x.text?.includes(`${tag}-p`)), "người đó không nhận thông báo (không lộ ứng dụng riêng)");
ok((await b("GET", `/api/apps/${priv}/comments`)).s === 404, "người ngoài không đọc được bình luận của ứng dụng riêng");
ok((await b("POST", `/api/apps/${priv}/comments`, { body: "x" })).s === 404, "người ngoài không bình luận được vào ứng dụng riêng");

console.log("3. Quyền sửa, xử lý, xóa");
ok((await c("PATCH", `/api/apps/comments/${cm}`, { resolved: true })).s === 403, "người khác không đánh dấu được bình luận không phải của mình");
ok((await c("DELETE", `/api/apps/comments/${cm}`)).s === 403, "người khác không xóa được");
r = await a("PATCH", `/api/apps/comments/${cm}`, { resolved: true });
ok(r.s === 200 && r.j.comment.resolved, "chủ ứng dụng đánh dấu đã xử lý");
ok((await b("POST", `/api/apps/${app}/comments`, { body: "   " })).s === 400, "bình luận trống → 400");
ok((await b("POST", `/api/apps/${app}/comments`, { body: "x".repeat(4001) })).s === 400, "quá 4.000 ký tự → 400");
ok((await anon("GET", `/api/apps/${app}/comments`)).s === 401, "chưa đăng nhập → 401");
ok((await fetch(`${B}/api/apps/${app}/comments`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: b.cookie() }, body: JSON.stringify({ body: "x" }) })).status >= 400, "khác nguồn gốc → bị chặn");

console.log("4. Kênh trực tiếp");
const lc = listen(c, app);
ok(await until(() => lc.events.some((e) => e.type === "presence" && e.people.some((p) => p.id === ids.c))), "mở ứng dụng: thấy mình trong danh sách đang xem", JSON.stringify(lc.events));
const lb = listen(b, app);
ok(await until(() => lc.events.some((e) => e.type === "presence" && e.people.length >= 2 && e.people.some((p) => p.id === ids.b))), "người khác mở cùng lúc → hiện ngay");
await a("POST", "/api/apps/data", { ref: { app }, op: "set", key: "tasks", value: "[]", shared: true, client: "tab-a" });
ok(await until(() => lc.events.some((e) => e.type === "data" && e.key === "tasks" && e.client === "tab-a")), "dữ liệu chung vừa đổi → mọi người đang mở được báo (kèm mã tab đã ghi)");
const n0 = lc.events.length;
await a("POST", "/api/apps/data", { ref: { app }, op: "set", key: "mine", value: "1", shared: false });
await sleep(500);
ok(!lc.events.slice(n0).some((e) => e.type === "data"), "dữ liệu riêng của một người không phát cho người khác");
r = await b("POST", `/api/apps/${app}/comments`, { body: `bình luận trực tiếp ${tag}` });
ok(await until(() => lc.events.some((e) => e.type === "comment" && e.comment.id === r.j.comment.id)), "bình luận mới hiện ngay cho người đang mở");
await b("DELETE", `/api/apps/comments/${r.j.comment.id}`);
ok(await until(() => lc.events.some((e) => e.type === "comment-update" && e.id === r.j.comment.id && e.deleted)), "xóa bình luận → cập nhật ngay");
await lb.close();
ok(await until(() => { const p = lc.events.filter((e) => e.type === "presence").at(-1); return p && !p.people.some((x) => x.id === ids.b); }), "đóng ứng dụng → biến khỏi danh sách đang xem");
await lc.close();
const lp = listen(b, priv); await sleep(600);
ok(lp.events.status === 404, "người ngoài không vào được kênh của ứng dụng riêng", lp.events.status);
await lp.close();
ok((await fetch(`${B}/api/apps/${app}/live`)).status === 401, "kênh trực tiếp cần đăng nhập");

console.log("5. Gỡ ứng dụng");
await a("DELETE", `/api/apps/${app}`); await a("DELETE", `/api/apps/${priv}`);
ok((await c("GET", `/api/apps/${app}/comments`)).s === 404, "gỡ ứng dụng thì bình luận đi theo");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
