#!/usr/bin/env bash
# Sao lưu cục bộ, xoay vòng, dữ liệu của Synchro (chạy bằng root, cron hằng đêm). Hướng dẫn khôi phục: docs/van-hanh.md.
#   bash scripts/backup.sh [thư mục app] [thư mục sao lưu]
#   0 3 * * *  root  bash /var/www/synchro/scripts/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
# - SQLite chụp bằng lệnh backup của chính SQLite (better-sqlite3 của app): nhất quán kể cả khi web đang ghi, không chép tệp .db đang mở.
# - Tệp dữ liệu chép bằng rsync --link-dest: tệp không đổi dùng chung liên kết cứng với bản trước, nên 7 bản ngày + 4 bản tuần vẫn gọn.
# - Bỏ data/skills và bản cài của CLI: tải lại được (kho skill ~1 GB+, hàng trăm nghìn tệp). Trừ skill riêng của người dùng: xem dưới.
# - Dùng thư mục tạm rồi đổi tên: bản dở dang (mất điện, đầy đĩa) không bao giờ được coi là bản tốt.
# - data/secret.key nằm trong bản sao lưu: thiếu nó thì token đã mã hóa không đọc được, nhưng ai có bản sao lưu là có khóa. Khi đẩy ra ngoài máy chủ
#   phải mã hóa, và giữ khóa ở nơi khác (xem docs/van-hanh.md).
# Chỉ là bản sao cùng đĩa: đĩa hỏng thì mất cả bản sao lưu. Nơi lưu ngoài máy chủ do chủ dịch vụ chọn; đặt SYNCHRO_BACKUP_HOOK=<lệnh> để đẩy đi
# sau mỗi bản (lệnh nhận đường dẫn bản vừa tạo làm tham số đầu).
set -euo pipefail
umask 077
APP="${1:-/var/www/synchro}"; DEST="${2:-/var/backups/synchro}"
KEEP_DAILY="${KEEP_DAILY:-7}"; KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
ENVF="$APP/.env.production"
get() { [ -f "$ENVF" ] && sed -n "s/^$1=//p" "$ENVF" | tail -1 | tr -d '"'"'"'' || true; }
DATA="$(get DATA_DIR)"; DATA="${DATA:-$APP/data}"
ENGINE="$(get SYNCHRO_ENGINE_HOME)"; ENGINE="${ENGINE:-$DATA/engine}"
NODE="$(command -v node || echo /usr/bin/node)"
[ -f "$DATA/synchro.db" ] || { echo "Không thấy $DATA/synchro.db" >&2; exit 1; }

# Đĩa gần đầy thì không sao lưu: chính bản sao lưu có thể làm đầy nốt, kéo sập web.
FREE=$(df -Pm "$(dirname "$DEST")" | awk 'NR==2 {print $4}')
if [ "${FREE:-0}" -lt "${MIN_FREE_MB:-5000}" ]; then echo "$(date -Is) Không sao lưu: chỉ còn ${FREE} MB trống." >&2; exit 2; fi

STAMP=$(date +%Y%m%d-%H%M%S)-$$
mkdir -p "$DEST/daily" "$DEST/weekly"
TMP="$DEST/.tmp-$STAMP"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"
PREV=$(ls -1d "$DEST"/daily/*/ 2>/dev/null | sort | tail -1 || true)
# Tệp không đổi so với bản trước dùng chung liên kết cứng.
LD() { if [ -n "$PREV" ]; then printf -- '--link-dest=%s%s' "$PREV" "$1"; fi; }

# 1. SQLite nhất quán, rồi kiểm tra tính toàn vẹn của bản sao trước khi tin nó.
(cd "$APP" && SRC="$DATA/synchro.db" OUT="$TMP/synchro.db" "$NODE" -e '
  const D = require("better-sqlite3");
  const db = new D(process.env.SRC, { readonly: true, fileMustExist: true });
  db.backup(process.env.OUT).then(() => {
    db.close();
    // Bản sao giữ chế độ WAL của bản gốc: đổi về một tệp duy nhất để khôi phục chỉ cần chép một tệp.
    const c = new D(process.env.OUT);
    c.pragma("journal_mode = DELETE");
    const r = c.pragma("integrity_check", { simple: true });
    c.close();
    if (r !== "ok") { console.error("Bản sao SQLite hỏng:", r); process.exit(1); }
  }).catch((e) => { console.error(e); process.exit(1); });')

# 2. Tệp dữ liệu. Skill riêng của người dùng nằm trong data/skills/<mã người dùng>, kho dựng sẵn ở data/skills/_plugins: chỉ bỏ kho dựng sẵn.
rsync -a --delete $(LD data) --exclude '/synchro.db*' --exclude '/skills/_plugins/' --exclude '/engine/.local/' --exclude '/engine/.npm/' --exclude '/engine/.cache/' --exclude '/engine/work/' "$DATA/" "$TMP/data/"
# Tệp tải lên.
if [ -d "$APP/.cache/files" ]; then rsync -a --delete $(LD uploads) "$APP/.cache/files/" "$TMP/uploads/"; fi
# Đăng nhập CLI của từng người dùng (nhà engine thường nằm ngoài data/): mất thì mọi người phải đăng nhập lại. Không chép bản cài CLI, thư mục làm việc.
if [ -d "$ENGINE/logins" ] && [ "$ENGINE" != "$DATA/engine" ]; then rsync -a --delete $(LD engine-logins) "$ENGINE/logins/" "$TMP/engine-logins/"; fi
# Tệp môi trường: chứa APP_URL, khóa OAuth, WS_AGENT_SECRET; không có thì khôi phục xong web không chạy.
[ -f "$ENVF" ] && cp -p "$ENVF" "$TMP/env.production"
[ -f /etc/synchro-ws.env ] && cp -p /etc/synchro-ws.env "$TMP/synchro-ws.env"
du -sm "$TMP" | cut -f1 > "$TMP/SIZE_MB"; echo "$STAMP" > "$TMP/CREATED"

# 3. Hoàn tất rồi mới vào danh sách; xoay vòng.
mv "$TMP" "$DEST/daily/$STAMP"
trap - EXIT
if [ "$(date +%u)" = "7" ]; then cp -al "$DEST/daily/$STAMP" "$DEST/weekly/$STAMP"; fi
prune() { { ls -1d "$1"/*/ 2>/dev/null || true; } | sort -r | tail -n "+$(($2 + 1))" | while read -r d; do rm -rf "$d"; done; }
prune "$DEST/daily" "$KEEP_DAILY"; prune "$DEST/weekly" "$KEEP_WEEKLY"
touch "$DEST/LAST_OK"
echo "$(date -Is) Sao lưu xong: $DEST/daily/$STAMP ($(cat "$DEST/daily/$STAMP/SIZE_MB") MB)"
if [ -n "${SYNCHRO_BACKUP_HOOK:-}" ]; then $SYNCHRO_BACKUP_HOOK "$DEST/daily/$STAMP"; fi
