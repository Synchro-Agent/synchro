// Đọc token thiết kế (shared/designextract.ts): bảng màu từ điểm ảnh, bậc bóng, phông gần nhất trong bộ, token từ
// kết quả đo, và mã đo / ẩn logo thật chạy trong Chrome ẩn trên một trang mẫu (bỏ qua phần Chrome nếu máy không
// có).
// Không cần máy chủ. Chạy: node tests/api/designextract.test.mjs
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";
import { openChrome, sleep } from "../lib/cdp.mjs";

let pass = 0;
let fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500));
};
const mods = await loadTs(["shared/designextract", "shared/designrefs"]);
const X = mods["shared/designextract"];
const D = mods["shared/designrefs"];
const FIX = "tests/fixtures/design-refs";
const kitIds = new Set(D.KIT_FONTS.map((f) => f.id));
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, d = 24) => rgbOf(a).every((v, i) => Math.abs(v - rgbOf(b)[i]) <= d);

console.log("1. Bảng màu từ điểm ảnh");
{
  // Ảnh tổng hợp 200×100: nền kem 70%, chữ than 20%, nút cam 3%, phần còn lại là nhiễu nén quanh nền và viền chữ.
  const w = 200;
  const h = 100;
  const px = new Uint8Array(w * h * 4);
  const put = (i, c, j = 0) => {
    px[i * 4] = Math.max(0, Math.min(255, c[0] + j));
    px[i * 4 + 1] = Math.max(0, Math.min(255, c[1] - j));
    px[i * 4 + 2] = Math.max(0, Math.min(255, c[2] + j));
    px[i * 4 + 3] = 255;
  };
  for (let i = 0; i < w * h; i++) {
    const r = (i * 7919) % 1000;
    if (r < 700) put(i, [245, 240, 232], (i % 5) - 2);
    else if (r < 900) put(i, [26, 26, 26], (i % 3) - 1);
    else if (r < 930) put(i, [228, 87, 46]);
    else put(i, [245, 240, 232], (i % 7) - 3);
  }
  const pal = X.paletteFromPixels(px, w, h);
  ok(pal.length >= 3 && pal.length <= 8, "3-8 màu", JSON.stringify(pal));
  ok(near(pal[0].hex, "#f5f0e8") && pal[0].share > 0.75 && pal[0].share < 0.85, "màu đầu là nền, chiếm khoảng 80%",
    JSON.stringify(pal[0]));
  ok(pal.some((c) => near(c.hex, "#1a1a1a") && c.share > 0.15), "có màu chữ than khoảng 20%", JSON.stringify(pal));
  const orange = pal.some((c) => near(c.hex, "#e4572e") && c.share > 0.02);
  ok(orange, "giữ màu nhấn cam dù chỉ 3% diện tích", JSON.stringify(pal));
  const three = X.paletteFromPixels(px, w, h, 3);
  const keeps = three.length === 3 && three.some((c) => near(c.hex, "#e4572e"));
  ok(keeps, "chỉ lấy 3 màu: nhấn vẫn có chỗ", JSON.stringify(three));
  ok(Math.abs(pal.reduce((a, c) => a + c.share, 0) - 1) < 0.02, "tổng diện tích xấp xỉ 1");
  ok(pal.every((c) => D.isHex(c.hex)), "mọi màu dạng #rrggbb");
  const clear = new Uint8Array(w * h * 4);
  ok(X.paletteFromPixels(clear, w, h).length === 0, "ảnh trong suốt: không có màu");
  ok(X.paletteFromPixels(px, 0, 0).length === 0 && X.paletteFromPixels(px.slice(0, 100), w, h).length === 0,
    "kích thước sai: mảng rỗng, không ném lỗi");
}

console.log("2. Bậc bóng");
const SHADOWS = [
  ["none", 0],
  ["", 0],
  ["0 0 0 1px rgba(0,0,0,.1)", 0],
  ["inset 0 1px 0 rgba(255,255,255,.16)", 0],
  ["0 1px 2px 0 rgba(0,0,0,.05)", 1],
  ["0 2px 8px rgba(28,25,23,.04)", 1],
  ["0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)", 1],
  ["0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)", 2],
  ["0 1px 2px -1px rgba(15,23,42,.04),0 8px 16px -4px rgba(15,23,42,.06),0 24px 48px -12px rgba(15,23,42,.08)", 2],
  ["rgba(0, 0, 0, 0.25) 0px 2px 32px 0px", 2],
  ["4px 4px 0 0 #000", 2],
  ["0 25px 50px -12px rgba(0,0,0,.25)", 3],
  ["inset 0 1px 0 0 rgba(255,255,255,.16),0 20px 40px -15px rgba(0,0,0,.65)", 3],
  ["0 30px 60px rgba(0,0,0,0)", 0],
];
for (const [css, want] of SHADOWS) {
  ok(X.shadowLevel(css) === want, `"${css || "(rỗng)"}" → ${want}`, X.shadowLevel(css));
}

console.log("3. Phông gần nhất trong bộ Synchro");
const FONTS = [
  ["Fraunces", "serif", "fraunces"],
  ["Playfair Display", "serif", "playfair-display"],
  ["Helvetica Neue", "sans", "inter"],
  ['"Inter Variable", system-ui, sans-serif', "sans", "inter"],
  ["Söhne", "sans", "inter"],
  ["Circular", "sans", "plus-jakarta-sans"],
  ["Gotham", "sans", "montserrat"],
  ["GT Sectra", "serif", "fraunces"],
  ["Tiempos Text", "serif", "source-serif-4"],
  ["Canela", "serif", "playfair-display"],
  ["Adobe Garamond Pro", "serif", "cormorant-garamond"],
  ["Druk Wide", "display", "unbounded"],
  ["Druk", "display", "anton"],
  ["Bebas Neue", "display", "oswald"],
  ["Berkeley Mono", "mono", "jetbrains-mono"],
  ["Neue Montreal", "sans", "space-grotesk"],
  ["Một phông lạ", "serif", "source-serif-4"],
  ["Một phông lạ", "sans", "inter"],
  ["Neue Haas Grotesk Display", "serif", "playfair-display"],
];
for (const [seen, cat, want] of FONTS) {
  const got = X.nearestKitFont(seen, cat);
  ok(got === want && kitIds.has(got), `${seen} (${cat}) → ${want}`, got);
}
for (const [seen, want] of [["Berkeley Mono", "mono"], ['"Canela", Georgia, serif', "serif"], ["Anton", "display"],
  ['"Graphik", "Helvetica Neue", sans-serif', "sans"], ["Source Serif 4", "serif"], ["Bebas Neue", "display"]]) {
  ok(X.fontCatOf(seen) === want, `loại phông ${seen} → ${want}`, X.fontCatOf(seen));
}

console.log("4. Token từ kết quả đo (trang sáng, chữ có chân)");
const light = JSON.parse(fs.readFileSync(`${FIX}/probe-light.json`, "utf8"));
const palLight = [
  { hex: "#f4f1ea", share: 0.62 },
  { hex: "#1c1a17", share: 0.12 },
  { hex: "#6b645e", share: 0.06 },
  { hex: "#b8452a", share: 0.02 },
  { hex: "#7a8f6a", share: 0.14 },
];
const L = X.tokensFromProbe(light, palLight);
const role = (t, r) => t.colors.filter((c) => c.role === r);
ok(L.tokens.theme === "light", "nền sáng", L.tokens.theme);
ok(["bg", "ink", "accent"].every((r) => role(L.tokens, r).length === 1), "đúng một nền, một chữ, một nhấn",
  JSON.stringify(L.tokens.colors));
ok(role(L.tokens, "bg")[0].hex === "#f4f1ea" && role(L.tokens, "ink")[0].hex === "#1c1a17", "nền và chữ đúng màu",
  JSON.stringify(L.tokens.colors));
ok(role(L.tokens, "muted")[0]?.hex === "#6b645e", "chữ phụ là xám ấm", JSON.stringify(L.tokens.colors));
ok(role(L.tokens, "accent")[0].hex === "#b8452a", "nhấn là màu nút", JSON.stringify(L.tokens.colors));
ok(role(L.tokens, "bg")[0].share === 0.62, "diện tích nền lấy từ bảng màu điểm ảnh", role(L.tokens, "bg")[0].share);
ok(L.tokens.fonts.head.kit === "playfair-display" && L.tokens.fonts.head.seen === "Canela", "tiêu đề Canela → Playfair",
  JSON.stringify(L.tokens.fonts.head));
ok(L.tokens.fonts.head.seenLicence === "proprietary" && L.tokens.fonts.body.kit === "inter",
  "ghi phông độc quyền đã thấy, thân Graphik → Inter", JSON.stringify(L.tokens.fonts));
ok(L.tokens.type.basePx === 18 && L.tokens.type.sizes[0] === 96 && L.tokens.type.ratio > 1.3,
  "chữ thân 18px, cỡ lớn nhất 96px, thang trên 1.3", JSON.stringify(L.tokens.type));
ok(L.tokens.tracking.display === -0.03 && L.tokens.tracking.label > 0.1, "tiêu đề siết −0.03em, nhãn hoa giãn rộng",
  JSON.stringify(L.tokens.tracking));
ok(L.tokens.radius.outer === 4 && L.tokens.radius.pill === true, "thẻ bo 4px, nút viên thuốc",
  JSON.stringify(L.tokens.radius));
ok(L.tokens.shadow.level === 1, "bóng mịn bậc 1", JSON.stringify(L.tokens.shadow));
const airy = L.tokens.spacing.unit === 8 && L.tokens.spacing.density === "airy";
ok(airy, "lưới 8px, thoáng", JSON.stringify(L.tokens.spacing));
ok(L.tokens.layout.align === "asymmetric" && L.tokens.layout.columns === 2, "chữ trái, ảnh phải: lệch",
  JSON.stringify(L.tokens.layout));
ok(L.tokens.imagery.kind === "photo" && L.tokens.imagery.share > 0.2, "hình chụp chiếm phần lớn màn đầu",
  JSON.stringify(L.tokens.imagery));
ok(["theme", "colors", "fonts", "type", "tracking", "radius", "shadow", "spacing", "layout"]
  .every((f) => L.measured.includes(f)) && !L.measured.includes("imagery"),
"trường đo được có trong measured; hình (ánh sáng, ống kính) còn phải chấm bằng mắt", JSON.stringify(L.measured));

console.log("5. Token từ kết quả đo (trang tối, số liệu)");
const dark = JSON.parse(fs.readFileSync(`${FIX}/probe-dark.json`, "utf8"));
const K = X.tokensFromProbe(dark, []);
ok(K.tokens.theme === "dark", "nền tối", K.tokens.theme);
ok(role(K.tokens, "ink")[0].hex === "#f5f7fa", "chữ chính là màu sáng nhất, không phải xám nhiều chữ",
  JSON.stringify(K.tokens.colors));
ok(D.contrastRatio(role(K.tokens, "ink")[0].hex, role(K.tokens, "bg")[0].hex) >= 4.5, "chữ trên nền đạt 4.5:1");
ok(role(K.tokens, "accent")[0].hex === "#7c8cff", "nhấn chàm", JSON.stringify(K.tokens.colors));
ok(role(K.tokens, "pos").length === 1 && role(K.tokens, "neg").length === 1, "có màu tăng / giảm",
  JSON.stringify(K.tokens.colors));
ok(role(K.tokens, "surface")[0]?.hex === "#121620", "bề mặt thẻ", JSON.stringify(K.tokens.colors));
ok(K.tokens.fonts.mono?.kit === "jetbrains-mono" && K.tokens.fonts.body.kit === "inter", "thân Inter, mono JetBrains",
  JSON.stringify(K.tokens.fonts));
ok(K.tokens.type.basePx === 16, "chữ thân 16px: bảng 13px trong ảnh giao diện không tính", K.tokens.type.basePx);
ok(K.tokens.shadow.level === 3 && K.tokens.radius.outer === 12, "bóng sâu bậc 3, thẻ bo 12",
  JSON.stringify([K.tokens.shadow, K.tokens.radius]));
ok(K.tokens.layout.align === "center", "tiêu đề giữa trang", K.tokens.layout.align);
ok(K.tokens.imagery.kind === "3d", "canvas là hình 3D", K.tokens.imagery.kind);
ok(K.tokens.layout.emptyShare >= 0 && K.tokens.layout.emptyShare <= 1, "tỉ lệ trống trong [0, 1]",
  K.tokens.layout.emptyShare);

console.log("6. Chỉ có ảnh (poster, trang PDF): chỉ đo màu");
{
  const blank = { url: "", vw: 800, vh: 1200, scrollH: 1200, pageBg: "", texts: [], boxes: [], media: [], gaps: [],
    paddings: [], maxWidth: 800, columns: 1, fonts: [] };
  const P = X.tokensFromProbe(blank, [
    { hex: "#101820", share: 0.7 },
    { hex: "#f2efe6", share: 0.18 },
    { hex: "#ff5a1f", share: 0.08 },
    { hex: "#5c6670", share: 0.04 },
  ]);
  ok(P.tokens.theme === "dark" && P.measured.join() === "theme,colors", "chỉ có theme và colors",
    JSON.stringify(P.measured));
  ok(role(P.tokens, "bg")[0].hex === "#101820" && role(P.tokens, "ink")[0].hex === "#f2efe6"
    && role(P.tokens, "accent")[0].hex === "#ff5a1f", "nền, chữ, nhấn suy từ bảng màu",
    JSON.stringify(P.tokens.colors));
  ok(X.tokensFromProbe(blank, []).measured.length === 0, "không có gì để đo: không trường nào");
}

console.log("7. Mã đo và ẩn logo chạy thật trong Chrome");
const CHROME = process.env.CHROME_PATH ?? (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/usr/bin/google-chrome");
if (!fs.existsSync(CHROME)) console.log("  (bỏ qua: máy không có Chrome)");
else {
  const t = await openChrome({ base: "about:blank", port: 9200 + (process.pid % 500), name: `dx-${process.pid}` });
  try {
    await t.size(1280, 800);
    const html = fs.readFileSync(`${FIX}/page.html`, "utf8");
    await t.P("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await t.until("document.readyState === 'complete'", 10_000);
    await sleep(200);
    const hidden = await t.ev(`(${X.HIDE_MARKS})()`);
    const state = await t.ev(`({
      logo: getComputedStyle(document.querySelector(".site-logo")).visibility,
      cookie: getComputedStyle(document.querySelector(".cookie")).display,
      strip: [...document.querySelectorAll(".logos img")].map((i) => getComputedStyle(i).visibility),
      h1: getComputedStyle(document.querySelector("h1")).visibility,
      nav: getComputedStyle(document.querySelector("nav")).visibility,
    })`);
    ok(hidden >= 6, `ẩn logo, dải logo khách hàng và hộp cookie (${hidden} phần tử)`, hidden);
    ok(state.logo === "hidden" && state.strip.every((v) => v === "hidden"), "logo và dải logo bị ẩn, giữ chỗ",
      JSON.stringify(state));
    ok(state.cookie === "none", "hộp cookie bỏ hẳn", state.cookie);
    const kept = state.h1 === "visible" && state.nav === "visible";
    ok(kept, "tiêu đề và thanh điều hướng giữ nguyên", JSON.stringify(state));
    const probe = await t.ev(`(${X.TOKEN_PROBE})(document.body)`);
    const h1 = probe.texts.find((x) => x.tag === "h1");
    ok(probe.vw === 1280 && probe.vh === 800 && probe.pageBg === "#0e0f0c", "khung 1280×800, nền trang đo đúng",
      JSON.stringify([probe.vw, probe.vh, probe.pageBg]));
    ok(h1 && h1.size === 72 && Math.abs(h1.tracking + 0.03) < 0.002 && h1.weight === 700, "h1 72px, siết −0.03em",
      JSON.stringify(h1));
    ok(probe.texts.some((x) => x.upper && x.size === 12 && x.tracking > 0.1), "nhãn chữ hoa nhỏ giãn 0.12em");
    ok(probe.columns === 3, "đếm được 3 cột thẻ", probe.columns);
    ok(probe.boxes.some((b) => b.radius === 16 && X.shadowLevel(b.shadow) === 3), "thẻ bo 16, bóng sâu",
      JSON.stringify(probe.boxes.slice(0, 6)));
    ok(probe.boxes.some((b) => b.radius >= b.h / 2 && b.bg === "#c9f24a"), "nút viên thuốc màu chanh");
    ok(probe.gaps.includes(24) && probe.paddings.includes(120), "gap 24 của lưới, đệm 120 của phần đầu",
      JSON.stringify([probe.gaps, probe.paddings]));
    ok(probe.fonts.some((f) => f.family === "NoSuchFamilyXyz" && f.loaded === false),
      "phông không tồn tại báo chưa tải dù fonts.check() trả true", JSON.stringify(probe.fonts));
    const T = X.tokensFromProbe(probe, []);
    ok(T.tokens.theme === "dark" && T.tokens.colors.find((c) => c.role === "accent")?.hex === "#c9f24a",
      "token: nền tối, nhấn chanh", JSON.stringify(T.tokens.colors));
    const shape = T.tokens.radius.outer === 16 && T.tokens.radius.pill && T.tokens.shadow.level === 3;
    ok(shape, "token: bo 16, có viên thuốc",
      JSON.stringify([T.tokens.radius, T.tokens.shadow]));
    ok(T.tokens.fonts.head.kit === "fraunces" && T.tokens.fonts.body.kit === "inter", "token: Fraunces + Inter",
      JSON.stringify(T.tokens.fonts));
    ok(T.tokens.tracking.display === -0.03 && T.tokens.layout.columns === 3, "token: siết −0.03em, 3 cột",
      JSON.stringify([T.tokens.tracking, T.tokens.layout]));
    // Đo một khung slide trong trang: toạ độ tính từ khung, màn đầu là chính khung 1280×720.
    await t.ev(`(() => {
      const s = document.createElement("div");
      s.id = "slide";
      s.style.cssText = "position:absolute;left:0;top:2000px;width:1280px;height:720px;background:#f7f3ea;color:#222";
      s.innerHTML = '<h2 style="margin:64px;font:600 64px/1.1 Georgia,serif">Một ý chính mỗi trang</h2>';
      document.body.append(s);
      s.scrollIntoView();
    })()`);
    const slide = await t.ev(`(${X.TOKEN_PROBE})(document.getElementById("slide"))`);
    const h2 = slide?.texts.find((x) => x.tag === "h2");
    ok(slide && slide.vw === 1280 && slide.vh === 720 && h2 && h2.y >= 60 && h2.y < 120, "đo trong khung slide",
      JSON.stringify([slide?.vw, slide?.vh, h2?.y]));
    ok(slide?.pageBg === "#f7f3ea", "nền của khung slide, không phải của trang", slide?.pageBg);
    ok((await t.ev(`(${X.TOKEN_PROBE})(null)`)) !== undefined, "root rỗng: đo cả trang");
  } finally {
    t.close();
  }
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
