#!/usr/bin/env bash
# Lớp chuyển tiếp (H3 bước 5): tệp thật nay ở ops/watchdog.sh. Giữ một bản phát hành cho lệnh còn gọi đường dẫn cũ (/root/deploy-<sha>.sh,
# lịch /etc/cron.d/synchro-backup, SYNCHRO_BACKUP_HOOK trong /etc/synchro-ops.env, tài liệu cũ) rồi xóa. ops/setup.sh sửa lịch và hook sang ops/.
exec bash "$(dirname "${BASH_SOURCE[0]}")/../ops/watchdog.sh" "$@"
