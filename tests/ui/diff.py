# So ảnh chụp hai lần (tests/ui/snapshots.mjs): in tỉ lệ điểm ảnh khác nhau của từng màn hình và lưu ảnh tô đỏ chỗ khác.
# Dùng: python3 tests/ui/diff.py <thư mục trước> <thư mục sau> [ngưỡng %, mặc định 0.05]
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
limit = float(sys.argv[3]) if len(sys.argv) > 3 else 0.05
bad = 0
worst = (0.0, "")
for f in sorted(os.listdir(a)):
    if not f.endswith(".png") or f.startswith("diff-") or not os.path.exists(os.path.join(b, f)): continue
    x, y = Image.open(os.path.join(a, f)).convert("RGB"), Image.open(os.path.join(b, f)).convert("RGB")
    if x.size != y.size: print(f"{f}: khác kích thước {x.size} / {y.size}"); bad += 1; continue
    d = ImageChops.difference(x, y).convert("L").point(lambda v: 255 if v > 24 else 0)
    n = sum(1 for v in d.getdata() if v)
    pct = 100 * n / (x.size[0] * x.size[1])
    print(f"{f}: {pct:.3f}% điểm ảnh khác")
    worst = max(worst, (pct, f))
    if n:
        bad += pct > limit
        red = Image.new("RGB", x.size, (255, 0, 0))
        Image.composite(red, y, d).save(os.path.join(b, "diff-" + f))
print(f"Lệch nhất: {worst[1] or '-'} {worst[0]:.3f}%; {bad} màn vượt ngưỡng {limit}%")
sys.exit(1 if bad else 0)
