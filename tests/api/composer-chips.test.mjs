// Dải thẻ đính kèm ô soạn tin (app/composerchips.ts): số thẻ ẩn sau "+N". Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { composerchips: C } = await loadTs(["composerchips"]);

ok(C.CHIP_LIMIT === 5, "giới hạn một hàng là 5 thẻ");
ok(C.hiddenCards(0) === 0, "không có thẻ: 0 ẩn");
ok(C.hiddenCards(3) === 0, "3 thẻ: 0 ẩn, không có +N");
ok(C.hiddenCards(5) === 0, "vừa đúng 5: 0 ẩn");
ok(C.hiddenCards(6) === 1, "6 thẻ: ẩn 1 (+1)", C.hiddenCards(6));
ok(C.hiddenCards(7) === 2, "7 thẻ: ẩn 2 (+2) — thứ 6, 7 gộp vào +N", C.hiddenCards(7));
ok(C.hiddenCards(30) === 25, "30 thẻ: ẩn 25 (danh sách dài)", C.hiddenCards(30));
ok(C.hiddenCards(7, true) === 0, "đã trải lưới: hiện hết, 0 ẩn");
ok(C.hiddenCards(100, true) === 0, "trải lưới luôn 0 ẩn dù rất nhiều");
ok(C.hiddenCards(2, false, 3) === 0, "giới hạn tùy biến 3, 2 thẻ: 0 ẩn");
ok(C.hiddenCards(5, false, 3) === 2, "giới hạn 3, 5 thẻ: ẩn 2", C.hiddenCards(5, false, 3));
ok(C.hiddenCards(-1) === 0, "số âm an toàn: 0 ẩn");

console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
