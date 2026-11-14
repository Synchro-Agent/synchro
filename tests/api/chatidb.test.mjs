// Kho đoạn chat IndexedDB (blueprint B4), phần không cần trình duyệt: lõi thuần (chỉ mục, chỉ ghi phần đổi, dấu khóa cũ, giữ 7 ngày),
// kho dự phòng localStorage, kho IndexedDB trên IndexedDB giả (tests/lib/fakeidb.mjs: hết chỗ, mất kết nối, mở lỗi / treo), chuyển dữ liệu cũ.
// Tự chạy được, không cần dev:mock.
import { fakeIDB } from "../lib/fakeidb.mjs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

// Kho giống Storage của trình duyệt; limit: tổng độ dài vượt mức thì setItem ném (hết chỗ).
class Store {
  constructor(limit = Infinity) { this.m = new Map(); this.limit = limit; this.sets = 0; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    this.sets++;
    const n = [...this.m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0) + String(v).length;
    if (n > this.limit) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new Store();

const { chatidbcore: K, chatsynccore: C, chatidb: D, userscope: U } = await loadTs(["chatidbcore", "chatsynccore", "chatidb", "userscope"]);

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

const plan = (d) => ({ put: d.put.map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })), idx: d.idx, del: d.del, drop: d.drop });
const DAY = 86_400_000;

console.log("7. Kho dự phòng localStorage (trình duyệt không mở được IndexedDB)");
{
  const st = new Store();
  globalThis.localStorage = st;
  const c1 = chat(1), c2 = chat(2), c3 = chat(3), srvStub = C.stubOf(chat(4)), inc = chat(5, { inc: true });
  st.setItem("u:A:chats", JSON.stringify([c3, c2, c1, inc, srvStub]));
  st.setItem("u:B:chats", JSON.stringify([chat(77)]));
  U.setUserScope("B");
  const s = await D.openChatStore("A");
  ok(s.kind === "ls" && s.uid === "A", "không có IndexedDB (node): rơi về localStorage", s.kind);
  const idx = await s.loadIndex();
  ok(idx.map((r) => r.id).join() === "4,3,2,1", "chỉ mục đủ đoạn, bỏ đoạn ẩn danh, mới nhất trước", idx.map((r) => r.id));
  ok(idx[0].srv === true && !idx[1].srv, "bản rút gọn cũ: chỉ mục ghi thân ở máy chủ");
  const b = await s.bodies([3, 4, 99]);
  ok(b.size === 1 && JSON.parse(b.get(3)).msgs.length === 2, "thân chỉ có cho đoạn có nội dung ở máy này", [...b.keys()]);
  const all = await s.loadAll();
  ok(all.map((c) => c.id).join() === "3,2,1,4" && all[3].stub, "đọc hết: giữ thứ tự đã lưu, bản rút gọn giữ nguyên", all.map((c) => c.id));

  const c2b = { ...c2, title: "Hai", msgs: [...c2.msgs, { role: "user", text: "thêm", time: 50 }] }, c6 = chat(6);
  let r = await s.write(plan(K.diffSave(K.snapshot(all), [c6, c3, c2b, c1, all[3]])));
  let saved = JSON.parse(st.getItem("u:A:chats"));
  ok(r.status === "ok" && saved.map((c) => c.id).join() === "6,3,2,1,4" && saved[2].title === "Hai" && saved[2].msgs.length === 3, "ghi: đoạn mới lên đầu, đoạn đổi giữ chỗ", saved.map((c) => c.id));
  ok(JSON.parse(st.getItem("u:B:chats"))[0].id === 77 && !st.getItem("u:anon:chats"), "ghi đúng khóa của tài khoản của kho (A), không theo vùng đang mở (B)");
  r = await s.write({ del: [1] });
  saved = JSON.parse(st.getItem("u:A:chats"));
  ok(saved.map((c) => c.id).join() === "6,3,2,4", "xóa", saved.map((c) => c.id));
  r = await s.write({ idx: [{ ...K.idxOf(srvStub), title: "Đổi tên bản rút gọn", pinned: true }, { ...K.idxOf(c3), title: "Ba" }] });
  saved = JSON.parse(st.getItem("u:A:chats"));
  const s4 = saved.find((c) => c.id === 4), s3 = saved.find((c) => c.id === 3);
  ok(s4.stub && s4.title === "Đổi tên bản rút gọn" && s4.pinned && !("upd" in s4) && !("local" in s4), "chỉ ghi chỉ mục của bản rút gọn: đổi tên / ghim, không thêm upd / local", s4);
  ok(!s3.stub && s3.title === "Ba" && s3.msgs.length === 2, "chỉ mục của đoạn đủ thân: vẫn đủ thân (không bao giờ thành rút gọn)", s3);
  r = await s.write({ drop: [6] });
  saved = JSON.parse(st.getItem("u:A:chats"));
  ok(saved[0].id === 6 && saved[0].stub && saved[0].msgs.length === 0, "bỏ thân: thành bản rút gọn", saved[0]);

  // Hết chỗ: rút gọn đoạn cũ nhất đã có trên máy chủ, như chatsync từ trước tới nay.
  const big = (id) => chat(id, { msgs: [{ role: "user", text: "x".repeat(3000), time: id }] });
  const st2 = new Store(9000);
  globalThis.localStorage = st2;
  const s2 = new D.LsStore("Q");
  await s2.loadIndex();
  r = await s2.write({ put: [big(10), big(20)].map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })) });
  ok(r.status === "ok", "vừa chỗ: ghi bình thường");
  const third = { put: [big(30)].map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })) };
  r = await s2.write(third);
  ok(r.status === "quota" && JSON.parse(st2.getItem("u:Q:chats")).length === 2, "hết chỗ, không có đoạn nào đã lên máy chủ: báo quota, bản cũ giữ nguyên", r);
  r = await s2.write({}, (id) => id === 10);
  const q = JSON.parse(st2.getItem("u:Q:chats"));
  ok(r.status === "ok" && r.stubbed.join() === "10" && q.find((c) => c.id === 10).stub && q.find((c) => c.id === 30).msgs.length === 1, "đoạn đã lên máy chủ thì rút gọn (cũ nhất trước) để vừa chỗ", [r, q.map((c) => [c.id, !!c.stub])]);
  await s2.clear();
  ok(st2.getItem("u:Q:chats") === null && !(await s2.loadIndex()).length, "xóa kho: khóa localStorage của tài khoản biến mất");
  globalThis.localStorage = st;
  U.setUserScope(null);
}

console.log("8. Kho IndexedDB (IndexedDB giả)");
{
  D.resetIdbDown();
  const f = fakeIDB();
  const s = await D.openChatStore("A", { idb: f });
  ok(s.kind === "idb" && f.has("synchro-chats:A"), "mở được IndexedDB: dùng kho IndexedDB riêng của tài khoản", s.kind);
  const list = [chat(3, { tags: ["t"] }), chat(2), chat(1, { msgs: [{ role: "ai", text: "", time: 9, run: "r7" }] })];
  let r = await s.write(plan(K.diffSave(new Map(), list)));
  ok(r.status === "ok" && f.dump("synchro-chats:A", "body").length === 3 && f.dump("synchro-chats:A", "idx").length === 3, "ghi lần đầu: mỗi đoạn một bản ghi thân + một dòng chỉ mục", r);
  const s2 = await D.openChatStore("A", { idb: f });
  const idx = await s2.loadIndex();
  ok(idx.map((x) => x.id).join() === "3,2,1" && idx[0].tags[0] === "t" && idx[2].run === "r7", "mở lại: chỉ mục còn đủ, mới nhất trước, giữ thẻ và mã lượt chạy", idx);
  const b = await s2.bodies([1, 3, 42]);
  ok(b.size === 2 && b.get(3) === C.serialChat(list[0]), "đọc thân theo id: đúng chuỗi serialChat (dấu nội dung khớp chatsync)");
  const all = await s2.loadAll();
  ok(all.length === 3 && all[0].msgs.length === 2 && !("local" in all[0]) && !("upd" in all[0]), "đọc hết: đoạn đầy đủ, không mang trường của chỉ mục", all[0]);
  s2.close();

  // Chỉ ghi phần đổi: đổi tên một đoạn → đúng 1 thân + 1 chỉ mục.
  const prev = K.snapshot(list);
  f.ctl.puts = {};
  const renamed = [list[0], { ...list[1], title: "Đổi tên" }, list[2]];
  r = await s.write(plan(K.diffSave(prev, renamed)));
  ok(r.status === "ok" && f.ctl.puts.body === 1 && f.ctl.puts.idx === 1, "đổi tên một đoạn: đúng 1 lần ghi thân và 1 lần ghi chỉ mục", f.ctl.puts);
  f.ctl.puts = {};
  const stub = K.stubOfRow(K.idxOf(list[2]));
  r = await s.write(plan(K.diffSave(K.snapshot([stub]), [{ ...stub, pinned: true }])));
  ok(r.status === "ok" && !f.ctl.puts.body && f.ctl.puts.idx === 1 && JSON.parse((await s.bodies([1])).get(1)).msgs.length === 1, "ghim bản rút gọn: chỉ ghi chỉ mục, thân thật còn nguyên", f.ctl.puts);
  r = await s.write({ drop: [1] });
  const i1 = (await s.loadIndex()).find((x) => x.id === 1);
  ok(r.status === "ok" && !(await s.bodies([1])).size && i1.srv === true && i1.run === undefined && i1.pinned, "bỏ thân: chỉ mục còn (srv, giữ ghim), thân không còn, bỏ mã lượt chạy", i1);
  ok((await s.loadAll()).find((c) => c.id === 1).stub === true && !(await s.loadAll()).find((c) => c.id === 1).local, "đọc hết: đoạn không còn thân là bản rút gọn của máy chủ");
  r = await s.write({ del: [2] });
  ok(r.status === "ok" && (await s.loadIndex()).map((x) => x.id).join() === "3,1" && !(await s.bodies([2])).size, "xóa: mất cả thân lẫn chỉ mục");

  // Mất kết nối (iOS): mở lại một lần rồi ghi tiếp.
  f.ctl.loseNext = 1;
  r = await s.write({ put: [{ id: 8, s: C.serialChat(chat(8)), idx: K.idxOf(chat(8)) }] });
  ok(r.status === "ok" && (await s.bodies([8])).size === 1, "mất kết nối một lần: mở lại, ghi được", r);
  f.ctl.loseNext = 2;
  r = await s.write({ put: [{ id: 9, s: C.serialChat(chat(9)), idx: K.idxOf(chat(9)) }] });
  ok(r.status === "error" && !(await s.bodies([9])).size, "mất kết nối cả lần thử lại: báo lỗi, không ném", r);

  // Hết chỗ: giao dịch nguyên khối, rồi rút gọn đoạn cũ nhất đã có trên máy chủ.
  const g = fakeIDB();
  const q = await D.openChatStore("Q", { idb: g });
  const big = (id, t) => chat(id, { msgs: [{ role: "user", text: "y".repeat(3000), time: t }] });
  r = await q.write({ put: [big(10, 100), big(20, 50), big(30, 300)].map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })) });
  ok(r.status === "ok", "vừa chỗ: ghi bình thường");
  g.ctl.quota = 10_500;
  const more = { put: [big(40, 400)].map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })) };
  r = await q.write(more);
  ok(r.status === "quota" && !(await q.bodies([40])).size && (await q.bodies([10, 20, 30])).size === 3, "hết chỗ, không được rút gọn: báo quota, không ghi nửa chừng", r);
  r = await q.write(more, (id) => id !== 30);
  const qi = await q.loadIndex();
  ok(r.status === "ok" && r.stubbed[0] === 20 && (await q.bodies([40])).size === 1, "được rút gọn: bỏ thân đoạn cũ nhất (mốc sửa nhỏ nhất) trước, rồi ghi được", r);
  ok(qi.length === 4 && qi.find((x) => x.id === 20).srv && !qi.find((x) => x.id === 30).srv, "đoạn bị rút gọn còn dòng chỉ mục (srv); đoạn chưa lên máy chủ không bao giờ bị rút gọn", qi);

  // Tab khác xóa cơ sở dữ liệu (đăng xuất kèm xóa thiết bị): nhường kết nối, không dựng lại kho.
  const h = fakeIDB();
  const v = await D.openChatStore("V", { idb: h });
  await v.write({ put: [{ id: 1, s: C.serialChat(chat(1)), idx: K.idxOf(chat(1)) }] });
  h.deleteDatabase("synchro-chats:V");
  r = await v.write({ put: [{ id: 2, s: C.serialChat(chat(2)), idx: K.idxOf(chat(2)) }] });
  ok(r.status === "error" && !h.has("synchro-chats:V") && h.conns("synchro-chats:V") === 0, "cơ sở dữ liệu bị xóa ở tab khác: kho nhường, ghi báo lỗi, không mở lại", r);

  // Kho dùng chung của trang: đặt kho mới thì đóng kho cũ.
  const k1 = await D.openChatStore("K", { idb: h }), k2 = await D.openChatStore("K2", { idb: h });
  D.setChatStore(k1);
  ok(D.currentChatStore() === k1, "đặt kho đang dùng");
  D.setChatStore(k2);
  ok(D.currentChatStore() === k2 && (await k1.write({ del: [1] })).status === "error" && h.conns("synchro-chats:K") === 0, "đổi kho (đổi tài khoản): kho cũ đóng kết nối");
  D.setChatStore(null);
  ok(D.currentChatStore() === null && h.conns("synchro-chats:K2") === 0, "đăng xuất: bỏ kho, đóng kết nối");
  await s.clear();
  ok(!(await s.loadIndex()).length && !f.dump("synchro-chats:A", "body").length, "xóa kho: không còn thân hay chỉ mục");
  s.close();
}

console.log("9. Mở IndexedDB lỗi thì rơi về localStorage, không ném");
{
  for (const [name, o] of [["open ném ngay (Firefox riêng tư cũ)", { throwOpen: true }], ["open báo lỗi", { failOpen: true }]]) {
    D.resetIdbDown();
    let threw = false, st = null;
    try { st = await D.openChatStore("A", { idb: fakeIDB(o) }); } catch { threw = true; }
    ok(!threw && st?.kind === "ls", name + ": dùng localStorage", st?.kind);
  }
  D.resetIdbDown();
  const t0 = Date.now();
  const hung = fakeIDB({ hangOpen: true });
  const st = await D.openChatStore("A", { idb: hung, timeout: 60 });
  ok(st.kind === "ls" && Date.now() - t0 < 1000, "open treo (Safari 14.1): quá thời gian thì dùng localStorage", Date.now() - t0);
  const later = await D.openChatStore("B", { idb: fakeIDB() });
  ok(later.kind === "ls", "đã rơi về localStorage thì giữ tới hết phiên trang (đổi tài khoản không chờ lại)", later.kind);
  D.resetIdbDown();
  ok((await D.openChatStore("A", { idb: null })).kind === "ls", "không có IndexedDB: dùng localStorage");
  D.resetIdbDown();
}

console.log("10. Chuyển dữ liệu cũ từ localStorage một lần, giữ khóa cũ 7 ngày");
{
  const st = new Store();
  globalThis.localStorage = st;
  const t0 = 1_700_000_000_000;
  const old = [chat(30), chat(20), chat(10), C.stubOf(chat(5)), chat(4, { inc: true })];
  st.setItem("u:A:chats", JSON.stringify(old));
  const f = fakeIDB();
  const s = await D.openChatStore("A", { idb: f });
  let r = await D.importLegacy(s, { now: t0 });
  const idx = await s.loadIndex();
  ok(r.imported === 4 && r.via === "main" && r.status === "ok", "lần đầu: nhập mọi đoạn (đọc ở luồng chính khi không có luồng phụ)", r);
  ok(idx.map((x) => x.id).join() === "30,20,10,5" && idx.find((x) => x.id === 5).srv && !(await s.bodies([5])).size, "bỏ đoạn ẩn danh; bản rút gọn cũ chỉ có chỉ mục (thân ở máy chủ)", idx);
  ok((await s.bodies([20])).get(20) === C.serialChat(old[1]), "thân nhập vào đúng chuỗi serialChat (chatsync không coi là đã sửa)");
  let m = await s.getMeta();
  ok(m.sig === K.legacySig(st.getItem("u:A:chats")) && m.migratedAt === t0, "ghi dấu khóa cũ và mốc nhập đầu", m);
  ok(st.getItem("u:A:chats") !== null, "khóa cũ vẫn còn (giữ 7 ngày)");
  f.ctl.puts = {};
  r = await D.importLegacy(s, { now: t0 + DAY });
  ok(r.imported === 0 && r.via === null && !f.ctl.puts.body, "mở lại, khóa cũ không đổi: không đọc / ghi lại", r);

  // Bản app cũ ở tab khác ghi lại khóa cũ: nhập lại (chỉ thêm / đè), không đè bản mới hơn trong kho.
  const newer = { ...chat(10), msgs: [...chat(10).msgs, { role: "user", text: "mới hơn ở kho", time: 500 }] };
  await s.write({ put: [{ id: 10, s: C.serialChat(newer), idx: K.idxOf(newer) }] });
  const edited = { ...chat(30), title: "Đổi ở tab cũ", msgs: [...chat(30).msgs, { role: "user", text: "tin mới", time: 600 }] };
  st.setItem("u:A:chats", JSON.stringify([chat(40), edited, chat(10)]));
  r = await D.importLegacy(s, { now: t0 + 2 * DAY });
  const ids = (await s.loadIndex()).map((x) => x.id).join();
  ok(r.imported === 2 && ids === "40,30,20,10,5", "khóa cũ đổi: nhập lại phần mới / đổi, không xóa đoạn vắng mặt", [r, ids]);
  ok(JSON.parse((await s.bodies([30])).get(30)).title === "Đổi ở tab cũ" && JSON.parse((await s.bodies([10])).get(10)).msgs.length === 3, "đoạn đổi ở tab cũ được nhập; đoạn trong kho có tin mới hơn giữ nguyên");
  m = await s.getMeta();
  ok(m.migratedAt === t0, "mốc nhập đầu không đổi khi nhập lại (7 ngày tính từ lần đầu)", m);

  r = await D.importLegacy(s, { now: t0 + 7 * DAY });
  ok(r.removed && st.getItem("u:A:chats") === null && (await s.loadIndex()).length === 5, "đủ 7 ngày: xóa khóa cũ, kho IndexedDB còn đủ", r);
  r = await D.importLegacy(s, { now: t0 + 8 * DAY });
  ok(r.imported === 0 && !r.removed, "không còn khóa cũ: không làm gì", r);

  // Khóa cũ hỏng: không ném, ghi dấu để không đọc lại mỗi lần mở trang.
  st.setItem("u:A:chats", "[{hỏng");
  r = await D.importLegacy(s, { now: t0 + 9 * DAY });
  ok(r.imported === 0 && (await s.getMeta()).sig === K.legacySig("[{hỏng") && (await s.loadIndex()).length === 5, "khóa cũ hỏng JSON: không nhập gì, không xóa gì trong kho", r);

  // Ghi không được (hết chỗ): không ghi dấu, không xóa khóa cũ, lần sau thử lại.
  const g = fakeIDB({ quota: 50 });
  const sq = await D.openChatStore("Z", { idb: g });
  st.setItem("u:Z:chats", JSON.stringify([chat(1), chat(2)]));
  r = await D.importLegacy(sq, { now: t0 });
  ok(r.status === "quota" && !(await sq.getMeta()).sig && st.getItem("u:Z:chats") !== null, "IndexedDB hết chỗ lúc nhập: giữ khóa cũ, không ghi dấu", r);
  r = await D.importLegacy(sq, { now: t0 + 30 * DAY });
  ok(st.getItem("u:Z:chats") !== null, "chưa nhập xong thì không bao giờ xóa khóa cũ, kể cả sau 7 ngày");

  // Kho localStorage: khóa cũ chính là kho.
  st.setItem("u:L:chats", JSON.stringify([chat(1)]));
  const ls = new D.LsStore("L");
  r = await D.importLegacy(ls, { now: t0 + 30 * DAY });
  ok(r.imported === 0 && !r.removed && st.getItem("u:L:chats") !== null, "kho localStorage: không nhập, không bao giờ xóa khóa (đó là kho)", r);

  // Luồng phụ (bước 3) được thay bằng hàm đọc truyền vào: kết quả như đọc ở luồng chính.
  const st2 = await D.openChatStore("W", { idb: fakeIDB() });
  st.setItem("u:W:chats", JSON.stringify([chat(1), chat(2)]));
  r = await D.importLegacy(st2, { now: t0, parse: async (raw) => ({ rows: K.legacyRows(JSON.parse(raw)), via: "worker" }) });
  ok(r.via === "worker" && r.imported === 2, "đọc khóa cũ ở luồng phụ khi có", r);
  ok((await D.parseLegacyMain("không phải json")) === null && (await D.parseLegacyMain('{"a":1}')).length === 0, "đọc ở luồng chính: JSON hỏng → null, không phải mảng → rỗng");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
