# Synchro cho Chrome

Tiện ích này cho Synchro tự làm việc ngay trên trình duyệt của bạn (Chrome, Microsoft Edge, Brave và các trình duyệt nhân Chromium khác) khi bạn nhờ trong khung chat, với mọi model: mở trang, đọc trang, bấm, gõ, điền biểu mẫu, chọn, cuộn, kéo thả, tải tệp lên, chụp màn hình, làm việc với nhiều tab. Synchro dùng luôn các tài khoản bạn đã đăng nhập sẵn trên trình duyệt này.

## Cài đặt (khoảng 1 phút)

1. **Tải tiện ích.** Trong Synchro mở **Cài đặt → Khả năng → Trình duyệt của bạn** (hoặc khung **Trình duyệt → Chrome của bạn**), bấm **Tải tiện ích (.zip)**. Tệp tải về đã ghi sẵn địa chỉ máy chủ Synchro của bạn.
2. **Giải nén** tệp `synchro-chrome.zip`. Bạn được thư mục `synchro-chrome`; để thư mục này ở chỗ cố định, không xóa (trình duyệt chạy tiện ích từ chính thư mục đó).
3. **Mở trang quản lý tiện ích:** gõ `chrome://extensions` vào thanh địa chỉ (Edge: `edge://extensions`, Brave: `brave://extensions`).
4. **Bật Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải trang.
5. Bấm **Load unpacked** (Tải tiện ích đã giải nén) rồi chọn thư mục `synchro-chrome`.
6. Bấm biểu tượng mảnh ghép trên thanh công cụ, **ghim Synchro** để dễ mở. Logo Synchro trên thanh công cụ tự đổi theo giao diện sáng / tối của trình duyệt.

## Ghép nối với tài khoản Synchro

1. Trong Synchro bấm **Lấy mã ghép nối**. Bạn nhận một mã 8 ký tự (ví dụ `ABCD-EFGH`), dùng một lần, hết hạn sau 10 phút.
2. Bấm biểu tượng Synchro trên thanh công cụ của trình duyệt, nhập mã rồi bấm **Kết nối**.
3. Synchro hiện "Đã kết nối". Từ giờ cứ nhờ trong khung chat, ví dụ: "mở Gmail trên Chrome của tôi và tóm tắt thư chưa đọc".

Mỗi tài khoản Synchro ghép nối trình duyệt của mình bằng mã riêng. Trên máy khác, hoặc với tài khoản khác: đăng nhập Synchro bằng tài khoản đó, tải tiện ích, cài và ghép nối lại theo các bước trên. Một tệp .zip dùng chung được cho mọi tài khoản trên cùng máy chủ Synchro (tệp không chứa khóa hay mật khẩu nào).

## Khi Synchro làm việc

- Mặc định Synchro có **toàn quyền**: dùng được mọi tab của trình duyệt. Muốn giới hạn, mở cửa sổ tiện ích và chọn **Chỉ nhóm tab Synchro**: Synchro chỉ làm trên các tab nó tự mở (nhóm tab "Synchro") và tab bạn bấm **Cho Synchro dùng tab này**.
- Mở trang mới thì Synchro dùng tab riêng trong nhóm "Synchro", không đè lên tab bạn đang xem. Synchro không bao giờ điều khiển chính trang Synchro hay trang hệ thống của trình duyệt.
- Tab Synchro đang làm có viền đậm quanh trang, logo Synchro xoay và dải **"Synchro đang điều khiển tab này"** với nút **Dừng**. Bấm Dừng (trên dải, trong cửa sổ tiện ích, ở khung trình duyệt của Synchro, hoặc nút Hủy trên thanh "đang gỡ lỗi trình duyệt này") là Synchro dừng ngay cả lượt đó.
- Trình duyệt hiện thanh "Synchro đã bắt đầu gỡ lỗi trình duyệt này" khi Synchro đang điều khiển. Đó là thông báo bình thường của Chrome cho mọi tiện ích dùng quyền gỡ lỗi; hết lượt Synchro tự thôi điều khiển và thanh này biến mất.
- Cần mật khẩu, mã OTP hay captcha: Synchro nhờ bạn tự nhập ngay trên trình duyệt rồi làm tiếp.

## Gỡ

Synchro → **Cài đặt → Khả năng → Trình duyệt của bạn** → biểu tượng thùng rác cạnh trình duyệt; hoặc **Ngắt ghép nối** trong cửa sổ tiện ích; hoặc gỡ tiện ích ở `chrome://extensions`.

## Quyền tiện ích dùng

- `debugger`: điều khiển trang (bấm, gõ, đọc, chụp màn hình), cùng cách các công cụ tự động hóa trình duyệt làm.
- `tabs`, `tabGroups`: biết các tab, mở tab mới trong nhóm "Synchro".
- `downloads`: báo cho Synchro biết tệp vừa tải về.
- `storage`, `alarms`: lưu khóa ghép nối của trình duyệt này, tự nối lại khi mất kết nối.
- `offscreen`: một trang ẩn đọc giao diện sáng / tối của trình duyệt để logo Synchro trên thanh công cụ đổi theo (bản sáng cho thanh sáng, bản tối cho thanh tối).
- Truy cập mọi trang (`<all_urls>`): kết nối tới máy chủ Synchro của bạn, ở bất kỳ địa chỉ nào.

Khóa ghép nối chỉ lưu trong trình duyệt này; máy chủ Synchro chỉ giữ bản băm và gỡ được bất cứ lúc nào.
