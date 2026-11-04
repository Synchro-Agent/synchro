// Bảo vệ đĩa chung: sàn đĩa trống từ chối tệp mới, tệp do code tạo có hạn mức theo tài khoản (mất tệp cũ nhất trước), dọn tệp quá hạn. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-disk-"));
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_OUTPUT_QUOTA_MB = "1";
process.env.SYNCHRO_MIN_FREE_MB = "1";
const { outputs: O, diskfloor: F, "fileproc/owners": W, authstore: A } = await loadTs(["outputs", "diskfloor", "fileproc/owners", "authstore"]);
const uid = "user-disk-1", MB = 1048576, file = (n, size) => ({ path: n, data: Buffer.alloc(size, 1) });

console.log("1. Sàn đĩa");
ok(F.freeMB(tmp) > 1, "đọc được số MB trống", F.freeMB(tmp));
ok(F.freeMB("/khong/co/duong/dan") === null && !F.diskLow("/khong/co/duong/dan"), "không đọc được thì không chặn");
ok(!F.diskLow(tmp), "còn nhiều chỗ: không chặn");
process.env.SYNCHRO_MIN_FREE_MB = String(F.freeMB(tmp) + 100000);
ok(F.diskLow(tmp), "dưới sàn: báo đĩa thấp");
let code = 0; try { W.checkQuota(uid, 10); } catch (e) { code = e.status; }
ok(code === 507, "tải tệp lên bị từ chối bằng 507", code);
ok(O.outputsFull() && O.saveOutputs(uid, [file("a.txt", 10)]).length === 0, "tệp do code tạo không được lưu");
process.env.SYNCHRO_MIN_FREE_MB = "1";

console.log("2. Hạn mức tệp do code tạo: chỉ từ chối tệp mới, không xóa tệp cũ");
const a = O.saveOutputs(uid, [file("a.bin", 0.6 * MB)]);
ok(O.outputRoom(uid) <= 0.41 * MB && O.outputRoom(uid) >= 0.39 * MB, "còn đúng phần dư", O.outputRoom(uid));
const b = O.saveOutputs(uid, [file("b.bin", 0.6 * MB)]);
ok(O.outputRoom(uid) === 0, "vượt hạn mức: hết chỗ", O.outputRoom(uid));
ok(O.outputFile(uid, a[0].id) && O.outputFile(uid, b[0].id), "tệp cũ còn nguyên");
ok(O.outputRoom("user-disk-2") === MB, "tài khoản khác không bị ảnh hưởng", O.outputRoom("user-disk-2"));

console.log("3. Dọn tệp quá hạn");
const old = O.saveOutputs("user-disk-3", [file("old.bin", 10)]);
A.db().prepare("UPDATE outputs SET created_at = ? WHERE id = ?").run(Date.now() - 31 * 86_400_000, old[0].id);
O.sweepOutputs();
ok(!fs.existsSync(path.join(tmp, "outputs", "user-disk-3", old[0].id)), "tệp quá 30 ngày được dọn khỏi đĩa");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
if (fail) process.exit(1);
