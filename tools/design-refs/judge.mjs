// Ghi phần chấm bằng mắt vào mẫu đã chụp: tên, tâm trạng, ngành, khán giả, "vì sao", hình (ánh sáng, ống kính, màu,
// chủ thể) và các token người duyệt sửa lại. Trường nào bị sửa tay thì bỏ khỏi `measured`, để biết số nào
// là số đo thật.
// Mẫu bị loại thì xoá ảnh + JSON và ghi lý do vào sources.json.
// node tools/design-refs/judge.mjs <chấm.json> [--sources tools/design-refs/sources.json]
//   <chấm.json>: { "web-001": { "decision": "keep" | "drop", "note", "title", "moods", "industries", "audience",
//     "why", "imagery": {...}, "colors": [["accent", "#5e6ad2"], …], "fonts": { "head": "fraunces" } hoặc
//     { "head": { "kit": "fraunces", "weight": 700 } }, "theme", "layout": {...}, "tokens": { "<trường>": {...} },
//     "source_url", "credit", "rights_url" } }
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
  if (j.source_url || j.credit || j.rights_url) {
    // Nguồn là trang của chính tác phẩm (hoặc địa chỉ ảnh kèm tên người làm), không phải trang danh sách: đặt lại các
    // khoá liền sau source_kind để tệp đọc như một bản ghi nguồn liền mạch, và ghi cùng địa chỉ vào sources.json để
    // lần chụp lại sau kiểm robots.txt đúng trang đó.
    const sourceUrl = j.source_url ?? ref.source_url;
    const prov = {
      source_url: sourceUrl,
      source_host: new URL(sourceUrl).host.replace(/^www\./, ""),
      source_kind: ref.source_kind,
      ...(j.credit ?? ref.credit ? { credit: j.credit ?? ref.credit } : {}),
      ...(j.rights_url ?? ref.rights_url ? { rights_url: j.rights_url ?? ref.rights_url } : {}),
    };
    const entries = Object.entries(ref).filter(([k]) => !(k in prov) && k !== "credit" && k !== "rights_url");
    const at = entries.findIndex(([k]) => k === "captured_at");
    entries.splice(at, 0, ...Object.entries(prov));
    for (const k of Object.keys(ref)) delete ref[k];
    Object.assign(ref, Object.fromEntries(entries));
    if (src) {
      src.sourceUrl = sourceUrl;
      if (j.credit) src.credit = j.credit;
      if (j.rights_url) src.rightsUrl = j.rights_url;
    }
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
    // "head": "fraunces" chỉ đổi phông; "head": { "kit": "fraunces", "weight": 700 } đổi cả độ đậm nhìn thấy.
    for (const [slot, v] of Object.entries(j.fonts)) {
      const { kit, weight } = typeof v === "string" ? { kit: v } : (v ?? {});
      if (v === null) t.fonts[slot] = null;
      else if (t.fonts[slot]) t.fonts[slot] = { ...t.fonts[slot], kit: kit ?? t.fonts[slot].kit,
        weight: weight ?? t.fonts[slot].weight };
      else t.fonts[slot] = { kit, seen: "", seenLicence: "unknown", weight: weight ?? 400 };
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
