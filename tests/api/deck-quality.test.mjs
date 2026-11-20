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
const { decknum, deckfit, critic, artdoc, artprobe, turnfold, i18n_dict: dict } = await loadTs(["decknum", "deckfit", "critic", "artdoc", "artprobe", "turnfold", "shared/i18n-dict"]).then((m) => ({ ...m, i18n_dict: m["shared/i18n-dict"] }));

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
  // T8 bản 2 (bìa không đánh số mục, nhãn 01–05 ở trang 02/06–06/06): chênh cố định một đơn vị là thiết kế có chủ ý (review W10), không báo.
  const T8v2 = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế đơn vị", "04 · Thị trường", "05 · Vòng vốn đề nghị"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  const s = decknum.deckSlides(T8v2);
  ok(s.length === 6 && s[0].line > 1 && s[1].line > s[0].line, "tách đúng 6 slide, có số dòng", JSON.stringify(s.map((x) => x.line)));
  ok(decknum.numberingIssues(T8v2).length === 0, "bìa không đánh số mục: nhãn 01–05 ở trang 02/06–06/06 (chênh cố định) → không báo", JSON.stringify(decknum.numberingIssues(T8v2)));
  // Một mục trải hai slide liền nhau (cùng nhãn 02): không báo, không bao giờ gợi ý nhãn "00".
  const span = deck({ brows: ["", "01 · Vấn đề", "02 · Thị trường", "02 · Thị trường", "03 · Đội ngũ", "04 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  ok(decknum.numberingIssues(span).length === 0, "mục trải hai slide (01, 02, 02, 03, 04) với chân trang 02–06 → không báo", JSON.stringify(decknum.numberingIssues(span)));
  const gap = deck({ brows: ["", "01 · Vấn đề", "", "02 · Giải pháp", "03 · Gọi vốn"], pages: ["", "02 / 05", "03 / 05", "04 / 05", "05 / 05"] });
  ok(decknum.numberingIssues(gap).length === 0, "slide không có nhãn mục xen giữa → không báo", JSON.stringify(decknum.numberingIssues(gap)));
  const kpi = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "04 · Gọi vốn"], pages: [] }).replace("<h2>Phần 2</h2>", "<h2>Phần 2</h2><div>05</div>");
  ok(decknum.numberingIssues(kpi).length === 0, "số đứng riêng (chỉ số KPI “05”) trong bộ dùng nhãn “0n · Tên” → không tính là nhãn mục", JSON.stringify(decknum.numberingIssues(kpi)));
  // Bỏ mục 03 mà nhãn mục chưa đánh lại (01, 02, 04, 05): báo nhảy cóc ở slide 4 và 5, gợi ý đúng 03, 04.
  const skip = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "04 · Kinh tế", "05 · Gọi vốn"], pages: ["", "02 / 05", "03 / 05", "04 / 05", "05 / 05"] });
  const iss = decknum.numberingIssues(skip);
  ok(iss.length === 1 && iss[0].kind === "brow" && iss[0].slides.join() === "4,5" && iss[0].vars.want === "03, 04", "nhãn mục nhảy cóc 02 → 04 → báo một lỗi ở slide 4, 5 (phải là 03, 04)", JSON.stringify(iss));
  ok(/slide 4 ghi “04”, theo thứ tự phải là “03”/.test(iss[0]?.prompt ?? ""), "câu báo cho model nói rõ slide nào, số nào", iss[0]?.prompt);
  const back = decknum.numberingIssues(deck({ brows: ["", "01 · A", "02 · B", "03 · C", "02 · D", "04 · E"], pages: [] }));
  ok(back.length === 1 && back[0].kind === "brow" && back[0].slides.join() === "5", "nhãn mục đi lùi (03 rồi 02) → báo đúng slide đó", JSON.stringify(back));
  const ahead = decknum.numberingIssues(deck({ brows: ["", "02 · A", "03 · B", "04 · C"], pages: ["", "01 / 04", "02 / 04", "03 / 04"] }));
  ok(ahead.some((x) => x.kind === "mixed"), "nhãn mục lớn hơn số trang (mục 02 ở trang 01) → báo lệch", JSON.stringify(ahead));
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
  const bad = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "04 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  const r = A.readArtifact(art(bad), {});
  ok(/<deck_numbering>/.test(r.content) && /Slide 4, 5, 6: đánh số slide không nhất quán/.test(r.content) && r.content.indexOf("<deck_numbering>") > r.content.indexOf("</artifact_source>"), "bộ slide đánh số lệch → read_artifact kèm <deck_numbering> sau mã nguồn", r.content.slice(-400));
  const good = deck({ brows: ["", "02 · Vấn đề", "03 · Giải pháp", "04 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 06", "03 / 06", "04 / 06", "05 / 06", "06 / 06"] });
  ok(!/<deck_numbering>/.test(A.readArtifact(art(good), {}).content), "đánh số đúng → không có thẻ");
  ok(!/<deck_numbering>/.test(A.readArtifact(art(bad, false), {}).content), "bản chưa viết xong → không báo");
  ok(/<deck_numbering>/.test(A.ARTCHECK_RULES(false)) && /đánh số lại MỌI nhãn số/.test(A.ARTCHECK_RULES(true)), "quy tắc self_check nhắc đánh số lại khi sửa bằng patch");

  console.log("1c. Tự kiểm bộ slide lúc model định trả lời xong (autoDeckCheck / <auto_check>)");
  delete process.env.CODE_RUN; // máy kiểm thử: không có workspace, chỉ phần đánh số (đọc mã)
  const turn = {};
  const row = await A.autoDeckCheck("u1", turn, art(bad), "http://x");
  ok(/Bộ slide "Pitch" \(identifier "pitch", phiên bản 2\)/.test(row ?? "") && /Đánh số slide không nhất quán:\n- Slide 4, 5, 6/.test(row ?? ""), "bộ slide đánh số lệch → một mục nêu tên, phiên bản và slide lệch", row);
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
  // Chỉ thứ bậc cỡ chữ yếu: không mở thêm lượt sửa (tốn khóa dùng chung / hạn mức miễn phí cho việc không ai yêu
  // cầu); có slide tràn thì lời nhắc kèm luôn thứ bậc yếu.
  const sized3 = (h, title) => [1, 2, 3].map((n) => ({ slide: n, h: n === 3 ? h : 720, w: 1280, vh: 720, vw: 1280,
    title, body: 20, lead: 20 }));
  const weakOnly = deck({ brows: [], pages: [], total: 3 }) + "<!-- weak -->";
  A.rememberLayout(weakOnly, { fit: sized3(720, 22), issues: [] });
  ok(await A.autoDeckCheck("u1", {}, art(weakOnly), "http://x") === null,
    "chỉ thứ bậc cỡ chữ yếu → không mở thêm lượt sửa");
  const weakTall = deck({ brows: [], pages: [], total: 3 }) + "<!-- weak tall -->";
  A.rememberLayout(weakTall, { fit: sized3(869, 22), issues: [] });
  const r3 = await A.autoDeckCheck("u1", {}, art(weakTall), "http://x") ?? "";
  const weakRow = /Tiêu đề không nổi hơn chữ thân:\n- Slide 1: thứ bậc cỡ chữ yếu — tiêu đề 22px/;
  ok(/slide 3 TRÀN/.test(r3) && weakRow.test(r3),
    "có slide tràn → lời nhắc kèm thứ bậc cỡ chữ yếu", r3);
  const msg = A.AUTO_CHECK([row]);
  ok(/^<auto_check>/.test(msg) && /mode="patch"/.test(msg) && /đánh số lại MỌI nhãn số/.test(msg), "lời nhắc <auto_check>: sửa đúng slide, được dùng bản patch");
  ok(/Người dùng không thấy tin nhắn này/.test(msg) && /Câu trả lời bạn vừa viết được giữ nguyên/.test(msg) && /Không nhắc tới bước tự kiểm/.test(msg) && msg.includes("chỉ trả lời đúng <keep/>"), "lời nhắc nói câu trả lời gốc được giữ, không nhắc tới bước tự kiểm, giữ nguyên thì trả lời <keep/>", msg);
  const tools = fs.readFileSync("server/chat/tools.ts", "utf8"), routing = fs.readFileSync("server/chat/routing.ts", "utf8");
  ok(/if \(i < steps - 1 && x\.art && !x\.deckGated\) \{\n\s+const g = await deckGate\(x, r\.text\);\n\s+if \(g\) \{ holdAnswer\(x, r\.text\); m\.push\(\{ role: "user", content: g \}\); continue; \}\n\s+\}\n\s+return \{ text: settleGate\(x, r\.text\), used \};/.test(tools), "vòng công cụ (khóa API): bộ slide lỗi → giữ câu trả lời đã viết, nhắc model sửa, cuối lượt gộp lại");
  ok(/else if \(x && !x\.deckGated && \(gate = await deckGate\(x, said\)\)\) \{ holdAnswer\(x, said\); next = gate; \}/.test(routing) && /settleGate\(x, String\(\(r\.json as J\)\.text \?\? ""\), !!\(r\.json as J\)\.cancelled\)/.test(routing), "lượt của gói CLI (cầu nối): cũng giữ câu trả lời và gộp phần sửa");
  ok(/return \{ text: settleGate\(x, liveNow\(\), true\), used, cancelled: true \}/.test(tools) && /if \(x\.held\) return \{ text: settleGate\(x, "", true\), used \}/.test(tools) && /x\?\.held \? settleGate\(x, "", true\)/.test(routing), "dừng / lỗi / hết bước khi đang sửa → giao câu trả lời gốc");
  ok(/live: turnLive\(x, liveNow\(\)\)/.test(tools), "read_artifact / check_artifact sau lời nhắc vẫn thấy bộ slide trong câu trả lời đang giữ");
  ok(/x\.deckGated = true;/.test(tools) && /\[\.\.\.\(x\.turnArts \?\? \[\]\), text\]/.test(tools), "một lần mỗi lượt; xét cả bộ slide viết giữa lượt");
}

console.log("1d. Gộp phần sửa sau <auto_check> vào câu trả lời gốc (turnfold) — một thẻ artifact, giữ lời tóm tắt");
{
  const { foldFix, KEEP } = turnfold;
  const { artState } = (await loadTs(["vfs"])).vfs;
  const full = (body, ident = "d") => `<artifact identifier="${ident}" type="text/html" title="Deck">\n${body}\n</artifact>`;
  const patch = (a, b, ident = "d") => `<artifact identifier="${ident}" mode="patch">\n<<<<<<< SEARCH\n${a}\n=======\n${b}\n>>>>>>> REPLACE\n</artifact>`;
  const orig = `Đây là bộ slide gọi vốn:\n\n${full("<p>01 · A</p>\n<p>04 · B</p>")}\n\nBộ slide gồm bìa và hai mục, mỗi mục một ý chính.`;
  ok(foldFix(orig, [], KEEP).text === orig, "<keep/> → giao đúng câu trả lời gốc");
  ok(foldFix(orig, [], "Mình giữ cách đánh số này: bìa không đánh số mục.").text === orig, "chỉ nói lý do (lời đáp cho lời nhắc ẩn) → không đưa vào câu trả lời");
  const fx = foldFix(orig, [], `Mình đã chỉnh nhãn mục cho liền mạch.\n\n${patch("<p>04 · B</p>", "<p>02 · B</p>")}`);
  const arts = (t) => (t.match(/<artifact\b/g) ?? []).length;
  ok(arts(fx.text) === 1 && !/mode="patch"/.test(fx.text) && /<p>02 · B<\/p>/.test(fx.text) && !/04 · B/.test(fx.text), "bản sửa patch áp thẳng vào bản đầy đủ → một thẻ artifact đã sửa", fx.text);
  ok(fx.text.startsWith("Đây là bộ slide gọi vốn:") && /mỗi mục một ý chính\.\n\nMình đã chỉnh nhãn mục cho liền mạch\.$/.test(fx.text), "giữ lời dẫn và lời tóm tắt gốc, câu nói đã chỉnh gì nối phía sau", fx.text);
  const st = artState([fx.text]);
  ok(st.get("d")?.v === 1 && /02 · B/.test(st.get("d")?.content ?? ""), "khung xem: chỉ một phiên bản, đúng bản đã sửa (không còn thẻ “Phiên bản 1” trỏ về bản cũ)", JSON.stringify([...st.values()].map((a) => [a.v, a.content])));
  // Bộ slide viết giữa lượt (trước khi gọi check_artifact), câu trả lời cuối chỉ còn lời tóm tắt.
  const mid = foldFix("Xong rồi: bộ slide ở trên.", [full("<p>04 · B</p>")], patch("<p>04 · B</p>", "<p>02 · B</p>"));
  ok(mid.before.length === 1 && /02 · B/.test(mid.before[0]) && mid.text === "Xong rồi: bộ slide ở trên.", "bộ slide nằm ở phần viết giữa lượt → sửa ngay ở đó, lời tóm tắt giữ nguyên", JSON.stringify(mid));
  const failed = foldFix(orig, [], `Đã chỉnh.\n\n${patch("<p>không có</p>", "<p>x</p>")}`);
  ok(arts(failed.text) === 2 && /mode="patch"/.test(failed.text), "bản sửa không áp được → giữ riêng như trước (trình duyệt báo bản sửa lỗi)", failed.text);
  const onPatch = foldFix(`Đã sửa:\n\n${patch("<p>A</p>", "<p>B</p>")}`, [], patch("<p>B</p>", "<p>C</p>"));
  ok(arts(onPatch.text) === 1 && (onPatch.text.match(/<<<<<<< SEARCH/g) ?? []).length === 2, "câu trả lời gốc là bản sửa → nối các khối SEARCH/REPLACE vào cùng một bản sửa", onPatch.text);
  const rewrite = foldFix(orig, [], full("<p>01 · A</p>\n<p>02 · B</p>"));
  ok(arts(rewrite.text) === 1 && /02 · B/.test(rewrite.text) && /mỗi mục một ý chính\.$/.test(rewrite.text.trim()), "viết lại trọn bộ slide → thay đúng chỗ bản cũ", rewrite.text);
  ok(foldFix(orig, [], `Đang sửa\n\n<artifact identifier="d" mode="patch">\n<<<<<<< SEARCH\n<p>04`).text === orig, "bản sửa viết dở (dừng giữa chừng) → bỏ, giao câu gốc");
  // H1 lỗi 9 ngoài đường tự kiểm: bộ slide viết trọn giữa lượt, câu trả lời cuối chỉ có bản sửa → một thẻ (withTurnArts dùng foldPatches).
  const fp = turnfold.foldPatches([full("<p>04 · B</p>")], `Mình đã sửa slide 2:\n\n${patch("<p>04 · B</p>", "<p>02 · B</p>")}`);
  ok(fp.text === "Mình đã sửa slide 2:" && fp.arts.length === 1 && /02 · B/.test(fp.arts[0]) && !/mode="patch"/.test(fp.arts[0]), "bản đầy đủ giữa lượt + bản sửa cuối lượt → một thẻ đã sửa, giữ lời", JSON.stringify(fp));
  const chain = turnfold.foldPatches([full("<p>A</p>"), patch("<p>A</p>", "<p>B</p>")], patch("<p>B</p>", "<p>C</p>"));
  ok(/mode="patch"/.test(chain.text), "giữa lượt đã có bản sửa → không áp chồng sai thứ tự, để nguyên", JSON.stringify(chain));
  const nofit = turnfold.foldPatches([full("<p>A</p>")], patch("<p>Z</p>", "<p>C</p>"));
  ok(/mode="patch"/.test(nofit.text) && nofit.arts[0] === full("<p>A</p>"), "bản sửa không áp được → để nguyên như cũ", JSON.stringify(nofit));
  const tools = fs.readFileSync("server/chat/tools.ts", "utf8");
  ok(/const fp = x\?\.turnArts\?\.length \? foldPatches\(x\.turnArts, text0\) : null;/.test(tools), "withTurnArts gộp bản sửa cuối lượt vào bộ slide viết giữa lượt");
  const other = foldFix(orig, [], `Thêm phụ lục.\n\n${full("<p>x</p>", "phu-luc")}`);
  ok(arts(other.text) === 2 && /identifier="phu-luc"/.test(other.text), "artifact khác identifier → thêm sau câu trả lời gốc", other.text);
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
  const bare = F("Số liệu sai", "Tổng doanh thu 3 quý không khớp với dòng tổng 1.200.", null, "high");
  const other = F("Thiếu phím tắt", "Không chuyển slide bằng bàn phím được.", null, "high");
  const out = critic.checkMath([T8, real, bare, other]);
  ok(!out.includes(T8), "T8: 11+7+5+3+6 = 32 khớp 32k → bỏ mục báo nhầm", JSON.stringify(out.map((f) => f.title)));
  ok(out.includes(real), "lệch thật (68.965.000 ≠ 68.000.000) → giữ");
  ok(out.find((f) => f.title === "Số liệu sai")?.severity === "low", "nêu lỗi số liệu mà không kèm phép tính → hạ xuống Gợi ý");
  ok(out.find((f) => f.title === "Thiếu phím tắt")?.severity === "high", "mục không phải số liệu giữ nguyên");
  // Review W10: chữ "mismatch", "không khớp", "doesn't match" của phản biện code không phải lỗi số liệu.
  const code = [F("Type mismatch crashes the app", "Passing a string where a number is expected throws at runtime.", null, "high"),
    F("Kiểu dữ liệu không khớp làm ứng dụng lỗi", "Hàm nhận chuỗi nhưng truyền số.", null, "high"),
    F("The selector doesn't match any element", "querySelector returns null and .addEventListener throws on line 42, the page breaks.", null, "high"),
    F("Total mismatch", "Total shows 1200 but rows add to 1250.", null, "high")];
  const kept = critic.checkMath(code);
  ok(kept.slice(0, 3).every((f) => f.severity === "high"), "“Type mismatch”, “không khớp kiểu”, “selector doesn't match” giữ mức Nghiêm trọng", JSON.stringify(kept.map((f) => f.severity)));
  ok(kept[3].severity === "low", "“Total mismatch … 1200 … 1250” không kèm phép tính → hạ xuống Gợi ý", kept[3].severity);
  ok(critic.checkMath(code, { downgrade: false })[3].severity === "high", "phản biện code / ứng dụng (downgrade: false): không hạ mức theo câu chữ");
  // So ở độ chính xác của số đang ghi, không dùng dung sai tương đối 0,5%.
  const near = [F("Tổng sai", "", { expr: "1000+20", shown: "1025" }), F("Total wrong", "", { expr: "12900+12900", shown: "25,910" }), F("Tỉ lệ", "", { expr: "1/3*100", shown: "33%" }),
    F("Làm tròn", "", { expr: "10.25+10.30", shown: "20.55" }), F("Thập phân", "", { expr: "2.5+2.5", shown: "5.1" }), F("Một chữ số", "", { expr: "0.1+0.2", shown: "0.3" })];
  const nk = critic.checkMath(near).map((f) => f.title);
  ok(nk.includes("Tổng sai") && nk.includes("Total wrong"), "lệch thật nhỏ (1020 ≠ 1025; 25.800 ≠ 25.910, chỉ 0,42%) → giữ", JSON.stringify(nk));
  ok(!nk.includes("Tỉ lệ") && !nk.includes("Làm tròn") && !nk.includes("Một chữ số"), "khớp ở độ chính xác đang ghi (33,33 ≈ 33%; 0,1+0,2 = 0,3) → bỏ", JSON.stringify(nk));
  ok(nk.includes("Thập phân"), "2,5 + 2,5 = 5 mà ghi “5.1”: lệch quá nửa đơn vị của chữ số cuối → giữ", JSON.stringify(nk));
  const parsed = critic.parseFindings('{"findings":[{"line_start":2,"title":"Tổng không khớp","math":{"expr":"1+2","shown":3}}]}', 5);
  ok(parsed?.[0]?.math?.expr === "1+2" && parsed[0].math.shown === "3", "đọc trường math trong JSON của model", JSON.stringify(parsed));
}

console.log("4. Phản biện theo ngôn ngữ giao diện, kèm số đo của Synchro");
{
  const route = fs.readFileSync("app/api/critic/route.ts", "utf8"), home = fs.readFileSync("ui/home.tsx", "utf8");
  ok(/auto, ui: getLang\(\) \}\)/.test(home), "giao diện gửi ngôn ngữ đang dùng (ui) khi nhờ phản biện");
  ok(/LANGS\.find\(\(l\) => l === b\.ui\)/.test(route) && /\.replace\("\{LANG\}", WRITE_IN\[lang\]\)/.test(route) && /en: "Write title and detail in English/.test(route), "lời nhắc phản biện đổi theo ngôn ngữ giao diện (tiếng Anh khi giao diện tiếng Anh)");
  ok(!/ngôn ngữ của người dùng \(mặc định tiếng Việt\)/.test(route), "bỏ câu cũ 'mặc định tiếng Việt'");
  ok(/checkMath\(findings, \{ downgrade: String\(b\.type\) === "html" \}\)/.test(route) && /"math": \{"expr"/.test(route), "phản biện phải kèm phép tính, máy chủ tự tính lại; chỉ hạ mức theo câu chữ với trang web / bộ slide");
  ok(/measureDeck\(/.test(route) && /deckFacts\(known, nums\)/.test(route) && /deckFindings\(content, lay, nums, lang\)/.test(route), "bộ slide: số đo khung + đánh số vào phản biện");
  // Review W10: dựng Chromium để đo chỉ khi người dùng bấm, gắn req.signal và có giới hạn thời gian.
  ok(/deck && !known && !auto \? measureDeck\(/.test(route) && /AbortSignal\.any\(\[req\.signal, AbortSignal\.timeout\(MEASURE_MS\)\]\)/.test(route), "phản biện tự chạy không dựng Chromium; bấm tay thì đo gắn req.signal, tối đa MEASURE_MS", route.match(/const measuring[^\n]*/)?.[0]);
  const ac = fs.readFileSync("server/artcheck.ts", "utf8");
  ok(/origin, signal\)\.catch/.test(ac) && /timeout: 150, signal, argv/.test(ac), "measureDeck → checkArtifact → execRun nhận signal (rời hàng chờ khi hủy)");
  // Mọi khóa tfOn / trOn của phản biện có bản dịch tiếng Anh.
  const dc = fs.readFileSync("server/deckcritic.ts", "utf8");
  const keys = [...dc.matchAll(/(?:tfOn|trOn)\("([^"]+)"/g)].map((m) => m[1]);
  const miss = keys.filter((k) => !dict.VI2EN[k]);
  ok(keys.length >= 11 && !miss.length, `${keys.length} câu của lỗi Synchro tự đo đều có bản tiếng Anh`, miss.join(" | "));
  // Mục phản biện của Synchro (server/deckcritic.ts): gộp khi nhiều slide tràn, gộp nhiều kiểu lỗi đánh số ở cùng một slide.
  const { deckcritic: DC } = await loadTs(["deckcritic"]);
  const deckSlidesLine = (src, k) => decknum.deckSlides(src)[k - 1]?.line;
  const html = deck({ brows: [], pages: [], total: 8 });
  const lay = (bad) => ({ at: 0, issues: [], fit: Array.from({ length: 8 }, (_, k) => ({ slide: k + 1, h: bad.includes(k + 1) ? 900 : 720, w: 1280, vh: 720, vw: 1280 })) });
  const two = DC.deckFindings(html, lay([2, 5]), [], "en");
  ok(two.length === 2 && two.every((f) => f.severity === "high" && f.by[0] === "Synchro") && two[0].title === "Slide 2 overflows its frame when presented", "2 slide tràn → 2 mục, mỗi slide một mục", JSON.stringify(two.map((f) => f.title)));
  const many = DC.deckFindings(html, lay([1, 2, 3, 4, 5, 6, 7, 8]), [], "en");
  ok(many.length === 1 && many[0].title === "8 slides overflow their frame when presented" && /slides 1, 2, 3, 4, 5, 6, 7, 8 are taller or wider/.test(many[0].detail), "cả 8 slide tràn → gộp một mục, không rải 8 mục Nghiêm trọng", JSON.stringify(many));
  const patched = deck({ brows: ["", "01 · Vấn đề", "02 · Giải pháp", "03 · Kinh tế", "05 · Thị trường", "06 · Gọi vốn"], pages: ["", "02 / 07", "03 / 07", "04 / 07", "06 / 07", "06 / 06"] });
  const nf = DC.deckFindings(patched, null, decknum.numberingIssues(patched), "en");
  const lines = nf.map((f) => f.line_start);
  ok(new Set(lines).size === lines.length && nf.some((f) => /Page numbers don't follow the slide order/.test(f.detail) && /Section labels skip a number or go backwards on slide 5, 6 \(in order they should read 04, 05\)/.test(f.detail)), "số trang sai thứ tự và nhãn mục nhảy cóc cùng slide 5 → một ghi chú (khóa React không trùng)", JSON.stringify(nf.map((f) => [f.line_start, f.detail])));
  // Thứ bậc cỡ chữ (số đo của check_artifact sau bộ tự co): slide 1 đúng cảnh bộ slide của tài khoản miễn phí
  // (tiêu đề bị co còn 11px, dòng mô tả 26px), slide 3 tiêu đề chỉ 1,3 lần chữ thân, slide 2 đạt.
  const frame = { h: 720, w: 1280, vh: 720, vw: 1280 };
  const sized = (rows) => ({ at: 0, issues: [], fit: rows.map((r, k) => ({ slide: k + 1, ...frame, ...r })) });
  const typeLay = sized([{ title: 11, body: 20, lead: 26 }, { title: 44, body: 20 }, { title: 26, body: 20 }]);
  const tf = DC.deckFindings(html, typeLay, [], "en");
  const tf0 = tf[0] ?? {};
  ok(tf.length === 1 && tf0.severity === "medium" && tf0.by[0] === "Synchro"
    && tf0.title === "Title doesn't stand out from the body text"
    && /slide 1: title 11px, description 26px; slide 3: title 26px, body text 20px/.test(tf0.detail)
    && /at least 1\.4 times the body text and 1\.2 times the description/.test(tf0.detail),
  "tiêu đề dưới 1,4 lần chữ thân / nhỏ hơn mô tả → mục phản biện của Synchro (tiếng Anh)", JSON.stringify(tf));
  ok(tf0.line_start === deckSlidesLine(html, 1), "mục thứ bậc cỡ chữ chỉ vào dòng của slide đầu tiên bị lỗi",
    JSON.stringify(tf0));
  const tv = DC.deckFindings(html, typeLay, [], "vi")[0] ?? {};
  ok(tv.title === "Tiêu đề không nổi hơn chữ thân" && /slide 1: tiêu đề 11px, dòng mô tả 26px/.test(tv.detail)
    && /ít nhất 1,4 lần chữ thân và 1,2 lần dòng mô tả/.test(tv.detail),
    "bản tiếng Việt", JSON.stringify(tv));
  // Không lỗi nào thì danh sách rỗng, khung xem mới hiện "Ổn"; có lỗi thứ bậc thì không.
  const good = sized([{ title: 44, body: 20, lead: 26 }, { title: 56, body: 18 }, { title: 28, body: 20 }]);
  const fine = DC.deckFindings(html, good, [], "vi");
  ok(fine.length === 0, "tiêu đề 1,4 lần chữ thân trở lên, không nhỏ hơn mô tả: không có mục nào (nhãn Ổn)",
    JSON.stringify(fine));
  // Tiêu đề bằng dòng mô tả (lỗi ở bìa bộ slide của tài khoản miễn phí) là thứ bậc yếu dù đạt 1,4 lần chữ thân;
  // tiêu đề lớn hơn dòng mô tả một bậc của thang 1,333 thì đạt.
  const leads = sized([
    { title: 28, body: 20, lead: 28 }, { title: 32, body: 18, lead: 32 }, { title: 36, body: 20, lead: 27 },
  ]);
  const lw = deckfit.weakType(leads.fit).map((f) => f.slide).join();
  ok(lw === "1,2", "tiêu đề bằng dòng mô tả → thứ bậc yếu; lớn hơn một bậc thang 1,333 → đạt", lw);
  // Sàn tiêu đề của bộ tự co (sxTitleMin, cùng mã chạy trong trang) không bao giờ tạo ra lỗi thứ bậc cỡ chữ: cỡ đo
  // được làm tròn, chữ thân lớn nhất có thể lẻ nửa px sau khi co.
  const titleMin = new Function(`${deckfit.TYPE_ELS_JS};return sxTitleMin`)();
  const made = [];
  for (let b = 11; b <= 40; b += 0.25) {
    const t = titleMin(b), r = Math.round(b);
    made.push({ slide: made.length + 1, ...frame, title: t, body: Math.round(b * 0.8), lead: r });
    made.push({ slide: made.length + 1, ...frame, title: t, body: r, lead: r });
  }
  const selfWeak = deckfit.weakType(made);
  ok(!selfWeak.length, "tiêu đề ở sàn bộ tự co (1,4 lần chữ thân lớn nhất) luôn đạt mục thứ bậc",
    JSON.stringify(selfWeak[0]));
  const blind = DC.deckFindings(html, sized([{ title: 0, body: 20 }, { title: 30 }]), [], "vi");
  ok(blind.length === 0, "slide không đo được tiêu đề / chữ thân: không kết luận", JSON.stringify(blind));
  const facts = DC.deckFacts(typeLay, []);
  ok(/Synchro đã đo cỡ chữ: slide 1 tiêu đề 11px, dòng mô tả 26px; slide 3 tiêu đề 26px, chữ thân 20px/.test(facts),
    "số đo cỡ chữ đưa cho model phản biện", facts);
  const note = deckfit.typeNote(typeLay.fit);
  ok(note.length === 2 && /Slide 1: thứ bậc cỡ chữ yếu — tiêu đề 11px, dòng mô tả 26px; tiêu đề cần lớn ít nhất 1,2 lần/
    .test(note[0]) && /Slide 3: .*chữ thân 20px; tiêu đề cần lớn ít nhất 1,4 lần chữ thân/.test(note[1]),
    "check_artifact báo model slide có thứ bậc yếu", note.join(" | "));
  // Bộ tự co không co vừa (slide tự cắt phần thừa nên cao / rộng bằng khung): vẫn là slide tràn với model, phản biện.
  const stuckLay = { at: 0, issues: [], fit: [{ slide: 1, ...frame }, { slide: 2, ...frame, over: true }] };
  ok(deckfit.overflowing(stuckLay.fit).map((f) => f.slide).join() === "2",
    "slide có cờ over là slide tràn dù cao / rộng bằng khung");
  const sf = DC.deckFindings(html, stuckLay, [], "en");
  ok(sf.length === 1 && sf[0].severity === "high" && sf[0].title === "Slide 2 overflows its frame when presented"
    && /content of slide 2 overflows and is cut off by the frame; shrinking the text does not make it fit, so Synchro/
      .test(sf[0].detail),
  "co không vừa (bộ tự co giữ nguyên cỡ, ghi cờ) → mục Nghiêm trọng", JSON.stringify(sf));
  const sum = deckfit.fitSummary(stuckLay.fit);
  ok(/slide 2 TRÀN — nội dung tràn và bị khung cắt mất; co chữ cũng không vừa nên Synchro giữ nguyên cỡ chữ/.test(sum),
    "dòng đo khung cho model nêu slide tràn sau khi co", sum);
  ok(!DC.contradicts(stuckLay, { title: "Slide 2 bị tràn", detail: "" }),
    "có slide tràn sau khi co: ý kiến 'tràn' của model phản biện không bị bỏ");
}

console.log("5. check_artifact đo khung 1280×720 thật (Chrome ẩn, mã PROBE thật)");
const CHROME = process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
if (!fs.existsSync(CHROME)) console.log("  (bỏ qua: máy không có Chrome)");
else {
  const probeOf = (src) => { const m = /const PROBE = String\.raw`([\s\S]*?)`;\n/.exec(src); if (!m) throw new Error("không thấy PROBE"); return m[1].replace("${DESIGN_PROBE}", artprobe.DESIGN_PROBE); };
  const SRC = fs.readFileSync("server/artcheck.ts", "utf8");
  const PROBE = probeOf(SRC);
  const FIT = /const FIT = String\.raw`([\s\S]*?)`;\n/.exec(SRC)?.[1];
  ok(!!FIT && /\$\{FIT\}/.test(SRC) && /FIT\.toString\(\)/.test(SRC), "check_artifact đo khung bằng đúng hàm FIT (kiểm thử chạy cùng mã)");
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
        const fit = await t.ev(`(() => { const el = window.__sxCur(); return { ...(${FIT})(el), sh: el.scrollHeight, ch: el.clientHeight }; })()`);
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
    // Review W10: khung 1920×1080 thu nhỏ bằng transform (kiểu reveal.js width:1920), và slide overflow:hidden có hình trang trí thò ra mép.
    // Cả hai đều vừa khung khi xem: không được báo TRÀN.
    const decks = {
      "khung 1920×1080 thu nhỏ": `<!doctype html><html><head><style>body{margin:0;overflow:hidden;background:#111}.stage{width:1920px;height:1080px;transform-origin:0 0;transform:scale(calc(1280/1920))}.slide{width:1920px;height:1080px;background:#fff;font:40px system-ui;padding:80px;box-sizing:border-box}</style></head><body><div class="stage">${[1, 2, 3].map((i) => `<section class="slide"><h1>Slide ${i}</h1><p>Nội dung</p></section>`).join("")}</div></body></html>`,
      "overflow:hidden + hình trang trí": `<!doctype html><html><head><style>body{margin:0}.slide{width:100vw;height:100vh;position:relative;overflow:hidden;background:#fbf7f0;padding:60px;box-sizing:border-box;font:28px system-ui}.blob{position:absolute;right:-240px;top:-200px;width:600px;height:600px;border-radius:50%;background:#f3c}</style></head><body>${[1, 2, 3].map((i) => `<section class="slide"><div class="blob" aria-hidden="true"></div><h1>Slide ${i}</h1><p>Nội dung</p></section>`).join("")}</body></html>`,
      // Khung thu nhỏ mà nội dung thật sự dài quá khung: vẫn phải báo, theo cỡ đã co (không phải 1080px chưa co).
      "khung thu nhỏ, slide 2 dài": `<!doctype html><html><head><style>body{margin:0;overflow:hidden}.stage{width:1920px;height:1080px;transform-origin:0 0;transform:scale(calc(1280/1920))}.slide{width:1920px;min-height:1080px;background:#fff;font:40px system-ui;padding:80px;box-sizing:border-box}.tall{height:1400px}</style></head><body><div class="stage">${[1, 2, 3].map((i) => `<section class="slide"><h1>Slide ${i}</h1>${i === 2 ? '<div class="tall">dài</div>' : ""}</section>`).join("")}</div></body></html>`,
    };
    for (const [name, d] of Object.entries(decks)) {
      await t.P("Page.navigate", { url: "data:text/html;base64," + Buffer.from(artdoc.buildDocCore("html", d, "https://synchro.test", "t", false, "", { fixed: null }, "Deck")).toString("base64") });
      await t.until("!!window.__sxAll && window.__sxAll().length === 3", 15000);
      const fits = [], probes = [];
      for (let i = 0; i < 3; i++) {
        await t.ev(`window.__sxGo(${i})`); await sleep(150);
        fits.push({ slide: i + 1, ...(await t.ev(`(${FIT})(window.__sxCur())`)), sh: await t.ev("window.__sxCur().scrollHeight") });
        probes.push((await t.ev(`(${PROBE})(window.__sxCur(), true)`)).filter((x) => /tràn/.test(x.kind)));
      }
      const line = deckfit.fitSummary(fits);
      if (name === "khung thu nhỏ, slide 2 dài") {
        const s2 = fits[1];
        ok(deckfit.overflowing(fits).map((f) => f.slide).join() === "2" && Math.abs(s2.h - s2.sh * 2 / 3) <= 2 && s2.sh > 1080, `${name}: chỉ slide 2 tràn, đo theo cỡ đã co (${s2.h}px = ${s2.sh}px × 2/3)`, line);
        ok(probes[1].some((x) => x.kind === "phần tử tràn khỏi slide"), `${name}: PROBE cũng báo phần tử tràn ở slide 2`, JSON.stringify(probes));
      } else ok(!deckfit.overflowing(fits).length && /cả 3 slide đều vừa khung/.test(line) && probes.every((p) => !p.length), `${name}: không báo TRÀN (đo khung lẫn PROBE)`, `${line} ${JSON.stringify(probes)}`);
    }
  } finally { t.close(); }
}

if (/synchro-deckq-/.test(process.env.DATA_DIR ?? "")) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
