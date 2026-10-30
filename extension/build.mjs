// Đóng gói tiện ích Synchro cho một máy chủ: các tệp trong extension/ (trừ tệp này), lõi thao tác workspace/browser-act.mjs chép thành act.js
// (cùng mã với trình duyệt của Synchro), phông Anthropic Sans của app (public/fonts) và Unbounded của bộ nhận diện (node_modules/@fontsource-variable)
// cho cửa sổ tiện ích, và config.js ghi sẵn
// địa chỉ máy chủ. Dùng ở
// - /api/browser/ext/download (nút "Tải tiện ích" trong Cài đặt → Khả năng → Trình duyệt của bạn) → tệp .zip;
// - npm run dev:mock (ghi sẵn bản giải nén vào data-mock/extension để "Load unpacked") và tiện ích giả lập (scripts/mock-extension.mjs).
// Chạy tay: node extension/build.mjs <địa chỉ Synchro> <thư mục ra>
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["build.mjs", "config.js"]);
function walk(dir, base = "") {
  const out = [];
  for (const f of fs.readdirSync(path.join(dir, base)).sort()) {
    if (f.startsWith(".")) continue;
    const rel = base ? `${base}/${f}` : f;
    if (fs.statSync(path.join(dir, rel)).isDirectory()) out.push(...walk(dir, rel));
    else if (!SKIP.has(rel)) out.push(rel);
  }
  return out;
}

/** [đường dẫn trong tiện ích, nội dung] của bản tiện ích cho máy chủ server. */
export function extensionFiles(root, server) {
  const dir = path.join(root, "extension");
  const files = walk(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))]);
  files.push(["act.js", fs.readFileSync(path.join(root, "workspace", "browser-act.mjs"))]);
  files.push(["fonts/AnthropicSans.woff2", fs.readFileSync(path.join(root, "public", "fonts", "AnthropicSans-Variable.woff2"))]);
  for (const sub of ["vietnamese", "latin"]) files.push([`fonts/unbounded-${sub}.woff2`, fs.readFileSync(path.join(root, "node_modules", "@fontsource-variable", "unbounded", "files", `unbounded-${sub}-wght-normal.woff2`))]);
  files.push(["config.js", `// Địa chỉ máy chủ Synchro mà tiện ích này nối tới (đổi được trong cửa sổ tiện ích trước khi ghép nối).\nexport const SERVER = ${JSON.stringify(String(server ?? "").replace(/\/$/, ""))};\n`]);
  return files;
}

/** Ghi bản giải nén ra thư mục out (xóa bản cũ). */
export function writeExtension(root, server, out) {
  fs.rmSync(out, { recursive: true, force: true });
  for (const [f, data] of extensionFiles(root, server)) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), data);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [server, out] = process.argv.slice(2);
  if (!server || !out) { console.error("Dùng: node extension/build.mjs <địa chỉ Synchro> <thư mục ra>"); process.exit(1); }
  console.log(writeExtension(process.cwd(), server, path.resolve(out)));
}
