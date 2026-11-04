// Lỗi của lượt chat: lỗi thô đổi thành câu đọc được; lượt lỗi không gửi lại cho model. Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { chaterror: E, history: H, "i18n-dict": D } = await loadTs(["chaterror", "history", "i18n-dict"]);

const spawn = E.chatError("spawn claude ENOENT");
ok(!/ENOENT/.test(spawn.text) && spawn.detail === "spawn claude ENOENT", "spawn ENOENT thành câu đọc được, lỗi thô để ở chi tiết", JSON.stringify(spawn));
ok(!/fetch failed/.test(E.chatError("fetch failed").text), "fetch failed thành câu mất kết nối");
ok(!/SIGKILL/.test(E.chatError("CLI killed by SIGKILL").text), "CLI bị dừng đột ngột");
ok(!/TypeError/.test(E.chatError("TypeError: x is not a function\n    at f (a.js:1:2)").text), "lỗi lập trình không hiện nguyên văn");
ok(E.chatError("").text === E.GENERIC_ERR && E.chatError(undefined).text === E.GENERIC_ERR, "không có lý do: câu chung");
const server = "Bạn chưa đăng nhập gói Claude. Đăng nhập ở Cài đặt → Providers.";
ok(E.chatError(server).text === server && E.chatError(server).act === "providers", "câu của máy chủ giữ nguyên, kèm nút mở Providers");
ok(E.chatError("Quá nhiều yêu cầu, thử lại sau.").act === undefined, "lỗi khác không có nút Providers");

const msgs = [
  { role: "user", text: "câu 1", time: 1 },
  { role: "ai", text: "", failed: true, err: "spawn claude ENOENT", done: true, time: 2 },
  { role: "user", text: "câu 2", time: 3 },
  { role: "ai", text: "viết dở", failed: true, err: "x", done: true, time: 4 },
  { role: "user", text: "câu 3", time: 5 },
  { role: "ai", text: "trả lời đầy đủ", done: true, time: 6 },
];
const h = H.chatHistory(msgs);
ok(h.length === 4 && h.every((m) => !String(m.content).includes("ENOENT") && !String(m.content).includes("viết dở")), "lượt lỗi không có trong lịch sử gửi model", JSON.stringify(h));
ok(h[h.length - 1].content === "trả lời đầy đủ", "câu trả lời thường vẫn gửi");

const has = (t) => Object.prototype.hasOwnProperty.call(D.VI2EN, t) || D.RULES_EN.some(([re]) => re.test(t));
for (const t of [spawn.text, E.chatError("fetch failed").text, E.chatError("SIGKILL").text, E.chatError("TypeError").text, E.GENERIC_ERR, "Câu trả lời chưa hoàn thành", "Khóa API bị từ chối (401): x"]) ok(has(t), `có bản tiếng Anh: ${t}`);

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
