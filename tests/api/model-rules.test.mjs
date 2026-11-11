// Sổ model tự cập nhật: luật chung hiểu mã model của mọi hãng (app/modelrules.ts) — dòng model, số phiên bản so theo số, bản chụp có ngày,
// model không dùng để nhắn tin, hạng model — trên danh sách giống API thật của từng hãng, kèm các mã lạ (-preview, -latest, -mini / -nano / -flash-lite).
// Và chế độ Tự động (app/router.ts) chọn bản mới nhất của một dòng khi hãng ra model mới. Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { modelrules: R, router: RT, catalog: C } = await loadTs(["modelrules", "router", "catalog"]);

console.log("1. Dòng model và phiên bản");
const P = (id) => { const p = R.parseId(id); return `${p.family} ${p.version.join(".")}${p.date ? ` @${p.date}` : ""}${p.preview ? " preview" : ""}${p.alias ? " alias" : ""}`; };
const CASES = [
  ["claude-opus-5-5", "claude-opus 5.5"], ["claude-opus-6", "claude-opus 6"], ["claude-haiku-4-5-20251001", "claude-haiku 4.5 @20251001"], ["claude-3-5-sonnet-20241022", "claude-sonnet 3.5 @20241022"],
  ["claude-fable-5-1", "claude-fable 5.1"], ["gpt-6.1-sol", "gpt-sol 6.1"], ["gpt-7-sol", "gpt-sol 7"], ["gpt-6-astra", "gpt-astra 6"], ["gpt-5.4-mini", "gpt-mini 5.4"], ["gpt-5.4-nano", "gpt-nano 5.4"],
  ["gpt-4o", "gpt-o 4"], ["gpt-4o-2024-08-06", "gpt-o 4 @2024-08-06"], ["gpt-4-0613", "gpt 4 @0613"], ["o3", "o 3"], ["o3-pro", "o-pro 3"], ["o4-mini", "o-mini 4"], ["chat-latest", "chat  alias"],
  ["gemini-3.1-pro-preview", "gemini-pro 3.1 preview"], ["gemini-4.5-pro", "gemini-pro 4.5"], ["gemini-3.5-flash-lite", "gemini-flash-lite 3.5"], ["gemini-2.0-flash-001", "gemini-flash 2.0"],
  ["gemini-4-argon", "gemini-argon 4"], ["gemini-3-flash-preview", "gemini-flash 3 preview"], ["models/gemini-2.5-pro", "gemini-pro 2.5"],
  ["grok-4.7", "grok 4.7"], ["grok-5", "grok 5"], ["grok-5-fast", "grok-fast 5"], ["grok-4.20-0309-reasoning", "grok-reasoning 4.20"], ["grok-build-0.1", "grok-build 0.1"], ["grok-code-fast-1", "grok-code-fast 1"], ["grok-2-1212", "grok 2 @1212"],
  ["deepseek-v4-pro", "deepseek-pro 4"], ["deepseek-flash", "deepseek-flash "], ["deepseek-chat", "deepseek-chat "],
];
for (const [id, want] of CASES) ok(P(id) === want, `${id} → ${want}`, P(id));

console.log("2. So phiên bản theo số");
const newer = (a, b) => R.compareModels(a, b) > 0;
ok(newer("anthropic/claude-opus-6", "anthropic/claude-opus-5-5"), "claude-opus-6 mới hơn claude-opus-5-5");
ok(newer("openai/gpt-7-sol", "openai/gpt-6.1-sol") && newer("openai/gpt-6.1-sol", "openai/gpt-6-sol"), "gpt-7-sol > gpt-6.1-sol > gpt-6-sol");
ok(newer("google/gemini-4.5-pro", "google/gemini-4-pro") && newer("google/gemini-4.5-pro", "google/gemini-3.1-pro-preview"), "gemini-4.5-pro > gemini-4-pro > gemini-3.1-pro-preview");
ok(newer("xai/grok-10", "xai/grok-9.5") && newer("xai/grok-5", "xai/grok-4.7"), "grok-10 > grok-9.5 (so theo số, không theo chữ), grok-5 > grok-4.7");
ok(newer("google/gemini-3-flash", "google/gemini-3-flash-preview"), "bản chính thức mới hơn bản -preview cùng số");
ok(newer("anthropic/claude-haiku-4-5", "anthropic/claude-haiku-4-5-20251001"), "tên chung đứng trước bản chụp có ngày cùng số");
ok(R.compareModels("x/a", "x/b", (k) => (k === "x/a" ? 2000 : 1000)) > 0, "không có số phiên bản thì so theo ngày hãng báo");

console.log("3. Model không dùng để nhắn tin và bản chụp có ngày");
const OPENAI = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "chat-latest", "gpt-image-2.5-sunburst", "gpt-image-2", "gpt-live-1", "gpt-realtime-2.1", "gpt-realtime-translate", "gpt-transcribe", "gpt-audio-1.5",
  "gpt-4o-mini-tts", "whisper-1", "tts-1", "text-embedding-3-large", "omni-moderation-latest", "dall-e-3", "sora-2", "gpt-4o-search-preview", "computer-use-preview", "o3-deep-research", "gpt-4o", "gpt-4o-2024-08-06"];
const all = new Set(OPENAI);
const chat = OPENAI.filter((id) => !R.nonChat(id) && !R.datedDuplicate(id, all));
ok(JSON.stringify(chat) === JSON.stringify(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "chat-latest", "gpt-4o"]), "OpenAI: chỉ còn model nhắn tin, bỏ bản chụp trùng tên chung", chat.join());
const GOOGLE = ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.8-live", "gemini-3.8-flash-tts", "gemini-3.1-flash-image", "gemini-3.5-transcribe", "gemini-omni-1.1-flash", "gemini-robotics-er-2-preview", "gemini-embedding-2-preview", "lyria-3.5", "imagen-4", "veo-3"];
ok(GOOGLE.filter((id) => !R.nonChat(id)).join() === "gemini-4-argon,gemini-3.8-flash", "Gemini: bỏ live / tts / image / transcribe / omni / robotics / embedding / lyria / imagen / veo", GOOGLE.filter((id) => !R.nonChat(id)).join());
const XAI = ["grok-5", "grok-4.7", "grok-imagine-image", "grok-imagine-video", "grok-2-image-1212", "grok-5-voice"];
ok(XAI.filter((id) => !R.nonChat(id)).join() === "grok-5,grok-4.7", "xAI: bỏ model tạo ảnh / video / giọng nói");
ok(!R.datedDuplicate("claude-opus-4-5-20251101", new Set(["claude-opus-4-5-20251101"])), "bản chụp có ngày mà không có tên chung thì giữ (Anthropic đời 4.5)");
ok(R.datedDuplicate("grok-2-1212", new Set(["grok-2", "grok-2-1212"])), "hậu tố 4 chữ số kiểu cũ (grok-2-1212) trùng tên chung thì bỏ");

console.log("4. Hạng model theo chữ, không theo chuỗi con");
const T = (k) => `${RT.tierOf(k)}${RT.profileOf(k).frontier ? "+" : ""}`;
const TIERS = [["google/gemini-5", "balanced"], ["google/gemini-4.5-pro", "strong"], ["google/gemini-4-argon", "strong+"], ["google/gemini-3.5-flash-lite", "fast"],
  ["anthropic/claude-opus-6", "strong"], ["anthropic/claude-fable-5-1", "strong+"], ["anthropic/claude-mythos-6", "strong+"], ["anthropic/claude-haiku-6", "fast"], ["anthropic/claude-sonnet-6", "balanced"],
  ["openai/gpt-7-sol", "balanced"], ["openai/gpt-6-astra", "strong+"], ["openai/gpt-6-luna", "fast"], ["openai/gpt-5.4-nano", "fast"], ["openai/o5", "balanced"], ["openai/o5-pro", "strong"],
  ["xai/grok-4.7", "strong"], ["xai/grok-10", "strong"], ["xai/grok-4.3", "balanced"], ["xai/grok-5-fast", "fast"], ["deepseek/deepseek-v4-pro", "strong"], ["deepseek/deepseek-flash", "fast"],
  ["sub-claude/opus", "strong"], ["sub-claude/haiku", "fast"], ["sub-codex/gpt-oss-120b", "fast"]];
for (const [k, want] of TIERS) ok(T(k) === want, `${k} → ${want}`, T(k));
ok(RT.vendorOf("sub-codex/gpt-oss-120b") === "other", "model mã nguồn mở qua gói không mang thế mạnh của hãng lớn");

console.log("5. Bản mới nhất của dòng và chế độ Tự động");
const pool = ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash"];
const old = R.supersededSet([...pool, "anthropic/claude-opus-6"]);
ok(old.has("anthropic/claude-opus-5-5") && old.size === 1, "claude-opus-6 thay chỗ claude-opus-5-5 trong dòng Opus", [...old].join());
const q = { text: "Xây dựng ứng dụng web quản lý kho hàng đầy đủ: đăng nhập, phân quyền, báo cáo, kiểm thử tự động, triển khai lên máy chủ", attachments: 0, turns: 1, studio: false };
const before = RT.routeModel(q, pool), after = RT.routeModel(q, [...pool, "anthropic/claude-opus-6"]);
ok(before?.model === "anthropic/claude-opus-5-5", `trước: việc khó → Opus 5.5 (${before?.model})`, JSON.stringify(before));
ok(after?.model === "anthropic/claude-opus-6" && after.alt.includes("anthropic/claude-opus-5-5"), `hãng ra Opus 6 → Tự động dùng Opus 6, Opus 5.5 vẫn là dự phòng (${after?.model})`, JSON.stringify(after));
// Thứ tự trong danh sách không còn quyết định: bản mới đứng sau vẫn thắng.
const late = RT.routeModel(q, ["anthropic/claude-opus-5-5", ...pool.slice(1), "anthropic/claude-opus-6"]);
ok(late?.model === "anthropic/claude-opus-6", "bản mới đứng cuối danh sách (Gemini không xếp theo ngày) vẫn được chọn", late?.model);
const g = RT.routeModel({ text: "Xin chào", attachments: 0, turns: 1, studio: false }, ["google/gemini-3.8-flash", "google/gemini-4.5-flash"]);
ok(g?.model === "google/gemini-4.5-flash", `câu chào: hai bản Flash → bản mới (${g?.model})`, g?.model);
ok(RT.sideModel(["anthropic/claude-haiku-5-5", "anthropic/claude-haiku-6"]) === "anthropic/claude-haiku-6", "việc phụ cũng dùng bản rẻ mới nhất của dòng");

console.log("6. Tham số theo dòng");
ok(R.anthropicWebSearch("claude-opus-6") === "web_search_20260209" && R.anthropicWebSearch("claude-sonnet-4-6") === "web_search_20260209" && R.anthropicWebSearch("claude-fable-6") === "web_search_20260209", "Opus 6, Sonnet 4.6, Fable 6: công cụ tìm web bản lọc động");
ok(R.anthropicWebSearch("claude-haiku-5-5") === "web_search_20250305" && R.anthropicWebSearch("claude-opus-4-5-20251101") === "web_search_20250305", "Haiku, Opus 4.5: bản cơ bản");
const pr = R.providerPrice({ id: "x", pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000002" } });
ok(pr?.in === 2 && pr.out === 10 && pr.cache === 0.2, "giá hãng tự báo theo token → USD / 1 triệu token", JSON.stringify(pr));
ok(R.providerPrice({ pricing: { prompt: "0", completion: "0" } }) === null && R.providerPrice({}) === null, "giá 0 hoặc không có giá: không dùng (không bao giờ tính 0)");
ok(C.equivalentModel("sub-claude/opus", [{ key: "anthropic/claude-opus-6", id: "claude-opus-6" }, { key: "anthropic/claude-sonnet-5-5", id: "claude-sonnet-5-5" }]) === "anthropic/claude-opus-6", "gói ↔ API: Opus của gói tương đương Opus 6 của khóa API");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
