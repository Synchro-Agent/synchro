// GET /api/models: danh sách model được dựng xong trước, khởi động sẵn tiến trình chat (prewarmChat, có phần chạy đồng bộ) chỉ chạy ở
// setImmediate sau đó, không chen vào lúc trang đang chờ các yêu cầu khởi động. Kiểm tra trên mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const src = fs.readFileSync("app/api/models/route.ts", "utf8");

console.log("1. prewarmChat chạy sau khi đã có câu trả lời");
const resAt = src.indexOf("Response.json({ providers"), warmAt = src.indexOf("prewarmChat("), immAt = src.indexOf("setImmediate(");
ok(resAt > 0 && warmAt > 0, "có câu trả lời và lời gọi prewarmChat");
ok(immAt > resAt && warmAt > immAt, "prewarmChat nằm trong setImmediate, sau khi dựng câu trả lời", { resAt, immAt, warmAt });
ok(!/\n\s*if \([^\n]*\) void import\("\.\.\/\.\.\/chatengine"\)\.then\(\(m\) => m\.prewarmChat/.test(src.slice(0, resAt)), "không còn gọi prewarmChat trước khi trả lời");
ok(/searchParams\.get\("bg"\) !== "1"/.test(src.slice(resAt)), "lần hỏi lại nền (bg=1) vẫn không khởi động");
// Route bọc trong timed(...): đuôi là "return res;\n});" — nhận cả hai dạng (có hoặc không có lớp bọc).
ok(/return res;\s*\}\)?;?\s*$/.test(src), "trả lại đúng câu trả lời đã dựng");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
