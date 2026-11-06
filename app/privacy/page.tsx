import type { Metadata } from "next";
import { LegalDoc } from "../legal/doc";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư – Synchro" };

// Phải khớp với những gì máy chủ thật sự lưu: thêm loại dữ liệu mới thì thêm vào đây, và vào app/purge.ts nếu lưu ngoài bảng có cột user_id / owner.
export default function Privacy() {
  return (
    <LegalDoc title="Chính sách quyền riêng tư" updated="06/11/2026">
      <p>Trang này mô tả những dữ liệu Synchro (synchro.net.nz) lưu khi bạn dùng dịch vụ, lưu ở đâu, trong bao lâu, gửi cho ai và cách bạn kiểm soát chúng.</p>
      <h2>Dữ liệu lưu trên máy chủ của Synchro</h2>
      <ul>
        <li><b>Tài khoản:</b> email, tên, ảnh đại diện, hồ sơ bạn điền (họ tên, ngày sinh, nghề nghiệp), hướng dẫn tùy chỉnh. Mật khẩu chỉ được lưu dưới dạng băm (scrypt), không ai đọc được mật khẩu gốc. Giữ tới khi bạn xóa tài khoản.</li>
        <li><b>Đăng nhập bằng Google, GitHub hoặc Apple:</b> chúng tôi chỉ nhận email đã xác minh, tên và ảnh đại diện công khai. Không truy cập Gmail, Drive hay dữ liệu nào khác, trừ khi bạn tự kết nối GitHub cho Synchro Code.</li>
        <li><b>Phiên đăng nhập:</b> thời điểm đăng nhập, địa chỉ IP và loại trình duyệt, để bạn xem và đăng xuất các thiết bị trong Cài đặt → Tài khoản. Hết hạn sau 30 ngày không dùng.</li>
        <li><b>Lượt trả lời đang chạy và vừa xong:</b> tin nhắn, câu trả lời, các bước công cụ, để câu trả lời vẫn chạy khi bạn đóng trang. Tự xóa sau 7 ngày; lượt của đoạn chat ẩn danh xóa khoảng 10 phút sau khi xong.</li>
        <li><b>Phiên của ứng dụng AI bạn đã đăng nhập:</b> Claude Code, Codex, Antigravity, Grok chạy trên máy chủ bằng chính gói của bạn. Thông tin đăng nhập của các gói này (được mã hóa hoặc nằm trong thư mục riêng của tài khoản) giữ tới khi bạn đăng xuất gói hoặc xóa tài khoản. Lịch sử phiên do chúng ghi giữ tới khi bạn xóa đoạn chat đó, đăng xuất gói hoặc xóa tài khoản.</li>
        <li><b>Bộ não và bộ nhớ:</b> ghi chú được chắt lọc từ đoạn chat, ký ức, lịch sử hướng dẫn. Giữ tới khi bạn xóa hoặc tắt trong Cài đặt → Bộ não.</li>
        <li><b>Tệp tải lên:</b> tệp gốc và phần chữ trích ra. Chỉ tài khoản đã tải tệp lên đọc được. Giữ tới khi bạn xóa tệp ở Cài đặt → Quyền riêng tư, xóa đoạn chat duy nhất dùng tệp đó, hoặc xóa tài khoản; tệp nhiều người cùng tải lên được xóa khi người cuối cùng bỏ tệp.</li>
        <li><b>Sản phẩm và tệp tạo ra:</b> tệp do model tạo (giữ 30 ngày hoặc tới khi xóa đoạn chat; mỗi tài khoản tối đa 5 GB, đầy thì tệp mới không được lưu cho tới khi bạn xóa bớt hoặc tệp cũ hết hạn), giọng nói đã tạo, artifact, ứng dụng đã xuất bản và dữ liệu của chúng, kết quả công cụ (giữ 30 ngày hoặc tới khi xóa đoạn chat).</li>
        <li><b>Skill, plugin, connector, tác vụ tự động và thông báo:</b> của riêng tài khoản bạn. Token kết nối được mã hóa trước khi lưu.</li>
        <li><b>Synchro Code:</b> phiên làm việc khi bật đồng bộ và tệp trong workspace (container riêng của bạn). Workspace không nằm trong bản sao lưu của máy chủ: hãy đẩy phần quan trọng lên GitHub hoặc tải về. Thư mục làm việc của code chạy trong chat tự xóa sau 24 giờ không dùng.</li>
        <li><b>Mức dùng:</b> số token, model, thời điểm từng lượt, để tính hạn mức.</li>
        <li><b>Nhật ký lỗi:</b> thông báo lỗi kỹ thuật của trang và máy chủ, đã bỏ email và mã bí mật, không chứa tin nhắn. Lỗi đăng nhập gói AI gắn với tài khoản để quản trị viên giúp đăng nhập lại; các lỗi khác không gắn với tài khoản. Chỉ quản trị viên xem, giữ tối đa 30 ngày và 20.000 dòng, để sửa lỗi.</li>
        <li><b>Nhật ký bảo mật:</b> đăng ký, đăng nhập, thao tác quản trị, kèm email và IP, để phát hiện truy cập trái phép. Giữ 50.000 sự kiện gần nhất.</li>
      </ul>
      <h2>Đoạn chat và dự án</h2>
      <p>Đoạn chat, dự án và tùy chọn giao diện nằm trong trình duyệt này; đoạn chat và dự án còn được đồng bộ vào tài khoản của bạn trên máy chủ để dùng được trên nhiều thiết bị. Đoạn chat ẩn danh không đồng bộ vào tài khoản và không vào Bộ não hay bộ nhớ, nhưng vẫn đi qua máy chủ để tới nhà cung cấp AI: lượt trả lời bị xóa khoảng 10 phút sau khi xong, lịch sử phiên của ứng dụng AI bị xóa ngay sau mỗi lượt. Tệp bạn đính kèm và tệp code tạo ra vẫn theo thời hạn thường ở trên. Khi bạn tạo liên kết chia sẻ, một bản chụp của đoạn chat được lưu trên máy chủ và ai có liên kết đều xem được, cho tới khi bạn dừng chia sẻ. Xóa đoạn chat sẽ xóa nó khỏi máy chủ, cùng với phần Bộ não đã học từ nó, liên kết chia sẻ, lịch sử phiên của ứng dụng AI, kết quả công cụ và tệp chỉ đoạn chat đó dùng. Artifact giữ lại trừ khi bạn chọn xóa cùng lúc. Bản đã có trong sao lưu của máy chủ mất đi theo vòng xoay, tối đa khoảng 5 tuần.</p>
      <h2>Dữ liệu được gửi cho ai</h2>
      <ul>
        <li><b>Nhà cung cấp mô hình AI bạn chọn</b> (Anthropic, OpenAI, Google, xAI): tin nhắn, tệp đính kèm, kết quả công cụ của lượt đó, thường qua gói đăng ký bạn đã đăng nhập. Cách họ dùng dữ liệu theo chính sách của họ và gói của bạn.</li>
        <li><b>ElevenLabs:</b> văn bản và âm thanh khi bạn dùng tính năng giọng nói.</li>
        <li><b>Microsoft, Google (giọng đọc video):</b> lời đọc, khi bạn nhờ làm video có giọng và đã bật truy cập mạng cho code.</li>
        <li><b>Connector, GitHub, trang web:</b> chỉ khi bạn kết nối hoặc yêu cầu; nội dung cần cho thao tác đó được gửi tới dịch vụ tương ứng.</li>
      </ul>
      <h2>Ai xem được</h2>
      <p>Trong giao diện, quản trị viên thấy email, tên, phiên đăng nhập, mức dùng và nhật ký bảo mật, không có màn hình đọc đoạn chat của người khác. Người vận hành máy chủ về mặt kỹ thuật có thể truy cập dữ liệu lưu trên máy chủ. Ứng dụng bạn chia sẻ bằng đường dẫn: mọi người có tài khoản Synchro và có đường dẫn đều mở được, kèm dữ liệu chung và bình luận của ứng dụng đó.</p>
      <h2>Chúng tôi không làm gì</h2>
      <ul>
        <li>Không bán hay chia sẻ dữ liệu cá nhân cho bên thứ ba để quảng cáo.</li>
        <li>Không dùng cookie quảng cáo hay theo dõi. Cookie chỉ dùng để giữ phiên đăng nhập và hoàn tất đăng nhập.</li>
      </ul>
      <h2>Xóa dữ liệu</h2>
      <p>Ở Cài đặt → Quyền riêng tư, bạn có thể tải về một tệp gồm hồ sơ, đoạn chat, dự án, artifact, bộ não và bộ nhớ, tác vụ và Hộp thư, liên kết chia sẻ, connector, phiên Synchro Code, ứng dụng và dữ liệu của chúng, bình luận, skill và plugin, cùng danh sách tệp. Nội dung tệp tải lên và tệp tạo ra tải riêng từng tệp, ngay ở đó; tệp trong workspace tải ở Synchro Code. Tệp không gồm mật khẩu băm, khóa và token, mức dùng chi tiết, nhật ký bảo mật. Bạn cũng xóa được từng tệp đã tải lên ở đó.</p>
      <p>Bạn có thể xóa tài khoản bất cứ lúc nào trong Cài đặt → Tài khoản → Xóa tài khoản. Synchro xóa mọi dữ liệu nêu trên của bạn, đăng xuất các gói AI và xóa workspace. Nhật ký bảo mật giữ lại sự kiện nhưng bỏ email và IP, trừ dòng ghi nhận việc xóa tài khoản. Dữ liệu còn trong bản sao lưu của máy chủ (nếu có) mất đi theo vòng xoay, tối đa khoảng 5 tuần. Dữ liệu đã gửi cho nhà cung cấp AI hoặc dịch vụ bạn kết nối do họ giữ theo chính sách của họ.</p>
      <h2>Liên hệ</h2>
      <p>Nếu có câu hỏi về quyền riêng tư, hãy liên hệ quản trị viên Synchro qua email hỗ trợ hiển thị trên màn hình đăng nhập.</p>
    </LegalDoc>
  );
}
