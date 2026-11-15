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
const src = readFileSync(new URL("../../ui/artifactcard.tsx", import.meta.url), "utf8");
ok(/onError=\{failed\}/.test(src) && !/onError=\{\(\) => setState\("gone"\)\}/.test(src), "thẻ ảnh hỏi lại máy chủ khi lỗi, không kết luận ngay");
const dict = readFileSync(new URL("../../app/i18n-features.ts", import.meta.url), "utf8");
ok(dict.includes('"Chưa tải được ảnh. Có thể do mạng hoặc máy chủ đang khởi động lại."'), "lời báo có bản tiếng Anh");

// Ảnh dựng nền (W23-2): thẻ ảnh trong chat không đứng mãi ở ô xám 1×1.
ok(O.genVerdict({ pending: true, failed: false }, false) === "wait" && O.genVerdict({ pending: true, failed: false }, true) === "wait", "còn đang dựng: chờ, hỏi lại sau");
ok(O.genVerdict({ pending: false, failed: false }, true) === "reload", "đã thấy đang chờ, nay hết cờ: tải lại ảnh thật");
ok(O.genVerdict({ pending: false, failed: false }, false) === "real", "ảnh 1×1 thật (chưa từng chờ): không tải lại, không lặp");
ok(O.genVerdict({ pending: false, failed: true }, true) === "failed" && O.genVerdict({ pending: false, failed: true }, false) === "failed", "dựng hỏng: thôi chờ");
const route = readFileSync(new URL("../../app/api/outputs/[id]/route.ts", import.meta.url), "utf8");
ok(/const gen = f\.mime === "image\/png" && f\.size <= 512 \? genImageState\(uid, f\.id, fs\.readFileSync\(f\.path\)\) : null;/.test(route), "/api/outputs nhận ra ảnh giữ chỗ (chỉ đọc PNG nhỏ)");
ok(/"cache-control": gen \? "no-store" : "private, max-age=3600"/.test(route) && /gen === "pending" \? \{ "x-synchro-pending": "1" \}/.test(route) && /gen === "failed" \? \{ "x-synchro-failed": "1" \}/.test(route), "ảnh giữ chỗ: no-store, báo đang chờ / hỏng");
ok(/el\.naturalWidth === 1 && el\.naturalHeight === 1/.test(src) && /onLoad=\{\(e\) => loaded\(e\.currentTarget\)\}/.test(src), "thẻ ảnh nhận ra ảnh 1×1 khi tải xong");
ok(/const wait = pendingRetryMs\(g\.n\+\+\);/.test(src) && /\$\{rev \? `&v=\$\{rev\}` : ""\}/.test(src), "hỏi lại theo pendingRetryMs, tải lại bằng địa chỉ mới");
ok(/noteGenSettled\(f\.id, true\)/.test(src) && /noteGenSettled\(f\.id, false\)/.test(src), "ảnh về / hỏng: báo một dòng");
const vi2en = readFileSync(new URL("../../app/i18n-dict.ts", import.meta.url), "utf8");
ok(vi2en.includes('"Không dựng được ảnh này; artifact vẫn giữ khung giữ chỗ."') && vi2en.includes('"Ảnh đang được dựng, sẽ tự hiện khi xong"'), "lời báo ảnh nền có bản tiếng Anh");
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
