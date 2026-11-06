// Bộ câu chấm chất lượng (tests/evals/answer-set.json) trên bộ định tuyến thật: câu nguy hiểm, sức khỏe, pháp lý, tài chính không được đi model rẻ nhất và đường nhanh; câu thường và câu trông giống rủi ro không bị đội giá.
// Phần này không gọi model. Câu trả lời thật do người đọc chấm bằng scripts/answer-eval.mjs. Hàm thuần, không cần máy chủ.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; if (!c) console.log("  ✗", n, String(x).slice(0, 300)); };
const { router: R } = await loadTs(["router"]);
const set = JSON.parse(fs.readFileSync(new URL("../evals/answer-set.json", import.meta.url), "utf8"));
const MODELS = ["sub-claude/fable", "sub-claude/opus", "sub-claude/sonnet", "sub-claude/haiku", "sub-codex/gpt-6.1-astra", "sub-codex/gpt-6.1-sol", "sub-codex/gpt-6-luna", "sub-agy/gemini-3.8-argon", "sub-agy/gemini-3.8-pro", "sub-agy/gemini-3.8-flash"];

ok(new Set(set.items.map((x) => x.id)).size === set.items.length, "mã câu không trùng");
for (const lang of ["vi", "en"]) for (const kind of ["crisis", "health", "legal", "money", "writing", "ordinary"]) ok(set.items.some((x) => x.lang === lang && x.kind === kind), `đủ loại ${kind} bằng ${lang}`);
for (const it of set.items) {
  const q = { text: it.prompt, attachments: 0, turns: 1, studio: false };
  const e = it.expect, r = R.routeModel(q, MODELS), tag = `${it.id}: ${it.prompt}`;
  if (e.crisis !== undefined) ok(R.isCrisis(it.prompt) === e.crisis, `nguy hiểm tức thời: ${tag}`, `isCrisis=${R.isCrisis(it.prompt)}`);
  if (e.crisis || e.stakes) {
    ok(R.hasHighStakes(q), `rủi ro: ${tag}`, "không nhận ra");
    ok(R.profileOf(r.model).tier !== "fast", `không đi model rẻ nhất: ${tag}`, r.model);
    ok(r.effort !== "low", `không đi nỗ lực thấp: ${tag}`, `${r.task} ${r.effort}`);
  }
  if (e.stakes === false) ok(!R.hasHighStakes(q), `không phải rủi ro: ${tag}`, `${r.task} ${r.model}`);
  if (e.fast !== undefined) ok(R.needsNoTools(q) === e.fast, `${e.fast ? "đi đường nhanh" : "có công cụ"}: ${tag}`, `${r.task} điểm ${R.difficulty(q).score}`);
}
// Hướng dẫn gửi cho model: lớp an toàn thứ hai ở đường nhanh (bộ định tuyến có thể bỏ sót), nói thật về việc không có công cụ, trả lời đúng ngôn ngữ.
const src = fs.readFileSync(new URL("../../app/chatengine.ts", import.meta.url), "utf8");
const fast = /const FAST_RULES = `([\s\S]*?)`;/.exec(src)?.[1] ?? "", full = /const QUALITY_RULES = `([\s\S]*?)`;/.exec(src)?.[1] ?? "";
ok(/An toàn đứng trước/.test(fast) && /tự làm hại/.test(fast) && /115/.test(fast) && /988/.test(fast) && /1737/.test(fast), "đường nhanh có dòng an toàn và đầu mối khẩn cấp", fast);
ok(/đừng nói đã tìm, đã tra, đã chạy hay đã kiểm tra/.test(fast), "đường nhanh: không nhận là đã kiểm tra khi không có công cụ", fast);
ok(/đúng ngôn ngữ người dùng/.test(fast) && /tiếng Anh/.test(fast), "đường nhanh: đúng ngôn ngữ", fast);
ok(/nói rõ đã thật sự kiểm tra gì/.test(full) && /chưa kiểm tra được/.test(full), "lượt đầy đủ: nói rõ đã kiểm tra gì, chưa kiểm tra gì", full);
ok(/988/.test(full) && /1737/.test(full) && /Sức khỏe, pháp lý, tài chính/.test(full), "lượt đầy đủ: đầu mối khẩn cấp và câu hỏi rủi ro", full);
for (const [t, n] of [[fast, "đường nhanh"], [full, "lượt đầy đủ"]]) ok(/không nêu 988/.test(t) && /múi giờ/.test(t), `${n}: chọn số theo nơi họ sống, người Việt không nhận số của Mỹ`, t);
// Script chấm trên CLI thật tốn lượt của gói nên kiểm thử không chạy nó: chỉ kiểm tra cú pháp và các hàm nó gọi còn tồn tại.
const script = new URL("../../scripts/answer-eval.mjs", import.meta.url).pathname;
ok(spawnSync(process.execPath, ["--check", script]).status === 0, "scripts/answer-eval.mjs đúng cú pháp");
const has = (file, name) => new RegExp(`export (?:async )?(?:function\\*? |const )${name}\\b`).test(fs.readFileSync(new URL(`../../app/${file}.ts`, import.meta.url), "utf8"));
for (const [f, n] of [["chatengine", "answerRules"], ["ai/cli_runtime", "removeSessionFiles"], ["ai/cli_runtime", "CLIS"], ["ai/cli_runtime", "engineHome"], ["ai/cli_runtime", "makeDir"], ["ai/cli_auth", "scopeDir"], ["ai/cli_auth", "engineEnv"], ["ai/cli_auth", "safeScope"], ["ai/cli_auth", "status"], ["ai/errors", "redact"], ["ai/selector", "engineFor"], ["router", "autoEffort"], ["router", "hasHighStakes"], ["router", "isCrisis"], ["router", "taskOf"]]) ok(has(f, n), `script dùng ${f}.${n}`);
console.log(`${set.items.length} câu. Kết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
