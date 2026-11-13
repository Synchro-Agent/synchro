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

Cấu hình ở `/etc/synchro-ops.env` (chỉ root đọc): `APP`, `PM2`, `PORT`, `WEB_USER`, `DATA_DIR`, `SYNCHRO_ENGINE_HOME`, `SYNCHRO_BACKUP_HOOK`, `WATCHDOG_ALERT_CMD` (lệnh chạy khi watchdog bỏ cuộc, ví dụ gửi thư bằng `mail` của máy, vì lúc đó web đã chết nên trang Sức khỏe không báo được). Nên đặt `DATA_DIR` ở đây nếu khác `<app>/data`; thiếu thì `backup.sh` đọc từ `.env.production` (của web user) nhưng từ chối nếu thư mục không thuộc `WEB_USER` (mặc định `synchro`) hoặc nằm trong nơi sao lưu.

Giới hạn lượt model (đặt trong `.env.production`): `SYNCHRO_TURNS_PER_ACCOUNT` (mặc định 4, quản trị viên gấp 3), `SYNCHRO_TURNS_ACCOUNT_TOTAL` (tổng mọi làn của một tài khoản, mặc định 6, thêm 2 chỗ cho việc phụ, không quá 60% cả máy), `SYNCHRO_TURN_QUEUE` (8), `SYNCHRO_TURNS_GLOBAL` (mặc định theo RAM: 70% RAM chia 400 MB mỗi CLI, chưa đo RSS thật), `SYNCHRO_MIN_FREE_RAM_MB` (300). Nới riêng một tài khoản bằng cài đặt `turns_limit:<id người dùng>`. Trang Sức khỏe hiện số lượt đang chạy, đang chờ, bị từ chối.

Quyền sở hữu: `scripts/server-build.sh` để thư mục app, `scripts/`, `workspace/` thuộc root; dịch vụ workspace chạy từ `/opt/synchro-ws` (bản sao, chỉ root ghi). Web user ghi được `data/`, `.cache/`, `.next/`, `node_modules/`, `.mkvenv/`, `.env.production` và mã ứng dụng của chính nó, nên script chạy bằng root không được tin các tệp này (`backup.sh` đã làm vậy). Tiến trình đọc tệp tải lên (`scripts/extract-worker.mjs`) chạy ưu tiên thấp, giới hạn bộ nhớ (`SYNCHRO_PARSE_HEAP_MB`, 1024), thời gian (`SYNCHRO_PARSE_MS`), số việc cùng lúc (`SYNCHRO_PARSE_MAX`, 2), không có biến môi trường bí mật, và theo mô hình quyền của Node chỉ đọc được mã của chính nó.

Người dùng mất cả ứng dụng tạo mã lẫn mã dự phòng (xác minh hai bước): sau khi xác nhận đúng chủ tài khoản, chạy trên máy chủ `sqlite3 data/synchro.db "DELETE FROM user_mfa WHERE user_id = '<id>'"`.

## Deploy và trả lại bản trước

`scripts/server-build.sh` dựng bản mới ở thư mục riêng, tráo bản, khởi động lại, rồi gọi `/api/health` tối đa khoảng 90 giây. Đây là cách một tiến trình (staging, production trước khi chuyển); production sau khi chuyển dùng xanh/lam ở mục dưới.

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

## Deploy xanh/lam (production)

Production chạy hai màu trong cùng thư mục `/var/www/synchro` (chung `data/`, `.cache/`, `.env.production`): **blue** = cổng 3000, thư mục build `.next-blue`, pm2 `synchro-blue`; **green** = cổng 3002, `.next-green`, `synchro-green`. Cổng 3001 là staging, không bao giờ dùng. Chỉ một màu nhận lưu lượng; màu kia dừng, giữ bản build trước để trả lại.

- `ecosystem.config.cjs`: chạy thẳng `node node_modules/next/dist/bin/next start -p <cổng>` (không qua npm), `kill_timeout: 30000`, `treekill: false` (pm2 không giết CLI đang trả lời), `NEXT_MANUAL_SIG_HANDLE=1`, `SYNCHRO_ROLE=secondary`, `SYNCHRO_COLOR`.
- `/var/lib/synchro-ops/live-color` (root ghi, ai cũng đọc): `<màu> <cổng> <thư mục app>`. `/etc/nginx/snippets/synchro-upstream.conf` (root): một dòng `proxy_pass http://127.0.0.1:<cổng>;`, site nginx `include` tệp này.
- Vai trò (`app/role.ts`): tiến trình bật lên là secondary, chỉ phục vụ yêu cầu. Nó nhận vai **primary** (litestream, bộ hẹn giờ tác vụ, bộ não, connector, theo dõi PR, cập nhật CLI, dò model, GitHub, dọn dẹp, cài plugin, chạy lại lượt dở dang) khi `live-color` ghi màu của nó **và** tiến trình giữ khóa `data/.primary.pid` đã thoát. Kiểm tra mỗi 3 giây (`SYNCHRO_ROLE_POLL_MS`). Không đặt `SYNCHRO_ROLE` (staging, máy dev) thì là primary ngay như trước.
- Tắt êm (`app/drain.ts`): SIGTERM → `/api/llm`, `/api/agent`, chạy tác vụ ngay trả 503 kèm `Retry-After: 5` (trình duyệt tự gửi lại, tới bản mới); dừng bộ hẹn giờ; chờ tối đa 25 giây (`SYNCHRO_DRAIN_MS`) cho lượt chat và lượt Code đang chạy; dừng litestream; bỏ khóa primary; thoát. Lượt còn dở sau 25 giây giữ trạng thái "đang chạy" và được bản mới chạy lại khi nhận vai primary. Trình duyệt đang theo dõi lượt qua bản mới (SSE) vẫn nhận bước và kết quả của lượt bản cũ đang chạy nốt (đọc cơ sở dữ liệu chung mỗi 1,5 giây).
- Nhật ký: `/home/synchro/.pm2/logs/synchro-<màu>-out.log` (trước đây `synchro-out.log`); dòng `[role]` khi nhận vai primary, `[deploy]` khi tắt êm.
- Ô **Lần khởi động lại web (24 giờ)** đếm lần một tiến trình nhận vai primary: mỗi deploy một lần, bản mới không đạt (chưa từng nhận lưu lượng) không tính.

Mỗi lần deploy, `scripts/server-build.sh` (tự dùng xanh/lam khi `live-color` ghi đúng thư mục app; `BLUEGREEN=1` ép xanh/lam; `BLUEGREEN=0` chỉ dùng được khi app pm2 một tiến trình còn tồn tại, production đã chuyển thì bị từ chối, xem "Bỏ hẳn xanh/lam"):

1. Build ở thư mục tạm (hoặc dùng bản build của CI nếu khớp commit, băm `package-lock.json` và biến `NEXT_PUBLIC_`), node_modules ở `/var/www/.synchro-mods/<băm>/node_modules` (chỉ `npm ci` khi băm đổi).
2. Đặt bản build vào thư mục của màu nghỉ kèm liên kết `.next-<màu>/node_modules` tới thư viện của nó, chép mã mới từ thư mục incoming (nếu deploy từ CI), bật màu nghỉ.
3. `/api/health` ở cổng mới phải báo đúng mã bản mới và `db: true`. Không đạt: dừng màu mới, trả liên kết node_modules và `public/`, `db/` về như cũ, deploy báo lỗi. nginx chưa từng trỏ sang nên người dùng không thấy gì.
4. Ghi tệp upstream, `nginx -t` (lỗi thì trả tệp cũ, dừng màu mới), `nginx -s reload`; kiểm tra qua nginx (`curl --resolve synchro.net.nz:443:127.0.0.1 https://synchro.net.nz/api/health`) thấy mã bản mới, không thì trả nginx về cổng cũ.
5. Ghi `live-color`, `pm2 stop` màu cũ (tắt êm ở trên, tối đa 30 giây), `pm2 save`, dọn node_modules không còn dùng (giữ bản của màu vừa dừng).

Lần sau đổi ngược về màu kia. Watchdog (`scripts/watchdog.sh`) đọc `live-color` để theo dõi và khởi động lại đúng màu (`pm2 restart synchro-<màu>`, không kèm `--update-env`), và vẫn bỏ qua khi đang có khóa deploy.

### Chuyển sang xanh/lam (một lần)

Deploy bản có tệp `ecosystem.config.cjs` bằng cách cũ trước (lần deploy đó vẫn là một tiến trình), rồi chạy bằng root:

```bash
bash /var/www/synchro/scripts/bluegreen-migrate.sh /var/www/synchro synchro /etc/nginx/sites-enabled/synchro
```

Script chạy lại an toàn: tạo `snippets/synchro-upstream.conf` trỏ 3000, thay `proxy_pass http://127.0.0.1:3000;` trong site bằng `include snippets/synchro-upstream.conf;` (sao lưu site ở `/etc/nginx/synchro.before-bluegreen.<giờ>`, `nginx -t` lỗi thì trả lại), chuyển node_modules vào kho theo băm, chép `.next` đang chạy sang `.next-green`, bật `synchro-green` ở 3002, kiểm tra sức khỏe, chuyển nginx sang 3002, chờ lượt của bản cũ (tối đa 25 giây), dừng và xóa app pm2 `synchro`, ghi `live-color` = green, `pm2 save`, cập nhật `PM2`/`PORT` trong `/etc/synchro-ops.env`. `.next` cũ được giữ để trả lại; xóa khi đã yên tâm.

Kiểm tra sau khi chuyển:

```bash
cat /var/lib/synchro-ops/live-color; cat /etc/nginx/snippets/synchro-upstream.conf; cat /var/www/synchro/data/.primary.pid
su - synchro -c "pm2 ls"   # synchro-green online, không còn synchro
grep -c ' 502 ' /var/log/nginx/access.log
```

### Trả lại bản trước bằng tay

Màu nghỉ giữ bản build trước (tới lần deploy sau). Ví dụ đang ở green, trả về blue:

```bash
cat /var/lib/synchro-ops/live-color                       # green 3002 /var/www/synchro
su - synchro -c "pm2 startOrRestart /var/www/synchro/ecosystem.config.cjs --only synchro-blue --update-env"
curl -s http://127.0.0.1:3000/api/health                  # build của bản trước, "db":true
printf 'proxy_pass http://127.0.0.1:3000;\n' > /etc/nginx/snippets/synchro-upstream.conf && nginx -t && nginx -s reload
printf 'blue 3000 /var/www/synchro\n' > /var/lib/synchro-ops/live-color
su - synchro -c "pm2 stop synchro-green && pm2 save"
```

Mỗi màu dùng thư viện của chính nó (`.next-<màu>/node_modules` → `/var/www/.synchro-mods/<băm>/node_modules`, `ecosystem.config.cjs` chạy `next` từ đó), nên trả về màu cũ không cần đụng liên kết thư viện. `$APP/node_modules` (cho script chạy từ thư mục app) chỉ đổi sau khi bản cũ đã thoát; trả lại bằng tay thì trỏ nó theo màu cũ: `ln -sfn "$(readlink /var/www/synchro/.next-blue/node_modules)" /var/www/synchro/.nm && mv -T /var/www/synchro/.nm /var/www/synchro/node_modules`.

Bỏ hẳn xanh/lam (về một tiến trình): trả site nginx từ bản sao lưu, `nginx -t && nginx -s reload`, `rm /var/lib/synchro-ops/live-color`, `cp -a .next-<màu sống> .next`, `pm2 start npm --name synchro -- start -- -p 3000`, dừng và xóa `synchro-blue`/`synchro-green`, `pm2 save`.

### Deploy từ CI

`.github/workflows/deploy.yml` rsync mã vào `/var/www/synchro-incoming/` (không vào thẳng thư mục app), kèm `.synchro-artifact/` (bản build `.next-ci` của bước kiểm tra, `meta` ghi commit, băm package-lock, băm biến `NEXT_PUBLIC_`, băm tệp nén) và `.synchro-source-sha`, rồi chạy `SYNCHRO_INCOMING=/var/www/synchro-incoming bash /var/www/synchro-incoming/scripts/server-build.sh /var/www/synchro synchro pip`. `public`, `db`, `catalog`, `scripts`, `workspace`… chỉ được chép vào thư mục app ngay trước khi bật bản mới. Deploy cách lần đạt trước (`/var/lib/synchro-ops/last-deploy-synchro`) dưới 15 phút thì chờ; lần đẩy mới trong lúc chờ thay lần đang chờ, nên các lần đẩy liền nhau gộp thành một deploy. Deploy từ máy Mac (rsync thẳng vào thư mục app + `/root/deploy-<sha>.sh`) vẫn chạy như trước; khi rsync nhớ loại trừ `'.next-*'` và `node_modules` (nay là liên kết).

## Sao lưu

`scripts/backup.sh` tạo bản sao cục bộ nhất quán, 7 bản ngày và 4 bản tuần. `workspace/setup.sh` tự thêm lịch nếu máy chưa có:

```
# /etc/cron.d/synchro-backup
0 3 * * * root bash /var/www/synchro/scripts/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
```

Sau mỗi bản, script mở lại chính bản vừa lưu và kiểm tra (`integrity_check`, số bảng, số tài khoản, có `secret.key` và khóa mở được một hộp đã mã hóa trong bản sao, đủ tệp tải lên, đọc lại tối đa 200 tệp ngẫu nhiên theo mã băm, `CHECK_FILES`), ghi vào `/var/lib/synchro-ops/backup-status.json`. Trang Sức khỏe hệ thống báo khi lỗi hoặc quá 36 giờ không có bản mới. Đây chưa phải diễn tập khôi phục: vẫn làm phần "Khôi phục" dưới đây mỗi quý.

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

## Nhật ký sudo không chứa lời nhắn

Antigravity chỉ nhận prompt qua tham số `-p`, nên dòng lệnh `sudo -u synchro-cli … agy -p <prompt>` có nguyên lời nhắn của người dùng. `scripts/setup-engine-user.sh` đặt `Defaults:<user Synchro> !log_allowed` để sudo không chép lệnh được phép vào `auth.log` và journal (lệnh bị từ chối vẫn được ghi). Máy cài trước khi có dòng này phải chạy lại script một lần: script ghi đè đúng quy tắc sudo, không đụng tới dữ liệu. Kiểm tra: `sudo cat /etc/sudoers.d/synchro-cli` có dòng `Defaults:`.

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

## Cập nhật CLI của các gói

`app/ai/cliupdate.ts`, Cài đặt → Providers → CLI updates (chủ sở hữu bật / tắt, bấm "Cập nhật ngay", trả về bản trước; quản trị viên chỉ xem). Mỗi tuần khoảng 04:00 giờ máy chủ:

1. Cài bản mới nhất cạnh bản đang chạy, mỗi bản một thư mục: `<engine home>/.local/versions/<cli>/<bản>-<mốc>/bin/<cli>` (claude, codex: `npm install -g --prefix` vào thư mục đó, đúng bản `npm view` báo; agy: script cài của Google với `--dir`; grok: script cài của xAI với `HOME` trỏ vào thư mục của bản đó nên không đè `.grok/downloads` đang chạy).
2. Kiểm tra bản mới: `--version`, rồi `auth status` / `login status` / `models` bằng đăng nhập sẵn có của chủ sở hữu (hoặc quản trị viên khác). Không chat nên không tốn hạn mức gói. Bản cũ đọc được đăng nhập mà bản mới không thì không dùng.
3. Đạt thì đổi `<engine home>/.local/bin/<cli>` thành liên kết tới bản mới (một lần `mv`). Bản trước giữ lại (lần đầu: liên kết cũ tới `.local/lib/node_modules`, hoặc tệp `agy` cũ đổi tên thành `agy.synchro-prev`); bản cũ hơn bị xóa.
4. Theo dõi tối đa 5 lượt thật đầu tiên trong 3 ngày: hai lượt đầu đều lỗi (CLI chết, không phản hồi, hãng không nhận đăng nhập), hoặc lỗi nhiều hơn chạy được sau 3 lượt, thì tự trả về bản trước và không cài lại bản đó.

Thư mục đăng nhập (`logins/`, `engine-tokens/`) không bao giờ bị chép, chuyển hay xóa. Kết quả vào Hộp thư của quản trị viên (lần hằng tuần chỉ báo khi có thay đổi hay lỗi). Claude Code chạy với `DISABLE_AUTOUPDATER=1` để không tự tải bản mới đè lên bản đã kiểm tra. Tắt hẳn: `SYNCHRO_CLI_AUTOUPDATE=0` trong `.env.production` (Claude Code lại tự cập nhật như trước). Trả về tay khi web không mở được: `sudo -u synchro-cli ln -sfn <đích cũ> /var/www/synchro-engine/.local/bin/<cli>` (đích cũ xem bằng `ls -la .local/versions/<cli>` hoặc `readlink` trước khi cập nhật).

## Hạn mức đĩa

- Dịch vụ workspace kiểm tra mỗi phút: quá 5 GB (`WS_DISK_MB`) thì cảnh báo, quá 6 GB thì dừng workspace (cho 5 phút sau khi bật để người dùng dọn), dưới 3 GB trống (`WS_MIN_FREE_MB`) thì không nhận việc mới và dừng workspace tốn đĩa nhất.
- Khi dừng vì vượt hạn mức hoặc đĩa sắp đầy, dịch vụ xóa thêm bộ nhớ đệm của workspace đó (`.cache`, `.npm/_cacache`, thư mục giữ lại giữa các lần chạy). Không đụng tệp của người dùng.
- Đây là kiểm tra định kỳ, không phải hạn mức của hệ thống tệp: một lệnh `dd` nhanh vẫn ghi được vài GB trong một phút. Muốn chặn cứng cần đặt `/srv/synchro-ws` trên phân vùng riêng có project quota (XFS / ext4).
- Tệp tải lên: 2 GB mỗi tài khoản (`SYNCHRO_UPLOAD_QUOTA_MB`), 300 tệp mỗi giờ; đĩa dưới 2 GB trống (`SYNCHRO_MIN_FREE_MB`) thì từ chối tệp mới. Người dùng tự xóa tệp ở Cài đặt → Quyền riêng tư.
- Tệp do code tạo: 5 GB mỗi tài khoản (`SYNCHRO_OUTPUT_QUOTA_MB`), vượt thì từ chối tệp mới và báo trong tin nhắn, không xóa tệp cũ; đĩa dưới mức trên thì không lưu tệp mới và báo cho model. Tệp quá 30 ngày được dọn mỗi ngày.

## Giới hạn và theo dõi khác

- Giọng nói (khóa ElevenLabs dùng chung): có trần credit mỗi ngày cho tài khoản đã xác minh, chưa xác minh và cả máy chủ, sửa ở Cài đặt → Quản trị (`speechBudget`), quản trị viên không tính. Hết trần thì dùng giọng của trình duyệt.
- Chủ của giọng riêng (`speech_voice_owner`): giọng tạo trên Synchro tự có chủ; giọng cũ gán một lần theo lịch sử dùng, không suy được thì thành viên vẫn thấy cho tới khi quản trị viên bấm "Chưa có chủ" trên thẻ giọng để gán email hoặc nhập `shared`. Xóa tài khoản thì xóa giọng người đó tạo trên ElevenLabs; lỗi thì giữ dòng `*purge` và thử lại mỗi giờ, nhật ký có dòng `[speech] chưa xóa được giọng`. Giọng chỉ suy từ lịch sử không tự xóa: hiện "Không còn chủ", quản trị viên tự xem rồi xóa hoặc gán.
- CSP script chạy thử (`Content-Security-Policy-Report-Only` trong `next.config.ts`): chỉ báo vào trang Sức khỏe hệ thống, chưa chặn. Báo cáo sạch một thời gian thì chuyển thành chặn thật.
- Người dùng tải được mọi dữ liệu máy chủ giữ của họ ở Cài đặt → Quyền riêng tư (`/api/auth/account/export`).

## Xóa đoạn chat và đoạn chat ẩn danh

Xóa đoạn chat xóa thêm lịch sử phiên của CLI trên đĩa (tìm theo mã phiên trong `logins/<cli>/<tài khoản>`, `engine_session_log` nhớ cả phiên cũ), kết quả công cụ, tệp do code tạo và tệp tải lên chỉ đoạn chat đó dùng. Artifact chỉ xóa khi người dùng chọn. Bản đã có trong sao lưu mất đi theo vòng xoay. Đoạn chat ẩn danh: không nối phiên (mỗi lượt gửi kèm lịch sử nên chậm hơn), xóa lịch sử phiên ngay sau lượt, xóa lượt chạy sau 10 phút (`SYNCHRO_EPHEMERAL_MS`). Lượt không thuộc đoạn chat nào (đặt tên, chưng cất) cũng được xóa lịch sử phiên. Cách này tìm theo tên tệp: kiểm tra lại với CLI thật sau mỗi lần CLI đổi phiên bản lớn (`find <thư mục đăng nhập> -name '*<mã phiên>*'`). Tệp lịch sử chung của CLI (nếu có, không theo mã phiên) không nằm trong phạm vi này.

## Xác minh email

Tài khoản đăng ký bằng mật khẩu sau khi có tính năng này nhận thư xác minh; chưa xác minh vẫn chat được, nhưng chưa dùng được tệp đính kèm, connector, tác vụ, giọng nói, Synchro Code (Cài đặt → Quản trị viên → "Require a verified email": tắt khi thư đang lỗi). Tài khoản cũ và tài khoản Google, GitHub, Apple không bị ảnh hưởng. Mốc phân biệt: `settings.verify_since`.

## Đo thời gian chờ chữ đầu

Mỗi lượt qua gói ghi một dòng `[timing]` vào nhật ký, không có nội dung người dùng:

`[timing] claude haiku low resume=0 fast=1 pool=hit job=title wait=40 chunks=9 sysKB=2 promptKB=0 status=0 prep=1 event=300 active=310 text=800 end=1200`

- `wait`: từ lúc lượt được tạo tới lúc gọi CLI (xếp hàng, chọn model, skill, gọi lại bộ não, cả lần thử đường nhanh trước đó). `wait + text` là thời gian người dùng chờ phía máy chủ.
- `event`: dòng đầu CLI in ra (khởi động xong). `text`: chữ đầu. `text - event` là phần của model và hãng.
- `chunks=1` với Codex hay Antigravity: chữ đầu chính là cả câu trả lời, nên `text` lúc đó là thời gian viết xong, không phải độ trễ chữ đầu.
- `job`: việc phụ (`title`, `compact`, `memory`, `project-memory`, `brain`, `meta`, `critic-auto`, `critic`, `voice`, `automate`). Không có `job` là lượt của người dùng; đừng tính việc phụ vào tốc độ chat.
- `pool`: `hit` có tiến trình đợi sẵn, `cold` phải khởi động. Không có `pool` là lượt đầy đủ có công cụ, chưa dùng được hồ.

Tỉ lệ trúng hồ của lượt đường nhanh: `grep '\[timing\]' | grep 'fast=1' | grep -v 'job=' | grep -c 'pool=hit'` chia cho số dòng có `fast=1` không có `job=`.

`SYNCHRO_CLAUDE_QUIET=1`: tắt lưu lượng phụ của Claude Code lúc khởi động. Mặc định tắt vì chưa đo. Muốn thử: bật trên một tài khoản thử, so `event` trước và sau, và kiểm tra tên model trong bộ chọn vẫn đúng.
