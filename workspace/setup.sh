#!/usr/bin/env bash
# Lớp chuyển tiếp (H3 bước 5): tệp thật nay ở ops/setup.sh. Giữ một bản phát hành cho lệnh deploy còn gọi đường dẫn cũ
# (/root/deploy-<sha>.sh chạy "bash workspace/setup.sh") rồi xóa. Tệp này không nằm trong mã băm image workspace (ops/setup.sh, HASH).
exec bash "$(dirname "${BASH_SOURCE[0]}")/../ops/setup.sh" "$@"
