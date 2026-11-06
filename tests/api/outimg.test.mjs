// Thẻ ảnh trong tin nhắn: chỉ 404 mới là "hết hạn"; mạng chập chờn, 502 khi deploy, 401 hết phiên thì thử lại, không báo nhầm. Tự chạy được, không cần máy chủ.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x)); };
const { outimg: O } = await loadTs(["outimg"]);
ok(O.imgVerdict(404, 0) === "gone" && O.imgVerdict(410, 0) === "gone", "máy chủ nói không còn tệp: hết hạn ngay");
for (const s of [null, 401, 500, 502, 503, 504, 200, 405]) {
  ok(O.imgVerdict(s, 0) === "retry" && O.imgVerdict(s, 1) === "retry", `${s}: tự thử lại, không báo hết hạn`);
  ok(O.imgVerdict(s, O.IMG_RETRIES) === "fail", `${s}: thử đủ rồi thì hiện nút Thử lại`);
}
ok(O.imgVerdict(404, O.IMG_RETRIES) === "gone", "thử lại rồi mới gặp 404 vẫn là hết hạn");
const src = readFileSync(new URL("../../app/artifactcard.tsx", import.meta.url), "utf8");
ok(/onError=\{failed\}/.test(src) && !/onError=\{\(\) => setState\("gone"\)\}/.test(src), "thẻ ảnh hỏi lại máy chủ khi lỗi, không kết luận ngay");
const dict = readFileSync(new URL("../../app/i18n-features.ts", import.meta.url), "utf8");
ok(dict.includes('"Chưa tải được ảnh. Có thể do mạng hoặc máy chủ đang khởi động lại."'), "lời báo có bản tiếng Anh");
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
