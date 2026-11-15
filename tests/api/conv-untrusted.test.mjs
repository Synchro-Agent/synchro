// D6: đọc skill của danh mục (chưa kiểm chứng) một lần thì cả cuộc trò chuyện giữ hạ quyền (thao tác ghi connector, browser_* trên Chrome của
// người dùng → hỏi), không chỉ lượt đã đọc. Dấu lưu theo (tài khoản, cuộc trò chuyện) ở máy chủ. Không cần máy chủ Synchro.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { readChatEngine } from "../lib/srcroots.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-convtrust-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "convtrust-test";
const { convtrust: CT, authstore: AU } = await loadTs(["convtrust", "authstore"]);
const mk = (n) => AU.createUser({ email: `ct${n}${Date.now()}@synchro.test`, name: "C", verified: true });
const a = mk(1), b = mk(2);

console.log("1. Chưa đọc skill danh mục: lượt bắt đầu bình thường");
ok(!CT.convUntrusted(a.id, "conv-1"), "cuộc trò chuyện mới không bị hạ quyền");

console.log("2. Đọc skill danh mục ở lượt 1 → lượt sau của cùng cuộc trò chuyện vẫn hạ quyền");
CT.markConvUntrusted(a.id, "conv-1");
CT.markConvUntrusted(a.id, "conv-1"); // gọi lại không lỗi
ok(CT.convUntrusted(a.id, "conv-1"), "lượt sau đọc được dấu");
ok(!CT.convUntrusted(a.id, "conv-2"), "cuộc trò chuyện khác không bị ảnh hưởng");
ok(!CT.convUntrusted(b.id, "conv-1"), "tài khoản khác cùng mã cuộc trò chuyện không bị ảnh hưởng");

console.log("3. Không có mã cuộc trò chuyện: không ghi, không đọc");
CT.markConvUntrusted(a.id, undefined); CT.markConvUntrusted(a.id, "");
ok(!CT.convUntrusted(a.id, undefined) && !CT.convUntrusted(a.id, ""), "không có mã → false");
CT.markConvUntrusted(a.id, "x".repeat(65));
ok(!CT.convUntrusted(a.id, "x".repeat(65)), "mã quá dài bị bỏ qua");

console.log("4. Dựng bảng lại (khởi động lại máy chủ) không lỗi, dấu vẫn còn");
const { convtrust: CT2 } = await loadTs(["convtrust"]);
ok(CT2.convUntrusted(a.id, "conv-1"), "bản mô-đun mới (CREATE TABLE IF NOT EXISTS lần nữa) vẫn thấy dấu");

console.log("5. Xóa tài khoản: dấu mất theo");
AU.db().prepare("DELETE FROM users WHERE id = ?").run(a.id);
ok(!AU.db().prepare("SELECT 1 FROM conv_untrusted WHERE user_id = ?").get(a.id), "ON DELETE CASCADE dọn dấu của tài khoản");

console.log("6. Vòng lặp chat: dựng Exec từ dấu của cuộc trò chuyện, load_skill skill danh mục thì ghi dấu");
const src = readChatEngine();
const seeds = src.match(/const xx?: Exec = \{[^\n]*\}/g) ?? [];
ok(seeds.length === 2 && seeds.every((l) => l.includes("untrusted: convUntrusted(c.user.id, convId)")), "cả hai chỗ dựng Exec khởi tạo untrusted từ cuộc trò chuyện", seeds.length);
ok(/if \(r\.used\.untrusted\) \{ x\.untrusted = true; markConvUntrusted\(x\.uid, x\.conv\); \}/.test(src), "load_skill skill chưa kiểm chứng ghi dấu cho cuộc trò chuyện");
ok(/const untrustedConnWrite = \(x: Exec, c: Call\) => !!x\.untrusted/.test(src) && /gateExtra: \(_name, input\) => x\.untrusted && browserTargetOf/.test(src), "hạ quyền connector / Chrome của người dùng đọc x.untrusted (gồm dấu từ lượt trước)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
