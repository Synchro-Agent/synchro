# Sao lưu liên tục lên Cloudflare R2

Synchro chạy [Litestream](https://litestream.io) cạnh web: mọi thay đổi của cơ sở dữ liệu (`data/synchro.db`: tài khoản, phiên, bộ não, artifact, việc tự động…) được đẩy lên bucket R2 của bạn trong vòng vài giây. Mất cả máy chủ thì chỉ mất vài giây dữ liệu cuối. Bản sao lưu hằng đêm (`ops/backup.sh`, 03:00) vẫn chạy như cũ; tệp tải lên và tệp do code tạo vẫn chỉ nằm trong bản sao lưu hằng đêm.

Chưa làm các bước dưới đây thì không gì thay đổi: Synchro không chạy Litestream, không gọi ra ngoài.

## Việc chủ dịch vụ cần làm (một lần)

### 1. Bật R2 trên tài khoản Cloudflare đang giữ synchro.net.nz

1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com) bằng tài khoản đang quản lý tên miền synchro.net.nz.
2. Thanh bên trái → **R2 Object Storage**. Lần đầu Cloudflare hỏi thông tin thanh toán để bật R2: gói miễn phí gồm 10 GB lưu trữ, 1 triệu thao tác loại A và 10 triệu thao tác loại B mỗi tháng, không mất phí truyền dữ liệu ra. Cơ sở dữ liệu của Synchro hiện nhỏ hơn nhiều so với 10 GB.
3. Ghi lại **Account ID** (32 ký tự, ở cột phải của trang R2 hoặc trang tổng quan của tài khoản).

### 2. Tạo bucket

1. R2 → **Create bucket**.
2. Tên: `synchro-backup` (hoặc tên khác, chỉ chữ thường, số, dấu gạch ngang).
3. Location: **Automatic** (hoặc chọn gần máy chủ). Default storage class: **Standard**.
4. Không bật Public access. Bucket này chỉ Synchro đọc ghi.

### 3. Tạo khóa API chỉ dùng được cho bucket này

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket(s): **Apply to specific buckets only** → chọn `synchro-backup`. Khóa này không đọc được bucket nào khác.
4. TTL: Forever (hoặc đặt hạn rồi nhớ thay trước khi hết hạn).
5. Bấm **Create API Token**. Cloudflare hiện **Access Key ID** và **Secret Access Key** đúng một lần: chép ngay. (Bỏ qua dòng "Token value", Synchro không dùng.)

### 4. Dán vào Synchro

1. Đăng nhập Synchro bằng tài khoản quản trị viên → **Cài đặt → Sức khỏe hệ thống → Sao lưu liên tục**.
2. Điền **Account ID**, **Bucket**, **Access Key ID**, **Secret Access Key**. **Thư mục trong bucket** để mặc định `synchro`.
3. Bấm **Lưu**, rồi bật **Sao lưu liên tục**.
4. Chờ khoảng một phút rồi bấm **Kiểm tra khôi phục**. Kết quả đúng là "Khôi phục được", `integrity_check: ok`, số dòng các bảng khớp (hoặc gần khớp) với cột "Đang chạy".

Khóa bí mật được mã hóa trong cơ sở dữ liệu như các khóa API khác và không bao giờ gửi xuống trình duyệt; ô khóa bí mật để trống khi lưu nghĩa là giữ khóa cũ. Litestream nhận khóa qua biến môi trường của tiến trình, tệp cấu hình `data/litestream/litestream.yml` (quyền 0600) không chứa khóa.

## Máy chủ

- `ops/setup.sh` (mỗi lần deploy đều chạy) cài Litestream **0.5.17** vào `/usr/local/bin/litestream`, tải từ bản phát hành chính thức trên GitHub và **kiểm sha256** trước khi cài; đã đúng bản thì không tải lại. Lỗi tải không làm hỏng deploy, trang Sức khỏe hệ thống báo "Máy chủ chưa cài litestream".
- Web tự chạy `litestream replicate` khi đã bật và có tệp chạy, chạy lại khi đổi cài đặt, tự chạy lại khi tiến trình chết (chờ lâu dần tới 5 phút), dừng khi web tắt. Lần khởi động sau dừng tiến trình mồ côi của lần trước (`data/litestream/replicate.pid`).
- Trạng thái trên trang: lần đồng bộ gần nhất, số giao dịch còn chậm so với dữ liệu đang chạy, TXID mới nhất trên R2 / trên máy (Litestream 0.5 đánh số theo giao dịch thay cho "generation" của bản 0.3), lỗi gần đây của Litestream.

## Khôi phục khi mất máy chủ

Trên máy mới (đã cài Synchro, chưa chạy web):

```bash
export LITESTREAM_ACCESS_KEY_ID=...        # Access Key ID ở bước 3
export LITESTREAM_SECRET_ACCESS_KEY=...    # Secret Access Key ở bước 3
litestream restore -o /var/www/synchro/data/synchro.db \
  "s3://synchro-backup/synchro?endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com&region=auto"
chown synchro:synchro /var/www/synchro/data/synchro.db
```

Sau đó chép lại `data/secret.key` (hoặc đặt đúng `DATA_KEY`) từ bản sao lưu hằng đêm: thiếu khóa này thì token connector, khóa API và đăng nhập đã lưu không mở được. Tệp tải lên lấy từ bản sao lưu hằng đêm.

## Đổi hoặc thu hồi khóa

Tạo khóa mới ở bước 3, dán vào trang (chỉ cần Access Key ID và Secret Access Key mới), bấm Lưu: Litestream chạy lại với khóa mới. Sau đó xóa khóa cũ trên Cloudflare. Nút **Xóa** trên trang dừng sao lưu liên tục và xóa khóa khỏi máy chủ; các bản đã có trong bucket vẫn còn.
