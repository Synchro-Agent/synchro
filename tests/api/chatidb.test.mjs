// Kho đoạn chat IndexedDB (blueprint B4), phần không cần trình duyệt: lõi thuần (chỉ mục, chỉ ghi phần đổi, dấu khóa cũ, giữ 7 ngày).
// Tự chạy được, không cần dev:mock.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

const { chatidbcore: K, chatsynccore: C } = await loadTs(["chatidbcore", "chatsynccore"]);

const chat = (id, extra = {}) => ({ id, title: `Chat ${id}`, msgs: [{ role: "user", text: `hỏi ${id}`, time: id + 1 }, { role: "ai", text: `đáp ${id}`, time: id + 2, done: true }], ...extra });

console.log("1. Dòng chỉ mục và bản rút gọn");
{
  ok(K.dbName("A") === "synchro-chats:A" && K.dbName("B") !== K.dbName("A"), "mỗi tài khoản một cơ sở dữ liệu riêng");
  const c = chat(100, { pinned: true, project: 7, tags: ["việc"], studio: "slides", named: true, mixer: { recent: 3 }, critic: { a: 1 } });
  const r = K.idxOf(c);
  ok(r.id === 100 && r.title === "Chat 100" && r.upd === 102 && r.pinned && r.project === 7 && r.tags[0] === "việc" && r.studio === "slides" && r.named, "chỉ mục có đủ trường thanh bên cần (tên, mốc sửa, ghim, dự án, thẻ, studio, tự đặt tên)", r);
  ok(!("msgs" in r) && !("mixer" in r) && !("critic" in r) && !("run" in r) && !("srv" in r), "chỉ mục không mang nội dung tin nhắn hay trường lớn", r);
  r.tags.push("x");
  ok(c.tags.length === 1, "chỉ mục chép mảng thẻ, sửa chỉ mục không đụng đoạn chat");
  const running = chat(200, { msgs: [{ role: "user", text: "q", time: 201 }, { role: "ai", text: "", time: 202, run: "r-9" }] });
  ok(K.idxOf(running).run === "r-9", "câu trả lời chưa nhận xong: chỉ mục giữ mã lượt chạy (phải đọc thân trước để nối lại)");
  ok(K.idxOf({ ...running, msgs: [...running.msgs, { role: "user", text: "tiếp", time: 203 }] }).run === undefined, "tin cuối là của người dùng: không có mã lượt chạy");
  ok(K.idxOf({ id: 5, msgs: [] }).title === "" && K.idxOf({ id: 5, msgs: [] }).upd === 5, "đoạn chat thiếu tên / chưa có tin: không lỗi, mốc sửa là id");
  ok(K.idxKey(K.idxOf(c)) === K.idxKey(K.idxOf({ ...c })), "cùng nội dung thì cùng khóa so");

  const s = K.stubOfRow(K.idxOf(c));
  ok(s.stub && s.local && s.msgs.length === 0 && s.upd === 102 && s.title === "Chat 100" && s.pinned && s.project === 7 && s.tags[0] === "việc" && s.studio === "slides" && s.named, "bản rút gọn từ chỉ mục: thân trong IndexedDB (local), giữ trường thanh bên", s);
  ok(C.lastTime(s) === 102, "mốc sửa của bản rút gọn lấy từ chỉ mục (không có tin)");
  ok(K.idxKey(K.idxOf(s)) === K.idxKey(K.idxOf(c)), "chỉ mục dựng lại từ bản rút gọn trùng chỉ mục gốc (ghi lại không đổi gì)", [K.idxOf(s), K.idxOf(c)]);
  const srv = K.stubOfRow({ ...K.idxOf(c), srv: true });
  ok(srv.stub && !srv.local, "chỉ mục srv: bản rút gọn chỉ có trên máy chủ (chatsync tải về)", srv);
  ok(K.idxOf(srv).srv === true && K.idxOf(s).srv === undefined, "bản rút gọn của máy chủ giữ srv khi ghi lại chỉ mục, bản local thì không");
}

console.log("2. Thân đoạn chat không bao giờ mang trường của chỉ mục");
{
  const body = chat(300, { pinned: true, tags: ["a"] });
  const st = { ...K.stubOfRow(K.idxOf(body)), title: "Tên mới", pinned: undefined, tags: ["b"], project: 4 };
  const m = K.withIdx(body, st);
  ok(m.title === "Tên mới" && m.pinned === undefined && !("pinned" in m) && m.tags[0] === "b" && m.project === 4 && m.msgs.length === 2, "sửa trên bản rút gọn trong lúc chờ thân: áp lên thân", m);
  ok(!("upd" in m) && !("local" in m) && !("stub" in m), "không chép upd / local / stub sang thân", m);
  const sBody = C.serialChat(body), sSame = C.serialChat(K.withIdx(body, K.stubOfRow(K.idxOf(body))));
  ok(sBody === sSame && C.hashOf(sBody) === C.hashOf(sSame), "thân hợp với bản rút gọn chưa sửa: dấu nội dung không đổi (không bị coi là đã sửa, không đẩy lại)", `${sBody}\n${sSame}`);
  ok(!/"upd"|"local"/.test(sSame), "serialChat của thân không chứa upd hay local", sSame);
  const lr = K.legacyRow({ ...body, upd: 999, local: true });
  ok(lr && !/"upd"|"local"/.test(lr.s) && lr.s === C.serialChat(body), "dữ liệu cũ lỡ có upd / local: bỏ đi trước khi lưu thân", lr?.s);
}

console.log("3. Chỉ ghi phần đã đổi");
{
  const a = chat(1), b = chat(2), c = chat(3);
  const prev = K.snapshot([c, b, a]);
  let d = K.diffSave(prev, [c, b, a]);
  ok(!d.put.length && !d.idx.length && !d.del.length && !d.drop.length && !d.guarded, "không đổi gì: không ghi gì", d);
  const b2 = { ...b, title: "B mới" };
  d = K.diffSave(prev, [c, b2, a]);
  ok(d.put.length === 1 && d.put[0] === b2 && !d.idx.length && !d.del.length, "đổi một đoạn: chỉ ghi đúng đoạn đó", d);
  const n = chat(4);
  d = K.diffSave(prev, [n, c, a]);
  ok(d.put.length === 1 && d.put[0] === n && d.del.length === 1 && d.del[0] === 2, "đoạn mới được ghi, đoạn bị xóa khỏi danh sách thì xóa khỏi kho", d);
  const inc = chat(5, { inc: true });
  d = K.diffSave(prev, [inc, c, b, a]);
  ok(!d.put.length && !d.del.length, "đoạn chat ẩn danh không bao giờ được lưu", d);
  ok(!K.snapshot([inc, a]).has(5), "bản đã lưu lần trước không chứa đoạn ẩn danh");

  const s = K.stubOfRow(K.idxOf(a));
  const p2 = K.snapshot([s]);
  ok(!K.diffSave(p2, [s]).idx.length, "bản rút gọn không đổi: không ghi");
  ok(!K.diffSave(p2, [{ ...s }]).idx.length, "bản rút gọn là đối tượng mới nhưng chỉ mục y nguyên: không ghi");
  const s2 = { ...s, title: "Đổi tên khi chưa đọc thân", pinned: true };
  d = K.diffSave(p2, [s2]);
  ok(!d.put.length && d.idx.length === 1 && d.idx[0].title === "Đổi tên khi chưa đọc thân" && d.idx[0].pinned && !d.idx[0].srv, "đổi tên / ghim bản rút gọn: chỉ ghi chỉ mục, không ghi thân rỗng đè thân thật", d);
  d = K.diffSave(K.snapshot([a]), [{ ...K.stubOfRow(K.idxOf(a)), local: undefined }]);
  ok(d.drop.length === 1 && d.drop[0] === 1 && d.idx[0]?.srv === true && !d.put.length, "đoạn chat thành bản rút gọn của máy chủ: bỏ thân ở máy này, chỉ mục ghi srv", d);
  const srvStub = { ...K.stubOfRow({ ...K.idxOf(a), srv: true }) };
  d = K.diffSave(K.snapshot([srvStub]), [{ ...srvStub, title: "x" }]);
  ok(!d.drop.length && d.idx.length === 1, "bản rút gọn của máy chủ đổi tên: không bỏ thân lần nữa", d);
}

console.log("4. Không suy ra xóa hết từ danh sách rỗng");
{
  const prev = K.snapshot([chat(1), chat(2)]);
  let d = K.diffSave(prev, []);
  ok(d.guarded && !d.del.length, "danh sách rỗng (chưa nạp xong, đổi tài khoản giữa chừng): không xóa gì", d);
  d = K.diffSave(prev, [chat(9, { inc: true })]);
  ok(d.guarded && !d.del.length, "chỉ còn đoạn ẩn danh cũng tính là rỗng", d);
  d = K.diffSave(prev, [], (id) => id === 2);
  ok(d.guarded && d.del.length === 1 && d.del[0] === 2, "người dùng đã xóa thật (explicit): xóa đúng mục đó", d);
  d = K.diffSave(new Map(), []);
  ok(!d.guarded && !d.del.length, "kho trống, danh sách trống: không có gì để chặn");
  d = K.diffSave(prev, [chat(1)]);
  ok(!d.guarded && d.del.length === 1 && d.del[0] === 2, "danh sách còn mục: xóa bình thường", d);
}

console.log("5. Dấu khóa cũ và giữ 7 ngày");
{
  const list = Array.from({ length: 60 }, (_, i) => chat(1000 - i));
  const raw = JSON.stringify(list);
  ok(raw.length > 8192, "dữ liệu thử đủ lớn để chỉ băm đầu + cuối", raw.length);
  ok(K.legacySig(raw) === K.legacySig(String(raw)), "cùng nội dung: cùng dấu");
  const head = JSON.stringify([{ ...list[0], title: "Chat 1000!" }, ...list.slice(1)]);
  ok(K.legacySig(head) !== K.legacySig(raw), "đoạn mới nhất (đầu danh sách) đổi: dấu đổi");
  const tail = JSON.stringify([...list.slice(0, -1), { ...list.at(-1), title: "Chat 94?" }]);
  ok(K.legacySig(tail) !== K.legacySig(raw), "đoạn cũ nhất (cuối danh sách) đổi: dấu đổi");
  ok(K.legacySig(JSON.stringify([...list, chat(1)])) !== K.legacySig(raw), "thêm đoạn: độ dài đổi, dấu đổi");
  ok(K.legacySig("[]") !== K.legacySig("[1]") && K.legacySig("").startsWith("0:"), "khóa nhỏ: băm cả chuỗi");
  const DAY = 86_400_000, t0 = 1_700_000_000_000;
  ok(!K.dropLegacyDue(t0, t0 + 6 * DAY + DAY - 1), "chưa đủ 7 ngày: giữ khóa cũ");
  ok(K.dropLegacyDue(t0, t0 + 7 * DAY), "đủ 7 ngày: xóa khóa cũ");
  ok(!K.dropLegacyDue(0, t0) && !K.dropLegacyDue(undefined, t0), "chưa chuyển lần nào: không bao giờ xóa");
}

console.log("6. Thứ tự và đọc khóa cũ");
{
  const rows = K.sortIdx([{ id: 2 }, { id: 9 }, { id: 5 }]);
  ok(rows.map((r) => r.id).join() === "9,5,2", "chỉ mục xếp id giảm dần như thanh bên");
  const src = [chat(10), chat(11, { inc: true }), { id: "x", msgs: [] }, null, 7, { id: 12 }, chat(13, { stub: true, msgs: [] }), chat(14, { msgs: [{ role: "ai", text: "", time: 20, run: "r1", prog: "đang viết", done: false }] })];
  const lr = K.legacyRows(src);
  ok(lr.map((r) => r.id).join() === "10,13,14", "bỏ đoạn ẩn danh và mục hỏng (id không phải số, thiếu msgs)", lr.map((r) => r.id));
  ok(lr[0].s === C.serialChat(src[0]) && lr[0].idx.upd === 12, "thân lưu đúng chuỗi serialChat (dấu nội dung khớp chatsync, không băm lại)");
  ok(lr[1].s === null && lr[1].idx.srv === true, "bản rút gọn cũ (hết chỗ): chỉ ghi chỉ mục, thân ở máy chủ", lr[1]);
  ok(!lr[2].s.includes("đang viết") && lr[2].idx.run === "r1", "đoạn đang chạy: bỏ dòng tiến độ như bản lưu cũ, chỉ mục giữ mã lượt chạy", lr[2]);
  ok(K.legacyRows({ a: 1 }).length === 0 && K.legacyRows(null).length === 0, "khóa cũ không phải mảng: không có gì để nhập");
  const have = { id: 10, title: "", upd: 50 };
  ok(K.legacyWins(lr[0], undefined), "kho chưa có: nhập");
  ok(!K.legacyWins(lr[0], have), "kho đã có bản có tin mới hơn: không đè bằng bản cũ");
  ok(K.legacyWins(lr[0], { ...have, upd: 12 }), "cùng mốc (đổi tên ở tab bản cũ): nhập lại");
  ok(!K.legacyWins(lr[1], { id: 13, title: "", upd: 0 }), "bản rút gọn cũ không đè thân đã có");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
