// Bộ nhớ đệm SVG của sơ đồ D2 trên máy chủ (server/d2render.ts): trần theo dung lượng (SYNCHRO_D2_MEM_MB, mặc định 48 MB), không chỉ theo số mục.
// Trước đây giữ 200 SVG mỗi cái tới 3 MB (có thể 600 MB+); Sức khỏe hệ thống có số liệu d2Svgs. Không cần máy chủ: SVG nạp từ thư mục đệm trên đĩa.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-d2mem-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SYNCHRO_D2_MEM_MB = "8";
const dir = path.join(process.env.DATA_DIR, "d2-cache");
fs.mkdirSync(dir, { recursive: true });
const { d2render: D, memstat: MS } = await loadTs(["d2render", "memstat"]);
const MB = 1048576;
// SVG ~1 MB ký tự (≈ 2 MB trong bộ nhớ) đặt sẵn trên đĩa đúng tên tệp theo mã băm của nguồn.
const put = (code) => { const key = crypto.createHash("sha256").update(`0\n${code}`).digest("hex"); fs.writeFileSync(path.join(dir, `${key}.svg`), `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(MB)}--></svg>`); };

try {
  console.log("1. Trần theo dung lượng");
  for (let i = 0; i < 12; i++) { put(`a${i} -> b${i}`); ok(D.cachedD2(`a${i} -> b${i}`, false)?.startsWith("<svg") === true, `sơ đồ ${i} đọc được`); }
  const s = D.d2CacheStats();
  ok(s.bytes <= 8 * MB && s.n >= 3 && s.n < 12, "12 SVG lớn: bộ nhớ giữ trong 8 MB, bỏ mục cũ nhất", s);
  ok(D.cachedD2("a11 -> b11", false) !== null && D.d2CacheStats().n === s.n, "mục mới nhất còn trong bộ nhớ");
  ok(D.cachedD2("a0 -> b0", false) !== null, "mục đã bị bỏ khỏi bộ nhớ vẫn đọc lại được từ đĩa");
  ok(D.d2CacheStats().bytes <= 8 * MB, "đọc lại từ đĩa vẫn trong trần", D.d2CacheStats());
  console.log("2. Sức khỏe hệ thống");
  const c = MS.cacheStats().d2Svgs;
  ok(c && typeof c.n === "number" && c.MB <= 8, "có số liệu d2Svgs (số mục, MB)", c);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
