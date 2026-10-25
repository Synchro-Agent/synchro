import type { Metadata } from "next";
import { LegalDoc } from "../legal/doc";

export const metadata: Metadata = { title: "Điều khoản sử dụng – Synchro" };

export default function Terms() {
  return (
    <LegalDoc title="Điều khoản sử dụng" updated="25/10/2026">
      <p>Synchro (synchro.net.nz) là trợ lý AI dùng cá nhân: chỉ chủ sở hữu đăng nhập và sử dụng được, không mở đăng ký cho người khác.</p>
      <h2>Tài khoản</h2>
      <ul>
        <li>Chỉ email của chủ sở hữu đăng nhập được (bằng Google hoặc mật khẩu đặt trên máy chủ).</li>
        <li>Chủ sở hữu chịu trách nhiệm giữ an toàn cho tài khoản, mật khẩu và các khóa API đã nhập.</li>
      </ul>
      <h2>Sử dụng</h2>
      <ul>
        <li>Không dùng Synchro cho hoạt động vi phạm pháp luật, phát tán mã độc hoặc tấn công hệ thống khác.</li>
        <li>Câu trả lời do AI tạo ra có thể sai; hãy tự kiểm tra trước khi dựa vào chúng cho quyết định quan trọng.</li>
        <li>Việc dùng model AI còn tuân theo điều khoản của từng nhà cung cấp (Anthropic, OpenAI, Google, ElevenLabs) mà khóa API thuộc về.</li>
      </ul>
      <h2>Thay đổi</h2>
      <p>Điều khoản có thể được cập nhật; ngày cập nhật gần nhất luôn ghi ở đầu trang.</p>
    </LegalDoc>
  );
}
