// Thao tác tệp của dịch vụ workspace (chạy bằng root) trong thư mục mà code của người dùng ghi được: không bao giờ đi theo liên kết.
// Code trong container tự do đổi bất kỳ tệp / thư mục nào trong thư mục được gắn thành liên kết tượng trưng tới /etc/cron.d hay
// /var/www/synchro/.env.production; root mà đi theo liên kết đó thì ghi / đọc được mọi tệp của máy chủ (chiếm cả máy, lộ khóa của mọi tài khoản).
// Hợp đồng: chỉ gọi khi không còn container nào đang gắn thư mục này (đã `docker rm -f` xong, lượt sau của cùng thư mục đang xếp hàng):
// khi đó không ai đổi được đường dẫn giữa lúc kiểm tra và lúc mở. O_NOFOLLOW / O_EXCL chặn nốt thành phần cuối.
import fs from "node:fs";
import path from "node:path";

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
const lstat = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const parts = (rel) => String(rel).split("/").filter((x) => x && x !== ".");
const bad = (rel) => parts(rel).includes("..");

/** Tạo thư mục con của root theo từng cấp; cấp nào là liên kết hoặc tệp thì thay bằng thư mục thật (tệp mới của người dùng được ưu tiên). */
export function safeMkdirs(root, rel) {
  if (bad(rel)) throw new Error("Đường dẫn không hợp lệ");
  let cur = root;
  for (const x of parts(rel)) {
    cur = path.join(cur, x);
    const st = lstat(cur);
    if (st?.isDirectory()) continue;
    if (st) fs.unlinkSync(cur);
    fs.mkdirSync(cur, { mode: 0o755 });
  }
  return cur;
}

/** Ghi tệp vào root/rel: gỡ thứ đang nằm ở đó (liên kết, FIFO, thư mục) rồi tạo mới bằng O_EXCL, không mở lại thứ code đã đặt sẵn. */
export function safeWrite(root, rel, data) {
  if (bad(rel) || !parts(rel).length) throw new Error("Đường dẫn không hợp lệ");
  const dir = safeMkdirs(root, path.posix.dirname(parts(rel).join("/")));
  const p = path.join(dir, parts(rel).at(-1));
  const st = lstat(p);
  if (st?.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
  else if (st) fs.unlinkSync(p);
  const fd = fs.openSync(p, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
  try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
}

/** Đọc một tệp thường (không qua liên kết, không treo ở FIFO); null nếu không phải tệp thường hoặc vượt maxBytes. */
export function safeRead(p, maxBytes = Infinity) {
  let fd;
  try { fd = fs.openSync(p, O_RDONLY | O_NOFOLLOW | O_NONBLOCK); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return null;
    return fs.readFileSync(fd);
  } catch { return null; } finally { fs.closeSync(fd); }
}

/** Đọc root/rel khi mọi thư mục trên đường đi là thư mục thật (không liên kết) và tệp là tệp thường; ngược lại null. */
export function safeReadIn(root, rel, maxBytes = Infinity) {
  if (bad(rel) || !parts(rel).length || path.isAbsolute(String(rel))) return null;
  let cur = root;
  for (const x of parts(rel).slice(0, -1)) { cur = path.join(cur, x); const st = lstat(cur); if (!st?.isDirectory()) return null; }
  return safeRead(path.join(cur, parts(rel).at(-1)), maxBytes);
}

/**
 * Gom tệp code ghi vào outputs/. outputs/ hoặc thư mục con là liên kết thì bỏ qua, không đọc gì ngoài cây thư mục thật.
 * Tệp thật được chọn trước; khung hình xem thử (_preview/) có hạn mức số tệp riêng, để không đẩy tệp thật ra khỏi danh sách gửi về.
 */
export function collectOutputs(base, { files = 20, previews = 8, fileBytes = Infinity, totalBytes = Infinity, depth = 3 } = {}) {
  const main = [], prev = [], skipped = [], out = [];
  const walk = (d, lvl) => {
    if (lvl > depth) return;
    for (const name of fs.readdirSync(d).sort((a, b) => a.localeCompare(b))) {
      const p = path.join(d, name), rel = path.relative(base, p), st = lstat(p);
      if (st?.isDirectory()) walk(p, lvl + 1);
      else if (st?.isFile()) (rel.startsWith("_preview" + path.sep) ? prev : main).push({ p, rel, size: st.size });
      else if (st?.isSymbolicLink()) skipped.push(`${rel}: là liên kết, không gửi`);
    }
  };
  const root = lstat(base);
  if (root?.isSymbolicLink()) return { files: out, skipped: ["outputs: là liên kết, không gửi"] };
  if (!root?.isDirectory()) return { files: out, skipped };
  walk(base, 0);
  let total = 0;
  const take = (list, cap) => {
    let n = 0;
    for (const f of list) {
      const mb = Math.round(f.size / 1048576);
      if (n >= cap) { skipped.push(`${f.rel}: quá ${cap} tệp`); continue; }
      if (f.size > fileBytes) { skipped.push(`${f.rel}: ${mb} MB, quá ${Math.round(fileBytes / 1048576)} MB`); continue; }
      if (total + f.size > totalBytes) { skipped.push(`${f.rel}: vượt tổng ${Math.round(totalBytes / 1048576)} MB`); continue; }
      const buf = safeRead(f.p, fileBytes);
      if (!buf) { skipped.push(`${f.rel}: không đọc được`); continue; }
      n++; total += buf.length;
      out.push({ path: f.rel, b64: buf.toString("base64") });
    }
  };
  take(main, files);
  take(prev, previews);
  return { files: out, skipped };
}

// ---------------------------------------------------------------- log của lần chạy
// Giữ head byte đầu và tail byte cuối của một luồng (giống app/runtext.ts): lỗi thật của một lần dựng dài nằm ở cuối log, không phải 400 KB đầu.
export function clipSink(head = 10_000, tail = 30_000) {
  const first = [], last = [];
  let nFirst = 0, nLast = 0, dropped = 0;
  return {
    push(c) {
      if (nFirst < head) { const a = c.subarray(0, head - nFirst); first.push(a); nFirst += a.length; c = c.subarray(a.length); }
      if (!c.length) return;
      last.push(c); nLast += c.length;
      while (last.length > 1 && nLast - last[0].length >= tail) { nLast -= last[0].length; dropped += last[0].length; last.shift(); }
    },
    text() {
      const end = Buffer.concat(last), over = Math.max(0, end.length - tail), gone = dropped + over;
      return Buffer.concat(first).toString("utf8") + (gone ? `\n[Đã bỏ ${gone >= 2048 ? `${Math.round(gone / 1024)} KB` : `${gone} ký tự`} ở giữa]\n` : "") + end.subarray(over).toString("utf8");
    },
  };
}

// ---------------------------------------------------------------- hàng đợi chạy code
/**
 * Hàng đợi có giới hạn: không báo lỗi ngay khi đủ chỗ. Một chỗ luôn dành cho lần chạy ngắn (script dài tới 15 phút không chiếm hết máy),
 * chọn người chờ theo công bằng: ai đang chạy ít nhất trước, cùng mức thì ai đến trước.
 */
export function createRunQueue({ max = 3, queue = 20, perUser = 4, waitMs = 240_000, shortSec = 120 } = {}) {
  let closed = "";
  const active = []; // { u, short }
  const waiting = []; // { u, short, ok, no, timer }
  const canRun = (short) => active.length < max && (short || active.filter((a) => !a.short).length < Math.max(1, max - 1));
  const count = (u) => active.filter((a) => a.u === u).length;
  const pump = () => {
    for (;;) {
      const next = waiting.map((w, i) => ({ w, i })).filter(({ w }) => canRun(w.short)).sort((a, b) => count(a.w.u) - count(b.w.u) || a.i - b.i)[0];
      if (!next) return;
      waiting.splice(next.i, 1);
      clearTimeout(next.w.timer);
      next.w.ok(grant(next.w.u, next.w.short));
    }
  };
  const grant = (u, short) => {
    const slot = { u, short };
    active.push(slot);
    let done = false;
    return () => { if (done) return; done = true; active.splice(active.indexOf(slot), 1); pump(); };
  };
  return {
    /** Đợi tới lượt; trả hàm nhả chỗ. Từ chối (reject) khi hàng đầy, chờ quá lâu, người gọi bỏ đi hoặc dịch vụ đang tắt. */
    acquire(u, sec, signal) {
      const short = sec <= shortSec;
      if (closed) return Promise.reject(new QueueFull(closed));
      if (canRun(short) && !waiting.length) return Promise.resolve(grant(u, short));
      if (waiting.length >= queue || waiting.filter((w) => w.u === u).length >= perUser) return Promise.reject(new QueueFull("Máy chủ đang chạy nhiều code cùng lúc. Hãy thử lại sau ít giây."));
      return new Promise((ok, no) => {
        const w = { u, short, ok, no, timer: null };
        const drop = (m) => { const i = waiting.indexOf(w); if (i >= 0) { waiting.splice(i, 1); clearTimeout(w.timer); no(new QueueFull(m)); } };
        w.timer = setTimeout(() => drop("Máy chủ đang chạy nhiều code cùng lúc. Hãy thử lại sau ít giây."), waitMs);
        signal?.addEventListener("abort", () => drop("Đã dừng."), { once: true });
        waiting.push(w);
        pump();
      });
    },
    /** Từ nay từ chối mọi lần chạy mới và trả lỗi cho người đang chờ (dịch vụ sắp khởi động lại). */
    close(m) { closed = m; for (const w of waiting.splice(0)) { clearTimeout(w.timer); w.no(new QueueFull(m)); } },
    get running() { return active.length; },
    get queued() { return waiting.length; },
  };
}
export class QueueFull extends Error {}

// ---------------------------------------------------------------- lần chạy dựng video (Remotion)
// Lệnh tốn CPU / bộ nhớ của synchro-video: dựng hình (Chromium + x264), ảnh xem trước, nhận dạng giọng nói (whisper ~1 GB).
// Gọi bằng shell ("synchro-video render …", "node /opt/remotion/cli/synchro-video.mjs render …", "synchro-video $LENH …"), danh sách tham số của
// Python / Node (["synchro-video", "render", …]) hoặc tên lệnh trong biến (SV = "synchro-video"). Nhận ngược: mọi lần nhắc tới synchro-video đều là
// dựng, trừ khi ngay sau đó là một lệnh nhẹ (templates, schema, example, check, words, help). Xếp hàng nhầm một lần chạy nhẹ chỉ chậm hơn chút;
// để lọt một lần dựng thì hai lần dựng chạy song song trên máy 2 vCPU.
// Không tính thư mục trạng thái .synchro-video/ (ls, rm của nó không phải dựng).
const VIDEO_CMD = /(?<![.\w-])synchro-video(?:\.mjs)?\b(?!\/)/g;
const LIGHT_AFTER = /^["']?(?:\s*,\s*|\s+)["']?(?:templates|schema|example|check|words|help|--help|-h)\b/;
const SCRIPT_EXT = /\.(?:py|sh|bash|js|mjs|cjs|ts)$/i;
const SCRIPT_REF = /(?:^|[\s"'`=(,\[])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:py|sh|bash|js|mjs|cjs|ts))\b/g;
const callsMedia = (text) => {
  for (const m of String(text).matchAll(VIDEO_CMD)) if (!LIGHT_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 60))) return true;
  return false;
};
const normRel = (p) => String(p).replace(/^\.\//, "");
/**
 * Lần chạy có gọi synchro-video để dựng không (đọc lệnh, stdin, tệp script của lần chạy, và script mà chúng gọi tới). Dùng để xếp hàng riêng:
 * mỗi máy một lần dựng. readScript(rel) đọc script đã có sẵn trong thư mục giữ lại từ lần chạy trước (vd. "bash render.sh"); trả chuỗi hoặc null.
 */
export function isMediaRun({ files = [], argv = [], stdin = null, readScript = null } = {}) {
  const own = new Map();
  for (const f of files) {
    if (!SCRIPT_EXT.test(String(f?.path ?? "")) || typeof f.b64 !== "string" || f.b64.length > 1_400_000) continue;
    own.set(normRel(f.path), Buffer.from(f.b64, "base64").toString("utf8"));
  }
  const seen = new Set(), queue = [...argv.map(String), ...(typeof stdin === "string" ? [stdin] : []), ...own.values()];
  for (let i = 0; i < queue.length && i < 40; i++) {
    const text = queue[i];
    if (callsMedia(text)) return true;
    // Script được nhắc tới mà không gửi kèm lần này: đọc bản trong thư mục giữ lại (tối đa 40 tệp, mỗi tệp một lần).
    for (const m of text.matchAll(SCRIPT_REF)) {
      const rel = normRel(m[1]);
      if (seen.has(rel) || rel.split("/").includes("..")) continue;
      seen.add(rel);
      const body = own.get(rel) ?? (readScript ? readScript(rel) : null);
      if (typeof body === "string" && !own.has(rel)) queue.push(body);
    }
  }
  return false;
}
