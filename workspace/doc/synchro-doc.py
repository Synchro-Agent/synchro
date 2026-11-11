#!/usr/bin/env python3
"""synchro-doc: tài liệu PDF / Word từ payload JSON bằng mẫu dựng sẵn (model chỉ viết JSON, không viết Typst / HTML).

  synchro-doc list                                   các mẫu
  synchro-doc schema <mẫu>                           JSON Schema của mẫu
  synchro-doc example <mẫu> > payload.json           payload mẫu (tiếng Việt)
  synchro-doc check <mẫu> payload.json               chỉ kiểm payload
  synchro-doc typst <basic-report|ilm|charged-ieee> payload.json outputs/bao-cao.pdf [--png outputs/_preview] [--keep]
  synchro-doc invoice payload.json outputs/hoa-don.pdf [--png outputs/_preview] [--keep]
  synchro-doc docx <basic-report|ilm|charged-ieee> payload.json outputs/bao-cao.docx

Mẫu: basic-report (báo cáo doanh nghiệp: bìa, mục lục, số trang), ilm (đề xuất dự án / sách mỏng), charged-ieee (bài nghiên cứu 2 cột),
invoice (hóa đơn / báo giá A4). Ba mẫu Typst dùng chung một hợp đồng nội dung (sections / blocks), nên cùng payload xuất được cả .docx.
Đường dẫn ảnh trong payload là đường dẫn tương đối trong thư mục hiện tại. Mã thoát: 0 xong, 2 payload / tham số sai (đọc lỗi rồi sửa), 1 lỗi bộ dựng.
Chỉ dùng thư viện chuẩn của Python (+ WeasyPrint cho hóa đơn, Pillow nếu cần đổi định dạng ảnh); chạy được không cần mạng.
"""
import datetime as dt
import difflib
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext

KIT = os.environ.get("SYNCHRO_DOC_KIT") or os.path.dirname(os.path.realpath(__file__))
if not os.path.isdir(os.path.join(KIT, "schemas")):
    KIT = "/opt/synchro/doc"
TYPST_NEW = os.environ.get("SYNCHRO_TYPST", "typst")
TYPST_012 = os.environ.get("SYNCHRO_TYPST_012", "/usr/local/lib/synchro-doc/typst-0.12.0")
# Mẫu -> (gói Typst đúng phiên bản chủ dự án chọn, trình biên dịch). basic-report 0.1.0 và gói phụ thuộc hydra 0.5.1 / oxifmt 0.2.0
# lỗi biên dịch từ Typst 0.13 (outline.entry đổi API), nên mẫu này chạy bằng Typst 0.12.0 đặt riêng; đừng gộp về một trình biên dịch.
TYPST = {
    "basic-report": ("@preview/basic-report:0.1.0", TYPST_012),
    "ilm": ("@preview/ilm:1.4.0", TYPST_NEW),
    "charged-ieee": ("@preview/charged-ieee:0.1.3", TYPST_NEW),
}
TEMPLATES = list(TYPST) + ["invoice"]
FONT_DIRS = [d for d in os.environ.get("SYNCHRO_DOC_FONTS", "/usr/share/fonts:/usr/share/texmf/fonts/opentype/public/tex-gyre").split(":") if d]
PACKAGES = os.environ.get("TYPST_PACKAGE_PATH", "/opt/synchro/typst-packages")
IMG_DIRECT = {".png", ".jpg", ".jpeg", ".gif", ".svg"}
IMG_CONVERT = {".webp", ".bmp", ".tif", ".tiff", ".ico", ".jfif"}
PREVIEW_PAGES = 4


class Bad(Exception):
    """Payload hay tham số sai: mã thoát 2, thông báo cho model sửa."""


def die(msg, code=2):
    print(f"synchro-doc: {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------- schema và bộ kiểm (một phần JSON Schema, đủ cho các tệp schemas/*.json)
def _schema_file(tpl):
    return os.path.join(KIT, "schemas", "invoice.json" if tpl == "invoice" else "typst.json")


def schema_of(tpl):
    """JSON Schema đầy đủ của một mẫu: phần riêng + $defs chung."""
    if tpl not in TEMPLATES:
        raise Bad(f'không có mẫu "{tpl}" (có: {", ".join(TEMPLATES)})')
    with open(_schema_file(tpl), encoding="utf-8") as f:
        src = json.load(f)
    t = src["templates"][tpl]
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": t["title"], "type": "object",
            "required": t["required"], "additionalProperties": False, "properties": t["properties"], "$defs": src["$defs"]}


JTYPE = {"string": "chuỗi", "number": "số", "integer": "số nguyên", "boolean": "true/false", "object": "object", "array": "mảng", "null": "null"}


def _is(t, v):
    if t == "string":
        return isinstance(v, str)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool) or isinstance(v, float) and math.isfinite(v) and v.is_integer()
    if t == "boolean":
        return isinstance(v, bool)
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "null":
        return v is None
    return False


def _kind(v):
    for t in ("null", "boolean", "string", "array", "object"):
        if _is(t, v):
            return t
    return "number" if _is("number", v) else "số không hữu hạn (NaN / Infinity)"


def _ref(root, s):
    while "$ref" in s:
        node = root
        for part in s["$ref"].lstrip("#/").split("/"):
            node = node[part]
        extra = {k: v for k, v in s.items() if k not in ("$ref", "description")}
        s = {**node, **extra}
    return s


def validate(root, s, v, path="payload"):
    """Danh sách lỗi (chuỗi tiếng Việt, có đường dẫn tới chỗ sai)."""
    s = _ref(root, s)
    errs = []
    if "anyOf" in s:
        branches = [_ref(root, b) for b in s["anyOf"]]
        tried = []
        for b in branches:
            e = validate(root, b, v, path)
            if not e:
                return []
            tried.append((b, e))
        # Khối có "type": báo lỗi theo đúng loại khối đó, không liệt kê lỗi của mọi loại.
        if isinstance(v, dict) and "type" in v:
            consts = [(b, e) for b, e in tried if isinstance(b.get("properties", {}).get("type"), dict) and "const" in b["properties"]["type"]]
            if consts:
                hit = [e for b, e in consts if b["properties"]["type"]["const"] == v["type"]]
                if hit:
                    return hit[0]
                names = [b["properties"]["type"]["const"] for b, _ in consts]
                near = difflib.get_close_matches(str(v["type"]), names, 1)
                return [f'{path}.type: "{v["type"]}" không có; dùng một trong: {", ".join(names)}' + (f' (có phải "{near[0]}"?)' if near else "")]
        same = [(b, e) for b, e in tried if b.get("type") == _kind(v) or (b.get("type") == "number" and _kind(v) == "number")]
        if same:
            return min(same, key=lambda x: len(x[1]))[1]
        kinds = []
        for b, _ in tried:
            k = JTYPE.get(b.get("type"), "") if b.get("type") else ""
            if k and k not in kinds:
                kinds.append(k)
        return [f"{path}: phải là {' hoặc '.join(kinds) or 'giá trị khác'}, đang là {JTYPE.get(_kind(v), _kind(v))}"]
    if "const" in s and v != s["const"]:
        return [f'{path}: phải là "{s["const"]}"']
    if "enum" in s and v not in s["enum"]:
        return [f'{path}: "{v}" không hợp lệ; dùng một trong: {", ".join(map(str, s["enum"]))}']
    t = s.get("type")
    if t and not _is(t, v):
        return [f"{path}: phải là {JTYPE.get(t, t)}, đang là {JTYPE.get(_kind(v), _kind(v))}"]
    if isinstance(v, str):
        if "minLength" in s and len(v.strip()) < s["minLength"]:
            errs.append(f"{path}: không được để trống")
        if "maxLength" in s and len(v) > s["maxLength"]:
            errs.append(f"{path}: dài {len(v)} ký tự, tối đa {s['maxLength']}")
        if "pattern" in s and not re.search(s["pattern"], v):
            errs.append(f'{path}: "{v[:60]}" sai dạng' + (" (cần YYYY-MM-DD)" if "\\d{4}" in s["pattern"] else " (cần http://, https:// hoặc mailto:)" if "https" in s["pattern"] else ""))
    if _is("number", v):
        if "minimum" in s and v < s["minimum"]:
            errs.append(f"{path}: phải ≥ {s['minimum']}")
        if "maximum" in s and v > s["maximum"]:
            errs.append(f"{path}: phải ≤ {s['maximum']}")
    if isinstance(v, list):
        if "minItems" in s and len(v) < s["minItems"]:
            errs.append(f"{path}: cần ít nhất {s['minItems']} phần tử")
        if "maxItems" in s and len(v) > s["maxItems"]:
            errs.append(f"{path}: có {len(v)} phần tử, tối đa {s['maxItems']}")
        if "items" in s:
            for i, x in enumerate(v):
                errs += validate(root, s["items"], x, f"{path}[{i}]")
                if len(errs) > 20:
                    break
    if isinstance(v, dict):
        props = s.get("properties", {})
        for k in s.get("required", []):
            if k not in v:
                errs.append(f'{path}: thiếu trường bắt buộc "{k}"')
        for k, x in v.items():
            if k in props:
                errs += validate(root, props[k], x, f"{path}.{k}")
            elif s.get("additionalProperties") is False:
                near = difflib.get_close_matches(k, list(props), 1)
                errs.append(f'{path}: không có trường "{k}"' + (f' (có phải "{near[0]}"?)' if near else f" (có: {', '.join(props)})"))
    return errs


# ---------------------------------------------------------------- đọc payload
# Tên trường theo mẫu main.typ trong tài liệu của chủ dự án (project.with(title, subtitle, authors, date), section.content):
# nhận và đổi sang tham số thật của gói để payload viết theo mẫu đó vẫn chạy.
def aliases(tpl, d):
    d = dict(d)
    notes = []
    if tpl == "basic-report":
        if "subtitle" in d and "category" not in d:
            d["category"] = d.pop("subtitle")
            notes.append('subtitle → category')
        if isinstance(d.get("authors"), list) and "author" not in d:
            names = [a if isinstance(a, str) else a.get("name", "") for a in d.pop("authors") if isinstance(a, (str, dict))]
            d["author"] = ", ".join(n for n in names if n)
            notes.append("authors → author")
    if tpl == "ilm" and isinstance(d.get("authors"), list) and "author" not in d:
        d["author"] = ", ".join(a if isinstance(a, str) else a.get("name", "") for a in d.pop("authors") if isinstance(a, (str, dict)))
        notes.append("authors → author")
    if tpl == "charged-ieee" and isinstance(d.get("author"), (str, dict)) and "authors" not in d:
        d["authors"] = [d.pop("author")]
        notes.append("author → authors")
    def fix_secs(secs):
        if isinstance(secs, list):
            for s in secs:
                if isinstance(s, dict) and "content" in s and "text" not in s and isinstance(s["content"], str):
                    s["text"] = s.pop("content")
                    if "section.content → text" not in notes:
                        notes.append("section.content → text")
    fix_secs(d.get("sections"))
    if isinstance(d.get("appendix"), dict):
        fix_secs(d["appendix"].get("sections"))
    return d, notes


def _no_nan(c):
    raise Bad(f"payload có {c}: không phải số hợp lệ, ghi số thật (vd. 0)")


# Ngày trên bìa ilm (datetime.display của Typst): chỉ thành phần của ngày, mỗi thành phần [tên tham số:giá trị …].
DATE_PARTS = {"day", "month", "year", "weekday", "week_number", "ordinal"}
DATE_MODS = {"padding", "repr", "case_sensitive", "one_indexed", "sign", "base"}
DATE_FMT_EG = "Ngày [day] tháng [month] năm [year]"


def check_date_format(f):
    """Lỗi (chuỗi) nếu date_format không dùng được với Typst, None nếu được."""
    if re.search(r"\[\[|\]\]", f):
        return 'không dùng "[[" hay "]]"'
    opened = re.sub(r"\[[^\[\]]*\]", "", f)
    if "[" in opened or "]" in opened:
        return "ngoặc vuông chưa đóng / mở đúng cặp"
    parts = re.findall(r"\[([^\[\]]*)\]", f)
    if not parts:
        return "không có thành phần ngày nào ([day], [month], [year]…), nên bìa sẽ in nguyên chữ"
    for p in parts:
        name, *mods = p.split()
        if name not in DATE_PARTS:
            return f'thành phần "[{p}]" không có; dùng {", ".join("[" + x + "]" for x in sorted(DATE_PARTS))}'
        for m in mods:
            k, _, v = m.partition(":")
            if k not in DATE_MODS or not re.fullmatch(r"[a-z_]+", v):
                return f'"{m}" trong "[{p}]" sai dạng (vd. [month repr:long], [day padding:none])'
    return None


def load_payload(tpl, p):
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f, parse_constant=_no_nan)
    except FileNotFoundError:
        raise Bad(f"không thấy tệp {p}")
    except ValueError as e:
        raise Bad(f"{p} không phải JSON hợp lệ: {e}")
    if not isinstance(d, dict):
        raise Bad("payload phải là một object JSON {…}")
    d, notes = aliases(tpl, d)
    sch = schema_of(tpl)
    errs = validate(sch, sch, d)
    for k in ("date", "due_date"):
        if isinstance(d.get(k), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d[k]):
            try:
                dt.date.fromisoformat(d[k])
            except ValueError:
                errs.append(f'payload.{k}: "{d[k]}" không phải ngày có thật')
    if tpl == "ilm" and isinstance(d.get("date_format"), str):
        why = check_date_format(d["date_format"])
        if why:
            errs.append(f'payload.date_format: {why}. Ví dụ: "{DATE_FMT_EG}"')
    if errs:
        more = f"\n  … và {len(errs) - 15} lỗi nữa" if len(errs) > 15 else ""
        raise Bad("payload sai (sửa rồi chạy lại; xem synchro-doc schema " + tpl + "):\n  " + "\n  ".join(errs[:15]) + more)
    return d, notes


# ---------------------------------------------------------------- chuẩn hóa nội dung (dùng chung cho Typst và Word)
INLINE_MD = re.compile(r"`([^`\n]+)`|\*\*(.+?)\*\*|\[([^\]\n]+)\]\(((?:https?://|mailto:)[^)\s]+)\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])")


def runs(x):
    """Inline (chuỗi có **đậm** *nghiêng* `mã` [chữ](url), hoặc mảng đoạn) -> [{text, bold?, italic?, code?, link?}]."""
    if x is None:
        return []
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        return [{"text": str(x)}]
    if isinstance(x, str):
        out, pos = [], 0
        for m in INLINE_MD.finditer(x):
            if m.start() > pos:
                out.append({"text": x[pos:m.start()]})
            if m.group(1) is not None:
                out.append({"text": m.group(1), "code": True})
            elif m.group(2) is not None:
                out.append({"text": m.group(2), "bold": True})
            elif m.group(3) is not None:
                out.append({"text": m.group(3), "link": m.group(4)})
            else:
                out.append({"text": m.group(5), "italic": True})
            pos = m.end()
        if pos < len(x):
            out.append({"text": x[pos:]})
        return [r for r in out if r["text"]]
    out = []
    for r in x:
        if isinstance(r, str):
            out += runs(r)
        elif isinstance(r, dict) and r.get("text"):
            out.append({k: r[k] for k in ("text", "bold", "italic", "code", "link") if r.get(k)})
    return out


def plain(rs):
    return "".join(r["text"] for r in rs)


NUM_CELL = re.compile(r"[+\-−–(]?\s*[$€£]?\s*\d[\d.,\u00a0\u202f ]*\s*(%|₫|đ|x|tr|tỷ|triệu|nghìn|k|usd|vnd|eur)?\.?\)?", re.I)


def fmt_number(v, lang):
    """Số trong ô bảng: 1234.5 -> 1.234,5 (vi) / 1,234.5 (en)."""
    if isinstance(v, int) or float(v).is_integer():
        s = f"{int(v):,}"
    else:
        s = f"{v:,.2f}".rstrip("0").rstrip(".")
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".") if lang == "vi" else s


def text_blocks(text):
    """Văn bản thuần của section.text -> khối: đoạn cách nhau bằng dòng trống, "- " gạch đầu dòng, "1. " danh sách số."""
    out = []
    for chunk in re.split(r"\n[ \t]*\n", text.strip()):
        lines = [l.strip() for l in chunk.strip().split("\n") if l.strip()]
        if not lines:
            continue
        if all(re.match(r"[-*•]\s+", l) for l in lines):
            out.append({"type": "bullets", "items": [re.sub(r"^[-*•]\s+", "", l) for l in lines]})
        elif all(re.match(r"\d{1,3}[.)]\s+", l) for l in lines):
            out.append({"type": "numbered", "items": [re.sub(r"^\d{1,3}[.)]\s+", "", l) for l in lines]})
        else:
            out.append({"type": "paragraph", "text": "\n".join(lines)})
    return out


class Ctx:
    def __init__(self, root, tmp, lang, target, tpl=None):
        self.root, self.tmp, self.lang, self.target, self.tpl = root, tmp, lang, target, tpl
        self.n = 0


# Số ký tự (cỡ chữ của bảng) vừa một dòng của khổ chữ mỗi mẫu Typst: bài 2 cột IEEE hẹp hơn nhiều.
LINE_CHARS = {"charged-ieee": 48, "basic-report": 85, "ilm": 80}


def table_widths(columns, rows, tpl):
    """Cột của bảng Typst không ghi widths: None = cột đầu 1fr, các cột khác vừa nội dung (bảng ít cột, vừa khổ chữ);
    "auto" = mọi cột vừa nội dung. Cột 1fr chỉ lấy phần còn lại sau các cột auto, nên khi các cột nội dung đã chiếm hết khổ chữ (bảng 6–12 cột),
    cột đầu co còn hẹp hơn một từ và chữ đè sang cột bên cạnh. Khi đó để Typst đo thật mọi cột rồi chia khổ chữ công bằng: cột chữ dài
    (nhãn, tiêu đề cột dài) xuống dòng, cột số giữ đủ bề rộng."""
    n = len(columns)
    if n < 2:
        return None
    cols = [[plain(columns[j])] + [plain(r[j]) for r in rows] for j in range(n)]
    longest = [max((len(w) for t in c for w in t.split()), default=1) for c in cols]
    natural = [max((max((len(l) for l in t.split("\n")), default=0) for t in c), default=0) for c in cols]
    # 2 ký tự mỗi cột cho lề ô; chừa 20% vì tiêu đề cột in đậm / chữ hoa nhỏ rộng hơn chữ thường.
    if sum(natural[1:]) + 2 * (n - 1) + max(longest[0], 12) <= 0.8 * LINE_CHARS.get(tpl, 80):
        return None
    return "auto"


def inside(root, p):
    """Đường dẫn tương đối trong thư mục làm việc -> đường dẫn tuyệt đối thật; ra ngoài (.., /, liên kết) thì lỗi."""
    if not isinstance(p, str) or not p.strip() or "\x00" in p:
        raise Bad(f"đường dẫn rỗng hoặc sai: {p!r}")
    a = os.path.realpath(os.path.join(root, p))
    if os.path.isabs(p) or not (a == root or a.startswith(root + os.sep)):
        raise Bad(f"đường dẫn nằm ngoài thư mục làm việc: {p} (dùng đường dẫn tương đối như inputs/anh.png)")
    if not os.path.isfile(a):
        raise Bad(f"không thấy tệp: {p}")
    return a


def image(ctx, p):
    """Ảnh của payload -> {path (tương đối với thư mục làm việc), px:[w,h]}; WebP / BMP / TIFF (và SVG khi xuất Word) đổi sang PNG trong thư mục tạm."""
    a = inside(ctx.root, p)
    ext = os.path.splitext(a)[1].lower()
    if ext not in IMG_DIRECT | IMG_CONVERT:
        raise Bad(f"{p}: định dạng ảnh không hỗ trợ (dùng PNG, JPEG, GIF, SVG, WebP, BMP, TIFF)")
    need = ext in IMG_CONVERT or (ctx.target == "docx" and ext in (".svg", ".gif"))
    px = None
    if need:
        ctx.n += 1
        out = os.path.join(ctx.tmp, f"img-{ctx.n}.png")
        if ext == ".svg":
            r = subprocess.run(["rsvg-convert", "-w", "1600", "-o", out, a], capture_output=True)
            if r.returncode:
                raise Bad(f"{p}: không đọc được SVG")
        else:
            try:
                from PIL import Image
                with Image.open(a) as im:
                    im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(out, "PNG")
            except Exception as e:  # noqa: BLE001
                raise Bad(f"{p}: không đọc được ảnh ({e})")
        a = out
    if ctx.target == "docx" or need:
        try:
            from PIL import Image
            with Image.open(a) as im:
                px = list(im.size)
        except Exception:  # noqa: BLE001
            if ctx.target == "docx":
                raise Bad(f"{p}: không đọc được kích thước ảnh")
    return {"path": os.path.relpath(a, ctx.root), "px": px}


def norm_block(ctx, b, where):
    t = b["type"]
    if t == "paragraph":
        return {"type": t, "text": runs(b["text"])}
    if t == "heading":
        return {"type": t, "level": int(b.get("level", 2)), "text": runs(b["text"])}
    if t in ("bullets", "numbered"):
        return {"type": t, "items": [runs(i) for i in b["items"]]}
    if t == "table":
        n = len(b["columns"])
        rows = []
        for i, r in enumerate(b["rows"]):
            if len(r) > n:
                raise Bad(f"{where}.rows[{i}]: có {len(r)} ô nhưng columns chỉ có {n} cột")
            rows.append([fmt_number(c, ctx.lang) if isinstance(c, (int, float)) and not isinstance(c, bool) else ("" if c is None else c) for c in r] + [""] * (n - len(r)))
        cells = [[runs(c) for c in r] for r in rows]
        align = b.get("align")
        if align and len(align) != n:
            raise Bad(f"{where}.align: cần đúng {n} giá trị (một cho mỗi cột)")
        if not align:
            align = []
            for j in range(n):
                vals = [plain(r[j]).strip() for r in cells if plain(r[j]).strip()]
                align.append("right" if j > 0 and vals and all(NUM_CELL.fullmatch(v) for v in vals) else "left")
        widths = b.get("widths")
        if widths and len(widths) != n:
            raise Bad(f"{where}.widths: cần đúng {n} số (một cho mỗi cột)")
        if not widths and ctx.target == "typst":
            widths = table_widths([runs(c) for c in b["columns"]], cells, ctx.tpl)
        return {"type": t, "columns": [runs(c) for c in b["columns"]], "rows": cells, "align": align, "widths": widths,
                "caption": runs(b.get("caption")) or None, "total": bool(b.get("total"))}
    if t == "image":
        img = image(ctx, b["path"])
        return {"type": t, **img, "width": b.get("width", 100), "caption": runs(b.get("caption")) or None}
    if t == "quote":
        return {"type": t, "text": runs(b["text"]), "by": b.get("by")}
    if t == "callout":
        return {"type": t, "title": b.get("title"), "text": runs(b["text"])}
    if t == "code":
        return {"type": t, "text": b["text"], "lang": b.get("lang")}
    return {"type": "pagebreak"}


def norm_sections(ctx, secs, where="sections"):
    out = []
    for i, s in enumerate(secs):
        blocks = text_blocks(s["text"]) if s.get("text") else []
        blocks += s.get("blocks", [])
        out.append({
            "heading": runs(s.get("heading")) or None,
            "level": int(s.get("level", 1)),
            "blocks": [norm_block(ctx, b, f"{where}[{i}].blocks[{j}]") for j, b in enumerate(blocks)],
        })
    return out


# Nhãn ghi cứng trong gói được dịch bằng luật show chuỗi (main.typ của mẫu). Luật đó khớp cả chữ của người dùng ("Abstraction", "TABLE_NAME",
# "Inhalt của gói"): các từ này trong chữ người dùng được blocks.typ tách bằng h(0pt) sau ký tự đầu nên luật không khớp, chữ in và chữ chép ra vẫn nguyên.
GUARD = {("charged-ieee", "vi"): ["Index Terms", "Abstract", "TABLE", "Fig."], ("basic-report", None): ["Inhalt"]}


def vi_date(s):
    return dt.date.fromisoformat(s).strftime("%d/%m/%Y") if s else None


def normalize(tpl, d, ctx):
    lang = d.get("lang", "vi")
    m = {"template": tpl, "lang": lang, "title": d["title"], "date": d.get("date"), "date_text": vi_date(d.get("date")) if lang == "vi" else d.get("date"),
         "sections": norm_sections(ctx, d["sections"]), "references": [runs(r) for r in d.get("references", [])],
         "guard": GUARD.get((tpl, lang), GUARD.get((tpl, None), []))}
    if tpl == "basic-report":
        m.update(category=d.get("category", ""), author=d.get("author", ""), affiliation=d.get("affiliation", ""),
                 toc_title=d.get("toc_title", "Mục lục" if lang == "vi" else "Contents"),
                 logo=image(ctx, d["logo"]) if d.get("logo") else None)
    elif tpl == "ilm":
        m.update(author=d.get("author", ""), date_format=d.get("date_format", "Ngày [day] tháng [month] năm [year]" if lang == "vi" else "[month repr:long] [day padding:none], [year]"),
                 abstract=runs(d.get("abstract")) or None,
                 preface=[norm_block(ctx, b, "preface") for b in text_blocks(d["preface"])] if d.get("preface") else None,
                 toc=d.get("toc", True), chapter_pagebreak=d.get("chapter_pagebreak", True),
                 figure_index=d.get("figure_index", False), table_index=d.get("table_index", False),
                 appendix={"title": d["appendix"].get("title", "Phụ lục" if lang == "vi" else "Appendix"),
                           "sections": norm_sections(ctx, d["appendix"]["sections"], "appendix.sections")} if d.get("appendix") else None)
    elif tpl == "charged-ieee":
        m.update(authors=[{"name": a} if isinstance(a, str) else a for a in d.get("authors", [])],
                 abstract=runs(d.get("abstract")) or None, keywords=d.get("keywords", []), paper=d.get("paper", "a4"))
    return m


# ---------------------------------------------------------------- chung
def out_path(root, p, ext):
    if not p.lower().endswith(ext):
        raise Bad(f"tệp ra phải có đuôi {ext}: {p}")
    a = os.path.realpath(os.path.join(root, p))
    if not a.startswith(root + os.sep):
        raise Bad(f"tệp ra phải nằm trong thư mục làm việc: {p}")
    os.makedirs(os.path.dirname(a), exist_ok=True)
    return a


def pdf_pages(pdf):
    try:
        r = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, timeout=30)
        m = re.search(r"^Pages:\s+(\d+)", r.stdout, re.M)
        return int(m.group(1)) if m else None
    except (OSError, subprocess.SubprocessError):
        return None


def previews(pdf, outdir, root):
    """Ảnh các trang đầu (70 dpi) để model tự xem bố cục và dấu tiếng Việt trước khi giao."""
    if not outdir:
        return []
    d = os.path.realpath(os.path.join(root, outdir))
    if not d.startswith(root + os.sep):
        raise Bad(f"--png phải là thư mục trong thư mục làm việc: {outdir}")
    os.makedirs(d, exist_ok=True)
    stem = os.path.splitext(os.path.basename(pdf))[0]
    for f in os.listdir(d):
        if re.fullmatch(re.escape(stem) + r"-\d+\.png", f):
            os.remove(os.path.join(d, f))
    try:
        subprocess.run(["pdftoppm", "-png", "-r", "70", "-f", "1", "-l", str(PREVIEW_PAGES), pdf, os.path.join(d, stem)], check=True, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return []
    return sorted(os.path.relpath(os.path.join(d, f), root) for f in os.listdir(d) if re.fullmatch(re.escape(stem) + r"-\d+\.png", f))


def report(res):
    print(json.dumps(res, ensure_ascii=False))


# ---------------------------------------------------------------- Typst
def typst_cmd(tpl, root, payload_rel, main, out, date):
    cmd = [TYPST[tpl][1], "compile", "--root", root, "--input", f"payload=/{payload_rel}", "--diagnostic-format", "short", "--ignore-system-fonts"]
    for d in FONT_DIRS:
        if os.path.isdir(d):
            cmd += ["--font-path", d]
    # Ngày trên bìa basic-report là datetime.today(): cố định theo payload.date để kết quả lặp lại được.
    when = dt.datetime.fromisoformat(date) if date else dt.datetime.now()
    cmd += ["--creation-timestamp", str(int(when.replace(hour=12, tzinfo=dt.timezone.utc).timestamp())), main, out]
    return cmd


def clean_stderr(s):
    # Phông mà gói ghi cứng (Ubuntu, Iosevka, Fira Mono…) đã được thay bằng phông có dấu tiếng Việt: cảnh báo này không phải lỗi.
    return "\n".join(l for l in s.splitlines() if l.strip() and "unknown font family" not in l)


def run_typst(tpl, payload, outp, png=None, keep=False):
    if tpl not in TYPST:
        raise Bad(f'mẫu Typst không có: "{tpl}" (có: {", ".join(TYPST)}; hóa đơn dùng synchro-doc invoice)')
    root = os.path.realpath(os.getcwd())
    d, notes = load_payload(tpl, payload)
    out = out_path(root, outp, ".pdf")
    tmp = tempfile.mkdtemp(prefix=".synchro-doc-", dir=root)
    t0 = time.time()
    try:
        model = normalize(tpl, d, Ctx(root, tmp, d.get("lang", "vi"), "typst", tpl))
        for sub in ("_lib", tpl):
            shutil.copytree(os.path.join(KIT, "typst", sub), os.path.join(tmp, sub))
        with open(os.path.join(tmp, "payload.json"), "w", encoding="utf-8") as f:
            json.dump(model, f, ensure_ascii=False)
        cmd = typst_cmd(tpl, root, os.path.relpath(os.path.join(tmp, "payload.json"), root), os.path.join(tmp, tpl, "main.typ"), out, d.get("date"))
        env = dict(os.environ, TYPST_PACKAGE_PATH=PACKAGES, TYPST_PACKAGE_CACHE_PATH=PACKAGES)
        try:
            r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=240)
        except FileNotFoundError:
            die(f"không có trình biên dịch {cmd[0]} (synchro-doc chỉ chạy trong sandbox workspace của Synchro)", 1)
        err = clean_stderr(r.stderr)
        if r.returncode:
            die(f"typst lỗi (báo lại lỗi này, đừng tự viết Typst để thay):\n{err}", 1)
        res = {"ok": True, "template": tpl, "package": TYPST[tpl][0], "output": os.path.relpath(out, root), "pages": pdf_pages(out),
               "seconds": round(time.time() - t0, 2), "previews": previews(out, png, root)}
        if notes:
            res["renamed"] = notes
        if err:
            res["warnings"] = err.splitlines()[:10]
        report(res)
    finally:
        if keep:
            print(f"giữ thư mục tạm: {os.path.relpath(tmp, root)}", file=sys.stderr)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- Word (.docx, thư viện docx của npm)
def run_docx(tpl, payload, outp, keep=False):
    if tpl not in TYPST:
        raise Bad(f'bản Word có cho: {", ".join(TYPST)} (hóa đơn chỉ có PDF)')
    root = os.path.realpath(os.getcwd())
    d, notes = load_payload(tpl, payload)
    out = out_path(root, outp, ".docx")
    tmp = tempfile.mkdtemp(prefix=".synchro-doc-", dir=root)
    t0 = time.time()
    try:
        model = normalize(tpl, d, Ctx(root, tmp, d.get("lang", "vi"), "docx"))
        mp = os.path.join(tmp, "model.json")
        with open(mp, "w", encoding="utf-8") as f:
            json.dump(model, f, ensure_ascii=False)
        try:
            r = subprocess.run(["node", os.path.join(KIT, "docx", "render.mjs"), mp, out, root], capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            die("không có node", 1)
        if r.returncode:
            die(f"dựng Word lỗi:\n{r.stderr.strip()[-2000:]}", 1)
        res = {"ok": True, "template": tpl, "output": os.path.relpath(out, root), "seconds": round(time.time() - t0, 2),
               "note": "Mục lục đã điền sẵn số trang (ước lượng như Word); người dùng sửa nội dung thì cập nhật trong Word bằng Update Table."}
        if notes:
            res["renamed"] = notes
        report(res)
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- hóa đơn (WeasyPrint)
# Mẫu gốc: invoice.html / invoice.css trong WeasyPrint samples (trước ở Kozea/WeasyPrint-Samples, nay CourtBouillon/weasyprint-samples,
# commit 6dc675b), README của kho ghi các mẫu thuộc phạm vi công cộng (public domain); phông giữ giấy phép riêng (OFL).
# invoice.css giữ nguyên bản gốc; synchro.css bổ sung (A4, bảng cộng, ghi chú, bố cục nhiều dòng). HTML dựng lại ở đây từ JSON.
LABELS = {
    "vi": {"title": "Hóa đơn", "number": "Số", "date": "Ngày", "description": "Mô tả", "price": "Đơn giá", "quantity": "SL", "line_total": "Thành tiền",
           "subtotal": "Cộng tiền hàng", "discount": "Chiết khấu", "tax": "Thuế GTGT", "due": "Hạn thanh toán", "account": "Số tài khoản",
           "total": "Tổng cộng", "tax_id": "MST", "thanks": "Cảm ơn quý khách!"},
    "en": {"title": "Invoice", "number": "Invoice number", "date": "Date", "description": "Description", "price": "Price", "quantity": "Qty",
           "line_total": "Subtotal", "subtotal": "Subtotal", "discount": "Discount", "tax": "VAT", "due": "Due by", "account": "Account number",
           "total": "Total due", "tax_id": "Tax ID", "thanks": "Thank you!"},
}
LONG_ITEMS = 8
CUR_Q = {"VND": Decimal("1"), "USD": Decimal("0.01"), "EUR": Decimal("0.01")}


def dec(v):
    return Decimal(str(v))


def money(v, cur, lang="vi"):
    q = CUR_Q[cur]
    with localcontext() as c:
        c.prec = 60
        v = dec(v).quantize(q, ROUND_HALF_UP)
    neg = v < 0
    s = f"{abs(v):,.0f}" if q == 1 else f"{abs(v):,.2f}"
    vi = s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    if cur == "VND":
        s = vi + "\u00a0₫"
    elif cur == "USD":
        # Hóa đơn tiếng Việt: số theo kiểu Việt (dấu phẩy thập phân) như số lượng và % thuế cùng trang, không trộn hai kiểu.
        s = vi + "\u00a0US$" if lang == "vi" else "$" + s
    else:
        s = vi + "\u00a0€" if lang == "vi" else "€" + s
    return ("−" if neg else "") + s


def qty_text(q, lang):
    s = format(dec(q).normalize(), "f")
    return s.replace(".", ",") if lang == "vi" else s


def totals(d):
    cur = d.get("currency", "VND")
    q = CUR_Q[cur]
    try:
        with localcontext() as c:
            c.prec = 60
            # Đơn giá làm tròn tới đơn vị tiền một lần, rồi mới nhân: đơn giá in × số lượng luôn bằng thành tiền in.
            prices = [dec(it["unit_price"]).quantize(q, ROUND_HALF_UP) for it in d["items"]]
            lines = [(dec(it["quantity"]) * p).quantize(q, ROUND_HALF_UP) for it, p in zip(d["items"], prices)]
            sub = sum(lines, Decimal(0))
            disc = dec(d.get("discount", 0)).quantize(q, ROUND_HALF_UP)
            rate = dec(d.get("tax_rate", 0))
            tax = ((sub - disc) * rate).quantize(q, ROUND_HALF_UP)
            total = sub - disc + tax
            over = disc > sub
    except (InvalidOperation, ValueError, ArithmeticError):
        raise Bad("số tiền / số lượng không tính được (quá lớn hoặc không phải số): kiểm lại items[].quantity, items[].unit_price, discount, tax_rate")
    if over:
        raise Bad(f"discount ({disc}) lớn hơn cộng tiền hàng ({sub})")
    return {"prices": prices, "lines": lines, "subtotal": sub, "discount": disc, "rate": rate, "tax": tax, "total": total}


def css_str(s):
    """Chuỗi CSS an toàn: mọi ký tự có thể thoát khỏi chuỗi hay khỏi thẻ <style> (\\ " ' < > & xuống dòng, ký tự điều khiển) viết bằng mã hex."""
    out = []
    for ch in str(s):
        if ch in "\\\"'<>&" or ord(ch) < 0x20 or ord(ch) == 0x7f:
            out.append("\\%x " % ord(ch))
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def invoice_html(d, long_=None):
    lang = d.get("lang", "vi")
    cur = d.get("currency", "VND")
    L = {**LABELS[lang], **d.get("labels", {})}
    e = html.escape
    tt = totals(d)
    long_ = len(d["items"]) > LONG_ITEMS if long_ is None else long_
    rows = "".join(
        f"<tr><td>{e(it['description'])}</td><td>{money(price, cur, lang)}</td>"
        f"<td>{e(qty_text(it['quantity'], lang))}{(' ' + e(it['unit'])) if it.get('unit') else ''}</td><td>{money(line, cur, lang)}</td></tr>"
        for it, price, line in zip(d["items"], tt["prices"], tt["lines"]))
    sums = [(L["subtotal"], money(tt["subtotal"], cur, lang))]
    if tt["discount"]:
        sums.append((L["discount"], money(-tt["discount"], cur, lang)))
    if tt["rate"]:
        pct = format((tt["rate"] * 100).normalize(), "f")
        sums.append((f"{L['tax']} {pct.replace('.', ',') if lang == 'vi' else pct}%", money(tt["tax"], cur, lang)))
    sums_html = "".join(f"<tr><th>{e(a)}</th><td>{b}</td></tr>" for a, b in sums)

    def party(p, cls):
        lines = [p["name"], *p.get("address", [])]
        if p.get("tax_id"):
            lines.append(f"{L['tax_id']}: {p['tax_id']}")
        lines += [x for x in (p.get("email"), p.get("phone")) if x]
        return f'<address id="{cls}">' + "<br>".join(e(x) for x in lines) + "</address>"

    def fdate(s):
        return dt.date.fromisoformat(s).strftime("%d/%m/%Y" if lang == "vi" else "%B %-d, %Y") if s else ""

    pay = d.get("payment", {})
    acct = e(pay.get("account", ""))
    sub_acct = " · ".join(e(x) for x in (pay.get("bank"), pay.get("holder")) if x)
    title = d.get("title", L["title"])
    page_css = (f"@page {{ @bottom-left {{ content: {css_str(d.get('thanks', L['thanks']))}; }} "
                f"@bottom-right {{ content: {css_str(d.get('footer', ''))}; }} }}")
    notes = f'<p id="notes">{e(d["notes"])}</p>' if d.get("notes") else ""
    return f"""<!doctype html>
<html lang="{e(lang)}"><head><meta charset="utf-8">
<link href="invoice.css" rel="stylesheet"><link href="synchro.css" rel="stylesheet">
<style>{page_css}</style>
<title>{e(title)} {e(d['number'])}</title></head>
<body class="{'long' if long_ else 'short'}">
<h1>{e(title)}</h1>
<aside>{party(d['from'], 'from')}{party(d['to'], 'to')}</aside>
<dl id="informations"><dt>{e(L['number'])}</dt><dd>{e(d['number'])}</dd><dt>{e(L['date'])}</dt><dd>{fdate(d['date'])}</dd></dl>
<table id="items"><thead><tr><th>{e(L['description'])}</th><th>{e(L['price'])}</th><th>{e(L['quantity'])}</th><th>{e(L['line_total'])}</th></tr></thead>
<tbody>{rows}</tbody></table>
<table id="totals">{sums_html}</table>
{notes}
<footer><table id="total"><thead><tr><th>{e(L['due'])}</th><th>{e(L['account'])}</th><th>{e(L['total'])}</th></tr></thead>
<tbody><tr><td>{fdate(d.get('due_date'))}</td><td>{acct}{f'<br><small>{sub_acct}</small>' if sub_acct else ''}</td><td>{money(tt['total'], cur, lang)}</td></tr></tbody></table></footer>
</body></html>
"""


def hidden_under_total(page):
    """Bố cục short: dòng chữ nào của trang (ngoài chân trang) xuống tới vùng bảng tổng ghim ở đáy không. Không đo được thì None."""
    try:
        top, bottom = None, 0.0

        def walk(box, in_footer):
            nonlocal top, bottom
            kind = type(box).__name__
            if kind == "MarginBox":  # lời cảm ơn, chân trang ở lề dưới: nằm dưới bảng tổng là đúng
                return
            tag = getattr(box, "element_tag", None)
            el = getattr(box, "element", None)
            in_footer = in_footer or tag == "footer"
            if tag == "table" and el is not None and el.get("id") == "total":
                top = box.position_y if top is None else min(top, box.position_y)
            if not in_footer and kind == "LineBox":
                bottom = max(bottom, box.position_y + box.height)
            for c in getattr(box, "children", None) or []:
                walk(c, in_footer)

        walk(page._page_box, False)
        return None if top is None else bottom > top - 1
    except Exception:
        return None


def run_invoice(payload, outp, png=None, keep=False):
    root = os.path.realpath(os.getcwd())
    d, _ = load_payload("invoice", payload)
    out = out_path(root, outp, ".pdf")
    tt = totals(d)
    try:
        import weasyprint
        from weasyprint.urls import URLFetcher
    except ImportError:
        die("không có WeasyPrint (synchro-doc invoice chỉ chạy trong sandbox workspace của Synchro)", 1)
    tmp = tempfile.mkdtemp(prefix=".synchro-doc-", dir=root)
    t0 = time.time()

    class LocalOnly(URLFetcher):
        """Chỉ đọc tệp trong thư mục tạm của mẫu (CSS, phông): không mạng, không tệp nào khác."""

        def __init__(self):
            super().__init__(allowed_protocols={"file"}, fail_on_errors=False)

        def fetch(self, url, headers=None):
            from urllib.parse import unquote, urlparse
            p = os.path.realpath(unquote(urlparse(url).path))
            if not p.startswith(os.path.realpath(tmp) + os.sep):
                raise ValueError(f"không cho tải: {url}")
            return super().fetch(url, headers)

    try:
        src = os.path.join(KIT, "invoice")
        for f in os.listdir(src):
            if not f.endswith(".html"):
                shutil.copy(os.path.join(src, f), tmp)
        index = os.path.join(tmp, "index.html")

        def render(long_):
            with open(index, "w", encoding="utf-8") as f:
                f.write(invoice_html(d, long_))
            return weasyprint.HTML(index, url_fetcher=LocalOnly()).render()

        long_ = len(d["items"]) > LONG_ITEMS
        doc = render(long_)
        if not long_ and (len(doc.pages) > 1 or hidden_under_total(doc.pages[0])):
            # Bảng tổng của mẫu gốc ghim ở đáy trang 1: nội dung tràn sang trang 2, hay có dòng chữ nằm khuất dưới bảng tổng, thì dựng lại
            # kiểu nhiều trang (bảng tổng đi sau bảng hàng).
            long_ = True
            doc = render(True)
        doc.write_pdf(out)
        res = {"ok": True, "template": "invoice", "engine": f"WeasyPrint {weasyprint.__version__}", "output": os.path.relpath(out, root),
               "pages": len(doc.pages), "layout": "long" if long_ else "short", "total": money(tt["total"], d.get("currency", "VND"), d.get("lang", "vi")),
               "seconds": round(time.time() - t0, 2), "previews": previews(out, png, root)}
        report(res)
    finally:
        if keep:
            print(f"giữ thư mục tạm: {os.path.relpath(tmp, root)}", file=sys.stderr)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- dòng lệnh
def main(argv):
    opts = {"png": None, "keep": False}
    pos = []
    it = iter(argv)
    for a in it:
        if a == "--png":
            opts["png"] = next(it, None) or "outputs/_preview"
        elif a.startswith("--png="):
            opts["png"] = a[6:]
        elif a in ("--keep", "--typ"):
            opts["keep"] = True
        elif a in ("-h", "--help", "help"):
            print(__doc__.strip())
            return
        elif a.startswith("--"):
            raise Bad(f"cờ không có: {a}")
        else:
            pos.append(a)
    if not pos:
        print(__doc__.strip())
        return
    cmd, rest = pos[0], pos[1:]
    if cmd == "list" and not rest:
        with open(os.path.join(KIT, "schemas", "typst.json"), encoding="utf-8") as f:
            t = json.load(f)["templates"]
        for k in TYPST:
            print(f"{k}\t{t[k]['title']}\tsynchro-doc typst {k} payload.json outputs/x.pdf | synchro-doc docx {k} payload.json outputs/x.docx")
        print("invoice\tHóa đơn / báo giá A4 (WeasyPrint)\tsynchro-doc invoice payload.json outputs/x.pdf")
    elif cmd == "schema" and len(rest) == 1:
        print(json.dumps(schema_of(rest[0]), ensure_ascii=False, indent=1))
    elif cmd == "example" and len(rest) == 1:
        schema_of(rest[0])
        with open(os.path.join(KIT, "examples", rest[0] + ".json"), encoding="utf-8") as f:
            print(f.read().strip())
    elif cmd == "check" and len(rest) == 2:
        d, notes = load_payload(rest[0], rest[1]) if rest[0] in TEMPLATES else (schema_of(rest[0]), [])
        if rest[0] == "invoice":
            totals(d)
        report({"ok": True, "template": rest[0], **({"renamed": notes} if notes else {})})
    elif cmd == "typst" and len(rest) == 3:
        run_typst(rest[0], rest[1], rest[2], opts["png"], opts["keep"])
    elif cmd == "invoice" and len(rest) == 2:
        run_invoice(rest[0], rest[1], opts["png"], opts["keep"])
    elif cmd == "docx" and len(rest) == 3:
        run_docx(rest[0], rest[1], rest[2], opts["keep"])
    else:
        raise Bad("lệnh sai.\n" + __doc__.strip())


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Bad as e:
        die(str(e), 2)
