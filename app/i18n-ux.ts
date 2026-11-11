// Bản dịch cho các trạng thái lỗi, tải, trống và trợ năng (trang lỗi, thẻ lỗi của lượt chat, phiên hết hạn, làm quen tài khoản mới…).
export const UX_VI2EN: Record<string, string> = {
  // Trang lỗi, 404, khung lỗi
  "Synchro gặp lỗi khi hiển thị trang này": "Synchro hit an error showing this page",
  "Đoạn chat và phần bạn đang gõ vẫn còn. Tải lại trang để dùng tiếp.": "Your chats and what you were typing are still here. Reload the page to continue.",
  "Tải lại trang": "Reload page", "Đoạn chat mới": "New chat",
  "Không tìm thấy trang này": "We can't find that page",
  "Địa chỉ có thể đã gõ sai, hoặc trang đã được chuyển đi nơi khác.": "The address may be mistyped, or the page has moved.",
  "Về trang chủ": "Back to home", "Không tìm thấy trang – Synchro": "Page not found – Synchro",
  "Chính sách quyền riêng tư – Synchro": "Privacy policy – Synchro", "Điều khoản sử dụng – Synchro": "Terms of use – Synchro",
  "Phần này gặp lỗi khi hiển thị": "This part hit a display error",
  "Các phần khác của Synchro vẫn dùng được bình thường.": "The rest of Synchro still works normally.",
  "Thử lại": "Try again",
  // Thẻ lỗi của lượt chat
  "Model chưa khởi động được trên máy chủ. Hãy thử lại hoặc chọn model khác.": "The model couldn't start on the server. Try again or pick another model.",
  "Mất kết nối tới model. Hãy kiểm tra mạng rồi thử lại.": "Lost the connection to the model. Check your network and try again.",
  "Model dừng đột ngột giữa lượt trả lời. Hãy thử lại hoặc chọn model khác.": "The model stopped unexpectedly during its reply. Try again or pick another model.",
  "Lượt này gặp lỗi ở máy chủ. Hãy thử lại hoặc chọn model khác.": "This turn hit a server error. Try again or pick another model.",
  "Không thể kết nối tới model. Vui lòng thử lại.": "Couldn't connect to the model. Please try again.",
  "Câu trả lời chưa hoàn thành": "This reply didn't finish", "Chi tiết kỹ thuật": "Technical details", "Mở Providers": "Open Providers",
  "Không lấy được nội dung tệp đính kèm. Hãy gửi lại.": "Couldn't read the attached file. Please send it again.",
  // Phiên hết hạn, làm quen tài khoản mới, trợ năng
  "Phiên đăng nhập đã hết hạn. Đăng nhập lại để dùng tiếp, phần đang làm vẫn được giữ.": "Your session has expired. Sign in again to continue. Your work is still here.",
  "Kết nối gói AI của bạn để bắt đầu": "Connect your AI plan to get started",
  "Synchro chạy bằng chính tài khoản AI của bạn. ChatGPT, Gemini và Grok dùng được cả tài khoản miễn phí, Claude cần gói Pro hoặc Max. Đăng nhập một tài khoản là chat được ngay, tin bạn đã gõ dưới đây vẫn được giữ.": "Synchro runs on your own AI account. ChatGPT, Gemini and Grok work on a free account; Claude needs a Pro or Max plan. Sign in to one and you can chat right away. What you've typed below stays here.",
  "Hãy kết nối một gói AI để gửi tin này": "Connect an AI plan to send this message",
  "Đang tải": "Loading", "Đến nội dung chính": "Skip to main content", "Ngôn ngữ": "Language",
  "Chưa tải được danh sách artifact": "Couldn't load your artifacts", "Chưa tải được Hộp thư": "Couldn't load your Inbox",
  "Hướng dẫn và khả năng": "Instructions and capabilities",
  // Terminal của Synchro Code, các thẻ làm việc
  "Đã ngắt kết nối": "Disconnected", "Đang nối lại…": "Reconnecting…", "mất kết nối mạng": "network connection lost", "trang này": "this page", "Rê chuột": "Hover", "Kéo thả": "Drag and drop", "Tải tệp": "Upload file",
  // Sửa tin đã gửi, ô soạn tin
  "Sửa tin nhắn": "Edit message", "Gửi lại": "Send again", "Sao chép": "Copy", "Hủy": "Cancel",
  "Các tin phía sau sẽ được thay bằng câu trả lời mới.": "Later messages will be replaced by the new reply.",
  "Tin nhắn cho Synchro": "Message to Synchro",
  // Nguồn trích dẫn có favicon, logo ứng dụng Composio
  "Tên miền không hợp lệ.": "Invalid domain.",
  "Ứng dụng không hợp lệ.": "Invalid app.",
  "Thiếu tham số.": "Missing parameter.",
  // Thẻ (tag) của đoạn chat
  "Gắn thẻ": "Add tags",
  "Bỏ lọc theo thẻ": "Clear tag filter",
  "Thẻ": "Tags",
  "Tìm hoặc tạo thẻ…": "Find or create a tag…",
  "Tìm hoặc tạo thẻ": "Find or create a tag",
  "Tạo thẻ": "Create tag",
  "Chưa có thẻ nào. Gõ tên rồi nhấn Enter để tạo.": "No tags yet. Type a name and press Enter to create one.",
  "Mỗi đoạn chat có tối đa 8 thẻ.": "Each chat can have up to 8 tags.",
  "Lọc đoạn chat có thẻ": "Show chats tagged",
  "Lọc theo thẻ": "Filter by tag",
  // Sửa tham số công cụ trước khi cho phép
  "đã sửa tham số": "inputs edited",
  "Cho phép với tham số đã sửa": "Allow with edited inputs",
  "Sửa tham số trước khi cho phép": "Edit inputs before allowing",
  "Hủy sửa": "Cancel edit",
  "JSON chưa đúng cú pháp": "Invalid JSON",
  "Tham số phải là một đối tượng JSON ({ … }).": "Inputs must be a JSON object ({ … }).",
  "Tham số (JSON)": "Inputs (JSON)",
  "Tham số hợp lệ. Cho phép sẽ chạy công cụ với tham số đã sửa.": "Inputs are valid. Allowing runs the tool with your edited inputs.",
  "Chưa sửa gì.": "No changes yet.",
  "Tham số quá dài (tối đa 100 KB).": "Inputs are too long (100 KB max).",
  "Câu hỏi này không cho sửa tham số.": "This request can't take edited inputs.",
  "Tham số chưa hợp lệ:": "Inputs aren't valid:",
};
export const UX_RULES_EN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Câu trả lời trong “(.+)” gặp lỗi$/, (m) => `The reply in “${m[1]}” hit an error`],
  [/^Khóa API bị từ chối \((\d+)\): (.*)$/, (m) => `The API key was rejected (${m[1]}): ${m[2]}`],
  [/^Khóa API đã hết số dư, cần nạp thêm ở trang của nhà cung cấp \(402\): (.*)$/, (m) => `The API key is out of credit. Top up on the provider's site (402): ${m[1]}`],
  [/^Không tìm thấy model hoặc địa chỉ API \(404\): (.*)$/, (m) => `Model or API address not found (404): ${m[1]}`],
  [/^Nhà cung cấp đang giới hạn lượt gọi hoặc hết hạn mức \(429\): (.*)$/, (m) => `The provider is rate limiting calls or the quota is used up (429): ${m[1]}`],
];
// Chữ tiếng Anh của Cài đặt (phần gốc viết bằng tiếng Anh, giao diện tiếng Việt dịch sang).
export const UX_EN2VI: Record<string, string> = {
  "Choose": "Chọn", "Default": "Mặc định", "Server runtime": "Máy chủ chạy code",
  "Code runs on the Synchro server.": "Code chạy trên máy chủ Synchro.",
  "Attached files and conversation history count toward the limit of the model you pick. Large files are trimmed to the most relevant parts.": "Tệp đính kèm và lịch sử hội thoại tính vào giới hạn của model bạn chọn. Tệp lớn được rút gọn còn phần liên quan nhất.",
  "Downloads the chats, projects and profile stored in this browser. Brain notes download from Settings → Brain; artifacts and Code sessions download where you use them.": "Tải về đoạn chat, dự án và hồ sơ lưu trong trình duyệt này. Ghi chú của bộ não tải ở Cài đặt → Bộ não; artifact và phiên Code tải ngay nơi bạn dùng chúng.",
  "Every Synchro Code conversation will be deleted from this browser and from the Synchro server, including on your other devices. This can't be undone.": "Mọi cuộc trò chuyện Synchro Code sẽ bị xóa khỏi trình duyệt này và máy chủ Synchro, kể cả trên các thiết bị khác của bạn. Không hoàn tác được.",
  "Turned on": "Đang bật", "List every skill directly": "Liệt kê trực tiếp mọi skill", "Custom connectors": "Connector tùy chỉnh", "Tools that delete data": "Công cụ xóa dữ liệu", "All directory connectors": "Mọi connector trong danh mục", "New sign-ups": "Đăng ký mới", "Apply to administrators": "Áp dụng cho quản trị viên",
  "Edited tool inputs before approving": "Sửa tham số công cụ trước khi duyệt",
};
export const UX_RULES_VI: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(\d+) sessions? in this browser, kept in sync with the Synchro server\.$/, (m) => `${m[1]} phiên trong trình duyệt này, đồng bộ với máy chủ Synchro.`],
];
