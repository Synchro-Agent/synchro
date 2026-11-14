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


// W1-03: mờ mép chỉ khi thật sự còn thẻ bị khuất ở mép đó.
const box = (o) => ({ scrollLeft: 0, scrollTop: 0, clientWidth: 600, clientHeight: 138, scrollWidth: 600, scrollHeight: 138, ...o });
ok(C.edgeFade(box({})) === "", "một tệp, không tràn: không mờ mép nào (thẻ đầu không bị mờ)");
ok(C.edgeFade(box({ scrollWidth: 601 })) === "", "chênh 1px do làm tròn: vẫn coi là không tràn");
ok(C.edgeFade(box({ scrollWidth: 698, clientWidth: 638 })) === "fade-r", "tràn bên phải, chưa cuộn: chỉ mờ mép phải", C.edgeFade(box({ scrollWidth: 698, clientWidth: 638 })));
ok(C.edgeFade(box({ scrollWidth: 698, clientWidth: 638, scrollLeft: 30 })) === "fade-l fade-r", "cuộn giữa chừng: mờ cả hai mép");
ok(C.edgeFade(box({ scrollWidth: 698, clientWidth: 638, scrollLeft: 60 })) === "fade-l", "cuộn tới cuối: chỉ mờ mép trái (nút xóa thẻ cuối không chìm)");
ok(C.edgeFade(box({ clientHeight: 266, scrollHeight: 522 }), "y") === "fade-b", "lưới đã trải còn hàng bên dưới: mờ mép dưới");
ok(C.edgeFade(box({ clientHeight: 266, scrollHeight: 522, scrollTop: 256 }), "y") === "fade-t", "lưới cuộn tới cuối: chỉ mờ mép trên");
ok(C.edgeFade(box({ clientHeight: 266, scrollHeight: 266 }), "y") === "", "lưới vừa đủ hai hàng: không mờ");

// LIVE-2 / LIVE-3 / R12: "+N" và "Thu gọn" nằm ngoài khung cuộn; lưới cao đúng số hàng trọn vẹn; trạng thái trải lưới đặt lại theo từng tin.
import fs from "node:fs";
const css = fs.readFileSync("app/globals.css", "utf8"), home = fs.readFileSync("app/home.tsx", "utf8"), code = fs.readFileSync("app/codeview.tsx", "utf8");
// Dải thẻ dùng chung (app/attachstrip.tsx) cho ô soạn tin thường và Synchro Code.
const page = fs.readFileSync("app/attachstrip.tsx", "utf8");
ok(/<AttachStrip cards=\{cards\} open=\{chipsOpen\} setOpen=\{setChipsOpen\}/.test(home) && /<AttachStrip className="cv-attach" open=\{stripOpen\} setOpen=\{setStripOpen\}/.test(code), "ô soạn thường và Synchro Code cùng dùng AttachStrip");
ok(/if \(files\.length <= CHIP_LIMIT\) setStripOpen\(false\)/.test(code), "Synchro Code: còn ít tệp thì lần sau bắt đầu lại từ dải một hàng");
ok(!/\.attach:not\(\.sent\):not\(\.attach-grid\)\{[^}]*mask-image/.test(css), "không còn lớp mờ hai mép luôn bật");
const grid = css.match(/\.attach\.attach-grid\{[^}]*max-height:(\d+)px/);
ok(grid && Number(grid[1]) > 138 && (Number(grid[1]) - 10) % 128 === 0, "lưới cao đúng 10px đệm + bội số của hàng 128px (thẻ 120 + khe 8)", grid?.[1]);
const strip = page.match(/<div className=\{`attach-wrap[\s\S]*?\n    <\/div>\n  \);/)?.[0] ?? "";
// U2 (u-bugs.mjs): dải một hàng chỉ dựng số thẻ hiện trọn được (useFitCount) rồi "+N" là phần tử cuối của dải: dải không tràn nên "+N" luôn thấy ở mép
// phải mà không thẻ nào bị mép cắt. "Thu gọn" của lưới đã trải vẫn đứng ngoài khung cuộn.
ok(/\{chipsHidden > 0 && <button[^>]*className="attach-more"[\s\S]*?<\/button>\}<\/div>/.test(strip), "nút +N là phần tử cuối của dải một hàng", strip.slice(0, 300));
ok(/useFitCount\(stripRef,/.test(page) && /cards\.slice\(0, cards\.length - chipsHidden\)/.test(page), "dải một hàng chỉ dựng những thẻ hiện trọn được");
ok(C.fitCount(678, [120, 120, 120, 120, 120, 120, 120], 8, 40) === 4, "768px: 4 thẻ 120px + “+3” vừa dải 678px (5 thẻ thì tràn 2px)", C.fitCount(678, Array(7).fill(120), 8, 40));
ok(C.fitCount(316, Array(7).fill(120), 8, 40) === 2, "390px: 2 thẻ + “+5”");
ok(C.fitCount(2000, Array(7).fill(120), 8, 40) === 5, "rộng mấy cũng không quá CHIP_LIMIT thẻ");
ok(/chipsExpanded && <button[^>]*onClick=\{\(e\) => flip\(false, e\)\}/.test(strip), "lưới đã trải có nút Thu gọn");
ok(/if \(chipCount <= CHIP_LIMIT\) setChipsOpen\(false\)/.test(home) && /setPicks\(\[\]\); setAt\(null\); setChipsOpen\(false\);/.test(home), "gửi tin / còn ít thẻ: lần sau bắt đầu lại từ dải một hàng");
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
