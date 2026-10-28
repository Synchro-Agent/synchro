#!/bin/bash
# Bật Chromium headless trong container (nếu chưa chạy) và mở cổng DevTools 9223 cho dịch vụ workspace trên máy chủ.
# Chromium chỉ nghe ở 127.0.0.1:9222; socat chuyển tiếp 9223 -> 9222 để máy chủ (ngoài container) điều khiển được.
# Hồ sơ trình duyệt (đăng nhập, cookie) nằm trong thư mục làm việc nên còn nguyên khi container được tạo lại;
# tệp tải về vào ~/work/Downloads. Cờ khởi động giống trình duyệt thường (không lộ chế độ tự động, tiếng Việt, giờ Việt Nam).
mkdir -p "$HOME/.synchro" "$HOME/work/.browser" "$HOME/work/Downloads"
if ! pgrep -u "$(id -u)" -x chromium >/dev/null; then
  rm -f "$HOME/work/.browser/profile/SingletonLock" "$HOME/work/.browser/profile/SingletonSocket" "$HOME/work/.browser/profile/SingletonCookie"
  V=$(chromium --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)
  TZ=Asia/Ho_Chi_Minh nohup chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --disable-background-networking \
    --disable-blink-features=AutomationControlled --lang=vi-VN --accept-lang=vi-VN,vi,en-US,en \
    ${V:+--user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$V Safari/537.36"} \
    --disk-cache-size=104857600 --password-store=basic \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    --user-data-dir="$HOME/work/.browser/profile" --window-size=1280,800 \
    about:blank >"$HOME/.synchro/chromium.log" 2>&1 &
fi
if ! pgrep -u "$(id -u)" -x socat >/dev/null; then
  nohup socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null 2>&1 &
fi
for _ in $(seq 1 50); do
  curl -sf http://127.0.0.1:9222/json/version >/dev/null && exit 0
  sleep 0.2
done
echo "Chromium không khởi động được" >&2
tail -n 20 "$HOME/.synchro/chromium.log" >&2
exit 1
