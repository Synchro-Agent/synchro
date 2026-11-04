// Xóa đoạn chat: tên và tóm tắt của nó biến khỏi mọi ghi chú trong bộ não ngay lúc đó (nhật ký ngày, mục lục, trung tâm, bản đồ, hoạt động).
// Tự chạy được, không cần máy chủ: thư mục dữ liệu riêng cho lượt kiểm thử.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-brainforget-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "brain-forget-key";
process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { brain: B, authstore: AS } = await loadTs(["brain", "authstore"]);
const U = AS.createUser({ email: "f@brain.test", name: "F", verified: true }), d = AS.db();
B.ensureBase(U);

const SECRET = "bí mật thử nghiệm lamtung", DAY = new Date(2026, 9, 3, 10).getTime(), DAY2 = new Date(2026, 9, 4, 10).getTime();
let seq = 0;
const seed = (kind, title, props, body = "", conv = null) => d.prepare("INSERT INTO brain_notes (id, user_id, kind, title, tkey, conv, body, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .run(`bn_t${++seq}`, U.id, kind, title, B.fold(title), conv, body, JSON.stringify(props), DAY, DAY);
const chat = (title, conv, date, gist) => seed("chat", title, { date, gist, distilledAt: date, tasks: ["việc x"], topics: [], tags: ["chat"] }, `**Tóm tắt:** ${gist}`, conv);
const stale = (title) => d.prepare("UPDATE brain_notes SET body = ? WHERE user_id = ? AND title = ?").run(`- [[Chat kín]]: ${SECRET}`, U.id, title);
const leaks = () => B.allNotes(U.id).filter((n) => n.body.includes(SECRET) || n.body.includes("Chat kín") || JSON.stringify(n.props).includes(SECRET));

chat("Chat kín", "conv-only", DAY, SECRET);
chat("Chat khác", "conv-other", DAY2, "chuyện thường ngày");
chat("Chuyện thứ hai", "conv-two", DAY2, "mật thứ hai lamtung");
seed("topic", "Chủ đề kín", { desc: "", summary: SECRET, facts: [{ t: SECRET, src: "Chat kín", at: DAY }], up: "Bản đồ · Kín" }, `${SECRET}\n\nThuộc [[Bản đồ · Kín]].`);
seed("topic", "Chủ đề giữ", { desc: "giữ", summary: "giữ lại", facts: [{ t: "không liên quan", src: "Chat khác", at: DAY }], up: "Bản đồ · Kín" }, "giữ lại");
seed("map", "Bản đồ · Kín", { desc: "gom", auto: true }, `- [[Chủ đề kín]]: ${SECRET}\n- [[Chủ đề giữ]]: giữ lại`);
// Nhật ký ngày được dựng thật (setTask gọi lại phần dựng nhật ký).
B.setTask(U, "Chat kín", "việc x", false);
B.setTask(U, "Chuyện thứ hai", "việc x", false);
const day1 = B.dailyTitle(DAY), day2 = B.dailyTitle(DAY2);
ok(B.getNote(U.id, day1)?.body.includes(SECRET), "trước khi xóa: nhật ký ngày có tóm tắt của đoạn chat", B.getNote(U.id, day1)?.body);
stale(B.INDEX);
d.prepare("INSERT INTO brain_log (user_id, at, text) VALUES (?, ?, ?)").run(U.id, DAY, "Học từ [[Chat kín]]: cập nhật [[Chủ đề kín]]");

B.forgetConv(U.id, "conv-only");
ok(!B.getNote(U.id, day1), "đoạn chat duy nhất trong ngày: nhật ký ngày đó biến mất", B.getNote(U.id, day1)?.body);
ok(!B.getNote(U.id, B.INDEX).body.includes("Chat kín"), "mục lục không còn tên đoạn chat", B.getNote(U.id, B.INDEX).body);
ok(!B.getNote(U.id, B.HUB).body.includes("Chat kín"), "trung tâm không còn đoạn chat đã xóa");
ok(!B.getNote(U.id, "Bản đồ · Kín").body.includes(SECRET) && B.getNote(U.id, "Bản đồ · Kín").body.includes("Chủ đề giữ"), "bản đồ viết lại theo chủ đề còn lại", B.getNote(U.id, "Bản đồ · Kín").body);
ok(!B.getNote(U.id, "Chủ đề kín"), "chủ đề chỉ sinh từ đoạn chat đó được xóa theo");
ok(!B.getNote(U.id, B.LOG).body.includes("Chat kín"), "hoạt động bộ não không còn nhắc tên");
ok(!leaks().length, "tìm khắp ghi chú: không còn tên hay tóm tắt của đoạn chat đã xóa", JSON.stringify(leaks().map((n) => n.title)));
ok(B.runBrainTool(U.id, "brain_search", { query: "lamtung" }).content.includes("Chuyện thứ hai") && !/\[\[Chat kín\]\]/.test(B.runBrainTool(U.id, "brain_search", { query: "lamtung" }).content), "brain_search không còn tìm thấy đoạn chat đã xóa", B.runBrainTool(U.id, "brain_search", { query: "lamtung" }).content);

// Ngày còn đoạn chat khác: nhật ký viết lại, không xóa.
B.forgetConv(U.id, "conv-two");
const dn = B.getNote(U.id, day2);
ok(dn && dn.body.includes("Chat khác") && !dn.body.includes("Chuyện thứ hai") && !dn.body.includes("mật thứ hai"), "ngày còn đoạn chat khác: nhật ký chỉ bỏ dòng đã xóa", dn?.body);
ok(!B.allNotes(U.id).some((n) => n.body.includes("Chuyện thứ hai") || n.body.includes("mật thứ hai")), "xóa nốt: không còn dấu vết");

// Phần người dùng tự viết trong nhật ký được giữ.
chat("Chat có ghi chú", "conv-note", DAY, "tóm tắt sẽ biến mất");
B.setTask(U, "Chat có ghi chú", "việc x", false);
B.saveNote(U, day1, { userNote: "Điều mình tự ghi" });
B.forgetConv(U.id, "conv-note");
const kept = B.getNote(U.id, day1);
ok(kept?.body.includes("Điều mình tự ghi") && !kept.body.includes("tóm tắt sẽ biến mất") && !kept.body.includes("Chat có ghi chú"), "nhật ký có ghi chú của người dùng: giữ phần của họ, bỏ phần Synchro viết", kept?.body);

// Phần tổng quan của trung tâm nhắc thẳng tên: bỏ ngay; không nhắc: giữ tới lần tổng hợp lại.
chat("Chat tên riêng", "conv-hub", DAY, "chuyện riêng");
B.saveNote(U, B.HUB, { userNote: "" });
d.prepare("UPDATE brain_notes SET props = ? WHERE user_id = ? AND title = ?").run(JSON.stringify({ overview: "Họ vừa bàn Chat tên riêng hôm qua.", focus: ["x"], auto: true }), U.id, B.HUB);
B.forgetConv(U.id, "conv-hub");
ok(!B.brainCore(U.id).includes("Chat tên riêng"), "tổng quan nhắc tên đoạn chat đã xóa: bỏ ngay khỏi lời nhắc của model", B.brainCore(U.id));
const st = d.prepare("SELECT dirty, garden_at FROM brain_state WHERE user_id = ?").get(U.id);
ok(st.dirty >= 3 && st.garden_at === 0, "đánh dấu tổng hợp lại ở nhịp kế tiếp", JSON.stringify(st));

// Xóa ghi chú riêng: mục lục không còn dòng đầu của nó.
B.saveNote(U, "Ghi chú riêng", { newTitle: "Ghi chú riêng", body: "dòng đầu riêng tư của mình" });
B.saveNote(U, B.INDEX, { userNote: "" });
d.prepare("UPDATE brain_notes SET body = ? WHERE user_id = ? AND title = ?").run("- [[Ghi chú riêng]]: dòng đầu riêng tư của mình", U.id, B.INDEX);
B.deleteNote(U, "Ghi chú riêng");
ok(!B.getNote(U.id, B.INDEX).body.includes("riêng tư"), "xóa ghi chú: mục lục cập nhật ngay", B.getNote(U.id, B.INDEX).body);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
