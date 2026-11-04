#!/usr/bin/env python3
# Phụ đề đúng cỡ theo độ phân giải: đọc .srt / .vtt (edge-tts --write-subtitles, thư viện srt) → .ass có PlayRes bằng đúng kích thước video, rồi đốt bằng
# ffmpeg -vf ass=phu-de.ass. Vì sao: ffmpeg dựng .srt trong khung 288 điểm nên FontSize=22 ra ~82 px ở 1080p và ~147 px ở video dọc 1920, che gần hết hình.
# Câu dài (edge-tts ghi cả câu vào một cue) được chia thành nhiều cue, mỗi cue tối đa 2 dòng, mỗi dòng tối đa 42 ký tự (video dọc ngắn hơn cho vừa khung).
# Dùng: subfit.py vao.srt ra.ass 1920x1080 [--font "Noto Sans"]. Chỉ dùng thư viện chuẩn.
import re, sys

TIME = re.compile(r'(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})')
MAX_LINE = 42
MIN_CUE = 0.8


def secs(h, m, s, ms):
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def parse(text):
    cues, cur = [], None
    for line in text.replace("﻿", "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        m = TIME.search(line)
        if m:
            g = m.groups()
            cur = [secs(*g[:4]), secs(*g[4:]), []]
            cues.append(cur)
        elif not line.strip():
            cur = None
        elif cur is not None:
            cur[2].append(re.sub(r'<[^>]+>', '', line).strip())
    return [(a, b, " ".join(x for x in t if x)) for a, b, t in cues if " ".join(t).strip()]


def wrap(text, limit):
    """Chia chữ thành các dòng ≤ limit ký tự, ngắt ở khoảng trắng (từ quá dài thì cắt cứng)."""
    lines, cur = [], ""
    for w in text.split():
        while len(w) > limit:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:limit])
            w = w[limit:]
        if cur and len(cur) + 1 + len(w) > limit:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(cur)
    return lines


def split_cue(start, end, text, limit):
    """Một cue → nhiều cue tối đa 2 dòng; thời lượng chia theo số ký tự để chữ khớp giọng đọc."""
    lines = wrap(text, limit)
    parts = [lines[i:i + 2] for i in range(0, len(lines), 2)]
    total = sum(len(x) for p in parts for x in p) or 1
    out, t = [], start
    for i, p in enumerate(parts):
        d = (end - start) * sum(len(x) for x in p) / total
        nxt = end if i == len(parts) - 1 else t + d
        out.append((t, nxt, p))
        t = nxt
    return out


def stamp(s):
    cs = int(round(max(s, 0) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def layout(w, h):
    """Cỡ chữ, viền, lề theo kích thước thật (px). Video dọc chừa lề dưới lớn: các nền tảng đặt nút và chú thích ở đó."""
    vertical = h > w
    font = round((w if vertical else h) * (0.043 if vertical else 0.042))
    avail = w * 0.88
    limit = min(MAX_LINE, int(avail / (font * 0.52)))
    return {"font": font, "outline": max(1, round(font / 15)), "margin_x": round(w * 0.06), "margin_v": round(h * (0.14 if vertical else 0.06)), "limit": limit}


def to_ass(cues, w, h, font_name="Noto Sans"):
    L = layout(w, h)
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{L['font']},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,{L['outline']},0,2,{L['margin_x']},{L['margin_x']},{L['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    rows = []
    for a, b, t in cues:
        # Cue quá ngắn so với số dòng thì giữ nguyên thời gian gốc: chữ hiện nhanh còn hơn lệch giọng đọc.
        for s, e, lines in split_cue(a, b, t, L["limit"]):
            text = "\\N".join(lines).replace("{", "(").replace("}", ")")
            rows.append(f"Dialogue: 0,{stamp(s)},{stamp(e)},Default,,0,0,0,,{text}")
    return head + "\n".join(rows) + "\n"


def main(argv):
    font = "Noto Sans"
    if "--font" in argv:
        i = argv.index("--font")
        font = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    m = re.fullmatch(r'(\d{2,5})[x×:](\d{2,5})', argv[2]) if len(argv) == 3 else None
    if not m:
        print("Dùng: subfit.py vao.srt ra.ass 1920x1080 [--font \"Noto Sans\"]", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8", errors="replace") as f:
        cues = parse(f.read())
    if not cues:
        print(f"Không đọc được cue nào trong {argv[0]}", file=sys.stderr)
        return 1
    with open(argv[1], "w", encoding="utf-8") as f:
        f.write(to_ass(cues, int(m.group(1)), int(m.group(2)), font))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
