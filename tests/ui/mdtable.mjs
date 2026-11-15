// Bảng trong câu trả lời đo bằng Chrome ẩn trên HTML tĩnh với đúng app/_shell/globals.css, không cần máy chủ: chữ trong ô không vỡ từng ký tự, bảng rộng cuộn ngang được, đoạn văn thường vẫn không tràn.
// Chạy tay: node tests/ui/mdtable.mjs
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x).slice(0, 700)); };
const css = readFileSync(new URL("../../app/_shell/globals.css", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "synchro-mdtable-"));
const LONG = "Mô tả rất dài về công việc đang làm ở bước này, kèm giải thích thêm để cột chữ chiếm gần hết chiều ngang của khung chat. ".repeat(2);
const row = (a) => `<tr><td>${a}</td><td>${LONG}</td><td>${LONG}</td></tr>`;
const table = (w) => `<div class="ai-msg" style="width:${w}px" data-w="${w}"><div><div class="md-tbl tight"><table><thead><tr><th><button class="md-th">Trạng thái</button></th><th><button class="md-th">Mô tả</button></th><th><button class="md-th">Ghi chú</button></th></tr></thead><tbody>${row("Hoàn thành")}${row("<a href='#x'>Đang chạy</a>")}${row("<code class='ic'>npm test</code>")}</tbody></table></div>
<div class="md-tbl wide"><table><thead><tr>${Array.from({ length: 8 }, (_, k) => `<th><button class="md-th">Cột${k}Tênrấtdàikhôngngắt</button></th>`).join("")}</tr></thead><tbody><tr>${Array.from({ length: 8 }, (_, k) => `<td>giá_trị_dài_liền_nhau_${k}</td>`).join("")}</tr></tbody></table></div>
<p class="plain">${"A".repeat(600)}</p><p class="plain"><a href="#y">https://example.com/${"b".repeat(400)}</a></p></div></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>${table(720)}${table(340)}<pre id="out"></pre><script>
const lines = (el) => { const r = document.createRange(), n = el.firstChild; const w = (el.textContent || "").split(/\\s+/).filter(Boolean); let at = 0, out = []; const t = el.textContent;
  for (const x of w) { const i = t.indexOf(x, at); at = i + x.length; r.setStart(n, i); r.setEnd(n, at); out.push([x, new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size]); } return out; };
const textEl = (td) => { let e = td; while (e.firstElementChild) e = e.firstElementChild; return e; };
document.getElementById("out").textContent = JSON.stringify([...document.querySelectorAll(".ai-msg")].map((m) => {
  const t = m.querySelector(".tight"), wide = m.querySelector(".wide");
  const cells = [...t.querySelectorAll("tr > :first-child")].map(textEl);
  return { w: +m.dataset.w, words: cells.flatMap(lines), col: t.querySelector("td").getBoundingClientRect().width, tight: [t.scrollWidth, t.clientWidth], wide: [wide.scrollWidth, wide.clientWidth], plain: [...m.querySelectorAll(".plain")].map((p) => [p.scrollWidth, p.clientWidth]), msg: [m.scrollWidth, m.clientWidth] };
}));
</script>`;
const file = join(dir, "t.html");
writeFileSync(file, html);
const out = await new Promise((y, n) => execFile(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--user-data-dir=${join(dir, "prof")}`, "--no-first-run", "--no-default-browser-check", "--window-size=1200,900", "--virtual-time-budget=1500", "--dump-dom", "file://" + file], { maxBuffer: 1 << 26, timeout: 60000 }, (e, so) => (e ? n(e) : y(so))));
const m = /<pre id="out">(.*?)<\/pre>/s.exec(out);
if (!m) throw new Error("không đọc được kết quả đo");
const res = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
for (const r of res) {
  console.log(`Khung ${r.w}px (cột đầu ${Math.round(r.col)}px)`);
  const broken = r.words.filter((x) => x[1] > 1);
  ok(r.words.length >= 8 && !broken.length, "chữ, link, mã trong ô không bị bẻ giữa từ", r.words);
  ok(r.wide[0] > r.wide[1] + 50, "bảng nhiều cột rộng cuộn ngang được", r.wide);
  ok(r.wide[1] <= r.w && r.tight[1] <= r.w, "bảng không làm khung chat rộng ra", { wide: r.wide, tight: r.tight });
  ok(r.plain.every(([s, c]) => s <= c), "chuỗi dài trong đoạn văn vẫn xuống dòng, không tràn", r.plain);
  ok(r.msg[0] <= r.msg[1], "cả khung câu trả lời không tràn ngang", r.msg);
}
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} đúng, ${fail} sai`);
if (fail) process.exit(1);
