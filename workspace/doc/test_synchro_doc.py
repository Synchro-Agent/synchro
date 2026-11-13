"""Kiểm thử phần thuần của synchro-doc (không cần Typst, WeasyPrint hay mạng): bộ kiểm payload, chuẩn hóa nội dung, tính tiền hóa đơn,
định dạng tiền Việt, thoát HTML / CSS, đường dẫn ra ngoài thư mục làm việc. Chạy: python3 -I workspace/doc/test_synchro_doc.py
Phần dựng thật (PDF, phông, chữ tiếng Việt) kiểm ở workspace/doc/selftest.sh lúc build image."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.realpath(__file__))
SCRIPT = os.path.join(HERE, "synchro-doc.py")
spec = importlib.util.spec_from_file_location("synchro_doc", SCRIPT)
sd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sd)


def errors(tpl, payload):
    s = sd.schema_of(tpl)
    d, _ = sd.aliases(tpl, payload)
    return sd.validate(s, s, d)


def run_cli(args, cwd):
    env = {k: v for k, v in os.environ.items() if not k.startswith("SYNCHRO_TYPST")}
    env["SYNCHRO_TYPST"] = env["SYNCHRO_TYPST_012"] = "/nonexistent/typst"  # không được tới bước biên dịch
    return subprocess.run([sys.executable, "-I", SCRIPT, *args], cwd=cwd, capture_output=True, text=True, env=env)


class Schemas(unittest.TestCase):
    def test_examples_valid(self):
        for t in sd.TEMPLATES:
            with open(os.path.join(HERE, "examples", t + ".json"), encoding="utf-8") as f:
                ex = json.load(f)
            self.assertEqual(errors(t, ex), [], t)

    def test_schema_is_self_contained(self):
        for t in sd.TEMPLATES:
            s = sd.schema_of(t)
            self.assertEqual(s["type"], "object")
            self.assertIn("$defs", s)
            json.dumps(s)

    def test_unknown_template(self):
        with self.assertRaises(sd.Bad):
            sd.schema_of("bao-cao")


class Validation(unittest.TestCase):
    base = {"title": "Báo cáo", "sections": [{"heading": "Một", "text": "Nội dung"}]}

    def test_missing_required(self):
        e = errors("ilm", {"title": "x"})
        self.assertTrue(any('thiếu trường bắt buộc "sections"' in x for x in e), e)

    def test_unknown_field_suggests(self):
        e = errors("basic-report", {**self.base, "categori": "x"})
        self.assertTrue(any('"categori"' in x and '"category"' in x for x in e), e)

    def test_unknown_block_type(self):
        e = errors("ilm", {"title": "x", "sections": [{"blocks": [{"type": "tabel", "columns": ["a"], "rows": [["1"]]}]}]})
        self.assertEqual(len(e), 1, e)
        self.assertIn('payload.sections[0].blocks[0].type: "tabel" không có', e[0])
        self.assertIn('"table"', e[0])

    def test_block_errors_point_to_field(self):
        e = errors("ilm", {"title": "x", "sections": [{"blocks": [{"type": "table", "columns": ["a"], "rows": "1"}]}]})
        self.assertEqual(e, ["payload.sections[0].blocks[0].rows: phải là mảng, đang là chuỗi"])

    def test_wrong_types_and_ranges(self):
        e = errors("ilm", {"title": "x", "date": "11/11/2026", "toc": "có", "sections": [{"level": 5, "blocks": [{"type": "image", "path": "a.png", "width": 300}]}]})
        joined = "\n".join(e)
        self.assertIn("payload.date", joined)
        self.assertIn("YYYY-MM-DD", joined)
        self.assertIn("payload.toc: phải là true/false", joined)
        self.assertIn("payload.sections[0].level: phải ≤ 3", joined)
        self.assertIn("width: phải ≤ 100", joined)

    def test_link_scheme(self):
        e = errors("ilm", {"title": "x", "sections": [{"blocks": [{"type": "paragraph", "text": [{"text": "a", "link": "javascript:alert(1)"}]}]}]})
        self.assertTrue(e and "link" in e[0], e)

    def test_owner_sample_fields(self):
        # main.typ mẫu trong tài liệu của chủ dự án: project.with(title, subtitle, authors, date) và section.content
        d, notes = sd.aliases("basic-report", {"title": "T", "subtitle": "Phụ đề", "authors": ["An", {"name": "Bình"}], "date": "2026-11-11",
                                               "sections": [{"heading": "H", "content": "Nội dung"}]})
        self.assertEqual(d["category"], "Phụ đề")
        self.assertEqual(d["author"], "An, Bình")
        self.assertEqual(d["sections"][0]["text"], "Nội dung")
        self.assertEqual(errors("basic-report", d), [])
        self.assertTrue(notes)

    def test_impossible_date(self):
        with tempfile.TemporaryDirectory() as w:
            p = os.path.join(w, "p.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({**self.base, "date": "2026-02-30"}, f)
            with self.assertRaises(sd.Bad) as c:
                sd.load_payload("ilm", p)
            self.assertIn("không phải ngày có thật", str(c.exception))


class Normalize(unittest.TestCase):
    def test_inline_markdown(self):
        r = sd.runs("Có **đậm**, *nghiêng*, `mã`, [web](https://vd.vn) và 30*2 = 60, a*b*c")
        self.assertEqual(r[1], {"text": "đậm", "bold": True})
        self.assertEqual(r[3], {"text": "nghiêng", "italic": True})
        self.assertEqual(r[5], {"text": "mã", "code": True})
        self.assertEqual(r[7], {"text": "web", "link": "https://vd.vn"})
        self.assertEqual(sd.plain(r), "Có đậm, nghiêng, mã, web và 30*2 = 60, a*b*c")

    def test_runs_are_literal(self):
        r = sd.runs([{"text": "**không đậm** #set $x$", "italic": True}, "x"])
        self.assertEqual(r[0], {"text": "**không đậm** #set $x$", "italic": True})

    def test_text_blocks(self):
        b = sd.text_blocks("Đoạn một\ndòng hai\n\n- a\n- b\n\n1. x\n2) y")
        self.assertEqual([x["type"] for x in b], ["paragraph", "bullets", "numbered"])
        self.assertEqual(b[0]["text"], "Đoạn một\ndòng hai")
        self.assertEqual(b[2]["items"], ["x", "y"])

    def test_table_numbers_and_align(self):
        with tempfile.TemporaryDirectory() as w:
            ctx = sd.Ctx(w, w, "vi", "typst")
            t = sd.norm_block(ctx, {"type": "table", "columns": ["Khu vực", "Doanh thu", "Ghi chú"], "rows": [["Bắc", 1234567.5, "tốt"], ["Nam", "8,3 tr", None], ["Trung"]]}, "b")
            self.assertEqual(t["align"], ["left", "right", "left"])
            self.assertEqual(sd.plain(t["rows"][0][1]), "1.234.567,5")
            self.assertEqual(len(t["rows"][2]), 3)
            with self.assertRaises(sd.Bad):
                sd.norm_block(ctx, {"type": "table", "columns": ["a"], "rows": [["1", "2"]]}, "b")
            with self.assertRaises(sd.Bad):
                sd.norm_block(ctx, {"type": "table", "columns": ["a", "b"], "rows": [["1", "2"]], "widths": [1]}, "b")

    def test_number_format_en(self):
        self.assertEqual(sd.fmt_number(1234567.25, "en"), "1,234,567.25")
        self.assertEqual(sd.fmt_number(42, "vi"), "42")


class Paths(unittest.TestCase):
    def test_inside(self):
        with tempfile.TemporaryDirectory() as w:
            root = os.path.realpath(w)
            os.makedirs(os.path.join(root, "inputs"))
            open(os.path.join(root, "inputs", "a.png"), "wb").close()
            self.assertTrue(sd.inside(root, "inputs/a.png").endswith("a.png"))
            for p in ("/etc/passwd", "../etc/passwd", "inputs/../../x", "", "inputs/khong-co.png"):
                with self.assertRaises(sd.Bad, msg=p):
                    sd.inside(root, p)
            os.symlink("/etc/hosts", os.path.join(root, "inputs", "link.png"))
            with self.assertRaises(sd.Bad):
                sd.inside(root, "inputs/link.png")

    def test_cli_rejects_escape_with_exit_2_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as w:
            for i, path in enumerate(("/etc/passwd", "../../etc/hostname")):
                with open(os.path.join(w, f"bad{i}.json"), "w", encoding="utf-8") as f:
                    json.dump({"title": "x", "sections": [{"blocks": [{"type": "image", "path": path}]}]}, f)
                r = run_cli(["typst", "ilm", f"bad{i}.json", "outputs/x.pdf"], w)
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertIn("ngoài thư mục làm việc", r.stderr)
            self.assertFalse([x for x in os.listdir(w) if x.startswith(".synchro-doc-")])
            r = run_cli(["typst", "ilm", "bad0.json", "/tmp/x.pdf"], w)
            self.assertEqual(r.returncode, 2)

    def test_cli_usage(self):
        with tempfile.TemporaryDirectory() as w:
            self.assertEqual(run_cli(["typst", "bao-cao", "p.json", "o.pdf"], w).returncode, 2)
            self.assertEqual(run_cli(["docx", "invoice", "p.json", "o.docx"], w).returncode, 2)
            self.assertEqual(run_cli(["typst", "ilm", "khong-co.json", "o.pdf"], w).returncode, 2)
            r = run_cli(["list"], w)
            self.assertEqual(r.returncode, 0)
            self.assertEqual([l.split("\t")[0] for l in r.stdout.strip().splitlines()], ["basic-report", "ilm", "charged-ieee", "invoice", "contract", "minutes", "official-report", "cv"])
            r = run_cli(["check", "invoice", os.path.join(HERE, "examples", "invoice.json")], w)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["ok"], True)
            r = run_cli(["example", "charged-ieee"], w)
            self.assertIn("authors", json.loads(r.stdout))


INVOICE = {"number": "HĐ-1", "date": "2026-11-11", "due_date": "2026-12-11", "currency": "VND",
           "from": {"name": "Công ty A", "address": ["12 Nguyễn Huệ"], "tax_id": "0312345678"}, "to": {"name": "Công ty B"},
           "items": [{"description": "Thiết kế", "quantity": 1, "unit_price": 15000000},
                     {"description": "Lập trình", "quantity": 40, "unit": "giờ", "unit_price": 450000},
                     {"description": "Bảo trì", "quantity": 1, "unit_price": 2500000}],
           "tax_rate": 0.08}


class Hardening(unittest.TestCase):
    def test_date_format(self):
        for f in ("Ngày [day] tháng [month] năm [year]", "[month repr:long] [day padding:none], [year]", "[weekday], [day]/[month]/[year repr:last_two]"):
            self.assertIsNone(sd.check_date_format(f), f)
        for f, why in (("DD/MM/YYYY", "không có thành phần"), ("Ngày [ngay] tháng", "không có"), ("[day", "ngoặc"), ("[day]]", "]]"),
                       ("[hour]:[minute]", "không có"), ("[day pading:none]", "sai dạng")):
            self.assertIn(why, sd.check_date_format(f) or "", f)
        with tempfile.TemporaryDirectory() as w:
            with open(os.path.join(w, "p.json"), "w", encoding="utf-8") as fh:
                json.dump({"title": "x", "date": "2026-11-12", "date_format": "DD/MM/YYYY", "sections": [{"text": "a"}]}, fh)
            r = run_cli(["check", "ilm", "p.json"], w)
            self.assertEqual(r.returncode, 2, r.stderr)
            self.assertIn("payload.date_format", r.stderr)
            self.assertIn("[day]", r.stderr)

    def test_guard_words(self):
        ctx = sd.Ctx("/tmp", "/tmp", "vi", "typst", "charged-ieee")
        base = {"title": "t", "sections": [{"text": "a"}]}
        self.assertEqual(sd.normalize("charged-ieee", {**base, "lang": "vi"}, ctx)["guard"], ["Index Terms", "Abstract", "TABLE", "Fig."])
        self.assertEqual(sd.normalize("charged-ieee", {**base, "lang": "en"}, ctx)["guard"], [])
        self.assertEqual(sd.normalize("basic-report", {**base, "lang": "en"}, ctx)["guard"], ["Inhalt"])
        self.assertEqual(sd.normalize("ilm", {**base, "lang": "vi"}, ctx)["guard"], [])
        lib = open(os.path.join(HERE, "typst", "_lib", "blocks.typ"), encoding="utf-8").read()
        self.assertIn("guarded(p)", lib)
        self.assertIn("show table: set par(justify: false)", lib)

    def test_table_columns(self):
        cols = [sd.runs(c) for c in ["Khu vực bán hàng", "Tháng 7", "Tháng 8", "Tháng 9", "Cộng quý III", "Cùng kỳ năm trước", "Tăng trưởng"]]
        rows = [[sd.runs(c) for c in ["Miền Bắc (Hà Nội, Hải Phòng)", "2.100.000", "2.250.000", "2.400.000", "6.750.000", "6.100.000", "+10,7%"]]]
        for tpl in ("basic-report", "ilm", "charged-ieee"):
            self.assertEqual(sd.table_widths(cols, rows, tpl), "auto", tpl)
        small = ([sd.runs("Hạng mục"), sd.runs("Giá trị")], [[sd.runs("Doanh thu"), sd.runs("1.000")]])
        self.assertIsNone(sd.table_widths(*small, "charged-ieee"))
        ctx = sd.Ctx("/tmp", "/tmp", "vi", "typst", "ilm")
        b = sd.norm_block(ctx, {"type": "table", "columns": ["a", "b"], "rows": [["x", 1]], "widths": [2, 1]}, "t")
        self.assertEqual(b["widths"], [2, 1])  # widths của payload giữ nguyên
        b = sd.norm_block(sd.Ctx("/tmp", "/tmp", "vi", "docx", "ilm"), {"type": "table", "columns": [c[0]["text"] for c in cols], "rows": [[r[0]["text"] for r in rows[0]]]}, "t")
        self.assertIsNone(b["widths"])  # Word tự co cột


class Invoice(unittest.TestCase):
    def test_totals(self):
        t = sd.totals(INVOICE)
        self.assertEqual(t["subtotal"], Decimal("35500000"))
        self.assertEqual(t["tax"], Decimal("2840000"))
        self.assertEqual(t["total"], Decimal("38340000"))
        t = sd.totals({**INVOICE, "discount": 500000})
        self.assertEqual(t["tax"], Decimal("2800000"))
        self.assertEqual(t["total"], Decimal("37800000"))

    def test_rounding(self):
        d = {**INVOICE, "items": [{"description": "x", "quantity": 3, "unit_price": 333.335}], "tax_rate": 0.1}
        t = sd.totals(d)
        # Đơn giá làm tròn tới đơn vị tiền trước khi nhân: in 333 ₫ × 3 thì thành tiền phải là 999 ₫.
        self.assertEqual((t["prices"], t["lines"]), ([Decimal("333")], [Decimal("999")]))
        t = sd.totals({**d, "currency": "USD"})
        self.assertEqual((t["prices"], t["lines"]), ([Decimal("333.34")], [Decimal("1000.02")]))
        self.assertEqual(t["tax"], Decimal("100.00"))
        with self.assertRaises(sd.Bad):
            sd.totals({**INVOICE, "discount": 10 ** 9})

    def test_printed_price_times_qty(self):
        # Hai ca người kiểm tra tìm ra: EUR 2,5 × 1999,995 và USD 1,5 × 1234,567.
        cases = [("EUR", "en", 2.5, 1999.995), ("USD", "vi", 1.5, 1234.567), ("VND", "vi", 7, 1234.6), ("USD", "en", 3, 0.005)]
        for cur, lang, qty, price in cases:
            d = {**INVOICE, "currency": cur, "lang": lang, "items": [{"description": "x", "quantity": qty, "unit_price": price}]}
            t = sd.totals(d)
            self.assertEqual((Decimal(str(qty)) * t["prices"][0]).quantize(sd.CUR_Q[cur], sd.ROUND_HALF_UP), t["lines"][0], (cur, qty, price))
            h = sd.invoice_html(d)
            self.assertIn(f"<td>{sd.money(t['prices'][0], cur, lang)}</td>", h)
            self.assertIn(f"<td>{sd.money(t['lines'][0], cur, lang)}</td>", h)
        h = sd.invoice_html({**INVOICE, "currency": "EUR", "lang": "en", "items": [{"description": "x", "quantity": 2.5, "unit_price": 1999.995}]})
        self.assertIn("<td>€2,000.00</td>", h)
        self.assertIn("<td>€5,000.00</td>", h)

    def test_bad_numbers_exit_2(self):
        with tempfile.TemporaryDirectory() as w:
            for name, body in (("nan", '"quantity": NaN'), ("inf", '"quantity": Infinity'), ("big", '"quantity": 1000, "unit_price": 1e25')):
                with open(os.path.join(w, name + ".json"), "w", encoding="utf-8") as f:
                    f.write('{"number": "1", "date": "2026-11-12", "from": {"name": "A"}, "to": {"name": "B"}, "items": [{"description": "x", ' + body + (', "unit_price": 1' if name != "big" else "") + '}]}')
                r = run_cli(["check", "invoice", name + ".json"], w)
                self.assertEqual(r.returncode, 2, (name, r.stderr))
                self.assertNotIn("Traceback", r.stderr, name)
            with self.assertRaises(sd.Bad):
                sd.totals({**INVOICE, "items": [{"description": "x", "quantity": float("nan"), "unit_price": 1}]})
            self.assertTrue(any("không hữu hạn" in e or "phải là số" in e for e in errors("invoice", {**INVOICE, "items": [{"description": "x", "quantity": float("inf"), "unit_price": 1}]})))

    def test_money(self):
        self.assertEqual(sd.money(38340000, "VND"), "38.340.000 ₫")
        self.assertEqual(sd.money(-500000, "VND"), "−500.000 ₫")
        self.assertEqual(sd.money(1234.5, "USD", "en"), "$1,234.50")
        # Hóa đơn tiếng Việt bằng USD: số kiểu Việt như số lượng (1,5) và % thuế cùng trang.
        self.assertEqual(sd.money(1234.567, "USD", "vi"), "1.234,57\u00a0US$")
        self.assertEqual(sd.money(1234.5, "USD"), "1.234,50\u00a0US$")
        self.assertEqual(sd.money(1234.5, "EUR", "vi"), "1.234,50 €")
        self.assertEqual(sd.money(1234.5, "EUR", "en"), "€1,234.50")
        self.assertEqual(sd.qty_text(1.5, "vi"), "1,5")

    def test_css_string_escape(self):
        s = sd.css_str('a"b\\c</style><script>\n\'x')
        self.assertTrue(s.startswith('"') and s.endswith('"'))
        inner = s[1:-1]
        for bad in ('"', "<", ">", "\n", "'"):
            self.assertNotIn(bad, inner)
        self.assertNotIn("\\\\", inner.replace("\\5c ", ""))

    def test_html_escaped(self):
        d = {**INVOICE, "items": [{"description": "<b>x</b> & \"y\"", "quantity": 1, "unit_price": 1}],
             "notes": "<script>alert(1)</script>", "footer": 'a"; } body { display:none } </style><h1>', "thanks": "Cảm ơn"}
        h = sd.invoice_html(d)
        self.assertIn("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;", h)
        self.assertNotIn("<script>", h)
        self.assertEqual(h.count("</style>"), 1)
        self.assertNotIn("display:none } </style>", h)
        self.assertIn("38.340.000", sd.invoice_html(INVOICE))
        self.assertIn("Thuế GTGT 8%", sd.invoice_html(INVOICE))
        self.assertIn("40 giờ", sd.invoice_html(INVOICE))
        self.assertIn("11/11/2026", sd.invoice_html(INVOICE))
        self.assertIn("MST: 0312345678", sd.invoice_html(INVOICE))

    def test_long_layout(self):
        self.assertIn('class="short"', sd.invoice_html(INVOICE))
        many = {**INVOICE, "items": [{"description": f"Mục {i}", "quantity": 1, "unit_price": 1000} for i in range(9)]}
        self.assertIn('class="long"', sd.invoice_html(many))
        eight = {**INVOICE, "items": many["items"][:8]}
        self.assertIn('class="short"', sd.invoice_html(eight))

    def test_english_labels(self):
        h = sd.invoice_html({**INVOICE, "lang": "en", "currency": "USD", "labels": {"total": "Grand total"}})
        self.assertIn("Invoice", h)
        self.assertIn("Grand total", h)
        self.assertIn("November 11, 2026", h)


def example(tpl):
    with open(os.path.join(HERE, "examples", tpl + ".json"), encoding="utf-8") as f:
        return json.load(f)


def word_model(tpl, payload):
    with tempfile.TemporaryDirectory() as w:
        return sd.normalize(tpl, sd.aliases(tpl, payload)[0], sd.Ctx(w, w, payload.get("lang", "vi"), "docx", tpl))


class WordTemplates(unittest.TestCase):
    """4 mẫu Word mới (H4.1): hợp đồng, biên bản họp, báo cáo có mục lục, CV."""

    def test_listed_with_schema_and_example(self):
        for t in sd.WORD:
            self.assertIn(t, sd.TEMPLATES)
            s = sd.schema_of(t)
            # khối nội dung dùng chung với các mẫu Typst
            self.assertIn("block", s["$defs"])
            self.assertIn("party", s["$defs"])
            self.assertEqual(errors(t, example(t)), [], t)

    def test_required_and_suggestions(self):
        e = errors("contract", {"title": "HĐ", "parties": [{"label": "BÊN A", "name": "X"}], "articles": [{"heading": "a"}]})
        self.assertTrue(any("cần ít nhất 2" in x for x in e), e)
        e = errors("minutes", {"subject": "Họp", "date": "2026-11-11", "attendees": ["An"], "start_time": "9h"})
        self.assertTrue(any("start_time" in x and "HH:MM" in x for x in e), e)
        e = errors("cv", {"name": "An", "acent": "112233"})
        self.assertTrue(any('"acent"' in x and '"accent"' in x for x in e), e)
        e = errors("official-report", {"organization": "A", "title": "B", "sections": [{"heading": "x"}], "signer": {"title": "GĐ"}})
        self.assertTrue(any('signer: thiếu trường bắt buộc "name"' in x for x in e), e)

    def test_aliases(self):
        d, notes = sd.aliases("contract", {"title": "x", "parties": [], "clauses": [{"heading": "a", "content": "Nội dung"}]})
        self.assertEqual(d["articles"][0]["text"], "Nội dung")
        self.assertIn("clauses → articles", notes)
        d, _ = sd.aliases("minutes", {"participants": ["An"], "conclusions": ["Chốt"]})
        self.assertEqual(d["attendees"], ["An"])
        self.assertEqual(d["decisions"], ["Chốt"])

    def test_date_line_decree_30(self):
        self.assertEqual(sd.date_line("Hà Nội", "2026-02-05", "vi"), "Hà Nội, ngày 05 tháng 02 năm 2026")
        self.assertEqual(sd.date_line("Hà Nội", "2026-11-11", "vi"), "Hà Nội, ngày 11 tháng 11 năm 2026")
        self.assertEqual(sd.date_line("Hanoi", "2026-11-11", "en"), "Hanoi, November 11, 2026")
        self.assertRegex(sd.date_line("Huế", None, "vi"), r"^Huế, ngày\s+tháng\s+năm \d{4}$")

    def test_contract_model(self):
        m = word_model("contract", example("contract"))
        self.assertEqual([p["short"] for p in m["parties"]], ["BÊN A", "BÊN B"])
        self.assertEqual(m["intro"], "Hôm nay, ngày 11 tháng 11 năm 2026, tại TP. Hồ Chí Minh, chúng tôi gồm:")
        self.assertIn("02 bản", m["closing"])
        self.assertTrue(m["national_header"])
        self.assertEqual(sd.plain(m["articles"][1]["heading"]), "Giá trị hợp đồng và phương thức thanh toán")
        self.assertEqual(m["articles"][1]["blocks"][1]["type"], "table")
        three = {**example("contract"), "parties": example("contract")["parties"] + [{"label": "Bên C (bên bảo lãnh)", "name": "Ngân hàng X"}], "lang": "en"}
        m = word_model("contract", three)
        self.assertEqual(m["parties"][2]["short"], "BÊN C")
        self.assertIn("3 copies", m["closing"])
        self.assertFalse(m["national_header"])

    def test_minutes_model(self):
        m = word_model("minutes", example("minutes"))
        self.assertEqual(m["title"], "BIÊN BẢN HỌP")
        self.assertEqual(m["time_line"], "09 giờ 00, ngày 11/11/2026")
        self.assertTrue(m["closing"].startswith("Cuộc họp kết thúc lúc 11 giờ 15 cùng ngày."))
        self.assertEqual(m["chair"], {"name": "Nguyễn Văn Ánh", "position": "Giám đốc"})
        self.assertEqual(m["actions"][0]["owner"], "Phạm Quốc Dũng")
        self.assertEqual(word_model("minutes", {"subject": "S", "date": "2026-11-11", "attendees": ["An"]})["attendees"], [{"name": "An", "position": ""}])

    def test_report_model(self):
        m = word_model("official-report", example("official-report"))
        self.assertTrue(m["toc"])
        self.assertEqual(m["organization"], "CÔNG TY TNHH ĐỒNG HÀNH")
        self.assertEqual(m["signer"]["title"], "GIÁM ĐỐC")
        self.assertEqual(m["intro"][0]["type"], "paragraph")
        self.assertEqual(word_model("official-report", {"organization": "A", "title": "B", "sections": [{"heading": "x"}], "signer": {"title": "t", "name": "n"}})["recipients"], ["Như trên;", "Lưu: VT."])

    def test_cv_model(self):
        m = word_model("cv", example("cv"))
        self.assertEqual(m["experience"][0]["end"], "nay")
        self.assertEqual(m["experience"][1]["end"], "02/2022")
        self.assertEqual(m["skills"][0]["group"], "Phân tích")
        m = word_model("cv", {"name": "An", "skills": ["Python", {"items": ["SQL"]}], "lang": "en", "experience": [{"role": "r", "org": "o", "start": "2020"}]})
        self.assertEqual(m["skills"][0], {"group": None, "items": ["Python"]})
        self.assertEqual(m["experience"][0]["end"], "Present")

    def test_word_template_not_typst(self):
        with tempfile.TemporaryDirectory() as w:
            with open(os.path.join(w, "p.json"), "w", encoding="utf-8") as f:
                json.dump(example("cv"), f, ensure_ascii=False)
            r = run_cli(["typst", "cv", "p.json", "outputs/a.pdf"], w)
            self.assertEqual(r.returncode, 2)
            self.assertIn("synchro-doc docx cv", r.stderr)
            r = run_cli(["list"], w)
            for t in sd.WORD:
                self.assertIn(f"synchro-doc docx {t}", r.stdout)


# Dựng thật cần node và thư viện docx (image workspace có sẵn; máy dev: npm ci trong workspace/doc/docx).
HAS_DOCX = os.path.isdir(os.path.join(HERE, "docx", "node_modules", "docx")) and subprocess.run(["node", "--version"], capture_output=True).returncode == 0


@unittest.skipUnless(HAS_DOCX, "cần node + workspace/doc/docx/node_modules")
class WordRender(unittest.TestCase):
    def build(self, tpl, payload, extra=()):
        import zipfile
        w = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(w, ignore_errors=True))
        with open(os.path.join(w, "p.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        env_soffice = {"SYNCHRO_SOFFICE": "/nonexistent/soffice"}
        r = subprocess.run([sys.executable, "-I", SCRIPT, "docx", tpl, "p.json", f"outputs/{tpl}.docx", *extra], cwd=w, capture_output=True, text=True, env={**os.environ, **env_soffice})
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout)
        with zipfile.ZipFile(os.path.join(w, res["output"])) as z:
            xml = z.read("word/document.xml").decode("utf-8")
        self.assertFalse([x for x in os.listdir(w) if x.startswith(".synchro-doc")], "còn thư mục tạm")
        return res, xml

    def test_contract(self):
        res, xml = self.build("contract", example("contract"))
        for s in ("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "Điều 1. ", "Điều 6. ", "ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B", "Số: 12/2026/HĐDV", "w:titlePg"):
            self.assertIn(s, xml, s)

    def test_minutes(self):
        _, xml = self.build("minutes", example("minutes"))
        for s in ("BIÊN BẢN HỌP", "Họp giao ban kinh doanh quý IV năm 2026", "Thời gian bắt đầu: ", "Phân công thực hiện:", "THƯ KÝ", "CHỦ TRÌ", "Lê Thị Cúc"):
            self.assertIn(s, xml, s)

    def test_report_toc(self):
        res, xml = self.build("official-report", example("official-report"))
        self.assertIn("TOC \\h \\o", xml)
        for s in ("MỤC LỤC", "I. ", "Kết quả thực hiện quý III", "IV. ", "Nơi nhận:", "GIÁM ĐỐC", "BÁO CÁO"):
            self.assertIn(s, xml, s)
        self.assertIn("Mục lục", res["note"])

    def test_cv_and_pdf_without_libreoffice(self):
        res, xml = self.build("cv", example("cv"), ("--pdf",))
        for s in ("Trần Thị Bình", "Kinh nghiệm làm việc", "03/2022 – nay", "IELTS 7.0", 'w:val="right"'):
            self.assertIn(s, xml, s)
        self.assertIsNone(res["pdf"])
        self.assertIn("LibreOffice", res["pdf_error"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
