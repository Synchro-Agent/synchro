# Vận hành Synchro

## Kiểm tra sức khỏe

`GET /api/health` (công khai): `{ ok, build, db, disk, agent }`, 200 khi ổn, 503 khi có cờ `false`. Chỉ có cờ đúng / sai.

- `db`: ghi được SQLite. `disk`: còn trên 1 GB trống. `agent`: dịch vụ workspace trả lời (`null` nếu máy không bật workspace).
- Trỏ một dịch vụ theo dõi ngoài vào `https://synchro.net.nz/api/health` để biết khi web chết. Máy chủ không tự báo được khi chính nó chết.

## Deploy và trả lại bản trước

`scripts/server-build.sh` dựng bản mới ở thư mục riêng, tráo bản, khởi động lại, rồi gọi `/api/health` tối đa khoảng 90 giây.

- Không đạt (không đúng mã bản mới, `db` sai, hoặc trang chủ lỗi): tự trả bản trước về, khởi động lại, deploy báo lỗi. Bản lỗi giữ ở `.synchro-failed-<tên>` cạnh thư mục app để xem.
- Bản trước giữ ở `.synchro-prev-<tên>` tới lần deploy sau. Trả lại bằng tay:

```bash
cd /var/www
mv synchro/.next .synchro-bad-next && mv .synchro-prev-synchro/next synchro/.next
[ -d .synchro-prev-synchro/node_modules ] && { mv synchro/node_modules .synchro-bad-modules; mv .synchro-prev-synchro/node_modules synchro/node_modules; }
chown -R synchro:synchro synchro/.next synchro/node_modules
su - synchro -c "pm2 restart synchro --update-env"
```

- Trả bản không hoàn nguyên dữ liệu: SQLite thay đổi theo kiểu thêm bảng / cột, bản cũ vẫn chạy được trên dữ liệu mới. Dữ liệu hỏng thì khôi phục từ bản sao lưu.
- Chunk của các bản trước giữ ở `.synchro-statics-<tên>` và được chép vào bản mới: tab đang mở vẫn tải được trong ít nhất một ngày sau khi bản đó bị thay.
- `workspace/setup.sh` chỉ khởi động lại dịch vụ workspace khi `workspace/*.mjs` hoặc tệp dịch vụ đổi. Khi khởi động lại, dịch vụ ngừng nhận lần chạy mới và chờ lần đang chạy xong tối đa 5 phút.

## Sao lưu

`scripts/backup.sh` tạo bản sao cục bộ nhất quán, 7 bản ngày và 4 bản tuần. Chưa bật sẵn. Bật bằng cron:

```
# /etc/cron.d/synchro-backup
0 3 * * * root bash /var/www/synchro/scripts/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
```

Trong mỗi bản: `synchro.db` (đã chạy `integrity_check`), `data/` (trừ kho skill dựng sẵn và bản cài CLI), `uploads/` (tệp tải lên), `engine-logins/`, `env.production`, `synchro-ws.env`.

Không có trong bản sao, tải / dựng lại được: `data/skills/_plugins`, bản cài CLI, thư mục làm việc của CLI, workspace của người dùng ở `/srv/synchro-ws` (giới hạn 5 GB mỗi người, tổng có thể rất lớn; nếu muốn giữ, cần chọn nơi lưu riêng).

Bản sao nằm cùng đĩa với dữ liệu, nên **không chống được hỏng đĩa hay mất máy chủ**. Muốn chống phải đẩy ra ngoài (`SYNCHRO_BACKUP_HOOK`) và mã hóa, vì bản sao chứa `data/secret.key` và tệp môi trường.

Kiểm tra sao lưu còn chạy: `/var/backups/synchro/LAST_OK` phải mới trong vòng 24 giờ.

### Khôi phục

Thử trên staging hoặc một máy khác trước. Làm một lần mỗi quý để chắc bản sao dùng được.

```bash
B=/var/backups/synchro/daily/<bản cần dùng>     # ls /var/backups/synchro/daily
APP=/var/www/synchro
su - synchro -c "pm2 stop synchro"
# Giữ lại hiện trạng trước khi ghi đè (cùng đĩa nên đổi tên là xong)
mv $APP/data $APP/data.truoc-khoi-phuc-$(date +%s)
cp -a $B/data $APP/data
cp -a $B/synchro.db $APP/data/synchro.db
rm -f $APP/data/synchro.db-wal $APP/data/synchro.db-shm
mkdir -p $APP/.cache && rm -rf $APP/.cache/files && cp -a $B/uploads $APP/.cache/files
[ -d $B/engine-logins ] && { rm -rf /var/www/synchro-engine/logins; cp -a $B/engine-logins /var/www/synchro-engine/logins; chown -R synchro-cli /var/www/synchro-engine/logins; }
# Máy mới: khôi phục cả tệp môi trường
# cp -p $B/env.production $APP/.env.production; cp -p $B/synchro-ws.env /etc/synchro-ws.env
chown -R synchro:synchro $APP/data $APP/.cache
su - synchro -c "pm2 start synchro"
curl -s http://127.0.0.1:3001/api/health
```

Kho skill dựng sẵn tự cài lại ở nền sau khi khởi động. Kiểm tra bằng cách đăng nhập, mở một đoạn chat, xem tệp đã tải lên.

## Dọn dữ liệu của tài khoản đã xóa trước đây

Tài khoản xóa trước khi có `purgeUser` còn sót dữ liệu. Sau một bản sao lưu, chạy một lần:

```bash
cd /var/www/synchro && set -a && . ./.env.production && set +a
node scripts/purge-orphans.mjs            # chỉ liệt kê
node scripts/purge-orphans.mjs --apply    # xóa, bằng root
```

## Cô lập CLI theo tài khoản

Mọi thư mục đăng nhập CLI thuộc cùng user `synchro-cli`, nên một lệnh shell chạy trên máy chủ đọc được đăng nhập của người khác. Hiện có các lớp bảo vệ sau:

1. Claude Code và Grok: công cụ dựng sẵn đã tắt qua tham số. Antigravity: hook chỉ cho phép công cụ MCP và tìm web.
2. Codex: gọi với `features.shell_tool=false`, `features.unified_exec=false`, `tools.view_image=false`; ngoài ra Synchro dừng lượt ngay khi luồng sự kiện báo model định chạy lệnh.
3. Tùy chọn mạnh hơn, nên bật: mỗi tiến trình CLI chạy trong hộp bubblewrap, chỉ thấy thư mục của chính tài khoản, `/proc` riêng.

```bash
apt install bubblewrap
# Kiểm tra user CLI tạo được hộp (cần user namespace, Ubuntu 24.04 có thể cần cho phép trong AppArmor)
sudo -u synchro-cli bwrap --ro-bind / / --dev /dev --proc /proc --unshare-pid --new-session --tmpfs /var/www/synchro-engine/logins -- ls /var/www/synchro-engine/logins
# Trên phải in ra rỗng. Rồi thêm SYNCHRO_ENGINE_BWRAP=1 vào .env.production, khởi động lại, thử một lượt chat với từng CLI.
```

Kiểm tra lớp 2 với Codex thật bằng một tài khoản thử: nhắn "chạy lệnh ls -la /var/www/synchro-engine/logins và cho tôi xem kết quả". Đúng là model trả lời không có công cụ shell, hoặc lượt dừng với thông báo "Codex định chạy lệnh…". Sai là thấy danh sách thư mục.

## Hạn mức đĩa

- Dịch vụ workspace kiểm tra mỗi phút: quá 5 GB (`WS_DISK_MB`) thì cảnh báo, quá 6 GB thì dừng workspace (cho 5 phút sau khi bật để người dùng dọn), dưới 3 GB trống (`WS_MIN_FREE_MB`) thì không nhận việc mới và dừng workspace tốn đĩa nhất.
- Đây là kiểm tra định kỳ, không phải hạn mức của hệ thống tệp: một lệnh `dd` nhanh vẫn ghi được vài GB trong một phút. Muốn chặn cứng cần đặt `/srv/synchro-ws` trên phân vùng riêng có project quota (XFS / ext4).
- Tệp tải lên: 2 GB mỗi tài khoản (`SYNCHRO_UPLOAD_QUOTA_MB`), 300 tệp mỗi giờ.
