// D4: mục lục ngành nghề (cat-…) chỉ gửi khi KHÔNG có gợi ý từ skill riêng; đủ mọi mục khi gửi; MỘT ngân sách 6.000 ký tự cho cả phần
// liệt kê (thư viện, skill lẻ và mục ngành nghề cộng lại), hạ từ 17.500 (8.000 + 9.500).
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const { skillruntime: RT, plugindir: PD } = await loadTs(["skillruntime", "plugindir"]);
const sk = (name, description, user_id = "u") => ({ name, description, user_id });
const cats = PD.PLUGIN_CATS.map((c) => sk(`cat-${c.key}`, `${c.label}: 12 thư viện, 340 skill (Thư viện số một dài dài, Thư viện số hai dài dài, Thư viện số ba…)`, "studio"));
const filler = Array.from({ length: 60 }, (_, i) => sk(`skill-${i}`, "Mô tả ".repeat(30)));
// Phần liệt kê = nội dung giữa <available_skills> … </available_skills> cộng khối <skill_categories> (nếu có).
const listing = (out) => {
  const a = out.indexOf("<available_skills>\n") + "<available_skills>\n".length, b = out.indexOf("\n</available_skills>");
  const c = out.indexOf("\n<skill_categories>\n"); // khối thật (luật trong RULES cũng nhắc tên thẻ)
  return { skills: out.slice(a, b), cats: c >= 0 ? out.slice(c + 1) : "" };
};
const hasCat = (block, name) => new RegExp(`(^|\\n|, )${name}(:|,|\\n)`).test(block);

ok(RT.LIST_BUDGET === 6000, "một ngân sách liệt kê 6.000 ký tự", RT.LIST_BUDGET);

console.log("1. Không có gợi ý skill riêng: đủ mọi mục ngành nghề, tổng vẫn trong 6.000");
const shown = RT.skillsPrompt([...filler, ...cats]);
const L1 = listing(shown);
ok(cats.length >= 50 && cats.every((c) => hasCat(L1.cats, c.name)), `đủ ${cats.length} mục ngành nghề`, cats.filter((c) => !hasCat(L1.cats, c.name)).map((c) => c.name).join());
ok(cats.every((c) => !shown.includes(`<name>${c.name}</name>`)), "mục ngành nghề đi dạng gọn (tên + nhãn), không phải thẻ <skill> dài");
ok(L1.cats.includes(`cat-${PD.PLUGIN_CATS[0].key}: ${PD.PLUGIN_CATS[0].label}`), "mỗi mục có nhãn ngắn (phần trước dấu \":\")", L1.cats.slice(0, 300));
ok(L1.skills.length + L1.cats.length <= 6000, `skill + mục ngành nghề ≤ 6.000 (${L1.skills.length} + ${L1.cats.length})`, L1.skills.length + L1.cats.length);
ok(L1.skills.includes("<name>skill-0</name>"), "vẫn liệt kê skill thường trong phần còn lại");

console.log("1b. Rất nhiều skill riêng xếp trước: mục ngành nghề vẫn không bị bỏ");
const many0 = Array.from({ length: 400 }, (_, i) => sk(`own-${i}`, `Skill riêng ${i} ` + "nội dung dài ".repeat(20)));
const L1b = listing(RT.skillsPrompt([...many0, ...cats]));
ok(cats.every((c) => hasCat(L1b.cats, c.name)), "đủ mọi mục dù skill riêng thừa sức lấp đầy ngân sách", cats.filter((c) => !hasCat(L1b.cats, c.name)).map((c) => c.name).join());
ok(L1b.skills.length + L1b.cats.length <= 6000, `tổng ≤ 6.000 (${L1b.skills.length + L1b.cats.length})`);

console.log("1c. Nhãn dài bất thường: cắt ngắn (hoặc chỉ giữ tên), vẫn đủ mọi mục");
const longCats = cats.map((c) => sk(c.name, `${"Nhãn rất dài ".repeat(10)}: chi tiết`, "studio"));
const L1c = listing(RT.skillsPrompt([...many0, ...longCats]));
ok(longCats.every((c) => hasCat(L1c.cats, c.name)) && L1c.skills.length + L1c.cats.length <= 6000, "đủ mọi mục, tổng ≤ 6.000", L1c.cats.length);

console.log("2. Có gợi ý skill riêng: bỏ hết mục lục ngành nghề cat-…");
const hidden = RT.skillsPrompt([...filler, ...cats], false, true);
ok(!listing(hidden).cats && cats.every((c) => !hidden.includes(c.name)), "không còn mục cat-… nào", cats.filter((c) => hidden.includes(c.name)).map((c) => c.name).join());
ok(hidden.includes("<name>skill-0</name>"), "vẫn liệt kê skill thường");

console.log("3. Không có mục ngành nghề: skill dùng trọn 6.000");
const many = Array.from({ length: 400 }, (_, i) => sk(`lib-x${i}`, `Thư viện ${i} ` + "nội dung dài ".repeat(20)));
const L3 = listing(RT.skillsPrompt(many, false, true));
ok(L3.skills.length > 5000 && L3.skills.length <= 6000, `phần liệt kê sát ngân sách 6.000 (${L3.skills.length} ký tự)`, L3.skills.length);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
