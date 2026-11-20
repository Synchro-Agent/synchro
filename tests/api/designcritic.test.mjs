// Vòng so với mẫu tham chiếu (server/designcritic.ts): đo chênh lệch trên số đo mẫu (fixture probe, không cần Chrome),
// khi nào phải sửa, đọc JSON của người chấm, lời nhắc <design_review>, thứ tự người chấm (không bao giờ khóa API dùng
// chung), bảng so sánh 1600×1000 bằng sharp. Không gọi model, không cần máy chủ: thư mục dữ liệu riêng.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-designcritic-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "design-critic-key";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { "server/designcritic": C } = await loadTs(["server/designcritic"]);

// Bộ token trộn mẫu: tối, Fraunces + Inter, bo 12, bóng mức 2, tiêu đề siết -0.03em, khung đầu cố ý trống 30%.
const tokens = {
  theme: "dark",
  colors: [{ hex: "#0e0f0c", role: "bg", share: 0.6 }, { hex: "#f4efe6", role: "ink", share: 0.2 },
    { hex: "#d9a441", role: "accent", share: 0.05 }],
  fonts: { head: { kit: "fraunces", seen: "x", seenLicence: "open", weight: 600 },
    body: { kit: "inter", seen: "x", seenLicence: "open", weight: 400 }, mono: null },
  type: { basePx: 16, ratio: 1.333, sizes: [16, 21, 28, 38, 56, 96], headLine: 1.1, bodyLine: 1.55, headCase: "none" },
  tracking: { display: -0.03, heading: -0.01, body: 0, label: 0.08 },
  radius: { outer: 12, inner: 6, pill: false },
  shadow: { level: 2, css: "0 12px 32px rgba(0,0,0,.4)" },
  spacing: { unit: 8, section: 96, gutter: 24, density: "airy" },
  layout: { columns: 12, maxWidth: 1200, align: "left", emptyShare: 0.3 },
  imagery: { kind: "photo", share: 0.5, light: "low raking light", lens: "85mm", grade: "warm amber", subject: "tea" },
};
const mix = {
  id: "m-test01", preset: "midnight-tech", domain: "web", tokens, css: "<style data-sx-mix></style>", brand: null,
};
const NO_HERO = { marked: false, share: 0, shader: false };
const facts = (o = {}) => ({ fonts: [], hero: NO_HERO, media: 0.4, content: 0.7, ...o });
const page = { hero: false, deck: false };
const kinds = (ds) => ds.map((d) => `${d.property}:${d.severity}`).sort().join(",");

console.log("1. Số đo khung đầu (không cần bộ đo token)");
{
  const f = facts({ fonts: [
    { family: "Fraunces", loaded: false, declared: false }, { family: "Inter", loaded: true, declared: true },
    { family: "Arial", loaded: true, declared: false },
  ] });
  const d = C.measuredDiffs(null, f, mix, { hero: false, deck: false });
  ok(kinds(d) === "font:high,font:medium", "phông trong bộ chưa tải là lỗi cao, phông ngoài bộ là lỗi vừa", kinds(d));
  ok(d.every((x) => x.by === "Synchro"), "chênh lệch đo được ghi người đo là Synchro");
  const hero = C.measuredDiffs(null, facts({ media: 0.1 }), mix, { hero: true, deck: false });
  ok(kinds(hero) === "image:high" && /25%/.test(hero[0].target),
    "web thiếu hình chủ đạo: lỗi cao, nêu mục tiêu 25%", hero);
  const marked = facts({ media: 0.1, hero: { ...NO_HERO, marked: true, share: 0.3 } });
  const shader = facts({ media: 0, hero: { ...NO_HERO, shader: true } });
  const shown = [["đánh dấu data-sx-hero", marked], ["nền shader", shader], ["ảnh chiếm 30%", facts({ media: 0.3 })]];
  for (const [name, f2] of shown) {
    ok(!C.measuredDiffs(null, f2, mix, { hero: true, deck: false }).length, `có hình chủ đạo (${name}): không báo`);
  }
  ok(!C.measuredDiffs(null, facts({ media: 0 }), mix, { hero: false, deck: false }).length,
    "định dạng không cần hình: không báo");
  const slide = C.measuredDiffs(null, facts({ content: 0.4 }), mix, { hero: false, deck: true });
  ok(kinds(slide) === "empty-area:medium", "slide nội dung dưới 45% khung: lỗi vừa", slide);
  ok(!C.measuredDiffs(null, facts({ content: 0.35 }), mix, { hero: false, deck: false }).length,
    "trang trống 65% khi mẫu cố ý trống 30% (trần 70%): không báo");
  ok(kinds(C.measuredDiffs(null, facts({ content: 0.2 }), mix, { hero: false, deck: false })) === "empty-area:medium",
    "trang trống 80% vượt trần 70%: lỗi vừa");
  ok(kinds(C.measuredDiffs(null, facts({ content: 0.2 }), null, { hero: false, deck: false })) === "empty-area:medium",
    "không có mẫu: trần trống 40%");
}

console.log("2. Số đo token so với bộ trộn (fixture probe)");
{
  const text = (o) => ({ tag: "p", size: 16, weight: 400, family: "Inter", tracking: 0, line: 1.5, upper: false,
    color: "#f4efe6", bg: "#0e0f0c", chars: 200, x: 0, y: 0, w: 400, h: 24, ...o });
  const probe = {
    url: "about:blank", vw: 1366, vh: 768, scrollH: 2400, pageBg: "#0e0f0c",
    texts: [text({ tag: "h1", size: 40, tracking: 0, chars: 20 }), text({}),
      text({ size: 14, color: "#3a3a3a", chars: 30 })],
    boxes: [{ x: 0, y: 0, w: 300, h: 200, radius: 2, shadow: "none", bg: "#1a1a1a", border: "" },
      { x: 0, y: 0, w: 300, h: 200, radius: 2, shadow: "none", bg: "#1a1a1a", border: "" }],
    media: [], gaps: [24], paddings: [24], maxWidth: 1200, columns: 12,
    fonts: [{ family: "Inter", loaded: true }],
  };
  const d = C.measuredDiffs(probe, facts(), mix, { hero: false, deck: false });
  const by = Object.fromEntries(d.map((x) => [x.property, x]));
  ok(by.contrast?.severity === "high" && /4.5:1/.test(by.contrast.target),
    "chữ 14px tương phản thấp: lỗi cao", by.contrast);
  ok(by.tracking?.measured === "0em" && by.tracking.target === "-0.03em",
    "tiêu đề 40px giãn 0em, mẫu -0.03em", by.tracking);
  ok(by.radius?.measured === "2px" && by.radius.target === "12px", "bo thẻ 2px, mẫu 12px", by.radius);
  ok(by.shadow?.target === "mức 2", "bóng thẻ mức 0, mẫu mức 2", by.shadow);
  ok(by.hierarchy?.severity === "medium", "tiêu đề / thân 2,5 so với thang 6 của mẫu: thứ bậc yếu", by.hierarchy);
  ok(C.needsFix(d), "có lỗi cao: phải sửa");
  const good = { ...probe, texts: [text({ tag: "h1", size: 96, tracking: -0.03 }), text({})],
    boxes: probe.boxes.map((b) => ({ ...b, radius: 12 })) };
  const flat = { ...mix, tokens: { ...tokens, shadow: { level: 0, css: "" } } };
  const ok2 = C.measuredDiffs(good, facts(), flat, page);
  ok(!ok2.length, "bản dựng khớp bộ trộn: không chênh lệch", ok2);
  ok(C.measuredDiffs(probe, facts(), null, { hero: false, deck: false }).map((x) => x.property).join() === "contrast",
    "không có mẫu: chỉ còn lỗi cứng (tương phản)");
}

console.log("3. Khi nào phải sửa");
{
  const d = (severity, property = "layout") => ({ where: "x", property, measured: "", target: "", fix: "f", severity });
  const two = [d("medium"), d("medium"), d("low")], three = [d("medium"), d("medium"), d("medium")];
  ok(C.needsFix([d("high")]) && !C.needsFix(two) && C.needsFix(three),
    "một lỗi cao, hoặc từ 3 lỗi vừa");
  ok(C.hardOnly([d("high", "font"), d("high", "layout"), d("medium", "image"), d("high", "contrast")]).length === 2,
    "khóa dùng chung: chỉ lỗi cứng mức cao (phông, hình chủ đạo, tương phản)");
}

console.log("4. JSON của người chấm");
{
  const text = "Đây là nhận xét:\n```json\n" + JSON.stringify({
    brief: [{ where: "Hero", property: "brief", measured: "thiếu nút CTA", target: "1 nút chính", fix: "Thêm nút",
      severity: "high" }],
    quality: [{ where: "Tiêu đề", property: "letter-spacing", measured: "0", target: "-0.03em", fix: "siết",
      severity: "urgent" }],
    impact: Array.from({ length: 9 }, (_, i) => ({ where: `ô ${i}`, property: "image", measured: "nhỏ", target: "lớn",
      fix: "phóng", severity: "medium" })),
    keep: ["bảng màu", 3],
  }) + "\n```\nHết.";
  const c = C.parseCritique(text, "sub-codex/gpt");
  ok(c && c.brief.length === 1 && c.brief[0].severity === "high", "đọc được JSON trong khối ```json có chữ thừa", c);
  ok(c.quality[0].property === "layout" && c.quality[0].severity === "low",
    "thuộc tính, mức lạ: về layout / low", c.quality[0]);
  ok(c.impact.length === 6 && c.keep.length === 1 && c.brief[0].by === "sub-codex/gpt",
    "tối đa 6 mục mỗi vai, keep chỉ nhận chữ");
  ok(C.parseCritique("không có JSON", "k") === null && C.parseCritique("{hỏng", "k") === null,
    "không đọc được: null, giao bản hiện tại");
}

console.log("5. Lời nhắc <design_review>");
{
  const diffs = [
    { where: "Khung đầu", property: "radius", measured: "2px", target: "12px", fix: "bo 12", severity: "medium" },
    { where: "Khung đầu", property: "image", measured: "10%", target: "25%", fix: "thêm hình", severity: "high" },
  ];
  const r = C.DESIGN_REVIEW({ round: 1, max: 2, diffs, keep: ["bảng màu"], self: true, refs: true, mix: "m-test01" });
  ok(/^<design_review round="1\/2">/.test(r) && r.trim().endsWith("</design_review>"),
    "đánh số vòng 1/2", r.slice(0, 80));
  ok(r.indexOf("[cao]") < r.indexOf("[vừa]"), "lỗi cao đứng trước");
  ok(["data-sx-mix=\"m-test01\"", "<keep/>", "Còn chưa đạt", "bảng màu"].every((x) => r.includes(x)),
    "giữ khối token trộn, có lối <keep/>, nêu chỗ còn chưa đạt, điều đã tốt");
  const judged = C.DESIGN_REVIEW({ round: 2, max: 2, diffs, keep: [], self: false, refs: true, mix: null });
  ok(r.includes("tự xem ảnh đi kèm") && !judged.includes("tự xem ảnh"),
    "không có người chấm: model dựng tự chấm theo ba vai");
}

console.log("6. Người chấm");
{
  const keys = ["sub-claude/claude-sonnet-5-5", "sub-codex/gpt-6.1-sol", "sub-agy/gemini-3-pro", "openai/gpt-6.1",
    "sub-claude/claude-fable-5", "sub-codex/gpt-6-codex", "sub-grok/grok-5-fast", "sub-claude/claude-opus-5-5"];
  const sees = (k) => !k.includes("grok");
  const order = C.orderCritics(keys, "sub-claude/claude-opus-5-5", { sees });
  ok(!order.includes("openai/gpt-6.1"), "không bao giờ khóa API (có thể là khóa dùng chung của máy chủ)", order);
  ok(!order.includes("sub-claude/claude-opus-5-5") && !order.includes("sub-claude/claude-fable-5"),
    "không chấm chính mình, không model tính tiền ngoài gói", order);
  ok(!order.includes("sub-codex/gpt-6-codex") && !order.includes("sub-grok/grok-5-fast"),
    "không model chỉ để code, không model không nhìn được ảnh", order);
  const sonnet = "sub-claude/claude-sonnet-5-5";
  ok(order[order.length - 1] === sonnet && order.indexOf("sub-codex/gpt-6.1-sol") < order.indexOf(sonnet),
    "khác hãng trước, cùng hãng sau", order);
  const stalled = C.orderCritics(keys, "sub-claude/claude-opus-5-5", { sees, stalled: ["sub-codex/gpt-6.1-sol"] });
  ok(stalled[0] !== "sub-codex/gpt-6.1-sol", "tránh CLI vừa treo", stalled);
  ok(C.orderCritics(["openai/gpt-6.1"], "openai/gpt-5", { sees }).length === 0,
    "chỉ có khóa API: không người chấm, model dựng tự chấm");
}

console.log("7. Bảng so sánh");
{
  const sharp = (await import("sharp")).default;
  const jpg = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).jpeg().toBuffer();
  const views = [await jpg(1366, 768, "#202020"), await jpg(1366, 768, "#303030")];
  const refs = [
    { label: "Mẫu 1", jpeg: await jpg(1280, 800, "#d9a441") },
    { label: "Mẫu 2", jpeg: await jpg(800, 1000, "#406080") },
    { label: "Mẫu 3", jpeg: await jpg(800, 600, "#a04040") },
  ];
  const sheet = await C.compareSheet(views, refs);
  const m = sheet ? await sharp(sheet).metadata() : {};
  ok(m.width === 1600 && m.height === 1000 && m.format === "jpeg", "bảng 1600×1000 JPEG", m);
  const one = { left: 1100, top: 200, width: 1, height: 1 };
  const px = sheet ? await sharp(sheet).extract(one).raw().toBuffer() : Buffer.alloc(3);
  ok(px[0] > 180 && px[1] > 130 && px[2] < 110, "ô phải hàng trên là mẫu chính", [...px]);
  ok((await C.compareSheet([], refs)) === null, "không có ảnh bản dựng: không có bảng");
  ok(!!(await C.compareSheet(views.slice(0, 1), [])), "không có mẫu: vẫn có bảng của bản dựng");
  // check_artifact của bộ 8 slide: ảnh chính là bảng tiếp xúc mọi slide và khung điện thoại, không bị bảng so với mẫu
  // (chỉ 2 khung đầu) thay mất.
  const contact = "Q09OVEFDVA==";
  const diff = { where: "Khung đầu", property: "image", measured: "0%", target: "25%", fix: "Thêm ảnh.",
    severity: "high" };
  const both = C.withSheet({ content: "8 slide, 390 px", is_error: false, image: contact }, sheet, [diff]);
  ok(both.image === contact && both.more?.length === 1 && both.more[0].mime === "image/jpeg"
    && both.more[0].data === sheet.toString("base64") && /Ảnh thứ hai là bảng so với mẫu/.test(both.content)
    && both.content.includes("image: 0% → 25%"), "giữ bảng tiếp xúc làm ảnh chính, bảng so với mẫu là ảnh thứ hai",
  { image: both.image, more: both.more?.length, content: both.content });
  const bare = C.withSheet({ content: "svg", is_error: false }, sheet, []);
  ok(bare.image === sheet.toString("base64") && !bare.more, "kết quả không có ảnh: bảng so với mẫu là ảnh duy nhất");
  const none = C.withSheet({ content: "x", is_error: false, image: contact }, null, []);
  ok(none.image === contact && !none.more && none.content === "x", "không dựng được bảng: kết quả giữ nguyên");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
