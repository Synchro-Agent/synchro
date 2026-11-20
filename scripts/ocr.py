import sys
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()

def lines(img):
    res, _ = ocr(np.array(img.convert("RGB")))
    out = []
    for box, text, _ in res or []:
        ys = [p[1] for p in box]
        out.append((sum(ys) / 4, min(p[0] for p in box), max(ys) - min(ys), text))
    out.sort(key=lambda t: (round(t[0] / 8), t[1]))
    return out

def para(ls):
    txt, prev = [], None
    for y, _, h, t in ls:
        if prev is not None and y - prev > h * 2.2:
            txt.append("")
        txt.append(t)
        prev = y
    return "\n".join(txt)

if sys.argv[1] == "--each":
    # Mỗi ảnh trang một dòng JSON, in ngay khi xong: máy chủ dừng tiến trình ở trần thời gian của cả tệp và vẫn giữ
    # được các trang đã xong (server/fileproc/extractors.ts ocrPages).
    import json
    for p in sys.argv[2:]:
        print(json.dumps({"text": para(lines(Image.open(p)))}, ensure_ascii=False), flush=True)
    sys.exit(0)

path = sys.argv[1]
pages = []
if path.lower().endswith(".pdf"):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    for i in range(len(pdf)):
        pages.append(para(lines(pdf[i].render(scale=2).to_pil())))
else:
    pages.append(para(lines(Image.open(path))))
print("\n\n---\n\n".join(f"## Trang {i + 1}\n\n{p}" if len(pages) > 1 else p for i, p in enumerate(pages)))
