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

const page = read("app/page.tsx");
ok(/<button className="pj-tg"[^>]*aria-expanded=\{open\}/.test(page), "nút thu gọn dự án là nút thật, báo trạng thái mở");
ok(!/<span className="pj-tg" role="button"/.test(page), "không còn nút lồng trong nút ở dòng dự án");
const lb = read("app/filemenu.tsx");
ok(/className="overlay ft-lightbox"/.test(lb) && /role="dialog" aria-modal="true" aria-label="Xem ảnh"/.test(lb), "hộp xem ảnh dùng cơ chế hộp thoại chung");

// U8: khung xem Excel / CSV luôn có thanh cuộn ngang mảnh (cột F trở đi không bị cắt im lặng) và nút "Vừa chiều rộng" có bản tiếng Anh.
{
  const { officeview: OV } = await loadTs(["officeview"]);
  const doc = OV.officeDoc("xlsx", "a.xlsx", "https://x.test", "ch", (s) => en(s) ?? s, "en-US");
  ok(/\.sheet\{[^}]*overflow:scroll/.test(doc) && /\.sheet::-webkit-scrollbar\{[^}]*height:10px/.test(doc), "bảng tính: thanh cuộn ngang luôn hiện");
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

console.log(`\n${pass} đạt, ${fail} hỏng`);
if (fail) process.exit(1);
