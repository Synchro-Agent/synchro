// Giữ các lỗi giao diện đã sửa không quay lại, đọc thẳng mã nguồn (không cần máy chủ): nhãn tiến trình có bản tiếng Anh, không còn hộp prompt() của trình duyệt,
// chữ hiện dần ở mọi nơi đang viết, nút thu gọn dự án là nút thật, hộp xem ảnh dùng cơ chế hộp thoại chung.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const read = (f) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const { "i18n-dict": D } = await loadTs(["i18n-dict"]);
const en = (t) => D.VI2EN[t] ?? D.RULES_EN.map(([re, f]) => { const m = t.match(re); return m ? f(m) : null; }).find(Boolean);

// Máy chủ ghi nhãn bằng tiếng Việt, giao diện dịch khi hiện (worklog.tsx): nhãn nào không có bản dịch thì giao diện tiếng Anh hiện nguyên tiếng Việt.
const srcs = ["app/chatengine.ts", ...fs.readdirSync("app/ai").filter((f) => f.endsWith(".ts")).map((f) => `app/ai/${f}`)];
const labels = new Set();
for (const f of srcs) for (const m of read(f).matchAll(/[`"](Đang [^`"\n]{2,120})[`"]/g)) if (!/\$\{[^}]*["?(]/.test(m[1])) labels.add(m[1].replace(/\$\{[^}]*\}/g, "12").trim());
ok(labels.size > 10, "tìm thấy các nhãn tiến trình", labels.size);
for (const l of labels) ok(!!en(l), `có bản tiếng Anh: ${l}`);
ok(en("Đang chờ 1 giây rồi thử lại") === "Waiting 1 second, then retrying", "một giây dùng số ít", en("Đang chờ 1 giây rồi thử lại"));
ok(en("Đang dùng Audit: delete_page") === "Using Audit: delete_page", "nhãn công cụ connector", en("Đang dùng Audit: delete_page"));

const tsx = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx")) tsx.push(p); } })("app");
const native = tsx.filter((f) => /(^|[^.\w])(window\.)?prompt\(/m.test(read(f)));
ok(!native.length, "không còn hộp prompt() của trình duyệt", native);

ok(/streaming=\{live && i === blocks\.length - 1\}/.test(read("app/agentui.tsx")), "Synchro Code: bước đang viết vẫn hiện chữ dần");
ok(/streaming=\{!n\.done\}/.test(read("app/codeview.tsx")), "Synchro Code: câu trả lời đang viết vẫn hiện chữ dần");
ok(/streaming=\{!art\.complete\}/.test(read("app/artifactui.tsx")), "Artifact đang viết vẫn hiện chữ dần");

const page = read("app/home.tsx");
ok(/<button className="pj-tg"[^>]*aria-expanded=\{open\}/.test(page), "nút thu gọn dự án là nút thật, báo trạng thái mở");
ok(!/<span className="pj-tg" role="button"/.test(page), "không còn nút lồng trong nút ở dòng dự án");
const lb = read("app/filemenu.tsx");
ok(/className="overlay ft-lightbox"/.test(lb) && /role="dialog" aria-modal="true" aria-label="Xem ảnh"/.test(lb), "hộp xem ảnh dùng cơ chế hộp thoại chung");

// U8: khung xem Excel / CSV luôn có thanh cuộn ngang mảnh (cột F trở đi không bị cắt im lặng) và nút "Vừa chiều rộng" có bản tiếng Anh.
{
  const { officeview: OV } = await loadTs(["officeview"]);
  const doc = OV.officeDoc("xlsx", "a.xlsx", "https://x.test", "ch", (s) => en(s) ?? s, "en-US");
  ok(/\.sheet\{[^}]*overflow-x:scroll;overflow-y:auto/.test(doc) && /\.sheet::-webkit-scrollbar\{[^}]*height:10px/.test(doc), "bảng tính: thanh cuộn ngang luôn hiện, dọc chỉ khi cần (không bắt buộc với bảng ngắn)");
  ok(/scrollbar-width:thin/.test(doc), "bảng tính: Firefox cũng có thanh cuộn mảnh");
  ok(OV.STRINGS.includes("Vừa chiều rộng") && OV.STRINGS.includes("Kích thước thật"), "nút Vừa chiều rộng / Kích thước thật đi qua bộ dịch của khung xem");
  ok(doc.includes('"Vừa chiều rộng":"Fit width"') && doc.includes('"Kích thước thật":"Actual size"'), "khung xem tiếng Anh nhận nhãn Fit width / Actual size");
  ok(/function applyFit\(\)/.test(doc) && /zin\.style\.zoom=fit\?/.test(doc), "Vừa chiều rộng thu cả bảng lẫn biểu đồ theo khung");
  // render() có biến pane riêng (khung cố định của tệp Excel): lớp bọc phải tên khác, không thì bảng không hiện (appendChild trên null).
  ok(!/\bpane\.(appendChild|innerHTML|style)/.test(doc), "lớp bọc bảng không trùng tên biến pane của render()");
}

// U11: chip nguồn — favicon hỏng / 1×1 thành chữ cái đầu trên nền trung tính; tối đa 6 chip, còn lại "+N nguồn".
{
  const c = read("app/cites.tsx"), css = read("app/synchro-ds.css");
  ok(/onLoad=\{\(e\) => \{ if \(e\.currentTarget\.naturalWidth < 2/.test(c) && /onError=\{\(\) => setBad\(true\)\}/.test(c), "favicon: ảnh lỗi hoặc ảnh 1×1 chuyển sang chữ cái đầu");
  ok(/export const SHOWN_SOURCES = 6;/.test(c) && /tr\(`\+\$\{more\} nguồn`\)/.test(c), "tối đa 6 chip nguồn, phần còn lại gom vào +N nguồn");
  ok(/\.msg-sources a\[hidden\]\{display:none\}/.test(css), "chip ẩn thật sự ẩn (hidden thắng display:inline-flex)");
  ok(/\.src-fav-l\{[^}]*background:var\(--pill\)/.test(css), "chữ cái đầu trên nền trung tính");
  ok(en("+6 nguồn") === "+6 sources" && en("+1 nguồn") === "+1 source", "bản tiếng Anh của +N nguồn", en("+6 nguồn"));
}

// U12: trang Speech không còn trống 2 giây chờ gói ElevenLabs — bố cục và khối giả hiện ngay, gói chỉ điền phần credit / công cụ.
{
  const v = read("app/speech/view.tsx"), p = read("app/speech/parts.tsx"), css = read("app/speech/speech.css");
  ok(/const planFailed = usePlanFailed\(\);\s*const waiting = !plan && !planFailed;/.test(v), "Speech: biết lúc gói còn đang đọc (hook gọi vô điều kiện)");
  ok(/if \(!plan && !failed\) return \(\s*<div className="sp-home" aria-busy="true">/.test(v) && /\{recentList\}\s*<\/div>\s*\);\s*if \(!plan \|\| !plan\.connected\)/.test(v), "Speech: trang chính dựng ngay ô soạn, thẻ công cụ, mục Gần đây trong lúc chờ gói");
  ok(/waiting && <span className="sk-blk sp-credit-wait"/.test(v) && /waiting && \[[\d, ]+\]\.map\(\(w, i\) => <span key=\{i\} className="sk-blk sp-tab-wait"/.test(v), "Speech: chỗ credit và thanh công cụ có khối giả");
  ok(!/<Spin \/> Đang đọc gói ElevenLabs…/.test(p) && /export function ToolWait\(\)/.test(p), "Speech: trang công cụ chờ gói bằng khung giả, không còn chỉ một vòng xoay");
  ok(/\.sp-credit-wait \{/.test(css) && /\.sp-wait-card \{/.test(css), "Speech: kiểu khối giả có trong speech.css");
}

// U13: sơ đồ Mermaid trong câu trả lời không cao hơn màn hình; có nút phóng to cả màn hình.
{
  const md = read("app/md.tsx"), css = read("app/globals.css");
  ok(/if \(lang === "mermaid"\) return <MermaidCard code=\{code\} \/>;/.test(md), "sơ đồ Mermaid trong chat dùng khung có nút phóng to");
  ok(/\.viz-mm \.art-mermaid svg\{max-height:min\(70vh,520px\)\}/.test(css), "sơ đồ cao tối đa min(70vh, 520px)");
  ok(/aria-label=\{tr\("Phóng to sơ đồ"\)\}/.test(md) && /role="dialog" aria-modal="true" aria-label=\{tr\("Sơ đồ"\)\}/.test(md) && /e\.key === "Escape"/.test(md), "nút phóng to có tên, khung cả màn hình là hộp thoại có tên, Esc đóng");
  ok(en("Phóng to sơ đồ") === "Enlarge diagram", "bản tiếng Anh của nút phóng to");
}

// U14: trợ năng — vùng bấm 44px trên màn cảm ứng, chữ tối thiểu 12px, nút đóng có tên, hộp xác nhận (Đăng xuất?) có tên.
{
  const cssFiles = ["app/globals.css", "app/synchro-ds.css", "app/features.css", "app/codeview.css", "app/brainview.css", "app/glass.css", "app/speech/speech.css", "app/download/download.css"];
  // Ngoại lệ: chỉ hình minh họa thu nhỏ thuần túy — trang tải về (.dl-win / .dl-phone) và ảnh thu nhỏ tài liệu Markdown (.art-thumb-doc, inert + aria-hidden) —
  // không phải chữ để đọc. Nhãn loại tệp trong ô 28–30px (.out-badge.sm, .art-head .out-badge) LÀ chữ để đọc nên không còn được miễn, phải ≥12px.
  const small = [];
  for (const f of cssFiles) for (const m of read(f).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/\.dl-(win|phone)|\.art-thumb-doc/.test(m[1])) continue;
    for (const d of m[2].matchAll(/font(?:-size)?:\s*(?:[a-z]+\s+|\d{3}\s+)*(\d+(?:\.\d+)?)px/g)) if (Number(d[1]) < 12) small.push(`${f}: ${m[1].trim().slice(-50)} ${d[0]}`);
  }
  ok(!small.length, "không còn cỡ chữ dưới 12px", small.slice(0, 10).join("\n"));
  ok(/@media \(pointer:coarse\)\{\s*html body :is\(\.icon-btn,\.menu-item,\.nav-item\):not\(\.auth-root \*\),\.auth-root :is\(\.icon-btn,\.menu-item,\.nav-item\)\{min-width:44px;min-height:44px\}/.test(read("app/synchro-ds.css")), "màn cảm ứng: nút biểu tượng, mục menu, mục điều hướng tối thiểu 44×44");
  const unnamed = [];
  for (const f of tsx) {
    const src = read(f);
    for (const m of src.matchAll(/<button\b/g)) {
      let d = 0, q = null, j = m.index + 1;
      for (; j < src.length; j++) { const c = src[j]; if (q) { if (c === q) q = null; } else if ((c === '"' || c === "'") && !d) q = c; else if (c === "{") d++; else if (c === "}") d--; else if (c === ">" && !d) break; }
      const tag = src.slice(m.index, j + 1);
      if (tag.includes("aria-label") || tag.endsWith("/>")) continue;
      const inner = src.slice(j + 1, src.indexOf("</button>", j)).trim();
      if (/^(<I\.(X|Close)\b[^<]*\/>|×|✕)$/.test(inner)) unnamed.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  ok(!unnamed.length, "nút đóng chỉ có dấu × đều có aria-label", unnamed.join(", "));
  const mo = read("app/modals.tsx");
  ok(/role="alertdialog" aria-modal="true" aria-labelledby=\{`\$\{id\}-t`\} aria-describedby=\{`\$\{id\}-d`\}/.test(mo) && /<h2 id=\{`\$\{id\}-t`\}/.test(mo), "hộp xác nhận (Đăng xuất?) có tên và mô tả");
  // R13/INT-4: StrictMode gắn–gỡ–gắn lại cùng ref; cờ "đã đóng" phải đặt lại khi gắn, không thì Đăng xuất (xóa dữ liệu) kẹt ở "Đang lưu lên máy chủ…".
  const lo = mo.slice(mo.indexOf("export function LogoutConfirm"), mo.indexOf("export function LogoutConfirm") + 2000);
  ok(/useEffect\(\(\) => \{ dead\.current = false; return \(\) => \{ dead\.current = true; \}; \}, \[\]\)/.test(lo), "hộp Đăng xuất: cờ đã đóng đặt lại khi gắn (StrictMode)");
  ok(/dead\.current = false;\n\s*setBusy\(true\)/.test(lo), "hộp Đăng xuất: bấm Đăng xuất đặt lại cờ trước khi đẩy dữ liệu");
}

console.log(`\n${pass} đạt, ${fail} hỏng`);
if (fail) process.exit(1);
