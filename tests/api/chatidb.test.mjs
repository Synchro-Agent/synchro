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
  ok(raw.length > 8192, "dữ liệu thử đủ lớn (vài đoạn băm)", raw.length);
  ok(K.legacySig(raw) === K.legacySig(String(raw)), "cùng nội dung: cùng dấu");
  const head = JSON.stringify([{ ...list[0], title: "Chat 1000!" }, ...list.slice(1)]);
  ok(K.legacySig(head) !== K.legacySig(raw), "đoạn mới nhất (đầu danh sách) đổi: dấu đổi");
  const tail = JSON.stringify([...list.slice(0, -1), { ...list.at(-1), title: "Chat 94?" }]);
  ok(K.legacySig(tail) !== K.legacySig(raw), "đoạn cũ nhất (cuối danh sách) đổi: dấu đổi");
  ok(K.legacySig(JSON.stringify([...list, chat(1)])) !== K.legacySig(raw), "thêm đoạn: độ dài đổi, dấu đổi");
  ok(K.legacySig("[]") !== K.legacySig("[1]") && K.legacySig("").startsWith("0:"), "khóa nhỏ: băm cả chuỗi");
  // Sửa một đoạn ở giữa danh sách mà độ dài không đổi (đổi tên cùng số chữ): dấu vẫn phải đổi, không thì khóa cũ không bao giờ được nhập lại.
  const mid = JSON.stringify([...list.slice(0, 30), { ...list[30], title: "Chat 97X" }, ...list.slice(31)]);
  ok(mid.length === raw.length && K.legacySig(mid) !== K.legacySig(raw), "sửa giữa danh sách, cùng độ dài: dấu đổi (băm cả chuỗi)", [mid.length, raw.length]);
  let pauses = 0;
  const pause = async () => { pauses++; };
  ok((await K.legacySigAsync(raw, pause, 1000)) === K.legacySig(raw) && pauses === Math.ceil(raw.length / 1000) - 1, "băm từng đoạn (nhường luồng giữa các đoạn): cùng kết quả với băm một lần", pauses);
  ok((await K.legacySigAsync("", pause)) === K.legacySig("") && (await K.legacySigAsync(mid, pause, 7)) === K.legacySig(mid), "chuỗi rỗng / đoạn lẻ: cùng kết quả");
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
  ok(/^[^|]+\|[^|]+$/.test(lr[0].mark) && lr[0].mark !== lr[2].mark, "mỗi dòng có dấu nội dung | dấu trường thanh bên", lr[0].mark);
  const have = { id: 10, title: "Chat 10", upd: 50 };
  ok(K.legacyMerge(lr[0], undefined, undefined) === lr[0], "kho chưa có: nhập");
  ok(K.legacyMerge(lr[0], have, undefined) === null, "kho đã có bản có tin mới hơn: không đè bằng bản cũ");
  ok(K.legacyMerge(lr[0], { ...have, upd: 12 }, undefined) === null, "cùng mốc, không có dấu lần nhập trước: không phân biệt được bản cũ, giữ kho");
  ok(K.legacyMerge(lr[0], { ...have, upd: 12 }, lr[0].mark) === null, "dòng không đổi so với lần nhập trước: bỏ qua");
  const renamedOld = K.legacyRow({ ...src[0], title: "Đổi ở tab cũ" });
  ok(K.legacyMerge(renamedOld, { ...have, upd: 12 }, lr[0].mark) === renamedOld, "cùng mốc, tab bản cũ đổi tên (trường thanh bên khác lần trước): nhập lại");
  ok(K.legacyMerge(lr[1], { id: 13, title: "", upd: 0 }, undefined) === null, "bản rút gọn cũ không đè thân đã có");
  // Tab cũ thêm tin vào đoạn mà app mới đã đổi tên + ghim: nhập nội dung mới, giữ tên / ghim của kho.
  const more = K.legacyRow({ ...src[0], msgs: [...src[0].msgs, { role: "user", text: "tin ở tab cũ", time: 80 }] });
  const m = K.legacyMerge(more, { ...have, title: "Tên ở app mới", pinned: true, upd: 12 }, lr[0].mark);
  ok(m && JSON.parse(m.s).msgs.length === 3 && JSON.parse(m.s).title === "Tên ở app mới" && JSON.parse(m.s).pinned === true && m.idx.title === "Tên ở app mới" && m.idx.pinned && m.idx.upd === 80, "nội dung đổi ở tab cũ, tên / ghim ở tab cũ không đổi: giữ tên / ghim của kho", m);
  ok(m && !/"upd"|"local"|"stub"/.test(m.s) && m.s === C.serialChat(JSON.parse(m.s)), "thân sau khi gộp vẫn là chuỗi serialChat sạch", m?.s);
}

const plan = (d) => K.toWrite(d);
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
  ok(v.closed === true, "kho bị đóng từ bên ngoài: closed = true để trang chuyển sang localStorage hoặc tải lại");

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

console.log("11. Đọc khóa cũ ở luồng phụ");
{
  // Chạy chính tệp app/chatmigrate.worker.ts với một "self" giả, rồi giả Worker của trình duyệt chuyển tin qua lại.
  const ctx = { onmessage: null, postMessage: null };
  globalThis.self = ctx;
  await loadTs(["chatmigrate.worker"]);
  ok(typeof ctx.onmessage === "function", "luồng phụ nhận tin");
  const list = [chat(3), chat(2, { inc: true }), C.stubOf(chat(1))];
  const raw = JSON.stringify(list);
  let got;
  ctx.postMessage = (m) => { got = m; };
  ctx.onmessage({ data: raw });
  ok(got.ok && got.rows.map((r) => r.id).join() === "3,1" && got.rows[0].s === C.serialChat(list[0]) && got.rows[1].s === null && got.rows[1].idx.srv, "luồng phụ trả chuỗi thân + chỉ mục, giống đọc ở luồng chính", got);
  ctx.onmessage({ data: "{hỏng" });
  ok(got.ok === false, "JSON hỏng: luồng phụ báo không đọc được", got);

  let made = 0, mode = "ok";
  globalThis.Worker = class {
    constructor(url) { made++; this.url = String(url); if (mode === "throw") throw new Error("CSP chặn luồng phụ"); }
    postMessage(data) {
      setTimeout(() => {
        if (mode === "error") { this.onerror?.({ preventDefault() {} }); return; }
        ctx.postMessage = (m) => this.onmessage?.({ data: structuredClone(m) });
        ctx.onmessage({ data });
      }, 0);
    }
    terminate() { this.dead = true; }
  };
  let r = await D.parseLegacy(raw);
  ok(made === 1 && r.via === "worker" && r.rows.map((x) => x.id).join() === "3,1", "có luồng phụ: đọc ở luồng phụ", r);
  r = await D.parseLegacy("{hỏng");
  ok(r.via === "worker" && r.rows === null, "JSON hỏng qua luồng phụ: rows null (importLegacy ghi dấu, không nhập gì)", r);
  mode = "error";
  r = await D.parseLegacy(raw);
  ok(r.via === "main" && r.rows.length === 2, "luồng phụ lỗi: đọc ở luồng chính", r);
  mode = "throw";
  r = await D.parseLegacy(raw);
  ok(r.via === "main" && r.rows.length === 2, "không mở được luồng phụ: đọc ở luồng chính", r);
  mode = "ok";
  const st = new Store();
  globalThis.localStorage = st;
  st.setItem("u:M:chats", raw);
  const s = await D.openChatStore("M", { idb: fakeIDB() });
  r = await D.importLegacy(s, { now: 1 });
  ok(r.via === "worker" && r.imported === 2 && (await s.bodies([3])).get(3) === C.serialChat(list[0]), "chuyển dữ liệu cũ dùng luồng phụ khi có", r);
  delete globalThis.Worker;
  delete globalThis.self;
}

console.log("12. Nhập lại khóa cũ không đè sửa chỉ mục ở app mới");
{
  // Lỗi cũ: nhập lại MỌI dòng của khóa cũ mỗi khi khóa đổi, nên đổi tên / ghim (chỉ ghi chỉ mục, mốc sửa không đổi) bị khóa cũ đè.
  const st = new Store();
  globalThis.localStorage = st;
  const t0 = 1_700_000_000_000;
  const a = chat(1000), b = chat(2000);
  st.setItem("u:R:chats", JSON.stringify([b, a]));
  const s = await D.openChatStore("R", { idb: fakeIDB() });
  let r = await D.importLegacy(s, { now: t0 });
  ok(r.imported === 2, "chuyển lần đầu", r);
  // App mới: đổi tên + ghim đoạn 1000 khi chỉ có bản rút gọn (chỉ ghi chỉ mục), và đổi tên đoạn 2000 khi đã mở thân (ghi thân + chỉ mục).
  const stubA = K.stubOfRow((await s.loadIndex()).find((x) => x.id === 1000));
  await s.write(plan(K.diffSave(K.snapshot([stubA]), [{ ...stubA, title: "Tên mới", pinned: true }])));
  const b2 = { ...b, title: "Hai nghìn" };
  await s.write(plan(K.diffSave(K.snapshot([b]), [b2])));
  // Tab bản cũ (hoặc một phiên rơi về localStorage) thêm một chat mới 3000: khóa cũ đổi, đoạn 1000 / 2000 trong khóa cũ không đổi.
  st.setItem("u:R:chats", JSON.stringify([chat(3000), b, a]));
  r = await D.importLegacy(s, { now: t0 + DAY });
  let idx = await s.loadIndex();
  const i1 = idx.find((x) => x.id === 1000), i2 = idx.find((x) => x.id === 2000);
  ok(r.imported === 1 && idx.map((x) => x.id).join() === "3000,2000,1000", "chỉ nhập đúng dòng mới", [r, idx.map((x) => x.id)]);
  ok(i1.title === "Tên mới" && i1.pinned === true, "đổi tên + ghim chỉ mục ở app mới còn nguyên sau khi nhập lại", i1);
  ok(i2.title === "Hai nghìn" && JSON.parse((await s.bodies([2000])).get(2000)).title === "Hai nghìn", "đổi tên đoạn đã mở thân còn nguyên (thân lẫn chỉ mục)", i2);
  // Tab cũ thêm tin vào đoạn 1000 (tên cũ, không ghim): nhập tin mới, giữ tên / ghim đặt ở app mới.
  const a3 = { ...a, msgs: [...a.msgs, { role: "user", text: "tin ở tab cũ", time: 5000 }] };
  st.setItem("u:R:chats", JSON.stringify([chat(3000), b, a3]));
  r = await D.importLegacy(s, { now: t0 + 2 * DAY });
  idx = await s.loadIndex();
  const body1 = JSON.parse((await s.bodies([1000])).get(1000));
  ok(r.imported === 1 && body1.msgs.length === 3 && body1.title === "Tên mới" && body1.pinned === true && idx.find((x) => x.id === 1000).pinned, "tab cũ thêm tin: tin mới vào kho, tên / ghim của app mới giữ nguyên", [r, body1.title, body1.pinned]);
  // Tab cũ đổi tên đoạn 2000 (cùng mốc sửa): đó là sửa thật ở tab cũ, nhập.
  st.setItem("u:R:chats", JSON.stringify([chat(3000), { ...b, title: "Tên ở tab cũ" }, a3]));
  r = await D.importLegacy(s, { now: t0 + 3 * DAY });
  ok(r.imported === 1 && (await s.loadIndex()).find((x) => x.id === 2000).title === "Tên ở tab cũ", "tab cũ đổi tên (cùng mốc sửa): nhập", r);
  ok(Object.keys((await s.getMeta()).rows ?? {}).sort().join() === "1000,2000,3000", "ghi dấu từng dòng của lần nhập", (await s.getMeta()).rows);
}

console.log("13. Bản rút gọn của máy chủ giữ mốc sửa thật");
{
  const full = chat(3000, { msgs: [{ role: "user", text: "q", time: 9999 }] });
  let d = K.diffSave(K.snapshot([full]), [C.stubOf(full)]);
  ok(d.drop.join() === "3000" && d.idx.length === 1 && d.idx[0].upd === 9999 && d.idx[0].srv, "đoạn đầy đủ thành bản rút gọn của máy chủ: chỉ mục giữ mốc sửa 9999, không rơi về id", d);
  const srv1 = C.stubOf(full), srv2 = { ...srv1, title: "Đổi tên" };
  d = K.diffSave(K.snapshot([srv1]), [srv2]);
  ok(d.idx.length === 1 && d.idx[0].upd === 3000, "bản rút gọn không có mốc nào khác ngoài id: dùng id", d);
  const loc = K.stubOfRow(K.idxOf(full));
  d = K.diffSave(K.snapshot([loc]), [{ ...loc, title: "Tên mới" }]);
  ok(d.idx[0].upd === 9999, "bản rút gọn local đổi tên: giữ mốc sửa", d);

  const f = fakeIDB();
  const s = await D.openChatStore("U", { idb: f });
  await s.write({ put: [{ id: 3000, s: C.serialChat(full), idx: K.idxOf(full) }] });
  await s.write({ idx: [K.idxOf(srv1)], drop: [3000] });
  let i = (await s.loadIndex())[0];
  ok(i.upd === 9999 && i.srv && !(await s.bodies([3000])).size, "kho IndexedDB: dòng chỉ mục từ bản rút gọn (mốc = id) không làm lùi mốc sửa", i);
  await s.write({ idx: [{ ...K.idxOf(srv2), srv: undefined }] });
  i = (await s.loadIndex())[0];
  ok(i.title === "Đổi tên" && i.srv === true && i.upd === 9999, "chỉ ghi chỉ mục không bao giờ làm thân đã bỏ hiện lại (giữ srv)", i);

  // Khóa cũ có thân cũ của 3000; ở app mới 3000 có tin mới rồi bị rút gọn. Khóa cũ đổi chỗ khác: thân cũ không quay lại.
  const st = new Store();
  globalThis.localStorage = st;
  const old = chat(3000), other = chat(4000);
  st.setItem("u:V3:chats", JSON.stringify([other, old]));
  const v = await D.openChatStore("V3", { idb: fakeIDB() });
  await D.importLegacy(v, { now: 1 });
  const newer = { ...old, msgs: [...old.msgs, { role: "user", text: "mới", time: 9999 }] };
  await v.write({ put: [{ id: 3000, s: C.serialChat(newer), idx: K.idxOf(newer) }] });
  await v.write(plan(K.diffSave(K.snapshot([newer]), [C.stubOf(newer)])));
  st.setItem("u:V3:chats", JSON.stringify([{ ...other, title: "Bốn nghìn" }, old]));
  await D.importLegacy(v, { now: 2 });
  i = (await v.loadIndex()).find((x) => x.id === 3000);
  ok(i.srv && i.upd === 9999 && !(await v.bodies([3000])).size, "nhập lại khóa cũ: thân cũ hơn không đè bản rút gọn của máy chủ", i);

  // Kho localStorage: bỏ thân / ghi chỉ mục của bản rút gọn cũng không làm lùi mốc sửa.
  globalThis.localStorage = new Store();
  const ls = new D.LsStore("W3");
  await ls.write({ put: [{ id: 3000, s: C.serialChat(full), idx: K.idxOf(full) }] });
  await ls.write({ drop: [3000] });
  ok((await ls.loadIndex())[0].upd === 9999, "LsStore bỏ thân: giữ mốc sửa", await ls.loadIndex());
  await ls.write({ idx: [K.idxOf(srv2)] });
  ok((await ls.loadIndex())[0].upd === 9999 && (await ls.loadIndex())[0].title === "Đổi tên", "LsStore đổi tên bản rút gọn: giữ mốc sửa", await ls.loadIndex());
  ok(K.legacyRow({ ...srv1, upd: 9999 }).idx.upd === 9999 && K.legacyRow(srv1).idx.upd === 3000, "bản rút gọn trong khóa cũ có upd: dùng upd, không thì id");
}

// Đoạn đầy đủ thành bản rút gọn của máy chủ và đổi tên / ghim trong cùng một lần lưu: diffSave gửi cả chỉ mục lẫn bỏ thân cho cùng id.
for (const kind of ["idb", "ls"]) {
  globalThis.localStorage = new Store();
  const s = kind === "idb" ? await D.openChatStore("R3", { idb: fakeIDB() }) : new D.LsStore("R3");
  const sv = new D.ChatSaver(s);
  const c = chat(100);
  await sv.save([c]);
  const stub = { ...C.stubOf(c), title: "Renamed", pinned: true };
  const d = K.diffSave(K.snapshot([c]), [stub]);
  ok(d.drop.join() === "100" && d.idx.length === 1, `${kind}: lần lưu có cả chỉ mục lẫn bỏ thân cho cùng đoạn`, d);
  const r = await sv.save([stub]);
  const i = (await s.loadIndex()).find((x) => x.id === 100);
  ok(r.status === "ok" && i.title === "Renamed" && i.pinned === true && i.srv === true && i.upd === 102, `${kind}: đổi tên và ghim không bị lệnh bỏ thân đè`, i);
  ok(!(await s.bodies([100])).size, `${kind}: thân đã bỏ`);
  if (kind === "idb") ok(s.idx.get(100)?.title === "Renamed" && s.idx.get(100)?.pinned === true && s.idx.get(100)?.srv === true, "idb: bản sao chỉ mục trong bộ nhớ cũng giữ tên mới", s.idx.get(100));
  const all = await s.loadAll();
  ok(all.length === 1 && all[0].title === "Renamed" && all[0].pinned && all[0].stub, `${kind}: đọc lại là bản rút gọn mang tên mới`, all);
  // Chỉ bỏ thân (không có dòng chỉ mục) và bỏ thân một id không có trong kho: như trước.
  await sv.save([stub, chat(200)]);
  await s.write({ drop: [200, 999] });
  const j = await s.loadIndex();
  ok(j.find((x) => x.id === 200)?.srv === true && !j.some((x) => x.id === 999) && j.find((x) => x.id === 100).title === "Renamed", `${kind}: chỉ bỏ thân vẫn đúng, id lạ không tạo dòng`, j);
  s.close();
}

console.log("14. Phiên rơi về localStorage không tin khóa cũ đã chuyển sang IndexedDB");
{
  const st = new Store();
  globalThis.localStorage = st;
  const t0 = 1_700_000_000_000;
  st.setItem("u:M3:chats", JSON.stringify([chat(2), chat(1)]));
  D.resetIdbDown();
  const s = await D.openChatStore("M3", { idb: fakeIDB() });
  await D.importLegacy(s, { now: t0 });
  ok(K.parseMark(st.getItem("u:M3:chatsIdb"))?.at === t0 && st.getItem("u:M3:chats") !== null, "lần chuyển đầu ghi dấu đã chuyển, khóa cũ còn giữ 7 ngày", st.getItem("u:M3:chatsIdb"));
  // App mới: đổi tên 1, xóa 2, thêm 3 (chỉ vào IndexedDB).
  await s.write({ del: [2], put: [chat(3)].map((c) => ({ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) })), idx: [{ ...K.idxOf(chat(1)), title: "Một" }] });
  // Phiên sau mở IndexedDB quá thời gian: rơi về localStorage.
  let ls = new D.LsStore("M3");
  ok(!(await ls.loadIndex()).length && ls.ignored, "khóa cũ là bản trước khi chuyển: bắt đầu rỗng (không mang lại đoạn đã xóa, tên cũ; chatsync tải lại từ máy chủ)", await ls.loadIndex());
  ok(!(await ls.loadAll()).length, "đọc hết cũng rỗng");
  // Phiên này tải từ máy chủ / tạo đoạn mới rồi ghi: khóa thành bản của chính LsStore.
  const fromSrv = [chat(5), { ...chat(1), title: "Một" }, chat(3)];
  await ls.write(plan(K.diffSave(new Map(), fromSrv)));
  ok(K.parseMark(st.getItem("u:M3:chatsIdb")).ls === K.ownSigOf(st.getItem("u:M3:chats")), "LsStore ghi: đánh dấu khóa là bản tự ghi");
  ls = new D.LsStore("M3");
  ok((await ls.loadIndex()).map((x) => x.id).join() === "5,3,1" && !ls.ignored, "phiên rơi về localStorage kế tiếp (chưa mở lại IndexedDB): tin bản LsStore tự ghi", (await ls.loadIndex()).map((x) => x.id));
  // IndexedDB mở lại được: nhập những gì phiên localStorage đã ghi, rồi khóa lại thành bản cũ.
  let r = await D.importLegacy(s, { now: t0 + DAY });
  const idx = await s.loadIndex();
  // 5 là đoạn mới; 1 đổi tên "Một" so với lần nhập trước nên được nhập lại (cùng nội dung với kho); 3 cùng mốc, không có dấu trước: giữ kho.
  ok(r.imported === 2 && idx.map((x) => x.id).join() === "5,3,1" && idx.find((x) => x.id === 1).title === "Một" && JSON.parse((await s.bodies([1])).get(1)).title === "Một", "IndexedDB nhập đoạn mới của phiên localStorage, đoạn đã xóa không quay lại", [r, idx.map((x) => x.id)]);
  ok(K.parseMark(st.getItem("u:M3:chatsIdb")).ls === undefined, "đã nhập: khóa không còn là bản LsStore tự ghi");
  ls = new D.LsStore("M3");
  ok(!(await ls.loadIndex()).length && ls.ignored, "phiên rơi về localStorage sau đó: lại bắt đầu rỗng");
  // Bản app cũ ở tab khác ghi lại khóa cũ (bản cũ trong bộ nhớ của nó) sau khi đã chuyển: LsStore không tin.
  st.setItem("u:M3:chats", JSON.stringify([chat(2), chat(1)]));
  ls = new D.LsStore("M3");
  ok(!(await ls.loadIndex()).length, "khóa do bản app cũ ghi lại sau khi chuyển: không tin");
  // Chưa chuyển bao giờ (không có dấu): LsStore dùng khóa như trước đây.
  st.setItem("u:N3:chats", JSON.stringify([chat(7)]));
  ok((await new D.LsStore("N3").loadIndex()).length === 1, "chưa chuyển sang IndexedDB: dùng khóa như trước đây");
  // Mất dấu (xóa tay): lần mở IndexedDB sau ghi lại.
  st.removeItem("u:M3:chatsIdb");
  await D.importLegacy(s, { now: t0 + 2 * DAY });
  ok(K.parseMark(st.getItem("u:M3:chatsIdb"))?.at === t0, "mất dấu: ghi lại với mốc chuyển đầu", st.getItem("u:M3:chatsIdb"));
  // Hết 7 ngày, khóa cũ đã xóa: dấu vẫn còn, phiên localStorage sau đó vẫn không tin bản không phải tự ghi.
  r = await D.importLegacy(s, { now: t0 + 8 * DAY });
  ok(r.removed && st.getItem("u:M3:chats") === null && K.parseMark(st.getItem("u:M3:chatsIdb")), "đủ 7 ngày: xóa khóa cũ, giữ dấu đã chuyển", r);
  const x = () => "x";
  ok(K.trustLegacy(null, x) && K.trustLegacy({ at: 1, ls: "x" }, x) && !K.trustLegacy({ at: 1 }, x) && !K.trustLegacy({ at: 1, ls: "y" }, x) && !K.trustLegacy({ at: 1, ls: "x" }, () => null), "trustLegacy: chưa chuyển / bản tự ghi thì tin, còn lại không");
  let called = 0;
  K.trustLegacy(null, () => (called++, "x")); K.trustLegacy({ at: 1 }, () => (called++, "x"));
  ok(called === 0, "trustLegacy: không có dấu, hoặc dấu không có ls: không tính dấu của khóa");
  ok(K.parseMark("hỏng") === null && K.parseMark('{"at":"x"}') === null && K.parseMark(null) === null, "dấu hỏng: coi như chưa có");
  U.clearAccountData("M3");
  ok(st.getItem("u:M3:chatsIdb") === null, "đăng xuất kèm xóa thiết bị: xóa cả dấu đã chuyển");
  s.close();
}

console.log("15. Kho bị đóng: không ném ra ngoài ở chỗ không được ném, báo onclosed");
{
  const st = new Store();
  globalThis.localStorage = st;
  const h = fakeIDB();
  const s = await D.openChatStore("C1", { idb: h });
  await s.write({ put: [{ id: 1, s: C.serialChat(chat(1)), idx: K.idxOf(chat(1)) }] });
  const why = [];
  s.onclosed = (w) => why.push(w);
  h.deleteDatabase("synchro-chats:C1");
  ok(s.closed && why.join() === "versionchange", "tab khác xóa cơ sở dữ liệu: closed, onclosed('versionchange') một lần", why);
  const rejects = async (p) => { try { await p; return null; } catch (e) { return e?.name ?? "?"; } };
  ok((await rejects(s.loadIndex())) === "ClosedError" && (await rejects(s.bodies([1]))) === "ClosedError" && (await rejects(s.loadAll())) === "ClosedError" && (await rejects(s.clear())) === "ClosedError", "đọc / xóa trên kho đã đóng: từ chối với ClosedError (bên gọi phải bắt, không coi là kho rỗng)");
  ok((await s.write({ del: [1] })).status === "error" && JSON.stringify(await s.getMeta()) === "{}", "ghi / đọc dấu: không ném");
  st.setItem("u:C1:chats", JSON.stringify([chat(1)]));
  let threw = false, r;
  try { r = await D.importLegacy(s, { now: 1 }); } catch { threw = true; }
  ok(!threw && r.status === "error" && r.imported === 0 && st.getItem("u:C1:chats") !== null, "nhập khóa cũ vào kho đã đóng: trả status error, không ném, giữ khóa cũ", r);
  ok(why.length === 1, "onclosed chỉ gọi một lần", why);

  // Mất kết nối mà mở lại không được: đóng hẳn, báo onclosed('lost'), các lần ghi sau báo lỗi ngay (không chờ hết thời gian mở mỗi lần).
  const g = fakeIDB();
  const s2 = await D.openChatStore("C2", { idb: g, timeout: 200 });
  const why2 = [];
  s2.onclosed = (w) => why2.push(w);
  g.ctl.loseNext = 1; g.ctl.hangOpen = true;
  let t = Date.now();
  r = await s2.write({ put: [{ id: 1, s: C.serialChat(chat(1)), idx: K.idxOf(chat(1)) }] });
  ok(r.status === "error" && s2.closed && why2.join() === "lost", "mở lại không được: báo lỗi, closed, onclosed('lost')", [r, why2]);
  t = Date.now();
  r = await s2.write({ del: [1] });
  ok(r.status === "error" && Date.now() - t < 100, "lần ghi sau: báo lỗi ngay", Date.now() - t);
  // Trang tự đóng kho (đổi tài khoản): không gọi onclosed.
  const s3 = await D.openChatStore("C3", { idb: fakeIDB() });
  let called = false;
  s3.onclosed = () => { called = true; };
  s3.close();
  ok(s3.closed && !called, "trang tự đóng kho: closed nhưng không gọi onclosed");
  const l = new D.LsStore("C4");
  ok(l.closed === false && l.onclosed === null, "LsStore không bao giờ đóng");
}

console.log("16. Hai lần ghi chồng nhau không đè bản sao chỉ mục của nhau");
{
  const g = fakeIDB();
  const q = await D.openChatStore("P", { idb: g });
  const big = (id, t) => chat(id, { msgs: [{ role: "user", text: "z".repeat(3000), time: t }] });
  const w = (c) => ({ put: [{ id: c.id, s: C.serialChat(c), idx: K.idxOf(c) }] });
  // Không chờ lần ghi đầu xong đã ghi lần hai (lưu dồn khi đang chạy câu trả lời).
  const [r1, r2] = await Promise.all([q.write(w(big(10, 100))), q.write(w(big(20, 50)))]);
  ok(r1.status === "ok" && r2.status === "ok", "cả hai lần ghi xong");
  g.ctl.quota = 7_000;
  const r = await q.write(w(big(30, 300)), () => true);
  ok(r.status === "ok" && r.stubbed.join() === "20", "hết chỗ: chọn đúng đoạn cũ nhất (20) trong cả hai lần ghi trước (bản sao chỉ mục đủ cả hai)", r);
  const order = [];
  const a = q.write({ idx: [{ ...K.idxOf(big(10, 100)), title: "A" }] }).then(() => order.push("a"));
  const b = q.loadIndex().then((x) => order.push("b:" + x.find((y) => y.id === 10).title));
  await Promise.all([a, b]);
  ok(order.join() === "a,b:A", "ghi và đọc chỉ mục chạy lần lượt theo thứ tự gọi", order);
  // Bỏ thân của đoạn mà bản sao chỉ mục chưa biết (kho có, trang chưa đọc chỉ mục): vẫn đánh dấu srv đúng.
  const q2 = await D.openChatStore("P", { idb: g });
  ok((await q2.write({ drop: [10] })).status === "ok" && (await q2.loadIndex()).find((x) => x.id === 10).srv === true && !(await q2.bodies([10])).size, "bỏ thân đọc dòng chỉ mục ngay trong giao dịch, không dựa vào bản sao trong bộ nhớ");
  q.close(); q2.close();
}

console.log("17. Lưu từ trang (ChatSaver): xóa rõ ràng, xóa hết");
{
  const st = new Store();
  globalThis.localStorage = st;
  const s = await D.openChatStore("S", { idb: fakeIDB() });
  const sv = new D.ChatSaver(s);
  const a = chat(1), b = chat(2);
  let r = await sv.save([b, a]);
  ok(r.status === "ok" && (await s.loadIndex()).length === 2, "lưu lần đầu");
  // Xóa đoạn 2 (danh sách còn mục): xóa bình thường.
  await sv.save([a]);
  ok((await s.loadIndex()).map((x) => x.id).join() === "1", "xóa một đoạn khi còn đoạn khác");
  // Xóa đoạn cuối cùng: chatsync đã bỏ mục khỏi meta.gone (máy chủ xác nhận) trước lần lưu, nhưng ChatSaver tự nhớ lệnh xóa.
  sv.forget([1]);
  r = await sv.save([]);
  ok(r.status === "ok" && !(await s.loadIndex()).length && !(await s.bodies([1])).size, "xóa đoạn cuối cùng: kho trống dù danh sách rỗng", await s.loadIndex());
  // Danh sách rỗng mà không có lệnh xóa (trang chưa nạp xong): giữ kho, và lần sau vẫn so đúng với kho.
  await sv.save([a, b]);
  r = await sv.save([]);
  ok((await s.loadIndex()).length === 2, "danh sách rỗng không có lệnh xóa: không xóa gì");
  await sv.save([a]);
  ok((await s.loadIndex()).map((x) => x.id).join() === "1", "lần sau danh sách có lại: xóa đúng đoạn không còn (bản trước được giữ khi bị chặn)");
  // Xóa hết đoạn chat (Cài đặt): xóa kho và khóa cũ, không đoạn nào quay lại khi mở lại / nhập lại.
  st.setItem("u:S:chats", JSON.stringify([a, b]));
  await sv.wipe();
  ok(!(await s.loadIndex()).length && st.getItem("u:S:chats") === null, "xóa hết: kho trống, khóa cũ cũng xóa", st.getItem("u:S:chats"));
  r = await D.importLegacy(s, { now: 1 });
  ok(r.imported === 0 && !(await s.loadIndex()).length, "mở lại sau khi xóa hết: không có gì quay lại", r);
  r = await sv.save([]);
  ok(r.status === "ok" && !(await s.loadIndex()).length, "lưu danh sách rỗng sau khi xóa hết: không lỗi");
  await sv.save([chat(9)]);
  ok((await s.loadIndex()).map((x) => x.id).join() === "9", "đoạn mới sau khi xóa hết: lưu bình thường");
  // Ghi không được (hết chỗ): giữ bản trước, lần sau ghi lại đúng phần đổi.
  const g = fakeIDB();
  const q = await D.openChatStore("S2", { idb: g });
  const sq = new D.ChatSaver(q);
  await sq.save([chat(1)]);
  g.ctl.quota = 10;
  const c2 = chat(2);
  r = await sq.save([c2, chat(1)]);
  ok(r.status === "quota" && (await q.loadIndex()).length === 1, "hết chỗ: không ghi gì", r);
  g.ctl.quota = Infinity;
  r = await sq.save([c2, chat(1)]);
  ok(r.status === "ok" && (await q.loadIndex()).length === 2, "có chỗ lại: lần lưu sau ghi đoạn chưa ghi được", r);
  // Kho localStorage: wipe xóa khóa.
  const ls = new D.LsStore("S3");
  const sl = new D.ChatSaver(ls);
  await sl.save([chat(1)]);
  await sl.wipe();
  ok(st.getItem("u:S3:chats") === null, "LsStore: xóa hết xóa khóa");
}

console.log("18. Kho dự phòng không băm cả khóa mỗi lần đọc / ghi");
{
  const items = K.jsonItems('[{"a":"x,]}{y"},{"b":[1,{"c":2}]},{"d":"\\"",",}"}]');
  ok(items?.length === 3 && K.jsonItems("[]").length === 0 && K.jsonItems("{}") === null && K.jsonItems("") === null, "tách phần tử cấp ngoài cùng, bỏ qua dấu phẩy / ngoặc trong chuỗi", items);
  const st = new Store();
  globalThis.localStorage = st;
  const big = (id) => chat(id, { msgs: [{ role: "user", text: "x".repeat(5000) + id, time: id + 1 }] });
  const list = [5, 4, 3, 2, 1].map(big);
  st.setItem("u:H3:chats", JSON.stringify(list));
  // Chưa chuyển sang IndexedDB (không có dấu): đọc và ghi không băm gì.
  let h0 = K.hashStats.chars;
  let ls = new D.LsStore("H3");
  ok((await ls.loadIndex()).length === 5, "chưa chuyển: dùng khóa");
  const sv = new D.ChatSaver(ls);
  sv.base(await ls.loadAll());
  await sv.save([{ ...list[0], title: "Năm" }, ...list.slice(1)]);
  ok(K.hashStats.chars === h0 && st.getItem("u:H3:chatsIdb") === null, "chưa chuyển: đọc và ghi không băm khóa", K.hashStats.chars - h0);
  // Đã chuyển, chưa từng tự ghi (dấu không có ls): không tin mà cũng không băm.
  st.setItem("u:H3:chatsIdb", JSON.stringify({ at: 1 }));
  h0 = K.hashStats.chars;
  ls = new D.LsStore("H3");
  ok(!(await ls.loadIndex()).length && ls.ignored && K.hashStats.chars === h0, "dấu không có ls: bắt đầu rỗng, không băm khóa", K.hashStats.chars - h0);
  // Phiên này ghi lần đầu: băm từng mục một lần.
  const sv2 = new D.ChatSaver(ls);
  await sv2.save(list);
  const key = () => st.getItem("u:H3:chats");
  ok(K.parseMark(st.getItem("u:H3:chatsIdb")).ls === K.ownSigOf(key()), "ghi lần đầu: dấu tự ghi khớp khóa");
  // Lần ghi sau chỉ băm mục đã đổi, không băm lại cả khóa.
  const changed = { ...list[2], msgs: [...list[2].msgs, { role: "ai", text: "đáp", time: 9, done: true }] };
  h0 = K.hashStats.chars;
  await sv2.save([list[0], list[1], changed, list[3], list[4]]);
  const n = K.hashStats.chars - h0, one = C.serialChat(changed).length;
  ok(n === one && n < key().length / 4, "ghi sau: chỉ băm mục đã đổi", { n, one, total: key().length });
  ok(K.parseMark(st.getItem("u:H3:chatsIdb")).ls === K.ownSigOf(key()), "dấu tính từ băm từng mục trùng dấu tính lại từ cả khóa");
  ls = new D.LsStore("H3");
  ok((await ls.loadIndex()).length === 5 && !ls.ignored, "phiên sau tin bản tự ghi");
  // Tab app cũ sửa một chữ giữa khóa, độ dài không đổi: dấu đổi, không tin.
  const raw = key(), at = raw.indexOf("xxxx", raw.length / 2);
  st.setItem("u:H3:chats", raw.slice(0, at) + "y" + raw.slice(at + 1));
  ls = new D.LsStore("H3");
  ok(!(await ls.loadIndex()).length && ls.ignored, "sửa giữa khóa mà độ dài không đổi: không tin");
  // Hết chỗ (rút gọn bớt): dấu vẫn khớp chuỗi đã ghi.
  const small = new Store(16000);
  globalThis.localStorage = small;
  small.setItem("u:Q3:chatsIdb", JSON.stringify({ at: 1, ls: "cũ" }));
  const q = new D.LsStore("Q3");
  const r = await q.write(plan(K.diffSave(new Map(), list)), () => true);
  ok(r.status === "ok" && r.stubbed.length && K.parseMark(small.getItem("u:Q3:chatsIdb")).ls === K.ownSigOf(small.getItem("u:Q3:chats")), "hết chỗ, đã rút gọn: dấu tự ghi khớp chuỗi đã ghi", r);
  // Sau lần ghi đã rút gọn, các lần ghi sau (đổi tên) vẫn chỉ băm mục đã đổi, không băm lại cả khóa.
  const s2 = new Store(16000);
  globalThis.localStorage = s2;
  s2.setItem("u:Q4:chatsIdb", JSON.stringify({ at: 1 }));
  const q4 = new D.LsStore("Q4");
  const sv4 = new D.ChatSaver(q4);
  h0 = K.hashStats.chars;
  const r4 = await sv4.save(list, () => true);
  const n4 = K.hashStats.chars - h0, key4 = () => s2.getItem("u:Q4:chats");
  ok(n4 === key4().length - 2 - (list.length - 1), "lần ghi rút gọn đầu: mỗi phần tử đã ghi băm đúng một lần", { n4, total: key4().length });
  ok(r4.status === "ok" && r4.stubbed.length > 0 && K.parseMark(s2.getItem("u:Q4:chatsIdb")).ls === K.ownSigOf(key4()), "ChatSaver hết chỗ: rút gọn, dấu khớp", r4);
  const stubId = r4.stubbed[0], fullId = list.map((c) => c.id).find((id) => !r4.stubbed.includes(id));
  const items4 = () => { const k = key4(); return Object.fromEntries(K.jsonItems(k).map(([a, b]) => [JSON.parse(k.slice(a, b)).id, b - a])); };
  let cur = list;
  for (const [i, id] of [stubId, fullId, stubId].entries()) {
    cur = cur.map((c) => (c.id === id ? { ...c, title: `Tên ${i}` } : c));
    h0 = K.hashStats.chars;
    const rr = await sv4.save(cur, () => true);
    const n = K.hashStats.chars - h0, it = items4();
    ok(rr.status === "ok" && n === it[id] && n < key4().length / 2, `đổi tên lần ${i + 1} (${id === stubId ? "mục đã rút gọn" : "mục đủ thân"}) sau khi rút gọn: chỉ băm mục đã đổi`, { n, item: it[id], total: key4().length, rr });
    ok(K.parseMark(s2.getItem("u:Q4:chatsIdb")).ls === K.ownSigOf(key4()), `đổi tên lần ${i + 1}: dấu từ băm từng mục trùng dấu tính lại từ cả khóa`);
  }
  const q4b = new D.LsStore("Q4");
  ok((await q4b.loadIndex()).length === list.length && !q4b.ignored, "phiên sau tin bản tự ghi đã rút gọn");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
