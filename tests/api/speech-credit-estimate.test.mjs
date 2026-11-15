// Ước tính credit của Speech theo bảng giá thật của model (shared/speech/data.ts creditRate), không theo hệ số API báo.
// Số đo trên bản thật (G6.5): Eleven v4 71 ký tự → 28 credit, lần đo trước 63 → 25 (0,4 credit mỗi ký tự, tính cả thẻ cảm xúc);
// Flash / Turbo 0,5 credit mỗi ký tự; Nhạc 30 giây → gói tăng 375 credit (12,5 credit mỗi giây). Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

const mods = await loadTs(["speech/data"]);
const { estCredits, billableChars, creditRate, estMusicCredits, MUSIC_DEFAULT_SEC, MUSIC_CREDIT_PER_SEC } = mods["speech/data"];
const text = (n) => "a".repeat(n);

console.log("1. Bảng giá theo model");
// API báo character_cost_multiplier = 1 cho v4 (ước tính cũ ≈71 trong khi thật 28): bảng giá thắng hệ số API với model có trong bảng.
ok(estCredits({ id: "eleven_v4", rate: 1 }, text(71)) === 28, "Eleven v4: 71 ký tự ≈ 28 credit như bản thật", estCredits({ id: "eleven_v4", rate: 1 }, text(71)));
ok(estCredits({ id: "eleven_v4", rate: 1 }, text(63)) === 25, "Eleven v4: 63 ký tự ≈ 25 credit như lần đo trước", estCredits({ id: "eleven_v4", rate: 1 }, text(63)));
ok(creditRate({ id: "eleven_flash_v2_5", rate: 1 }) === 0.5 && creditRate({ id: "eleven_turbo_v2_5" }) === 0.5 && creditRate({ id: "eleven_flash_v2" }) === 0.5 && creditRate({ id: "eleven_v4_turbo", rate: 1 }) === 0.5, "Flash, Turbo: 0,5 credit mỗi ký tự");
ok(estCredits({ id: "eleven_flash_v2_5", rate: 0.5 }, "abcdefghij") === 5, "Flash: 10 ký tự = 5 credit");
ok(creditRate({ id: "eleven_v3", rate: 0.3 }) === 1 && creditRate({ id: "eleven_multilingual_v2" }) === 1, "v3, Multilingual: 1 credit mỗi ký tự");
ok(estCredits({ id: "eleven_multilingual_v2", rate: 1 }, "Xin chào") === "Xin chào".length, "Multilingual: 1 credit mỗi ký tự");
ok(creditRate({ id: "eleven_future_v9", rate: 0.25 }) === 0.25 && creditRate({ id: "eleven_future_v9" }) === 1, "model lạ: theo hệ số API báo, không có thì 1");

console.log("2. Đếm ký tự và làm tròn");
const withTags = "[happy] [whispers] Xin chào bạn";
ok(billableChars("eleven_v4", withTags) === withTags.length, "thẻ cảm xúc là một phần văn bản gửi đi, được tính như ký tự");
ok(estCredits({ id: "eleven_v4", rate: 1 }, "a") === 1, "có chữ thì ít nhất 1 credit");
ok(estCredits(null, "abc") === 3, "không có model: 1 credit mỗi ký tự");
ok(estCredits(undefined, "") === 0, "chuỗi rỗng: 0 credit");

console.log("3. Nhạc theo thời lượng");
ok(MUSIC_CREDIT_PER_SEC === 12.5 && estMusicCredits(30) === 375, "nhạc 30 giây ≈ 375 credit như bản thật (không còn ≈3.000)", estMusicCredits(30));
ok(estMusicCredits(0) === 0 && estMusicCredits(300) === 3750, "0 giây: 0; 5 phút: 3.750");
ok(MUSIC_DEFAULT_SEC === 30, "độ dài nhạc mặc định là 30 giây");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
