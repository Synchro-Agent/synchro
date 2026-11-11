// Phần thuần của synchro-video (chỉ dùng mô-đun có sẵn của Node, không cần node_modules): đọc tham số, chia đoạn dựng và dựng tiếp,
// số tiến trình theo cgroup, đường dẫn an toàn, chuyển phụ đề (whisper.cpp -ojf, edge-tts WordBoundary, .srt) thành Caption[].
// Kho mã kiểm thử trực tiếp tệp này (tests/api/synchro-video.test.mjs); synchro-video.mjs trong image dùng lại đúng các hàm này.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TEMPLATE_IDS = ["tiktok", "next-tailwind", "audiogram", "github-unwrapped"];
/** Mã thoát khi hết ngân sách thời gian giữa chừng: chạy lại đúng lệnh đó để dựng tiếp từ đoạn đã xong. */
export const EXIT_RESUME = 75;
export const DEFAULT_FPS = 60;
export const DEFAULT_BUDGET = 170;
export const DEFAULT_CHUNK_SEC = 8;
export const MAX_SECONDS = 900;

export class UsageError extends Error {}

const COMMANDS = {
  templates: { pos: [0, 0], flags: [] },
  schema: { pos: [1, 1], flags: [] },
  example: { pos: [1, 1], flags: [] },
  check: { pos: [2, 2], flags: ["fps", "size"] },
  still: { pos: [2, 2], flags: ["fps", "size", "at", "out"] },
  render: { pos: [2, 3], flags: ["fps", "size", "crf", "budget", "chunk", "previews"] },
  captions: { pos: [2, 2], flags: ["lang", "model"] },
  words: { pos: [2, 2], flags: [] },
  selftest: { pos: [0, 0], flags: ["skip-whisper", "size"] },
  bench: { pos: [0, 0], flags: ["seconds", "skip-whisper"] },
};
export const COMMAND_NAMES = Object.keys(COMMANDS);

export const USAGE = `synchro-video — dựng video bằng 4 mẫu Remotion có sẵn (không cần mạng)
  synchro-video templates                         danh sách mẫu (JSON)
  synchro-video schema <mẫu>                      JSON Schema của props
  synchro-video example <mẫu>                     props mẫu để chép rồi sửa
  synchro-video check <mẫu> props.json            kiểm tra props, in thời lượng, số khung, thời gian dựng ước tính
  synchro-video still <mẫu> props.json [--at 1,3.5,8]   ảnh xem trước vào outputs/_preview/
  synchro-video render <mẫu> props.json [outputs/ten.mp4] [--fps 30|60] [--size vertical|square|landscape|RỘNGxCAO] [--crf 20] [--budget 170]
  synchro-video captions <âm thanh|video> <phu-de.json> [--lang vi]   nhận dạng giọng nói bằng whisper.cpp (không cần mạng)
  synchro-video words <giong.srt|tu.json> <phu-de.json>               đổi phụ đề edge-tts (.srt hoặc WordBoundary) thành Caption[]
Mẫu: ${TEMPLATE_IDS.join(", ")}. Mã thoát ${EXIT_RESUME} = hết ngân sách thời gian, chạy lại đúng lệnh để dựng tiếp.`;

/** Đọc tham số dòng lệnh; sai thì ném UsageError với câu tiếng Việt nói rõ chỗ sai. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return { cmd: "help", pos: [], opts: {} };
  const spec = COMMANDS[cmd];
  if (!spec) throw new UsageError(`Lệnh không có: ${cmd}. Lệnh hợp lệ: ${COMMAND_NAMES.join(", ")}.`);
  const pos = [], opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (!spec.flags.includes(k)) throw new UsageError(`Lệnh ${cmd} không nhận --${k}${spec.flags.length ? ` (nhận: ${spec.flags.map((f) => "--" + f).join(", ")})` : ""}.`);
      if (k === "skip-whisper") { opts[k] = true; continue; }
      const v = inline ?? rest[++i];
      if (v == null || v.startsWith("--")) throw new UsageError(`Thiếu giá trị cho --${k}.`);
      opts[k] = v;
    } else pos.push(a);
  }
  if (pos.length < spec.pos[0] || pos.length > spec.pos[1]) throw new UsageError(`Lệnh ${cmd} cần ${spec.pos[0] === spec.pos[1] ? spec.pos[0] : `${spec.pos[0]}–${spec.pos[1]}`} tham số, nhận ${pos.length}.\n${USAGE}`);
  if (["schema", "example", "check", "still", "render"].includes(cmd) && !TEMPLATE_IDS.includes(pos[0])) throw new UsageError(`Không có mẫu "${pos[0]}". Mẫu hợp lệ: ${TEMPLATE_IDS.join(", ")}.`);
  const out = { cmd, pos, opts: { ...opts } };
  if (opts.fps != null) { const f = Number(opts.fps); if (f !== 30 && f !== 60) throw new UsageError("--fps chỉ nhận 30 hoặc 60."); out.opts.fps = f; }
  if (opts.size != null) out.opts.size = parseSize(opts.size);
  if (opts.crf != null) { const c = Number(opts.crf); if (!Number.isInteger(c) || c < 12 || c > 35) throw new UsageError("--crf là số nguyên 12–35 (thấp hơn = nét hơn, tệp nặng hơn)."); out.opts.crf = c; }
  if (opts.budget != null) { const b = Number(opts.budget); if (!(b >= 20 && b <= 3600)) throw new UsageError("--budget là số giây 20–3600."); out.opts.budget = b; }
  if (opts.chunk != null) { const c = Number(opts.chunk); if (!(c >= 1 && c <= 60)) throw new UsageError("--chunk là số giây 1–60."); out.opts.chunk = c; }
  if (opts.previews != null) { const n = Number(opts.previews); if (!Number.isInteger(n) || n < 0 || n > 8) throw new UsageError("--previews là số ảnh 0–8."); out.opts.previews = n; }
  if (opts.seconds != null) { const n = Number(opts.seconds); if (!(n >= 1 && n <= 120)) throw new UsageError("--seconds là 1–120."); out.opts.seconds = n; }
  if (opts.at != null) {
    const at = String(opts.at).split(",").map((x) => Number(x.trim()));
    if (!at.length || at.length > 8 || at.some((x) => !(x >= 0))) throw new UsageError("--at là danh sách giây, vd. --at 0.5,3,8 (tối đa 8 mốc).");
    out.opts.at = at;
  }
  if (opts.lang != null && !/^(?:auto|[a-z]{2})$/.test(opts.lang)) throw new UsageError("--lang là mã 2 chữ (vi, en…) hoặc auto.");
  if (cmd === "render" && pos[2] != null && !/\.mp4$/i.test(pos[2])) throw new UsageError("Tệp ra phải là .mp4 (vd. outputs/video.mp4).");
  if (cmd === "captions" || cmd === "words") { if (!/\.json$/i.test(pos[1])) throw new UsageError("Tệp phụ đề ra phải là .json (Caption[])."); }
  return out;
}

export const SIZE_PRESETS = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] };
/** Khung lớn nhất dựng được trong 2 GB bộ nhớ của máy dựng: 3840x2160 (4K) dựng xong, 3840x3840 bị hệ điều hành giết vì hết bộ nhớ (đo 2026-11-12). */
export const MAX_AREA = 3840 * 2160;
/** "vertical" | "square" | "landscape" | "1080x1920" → chuỗi kích thước props nhận (giữ nguyên tên mẫu sẵn). */
export function parseSize(s) {
  const v = String(s).trim().toLowerCase();
  if (SIZE_PRESETS[v]) return v;
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(v);
  if (!m) throw new UsageError(`--size không hợp lệ: ${s}. Dùng vertical, square, landscape hoặc RỘNGxCAO (vd. 1080x1920).`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 2 || h % 2 || w < 240 || h < 240 || w > 3840 || h > 3840) throw new UsageError(`--size ${s}: mỗi cạnh là số chẵn 240–3840.`);
  if (w * h > MAX_AREA) throw new UsageError(`--size ${s}: khung tối đa 3840x2160 (hoặc 2160x3840, tức 8,3 triệu điểm ảnh) vì máy dựng chỉ có 2 GB bộ nhớ.`);
  return `${w}x${h}`;
}

// ---------------------------------------------------------------- chia đoạn, dựng tiếp
/** Chia [0, totalFrames) thành các đoạn ~chunkSec giây; đoạn cuối quá ngắn (dưới 1/3) thì gộp vào đoạn trước. */
export function planChunks(totalFrames, fps, chunkSec = DEFAULT_CHUNK_SEC) {
  if (!(totalFrames > 0) || !(fps > 0)) throw new Error("Số khung và fps phải dương");
  const size = Math.max(1, Math.round(chunkSec * fps));
  const out = [];
  for (let s = 0; s < totalFrames; s += size) out.push([s, Math.min(totalFrames, s + size) - 1]);
  if (out.length > 1) {
    const last = out[out.length - 1];
    if (last[1] - last[0] + 1 < size / 3) { out.pop(); out[out.length - 1][1] = last[1]; }
  }
  return out.map(([start, end], i) => ({ i, start, end, file: `chunk-${String(i).padStart(4, "0")}.ts` }));
}
/** Đoạn chưa dựng xong (tệp đoạn chỉ có khi đoạn đã dựng trọn: ghi vào .part rồi đổi tên). */
export const pendingChunks = (plan, done) => plan.filter((c) => !done.has(c.file));
/**
 * Có dựng thêm một đoạn nữa không: còn đủ ngân sách cho một đoạn theo tốc độ đo được (đoạn đầu chưa có số đo thì luôn dựng,
 * để mỗi lần chạy luôn tiến lên ít nhất một đoạn).
 */
export function shouldContinue({ elapsedSec, budgetSec, doneThisRun, framesPerSec, nextFrames, startupSec = 0 }) {
  if (doneThisRun === 0) return true;
  if (!(framesPerSec > 0)) return elapsedSec < budgetSec * 0.5;
  const need = nextFrames / framesPerSec + startupSec;
  return elapsedSec + need * 1.15 <= budgetSec;
}

// ---------------------------------------------------------------- tài nguyên máy
/** Đọc giới hạn cgroup v2 (Docker --cpus / --memory). read(p) trả nội dung tệp hoặc null. */
export function readCgroup(read) {
  const cpu = read("/sys/fs/cgroup/cpu.max");
  let cpuQuota = null;
  if (cpu) { const [q, per] = cpu.trim().split(/\s+/); if (q !== "max" && Number(per) > 0) cpuQuota = Number(q) / Number(per); }
  const num = (p) => { const v = read(p)?.trim(); return v && v !== "max" && Number.isFinite(Number(v)) ? Number(v) : null; };
  return { cpuQuota, memMax: num("/sys/fs/cgroup/memory.max"), memCurrent: num("/sys/fs/cgroup/memory.current") };
}
/**
 * Số tab Chromium dựng song song: tối đa 2 (máy 2 vCPU, còn ffmpeg nén hình), không quá số CPU được cấp,
 * và 1 khi bộ nhớ còn dưới 1,5 GB (mỗi tab headless + bộ đệm khung ~400–600 MB; vượt 2 GB là mã 137).
 */
export function pickConcurrency({ cpus, cpuQuota = null, memMax = null, memCurrent = null, width = 0, height = 0 }) {
  const cpu = Math.max(1, Math.floor(Math.min(cpus || 1, cpuQuota ?? Infinity)));
  let n = Math.min(2, cpu);
  if (memMax != null && memMax - (memCurrent ?? 0) < 1.5 * 1024 ** 3) n = 1;
  // Khung lớn hơn hai lần Full HD: mỗi tab và bộ đệm khung của ffmpeg lớn theo số điểm ảnh, hai tab là vượt 2 GB giữa chừng.
  if (width * height > 2 * 1920 * 1080) n = 1;
  return n;
}

/** Lỗi do hệ điều hành giết tiến trình vì hết bộ nhớ (Chromium / ffmpeg nhận SIGKILL, Remotion báo "signal SIGKILL" chứ không ra mã 137). */
export const isOomError = (msg) => /\bSIGKILL\b|signal 9\b|\bcode 137\b|out of memory|ENOMEM/i.test(String(msg ?? ""));
/** Thông báo lỗi gọn: lỗi của Remotion kèm cả bản in cấu hình build của ffmpeg (~3 KB), chỉ giữ đầu (nguyên nhân) và đuôi. */
export function trimError(msg, head = 400, tail = 300) {
  const s = String(msg ?? "").replace(/\s*configuration: --[^\n]*/g, " …");
  return s.length <= head + tail + 20 ? s : `${s.slice(0, head)} … ${s.slice(-tail)}`;
}

/**
 * Ngân sách thời gian của lần dựng (giây): không quá --budget (mặc định DEFAULT_BUDGET) và luôn thoát (mã 75) trước khi máy chạy code
 * ngắt lệnh (SYNCHRO_RUN_TIMEOUT = số giây của lần chạy, máy chạy code truyền vào), chừa 25 giây cho ghép tệp và đóng trình duyệt.
 */
export function pickBudget(optBudget, runTimeout) {
  const b = optBudget ?? DEFAULT_BUDGET, t = Number(runTimeout);
  return t > 0 ? Math.max(10, Math.min(b, t - 25)) : b;
}

// ---------------------------------------------------------------- đường dẫn
/** Đường dẫn tương đối trong root, không đi ra ngoài (kể cả qua liên kết tượng trưng). Trả đường dẫn thật (realpath). */
export function safeResolve(root, rel, real = fs.realpathSync) {
  if (typeof rel !== "string" || !rel.trim()) throw new UsageError("Đường dẫn tệp trống.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) throw new UsageError(`"${rel}": chỉ nhận tệp trong thư mục làm việc. Tải tệp về trước (vd. curl -o inputs/ten.mp4 …) rồi ghi đường dẫn tương đối.`);
  if (path.isAbsolute(rel)) throw new UsageError(`"${rel}": dùng đường dẫn tương đối trong thư mục làm việc (vd. inputs/anh.jpg), không dùng đường dẫn tuyệt đối.`);
  if (rel.split(/[\\/]/).includes("..")) throw new UsageError(`"${rel}": không được dùng ".." để ra ngoài thư mục làm việc.`);
  const base = real(root);
  let target;
  try { target = real(path.resolve(base, rel)); } catch { throw new UsageError(`Không thấy tệp "${rel}" trong thư mục làm việc (ls inputs/ để xem tên đúng).`); }
  if (target !== base && !target.startsWith(base + path.sep)) throw new UsageError(`"${rel}" trỏ ra ngoài thư mục làm việc (liên kết tượng trưng).`);
  return target;
}

/**
 * Đường dẫn tệp ra (có thể chưa có) trong thư mục làm việc, và trong thư mục con under nếu có (vd. "outputs": chỉ tệp trong outputs/ tới tay người dùng).
 * Không nhận đường dẫn tuyệt đối, "..", hay thư mục liên kết tượng trưng trỏ ra ngoài. Trả đường dẫn tuyệt đối.
 */
export function safeOut(root, rel, under = "", real = fs.realpathSync) {
  const where = under ? `${under}/` : "thư mục làm việc";
  const eg = under ? `${under}/${under === "outputs" ? "video.mp4" : "ten"}` : "outputs/phu-de.json";
  if (typeof rel !== "string" || !rel.trim()) throw new UsageError("Đường dẫn tệp ra trống.");
  if (path.isAbsolute(rel) || /^[a-z][a-z0-9+.-]*:/i.test(rel)) throw new UsageError(`"${rel}": tệp ra phải là đường dẫn tương đối trong ${where} (vd. ${eg}).`);
  if (rel.split(/[\\/]/).includes("..")) throw new UsageError(`"${rel}": không được dùng ".." để ra ngoài ${where}.`);
  const base = real(root), top = under ? path.join(base, under) : base;
  const target = path.resolve(base, rel);
  if (target !== top && !target.startsWith(top + path.sep)) throw new UsageError(`"${rel}": tệp ra phải nằm trong ${where} (vd. ${eg})${under === "outputs" ? ": chỉ tệp trong outputs/ tới tay người dùng" : ""}.`);
  // Thư mục cha đã có thì đường dẫn thật cũng phải ở trong (không đi vòng qua liên kết tượng trưng).
  let p = path.dirname(target);
  while (!fs.existsSync(p) && p.startsWith(base + path.sep)) p = path.dirname(p);
  const rp = real(p);
  const inside = rp === top || rp.startsWith(top + path.sep), above = rp === p && (p === base || top.startsWith(p + path.sep));
  if (!inside && !above) throw new UsageError(`"${rel}" trỏ ra ngoài ${where} (liên kết tượng trưng).`);
  let link = false;
  try { link = fs.lstatSync(target).isSymbolicLink(); } catch {}
  if (link) throw new UsageError(`"${rel}" là liên kết tượng trưng: ghi vào tên tệp khác.`);
  return target;
}

// Trường chứa đường dẫn tệp trong props (theo schema của 4 mẫu).
export const FILE_KEYS = new Set(["video", "images", "audio", "logo", "image", "cover", "voiceover", "src"]);
/** Gọi fn(chuỗi, đường dẫn JSON) cho mọi giá trị tệp, trả bản props mới với giá trị fn trả về. */
export function mapFiles(props, fn, at = "") {
  if (Array.isArray(props)) return props.map((v, i) => mapFiles(v, fn, `${at}[${i}]`));
  if (!props || typeof props !== "object") return props;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const here = at ? `${at}.${k}` : k;
    if (FILE_KEYS.has(k) && typeof v === "string") out[k] = fn(v, here);
    else if (FILE_KEYS.has(k) && Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v.map((x, i) => fn(x, `${here}[${i}]`));
    else out[k] = mapFiles(v, fn, here);
  }
  return out;
}

/** Khóa thư mục trạng thái: cùng mẫu + props + tệp đầu vào + phiên bản thì dùng lại các đoạn đã dựng. */
export function stateKey(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
}

// ---------------------------------------------------------------- phụ đề → Caption[]
const cap = (text, startMs, endMs, timestampMs = null, confidence = null) => ({ text, startMs: Math.max(0, Math.round(startMs)), endMs: Math.max(0, Math.round(endMs)), timestampMs: timestampMs == null ? null : Math.round(timestampMs), confidence });

/**
 * Kết quả whisper-cli -ojf (JSON đầy đủ, có token và t_dtw) → mỗi từ một Caption, chữ bắt đầu bằng dấu cách như @remotion/install-whisper-cpp toCaptions.
 * Token đặc biệt ([_BEG_], [_TT_…]) bị bỏ; token không bắt đầu bằng dấu cách được nối vào từ trước (whisper tách một từ tiếng Việt thành nhiều token byte).
 */
export function whisperToCaptions(json) {
  const out = [];
  for (const seg of json?.transcription ?? []) {
    for (const t of seg.tokens ?? []) {
      const text = String(t.text ?? "");
      if (!text || /^\[_[A-Z]+_?.*\]$/.test(text) || /^\[_/.test(text)) continue;
      const from = t.offsets?.from ?? 0, to = t.offsets?.to ?? from;
      const ts = typeof t.t_dtw === "number" && t.t_dtw >= 0 ? t.t_dtw * 10 : null;
      const prev = out[out.length - 1];
      if (prev && !/^\s/.test(text) && !/^[\s]*$/.test(text)) { prev.text += text; prev.endMs = Math.max(prev.endMs, to); continue; }
      if (!text.trim()) continue;
      out.push(cap(out.length ? text : text.replace(/^\s+/, " "), from, to, ts, typeof t.p === "number" ? t.p : null));
    }
  }
  // Ghép xong mới sửa byte UTF-8 vỡ (token lẻ của whisper có thể là nửa ký tự): bỏ ký tự thay thế.
  return out.map((c) => ({ ...c, text: c.text.replace(/�/g, "") })).filter((c) => c.text.trim());
}

/** edge-tts WordBoundary ({offset, duration} theo đơn vị 100 ns, text) → Caption[]. Nhận mảng hoặc {words: [...]}. */
export function wordBoundaryToCaptions(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
  if (!list) throw new UsageError("Tệp WordBoundary phải là mảng {offset, duration, text} (đơn vị 100 ns như edge-tts) hoặc {words: [...]}.");
  return list.filter((w) => (w.type ?? "WordBoundary") === "WordBoundary" && String(w.text ?? "").trim()).map((w, i) => {
    const s = Number(w.offset) / 10_000, e = s + Number(w.duration) / 10_000;
    return cap((i ? " " : "") + String(w.text).trim(), s, e, (s + e) / 2);
  });
}

const srtTime = (s) => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(s); if (!m) return null; return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Number(m[4].padEnd(3, "0")); };
/**
 * .srt → Caption[]. words=true (mặc định): chia mỗi dòng phụ đề thành từng từ, thời gian chia theo độ dài chữ, để mẫu tiktok tô sáng từng từ
 * (edge-tts --write-subtitles cho phụ đề theo câu).
 */
export function srtToCaptions(text, { words = true } = {}) {
  const out = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const s = srtTime(a), e = srtTime(b);
    if (s == null || e == null) continue;
    const body = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    if (!words) { out.push(cap((out.length ? " " : "") + body, s, e)); continue; }
    const ws = body.split(" "), total = ws.reduce((n, w) => n + w.length + 1, 0);
    let t = s;
    for (const w of ws) {
      const d = ((e - s) * (w.length + 1)) / total;
      out.push(cap((out.length ? " " : "") + w, t, t + d, t + d / 2));
      t += d;
    }
  }
  return out;
}

/** Cắt và dời phụ đề theo đoạn [startSec, endSec) của âm thanh (audiogram clip). */
export function shiftCaptions(caps, startSec = 0, endSec = Infinity) {
  const a = startSec * 1000, b = endSec * 1000;
  return caps.filter((c) => c.endMs > a && c.startMs < b).map((c) => ({ ...c, startMs: Math.max(0, c.startMs - a), endMs: Math.min(b - a, c.endMs - a), timestampMs: c.timestampMs == null ? null : Math.max(0, c.timestampMs - a) }));
}
export const captionsEndSec = (caps) => (caps.length ? Math.max(...caps.map((c) => c.endMs)) / 1000 : 0);

/** Lỗi zod → các dòng "đường.dẫn: thông báo" tiếng Việt. */
export function formatIssues(issues) {
  return issues.slice(0, 12).map((i) => {
    const at = i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "") || "(gốc)";
    const msg = i.code === "invalid_type" ? `sai kiểu (cần ${i.expected})` : i.code === "invalid_value" ? `phải là một trong: ${(i.values ?? []).join(", ")}`
      : i.code === "too_small" ? `quá nhỏ / thiếu (tối thiểu ${i.minimum})` : i.code === "too_big" ? `quá lớn / quá nhiều (tối đa ${i.maximum})`
      : i.code === "unrecognized_keys" ? `trường không có trong schema: ${(i.keys ?? []).join(", ")}` : i.code === "invalid_union" ? "không khớp kiểu nào của trường này (xem synchro-video schema)" : i.message;
    return `props.${at}: ${msg}`;
  });
}

/**
 * Ước tính thời gian dựng (giây) trên VPS 2 vCPU, để model báo người dùng; số đo thật in sau mỗi lần dựng.
 * Đo 2026-11-11 (synchro-video bench, 60 fps, --cpus 2): tiktok có video nền 1080x1920 8,6 khung/giây; next-tailwind 1920x1080 17,9;
 * audiogram 1080x1080 23,2; github-unwrapped 1080x1080 21,8.
 */
export function estimateRenderSec(id, frames, { video = false } = {}) {
  const fps = video ? 8.5 : id === "audiogram" ? 23 : id === "github-unwrapped" ? 21 : id === "next-tailwind" ? 17 : 14;
  return Math.round(frames / fps + 8);
}
