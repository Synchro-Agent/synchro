// PDF gửi kèm: tệp hỏng báo rõ lúc tải lên; tệp quá dài không gửi nguyên cho Claude (API từ chối cả lượt) mà gửi phần chữ của nhiều trang. Không cần máy chủ; cần Python có pdfplumber, pypdfium2.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const py = process.env.PYTHON_BIN || path.join(process.cwd(), ".mkvenv", "bin", "python");
try { execFileSync(py, ["-c", "import pdfplumber, pypdfium2"], { stdio: "ignore" }); } catch { console.log("Bỏ qua: máy này không có Python kèm pdfplumber, pypdfium2.\n\n0/0 đạt"); process.exit(0); }
process.env.PYTHON_BIN = py; process.env.LLM_PDF_NATIVE = "1";

// PDF tối thiểu n trang, mỗi trang một dòng chữ.
function pdf(n) {
  const objs = [], add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let i = 1; i <= n; i++) {
    const body = `BT /F1 12 Tf 72 720 Td (Page number ${i} of the long contract with plenty of words here) Tj ET`;
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${n} >>`;
  let out = "%PDF-1.4\n"; const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const { "fileproc/extractors": X, "fileproc/types": T } = await loadTs(["fileproc/extractors", "fileproc/types"]);
const run = (buf, name) => X.pickExtractor("application/pdf", name).run(buf, { name, kind: "application/pdf" });

console.log("1. PDF bình thường: gửi nguyên kèm chữ dự phòng");
const short = await run(pdf(3), "ngan.pdf");
ok(short.length === 1 && short[0].type === "document" && /Page number 3/.test(short[0].fallbackText ?? ""), "3 trang: khối document có chữ dự phòng", JSON.stringify(short).slice(0, 300));

console.log("2. Tệp hỏng");
let msg = "";
try { await run(Buffer.from("%PDF-1.4\nrác không phải pdf\n".repeat(50)), "hong.pdf"); } catch (e) { msg = e.message; }
ok(/Không đọc được "hong\.pdf"/.test(msg), "báo tệp hỏng bằng câu đọc được", msg);

console.log("3. Quá giới hạn trang");
const long = await run(pdf(150), "dai.pdf");
ok(!long.some((b) => b.type === "document"), "150 trang: không gửi nguyên tệp", JSON.stringify(long.map((b) => b.type)));
const text = long.find((b) => b.type === "text")?.text ?? "";
ok(/Page number 150/.test(text), "chữ có đủ tới trang cuối (không còn dừng ở trang 20)", text.slice(-200));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
