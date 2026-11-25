// Đội hình model ở bộ chọn model (shared/modellineup.ts): mỗi hãng chỉ hiện bản mới nhất của từng bậc, xếp từ việc
// nhẹ đến việc khó, như ứng dụng của chính hãng. Danh sách giống thật của từng hãng (gói và khóa API), ca Gemini
// Hydrogen / Argon / Carbon → Hydrogen / Neon / Carbon, model đang chọn đời cũ, model hãng khác đi kèm gói Google,
// và đường dữ liệu từ sổ model (ngày thấy lần đầu, nhãn Mới 14 ngày).
// Hàm thuần và cơ sở dữ liệu tạm, không cần máy chủ.
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

process.env.DATA_DIR = mkdtempSync(path.join(process.cwd(), "node_modules", ".cache", "synchro-lineup-"));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400));
};
const { "shared/modellineup": L } = await loadTs(["shared/modellineup"]);

/** Nhóm model như /api/models trả về: [mã, tên] hoặc [mã, tên, since]. */
const group = (prov, rows) =>
  rows.map(([id, name, since]) => ({ key: `${prov}/${id}`, id, name, ...(since ? { since } : {}) }));
/** Nhóm từ danh sách mã (tên là chính mã). */
const byIds = (prov, list) => group(prov, list.map((id) => [id, id]));
const ids = (list) => list.map((m) => m.id).join(",");
const eq = (got, want, name) => ok(ids(got) === want, `${name}: ${want || "(trống)"}`, ids(got));
const has = (list, id) => list.some((m) => m.id === id);
const GEM4 = "gemini-4-hydrogen,gemini-4-neon,gemini-4-carbon";

console.log("1. Gói Gemini (Antigravity) như ảnh chụp của chủ dự án");
const AGY = group("sub-agy", [
  ["gemini-4-neon", "Gemini 4 Neon"], ["gemini-4-carbon", "Gemini 4 Carbon"], ["gemini-4-argon", "Gemini 4 Argon"],
  ["gemini-4-hydrogen", "Gemini 4 Hydrogen"], ["gemini-4-orchestrator-neon", "Orchestrator (Neon)"],
  ["gemini-4-orchestrator-carbon", "Orchestrator (Carbon)"],
  ["orchestrator-hydrogen", "Orchestrator (Hydrogen) (Antigravity)"], ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["claude-opus-5-5", "Claude Opus 5.5 (Antigravity)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 (Antigravity)"],
  ["gpt-oss-120b", "GPT-OSS 120B (Antigravity)"],
]);
let r = L.lineup(AGY, { ownPlans: new Set(["google", "anthropic", "openai"]) });
eq(r.main, GEM4, "đội hình nhẹ → chuẩn → khó");
eq(r.via, "", "đã có gói Claude: không tách mục Qua Antigravity");
ok(r.rest.length === AGY.length - 3 && r.rest.every((m) => !r.main.includes(m)),
  "mọi model khác vẫn ở Xem tất cả model, không mất model nào", ids(r.rest));
ok(r.rest.some((m) => /orchestrator/.test(m.id)) && !r.main.some((m) => /orchestrator/i.test(m.name)),
  "model điều phối chỉ ở Xem tất cả");
r = L.lineup(AGY, { ownPlans: new Set(["google"]) });
eq(r.via, "claude-sonnet-5-5,claude-opus-5-5", "không có gói Claude: Claude qua Antigravity thành mục riêng, theo bậc");
ok(!has(r.via, "gpt-oss-120b") && has(r.rest, "gpt-oss-120b"), "GPT-OSS (mã nguồn mở) chỉ ở Xem tất cả");

console.log("2. Model mới THAY model cùng bậc: Hydrogen / Argon / Carbon → Hydrogen / Neon / Carbon");
const T0 = Date.UTC(2026, 8, 1), T1 = Date.UTC(2026, 10, 20);
const before = group("sub-agy", [["gemini-4-hydrogen", "H", T0], ["gemini-4-argon", "A", T0],
  ["gemini-4-carbon", "C", T0], ["gemini-3.8-flash", "F", T0]]);
eq(L.lineup(before).main, "gemini-4-hydrogen,gemini-4-argon,gemini-4-carbon", "trước khi có Neon");
const after = [...before, ...group("sub-agy", [["gemini-4-neon", "N", T1]])];
r = L.lineup(after);
eq(r.main, GEM4, "Neon (thấy sau, cùng đời 4) thay Argon ở bậc chuẩn, không xếp thêm");
ok(has(r.rest, "gemini-4-argon"), "Argon vẫn chọn được qua Xem tất cả model");
const listed = group("sub-agy", [["gemini-4-neon", "N"], ["gemini-4-carbon", "C"], ["gemini-4-argon", "A"],
  ["gemini-4-hydrogen", "H"]]);
eq(L.lineup(listed).main, GEM4, "không có ngày: bản hãng liệt kê trước (mới hơn) thắng");
const newFlash = [...after, { ...group("sub-agy", [["gemini-3.9-flash", "F2", T1 + 1]])[0], isNew: true }];
eq(L.lineup(newFlash).main, GEM4, "model mới nhưng đời cũ hơn (3.9 Flash) không chen vào: mới thôi chưa đủ");
const gen5 = [...after, ...group("google", [["gemini-5-oxygen", "O", T1 + 2]])];
eq(L.lineup(gen5, { kind: "google" }).main, "gemini-4-hydrogen,gemini-5-oxygen,gemini-4-carbon",
  "dòng lạ đời 5 tự vào ô theo hạng chung (không cần sửa code)");

console.log("3. Gói ChatGPT như ảnh chụp");
const CODEX = group("sub-codex", [["gpt-6.2-sol", "GPT-6.2 Sol"], ["gpt-6.2-astra", "GPT-6.2 Astra"],
  ["gpt-6.1-terra", "GPT-6.1 Terra"], ["gpt-6.1-sol", "GPT-6.1 Sol"], ["gpt-6-astra", "GPT-6 Astra"],
  ["gpt-6-sol", "GPT-6 Sol"], ["gpt-6-luna", "GPT-6 Luna"], ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"], ["gpt-5.6-luna", "GPT-5.6 Luna"]]);
r = L.lineup(CODEX);
eq(r.main, "gpt-6-luna,gpt-6.2-sol,gpt-6.2-astra", "Luna / Sol / Astra bản mới nhất mỗi bậc");
ok(r.rest.length === 7 && r.rest[0].id === "gpt-6.1-terra", "Terra và đời cũ ở Xem tất cả, theo thứ tự hãng liệt kê",
  ids(r.rest));
eq(L.lineup([...group("sub-codex", [["gpt-7-luna", "GPT-7 Luna"]]), ...CODEX]).main,
  "gpt-7-luna,gpt-6.2-sol,gpt-6.2-astra", "GPT-7 Luna thay GPT-6 Luna");
eq(L.lineup(group("sub-codex", [["default", "ChatGPT (plan default)"]])).main, "default",
  "gói chưa đọc được danh sách: vẫn hiện model mặc định");

console.log("4. Khóa API OpenAI (danh sách giống API thật)");
const OA = byIds("openai", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "chat-latest", "gpt-5.6-sol",
  "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4-mini", "gpt-5.4-nano", "o3-pro", "o3", "gpt-4o",
  "gpt-5.6-cyber", "gpt-oss-120b", "gpt-5.3-codex"]);
r = L.lineup(OA, { kind: "openai" });
eq(r.main, "gpt-6-luna,gpt-6.1-sol,gpt-6-astra", "đội hình của khóa API");
ok(r.main.length + r.rest.length === OA.length, "không mất model nào");
eq(L.lineup(OA, { kind: "openai", code: true }).main, "gpt-6-luna,gpt-6.1-sol,gpt-6-astra,gpt-5.3-codex",
  "Synchro Code: thêm model chỉ viết code ở cuối");

console.log("5. Claude (gói và khóa API)");
const CLAUDE_PLAN = group("sub-claude", [["fable", "Claude Fable 5.1"], ["opus", "Claude Opus 5.5"],
  ["sonnet", "Claude Sonnet 5.5"], ["haiku", "Claude Haiku 5.5"]]);
eq(L.lineup(CLAUDE_PLAN).main, "haiku,sonnet,opus,fable", "gói Claude: Haiku → Sonnet → Opus → Fable");
const ANT = byIds("anthropic", ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-sonnet-4-6",
  "claude-opus-4-5-20251101", "claude-haiku-4-5-20251001"]);
eq(L.lineup(ANT).main, "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5,claude-fable-5-1",
  "khóa API: bản mới nhất mỗi dòng");
eq(L.lineup([...ANT, ...byIds("anthropic", ["claude-opus-6"])]).main,
  "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-6,claude-fable-5-1", "Claude Opus 6 thay Opus 5.5, không xếp thêm");

console.log("6. Grok và DeepSeek");
const GROK = group("sub-grok", [["grok-4.7", "Grok 4.7"], ["grok-4.6", "Grok 4.6"],
  ["grok-build-0.1", "Grok Build 0.1"]]);
eq(L.lineup(GROK).main, "grok-4.7", "gói Grok: bản mới nhất của dòng chính");
eq(L.lineup(GROK, { code: true }).main, "grok-4.7,grok-build-0.1", "Synchro Code: thêm Grok Build");
const XAI = byIds("xai", ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning", "grok-build-0.1", "grok-4-fast-reasoning", "grok-3", "grok-3-mini",
  "grok-code-fast-1"]);
eq(L.lineup(XAI).main, "grok-4-fast-reasoning,grok-4.7", "khóa API Grok: Fast → dòng chính");
eq(L.lineup([...XAI, ...byIds("xai", ["grok-5-heavy"])]).main, "grok-4-fast-reasoning,grok-4.7,grok-5-heavy",
  "bậc Heavy khi hãng có");
eq(L.lineup(byIds("deepseek", ["deepseek-v4-pro", "deepseek-flash", "deepseek-chat"])).main,
  "deepseek-flash,deepseek-chat,deepseek-v4-pro", "DeepSeek: Flash → Chat → Pro");

console.log("7. Model đang chọn, nhà cung cấp chưa có đội hình");
r = L.lineup(CODEX, { selected: "sub-codex/gpt-5.6-sol" });
ok(ids(r.main) === "gpt-6-luna,gpt-6.2-sol,gpt-6.2-astra,gpt-5.6-sol" && !has(r.rest, "gpt-5.6-sol"),
  "chat cũ ghim GPT-5.6 Sol: vẫn hiện ở danh sách chính (có dấu chọn), không lặp ở Xem tất cả", ids(r.main));
r = L.lineup(byIds("openrouter", ["anthropic/claude-opus-5-5", "meta/llama-5", "x/y"]), { kind: "compatible" });
ok(r.main.length === 3 && !r.rest.length, "nhà cung cấp tương thích OpenAI: hiện đủ như trước");
ok(L.lineup([]).main.length === 0, "nhóm trống không lỗi");

console.log("8. Từ sổ model: ngày thấy lần đầu và nhãn Mới chỉ 14 ngày");
const { modelreg: G } = await loadTs(["modelreg"]);
const LIST = (xs) => xs.map((id) => ({ id, name: id }));
const BASE = ["gemini-4-hydrogen", "gemini-4-argon", "gemini-4-carbon"];
G.syncListed("sub-agy", "google", LIST(BASE), { plan: true });
await new Promise((res) => setTimeout(res, 15));
G.syncListed("sub-agy", "google", LIST([...BASE, "gemini-4-neon"]), { plan: true });
const key = (id) => `sub-agy/${id}`;
ok(G.sinceOf(key("gemini-4-neon")) > G.sinceOf(key("gemini-4-argon")), "Neon thấy sau Argon");
ok(G.sinceOf("sub-agy/khong-co") === undefined, "model chưa có trong sổ: không có ngày");
const fromReg = [...BASE, "gemini-4-neon"].map((id) => ({
  key: key(id), id, name: id, since: G.sinceOf(key(id)), ...(G.isNewModel(key(id)) ? { isNew: true } : {}),
}));
r = L.lineup(fromReg);
eq(r.main, GEM4, "danh sách gói như máy chủ gửi: Neon thay Argon");
ok(r.main.find((m) => m.id === "gemini-4-neon")?.isNew && !r.main.find((m) => m.id === "gemini-4-hydrogen")?.isNew,
  "chỉ model vừa ra mang nhãn Mới (danh sách nền thì không)");
const DAY = 86_400_000, neon = key("gemini-4-neon");
ok(G.isNewModel(neon, Date.now() + 13 * DAY) && !G.isNewModel(neon, Date.now() + 15 * DAY),
  "nhãn Mới tự hết sau 14 ngày, không ở mãi");
// Gói vừa nối (hay sổ làm lại) thấy lần đầu một model hãng đã bán từ lâu: không phải model mới.
G.syncListed("sub-agy", "google", [...LIST([...BASE, "gemini-4-neon"]),
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", created: Date.now() - 40 * DAY }], { plan: true });
ok(!G.isNewModel(key("gemini-3.8-flash")) && G.isNewModel(neon),
  "thấy lần đầu nhưng hãng ra mắt 40 ngày trước: không gắn nhãn Mới");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
