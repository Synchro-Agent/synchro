// Nạp / lưu đoạn chat của trang qua kho IndexedDB (app/chatload.ts, blueprint B4 bước 5-6), phần không cần trình duyệt, trên IndexedDB giả:
// chỉ đọc thân đoạn cần ngay, đọc dần phần còn lại, thân vừa đọc không ghi lại, sửa bản rút gọn trong lúc chờ được giữ, nhật ký lúc rời trang,
// xóa đoạn chat (kể cả đoạn cuối cùng), kho bị xóa từ tab khác / lỗi đọc lúc mở thì dùng localStorage, thân mất thì nhờ chatsync lấy về.
// Tự chạy được, không cần dev:mock.
import { fakeIDB } from "../lib/fakeidb.mjs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

class Store {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new Store();
let f = fakeIDB();
globalThis.indexedDB = f;

const { chatload: L, chatidb: D, userscope: U, "chatstore.client": S, chatsynccore: C } = await loadTs(["chatload", "chatidb", "userscope", "chatstore.client", "chatsynccore"]);
const st = () => S.useChatStore.getState();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const msg = (role, text, time, extra = {}) => ({ role, text, time, done: true, ...extra });
const chat = (id, o = {}) => ({ id, title: `Chat ${id}`, msgs: [msg("user", `hỏi ${id}`, id), msg("ai", `đáp ${id}`, id + 1)], ...o });
const db = "synchro-chats:A";
const puts = () => ({ ...f.ctl.puts });
// Như home.tsx startChats: nạp rồi đặt vào kho trang.
const boot = async (uid = "A", want = []) => { U.setUserScope(uid); const list = await L.loadChats(uid, want); if (list) st().setChats(list); return list; };

console.log("1. Lần mở đầu: nhập khóa cũ, chỉ đọc thân đoạn cần ngay");
{
  const list = [chat(50), chat(40), chat(30, { msgs: [msg("user", "chạy dở", 30), { role: "ai", text: "", time: 31, run: "r1" }] }), chat(20), chat(10)];
  localStorage.setItem("u:A:chats", JSON.stringify(list));
  localStorage.setItem("u:A:chatSync", JSON.stringify({ cur: 0, known: {}, dirty: { "chat:20": 5 }, gone: {} }));
  const got = await boot("A", [40]);
  ok(got.length === 5 && got.map((c) => c.id).join() === "50,40,30,20,10", "đủ 5 đoạn, mới nhất trước", got?.map((c) => c.id));
  const full = got.filter((c) => !c.stub).map((c) => c.id).sort().join();
  ok(full === "20,30,40", "có thân ngay: #c= (40), lượt chạy dở (30), chưa lên máy chủ (20)", full);
  ok(got.filter((c) => c.stub).every((c) => c.local && c.msgs.length === 0 && typeof c.upd === "number"), "còn lại: bản rút gọn local (thanh bên hiện ngay)");
  ok(got.filter((c) => !c.stub).every((c) => L.localBodies.has(c) && L.bodyStr.get(c) === C.serialChat(c)), "thân vừa đọc: đánh dấu đọc từ kho, giữ đúng chuỗi đã lưu");
  ok(!("local" in got[1]) && !("upd" in got[1]), "thân không mang trường của chỉ mục (dấu nội dung không đổi)", got[1]);
  ok(L.useChatLoad.getState().kind === "idb" && !L.useChatLoad.getState().ready && L.useChatLoad.getState().imported === 5, "kho IndexedDB, nhập 5 đoạn, thân chưa đọc hết", L.useChatLoad.getState());
}

console.log("2. Đọc dần phần còn lại; thân vừa đọc không ghi lại; sửa bản rút gọn trong lúc chờ được giữ");
{
  // Người dùng ghim đoạn 10 (bản rút gọn) trước khi thân về.
  st().togglePin(10);
  const pinnedStub = st().chats.find((c) => c.id === 10);
  await L.hydrateAll(true);
  const cs = st().chats;
  ok(cs.every((c) => !c.stub), "đọc xong: không còn bản rút gọn");
  ok(L.useChatLoad.getState().ready, "ready = true");
  const c10 = cs.find((c) => c.id === 10), c50 = cs.find((c) => c.id === 50);
  ok(c10.pinned === true && c10.msgs.length === 2 && !L.localBodies.has(c10) && !("local" in c10) && !("upd" in c10), "đoạn đã ghim lúc còn rút gọn: thân + dấu ghim, coi là đã sửa", c10);
  ok(L.localBodies.has(c50) && c50 !== pinnedStub, "đoạn không sửa: thân thay thẳng (đọc từ kho)");
  const p0 = puts();
  const r = await L.saveChats(st().chats);
  const p1 = puts();
  ok(r?.status === "ok" && (p1.body ?? 0) - (p0.body ?? 0) === 1, "lưu sau khi đọc hết thân: chỉ ghi 1 thân (đoạn đã ghim), không ghi lại 4 thân vừa đọc", { p0, p1 });
  ok(f.dump(db, "idx").find((x) => x.id === 10)?.pinned === true, "dấu ghim vào chỉ mục");
}

console.log("3. Chỉ ghi phần đổi; lần lưu chạy lần lượt, lần chờ chỉ giữ danh sách mới nhất");
{
  const p0 = puts();
  st().patchChat(50, { title: "Đổi tên 50" });
  const a = L.saveChats(st().chats);
  st().patchChat(40, { title: "Đổi tên 40" });
  const b = L.saveChats(st().chats);
  st().patchChat(20, { title: "Đổi tên 20" });
  const c = L.saveChats(st().chats);
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  const p1 = puts();
  ok(ra.status === "ok" && rb === rc, "lần chờ gộp: hai lần gọi sau nhận cùng một kết quả");
  ok((p1.body ?? 0) - (p0.body ?? 0) === 3, "3 đoạn đổi = 3 thân", { p0, p1 });
  ok(["Đổi tên 50", "Đổi tên 40", "Đổi tên 20"].every((t) => f.dump(db, "idx").some((x) => x.title === t)), "cả ba tên mới trong chỉ mục");
}

console.log("4. Nhật ký lúc rời trang: sửa chưa kịp lưu vẫn còn sau khi mở lại");
{
  st().patch(50, (ms) => [...ms, msg("user", "tin mới chưa lưu", 999)]);
  L.writeJournal();
  ok(localStorage.getItem("u:A:chatJournal")?.includes("tin mới chưa lưu"), "nhật ký có đoạn chưa lưu");
  ok(!localStorage.getItem("u:A:chatJournal")?.includes("đáp 40"), "nhật ký không có đoạn đã lưu");
  // Trang bị đóng ngay (giao dịch không kịp chạy): đóng kho không chờ.
  await L.closeChats(true);
  st().reset();
  const got = await boot("A");
  await L.hydrateIds([50]);
  ok(got.find((c) => c.id === 50)?.upd === 999 && st().chats.find((c) => c.id === 50 && !c.stub)?.msgs.some((m) => m.text === "tin mới chưa lưu"), "mở lại: tin mới còn (áp nhật ký vào kho)", st().chats.find((c) => c.id === 50));
  ok(localStorage.getItem("u:A:chatJournal") === null, "nhật ký đã xóa sau khi áp");
  // Nhật ký cũ hơn bản trong kho (tab khác đã lưu bản mới hơn): không đè.
  localStorage.setItem("u:A:chatJournal", JSON.stringify({ put: [C.serialChat(chat(40, { title: "bản cũ", msgs: [msg("user", "cũ", 40)] }))], del: [] }));
  await L.closeChats(true);
  st().reset();
  const got2 = await boot("A");
  ok(got2.find((c) => c.id === 40)?.title === "Đổi tên 40", "nhật ký cũ hơn kho: giữ bản trong kho", got2.find((c) => c.id === 40)?.title);
  // Ẩn tab rồi quay lại: lần lưu sau nhật ký xóa nhật ký (không áp bản cũ đè lên sửa sau đó).
  await L.hydrateAll(true);
  st().patchChat(30, { title: "trước khi ẩn" });
  L.writeJournal();
  await L.saveChats(st().chats);
  ok(localStorage.getItem("u:A:chatJournal") === null, "lưu xong sau khi ghi nhật ký: nhật ký bị xóa");
}

console.log("5. Xóa đoạn chat, kể cả đoạn cuối cùng (danh sách rỗng)");
{
  const ids = st().chats.map((c) => c.id);
  L.forgetChats([ids[0]]);
  st().removeChats([ids[0]]);
  await L.saveChats(st().chats);
  ok(!f.dump(db, "idx").some((x) => x.id === ids[0]), "xóa một đoạn: khỏi kho");
  const rest = st().chats.map((c) => c.id);
  st().setChats([]);
  await L.saveChats([]);
  ok(f.dump(db, "idx").length === rest.length, "danh sách rỗng mà không ai xóa: không suy ra là xóa hết", f.dump(db, "idx").length);
  L.forgetChats(rest);
  await L.saveChats([]);
  ok(f.dump(db, "idx").length === 0 && f.dump(db, "body").length === 0, "xóa rõ ràng hết: kho rỗng");
}

console.log("6. Thân mất (đoạn chỉ còn chỉ mục): thành bản rút gọn của máy chủ, nhờ chatsync lấy về");
{
  const list = [chat(300), chat(200), chat(100)];
  await L.saveChats(list);
  await L.closeChats();
  // Tab khác xóa thân của 200 (giả lập): xóa thẳng trong cơ sở dữ liệu giả.
  const conn = await new Promise((r) => { const q = f.open(db, 1); q.onsuccess = () => r(q.result); });
  await new Promise((r) => { const t = conn.transaction(["body"], "readwrite"); t.objectStore("body").delete(200); t.oncomplete = r; });
  conn.close();
  st().reset();
  await boot("A");
  const need = [];
  const off = L.onNeedChats((ids) => need.push(...ids));
  await L.hydrateAll(true);
  const c200 = st().chats.find((c) => c.id === 200);
  ok(c200?.stub && !c200.local && need.includes(200), "bản rút gọn của máy chủ + chatsync được báo lấy về", { c200, need });
  off();
}

console.log("7. Kho bị xóa từ tab khác (đăng xuất kèm xóa thiết bị): dùng localStorage cho phần còn lại của phiên");
{
  await L.closeChats(true);
  st().reset();
  await boot("A");
  const need = [];
  const off = L.onNeedChats((ids) => need.push(...ids));
  const stubs = st().chats.filter((c) => c.stub && c.local).map((c) => c.id);
  f.deleteDatabase(db);
  await tick(5);
  ok(L.useChatLoad.getState().kind === "ls", "chuyển sang localStorage", L.useChatLoad.getState());
  ok(st().chats.every((c) => !c.local) && stubs.every((id) => need.includes(id)), "bản rút gọn local thành bản rút gọn của máy chủ, chatsync lấy về", { stubs, need });
  ok(!f.has(db), "không dựng lại cơ sở dữ liệu vừa bị xóa");
  st().setChats((cs) => [chat(400, { title: "sửa sau khi kho bị xóa" }), ...cs]);
  await L.saveChats(st().chats);
  ok((localStorage.getItem("u:A:chats") ?? "").includes("sửa sau khi kho bị xóa"), "sửa sau đó lưu vào localStorage");
  off();
}

console.log("8. Lỗi đọc lúc mở trang không phải kho rỗng: dùng localStorage, không lưu danh sách rỗng đè kho");
{
  await L.closeChats(true);
  D.resetIdbDown();
  f = fakeIDB(); globalThis.indexedDB = f;
  localStorage.removeItem("u:B:chats");
  U.setUserScope("B");
  await L.loadChats("B");
  await L.saveChats([chat(7), chat(8)]);
  await L.closeChats();
  // Đọc chỉ mục lỗi (mất kết nối liên tục).
  f.ctl.loseNext = 1000;
  st().reset();
  const got = await boot("B");
  ok(L.useChatLoad.getState().kind === "ls" && Array.isArray(got), "lỗi đọc: kho dự phòng localStorage", L.useChatLoad.getState());
  f.ctl.loseNext = 0;
  await L.closeChats();
  D.resetIdbDown();
  st().reset();
  const again = await boot("B");
  ok(again.length === 2 && L.useChatLoad.getState().kind === "idb", "lần mở sau: kho IndexedDB vẫn đủ 2 đoạn", again?.length);
}

console.log("9. Đổi tài khoản giữa lúc đang nạp: bỏ kết quả của tài khoản cũ; lần lưu của tài khoản cũ xong trước khi đóng kho");
{
  await L.closeChats();
  st().reset();
  U.setUserScope("B");
  const p = L.loadChats("B");
  U.setUserScope("C");
  const q = L.loadChats("C");
  ok((await p) === null, "lần nạp của tài khoản cũ trả null");
  ok(Array.isArray(await q), "lần nạp của tài khoản mới xong");
  st().setChats([chat(77)]);
  const saving = L.saveChats([chat(77)]);
  U.setUserScope("D");
  const r = L.loadChats("D");
  await saving; await r;
  ok(f.dump("synchro-chats:C", "idx").some((x) => x.id === 77), "lần lưu của tài khoản C xong dù đã chuyển sang D");
  ok(L.saveChats.length >= 1 && (await L.saveChats([chat(1)])) !== null, "lưu theo tài khoản đang mở (D)");
  await L.wipeChats();
  ok(f.dump("synchro-chats:D", "idx").length === 0, "wipe: xóa hết đoạn chat của tài khoản trên thiết bị");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
