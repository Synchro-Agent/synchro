#!/usr/bin/env bash
# Dựng bản production trên máy chủ rồi thay bản đang chạy (chạy bằng root): bash scripts/server-build.sh [thư mục app] [tên pm2] [pip] [cổng]
#   bash /var/www/synchro/scripts/server-build.sh /var/www/synchro synchro pip
# Không làm gián đoạn web:
# - Dựng ở thư mục riêng không có data/ (dữ liệu lúc chạy: ~3.000 thư viện skill, hàng trăm nghìn tệp): build ngay trong thư mục app thì
#   Next.js dò cả data/ và hết bộ nhớ.
# - Thư viện (node_modules) chỉ cài lại khi package-lock.json đổi, và cài vào thư mục riêng: trước đây `npm ci` xóa node_modules mà web
#   đang dùng, web trả 502 trong lúc cài.
# - Bản build và thư viện mới chỉ thay bản cũ khi đã xong hết (đổi tên thư mục trên cùng ổ đĩa, rồi khởi động lại); lỗi ở bất kỳ bước nào
#   thì web vẫn chạy bản cũ.
# - Sau khi khởi động lại: gọi /api/health tối đa ~90 giây; không đạt thì tự trả bản trước về chỗ cũ, khởi động lại và báo lỗi (deploy dừng ở đây).
# - Bản trước được giữ tới lần deploy sau, bên cạnh thư mục app (.synchro-prev-<tên>): rsync --delete của deploy không đụng tới.
# - Tab đang mở từ bản cũ vẫn tải được chunk cũ: static của các bản trong ~1 ngày qua (ít nhất bản liền trước) được chép vào bản mới
#   (.synchro-statics-<tên>; Next đọc danh sách .next/static lúc khởi động nên chép trước khi khởi động lại).
set -euo pipefail
APP="${1:-/var/www/synchro}"; PM2="${2:-synchro}"; PIP="${3:-}"; PORT="${4:-}"
SIDE="$(dirname "$APP")"; NAME="$(basename "$APP")"
PREV="$SIDE/.synchro-prev-$NAME"; STATICS="$SIDE/.synchro-statics-$NAME"; GOOD="$SIDE/.synchro-good-$NAME"
# Một lần deploy mỗi lúc; watchdog (scripts/watchdog.sh) thấy khóa này thì không khởi động lại web giữa chừng. Lần sau chờ lần trước xong, không cắt ngang lúc đang tráo bản.
if command -v flock >/dev/null 2>&1; then
  exec 9>/run/synchro-deploy.lock
  flock -w 900 9 || { echo "Đang có lần deploy khác chạy quá lâu." >&2; exit 1; }
fi
B=$(mktemp -d "$SIDE/.build-$NAME.XXXXXX")
trap 'rm -rf "$B"' EXIT
chown -R synchro:synchro "$APP"
# Mã do root chạy (scripts/, workspace/: sao lưu, cài đặt, deploy) chỉ root ghi được, kể cả thư mục app (ai sở hữu thư mục cha đổi tên được thư mục con).
# Nhờ vậy chiếm được web user (lỗi trong bộ đọc tệp chẳng hạn) không leo được lên root qua cron hay lần deploy sau. Web user vẫn ghi được data/, .cache/, .next/, node_modules/.
mkdir -p "$APP/.cache" "$APP/data"
chown synchro:synchro "$APP/.cache" "$APP/data"
chown root:root "$APP"; chmod 755 "$APP"
chown -R root:root "$APP/scripts" "$APP/workspace"; chmod -R go-w "$APP/scripts" "$APP/workspace"
if [ -d "$APP/workspace/data" ]; then chown -R synchro:synchro "$APP/workspace/data"; fi
# Blueprint G3.3: 4 GB swap cho máy chủ (container có --memory-swap lớn hơn --memory chỉ tràn sang swap được khi máy có swap). Chạy lại không đổi gì
# khi đã có; đĩa thiếu hay lỗi thì bỏ qua, không chặn deploy.
bash "$APP/scripts/setup-swap.sh" 9>&- || echo "Không thêm được swap cho máy chủ (bỏ qua)." >&2
[ -n "$PIP" ] && su - synchro -c "cd $APP && .mkvenv/bin/pip install -q -r requirements.txt"
rsync -a --exclude /data --exclude /.next --exclude '/.next-*' --exclude /node_modules --exclude /.git --exclude /workspace/data --exclude /.mkvenv "$APP/" "$B/"
LOCK=$(sha1sum "$APP/package-lock.json" | cut -d' ' -f1)
NEWMOD=""
if [ -d "$APP/node_modules" ] && [ "$(cat "$APP/node_modules/.synchro-lock" 2>/dev/null)" = "$LOCK" ]; then
  ln -s "$APP/node_modules" "$B/node_modules"
else
  chown -R synchro:synchro "$B"
  su - synchro -c "cd $B && npm ci"
  echo "$LOCK" > "$B/node_modules/.synchro-lock"
  NEWMOD=1
fi
chown -R synchro:synchro "$B"
su - synchro -c "cd $B && NODE_OPTIONS=--max-old-space-size=3072 npx next build"
rm -rf "$B/.next/cache" "$B/.next/server/route-cache"
NEWID=$(cat "$B/.next/BUILD_ID")

# Chunk của các bản trước cho tab đang mở. Lưu static "thuần" của từng bản (trước khi trộn), nếu không chunk cũ được mang theo mãi.
mkdir -p "$STATICS"
OLDID=$(cat "$APP/.next/BUILD_ID" 2>/dev/null || true)
if [ -n "$OLDID" ] && [ ! -d "$STATICS/$OLDID" ] && [ -d "$APP/.next/static" ]; then cp -a "$APP/.next/static" "$STATICS/$OLDID"; fi
# Tính "một ngày" từ lúc bản đó bị thay, không phải lúc được dựng: bản chạy cả tuần vừa bị thay thì tab đang mở vẫn cần chunk của nó.
[ -n "$OLDID" ] && [ -d "$STATICS/$OLDID" ] && touch "$STATICS/$OLDID"
rm -rf "$STATICS/$NEWID"
cp -a "$B/.next/static" "$STATICS/$NEWID"
find "$STATICS" -mindepth 1 -maxdepth 1 -type d -mmin +1440 ! -name "$OLDID" ! -name "$NEWID" -exec rm -rf {} +
for d in "$STATICS"/*/; do
  [ "$(basename "$d")" = "$NEWID" ] || rsync -a --ignore-existing "$d" "$B/.next/static/"
done

# Cổng để gọi kiểm tra sức khỏe: tham số thứ 4, nếu không thì đọc từ pm2 (-p <cổng> hoặc PORT).
if [ -z "$PORT" ]; then
  PORT=$(su - synchro -c "pm2 jlist" 2>/dev/null | PM2_NAME="$PM2" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const e = JSON.parse(s.slice(s.indexOf("["))).find((x) => x.name === process.env.PM2_NAME)?.pm2_env ?? {};
        const a = [].concat(e.args ?? []).map(String), i = a.indexOf("-p");
        process.stdout.write(String(i >= 0 ? a[i + 1] : e.PORT ?? e.env?.PORT ?? ""));
      } catch {}
    });' || true)
fi
[ -z "$PORT" ] && [ "$PM2" = "synchro" ] && PORT=3001

# 9>&-: tiến trình nền của pm2 không được mang theo khóa deploy.
restart() { su - synchro -c "pm2 restart $PM2 --update-env" 9>&- || su - synchro -c "cd $APP && pm2 start npm --name $PM2 -- start -- -p ${PORT:-3001} && pm2 save" 9>&-; }
# Đạt khi: /api/health báo đúng bản $1 (không phải tiến trình cũ còn sót), ghi được cơ sở dữ liệu và trang chủ không lỗi.
# Không xét mã 503 của /api/health: đĩa gần đầy hay dịch vụ workspace tắt không phải lỗi của bản mới, trả bản cũ về cũng không hết.
healthy() {
  [ -n "$PORT" ] || return 0
  for _ in $(seq 1 45); do
    H=$(curl -sS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
    case "$H" in *"\"build\":\"$1\""*"\"db\":true"*) curl -fsS --max-time 15 -o /dev/null "http://127.0.0.1:$PORT/" && return 0 ;; esac
    sleep 2
  done
  return 1
}
# Sau khi trả bản trước: chỉ cần trang chủ lên (bản trước của lần deploy đầu tiên chưa có /api/health).
up() {
  [ -n "$PORT" ] || return 0
  for _ in $(seq 1 45); do curl -fsS --max-time 15 -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 2; done
  return 1
}

# Tráo: cùng ổ đĩa nên đổi tên gần như tức thì. Bản đang chạy chuyển sang .synchro-prev để trả lại được.
rm -rf "$PREV"; mkdir -p "$PREV"
[ -d "$APP/.next" ] && mv "$APP/.next" "$PREV/next"
mv "$B/.next" "$APP/.next"
if [ -n "$NEWMOD" ]; then [ -d "$APP/node_modules" ] && mv "$APP/node_modules" "$PREV/node_modules"; mv "$B/node_modules" "$APP/node_modules"; fi
chown -R synchro:synchro "$APP/.next" "$APP/node_modules"
restart || true
if [ -z "$PORT" ]; then echo "CẢNH BÁO: không biết cổng của $PM2 nên bỏ qua kiểm tra sức khỏe (truyền cổng ở tham số thứ 4)." >&2; fi
if ! healthy "$NEWID"; then
  echo "BẢN MỚI KHÔNG ĐẠT kiểm tra sức khỏe: trả lại bản trước." >&2
  su - synchro -c "pm2 logs $PM2 --nostream --lines 40" >&2 || true
  [ -d "$PREV/next" ] || { echo "Không có bản trước để trả lại." >&2; exit 1; }
  rm -rf "$SIDE/.synchro-failed-$NAME"; mkdir -p "$SIDE/.synchro-failed-$NAME"
  mv "$APP/.next" "$SIDE/.synchro-failed-$NAME/next"
  mv "$PREV/next" "$APP/.next"
  if [ -d "$PREV/node_modules" ]; then mv "$APP/node_modules" "$SIDE/.synchro-failed-$NAME/node_modules"; mv "$PREV/node_modules" "$APP/node_modules"; fi
  # rsync của CI đã đè public/ và db/ trước khi build: trả về bản của lần deploy tốt gần nhất, không thì bản cũ chạy với tệp tĩnh và dữ liệu mẫu của bản lỗi.
  for d in public db; do if [ -d "$GOOD/$d" ] && [ -d "$APP/$d" ]; then rsync -a --delete "$GOOD/$d/" "$APP/$d/" || true; fi; done
  restart || true
  if up; then echo "Đã trả lại bản $OLDID, web đang chạy bình thường. Bản lỗi giữ ở $SIDE/.synchro-failed-$NAME để xem." >&2
  else echo "ĐÃ TRẢ LẠI BẢN $OLDID NHƯNG VẪN KHÔNG ĐẠT: cần xử lý tay ngay (xem docs/van-hanh.md)." >&2; fi
  exit 1
fi
rm -rf "$SIDE/.synchro-failed-$NAME"
# Lỗi ở đây không được làm hỏng lần deploy đã đạt.
for d in public db; do if [ -d "$APP/$d" ]; then mkdir -p "$GOOD/$d" && rsync -a --delete "$APP/$d/" "$GOOD/$d/" || true; fi; done
echo "build ok: $NEWID (bản trước giữ ở $PREV)"
