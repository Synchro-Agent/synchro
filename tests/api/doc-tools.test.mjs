// Tài liệu PDF / Word theo mẫu (synchro-doc, workspace/doc): ghim phiên bản và mã băm trong Dockerfile, setup.sh dựng lại image khi mẫu đổi,
// hợp đồng JSON (schema + ví dụ), phần thuần của synchro-doc (kiểm payload, tính tiền hóa đơn, thoát HTML / CSS, đường dẫn: test_synchro_doc.py),
// hướng dẫn cho model (app/coderun.ts chỉ với image workspace, app/dockit.ts theo lượt, app/designkit.ts).
// Không cần máy chủ, Typst hay WeasyPrint. Phần dựng thật: workspace/doc/selftest.sh lúc build image.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const read = (p) => fs.readFileSync(p, "utf8");
const D = "workspace/doc";

console.log("1. Dockerfile: Typst, gói @preview, phông, WeasyPrint, docx đều ghim và kiểm sha256");
{
  const d = read("workspace/Dockerfile");
  ok(/typst\/releases\/download\/v0\.15\.1\/typst-x86_64-unknown-linux-musl\.tar\.xz/.test(d) && d.includes("a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c"), "Typst 0.15.1 + sha256");
  ok(/v0\.12\.0\/typst-x86_64-unknown-linux-musl\.tar\.xz/.test(d) && d.includes("605130a770ebd59a4a579673079cb913a13e75985231657a71d6239a57539ec3") && d.includes("/usr/local/lib/synchro-doc/typst-0.12.0"), "Typst 0.12.0 riêng cho basic-report 0.1.0 + sha256");
  for (const [sum, pkg] of [["6ed00d8a7fbcd882abdd21a0e1ab27807019d1aef447d14a87ecd8daefd32293", "basic-report 0.1.0"], ["40723a565b981b0cb8b9cdfe193c8dbf31944cf6c42c55d8ae60d25eee27f1ac", "hydra 0.5.1"],
    ["260d4db5173286a79e26f88e885b3cecb89d85807d92110d839511d82152e862", "oxifmt 0.2.0"], ["2448904f8bbff54c68ddd700e3b01788053f3b48417aac4553a4a17008a60219", "ilm 1.4.0"], ["f665c7de234a86be9b59b2df920df023f742b7f094fd71f8159a52808bb51d42", "charged-ieee 0.1.3"]])
    ok(d.includes(`'${sum} ${pkg}'`), `gói ${pkg} đúng phiên bản chủ dự án chọn + sha256`);
  ok(/packages\.typst\.org\/preview\/\$n-\$v\.tar\.gz/.test(d) && d.includes("/opt/synchro/typst-packages/preview/$n/$v"), "gói đặt sẵn theo cấu trúc {path}/preview/<tên>/<bản>");
  ok(/ENV TYPST_PACKAGE_PATH=\/opt\/synchro\/typst-packages/.test(d) && /export TYPST_PACKAGE_PATH=\/opt\/synchro\/typst-packages/.test(d), "TYPST_PACKAGE_PATH cho cả shell không tương tác");
  ok(/Vollkorn-Typeface\/38ab7a896bd6b163ac7f834ec696d6c68e5dedd6[\s\S]{0,200}\/usr\/share\/fonts\/truetype\/synchro\/Vollkorn-Regular\.ttf/.test(d), "Vollkorn bản tĩnh vào /usr/share/fonts (Typst 0.12 không in đậm phông biến thiên)");
  ok(/CourtBouillon\/weasyprint-samples\/6dc675b05a5cba59576dfaa8881ea6ccdccb13cc\/invoice\/invoice\.css/.test(d) && d.includes("156424e672f26cdd52da0674d0dd3ef85728f9a63e3f224528d87627eda87505"), "invoice.css gốc ghim commit + sha256");
  ok(d.includes("5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701") && /\/opt\/synchro\/doc\/invoice\/pacifico\.ttf/.test(d), "Pacifico đủ dấu (Google Fonts) thay bản thiếu 56 chữ của mẫu gốc");
  ok(/fonts-texgyre/.test(d) && /libpango-1\.0-0 libpangoft2-1\.0-0 libharfbuzz-subset0/.test(d), "TeX Gyre cho charged-ieee, Pango / HarfBuzz cho WeasyPrint");
  ok(/"weasyprint==70\.0"/.test(d) && /assert weasyprint\.__version__ == '70\.0'/.test(d), "WeasyPrint 70.0 từ pip (Debian 57.2 không hiểu CSS lồng nhau)");
  ok(/COPY doc\/docx\/package\.json doc\/docx\/package-lock\.json \/opt\/synchro\/doc\/docx\/\nRUN cd \/opt\/synchro\/doc\/docx && npm ci --omit=dev/.test(d), "thư viện docx cài theo lockfile");
  ok(/install -m 755 \/opt\/synchro\/doc\/synchro-doc\.py \/usr\/local\/bin\/synchro-doc/.test(d), "lệnh synchro-doc trong PATH");
  ok(/USER user\n[\s\S]*RUN bash \/opt\/synchro\/doc\/selftest\.sh/.test(d), "tự kiểm tra lúc build bằng người dùng của sandbox");
  const remotionAt = d.indexOf("COPY remotion/ /opt/remotion/"), docAt = d.indexOf("COPY doc/ /opt/synchro/doc/");
  ok(remotionAt > 0 && docAt > remotionAt, "lớp tài liệu sau lớp Remotion (đổi mẫu không dựng lại video)");
  ok(read("workspace/.dockerignore").includes("doc/docx/node_modules"), ".dockerignore bỏ node_modules của docx");
  const pkg = JSON.parse(read(`${D}/docx/package.json`)), lock = JSON.parse(read(`${D}/docx/package-lock.json`));
  ok(pkg.dependencies.docx === "9.15.3" && lock.packages["node_modules/docx"]?.version === "9.15.3", "docx 9.15.3 ghim chính xác");
  ok(Object.entries(lock.packages).filter(([k]) => k).every(([, p]) => /^sha512-/.test(p.integrity ?? "")), "mọi gói trong lockfile có mã băm sha512");
}

console.log("2. setup.sh dựng lại image khi mẫu tài liệu đổi");
{
  const s = read("workspace/setup.sh");
  ok(/find doc -type f -not -path 'doc\/docx\/node_modules\/\*'/.test(s) && /for f in \$REMOTION_FILES \$DOC_FILES/.test(s), "HASH gồm mọi tệp của workspace/doc");
  const r = spawnSync("bash", ["-n", "workspace/setup.sh"]);
  ok(r.status === 0, "setup.sh đúng cú pháp", r.stderr);
}

console.log("3. Mẫu Typst: đúng gói, đọc payload, không eval chữ của payload");
{
  const lib = read(`${D}/typst/_lib/blocks.typ`);
  ok(/json\(sys\.inputs\.at\("payload"/.test(lib), "main.typ đọc payload JSON (cách của chủ dự án), đường dẫn do synchro-doc truyền");
  ok(!/\beval\(/.test(lib.replace(/^\s*\/\/.*$/gm, "")), "không eval chữ của payload");
  ok(/table\.header\(/.test(lib) && /breakable: false/.test(lib) && /set block\(breakable: true\)/.test(lib), "bảng dài ngắt trang, lặp tiêu đề cột, không cắt đôi một dòng");
  const br = read(`${D}/typst/basic-report/main.typ`), ilm = read(`${D}/typst/ilm/main.typ`), ieee = read(`${D}/typst/charged-ieee/main.typ`);
  ok(br.includes('#import "@preview/basic-report:0.1.0"') && ilm.includes('#import "@preview/ilm:1.4.0"') && ieee.includes('#import "@preview/charged-ieee:0.1.3"'), "đúng 3 gói và phiên bản chủ dự án chọn");
  ok(/font-remap\(\("ubuntu": "Be Vietnam Pro"\)\)/.test(br) && /show "Inhalt"/.test(br), "basic-report: thay phông Ubuntu thiếu dấu, dịch \"Inhalt\"");
  ok(/show "Abstract"/.test(ieee) && /show "Index Terms"/.test(ieee) && /show "TABLE"/.test(ieee), "charged-ieee: nhãn tiếng Việt khi lang là vi");
  const py = read(`${D}/synchro-doc.py`);
  ok(/"basic-report": \("@preview\/basic-report:0\.1\.0", TYPST_012\)/.test(py) && /"ilm": \("@preview\/ilm:1\.4\.0", TYPST_NEW\)/.test(py), "basic-report biên dịch bằng Typst 0.12.0, mẫu khác bằng 0.15.1");
  ok(/--ignore-system-fonts/.test(py) && /--font-path/.test(py) && /tex-gyre/.test(py) && /--creation-timestamp/.test(py), "phông qua --font-path (gồm TeX Gyre), ngày cố định theo payload");
  ok(/class LocalOnly\(URLFetcher\)/.test(py) && /allowed_protocols=\{"file"\}/.test(py), "WeasyPrint chỉ đọc tệp trong thư mục tạm");
  const st = read(`${D}/selftest.sh`);
  ok(/basic-report 0\.1\.0 lại biên dịch được trên Typst 0\.15\.1/.test(st), "selftest giữ việc basic-report 0.1.0 cần Typst 0.12.0 (không gộp trình biên dịch)");
  ok(/HTTPS_PROXY=http:\/\/127\.0\.0\.1:9/.test(st) && /typst init "@preview\/\$1"/.test(st), "selftest chạy không mạng, gồm 3 lệnh typst init của chủ dự án");
  ok(/Vollkorn/.test(st) && /TeXGyreTermes/.test(st) && /Pacifico/.test(st) && /"38\.340\.000 ₫"/.test(st), "selftest kiểm phông nhúng và chữ tiếng Việt, tổng tiền hóa đơn");
  const css = read(`${D}/invoice/synchro.css`);
  ok(/Kozea\/WeasyPrint-Samples/.test(css) && /CourtBouillon\/weasyprint-samples/.test(css) && /công cộng/.test(css), "ghi nguồn mẫu hóa đơn (Kozea → CourtBouillon) và giấy phép");
  ok(/thead \{ display: table-header-group; \}/.test(css) && /tr \{ break-inside: avoid; \}/.test(css) && /body\.long table#total/.test(css), "hóa đơn: lặp tiêu đề cột, không cắt dòng, bố cục nhiều trang");
}

console.log("4. Phần thuần của synchro-doc (python3 -I)");
{
  const r = spawnSync("python3", ["-I", `${D}/test_synchro_doc.py`], { encoding: "utf8" });
  const tail = (r.stderr || "").trim().split("\n").slice(-3).join(" | ");
  ok(r.status === 0 && /\nOK\s*$/.test(r.stderr), `test_synchro_doc.py: ${tail}`, r.stderr.slice(-1500));
}

console.log("5. Hướng dẫn cho model");
{
  const st0 = read(`${D}/selftest.sh`);
  const rules = read("app/coderun.ts");
  ok(/WS_TOOLS = [^\n]*synchro-doc[^\n]*Typst 0\.15[^\n]*WeasyPrint 70/.test(rules), "WS_TOOLS nêu synchro-doc, Typst, WeasyPrint");
  ok(!/BASE_TOOLS = [^\n]*(?:synchro-doc|Typst|WeasyPrint)/.test(rules), "nơi chạy khác (E2B, máy giả lập) không quảng cáo synchro-doc");
  ok(/runner\(\) === "workspace" \? DOC_ROUTE : ""\}PDF dựng bằng reportlab/.test(rules), "DOC_ROUTE chỉ với image workspace, reportlab vẫn là đường dự phòng");
  ok(/DOC_ROUTE = "[^\n]*basic-report, ilm, charged-ieee[^\n]*invoice[^\n]*Không tự viết Typst/.test(rules), "DOC_ROUTE nêu 4 mẫu, cấm tự viết Typst cho các mẫu này");
  const dk = read("app/designkit.ts");
  ok(/<doc_kit>[^`]*synchro-doc docx/.test(dk) && /Word bằng python-docx/.test(dk), "designkit: PDF theo mẫu dùng khối doc_kit, Word tự do vẫn python-docx");
  const { dockit: K } = await loadTs(["dockit"]);
  for (const [q, want] of [["Làm báo cáo PDF kết quả kinh doanh quý 3 có mục lục", "doc"], ["Viết đề xuất dự án chuyển đổi số, xuất file Word", "doc"], ["soạn bài nghiên cứu 2 cột kiểu IEEE về nhận dạng chữ viết tay", "doc"],
    ["Tạo hóa đơn cho khách hàng Ánh Dương 3 hạng mục", "invoice"], ["lập báo giá thiết kế website gửi khách", "invoice"], ["Make an invoice for Acme Corp", "invoice"], ["Write a project proposal as a PDF", "doc"]])
    ok(K.wantsDoc(q) === want, `nhận ra "${q}" → ${want}`, K.wantsDoc(q));
  for (const q of ["xin chào", "hóa đơn đỏ là gì?", "cách làm báo cáo tài chính", "tóm tắt file pdf này giúp mình", "viết báo cáo về thị trường bia", "chuyển file pdf sang word", "kiểm tra hóa đơn này có đúng không", "làm bộ slide báo cáo quý"])
    ok(K.wantsDoc(q) === null, `không phải làm tệp tài liệu: "${q}"`, K.wantsDoc(q));
  ok(K.wantsDoc("viết kế hoạch marketing", "doc") === null && K.wantsDoc("viết kế hoạch marketing bản PDF", "doc") === "doc", "chỉ khi nói rõ tệp (PDF, Word, A4, mục lục…)");
  const b = K.docTurn({ typed: "làm báo cáo pdf quý 3", code: true, workspace: true });
  ok(b.startsWith("<doc_kit>") && b.endsWith("</doc_kit>"), "khối <doc_kit>");
  for (const t of ["synchro-doc example", "synchro-doc typst", "synchro-doc invoice", "synchro-doc docx", "--png outputs/_preview", "Mã thoát 2", "basic-report", "ilm", "charged-ieee", "invoice", "tax_rate", "unit_price", "chapter_pagebreak", "pdftotext"])
    ok(b.includes(t), `khối nêu ${t}`);
  ok(/không tự tính/.test(b) && /Không tự viết Typst/.test(b), "khối dặn không tự tính tiền, không tự viết Typst");
  ok(K.docTurn({ typed: "làm báo cáo pdf", code: true, workspace: false }) === "" && K.docTurn({ typed: "làm báo cáo pdf", code: false, workspace: true }) === "", "không có run_code / không phải image workspace: không có khối");
  ok(K.docTurn({ typed: "làm báo cáo pdf #nodockit", code: true, workspace: true }) === "", "#nodockit tắt khối");
  ok(Buffer.byteLength(K.DOC_KIT) < 6144, "khối dưới 6 KB", Buffer.byteLength(K.DOC_KIT));
  // Tên trường trong khối phải có thật trong schema (khối là bản tóm tắt của schemas/*.json).
  const ts = JSON.parse(read(`${D}/schemas/typst.json`)), inv = JSON.parse(read(`${D}/schemas/invoice.json`));
  const fields = new Set([...Object.values(ts.templates).flatMap((t) => Object.keys(t.properties)), ...Object.keys(inv.templates.invoice.properties), ...Object.keys(ts.$defs.section.properties)]);
  for (const f of ["category", "affiliation", "logo", "toc_title", "abstract", "preface", "toc", "chapter_pagebreak", "figure_index", "table_index", "appendix", "authors", "keywords", "paper", "references", "number", "due_date", "currency", "discount", "tax_rate", "notes", "payment", "thanks", "footer", "heading", "level", "text", "blocks"])
    ok(fields.has(f) && b.includes(f), `trường ${f} có trong schema và trong khối`);
  const blockTypes = ts.$defs.block.anyOf.map((x) => x.properties.type.const);
  ok(blockTypes.every((t) => b.includes(`"${t}"`)), `khối liệt kê đủ ${blockTypes.length} loại khối`, blockTypes.join());
  // H4: 4 mẫu Word (hợp đồng, biên bản họp, báo cáo có mục lục, CV).
  const wd = JSON.parse(read(`${D}/schemas/word.json`));
  ok(["contract", "minutes", "official-report", "cv"].every((t) => wd.templates[t] && fs.existsSync(`${D}/examples/${t}.json`)), "schemas/word.json có đủ 4 mẫu Word, mỗi mẫu một ví dụ");
  const wfields = new Set([...Object.values(wd.templates).flatMap((t) => Object.keys(t.properties)), ...Object.keys(wd.$defs.party.properties), ...Object.keys(wd.$defs.signer.properties)]);
  for (const f of ["legal_bases", "parties", "label", "representative", "articles", "closing", "subject", "start_time", "end_time", "chair", "secretary", "attendees", "agenda", "decisions", "actions", "organization", "recipients", "signer", "authority", "headline", "contact", "experience", "education", "skills", "languages", "certifications"])
    ok(wfields.has(f) && b.includes(f), `mẫu Word: trường ${f} có trong schema và trong khối`);
  ok(/--pdf --png outputs\/_preview/.test(b) && /contract\|minutes\|official-report\|cv/.test(b), "khối dặn dựng bản PDF + ảnh từ chính tệp Word để tự kiểm");
  for (const [q, want] of [["Soạn hợp đồng dịch vụ thiết kế website, xuất file Word", "doc"], ["lập biên bản họp giao ban tuần này bản word", "doc"], ["làm CV xin việc vị trí phân tích dữ liệu", "doc"], ["Write my resume for a data analyst role", "doc"], ["viết hợp đồng thuê nhà", null], ["hợp đồng lao động là gì", null]])
    ok(K.wantsDoc(q) === want, `nhận ra "${q}" → ${want}`, K.wantsDoc(q));
  const wm = read(`${D}/docx/word.mjs`);
  ok(/estimatePageNumbersWith/.test(wm) && /updateFields: true/.test(wm), "báo cáo: mục lục điền sẵn số trang (docx/layout), bản docx cũ thì Word tự cập nhật");
  ok(/titlePage: true/.test(wm) && /PageNumber\.CURRENT/.test(wm) && /cm\(3\)/.test(wm) && /Times New Roman/.test(wm), "hợp đồng / biên bản / báo cáo: lề trái 3 cm, Times New Roman, số trang từ trang 2 (Nghị định 30)");
  ok(/def docx_pdf\(/.test(read(`${D}/synchro-doc.py`)) && /"--convert-to", "pdf"/.test(read(`${D}/synchro-doc.py`)), "synchro-doc docx --pdf dựng PDF bằng LibreOffice");
  ok(/for t in contract minutes official-report cv/.test(st0) && /"ĐẠI DIỆN BÊN A"/.test(st0), "selftest dựng 4 mẫu Word và kiểm chữ trong bản PDF");
  const engine = read("app/chatengine.ts");
  ok(/docTurn\(\{ typed, code: caps\.code, workspace: runner\(\) === "workspace", format: d\?\.format \}\)/.test(engine), "chatengine đặt khối cạnh tin nhắn mới nhất");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
