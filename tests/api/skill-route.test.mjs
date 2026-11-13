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
for (const [q, want] of [["Tư vấn thuế cho hộ kinh doanh", "tax-filing"], ["Làm video giới thiệu quán", "video-editor"], ["Tuyển dụng nhân viên bán hàng", "recruiting-helper"], ["Lập kế hoạch marketing cho quán", "marketing-plan"], ["Lịch trình du lịch Đà Lạt 3 ngày", "trip-planner"], ["Lịch tập gym cho người mới", "gym-coach"]])
  ok(top(q)[0] === want, `“${q}” → ${want}`, top(q));
ok(top("Công thức nấu phở").slice(0, 2).sort().join() === "recipe-box,thuc-don", "“Công thức nấu phở”: skill mô tả tiếng Việt đúng chữ và skill tiếng Anh cùng đứng đầu", top("Công thức nấu phở"));
ok(top("Viết báo cáo tuần")[0] === "doc-coauthoring", "chỉ nói hình thức: vẫn ra skill tài liệu", top("Viết báo cáo tuần"));
ok(top("lên thực đơn nấu ăn gia đình").includes("thuc-don"), "mô tả skill bằng tiếng Việt vẫn tìm được khi trùng nhiều âm tiết", top("lên thực đơn nấu ăn gia đình"));
ok(!top("cà").length && !top("đi đâu").length, "một âm tiết không đủ để gợi ý", top("cà"));
ok(top("ui review").length >= 0 && SR.expand("ui ux qa").terms.has("ui") && !SR.expand("mi xo").terms.has("mi"), "giữ viết tắt quen thuộc, bỏ từ 2 chữ khác");
console.log("2. Gợi ý cho lượt chat");
ok(SR.suggest("Tư vấn thuế cho hộ kinh doanh", KHO.map((skill) => ({ skill })))[0]?.skill.name === "tax-filing", "câu hỏi thuế có gợi ý");
ok(!SR.suggest("Xin chào bạn", KHO.map((skill) => ({ skill }))).length, "câu chào không gợi ý gì");
console.log("2b. Chữ bỏ dấu không kéo nhầm lĩnh vực");
const KHO2 = [...KHO, sk("song-planner", "Plan songs, music and chord composition"), sk("book-summary", "Summarize books, novels and reading notes"), sk("contract-review", "Review legal contracts and compliance terms"), sk("doc-writer", "Writing documents, copy and tone")];
const top2 = (q) => SR.rank(q, KHO2.map((skill) => ({ skill })), 5).map((h) => h.skill.name);
ok(!top2("Soạn hợp đồng thuê nhà").includes("tax-filing") && top2("Soạn hợp đồng thuê nhà")[0] === "contract-review", "“thuê nhà” không ra skill thuế", top2("Soạn hợp đồng thuê nhà"));
ok(top2("Tư vấn thuế cho hộ kinh doanh")[0] === "tax-filing" && top2("tu van thue ho kinh doanh")[0] === "tax-filing", "“thuế” có dấu hoặc không dấu vẫn ra skill thuế", top2("tu van thue ho kinh doanh"));
ok(!top2("hop dong thue nha").includes("tax-filing"), "“thue nha” không dấu cũng không ra skill thuế", top2("hop dong thue nha"));
ok(!top2("Lập danh sách khách mời").includes("book-summary") && !top2("Chính sách đổi trả").includes("book-summary"), "“danh sách”, “chính sách” không ra skill sách", top2("Lập danh sách khách mời"));
ok(top2("Tóm tắt sách Đắc Nhân Tâm")[0] === "book-summary", "“sách” thật vẫn ra skill sách", top2("Tóm tắt sách Đắc Nhân Tâm"));
ok(!top2("Nhắc tôi họp lúc 3 giờ").includes("song-planner"), "“nhắc tôi” không ra skill nhạc", top2("Nhắc tôi họp lúc 3 giờ"));
ok(top2("Viết nhạc cho đám cưới")[0] === "song-planner", "“nhạc” thật vẫn ra skill nhạc", top2("Viết nhạc cho đám cưới"));
ok(!SR.expand("Du lịch Việt Nam").groups.some((g) => g.includes("writing")), "“Việt Nam” không phải “viết”");
console.log("2c. Từ người dùng viết nặng hơn từ khóa suy ra; mô tả nhồi từ khóa không vượt được skill đúng tên");
{
  const stuffed = Array.from({ length: 200 }, (_, i) => sk(`web-kit-${i}`, "Design frontend interface ui ux web page pages layout visual landing components performance optimization optimize bundle speed fast rendering website react hooks and everything else you may need for building websites ".repeat(2)));
  const pool = [sk("seo-audit", "Audit SEO for websites"), ...stuffed];
  const t3 = SR.rank("Tối ưu SEO cho website", pool.map((skill) => ({ skill })), 5).map((h) => h.skill.name);
  ok(t3[0] === "seo-audit", "“Tối ưu SEO cho website” → seo-audit đứng đầu", t3);
}
console.log("2d. Kho rất lớn: chấm nhanh nhờ chỉ mục ngược");
{
  const big = Array.from({ length: 18000 }, (_, i) => sk(`skill-${i}`, `Helper number ${i} for topic${i % 500} with word${i % 97} and thing${i % 41} plus ${i % 3 ? "marketing" : "finance"} tasks`));
  const cands = big.map((skill) => ({ skill }));
  SR.rank("Lập kế hoạch marketing", cands, 5);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) SR.rank("Lập kế hoạch tài chính cho topic7", cands, 5);
  const ms = (performance.now() - t0) / 5;
  ok(ms < 40, `18.000 skill: ${ms.toFixed(1)} ms mỗi lượt sau lần đầu`, ms);
  ok(SR.rank("skill-17", cands, 3)[0]?.skill.name === "skill-17", "gọi đúng tên skill vẫn tìm được", SR.rank("skill-17", cands, 3).map((h) => h.skill.name));
}
console.log("2e. Bộ câu có nhãn trên danh mục thật (tên skill và mô tả thư viện; mô tả từng skill chỉ có sau khi cài)");
{
  const dir = JSON.parse(fs.readFileSync("catalog/claude-directory.json", "utf8")).plugins;
  const real = dir.flatMap((p) => p.skills.map((name) => ({ skill: sk(`${p.slug}:${name}`, `${name.replace(/-/g, " ")}. ${p.summary}`), weight: 0.6 })));
  for (const [q, want] of [["Tối ưu SEO cho website", /seo/], ["Soạn hợp đồng thuê nhà", /legal|contract/], ["Tính thuế thu nhập cá nhân", /tax/], ["Làm slide thuyết trình về khí hậu", /slide|deck/], ["Tạo file Excel bảng lương", /excel/], ["Viết email xin nghỉ phép", /email/], ["Review pull request này", /pull-request|pr-review/], ["Tuyển dụng lập trình viên", /recruit|talent/], ["Lịch trình du lịch Đà Lạt 3 ngày", /itinerary|trip|travel/], ["Làm video giới thiệu sản phẩm", /video/]]) {
    const names = SR.suggest(q, real).slice(0, 5).map((h) => h.skill.name.split(":").pop());
    ok(names.some((n) => want.test(n)), `“${q}” → ${want}`, names);
  }
  // Gõ không dấu: âm tiết trùng chữ tiếng Anh ("hang", "ban") không kéo skill lạ; khái niệm có tên riêng thắng khái niệm rộng.
  const names = (q) => SR.suggest(q, real).slice(0, 5).map((h) => h.skill.name.split(":").pop());
  for (const [q, bad] of [["phan tich du lieu ban hang", /debugging|board-minutes/], ["viet email cam on khach hang", /mapmap|maps/], ["Lập ngân sách đám cưới", /event-sourcing|twilio/], ["Làm hóa đơn cho khách hàng", /income-taxes|profit-loss|uk-accounting/]])
    ok(!names(q).some((n) => bad.test(n)), `“${q}” không ra skill lạ`, names(q));
  for (const [q, want] of [["viet email cam on khach hang", /email/], ["Làm hóa đơn cho khách hàng", /invoice/], ["lam hoa don cho khach hang", /invoice/], ["Lập ngân sách đám cưới", /wedding|budget/], ["Tuyển dụng lập trình viên", /recruit/]])
    ok(names(q).some((n) => want.test(n)), `“${q}” → ${want}`, names(q));
  for (const q of ["Lập danh sách khách mời", "Nhắc tôi họp lúc 3 giờ", "Xin chào bạn"]) ok(!SR.suggest(q, real).length, `“${q}”: không gợi ý skill nào`, SR.suggest(q, real).map((h) => h.skill.name));
}
console.log("3. Mục lục đủ mọi mục ngành nghề");
const cats = PD.PLUGIN_CATS.map((c) => sk(`cat-${c.key}`, `${c.label}: 12 thư viện, 340 skill (Thư viện số một dài dài, Thư viện số hai dài dài, Thư viện số ba…)`, "studio"));
const filler = Array.from({ length: 60 }, (_, i) => sk(`skill-${i}`, "Mô tả ".repeat(30)));
const out = RT.skillsPrompt([...filler, ...cats]);
ok(cats.every((c) => out.includes(`<name>${c.name}</name>`)), `đủ ${cats.length} mục ngành nghề dù có nhiều skill riêng`, cats.filter((c) => !out.includes(`<name>${c.name}</name>`)).map((c) => c.name).join());
console.log("Đường nhanh biết người dùng có skill riêng");
{
  const brand = [sk("brand-voice-email", "Write emails and captions in our brand voice")];
  const cap = [sk("instagram-caption", "Viết caption instagram theo giọng thương hiệu")];
  ok(SR.ownSkillFits("viết email xin nghỉ phép", brand), "có skill email: “viết email xin nghỉ phép” không đi đường nhanh");
  ok(SR.ownSkillFits("viet email xin nghi phep", brand), "gõ không dấu cũng nhận ra");
  ok(SR.ownSkillFits("viết caption instagram", cap), "có skill caption: “viết caption instagram” không đi đường nhanh");
  ok(!SR.ownSkillFits("xin chào", brand) && !SR.ownSkillFits("cảm ơn nhé", brand), "câu chào không kéo theo skill");
  ok(!SR.ownSkillFits("1+1 bằng mấy?", brand) && !SR.ownSkillFits("Thủ đô của Úc là gì?", brand), "câu không liên quan vẫn đi đường nhanh");
  ok(!SR.ownSkillFits("viết một bài thơ về mùa thu", [sk("recipe-box", "Cooking recipes and meal plans")]), "skill khác lĩnh vực không chặn đường nhanh");
  ok(!SR.ownSkillFits("viết email xin nghỉ phép", []), "không có skill nào: giữ đường nhanh");
}
console.log("Định tuyến video sang Remotion (G5)");
{
  for (const q of ["Làm video giới thiệu quán", "tao mot motion graphic", "animation logo cho công ty", "dựng video intro cho kênh YouTube", "video TikTok 30 giây", "làm explainer video về sản phẩm"])
    ok(SR.routeVideoSkill(q) === "remotion", `“${q}” → Remotion`, SR.routeVideoSkill(q));
  ok(SR.routeVideoSkill("Làm video giới thiệu", { queueFull: true }) === "ffmpeg", "hàng dựng đầy thì lùi về ffmpeg", SR.routeVideoSkill("Làm video giới thiệu", { queueFull: true }));
  for (const q of ["Viết báo cáo tuần", "Lập kế hoạch marketing", "Thiết kế poster sự kiện", "một bài hát về mùa thu"])
    ok(SR.routeVideoSkill(q) === null, `“${q}”: không phải việc video`, SR.routeVideoSkill(q));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
