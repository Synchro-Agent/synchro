// W10 nhóm C (H1 lỗi 6, 16): bộ slide tràn khung 1280×720 mà check_artifact và hội đồng phản biện không thấy, đánh số slide lệch sau bản sửa,
// phản biện báo nhầm lỗi số liệu, phản biện viết tiếng Việt khi giao diện tiếng Anh.
// Không cần máy chủ: hàm thuần (decknum, deckfit, critic) + mã PROBE thật của check_artifact chạy trong Chrome ẩn (bỏ qua phần đó nếu máy không có Chrome).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";
import { openChrome, sleep } from "../lib/cdp.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { decknum, deckfit, critic, artdoc, artprobe, i18n_dict: dict } = await loadTs(["decknum", "deckfit", "critic", "artdoc", "artprobe", "shared/i18n-dict"]).then((m) => ({ ...m, i18n_dict: m["shared/i18n-dict"] }));

// Bộ slide kiểu T8: bìa + các slide có nhãn mục "0n · …" và chân trang "0n / 06". Slide cao theo nội dung (min-height:100vh), slide 6 nhiều chữ.
const deck = ({ brows, pages, total = Math.max(brows.length, pages.length), long = 0 }) => `<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0;font:20px/1.4 system-ui}
.slide{min-height:100vh;padding:56px 72px 80px;display:flex;flex-direction:column;gap:18px;position:relative;background:#fbf7f0;color:#1d1d1b}
.eyebrow{font:600 14px/1 system-ui;letter-spacing:.12em;color:#b23a12}
h2{font-size:48px;margin:0}
.foot{position:absolute;left:72px;right:72px;bottom:28px;display:flex;justify-content:space-between;font-size:14px;color:#555}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:#fff;border:1px solid #ddd;padding:18px;min-height:150px}
</style></head><body>
${Array.from({ length: total }, (_, k) => `<section class="slide">
  ${brows[k] ? `<div class="eyebrow">${brows[k]}</div>` : ""}
  <h2>${k === 0 ? "Trà Một Chạm" : `Phần ${k}`}</h2>
  <p>Giao trà sữa bằng xe điện trong 18 phút ở nội thành Hà Nội.</p>
  ${k === long ? `<div class="row">${Array.from({ length: 6 }, (_, i) => `<div class="card"><b>Mốc ${i + 1}</b><p>Tháng ${3 * (i + 1)}: mở thêm micro-hub, tuyển 40 tài xế, phủ 3 cụm quận.</p></div>`).join("")}</div><p>Mục tiêu: 3 micro-hub, 12.000 đơn mỗi tháng.</p>` : ""}
  ${pages[k] ? `<div class="foot"><span>Trà Một Chạm · minh hoạ</span><span>${pages[k]}</span></div>` : ""}
</section>`).join("\n")}
</body></html>`;

console.log("1. Đánh số slide (decknum)");
{
  const T8v2 = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế đơn vị", "04 · Thị trường", "05 · Vòng vốn đề nghị"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  const s = decknum.deckSlides(T8v2);
  ok(s.length === 6 && s[0].line > 1 && s[1].line > s[0].line, "tách đúng 6 slide, có số dòng", JSON.stringify(s.map((x) => x.line)));
  const iss = decknum.numberingIssues(T8v2);
  ok(iss.length === 1 && iss[0].kind === "mixed" && iss[0].slides.join() === "2,3,4,5,6" && iss[0].vars.brows === "01–05" && iss[0].vars.pages === "02–06 / 06", "T8 bản 2: nhãn mục 01–05 lệch chân trang 02/06–06/06 → báo một lỗi", JSON.stringify(iss));
  ok(/nhãn mục và số trang lệch nhau/.test(iss[0]?.prompt ?? ""), "câu báo cho model nói rõ lệch gì", iss[0]?.prompt);
  const good = deck({ brows: ["", "02 · Vấn đề", "03 · Giải pháp", "04 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  ok(decknum.numberingIssues(good).length === 0, "nhãn mục trùng số trang, đúng thứ tự → không báo", JSON.stringify(decknum.numberingIssues(good)));
  const sectionsOnly = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "04 · Thị trường", "05 · Gọi vốn"], pages: [] });
  ok(decknum.numberingIssues(sectionsOnly).length === 0, "chỉ có nhãn mục (bìa không đánh số) → không báo");
  // Bản sửa bỏ một slide nhưng chỉ đánh số lại một phần (kiểu bản 1 → bản 2 hỏng).
  const patched = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 07", "03 / 07", "04 / 07", "06 / 07", "06 / 06"] });
  const kinds = decknum.numberingIssues(patched).map((x) => x.kind).sort().join();
  ok(/brow/.test(kinds) && /order/.test(kinds) && /total/.test(kinds), "đánh số lại một phần: nhãn mục nhảy cóc, số trang sai thứ tự, tổng không đồng nhất", kinds);
  const wrongTotal = deck({ brows: [], pages: ["01 / 07", "02 / 07", "03 / 07", "04 / 07", "05 / 07", "06 / 07"] });
  const wt = decknum.numberingIssues(wrongTotal);
  ok(wt.length === 1 && wt[0].kind === "count" && wt[0].vars.of === 7 && wt[0].vars.total === 6, "chân trang ghi / 07 mà bộ có 6 slide → báo tổng sai", JSON.stringify(wt));
  const agenda = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "04 · Thị trường"], pages: ["", "02 / 05", "03 / 05", "04 / 05", "05 / 05"] }).replace("<h2>Phần 1</h2>", "<h2>Phần 1</h2><ol><li>01 · Vấn đề</li><li>02 · Giải pháp</li></ol>");
  ok(decknum.slideNumbers(decknum.deckSlides(agenda))[1].brow === null, "slide liệt kê nhiều số (mục lục) thì bỏ qua nhãn mục của slide đó");
  ok(decknum.deckSlides('<div class="slide-title">a</div><div class="slides"><section class="slide">1</section><section class="slide x">2</section></div>').length === 2, "lớp slide-title / slides không bị coi là slide");
  ok(decknum.numberingIssues("<p>không phải bộ slide</p>").length === 0, "trang không phải bộ slide → không báo");
}

console.log("1b. read_artifact báo đánh số lệch (không cần Chromium)");
{
  process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "synchro-deckq-")); process.env.DATA_KEY ??= "deck-quality-test";
  const { artcheck: A } = await loadTs(["artcheck"]);
  const art = (content, complete = true) => ({ ident: "pitch", title: "Pitch", type: "html", lang: null, content, complete, v: 2 });
  const bad = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "04 · Thị trường", "05 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  const r = A.readArtifact(art(bad), {});
  ok(/<deck_numbering>/.test(r.content) && /Slide 2, 3, 4, 5, 6: đánh số slide không nhất quán/.test(r.content) && r.content.indexOf("<deck_numbering>") > r.content.indexOf("</artifact_source>"), "bộ slide đánh số lệch → read_artifact kèm <deck_numbering> sau mã nguồn", r.content.slice(-400));
  const good = deck({ brows: ["", "02 · Vấn đề", "03 · Giải pháp", "04 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  ok(!/<deck_numbering>/.test(A.readArtifact(art(good), {}).content), "đánh số đúng → không có thẻ");
  ok(!/<deck_numbering>/.test(A.readArtifact(art(bad, false), {}).content), "bản chưa viết xong → không báo");
  ok(/<deck_numbering>/.test(A.ARTCHECK_RULES(false)) && /đánh số lại MỌI nhãn số/.test(A.ARTCHECK_RULES(true)), "quy tắc self_check nhắc đánh số lại khi sửa bằng patch");

  console.log("1c. Tự kiểm bộ slide lúc model định trả lời xong (autoDeckCheck / <auto_check>)");
  delete process.env.CODE_RUN; // máy kiểm thử: không có workspace, chỉ phần đánh số (đọc mã)
  const turn = {};
  const row = await A.autoDeckCheck("u1", turn, art(bad), "http://x");
  ok(/Bộ slide "Pitch" \(identifier "pitch", phiên bản 2\)/.test(row ?? "") && /Đánh số slide không nhất quán:\n- Slide 2, 3, 4, 5, 6/.test(row ?? ""), "bộ slide đánh số lệch → một mục nêu tên, phiên bản và slide lệch", row);
  ok(await A.autoDeckCheck("u1", {}, art(good), "http://x") === null, "bộ slide sạch lỗi → không nhắc (không tốn thêm một bước của model)");
  ok(await A.autoDeckCheck("u1", {}, art(bad, false), "http://x") === null && await A.autoDeckCheck("u1", {}, { ...art(bad), type: "react" }, "http://x") === null, "chưa viết xong / không phải bộ slide → bỏ qua");
  const seen = {};
  A.checkRoundGate(seen, art(bad));
  ok(A.checkedInTurn(seen, art(bad)) && await A.autoDeckCheck("u1", seen, art(bad), "http://x") === null, "bản này đã check_artifact trong lượt (model đã thấy kết quả) → không nhắc lại");
  ok(!A.checkedInTurn(seen, art(good)), "bản khác (đã sửa) thì chưa tính là đã kiểm");
  // Số đo khung có sẵn (check_artifact đo trước đó trong tiến trình): slide tràn được nêu trong lời nhắc.
  const tall = deck({ brows: [], pages: [], total: 3 }) + "<!-- tall -->";
  A.rememberLayout(tall, { fit: [1, 2, 3].map((n) => ({ slide: n, h: n === 3 ? 869 : 720, w: 1280, vh: 720, vw: 1280 })), issues: [] });
  const r2 = await A.autoDeckCheck("u1", {}, art(tall), "http://x");
  ok(/slide 3 TRÀN — cao 869px \(thừa 149px so với khung 720px\)/.test(r2 ?? "") && /vừa khung: slide 1–2/.test(r2 ?? ""), "slide tràn khung 1280×720 → nêu đúng slide và số px thừa", r2);
  const msg = A.AUTO_CHECK([row]);
  ok(/^<auto_check>/.test(msg) && /mode="patch"/.test(msg) && /đánh số lại MỌI nhãn số/.test(msg) && /cố ý giữ nguyên thì nói rõ lý do/.test(msg), "lời nhắc <auto_check>: sửa đúng slide, được dùng bản patch, hoặc nói lý do giữ nguyên");
  const tools = fs.readFileSync("server/chat/tools.ts", "utf8"), routing = fs.readFileSync("server/chat/routing.ts", "utf8");
  ok(/if \(i < steps - 1 && x\.art && !x\.deckGated\) \{\n\s+const g = await deckGate\(x, r\.text\);\n\s+if \(g\) \{ sayOut\(x, r\.text\); m\.push\(\{ role: "user", content: g \}\); continue; \}/.test(tools), "vòng công cụ (khóa API): câu trả lời cuối có bộ slide lỗi → nhắc model sửa, giữ lời đã viết");
  ok(/else if \(x && !x\.deckGated && \(gate = await deckGate\(x, said\)\)\) next = gate;/.test(routing), "lượt của gói CLI (cầu nối): cũng tự kiểm bộ slide trước khi giao");
  ok(/x\.deckGated = true;/.test(tools) && /\[\.\.\.\(x\.turnArts \?\? \[\]\), text\]/.test(tools), "một lần mỗi lượt; xét cả bộ slide viết giữa lượt");
}

console.log("2. Số đo khung từng slide (deckfit)");
{
  const fit = [1, 2, 3, 4, 5].map((n) => ({ slide: n, h: 720, w: 1280, vh: 720, vw: 1280 })).concat([{ slide: 6, h: 869, w: 1280, vh: 720, vw: 1280 }, { slide: 7, h: 726, w: 1280, vh: 720, vw: 1280 }]);
  const line = deckfit.fitSummary(fit);
  ok(/slide 6 TRÀN — cao 869px \(thừa 149px so với khung 720px\)/.test(line) && /slide 7 TRÀN — cao 726px/.test(line) && /vừa khung: slide 1–5/.test(line), "báo từng slide: slide 6, 7 tràn bao nhiêu px; 1–5 vừa", line);
  ok(/cả 3 slide đều vừa khung/.test(deckfit.fitSummary(fit.slice(0, 3))) && deckfit.fitSummary([]) === "", "không tràn → một dòng 'đều vừa khung'; chưa đo → rỗng");
  ok(deckfit.overflowing([{ slide: 1, h: 723, w: 1280, vh: 720, vw: 1280 }]).length === 0, "lệch trong dung sai 4px không tính");
}

console.log("3. Phản biện: tự tính lại lỗi số liệu (critic.checkMath)");
{
  const F = (title, detail, math, severity = "medium") => ({ line_start: 1, line_end: 1, severity, title, detail, suggested_fix: "", ...(math ? { math } : {}) });
  ok(critic.parseNum("32.000") === 32000 && critic.parseNum("25,910.00") === 25910 && critic.parseNum("1,5") === 1.5 && critic.parseNum("0.105") === 0.105 && critic.parseNum("32k") === 32 && critic.parseNum("68.965.000 ₫".replace(" ", "")) === 68965000 && critic.parseNum("abc") === null, "đọc số kiểu Việt / kiểu Anh / kèm đơn vị");
  ok(critic.evalExpr("11+7+5+3+6") === 32 && critic.evalExpr("(5 × 8.000) − 1.000") === 39000 && critic.evalExpr("32") === null && critic.evalExpr("a+b") === null, "tính phép tính đơn giản; không phải phép tính → null");
  const T8 = F("Tổng các thành phần không khớp giá trị đơn hàng", "Các thành phần chi phí không cộng ra 32k.", { expr: "11+7+5+3+6", shown: "32k" });
  const real = F("Tổng lương không khớp", "Dòng tổng ghi 68.000.000 nhưng cộng ra 68.965.000.", { expr: "12.000.000+14.500.000+13.200.000+15.765.000+13.500.000", shown: "68.000.000" });
  const bare = F("Số liệu sai", "Tổng không khớp.", null, "high");
  const other = F("Thiếu phím tắt", "Không chuyển slide bằng bàn phím được.", null, "high");
  const out = critic.checkMath([T8, real, bare, other]);
  ok(!out.includes(T8), "T8: 11+7+5+3+6 = 32 khớp 32k → bỏ mục báo nhầm", JSON.stringify(out.map((f) => f.title)));
  ok(out.includes(real), "lệch thật (68.965.000 ≠ 68.000.000) → giữ");
  ok(out.find((f) => f.title === "Số liệu sai")?.severity === "low", "nêu lỗi số liệu mà không kèm phép tính → hạ xuống Gợi ý");
  ok(out.find((f) => f.title === "Thiếu phím tắt")?.severity === "high", "mục không phải số liệu giữ nguyên");
  const parsed = critic.parseFindings('{"findings":[{"line_start":2,"title":"Tổng không khớp","math":{"expr":"1+2","shown":3}}]}', 5);
  ok(parsed?.[0]?.math?.expr === "1+2" && parsed[0].math.shown === "3", "đọc trường math trong JSON của model", JSON.stringify(parsed));
}

console.log("4. Phản biện theo ngôn ngữ giao diện, kèm số đo của Synchro");
{
  const route = fs.readFileSync("app/api/critic/route.ts", "utf8"), home = fs.readFileSync("ui/home.tsx", "utf8");
  ok(/auto, ui: getLang\(\) \}\)/.test(home), "giao diện gửi ngôn ngữ đang dùng (ui) khi nhờ phản biện");
  ok(/LANGS\.find\(\(l\) => l === b\.ui\)/.test(route) && /\.replace\("\{LANG\}", WRITE_IN\[lang\]\)/.test(route) && /en: "Write title and detail in English/.test(route), "lời nhắc phản biện đổi theo ngôn ngữ giao diện (tiếng Anh khi giao diện tiếng Anh)");
  ok(!/ngôn ngữ của người dùng \(mặc định tiếng Việt\)/.test(route), "bỏ câu cũ 'mặc định tiếng Việt'");
  ok(/checkMath\(findings\)/.test(route) && /"math": \{"expr"/.test(route), "phản biện phải kèm phép tính, máy chủ tự tính lại");
  ok(/measureDeck\(/.test(route) && /deckFacts\(known, nums\)/.test(route) && /deckFindings\(content, lay, nums, lang\)/.test(route), "bộ slide: số đo khung + đánh số vào phản biện");
  // Mọi khóa tfOn / trOn của phản biện có bản dịch tiếng Anh.
  const keys = [...route.matchAll(/(?:tfOn|trOn)\("([^"]+)"/g)].map((m) => m[1]);
  const miss = keys.filter((k) => !dict.VI2EN[k]);
  ok(keys.length >= 9 && !miss.length, `${keys.length} câu của lỗi Synchro tự đo đều có bản tiếng Anh`, miss.join(" | "));
}

console.log("5. check_artifact đo khung 1280×720 thật (Chrome ẩn, mã PROBE thật)");
const CHROME = process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
if (!fs.existsSync(CHROME)) console.log("  (bỏ qua: máy không có Chrome)");
else {
  const probeOf = (src) => { const m = /const PROBE = String\.raw`([\s\S]*?)`;\n/.exec(src); if (!m) throw new Error("không thấy PROBE"); return m[1].replace("${DESIGN_PROBE}", artprobe.DESIGN_PROBE); };
  const PROBE = probeOf(fs.readFileSync("server/artcheck.ts", "utf8"));
  // Bản trước (w9-integ) để chứng minh nguyên nhân: slide tự dài ra nên scrollHeight = clientHeight, PROBE cũ không thấy.
  let OLD = null;
  try { OLD = probeOf(execFileSync("git", ["show", "w9-integ:server/artcheck.ts"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch {}
  const t = await openChrome({ base: "about:blank", port: 9300 + (process.pid % 500), name: `deckq-${process.pid}` });
  try {
    await t.size(1280, 720);
    const html = artdoc.buildDocCore("html", deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "04 · Thị trường", "05 · Lợi thế vận hành", "06 · Gọi vốn"], pages: ["", "02 / 07", "03 / 07", "04 / 07", "05 / 07", "06 / 07", "07 / 07"], long: 5 }), "https://synchro.test", "t", false, "", { fixed: null }, "Deck");
    await t.P("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await t.until("!!window.__sxAll && window.__sxAll().length === 7", 15000);
    const run = async (src) => {
      const res = [];
      for (let i = 0; i < 7; i++) {
        await t.ev(`window.__sxGo(${i})`); await sleep(120);
        const issues = await t.ev(`(${src})(window.__sxCur(), true)`);
        const fit = await t.ev(`(() => { const el = window.__sxCur(); const r = el.getBoundingClientRect(); return { h: Math.round(Math.max(r.height, el.scrollHeight)), w: Math.round(Math.max(r.width, el.scrollWidth)), vh: innerHeight, vw: innerWidth, sh: el.scrollHeight, ch: el.clientHeight }; })()`);
        res.push({ slide: i + 1, issues, fit });
      }
      return res;
    };
    const now = await run(PROBE);
    const s6 = now[5], over = (r) => r.issues.filter((x) => /tràn khỏi slide|slide tràn nội dung/.test(x.kind));
    console.log(`    slide 6: cao ${s6.fit.h}px, scrollHeight ${s6.fit.sh} = clientHeight ${s6.fit.ch}`);
    ok(s6.fit.h > 760 && s6.fit.sh <= s6.fit.ch + 4, "tái hiện T8: slide 6 tự dài ra quá 720px, scrollHeight bằng clientHeight", JSON.stringify(s6.fit));
    ok(over(s6).length > 0 && over(s6).some((x) => /> khung 720×1280px/.test(x.detail)), "PROBE mới: slide 6 báo phần tử tràn khỏi khung 720px", JSON.stringify(s6.issues));
    ok(now.filter((r, i) => i !== 5 && over(r).length).length === 0, "các slide khác không bị báo tràn", JSON.stringify(now.filter((r) => over(r).length).map((r) => r.slide)));
    ok(!s6.issues.some((x) => x.kind === "chữ tràn ra ngoài slide"), "slide quá cao báo gọn ở mục phần tử tràn, không liệt kê từng dòng chữ", JSON.stringify(s6.issues.map((x) => x.kind)));
    const fitLine = deckfit.fitSummary(now.map((r) => ({ slide: r.slide, h: r.fit.h, w: r.fit.w, vh: r.fit.vh, vw: r.fit.vw })));
    console.log("    " + fitLine.slice(0, 200));
    ok(/slide 6 TRÀN/.test(fitLine) && !/slide [1-57] TRÀN/.test(fitLine), "dòng 'Đo khung từng slide' chỉ ra đúng slide 6", fitLine);
    if (OLD) {
      const before = await run(OLD);
      ok(over(before[5]).length === 0, "PROBE cũ (w9-integ) không thấy slide 6 tràn — đúng lỗi H1", JSON.stringify(before[5].issues));
    } else console.log("  (bỏ qua so sánh với bản cũ: không đọc được w9-integ)");
  } finally { t.close(); }
}

if (/synchro-deckq-/.test(process.env.DATA_DIR ?? "")) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
