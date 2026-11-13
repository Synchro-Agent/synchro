#!/usr/bin/env bash
# Đẩy bản chụp tệp của người dùng ra ngoài máy chủ (Blueprint A6.2): tệp tải lên, tệp đã tạo, skill riêng, âm thanh của Speech.
# backup.sh gọi lệnh này sau mỗi bản sao lưu đêm, khi /etc/synchro-ops.env có:
#   SYNCHRO_BACKUP_HOOK="/var/www/synchro/scripts/backup-offsite.sh"
#   SYNCHRO_AGE_RECIPIENT="age1…"        # khóa CÔNG KHAI của age; khóa riêng chủ dịch vụ cất ngoài máy chủ
# Tham số đầu: thư mục bản chụp vừa tạo ($DEST/daily/<STAMP>), chỉ root đọc được.
# - Mã hóa bằng age trước khi rời máy: ai có bucket mà không có khóa riêng thì không đọc được gì.
# - Cơ sở dữ liệu không nằm trong gói này: Litestream đã đẩy liên tục lên R2. secret.key cũng không: chủ dịch vụ giữ bản riêng.
# - Đẩy lên cùng bucket R2 của sao lưu liên tục, thư mục "<thư mục>-files/", bằng rclone. Khóa R2 lấy từ cài đặt của Synchro
#   (scripts/r2-creds.mjs, chạy bằng web user), chỉ đi qua biến môi trường của rclone, không nằm trong tệp nào trên đĩa.
# - Giữ 14 bản gần nhất trên R2 (KEEP_OFFSITE).
# Khôi phục: rclone copy r2:<bucket>/<thư mục>-files/files-<STAMP>.tar.gz.age . && age -d -i khoa-rieng.txt files-….tar.gz.age | tar -xz
set -euo pipefail
umask 077
SNAP="${1:?thiếu thư mục bản chụp}"
[ -f /etc/synchro-ops.env ] && . /etc/synchro-ops.env
APP="${APP:-/var/www/synchro}"; WEB_USER="${WEB_USER:-synchro}"
DATA="${SYNCHRO_DATA:-$APP/data}"
KEEP="${KEEP_OFFSITE:-14}"
RECIP="${SYNCHRO_AGE_RECIPIENT:-}"
[ -d "$SNAP" ] && [ ! -L "$SNAP" ] || { echo "Không thấy bản chụp $SNAP" >&2; exit 1; }
[[ "$RECIP" =~ ^age1[0-9a-z]{58}$ ]] || { echo "Chưa đặt SYNCHRO_AGE_RECIPIENT (khóa công khai age1…) trong /etc/synchro-ops.env" >&2; exit 1; }
command -v age >/dev/null && command -v rclone >/dev/null || { echo "Thiếu age hoặc rclone (apt install age rclone)" >&2; exit 1; }
[ "$WEB_USER" != root ] && [ "$(id -u "$WEB_USER")" != 0 ] || { echo "WEB_USER không được là root." >&2; exit 1; }

# Khóa R2: web user đọc từ cơ sở dữ liệu, đưa qua ống. Kiểm lại định dạng ở đây: không tin chuỗi từ web user.
CREDS="$(cd "$APP" && runuser -u "$WEB_USER" -- node scripts/r2-creds.mjs "$DATA")" || { echo "Chưa bật sao lưu liên tục lên R2 (Cài đặt → Sức khỏe hệ thống): không có nơi để đẩy." >&2; exit 1; }
{ read -r ACC; read -r BUCKET; read -r KID; read -r SECRET; read -r PREFIX; } <<< "$CREDS"
unset CREDS
[[ "$ACC" =~ ^[0-9a-f]{32}$ && "$BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ && "$KID" =~ ^[A-Za-z0-9]{16,128}$ && "$SECRET" =~ ^[A-Za-z0-9/+=_-]{16,256}$ && "$PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ && "$PREFIX" != *..* ]] || { echo "Cấu hình R2 không đúng định dạng." >&2; exit 1; }

# rclone đọc cấu hình "r2:" từ biến môi trường (không có tệp cấu hình nào chứa khóa).
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ENDPOINT="https://$ACC.r2.cloudflarestorage.com" RCLONE_CONFIG_R2_ACCESS_KEY_ID="$KID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$SECRET"
# no_head: rclone 1.60 (Ubuntu) HEAD lại tệp vừa tải lên kèm ?versionId=, R2 trả 501 NotImplemented. Kích thước được kiểm lại ở dưới.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true RCLONE_CONFIG_R2_NO_HEAD=true RCLONE_CONFIG=/dev/null
unset SECRET
REMOTE="r2:$BUCKET/${PREFIX%/}-files"

STAMP="$(basename "$SNAP")"
OUT="$(mktemp -d /var/tmp/synchro-offsite.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT
F="$OUT/files-$STAMP.tar.gz.age"
# Chỉ những gì người dùng tạo ra mà không tải lại được. Không theo liên kết mềm (tar mặc định giữ nguyên liên kết, không đọc tệp đích).
PARTS=()
for p in uploads data/outputs data/skills data/speech; do [ -e "$SNAP/$p" ] && PARTS+=("$p"); done
[ "${#PARTS[@]}" -gt 0 ] || { echo "Bản chụp không có tệp người dùng nào." >&2; exit 1; }
tar -C "$SNAP" --exclude='data/skills/_plugins' -czf - "${PARTS[@]}" | age -r "$RECIP" -o "$F"
SIZE=$(du -m "$F" | cut -f1)
rclone copyto --s3-no-check-bucket --retries 3 --low-level-retries 5 "$F" "$REMOTE/$(basename "$F")"
# Đọc lại kích thước trên R2: tệp lên thiếu thì coi như lỗi.
REMOTE_SIZE=$(rclone size --json "$REMOTE/$(basename "$F")" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
[ "$REMOTE_SIZE" = "$(stat -c %s "$F")" ] || { echo "Tệp trên R2 không khớp kích thước ($REMOTE_SIZE)." >&2; exit 1; }
# Giữ KEEP bản mới nhất (tên có ngày giờ nên sắp theo tên là theo thời gian).
rclone lsf --files-only "$REMOTE/" | grep -E '^files-[0-9]{8}-[0-9]{6}-[0-9]+\.tar\.gz\.age$' | sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do rclone deletefile "$REMOTE/$old"; done
echo "$(date +%FT%T%z) Đã đẩy bản chụp tệp (mã hóa age, ${SIZE} MB) lên $REMOTE"
