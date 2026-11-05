// Đồng bộ ngôn ngữ: mọi chữ giao diện trong app/ phải có bản dịch sang ngôn ngữ còn lại (từ điển app/i18n-dict.ts),
// bản dịch tiếng Anh không được sót chữ tiếng Việt, và các luật dịch chuỗi ghép cho ra đúng câu. Không cần máy chủ.
import { scan } from "../lib/i18n-scan.mjs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 1500)); };

console.log("1. Quét toàn bộ chữ giao diện");
const { total, missing } = await scan();
ok(total > 3000, `tìm thấy ${total} chuỗi giao diện`, total);
const show = (ms) => ms.slice(0, 25).map((m) => `\n     ${m.file}:${m.line} [${m.need}] ${m.text.slice(0, 100)}${m.partial ? ` → ${m.partial.slice(0, 60)}` : ""}`).join("");
ok(!missing.filter((m) => m.need === "en").length, "chữ tiếng Việt đều có bản tiếng Anh", show(missing.filter((m) => m.need === "en")));
ok(!missing.filter((m) => m.need === "vi").length, "chữ tiếng Anh đều có bản tiếng Việt (hoặc là tên riêng / thuật ngữ giữ nguyên)", show(missing.filter((m) => m.need === "vi")));

console.log("2. Dịch đúng câu");
const { "i18n-dict": D0, "i18n-vi": V } = await loadTs(["i18n-dict", "i18n-vi"]);
const D = { ...D0, EN2VI: V.EN2VI, RULES_VI: V.RULES_VI };
const tr = (s, lang) => {
  const map = lang === "en" ? D.VI2EN : D.EN2VI;
  if (Object.prototype.hasOwnProperty.call(map, s)) return map[s];
  for (const [re, f] of lang === "en" ? D.RULES_EN : D.RULES_VI) { const m = s.match(re); if (m) return f(m); }
  return s;
};
ok(tr("Cập nhật lần cuối:", "en") === "Last updated:", "trang điều khoản: “Cập nhật lần cuối:”", tr("Cập nhật lần cuối:", "en"));
ok(tr("Cập nhật 9 giờ trước", "en") === "Updated 9h ago" && tr("Cập nhật vừa xong", "en") === "Updated just now" && tr("Cập nhật", "en") === "Update", "nhãn thời gian “Updated”, nút vẫn là “Update”", tr("Cập nhật 9 giờ trước", "en"));
ok(tr("Giọng trong tài khoản ElevenLabs và thư viện cộng đồng. Đã dùng 3/10 chỗ lưu giọng.", "en") === "Voices in your ElevenLabs account and the community library. 3/10 voice slots used.", "Speech → Giọng nói: câu ghép có số", tr("Giọng trong tài khoản ElevenLabs và thư viện cộng đồng. Đã dùng 3/10 chỗ lưu giọng.", "en"));
ok(tr("Gói Claude của bạn đã hết hạn mức.", "en") === "Your Claude plan has hit its limit.", "thông báo máy chủ có tên gói", tr("Gói Claude của bạn đã hết hạn mức.", "en"));
ok(tr("Signed in with your ChatGPT account · 4 models", "vi") === "Đã đăng nhập bằng tài khoản ChatGPT · 4 model", "Providers: “Signed in with your … · n models”", tr("Signed in with your ChatGPT account · 4 models", "vi"));
ok(tr("Add a file to My Files", "vi") === "Thêm tệp vào Tệp của tôi", "nhãn ghép bằng +", tr("Add a file to My Files", "vi"));
ok(tr("Hội đồng phản biện", "en") === "Critic panel" && tr("Ngữ cảnh gửi cho model", "en") === "Context sent to the model", "chuỗi gọi qua tr(…)");
ok(tr("Nhật ký 2026-10-28", "en") === "Daily note 2026-10-28", "tên nhật ký hằng ngày của bộ não", tr("Nhật ký 2026-10-28", "en"));
ok(D.SAME_WORDS.has("Synchro") && D.SAME_WORDS.has("Claude") && !D.SAME_WORDS.has("Settings"), "tên riêng giữ nguyên, chữ thường vẫn phải dịch");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
