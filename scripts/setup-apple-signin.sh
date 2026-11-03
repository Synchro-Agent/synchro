#!/usr/bin/env bash
# Cài khóa "Đăng nhập bằng Apple" cho Synchro (web và ứng dụng iOS Capacitor) lên máy chủ: bash scripts/setup-apple-signin.sh
# Hỏi từng giá trị, đọc khóa .p8 từ tệp trên máy này rồi ghi vào /var/www/synchro/.env.production qua ssh (khóa đi qua stdin,
# không hiện trên màn hình, không nằm trong lịch sử lệnh). Sao lưu .env.production trước khi sửa; chạy lại thì thay các dòng APPLE_ cũ.
set -euo pipefail
HOST="${SYNCHRO_HOST:-synchro-vps}"
ENVF="/var/www/synchro/.env.production"

ask() { local v; read -r -p "$1 [$2]: " v; echo "${v:-$2}"; }
id10() { [[ "$1" =~ ^[A-Z0-9]{10}$ ]] || { echo "  ✗ $2 phải gồm đúng 10 ký tự chữ in hoa / số (vd. AB12CD34EF)." >&2; exit 1; }; }

echo "━━ Đăng nhập bằng Apple cho Synchro"
echo "Nhấn Enter để giữ giá trị trong ngoặc vuông."
echo
SERVICE_ID=$(ask "1. Services ID (bước 2, dùng cho web)" "nz.net.synchro.web")
BUNDLE_ID=$(ask "2. App ID / Bundle ID (bước 1, dùng cho ứng dụng iOS)" "nz.net.synchro.app")
read -r -p "3. Team ID (bước 4, 10 ký tự): " TEAM_ID; TEAM_ID=$(echo "$TEAM_ID" | tr -d ' ' | tr '[:lower:]' '[:upper:]'); id10 "$TEAM_ID" "Team ID"
read -r -p "4. Key ID (bước 3, 10 ký tự): " KEY_ID; KEY_ID=$(echo "$KEY_ID" | tr -d ' ' | tr '[:lower:]' '[:upper:]'); id10 "$KEY_ID" "Key ID"
P8=$(ask "5. Đường dẫn tệp khóa .p8" "$HOME/Downloads/AuthKey_${KEY_ID}.p8")
P8="${P8/#\~/$HOME}"
[ -f "$P8" ] || { echo "  ✗ Không thấy tệp $P8" >&2; exit 1; }
grep -q "BEGIN PRIVATE KEY" "$P8" || { echo "  ✗ $P8 không phải khóa .p8 của Apple (thiếu BEGIN PRIVATE KEY)." >&2; exit 1; }
KEY=$(awk 'NF{gsub(/\r/,""); printf "%s\\n",$0}' "$P8")

echo
echo "Sẽ ghi lên $HOST:$ENVF"
echo "  APPLE_CLIENT_ID=$SERVICE_ID"
echo "  APPLE_BUNDLE_ID=$BUNDLE_ID"
echo "  APPLE_TEAM_ID=$TEAM_ID"
echo "  APPLE_KEY_ID=$KEY_ID"
echo "  APPLE_PRIVATE_KEY=(nội dung $(basename "$P8"), không hiện)"
read -r -p "Ghi? (y/N): " OK
[[ "$OK" =~ ^[yY]$ ]] || { echo "Đã hủy, chưa ghi gì."; exit 0; }

ssh "$HOST" "f=$ENVF; cp \"\$f\" \"\$f.bak-\$(date +%Y%m%d%H%M%S)\"; grep -v '^APPLE_' \"\$f\" > \"\$f.tmp\" || true; cat >> \"\$f.tmp\"; cat \"\$f.tmp\" > \"\$f\"; rm -f \"\$f.tmp\"" <<EOF
APPLE_CLIENT_ID=$SERVICE_ID
APPLE_BUNDLE_ID=$BUNDLE_ID
APPLE_TEAM_ID=$TEAM_ID
APPLE_KEY_ID=$KEY_ID
APPLE_PRIVATE_KEY="$KEY"
EOF
echo
echo "✓ Đã ghi (bản cũ được sao lưu cạnh tệp). Quay lại chat và nhắn \"xong\" để Synchro khởi động lại và kiểm tra."
