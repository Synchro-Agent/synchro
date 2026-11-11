// Bộ nhớ của gói plugin vừa tải: tối đa 50 MB, hết hạn thì tự bỏ cả khi không ai đọc lại, xong cài hàng loạt thì bỏ hết.
// Không cần mạng hay dev:mock: fetch giả trả gói zip dựng tại chỗ.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-zipmem-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
process.env.SYNCHRO_DEFAULT_PLUGINS = "0"; process.env.SYNCHRO_ZIP_TTL_MS = "600";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const JSZip = createRequire(path.join(process.cwd(), "package.json"))("jszip");
const MB = 1048576;
const zips = new Map();
const zipOf = async (repo) => {
  if (!zips.has(repo)) {
    const z = new JSZip(), root = `${repo.split("/")[1]}-c/`;
    z.file(`${root}LICENSE`, "MIT License\nPermission is hereby granted, free of charge");
    z.file(`${root}skills/demo/SKILL.md`, `---\nname: demo-${repo.split("/")[1]}\ndescription: Kiểm thử bộ nhớ.\n---\nNội dung.`);
    z.file(`${root}skills/demo/data.bin`, crypto.randomBytes(18 * MB));
    zips.set(repo, await z.generateAsync({ type: "nodebuffer", compression: "STORE" }));
  }
  return zips.get(repo);
};
globalThis.fetch = async (u) => {
  u = String(u);
  if (/\/commits\//.test(u)) return new Response("a".repeat(40));
  const m = u.match(/\/([^/]+)\/([^/]+)\/zip\//);
  if (m) return new Response(await zipOf(`${m[1]}/${m[2]}`));
  return new Response("", { status: 404 });
};
const { plugins: P } = await loadTs(["plugins"]);
const def = (r) => ({ slug: r, name: r, description: "", sources: [{ repo: `o/${r}` }] });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

try {
  console.log("1. Trần 50 MB");
  for (const r of ["r1", "r2", "r3", "r4", "r5"]) { const p = await P.previewPlugin(def(r)); ok(p.skills.length === 1, `xem trước ${r}`, p.skills); }
  const st = P.zipCacheStats();
  ok(st.bytes <= 50 * MB && st.n >= 1, `5 gói ~18 MB: giữ ${st.n} gói, ${(st.bytes / MB).toFixed(1)} MB`, st);
  console.log("2. Xong cài hàng loạt: bỏ hết");
  P.setBulk(true);
  await P.previewPlugin(def("r1"));
  ok(P.zipCacheStats().n >= 1, "đang cài hàng loạt: vẫn giữ để dùng lại");
  P.setBulk(false);
  ok(P.zipCacheStats().n === 0, "setBulk(false): bộ đệm trống", P.zipCacheStats());
  console.log("3. Hết hạn thì tự bỏ, không cần ai đọc lại");
  await P.previewPlugin(def("r2"));
  ok(P.zipCacheStats().n === 1, "vừa tải: có trong bộ đệm");
  await sleep(1400);
  ok(P.zipCacheStats().n === 0, "quá hạn: tự bỏ", P.zipCacheStats());
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
