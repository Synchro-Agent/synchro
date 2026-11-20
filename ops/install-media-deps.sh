#!/usr/bin/env bash
# Cài chương trình cho ba bộ đọc tệp cần thứ ngoài Node (Ubuntu 22.04 / 24.04), rồi tự kiểm và in phiên bản:
# - Ảnh HEIC (iPhone): libheif-examples (heif-dec / heif-convert). Ubuntu 24.04 tách bộ giải HEVC ra gói
#   libheif-plugin-libde265; 22.04 đã kèm trong libheif1. Sharp trên npm không có bộ giải HEVC nên web gọi công cụ
#   này (server/fileproc/heic.ts).
# - Office cũ .doc / .xls / .ppt: LibreOffice không giao diện (gói -nogui, không Java, không gói gợi ý); web gọi
#   /usr/bin/soffice (SYNCHRO_SOFFICE_BIN trong ecosystem.config.cjs).
# - OCR trang PDF scan (SYNCHRO_OCR=1): thư viện hệ thống mà OpenCV cần (libgl1, GLib). Gói Python
#   (rapidocr-onnxruntime, pypdfium2) nằm trong requirements.txt; ops/server-build.sh cài vào .mkvenv khi deploy có
#   tham số pip.
#
# Chạy bằng root trên máy chủ: sudo bash ops/install-media-deps.sh [thư mục app, mặc định /var/www/synchro]
# Chạy lại bao nhiêu lần cũng được: gói đã có thì bỏ qua. Không khởi động lại web; trang Cài đặt → Sức khỏe hệ thống
# đo lại sau tối đa 1 phút (bấm Làm mới), /api/health sau tối đa 10 phút.
#
# Ảnh hưởng tới máy chủ (ước lượng theo cỡ gói Ubuntu, chưa đo trên máy chủ thật):
# - Đĩa: LibreOffice -nogui (writer, calc, impress và thư viện kèm) khoảng 300-400 MB; libheif + libde265 dưới 5 MB;
#   libgl1 / GLib vài chục MB (thường đã có). Gói Python OCR trong .mkvenv khoảng 250 MB (đã có trong requirements.txt).
# - Bộ nhớ, chỉ trong lúc đọc tệp (không có tiến trình thường trú): giải HEIC khoảng 4 byte mỗi điểm ảnh, ảnh iPhone
#   12 MP khoảng 100-150 MB trong dưới 1 giây, trần 40 triệu điểm ảnh và 1,5 GB bộ nhớ ảo (prlimit). Một lần soffice
#   chuyển tệp khoảng 150-300 MB trong 2-10 giây. Một tiến trình OCR (mọi trang scan của một tệp) khoảng 300-500 MB.
#   Office cũ và OCR đi hàng "convert" của web: tối đa SYNCHRO_CONVERT_MAX (mặc định 2) việc cùng lúc trên cả máy, mỗi
#   người một việc; ảnh HEIC đi hàng đọc tệp thường (2 việc). Đỉnh thêm vào khoảng 1 GB.
set -euo pipefail

APP="${1:-/var/www/synchro}"
WEB_USER="${WEB_USER:-synchro}"
say() { echo "install-media-deps: $*"; }
die() { echo "install-media-deps: $*" >&2; exit 1; }
[ "$(uname -s)" = "Linux" ] || die "chỉ chạy trên Linux (Ubuntu)."
[ "$(id -u)" -eq 0 ] || die "cần chạy bằng root (sudo)."
command -v apt-get >/dev/null 2>&1 || die "không có apt-get, máy này không phải Ubuntu / Debian."
export DEBIAN_FRONTEND=noninteractive

installed() { [ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true)" = "install ok installed" ]; }
# Gói có trong kho apt của bản Ubuntu này (tên gói đổi giữa 22.04 và 24.04).
known() { apt-cache show "$1" >/dev/null 2>&1; }
first_known() { for p in "$@"; do if known "$p"; then echo "$p"; return; fi; done; }
# Máy mới chưa từng apt-get update thì danh sách gói trống và known() sai hết: update trước khi chọn tên gói.
known libheif-examples || apt-get update -q

WANT=(libheif-examples libgl1)
GLIB=$(first_known libglib2.0-0t64 libglib2.0-0)
if [ -n "$GLIB" ]; then WANT+=("$GLIB"); fi
# 24.04 trở đi: thiếu plugin này thì heif-dec có mà không giải được ảnh iPhone (trang Sức khỏe báo "Chạy thử lỗi").
if known libheif-plugin-libde265; then WANT+=(libheif-plugin-libde265); fi
# Ảnh HEIF mã AV1 web đã giải bằng sharp trước khi gọi heif-dec; plugin này để chính heif-dec (và phần tự kiểm bên
# dưới khi người vận hành thử tay) cũng giải được, vì --no-install-recommends không kéo nó theo.
if known libheif-plugin-dav1d; then WANT+=(libheif-plugin-dav1d); fi
for app in writer calc impress; do
  if known "libreoffice-$app-nogui"; then WANT+=("libreoffice-$app-nogui"); else WANT+=("libreoffice-$app"); fi
done

MISSING=()
for p in "${WANT[@]}"; do installed "$p" || MISSING+=("$p"); done
if [ "${#MISSING[@]}" -gt 0 ]; then
  say "cài: ${MISSING[*]}"
  apt-get update -q
  apt-get install -y -q --no-install-recommends "${MISSING[@]}"
else
  say "đủ gói, không cài thêm."
fi

echo
say "phiên bản:"
for p in "${WANT[@]}"; do
  printf '  %-32s %s\n' "$p" "$(dpkg-query -W -f='${Version}' "$p" 2>/dev/null || echo '(không có)')"
done

echo
say "tự kiểm:"
PROBE="$APP/scripts/media-probe.heic"
TMP=$(mktemp -d)
chmod 755 "$TMP"
trap 'rm -rf "$TMP"' EXIT
DEC=$(command -v heif-dec || command -v heif-convert || true)
if [ -z "$DEC" ]; then
  echo "  HEIC: KHÔNG có heif-dec / heif-convert" >&2
elif [ ! -f "$PROBE" ]; then
  echo "  HEIC: có $DEC nhưng không thấy ảnh mẫu $PROBE (đặt thư mục app ở tham số đầu)"
elif timeout 60 "$DEC" "$PROBE" "$TMP/probe.png" >/dev/null 2>&1 && [ -s "$TMP/probe.png" ]; then
  echo "  HEIC: giải được ảnh mẫu bằng $DEC"
else
  echo "  HEIC: $DEC KHÔNG giải được ảnh mẫu (thiếu plugin libde265?)" >&2
fi
if command -v soffice >/dev/null 2>&1; then
  VER=$(HOME="$TMP" timeout 60 soffice --headless --version 2>/dev/null | head -1 || true)
  echo "  Office cũ: ${VER:-soffice không trả lời} ($(command -v soffice))"
else
  echo "  Office cũ: KHÔNG có soffice" >&2
fi
# .mkvenv do web user ghi được: chạy Python của nó bằng chính web user, không bằng root.
PY="$APP/.mkvenv/bin/python"
CHECK="import importlib.metadata as m, rapidocr_onnxruntime, pypdfium2; print(m.version('rapidocr-onnxruntime'))"
if [ ! -x "$PY" ]; then
  echo "  OCR: chưa có $PY; deploy với tham số pip (bash ops/server-build.sh $APP synchro pip)"
elif OUT=$(cd "$TMP" && runuser -u "$WEB_USER" -- "$PY" -c "$CHECK" 2>&1); then
  echo "  OCR: rapidocr-onnxruntime $OUT"
else
  echo "  OCR: thư viện Python chưa nạp được: $(echo "$OUT" | tail -1)" >&2
fi
