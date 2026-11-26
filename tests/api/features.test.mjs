// Autopilot theo trang, đếm nhẹ, giữ kết quả lâu dài; xóa đoạn chat gỡ cả điều đã học; thư viện bị chặn vì giấy phép;
// trạng thái Speech. Chạy trên npm run dev:mock (web 3200).
import { createRequire } from "node:module";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = () => {
  let cookie = "";
  return async (m, p, b, raw = false) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
};
const email = `features-${Date.now()}@synchro.test`;
const a = client();
await a("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Features Tester", birthDate: "2000-01-01" } });
await a("POST", "/api/auth/login", { email, password: "Member-pass-123" });
const uid = (await a("GET", "/api/auth/me")).j.user.id;
const R = createRequire(process.cwd() + "/package.json");
const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db");
db.pragma("busy_timeout = 5000");

console.log("1. Autopilot: đếm nhẹ, theo trang, giữ kết quả quá 7 ngày");
await a("GET", "/api/autopilot"); // tạo bảng
const now = Date.now(), DAY = 86_400_000;
const ins = db.prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at, read, kind, result) VALUES (?, 't', ?, ?, ?, ?, 'run', ?)");
for (let i = 0; i < 120; i++) ins.run(`rn_${uid}_${i}`, uid, `Kết quả ${i}`, now - i * DAY, i < 3 ? 0 : 1, JSON.stringify({ status: "done", text: `Nội dung ${i}`.padEnd(2000, "x") }));
ins.run(`rn_${uid}_gone`, uid, "Cũ không còn", now - 400 * DAY, 1, null);
db.prepare("INSERT INTO notices (id, owner, title, text, at, read) VALUES (?, ?, 'Thông báo', 'x', ?, 0)").run(`nt_${uid}`, uid, now - 1000);
let r = await a("GET", "/api/autopilot?count=1", undefined, true);
const raw = await r.text(), c = JSON.parse(raw);
ok(c.unread === 4 && !raw.includes("Nội dung"), "đếm đúng chưa đọc (kể cả thông báo), không có nội dung kết quả", raw.slice(0, 300));
ok(raw.length < 3000 && c.fresh.length === 4, `phản hồi đếm rất nhẹ (${raw.length} byte)`, raw.length);
let p = await a("GET", "/api/autopilot?limit=50");
ok(p.j.items.length === 50 && p.j.more === true && p.j.unread === 4, "trang đầu 50 mục, còn nữa", JSON.stringify({ n: p.j.items.length, more: p.j.more, unread: p.j.unread }));
const seen = new Set(p.j.items.map((x) => x.run));
let cursor = Math.min(...p.j.items.map((x) => x.at)), pages = 1;
while (p.j.more && pages < 10) { p = await a("GET", `/api/autopilot?limit=50&before=${cursor}`);
  for (const x of p.j.items) { ok(!seen.has(x.run) || false, "không lặp mục giữa các trang", x.run); seen.add(x.run);
  } cursor = Math.min(...p.j.items.map((x) => x.at)); pages++; }
ok(seen.size === 122, `đi hết các trang thấy đủ mọi mục, không chỉ 50 mục (${seen.size})`, seen.size);
const old = (await a("GET",
  `/api/autopilot?limit=5&before=${now - 100 * DAY}`)).j.items.find((x) => x.title === "Kết quả 101");
ok(old?.status === "done" && old.text.startsWith("Nội dung 101"), "kết quả 100 ngày trước vẫn đọc được, không báo lỗi", JSON.stringify(old)?.slice(0, 200));
const gone = (await a("GET",
  `/api/autopilot?limit=5&before=${now - 300 * DAY}`)).j.items.find((x) => x.title === "Cũ không còn");
ok(gone?.status === "expired" && /quá cũ/.test(gone.error ?? ""), "lượt đã mất từ trước khi có bản lưu thì báo rõ (hết hạn, không phải lỗi)", JSON.stringify(gone));
ok(db.prepare("SELECT result FROM task_runs WHERE run_id = ?").get(`rn_${uid}_gone`).result !== null, "đã ghi nhận, không phải tra lại mỗi lần");
db.prepare("DELETE FROM task_runs WHERE owner = ?").run(uid); db.prepare("DELETE FROM notices WHERE owner = ?").run(uid);

console.log("2. Xóa đoạn chat gỡ cả điều đã học từ nó");
await a("POST", "/api/memory", { cfg: { gen: true, sens: false } });
await a("GET", "/api/brain");
const conv = String(now), srcTitle = `Nguồn ${now}`, srcOther = `Nguồn khác ${now}`;
await a("POST", "/api/brain/import", { chats: [{ id: conv, title: srcTitle, msgs: [{ role: "user", text: "Đoạn chat đủ dài để vào bộ não" }] }] });
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const wiki = (title, facts) => db.prepare("INSERT INTO brain_notes (id, user_id, kind, title, tkey, conv, body, props, created_at, updated_at) VALUES (?, ?, 'topic', ?, ?, NULL, '', ?, ?, ?)").run(`bn_${title}`, uid, title, fold(title), JSON.stringify({ facts, summary: "Tóm lược BIMAT" }), now, now);
const only = `Chủ đề chỉ một nguồn ${now}`, both = `Chủ đề hai nguồn ${now}`;
wiki(only, [{ t: "Điều BIMAT", src: srcTitle, at: now }]);
wiki(both, [{ t: "Điều BIMAT", src: srcTitle, at: now }, { t: "Điều giữ lại", src: srcOther, at: now }]);
const about = await a("GET", `/api/brain/note?title=${encodeURIComponent("Về bạn")}`);
if (about.j?.note?.id) { const row = db.prepare("SELECT props FROM brain_notes WHERE id = ?").get(about.j.note.id); const pp = JSON.parse(row.props); pp.profile = [{ cat: "who", t: "Hồ sơ BIMAT", src: srcTitle, at: now }, { cat: "who", t: "Hồ sơ giữ lại", at: now }]; db.prepare("UPDATE brain_notes SET props = ? WHERE id = ?").run(JSON.stringify(pp), about.j.note.id); }
await a("PUT", "/api/chats", { items: [{ kind: "chat", id: conv, upd: Date.now(), deleted: true }] });
ok(!db.prepare("SELECT 1 FROM brain_notes WHERE user_id = ? AND conv = ?").get(uid, conv), "ghi chú của đoạn chat đã xóa");
ok(!db.prepare("SELECT 1 FROM brain_queue WHERE user_id = ? AND conv = ?").get(uid, conv), "hàng chờ học của đoạn chat đã xóa");
ok(!db.prepare("SELECT 1 FROM brain_notes WHERE user_id = ? AND title = ?").get(uid, only), "chủ đề chỉ sinh ra từ đoạn chat đó thì mất theo");
const kept = db.prepare("SELECT props, body FROM brain_notes WHERE user_id = ? AND title = ?").get(uid, both);
ok(kept && !kept.props.includes("BIMAT") && !kept.body.includes("BIMAT") && kept.props.includes("Điều giữ lại") && JSON.parse(kept.props).stale, "chủ đề có nguồn khác: gỡ điều đã học và tóm lược cũ, chờ biên soạn lại", kept?.props);
const ab = about.j?.note?.id ? db.prepare("SELECT props, body FROM brain_notes WHERE id = ?").get(about.j.note.id) : null;
ok(ab && !ab.props.includes("BIMAT") && !ab.body.includes("BIMAT") && ab.props.includes("Hồ sơ giữ lại"), "hồ sơ Về bạn: gỡ điều có nguồn là đoạn chat đó", ab?.props);
ok((await a("PUT", "/api/chats", { items: [{ kind: "chat", id: conv, upd: Date.now(), deleted: true }] })).s === 200, "xóa lại lần nữa vẫn an toàn");

console.log("3. Thư viện bị chặn vì giấy phép không còn trông như cài được");
const admin = client();
await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
let cat = await a("GET", "/api/plugins/catalog?size=100&only=missing");
const lib = cat.j?.items?.find((x) => !x.closed && !x.installed);
if (lib) {
  const before = cat.j.totals.closed;
  const entryCommit = (await import("node:fs")).readFileSync(process.cwd() + "/catalog/claude-directory.json", "utf8");
  const commit = JSON.parse(entryCommit).plugins.find((x) => `cd:${x.id}` === lib.id)?.commit ?? "";
  db.prepare("INSERT OR REPLACE INTO plugin_catalog_blocked (catalog_id, name, reason, commit_sha, at) VALUES (?, ?, 'Giấy phép độc quyền thử nghiệm', ?, ?)").run(lib.id, lib.name, commit, now);
  cat = await a("GET", `/api/plugins/catalog?size=100&q=${encodeURIComponent(lib.name)}`);
  const it = cat.j.items.find((x) => x.id === lib.id);
  ok(it?.closed === true && /độc quyền/.test(it.closedWhy ?? ""), "hiện là bị khóa, có lý do", JSON.stringify(it)?.slice(0, 300));
  ok(cat.j.totals.closed === before + 1, "không còn đếm vào số thư viện cài được", `${before} → ${cat.j.totals.closed}`);
  const ins2 = await a("POST", "/api/plugins", { action: "install", catalogId: lib.id, scope: "personal" });
  ok(ins2.s === 403 && /độc quyền/.test(ins2.j?.error ?? ""), "bấm cài bị từ chối ngay, không tải về rồi mới lỗi", JSON.stringify(ins2));
  const exp = await admin("GET", "/api/plugins/catalog?blocked=1");
  ok(exp.j?.[lib.id]?.reason, "quản trị viên lấy được danh sách để ghi vào danh mục", JSON.stringify(exp.j)?.slice(0, 200));
  ok(!(await a("GET", "/api/plugins/catalog?blocked=1")).j?.[lib.id], "thành viên không lấy được danh sách đó");
  db.prepare("DELETE FROM plugin_catalog_blocked WHERE catalog_id = ?").run(lib.id);
} else console.log("  (danh mục giả lập không có thư viện chưa cài: bỏ qua)");

console.log("4. Trạng thái Speech trả về cho giao diện");
ok(typeof (await a("GET", "/api/auth/me")).j.speechReady === "boolean", "giao diện biết máy chủ có khóa ElevenLabs hay chưa (ẩn Speech khỏi thành viên khi chưa có)");

db.close();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
