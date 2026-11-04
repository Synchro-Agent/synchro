"""Trích PDF: text từng trang (pdfplumber) + render trang thành ảnh JPEG (pypdfium2).
Dùng: python pdf_extract.py <file.pdf> <maxPages> <scale> [textPages]  ->  JSON ra stdout.
maxPages: số trang render ảnh; textPages: số trang lấy chữ (mặc định bằng maxPages). Tệp hỏng hoặc có mật khẩu: {"bad": "lý do"}, không phải lỗi của máy chủ."""
import sys, json, io, base64
import pdfplumber
import pypdfium2 as pdfium

path, max_pages, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
text_pages = int(sys.argv[4]) if len(sys.argv) > 4 else max_pages
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
        imgs.append(base64.b64encode(buf.getvalue()).decode())
except Exception as e:
    why = why or str(e) or type(e).__name__
if not total:
    print(json.dumps({"bad": why[:200] or "không có trang nào"}))
    sys.exit(0)
print(json.dumps({"total": total, "texts": texts, "images": imgs}))
