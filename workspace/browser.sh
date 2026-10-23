#!/bin/bash
# Bật Chromium headless trong container (nếu chưa chạy) và mở cổng DevTools 9223 cho dịch vụ workspace trên máy chủ.
# Chromium chỉ nghe ở 127.0.0.1:9222; socat chuyển tiếp 9223 -> 9222 để máy chủ (ngoài container) điều khiển được.
mkdir -p "$HOME/.synchro"
if ! pgrep -u "$(id -u)" -x chromium >/dev/null; then
  nohup chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --disable-background-networking \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    --user-data-dir="$HOME/.synchro/chromium" --window-size=1280,800 \
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
