// Kiểm mọi mẫu trong catalog/design-refs rồi ghi index.json (bản tóm tắt cho bộ chọn mẫu) và in báo cáo dung lượng,
// hạn mức, độ đa dạng. Có lỗi thì không ghi chỉ mục, để bộ chọn không bao giờ đọc phải một mẫu hỏng.
// node tools/design-refs/build-index.mjs [--check]   (--check: chỉ kiểm, không ghi)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../../tests/lib/ts.mjs";

const ROOT = process.cwd();
const sharp = createRequire(path.join(ROOT, "package.json"))("sharp");
const CATALOG = path.join(ROOT, "catalog/design-refs");
const mods = await loadTs(["shared/designrefcheck", "shared/designrefs"]);
const C = mods["shared/designrefcheck"];
const D = mods["shared/designrefs"];

/** Đọc cả thư viện cùng số đo thật của từng ảnh (kích thước, dung lượng trên đĩa). */
export async function readCatalog() {
  const refs = [];
  const files = new Map();
  for (const d of D.REF_DOMAINS) {
    const dir = path.join(CATALOG, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      const ref = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      refs.push(ref);
      const img = path.join(CATALOG, ref.image?.file ?? "");
      if (!existsSync(img) || !ref.image?.file) {
        files.set(ref.id, null);
        continue;
      }
      const meta = await sharp(img).metadata();
      files.set(ref.id, { format: meta.format, width: meta.width, height: meta.height, bytes: statSync(img).size });
    }
  }
  const sources = JSON.parse(readFileSync(path.join(ROOT, "tools/design-refs/sources.json"), "utf8")).candidates;
  return { refs, files, sources };
}

/** Lỗi theo mẫu và lỗi cả thư viện; ảnh thừa (không có JSON) cũng là lỗi vì sẽ nằm trong repo vô ích. */
export function validate({ refs, files, sources }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const errors = [];
  for (const ref of refs) {
    const src = byId.get(ref.id);
    const brands = src?.brand ? [src.brand] : [];
    const own = C.checkRef(ref, brands).map((e) => `${ref.id}: ${e}`);
    const f = files.get(ref.id);
    if (!f) own.push(`${ref.id}: thiếu ảnh`);
    else if (f.format !== "webp" || f.width !== ref.image.width || f.height !== ref.image.height
      || f.bytes !== ref.image.bytes) {
      own.push(`${ref.id}: ảnh trên đĩa ${f.format} ${f.width}×${f.height} ${f.bytes} B khác JSON`);
    }
    if (!src) own.push(`${ref.id}: không có trong sources.json`);
    else if (src.decision !== "keep") own.push(`${ref.id}: sources.json ghi ${src.decision}, cần keep`);
    errors.push(...own);
  }
  const known = new Set(refs.map((r) => r.image?.file));
  for (const d of D.REF_DOMAINS) {
    const dir = path.join(CATALOG, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".webp"))) {
      if (!known.has(`${d}/${f}`)) errors.push(`${d}/${f}: ảnh không có JSON`);
    }
  }
  const vn = new Set(sources.filter((s) => s.vn).map((s) => s.id));
  const cat = C.checkCatalog(refs, vn);
  errors.push(...cat.errors);
  return { errors, stats: cat.stats };
}

export function buildIndex(refs, builtAt) {
  const rows = refs.map((r) => C.indexRow(r)).sort((a, b) => a.id.localeCompare(b.id));
  return { v: 1, built_at: builtAt, refs: rows };
}

function report(stats, indexBytes) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log("Mảng        số mẫu / hạn mức   tâm trạng");
  for (const d of D.REF_DOMAINS) {
    const n = `${stats.perDomain[d]} / ${D.REF_QUOTA[d]}`;
    console.log(`  ${d.padEnd(10)} ${n.padEnd(18)} ${stats.moodsPerDomain[d]}`);
  }
  const mb = (stats.bytes / 1e6).toFixed(2);
  console.log(`Tổng ${stats.total} mẫu, ảnh ${mb} MB (trần 15 MB), chỉ mục ${indexBytes} B`);
  console.log(`Tối ${pct(stats.darkShare)}, có hình thật ${pct(stats.pictureShare)}, Việt Nam ${stats.vietnamese}`);
  console.log(`Kem + chữ có chân + đồng: ${stats.creamSerifCopper.join(", ") || "không có"}`);
}

async function main() {
  const onlyCheck = process.argv.includes("--check");
  const cat = await readCatalog();
  const { errors, stats } = validate(cat);
  const index = buildIndex(cat.refs, new Date().toISOString().slice(0, 10));
  const text = JSON.stringify(index, null, 1) + "\n";
  report(stats, Buffer.byteLength(text));
  if (errors.length) {
    console.log(`\n${errors.length} lỗi:`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!onlyCheck) writeFileSync(path.join(CATALOG, "index.json"), text);
  console.log(onlyCheck ? "hợp lệ" : "đã ghi catalog/design-refs/index.json");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
