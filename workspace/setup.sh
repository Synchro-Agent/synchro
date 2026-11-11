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
# Dự án video Remotion (workspace/remotion, chép vào image ở /opt/remotion): mọi tệp trừ thư mục sinh ra (giống .dockerignore).
REMOTION_FILES=$(cd "$APP/workspace" && find remotion -type f -not -path 'remotion/node_modules/*' -not -path 'remotion/bundle/*' -not -path 'remotion/public/fonts/*' -not -path 'remotion/out/*' -not -path 'remotion/.synchro-video/*' | LC_ALL=C sort)
# Mẫu tài liệu (workspace/doc, chép vào image ở /opt/synchro/doc: mẫu Typst, hợp đồng JSON, synchro-doc, bộ dựng Word): mọi tệp trừ node_modules.
DOC_FILES=$(cd "$APP/workspace" && find doc -type f -not -path 'doc/docx/node_modules/*' -not -path '*/__pycache__/*' | LC_ALL=C sort)
# Biểu đồ (workspace/charts, chép vào image ở /opt/synchro/charts: synchro-chart, cấu hình biểu đồ, package-lock của ECharts): mọi tệp trừ node_modules.
CHART_FILES=$(cd "$APP/workspace" && find charts -type f -not -path 'charts/node_modules/*' | LC_ALL=C sort)
HASH=$( { cat "$APP/workspace/Dockerfile" "$APP/workspace/.dockerignore" "$APP/workspace/fsop.js" "$APP/workspace/browser.sh" "$APP/workspace/subfit.py" "$APP/workspace/xlsx_recalc.py"; \
  for f in $REMOTION_FILES $DOC_FILES $CHART_FILES; do printf '%s\n' "$f"; cat "$APP/workspace/$f"; done; } | sha256sum | cut -c1-16)
CUR=$(docker image inspect -f '{{index .Config.Labels "synchro.hash"}}' "$IMAGE" 2>/dev/null || true)
if [ "$HASH" != "$CUR" ]; then
  echo "Đang build image $IMAGE…"
  docker build -q -t "$IMAGE" --label "synchro.hash=$HASH" "$APP/workspace"
  docker image prune -f >/dev/null
  IMG_CHANGED=1
fi

# 3. Dịch vụ systemd. Chỉ khởi động lại khi code của dịch vụ hoặc tệp dịch vụ đổi: deploy nào cũng chạy tệp này, khởi động lại vô cớ làm rớt
# terminal, màn hình trình duyệt và lần chạy code đang dở (dựng video dài). Khi phải khởi động lại, dịch vụ tự chờ lần chạy đang dở xong:
# KillMode=mixed chỉ gửi SIGTERM cho tiến trình chính (không đụng lệnh docker con của nó), TimeoutStopSec lớn hơn WS_DRAIN_SEC (mặc định 300 giây).
UNIT=/etc/systemd/system/synchro-ws.service
STAMP=/etc/synchro-ws.hash
# Dịch vụ chạy bằng root nên mã của nó nằm ở nơi chỉ root ghi được, không chạy trực tiếp từ thư mục app và node_modules (của web user):
# lỗi đọc tệp hay lỗi nào khác cho chiếm được web user không leo lên root được qua đây. Chép mã trước khi khởi động lại; tiến trình đang chạy đã nạp xong nên không ảnh hưởng.
WSBIN=/opt/synchro-ws
mkdir -p "$WSBIN/node_modules"
install -o root -g root -m 644 "$APP"/workspace/*.mjs "$WSBIN"/
WSV=$(sed -n '/"node_modules\/ws": {/,/}/s/.*"version": "\(.*\)".*/\1/p' "$APP/package-lock.json" | head -1)
if [ "$(cat "$WSBIN/node_modules/.ws-version" 2>/dev/null || true)" != "$WSV" ] || [ ! -f "$WSBIN/node_modules/ws/package.json" ]; then
  # Cài mới từ npm (đúng phiên bản trong package-lock, không chạy script cài đặt); không có mạng thì chép từ bản của app.
  if ! npm install --prefix "$WSBIN" --no-audit --no-fund --no-save --no-package-lock --ignore-scripts "ws@$WSV" >/dev/null 2>&1; then
    rm -rf "$WSBIN/node_modules/ws"; cp -a "$APP/node_modules/ws" "$WSBIN/node_modules/ws"
  fi
  echo "$WSV" > "$WSBIN/node_modules/.ws-version"
fi
chown -R root:root "$WSBIN"; chmod -R go-w "$WSBIN"
NEWUNIT=$(cat <<EOF
[Unit]
Description=Synchro Code workspace agent
After=docker.service network-online.target
Requires=docker.service

[Service]
EnvironmentFile=$ENVF
WorkingDirectory=$WSBIN
ExecStart=/usr/bin/node $WSBIN/agent.mjs
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
# Image vừa build lại mà dịch vụ không khởi động lại: bỏ kho container khởi động sẵn (image cũ), dựng lại bằng image mới.
if [ -n "${IMG_CHANGED:-}" ] && [ -z "$CHANGED" ]; then
  SEC=$(sed -n 's/^WS_AGENT_SECRET=//p' "$ENVF" | head -1)
  # Khóa đưa qua stdin (curl -K -), không nằm trên dòng lệnh để tiến trình khác không đọc được.
  printf 'header = "Authorization: Bearer %s"\n' "$SEC" | curl -fsS -m 60 -X POST -K - http://127.0.0.1:3555/warm/refresh >/dev/null 2>&1 || true
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

# 5. Watchdog của web và sao lưu hằng đêm (Cài đặt → Sức khỏe hệ thống đọc kết quả ở /var/lib/synchro-ops). Lỗi ở đây không được làm hỏng deploy.
install_ops() {
  local OPS=/opt/synchro-ops ENVO=/etc/synchro-ops.env PM2_NAME=synchro PORT
  mkdir -p "$OPS" /var/lib/synchro-ops
  chmod 755 /var/lib/synchro-ops
  install -o root -g root -m 755 "$APP/scripts/watchdog.sh" "$OPS/watchdog.sh"
  PORT=$(su - synchro -c "pm2 jlist" 2>/dev/null | PM2_NAME="$PM2_NAME" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const e = JSON.parse(s.slice(s.indexOf("["))).find((x) => x.name === process.env.PM2_NAME)?.pm2_env ?? {};
        const a = [].concat(e.args ?? []).map(String), i = a.indexOf("-p");
        process.stdout.write(String(i >= 0 ? a[i + 1] : e.PORT ?? e.env?.PORT ?? ""));
      } catch {}
    });' || true)
  # Tệp này root đọc rồi chạy nên chỉ root ghi được; giữ nguyên những gì chủ dịch vụ đã thêm (SYNCHRO_BACKUP_HOOK).
  [ -f "$ENVO" ] || (umask 077; : > "$ENVO")
  chown root:root "$ENVO"; chmod 600 "$ENVO"
  grep -q '^APP=' "$ENVO" || echo "APP=$APP" >> "$ENVO"
  grep -q '^PM2=' "$ENVO" || echo "PM2=$PM2_NAME" >> "$ENVO"
  grep -q '^WEB_USER=' "$ENVO" || echo "WEB_USER=synchro" >> "$ENVO"
  grep -q '^PORT=' "$ENVO" || echo "PORT=${PORT:-3001}" >> "$ENVO"
  local SVC=/etc/systemd/system/synchro-watchdog.service TMR=/etc/systemd/system/synchro-watchdog.timer
  local NS NT
  NS=$(printf '[Unit]\nDescription=Synchro web watchdog\n\n[Service]\nType=oneshot\nExecStart=/bin/bash %s/watchdog.sh\nTimeoutStartSec=120\n' "$OPS")
  NT=$(printf '[Unit]\nDescription=Synchro web watchdog, every minute\n\n[Timer]\nOnBootSec=3min\nOnUnitActiveSec=1min\nAccuracySec=10s\n\n[Install]\nWantedBy=timers.target\n')
  if [ "$(cat "$SVC" 2>/dev/null || true)" != "$NS" ] || [ "$(cat "$TMR" 2>/dev/null || true)" != "$NT" ]; then
    printf '%s\n' "$NS" > "$SVC"; printf '%s\n' "$NT" > "$TMR"
    systemctl daemon-reload
  fi
  systemctl enable -q --now synchro-watchdog.timer
  # Sao lưu: chỉ thêm lịch khi máy chưa có; đã có lịch thì giữ nguyên của chủ dịch vụ.
  if ! grep -qs 'backup\.sh' /etc/crontab /etc/cron.d/* && ! crontab -l 2>/dev/null | grep -q 'backup\.sh'; then
    printf '0 3 * * * root bash %s/scripts/backup.sh %s /var/backups/synchro >> /var/log/synchro-backup.log 2>&1\n' "$APP" "$APP" > /etc/cron.d/synchro-backup
    chmod 644 /etc/cron.d/synchro-backup
  fi
}
install_ops || echo "CẢNH BÁO: chưa cài được watchdog hoặc lịch sao lưu (trang Sức khỏe hệ thống sẽ báo)." >&2

# 6. Litestream (sao lưu liên tục lên Cloudflare R2, app/litestream.ts; quản trị viên bật ở Cài đặt → Sức khỏe hệ thống, xem docs/backup-r2.md).
# Bản cố định, kiểm sha256 trước khi cài (checksums.txt của bản phát hành v0.5.17). Đã đúng bản thì không tải lại. Lỗi ở đây không làm hỏng deploy:
# web vẫn chạy, chỉ là chưa sao lưu liên tục được (trang Sức khỏe hệ thống báo "Máy chủ chưa cài litestream").
install_litestream() {
  local V=0.5.17 BIN=/usr/local/bin/litestream ARCH SUM T
  if [ -x "$BIN" ] && [ "$("$BIN" version 2>/dev/null)" = "$V" ]; then return 0; fi
  case "$(uname -m)" in
    x86_64|amd64) ARCH=linux-x86_64; SUM=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d ;;
    aarch64|arm64) ARCH=linux-arm64; SUM=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 ;;
    *) echo "Litestream: chưa hỗ trợ kiến trúc $(uname -m)." >&2; return 1 ;;
  esac
  T=$(mktemp -d)
  if ! curl -fsSL --max-time 120 -o "$T/ls.tgz" "https://github.com/benbjohnson/litestream/releases/download/v$V/litestream-$V-$ARCH.tar.gz"; then rm -rf "$T"; return 1; fi
  if ! echo "$SUM  $T/ls.tgz" | sha256sum -c --status; then echo "Litestream: sha256 không khớp, không cài." >&2; rm -rf "$T"; return 1; fi
  tar -xzf "$T/ls.tgz" -C "$T" litestream
  install -o root -g root -m 755 "$T/litestream" "$BIN"
  rm -rf "$T"
  echo "Đã cài litestream $V."
}
install_litestream || echo "CẢNH BÁO: chưa cài được litestream (sao lưu liên tục lên R2 chưa dùng được)." >&2
echo "Workspace sẵn sàng."
