// Cảnh báo vận hành và báo cáo lạm dụng tới cả chủ sở hữu khi OWNER_EMAILS đặt riêng (không nằm trong ADMIN_EMAILS). Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-alert-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "alert-test";
process.env.ADMIN_EMAILS = "ops@synchro.test"; process.env.OWNER_EMAILS = "chu@synchro.test";
const { authstore: AU } = await loadTs(["authstore"]);
ok(AU.ALERT_EMAILS.includes("chu@synchro.test") && AU.ALERT_EMAILS.includes("ops@synchro.test"), "người nhận cảnh báo gồm chủ sở hữu và quản trị viên ở cấu hình", JSON.stringify(AU.ALERT_EMAILS));
for (const f of ["app/ops.ts", "app/sharestore.ts"]) {
  const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
  ok(/ALERT_EMAILS/.test(src) && !/\bADMIN_EMAILS\b/.test(src), `${f} gửi tới ALERT_EMAILS`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
