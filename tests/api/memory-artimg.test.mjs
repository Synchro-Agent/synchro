// Bộ nhớ của ảnh artifact nhớ tạm: tối đa 64 MB và 30 phút (trước đây 100 ảnh tới 6 MB, giữ mãi). Không cần mạng: loader giả.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-artimgmem-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SYNCHRO_ARTIMG_TTL_MS = "500";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { artimg: A } = await loadTs(["artimg"]);
const MB = 1048576;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let calls = 0;
const loader = async () => { calls++; return { mime: "image/png", data: Buffer.alloc(6 * MB) }; };

try {
  console.log("1. Trần 64 MB");
  for (let i = 0; i < 30; i++) await A.cachedImage(`https://x.test/${i}.png`, loader);
  const st = A.artImgStats();
  ok(st.bytes <= 64 * MB, `30 ảnh 6 MB: giữ ${st.n} ảnh, ${(st.bytes / MB).toFixed(0)} MB`, st);
  ok(st.n === 10, "giữ những ảnh mới nhất vừa đủ trần", st);
  const before = calls;
  await A.cachedImage("https://x.test/29.png", loader);
  ok(calls === before, "ảnh còn trong bộ đệm: không tải lại");
  await A.cachedImage("https://x.test/0.png", loader);
  ok(calls === before + 1, "ảnh đã bị bỏ: tải lại");
  console.log("2. Ảnh lỗi không giữ");
  await A.cachedImage("https://x.test/bad.png", async () => null);
  let again = 0;
  await A.cachedImage("https://x.test/bad.png", async () => { again++; return null; });
  ok(again === 1, "ảnh lỗi: lần sau thử lại");
  console.log("3. Hết hạn thì tự bỏ, không cần ai đọc lại");
  ok(A.artImgStats().n > 0, "đang có ảnh");
  await sleep(1300);
  ok(A.artImgStats().n === 0, "quá hạn: bộ đệm trống", A.artImgStats());
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
