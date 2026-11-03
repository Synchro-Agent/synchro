#!/usr/bin/env bash
# Dựng bản production trên máy chủ rồi thay bản đang chạy (chạy bằng root): bash scripts/server-build.sh [thư mục app] [tên pm2] [pip]
#   bash /var/www/synchro/scripts/server-build.sh /var/www/synchro synchro pip
# Không làm gián đoạn web:
# - Dựng ở thư mục riêng không có data/ (dữ liệu lúc chạy: ~3.000 thư viện skill, hàng trăm nghìn tệp): build ngay trong thư mục app thì
#   Next.js dò cả data/ và hết bộ nhớ.
# - Thư viện (node_modules) chỉ cài lại khi package-lock.json đổi, và cài vào thư mục riêng: trước đây `npm ci` xóa node_modules mà web
#   đang dùng, web trả 502 trong lúc cài.
# - Bản build và thư viện mới chỉ thay bản cũ khi đã xong hết (đổi tên thư mục trên cùng ổ đĩa, rồi khởi động lại); lỗi ở bất kỳ bước nào
#   thì web vẫn chạy bản cũ.
set -euo pipefail
APP="${1:-/var/www/synchro}"; PM2="${2:-synchro}"; PIP="${3:-}"
B=$(mktemp -d "$(dirname "$APP")/.build-$(basename "$APP").XXXXXX")
trap 'rm -rf "$B"' EXIT
chown -R synchro:synchro "$APP"
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
rm -rf "$B/.next/cache" "$B/.next/server/route-cache" "$APP/.next-old" "$APP/node_modules-old"
# Tráo: cùng ổ đĩa nên đổi tên gần như tức thì.
[ -d "$APP/.next" ] && mv "$APP/.next" "$APP/.next-old"
mv "$B/.next" "$APP/.next"
if [ -n "$NEWMOD" ]; then [ -d "$APP/node_modules" ] && mv "$APP/node_modules" "$APP/node_modules-old"; mv "$B/node_modules" "$APP/node_modules"; fi
chown -R synchro:synchro "$APP/.next" "$APP/node_modules"
su - synchro -c "pm2 restart $PM2 --update-env" || su - synchro -c "cd $APP && pm2 start npm --name $PM2 -- start -- -p 3001 && pm2 save"
rm -rf "$APP/.next-old" "$APP/node_modules-old"
echo "build ok: $(cat "$APP/.next/BUILD_ID")"
