// Đoạn chat và dự án theo tài khoản: hai thiết bị, mới nhất thắng, xóa lan sang thiết bị khác và kéo theo Bộ não, lượt chạy, liên kết chia sẻ; không lộ sang tài khoản khác.
// Chạy trên npm run dev:mock (web 3200).
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const client = () => {
  let cookie = "";
  return async (m, p, b) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
};
const signup = async (email) => {
  const c = client();
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Sync Tester", birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
  return c;
};
const now = Date.now();
const email = `chatsync-${now}@synchro.test`;
const a = await signup(email), other = await signup(`other-${email}`), anon = client();
const b = client();
await b("POST", "/api/auth/login", { email, password: "Member-pass-123" });
const data = (id, text, title = "T") => JSON.stringify({ id, title, msgs: [{ role: "user", text, time: id, done: true }] });
const push = (c, items) => c("PUT", "/api/chats", { items });
const pull = (c, since = 0) => c("GET", `/api/chats?since=${since}`);

console.log("1. Thiết bị A đẩy lên, thiết bị B nhận được");
ok((await pull(anon)).s === 401, "chưa đăng nhập không đọc được");
ok((await anon("PUT", "/api/chats", { items: [] })).s === 401, "chưa đăng nhập không ghi được");
const id1 = now, id2 = now + 1;
let r = await push(a, [{ kind: "chat", id: String(id1), upd: now - 1000, data: data(id1, "tin một") }, { kind: "project", id: String(id2), upd: now - 1000, data: JSON.stringify({ id: id2, name: "Dự án", desc: "" }) }]);
ok(r.s === 200 && r.j.results.every((x) => x.ok), "đẩy một đợt", JSON.stringify(r));
let p = await pull(b);
ok(p.j.items.length === 2 && p.j.items.some((x) => x.kind === "chat" && JSON.parse(x.data).msgs[0].text === "tin một"), "thiết bị khác đọc được", JSON.stringify(p.j));
const cur = p.j.next;
ok(!p.j.more && cur > 0, "có mốc để lần sau chỉ lấy phần mới");
ok((await pull(b, cur)).j.items.length === 0, "không đổi gì thì không có gì");
ok((await pull(other)).j.items.length === 0, "tài khoản khác không thấy");

console.log("2. Theo từng mục, bản mới nhất thắng");
r = await push(b, [{ kind: "chat", id: String(id1), upd: now - 500, data: data(id1, "bản mới") }]);
ok(r.j.results[0].ok, "bản mới hơn được nhận");
r = await push(a, [{ kind: "chat", id: String(id1), upd: now - 800, data: data(id1, "bản cũ") }]);
ok(!r.j.results[0].ok && r.j.results[0].upd === now - 500, "bản cũ hơn bị từ chối, báo mốc của máy chủ", JSON.stringify(r.j));
p = await a("GET", `/api/chats?keys=chat:${id1}`);
ok(JSON.parse(p.j.items[0].data).msgs[0].text === "bản mới", "lấy được bản thắng theo khóa", JSON.stringify(p.j));
r = await push(a, [{ kind: "chat", id: String(id1 + 5), upd: now + 1e10, data: data(id1 + 5, "đồng hồ nhanh") }]);
ok(r.j.results[0].ok && r.j.results[0].upd <= Date.now(), "đồng hồ thiết bị chạy nhanh bị giới hạn ở giờ máy chủ");

console.log("3. Dữ liệu sai và giới hạn");
r = await push(a, [{ kind: "chat", id: "../x", upd: now, data: "{}" }, { kind: "user", id: "1", upd: now, data: "{}" }, { kind: "chat", id: String(now + 9), upd: now, data: "không phải json" }]);
ok(r.j.results.every((x) => !x.ok && x.error === "bad"), "mã, loại hay nội dung sai đều bị từ chối", JSON.stringify(r.j));
r = await push(a, [{ kind: "chat", id: String(now + 8), upd: now, data: JSON.stringify({ id: now + 8, x: "a".repeat(12_000_001) }) }]);
ok(r.j?.results?.[0]?.error === "too_big", "mục quá lớn bị từ chối rõ ràng, mục khác không ảnh hưởng", JSON.stringify(r.j).slice(0, 200));
const noOrigin = await fetch(`${B}/api/chats`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
ok(noOrigin.status === 401 || noOrigin.status === 403, "yêu cầu chéo trang bị chặn");

console.log("4. Xóa lan sang thiết bị khác và kéo theo phần sinh ra từ đoạn chat");
await a("POST", "/api/memory", { cfg: { gen: true, sens: false } });
const sh = await a("POST", "/api/share", { conv: String(id1), title: "Chia sẻ", msgs: [{ role: "user", text: "Công khai" }] });
await a("POST", "/api/brain/import", { chats: [{ id: String(id1), title: "Ghi chú nhạy cảm NOTE99", msgs: [{ role: "user", text: "Nội dung đoạn chat đủ dài để vào bộ não" }, { role: "ai", text: "ok" }] }] });
const hasNote = async () => (await a("GET", "/api/brain")).j?.nodes?.some((n) => n.title.includes("NOTE99"));
ok(await hasNote(), "trước khi xóa: Bộ não có ghi chú của đoạn chat");
const before = (await pull(b)).j.next;
r = await push(a, [{ kind: "chat", id: String(id1), upd: Date.now(), deleted: true }]);
ok(r.j.results[0].ok && r.j.results[0].deleted, "xóa được", JSON.stringify(r.j));
p = await pull(b, before);
ok(p.j.items.some((x) => x.id === String(id1) && x.deleted && x.data === null), "thiết bị khác nhận lệnh xóa, nội dung không còn trên máy chủ", JSON.stringify(p.j));
ok(!(await hasNote()), "Bộ não không còn ghi chú của đoạn chat");
await a("POST", "/api/brain/import", { chats: [{ id: String(id1), title: "Ghi chú nhạy cảm NOTE99", msgs: [{ role: "user", text: "Nội dung đoạn chat đủ dài để vào bộ não" }] }] });
ok(!(await hasNote()), "thiết bị khác có nạp lại đoạn chat đã xóa thì Bộ não cũng không nhận");
ok((await fetch(`${B}/share/${sh.j.share.token}`)).status === 404, "liên kết chia sẻ của đoạn chat hết hiệu lực");
r = await push(b, [{ kind: "chat", id: String(id1), upd: now - 100, data: data(id1, "bản cũ sống lại?") }]);
ok(!r.j.results[0].ok && r.j.results[0].deleted, "bản cũ trên thiết bị chưa đồng bộ không làm đoạn chat sống lại", JSON.stringify(r.j));

console.log("5. Xóa tất cả");
const id3 = Date.now() - 50;
await push(a, [{ kind: "chat", id: String(id3), upd: id3, data: data(id3, "còn lại") }]);
const at = Date.now();
ok((await a("PUT", "/api/chats", { wipe: at })).j?.ok, "xóa tất cả");
const left = (await pull(b)).j.items.filter((x) => (x.kind === "chat" || x.kind === "project") && !x.deleted);
ok(left.length === 0, "không còn gì trên máy chủ", JSON.stringify(left));
r = await push(b, [{ kind: "chat", id: String(now + 77), upd: at - 5, data: data(now + 77, "chỉ có ở thiết bị B") }]);
ok(!r.j.results[0].ok && r.j.results[0].deleted, "đoạn cũ chưa từng lên máy chủ cũng không sống lại sau khi xóa tất cả", JSON.stringify(r.j));
await new Promise((ok_) => setTimeout(ok_, 5));
r = await push(b, [{ kind: "chat", id: String(now + 78), upd: Date.now(), data: data(now + 78, "chat mới sau khi xóa") }]);
ok(r.j.results[0].ok, "đoạn chat mới sau đó vẫn lưu bình thường", JSON.stringify(r.j));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
