#!/usr/bin/env bash
# Thêm swap cho máy chủ (Blueprint G3.3): container chạy code / workspace có --memory-swap lớn hơn --memory (workspace/agent.mjs), nhưng phần
# swap thêm đó chỉ có tác dụng khi chính máy chủ có swap; không có thì container vượt --memory vẫn bị kill (mã 137).
#
# Chạy bằng root: sudo bash ops/setup-swap.sh   (ops/server-build.sh gọi mỗi lần deploy; chạy lại bao nhiêu lần cũng được)
# Tùy chọn: SWAP_FILE (mặc định /swapfile), SWAP_MB (mặc định 4096), SWAP_SWAPPINESS (mặc định 10: chỉ dùng swap khi RAM thật sắp hết),
#           SWAP_MIN_FREE_MB (mặc định 3000, giống WS_MIN_FREE_MB: sau khi tạo tệp swap đĩa vẫn phải còn trống chừng này).
# Bỏ qua (thoát 0, không đổi gì) khi: máy đã có từ SWAP_MB swap trở lên, không phải Linux, không có swapon / mkswap, đĩa không đủ chỗ.
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_MB="${SWAP_MB:-4096}"
SWAPPINESS="${SWAP_SWAPPINESS:-10}"
MIN_FREE_MB="${SWAP_MIN_FREE_MB:-3000}"

say() { echo "setup-swap: $*"; }
[ "$(uname -s)" = "Linux" ] || { say "không phải Linux, bỏ qua."; exit 0; }
[ "$(id -u)" -eq 0 ] || { echo "setup-swap: cần chạy bằng root (sudo)." >&2; exit 1; }
for c in swapon mkswap; do command -v "$c" >/dev/null 2>&1 || { say "không có $c, bỏ qua."; exit 0; }; done

# Swap đang bật (MB), đọc từ /proc/meminfo.
swap_now() { awk '/^SwapTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo; }

# swappiness thấp: nhân Linux chỉ đẩy sang swap khi RAM thật gần hết (swap là đệm chống OOM, không phải RAM thêm). Ghi cả vào sysctl.d để giữ sau khởi động lại.
set_swappiness() {
  if [ "$(cat /proc/sys/vm/swappiness 2>/dev/null || echo)" != "$SWAPPINESS" ]; then
    sysctl -q -w "vm.swappiness=$SWAPPINESS" >/dev/null 2>&1 || true
  fi
  if [ -d /etc/sysctl.d ] && ! grep -qs "^vm.swappiness *= *$SWAPPINESS\$" /etc/sysctl.d/90-synchro-swap.conf; then
    printf '# ops/setup-swap.sh (Blueprint G3.3)\nvm.swappiness = %s\n' "$SWAPPINESS" > /etc/sysctl.d/90-synchro-swap.conf
  fi
}

# Dòng fstab để swap tự bật lại sau khi khởi động máy (chỉ thêm một lần).
add_fstab() {
  if ! awk -v f="$SWAP_FILE" '$1 == f && $3 == "swap" { found = 1 } END { exit !found }' /etc/fstab 2>/dev/null; then
    printf '%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab
    say "đã thêm $SWAP_FILE vào /etc/fstab."
  fi
}

NOW=$(swap_now)
if [ "${NOW:-0}" -ge "$SWAP_MB" ]; then
  say "đã có ${NOW} MB swap (≥ ${SWAP_MB} MB), không đổi gì."
  set_swappiness
  exit 0
fi

# Tệp swap đã có (lần trước tạo nhưng chưa bật, vd. sau khi khởi động lại mà thiếu dòng fstab): bật lại nếu đúng cỡ, sai cỡ thì tạo lại.
if [ -f "$SWAP_FILE" ]; then
  SIZE_MB=$(( $(stat -c %s "$SWAP_FILE") / 1048576 ))
  if grep -qs "^$SWAP_FILE " /proc/swaps; then
    say "$SWAP_FILE đang bật (${SIZE_MB} MB) nhưng tổng swap ${NOW} MB < ${SWAP_MB} MB; giữ nguyên, đặt SWAP_FILE khác nếu cần thêm."
    add_fstab; set_swappiness; exit 0
  fi
  if [ "$SIZE_MB" -ge "$SWAP_MB" ]; then
    chmod 600 "$SWAP_FILE"
    if swapon "$SWAP_FILE" 2>/dev/null || { mkswap "$SWAP_FILE" >/dev/null && swapon "$SWAP_FILE"; }; then
      say "đã bật lại $SWAP_FILE (${SIZE_MB} MB)."
      add_fstab; set_swappiness; exit 0
    fi
  fi
  rm -f "$SWAP_FILE"
fi

# Đủ đĩa: tạo tệp swap xong vẫn còn trống MIN_FREE_MB (SQLite, nhật ký, lần chạy code của mọi người cần đĩa hơn swap).
DIR=$(dirname "$SWAP_FILE")
FREE_MB=$(df -Pm "$DIR" | awk 'NR == 2 { print $4 }')
if [ "${FREE_MB:-0}" -lt $(( SWAP_MB + MIN_FREE_MB )) ]; then
  say "đĩa chỉ còn ${FREE_MB} MB trống, cần $(( SWAP_MB + MIN_FREE_MB )) MB; không tạo swap." >&2
  exit 0
fi

# fallocate nhanh; hệ thống tệp không hỗ trợ (vd. một số btrfs / xfs cũ) thì ghi bằng dd.
fallocate -l "${SWAP_MB}M" "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_MB" status=none
chmod 600 "$SWAP_FILE"
mkswap "$SWAP_FILE" >/dev/null
swapon "$SWAP_FILE"
add_fstab
set_swappiness
say "đã bật ${SWAP_MB} MB swap ở $SWAP_FILE (tổng swap: $(swap_now) MB, swappiness $SWAPPINESS)."
