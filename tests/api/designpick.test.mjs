// Bộ chọn mẫu tham chiếu (shared/designpick.ts): đọc đề, chọn 3 mẫu, luật không lặp, trộn token, sửa tương phản, khối
// CSS.
// Nghiệm thu của chủ dự án: 7 đề ở mục 7 chạy liên tiếp cho một người ra 7 bảng màu và 7 cặp phông khác nhau, poster
// jazz
// nền tối, dashboard không dùng chữ có chân cho tiêu đề. Chạy trên thư viện tổng hợp và trên thư viện thật nếu đã có.
// Không cần máy chủ.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { makeCatalog } from "../fixtures/designpick/catalog.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const { "shared/designpick": P, "shared/designrefs": R } = await loadTs(["shared/designpick", "shared/designrefs"]);
const briefs = JSON.parse(fs.readFileSync("tests/fixtures/designpick/owner-briefs.json", "utf8"));
const cat = makeCatalog(R);
const byId = new Map(cat.refs.map((r) => [r.id, r]));

console.log("1. Đọc đề");
const F = briefs.map((b) => P.briefFacets(b.text, b.format));
ok(F.map((f) => f.domain).join() === "slide,web,poster,poster,dashboard,doc,poster", "mảng của 7 đề",
  F.map((f) => f.domain));
ok(F[0].industries[0] === "food-beverage" && F[1].industries[0] === "real-estate-interior", "ngành: trà, nội thất",
  F[0]);
ok(F[2].industries.includes("culture-music") && F[2].theme === "dark", "poster jazz: âm nhạc, đêm → nền tối", F[2]);
ok(F[1].moods.includes("minimal-mono") && F[1].moods.includes("warm-craft"),
  "\"tối giản ấm\" là tâm trạng, không là nền tối", F[1]);
ok(F[0].theme === null && F[1].theme === null, "\"tối đa\", \"tối giản\", \"giám đốc sáng tạo\" không đổi nền",
  [F[0].theme, F[1].theme]);
ok(F[4].theme === null && F[4].moods[0] === "data-dense" && !F[4].moods.includes("editorial"),
  "dashboard: \"sáng và tối\" để mẫu quyết định, luôn có data-dense, không editorial", F[4]);
ok(F[0].brand === "Sương Sớm" && F[3].brand === "Lò Ấm" && F[2].brand === "Hà Nội Sau Mưa",
  "tên thương hiệu trong ngoặc");
ok(!F[3].moods.includes("warm-craft") || F[3].moods.join() === P.MOOD_DEFAULTS["food-beverage"].join(),
  "tên \"Lò Ấm\" không bị đọc thành tâm trạng ấm áp (tâm trạng theo ngành)", F[3].moods);
ok(!F.some((f) => f.industries.includes("ai")), "\"không ảnh AI\" không làm đề thành ngành AI",
  F.map((f) => f.industries));
ok(P.briefFacets("Làm slide giới thiệu giải pháp AI cho kho vận", "slide").industries[0] === "ai",
  "AI là chủ đề thì là ngành AI");
ok(!P.briefFacets("Landing page có form kiểm tra dữ liệu", "graphic").industries.includes("food-beverage"),
  "đề có dấu: \"kiểm tra\" không khớp \"trà\"");
const loose = P.briefFacets("lam poster dem nhac jazz nen toi cho quan ca phe", "graphic");
ok(loose.theme === "dark" && loose.industries.includes("culture-music") && loose.industries.includes("food-beverage"),
  "đề gõ không dấu vẫn nhận ngành và nền", loose);
ok(P.briefFacets("Tạo file Excel ngân sách", "sheet") === null, "bảng tính không dùng mẫu");
ok(P.briefFacets("Thiết kế dashboard theo dõi đơn hàng", "graphic").domain === "dashboard"
  && P.briefFacets("Thiết kế email chào mừng", "graphic").domain === "email"
  && P.briefFacets("Làm banner khuyến mãi", "graphic").domain === "poster", "mảng đồ họa: dashboard, email, poster");
ok(P.briefFacets("Làm landing page nền trắng, sáng sủa", "graphic").theme === "light", "nền trắng → sáng");

console.log("2. \"Làm theo kiểu này\" trong câu gõ");
ok(P.followAsk("Làm landing page theo kiểu https://example.com/a.", false)?.url === "https://example.com/a",
  "liên kết + theo kiểu");
ok(P.followAsk("làm poster theo phong cách ảnh này", true)?.image === true, "ảnh đính kèm + theo phong cách");
ok(P.followAsk("lam poster giong trang https://x.vn", false)?.url === "https://x.vn", "không dấu");
ok(P.followAsk("làm poster cho https://x.vn", true) === null,
  "liên kết không kèm lời \"theo kiểu\": không phải đọc phong cách");
ok(P.followAsk("theo phong cách tối giản", false) === null, "không có liên kết, không có ảnh: không đọc gì");

console.log("3. Chọn 3 mẫu");
const pick = (f, history = [], seed = "c1", rows = cat.rows) => P.pickRefs({ facets: f, rows, history, seed });
for (const [k, f] of F.entries()) {
  const p = pick(f);
  const hosts = new Set(p.map((x) => x.row.host));
  ok(p.length === 3 && new Set(p.map((x) => x.row.id)).size === 3 && hosts.size === 3,
    `đề ${k + 1}: 3 mẫu, 3 trang nguồn`,
    p.map((x) => x.row.id + "@" + x.row.host));
  ok(p[0].roles.join() === "palette,layout" && p[1].roles.join() === "type" && p[2].roles.join() === "shape",
    `đề ${k + 1}: vai màu+bố cục, chữ, hình khối`, p.map((x) => x.roles));
}
const jazz = pick(F[2]);
ok(jazz[0].row.theme === "dark", "poster jazz: mẫu chính nền tối", jazz[0].row);
const visual = new Set(["photo", "3d", "illustration", "mixed"]);
ok([F[0], F[1], F[2]].every((f) => pick(f).some((x) => visual.has(x.row.imagery))),
  "web, slide, poster luôn có một mẫu có ảnh");
const dash = pick(F[4]);
ok(dash.every((x) => !x.row.moods.includes("editorial")), "dashboard không nhận mẫu editorial",
  dash.map((x) => x.row.moods));
ok(R.kitFont(dash[1].row.fontPair.split("+")[0]).cat !== "serif", "dashboard: mẫu chữ không có tiêu đề chân",
  dash[1].row);
ok(JSON.stringify(pick(F[0])) === JSON.stringify(pick(F[0])), "cùng đề, cùng đoạn chat: cùng kết quả");
const jit = ["a", "b", "c", "d"].map((s) => P.scoreRef(cat.rows[0], F[1], s));
ok(new Set(jit).size > 1 && Math.max(...jit) - Math.min(...jit) <= 1.5,
  "phần ngẫu nhiên theo đoạn chat, tối đa 1,5 điểm", jit);
const first = pick(F[0]);
const keys = (p) => {
  const t = P.mixTokens(p.map((x) => ({ tokens: byId.get(x.row.id).tokens, roles: x.roles, moods: x.row.moods })),
    "slide", false);
  return { refIds: p.map((x) => x.row.id), ...P.mixKeys(t), brand: null };
};
const h1 = keys(first);
const again = pick(F[0], [h1]);
ok(again.every((x) => !h1.refIds.includes(x.row.id)), "sản phẩm sau không dùng lại mẫu của 3 sản phẩm gần nhất", again);
ok(again[0].row.paletteKey !== h1.paletteKey, "bảng màu chính khác sản phẩm trước", [again[0].row.paletteKey,
  h1.paletteKey]);
ok(keys(again).fontPair !== h1.fontPair, "cặp phông khác sản phẩm trước", [keys(again).fontPair, h1.fontPair]);
const sameBrand = pick({ ...F[0] }, [{ ...h1, brand: "sương sớm" }]);
ok(JSON.stringify(sameBrand) === JSON.stringify(first), "cùng thương hiệu: được dùng lại đúng bộ cũ (giữ nhận diện)");
const sparse = cat.rows.filter((r) => r.domain !== "email" || r.id === "email-001");
const em = pick(P.briefFacets("Thiết kế email chào mừng", "graphic"), [], "c1", sparse);
ok(em.length === 3 && em.some((x) => x.row.domain === "web"), "ít mẫu email: mượn mẫu web", em.map((x) => x.row.id));
ok(pick(F[0], [], "c1", []) === null, "thư viện trống: null (lượt chạy như trước)");
const tiny = cat.rows.filter((r) => r.domain === "doc").slice(0, 2);
const two = pick(F[5], [], "c1", tiny);
ok(two.length === 2 && two[0].roles.includes("shape"), "chỉ có 2 mẫu: mẫu chính giữ luôn vai hình khối",
  two.map((x) => x.roles));

console.log("4. Trộn token, tương phản");
const parts = first.map((x) => ({ tokens: byId.get(x.row.id).tokens, roles: x.roles, moods: x.row.moods }));
const t = P.mixTokens(parts, "slide", false);
const [pa, ty, sh] = parts.map((x) => x.tokens);
ok(t.colors.find((c) => c.role === "bg").hex === pa.colors[0].hex && t.theme === pa.theme, "màu và nền từ mẫu chính");
ok(t.type.ratio === ty.type.ratio && t.tracking.display === ty.tracking.display, "thang chữ, giãn chữ từ mẫu chữ");
ok(t.radius.outer === sh.radius.outer && t.shadow.css === sh.shadow.css, "bo góc, bóng từ mẫu hình khối");
const low = {
  ...pa, theme: "light",
  colors: [{ hex: "#ffffff", role: "bg", share: 0.7 }, { hex: "#bbbbbb", role: "ink", share: 0.2 },
    { hex: "#ffd60a", role: "accent", share: 0.05 }],
};
const lp = P.mixPalette(low.colors, "light");
ok(R.contrastRatio(lp.ink, lp.bg) >= 4.5 && R.contrastRatio(lp.muted, lp.bg) >= 4.5,
  "chữ, chữ phụ đạt 4.5:1 (đẩy độ sáng)",
  [lp.ink, lp.muted, R.contrastRatio(lp.ink, lp.bg)]);
ok(R.contrastRatio(lp.accent, lp.bg) >= 4.5 && lp.vivid === "#ffd60a",
  "nhấn vàng làm chữ được làm sẫm, màu gốc giữ ở vivid", lp);
ok(["surface", "raised", "line", "neutral", "pos", "neg", "accent2"].every((k) => R.isHex(lp[k])),
  "vai thiếu được pha đủ", lp);
const mono = P.mixPalette([{ hex: "#c41c1c", role: "bg", share: 0.8 }, { hex: "#ffffff", role: "ink", share: 0.1 },
  { hex: "#c41c1c", role: "accent", share: 0.8 }, { hex: "#111111", role: "accent2", share: 0.05 }], "dark");
ok(mono.vivid === "#111111" && R.contrastRatio(mono.accent, mono.bg) >= 4.5, "nhấn trùng nền: dùng nhấn phụ", mono);
const darkP = P.mixPalette([{ hex: "#0a0a0a", role: "bg", share: 1 }, { hex: "#333333", role: "ink", share: 0 },
  { hex: "#3b0764", role: "accent", share: 0 }], "dark");
ok(R.contrastRatio(darkP.ink, darkP.bg) >= 4.5 && R.contrastRatio(darkP.accent, darkP.bg) >= 4.5,
  "nền tối: làm sáng chữ, nhấn", darkP);
const display = { ...ty, fonts: { head: { ...ty.fonts.head, kit: "anton" }, body: { ...ty.fonts.body, kit: "oswald" },
  mono: null } };
const td = P.mixTokens([{ tokens: pa, roles: ["palette", "layout", "shape"] }, { tokens: display, roles: ["type"],
  moods: ["tech"] }],
  "web", false);
ok(td.fonts.head.kit === "anton" && td.fonts.body.kit === "inter", "phông thân chỉ cho tiêu đề → đổi sang phông đọc",
  td.fonts);
const serif = { ...ty, fonts: { ...ty.fonts, head: { ...ty.fonts.head, kit: "fraunces" }, body: { ...ty.fonts.body,
  kit: "inter" } } };
const tds = P.mixTokens([{ tokens: pa, roles: ["palette", "layout", "shape"] }, { tokens: serif, roles: ["type"] }],
  "dashboard", false);
ok(tds.fonts.head.kit === "inter", "dashboard: tiêu đề có chân đổi sang phông sans", tds.fonts);
const own = P.mixTokens(parts, "slide", true);
ok(own.colors.length === 0 && own.fonts.head.kit === t.fonts.head.kit,
  "thương hiệu riêng: bỏ màu mẫu, giữ chữ và hình khối");
const imgParts = parts.map((p, k) => ({ ...p, tokens: { ...p.tokens, imagery: { ...p.tokens.imagery,
  kind: k === 2 ? "photo" : "type-only" } } }));
ok(P.mixTokens(imgParts, "slide", false).imagery.kind === "photo", "ảnh lấy từ mẫu đầu tiên có ảnh thật");

console.log("5. Phong cách nền và khối CSS");
const base = (o) => ({ ...t, ...o });
ok(P.basePreset(base({ theme: "dark", radius: { outer: 16, inner: 8, pill: false } })) === "midnight-tech"
  && P.basePreset(base({ theme: "dark", radius: { outer: 4, inner: 2, pill: false } })) === "data-terminal", "nền tối");
ok(P.basePreset(base({ theme: "light", shadow: { level: 2, css: "5px 5px 0 0 #000" } })) === "neo-brutalist",
  "bóng cứng → thô mộc");
ok(P.basePreset(base({ theme: "light", radius: { outer: 24, inner: 12, pill: true }, shadow: { level: 1,
  css: "0 8px 16px rgba(0,0,0,.1)" } }))
  === "soft-bento", "bo lớn → bento");
const flat = base({ theme: "light", radius: { outer: 0, inner: 0, pill: false }, shadow: { level: 0, css: "none" },
  fonts: { ...t.fonts, head: { ...t.fonts.head, kit: "archivo" } } });
ok(P.basePreset(flat) === "swiss-grid", "không bo, không bóng → lưới Thụy Sĩ");
const mix = P.buildMix(parts, "slide", false, "Sương Sớm");
ok(/^m-[0-9a-f]{8}$/.test(mix.id) && mix.id === P.buildMix(parts, "slide", false, "Sương Sớm").id,
  "mã bản trộn ổn định", mix.id);
const css = mix.css;
const varsIn = [...css.matchAll(/(--sx-[\w-]+):/g)].map((m) => m[1]);
ok(R.MIX_VARS.every((v) => varsIn.includes(v)) && varsIn.every((v) => R.MIX_VARS.includes(v)),
  "đúng bộ biến MIX_VARS", varsIn);
const sel = `[data-sx-preset="${mix.preset}"][data-sx-mix="${mix.id}"]{`;
ok(css.includes(sel), "bộ chọn gồm cả phong cách nền và mã bản trộn");
const fontsAttr = /data-sx-fonts="([^"]+)"/.exec(css)[1].split(",");
ok([mix.tokens.fonts.head.kit, mix.tokens.fonts.body.kit].every((k) => fontsAttr.includes(k))
  && fontsAttr.every((k) => R.kitFont(k)),
  "data-sx-fonts liệt kê phông của bộ", fontsAttr);
ok(/--sx-r:\d+;/.test(css) && /--sx-blur:0px/.test(css) && /--sx-track-display:-?[\d.]+em/.test(css),
  "đơn vị như bộ kit");
ok(!/Proprietary/.test(css), "không có tên phông độc quyền mẫu đã dùng");
const ownMix = P.buildMix(parts, "slide", true, null);
ok(!/--sx-bg|--sx-accent/.test(ownMix.css) && /--sx-head/.test(ownMix.css),
  "thương hiệu riêng: khối CSS không đặt màu");
ok(/nền #[0-9a-f]{6}/.test(P.mixLiterals(mix.tokens)), "thư HTML nhận mã màu thẳng");

console.log("6. Màu đọc từ ảnh");
const roles = P.rolesFromPalette([{ hex: "#101418", share: 0.62 }, { hex: "#f2efe8", share: 0.2 }, { hex: "#ff5a1f",
  share: 0.06 },
  { hex: "#2bb3a3", share: 0.04 }, { hex: "#1a2026", share: 0.08 }]);
const role = (r) => roles.find((c) => c.role === r)?.hex;
ok(role("bg") === "#101418" && role("ink") === "#f2efe8" && role("accent") === "#ff5a1f"
  && role("accent2") === "#2bb3a3",
  "nền nhiều nhất, chữ tương phản nhất, nhấn rực nhất", roles);
ok(role("surface") === "#1a2026", "màu gần nền là bề mặt", roles);
ok(P.rolesFromPalette([]) === null, "không có màu: null");
const ft = P.followTokens(roles, {}, null, F[2]);
ok(ft.theme === "dark" && P.validTokens(ft) && ft.fonts.head.kit === P.MOOD_FONTS[F[2].moods[0]][0],
  "token đủ, phông theo tâm trạng", ft.fonts);
ok(P.validTokens({ ...ft, fonts: { ...ft.fonts, head: { kit: "comic-sans" } } }) === null,
  "phông ngoài bộ: không hợp lệ");

/** 7 đề chạy liên tiếp cho một người: lịch sử là sản phẩm trước, mới trước. */
function sevenBriefs(rows, getRef, label) {
  const history = [];
  const out = [];
  for (const [k, f] of F.entries()) {
    const p = P.pickRefs({ facets: f, rows, history, seed: `conv-${k}` });
    const ps = p.map((x) => ({ tokens: getRef(x.row.id).tokens, roles: x.roles, moods: x.row.moods }));
    const m = P.buildMix(ps, f.domain, false, f.brand, { facets: f, history });
    const k2 = P.mixKeys(m.tokens);
    history.unshift({ refIds: p.map((x) => x.row.id), ...k2, brand: f.brand });
    out.push({ ...k2, theme: m.tokens.theme, head: m.tokens.fonts.head.kit, preset: m.preset });
  }
  ok(new Set(out.map((o) => o.paletteKey)).size === 7, `${label}: 7 bảng màu khác nhau`, out.map((o) => o.paletteKey));
  ok(new Set(out.map((o) => o.fontPair)).size === 7, `${label}: 7 cặp phông khác nhau`, out.map((o) => o.fontPair));
  ok(out[2].theme === "dark", `${label}: poster jazz nền tối`, out[2]);
  ok(R.kitFont(out[4].head).cat !== "serif", `${label}: dashboard không dùng tiêu đề có chân`, out[4]);
  console.log(`     ${out.map((o, i) => `${i + 1}:${o.paletteKey}/${o.fontPair}/${o.preset}`).join("  ")}`);
}
console.log("7. Nghiệm thu 7 đề");
sevenBriefs(cat.rows, (id) => byId.get(id), "thư viện tổng hợp");
// Thư viện mà gần như mẫu nào cũng đo ra Inter (trang dùng phông độc quyền, quy về phông gần nhất trong bộ): cặp phông
// vẫn không lặp nhờ cặp phông theo tâm trạng của đề.
const inter = { kit: "inter", seen: "", seenLicence: "open", weight: 400 };
const flatRefs = new Map(cat.refs.map((r) => [r.id, { ...r, tokens: { ...r.tokens, fonts: { head: inter, body: inter,
  mono: null } } }]));
const flatRows = cat.rows.map((r) => ({ ...r, fontPair: "inter+inter" }));
sevenBriefs(flatRows, (id) => flatRefs.get(id), "thư viện chỉ có Inter");
const same = { refIds: [], paletteKey: "x", fontPair: "inter+inter", brand: "Sương Sớm" };
const kept = P.freshFonts({ ...t, fonts: { ...t.fonts, head: inter, body: inter } }, F[0], [same]);
ok(kept.fonts.head.kit === "inter", "cùng thương hiệu: giữ cặp phông cũ", kept.fonts);
const real = path.join("catalog", "design-refs", "index.json");
if (fs.existsSync(real)) {
  const idx = JSON.parse(fs.readFileSync(real, "utf8"));
  const get = (id) => JSON.parse(fs.readFileSync(path.join("catalog", "design-refs", id.split("-")[0],
    `${id}.json`), "utf8"));
  sevenBriefs(idx.refs, get, `thư viện thật (${idx.refs.length} mẫu)`);
} else console.log("     (chưa có catalog/design-refs: bỏ qua phần thư viện thật)");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
