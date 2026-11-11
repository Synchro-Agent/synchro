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
            self.assertEqual([l.split("\t")[0] for l in r.stdout.strip().splitlines()], ["basic-report", "ilm", "charged-ieee", "invoice"])
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
        self.assertEqual(t["lines"], [Decimal("1000")])  # VND: làm tròn đồng
        t = sd.totals({**d, "currency": "USD"})
        self.assertEqual(t["lines"], [Decimal("1000.01")])
        self.assertEqual(t["tax"], Decimal("100.00"))
        with self.assertRaises(sd.Bad):
            sd.totals({**INVOICE, "discount": 10 ** 9})

    def test_money(self):
        self.assertEqual(sd.money(38340000, "VND"), "38.340.000 ₫")
        self.assertEqual(sd.money(-500000, "VND"), "−500.000 ₫")
        self.assertEqual(sd.money(1234.5, "USD"), "$1,234.50")
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


if __name__ == "__main__":
    unittest.main(verbosity=1)
