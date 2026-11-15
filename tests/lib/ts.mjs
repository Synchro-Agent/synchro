// Nạp các tệp TypeScript thuần của ứng dụng để kiểm thử không cần máy chủ: dịch bằng TypeScript sang .mjs trong thư mục tạm,
// giữ đường dẫn tương đối giữa các tệp (import "./x" → "./x.mjs"). Chỉ dùng cho mô-đun không phụ thuộc Next hay cơ sở dữ liệu.
// Tên mô-đun (H3): "server/x", "ui/x", "shared/x", "app/x" dùng đúng như ghi; tên trần kiểu cũ ("authstore", "ai/cli_auth",
// "api/auth/login/route", "../server/route" tính từ app/) được tìm trong server/, shared/, ui/, app/ — không thấy hoặc thấy hai nơi
// thì báo lỗi, không đoán. Khóa của đối tượng trả về vẫn là đúng chuỗi đã truyền.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const P = path.posix;
const LOOKUP = ["server", "shared", "ui", "app"];

/** Đường dẫn tương đối với gốc repo, không đuôi (thư mục có index.ts thì là thư mục), hoặc null. */
const find = (rel) => {
  const root = process.cwd();
  if (existsSync(path.join(root, `${rel}.ts`))) return rel;
  if (existsSync(path.join(root, rel, "index.ts"))) return rel;
  return null;
};

export function resolveTsEntry(entry) {
  let e = P.normalize(entry.replace(/\.ts$/, ""));
  if (e.startsWith("../")) e = P.normalize(P.join("app", e));
  if (/^(app|server|ui|shared)\//.test(e)) {
    const hit = find(e);
    if (!hit) throw new Error(`loadTs: không thấy ${entry}`);
    return hit;
  }
  const hits = LOOKUP.map((r) => find(`${r}/${e}`)).filter(Boolean);
  if (hits.length !== 1) throw new Error(`loadTs: "${entry}" ${hits.length ? `trùng ở ${hits.join(", ")}` : `không có trong ${LOOKUP.join("/, ")}/`}`);
  return hits[0];
}

export async function loadTs(entries) {
  // Thư mục tạm nằm trong node_modules/.cache để import gói (better-sqlite3…) vẫn tìm được node_modules của dự án.
  // Cây tạm theo đường dẫn tính từ gốc repo, nên import "../server/x" từ app/ vẫn nằm trong thư mục tạm.
  const root = process.cwd();
  const cache = path.join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, "synchro-ts-"));
  const done = new Set();
  const conv = (rel) => {
    if (done.has(rel)) return;
    done.add(rel);
    // import "./x" trỏ tới thư mục x/index.ts.
    if (!existsSync(path.join(root, `${rel}.ts`)) && existsSync(path.join(root, rel, "index.ts"))) {
      const file = path.join(dir, `${rel}.mjs`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `export * from "./${P.basename(rel)}/index.mjs";\n`);
      conv(`${rel}/index`);
      return;
    }
    const src = readFileSync(path.join(root, `${rel}.ts`), "utf8");
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      // Dấu "chỉ chạy ở máy chủ" (H3): gói server-only chỉ có nghĩa trong bản dựng Next, ngoài đó bỏ đi.
      .replace(/^\s*import\s+["']server-only["'];?[ \t]*$/m, "")
      .replace(/from "(\.{1,2}\/[\w/.-]+)"/g, (_, p) => p.endsWith(".mjs") ? `from "${pathToFileURL(path.resolve(root, P.dirname(rel), p)).href}"` : `from "${p}.mjs"`); // .mjs thật (scripts/zipguard.mjs): dùng nguyên tệp
    const file = path.join(dir, `${rel}.mjs`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out);
    for (const m of out.matchAll(/from "(\.{1,2}\/[\w/.-]+)\.mjs"/g)) conv(P.join(P.dirname(rel), m[1]));
  };
  const resolved = entries.map(resolveTsEntry);
  for (const r of resolved) conv(r);
  const mods = {};
  for (let i = 0; i < entries.length; i++) mods[entries[i]] = await import(pathToFileURL(path.join(dir, `${resolved[i]}.mjs`)).href);
  return mods;
}
