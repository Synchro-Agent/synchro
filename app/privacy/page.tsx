import type { Metadata } from "next";
import { LegalDoc } from "../legal/doc";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư – Synchro" };

export default function Privacy() {
  return (
    <LegalDoc title="Chính sách quyền riêng tư" updated="22/10/2026">
      <p>Trang này mô tả những dữ liệu Synchro (synchro.net.nz) thu thập khi bạn dùng dịch vụ, lý do thu thập và cách bạn kiểm soát chúng.</p>
      <h2>Dữ liệu chúng tôi lưu</h2>
      <ul>
        <li><b>Tài khoản:</b> email, tên hiển thị và ảnh đại diện. Nếu bạn đặt mật khẩu, mật khẩu chỉ được lưu dưới dạng băm (scrypt), không ai đọc được mật khẩu gốc.</li>
        <li><b>Đăng nhập bằng Google hoặc GitHub:</b> chúng tôi chỉ nhận email đã xác minh, tên và ảnh đại diện công khai của bạn. Chúng tôi không truy cập Gmail, Drive, kho mã hay bất kỳ dữ liệu nào khác.</li>
        <li><b>Phiên đăng nhập:</b> thời điểm đăng nhập, địa chỉ IP và loại trình duyệt, để bạn xem và đăng xuất các thiết bị trong Cài đặt → Tài khoản.</li>
        <li><b>Nhật ký bảo mật:</b> các sự kiện đăng ký, đăng nhập, đăng nhập thất bại, dùng để phát hiện truy cập trái phép.</li>
      </ul>
      <h2>Nội dung trò chuyện</h2>
      <p>Các đoạn chat và dự án được lưu trong trình duyệt của bạn và đồng bộ vào tài khoản của bạn trên máy chủ Synchro, để dùng được trên nhiều thiết bị; đoạn chat ẩn danh không rời trình duyệt. Khi bạn tạo liên kết chia sẻ, một bản chụp của đoạn chat được lưu trên máy chủ và ai có liên kết đều xem được, cho tới khi bạn dừng chia sẻ. Xóa đoạn chat sẽ xóa nó khỏi máy chủ, cùng với phần Bộ não đã học từ nó và liên kết chia sẻ. Khi bạn gửi tin nhắn hoặc tệp, nội dung đó được chuyển tới nhà cung cấp mô hình AI để tạo câu trả lời và không được dùng cho mục đích khác.</p>
      <h2>Chúng tôi không làm gì</h2>
      <ul>
        <li>Không bán hay chia sẻ dữ liệu cá nhân cho bên thứ ba để quảng cáo.</li>
        <li>Không dùng cookie quảng cáo hay theo dõi. Cookie duy nhất là cookie phiên đăng nhập.</li>
      </ul>
      <h2>Lưu trữ và xóa dữ liệu</h2>
      <p>Dữ liệu tài khoản được lưu trên máy chủ của Synchro. Bạn có thể xóa tài khoản bất cứ lúc nào trong Cài đặt → Tài khoản → Xóa tài khoản; tài khoản, cách đăng nhập và mọi phiên sẽ bị xóa vĩnh viễn.</p>
      <h2>Liên hệ</h2>
      <p>Nếu có câu hỏi về quyền riêng tư, hãy liên hệ quản trị viên Synchro qua email hỗ trợ hiển thị trên màn hình đăng nhập.</p>
    </LegalDoc>
  );
}
