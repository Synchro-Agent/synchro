#!/bin/bash
# Tự kiểm tra bộ dựng tài liệu trong image workspace (lúc build image và trên image thử): chạy như người dùng của sandbox, không cần mạng.
# Lỗi ở đây làm build hỏng thay vì giao image có Typst / WeasyPrint / phông hỏng. Dùng: bash /opt/synchro/doc/selftest.sh [thư mục giữ kết quả]
set -u
KIT=/opt/synchro/doc
KEEP=${1:-}
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
cd "$W" || exit 1
# Không mạng: mọi lần tải đều đi vào cổng chết, nên chỉ chạy được nhờ gói đặt sẵn.
export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9
fail=0
ok() { echo "  ok   $*"; }
bad() { echo "  LỖI  $*"; fail=1; }
mkdir -p outputs inputs

echo "== phiên bản"
v15=$(typst --version 2>&1); v12=$(/usr/local/lib/synchro-doc/typst-0.12.0 --version 2>&1)
case "$v15" in "typst 0.15.1"*) ok "$v15";; *) bad "typst: $v15";; esac
case "$v12" in "typst 0.12.0"*) ok "$v12 (chỉ cho basic-report 0.1.0)";; *) bad "typst 0.12.0: $v12";; esac
wv=$(python3 -c 'import weasyprint; print(weasyprint.__version__)' 2>&1)
[ "$wv" = "70.0" ] && ok "WeasyPrint $wv" || bad "WeasyPrint: $wv"

echo "== lệnh typst init của chủ dự án (không mạng)"
for spec in "basic-report:0.1.0 mau-bao-cao-doanh-nghiep" "ilm:1.4.0 mau-de-xuat-du-an" "charged-ieee:0.1.3 mau-bao-cao-2-cot"; do
  set -- $spec
  typst init "@preview/$1" "$2" >/dev/null 2>&1 && ok "typst init @preview/$1 $2" || bad "typst init @preview/$1"
done
(cd mau-bao-cao-doanh-nghiep && /usr/local/lib/synchro-doc/typst-0.12.0 compile main.typ ../stock-br.pdf >/dev/null 2>&1) && ok "mẫu gốc basic-report biên dịch bằng Typst 0.12.0" || bad "mẫu gốc basic-report với Typst 0.12.0"
# Giữ hai trình biên dịch: basic-report 0.1.0 lỗi trên Typst mới. Nếu chỗ này "đạt" thì gói hay Typst đã đổi, xem lại trước khi gộp.
(cd mau-bao-cao-doanh-nghiep && typst compile main.typ ../stock-br15.pdf >/dev/null 2>&1) && bad "basic-report 0.1.0 lại biên dịch được trên Typst 0.15.1?" || ok "basic-report 0.1.0 vẫn lỗi trên Typst 0.15.1 (đúng như đã biết)"
(cd mau-de-xuat-du-an && typst compile main.typ ../stock-ilm.pdf >/dev/null 2>&1) && ok "mẫu gốc ilm" || bad "mẫu gốc ilm"
(cd mau-bao-cao-2-cot && typst compile main.typ ../stock-ieee.pdf >/dev/null 2>&1) && ok "mẫu gốc charged-ieee" || bad "mẫu gốc charged-ieee"

echo "== synchro-doc với payload tiếng Việt"
python3 -c '
from PIL import Image, ImageDraw
im = Image.new("RGB", (640, 320), (20, 70, 160)); ImageDraw.Draw(im).rectangle([80, 80, 560, 240], fill=(250, 200, 40)); im.save("inputs/hinh.webp")'
check() { # check <pdf> <phông cần có> <chữ cần có…>
  local pdf=$1 font=$2; shift 2
  local fonts text
  fonts=$(pdffonts "$pdf" 2>/dev/null); text=$(pdftotext -layout "$pdf" - 2>/dev/null)
  echo "$fonts" | grep -q "$font" && ok "$(basename "$pdf"): có phông $font" || bad "$(basename "$pdf"): thiếu phông $font"
  for s in "$@"; do grep -qF -- "$s" <<<"$text" && ok "$(basename "$pdf"): chữ \"$s\"" || bad "$(basename "$pdf"): không thấy \"$s\""; done
}
timed() { # timed <tên> <lệnh…>: chạy, kiểm mã thoát 0 và dưới 5 giây
  local name=$1; shift
  local t0=$(date +%s.%N)
  "$@" >"$W/$name.out" 2>"$W/$name.err" || { bad "$name thoát mã $? $(head -c 600 "$W/$name.err")"; return; }
  local s=$(echo "$(date +%s.%N) - $t0" | bc)
  [ "$(echo "$s < 5" | bc)" = 1 ] && ok "$name xong trong ${s:0:4} giây" || bad "$name chậm: ${s:0:4} giây"
}
for t in basic-report ilm charged-ieee invoice; do synchro-doc example $t > $t.json || bad "example $t"; done
python3 - <<'EOF'
import json
d = json.load(open("basic-report.json"))
d["sections"][1]["blocks"].append({"type": "image", "path": "inputs/hinh.webp", "width": 40, "caption": "Ảnh WebP đổi sang PNG"})
d["sections"][1]["blocks"].append({"type": "table", "caption": "Bảng dài", "columns": ["Hạng mục", "Giá trị"], "rows": [[f"Dòng {i} ư ơ ệ ẫ", f"{i * 1000:,}".replace(",", ".")] for i in range(1, 70)]})
json.dump(d, open("basic-report.json", "w"), ensure_ascii=False)
EOF
timed basic-report synchro-doc typst basic-report basic-report.json outputs/basic-report.pdf --png outputs/_preview
timed ilm synchro-doc typst ilm ilm.json outputs/ilm.pdf --png outputs/_preview
timed charged-ieee synchro-doc typst charged-ieee charged-ieee.json outputs/charged-ieee.pdf --png outputs/_preview
timed invoice synchro-doc invoice invoice.json outputs/invoice.pdf --png outputs/_preview
python3 - <<'EOF'
import json
d = json.load(open("invoice.json"))
d["number"] = "HĐ-DÀI"
d["items"] = [{"description": f"Hạng mục số {i} — thiết kế, lập trình ư ơ ệ ẫ", "quantity": i % 4 + 1, "unit_price": 125000 * i} for i in range(1, 37)]
d["discount"] = 500000
d["footer"] = 'lienhe@vd.vn "</style><b>x</b>'
json.dump(d, open("invoice-long.json", "w"), ensure_ascii=False)
EOF
timed invoice-long synchro-doc invoice invoice-long.json outputs/invoice-long.pdf --png outputs/_preview
check outputs/basic-report.pdf Vollkorn "Báo cáo kết quả kinh" "Kế hoạch quý IV" "₫" "Mục lục" "11/11/2026" "Dòng 69 ư ơ ệ ẫ"
check outputs/basic-report.pdf BeVietnamPro "Số liệu chính"
check outputs/ilm.pdf LibertinusSerif "Ngày 11 tháng 11 năm 2026" "Lộ trình triển khai" "Mục lục"
check outputs/charged-ieee.pdf TeXGyreTermes "Tóm tắt" "Từ khóa" "dấu thanh" "BẢNG"
# Tiêu đề Pacifico có kerning nên pdftotext tách "H óa đơn"; WeasyPrint đặt tên phông theo @font-face ("Source-Sans-Pro").
check outputs/invoice.pdf Pacifico "óa đơn" "38.340.000 ₫" "Lập trình và tích hợp"
check outputs/invoice.pdf Source-Sans "Thuế GTGT 8%" "Cảm ơn quý khách!"
check outputs/invoice-long.pdf Pacifico "Hạng mục số 36" '"</style><b>x</b>'
grep -q '"layout": "long"' "$W/invoice-long.out" && ok "hóa đơn 36 dòng dùng bố cục nhiều trang" || bad "hóa đơn dài không chuyển bố cục"
n=$(pdfinfo outputs/basic-report.pdf | awk '/^Pages/{print $2}'); [ "${n:-0}" -ge 5 ] && ok "basic-report $n trang (bìa, mục lục, bảng dài ngắt trang)" || bad "basic-report chỉ $n trang"
ls outputs/_preview/basic-report-1.png outputs/_preview/invoice-1.png >/dev/null 2>&1 && ok "ảnh xem trước trang 1" || bad "thiếu ảnh xem trước"
ls -a | grep -q '^\.synchro-doc-' && bad "còn thư mục tạm .synchro-doc-*" || ok "đã dọn thư mục tạm"

echo "== Word (.docx, thư viện docx) cùng payload"
for t in basic-report ilm charged-ieee; do
  timed docx-$t synchro-doc docx $t $t.json outputs/$t.docx
done
if soffice --headless --convert-to pdf --outdir outputs/docx-pdf outputs/basic-report.docx outputs/ilm.docx outputs/charged-ieee.docx >/dev/null 2>&1; then
  check outputs/docx-pdf/basic-report.pdf Caladea "Báo cáo kết quả kinh" "Kế hoạch quý IV" "Mục lục"
  check outputs/docx-pdf/ilm.pdf Caladea "Ngày 11 tháng 11 năm 2026" "Lộ trình triển khai"
  check outputs/docx-pdf/charged-ieee.pdf "Liberation\|Times" "Tóm tắt" "dấu thanh"
else
  bad "LibreOffice không mở được bản .docx"
fi

echo "== payload sai: mã thoát 2, không chạm tệp ngoài thư mục làm việc"
echo '{"title":"x","sections":[{"blocks":[{"type":"image","path":"/etc/passwd"}]}]}' > bad1.json
echo '{"title":"x","sections":[{"blocks":[{"type":"image","path":"../../etc/hostname"}]}]}' > bad2.json
echo '{"title":"x","sections":[{"blocks":[{"type":"tabel"}]}]}' > bad3.json
for f in bad1 bad2 bad3; do synchro-doc typst ilm $f.json outputs/$f.pdf >/dev/null 2>&1; c=$?; [ $c = 2 ] && ok "$f.json bị từ chối (mã 2)" || bad "$f.json thoát mã $c"; done

if [ -n "$KEEP" ]; then mkdir -p "$KEEP" && cp -r outputs/. stock-*.pdf "$KEEP"/ 2>/dev/null; fi
[ $fail = 0 ] && echo "synchro-doc selftest: đạt" || echo "synchro-doc selftest: CÓ LỖI"
exit $fail
