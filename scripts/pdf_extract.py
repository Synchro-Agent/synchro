"""Trích PDF: text từng trang (pdfplumber) + render trang thành ảnh JPEG (pypdfium2).
Dùng: python pdf_extract.py <file.pdf> <maxPages> <scale>  ->  JSON ra stdout."""
import sys, json, io, base64
import pdfplumber
import pypdfium2 as pdfium

path, max_pages, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
texts = []
with pdfplumber.open(path) as pdf:
    total = len(pdf.pages)
    for pg in pdf.pages[:max_pages]:
        try:
            texts.append(pg.extract_text() or "")
        except Exception:
            texts.append("")
imgs = []
doc = pdfium.PdfDocument(path)
for i in range(min(total, max_pages)):
    im = doc[i].render(scale=scale).to_pil().convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72)
    imgs.append(base64.b64encode(buf.getvalue()).decode())
print(json.dumps({"total": total, "texts": texts, "images": imgs}))
