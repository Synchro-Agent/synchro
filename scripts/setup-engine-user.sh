#!/usr/bin/env bash
# Tạo user hệ thống riêng để chạy CLI chính chủ (claude, codex, agy) thay vì chạy bằng user của Synchro (ADR 0001, bước 6).
# CLI chạy bằng user này nên không đọc được cơ sở dữ liệu, khóa mã hóa hay khóa API của Synchro; chỉ ghi trong thư mục nhà engine
# (thư mục đăng nhập riêng của từng tài khoản và thư mục làm việc).
#
# Chạy một lần bằng root trên máy chủ:   sudo bash scripts/setup-engine-user.sh
# Tùy chọn: APP_USER (user chạy Synchro, mặc định synchro), CLI_USER (mặc định synchro-cli),
#           ENGINE_HOME (mặc định /var/www/synchro-engine).
set -euo pipefail

APP_USER="${APP_USER:-synchro}"
CLI_USER="${CLI_USER:-synchro-cli}"
ENGINE_HOME="${ENGINE_HOME:-/var/www/synchro-engine}"

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng root (sudo)." >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "Không có user $APP_USER." >&2; exit 1; }

if ! id "$CLI_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$ENGINE_HOME" --shell /usr/sbin/nologin --user-group "$CLI_USER"
  echo "Đã tạo user hệ thống $CLI_USER."
fi

mkdir -p "$ENGINE_HOME/.local/bin" "$ENGINE_HOME/.local/nobrowser" "$ENGINE_HOME/logins" "$ENGINE_HOME/work"
# Lệnh "mở trình duyệt" giả: CLI trên máy chủ không mở trình duyệt, Synchro đọc link đăng nhập từ đầu ra.
for b in open xdg-open x-www-browser www-browser sensible-browser gio wslview; do
  printf '#!/bin/sh\nexit 0\n' > "$ENGINE_HOME/.local/nobrowser/$b"
  chmod 755 "$ENGINE_HOME/.local/nobrowser/$b"
done

# Nhà engine thuộc user CLI; nhóm của Synchro chỉ được đi qua và chạy thử CLI trong .local/bin (để kiểm tra đã cài),
# không đọc được thư mục đăng nhập của từng tài khoản (logins/ 0700).
chown -R "$CLI_USER:$APP_USER" "$ENGINE_HOME"
chmod 750 "$ENGINE_HOME" "$ENGINE_HOME/.local" "$ENGINE_HOME/.local/bin" "$ENGINE_HOME/.local/nobrowser"
chmod 700 "$ENGINE_HOME/logins" "$ENGINE_HOME/work"

# Synchro chỉ được chạy lệnh bằng user CLI (không phải root): `sudo -n -u synchro-cli -- env -i … <CLI>`.
RULE="/etc/sudoers.d/synchro-cli"
# Không ghi lệnh được phép vào nhật ký hệ thống: Antigravity chỉ nhận prompt qua tham số -p, mặc định sudo chép cả dòng lệnh (lời nhắn và câu lệnh tạo ảnh của người dùng,
# kể cả đoạn chat ẩn danh) vào auth.log và journal, sống lâu hơn mọi hạn xóa Synchro cam kết. Lệnh bị từ chối vẫn được ghi. sudo cũ chưa có log_allowed thì tắt hẳn nhật ký của user này.
write_rule() { printf 'Defaults:%s %s\n%s ALL=(%s) NOPASSWD: /usr/bin/env\n' "$APP_USER" "$1" "$APP_USER" "$CLI_USER" > "$RULE.tmp"; chmod 440 "$RULE.tmp"; visudo -c -f "$RULE.tmp" >/dev/null 2>&1; }
write_rule '!log_allowed' || write_rule '!syslog, !logfile' || { echo "visudo không nhận quy tắc sudo." >&2; rm -f "$RULE.tmp"; exit 1; }
mv "$RULE.tmp" "$RULE"

cat <<MSG

Xong. Thêm vào tệp môi trường của Synchro (/var/www/synchro/.env.production) rồi khởi động lại:
  SYNCHRO_ENGINE_HOME=$ENGINE_HOME
  SYNCHRO_ENGINE_USER=$CLI_USER
  su - $APP_USER -c "pm2 restart synchro"
Kiểm tra: su - $APP_USER -c "sudo -n -u $CLI_USER -- env -i -C $ENGINE_HOME PATH=/usr/bin:/bin whoami"   (in ra $CLI_USER)
Sau đó vào Cài đặt → Providers (tài khoản quản trị) bấm Cài cho từng CLI, rồi đăng nhập lại
(đăng nhập cũ nằm ở thư mục engine trước đây nên không mang sang).
MSG
