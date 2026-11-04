// Bản dịch cho các trạng thái lỗi, tải, trống và trợ năng (trang lỗi, thẻ lỗi của lượt chat, phiên hết hạn, làm quen tài khoản mới…).
export const UX_VI2EN: Record<string, string> = {
  // Trang lỗi, 404, khung lỗi
  "Synchro gặp lỗi khi hiển thị trang này": "Synchro hit an error showing this page",
  "Đoạn chat và phần bạn đang gõ vẫn còn. Tải lại trang để dùng tiếp.": "Your chats and what you were typing are still here. Reload the page to continue.",
  "Tải lại trang": "Reload page", "Đoạn chat mới": "New chat",
  "Không tìm thấy trang này": "We can't find that page",
  "Địa chỉ có thể đã gõ sai, hoặc trang đã được chuyển đi nơi khác.": "The address may be mistyped, or the page has moved.",
  "Về trang chủ": "Back to home", "Không tìm thấy trang – Synchro": "Page not found – Synchro",
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
  // Sửa tin đã gửi, ô soạn tin
  "Sửa tin nhắn": "Edit message", "Gửi lại": "Send again", "Sao chép": "Copy", "Hủy": "Cancel",
  "Các tin phía sau sẽ được thay bằng câu trả lời mới.": "Later messages will be replaced by the new reply.",
  "Tin nhắn cho Synchro": "Message to Synchro",
};
export const UX_RULES_EN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Khóa API bị từ chối \((\d+)\): (.*)$/, (m) => `The API key was rejected (${m[1]}): ${m[2]}`],
  [/^Khóa API đã hết số dư, cần nạp thêm ở trang của nhà cung cấp \(402\): (.*)$/, (m) => `The API key is out of credit. Top up on the provider's site (402): ${m[1]}`],
  [/^Không tìm thấy model hoặc địa chỉ API \(404\): (.*)$/, (m) => `Model or API address not found (404): ${m[1]}`],
  [/^Nhà cung cấp đang giới hạn lượt gọi hoặc hết hạn mức \(429\): (.*)$/, (m) => `The provider is rate limiting calls or the quota is used up (429): ${m[1]}`],
];
