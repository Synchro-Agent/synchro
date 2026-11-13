#!/usr/bin/env bash
# Dựng bản production trên máy chủ rồi thay bản đang chạy (chạy bằng root): bash scripts/server-build.sh [thư mục app] [tên pm2] [pip] [cổng]
#   bash /var/www/synchro/scripts/server-build.sh /var/www/synchro synchro pip
# Hai cách thay bản:
# - Xanh/lam (production sau khi chạy scripts/bluegreen-migrate.sh; BLUEGREEN=1 bắt buộc, BLUEGREEN=0 tắt): bản mới chạy ở màu đang nghỉ
#   (blue 3000 / green 3002) bên cạnh bản cũ, đạt kiểm tra sức khỏe mới chuyển nginx, rồi bản cũ nhận SIGTERM, chạy nốt lượt đang dở
#   (tối đa 25 giây) và thoát. Không có lúc nào nginx trỏ vào cổng chưa sẵn sàng: không rớt lượt, không 502. Xem docs/van-hanh.md.
# - Một tiến trình (staging, production chưa chuyển): tráo .next rồi pm2 restart như trước.
# Chung cho cả hai:
# - Dựng ở thư mục riêng không có data/ (dữ liệu lúc chạy: ~3.000 thư viện skill, hàng trăm nghìn tệp): build ngay trong thư mục app thì
#   Next.js dò cả data/ và hết bộ nhớ.
# - Thư viện (node_modules) chỉ cài lại khi package-lock.json đổi, và cài vào thư mục riêng: không bao giờ xóa node_modules mà web đang dùng.
# - Lỗi ở bất kỳ bước nào trước khi chuyển thì web vẫn chạy bản cũ. Bản mới không đạt /api/health (đúng mã bản, ghi được cơ sở dữ liệu):
#   một tiến trình thì trả bản trước về và khởi động lại; xanh/lam thì chỉ dừng bản mới, nginx chưa từng trỏ sang nó.
# - Tab đang mở từ bản cũ vẫn tải được chunk cũ: static của các bản trong ~1 ngày qua (ít nhất bản liền trước) được chép vào bản mới
#   (.synchro-statics-<tên>; Next đọc danh sách static lúc khởi động nên chép trước khi khởi động).
# - SYNCHRO_INCOMING=<thư mục>: mã mới nằm ở đó (deploy từ CI rsync vào /var/www/synchro-incoming), chưa đụng vào thư mục app; public, db,
#   catalog, scripts, workspace… chỉ được chép sang ngay trước khi bật bản mới. Có .synchro-artifact/ khớp băm package-lock và mã commit
#   (CI đã build sẵn .next) thì bỏ bước build.
set -euo pipefail
APP="${1:-/var/www/synchro}"; PM2="${2:-synchro}"; PIP="${3:-}"; PORT="${4:-}"
SIDE="$(dirname "$APP")"; NAME="$(basename "$APP")"
PREV="$SIDE/.synchro-prev-$NAME"; STATICS="$SIDE/.synchro-statics-$NAME"; GOOD="$SIDE/.synchro-good-$NAME"
SRC="${SYNCHRO_INCOMING:-$APP}"
. "$(dirname "${BASH_SOURCE[0]}")/bluegreen-lib.sh"
BG=0; bg_enabled "$APP" && BG=1
# Một lần deploy mỗi lúc; watchdog (scripts/watchdog.sh) thấy khóa này thì không khởi động lại web giữa chừng. Lần sau chờ lần trước xong, không cắt ngang lúc đang tráo bản.
if command -v flock >/dev/null 2>&1; then
  exec 9>/run/synchro-deploy.lock
  flock -w 900 9 || { echo "Đang có lần deploy khác chạy quá lâu." >&2; exit 1; }
fi
# Màu đang sống đọc sau khi đã giữ khóa: lần deploy trước (vừa xong) có thể vừa đổi màu.
if [ "$BG" = 1 ]; then
  LIVE=$(bg_live_color)
  case "$LIVE" in blue|green) ;; *) echo "Tệp màu sống $BG_LIVE_FILE không hợp lệ ('$LIVE'): chạy scripts/bluegreen-migrate.sh trước." >&2; exit 1 ;; esac
  NEW=$(bg_other "$LIVE"); OLDPORT=$(bg_port_of "$LIVE"); NEWPORT=$(bg_port_of "$NEW")
  OLDDIST="$APP/.next-$LIVE"; NEWDIST="$APP/.next-$NEW"
fi
B=$(mktemp -d "$SIDE/.build-$NAME.XXXXXX")
trap 'rm -rf "$B"' EXIT
# Mã do root chạy (scripts/, workspace/: sao lưu, cài đặt, deploy) chỉ root ghi được, kể cả thư mục app (ai sở hữu thư mục cha đổi tên được thư mục con).
# Nhờ vậy chiếm được web user (lỗi trong bộ đọc tệp chẳng hạn) không leo được lên root qua cron hay lần deploy sau. Web user vẫn ghi được data/, .cache/, .next*/, node_modules/.
harden() {
  chown -R synchro:synchro "$APP"
  mkdir -p "$APP/.cache" "$APP/data"
  chown synchro:synchro "$APP/.cache" "$APP/data"
  chown root:root "$APP"; chmod 755 "$APP"
  chown -R root:root "$APP/scripts" "$APP/workspace"; chmod -R go-w "$APP/scripts" "$APP/workspace"
  if [ -d "$APP/workspace/data" ]; then chown -R synchro:synchro "$APP/workspace/data"; fi
}
# Thư mục chỉ có lúc chạy, không bao giờ chép đè hay xóa khi đồng bộ mã.
EXCL=(--exclude /data --exclude /.next --exclude '/.next-*' --exclude /node_modules --exclude /.git --exclude /workspace/data --exclude /.mkvenv --exclude /.cache --exclude '/.env*' --exclude /.synchro-artifact --exclude '/.node_modules.new.*')
sync_code() { # mã mới từ $SRC sang thư mục app (chỉ khi deploy từ thư mục incoming)
  [ "$SRC" = "$APP" ] && return 0
  rsync -a --delete "${EXCL[@]}" "$SRC/" "$APP/"
  harden
}
harden
# Một tiến trình: thư mục app phải có mã mới trước khi build (như trước đây).
[ "$BG" = 1 ] || { sync_code; SRC="$APP"; }
[ -n "$PIP" ] && su - synchro -c "cd $APP && .mkvenv/bin/pip install -q -r $SRC/requirements.txt"
rsync -a "${EXCL[@]}" "$SRC/" "$B/"
LOCK=$(sha1sum "$SRC/package-lock.json" | cut -d' ' -f1)
NEWMOD=""
if [ "$BG" = 1 ]; then
  # Xanh/lam: node_modules theo băm, $APP/node_modules là liên kết; bản đang chạy không bao giờ mất thư viện của nó.
  bg_adopt_modules "$APP" "$SIDE"
  MODS="$(bg_mods_dir "$SIDE")/$LOCK/node_modules"
  if [ "$(cat "$MODS/.synchro-lock" 2>/dev/null)" != "$LOCK" ]; then
    chown -R synchro:synchro "$B"
    su - synchro -c "cd $B && npm ci"
    echo "$LOCK" > "$B/node_modules/.synchro-lock"
    rm -rf "$MODS"; mkdir -p "$(dirname "$MODS")"; mv "$B/node_modules" "$MODS"
    chown -R synchro:synchro "$MODS"
  fi
  ln -s "$MODS" "$B/node_modules"
elif [ -d "$APP/node_modules" ] && [ "$(cat "$APP/node_modules/.synchro-lock" 2>/dev/null)" = "$LOCK" ]; then
  ln -s "$APP/node_modules" "$B/node_modules"
else
  chown -R synchro:synchro "$B"
  su - synchro -c "cd $B && npm ci"
  echo "$LOCK" > "$B/node_modules/.synchro-lock"
  NEWMOD=1
fi
chown -R synchro:synchro "$B"

# Bản build sẵn của CI (.github/workflows/deploy.yml): chỉ dùng khi đúng commit, đúng package-lock, cùng biến NEXT_PUBLIC_ (được nhúng vào
# mã trình duyệt lúc build) và tệp nén còn nguyên. Không có hoặc không khớp: build như thường.
from_artifact() {
  local a="$SRC/.synchro-artifact" m pub
  [ "${SYNCHRO_USE_ARTIFACT:-1}" = 1 ] && [ -f "$a/meta" ] && [ -f "$a/next.tgz" ] && [ -f "$SRC/.synchro-source-sha" ] || return 1
  m="$a/meta"
  pub=$( (grep -E '^NEXT_PUBLIC_[A-Z0-9_]*=' "$APP/.env.production" 2>/dev/null || true) | LC_ALL=C sort | sha1sum | cut -d' ' -f1)
  [ "$(sed -n 's/^lock=//p' "$m")" = "$LOCK" ] || { echo "Bản build của CI khác package-lock: build lại." >&2; return 1; }
  [ "$(sed -n 's/^sha=//p' "$m")" = "$(cat "$SRC/.synchro-source-sha")" ] || { echo "Bản build của CI khác commit: build lại." >&2; return 1; }
  [ "$(sed -n 's/^pub=//p' "$m")" = "$pub" ] || { echo "Bản build của CI khác biến NEXT_PUBLIC_ của máy chủ: build lại." >&2; return 1; }
  [ "$(sed -n 's/^tgz=//p' "$m")" = "$(sha256sum "$a/next.tgz" | cut -d' ' -f1)" ] || { echo "Tệp build của CI hỏng: build lại." >&2; return 1; }
  local dist; dist=$(sed -n 's/^dist=//p' "$m")
  case "$dist" in .next|.next-[a-z]*) ;; *) return 1 ;; esac
  mkdir -p "$B/.ci" && tar -xzf "$a/next.tgz" -C "$B/.ci" && [ -f "$B/.ci/$dist/BUILD_ID" ] || return 1
  rm -rf "$B/.next"; mv "$B/.ci/$dist" "$B/.next"; rm -rf "$B/.ci"
  chown -R synchro:synchro "$B/.next"
  echo "Dùng bản build của CI ($(cat "$B/.next/BUILD_ID")), bỏ bước build."
}
if ! from_artifact; then
  su - synchro -c "cd $B && NODE_OPTIONS=--max-old-space-size=3072 npx next build"
fi
rm -rf "$B/.next/cache" "$B/.next/server/route-cache"
NEWID=$(cat "$B/.next/BUILD_ID")

# Thư mục build đang chạy (xanh/lam: của màu đang sống, đặt ở trên) để lấy static của bản cũ.
[ "$BG" = 1 ] || OLDDIST="$APP/.next"

# Chunk của các bản trước cho tab đang mở. Lưu static "thuần" của từng bản (trước khi trộn), nếu không chunk cũ được mang theo mãi.
mkdir -p "$STATICS"
OLDID=$(cat "$OLDDIST/BUILD_ID" 2>/dev/null || true)
if [ -n "$OLDID" ] && [ ! -d "$STATICS/$OLDID" ] && [ -d "$OLDDIST/static" ]; then cp -a "$OLDDIST/static" "$STATICS/$OLDID"; fi
# Tính "một ngày" từ lúc bản đó bị thay, không phải lúc được dựng: bản chạy cả tuần vừa bị thay thì tab đang mở vẫn cần chunk của nó.
[ -n "$OLDID" ] && [ -d "$STATICS/$OLDID" ] && touch "$STATICS/$OLDID"
rm -rf "$STATICS/$NEWID"
cp -a "$B/.next/static" "$STATICS/$NEWID"
find "$STATICS" -mindepth 1 -maxdepth 1 -type d -mmin +1440 ! -name "$OLDID" ! -name "$NEWID" -exec rm -rf {} +
for d in "$STATICS"/*/; do
  [ "$(basename "$d")" = "$NEWID" ] || rsync -a --ignore-existing "$d" "$B/.next/static/"
done

# public/ và db/ của lần deploy đạt gần nhất: bản cũ vẫn phục vụ thì phải có lại tệp tĩnh và dữ liệu mẫu của nó.
restore_good() { for d in public db; do if [ -d "$GOOD/$d" ] && [ -d "$APP/$d" ]; then rsync -a --delete "$GOOD/$d/" "$APP/$d/" || true; fi; done; }
deployed() {
  rm -rf "$SIDE/.synchro-failed-$NAME"
  # Lỗi ở đây không được làm hỏng lần deploy đã đạt.
  for d in public db; do if [ -d "$APP/$d" ]; then mkdir -p "$GOOD/$d" && rsync -a --delete "$APP/$d/" "$GOOD/$d/" || true; fi; done
  # Lần deploy đạt gần nhất (CI gộp các lần deploy cách nhau dưới 15 phút, .github/workflows/deploy.yml).
  mkdir -p "$BG_STATE_DIR" && date +%s > "$BG_STATE_DIR/last-deploy-$NAME" && chmod 644 "$BG_STATE_DIR/last-deploy-$NAME" || true
}

if [ "$BG" = 1 ]; then
  # ---------------- Xanh/lam ----------------
  NEWPM2=$(bg_pm2_name "$NEW"); OLDPM2=$(bg_pm2_name "$LIVE")
  echo "Bản đang chạy: $LIVE (cổng $OLDPORT, $OLDID). Bản mới: $NEW (cổng $NEWPORT, $NEWID)."
  [ "$(bg_upstream_port)" = "$OLDPORT" ] || echo "CẢNH BÁO: nginx đang trỏ cổng $(bg_upstream_port), tệp màu ghi $LIVE ($OLDPORT)." >&2
  # Màu nghỉ có thể còn chạy (lần trước dừng dở): dừng trước khi thay thư mục build của nó. Không phải màu đang sống nên không ảnh hưởng ai.
  bg_stop "$NEW"
  rm -rf "$NEWDIST.old"; [ -d "$NEWDIST" ] && mv "$NEWDIST" "$NEWDIST.old"
  mv "$B/.next" "$NEWDIST"; rm -rf "$NEWDIST.old"
  chown -R synchro:synchro "$NEWDIST"
  # Thư viện: đổi liên kết nếu package-lock đổi. Bản cũ đã nạp gói của nó; thư mục cũ được giữ tới lần deploy sau để trả lại.
  PREVMODS=$(bg_mods_current "$APP")
  [ "$PREVMODS" = "$MODS" ] || bg_link_modules "$APP" "$MODS"
  # public, db, catalog, scripts, workspace… cùng lúc với bản build mới (deploy từ thư mục incoming).
  sync_code
  fail() { # fail <lý do>: dừng bản mới, nginx vẫn ở bản cũ; trả thư viện, public/db về như trước.
    echo "BẢN MỚI KHÔNG ĐẠT ($1): giữ nguyên bản $LIVE ($OLDID), web không bị gián đoạn." >&2
    bg_pm2 logs "$NEWPM2" --nostream --lines 40 >&2 || true
    bg_stop "$NEW"
    [ -n "$PREVMODS" ] && [ "$PREVMODS" != "$MODS" ] && bg_link_modules "$APP" "$PREVMODS"
    restore_good
    rm -rf "$SIDE/.synchro-failed-$NAME"; mkdir -p "$SIDE/.synchro-failed-$NAME"; cp -a "$NEWDIST/BUILD_ID" "$SIDE/.synchro-failed-$NAME/" 2>/dev/null || true
    echo "Bản lỗi vẫn ở $NEWDIST (màu nghỉ) để xem; lần deploy sau sẽ ghi đè." >&2
    exit 1
  }
  bg_start "$APP" "$NEW" || fail "pm2 không bật được $NEWPM2"
  bg_healthy "$NEWPORT" "$NEWID" || fail "kiểm tra sức khỏe ở cổng $NEWPORT"
  bg_switch_upstream "$NEWPORT" || fail "nginx -t / reload"
  if ! bg_via_nginx "$NEWID"; then
    bg_switch_upstream "$OLDPORT" || echo "CẢNH BÁO: không trả được nginx về cổng $OLDPORT, cần xem tay ngay." >&2
    fail "qua nginx (https://$BG_HOST) chưa thấy bản mới"
  fi
  # Từ đây người dùng đã ở bản mới. Ghi màu sống trước khi dừng bản cũ: bản mới nhận vai primary ngay khi bản cũ thoát (app/role.ts).
  bg_write_live "$NEW" "$NEWPORT" "$APP"
  echo "Dừng bản cũ $OLDPM2 (chạy nốt lượt đang dở, tối đa 25 giây)…"
  bg_stop "$LIVE"
  bg_pm2 save >/dev/null 2>&1 || true
  # Giữ: thư viện bản mới, và của bản vừa dừng (trả lại bằng tay được, docs/van-hanh.md).
  bg_prune_modules "$SIDE" "$MODS" "${PREVMODS:-$MODS}"
  deployed
  echo "build ok: $NEWID ($NEW, cổng $NEWPORT; bản trước $OLDID giữ ở $OLDDIST)"
  exit 0
fi

# ---------------- Một tiến trình ----------------
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
healthy() { [ -n "$PORT" ] || return 0; bg_healthy "$PORT" "$1"; }
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
  # rsync của deploy đã đè public/ và db/ trước khi build: trả về bản của lần deploy tốt gần nhất, không thì bản cũ chạy với tệp tĩnh và dữ liệu mẫu của bản lỗi.
  restore_good
  restart || true
  if up; then echo "Đã trả lại bản $OLDID, web đang chạy bình thường. Bản lỗi giữ ở $SIDE/.synchro-failed-$NAME để xem." >&2
  else echo "ĐÃ TRẢ LẠI BẢN $OLDID NHƯNG VẪN KHÔNG ĐẠT: cần xử lý tay ngay (xem docs/van-hanh.md)." >&2; fi
  exit 1
fi
deployed
echo "build ok: $NEWID (bản trước giữ ở $PREV)"
