import type { Metadata } from "next";
import { LegalDoc } from "../legal/doc";

export const metadata: Metadata = { title: "Điều khoản sử dụng – Synchro" };

export default function Terms() {
  return (
    <LegalDoc title="Điều khoản sử dụng" updated="22/10/2026">
      <p>Khi dùng Synchro (synchro.net.nz), bạn đồng ý với các điều khoản dưới đây.</p>
      <h2>Tài khoản</h2>
      <ul>
        <li>Bạn chịu trách nhiệm giữ an toàn cho tài khoản và mật khẩu của mình.</li>
        <li>Mỗi người chỉ dùng tài khoản của chính mình; không chia sẻ hay mua bán tài khoản.</li>
      </ul>
      <h2>Sử dụng hợp lệ</h2>
      <ul>
        <li>Không dùng Synchro cho hoạt động vi phạm pháp luật, gây hại cho người khác, phát tán mã độc hoặc tấn công hệ thống.</li>
        <li>Không cố truy cập dữ liệu của người dùng khác hoặc các phần quản trị.</li>
        <li>Câu trả lời do AI tạo ra có thể sai; hãy tự kiểm tra trước khi dựa vào chúng cho quyết định quan trọng.</li>
      </ul>
      <h2>Tạm khóa và chấm dứt</h2>
      <p>Quản trị viên có thể tạm khóa hoặc xóa tài khoản vi phạm các điều khoản này. Bạn có thể tự xóa tài khoản bất cứ lúc nào trong Cài đặt → Tài khoản.</p>
      <h2>Thay đổi</h2>
      <p>Điều khoản có thể được cập nhật; ngày cập nhật gần nhất luôn ghi ở đầu trang.</p>
    </LegalDoc>
  );
}
