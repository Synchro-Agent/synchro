// Thư viện mẫu thiết kế tham chiếu (catalog/design-refs): mọi mẫu hợp lệ, ảnh đúng kích thước và dung lượng, cả thư
// viện đủ hạn mức và đủ đa dạng, chỉ mục khớp tệp, nguồn được kiểm robots.txt. Phần đầu kiểm bộ kiểm tra bằng mẫu giả.
// Không cần máy chủ. Chạy: node tests/api/design-refs.test.mjs
import { existsSync, readFileSync, statSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";
import { buildIndex, readCatalog, validate } from "../../tools/design-refs/build-index.mjs";

let pass = 0;
let fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 800));
};
const mods = await loadTs(["shared/designrefcheck", "shared/designrefs"]);
const C = mods["shared/designrefcheck"];
const D = mods["shared/designrefs"];
const clone = (x) => JSON.parse(JSON.stringify(x));

const cat = await readCatalog();
const base = cat.refs.find((r) => r.id === "web-001") ?? cat.refs[0];

console.log("1. Bộ kiểm một mẫu");
{
  ok(C.checkRef(base, []).length === 0, "mẫu thật hợp lệ", C.checkRef(base, []).join("; "));
  const named = clone(base);
  named.title = "Trang chủ Linear nền đen";
  ok(C.checkRef(named, ["Linear"]).some((e) => e.includes("title")), "bắt tên thương hiệu trong tên mẫu");
  const short = clone(base);
  short.why = "Bố cục này hay. Màu đẹp 12 px. Chữ rõ.";
  ok(!C.checkRef(short, ["HAY"]).some((e) => e.includes("HAY")), "từ thường 'hay' không bị coi là thương hiệu HAY");
  const font = clone(base);
  font.tokens.fonts.head.kit = "helvetica-neue";
  ok(C.checkRef(font).some((e) => e.includes("fonts.head")), "phông ngoài bộ bị bắt");
  const two = clone(base);
  two.tokens.colors.push({ hex: "#ff0000", role: "accent", share: 0 });
  ok(C.checkRef(two).some((e) => e.includes("đúng một accent")), "hai màu nhấn bị bắt");
  const viet = clone(base);
  viet.tokens.imagery = { kind: "photo", share: 0.5, light: "ánh sáng cửa sổ", lens: "85mm", grade: "warm",
    subject: "tea" };
  ok(C.checkRef(viet).some((e) => e.includes("imagery.light")), "mô tả hình cho câu lệnh ảnh phải là tiếng Anh");
  const longWhy = clone(base);
  longWhy.why = "Một 1. Hai. Ba. Bốn. Năm. Sáu.";
  ok(C.checkRef(longWhy).some((e) => e.includes("why: 6 câu")), "why quá 5 câu bị bắt");
  ok(C.sentenceCount("Siết −0,03em. Nền #08090a, chữ 15 px! Hết") === 3, "đếm câu không tách ở số thập phân dùng phẩy");
}

console.log("2. Nhận ra kiểu kem + chữ có chân + đồng");
{
  const t = clone(base.tokens);
  t.theme = "light";
  t.colors = [
    { hex: "#f4ecdf", role: "bg", share: 0.8 },
    { hex: "#2b2724", role: "ink", share: 0.1 },
    { hex: "#a65f3a", role: "accent", share: 0.02 },
  ];
  t.fonts.head.kit = "playfair-display";
  ok(C.isCreamSerifCopper(t), "kem #f4ecdf + Playfair + đồng #a65f3a");
  t.fonts.head.kit = "inter";
  ok(!C.isCreamSerifCopper(t), "cùng màu nhưng tiêu đề không chân thì không tính");
  t.fonts.head.kit = "fraunces";
  t.colors[0].hex = "#ffffff";
  ok(!C.isCreamSerifCopper(t), "nền trắng lạnh không tính");
}

console.log("3. Cả thư viện");
{
  const { errors, stats } = validate(cat);
  ok(errors.length === 0, `không lỗi (${stats.total} mẫu)`, errors.slice(0, 25).join("\n    "));
  const total = Object.values(D.REF_QUOTA).reduce((a, b) => a + b, 0);
  ok(stats.total === total, `đủ ${total} mẫu`, JSON.stringify(stats.perDomain));
  ok(stats.bytes < D.REF_LIMITS.catalogMaxBytes, `ảnh ${(stats.bytes / 1e6).toFixed(2)} MB dưới 15 MB`);
  ok(stats.darkShare >= C.VARIETY.darkShare, `mẫu tối ${Math.round(stats.darkShare * 100)}%`);
  ok(stats.pictureShare >= C.VARIETY.pictureShare, `mẫu có hình thật ${Math.round(stats.pictureShare * 100)}%`);
  ok(stats.vietnamese >= C.VARIETY.vietnamese, `mẫu Việt Nam ${stats.vietnamese}`);
  const cream = stats.creamSerifCopper;
  ok(cream.length <= C.VARIETY.creamSerifCopper, `kiểu kem-đồng: ${cream.join(", ") || "không có"}`);
  for (const d of D.REF_DOMAINS) {
    const moods = stats.moodsPerDomain[d];
    ok(moods >= C.VARIETY.moodsPerDomain, `${d}: ${moods} tâm trạng`);
  }
  const big = [...cat.files.values()].filter((f) => f && f.bytes > D.REF_LIMITS.imageMaxBytes);
  ok(big.length === 0, "mọi ảnh dưới 100 KB", JSON.stringify(big));
}

console.log("4. Chỉ mục");
{
  const file = "catalog/design-refs/index.json";
  ok(existsSync(file), "có index.json");
  const index = JSON.parse(readFileSync(file, "utf8"));
  const fresh = buildIndex(cat.refs, index.built_at);
  ok(JSON.stringify(index) === JSON.stringify(fresh), "index.json khớp các tệp mẫu (chạy lại build-index.mjs nếu sai)");
  ok(statSync(file).size < 200_000, `index.json ${statSync(file).size} B dưới 200 KB`);
  const keys = new Set(index.refs.map((r) => `${r.paletteKey}|${r.fontPair}`));
  ok(keys.size >= index.refs.length * 0.5, `${keys.size} cặp bảng màu + phông khác nhau trên ${index.refs.length} mẫu`);
}

console.log("5. Nguồn");
{
  const src = cat.sources;
  ok(src.length >= 220, `${src.length} nguồn ứng viên`);
  const kept = src.filter((s) => s.decision === "keep");
  const blocked = kept.filter((s) => s.robots === "disallowed" || s.robots === "ai-optout");
  ok(blocked.length === 0, "không giữ nguồn bị robots.txt chặn", blocked.map((s) => s.id).join(", "));
  const orphan = kept.filter((s) => !cat.refs.some((r) => r.id === s.id));
  ok(orphan.length === 0, "nguồn 'keep' nào cũng có mẫu", orphan.map((s) => s.id).join(", "));
  const undated = cat.refs.filter((r) => !r.source_url || !r.captured_at);
  ok(undated.length === 0, "mọi mẫu ghi nguồn và ngày chụp", undated.map((r) => r.id).join(", "));
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
