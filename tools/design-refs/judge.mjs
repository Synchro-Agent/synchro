// Ghi phần chấm bằng mắt vào mẫu đã chụp: tên, tâm trạng, ngành, khán giả, "vì sao", hình (ánh sáng, ống kính, màu,
// chủ thể) và các token người duyệt sửa lại. Trường nào bị sửa tay thì bỏ khỏi `measured`, để biết số nào
// là số đo thật.
// Mẫu bị loại thì xoá ảnh + JSON và ghi lý do vào sources.json.
// node tools/design-refs/judge.mjs <chấm.json> [--sources tools/design-refs/sources.json]
//   <chấm.json>: { "web-001": { "decision": "keep" | "drop", "note", "title", "moods", "industries", "audience",
//     "why", "imagery": {...}, "colors": [["accent", "#5e6ad2"], …], "fonts": { "head": "fraunces" }, "theme",
//     "layout": {...}, "tokens": { "<trường>": {...} } } }
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "catalog/design-refs");
const argv = process.argv.slice(2);
const file = argv[0];
const srcFile = argv.includes("--sources") ? argv[argv.indexOf("--sources") + 1] : "tools/design-refs/sources.json";
if (!file) throw new Error("cần tệp chấm");
const judged = JSON.parse(readFileSync(file, "utf8"));
const sources = JSON.parse(readFileSync(srcFile, "utf8"));
const byId = new Map(sources.candidates.map((c) => [c.id, c]));

const unmeasure = (ref, field) => {
  ref.measured = ref.measured.filter((m) => m !== field);
};
let kept = 0;
let dropped = 0;
for (const [id, j] of Object.entries(judged)) {
  const domain = id.split("-")[0];
  const jsonPath = path.join(CATALOG, domain, `${id}.json`);
  const src = byId.get(id);
  if (j.decision === "drop") {
    rmSync(jsonPath, { force: true });
    rmSync(path.join(CATALOG, domain, `${id}.webp`), { force: true });
    if (src) {
      src.decision = "drop";
      src.note = j.note ?? src.note;
    }
    dropped++;
    continue;
  }
  if (!existsSync(jsonPath)) {
    console.log(`bỏ qua ${id}: chưa chụp`);
    continue;
  }
  const ref = JSON.parse(readFileSync(jsonPath, "utf8"));
  for (const k of ["title", "moods", "industries", "audience", "why", "source_kind", "licence"]) {
    if (j[k] !== undefined) ref[k] = j[k];
  }
  const t = ref.tokens;
  if (j.theme && j.theme !== t.theme) {
    t.theme = j.theme;
    unmeasure(ref, "theme");
  }
  if (j.colors) {
    for (const [role, hex] of j.colors) {
      const old = t.colors.find((c) => c.role === role);
      if (hex === null) t.colors = t.colors.filter((c) => c.role !== role);
      else if (old) {
        if (old.hex !== hex) old.share = 0;
        old.hex = hex;
      } else t.colors.push({ hex, role, share: 0 });
    }
    unmeasure(ref, "colors");
  }
  if (j.fonts) {
    for (const [slot, kit] of Object.entries(j.fonts)) {
      if (kit === null) t.fonts[slot] = null;
      else if (t.fonts[slot]) t.fonts[slot].kit = kit;
      else t.fonts[slot] = { kit, seen: "", seenLicence: "unknown", weight: 400 };
    }
    unmeasure(ref, "fonts");
  }
  for (const [field, value] of Object.entries(j.tokens ?? {})) {
    t[field] = { ...t[field], ...value };
    unmeasure(ref, field);
  }
  if (j.layout) {
    t.layout = { ...t.layout, ...j.layout };
    unmeasure(ref, "layout");
  }
  if (j.imagery) t.imagery = { ...t.imagery, ...j.imagery };
  writeFileSync(jsonPath, JSON.stringify(ref, null, 2) + "\n");
  if (src) src.decision = "keep";
  kept++;
}
writeFileSync(srcFile, JSON.stringify(sources, null, 1) + "\n");
console.log(`giữ ${kept}, loại ${dropped}`);
