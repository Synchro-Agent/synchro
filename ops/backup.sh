#!/usr/bin/env bash
# Sao lưu cục bộ, xoay vòng, dữ liệu của Synchro (chạy bằng root, cron hằng đêm). Hướng dẫn khôi phục: docs/van-hanh.md.
#   bash ops/backup.sh [thư mục app] [thư mục sao lưu]
#   0 3 * * *  root  bash /var/www/synchro/ops/backup.sh /var/www/synchro /var/backups/synchro >> /var/log/synchro-backup.log 2>&1
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
# - Web user bị chiếm không được thành root qua script này: WEB_USER, DATA_DIR ưu tiên lấy từ /etc/synchro-ops.env (của root); DATA_DIR đọc từ .env.production (của web user)
#   chỉ dùng khi thư mục đó đúng là của web user và nằm ngoài nơi sao lưu; không bao giờ chạy Node bằng root; root không ghi hay đổi chủ gì trong thư mục của web user,
#   chỉ nhận tệp từ đó sau khi đã chuyển vào thư mục riêng của root và kiểm tra (không phải liên kết, đúng chủ).
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
  # Thư mục tạm trong dữ liệu là của web user: để chính web user xóa.
  if [ -n "${WORK:-}" ]; then as_web rm -rf "$WORK" 2>/dev/null || true; fi
  [ -n "${VDIR:-}" ] && rm -rf "$VDIR"
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
  if [ "$code" -ne 0 ]; then
    report "\"ok\":false,\"error\":\"$(printf '%s' "$STEP" | tr -d '"\\')\",\"lastOkAt\":$( [ -f "$DEST/LAST_OK" ] && file_ms "$DEST/LAST_OK" || echo 0)"
  fi
}
trap on_exit EXIT
KEEP_DAILY="${KEEP_DAILY:-7}"; KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
ENVF="$APP/.env.production"
# Tệp của web user: nếu là liên kết mềm thì không đọc (có thể trỏ tới tệp của root).
get() { [ -f "$ENVF" ] && [ ! -L "$ENVF" ] && sed -n "s/^$1=//p" "$ENVF" | tail -1 | tr -d '"'"'"'' || true; }
DATA="${DATA_DIR:-$(get DATA_DIR)}"; DATA="${DATA:-$APP/data}"
ENGINE="${SYNCHRO_ENGINE_HOME:-$(get SYNCHRO_ENGINE_HOME)}"; ENGINE="${ENGINE:-$DATA/engine}"
NODE="$(command -v node || echo /usr/bin/node)"
STEP="không thấy cơ sở dữ liệu"
[ -f "$DATA/synchro.db" ] || { echo "Không thấy $DATA/synchro.db" >&2; exit 1; }
# Không suy ra web user từ chủ thư mục dữ liệu: DATA_DIR có thể do web user đặt, trỏ vào thư mục của root thì Node chạy bằng root với node_modules web user ghi được.
if [ "$(id -u)" = 0 ]; then WEB_USER="${WEB_USER:-synchro}"; else WEB_USER="$(id -un)"; fi
STEP="thiết lập web user không an toàn"
[ "$(id -u)" != 0 ] || { [ "$WEB_USER" != root ] && [ "$(id -u "$WEB_USER" 2>/dev/null || echo 0)" != 0 ]; } || { echo "WEB_USER không được là root." >&2; exit 1; }
owner_of() { stat -L -c %U "$1" 2>/dev/null || stat -L -f %Su "$1"; }
links_of() { stat -c %h "$1" 2>/dev/null || stat -f %l "$1"; }
STEP="thư mục dữ liệu không thuộc web user"
[ "$(owner_of "$DATA")" = "$WEB_USER" ] || { echo "$DATA không thuộc $WEB_USER: không sao lưu." >&2; exit 1; }
STEP="thư mục dữ liệu nằm trong nơi sao lưu"
RDEST="$(mkdir -p "$DEST" && cd -P "$DEST" && pwd -P)"; RDATA="$(cd -P "$DATA" && pwd -P)"
case "$RDATA/" in "$RDEST"/*) echo "$DATA nằm trong $DEST: không sao lưu." >&2; exit 1 ;; esac
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
# Web user tự tạo: root mà mkdir rồi chown ở đây thì một liên kết mềm đặt sẵn sẽ đổi chủ thư mục khác.
WORK="$DATA/.backup-work-$STAMP"
as_web mkdir "$WORK"
PREV=$(ls -1d "$DEST"/daily/*/ 2>/dev/null | sort | tail -1 || true)
# Tệp không đổi so với bản trước dùng chung liên kết cứng.
LD() { if [ -n "$PREV" ]; then printf -- '--link-dest=%s%s' "$PREV" "$1"; fi; }
# rsync mã 24 = có tệp biến mất trong lúc chép (web đang chạy: tệp tạm, bộ đệm, khóa của Litestream, thư mục làm việc vừa dọn). Tệp đã mất thì
# không cần sao lưu, phần còn lại vẫn chép đủ, nên không hủy cả bản sao lưu vì nó (đêm 12/11 từng hỏng đúng như vậy). Mã lỗi khác vẫn dừng.
RS() { local rc=0; rsync "$@" || rc=$?; if [ "$rc" = 24 ]; then echo "rsync: vài tệp biến mất trong lúc chép, bỏ qua." >&2; return 0; fi; return "$rc"; }

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
# Tệp do web user tạo, đã vào thư mục chỉ root đọc được nên kiểm tra rồi không còn bị tráo. Liên kết tới tệp khác hoặc không đúng chủ thì không tin.
# Viết rõ if: chuỗi && đứng riêng không làm set -e dừng script khi một vế sai, nên kiểm tra sẽ vô tác dụng.
if ! { [ -f "$TMP/synchro.db" ] && [ ! -L "$TMP/synchro.db" ] && [ "$(links_of "$TMP/synchro.db")" = 1 ] && [ "$(owner_of "$TMP/synchro.db")" = "$WEB_USER" ]; }; then
  STEP="bản sao cơ sở dữ liệu không đáng tin (liên kết hoặc sai chủ)"
  echo "$TMP/synchro.db không phải tệp thật của $WEB_USER: không sao lưu." >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then chown -h root "$TMP/synchro.db"; fi

# 2. Tệp dữ liệu. Skill riêng của người dùng nằm trong data/skills/<mã người dùng>, kho dựng sẵn ở data/skills/_plugins: chỉ bỏ kho dựng sẵn.
STEP="không chép được tệp dữ liệu"
RS -a --delete $(LD data) --exclude '/synchro.db*' --exclude '/.backup-work-*' --exclude '/skills/_plugins/' --exclude '/engine/.local/' --exclude '/engine/.npm/' --exclude '/engine/.cache/' --exclude '/engine/work/' "$DATA/" "$TMP/data/"
# Tệp tải lên.
if [ -d "$APP/.cache/files" ]; then RS -a --delete $(LD uploads) "$APP/.cache/files/" "$TMP/uploads/"; fi
# Đăng nhập CLI của từng người dùng (nhà engine thường nằm ngoài data/): mất thì mọi người phải đăng nhập lại. Không chép bản cài CLI, thư mục làm việc.
if [ -d "$ENGINE/logins" ] && [ "$ENGINE" != "$DATA/engine" ]; then RS -a --delete $(LD engine-logins) "$ENGINE/logins/" "$TMP/engine-logins/"; fi
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
# Root không ghi vào thư mục của web user (liên kết đặt sẵn ở đó sẽ đưa tệp bất kỳ cho web user): đưa qua ống, web user tự ghi bản của nó; kết quả nhận về thư mục riêng của root.
VDIR="$DEST/.verify-$STAMP"; mkdir -p "$VDIR"
as_web sh -c 'cat > "$1"' sh "$WORK/verify.db" < "$SNAP/synchro.db"
# DATA_KEY của máy chủ (nếu đặt) được ưu tiên hơn secret.key, y như lúc chạy thật.
# rsync giữ nguyên liên kết mềm: chỉ đọc khóa khi là tệp thật, không root sẽ đọc hộ tệp mà liên kết trỏ tới rồi đưa cho web user.
KEYF="$SNAP/data/secret.key"; KEYV="$(get DATA_KEY)"
if [ -z "$KEYV" ] && [ -f "$KEYF" ] && [ ! -L "$KEYF" ]; then KEYV="$(tr -d '[:space:]' < "$KEYF" || true)"; fi
# Qua ống, không qua biến trên dòng lệnh: dòng lệnh ai trên máy cũng đọc được bằng ps.
VERIFY=$(printf '%s' "$KEYV" | (cd "$APP" && as_web env F="$WORK/verify.db" NODE_PATH="${NODE_PATH:-}" "$NODE" -e '
  const D = require("better-sqlite3"), fs = require("fs");
  const out = { integrity: "lỗi", tables: 0, users: 0, ids: [], keyOk: null };
  try {
    const db = new D(process.env.F, { readonly: true, fileMustExist: true });
    out.integrity = db.pragma("integrity_check", { simple: true });
    out.tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = ?").get("table").n;
    out.users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    try { out.ids = db.prepare("SELECT DISTINCT file_id AS i FROM file_owners WHERE size > 0").all().map((r) => r.i); } catch {}
    // Khóa trong bản sao có mở được dữ liệu trong bản sao không: khôi phục mà sai khóa thì mất hết token, đăng nhập đã lưu. Không có gì đã mã hóa thì không kết luận.
    try {
      const box = db.prepare("SELECT enc_auth AS b FROM connectors WHERE enc_auth IS NOT NULL LIMIT 1").get()?.b;
      const k = fs.readFileSync(0, "utf8");
      if (box && k) {
        const c = require("crypto"), [iv, tag, enc] = box.split(".").map((s) => Buffer.from(s, "base64"));
        const d = c.createDecipheriv("aes-256-gcm", c.createHash("sha256").update("synchro-api:" + k).digest(), iv);
        d.setAuthTag(tag);
        try { d.update(enc); d.final(); out.keyOk = true; } catch { out.keyOk = false; }
      }
    } catch {}
    db.close();
  } catch (e) { out.integrity = String(e.message || e).slice(0, 120); }
  fs.writeFileSync(process.env.F + ".ids", out.ids.join("\n"));
  console.log(JSON.stringify({ integrity: out.integrity, tables: out.tables, users: out.users, keyOk: out.keyOk }));'))
KEYV=""
UPLOADS=0; MISSING=0; CHECKED=0; CORRUPT=0
# Đọc bằng web user, ghi vào thư mục của root: liên kết đặt ở đây không làm root đọc được gì thêm.
as_web cat "$WORK/verify.db.ids" > "$VDIR/ids" 2>/dev/null || : > "$VDIR/ids"
if [ -s "$VDIR/ids" ]; then
  while IFS= read -r id || [ -n "$id" ]; do
    [ -n "$id" ] || continue
    UPLOADS=$((UPLOADS + 1))
    [ -f "$SNAP/uploads/$id.bin" ] || MISSING=$((MISSING + 1))
  done < "$VDIR/ids"
  # Tên tệp chính là mã băm nội dung: đọc thử một phần (mỗi đêm một nhóm khác nhau, ngẫu nhiên) xem tệp còn nguyên vẹn không. Mỗi lần tối đa CHECK_FILES tệp để không đọc lại cả ổ đĩa.
  sha() { if command -v sha1sum >/dev/null 2>&1; then sha1sum "$1" | cut -d' ' -f1; else shasum "$1" | cut -d' ' -f1; fi; }
  while IFS= read -r id; do
    f="$SNAP/uploads/$id.bin"
    [ -f "$f" ] || continue
    case "$id" in *[!a-f0-9]*) continue ;; esac
    [ "${#id}" = 40 ] || continue
    CHECKED=$((CHECKED + 1))
    [ "$(sha "$f")" = "$id" ] || CORRUPT=$((CORRUPT + 1))
  done <<EOF_IDS
$(awk 'BEGIN { srand() } { print rand() "\t" $0 }' "$VDIR/ids" | sort -n | cut -f2 | head -n "${CHECK_FILES:-200}")
EOF_IDS
fi
HASKEY=false; if [ -f "$KEYF" ] && [ ! -L "$KEYF" ]; then HASKEY=true; fi
# Đẩy ra ngoài máy chủ (nếu có): lỗi ở đây không làm hỏng bản sao cục bộ, nhưng phải hiện trên trang sức khỏe.
OFFSITE=false; OFFSITE_OK=false
STEP="sao lưu xong, ghi báo cáo lỗi"
if [ -n "${SYNCHRO_BACKUP_HOOK:-}" ]; then
  OFFSITE=true
  # Lệnh đẩy (vd. ops/backup-offsite.sh) cần biết thư mục dữ liệu và web user mà script này đã kiểm.
  if SYNCHRO_DATA="$DATA" WEB_USER="$WEB_USER" APP="$APP" $SYNCHRO_BACKUP_HOOK "$SNAP"; then OFFSITE_OK=true; else echo "$(date +%FT%T%z) Lệnh đẩy bản sao ra ngoài lỗi" >&2; fi
fi
V=${VERIFY#\{}; V=${V%\}}
report "\"ok\":true,\"lastOkAt\":$(file_ms "$DEST/LAST_OK"),\"snapshot\":\"$STAMP\",\"sizeMB\":$(cat "$SNAP/SIZE_MB"),$V,\"hasKey\":$HASKEY,\"uploads\":$UPLOADS,\"missingUploads\":$MISSING,\"checked\":$CHECKED,\"corrupt\":$CORRUPT,\"offsite\":$OFFSITE,\"offsiteOk\":$OFFSITE_OK"
