#!/usr/bin/env python3
# Tính lại công thức trong .xlsx bằng LibreOffice rồi ghi giá trị vào chính tệp gốc (dịch vụ workspace gọi sau mỗi run_code thành công, trong container).
# Vì sao: openpyxl không ghi giá trị công thức, xlsxwriter ghi 0, nên bản xem trước, Excel ở Protected View và pandas đều thấy ô trống hoặc số 0.
# Không lưu đè bằng bản LibreOffice xuất ra vì mất biểu đồ, định dạng, Excel Table: chỉ sửa <v> của ô có công thức trong XML gốc, mọi thứ khác giữ nguyên từng byte.
# Dùng: xlsx_recalc.py <thư mục|tệp>…  In JSON: { files: [{ path, formulas, filled, errors, sample }], failed: [{ path, reason }] }. Chỉ dùng thư viện chuẩn.
import html, json, os, re, shutil, subprocess, sys, tempfile, time, zipfile

BUDGET = 110  # giây cho cả lần gọi: container bị giới hạn 120 giây
MAX_XML = 400 * 1024 * 1024  # sheet lớn hơn thì LibreOffice cũng không tính kịp, khỏi đọc vào bộ nhớ
# LibreOffice mặc định không tính lại tệp của "ứng dụng quen" (xlsxwriter tự xưng Microsoft Excel) nên đọc nguyên số 0: bắt buộc tính lại khi mở.
XCU = '''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
'''
# Ô có nội dung (<c r="A1" …>…</c>), không bắt ô rỗng tự đóng <c r="A1"/>.
CELL = re.compile(r'<c\s((?:[^>/]|/(?!>))*)>(.*?)</c>', re.S)
HAS_F = re.compile(rb'<f[\s>/]')
F_TAG = re.compile(r'<f\b[^>]*/>|<f\b.*?</f>', re.S)
V_TAG = re.compile(r'<v\b[^>]*/>|<v\b[^>]*>(.*?)</v>', re.S)


# Hàm sau Excel 2007: trong tệp phải ghi kèm tiền tố _xlfn., thiếu thì Excel báo #NAME? dù LibreOffice vẫn tính được, nên bước tự kiểm tra không bắt được lỗi này.
# openpyxl ghi nguyên văn model viết. Không có hàm mảng động (XLOOKUP, FILTER…): chúng còn cần cờ mảng, thêm tiền tố cũng chưa đúng; quy tắc của run_code đã cấm.
LATER_FUNCS = """IFS SWITCH MAXIFS MINIFS TEXTJOIN CONCAT IFNA DAYS ISOWEEKNUM XOR NUMBERVALUE UNICHAR UNICODE FORMULATEXT ISFORMULA SHEET SHEETS ARABIC BASE DECIMAL
CEILING.MATH FLOOR.MATH STDEV.S STDEV.P VAR.S VAR.P COVARIANCE.P COVARIANCE.S PERCENTILE.INC PERCENTILE.EXC PERCENTRANK.INC PERCENTRANK.EXC QUARTILE.INC QUARTILE.EXC
RANK.EQ RANK.AVG MODE.SNGL MODE.MULT NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T CONFIDENCE.NORM CONFIDENCE.T FORECAST.LINEAR
NETWORKDAYS.INTL WORKDAY.INTL AGGREGATE PDURATION RRI GAMMA BITAND BITOR BITXOR""".split()
LATER = re.compile(r'(?<![\w.])(' + "|".join(re.escape(n) for n in sorted(LATER_FUNCS, key=len, reverse=True)) + r')(?=\s*\()', re.I)
# NETWORKDAYS.INTL, WORKDAY.INTL, AGGREGATE có từ Excel 2010 nhưng lưu không tiền tố.
NO_PREFIX = {"NETWORKDAYS.INTL", "WORKDAY.INTL", "AGGREGATE"}


def add_prefixes(f_xml):
    """Thêm _xlfn. vào một thẻ <f>; bỏ qua chữ trong ngoặc kép. Trả về (thẻ mới, số chỗ đã thêm)."""
    count = 0

    def one(m):
        nonlocal count
        name = m.group(1).upper()
        if name in NO_PREFIX:
            return m.group(0)
        count += 1
        return "_xlfn." + name
    # &quot; là ngoặc kép đã mã hóa trong XML, openpyxl có thể ghi dạng này.
    parts = re.split(r'("(?:[^"]|"")*"|&quot;.*?&quot;)', f_xml)
    return "".join(LATER.sub(one, p) if i % 2 == 0 else p for i, p in enumerate(parts)), count


def prefix_book(path):
    """Sửa tên hàm trong mọi sheet, tại chỗ; không có gì phải sửa thì không đụng tới tệp. Trả về số chỗ đã sửa."""
    total = 0
    names = {}
    with zipfile.ZipFile(path) as z:
        for _, part in sheet_paths(z):
            xml = read_xml(z, part)

            def fix(m):
                nonlocal total
                new, n = add_prefixes(m.group(0))
                total += n
                return new
            new = F_TAG.sub(fix, xml)
            if new != xml:
                names[part] = new
        if names:
            fd, tmp = tempfile.mkstemp(prefix=".recalc-", dir=os.path.dirname(os.path.abspath(path)))
            os.close(fd)
            try:
                with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as o:
                    for info in z.infolist():
                        o.writestr(info, names[info.filename].encode("utf-8") if info.filename in names else z.read(info.filename))
                os.replace(tmp, path)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
    return total


def attr(tag, name):
    m = re.search(r'(?:^|\s)' + name + r'="([^"]*)"', tag)
    return m.group(1) if m else None


def write_profile(user_dir):
    os.makedirs(user_dir, exist_ok=True)
    with open(os.path.join(user_dir, "registrymodifications.xcu"), "w", encoding="utf-8") as f:
        f.write(XCU)


def sheet_paths(z):
    """Tên sheet (theo thứ tự) → đường dẫn XML trong tệp."""
    rels = {}
    for m in re.finditer(r'<Relationship\b[^>]*>', z.read("xl/_rels/workbook.xml.rels").decode("utf-8")):
        rid, tgt = attr(m.group(0), "Id"), attr(m.group(0), "Target")
        if rid and tgt:
            rels[rid] = tgt.lstrip("/") if tgt.startswith("/") else "xl/" + tgt
    out = []
    for m in re.finditer(r'<sheet\b[^>]*>', z.read("xl/workbook.xml").decode("utf-8")):
        rid = re.search(r'\s[\w]+:id="([^"]*)"', m.group(0))
        if rid and rid.group(1) in rels:
            out.append((html.unescape(attr(m.group(0), "name") or ""), rels[rid.group(1)]))
    return out


def read_xml(z, name):
    if z.getinfo(name).file_size > MAX_XML:
        raise ValueError("sheet quá lớn để tính lại")
    return z.read(name).decode("utf-8")


def values_of(path):
    """Giá trị đã tính của các ô công thức trong bản LibreOffice xuất ra: { tên sheet: { ô: (t, nội dung <v>) } }."""
    out = {}
    with zipfile.ZipFile(path) as z:
        for name, part in sheet_paths(z):
            cells = {}
            for m in CELL.finditer(read_xml(z, part)):
                if "<f" not in m.group(2):
                    continue
                ref = attr(m.group(1), "r")
                v = V_TAG.search(m.group(2))
                if ref and v:
                    cells[ref] = (attr(m.group(1), "t") or "n", v.group(1) or "")
            out[name] = cells
    return out


def set_calc_on_load(wb):
    """Excel vẫn tự tính lại khi mở (giá trị vừa ghi chỉ để đọc khi chưa mở hẳn: Protected View, xem trước, pandas)."""
    m = re.search(r'<calcPr\b[^>]*?/?>', wb)
    if m:
        if "fullCalcOnLoad" in m.group(0):
            return wb
        return wb[:m.start()] + re.sub(r'^<calcPr', '<calcPr fullCalcOnLoad="1"', m.group(0)) + wb[m.end():]
    # Đúng thứ tự phần tử của workbook.xml: calcPr nằm sau definedNames / externalReferences / sheets.
    for end in ("</definedNames>", "</externalReferences>", "</functionGroups>", "</sheets>"):
        i = wb.find(end)
        if i >= 0:
            i += len(end)
            return wb[:i] + '<calcPr fullCalcOnLoad="1"/>' + wb[i:]
    return wb


def inject(path, computed):
    """Ghi giá trị vào ô công thức của tệp gốc, tại chỗ. Ô LibreOffice báo lỗi không ghi (có thể chỉ vì LibreOffice thiếu hàm), báo về cho model."""
    rep = {"formulas": 0, "filled": 0, "errors": [], "sample": []}
    names = {}
    with zipfile.ZipFile(path) as z:
        sheets = sheet_paths(z)
        for i, (name, part) in enumerate(sheets):
            got = computed.get(name)
            if got is None:  # sheet đổi tên khi xuất: theo thứ tự
                vals = list(computed.values())
                got = vals[i] if i < len(vals) else {}
            xml = read_xml(z, part)

            def fix(m):
                body = m.group(2)
                f = F_TAG.search(body)
                if not f:
                    return m.group(0)
                rep["formulas"] += 1
                ref = attr(m.group(1), "r") or ""
                r = got.get(ref)
                if r is None:
                    return m.group(0)
                t, val = r
                ftext = re.sub(r'<[^>]+>', '', f.group(0))
                if t == "e" or val.startswith("#") or val.startswith("Err:"):
                    if len(rep["errors"]) < 25:
                        rep["errors"].append({"sheet": name, "cell": ref, "value": html.unescape(val), "formula": html.unescape(ftext)[:200]})
                    return m.group(0)
                if t not in ("n", "str", "b"):
                    return m.group(0)
                rep["filled"] += 1
                if len(rep["sample"]) < 40:
                    rep["sample"].append(f"{name}!{ref}={html.unescape(val)}")
                attrs = re.sub(r'(^|\s)t="[^"]*"', '', m.group(1)).rstrip()
                if t != "n":
                    attrs += f' t="{t}"'
                rest = V_TAG.sub('', body[f.end():])
                return f'<c {attrs.strip()}>{body[:f.start()]}{f.group(0)}<v>{val}</v>{rest}</c>'

            new = CELL.sub(fix, xml)
            if new != xml:
                names[part] = new
        wb = z.read("xl/workbook.xml").decode("utf-8")
        wb2 = set_calc_on_load(wb)
        if wb2 != wb:
            names["xl/workbook.xml"] = wb2
        if names:
            fd, tmp = tempfile.mkstemp(prefix=".recalc-", dir=os.path.dirname(os.path.abspath(path)))
            os.close(fd)
            try:
                with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as o:
                    for info in z.infolist():
                        o.writestr(info, names[info.filename].encode("utf-8") if info.filename in names else z.read(info.filename))
                os.replace(tmp, path)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
    # Vài giá trị cuối (thường là dòng tổng) đủ để model đối chiếu với số tự tính, không làm dài kết quả công cụ.
    rep["sample"] = rep["sample"][-8:]
    return rep


def has_formula(path):
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.filename.startswith("xl/worksheets/") and info.filename.endswith(".xml"):
                if info.file_size > MAX_XML or HAS_F.search(z.read(info.filename)):
                    return True
    return False


def recalc(path, soffice, tmp, seconds):
    write_profile(os.path.join(tmp, "profile", "user"))
    out = os.path.join(tmp, "out")
    os.makedirs(out, exist_ok=True)
    cmd = [soffice, "--headless", "--norestore", f"-env:UserInstallation=file://{os.path.join(tmp, 'profile')}", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, path]
    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=seconds)
    res = os.path.join(out, os.path.splitext(os.path.basename(path))[0] + ".xlsx")
    if not os.path.exists(res):
        raise RuntimeError((r.stderr or b"").decode("utf-8", "replace").strip()[-200:] or f"soffice exit {r.returncode}")
    return values_of(res)


def books(args):
    for a in args:
        if os.path.isfile(a) and not os.path.islink(a):
            yield a
        elif os.path.isdir(a) and not os.path.islink(a):
            for root, dirs, fs in os.walk(a):
                dirs[:] = sorted(d for d in dirs if d != "_preview" and not os.path.islink(os.path.join(root, d)))
                for f in sorted(fs):
                    p = os.path.join(root, f)
                    if re.search(r'\.xls[xm]$', f, re.I) and not f.startswith(".") and not os.path.islink(p):
                        yield p


def main(argv):
    if len(argv) == 2 and argv[0] == "--write-profile":
        write_profile(argv[1])
        return 0
    soffice = os.environ.get("SYNCHRO_SOFFICE") or shutil.which("soffice") or shutil.which("libreoffice")
    report = {"files": [], "failed": []}
    deadline = time.time() + BUDGET
    for path in books(argv):
        rel = path.split("outputs/", 1)[-1]
        try:
            if not has_formula(path):
                continue
            # Trước khi tính lại: LibreOffice hỏng hay hết giờ thì tệp vẫn mở đúng trong Excel.
            prefixed = prefix_book(path)
            if not soffice:
                raise RuntimeError("không có LibreOffice ở nơi chạy này")
            left = deadline - time.time()
            if left < 5:
                raise RuntimeError("hết thời gian tính lại")
            with tempfile.TemporaryDirectory() as tmp:
                rep = inject(path, recalc(path, soffice, tmp, left))
            report["files"].append({"path": rel, **rep, **({"prefixed": prefixed} if prefixed else {})})
        except Exception as e:  # một tệp lỗi không được chặn các tệp còn lại
            msg = "quá thời gian tính lại" if isinstance(e, subprocess.TimeoutExpired) else str(e)
            report["failed"].append({"path": rel, "reason": msg[:200]})
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
