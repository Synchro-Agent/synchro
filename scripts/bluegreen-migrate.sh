#!/usr/bin/env bash
# Chuyển production sang deploy xanh/lam MỘT LẦN, không gián đoạn web (chạy bằng root trên VPS, chạy lại an toàn):
#   bash /var/www/synchro/scripts/bluegreen-migrate.sh [thư mục app] [tên pm2 cũ] [tệp site nginx]
#   mặc định: /var/www/synchro synchro /etc/nginx/sites-enabled/synchro
# Các bước (mỗi bước tự bỏ qua nếu đã làm):
# 1. nginx: tạo /etc/nginx/snippets/synchro-upstream.conf trỏ cổng hiện tại (3000), sửa site để include tệp này thay cho proxy_pass cứng
#    (sao lưu site trước, nginx -t, lỗi thì trả site cũ). Lúc này nginx vẫn trỏ đúng chỗ cũ: chưa có gì thay đổi với người dùng.
# 2. node_modules: chuyển vào kho theo băm ($SIDE/.synchro-mods/<băm>), $APP/node_modules thành liên kết.
# 3. Chép bản build đang chạy (.next) sang .next-green, bật synchro-green ở cổng 3002 (ecosystem.config.cjs), kiểm tra /api/health.
#    Không đạt: dừng green, không đổi gì nữa.
# 4. nginx chuyển sang 3002, kiểm tra qua nginx; dừng rồi xóa app pm2 cũ "synchro" (cổng 3000), ghi màu sống = green, pm2 save.
#    green nhận vai primary khi tiến trình cũ đã thoát (app/role.ts).
# 5. /etc/synchro-ops.env: PM2/PORT của watchdog theo màu sống (watchdog cũng tự đọc tệp màu sống).
# Sau đó mỗi lần deploy (scripts/server-build.sh) tự dùng xanh/lam: bản mới ở màu nghỉ (blue 3000 ⇄ green 3002), bản cũ thoát sau khi nginx chuyển.
set -euo pipefail
APP="${1:-/var/www/synchro}"; OLDPM2="${2:-synchro}"; SITE="${3:-/etc/nginx/sites-enabled/synchro}"
SIDE="$(dirname "$APP")"
. "$(dirname "${BASH_SOURCE[0]}")/bluegreen-lib.sh"
[ "$(id -u)" = 0 ] || { echo "Chạy bằng root." >&2; exit 1; }
[ -f "$APP/ecosystem.config.cjs" ] || { echo "Thiếu $APP/ecosystem.config.cjs: deploy bản có xanh/lam trước (bằng cách cũ), rồi chạy lại." >&2; exit 1; }
if command -v flock >/dev/null 2>&1; then
  exec 9>/run/synchro-deploy.lock
  flock -w 900 9 || { echo "Đang có lần deploy khác." >&2; exit 1; }
fi
say() { echo "• $*"; }

LIVE=$(bg_live_color)
if [ -n "$LIVE" ]; then
  say "Đã chuyển từ trước: màu sống $LIVE (cổng $(bg_port_of "$LIVE")), nginx trỏ cổng $(bg_upstream_port)."
  say "Không làm gì thêm. Deploy bình thường bằng scripts/server-build.sh."
  exit 0
fi

# ---- 1. nginx include ----
OLDPORT=$(sed -n 's/^[[:space:]]*proxy_pass[[:space:]]*http:\/\/127\.0\.0\.1:\([0-9]*\);.*/\1/p' "$SITE" | head -1)
[ -n "$OLDPORT" ] || OLDPORT=$(bg_upstream_port)
[ -n "$OLDPORT" ] || { echo "Không tìm thấy proxy_pass http://127.0.0.1:<cổng>; trong $SITE." >&2; exit 1; }
# Lần chạy trước dừng giữa chừng sau khi nginx đã sang green (3002): green đang phục vụ, không bật lại nó; làm tiếp từ bước 4.
RESUME=0
if [ "$OLDPORT" = 3002 ]; then
  RESUME=1; OLDPORT=3000
  say "Lần trước đã chuyển nginx sang 3002 nhưng chưa xong: làm tiếp."
fi
[ "$OLDPORT" = 3000 ] || echo "CẢNH BÁO: production đang ở cổng $OLDPORT (không phải 3000)." >&2
if [ ! -f "$BG_UPSTREAM" ]; then
  mkdir -p "$(dirname "$BG_UPSTREAM")"
  printf '# Do scripts/server-build.sh ghi (deploy xanh/lam), đừng sửa tay: xem docs/van-hanh.md.\nproxy_pass http://127.0.0.1:%s;\n' "$OLDPORT" > "$BG_UPSTREAM"
  chmod 644 "$BG_UPSTREAM"
  say "Tạo $BG_UPSTREAM → cổng $OLDPORT"
fi
INC="include ${BG_UPSTREAM#/etc/nginx/};"
if grep -q "synchro-upstream.conf" "$SITE"; then
  say "Site nginx đã include $BG_UPSTREAM"
else
  BAK="$SITE.before-bluegreen.$(date +%Y%m%d%H%M%S)"
  # Bản sao lưu để ngoài sites-enabled: nginx nạp mọi tệp trong đó.
  case "$SITE" in /etc/nginx/sites-enabled/*) BAK="/etc/nginx/$(basename "$SITE").before-bluegreen.$(date +%Y%m%d%H%M%S)" ;; esac
  cp -pL "$SITE" "$BAK"
  TGT=$(readlink -f "$SITE")
  # Chỉ thay đúng dòng proxy_pass tới cổng của production (không đụng proxy_pass khác, ví dụ dịch vụ workspace).
  sed -i "s|^\([[:space:]]*\)proxy_pass[[:space:]]*http://127\.0\.0\.1:$OLDPORT;|\1$INC|" "$TGT"
  if nginx -t >/dev/null 2>&1 && nginx -s reload; then say "Site nginx dùng $INC (sao lưu: $BAK)"
  else cp -p "$BAK" "$TGT"; nginx -t >/dev/null 2>&1 && nginx -s reload || true; echo "nginx -t lỗi: đã trả site cũ ($BAK). Dừng." >&2; exit 1; fi
fi

# ---- 2. node_modules theo băm ----
bg_adopt_modules "$APP" "$SIDE"
say "node_modules → $(bg_mods_current "$APP")"

# ---- 3. green ở 3002 với bản build đang chạy ----
[ -f "$APP/.next/BUILD_ID" ] || { echo "Không có $APP/.next/BUILD_ID để chép sang green." >&2; exit 1; }
ID=$(cat "$APP/.next/BUILD_ID")
if [ "$RESUME" = 1 ] && bg_healthy 3002 "$(cat "$APP/.next-green/BUILD_ID" 2>/dev/null)"; then
  ID=$(cat "$APP/.next-green/BUILD_ID")
  say "synchro-green đang chạy tốt ở 3002 ($ID)"
else
bg_stop green
rm -rf "$APP/.next-green.tmp"
rsync -a --exclude /cache "$APP/.next/" "$APP/.next-green.tmp/"
rm -rf "$APP/.next-green"; mv "$APP/.next-green.tmp" "$APP/.next-green"
chown -R synchro:synchro "$APP/.next-green"
say "Chép bản $ID sang .next-green, bật synchro-green ở cổng 3002"
bg_start "$APP" green
if ! bg_healthy 3002 "$ID"; then
  bg_pm2 logs synchro-green --nostream --lines 40 >&2 || true
  bg_stop green
  [ "$RESUME" = 1 ] && bg_switch_upstream "$OLDPORT" || true
  echo "synchro-green không đạt kiểm tra sức khỏe: dừng green, nginx trỏ cổng $OLDPORT (bản cũ)." >&2
  exit 1
fi
fi

# ---- 4. chuyển nginx, dừng bản cũ ----
bg_switch_upstream 3002 || { bg_stop green; echo "Không chuyển được nginx: web vẫn ở cổng $OLDPORT." >&2; exit 1; }
if ! bg_via_nginx "$ID"; then
  echo "CẢNH BÁO: chưa đọc được /api/health qua nginx (https://$BG_HOST, --resolve 127.0.0.1). Cả hai bản cùng mã $ID nên kiểm tra cổng:" >&2
fi
[ "$(bg_upstream_port)" = 3002 ] || { bg_switch_upstream "$OLDPORT" || true; bg_stop green; echo "nginx không trỏ 3002: trả về $OLDPORT." >&2; exit 1; }
# Bản cũ chưa có tắt êm (app/drain.ts): nginx đã đưa lượt mới sang green, nên chờ tối đa 25 giây cho các lượt bắt đầu trước lúc chuyển
# chạy xong ở bản cũ (đọc bảng runs, cần sqlite3). Lượt còn dở sau đó được green chạy lại khi nhận vai primary.
SWITCHED=$(( $(date +%s) * 1000 ))
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$APP/data/synchro.db" ]; then
  for _ in $(seq 1 25); do
    n=$(sqlite3 -readonly "$APP/data/synchro.db" "SELECT COUNT(*) FROM runs WHERE status = 'running' AND created_at < $SWITCHED" 2>/dev/null || echo 0)
    [ "${n:-0}" = 0 ] && break
    sleep 1
  done
  say "Lượt còn dở ở bản cũ khi dừng: ${n:-0}"
fi
say "Dừng app pm2 cũ \"$OLDPM2\" (cổng $OLDPORT)."
bg_pm2 stop "$OLDPM2" >/dev/null 2>&1 || true
bg_pm2 delete "$OLDPM2" >/dev/null 2>&1 || true
# Ghi màu sống SAU khi bản cũ đã dừng: bản cũ là một tiến trình (không giữ khóa primary), ghi sớm hơn thì green nhận vai trong lúc bản cũ
# vẫn chạy việc nền. Từ lần deploy sau, bản cũ giữ khóa nên server-build.sh ghi màu sống trước rồi mới dừng bản cũ.
bg_write_live green 3002 "$APP"
bg_pm2 save >/dev/null 2>&1 || true

# ---- 5. watchdog ----
ENVO=/etc/synchro-ops.env
if [ -f "$ENVO" ]; then
  sed -i -e 's/^PM2=.*/PM2=synchro-green/' -e 's/^PORT=.*/PORT=3002/' "$ENVO"
  say "$ENVO: PM2=synchro-green PORT=3002 (watchdog đọc tệp màu sống trước, các dòng này chỉ là dự phòng)"
fi

# green nhận vai trong vài giây sau khi bản cũ thoát.
for _ in $(seq 1 20); do [ -f "$APP/data/.primary.pid" ] && break; sleep 1; done
if [ -f "$APP/data/.primary.pid" ]; then say "synchro-green đã nhận vai primary ($(cat "$APP/data/.primary.pid"))"
else echo "CẢNH BÁO: sau 20 giây green chưa nhận vai primary: xem pm2 logs synchro-green." >&2; fi
say "Xong. Màu sống: green (cổng 3002). Bản build cũ $APP/.next giữ nguyên để trả lại bằng tay (docs/van-hanh.md); xóa khi đã yên tâm."
