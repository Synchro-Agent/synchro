// Bộ phông Synchro tự phục vụ (/kitfonts/v1/): artifact, tệp tải về, ảnh PNG và PowerPoint vẫn đúng phông khi mạng
// ngoài bị chặn (tường lửa công ty, Google Fonts bị chặn), vì khung artifact chỉ tải phông từ chính Synchro.
// Mỗi họ phông: tệp woff2 theo từng bộ ký tự (vietnamese, latin-ext, latin) như Google Fonts chia, để trang chỉ tải
// phần có chữ nó dùng; bốn phông có chân có thêm bản nghiêng. Tất cả là giấy phép OFL-1.1, OFL.txt đi kèm từng thư mục.
//
// node tools/fetch-kit-fonts.mjs           lấy lại từ Google Fonts, ghi public/kitfonts/v1/** và shared/kitfonts.ts
// node tools/fetch-kit-fonts.mjs --check   không cần mạng: so mọi tệp trên đĩa với mã băm sha256 đã ghim trong
//                                          shared/kitfonts.ts (kích thước, mã băm, face.css khớp danh sách tệp)
// Đã có shared/kitfonts.ts thì lần lấy lại phải ra đúng từng byte đã ghim: Google đổi tệp sau cùng một địa chỉ là lỗi,
// không lặng lẽ thay phông của mọi artifact. Muốn nâng bản phông có chủ đích: thêm --update.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/kitfonts/v1");
const MANIFEST = path.join(ROOT, "shared/kitfonts.ts");
// Trình duyệt hiện đại: Google Fonts chỉ trả woff2 (và chia theo unicode-range) cho chuỗi nhận dạng như vậy.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
  + " Chrome/124.0 Safari/537.36";
// Kho google/fonts ghim cùng commit với phông trong workspace/Dockerfile: OFL.txt đúng bản của tệp phông.
const OFL_COMMIT = "bbda7253fc363238b05d97515ca71f8ae49c4fa9";
const SUBSETS = ["vietnamese", "latin-ext", "latin"];
// Ngân sách cả bộ: đủ nhỏ để nằm trong repo và bản build, đủ để 17 họ có đủ độ đậm.
const BUDGET = 8 * 1024 * 1024;

// id trùng shared/designrefs.ts KIT_FONTS; axes là phần sau dấu ":" của địa chỉ css2 (phông biến thiên: một tệp mỗi
// bộ ký tự cho mọi độ đậm). Be Vietnam Pro và Anton không có bản biến thiên nên liệt kê độ đậm.
const FONTS = [
  { id: "be-vietnam-pro", family: "Be Vietnam Pro", dir: "bevietnampro", axes: "wght@300;400;500;600;700;800" },
  { id: "inter", family: "Inter", dir: "inter", axes: "wght@100..900" },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", dir: "plusjakartasans", axes: "wght@200..800" },
  { id: "montserrat", family: "Montserrat", dir: "montserrat", axes: "wght@100..900" },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", dir: "ibmplexsans", axes: "wght@100..700" },
  { id: "archivo", family: "Archivo", dir: "archivo", axes: "wght@100..900" },
  { id: "bricolage-grotesque", family: "Bricolage Grotesque", dir: "bricolagegrotesque", axes: "wght@200..800" },
  { id: "space-grotesk", family: "Space Grotesk", dir: "spacegrotesk", axes: "wght@300..700" },
  { id: "lexend", family: "Lexend", dir: "lexend", axes: "wght@100..900" },
  { id: "unbounded", family: "Unbounded", dir: "unbounded", axes: "wght@200..900" },
  { id: "oswald", family: "Oswald", dir: "oswald", axes: "wght@200..700" },
  { id: "anton", family: "Anton", dir: "anton", axes: "" },
  { id: "playfair-display", family: "Playfair Display", dir: "playfairdisplay",
    axes: "ital,wght@0,400..900;1,400..900" },
  { id: "fraunces", family: "Fraunces", dir: "fraunces", axes: "ital,wght@0,100..900;1,100..900" },
  { id: "source-serif-4", family: "Source Serif 4", dir: "sourceserif4", axes: "ital,wght@0,200..900;1,200..900" },
  { id: "cormorant-garamond", family: "Cormorant Garamond", dir: "cormorantgaramond",
    axes: "ital,wght@0,300..700;1,300..700" },
  { id: "jetbrains-mono", family: "JetBrains Mono", dir: "jetbrainsmono", axes: "wght@100..800" },
];

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const css2 = (f) => `${f.family.replace(/ /g, "+")}${f.axes ? `:${f.axes}` : ""}`;

async function get(url, as) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return as === "text" ? r.text() : Buffer.from(await r.arrayBuffer());
}

/** Các mặt phông trong CSS của Google: bộ ký tự (chú thích đứng trước), kiểu, độ đậm, địa chỉ, unicode-range. */
function facesOf(css) {
  const out = [];
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const pick = (k) => new RegExp(`${k}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
    const url = /url\(([^)]+)\)/.exec(body)?.[1] ?? "";
    const face = { style: pick("font-style"), weight: pick("font-weight"), url, range: pick("unicode-range") };
    out.push({ subset: m[1], ...face });
  }
  return out;
}

async function readPins() {
  if (!fs.existsSync(MANIFEST)) return new Map();
  const src = fs.readFileSync(MANIFEST, "utf8");
  const json = /KIT_FONT_FILES = (\{[\s\S]*?\}) as const/.exec(src)?.[1];
  if (!json) return new Map();
  const files = JSON.parse(json);
  const pins = new Map();
  for (const [id, list] of Object.entries(files)) for (const f of list) pins.set(`${id}/${f.file}`, f);
  return pins;
}

function manifestTs(files, total) {
  const css = Object.fromEntries(FONTS.map((f) => [f.id, css2(f)]));
  return `// Tệp sinh bởi tools/fetch-kit-fonts.mjs, không sửa tay: danh sách tệp phông của bộ Synchro tự phục vụ
// (public/kitfonts/v1/<id>/), mã băm sha256 đã ghim và phần css2 của Google Fonts (đường dự phòng khi trang không có
// địa chỉ Synchro). Kiểm thử: tests/api/kitfonts.test.mjs; node tools/fetch-kit-fonts.mjs --check để đối chiếu.
export const KIT_FONT_DIR = "/kitfonts/v1";
export const KIT_FONT_BYTES = ${total};
export const KIT_FONT_CSS2 = ${JSON.stringify(css, null, 2)} as const;
export type KitFontFile = {
  file: string; subset: string; style: string; weight: string; bytes: number; sha256: string;
};
export const KIT_FONT_FILES = ${JSON.stringify(files, null, 2)} as const;
/** Địa chỉ face.css của một phông trong bộ (origin rỗng: đường dẫn tương đối của chính Synchro). */
export const kitFaceUrl = (origin: string, id: string) => \`\${origin}\${KIT_FONT_DIR}/\${id}/face.css\`;
`;
}

async function check() {
  const pins = await readPins();
  if (!pins.size) throw new Error("Chưa có shared/kitfonts.ts: chạy node tools/fetch-kit-fonts.mjs trước.");
  let total = 0;
  const bad = [];
  for (const [key, f] of pins) {
    const p = path.join(OUT, key);
    if (!fs.existsSync(p)) {
      bad.push(`${key}: thiếu tệp`);
      continue;
    }
    const buf = fs.readFileSync(p);
    total += buf.length;
    if (buf.length !== f.bytes || sha(buf) !== f.sha256) bad.push(`${key}: mã băm hoặc kích thước khác bản đã ghim`);
  }
  for (const f of FONTS) {
    const face = path.join(OUT, f.id, "face.css");
    if (!fs.existsSync(face)) bad.push(`${f.id}: thiếu face.css`);
    if (!fs.existsSync(path.join(OUT, f.id, "OFL.txt"))) bad.push(`${f.id}: thiếu OFL.txt`);
  }
  if (bad.length) throw new Error(bad.join("\n"));
  console.log(`Đủ ${pins.size} tệp phông, ${(total / 1048576).toFixed(2)} MB, khớp mã băm đã ghim.`);
}

async function fetchAll(update) {
  const pins = update ? new Map() : await readPins();
  const files = {};
  let total = 0;
  for (const f of FONTS) {
    const dir = path.join(OUT, f.id);
    fs.mkdirSync(dir, { recursive: true });
    const css = await get(`https://fonts.googleapis.com/css2?family=${css2(f)}&display=swap`, "text");
    const faces = facesOf(css).filter((x) => SUBSETS.includes(x.subset));
    if (!faces.some((x) => x.subset === "vietnamese")) {
      throw new Error(`${f.family}: Google Fonts không có bộ tiếng Việt`);
    }
    const rules = [];
    files[f.id] = [];
    for (const x of faces) {
      const file = `${x.style}-${x.weight.replace(/\s+/g, "-")}-${x.subset}.woff2`;
      const buf = await get(x.url);
      const pin = pins.get(`${f.id}/${file}`);
      if (pin && pin.sha256 !== sha(buf)) {
        throw new Error(`${f.id}/${file}: tệp tải về khác bản đã ghim (thêm --update nếu cố ý)`);
      }
      fs.writeFileSync(path.join(dir, file), buf);
      total += buf.length;
      const entry = { file, subset: x.subset, style: x.style, weight: x.weight, bytes: buf.length, sha256: sha(buf) };
      files[f.id].push(entry);
      rules.push(`/* ${x.subset} */\n@font-face{font-family:"${f.family}";font-style:${x.style};`
        + `font-weight:${x.weight};font-display:swap;src:url(./${file}) format("woff2");unicode-range:${x.range}}`);
    }
    fs.writeFileSync(path.join(dir, "face.css"), `${rules.join("\n")}\n`);
    const ofl = await get(`https://raw.githubusercontent.com/google/fonts/${OFL_COMMIT}/ofl/${f.dir}/OFL.txt`, "text");
    fs.writeFileSync(path.join(dir, "OFL.txt"), ofl);
    console.log(`${f.family}: ${files[f.id].length} tệp`);
  }
  if (total > BUDGET) {
    throw new Error(`Bộ phông ${(total / 1048576).toFixed(2)} MB vượt ngân sách ${BUDGET / 1048576} MB`);
  }
  fs.writeFileSync(MANIFEST, manifestTs(files, total));
  console.log(`Xong: ${(total / 1048576).toFixed(2)} MB trong ${OUT}`);
}

const args = process.argv.slice(2);
try {
  if (args.includes("--check")) await check();
  else await fetchAll(args.includes("--update"));
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
