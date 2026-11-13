// D6: skill của danh mục (bên thứ ba) được đánh dấu untrusted trong thẻ <skill>; khi load_skill một skill như vậy, kết quả báo used.untrusted
// để vòng lặp hạ quyền ghi connector và dùng Chrome của người dùng. Không cần máy chủ (skillruntime nạp được qua loadTs).
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const { skillruntime: RT } = await loadTs(["skillruntime"]);

const sk = (name, description, extra = {}) => ({ name, description, user_id: "p1", version: 1, body: `# ${name}\nHướng dẫn.`, files: [], ...extra });
const mine = sk("my-skill", "Skill riêng của người dùng để viết báo cáo.");
const cat = sk("cat-vendor-skill", "Skill của danh mục công khai.", { untrusted: true });

console.log("1. skillsPrompt (danh sách ngắn): chỉ skill untrusted mới có untrusted=\"true\"");
const small = RT.skillsPrompt([mine, cat]);
ok(/<skill untrusted="true"><name>cat-vendor-skill<\/name>/.test(small), "skill danh mục có untrusted=\"true\"", small);
ok(/<skill><name>my-skill<\/name>/.test(small), "skill riêng không bị đánh dấu", small);

console.log("2. skillsPrompt (kho lớn > ngưỡng): giữ đánh dấu untrusted");
const filler = Array.from({ length: 60 }, (_, i) => sk(`k${i}`, "Mô tả ".repeat(20)));
const big = RT.skillsPrompt([cat, ...filler]); // cat đứng đầu để nằm trong ngân sách liệt kê
ok(big.includes(`<skill untrusted="true"><name>cat-vendor-skill</name>`), "kho lớn vẫn đánh dấu untrusted", big.slice(0, 400));

console.log("3. load_skill: skill untrusted → thẻ có untrusted và used.untrusted=true");
const r1 = await RT.runSkillTool([cat], "load_skill", { name: "cat-vendor-skill" });
ok(/<skill name="cat-vendor-skill" version="1" untrusted="true">/.test(r1.content), "thẻ skill có untrusted", r1.content.slice(0, 200));
ok(r1.used.untrusted === true, "used.untrusted = true", JSON.stringify(r1.used));
ok(/chưa kiểm chứng/.test(r1.content), "có cảnh báo cho model");

console.log("4. load_skill: skill tin được → không đánh dấu, không hạ quyền");
const r2 = await RT.runSkillTool([mine], "load_skill", { name: "my-skill" });
ok(!/untrusted/.test(r2.content), "không có untrusted trong thẻ", r2.content.slice(0, 160));
ok(!r2.used.untrusted, "used.untrusted không đặt", JSON.stringify(r2.used));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
