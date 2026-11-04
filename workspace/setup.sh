#!/bin/bash
# Cài / cập nhật workspace của Synchro Code trên VPS. Chạy bằng root; chạy lại nhiều lần vẫn an toàn (deploy gọi mỗi lần).
set -euo pipefail
APP=${APP:-/var/www/synchro}
ENVF=/etc/synchro-ws.env
APPENV=$APP/.env.production
IMAGE=synchro-ws:1

# 1. Khóa bí mật dùng chung giữa máy chủ Next và dịch vụ workspace (không in ra màn hình).
if [ ! -f "$ENVF" ]; then
  (umask 077; echo "WS_AGENT_SECRET=$(openssl rand -hex 32)" > "$ENVF")
fi
if ! grep -q '^WS_AGENT_SECRET=' "$APPENV"; then
  { echo "WS_AGENT_URL=http://127.0.0.1:3555"; grep '^WS_AGENT_SECRET=' "$ENVF"; } >> "$APPENV"
fi
mkdir -p /srv/synchro-ws && chmod 711 /srv/synchro-ws

# 2. Build lại image khi Dockerfile hoặc file đi kèm thay đổi.
HASH=$(cat "$APP/workspace/Dockerfile" "$APP/workspace/fsop.js" "$APP/workspace/browser.sh" "$APP/workspace/subfit.py" "$APP/workspace/xlsx_recalc.py" | sha256sum | cut -c1-16)
CUR=$(docker image inspect -f '{{index .Config.Labels "synchro.hash"}}' "$IMAGE" 2>/dev/null || true)
if [ "$HASH" != "$CUR" ]; then
  echo "Đang build image $IMAGE…"
  docker build -q -t "$IMAGE" --label "synchro.hash=$HASH" "$APP/workspace"
  docker image prune -f >/dev/null
fi

# 3. Dịch vụ systemd. Chỉ khởi động lại khi code của dịch vụ hoặc tệp dịch vụ đổi: deploy nào cũng chạy tệp này, khởi động lại vô cớ làm rớt
# terminal, màn hình trình duyệt và lần chạy code đang dở (dựng video dài). Khi phải khởi động lại, dịch vụ tự chờ lần chạy đang dở xong:
# KillMode=mixed chỉ gửi SIGTERM cho tiến trình chính (không đụng lệnh docker con của nó), TimeoutStopSec lớn hơn WS_DRAIN_SEC (mặc định 300 giây).
UNIT=/etc/systemd/system/synchro-ws.service
STAMP=/etc/synchro-ws.hash
NEWUNIT=$(cat <<EOF
[Unit]
Description=Synchro Code workspace agent
After=docker.service network-online.target
Requires=docker.service

[Service]
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=/usr/bin/node $APP/workspace/agent.mjs
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=330

[Install]
WantedBy=multi-user.target
EOF
)
AGENT=$(cat "$APP"/workspace/*.mjs | sha256sum | cut -c1-16)
CHANGED=""
if [ "$(cat "$UNIT" 2>/dev/null || true)" != "$NEWUNIT" ]; then
  printf '%s\n' "$NEWUNIT" > "$UNIT"
  systemctl daemon-reload
  CHANGED=1
fi
systemctl enable -q synchro-ws
if [ "$(cat "$STAMP" 2>/dev/null || true)" != "$AGENT" ]; then CHANGED=1; fi
if [ -n "$CHANGED" ]; then
  echo "Code dịch vụ workspace đã đổi: khởi động lại (chờ lần chạy đang dở tối đa ~5 phút)…"
  systemctl restart synchro-ws
  echo "$AGENT" > "$STAMP"
elif ! systemctl is-active -q synchro-ws; then
  systemctl start synchro-ws
fi

# 4. nginx: chỉ mở ba đường WebSocket (terminal, màn hình trình duyệt, tiện ích Synchro trong Chrome của người dùng); API còn lại chỉ nghe ở 127.0.0.1.
SNIP=/etc/nginx/snippets/synchro-ws.conf
NEWSNIP=$(cat <<'EOF'
location ~ ^/ws-agent/(term|screen|ext)$ {
    proxy_pass http://127.0.0.1:3555;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
EOF
)
RELOAD=""
if [ "$(cat "$SNIP" 2>/dev/null || true)" != "$NEWSNIP" ]; then printf '%s\n' "$NEWSNIP" > "$SNIP"; RELOAD=1; fi
SITE=/etc/nginx/sites-enabled/synchro
if ! grep -q 'snippets/synchro-ws.conf' "$SITE"; then
  sed -i '0,/listen 443 ssl/s//include snippets\/synchro-ws.conf;\n    listen 443 ssl/' "$SITE"
  RELOAD=1
fi
if [ -n "$RELOAD" ]; then nginx -t -q && systemctl reload nginx; fi
echo "Workspace sẵn sàng."
