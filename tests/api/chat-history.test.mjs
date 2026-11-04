// Lịch sử gửi cho model sau lượt lỗi: lời báo lỗi không phải câu trả lời của model, phần đã viết được đánh dấu chưa xong, tệp đính kèm giữ khi thử lại.
// Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { history: H } = await loadTs(["history"]);

const msgs = [
  { role: "user", text: "Tóm tắt file này", files: ["a.pdf"], fids: { "a.pdf": "f1" }, time: 1 },
  { role: "ai", text: "Gói Claude của bạn đã hết hạn mức.", done: true, time: 2, notice: { failed: true } },
  { role: "user", text: "tiếp", time: 3 },
  { role: "ai", text: "Phần đã viết", done: true, time: 4, notice: { text: "Gói hết hạn mức", partial: true }, trace: [{ id: "1", name: "run_code", label: "x", input: "", status: "ok", summary: "xong" }] },
  { role: "user", text: "", files: ["b.png"], time: 5 },
];
const h = H.chatHistory(msgs);
ok(h.length === 4 && !h.some((m) => /đã hết hạn mức/.test(JSON.stringify(m.content))), "lời báo lỗi không gửi lại cho model", JSON.stringify(h));
ok(Array.isArray(h[0].content) && h[0].content.some((b) => b.type === "file_ref" && b.id === "f1"), "tin có tệp vẫn kèm tệp khi dựng lại lịch sử (thử lại không mất tệp)", JSON.stringify(h[0]));
ok(h[2].trace.length === 2 && h[2].trace[0].name === "run_code" && /ngắt giữa chừng/.test(h[2].trace[1].summary), "phần đã viết: giữ dấu vết công cụ, ghi rõ chưa xong", JSON.stringify(h[2]));
ok(h[3].content === "Hãy xem các tệp đính kèm.", "tin chỉ có tệp (tệp không còn mã trên máy chủ): không gửi tin trống", JSON.stringify(h[3]));
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
