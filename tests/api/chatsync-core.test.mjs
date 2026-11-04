// Lõi đồng bộ đoạn chat (hàm thuần, không cần máy chủ): nhận biết mục cần đẩy, mới nhất thắng, chia đợt, rút gọn khi trình duyệt hết chỗ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { chatsynccore: C } = await loadTs(["chatsynccore"]);

console.log("1. Bản lưu ổn định: đọc rồi ghi lại không đổi dấu nội dung");
const chat = { id: 1700000000000, title: "A", msgs: [{ role: "user", text: "chào", time: 5 }, { role: "ai", text: "x", time: 9, prog: "đang viết", run: "r1", done: false }], pinned: undefined };
const s1 = C.serialChat(chat), s2 = C.serialChat(JSON.parse(s1));
ok(s1 === s2 && C.hashOf(s1) === C.hashOf(s2), "serial → parse → serial giữ nguyên", `${s1}\n${s2}`);
ok(!s1.includes("đang viết") && JSON.parse(s1).msgs[1].done === true && JSON.parse(s1).msgs[1].run === "r1", "bỏ dòng tiến độ, coi là xong, giữ mã lượt chạy");
ok(C.hashOf("a") !== C.hashOf("b") && C.hashOf("ab") !== C.hashOf("ba"), "nội dung khác có dấu khác");
ok(C.lastTime({ id: 3, msgs: [{ time: 5 }, { time: 9 }] }) === 9 && C.lastTime({ id: 3, msgs: [] }) === 3, "mốc sửa suy ra từ tin mới nhất, không phải giờ hiện tại");

console.log("2. Chuyển dần: mục chưa từng lên máy chủ thì đẩy, bản trùng thì thôi");
const m = C.emptyMeta();
ok(C.startupDirty(m, "chat:1", "h", 7) === 7, "chưa biết → chờ đẩy với mốc của nội dung");
m.known["chat:1"] = [10, "h"];
ok(C.startupDirty(m, "chat:1", "h", 7) === null, "đã xác nhận, nội dung không đổi → không đẩy");
ok(C.startupDirty(m, "chat:1", "h2", 7) === 11, "nội dung khác bản đã xác nhận (trang đóng trước khi đẩy) → đẩy, mốc lớn hơn bản đã biết");
m.dirty["chat:1"] = 20;
ok(C.startupDirty(m, "chat:1", "h2", 7) === 20, "đang chờ đẩy thì giữ mốc đã ghi");
ok(C.startupDirty(m, "chat:1", "h", 7) === null, "đang chờ nhưng nội dung đã trùng bản máy chủ → thôi");
ok(C.parseMeta("rác").cur === 0 && C.parseMeta(null).cur === 0 && C.parseMeta('{"cur":5,"known":{}}').cur === 5, "dữ liệu theo dõi hỏng thì làm lại từ đầu, không lỗi");

console.log("3. Theo từng mục, bản mới nhất thắng");
const d = { ...C.emptyMeta(), dirty: { "chat:1": 100 } };
ok(C.decideRemote(d, "chat:1", 90, false) === "keep", "bản ở đây mới hơn → giữ");
ok(C.decideRemote(d, "chat:1", 110, false) === "apply", "bản máy chủ mới hơn → nhận");
ok(C.decideRemote(d, "chat:2", 1, false) === "apply", "không sửa gì ở đây → nhận");
ok(C.decideRemote(d, "chat:2", 1e15, true) === "keep", "đang trả lời ở máy này → không đè");
ok(C.losesUserMsgs({ msgs: [{ role: "user", text: "tin riêng", time: 3 }] }, { msgs: [{ role: "user", text: "khác", time: 4 }] }), "bản thua có tin người dùng bên kia chưa có → phải giữ");
ok(!C.losesUserMsgs({ msgs: [{ role: "user", text: "a", time: 4 }, { role: "ai", text: "x", time: 5 }] }, { msgs: [{ role: "user", text: "a", time: 4 }, { role: "ai", text: "y", time: 6 }] }), "chỉ khác câu trả lời → không cần bản sao");

console.log("4. Chia đợt");
const part = (k, size) => ({ key: k, kind: "chat", id: k, upd: 1, size });
const b = C.batches([part("a", 60), part("b", 60), part("c", 300), part("d", 1)], 100);
ok(b.length === 4 || b.map((x) => x.map((p) => p.key).join("")).join("|") === "a|b|c|d", "không đợt nào vượt ngưỡng, mục lớn đi riêng", JSON.stringify(b));
ok(C.batches([], 10).length === 0, "không có gì thì không gửi");

console.log("5. Trình duyệt hết chỗ");
const rows = [{ key: "chat:1", full: "x".repeat(50), stub: "s1", time: 1 }, { key: "chat:2", full: "y".repeat(50), stub: "s2", time: 2 }, { key: "chat:3", full: "z".repeat(50), stub: null, time: 3 }];
let last = "";
const quota = (n) => (j) => { if (j.length > n) return false; last = j; return true; };
let r = C.saveFit(rows, new Set(), quota(1000));
ok(r.ok && r.stubbed.size === 0 && last.includes("xxx"), "đủ chỗ thì giữ nguyên, không rút gọn");
r = C.saveFit(rows, new Set(), quota(120));
ok(r.ok && r.stubbed.has("chat:1") && last.includes("zzz") && last.includes("s1"), "hết chỗ: rút gọn mục cũ nhất đã có trên máy chủ", last);
ok(!r.stubbed.has("chat:3"), "mục chưa lên máy chủ không bao giờ bị rút gọn");
r = C.saveFit(rows, new Set(), quota(10));
ok(!r.ok, "rút gọn hết vẫn không đủ → báo không ghi được");
r = C.saveFit(rows.map((x) => (x.key === "chat:1" ? { ...x, stub: null } : x)), new Set(["chat:1"]), quota(1000));
ok(r.ok && !r.stubbed.has("chat:1"), "mục vừa sửa (chưa lên máy chủ) không còn bị rút gọn");
const st = C.stubOf({ id: 1, title: "t", msgs: [{}], pins: [1], pinned: true, project: 2 });
ok(st.msgs.length === 0 && st.stub && st.title === "t" && st.pinned && st.project === 2 && !st.pins, "bản rút gọn còn đủ để hiện ở thanh bên");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
