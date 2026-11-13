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
DATA="${DATA_DIR:-$APP/data}"
# Bản build có mã xanh/lam (app/role.ts: khóa primary; app/drain.ts: tắt êm). Bản cũ hơn chạy ở green thì thành primary thứ hai ngay khi bật
# và không thoát khi nhận SIGTERM: không được chuyển.
has_bg_code() { grep -rqs "SYNCHRO_PRIMARY_LOCK" "$1/server" && grep -rqs "NEXT_MANUAL_SIG_HANDLE" "$1/server"; }
primary_color() { awk 'NR==1{print $2}' "$DATA/.primary.pid" 2>/dev/null || true; }
ENVO="${SYNCHRO_OPS_ENV:-/etc/synchro-ops.env}"
NOPRIMARY="Lúc này KHÔNG có tiến trình nào là primary: không sao lưu litestream, không bộ hẹn giờ tác vụ."
# Trả lại bản một tiến trình cũ (green không nhận được vai primary): bật lại app pm2 cũ, nginx về cổng cũ, bỏ màu sống, dừng green.
# Không còn app cũ trong pm2 thì không đụng gì, chỉ hướng dẫn.
rollback_old() {
  if ! bg_pm2_has "$OLDPM2"; then
    echo "$NOPRIMARY Không còn app pm2 \"$OLDPM2\" để trả lại. Xem: cat $DATA/.primary.pid; su - synchro -c 'pm2 logs synchro-green'. Khóa của tiến trình đã chết: xóa tệp khóa, green nhận vai trong vài giây." >&2
    return 1
  fi
  rm -f "$BG_LIVE_FILE"
  bg_pm2 restart "$OLDPM2" >/dev/null 2>&1 || true
  if bg_healthy "$OLDPORT" "$ID" && bg_switch_upstream "$OLDPORT"; then bg_stop green || true; echo "Đã trả lại bản cũ \"$OLDPM2\" ở cổng $OLDPORT (nó là primary). Xem pm2 logs synchro-green rồi chạy lại." >&2
  else echo "CẢNH BÁO: bản cũ chưa lên lại ở cổng $OLDPORT, nginx vẫn ở green 3002. $NOPRIMARY Cần xem tay ngay." >&2; fi
  return 1
}
# Các bước cuối, rẻ và chạy lại được: chạy cả khi chuyển đổi trước đó bị cắt ngang sau lúc ghi màu sống (mất ssh, pm2 save lỗi).
finish_steps() { # finish_steps <màu sống>
  local c="$1" p rc=0
  p=$(bg_port_of "$c")
  if bg_pm2_has "$OLDPM2"; then
    say "App pm2 cũ \"$OLDPM2\" vẫn còn trong pm2: dừng và xóa (không thì khởi động lại máy sẽ bật lại nó)."
    bg_pm2 stop "$OLDPM2" >/dev/null 2>&1 || true
    bg_pm2 delete "$OLDPM2" >/dev/null 2>&1 || { echo "LỖI: không xóa được app pm2 \"$OLDPM2\": chưa pm2 save (không lưu app cũ vào danh sách khởi động lại máy). Xóa tay rồi chạy lại." >&2; rc=1; }
  fi
  if [ "$rc" = 0 ]; then
    if bg_pm2 save >/dev/null 2>&1; then say "pm2 save: danh sách khởi động lại máy có synchro-$c"
    else echo "LỖI: pm2 save không được: khởi động lại máy có thể bật sai app. Chạy lại script này." >&2; rc=1; fi
  fi
  # Watchdog đọc tệp màu sống và tệp upstream trước; các dòng này chỉ là dự phòng.
  if [ -f "$ENVO" ]; then
    sed -i -e "s/^PM2=.*/PM2=synchro-$c/" -e "s/^PORT=.*/PORT=$p/" "$ENVO"
    say "$ENVO: PM2=synchro-$c PORT=$p"
  fi
  [ "$(primary_color)" = "$c" ] || echo "CẢNH BÁO: khóa primary ($DATA/.primary.pid) không ghi màu $c: xem pm2 logs synchro-$c." >&2
  return "$rc"
}

LIVE=$(bg_live_color)
if [ -n "$LIVE" ]; then
  say "Đã chuyển từ trước: màu sống $LIVE (cổng $(bg_port_of "$LIVE")), nginx trỏ cổng $(bg_upstream_port). Làm nốt các bước cuối nếu còn thiếu."
  # Chỉ làm nốt khi màu sống thật sự đang là primary (lần trước có thể bị cắt ngang lúc chờ green nhận vai). Không thì xử lý như lần chạy
  # liền mạch: trả lại bản cũ nếu app cũ còn trong pm2; không xóa app cũ, không pm2 save.
  for _ in $(seq 1 20); do [ "$(primary_color)" = "$LIVE" ] && break; sleep 1; done
  if [ "$(primary_color)" != "$LIVE" ]; then
    echo "LỖI: màu sống $LIVE chưa nhận vai primary (khóa: $(cat "$DATA/.primary.pid" 2>/dev/null || echo không có))." >&2
    OLDPORT=3000; ID=$(cat "$APP/.next/BUILD_ID" 2>/dev/null || true)
    if [ "$LIVE" = green ]; then rollback_old || true; else echo "$NOPRIMARY Xem pm2 logs synchro-$LIVE." >&2; fi
    exit 1
  fi
  rc=0; finish_steps "$LIVE" || rc=$?
  [ "$rc" = 0 ] && say "Xong. Deploy bình thường bằng scripts/server-build.sh."
  exit "$rc"
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
if [ "$RESUME" = 0 ]; then
  # Bản đang chạy phải chính là .next này (lần deploy kiểu cũ có thể đã lỗi rồi trả bản trước về) và phải có mã xanh/lam.
  RUNNING=$( { curl -sS --max-time 5 "http://127.0.0.1:$OLDPORT/api/health" 2>/dev/null || true; } | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')
  [ "$RUNNING" = "$ID" ] || { echo "Bản đang chạy ở cổng $OLDPORT (${RUNNING:-không trả lời}) không phải $APP/.next ($ID): deploy lại bằng cách cũ cho đạt rồi chạy lại." >&2; exit 1; }
  has_bg_code "$APP/.next" || { echo "Bản build đang chạy ($ID) chưa có mã xanh/lam (app/role.ts, app/drain.ts): deploy bản này bằng cách cũ cho đạt (build ok) rồi chạy lại." >&2; exit 1; }
fi
if [ "$RESUME" = 1 ] && has_bg_code "$APP/.next-green" && bg_healthy 3002 "$(cat "$APP/.next-green/BUILD_ID" 2>/dev/null)"; then
  ID=$(cat "$APP/.next-green/BUILD_ID")
  say "synchro-green đang chạy tốt ở 3002 ($ID)"
else
bg_stop green
rm -rf "$APP/.next-green.tmp"
rsync -a --exclude /cache --exclude /node_modules "$APP/.next/" "$APP/.next-green.tmp/"
# Thư viện riêng của green (ecosystem.config.cjs chạy next từ .next-green/node_modules).
ln -sfn "$(bg_mods_current "$APP")" "$APP/.next-green.tmp/node_modules"
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
# Bản cũ phải thật sự đã thoát (pm2 stop đạt và cổng thôi trả lời) rồi mới ghi màu sống: không thì green nhận vai primary bên cạnh nó.
# Chưa xóa app cũ khỏi pm2: green không nhận vai thì bật lại nó.
STOPPED=1
if ! bg_pm2 stop "$OLDPM2" >/dev/null 2>&1; then
  STOPPED=0
  # App đã không còn trong pm2 (đã xóa tay ở lần chạy trước): coi như đã dừng nếu cổng cũng trống (kiểm tra ngay dưới).
  if bg_pm2_has "$OLDPM2"; then
    echo "pm2 stop \"$OLDPM2\" lỗi. Web vẫn chạy: nginx ở green 3002 (cùng bản $ID, chưa nhận vai primary), bản cũ vẫn là primary. Dừng bản cũ bằng tay rồi chạy lại script." >&2
    exit 1
  fi
  say "App pm2 \"$OLDPM2\" không còn trong pm2: kiểm tra cổng $OLDPORT đã trống."
fi
gone=0
for _ in $(seq 1 15); do curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$OLDPORT/api/health" 2>/dev/null || { gone=1; break; }; sleep 1; done
if [ "$gone" != 1 ]; then
  if [ "$STOPPED" = 0 ]; then
    echo "Không có app pm2 \"$OLDPM2\" nhưng cổng $OLDPORT vẫn trả lời: bản cũ có thể chạy dưới tên khác (pm2 ls). Chưa ghi màu sống: green vẫn là secondary, nginx ở 3002; tiến trình ở cổng $OLDPORT (nếu là Synchro) vẫn là primary. Chạy lại script với đúng tên app cũ (tham số thứ 2)." >&2
    exit 1
  fi
  echo "Cổng $OLDPORT vẫn trả lời sau khi dừng \"$OLDPM2\": còn tiến trình khác giữ cổng. Chưa ghi màu sống: green vẫn là secondary, nginx ở 3002, bản cũ đã dừng. $NOPRIMARY Cách xử lý: dừng tiến trình đang giữ cổng $OLDPORT (ss -ltnp | grep :$OLDPORT) rồi chạy lại script; hoặc trả lại bản cũ: su - synchro -c 'pm2 restart $OLDPM2' rồi đưa nginx về $OLDPORT (docs/van-hanh.md)." >&2
  exit 1
fi
# Ghi màu sống SAU khi bản cũ đã thoát: bản cũ chạy một tiến trình nên có thể chưa nhường khóa đúng lúc. Từ lần deploy sau, bản cũ giữ
# khóa xanh/lam nên server-build.sh ghi màu sống trước rồi mới dừng bản cũ.
bg_write_live green 3002 "$APP"
# green nhận vai trong vài giây (khóa primary ghi màu green). Không nhận: trả lại bản cũ (bật lại app pm2 cũ, nginx về cổng cũ, bỏ màu sống, dừng green).
for _ in $(seq 1 20); do [ "$(primary_color)" = green ] && break; sleep 1; done
if [ "$(primary_color)" != green ]; then
  echo "LỖI: sau 20 giây green chưa nhận vai primary (khóa: $(cat "$DATA/.primary.pid" 2>/dev/null || echo không có)): trả lại bản cũ." >&2
  bg_pm2 logs synchro-green --nostream --lines 40 >&2 || true
  rollback_old || true
  exit 1
fi
say "synchro-green đã nhận vai primary ($(cat "$DATA/.primary.pid"))"
# ---- 5. xóa app cũ, pm2 save, watchdog ----
bg_pm2 delete "$OLDPM2" >/dev/null 2>&1 || true
rc=0; finish_steps green || rc=$?
[ "$rc" = 0 ] || exit "$rc"
say "Xong. Màu sống: green (cổng 3002). Bản build cũ $APP/.next giữ nguyên để trả lại bằng tay (docs/van-hanh.md); xóa khi đã yên tâm."
