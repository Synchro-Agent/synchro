// Thẻ (tag) của đoạn chat: chuẩn hóa chữ người dùng gõ, không phân biệt hoa thường / dấu, tối đa 8 thẻ, dữ liệu hỏng từ thiết bị khác không làm vỡ giao diện.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x).slice(0, 400)); };
const { chattags: T } = await loadTs(["chattags"]);

ok(T.normTag("  #  Công   việc ") === "Công việc", "bỏ # đầu, gộp khoảng trắng", T.normTag("  #  Công   việc "));
ok(T.normTag("a,b;c<d>") === "a b c d" && T.normTag("x\u0000y") === "x y", "bỏ dấu phân cách và ký tự điều khiển", T.normTag("a,b;c<d>"));
ok(T.normTag("x".repeat(40)).length === T.TAG_LEN, "cắt còn 24 ký tự");
ok(T.normTag("###") === "" && T.normTag("   ") === "", "chỉ có # / khoảng trắng: rỗng");
ok(T.tagKey("Công Việc") === T.tagKey("cong viec") && T.tagKey("Đọc") === "doc", "so sánh không phân biệt hoa thường, dấu");
let t = T.toggleTag([], "Công việc");
ok(JSON.stringify(t) === '["Công việc"]', "thêm thẻ", t);
t = T.toggleTag(t, "cong viec");
ok(t.length === 0, "gõ lại (khác dấu) là bỏ thẻ", t);
t = T.toggleTag([], "du an", ["Dự án"]);
ok(t[0] === "Dự án", "thẻ đã có ở đoạn chat khác: dùng đúng cách viết đã có", t);
let many = [];
for (let i = 0; i < 12; i++) many = T.toggleTag(many, `t${i}`);
ok(many.length === T.TAG_MAX, "tối đa 8 thẻ", many.length);
ok(T.toggleTag(["a"], "   ").join() === "a", "chữ rỗng không đổi gì");
ok(JSON.stringify(T.cleanTags(["a", "A", 3, null, "", "  b  ", "#c", ..."defghijklmn"])) === JSON.stringify(["a", "b", "c", "d", "e", "f", "g", "h"]), "dữ liệu hỏng: bỏ trùng, bỏ không phải chữ, tối đa 8", T.cleanTags(["a", "A", 3, null, "", "  b  ", "#c", ..."defghijklmn"]));
ok(T.cleanTags("x").length === 0 && T.cleanTags(undefined).length === 0, "không phải mảng: không có thẻ");
ok(T.hasTag(["Học"], "hoc") && !T.hasTag("hoc", "hoc") && !T.hasTag(undefined, "x"), "hasTag chịu được dữ liệu hỏng");
const all = T.allTags([{ tags: ["Học", "Việc"] }, { tags: ["viec"] }, { tags: ["Bí mật"], inc: true }, { tags: "x" }, {}]);
ok(JSON.stringify(all) === JSON.stringify([{ tag: "Việc", n: 2 }, { tag: "Học", n: 1 }]), "đếm thẻ, nhiều nhất trước, bỏ đoạn chat ẩn danh", all);
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
