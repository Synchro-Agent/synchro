// Bản dịch cho phần bảo mật, xác minh email, sức khỏe hệ thống, sao lưu và quản lý tệp (giữ riêng để các phần khác của từ điển không phải đụng tới).
export const OPS_VI2EN: Record<string, string> = {
  "Máy chủ đang đọc nhiều tệp cùng lúc. Hãy thử lại sau ít phút.": "The server is reading many files right now. Try again in a few minutes.",
  "Dung lượng sau khi giải nén quá lớn hoặc file nén bị hỏng": "The archive is too large once unpacked, or it is damaged",
  "Máy chủ sắp hết dung lượng nên tạm thời chưa nhận tệp mới. Hãy thử lại sau.": "The server is nearly out of disk space, so it can't take new files right now. Try again later.",
};
export const OPS_EN2VI: Record<string, string> = {};
type Rule = [RegExp, (m: RegExpMatchArray) => string];
export const OPS_RULES_EN: Rule[] = [
  [/^Bạn đã dùng hết (\d+) MB dung lượng tệp tải lên\. Xóa bớt tệp cũ ở Cài đặt → Quyền riêng tư\.$/, (m) => `You've used all ${m[1]} MB of your upload space. Delete old files in Settings → Privacy.`],
  [/^"(.+)" quá lớn hoặc quá phức tạp để đọc\. Hãy chia nhỏ tệp rồi tải lên lại\.$/, (m) => `"${m[1]}" is too large or too complex to read. Split it into smaller files and upload again.`],
  [/^"(.+)" giải nén ra quá lớn \(trên 200 MB\) nên Synchro không đọc\. Hãy chia nhỏ tệp rồi tải lên lại\.$/, (m) => `"${m[1]}" unpacks to more than 200 MB, so Synchro didn't read it. Split it into smaller files and upload again.`],
  [/^"(.+)" bị hỏng hoặc không đúng định dạng, không mở được\.$/, (m) => `"${m[1]}" is damaged or not in the expected format, so it couldn't be opened.`],
];
export const OPS_RULES_VI: Rule[] = [];
