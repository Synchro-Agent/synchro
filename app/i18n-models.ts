// Bản dịch cho sổ model tự cập nhật: Cài đặt → Providers → New models (chữ gốc tiếng Anh), thông báo và lỗi của máy chủ (chữ gốc tiếng Việt),
// nhãn "Mới" ở bộ chọn model, lời báo khi model đã chọn bị hãng gỡ.
export const MODELS_EN2VI: Record<string, string> = {
  "New models": "Model mới", "Claude plan": "Gói Claude", "ChatGPT plan": "Gói ChatGPT", "Gemini plan": "Gói Gemini", "Grok plan": "Gói Grok",
  "Claude API": "Claude API", "ChatGPT API": "ChatGPT API", "Gemini API": "Gemini API", "Grok API": "Grok API", "DeepSeek API": "DeepSeek API",
  "Waiting for test": "Chờ thử", "Test failed, retrying": "Thử chưa đạt, sẽ thử lại", "In use": "Đang dùng", "Superseded": "Đã có bản mới hơn", "Removed by provider": "Hãng đã gỡ",
  "Text": "Chữ", "Tools": "Công cụ", "Images": "Ảnh", "Hidden": "Đã ẩn", "New": "Mới", "Pinned": "Đã ghim",
  "First seen": "Thấy lần đầu", "Released": "Ra mắt", "Replaced by": "Thay bằng", "Next try": "Thử lại", "Tested": "Đã thử",
  "Test again": "Thử lại", "Use now": "Dùng ngay", "Pin": "Ghim", "Unpin": "Bỏ ghim", "Show": "Hiện", "Hide": "Ẩn", "Remove from list": "Xóa khỏi danh sách",
  "New models found. Results are listed below": "Đã thấy model mới. Kết quả ở bên dưới", "No new models since the last check": "Không có model mới kể từ lần kiểm tra trước",
  "Add new models automatically": "Tự thêm model mới",
  "When a provider releases a model, Synchro tests it with one short message, one tool call and one image, then shows it with a New label. Auto picks the newest model of each line; the previous one stays as a fallback.":
    "Khi hãng ra mắt model, Synchro thử nó bằng một câu ngắn, một lần gọi công cụ và một ảnh, rồi hiện nó với nhãn Mới. Chế độ Tự động chọn bản mới nhất của mỗi dòng; bản trước vẫn là dự phòng.",
  "Last check": "Kiểm tra lần cuối", ". Synchro checks every 6 hours.": ". Synchro tự kiểm tra mỗi 6 giờ.", "Synchro checks every 6 hours.": "Synchro tự kiểm tra mỗi 6 giờ.",
  "Check now": "Kiểm tra ngay", "Checking…": "Đang kiểm tra…", "Recent changes": "Thay đổi gần đây", "All models": "Tất cả model", "Providers": "Nhà cung cấp",
  "No new models yet. Models found here are tested before anyone can use them.": "Chưa có model mới. Model thấy ở đây được thử trước khi ai đó dùng được.",
};
export const MODELS_VI2EN: Record<string, string> = {
  "Mới": "New", "Hãng vừa ra mắt, Synchro đã thử và cho dùng": "Just released by the provider; Synchro tested it and turned it on",
  "Không tìm thấy model này trong sổ.": "This model isn't in the registry.", "Model này không ở trạng thái chờ.": "This model isn't waiting.",
  "Không có khóa API cho nhà cung cấp này.": "There's no API key for this provider.", "Hãng từ chối mọi cách gọi thử.": "The provider rejected every test call.",
  "Model trả lời rỗng.": "The model replied with nothing.", "Model không gọi công cụ khi được yêu cầu.": "The model didn't call the tool when asked.",
  "Model chỉ đọc chữ, ảnh sẽ được thay bằng ghi chú.": "The model reads text only; images will be replaced with a note.", "Không đạt.": "Didn't pass.",
  "Thao tác không hợp lệ.": "Invalid action.", "Chỉ xóa được model hãng đã gỡ.": "Only models the provider removed can be deleted.",
};
const STEP_EN: Record<string, string> = { "chữ": "text", "công cụ": "tools", "ảnh": "images" };
const stepsEn = (s: string) => s.replace(/(chữ|công cụ|ảnh) (✓|✗)/g, (_, w, k) => `${STEP_EN[w]} ${k}`).replace(/model của gói, CLI chính chủ chạy/g, "plan model, run by the provider's own CLI");
export const MODELS_RULES_EN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Synchro đã thêm model mới: (.+)$/, (m) => `Synchro added new models: ${m[1]}`],
  [/^Model mới chưa dùng được: (.+)$/, (m) => `New models not ready yet: ${m[1]}`],
  [/^([\s\S]+)\nModel mới đã hiện ở bộ chọn model với nhãn Mới, chế độ Tự động ưu tiên bản mới nhất của mỗi dòng\.$/, (m) => `${stepsEn(m[1])}\nThe new models now show in the model picker with a New label, and Auto prefers the newest model of each line.`],
  [/^([\s\S]+)\nSynchro sẽ tự thử lại sau; chat không dùng các model này cho tới khi đạt\.$/, (m) => `${stepsEn(m[1])}\nSynchro will try again later; chats won't use these models until they pass.`],
  [/^(.+) không còn dùng được nên Synchro đã chuyển sang (.+)$/, (m) => `${m[1]} is no longer available, so Synchro switched to ${m[2]}`],
];
