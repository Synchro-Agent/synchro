#!/usr/bin/env bash
# Watchdog của web (chạy bằng root, systemd timer mỗi phút; workspace/setup.sh chép vào /opt/synchro-ops và cài timer). Không dùng dịch vụ ngoài.
# - Gọi /api/health ở máy chủ. Web không trả lời, hoặc báo không ghi được cơ sở dữ liệu: tính một lần lỗi. 3 lần liên tiếp thì khởi động lại bằng pm2.
# - Web trả lời nhưng báo 503 vì đĩa gần đầy hay dịch vụ workspace tắt: khởi động lại web không chữa được, chỉ ghi lại (trang Sức khỏe hệ thống báo cho quản trị viên).
# - Đang deploy (scripts/server-build.sh giữ khóa): không làm gì. Tối thiểu 10 phút giữa hai lần khởi động lại, tối đa 3 lần mỗi giờ; quá thì dừng và ghi lại để người xử lý.
# Kết quả ở $OPS_DIR (web chỉ đọc): watchdog-state.json, watchdog.jsonl.
set -u
[ -f /etc/synchro-ops.env ] && . /etc/synchro-ops.env
OPS_DIR="${OPS_DIR:-/var/lib/synchro-ops}"; PORT="${PORT:-3001}"; PM2="${PM2:-synchro}"; WEB_USER="${WEB_USER:-synchro}"
LOCK="${DEPLOY_LOCK:-/run/synchro-deploy.lock}"
FAILS_MAX="${WATCHDOG_FAILS:-3}"; GAP="${WATCHDOG_GAP_SEC:-600}"; PER_HOUR="${WATCHDOG_PER_HOUR:-3}"
RESTART="${WATCHDOG_RESTART_CMD:-su - $WEB_USER -c 'pm2 restart $PM2 --update-env'}"
HEALTH="${WATCHDOG_URL:-http://127.0.0.1:$PORT/api/health}"
mkdir -p "$OPS_DIR"; chmod 755 "$OPS_DIR" 2>/dev/null || true
COUNT="$OPS_DIR/watchdog.fails"; RESTARTS="$OPS_DIR/watchdog.restarts"; LOG="$OPS_DIR/watchdog.jsonl"; STATE="$OPS_DIR/watchdog-state.json"
now=$(date +%s)

event() { # event <tên> [chi tiết]
  printf '{"at":%s000,"event":"%s","detail":"%s"}\n' "$now" "$1" "$(printf '%s' "${2:-}" | tr -d '"\\\n' | cut -c1-200)" >> "$LOG"
  chmod 644 "$LOG" 2>/dev/null || true
  if [ "$(wc -l < "$LOG")" -gt 1000 ]; then tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}
save() { # save <trạng thái>
  local last=0 n24=0
  if [ -f "$RESTARTS" ]; then
    last=$(tail -n 1 "$RESTARTS"); n24=$(awk -v c="$((now - 86400))" '$1 > c' "$RESTARTS" | wc -l | tr -d ' ')
  fi
  printf '{"at":%s000,"fails":%s,"status":"%s","lastRestartAt":%s,"restarts24":%s}\n' "$now" "$fails" "$1" "$(( ${last:-0} * 1000 ))" "$n24" > "$STATE.tmp"
  chmod 644 "$STATE.tmp"; mv "$STATE.tmp" "$STATE"
}
fails=$(cat "$COUNT" 2>/dev/null || echo 0); case "$fails" in ''|*[!0-9]*) fails=0 ;; esac
prev=$(sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' "$STATE" 2>/dev/null | head -1)

# Đang deploy: deploy tự kiểm tra sức khỏe và tự trả bản cũ.
if command -v flock >/dev/null 2>&1 && [ -e "$LOCK" ] && ! flock -n "$LOCK" true; then fails=0; echo 0 > "$COUNT"; save deploying; exit 0; fi

body=$(curl -sS --max-time "${WATCHDOG_TIMEOUT_SEC:-15}" -w '\n%{http_code}' "$HEALTH" 2>/dev/null); code=${body##*$'\n'}; body=${body%$'\n'*}
case "$code:$body" in
  200:*) status=ok ;;
  503:*'"db":true'*) status=degraded ;;
  *) status=failing ;;
esac

if [ "$status" != failing ]; then
  [ "$fails" -ge 2 ] && event recovered
  [ "$status" = degraded ] && [ "$prev" != degraded ] && event degraded "$(printf '%s' "$body" | cut -c1-160)"
  fails=0; echo 0 > "$COUNT"; save "$status"; exit 0
fi

fails=$((fails + 1)); echo "$fails" > "$COUNT"
[ "$fails" -eq 2 ] && event down "HTTP ${code:-000}"
if [ "$fails" -lt "$FAILS_MAX" ]; then save failing; exit 0; fi

# Giữ danh sách lần khởi động lại trong 24 giờ.
touch "$RESTARTS"; awk -v c="$((now - 86400))" '$1 > c' "$RESTARTS" > "$RESTARTS.tmp" && mv "$RESTARTS.tmp" "$RESTARTS"
last=$(tail -n 1 "$RESTARTS"); hour=$(awk -v c="$((now - 3600))" '$1 > c' "$RESTARTS" | wc -l | tr -d ' ')
if [ "$hour" -ge "$PER_HOUR" ]; then
  # Web đang chết thì trang Sức khỏe và thư của web đều không tới ai: lệnh báo động do chủ máy cấu hình ở /etc/synchro-ops.env (của root), chạy một lần mỗi lần chuyển sang trạng thái này.
  if [ "$prev" != gave_up ]; then
    event gave_up "$hour"
    if [ -n "${WATCHDOG_ALERT_CMD:-}" ]; then sh -c "$WATCHDOG_ALERT_CMD" </dev/null >/dev/null 2>&1 || event alert_failed; fi
  fi
  save gave_up; exit 0
fi
if [ -n "$last" ] && [ "$((now - last))" -lt "$GAP" ]; then save failing; exit 0; fi
if bash -c "$RESTART" >/dev/null 2>&1; then event restart "HTTP ${code:-000}"; else event restart_failed "HTTP ${code:-000}"; fi
echo "$now" >> "$RESTARTS"; chmod 644 "$RESTARTS" 2>/dev/null || true
fails=0; echo 0 > "$COUNT"; save restarted
