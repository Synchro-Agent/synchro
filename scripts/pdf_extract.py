"""Trích PDF: text từng trang (pdfplumber) + render trang thành ảnh JPEG (pypdfium2).
Dùng: python pdf_extract.py <file.pdf> <maxPages> <scale> <textPages> <imgDir>  ->  JSON ra stdout.
maxPages: số trang render ảnh; textPages: số trang lấy chữ (mặc định bằng maxPages); imgDir: thư mục ghi ảnh trang (page_<i>.jpg),
stdout chỉ trả tên tệp ảnh — KHÔNG nhét base64 vào ống, để ống luôn nhỏ (ảnh nặng ghi ra đĩa tạm, phía gọi đọc lại rồi xoá).
Tệp hỏng hoặc có mật khẩu: {"bad": "lý do"}, không phải lỗi của máy chủ."""
import sys, os, json, resource

# Trần bộ nhớ (địa chỉ ảo) cho tiến trình đọc tệp: PDF độc hại / khổng lồ chỉ làm chết tiến trình này, không ngốn hết RAM máy chủ web.
# Mặc định rộng rãi để PDF bình thường không hỏng; chỉnh bằng PDF_RLIMIT_MB. Hệ không hỗ trợ (Windows) hoặc đặt lỗi thì bỏ qua.
try:
    _mb = int(os.environ.get("PDF_RLIMIT_MB", "3072"))
    if _mb > 0:
        _lim = _mb * 1024 * 1024
        _soft, _hard = resource.getrlimit(resource.RLIMIT_AS)
        _cap = _lim if _hard in (resource.RLIM_INFINITY, -1) else min(_lim, _hard)
        resource.setrlimit(resource.RLIMIT_AS, (_cap, _hard))
except Exception:
    pass

import io
import pdfplumber
import pypdfium2 as pdfium

path, max_pages, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
text_pages = int(sys.argv[4]) if len(sys.argv) > 4 else max_pages
img_dir = sys.argv[5] if len(sys.argv) > 5 else None
texts = []
total = None
why = ""
try:
    with pdfplumber.open(path) as pdf:
        total = len(pdf.pages)
        for pg in pdf.pages[:text_pages]:
            try:
                texts.append(pg.extract_text() or "")
            except Exception:
                texts.append("")
except Exception as e:
    why = str(e) or type(e).__name__
imgs = []
try:
    doc = pdfium.PdfDocument(path)
    if total is None:
        total = len(doc)
    for i in range(min(total, max_pages)):
        im = doc[i].render(scale=scale).to_pil().convert("RGB")
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=72)
        data = buf.getvalue()
        if img_dir:
            name = "page_%d.jpg" % i
            with open(os.path.join(img_dir, name), "wb") as f:
                f.write(data)
            imgs.append(name)
        else:
            import base64
            imgs.append(base64.b64encode(data).decode())
except Exception as e:
    why = why or str(e) or type(e).__name__
if not total:
    print(json.dumps({"bad": why[:200] or "không có trang nào"}))
    sys.exit(0)
print(json.dumps({"total": total, "texts": texts, "images": imgs}))
