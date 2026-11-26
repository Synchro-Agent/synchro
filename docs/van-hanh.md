# Vận hành Synchro

## Kiểm tra sức khỏe

`GET /api/health` (công khai): `{ ok, build, db, disk, agent, media }`, 200 khi ổn, 503 khi có cờ `false`. Chỉ có
cờ đúng / sai.

- `db`: ghi được SQLite. `disk`: còn trên 1 GB trống. `agent`: dịch vụ workspace trả lời (`null` nếu máy không bật workspace).
- `media`: `{ heic, office, ocr }`, đọc được ảnh HEIC, tệp Office cũ, chữ trong PDF scan (`null` trong vài giây đầu,
  khi chưa đo xong). Không tính vào `ok`: thiếu thì chỉ các loại tệp đó bị từ chối, web không 503 và watchdog không
  khởi động lại vì nó. Xem mục "Đọc tệp đặc biệt" bên dưới.
- Theo dõi ngoài (Blueprint A6.4) — ping mỗi phút từ Cloudflare, báo qua GitHub:
  - `ops/uptime-worker/` là một Cloudflare Worker có lịch `* * * * *` (gói Workers Free, cùng tài khoản Cloudflare đang giữ synchro.net.nz). Mỗi phút gọi `/api/health`; lỗi thì 15 giây sau gọi lại. Lỗi 3 phút liền (`FAILS_TO_ALERT`) thì Worker kích `.github/workflows/uptime.yml` (workflow_dispatch, lý do "down: …"); workflow kiểm lại từ máy của GitHub, lỗi thật thì job đỏ và GitHub gửi email "Run failed". Hồi lại thì Worker kích lần nữa ("up: …", job xanh). Trạng thái nằm trong KV `UPTIME`, chỉ ghi khi đổi. Kiểm thử: `node tests/api/uptime-worker.test.mjs`.
  - Cài một lần (chủ sở hữu): (1) GitHub → Settings (tài khoản) → Developer settings → Fine-grained tokens → Generate: chỉ repo `synchro`, quyền **Actions: Read and write** (không cấp Contents), hạn 1 năm. (2) Trong `ops/uptime-worker/`: `npx wrangler login` → `npx wrangler kv namespace create UPTIME` (chép `id` vào `wrangler.toml`) → `npx wrangler secret put GH_TOKEN` (dán token) → `npx wrangler deploy`. (3) GitHub → Settings (tài khoản) → Notifications → Actions → "Send notifications for failed workflows only" + Email. Thử: tab Actions → Uptime → Run workflow phải xanh; xem nhật ký Worker bằng `npx wrangler tail`.
  - Phút Actions: `uptime.yml` còn một lịch dự phòng 6 giờ một lần (120 phút / tháng) và 1 phút cho mỗi lần Worker báo. Không đặt lại lịch mỗi 5 phút: ≈ 8.640 phút / tháng, gói Free của repo riêng tư chỉ có 2.000 phút, hết phút thì mọi workflow (cả deploy) bị chặn tới kỳ sau. Không muốn dùng Worker: Better Stack (gói miễn phí, kiểm 3 phút một lần, báo email) hoặc UptimeRobot (5 phút) trỏ vào `https://synchro.net.nz/api/health`, từ khóa `"db":true`.
  - GitHub tự tắt lịch của repo không có commit trong 60 ngày (chỉ lịch dự phòng; kích từ Worker vẫn chạy); bật lại ở tab Actions → Uptime → Enable workflow.

## Sức khỏe hệ thống và watchdog

Quản trị viên xem ở **Cài đặt → Sức khỏe hệ thống**: lỗi máy chủ gần đây (đã bỏ email, token), người bị hãng từ chối
đăng nhập gói AI, đĩa, thư gửi lỗi và nút gửi thử, tuổi và kết quả kiểm tra của bản sao lưu mới nhất, watchdog. Vấn đề
nghiêm trọng (đĩa, thư, sao lưu, từ 3 người mất đăng nhập gói) còn được báo vào Autopilot và email của quản trị viên,
mỗi loại tối đa một lần mỗi ngày.

`ops/setup.sh` (deploy chạy mỗi lần) cài `synchro-watchdog.timer`: mỗi phút gọi `/api/health` ở máy chủ. Web không trả lời hoặc `db` sai 3 lần liên tiếp thì `pm2 restart`; tối thiểu 10 phút giữa hai lần, tối đa 3 lần mỗi giờ. Đang deploy thì bỏ qua (khóa `/run/synchro-deploy.lock`). Báo 503 vì đĩa hay dịch vụ workspace thì chỉ ghi lại, khởi động lại web không chữa được.

```bash
systemctl status synchro-watchdog.timer
cat /var/lib/synchro-ops/watchdog-state.json; tail /var/lib/synchro-ops/watchdog.jsonl
```

Cấu hình ở `/etc/synchro-ops.env` (chỉ root đọc): `APP`, `PM2`, `PORT`, `WEB_USER`, `DATA_DIR`, `SYNCHRO_ENGINE_HOME`, `SYNCHRO_BACKUP_HOOK`, `WATCHDOG_ALERT_CMD` (lệnh chạy khi watchdog bỏ cuộc, ví dụ gửi thư bằng `mail` của máy, vì lúc đó web đã chết nên trang Sức khỏe không báo được). Nên đặt `DATA_DIR` ở đây nếu khác `<app>/data`; thiếu thì `backup.sh` đọc từ `.env.production` (của web user) nhưng từ chối nếu thư mục không thuộc `WEB_USER` (mặc định `synchro`) hoặc nằm trong nơi sao lưu.

Giới hạn lượt model (đặt trong `.env.production`): `SYNCHRO_TURNS_PER_ACCOUNT` (mặc định 4, quản trị viên gấp 3), `SYNCHRO_TURNS_ACCOUNT_TOTAL` (tổng mọi làn của một tài khoản, mặc định 6, thêm 2 chỗ cho việc phụ, không quá 60% cả máy), `SYNCHRO_TURN_QUEUE` (8), `SYNCHRO_TURNS_GLOBAL` (mặc định theo RAM: (tổng RAM − 2,5 GB) chia 400 MB mỗi CLI; 400 MB là ước lượng, dòng `[timing] mem` ghi RSS thật của các CLI ở `cli=` để đặt lại). Dịch vụ workspace tự tính trần riêng: `WS_MAX_RUNNING` = (tổng − 2,5 GB) × 0,5 / 1,5 GB, ít nhất 3; `WS_RUN_MAX` = (tổng − 2,5 GB) × 0,5 / 2 GB, ít nhất 2 và không dưới số container giữ sẵn (`SYNCHRO_WARM_POOL`); `WS_MEDIA_MAX` = (tổng − 2,5 GB) × 0,5 / 3,5 GB nhưng không quá `WS_RUN_MAX` — lần dựng video có hàng riêng, không chiếm chỗ chạy code chung (đặt tay thì theo), `SYNCHRO_MIN_FREE_RAM_MB` (300). Nới riêng một tài khoản bằng cài đặt `turns_limit:<id người dùng>`. Trang Sức khỏe hiện số lượt đang chạy, đang chờ, bị từ chối.

Quyền sở hữu: `ops/server-build.sh` để thư mục app, `scripts/`, `workspace/` thuộc root; dịch vụ workspace chạy từ `/opt/synchro-ws` (bản sao, chỉ root ghi). Web user ghi được `data/`, `.cache/`, `.next/`, `node_modules/`, `.mkvenv/`, `.env.production` và mã ứng dụng của chính nó, nên script chạy bằng root không được tin các tệp này (`backup.sh` đã làm vậy). Tiến trình đọc tệp tải lên (`scripts/extract-worker.mjs`) chạy ưu tiên thấp, giới hạn bộ nhớ (`SYNCHRO_PARSE_HEAP_MB`, 1024), thời gian (`SYNCHRO_PARSE_MS`), số việc cùng lúc (`SYNCHRO_PARSE_MAX`, 2), không có biến môi trường bí mật, và theo mô hình quyền của Node chỉ đọc được mã của chính nó.

Người dùng mất cả ứng dụng tạo mã lẫn mã dự phòng (xác minh hai bước): sau khi xác nhận đúng chủ tài khoản, chạy trên máy chủ `sqlite3 data/synchro.db "DELETE FROM user_mfa WHERE user_id = '<id>'"`.

## Deploy và trả lại bản trước

`ops/server-build.sh` dựng bản mới ở thư mục riêng, tráo bản, khởi động lại, rồi gọi `/api/health` tối đa khoảng 90 giây. Đây là cách một tiến trình (staging, production trước khi chuyển); production sau khi chuyển dùng xanh/lam ở mục dưới.

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
- `ops/setup.sh` chỉ khởi động lại dịch vụ workspace khi `workspace/*.mjs` hoặc tệp dịch vụ đổi. Khi khởi động lại, dịch vụ ngừng nhận lần chạy mới và chờ lần đang chạy xong tối đa 5 phút.

## Deploy xanh/lam (production)

Production chạy hai màu trong cùng thư mục `/var/www/synchro` (chung `data/`, `.cache/`, `.env.production`): **blue** = cổng 3000, thư mục build `.next-blue`, pm2 `synchro-blue`; **green** = cổng 3002, `.next-green`, `synchro-green`. Cổng 3001 là staging, không bao giờ dùng. Chỉ một màu nhận lưu lượng; màu kia dừng, giữ bản build trước để trả lại.

- `ecosystem.config.cjs`: chạy thẳng `node node_modules/next/dist/bin/next start -p <cổng>` (không qua npm), `kill_timeout: 30000`, `treekill: false` (pm2 không giết CLI đang trả lời), `NEXT_MANUAL_SIG_HANDLE=1`, `SYNCHRO_ROLE=secondary`, `SYNCHRO_COLOR`.
- `/var/lib/synchro-ops/live-color` (root ghi, ai cũng đọc): `<màu> <cổng> <thư mục app>`. `/etc/nginx/snippets/synchro-upstream.conf` (root): một dòng `proxy_pass http://127.0.0.1:<cổng>;`, site nginx `include` tệp này.
- Khóa primary `data/.primary.pid`: `<pid> <màu> <boot_id> <starttime>`. Khóa của lần khởi động máy trước, của pid đã bị tiến trình khác dùng lại, hay của tiến trình user khác (EPERM) mà khóa không có danh tính khớp đều coi là trống (EPERM có danh tính khớp vẫn là chủ khóa). Một tiến trình (staging, `npm start`) cũng giữ khóa này: lỡ bật thêm một tiến trình trên cùng thư mục dữ liệu thì nó chỉ phục vụ, không chạy việc nền. Chờ nhận vai quá 60 giây thì báo lỗi ở Sức khỏe hệ thống.
- Tệp upstream của nginx là nguồn sự thật: deploy chết giữa lúc đổi nginx và lúc ghi `live-color` thì lần deploy sau (và watchdog) theo cổng nginx đang trỏ, sửa lại `live-color`, không bao giờ dừng màu nginx đang trỏ.
- Vai trò (`server/role.ts`): tiến trình bật lên là secondary, chỉ phục vụ yêu cầu. Nó nhận vai **primary** (litestream, bộ hẹn giờ tác vụ, bộ não, connector, theo dõi PR, cập nhật CLI, dò model, GitHub, dọn dẹp, cài plugin, chạy lại lượt dở dang) khi `live-color` ghi màu của nó **và** tiến trình giữ khóa `data/.primary.pid` đã thoát. Kiểm tra mỗi 3 giây (`SYNCHRO_ROLE_POLL_MS`). Không đặt `SYNCHRO_ROLE` (staging, máy dev) thì là primary ngay như trước.
- Tắt êm (`server/drain.ts`): SIGTERM → `/api/llm`, `/api/agent`, chạy tác vụ ngay trả 503 kèm `Retry-After: 5` (trình duyệt tự gửi lại, tới bản mới); dừng bộ hẹn giờ; chờ tối đa 25 giây (`SYNCHRO_DRAIN_MS`) cho lượt chat và lượt Code đang chạy; dừng litestream; bỏ khóa primary; thoát.
  - **Lượt chat** còn dở sau 25 giây giữ trạng thái "đang chạy" và được bản mới chạy lại khi nhận vai primary (trừ lượt đã có tác động ra ngoài, như trước). Trình duyệt theo dõi lượt qua bản mới (SSE) vẫn nhận bước và kết quả của lượt bản cũ đang chạy nốt (đọc cơ sở dữ liệu chung mỗi 1,5 giây). Nút Dừng và tin nhắn thêm gửi tới bản mới được ghi vào bảng `runs` (`cancel_req`, `steer_req`): bản cũ đọc mỗi 1,5 giây; lượt đã bấm Dừng không bị chạy lại (đóng kèm chữ đã viết mà bản cũ lưu lúc hết giờ chờ, cột `partial`).
  - **Lượt Code** (Synchro Code) chỉ nằm trong bộ nhớ, không chạy lại được. Trong 25 giây đó bản mới biết lượt đang chạy ở bản cũ (bảng `agent_owner`): trình duyệt nối lại hay mở lại phiên nhận 202 (hiện đang chạy, có nút Dừng) và chờ, nút Dừng được chuyển sang bản cũ; dòng ghi pid kèm boot_id + starttime, dòng của tiến trình đã chết (hoặc cũ hơn 2 giờ 10 phút) bị xóa. **Lượt Code còn chạy sau 25 giây bị dừng hẳn** khi bản cũ thoát (phần đã làm vẫn ở workspace, phiên hiện "Đã dừng"); nhật ký ghi `[deploy] hết giờ chờ, còn N lượt chat, M lượt Code`. Tránh deploy khi có lượt Code dài đang chạy.
- Nhật ký: `/home/synchro/.pm2/logs/synchro-<màu>-out.log` (trước đây `synchro-out.log`); dòng `[role]` khi nhận vai primary, `[deploy]` khi tắt êm.
- Ô **Lần khởi động lại web (24 giờ)** đếm lần một tiến trình nhận vai primary: mỗi deploy một lần, bản mới không đạt (chưa từng nhận lưu lượng) không tính.

Mỗi lần deploy, `ops/server-build.sh` (tự dùng xanh/lam khi `live-color` ghi đúng thư mục app; `BLUEGREEN=1` ép xanh/lam; `BLUEGREEN=0` chỉ dùng được khi app pm2 một tiến trình còn tồn tại, production đã chuyển thì bị từ chối, xem "Bỏ hẳn xanh/lam"):

1. Build ở thư mục tạm (hoặc dùng bản build của CI nếu khớp commit, băm `package-lock.json` và biến `NEXT_PUBLIC_`), node_modules ở `/var/www/.synchro-mods/<băm>/node_modules` (chỉ `npm ci` khi băm đổi).
2. Đặt bản build vào thư mục của màu nghỉ kèm liên kết `.next-<màu>/node_modules` tới thư viện của nó, chép mã mới từ thư mục incoming (nếu deploy từ CI), bật màu nghỉ.
3. `/api/health` ở cổng mới phải báo đúng mã bản mới và `db: true`. Không đạt: dừng màu mới, trả liên kết node_modules và `public/`, `db/` về như cũ, deploy báo lỗi. nginx chưa từng trỏ sang nên người dùng không thấy gì.
4. Ghi tệp upstream, `nginx -t` (lỗi thì trả tệp cũ, dừng màu mới), `nginx -s reload`; kiểm tra qua nginx (`curl --resolve synchro.net.nz:443:127.0.0.1 https://synchro.net.nz/api/health`) thấy mã bản mới, không thì trả nginx về cổng cũ.
5. Ghi `live-color`, `pm2 stop` màu cũ (tắt êm ở trên, tối đa 30 giây), `pm2 save`, dọn node_modules không còn dùng (giữ bản của màu vừa dừng).

Lần sau đổi ngược về màu kia. Watchdog (`ops/watchdog.sh`) đọc `live-color` để theo dõi và khởi động lại đúng màu (`pm2 restart synchro-<màu>`, không kèm `--update-env`), và vẫn bỏ qua khi đang có khóa deploy.

### Chuyển sang xanh/lam (một lần)

Deploy bản có xanh/lam bằng cách cũ trước và chờ tới `build ok` (lần deploy đó vẫn là một tiến trình; tiến trình đó đã giữ khóa `data/.primary.pid` với màu `single`), rồi chạy bằng root:

```bash
bash /var/www/synchro/ops/bluegreen-migrate.sh /var/www/synchro synchro /etc/nginx/sites-enabled/synchro
```

Script chạy lại an toàn, theo thứ tự:

1. Tạo `snippets/synchro-upstream.conf` trỏ 3000, thay `proxy_pass http://127.0.0.1:3000;` trong site bằng `include snippets/synchro-upstream.conf;` (sao lưu site ở `/etc/nginx/synchro.before-bluegreen.<giờ>`, `nginx -t` lỗi thì trả lại).
2. Chuyển node_modules vào kho theo băm.
3. Từ chối nếu bản đang trả lời ở cổng 3000 không phải `.next` hiện có, hoặc `.next` chưa có mã xanh/lam (deploy kiểu cũ trước đó lỗi và đã trả bản trước về). Chép `.next` sang `.next-green` (kèm `.next-green/node_modules`), bật `synchro-green` ở 3002, kiểm tra sức khỏe.
4. Chuyển nginx sang 3002, chờ lượt của bản cũ (tối đa 25 giây), `pm2 stop synchro`; lệnh này lỗi hoặc cổng 3000 vẫn trả lời thì dừng, chưa ghi `live-color` (green vẫn là secondary, chạy lại script sau khi dừng bản cũ bằng tay).
5. Ghi `live-color` = green, chờ green nhận vai primary (khóa ghi `green`) tối đa 20 giây; không nhận thì bật lại `synchro`, nginx về 3000, bỏ `live-color`, dừng green, báo lỗi.
6. Xóa app pm2 `synchro`, `pm2 save` (lỗi thì báo, không giấu), cập nhật `PM2`/`PORT` trong `/etc/synchro-ops.env`.

Chạy lại khi đã có `live-color` (lần trước bị cắt ngang): làm nốt bước 6 theo màu sống. `.next` cũ được giữ để trả lại; xóa khi đã yên tâm.

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

`.github/workflows/deploy.yml` rsync mã vào `/var/www/synchro-incoming/` (không vào thẳng thư mục app), kèm `.synchro-artifact/` (bản build `.next-ci` của bước kiểm tra, `meta` ghi commit, băm package-lock, băm biến `NEXT_PUBLIC_`, băm tệp nén) và `.synchro-source-sha`, rồi chạy `SYNCHRO_INCOMING=/var/www/synchro-incoming bash /var/www/synchro-incoming/ops/server-build.sh /var/www/synchro synchro pip`. `public`, `db`, `catalog`, `scripts`, `workspace`… chỉ được chép vào thư mục app ngay trước khi bật bản mới. Deploy cách lần đạt trước (`/var/lib/synchro-ops/last-deploy-synchro`) dưới 15 phút thì chờ; lần đẩy mới trong lúc chờ thay lần đang chờ, nên các lần đẩy liền nhau gộp thành một deploy. Deploy từ máy Mac (rsync thẳng vào thư mục app + `/root/deploy-<sha>.sh`) vẫn chạy được, nhưng phải dùng đúng danh sách loại trừ ở mục dưới.

### Deploy từ máy Mac

Đường này không qua `/var/www/synchro-incoming`: rsync chép thẳng vào thư mục app, nên `SRC` = `APP`, `sync_code` của `ops/server-build.sh` không chạy và `EXCL` của nó không có tác dụng. Mọi thứ phải loại trừ nằm ở lệnh rsync trên máy Mac. Danh sách dưới đây giống hệt `EXCL` (kể cả `/public/intro/*.mp4`: thiếu nó thì `--delete` xóa phim giới thiệu trong `public/intro/` vì phim không còn trong git, xem mục Phim giới thiệu).

```bash
# Trên máy Mac, trong bản sao repo. Viết thẳng từng --exclude, không gom vào biến shell:
# zsh không tách từ, rsync nhận một mẫu hỏng và --delete xóa /var/www/synchro/data.
D=$(mktemp -d) && git archive <sha> | tar -x -C "$D"
rsync -a --delete --dry-run --itemize-changes \
  --exclude '/public/intro/*.mp4' --exclude /data --exclude /.next --exclude '/.next-*' --exclude /node_modules --exclude /.git \
  --exclude /workspace/data --exclude /.mkvenv --exclude /.cache --exclude '/.env*' --exclude /.synchro-artifact --exclude '/.node_modules.new.*' \
  "$D/" root@<máy chủ>:/var/www/synchro/ | grep '^\*deleting'
# Đọc danh sách xóa (không được có data/, node_modules, .next-*, public/intro/*.mp4). Ổn thì chạy lại đúng lệnh rsync đó,
# bỏ --dry-run --itemize-changes và | grep, rồi chạy /root/deploy-<sha>.sh trên máy chủ như trước.
```

### Kiểm thử trong CI (Blueprint H2)

Job `verify` của `deploy.yml` (chặn deploy): `npm ci` → `npm audit` (chỉ báo) → `tsc --noEmit` → `npm run lint` (đỏ khi có lỗi, cảnh báo không chặn) → `npm run build` → `npm run dev:mock:fast` chạy nền (heap 4096 MB như bước build) → `node tests/run-all.mjs` (bộ API). Deploy chỉ chạy khi `verify` xanh.

Bộ giao diện chạy ở workflow riêng `.github/workflows/ui-qa.yml`: `npm run dev:mock:fast` → `node tools/qa.mjs --no-api` (Chrome ẩn), kết quả ở artifact `ui-qa-result` và `/var/www/ci-status/ui-<nhánh>.txt` trên VPS. Chưa chặn deploy vì chưa từng có một lần xanh trọn vẹn trên CI; mặc định chạy mỗi tuần (Chủ nhật 19:23 UTC) và khi bấm Actions → UI QA → Run workflow. Khi đã có một lần xanh: chuyển bước "Kiểm thử giao diện" vào job `verify` (sau bộ API) để nó chặn deploy.

Phút GitHub Actions (repo riêng tư, gói Free: 2.000 phút / tháng, mỗi job tính tối thiểu 1 phút; hết phút thì mọi workflow bị chặn tới kỳ sau, kể cả deploy): `verify` ≈ 40 phút mỗi lần đẩy main / staging; `ui-qa.yml` ≈ 60–90 phút mỗi lần (lịch tuần ≈ 320 phút / tháng); `uptime.yml` ≈ 120 phút / tháng. Tức còn chỗ cho khoảng 35 lần đẩy mỗi tháng; đẩy nhiều commit một lần thay vì từng commit. Biến repo `SYNCHRO_CI_UI = push` chạy bộ giao diện sau mỗi lần đẩy main — chỉ bật khi repo công khai (phút Actions miễn phí) hoặc gói trả phí.

- Một lệnh build cho cả ba nơi: `npm run build` (= `next build`, webpack) ở `package.json`, CI và `ops/server-build.sh`; mỗi nơi chỉ đặt riêng `NODE_OPTIONS` (bộ nhớ) và `NEXT_DIST_DIR`.
- `package.json` có `"engines": { "node": "22.x" }`; CI đọc phiên bản Node từ đó (`node-version-file`). Máy chủ cũng phải chạy Node 22.
- `tools/qa.mjs` chạy mọi `tests/ui/*.mjs` (glob) trừ danh sách `SKIP` có lý do; `node tools/qa.mjs --list` in danh sách. `tests/api/qa-plan.test.mjs` đỏ khi có tệp mới không chạy mà cũng không nằm trong `SKIP`.
- ESLint (`eslint.config.mjs`: `next/core-web-vitals` + `jsx-a11y`): gói `eslint`, `eslint-config-next` (ghim đúng phiên bản của `next`, không dùng `^`; nâng `next` thì nâng gói này theo, `tests/api/lint-ci.test.mjs` kiểm), `@eslint/eslintrc`, `eslint-plugin-jsx-a11y` là devDependencies, `npm ci` cài sẵn. `npm run lint` (tools/lint.mjs) lint cả repo, thoát khác 0 chỉ khi có lỗi; bước ESLint của `verify` chặn deploy theo đúng nghĩa đó. Khi bước này đỏ, nó chạy lại `npm run lint -- --quiet` vào `lint-errors.log` và `ci.txt` in tệp đó trước `lint.log` (lint.log ~1.300 dòng cảnh báo, ci.txt chỉ giữ 150 dòng cuối mỗi tệp nên lỗi có thể bị cắt mất). Cảnh báo (trợ năng ở mức `A11Y_LEVEL = "warn"`, deps của hook, biểu thức thừa) không chặn; hết cảnh báo trợ năng thì đổi `A11Y_LEVEL` thành `error`. `next build` không tự lint (`eslint.ignoreDuringBuilds` trong next.config.ts). Máy chủ (`ops/server-build.sh`) không chạy lint; `npm ci` ở đó cài cả gói dev (cần cho typescript, tailwind lúc build) nên có thêm ESLint, vô hại.
- Bước giao diện (ui-qa.yml) trên Ubuntu 24.04 tắt `kernel.apparmor_restrict_unprivileged_userns` trên máy CI để Chrome mở được sandbox; `qa.mjs` tự tìm `google-chrome` trên Linux (`CHROME_PATH` để đổi). `dev:mock:fast` tự đặt heap 4096 MB cho bước build khi `NODE_OPTIONS` chưa đặt (`MOCK_BUILD_HEAP_MB` để đổi).

Quy tắc bảo vệ nhánh `main` (cài đặt của GitHub, không nằm trong repo — chủ repo bật một lần): GitHub → repo → Settings → Rules → Rulesets → New branch ruleset → Target: `main` → bật "Require status checks to pass" → thêm check `verify` (tên job trong `deploy.yml`) → bật "Block force pushes" → Create. Repo riêng tư trên gói Free của GitHub không áp dụng được ruleset / branch protection (cần GitHub Pro hoặc Team); khi đó vẫn giữ được an toàn vì job `deploy` có `needs: verify`, chỉ deploy khi `verify` xanh. Lưu ý: commit được rsync thẳng từ máy Mac không đi qua CI, nên không được bảo vệ bởi quy tắc này.

## Phim giới thiệu

Từ Blueprint H3.9 hai tệp mp4 của phim giới thiệu (`ui/introfilm.tsx`) không còn nằm trong git. Trình duyệt vẫn tải ở cùng URL `/intro/synchro-intro-720.mp4` (3,9 MB, mặc định) và `/intro/synchro-intro.mp4` (19 MB, chỉ khi xem toàn màn hình). Trên máy chủ, nginx phục vụ các URL này thẳng từ thư mục riêng, nằm ngoài thư mục app:

```
/var/www/synchro-media/intro/          root:root 755
├── synchro-intro-720.mp4              root:root 644
├── synchro-intro.mp4                  root:root 644
└── synchro-intro-poster.jpg           root:root 644   (bản sao của public/intro/synchro-intro-poster.jpg trong git)
```

Lý do: deploy chép mã bằng `rsync --delete` vào `/var/www/synchro` (`sync_code` trong `ops/server-build.sh`), và khi bản mới lỗi thì trả `public/` của lần deploy tốt gần nhất về bằng `rsync --delete`. `/var/www/synchro-media` không nằm trong hai đường đó và cũng không nằm trong `/var/www/synchro-incoming`, nên không lần deploy nào (một tiến trình hay xanh/lam, đạt hay trả lại bản trước) xóa hay ghi đè được phim. Ngoài ra, `ops/server-build.sh` loại `/public/intro/*.mp4` khỏi rsync (`EXCL`), và bước rsync vào staging trong `deploy.yml` cũng loại như vậy. Nhờ thế bản sao cũ trong `/var/www/synchro/public/intro/` vẫn còn nếu nginx chưa đổi, và Next vẫn phục vụ phim như trước. Deploy từ máy Mac chỉ giữ được bản sao đó khi lệnh rsync có `--exclude '/public/intro/*.mp4'` (mục Deploy từ máy Mac).

**Làm phần "Cài một lần" dưới đây trước lần deploy đầu tiên của commit H3.9 (commit bỏ phim khỏi git), dù deploy bằng đường nào (CI, máy Mac, tay).** Một lần rsync `--delete` với danh sách loại trừ cũ (chưa có `/public/intro/*.mp4`) xóa phim khỏi `/var/www/synchro/public/intro/`. Nếu nginx chưa trỏ sang `/var/www/synchro-media`, mọi người dùng mới nhận 404 và app bỏ qua phim; bản sao trong thư mục app khi đó cũng mất, nên bước 1 phải chép từ máy Mac.

### Cài một lần (người vận hành, quyền root)

1. Tạo thư mục và chép phim từ máy Mac. Nguồn là `public/intro/` của bản sao repo trên máy Mac (thiếu thì chạy `node tools/fetch-intro.mjs` trước để lấy lại từ lịch sử git):

```bash
# Trên máy Mac, trong bản sao repo
ssh root@<máy chủ> install -d -o root -g root -m 755 /var/www/synchro-media/intro
scp -p public/intro/synchro-intro-720.mp4 public/intro/synchro-intro.mp4 public/intro/synchro-intro-poster.jpg root@<máy chủ>:/var/www/synchro-media/intro/
# Trên máy chủ
chown root:root /var/www/synchro-media/intro/*; chmod 644 /var/www/synchro-media/intro/*
stat -c '%s %n' /var/www/synchro-media/intro/*.mp4   # 3913526 …-720.mp4 · 19025144 …intro.mp4
```

   Chỉ khi không có máy Mac: chép từ bản đang chạy, nếu deploy chưa xóa nó (`ls -l /var/www/synchro/public/intro/`): `cp -p /var/www/synchro/public/intro/{synchro-intro-720.mp4,synchro-intro.mp4,synchro-intro-poster.jpg} /var/www/synchro-media/intro/`.

2. Thêm khối sau vào `server { … }` có `listen 443 ssl` trong `/etc/nginx/sites-enabled/synchro`, đặt trước `location /` (khối chuyển tiếp tới app). Nếu staging có site nginx riêng thì thêm cùng khối đó vào site staging, trỏ cùng thư mục.

```nginx
# Phim giới thiệu (Blueprint H3.9): tệp tĩnh ngoài thư mục app, deploy (rsync --delete vào /var/www/synchro) không đụng tới.
# ^~: khớp tiền tố này thì nginx không xét các location dạng regex nữa (vd. một khối ~* \.(mp4|jpg)$ khác).
location ^~ /intro/ {
    alias /var/www/synchro-media/intro/;
    # Giống next.config.ts (/intro/:path*): tên tệp không đổi khi nội dung đổi, nên giữ một tuần, sau đó vẫn dùng bản cũ trong lúc tải bản mới.
    add_header Cache-Control "public, max-age=604800, stale-while-revalidate=2592000";
}
```

Lưu ý:

- Khối này bắt mọi URL dưới `/intro/`, kể cả ảnh chờ `synchro-intro-poster.jpg`. Vì vậy ảnh chờ phải có trong thư mục media (bước 1). Đổi ảnh chờ trong git thì chép lại vào đó.
- Một `location` có `add_header` riêng thì không thừa hưởng `add_header` ở mức `server`. Nếu site đặt header ở mức `server` (vd. `Strict-Transport-Security`), chép các dòng `add_header` đó vào khối này. Header COOP/COEP mà Next đặt cho mọi đường dẫn chỉ có tác dụng với trang HTML, không cần cho tệp video.
- nginx tự xử lý yêu cầu `Range` (206) cho video và đặt `Content-Type: video/mp4` theo `mime.types`. Không cần thêm gì.
- Thiếu tệp thì nginx trả 404 và không chuyển sang app. Khi đó app tự bỏ phim, đi thẳng vào trang chủ.

3. Kiểm tra rồi nạp lại, sau đó thử qua đúng tên miền:

```bash
nginx -t && systemctl reload nginx
curl -sI https://synchro.net.nz/intro/synchro-intro-720.mp4 | grep -iE '^(HTTP|content-type|content-length|cache-control|accept-ranges|etag)'
#   HTTP/2 200 · content-type: video/mp4 · content-length: 3913526 · cache-control: public, max-age=604800, stale-while-revalidate=2592000
#   · accept-ranges: bytes · etag: "…-3bb736" (nginx: ETag dạng "<giờ>-<cỡ>" hệ 16, không có W/ như Next)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-99' https://synchro.net.nz/intro/synchro-intro.mp4   # 206
curl -sI https://synchro.net.nz/intro/synchro-intro-poster.jpg | head -1                                          # 200
```

Sau khi nginx đã phục vụ từ `/var/www/synchro-media`, có thể để nguyên bản sao cũ trong `/var/www/synchro/public/intro/*.mp4`: không còn ai đọc, và deploy không xóa nó. Muốn gọn thì xóa hai tệp mp4 đó, nhưng không xóa ảnh chờ (nó nằm trong git).

### Thay phim

Dựng lại bằng dự án `synchro-intro-film` (Remotion, ngoài repo). Chép lên máy chủ vào thư mục tạm `/var/www/synchro-media/.new-intro` rồi `mv` vào chỗ. Thư mục tạm nằm ngoài `/intro/` mà nginx phục vụ, nên tệp đang chép dở không ai tải được; nó cùng ổ đĩa với `intro/`, nên `mv` là đổi tên nguyên tử và người đang tải không bao giờ nhận nửa tệp. `scp` nhiều tệp cần thư mục đích có sẵn, nên tạo nó trước:

```bash
# Trên máy Mac
ssh root@<máy chủ> install -d -o root -g root -m 755 /var/www/synchro-media/.new-intro
scp synchro-intro-720.mp4 synchro-intro.mp4 root@<máy chủ>:/var/www/synchro-media/.new-intro/
# Trên máy chủ
cd /var/www/synchro-media && chown root:root .new-intro/*.mp4 && chmod 644 .new-intro/*.mp4 && mv .new-intro/*.mp4 intro/ && rmdir .new-intro
```

- Không cần deploy, không cần khởi động lại app hay nginx.
- Tên tệp giữ nguyên nên trình duyệt đã xem có thể dùng bản cũ tới một tuần (`Cache-Control`). Muốn mọi người thấy bản mới ngay thì đặt tên mới (vd. `synchro-intro-720-v2.mp4`), rồi đổi `SRC_720` / `SRC_1080` trong `ui/introfilm.tsx`, `INTRO_FILES` trong `tools/fetch-intro.mjs` và tên tệp trong `tests/ui/introfilm.mjs`. Chép tệp mới lên máy chủ trước khi deploy mã trỏ tới nó.
- Máy dev và CI không nhận phim mới qua git. `node tools/fetch-intro.mjs` chỉ lấy tệp còn thiếu (từ lịch sử git, không có thì tải từ `https://synchro.net.nz/intro/`). Muốn lấy bản mới thì xóa `public/intro/*.mp4` rồi chạy lại với `--no-git`.

### Máy dev và CI

`tools/fetch-intro.mjs` lấy tệp còn thiếu vào `public/intro/`. Nó lấy từ lịch sử git trước (commit cuối còn tệp), không có thì tải từ `https://synchro.net.nz/intro/…`. Tệp tải về phải đúng là mp4 (có hộp `ftyp`) và lớn hơn 100 KB thì mới được đặt vào chỗ. `npm run dev:mock` tự chạy bước này trước khi bật Next. `SYNCHRO_INTRO_FETCH=0` bỏ bước này; job `verify` của `deploy.yml` đặt biến này vì bộ API không cần phim. `ui-qa.yml` tải phim trước khi build. Thiếu phim thì `tests/ui/introfilm.mjs` in `BỎ QUA: <lý do>`, và tổng kết của `tools/qa.mjs` ghi bộ đó là ○ bỏ qua.

Merge (hoặc checkout, pull) commit H3.9 vào một bản sao từng có phim trong git thì git xóa hai tệp mp4 khỏi đĩa, vì trước đó chúng được git theo dõi. Bản sao chính trên máy Mac cũng vậy: sau merge, `npm run dev:mock` và mọi lần rsync từ thư mục đó không còn phim. Cách giữ: chép `public/intro/*.mp4` ra ngoài trước `git merge` rồi chép lại sau, hoặc chạy `node tools/fetch-intro.mjs` ngay sau merge (lấy lại từ lịch sử git, không cần mạng). Sau đó `git status` không báo gì vì `.gitignore` có `/public/intro/*.mp4`.

## Sao lưu

`ops/backup.sh` tạo bản sao cục bộ nhất quán, 7 bản ngày và 4 bản tuần. `ops/setup.sh` tự thêm lịch nếu máy chưa có:

```
# /etc/cron.d/synchro-backup
0 3 * * * root bash /var/www/synchro/ops/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
```

Sau mỗi bản, script mở lại chính bản vừa lưu và kiểm tra (`integrity_check`, số bảng, số tài khoản, có `secret.key` và khóa mở được một hộp đã mã hóa trong bản sao, đủ tệp tải lên, đọc lại tối đa 200 tệp ngẫu nhiên theo mã băm, `CHECK_FILES`), ghi vào `/var/lib/synchro-ops/backup-status.json`. Trang Sức khỏe hệ thống báo khi lỗi hoặc quá 36 giờ không có bản mới. Đây chưa phải diễn tập khôi phục: vẫn làm phần "Khôi phục" dưới đây mỗi quý.

Trong mỗi bản: `synchro.db` (đã chạy `integrity_check`), `data/` (trừ kho skill dựng sẵn và bản cài CLI), `uploads/` (tệp tải lên), `engine-logins/`, `env.production`, `synchro-ws.env`.

Không có trong bản sao, tải / dựng lại được: `data/skills/_plugins`, bản cài CLI, thư mục làm việc của CLI, workspace của người dùng ở `/srv/synchro-ws` (giới hạn 5 GB mỗi người, tổng có thể rất lớn; nếu muốn giữ, cần chọn nơi lưu riêng).

Bản sao nằm cùng đĩa với dữ liệu, nên **không chống được hỏng đĩa hay mất máy chủ**. Muốn chống phải đẩy ra ngoài và mã hóa, vì bản sao chứa `data/secret.key` và tệp môi trường. Đặt lệnh trong `/etc/synchro-ops.env` (không đặt trong `.env.production`: lệnh này chạy bằng root):

```bash
# Đang dùng (Blueprint A6.2, bật 13/11/2026): ops/backup-offsite.sh nén tệp tải lên, tệp đã tạo, skill riêng, âm thanh Speech,
# mã hóa bằng age với khóa CÔNG KHAI, đẩy lên cùng bucket R2 của sao lưu liên tục (thư mục "<thư mục>-files/") bằng rclone, giữ 14 bản.
SYNCHRO_BACKUP_HOOK="/var/www/synchro/ops/backup-offsite.sh"
SYNCHRO_AGE_RECIPIENT="age1…"     # khóa công khai; khóa riêng (AGE-SECRET-KEY-1…) chủ dịch vụ giữ ngoài máy chủ
```

Lệnh nhận đường dẫn bản vừa tạo làm tham số đầu; lỗi thì bản cục bộ vẫn giữ và trang sức khỏe báo (dòng "Off-site copy").
Khóa R2 lấy từ cài đặt sao lưu liên tục (Cài đặt → Sức khỏe hệ thống) qua `ops/r2-creds.mjs` chạy bằng web user, chỉ đi qua biến môi trường của rclone.
Cơ sở dữ liệu không nằm trong gói này (Litestream đã đẩy liên tục, xem docs/backup-r2.md); `secret.key` cũng không: giữ một bản riêng cùng khóa age.
Máy chủ cần `age` và `rclone` (ops/setup.sh tự cài bằng apt).

**Mở bản chụp tệp trên R2** (máy bất kỳ có khóa riêng):

```bash
# Tải về bằng rclone (hoặc tải trên trang R2 của Cloudflare), rồi giải mã. Có lệnh age:
age -d -i age-key.txt files-<STAMP>.tar.gz.age | tar -xz
# Không có age, chỉ cần Node:
node ops/age-decrypt.mjs age-key.txt files-<STAMP>.tar.gz.age | tar -xz
# Được: uploads/ (đặt lại vào <app>/.cache/files), data/outputs, data/skills, data/speech
```

Đã diễn tập ngày 13/11/2026: bản 202 MB tải từ R2, giải mã trên máy khác bằng `age-decrypt.mjs`, đọc đủ 319 tệp.

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
node ops/purge-orphans.mjs            # chỉ liệt kê
node ops/purge-orphans.mjs --apply    # xóa, bằng root
```

## Nhật ký sudo không chứa lời nhắn

Antigravity chỉ nhận prompt qua tham số `-p`, nên dòng lệnh `sudo -u synchro-cli … agy -p <prompt>` có nguyên lời nhắn của người dùng. `ops/setup-engine-user.sh` đặt `Defaults:<user Synchro> !log_allowed` để sudo không chép lệnh được phép vào `auth.log` và journal (lệnh bị từ chối vẫn được ghi). Máy cài trước khi có dòng này phải chạy lại script một lần: script ghi đè đúng quy tắc sudo, không đụng tới dữ liệu. Kiểm tra: `sudo cat /etc/sudoers.d/synchro-cli` có dòng `Defaults:`.

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

`server/ai/cliupdate.ts`, Cài đặt → Providers → CLI updates (chủ sở hữu bật / tắt, bấm "Cập nhật ngay", trả về bản trước; quản trị viên chỉ xem). Mỗi tuần khoảng 04:00 giờ máy chủ:

1. Cài bản mới nhất cạnh bản đang chạy, mỗi bản một thư mục: `<engine home>/.local/versions/<cli>/<bản>-<mốc>/bin/<cli>` (claude, codex: `npm install -g --prefix` vào thư mục đó, đúng bản `npm view` báo; agy: script cài của Google với `--dir`; grok: script cài của xAI với `HOME` trỏ vào thư mục của bản đó nên không đè `.grok/downloads` đang chạy).
2. Kiểm tra bản mới: `--version`, rồi `auth status` / `login status` / `models` bằng đăng nhập sẵn có của chủ sở hữu (hoặc quản trị viên khác). Không chat nên không tốn hạn mức gói. Bản cũ đọc được đăng nhập mà bản mới không thì không dùng.
3. Đạt thì đổi `<engine home>/.local/bin/<cli>` thành liên kết tới bản mới (một lần `mv`). Bản trước giữ lại (lần đầu: liên kết cũ tới `.local/lib/node_modules`, hoặc tệp `agy` cũ đổi tên thành `agy.synchro-prev`); bản cũ hơn bị xóa.
4. Theo dõi tối đa 5 lượt thật đầu tiên trong 3 ngày: hai lượt đầu đều lỗi (CLI chết, không phản hồi, hãng không nhận đăng nhập), hoặc lỗi nhiều hơn chạy được sau 3 lượt, thì tự trả về bản trước và không cài lại bản đó.

Thư mục đăng nhập (`logins/`, `engine-tokens/`) không bao giờ bị chép, chuyển hay xóa. Kết quả vào Autopilot của quản
trị viên (lần hằng tuần chỉ báo khi có thay đổi hay lỗi). Claude Code chạy với `DISABLE_AUTOUPDATER=1` để không tự tải
bản mới đè lên bản đã kiểm tra. Tắt hẳn: `SYNCHRO_CLI_AUTOUPDATE=0` trong `.env.production` (Claude Code lại tự cập nhật
như trước). Trả về tay khi web không mở được: `sudo -u synchro-cli ln -sfn <đích cũ>
/var/www/synchro-engine/.local/bin/<cli>` (đích cũ xem bằng `ls -la .local/versions/<cli>` hoặc `readlink` trước khi cập
nhật).

## Hạn mức đĩa

- Dịch vụ workspace kiểm tra mỗi phút: quá 5 GB (`WS_DISK_MB`) thì cảnh báo, quá 6 GB thì dừng workspace (cho 5 phút sau khi bật để người dùng dọn), dưới 3 GB trống (`WS_MIN_FREE_MB`) thì không nhận việc mới và dừng workspace tốn đĩa nhất.
- Khi dừng vì vượt hạn mức hoặc đĩa sắp đầy, dịch vụ xóa thêm bộ nhớ đệm của workspace đó (`.cache`, `.npm/_cacache`, thư mục giữ lại giữa các lần chạy). Không đụng tệp của người dùng.
- Đây là kiểm tra định kỳ, không phải hạn mức của hệ thống tệp: một lệnh `dd` nhanh vẫn ghi được vài GB trong một phút. Muốn chặn cứng cần đặt `/srv/synchro-ws` trên phân vùng riêng có project quota (XFS / ext4).
- Tệp tải lên: 2 GB mỗi tài khoản (`SYNCHRO_UPLOAD_QUOTA_MB`), 300 tệp mỗi giờ; đĩa dưới 2 GB trống (`SYNCHRO_MIN_FREE_MB`) thì từ chối tệp mới. Người dùng tự xóa tệp ở Cài đặt → Quyền riêng tư.
- Tệp do code tạo: 5 GB mỗi tài khoản (`SYNCHRO_OUTPUT_QUOTA_MB`), vượt thì từ chối tệp mới và báo trong tin nhắn, không xóa tệp cũ; đĩa dưới mức trên thì không lưu tệp mới và báo cho model. Tệp quá 30 ngày được dọn mỗi ngày.

## Đọc tệp đặc biệt (HEIC, Office cũ, OCR)

Ba loại tệp cần chương trình cài trên máy chủ, cài một lần bằng root: `sudo bash ops/install-media-deps.sh` (chạy
lại không đổi gì; in phiên bản và tự kiểm cả ba ở cuối).

- Ảnh HEIC (iPhone): web thử sharp trước (giải được AVIF và mọi ảnh HEIF mã AV1); sharp trên npm không có bộ giải
  HEVC nên ảnh iPhone đi tiếp sang `heif-dec` / `heif-convert` (gói `libheif-examples`, Ubuntu 24.04 thêm
  `libheif-plugin-libde265`). Đặt `SYNCHRO_HEIF_BIN` để chỉ công cụ khác. Mỗi ảnh tối đa 60 giây, 40 triệu điểm ảnh
  (đọc từ đầu tệp, trước khi giải mã; ảnh giải ra lớn hơn kích thước tệp khai thì bị từ chối) và 1,5 GB bộ nhớ ảo qua
  `prlimit --as` (`SYNCHRO_HEIF_MEM_MB`). Giải ảnh đi hàng đọc tệp thường (cùng docx / PDF, 1-3 giây mỗi ảnh), không
  chờ sau chép lời.
- Office cũ `.doc` / `.xls` / `.ppt`: LibreOffice `-nogui`, web gọi `SYNCHRO_SOFFICE_BIN` (đặt sẵn `/usr/bin/soffice`
  trong `ecosystem.config.cjs`), tối đa 180 giây mỗi tệp, rồi đọc như `.docx` / `.xlsx` / `.pptx`.
- OCR trang PDF scan: `SYNCHRO_OCR=1` (đặt sẵn trong `ecosystem.config.cjs`), Python trong `.mkvenv` với gói của
  `requirements.txt` (deploy có tham số `pip`) cộng `libgl1`, GLib của hệ thống. Mọi trang scan của một tệp OCR trong
  một tiến trình (nạp mô hình một lần), sau khi tệp đã trả chỗ trong hàng đọc tệp, nên PDF scan không làm docx / xlsx
  của người khác phải chờ. Mỗi tệp chờ hàng "convert" tối đa 15 giây và OCR tối đa 45 giây
  (`SYNCHRO_OCR_BUDGET_MS`), quá thì các trang còn lại chỉ gửi ảnh trang như khi chưa bật OCR; nhật ký ghi
  `[ocr] hết 45 giây, OCR được a/b trang`. Thời gian OCR mỗi trang chưa đo trên máy chủ thật: sau khi bật, xem dòng
  này để chỉnh ngân sách.

Office cũ, OCR và chép lời đi hàng "convert" (`SYNCHRO_CONVERT_MAX`, mặc định 2 việc cùng lúc trên cả máy, mỗi người
một việc). Cả ba công cụ chạy ưu tiên thấp, không có biến môi trường bí mật. Ước lượng (chưa đo trên máy chủ thật):
đĩa thêm khoảng 300-400 MB cho LibreOffice, dưới 5 MB cho libheif; bộ nhớ chỉ trong lúc đọc tệp, khoảng 100-150 MB
cho một ảnh iPhone 12 MP, 150-300 MB cho một lần soffice, 300-500 MB cho một tiến trình OCR, nên đỉnh thêm vào khoảng
1 GB (hai việc convert cùng lúc cộng hai ảnh HEIC).

Kiểm tra: **Cài đặt → Sức khỏe hệ thống → Đọc tệp đặc biệt**. Một lần đo giải ảnh HEIC mẫu
`scripts/media-probe.heic`, chạy `soffice --version` rồi nạp thư viện OCR, lần lượt, trong hàng "convert" (nên tính
vào cùng đỉnh bộ nhớ ở trên; hàng bận quá 20 giây thì bỏ lần đo, giữ kết quả cũ). Trang luôn hiện kết quả gần nhất
ngay, cũ hơn 1 phút thì đo lại ở nền: vừa cài xong, bấm Làm mới vài giây sau là thấy. `/api/health` đo lại tối đa
10 phút một lần. Thiếu thì có dòng "Nên xem" ở đầu trang; nhật ký máy chủ có dòng `[media]`, `[heic]`, `[office]`,
`[ocr]` kèm lý do.

## Swap của máy chủ

- `ops/setup-swap.sh` (Blueprint G3.3) thêm 4 GB swap ở `/swapfile`: `fallocate` (không được thì `dd`), `chmod 600`, `mkswap`, `swapon`, một dòng trong `/etc/fstab` để bật lại sau khi khởi động máy, `vm.swappiness = 10` (ghi ở `/etc/sysctl.d/90-synchro-swap.conf`) để chỉ dùng swap khi RAM thật gần hết.
- `ops/server-build.sh` gọi script này mỗi lần deploy. Chạy lại không đổi gì khi máy đã có từ 4 GB swap; đĩa không còn đủ 4 GB + 3 GB trống (`SWAP_MIN_FREE_MB`) thì bỏ qua; lỗi không chặn deploy. Chạy tay: `sudo bash ops/setup-swap.sh`; tùy chọn `SWAP_FILE`, `SWAP_MB`, `SWAP_SWAPPINESS`.
- Container chạy code và workspace có `--memory-swap` = `--memory` + 1 GB (`WS_SWAP_EXTRA`, hoặc đặt hẳn `WS_RUN_MEMORY_SWAP` / `WS_MEMORY_SWAP`; `-1` = không giới hạn): vượt RAM chút ít thì tràn sang swap thay vì bị kill (mã 137). Không có swap trên máy chủ thì phần thêm này không có tác dụng; dịch vụ workspace ghi cảnh báo lúc khởi động. Kiểm tra: `swapon --show` và `free -m`.
- Swap là đệm chống hết bộ nhớ, không tính vào trần số việc chạy cùng lúc (`WS_RUN_MAX`, `WS_MAX_RUNNING`, `SYNCHRO_TURNS_GLOBAL` vẫn tính theo RAM thật).

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
