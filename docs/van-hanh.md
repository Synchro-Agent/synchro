# Vận hành Synchro

## Kiểm tra sức khỏe

`GET /api/health` (công khai): `{ ok, build, db, disk, agent }`, 200 khi ổn, 503 khi có cờ `false`. Chỉ có cờ đúng / sai.

- `db`: ghi được SQLite. `disk`: còn trên 1 GB trống. `agent`: dịch vụ workspace trả lời (`null` nếu máy không bật workspace).
- Trỏ một dịch vụ theo dõi ngoài vào `https://synchro.net.nz/api/health` để biết khi web chết. Máy chủ không tự báo được khi chính nó chết.

## Sức khỏe hệ thống và watchdog

Quản trị viên xem ở **Cài đặt → Sức khỏe hệ thống**: lỗi máy chủ gần đây (đã bỏ email, token), người bị hãng từ chối đăng nhập gói AI, đĩa, thư gửi lỗi và nút gửi thử, tuổi và kết quả kiểm tra của bản sao lưu mới nhất, watchdog. Vấn đề nghiêm trọng (đĩa, thư, sao lưu, từ 3 người mất đăng nhập gói) còn được báo vào Hộp thư và email của quản trị viên, mỗi loại tối đa một lần mỗi ngày.

`workspace/setup.sh` (deploy chạy mỗi lần) cài `synchro-watchdog.timer`: mỗi phút gọi `/api/health` ở máy chủ. Web không trả lời hoặc `db` sai 3 lần liên tiếp thì `pm2 restart`; tối thiểu 10 phút giữa hai lần, tối đa 3 lần mỗi giờ. Đang deploy thì bỏ qua (khóa `/run/synchro-deploy.lock`). Báo 503 vì đĩa hay dịch vụ workspace thì chỉ ghi lại, khởi động lại web không chữa được.

```bash
systemctl status synchro-watchdog.timer
cat /var/lib/synchro-ops/watchdog-state.json; tail /var/lib/synchro-ops/watchdog.jsonl
```

Cấu hình ở `/etc/synchro-ops.env` (chỉ root đọc): `APP`, `PM2`, `PORT`, `WEB_USER`, `SYNCHRO_BACKUP_HOOK`.

Quyền sở hữu: `scripts/server-build.sh` để thư mục app, `scripts/`, `workspace/` thuộc root; dịch vụ workspace chạy từ `/opt/synchro-ws` (bản sao, chỉ root ghi). Web user chỉ ghi được `data/`, `.cache/`, `.next/`, `node_modules/`, `.mkvenv/` và mã ứng dụng của chính nó. Tiến trình đọc tệp tải lên (`scripts/extract-worker.mjs`) chạy ưu tiên thấp, giới hạn bộ nhớ (`SYNCHRO_PARSE_HEAP_MB`, 1024), thời gian (`SYNCHRO_PARSE_MS`), số việc cùng lúc (`SYNCHRO_PARSE_MAX`, 2), không có biến môi trường bí mật, và theo mô hình quyền của Node chỉ đọc được mã của chính nó.

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

`scripts/backup.sh` tạo bản sao cục bộ nhất quán, 7 bản ngày và 4 bản tuần. `workspace/setup.sh` tự thêm lịch nếu máy chưa có:

```
# /etc/cron.d/synchro-backup
0 3 * * * root bash /var/www/synchro/scripts/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
```

Sau mỗi bản, script mở lại chính bản vừa lưu và kiểm tra (`integrity_check`, số bảng, số tài khoản, có `secret.key`, đủ tệp tải lên), ghi vào `/var/lib/synchro-ops/backup-status.json`. Trang Sức khỏe hệ thống báo khi lỗi hoặc quá 36 giờ không có bản mới. Đây chưa phải diễn tập khôi phục: vẫn làm phần "Khôi phục" dưới đây mỗi quý.

Trong mỗi bản: `synchro.db` (đã chạy `integrity_check`), `data/` (trừ kho skill dựng sẵn và bản cài CLI), `uploads/` (tệp tải lên), `engine-logins/`, `env.production`, `synchro-ws.env`.

Không có trong bản sao, tải / dựng lại được: `data/skills/_plugins`, bản cài CLI, thư mục làm việc của CLI, workspace của người dùng ở `/srv/synchro-ws` (giới hạn 5 GB mỗi người, tổng có thể rất lớn; nếu muốn giữ, cần chọn nơi lưu riêng).

Bản sao nằm cùng đĩa với dữ liệu, nên **không chống được hỏng đĩa hay mất máy chủ**. Muốn chống phải đẩy ra ngoài và mã hóa, vì bản sao chứa `data/secret.key` và tệp môi trường. Đặt lệnh trong `/etc/synchro-ops.env` (không đặt trong `.env.production`: lệnh này chạy bằng root):

```bash
# Ví dụ: mã hóa bằng age với khóa công khai (khóa riêng giữ ngoài máy chủ) rồi đẩy đi bằng rclone. Nơi lưu do chủ dịch vụ chọn.
SYNCHRO_BACKUP_HOOK=/root/synchro-offsite.sh
```

Lệnh nhận đường dẫn bản vừa tạo làm tham số đầu; lỗi thì bản cục bộ vẫn giữ và trang sức khỏe báo.

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
- Khi dừng vì vượt hạn mức hoặc đĩa sắp đầy, dịch vụ xóa thêm bộ nhớ đệm của workspace đó (`.cache`, `.npm/_cacache`, thư mục giữ lại giữa các lần chạy). Không đụng tệp của người dùng.
- Đây là kiểm tra định kỳ, không phải hạn mức của hệ thống tệp: một lệnh `dd` nhanh vẫn ghi được vài GB trong một phút. Muốn chặn cứng cần đặt `/srv/synchro-ws` trên phân vùng riêng có project quota (XFS / ext4).
- Tệp tải lên: 2 GB mỗi tài khoản (`SYNCHRO_UPLOAD_QUOTA_MB`), 300 tệp mỗi giờ; đĩa dưới 2 GB trống (`SYNCHRO_MIN_FREE_MB`) thì từ chối tệp mới. Người dùng tự xóa tệp ở Cài đặt → Quyền riêng tư.
- Tệp do code tạo: 5 GB mỗi tài khoản (`SYNCHRO_OUTPUT_QUOTA_MB`), vượt thì xóa tệp cũ nhất; đĩa dưới mức trên thì không lưu tệp mới và báo cho model. Tệp quá 30 ngày được dọn mỗi ngày.

## Xác minh email

Tài khoản đăng ký bằng mật khẩu sau khi có tính năng này nhận thư xác minh; chưa xác minh vẫn chat được, nhưng chưa dùng được tệp đính kèm, connector, tác vụ, giọng nói, Synchro Code (Cài đặt → Quản trị viên → "Require a verified email": tắt khi thư đang lỗi). Tài khoản cũ và tài khoản Google, GitHub, Apple không bị ảnh hưởng. Mốc phân biệt: `settings.verify_since`.
