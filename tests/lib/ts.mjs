// Nạp các tệp TypeScript thuần trong app/ để kiểm thử không cần máy chủ: dịch bằng TypeScript sang .mjs trong thư mục tạm,
// giữ đường dẫn tương đối giữa các tệp (import "./x" → "./x.mjs"). Chỉ dùng cho mô-đun không phụ thuộc Next hay cơ sở dữ liệu.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");

export async function loadTs(entries) {
  // Thư mục tạm nằm trong node_modules/.cache để import gói (better-sqlite3…) vẫn tìm được node_modules của dự án.
  const cache = path.join(process.cwd(), "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, "synchro-ts-"));
  const done = new Set();
  const conv = (rel) => {
    if (done.has(rel)) return;
    done.add(rel);
    // import "./x" trỏ tới thư mục x/index.ts.
    if (!existsSync(path.join(process.cwd(), "app", `${rel}.ts`)) && existsSync(path.join(process.cwd(), "app", rel, "index.ts"))) {
      const file = path.join(dir, `${rel}.mjs`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `export * from "./${path.posix.basename(rel)}/index.mjs";\n`);
      conv(`${rel}/index`);
      return;
    }
    const src = readFileSync(path.join(process.cwd(), "app", `${rel}.ts`), "utf8");
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from "(\.{1,2}\/[\w/.-]+)"/g, (_, p) => `from "${p}.mjs"`);
    const file = path.join(dir, `${rel}.mjs`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out);
    for (const m of out.matchAll(/from "(\.{1,2}\/[\w/.-]+)\.mjs"/g)) conv(path.posix.join(path.posix.dirname(rel), m[1]));
  };
  for (const e of entries) conv(e);
  const mods = {};
  for (const e of entries) mods[e] = await import(path.join(dir, `${e}.mjs`));
  return mods;
}
