#!/usr/bin/env bash
# Dựng bản production trên máy chủ rồi thay bản đang chạy (chạy bằng root): bash scripts/server-build.sh [thư mục app] [tên pm2] [pip]
#   bash /var/www/synchro/scripts/server-build.sh /var/www/synchro synchro pip
# Dựng ở một thư mục tạm không có data/ (dữ liệu lúc chạy: ~3.000 thư viện skill, hàng trăm nghìn tệp): build ngay trong thư mục app thì
# Next.js dò cả data/ và hết bộ nhớ. Bản build mới chỉ thay bản cũ khi đã dựng xong (đổi tên thư mục, rồi khởi động lại), nên build lỗi
# thì web vẫn chạy bản cũ, không bao giờ còn nửa bản như trước (từng xóa mất .next đang chạy khi build hết bộ nhớ).
set -euo pipefail
APP="${1:-/var/www/synchro}"; PM2="${2:-synchro}"; PIP="${3:-}"
B=$(mktemp -d /tmp/synchro-build.XXXXXX)
trap 'rm -rf "$B" "$APP/.next-new"' EXIT
chown -R synchro:synchro "$APP"
su - synchro -c "cd $APP && npm ci${PIP:+ && .mkvenv/bin/pip install -q -r requirements.txt}"
rsync -a --exclude /data --exclude /.next --exclude '/.next-*' --exclude /node_modules --exclude /.git --exclude /workspace/data --exclude /.mkvenv "$APP/" "$B/"
ln -s "$APP/node_modules" "$B/node_modules"
chown -R synchro:synchro "$B"
su - synchro -c "cd $B && NODE_OPTIONS=--max-old-space-size=3072 npx next build"
rm -rf "$APP/.next-new" "$APP/.next-old"
cp -a "$B/.next" "$APP/.next-new"
rm -rf "$APP/.next-new/cache" "$APP/.next-new/server/route-cache"
chown -R synchro:synchro "$APP/.next-new"
[ -d "$APP/.next" ] && mv "$APP/.next" "$APP/.next-old"
mv "$APP/.next-new" "$APP/.next"
su - synchro -c "pm2 restart $PM2 --update-env" || su - synchro -c "cd $APP && pm2 start npm --name $PM2 -- start -- -p 3001 && pm2 save"
rm -rf "$APP/.next-old"
echo "build ok: $(cat "$APP/.next/BUILD_ID")"
