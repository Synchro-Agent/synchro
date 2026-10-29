// Kiểu trả lời của Synchro Code (Cài đặt → Synchro Code → Kiểu trả lời, hoặc menu của từng phiên). Dùng ở trình duyệt và máy chủ.
export type CodeStyle = "default" | "explain" | "learn";
export const STYLE_LABEL: Record<CodeStyle, string> = { default: "Mặc định", explain: "Giải thích", learn: "Học cùng" };
export const STYLE_DESC: Record<CodeStyle, string> = {
  default: "Làm việc gọn, tập trung vào kết quả.",
  explain: "Vừa làm vừa giải thích lựa chọn trong code và cách code này chạy.",
  learn: "Cùng làm: Synchro để lại vài phần nhỏ, có ý nghĩa cho bạn tự viết, rồi xem lại giúp bạn.",
};
export const STYLE_SYS: Record<CodeStyle, string> = {
  default: "",
  explain: `<output_style name="Giải thích">
Người dùng muốn hiểu code chứ không chỉ nhận kết quả. Vẫn làm trọn việc được nhờ, đồng thời:
- Sau mỗi thay đổi đáng kể, thêm một khối ngắn bắt đầu bằng "★ Điểm đáng chú ý" (2–3 gạch đầu dòng): vì sao chọn cách này, đánh đổi gì, mẫu / quy ước của codebase vừa dùng.
- Giải thích cụ thể cho codebase này, không lý thuyết chung chung; không lặp lại điều hiển nhiên.
- Giữ phần giải thích ngắn hơn phần việc; không giải thích khi việc chỉ là đổi tên hay sửa chữ.
</output_style>`,
  learn: `<output_style name="Học cùng">
Người dùng muốn học bằng cách tự tay viết một phần code. Vẫn làm phần lớn việc (khung, phần lặp lại, phần dễ sai), nhưng:
- Chọn 1–2 chỗ nhỏ mà có ý nghĩa (5–15 dòng: một quy tắc nghiệp vụ, một cách xử lý lỗi, một lựa chọn thuật toán) để người dùng tự viết.
- Ở chỗ đó để lại "TODO(bạn): …" trong code, kèm chú thích ngắn: cần làm gì, gợi ý hướng, các lựa chọn và đánh đổi.
- Trong câu trả lời, mở bằng mục "✍️ Phần của bạn" nêu rõ tệp, vị trí và việc cần viết; rồi dừng chờ người dùng viết xong.
- Khi người dùng báo đã viết xong: đọc lại, chạy thử, góp ý cụ thể và hoàn thiện phần còn lại.
- Thêm "★ Điểm đáng chú ý" ngắn sau các quyết định quan trọng như kiểu Giải thích.
</output_style>`,
};
export const isStyle = (v: unknown): v is CodeStyle => v === "default" || v === "explain" || v === "learn";
