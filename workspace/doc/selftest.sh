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

echo "== bố cục khó: ghi chú khuất dưới bảng tổng, bảng nhiều cột, chữ trùng nhãn của gói, tiền làm tròn, payload số / ngày sai"
python3 - <<'EOF'
import json
inv = json.load(open("invoice.json"))
items = (inv["items"] * 2)[:4]
json.dump({**inv, "number": "HĐ-GHICHU", "items": items, "notes": "\n".join(f"Ghi chú dòng {i}" for i in range(5))}, open("inv-notes.json", "w"), ensure_ascii=False)
json.dump({**inv, "number": "R-1", "lang": "en", "currency": "EUR", "items": [{"description": "Rounding", "quantity": 2.5, "unit_price": 1999.995}], "tax_rate": 0}, open("inv-eur.json", "w"), ensure_ascii=False)
json.dump({**inv, "number": "R-2", "lang": "vi", "currency": "USD", "items": [{"description": "Làm tròn", "quantity": 1.5, "unit_price": 1234.567}], "tax_rate": 0.1}, open("inv-usd.json", "w"), ensure_ascii=False)
rows7 = [["Miền Bắc (Hà Nội, Hải Phòng)", "2.100.000", "2.250.000", "2.400.000", "6.750.000", "6.100.000", "+10,7%"],
         ["Miền Trung (Đà Nẵng, Huế, Quảng Nam)", "1.250.000", "1.300.000", "1.420.000", "3.970.000", "3.500.000", "+13,4%"],
         ["Miền Nam (TP. Hồ Chí Minh, Cần Thơ)", "3.400.000", "3.650.000", "3.900.000", "10.950.000", "9.800.000", "+11,7%"]]
t7 = {"type": "table", "caption": "Doanh thu quý III theo khu vực", "columns": ["Khu vực bán hàng", "Tháng 7", "Tháng 8", "Tháng 9", "Cộng quý III", "Cùng kỳ năm trước", "Tăng trưởng"], "rows": rows7}
t6 = {"type": "table", "caption": "Kết quả nhận dạng", "columns": ["Mô hình", "Tham số", "WER tập kiểm tra", "CER tập kiểm tra", "Tốc độ", "Ghi chú"],
      "rows": [["Transformer", "9,1 triệu", "12,4%", "4,1%", "1,2×", "cơ sở"], ["Conformer-Large", "118 triệu", "8,7%", "2,9%", "0,8×", "tốt nhất"]]}
t12 = {"type": "table", "columns": [f"Cột {i}" for i in range(12)], "rows": [[f"Giá trị {i}" for i in range(12)]]}
trap = "Abstraction layer và TABLE_NAME trong SQL; Fig.ure xem Fig. 2. Inhalt của gói."
for t in ("basic-report", "ilm", "charged-ieee"):
    d = json.load(open(f"{t}.json"))
    d["sections"] = [{"heading": "Bảng nhiều cột", "blocks": [{"type": "paragraph", "text": trap}, t7, t6, t12]}]
    d["lang"] = "vi"
    json.dump(d, open(f"{t}-hard.json", "w"), ensure_ascii=False)
EOF
synchro-doc invoice inv-notes.json outputs/inv-notes.pdf >"$W/inv-notes.out" 2>&1 || bad "inv-notes thoát mã $?"
python3 - "$W/inv-notes.out" <<'EOF' && ok "hóa đơn 4 dòng + ghi chú 5 dòng: không dòng nào khuất dưới bảng tổng" || bad "ghi chú nằm khuất dưới bảng tổng"
import json, re, subprocess, sys
res = json.load(open(sys.argv[1]))
if res["layout"] == "long":
    sys.exit(0)
xml = subprocess.run(["pdftotext", "-f", "1", "-l", "1", "-bbox", "outputs/inv-notes.pdf", "-"], capture_output=True, text=True).stdout
words = [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', xml)]
# Đỉnh vùng xám của bảng tổng: tiêu đề "HẠN THANH TOÁN" trừ viền trên 2 cm (56,7 pt).
head = min(y0 for x0, y0, x1, y1, w in words if w.upper() == "HẠN")
notes = [y1 for x0, y0, x1, y1, w in words if w == "dòng"]
sys.exit(0 if len(notes) == 5 and max(notes) < head - 56 else 1)
EOF
for f in inv-eur inv-usd; do synchro-doc invoice $f.json outputs/$f.pdf >/dev/null 2>&1 || bad "$f thoát mã $?"; done
check outputs/inv-eur.pdf Source-Sans "€2,000.00" "€5,000.00"
check outputs/inv-usd.pdf Source-Sans "1.234,57 US$" "1.851,86 US$" "1,5"
for t in basic-report ilm charged-ieee; do
  synchro-doc typst $t $t-hard.json outputs/$t-hard.pdf >"$W/$t-hard.out" 2>"$W/$t-hard.err" || bad "$t-hard thoát mã $? $(head -c 400 "$W/$t-hard.err")"
  # Không có hai chữ nào đè lên nhau (chữ của ô tràn sang ô bên cạnh).
  python3 - outputs/$t-hard.pdf <<'EOF' && ok "$t: bảng 6, 7, 12 cột không có chữ đè nhau" || bad "$t: bảng nhiều cột có chữ đè nhau"
import re, subprocess, sys
xml = subprocess.run(["pdftotext", "-bbox", sys.argv[1], "-"], capture_output=True, text=True).stdout
hits = []
for page in xml.split("<page ")[1:]:
    ws = [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', page)]
    for i, p in enumerate(ws):
        for q in ws[i + 1:]:
            # Cùng một dòng (đỉnh chữ lệch dưới 2 pt) mà chồng nhau theo chiều ngang: dấu tiếng Việt làm khung chữ của hai dòng sát nhau chồng
            # theo chiều dọc, đó không phải lỗi.
            if abs(p[1] - q[1]) < 2 and min(p[2], q[2]) - max(p[0], q[0]) > 0.8:
                hits.append((p[4], q[4]))
if hits:
    print("    chữ đè nhau:", hits[:6], file=sys.stderr)
sys.exit(1 if hits else 0)
EOF
done
check outputs/charged-ieee-hard.pdf TeXGyreTermes "Abstraction layer" "TABLE_NAME" "Fig.ure" "Tóm tắt" "BẢNG"
check outputs/basic-report-hard.pdf Vollkorn "Inhalt của gói" "Mục lục"
for s in "Tóm tắtion" "BẢNG_NAME" "Hìnhure" "Mục lục của gói"; do
  { pdftotext outputs/charged-ieee-hard.pdf -; pdftotext outputs/basic-report-hard.pdf -; } 2>/dev/null | grep -qF "$s" && bad "chữ của người dùng bị luật dịch nhãn đổi thành \"$s\"" || ok "chữ của người dùng không bị đổi thành \"$s\""
done
echo '{"title":"x","date":"2026-11-12","date_format":"DD/MM/YYYY","sections":[{"text":"a"}]}' > bad-date1.json
echo '{"title":"x","date":"2026-11-12","date_format":"Ngày [ngay] tháng","sections":[{"text":"a"}]}' > bad-date2.json
echo '{"title":"x","date":"2026-11-12","date_format":"[day","sections":[{"text":"a"}]}' > bad-date3.json
echo '{"number":"1","date":"2026-11-12","from":{"name":"A"},"to":{"name":"B"},"items":[{"description":"x","quantity":NaN,"unit_price":1}]}' > bad-nan.json
for f in bad-date1 bad-date2 bad-date3; do synchro-doc typst ilm $f.json outputs/$f.pdf >/dev/null 2>&1; c=$?; [ $c = 2 ] && ok "$f.json bị từ chối (mã 2)" || bad "$f.json thoát mã $c"; done
synchro-doc invoice bad-nan.json outputs/bad-nan.pdf >/dev/null 2>"$W/nan.err"; c=$?; { [ $c = 2 ] && ! grep -q Traceback "$W/nan.err"; } && ok "số NaN bị từ chối (mã 2)" || bad "NaN thoát mã $c"

echo "== payload sai: mã thoát 2, không chạm tệp ngoài thư mục làm việc"
echo '{"title":"x","sections":[{"blocks":[{"type":"image","path":"/etc/passwd"}]}]}' > bad1.json
echo '{"title":"x","sections":[{"blocks":[{"type":"image","path":"../../etc/hostname"}]}]}' > bad2.json
echo '{"title":"x","sections":[{"blocks":[{"type":"tabel"}]}]}' > bad3.json
for f in bad1 bad2 bad3; do synchro-doc typst ilm $f.json outputs/$f.pdf >/dev/null 2>&1; c=$?; [ $c = 2 ] && ok "$f.json bị từ chối (mã 2)" || bad "$f.json thoát mã $c"; done

if [ -n "$KEEP" ]; then mkdir -p "$KEEP" && cp -r outputs/. stock-*.pdf "$KEEP"/ 2>/dev/null; fi
[ $fail = 0 ] && echo "synchro-doc selftest: đạt" || echo "synchro-doc selftest: CÓ LỖI"
exit $fail
