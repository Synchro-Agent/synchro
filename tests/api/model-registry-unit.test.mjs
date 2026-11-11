// Sổ model tự cập nhật, phần không cần máy chủ (cơ sở dữ liệu tạm): những lỗi người kiểm tra tìm ra ở nhánh r9-models.
//  - một ảnh hỏng / quá lớn không được tắt đọc ảnh của model cho mọi người; "Thử lại" xóa điều đã học;
//  - xóa hết model đã gỡ của một hãng không làm model mới sau đó thành "nền" (dùng ngay, không thử);
//  - model đã cũ nhường chỗ (màn hình chính, quyền từng tài khoản, model mặc định) cho bản thay thế; lời báo phân biệt "đã gỡ" và "đã có bản mới";
//  - nhà cung cấp nhiều hãng (OpenRouter…): model trùng tên của người khác không chiếm dòng của model chính chủ;
//  - model chưa thử đạt: máy chủ không chạy chat trên nó.
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

process.env.DATA_DIR = mkdtempSync(path.join(process.cwd(), "node_modules", ".cache", "synchro-reg-"));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { modelreg: G, llmcall: L } = await loadTs(["modelreg", "llmcall"]);
const row = (k) => G.listRegistry().find((m) => m.key === k);
const L1 = (ids) => ids.map((id) => ({ id, name: id }));

console.log("1. Ảnh lỗi không tắt đọc ảnh của model");
const img = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }, { type: "text", text: "hi" }] }] };
ok(!L.compatRetry({ kind: "google" }, img, "Unable to process input image"), "Gemini, ảnh hỏng: không lặng lẽ bỏ ảnh (báo lỗi như trước)");
ok(!L.compatRetry({ kind: "compatible" }, img, "Image size exceeds limit"), "nhà cung cấp tương thích, ảnh quá lớn: không bỏ ảnh");
ok(!!L.compatRetry({ kind: "google" }, img, "Image input modality is not enabled for models/gemini-x"), "Gemini báo model không nhận ảnh: gửi lại chỉ có chữ");
ok(!!L.compatRetry({ kind: "xai" }, img, "Image size exceeds limit"), "Grok, DeepSeek: như trước nhánh này (mọi lỗi ảnh → gửi lại chỉ có chữ)");
const R = await loadTs(["modelrules"]).then((m) => m.modelrules);
for (const [m, want] of [["Unable to process input image", false], ["Image size exceeds limit", false], ["Image format not supported", false], ["Invalid image data", false],
  ["This model does not support image input", true], ["Image input is not supported for this model", true], ["model only supports text", true], ["Unsupported input modality: image", true]])
  ok(R.visionUnsupported(m) === want, `"${m}" → ${want ? "model chỉ đọc chữ" : "lỗi của ảnh này, không ghi nhớ"}`);

console.log("2. Nền của một hãng chỉ một lần");
G.syncListed("p1", "compatible", L1(["alpha-1", "alpha-2"]));
ok(row("p1/alpha-1")?.baseline && row("p1/alpha-1")?.status === "active", "lần đầu: cả danh sách là nền, dùng ngay");
G.syncListed("p1", "compatible", []);
G.forget("p1/alpha-1"); G.forget("p1/alpha-2");
ok(!row("p1/alpha-1") && !row("p1/alpha-2"), "quản trị viên xóa hết model hãng đã gỡ");
const s3 = G.syncListed("p1", "compatible", L1(["alpha-3"]));
ok(!s3.baseline && row("p1/alpha-3")?.status === "new", "model mới sau đó vẫn phải thử (không thành nền)", JSON.stringify(row("p1/alpha-3")));
ok(G.untested("p1/alpha-3"), "model chưa thử đạt: máy chủ không chạy chat trên nó");
G.activate("p1/alpha-3");
ok(!G.untested("p1/alpha-3"), "quản trị viên bấm Dùng ngay: chạy được");

console.log("3. Điều đã học được xóa khi Thử lại");
G.learnFromRetry("p1", "alpha-3", { vision: false });
ok(G.modelParams("p1", "alpha-3")?.vision === false, "ghi nhớ model chỉ đọc chữ");
G.queueRetest("p1/alpha-3");
ok(G.modelParams("p1", "alpha-3")?.vision === undefined, "Thử lại: xóa điều đã học để học lại từ đầu", JSON.stringify(G.modelParams("p1", "alpha-3")));

console.log("4. Model đã cũ nhường chỗ cho bản thay thế");
G.syncListed("anthropic", "anthropic", L1(["claude-opus-5-5", "claude-sonnet-5-5"]));
G.syncListed("anthropic", "anthropic", L1(["claude-opus-6", "claude-opus-5-5", "claude-sonnet-5-5"]));
G.activate("anthropic/claude-opus-6");
G.syncListed("anthropic", "anthropic", L1(["claude-opus-6-1", "claude-opus-6", "claude-opus-5-5", "claude-sonnet-5-5"]));
G.activate("anthropic/claude-opus-6-1");
ok(row("anthropic/claude-opus-5-5")?.status === "deprecated", "hai bản Opus mới: Opus 5.5 thành đã cũ", row("anthropic/claude-opus-5-5")?.status);
const rep = G.replacements()["anthropic/claude-opus-5-5"];
ok(rep?.to === "anthropic/claude-opus-6-1" && rep.why === "old", "bản thay thế là Opus 6.1, lý do: đã có bản mới hơn (không phải hãng gỡ)", JSON.stringify(rep));
const main = G.withReplacements(["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5"]);
ok(main.includes("anthropic/claude-opus-6-1") && main.includes("anthropic/claude-sonnet-5-5"), "màn hình chính chỉ chọn Opus 5.5: Opus 6.1 giữ chỗ (bộ chọn không mất Opus)", main.join());
ok(globalThis.__synchroModelAllow?.(["anthropic/claude-opus-5-5"], "anthropic/claude-opus-6-1") === true && globalThis.__synchroModelAllow?.(["anthropic/claude-sonnet-5-5"], "anthropic/claude-opus-6-1") === false,
  "tài khoản chỉ được dùng Opus 5.5 thì được dùng bản thay thế Opus 6.1, không được dùng model khác");
G.syncListed("anthropic", "anthropic", L1(["claude-opus-6-1", "claude-opus-6", "claude-sonnet-5-5"]));
ok(G.replacements()["anthropic/claude-opus-5-5"]?.why === "gone", "hãng gỡ Opus 5.5: lý do đổi thành đã gỡ");

console.log("5. Nhà cung cấp nhiều hãng: model trùng tên không chiếm dòng chính chủ");
G.syncListed("or", "compatible", L1(["deepseek/deepseek-v4-pro", "anthropic/claude-opus-5-5"]));
G.syncListed("or", "compatible", L1(["randomuser/deepseek-v9-pro", "other/deepseek-v8-pro", "x/claude-opus-99", "y/claude-opus-98", "deepseek/deepseek-v4-pro", "anthropic/claude-opus-5-5"]));
for (const k of ["or/randomuser/deepseek-v9-pro", "or/other/deepseek-v8-pro", "or/x/claude-opus-99", "or/y/claude-opus-98"]) G.activate(k);
ok(row("or/deepseek/deepseek-v4-pro")?.status === "active" && row("or/anthropic/claude-opus-5-5")?.status === "active", "model chính chủ không bị coi là đã cũ",
  `${row("or/deepseek/deepseek-v4-pro")?.status} ${row("or/anthropic/claude-opus-5-5")?.status}`);
ok(!G.replacements()["or/anthropic/claude-opus-5-5"], "không ai bị chuyển sang model của người khác");
ok(row("or/x/claude-opus-99")?.family === "x/claude-opus" && row("or/deepseek/deepseek-v4-pro")?.family === "deepseek/deepseek-pro", "dòng model kèm tên hãng gốc");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
