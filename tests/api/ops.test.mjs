// Sổ vận hành: làm sạch dòng lỗi, luật cảnh báo. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { opsredact: R } = await loadTs(["opsredact"]);
const r = (s) => R.redact(s);
ok(!/@/.test(r("lỗi với ai@example.com khi gửi")), "bỏ email", r("lỗi với ai@example.com khi gửi"));
ok(!/abc123/.test(r("GET https://x.test/a?token=abc123#c=9")) && /x\.test\/a/.test(r("GET https://x.test/a?token=abc123#c=9")), "bỏ tham số trên địa chỉ, giữ đường dẫn", r("GET https://x.test/a?token=abc123#c=9"));
ok(!/sekret/.test(r('password: "sekret" thất bại')), "bỏ mật khẩu", r('password: "sekret" thất bại'));
ok(!/sk-ant/.test(r("key sk-ant-abcdefghijklmnop123")), "bỏ khóa API", r("key sk-ant-abcdefghijklmnop123"));
ok(!/eyJhbGci/.test(r("Authorization eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIi.abc")), "bỏ JWT");
ok(!/[a-f0-9]{40}/.test(r(`cookie ${"a1b2".repeat(10)}`)), "bỏ chuỗi dài như token");
ok(R.redact("x".repeat(5000)).length <= 400, "cắt ngắn");
ok(/TypeError: Cannot read properties of undefined \(reading 'id'\)/.test(r("TypeError: Cannot read properties of undefined (reading 'id')")), "lỗi thường vẫn đọc được");

// Luật cảnh báo chạy với authstore thật nên chỉ đọc bằng kiểm tra tĩnh phần ngưỡng ở đây; đường chạy thật có ở /api/admin khi tích hợp.
import { readFileSync } from "node:fs";
const src = readFileSync("app/ops.ts", "utf8");
ok(/BACKUP_MAX_AGE_H = 26/.test(src), "sao lưu quá 26 giờ thì báo");
ok(!/user_id|uid/.test(src), "sổ vận hành không lưu mã người dùng");
ok(/touch "\$DATA\/\.backup-ok"/.test(readFileSync("scripts/backup.sh", "utf8")), "backup.sh để lại dấu web đọc được");
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
