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
HASH=$(cat "$APP/workspace/Dockerfile" "$APP/workspace/fsop.js" "$APP/workspace/browser.sh" | sha256sum | cut -c1-16)
CUR=$(docker image inspect -f '{{index .Config.Labels "synchro.hash"}}' "$IMAGE" 2>/dev/null || true)
if [ "$HASH" != "$CUR" ]; then
  echo "Đang build image $IMAGE…"
  docker build -q -t "$IMAGE" --label "synchro.hash=$HASH" "$APP/workspace"
  docker image prune -f >/dev/null
fi

# 3. Dịch vụ systemd.
cat > /etc/systemd/system/synchro-ws.service <<EOF
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

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q synchro-ws
systemctl restart synchro-ws

# 4. nginx: chỉ mở hai đường WebSocket (terminal, màn hình trình duyệt); API còn lại chỉ nghe ở 127.0.0.1.
cat > /etc/nginx/snippets/synchro-ws.conf <<'EOF'
location ~ ^/ws-agent/(term|screen)$ {
    proxy_pass http://127.0.0.1:3555;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
EOF
SITE=/etc/nginx/sites-enabled/synchro
if ! grep -q 'snippets/synchro-ws.conf' "$SITE"; then
  sed -i '0,/listen 443 ssl/s//include snippets\/synchro-ws.conf;\n    listen 443 ssl/' "$SITE"
fi
nginx -t -q && systemctl reload nginx
echo "Workspace sẵn sàng."
