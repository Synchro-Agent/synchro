// Phim giới thiệu (ui/introfilm.tsx) không nằm trong git từ Blueprint H3.9: production phục vụ /intro/*.mp4 bằng nginx từ
// /var/www/synchro-media/intro/ (ngoài thư mục app, docs/van-hanh.md mục "Phim giới thiệu"). Máy dev, dev:mock và CI cần tệp ở public/intro/:
// tệp nào thiếu thì lấy một lần, theo thứ tự
//   1. lịch sử git của repo này (commit cuối còn tệp, trước khi bỏ khỏi git) — không cần mạng; bản sao nông (CI) không có thì bỏ qua;
//   2. tải từ https://synchro.net.nz/intro/<tệp> (SYNCHRO_INTRO_BASE để đổi), kiểm tra đúng là mp4 rồi mới đặt vào chỗ.
// Không bao giờ ghi đè tệp đã có. Lỗi không làm hỏng dev:mock: phim thiếu thì tests/ui/introfilm.mjs bỏ qua kèm lý do, app tự bỏ phim.
// Dùng: node tools/fetch-intro.mjs [--dir <thư mục>] [--no-git]     SYNCHRO_INTRO_FETCH=0: không lấy gì (job verify của CI không cần phim).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INTRO_FILES = ["synchro-intro-720.mp4", "synchro-intro.mp4"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_BYTES = 100_000;

/** Đầu tệp mp4 (ISO BMFF): 4 byte cỡ hộp rồi "ftyp". */
export const isMp4 = (buf) => buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp";

function fromGit(file, dst) {
  const rel = `public/intro/${file}`;
  const last = spawnSync("git", ["rev-list", "-1", "HEAD", "--", rel], { cwd: ROOT, encoding: "utf8" });
  const c = last.status === 0 ? last.stdout.trim() : "";
  if (!c) return false;
  for (const spec of [`${c}:${rel}`, `${c}^:${rel}`]) {
    if (spawnSync("git", ["cat-file", "-e", spec], { cwd: ROOT }).status !== 0) continue;
    const tmp = `${dst}.part`;
    const fd = fs.openSync(tmp, "w");
    const r = spawnSync("git", ["cat-file", "blob", spec], { cwd: ROOT, stdio: ["ignore", fd, "ignore"] });
    fs.closeSync(fd);
    const head = Buffer.alloc(12); const h = fs.openSync(tmp, "r"); fs.readSync(h, head, 0, 12, 0); fs.closeSync(h);
    if (r.status === 0 && fs.statSync(tmp).size >= MIN_BYTES && isMp4(head)) { fs.renameSync(tmp, dst); return true; }
    fs.rmSync(tmp, { force: true });
  }
  return false;
}

async function download(file, dst, base) {
  const url = `${base.replace(/\/+$/, "")}/intro/${file}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < MIN_BYTES || !isMp4(buf)) throw new Error(`${url}: không phải tệp mp4 (${buf.length} byte, ${r.headers.get("content-type")})`);
  fs.writeFileSync(`${dst}.part`, buf);
  fs.renameSync(`${dst}.part`, dst);
}

/** Lấy các tệp phim còn thiếu vào `dir`. Trả về { got: [[tệp, nguồn]], missing: [[tệp, lý do]] }; không ném lỗi. */
export async function fetchIntro({ dir = path.join(ROOT, "public", "intro"), base = process.env.SYNCHRO_INTRO_BASE || "https://synchro.net.nz", git = true, net = true } = {}) {
  const got = [], missing = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const f of INTRO_FILES) {
    const dst = path.join(dir, f);
    if (fs.existsSync(dst)) continue;
    try {
      if (git && fromGit(f, dst)) { got.push([f, "git"]); continue; }
      if (!net) { missing.push([f, "không có trong lịch sử git, không tải mạng"]); continue; }
      await download(f, dst, base);
      got.push([f, base]);
    } catch (e) { fs.rmSync(`${dst}.part`, { force: true }); missing.push([f, e?.message ?? String(e)]); }
  }
  return { got, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.SYNCHRO_INTRO_FETCH === "0") { console.log("SYNCHRO_INTRO_FETCH=0: không lấy phim giới thiệu."); process.exit(0); }
  const a = process.argv.slice(2), i = a.indexOf("--dir");
  const { got, missing } = await fetchIntro({ ...(i >= 0 && a[i + 1] ? { dir: path.resolve(a[i + 1]) } : {}), git: !a.includes("--no-git") });
  for (const [f, src] of got) console.log(`Phim giới thiệu: đã lấy ${f} (${src}).`);
  for (const [f, why] of missing) console.error(`Phim giới thiệu: thiếu ${f}: ${why}`);
  if (!got.length && !missing.length) console.log("Phim giới thiệu: đủ tệp ở public/intro/.");
  process.exit(missing.length ? 1 : 0);
}
