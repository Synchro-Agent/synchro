// Định tuyến skill tiếng Việt: âm tiết không khớp nhầm tên hiếm, các lĩnh vực của danh mục đều có khái niệm, lĩnh vực cụ thể đứng trước hình thức chung;
// mục lục đủ 55 mục ngành nghề. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-skillroute-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "skill-route-test";
const { skillroute: SR, skillruntime: RT, plugindir: PD } = await loadTs(["skillroute", "skillruntime", "plugindir"]);
const sk = (name, description, user_id = "u") => ({ name, description, user_id });
const KHO = [
  sk("admisibilidad-ca", "Admisibilidad de recursos ante la Corte de Apelaciones"), sk("market-research", "Market research and competitor analysis reports"),
  sk("tax-filing", "Prepare tax returns and accounting summaries"), sk("video-editor", "Edit videos, add subtitles with ffmpeg"), sk("recruiting-helper", "Recruiting: screen candidates, interview guides for hiring"),
  sk("marketing-plan", "Plan marketing campaigns, SEO and ads growth"), sk("doc-coauthoring", "Co-author documents, reports and proposals"), sk("trip-planner", "Travel itinerary, hotels and flights"),
  sk("gym-coach", "Workout and fitness plans"), sk("recipe-box", "Cooking recipes and meal plans"), sk("thuc-don", "Lên thực đơn và công thức nấu ăn cho gia đình"),
];
const top = (q) => SR.rank(q, KHO.map((skill) => ({ skill })), 5).map((h) => h.skill.name);
console.log("1. Tìm bằng tiếng Việt");
let t = top("Nghiên cứu thị trường cà phê");
ok(t[0] === "market-research" && !t.includes("admisibilidad-ca"), "“cà” không khớp nhầm admisibilidad-ca", t);
for (const [q, want] of [["Tư vấn thuế cho hộ kinh doanh", "tax-filing"], ["Làm video giới thiệu quán", "video-editor"], ["Tuyển dụng nhân viên bán hàng", "recruiting-helper"], ["Lập kế hoạch marketing cho quán", "marketing-plan"], ["Lịch trình du lịch Đà Lạt 3 ngày", "trip-planner"], ["Lịch tập gym cho người mới", "gym-coach"], ["Công thức nấu phở", "recipe-box"]])
  ok(top(q)[0] === want, `“${q}” → ${want}`, top(q));
ok(top("Viết báo cáo tuần")[0] === "doc-coauthoring", "chỉ nói hình thức: vẫn ra skill tài liệu", top("Viết báo cáo tuần"));
ok(top("lên thực đơn nấu ăn gia đình").includes("thuc-don"), "mô tả skill bằng tiếng Việt vẫn tìm được khi trùng nhiều âm tiết", top("lên thực đơn nấu ăn gia đình"));
ok(!top("cà").length && !top("đi đâu").length, "một âm tiết không đủ để gợi ý", top("cà"));
ok(top("ui review").length >= 0 && SR.expand("ui ux qa").terms.has("ui") && !SR.expand("mi xo").terms.has("mi"), "giữ viết tắt quen thuộc, bỏ từ 2 chữ khác");
console.log("2. Gợi ý cho lượt chat");
ok(SR.suggest("Tư vấn thuế cho hộ kinh doanh", KHO.map((skill) => ({ skill })))[0]?.skill.name === "tax-filing", "câu hỏi thuế có gợi ý");
ok(!SR.suggest("Xin chào bạn", KHO.map((skill) => ({ skill }))).length, "câu chào không gợi ý gì");
console.log("3. Mục lục đủ mọi mục ngành nghề");
const cats = PD.PLUGIN_CATS.map((c) => sk(`cat-${c.key}`, `${c.label}: 12 thư viện, 340 skill (Thư viện số một dài dài, Thư viện số hai dài dài, Thư viện số ba…)`, "studio"));
const filler = Array.from({ length: 60 }, (_, i) => sk(`skill-${i}`, "Mô tả ".repeat(30)));
const out = RT.skillsPrompt([...filler, ...cats]);
ok(cats.every((c) => out.includes(`<name>${c.name}</name>`)), `đủ ${cats.length} mục ngành nghề dù có nhiều skill riêng`, cats.filter((c) => !out.includes(`<name>${c.name}</name>`)).map((c) => c.name).join());
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
