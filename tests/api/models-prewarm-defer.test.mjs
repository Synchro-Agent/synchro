// GET /api/models: danh sách model được dựng xong trước, khởi động sẵn tiến trình chat (prewarmChat, có phần chạy đồng bộ) chỉ chạy ở
// setImmediate sau đó, không chen vào lúc trang đang chờ các yêu cầu khởi động. Kiểm tra trên mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const src = fs.readFileSync("app/api/models/route.ts", "utf8");
// A3: danh sách model dựng ở server/modelslist.ts (dùng chung với /api/bootstrap); khởi động sẵn là prewarmLater() ở đó.
const lib = fs.readFileSync("server/modelslist.ts", "utf8");

console.log("1. prewarmChat chạy sau khi đã có câu trả lời");
const resAt = src.indexOf("Response.json(await modelsFor("), callAt = src.indexOf("prewarmLater(c.user)");
ok(resAt > 0 && callAt > 0, "có câu trả lời và lời gọi prewarmLater", { resAt, callAt });
ok(callAt > resAt, "prewarmLater gọi sau khi dựng câu trả lời", { resAt, callAt });
const fn = lib.slice(lib.indexOf("export function prewarmLater"));
const immAt = fn.indexOf("setImmediate("), warmAt = fn.indexOf("prewarmChat(");
ok(immAt > 0 && warmAt > immAt, "prewarmChat nằm trong setImmediate", { immAt, warmAt });
ok(!/prewarmChat\(/.test(src) && !/prewarmChat\(/.test(lib.slice(0, lib.indexOf("export function prewarmLater"))), "không còn gọi prewarmChat trực tiếp trước khi trả lời");
ok(/searchParams\.get\("bg"\) !== "1"/.test(src.slice(resAt)), "lần hỏi lại nền (bg=1) vẫn không khởi động");
ok(/return res;\s*\}\)?;?\s*$/.test(src), "trả lại đúng câu trả lời đã dựng");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
