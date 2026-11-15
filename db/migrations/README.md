# Migration cơ sở dữ liệu

Mọi bảng, chỉ mục, trigger và cột của `data/synchro.db` khai ở đây. `db/migrate.mjs` chạy các tệp theo số thứ tự khi máy chủ mở cơ sở dữ liệu (`server/db/db.ts`) và khi chạy `ops/create-admin.mjs`. Số phiên bản đã áp dụng nằm ở `PRAGMA user_version`.

- `NNN_tên.sql`: câu lệnh SQL.
- `NNN_tên.columns.json`: `[{ "table", "column", "def" }]`. Bộ chạy thêm cột nếu bảng chưa có cột đó (`PRAGMA table_info`).

Cả lượt chạy là một giao dịch `BEGIN IMMEDIATE`. Tiến trình thứ hai (deploy xanh/lam dùng chung một cơ sở dữ liệu) đợi tiến trình đầu xong, rồi đọc lại `user_version` trong giao dịch của mình. Lỗi thì `ROLLBACK`, máy chủ không khởi động, deploy quay lại bản cũ. Cơ sở dữ liệu mới hơn mã (đã quay lại bản trước) thì bộ chạy ghi nhật ký rồi chạy tiếp, không hạ phiên bản.

Một tệp mà mọi thứ nó khai đã có sẵn thì bộ chạy chỉ ghi `user_version`, không chạy câu nào. Nhờ vậy cơ sở dữ liệu có từ trước khi có bộ chạy này (phiên bản 0) lên phiên bản mới mà không dữ liệu nào bị đụng tới.

## Quy tắc cho mọi migration mới (`tests/api/migrations.test.mjs` kiểm tra)

1. **Chỉ thêm, không sửa, không bỏ.** Trong lúc deploy xanh/lam, bản cũ và bản mới dùng chung một cơ sở dữ liệu. Quay lại bản trước cũng giữ nguyên cơ sở dữ liệu đã migrate. Vì vậy bản cũ phải chạy được trên lược đồ mới. Muốn đổi tên hay bỏ một cột thì làm ba bước qua ba lần phát hành: thêm cột mới và ghi cả hai cột → phát hành → chuyển sang chỉ đọc cột mới → phát hành → bỏ cột cũ ở một lần phát hành SAU.
2. Tệp `.sql` chỉ chứa `CREATE TABLE | INDEX | UNIQUE INDEX | TRIGGER … IF NOT EXISTS` và `DROP INDEX IF EXISTS`. Không có `DROP TABLE`, `ALTER`, `UPDATE`, `DELETE`, `INSERT`.
3. Cột thêm qua `.columns.json` phải cho phép NULL hoặc có `DEFAULT` hằng số (SQLite chỉ cho `ADD COLUMN` như vậy với bảng đã có dòng). Không dùng `PRIMARY KEY` hay `UNIQUE`.
4. Không sửa tệp đã phát hành. Thay đổi mới là tệp mới, số tiếp theo, không bỏ số.
5. Việc sửa dữ liệu (dọn dòng cũ, chuyển dữ liệu một lần) không đặt ở đây. Việc đó nằm trong mô-đun dùng bảng, có cờ trong `settings` nếu chỉ chạy một lần, ví dụ `run_events_migrated` của `server/runs/store-sqlite.ts`.

## Các tệp hiện có

- `001_baseline.sql`: lược đồ của mã trước khi có bộ chạy, gồm `db/schema.sql` cũ cộng phần mỗi mô-đun tự tạo lúc dùng lần đầu. Có 80 bảng, 42 chỉ mục, 1 trigger. Cột xếp đúng thứ tự như cơ sở dữ liệu đang chạy. `tests/fixtures/schema-v0.sql` là bản dump lược đồ đó, dùng để so sánh.
- `002_reconcile.columns.json`: 54 cột mà bản cũ thêm sau bằng `ALTER TABLE`. Bảng tạo từ bản rất cũ còn thiếu cột nào thì nhận cột đó.
