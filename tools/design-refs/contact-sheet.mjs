// Tờ ảnh thu nhỏ của nhiều mẫu tham chiếu để người duyệt xem một lượt (kèm mã mẫu dưới mỗi ô).
// node tools/design-refs/contact-sheet.mjs <ra.jpg> [--cols 4] [--cell 400] [--random 12] [--domain web]
//   [--top 140] [--ratio 0.6] [id …]
// Không có id: lấy cả mảng (--domain) hoặc cả thư viện; --random n chọn ngẫu nhiên n mẫu.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const sharp = createRequire(path.join(ROOT, "package.json"))("sharp");
const CATALOG = path.join(ROOT, "catalog/design-refs");

const argv = process.argv.slice(2);
const out = argv.shift();
const opt = { cols: 4, cell: 400, random: 0, domain: "" };
const ids = [];
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k.startsWith("--")) opt[k.slice(2)] = /^\d+$/.test(argv[i + 1]) ? Number(argv[++i]) : argv[++i];
  else ids.push(k);
}
if (!out) throw new Error("cần đường dẫn ảnh ra");

const all = [];
for (const d of readdirSync(CATALOG)) {
  const dir = path.join(CATALOG, d);
  if (!existsSync(dir) || d.includes(".")) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    all.push(JSON.parse(readFileSync(path.join(dir, f))));
  }
}
const inDomain = all.filter((r) => !opt.domain || r.domain === opt.domain);
let refs = ids.length ? all.filter((r) => ids.includes(r.id)) : inDomain;
const missing = ids.filter((id) => !all.some((r) => r.id === id));
if (missing.length) console.warn(`không có mẫu: ${missing.join(", ")}`);
if (opt.random) {
  // Xáo cố định theo ngày để hai lần chạy cùng ngày ra cùng một tờ; băm SHA-1 để mã cùng tiền tố (web-0…) không
  // dồn về một mảng.
  const seed = new Date().toISOString().slice(0, 10);
  const score = (id) => createHash("sha1").update(seed + id).digest().readUInt32BE(0);
  refs = refs.sort((a, b) => score(a.id) - score(b.id)).slice(0, opt.random);
}
refs.sort((a, b) => a.id.localeCompare(b.id));
if (!refs.length) {
  console.error("không có mẫu nào để ghép tờ ảnh");
  process.exit(1);
}
const W = opt.cell;
// --top 140: chỉ lấy dải trên cùng cao 140 px của ảnh gốc (nơi logo hay nằm) để soát dấu thương hiệu cả loạt.
const top = Number(opt.top) || 0;
const H = top ? Math.round((W * top) / 1280) : Math.round(W * (Number(opt.ratio) || 1.25));
const LABEL = 28;
const rows = Math.ceil(refs.length / opt.cols);
const tiles = [];
for (const [i, r] of refs.entries()) {
  const file = path.join(CATALOG, r.image.file);
  const band = top ? { left: 0, top: 0, width: r.image.width, height: Math.min(r.image.height, top) } : null;
  const img = await (band ? sharp(file).extract(band) : sharp(file))
    .resize(W, H, { fit: "contain", position: "top", background: "#e9e9e6" })
    .toBuffer();
  const esc = (s) => s.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" })[c]);
  const label = `${r.id} · ${r.tokens.theme} · ${r.title || r.source_host}`.slice(0, 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL}"><rect width="100%" height="100%"
    fill="#111"/><text x="8" y="19" font-family="Helvetica" font-size="14" fill="#fff">${esc(label)}</text></svg>`;
  const x = (i % opt.cols) * W;
  const y = Math.floor(i / opt.cols) * (H + LABEL);
  tiles.push({ input: img, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y + H });
}
const canvas = { width: W * opt.cols, height: rows * (H + LABEL), channels: 3, background: "#fff" };
const sheet = await sharp({ create: canvas })
  .composite(tiles)
  .jpeg({ quality: 82 })
  .toBuffer();
writeFileSync(out, sheet);
console.log(`${refs.length} mẫu → ${out}`);
