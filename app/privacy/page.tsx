import type { Metadata } from "next";
import { LegalDoc } from "../legal/doc";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư – Synchro" };

export default function Privacy() {
  return (
    <LegalDoc title="Chính sách quyền riêng tư" updated="25/10/2026">
      <p>Synchro (synchro.net.nz) là trợ lý AI dùng cá nhân của chủ sở hữu. Trang này mô tả dữ liệu Synchro lưu và nơi dữ liệu đi tới.</p>
      <h2>Dữ liệu được lưu</h2>
      <ul>
        <li><b>Tài khoản:</b> email, tên hiển thị và ảnh đại diện của chủ sở hữu. Mật khẩu (nếu có) chỉ lưu dạng băm (scrypt).</li>
        <li><b>Đăng nhập bằng Google hoặc GitHub:</b> chỉ nhận email đã xác minh, tên và ảnh đại diện công khai; không truy cập Gmail, Drive hay kho mã.</li>
        <li><b>Phiên đăng nhập và nhật ký bảo mật:</b> thời điểm, địa chỉ IP và loại trình duyệt của các lần đăng nhập, để phát hiện truy cập trái phép.</li>
        <li><b>Nội dung làm việc:</b> đoạn chat và dự án lưu trong trình duyệt; tệp, skill, connector, ứng dụng, tác vụ nền lưu trên máy chủ Synchro.</li>
      </ul>
      <h2>Nội dung gửi tới model AI</h2>
      <p>Tin nhắn và tệp bạn gửi được chuyển thẳng tới nhà cung cấp model (Anthropic, OpenAI, Google, ElevenLabs) qua khóa API của chính bạn để tạo câu trả lời, theo chính sách dữ liệu của nhà cung cấp đó.</p>
      <h2>Không làm</h2>
      <ul>
        <li>Không bán hay chia sẻ dữ liệu cho bên thứ ba để quảng cáo.</li>
        <li>Không dùng cookie quảng cáo hay theo dõi. Cookie duy nhất là cookie phiên đăng nhập.</li>
      </ul>
    </LegalDoc>
  );
}
