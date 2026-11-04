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
# Chỉ là bản sao cùng đĩa: đĩa hỏng thì mất cả bản sao lưu. Nơi lưu ngoài máy chủ do chủ dịch vụ chọn; đặt SYNCHRO_BACKUP_HOOK=<lệnh> trong /etc/synchro-ops.env
# (không đọc từ .env.production: tệp đó của web user, mà lệnh này chạy bằng root) để đẩy đi sau mỗi bản; lệnh nhận đường dẫn bản vừa tạo làm tham số đầu.
# - Sau mỗi bản: mở lại chính bản vừa lưu và kiểm tra (integrity_check, số bảng, có tài khoản, có secret.key, đủ tệp tải lên). Kết quả ghi ở $OPS_DIR/backup-status.json,
#   trang Cài đặt → Sức khỏe hệ thống đọc từ đó và báo khi sao lưu lỗi hoặc quá cũ.
# - Mã của thư viện (better-sqlite3 trong node_modules) thuộc web user nên phần đọc SQLite chạy bằng web user, không chạy bằng root.
set -euo pipefail
umask 077
[ -f /etc/synchro-ops.env ] && . /etc/synchro-ops.env
APP="${1:-/var/www/synchro}"; DEST="${2:-/var/backups/synchro}"
OPS_DIR="${OPS_DIR:-/var/lib/synchro-ops}"
STEP="chuẩn bị"
now_ms() { echo "$(date +%s)000"; }
file_ms() { local t; t=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0); echo "${t}000"; }
# Báo cáo cho trang sức khỏe: ghi ra tệp tạm rồi đổi tên, thư mục của root nên web user không tráo được tệp này.
report() { # report <nội dung JSON không có ngoặc nhọn>
  mkdir -p "$OPS_DIR" && chmod 755 "$OPS_DIR" || return 0
  printf '{"at":%s,%s}\n' "$(now_ms)" "$1" > "$OPS_DIR/backup-status.json.tmp" && chmod 644 "$OPS_DIR/backup-status.json.tmp" && mv "$OPS_DIR/backup-status.json.tmp" "$OPS_DIR/backup-status.json" || true
}
on_exit() {
  local code=$?
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
  if [ "$code" -ne 0 ]; then
    report "\"ok\":false,\"error\":\"$(printf '%s' "$STEP" | tr -d '"\\')\",\"lastOkAt\":$( [ -f "$DEST/LAST_OK" ] && file_ms "$DEST/LAST_OK" || echo 0)"
  fi
}
trap on_exit EXIT
KEEP_DAILY="${KEEP_DAILY:-7}"; KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
ENVF="$APP/.env.production"
get() { [ -f "$ENVF" ] && sed -n "s/^$1=//p" "$ENVF" | tail -1 | tr -d '"'"'"'' || true; }
DATA="$(get DATA_DIR)"; DATA="${DATA:-$APP/data}"
ENGINE="$(get SYNCHRO_ENGINE_HOME)"; ENGINE="${ENGINE:-$DATA/engine}"
NODE="$(command -v node || echo /usr/bin/node)"
STEP="không thấy cơ sở dữ liệu"
[ -f "$DATA/synchro.db" ] || { echo "Không thấy $DATA/synchro.db" >&2; exit 1; }
# Chạy bằng chủ của thư mục dữ liệu khi đang là root.
WEB_USER="$(stat -c %U "$DATA" 2>/dev/null || stat -f %Su "$DATA")"
as_web() {
  if [ "$(id -u)" = 0 ] && [ "$WEB_USER" != root ]; then
    if command -v runuser >/dev/null 2>&1; then runuser -u "$WEB_USER" -- "$@"; else su -s /bin/sh "$WEB_USER" -c "$(printf '%q ' "$@")"; fi
  else "$@"; fi
}

# Đĩa gần đầy thì không sao lưu: chính bản sao lưu có thể làm đầy nốt, kéo sập web.
FREE=$(df -Pm "$(dirname "$DEST")" | awk 'NR==2 {print $4}')
STEP="đĩa còn ${FREE:-0} MB trống, không đủ để sao lưu"
if [ "${FREE:-0}" -lt "${MIN_FREE_MB:-5000}" ]; then echo "$(date +%FT%T%z) Không sao lưu: chỉ còn ${FREE} MB trống." >&2; exit 2; fi

STAMP=$(date +%Y%m%d-%H%M%S)-$$
mkdir -p "$DEST/daily" "$DEST/weekly"
TMP="$DEST/.tmp-$STAMP"
mkdir -p "$TMP"
# Web user không vào được thư mục sao lưu (700): phần SQLite làm trong thư mục tạm của nó, cùng đĩa với dữ liệu.
WORK="$DATA/.backup-work-$STAMP"
mkdir -p "$WORK"
[ "$(id -u)" = 0 ] && chown "$WEB_USER" "$WORK"
PREV=$(ls -1d "$DEST"/daily/*/ 2>/dev/null | sort | tail -1 || true)
# Tệp không đổi so với bản trước dùng chung liên kết cứng.
LD() { if [ -n "$PREV" ]; then printf -- '--link-dest=%s%s' "$PREV" "$1"; fi; }

# 1. SQLite nhất quán, rồi kiểm tra tính toàn vẹn của bản sao trước khi tin nó.
STEP="không chụp được cơ sở dữ liệu"
(cd "$APP" && as_web env SRC="$DATA/synchro.db" OUT="$WORK/synchro.db" NODE_PATH="${NODE_PATH:-}" "$NODE" -e '
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
mv "$WORK/synchro.db" "$TMP/synchro.db"
[ "$(id -u)" = 0 ] && chown root "$TMP/synchro.db"

# 2. Tệp dữ liệu. Skill riêng của người dùng nằm trong data/skills/<mã người dùng>, kho dựng sẵn ở data/skills/_plugins: chỉ bỏ kho dựng sẵn.
STEP="không chép được tệp dữ liệu"
rsync -a --delete $(LD data) --exclude '/synchro.db*' --exclude '/.backup-work-*' --exclude '/skills/_plugins/' --exclude '/engine/.local/' --exclude '/engine/.npm/' --exclude '/engine/.cache/' --exclude '/engine/work/' "$DATA/" "$TMP/data/"
# Tệp tải lên.
if [ -d "$APP/.cache/files" ]; then rsync -a --delete $(LD uploads) "$APP/.cache/files/" "$TMP/uploads/"; fi
# Đăng nhập CLI của từng người dùng (nhà engine thường nằm ngoài data/): mất thì mọi người phải đăng nhập lại. Không chép bản cài CLI, thư mục làm việc.
if [ -d "$ENGINE/logins" ] && [ "$ENGINE" != "$DATA/engine" ]; then rsync -a --delete $(LD engine-logins) "$ENGINE/logins/" "$TMP/engine-logins/"; fi
# Tệp môi trường: chứa APP_URL, khóa OAuth, WS_AGENT_SECRET; không có thì khôi phục xong web không chạy.
[ -f "$ENVF" ] && cp -p "$ENVF" "$TMP/env.production"
[ -f /etc/synchro-ws.env ] && cp -p /etc/synchro-ws.env "$TMP/synchro-ws.env"
du -sm "$TMP" | cut -f1 > "$TMP/SIZE_MB"; echo "$STAMP" > "$TMP/CREATED"

# 3. Hoàn tất rồi mới vào danh sách; xoay vòng.
STEP="không hoàn tất được bản sao"
mv "$TMP" "$DEST/daily/$STAMP"
TMP=""
if [ "$(date +%u)" = "7" ]; then cp -al "$DEST/daily/$STAMP" "$DEST/weekly/$STAMP"; fi
prune() { { ls -1d "$1"/*/ 2>/dev/null || true; } | sort -r | tail -n "+$(($2 + 1))" | while read -r d; do rm -rf "$d"; done; }
prune "$DEST/daily" "$KEEP_DAILY"; prune "$DEST/weekly" "$KEEP_WEEKLY"
touch "$DEST/LAST_OK"
SNAP="$DEST/daily/$STAMP"
echo "$(date +%FT%T%z) Sao lưu xong: $SNAP ($(cat "$SNAP/SIZE_MB") MB)"

# 4. Kiểm tra lại chính bản vừa lưu như khi khôi phục: chép ra, mở, đếm. Kiểm tra ở đây, không tin vào bước 1: tệp có thể hỏng khi đổi tên, đầy đĩa giữa chừng.
STEP="không kiểm tra được bản sao mới nhất"
cp "$SNAP/synchro.db" "$WORK/verify.db"
[ "$(id -u)" = 0 ] && chown "$WEB_USER" "$WORK/verify.db"
VERIFY=$(cd "$APP" && as_web env F="$WORK/verify.db" NODE_PATH="${NODE_PATH:-}" "$NODE" -e '
  const D = require("better-sqlite3"), fs = require("fs");
  const out = { integrity: "lỗi", tables: 0, users: 0, ids: [] };
  try {
    const db = new D(process.env.F, { readonly: true, fileMustExist: true });
    out.integrity = db.pragma("integrity_check", { simple: true });
    out.tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = ?").get("table").n;
    out.users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    try { out.ids = db.prepare("SELECT DISTINCT file_id AS i FROM file_owners WHERE size > 0").all().map((r) => r.i); } catch {}
    db.close();
  } catch (e) { out.integrity = String(e.message || e).slice(0, 120); }
  fs.writeFileSync(process.env.F + ".ids", out.ids.join("\n"));
  console.log(JSON.stringify({ integrity: out.integrity, tables: out.tables, users: out.users }));')
UPLOADS=0; MISSING=0
if [ -f "$WORK/verify.db.ids" ]; then
  while IFS= read -r id || [ -n "$id" ]; do
    [ -n "$id" ] || continue
    UPLOADS=$((UPLOADS + 1))
    [ -f "$SNAP/uploads/$id.bin" ] || MISSING=$((MISSING + 1))
  done < "$WORK/verify.db.ids"
fi
HASKEY=false; [ -f "$SNAP/data/secret.key" ] && HASKEY=true
# Đẩy ra ngoài máy chủ (nếu có): lỗi ở đây không làm hỏng bản sao cục bộ, nhưng phải hiện trên trang sức khỏe.
OFFSITE=false; OFFSITE_OK=false
STEP="sao lưu xong, ghi báo cáo lỗi"
if [ -n "${SYNCHRO_BACKUP_HOOK:-}" ]; then
  OFFSITE=true
  if $SYNCHRO_BACKUP_HOOK "$SNAP"; then OFFSITE_OK=true; else echo "$(date +%FT%T%z) Lệnh đẩy bản sao ra ngoài lỗi" >&2; fi
fi
V=${VERIFY#\{}; V=${V%\}}
report "\"ok\":true,\"lastOkAt\":$(file_ms "$DEST/LAST_OK"),\"snapshot\":\"$STAMP\",\"sizeMB\":$(cat "$SNAP/SIZE_MB"),$V,\"hasKey\":$HASKEY,\"uploads\":$UPLOADS,\"missingUploads\":$MISSING,\"offsite\":$OFFSITE,\"offsiteOk\":$OFFSITE_OK"
