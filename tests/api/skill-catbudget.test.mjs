// D4: mục lục ngành nghề (cat-…) chỉ gửi khi KHÔNG có gợi ý từ skill riêng; đủ cả 55 mục khi gửi; ngân sách liệt kê thư viện / skill = 6.000.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const { skillruntime: RT, plugindir: PD } = await loadTs(["skillruntime", "plugindir"]);
const sk = (name, description, user_id = "u") => ({ name, description, user_id });
const cats = PD.PLUGIN_CATS.map((c) => sk(`cat-${c.key}`, `${c.label}: 12 thư viện, 340 skill (Thư viện số một dài dài, Thư viện số hai dài dài, Thư viện số ba…)`, "studio"));
const filler = Array.from({ length: 60 }, (_, i) => sk(`skill-${i}`, "Mô tả ".repeat(30)));

console.log("1. Không có gợi ý skill riêng: đủ mọi mục ngành nghề");
const shown = RT.skillsPrompt([...filler, ...cats]);
ok(cats.every((c) => shown.includes(`<name>${c.name}</name>`)), `đủ ${cats.length} mục ngành nghề`, cats.filter((c) => !shown.includes(`<name>${c.name}</name>`)).map((c) => c.name).join());

console.log("2. Có gợi ý skill riêng: bỏ hết mục lục ngành nghề cat-…");
const hidden = RT.skillsPrompt([...filler, ...cats], false, true);
ok(cats.every((c) => !hidden.includes(`<name>${c.name}</name>`)), "không còn mục cat-… nào", cats.filter((c) => hidden.includes(`<name>${c.name}</name>`)).map((c) => c.name).join());
ok(hidden.includes("<name>skill-0</name>"), "vẫn liệt kê skill thường");

console.log("3. Ngân sách liệt kê thư viện / skill lẻ ≈ 6.000 ký tự");
const many = Array.from({ length: 400 }, (_, i) => sk(`lib-x${i}`, `Thư viện ${i} ` + "nội dung dài ".repeat(20)));
const listOut = RT.skillsPrompt(many, false, true); // không có cat để tách bạch phần liệt kê thư viện / skill
const body = listOut.split("<available_skills>")[1] ?? "";
ok(body.length > 4000 && body.length < 9000, `phần liệt kê trong khoảng ngân sách 6.000 (${body.length} ký tự thô, gồm thẻ)`, body.length);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
