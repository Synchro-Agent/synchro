// Ước tính credit của Speech theo bảng giá thật của model: bỏ thẻ cảm xúc (không bị tính tiền) với model v3/v4, nhân hệ số giá.
// Sửa lỗi cũ: giao diện hiện "≈63 credit" trong khi thực tế chỉ 25 vì đếm cả thẻ trong ngoặc vuông.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

const mods = await loadTs(["speech/data"]);
const { estCredits, billableChars, estMusicCredits, MUSIC_DEFAULT_SEC, MUSIC_CREDIT_PER_SEC } = mods["speech/data"];

// Model chuẩn (hệ số 1): 1 credit mỗi ký tự đọc.
ok(estCredits({ id: "eleven_multilingual_v2", rate: 1 }, "Xin chào") === "Xin chào".length, "multilingual: 1 credit mỗi ký tự");
// Model nửa giá (Flash, hệ số 0,5).
ok(estCredits({ id: "eleven_flash_v2_5", rate: 0.5 }, "abcdefghij") === 5, "flash nửa giá: ceil(10 × 0,5) = 5");

// v3 / v4: thẻ cảm xúc [happy] [whispers]… KHÔNG bị tính tiền → bỏ khỏi số ký tự tính credit (chính là bug 63 → 25).
const withTags = "[happy] [whispers] [laughs] Xin chào bạn";
ok(billableChars("eleven_v3", withTags) === "Xin chào bạn".length, "v3: bỏ thẻ cảm xúc khỏi số ký tự tính tiền");
ok(estCredits({ id: "eleven_v3", rate: 1 }, withTags) === "Xin chào bạn".length, "v3: ước tính = số ký tự đọc, không tính thẻ");
ok(estCredits({ id: "eleven_v4", rate: 1 }, withTags) < withTags.length, "v4: ước tính nhỏ hơn độ dài thô vì thẻ không tính tiền");

// Model không hiểu thẻ (v2): giữ nguyên toàn bộ ký tự.
ok(billableChars("eleven_multilingual_v2", withTags) === withTags.length, "v2: không bỏ thẻ (model không hiểu thẻ)");

// Không có model: mặc định hệ số 1, không bỏ thẻ.
ok(estCredits(null, "abc") === 3, "không có model: mặc định 1 credit mỗi ký tự");
ok(estCredits(undefined, "") === 0, "chuỗi rỗng: 0 credit");

// Nhạc: ước tính theo thời lượng; mặc định 30 giây.
ok(estMusicCredits(30) === 30 * MUSIC_CREDIT_PER_SEC, "nhạc 30s = 30 × hệ số mỗi giây");
ok(estMusicCredits(0) === 0, "nhạc 0 giây: 0 credit");
ok(MUSIC_DEFAULT_SEC === 30, "độ dài nhạc mặc định là 30 giây");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
