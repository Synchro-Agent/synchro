// Bản sửa artifact (mode="patch") áp được ngay lần đầu với cách model thật hay viết, báo đúng khối hỏng khi không
// khớp, ghép lần gửi lại vào bản sửa gốc; giới hạn 2 phút cho bước tự kiểm hiển thị.
// Không cần máy chủ: hàm thuần (vfs, patchheal, checkbudget, artcheck) qua loadTs.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900));
};
const mods = ["vfs", "patchheal", "checkbudget", "artcheck"];
const { vfs: V, patchheal: H, checkbudget: CB, artcheck: A } = await loadTs(mods);

// Bộ slide 6 trang thụt lề như model viết, đủ dài để SEARCH phải chọn đúng chỗ.
const slide = (n, title, body) => `  <section class="slide" data-n="${n}">
    <p class="k">0${n} · Mục ${n}</p>
    <h2>${title}</h2>
    <p>${body}</p>
    <div class="foot"><span>Sương Sớm</span><span>0${n} / 06</span></div>
  </section>`;
const SLIDES = [
  ["Trà shan tuyết Hà Giang", "Hái tay từ cây cổ thụ trên 300 năm."],
  ["Khách thành phố khó mua trà thật", "62% người mua online không tin nguồn gốc."],
  ["Truy xuất từng búp trà", "Mã QR dẫn tới vườn, ngày hái, người hái."],
  ["4,2 tỷ đồng doanh thu năm đầu", "Số minh hoạ cho bản gọi vốn."],
  ["Thị trường trà đặc sản tăng 18%/năm", "Nguồn: minh hoạ."],
  ["Gọi 6 tỷ cho 15%", "Mở 2 vườn mới và kênh xuất khẩu."],
];
const DECK = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Sương Sớm — gọi vốn</title>
  <style>
    .slide { width: 100vw; height: 100vh; padding: 64px; }
    h2 { font: 600 48px/1.1 "Playfair Display", serif; }
  </style>
</head>
<body>
${SLIDES.map(([t, b], i) => slide(i + 1, t, b)).join("\n")}
</body>
</html>`;
const tag = (ident, extra) => `<artifact identifier="${ident}" ${extra}>`;
const HTML = 'type="text/html" title="Sương Sớm"';
const full = (body, ident = "suong-som") => `Đây là bộ slide:\n\n${tag(ident, HTML)}\n${body}\n</artifact>`;
const patch = (blocks, ident = "suong-som") => `Mình đã sửa.\n\n${tag(ident, 'mode="patch"')}\n${blocks}\n</artifact>`;
const blk = (s, r) => `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;
const two = (s1, r1, s2, r2) => [blk(s1, r1), blk(s2, r2)].join("\n");

console.log("1. Mười lượt sửa bộ slide liên tiếp, mỗi lượt một kiểu viết thường gặp của model");
{
  const numbered = (c, s) => {
    const at = c.split("\n").findIndex((l) => l === s.split("\n")[0]);
    return s.split("\n").map((l, k) => `${String(at + k + 1).padStart(4)} | ${l}`).join("\n");
  };
  const trimAll = (t) => t.split("\n").map((l) => l.trim()).join("\n");
  const marks = (t, a, b, c) => t.replace(/<<<<<<< SEARCH/g, a).replace(/=======/g, b).replace(/>>>>>>> REPLACE/g, c);
  // Mỗi lượt hai khối: đổi tiêu đề slide n, rồi thêm một dòng ghi chú ngay dưới tiêu đề vừa đổi (khối 2 dựa trên kết
  // quả khối 1, như model thật khi sửa hai chỗ liền nhau).
  const rounds = [
    ["nguyên văn", (...a) => two(...a)],
    ["xuống dòng CRLF", (...a) => two(...a).replace(/\n/g, "\r\n")],
    ["thụt lề sai (bỏ thụt lề trong SEARCH)", (s1, r1, s2, r2) => two(s1.trim(), r1.trim(), trimAll(s2), r2.trim())],
    ["chép cả số dòng của read_artifact", (s1, r1, s2, r2, c) => {
      const num = numbered(c, s1);
      return two(num, num.replace(s1, r1), s2, r2);
    }],
    ["dấu kiểu Cline", (...a) => marks(two(...a), "------- SEARCH", "=======", "+++++++ REPLACE")],
    ["dấu thừa khoảng trắng, 6 ký tự", (...a) => marks(two(...a), "<<<<<< SEARCH  ", "====== ", ">>>>>>>REPLACE")],
    ["khối cuối thiếu dòng REPLACE", (...a) => two(...a).replace(/\n>>>>>>> REPLACE$/, "")],
    ["thêm dòng trống giữa SEARCH", (s1, r1, s2, r2) => two(s1, r1, s2.replace("\n", "\n\n"), r2)],
    ["bọc trong khối ``` của markdown", (...a) => "```html\n" + two(...a) + "\n```"],
    ["khối sau sửa tiếp dòng khối trước vừa đổi", (s1, r1) => two(s1, r1, r1, r1.replace("</h2>", " (bản cuối)</h2>"))],
  ];
  const texts = [full(DECK)];
  let cur = DECK, rewrites = 0, okRounds = 0;
  rounds.forEach(([name, mk], i) => {
    const n = (i % 6) + 1, L = cur.split("\n"), at = L.findIndex((l) => l.includes(`data-n="${n}"`));
    const h2 = L[at + 2], p = L[at + 3];
    const s1 = h2, r1 = h2.replace("</h2>", ` · v${i + 2}</h2>`);
    const s2 = `${r1}\n${p}`, r2 = `${r1}\n${p}\n    <p class="note">Ghi chú lượt ${i + 2}</p>`;
    const body = mk(s1, r1, s2, r2, cur);
    texts.push(patch(body));
    const st = V.artState(texts).get("suong-som");
    const good = st.fix && !st.fix.failed.length && st.content.includes(` · v${i + 2}`) && st.v === i + 2;
    if (good) okRounds++;
    else rewrites++;
    const why = `${JSON.stringify(st.fix)}\n${body.slice(0, 400)}`;
    ok(good, `lượt ${i + 2}: ${name} → áp trọn, phiên bản ${i + 2}`, why);
    cur = st.content;
  });
  ok(okRounds === 10 && rewrites === 0, `10/10 lượt áp được, 0 lượt phải viết lại cả tệp (${okRounds}/10)`);
  const clean = !/<<<<<<<|=======|>>>>>>>/.test(cur);
  ok(/Ghi chú lượt 2</.test(cur) && /bản cuối/.test(cur) && clean, "bản cuối có đủ thay đổi, không lẫn dấu khối");
  const st = H.patchStats(new Map(), texts);
  ok(st.ok >= 19 && st.failed === 0 && st.rewrites === 0, "đếm cho dòng [timing]: khối áp được / hỏng / viết lại", st);
}

console.log("2. Bản sửa nằm cả ở artifact viết giữa lượt lẫn chữ đang viết: chỉ áp một lần");
{
  const six = '  <section class="slide" data-n="6">';
  const p = patch(blk(six, `${six}\n    <p class="k">Phụ lục</p>`));
  const arts = [p.slice(p.indexOf("<artifact"))];
  const count = (a) => (a.content.match(/Phụ lục/g) ?? []).length;
  // Bộ xử lý khóa API: lời dẫn đã tách vào turnArts nhưng chữ đang viết của bước vẫn còn nguyên khối đó.
  const twice = V.artState([full(DECK), ...arts, p]).get("suong-som");
  ok(count(twice) === 2 && twice.v === 3, "đọc cả hai thì khối chèn thành hai bản, phiên bản nhảy lên 3 (cần tránh)");
  const once = V.artState([full(DECK), ...arts, H.dropSeen(arts, p)]).get("suong-som");
  ok(count(once) === 1 && once.v === 2, "dropSeen bỏ khối đã tách: một bản, phiên bản 2", once.v);
  ok(H.dropSeen([], p) === p && H.dropSeen(arts, "chỉ có chữ") === "chỉ có chữ", "không có khối đã tách: giữ nguyên");
}

const GOOD = blk("    <h2>Trà shan tuyết Hà Giang</h2>", "    <h2>Trà shan tuyết cổ thụ</h2>");
console.log("3. Khối không khớp: báo đúng khối nào, chỗ gần giống nhất kèm số dòng");
{
  const h2 = "    <h2>Truy xuất từng búp trà</h2>";
  const typo = blk("    <h2>Truy xuất từng búp chè</h2>\n    <p>Mã QR dẫn tới vườn.</p>", "    <h2>Biết rõ</h2>");
  const st = V.artState([full(DECK), patch(`${GOOD}\n${typo}`)]).get("suong-som");
  const f = st.fix;
  const second = f.misses?.[0]?.block === 2 && f.total === 2;
  ok(f.applied === 1 && f.failed.length === 1 && second, "khối 1 áp, khối 2 hỏng", f);
  ok(st.content.includes("cổ thụ</h2>") && st.content.includes(h2), "khối khớp vẫn áp; chỗ hỏng giữ nguyên");
  const rep = H.patchReport(st);
  const head = /<patch_failed identifier="suong-som" version="2">/.test(rep);
  ok(head && /Khối 2\/2/.test(rep) && /áp được 1\/2 khối/.test(rep), "báo: khối 2/2, đã áp 1/2", rep);
  const near = /dòng (\d+)–(\d+)/.exec(rep), at = DECK.split("\n").findIndex((l) => l === h2) + 1;
  const spans = near && +near[1] <= at && +near[2] >= at && +near[2] - +near[1] >= 2;
  ok(spans && rep.includes(`${String(at).padStart(4)} | ${h2}`), `chỗ gần giống có dòng ${at}, ít nhất 3 dòng`, rep);
  ok(/Không viết lại cả tệp/.test(rep) && !/Khối 1\//.test(rep), "chỉ xin gửi lại khối hỏng");
  const none = V.artState([full(DECK), patch("Mình đổi tiêu đề slide 2 thành “Khách khó mua trà”.")]).get("suong-som");
  const unread = H.patchReport(none).includes("không đọc được khối SEARCH/REPLACE nào");
  ok(none.fix.failed.length === 1 && unread, "không đọc được khối nào: báo lỗi, không im lặng giữ bản trước", none.fix);
  const orphan = V.artState([patch(GOOD, "khong-co")]).get("khong-co");
  ok(/Chưa có bản nào của "khong-co"/.test(H.patchReport(orphan)), "sửa artifact chưa có: nói rõ identifier sai");
  const gone = V.artState([full(DECK), patch(blk("<footer>đã xóa</footer>", ""))]).get("suong-som");
  ok(/Không có chỗ nào gần giống/.test(H.patchReport(gone)), "đoạn đã không còn: nói rõ không có chỗ gần giống");
  ok(H.patchReport(V.artState([full(DECK), patch(GOOD)]).get("suong-som")) === "", "áp trọn: không báo gì");
  const writing = `${tag("suong-som", 'mode="patch"')}\n${GOOD}\n<<<<<<< SEARCH\n    <h2>Gọi`;
  const streaming = V.artState([full(DECK), writing]).get("suong-som");
  ok(!streaming.fix.failed.length && streaming.content.includes("cổ thụ"), "đang viết dở: khối đã đóng áp ngay");
}

console.log("4. Gửi lại đúng khối hỏng rồi ghép vào bản sửa gốc");
{
  const prior = V.artState([full(DECK)]);
  const typo = blk("    <h2>Truy xuất từng búp chè</h2>", "    <h2>Biết rõ từng búp trà</h2>");
  const answer = patch(`${GOOD}\n${typo}`);
  const bad = H.failingPatches(prior, [answer]);
  ok(bad.length === 1 && bad[0].art.ident === "suong-som", "kết thúc với bản sửa hỏng → cần nhắc", bad.length);
  ok(/Khối 2\/2/.test(H.HEAL_ASK(bad.map((b) => H.patchReport(b.r)))), "lời nhắc nêu đúng khối hỏng");
  const fixed = blk("    <h2>Truy xuất từng búp trà</h2>", "    <h2>Biết rõ từng búp trà</h2>");
  const resend = `${tag("suong-som", 'mode="patch"')}\n${fixed}\n</artifact>`;
  const swaps = H.healFold(prior, [answer], resend);
  const merged = H.applySwaps(answer, swaps);
  const st = V.artState([full(DECK), merged]).get("suong-som");
  const both = st.content.includes("cổ thụ") && st.content.includes("Biết rõ từng búp trà");
  ok(swaps.length === 1 && !st.fix.failed.length && both, "ghép: một bản sửa, áp trọn cả hai thay đổi", st.fix);
  const kept = merged.startsWith("Mình đã sửa.");
  ok(!H.failingPatches(prior, [merged]).length && kept, "sau khi ghép hết bản sửa hỏng; lời câu trả lời giữ nguyên");
  const redo = full(DECK.replace("Hà Giang</h2>", "Hà Giang (viết lại)</h2>")).replace("Đây là bộ slide:\n\n", "");
  const rewrite = H.healFold(prior, [answer], redo);
  ok(rewrite.length === 1 && !/mode="patch"/.test(rewrite[0][1]), "gửi lại bản đầy đủ: thay hẳn bản sửa hỏng");
  const still = H.healFold(prior, [answer], `${tag("suong-som", 'mode="patch"')}\n${typo}\n</artifact>`);
  ok(!still.length, "gửi lại vẫn sai: giữ nguyên (trình duyệt báo bản sửa lỗi)");
  // Bản sửa hỏng nằm ở artifact viết giữa lượt, câu trả lời cuối chỉ có lời tóm tắt.
  const mid = answer.slice(answer.indexOf("<artifact"));
  const sw2 = H.healFold(prior, [mid, "Xong rồi."], resend);
  ok(sw2.length === 1 && H.applySwaps(mid, sw2).includes("Biết rõ từng búp trà"), "hỏng ở giữa lượt cũng ghép được");
  const stats = H.patchStats(prior, [answer, redo]);
  ok(stats.ok === 1 && stats.failed === 1 && stats.rewrites === 1, "viết lại cả tệp sau bản sửa hỏng được đếm", stats);
}

console.log("5. Tự kiểm hiển thị tối đa theo đồng hồ của lượt, tính cả thời gian model giữa các lần kiểm");
{
  const wait = (ms) => (s) => new Promise((res) => {
    const t = setTimeout(() => res("xong"), ms);
    s.addEventListener("abort", () => {
      clearTimeout(t);
      res("bị cắt");
    }, { once: true });
  });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const turn = {}, run = (f, signal, t = turn) => CB.withinCheckBudget(t, signal, f, 400);
  const t0 = Date.now();
  ok((await run(wait(150))) === "xong", "lần kiểm đầu trong ngân sách: có kết quả");
  ok((await run(wait(2000))) === null && Date.now() - t0 < 900, "lần kiểm quá phần còn lại bị cắt khi hết ngân sách");
  const t1 = Date.now();
  ok((await run(wait(50))) === null && Date.now() - t1 < 20, "hết ngân sách: không chạy thêm lần kiểm nào");
  ok(CB.checkSpent(turn) >= 400 && CB.checkSpent({}) === 0, "ngân sách tính riêng cho từng lượt", CB.checkSpent(turn));
  // Kiểu "tự kiểm từng trang": mỗi lần dựng nhanh, phần lớn thời gian là model đọc ảnh rồi viết giữa hai lần gọi.
  const slow = {}, calls = [];
  for (let k = 0; k < 8; k++) {
    calls.push(await CB.withinCheckBudget(slow, undefined, wait(20), 400));
    await pause(120);
  }
  const done = calls.filter((c) => c === "xong").length;
  ok(done >= 2 && done <= 4 && calls.at(-1) === null, "8 lần kiểm cách nhau bởi thời gian model: dừng sau ngân sách",
    `${done} ${calls}`);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 50);
  ok((await run(wait(1000), stop.signal, {})) === "bị cắt", "người dùng bấm Dừng: trả kết quả của lần kiểm");
  ok(CB.SELF_CHECK_MS === 120_000 && /2 phút/.test(CB.SELF_CHECK_SPENT), "mặc định 2 phút mỗi lượt");
  const auto = await CB.withinAutoCheck(slow, undefined, wait(20));
  ok(auto === "xong" && CB.AUTO_CHECK_MS === 30_000, "model đã dùng hết giờ: lần tự đo trước khi giao vẫn chạy (30 giây)");
  ok((await CB.withinAutoCheck(slow, undefined, wait(20))) === "xong", "lần tự đo không làm hụt giờ của model");
  // Lần kiểm của model bị cắt giữa chừng: model chưa thấy kết quả, bản đó chưa tính là đã kiểm.
  const deck = { ident: "d", title: "D", type: "html", lang: null, content: DECK, complete: true, v: 1 };
  const cut = {};
  A.checkRoundGate(cut, deck);
  const before = A.checkedInTurn(cut, deck);
  A.forgetCheck(cut, deck);
  ok(before && !A.checkedInTurn(cut, deck), "lần kiểm bị cắt được trả lại: bản đó vẫn được tự đo trước khi giao");
  const v2 = { ...deck, content: `${DECK}<!-- 2 -->`, v: 2 }, v3 = { ...deck, content: `${DECK}<!-- 3 -->`, v: 3 };
  ok(!A.checkRoundGate(cut, deck) && !A.checkRoundGate(cut, v2) && !!A.checkRoundGate(cut, v3),
    "vòng bị cắt không tính: vẫn còn đủ 2 vòng");
}

console.log("6. Trường hợp không được đoán: dòng gạch chân, nội dung có số kiểu read_artifact, ngữ cảnh ở đầu tệp");
{
  const md = "Tiêu đề\n=====\n\nĐoạn thân.";
  const art = (body) => `${tag("md", 'type="text/markdown" title="Ghi chú"')}\n${body}\n</artifact>`;
  const mdPatch = (b) => `${tag("md", 'mode="patch"')}\n${b}\n</artifact>`;
  const exact = V.artState([art(md), mdPatch(blk("Tiêu đề\n=====", "Tiêu đề mới\n====="))]).get("md");
  ok(!exact.fix.failed.length && exact.content === "Tiêu đề mới\n=====\n\nĐoạn thân.",
    "gạch chân Markdown trong SEARCH / REPLACE, dòng ngăn đúng 7 dấu: áp đúng", exact.content);
  const loose = blk("Tiêu đề\n=====", "Tiêu đề mới\n=====").replace("\n=======\n", "\n======\n");
  const amb = V.artState([art(md), mdPatch(loose)]).get("md");
  ok(amb.fix.failed.length === 1 && amb.content === md && /không tách được SEARCH và REPLACE/.test(H.patchReport(amb)),
    "gạch chân cùng dòng ngăn 6 dấu: báo hỏng, không đoán, nội dung giữ nguyên", `${amb.content} ${H.patchReport(amb)}`);
  const noMid = V.parsePatches("<<<<<<< SEARCH\nmột dòng\n>>>>>>> REPLACE");
  ok(noMid.length === 1 && noMid[0].unclear, "khối thiếu dòng ngăn: báo hỏng chứ không coi cả khối là SEARCH");
  const table = "Năm | Số\n--- | ---\n2024 | 10\n2025 | 12\n";
  const tp = V.applyPatches(table, V.parsePatches(blk("2024 | 10\n2025 | 12", "2024 | 10\n2025 | 14")));
  ok(tp.ok && tp.content === "Năm | Số\n--- | ---\n2024 | 10\n2025 | 14\n",
    "dòng thật sự bắt đầu bằng \"số | \" (bảng GFM): áp nguyên văn, REPLACE không bị cắt", tp);
  const lines = DECK.split("\n");
  const first = V.nearest(DECK, "<!doctype htm>"), last = V.nearest(DECK, "</htm>");
  ok(first?.from === 1 && first.lines.length === 3, "chỗ gần giống ở dòng đầu: vẫn 3 dòng ngữ cảnh", first);
  ok(last?.lines.length === 3 && last.from + 2 === lines.length && last.lines[2] === "</html>",
    "chỗ gần giống ở dòng cuối: vẫn 3 dòng ngữ cảnh", last);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
