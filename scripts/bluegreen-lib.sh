# Hàm dùng chung của deploy xanh/lam (docs/van-hanh.md, "Deploy xanh/lam"): scripts/server-build.sh, scripts/bluegreen-migrate.sh và
# tests/api/bluegreen.test.mjs nạp tệp này bằng `source`. Không chạy gì khi nạp, chỉ định nghĩa hàm và giá trị mặc định.
#   blue  = cổng 3000, thư mục build .next-blue, pm2 synchro-blue
#   green = cổng 3002, thư mục build .next-green, pm2 synchro-green   (3001 là staging, không bao giờ dùng ở đây)
# Màu đang nhận lưu lượng ghi ở $BG_LIVE_FILE (root ghi, ai cũng đọc): một dòng "<màu> <cổng> <thư mục app>". Tiến trình web đọc màu ở đầu dòng
# để biết khi nào được nhận vai primary (app/role.ts). nginx đọc cổng từ $BG_UPSTREAM (một dòng proxy_pass), đổi bằng bg_switch_upstream.

BG_STATE_DIR="${BG_STATE_DIR:-/var/lib/synchro-ops}"
BG_LIVE_FILE="${BG_LIVE_FILE:-$BG_STATE_DIR/live-color}"
BG_UPSTREAM="${BG_UPSTREAM:-/etc/nginx/snippets/synchro-upstream.conf}"
BG_HOST="${BG_HOST:-synchro.net.nz}"
BG_WEB_USER="${BG_WEB_USER-synchro}"
BG_TRIES="${BG_TRIES:-45}"; BG_SLEEP="${BG_SLEEP:-2}"

bg_log() { echo "[xanh/lam] $*" >&2; }
bg_port_of() { case "$1" in blue) echo 3000 ;; green) echo 3002 ;; *) return 1 ;; esac; }
bg_other() { case "$1" in blue) echo green ;; green) echo blue ;; *) return 1 ;; esac; }
bg_pm2_name() { echo "synchro-$1"; }
bg_color_of_port() { case "$1" in 3000) echo blue ;; 3002) echo green ;; *) return 1 ;; esac; }

# Màu đang sống ("" nếu chưa chuyển sang xanh/lam). bg_live_app: thư mục app ghi kèm (để staging không nhầm là đã chuyển).
bg_live_color() { [ -f "$BG_LIVE_FILE" ] && awk 'NR==1{print $1}' "$BG_LIVE_FILE" || true; }
bg_live_app() { [ -f "$BG_LIVE_FILE" ] && awk 'NR==1{print $3}' "$BG_LIVE_FILE" || true; }
# Ghi nguyên tử (tệp tạm cùng thư mục rồi đổi tên): tiến trình web không bao giờ đọc phải nửa dòng.
bg_write_live() { # bg_write_live <màu> <cổng> <app>
  mkdir -p "$(dirname "$BG_LIVE_FILE")"
  printf '%s %s %s\n' "$1" "$2" "$3" > "$BG_LIVE_FILE.tmp.$$"
  chmod 644 "$BG_LIVE_FILE.tmp.$$"
  mv -f "$BG_LIVE_FILE.tmp.$$" "$BG_LIVE_FILE"
}
# Có dùng xanh/lam cho thư mục app này không: BLUEGREEN=1/0 quyết định; không đặt thì theo tệp màu sống (đã chạy bluegreen-migrate.sh cho đúng app này).
bg_enabled() { # bg_enabled <app>
  case "${BLUEGREEN:-}" in 1) return 0 ;; 0) return 1 ;; esac
  [ -n "$(bg_live_color)" ] && [ "$(bg_live_app)" = "$1" ]
}

# pm2 của web user. Chạy bằng root thì qua su; kiểm thử (không phải root, hoặc BG_WEB_USER rỗng) gọi thẳng pm2 trên PATH.
# 9>&-: tiến trình nền của pm2 không được mang theo khóa deploy.
bg_pm2() {
  if [ "$(id -u)" = 0 ] && [ -n "$BG_WEB_USER" ]; then su - "$BG_WEB_USER" -c "pm2 $*" 9>&-
  else pm2 "$@" 9>&-; fi
}
bg_start() { # bg_start <app> <màu>: bật (hoặc bật lại) màu theo ecosystem.config.cjs, môi trường lấy lại từ tệp đó.
  bg_pm2 startOrRestart "$1/ecosystem.config.cjs" --only "$(bg_pm2_name "$2")" --update-env
}
# pm2 stop gửi SIGTERM rồi chờ tiến trình thoát (tối đa kill_timeout 30 giây): bản cũ chạy nốt lượt đang dở (app/drain.ts).
# Không bao giờ dừng màu mà nginx đang trỏ tới (tệp upstream là nguồn sự thật): trả mã lỗi, người gọi quyết định.
bg_stop() {
  if [ "$(bg_port_of "$1")" = "$(bg_upstream_port)" ] && [ "${BG_STOP_FORCE:-}" != 1 ]; then
    bg_log "không dừng $1: nginx đang trỏ cổng $(bg_port_of "$1") của nó"; return 1
  fi
  bg_pm2 stop "$(bg_pm2_name "$1")" >/dev/null 2>&1 || true
}

# Đạt khi: /api/health ở đúng cổng báo đúng bản $2 (không phải tiến trình cũ còn sót), ghi được cơ sở dữ liệu và trang chủ không lỗi.
# Không xét mã 503 của /api/health: đĩa gần đầy hay dịch vụ workspace tắt không phải lỗi của bản mới.
bg_healthy() { # bg_healthy <cổng> <mã bản>
  local h
  for _ in $(seq 1 "$BG_TRIES"); do
    h=$(curl -sS --max-time 5 "http://127.0.0.1:$1/api/health" 2>/dev/null || true)
    case "$h" in *"\"build\":\"$2\""*"\"db\":true"*) curl -fsS --max-time 15 -o /dev/null "http://127.0.0.1:$1/" && return 0 ;; esac
    sleep "$BG_SLEEP"
  done
  return 1
}
# Qua chính nginx của máy (đúng tên miền, --resolve về 127.0.0.1): người dùng đã tới bản $1 chưa. -k: nối tới chính máy này nên không cần
# xác thực chứng chỉ (chứng chỉ gốc của Cloudflare chẳng hạn không được curl tin); nginx chỉ nghe http thì thử thêm http với Host.
bg_via_nginx() { # bg_via_nginx <mã bản>
  local h
  for _ in $(seq 1 10); do
    h=$(curl -ksS --max-time 5 --resolve "$BG_HOST:443:127.0.0.1" "https://$BG_HOST/api/health" 2>/dev/null || true)
    case "$h" in *"\"build\":\"$1\""*) return 0 ;; esac
    h=$(curl -sS --max-time 5 -H "Host: $BG_HOST" "http://127.0.0.1/api/health" 2>/dev/null || true)
    case "$h" in *"\"build\":\"$1\""*) return 0 ;; esac
    sleep 1
  done
  return 1
}

# Màu sống phải khớp cổng nginx đang trỏ (deploy trước chết giữa lúc đổi nginx và lúc ghi màu: SIGKILL, mất ssh). Upstream là nguồn sự thật:
# sửa tệp màu sống theo nó. Tiến trình của màu đó nhận vai primary khi màu cũ thoát (app/role.ts).
bg_sync_live() { # bg_sync_live <app>
  local up c
  up=$(bg_upstream_port); c=$(bg_color_of_port "$up") || return 0
  [ "$(bg_live_color)" = "$c" ] && [ "$(bg_live_app)" = "$1" ] && return 0
  [ -n "$(bg_live_color)" ] || return 0
  bg_log "tệp màu sống ghi $(bg_live_color) nhưng nginx trỏ cổng $up: ghi lại màu sống = $c"
  bg_write_live "$c" "$up" "$1"
}
bg_upstream_port() { [ -f "$BG_UPSTREAM" ] && sed -n 's/.*127\.0\.0\.1:\([0-9]*\).*/\1/p' "$BG_UPSTREAM" | head -1 || true; }
# Trỏ nginx sang cổng mới: ghi tệp include nguyên tử, nginx -t, reload (nginx giữ kết nối đang mở tới bản cũ tới khi xong).
# nginx -t hay reload lỗi: trả tệp cũ về (hoặc xóa nếu trước đó chưa có), reload lại cấu hình cũ, trả mã lỗi; không chuyển gì cả.
bg_switch_upstream() { # bg_switch_upstream <cổng>
  local f="$BG_UPSTREAM" had=0
  mkdir -p "$(dirname "$f")"
  if [ -f "$f" ]; then cp -p "$f" "$f.bak"; had=1; fi
  printf '# Do scripts/server-build.sh ghi (deploy xanh/lam), đừng sửa tay: xem docs/van-hanh.md.\nproxy_pass http://127.0.0.1:%s;\n' "$1" > "$f.tmp.$$"
  chmod 644 "$f.tmp.$$"
  mv -f "$f.tmp.$$" "$f"
  if nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1; then rm -f "$f.bak"; bg_log "nginx đã chuyển sang cổng $1"; return 0; fi
  bg_log "nginx không nhận cấu hình mới (cổng $1): trả cấu hình cũ"
  if [ "$had" = 1 ]; then mv -f "$f.bak" "$f"; else rm -f "$f"; fi
  nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1 || bg_log "CẢNH BÁO: nginx -t vẫn lỗi sau khi trả cấu hình cũ, cần xem tay"
  return 1
}

# ---- node_modules theo mã băm package-lock.json ----
# $SIDE/.synchro-mods/<băm>/node_modules, $APP/node_modules là liên kết tới bản đang dùng (đổi nguyên tử bằng ln -sfn + mv -T).
bg_mods_dir() { echo "$1/.synchro-mods"; }  # bg_mods_dir <side>
# Thư mục node_modules thật của app (lần đầu): chuyển vào kho theo băm ghi trong .synchro-lock rồi thay bằng liên kết. Cửa sổ giữa mv và
# ln chỉ vài micro giây; tiến trình đang chạy đã nạp các gói của nó.
bg_adopt_modules() { # bg_adopt_modules <app> <side>
  local app="$1" mods h
  mods=$(bg_mods_dir "$2")
  [ -d "$app/node_modules" ] && [ ! -L "$app/node_modules" ] || return 0
  h=$(cat "$app/node_modules/.synchro-lock" 2>/dev/null || true)
  [ -n "$h" ] || h=$(sha1sum "$app/package-lock.json" | cut -d' ' -f1)
  mkdir -p "$mods/$h"
  if [ -e "$mods/$h/node_modules" ]; then rm -rf "$mods/$h/node_modules.old"; mv "$mods/$h/node_modules" "$mods/$h/node_modules.old"; fi
  mv "$app/node_modules" "$mods/$h/node_modules" && ln -s "$mods/$h/node_modules" "$app/node_modules"
  rm -rf "$mods/$h/node_modules.old"
  bg_log "node_modules chuyển vào $mods/$h"
}
bg_mods_current() { readlink "$1/node_modules" 2>/dev/null || true; }  # đích hiện tại của liên kết
bg_link_modules() { # bg_link_modules <app> <đích>
  ln -sfn "$2" "$1/.node_modules.new.$$"
  mv -T "$1/.node_modules.new.$$" "$1/node_modules" 2>/dev/null || mv -fh "$1/.node_modules.new.$$" "$1/node_modules"  # -h: macOS (kiểm thử)
}
# Giữ: bản đang dùng, bản trước (trả lại được), và bản các màu đang ghi nhận; xóa phần còn lại.
bg_prune_modules() { # bg_prune_modules <side> <đích giữ>...
  local mods d keep k
  mods=$(bg_mods_dir "$1"); shift
  for d in "$mods"/*/; do
    [ -d "$d" ] || continue
    keep=0
    for k in "$@"; do case "$k" in "${d%/}"/*|"${d%/}") keep=1 ;; esac; done
    [ "$keep" = 1 ] || { rm -rf "${d%/}"; bg_log "xóa node_modules cũ ${d%/}"; }
  done
}
