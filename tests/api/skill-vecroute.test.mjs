// D4: khóa nhớ đệm tập ứng viên theo (người dùng, thế hệ), và chọn skill theo nghĩa với lớp lùi về bộ chấm từ khóa khi không có embedding.
// Không cần máy chủ (skillroute không phụ thuộc DB).
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { skillroute: SR } = await loadTs(["skillroute"]);
const sk = (name, description, user_id = "u") => ({ name, description, user_id });

console.log("1. Khóa nhớ đệm tập ứng viên");
ok(SR.candidateKey("u1", 7) === "u1\u00007", "khóa gồm uid và thế hệ", SR.candidateKey("u1", 7));
ok(SR.candidateKey("u1", 7) !== SR.candidateKey("u2", 7) && SR.candidateKey("u1", 7) !== SR.candidateKey("u1", 8), "đổi uid hoặc thế hệ là khóa khác");

console.log("2. prepareCandidates nhớ theo khóa, dựng lại khi thế hệ đổi");
SR.dropCandidateCache();
const KHO = [sk("seo-audit", "Audit SEO for websites"), sk("tax-filing", "Prepare tax returns and accounting summaries"), sk("video-editor", "Edit videos, add subtitles with ffmpeg")];
const k1 = SR.candidateKey("u1", 1);
const p1 = SR.prepareCandidates(k1, KHO.map((skill) => ({ skill })));
const p1b = SR.prepareCandidates(k1, []); // cùng khóa: trả bản đã nhớ, bỏ qua tham số mới
ok(p1 === p1b, "cùng khóa trả đúng một đối tượng đã nhớ");
ok(p1.names.length === 3 && p1.byName.get("seo-audit"), "giữ đủ ứng viên theo tên", p1.names);
const p2 = SR.prepareCandidates(SR.candidateKey("u1", 2), KHO.map((skill) => ({ skill })));
ok(p2 !== p1, "thế hệ mới thì dựng lại");

console.log("3. suggestSemantic: không có embedding thì lùi về bộ chấm từ khóa (như suggest)");
const cands = KHO.map((skill) => ({ skill }));
const base = SR.suggest("Tối ưu SEO cho website", cands).map((h) => h.skill.name);
const fb = (await SR.suggestSemantic("Tối ưu SEO cho website", cands)).map((h) => h.skill.name);
ok(JSON.stringify(base) === JSON.stringify(fb), "kết quả trùng bộ chấm từ khóa", `${base} vs ${fb}`);

console.log("4. suggestSemantic: có embedding thì thu hẹp còn ~k gần nhất rồi chấm lại");
// nearest giả: chỉ trả 2 skill, bỏ seo-audit để chứng minh đã thu hẹp trước khi chấm.
const nearest = async (_q, _names, _k) => ["tax-filing", "video-editor"];
const narrowed = (await SR.suggestSemantic("Tối ưu SEO cho website", cands, { nearest })).map((h) => h.skill.name);
ok(!narrowed.includes("seo-audit"), "seo-audit bị loại vì không nằm trong top gần nhất", narrowed);
// keep: skill riêng luôn được giữ lại dù nearest không trả về.
const kept = (await SR.suggestSemantic("Tối ưu SEO cho website", cands, { nearest, keep: new Set(["seo-audit"]) })).map((h) => h.skill.name);
ok(kept.includes("seo-audit"), "keep giữ lại skill riêng dù ngoài top gần nhất", kept);
// nearest trả null (hết hạn / chưa có vector): lùi về bộ chấm đầy đủ.
const nullNear = async () => null;
const back = (await SR.suggestSemantic("Tối ưu SEO cho website", cands, { nearest: nullNear })).map((h) => h.skill.name);
ok(JSON.stringify(back) === JSON.stringify(base), "nearest=null: lùi về bộ chấm đầy đủ", back);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
