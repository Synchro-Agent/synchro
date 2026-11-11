#!/usr/bin/env node
// synchro-video: lệnh model gọi trong run_code để dựng video từ 4 mẫu Remotion dựng sẵn ở /opt/remotion (bundle đã đóng gói lúc build image,
// không cần mạng). Model chỉ viết props.json theo schema; bố cục là mã cố định của mẫu (Schema-to-Component).
// Dựng theo từng đoạn ~8 giây vào .synchro-video/<khóa>/ trong thư mục làm việc: hết --budget giây thì thoát mã 75, chạy lại đúng lệnh để dựng tiếp.
// Giấy phép: Remotion Free License (cá nhân / công ty tối đa 3 người). Không truyền licenseKey: bản v4 không gửi gì ra ngoài khi thiếu khóa.
// Chỉ dựng các mẫu của Synchro hoặc composition model tự viết; không dựng dự án Remotion người dùng tải lên (điều khoản của Remotion).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captionsEndSec, DEFAULT_BUDGET, isOomError, pickBudget, safeOut, trimError, DEFAULT_CHUNK_SEC, DEFAULT_FPS, estimateRenderSec, EXIT_RESUME, formatIssues, mapFiles, MAX_SECONDS, parseArgs,
  pendingChunks, pickConcurrency, planChunks, readCgroup, safeResolve, shiftCaptions, shouldContinue, srtToCaptions, stateKey, UsageError, USAGE,
  whisperToCaptions, wordBoundaryToCaptions,
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = process.env.SYNCHRO_VIDEO_BUNDLE ?? path.join(ROOT, "bundle");
const SHELL = path.join(ROOT, "chrome-headless-shell-linux64", "chrome-headless-shell");
const WHISPER = process.env.SYNCHRO_WHISPER ?? "/opt/whisper/build/bin/whisper-cli";
const MODEL = process.env.SYNCHRO_WHISPER_MODEL ?? "/opt/whisper/ggml-small.bin";
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies.remotion;
// Thư mục làm việc (selftest / bench đổi sang thư mục tạm của chúng).
let CWD = process.cwd();

const log = (...a) => console.error(...a);
const out = (o) => process.stdout.write(JSON.stringify(o, null, 1) + "\n");
const readMaybe = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });
  if (r.status !== 0) throw new Error(`${cmd} lỗi (mã ${r.status ?? r.signal}): ${(r.stderr || r.stdout || "").trim().slice(-600)}`);
  return r.stdout;
};

async function schemas() { return import("../src/schemas.mjs"); }
const examples = () => JSON.parse(fs.readFileSync(path.join(ROOT, "src", "examples.json"), "utf8"));

// ---------------------------------------------------------------- trình duyệt
// Mặc định Chrome Headless Shell đúng bản Remotion 4.0.539 đã thử (157.0.8080.0, tải lúc build image, có mã băm). SYNCHRO_VIDEO_BROWSER=system dùng
// Chromium của Debian (/usr/bin/chromium, chế độ chrome-for-testing); "auto" để Remotion tự tìm / tải (chỉ dùng khi phát triển trên máy khác).
function browserOpts() {
  const want = process.env.SYNCHRO_VIDEO_BROWSER ?? (fs.existsSync(SHELL) ? "shell" : fs.existsSync("/usr/bin/chromium") ? "system" : "auto");
  if (want === "shell") return { browserExecutable: SHELL, chromeMode: "headless-shell" };
  if (want === "system") return { browserExecutable: "/usr/bin/chromium", chromeMode: "chrome-for-testing" };
  return { browserExecutable: null, chromeMode: "headless-shell" };
}
const chromiumOptions = { enableMultiProcessOnLinux: true };

function concurrency(size) {
  const cg = readCgroup(readMaybe);
  return pickConcurrency({ cpus: os.availableParallelism?.() ?? os.cpus().length, ...cg, ...size });
}
// Khung đang dựng, để báo lỗi hết bộ nhớ nói đúng kích thước.
let curSize = null;

// ---------------------------------------------------------------- máy chủ tệp của người dùng (chỉ đọc, chỉ 127.0.0.1)
// staticFile() của Remotion chỉ thấy public/ của bundle, nên tệp trong thư mục làm việc được phục vụ qua địa chỉ nội bộ. Chỉ GET / HEAD,
// chỉ những tệp props nhắc tới (đã qua safeResolve), hỗ trợ Range (trình đọc âm thanh / video của Remotion cần).
const MIME = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
function fileServer(allowed) {
  const byId = new Map([...allowed].map((p, i) => [String(i), p]));
  const srv = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    const m = /^\/f\/(\d+)\//.exec(req.url ?? "");
    const file = m && byId.get(m[1]);
    if (!file) { res.writeHead(404); return res.end(); }
    let st;
    try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0, end = st.size - 1, code = 200;
    if (r) {
      if (r[1] === "") { start = Math.max(0, st.size - Number(r[2])); } else { start = Number(r[1]); if (r[2] !== "") end = Math.min(end, Number(r[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      code = 206;
    }
    res.writeHead(code, { "Content-Type": type, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(code === 206 ? { "Content-Range": `bytes ${start}-${end}/${st.size}` } : {}) });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const ids = new Map([...byId].map(([id, p]) => [p, id]));
    ok({ url: (p) => `${base}/f/${ids.get(p)}/${encodeURIComponent(path.basename(p))}`, close: () => srv.close() });
  }));
}

// ---------------------------------------------------------------- đo tệp
function probeDuration(file) {
  const s = sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim();
  const d = Number(s);
  if (!(d > 0)) throw new UsageError(`Không đọc được thời lượng của ${path.relative(CWD, file)} (tệp hỏng hoặc không phải âm thanh / video).`);
  return d;
}
const fileSig = (p) => { const st = fs.statSync(p); return `${path.relative(CWD, p)}:${st.size}:${Math.round(st.mtimeMs)}`; };

// ---------------------------------------------------------------- phụ đề
function captionsFromFile(abs) {
  const raw = fs.readFileSync(abs, "utf8");
  if (/\.srt$/i.test(abs)) return srtToCaptions(raw);
  const j = JSON.parse(raw);
  if (Array.isArray(j) && j.every((c) => typeof c?.startMs === "number")) return j.map((c) => ({ timestampMs: null, confidence: null, ...c }));
  if (j?.transcription) return whisperToCaptions(j);
  return wordBoundaryToCaptions(j);
}

/** Nhận dạng giọng nói bằng whisper.cpp (không cần mạng). clip: chỉ một đoạn [startSec, endSec). */
function transcribe(media, { lang = "vi", model = MODEL, clip = null, work }) {
  if (!fs.existsSync(WHISPER) || !fs.existsSync(model)) throw new UsageError("Image này chưa có whisper.cpp / mô hình: hãy ghi phụ đề vào props (Caption[] hoặc .srt từ edge-tts) thay cho \"auto\".");
  fs.mkdirSync(work, { recursive: true });
  const wav = path.join(work, "asr.wav"), base = path.join(work, "asr");
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...(clip ? ["-ss", String(clip.startSec), "-to", String(clip.endSec)] : []), "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const threads = String(Math.max(1, Math.min(4, Math.floor(readCgroup(readMaybe).cpuQuota ?? os.availableParallelism?.() ?? 2))));
  const dtw = /small/.test(path.basename(model)) ? ["--dtw", "small"] : /base/.test(path.basename(model)) ? ["--dtw", "base"] : [];
  const t0 = Date.now();
  sh(WHISPER, ["-m", model, "-f", wav, "-l", lang, "-t", threads, "-ojf", "-of", base, "-sow", "-np", ...dtw], { cwd: work });
  const caps = whisperToCaptions(JSON.parse(fs.readFileSync(base + ".json", "utf8")));
  log(`[whisper] ${caps.length} từ trong ${((Date.now() - t0) / 1000).toFixed(1)} giây`);
  fs.rmSync(wav, { force: true });
  return caps;
}

// ---------------------------------------------------------------- chuẩn bị props
/**
 * Đọc props.json, áp --fps/--size, kiểm tra bằng schema, giải đường dẫn tệp (an toàn), chuẩn bị phụ đề và thời lượng.
 * mode "check": không chạy whisper. Trả { id, props (đường dẫn thật), files (Set), sig, notes }.
 */
async function prepare(id, propsPath, opts, mode) {
  const { SCHEMAS, plannedSeconds, sizeOf, DEFAULT_SIZE } = await schemas();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(safeResolve(CWD, propsPath), "utf8")); } catch (e) { throw e instanceof UsageError ? e : new UsageError(`Không đọc được ${propsPath}: ${e.message}`); }
  if (opts.fps) raw.fps = opts.fps;
  if (opts.size) raw.size = opts.size;
  const r = SCHEMAS[id].safeParse(raw);
  if (!r.success) throw new UsageError(`Props chưa đúng schema của mẫu ${id}:\n${formatIssues(r.error.issues).join("\n")}\nXem: synchro-video schema ${id}`);
  const files = new Set(), sigs = [], notes = [];
  let p = mapFiles(r.data, (rel, at) => {
    if (at === "captions") return rel; // đường dẫn phụ đề đọc ở dưới
    const abs = safeResolve(CWD, rel);
    files.add(abs); sigs.push(fileSig(abs));
    return abs;
  });
  try { sizeOf(id, p.size ?? DEFAULT_SIZE[id]); } catch (e) { throw new UsageError(`props.size: ${e.message}.`); }
  const work = path.join(CWD, ".synchro-video", "asr");
  // Phụ đề.
  if (typeof p.captions === "string" && p.captions !== "auto" && p.captions !== "none") {
    const abs = safeResolve(CWD, p.captions);
    sigs.push(fileSig(abs));
    p.captions = captionsFromFile(abs);
    if (id === "audiogram" && p.clip) p.captions = shiftCaptions(p.captions, p.clip.startSec, p.clip.endSec);
  } else if (p.captions === "none") p.captions = [];
  if (p.captions === "auto") {
    const media = id === "tiktok" ? p.audio ?? p.video : id === "audiogram" ? p.audio : p.voiceover;
    if (!media) throw new UsageError(`captions "auto" cần tệp giọng nói (${id === "tiktok" ? "audio hoặc video" : id === "audiogram" ? "audio" : "voiceover"}). Không có giọng thì ghi phụ đề vào props.`);
    if (mode === "check") { notes.push("Phụ đề \"auto\": sẽ nhận dạng giọng nói bằng whisper.cpp khi dựng (mô hình small, ~1 GB bộ nhớ, chạy trước khi dựng hình)."); p.captions = []; }
    else {
      const key = stateKey([fileSig(media), p.clip ?? null, p.language]);
      const cache = path.join(work, `${key}.json`);
      if (fs.existsSync(cache)) p.captions = JSON.parse(fs.readFileSync(cache, "utf8"));
      else { p.captions = transcribe(media, { lang: p.language, clip: id === "audiogram" ? p.clip : null, work }); fs.writeFileSync(cache, JSON.stringify(p.captions)); }
      sigs.push(`asr:${key}`);
    }
  }
  // Thời lượng.
  if (id === "tiktok") {
    const m = p.video ?? p.audio;
    p.durationSec = m ? probeDuration(m) : p.images?.length ? p.images.length * p.imageSeconds : p.durationSec ?? (captionsEndSec(p.captions) ? captionsEndSec(p.captions) + 0.8 : 5);
  } else if (id === "audiogram") {
    const full = probeDuration(p.audio);
    if (p.clip) {
      if (!(p.clip.endSec > p.clip.startSec)) throw new UsageError("clip.endSec phải lớn hơn clip.startSec.");
      if (p.clip.startSec >= full) throw new UsageError(`clip.startSec (${p.clip.startSec}) vượt thời lượng âm thanh (${full.toFixed(1)} giây).`);
      p.durationSec = Math.min(full, p.clip.endSec) - p.clip.startSec;
    } else p.durationSec = full;
  } else {
    p.durationSec = plannedSeconds(id, p);
    const voice = p.voiceover;
    if (voice) { const v = probeDuration(voice); if (v > p.durationSec + 0.3) notes.push(`Giọng đọc dài ${v.toFixed(1)} giây nhưng các cảnh chỉ ${p.durationSec.toFixed(1)} giây: tăng seconds của cảnh để không cắt mất lời.`); }
  }
  if (p.durationSec > MAX_SECONDS) throw new UsageError(`Video dài ${Math.round(p.durationSec)} giây, tối đa ${MAX_SECONDS} giây một lần dựng: chia thành nhiều video.`);
  const final = SCHEMAS[id].safeParse(p);
  if (!final.success) throw new UsageError(`Props sau khi chuẩn bị không hợp lệ:\n${formatIssues(final.error.issues).join("\n")}`);
  return { id, props: final.data, files, sig: sigs, notes, size: sizeOf(id, final.data.size ?? DEFAULT_SIZE[id]) };
}

async function openSession(prep) {
  const { openBrowser, selectComposition } = await import("@remotion/renderer");
  if (!fs.existsSync(path.join(BUNDLE, "index.html"))) throw new Error(`Chưa có bundle Remotion ở ${BUNDLE}`);
  const srv = await fileServer(prep.files);
  const inputProps = mapFiles(prep.props, (abs, at) => (at === "captions" ? abs : srv.url(abs)));
  const b = browserOpts();
  const browser = await openBrowser("chrome", { browserExecutable: b.browserExecutable, chromeMode: b.chromeMode, chromiumOptions, logLevel: "error" });
  const comp = await selectComposition({ serveUrl: BUNDLE, id: prep.id, inputProps, puppeteerInstance: browser, chromeMode: b.chromeMode, chromiumOptions, logLevel: "error", timeoutInMilliseconds: 60_000 });
  return { browser, comp, inputProps, srv, b, close: async () => { srv.close(); await browser.close({ silent: true }).catch(() => {}); } };
}

const stillName = (id, t) => `${id}-${String(t).replace(".", "_")}s.jpg`;

async function cmdStill(id, propsPath, opts) {
  if (opts.out != null) safeOut(CWD, opts.out, "outputs");
  const prep = await prepare(id, propsPath, opts, "still");
  curSize = prep.size;
  const { renderStill } = await import("@remotion/renderer");
  const s = await openSession(prep);
  try {
    const dur = s.comp.durationInFrames / s.comp.fps;
    const at = opts.at ?? [0.2, dur * 0.35, dur * 0.7, Math.max(0, dur - 0.3)].map((x) => Math.round(x * 10) / 10);
    const dir = safeOut(CWD, opts.out ?? "outputs/_preview", "outputs");
    fs.mkdirSync(dir, { recursive: true });
    const made = [];
    for (const t of at) {
      const frame = Math.min(s.comp.durationInFrames - 1, Math.round(t * s.comp.fps));
      const file = path.join(dir, stillName(id, t));
      await renderStill({ composition: s.comp, serveUrl: BUNDLE, inputProps: s.inputProps, frame, output: file, imageFormat: "jpeg", jpegQuality: 85, puppeteerInstance: s.browser,
        chromeMode: s.b.chromeMode, chromiumOptions, logLevel: "error", overwrite: true, scale: Math.min(1, 1080 / Math.max(s.comp.width, s.comp.height)) });
      made.push(path.relative(CWD, file));
    }
    out({ ok: true, id, width: s.comp.width, height: s.comp.height, fps: s.comp.fps, durationSec: +dur.toFixed(2), stills: made, notes: prep.notes });
  } finally { await s.close(); }
}

async function cmdCheck(id, propsPath, opts) {
  const prep = await prepare(id, propsPath, opts, "check");
  const frames = Math.round(prep.props.durationSec * prep.props.fps);
  const est = estimateRenderSec(id, frames, { video: !!prep.props.video });
  out({ ok: true, id, ...prep.size, fps: prep.props.fps, durationSec: +prep.props.durationSec.toFixed(2), frames, chunks: planChunks(frames, prep.props.fps, DEFAULT_CHUNK_SEC).length,
    estimateSec: est, runs: Math.max(1, Math.ceil(est / pickBudget(undefined, process.env.SYNCHRO_RUN_TIMEOUT))), files: [...prep.files].map((f) => path.relative(CWD, f)), notes: prep.notes });
}

async function cmdRender(id, propsPath, target, opts) {
  const t0 = Date.now();
  const budget = pickBudget(opts.budget, process.env.SYNCHRO_RUN_TIMEOUT), crf = opts.crf ?? 20;
  // Chỉ tệp trong outputs/ tới tay người dùng: tệp ra ở chỗ khác thì dựng xong mà người dùng không nhận được gì.
  const outFile = safeOut(CWD, target ?? `outputs/${id}.mp4`, "outputs");
  const prep = await prepare(id, propsPath, opts, "render");
  curSize = prep.size;
  const fps = prep.props.fps, frames = Math.round(prep.props.durationSec * fps);
  const key = stateKey([VERSION, id, prep.props, prep.sig, crf, opts.chunk ?? DEFAULT_CHUNK_SEC]);
  const dir = path.join(CWD, ".synchro-video", key);
  fs.mkdirSync(dir, { recursive: true });
  const plan = planChunks(frames, fps, opts.chunk ?? DEFAULT_CHUNK_SEC);
  const done = new Set(fs.readdirSync(dir).filter((f) => /^chunk-\d+\.ts$/.test(f)));
  const todo = pendingChunks(plan, done);
  const conc = concurrency(prep.size);
  log(`[synchro-video] ${id} ${prep.size.width}x${prep.size.height} ${fps} fps, ${prep.props.durationSec.toFixed(1)} giây = ${frames} khung, ${plan.length} đoạn (đã xong ${plan.length - todo.length}), ${conc} tab`);
  const { renderMedia, makeCancelSignal } = await import("@remotion/renderer");
  const { cancelSignal, cancel } = makeCancelSignal();
  process.once("SIGTERM", () => { cancel(); });
  process.once("SIGINT", () => { cancel(); });
  if (todo.length) {
    const s = await openSession(prep);
    const startup = (Date.now() - t0) / 1000;
    const common = { composition: s.comp, serveUrl: BUNDLE, inputProps: s.inputProps, puppeteerInstance: s.browser, chromeMode: s.b.chromeMode, chromiumOptions, logLevel: "error", cancelSignal,
      concurrency: conc, offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, timeoutInMilliseconds: 120_000 };
    try {
      let n = 0, frameSec = 0, framesDone = 0;
      for (const c of todo) {
        const elapsed = (Date.now() - t0) / 1000;
        if (!shouldContinue({ elapsedSec: elapsed, budgetSec: budget, doneThisRun: n, framesPerSec: frameSec ? framesDone / frameSec : 0, nextFrames: c.end - c.start + 1, startupSec: 0 })) break;
        const c0 = Date.now();
        // Tiếng của đúng đoạn này ra tệp WAV riêng (PCM 48 kHz, ghép nối không hở như đoạn hình); video không có tiếng vẫn có rãnh im lặng.
        // Một lượt cho cả hình lẫn tiếng: lượt tiếng riêng phải duyệt lại mọi khung (đo trên VPS: 4 giây có video nền mất ~28 giây).
        const part = (ext) => path.join(dir, c.file.replace(/\.ts$/, `.part${ext}`));
        await renderMedia({ ...common, codec: "h264-ts", frameRange: [c.start, c.end], outputLocation: part(".ts"), overwrite: true,
          audioCodec: "pcm-16", separateAudioTo: part(".wav"), enforceAudioTrack: true, sampleRate: 48000,
          imageFormat: "jpeg", jpegQuality: 88, x264Preset: "veryfast", crf, pixelFormat: "yuv420p" });
        fs.renameSync(part(".wav"), path.join(dir, c.file.replace(/\.ts$/, ".wav")));
        fs.renameSync(part(".ts"), path.join(dir, c.file));
        done.add(c.file); n++;
        frameSec += (Date.now() - c0) / 1000; framesDone += c.end - c.start + 1;
        log(`[synchro-video] đoạn ${c.i + 1}/${plan.length} xong (${(framesDone / frameSec).toFixed(1)} khung/giây)`);
      }
      log(`[synchro-video] khởi động ${startup.toFixed(1)} giây`);
    } finally { await s.close(); }
  }
  const left = pendingChunks(plan, done);
  if (left.length) {
    out({ ok: false, status: "partial", id, done: plan.length - left.length, total: plan.length, elapsedSec: Math.round((Date.now() - t0) / 1000),
      next: `Chạy lại đúng lệnh này (mã thoát ${EXIT_RESUME}): dựng tiếp từ đoạn ${plan.length - left.length + 1}/${plan.length}, các đoạn đã xong được giữ.` });
    process.exit(EXIT_RESUME);
  }
  // Ghép các đoạn (chép nguyên hình) với tiếng AAC 48 kHz.
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const list = path.join(dir, "concat.txt"), alist = path.join(dir, "concat-audio.txt");
  fs.writeFileSync(list, plan.map((c) => `file '${path.join(dir, c.file)}'`).join("\n") + "\n");
  fs.writeFileSync(alist, plan.map((c) => `file '${path.join(dir, c.file.replace(/\.ts$/, ".wav"))}'`).join("\n") + "\n");
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-f", "concat", "-safe", "0", "-i", alist, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-r", String(fps), "-shortest", "-movflags", "+faststart", outFile]);
  const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,sample_rate,nb_frames:format=duration,size", "-of", "json", outFile]));
  const v = probe.streams.find((x) => x.codec_type === "video"), a = probe.streams.find((x) => x.codec_type === "audio");
  // Ảnh xem trước từ chính tệp MP4 (đúng thứ người dùng nhận), vào outputs/_preview/.
  const nPrev = opts.previews ?? 5, prevDir = path.join(CWD, "outputs", "_preview"), stills = [];
  if (nPrev) fs.mkdirSync(prevDir, { recursive: true });
  const dur = Number(probe.format.duration);
  for (let i = 0; i < nPrev; i++) {
    const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / nPrev);
    const f = path.join(prevDir, `${path.basename(outFile, ".mp4")}-${i + 1}.jpg`);
    sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", outFile, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", f]);
    stills.push(path.relative(CWD, f));
  }
  const size = Number(probe.format.size);
  const problems = [];
  if (v?.r_frame_rate !== `${fps}/1`) problems.push(`tốc độ khung ${v?.r_frame_rate} khác ${fps}/1`);
  if (a?.sample_rate !== "48000") problems.push(`âm thanh ${a?.sample_rate ?? "không có"} Hz`);
  if (size > 100 * 1024 * 1024) problems.push(`tệp ${(size / 1048576).toFixed(0)} MB vượt 100 MB: dựng lại với --crf cao hơn (24–28)`);
  out({ ok: problems.length === 0, id, file: path.relative(CWD, outFile), width: v?.width, height: v?.height, fps: v?.r_frame_rate, audioHz: a?.sample_rate, durationSec: +dur.toFixed(2),
    sizeMB: +(size / 1048576).toFixed(1), renderSec: Math.round((Date.now() - t0) / 1000), previews: stills, problems, notes: prep.notes });
  fs.rmSync(dir, { recursive: true, force: true });
}

async function cmdCaptions(media, outJson, opts) {
  const o = safeOut(CWD, outJson);
  const abs = safeResolve(CWD, media);
  const caps = transcribe(abs, { lang: opts.lang ?? "vi", model: opts.model ? safeResolve(CWD, opts.model) : MODEL, work: path.join(CWD, ".synchro-video", "asr") });
  fs.mkdirSync(path.dirname(o), { recursive: true });
  fs.writeFileSync(o, JSON.stringify(caps, null, 1));
  out({ ok: true, words: caps.length, durationSec: +captionsEndSec(caps).toFixed(2), file: path.relative(CWD, o), sample: caps.slice(0, 12).map((c) => c.text).join("") });
}

function cmdWords(input, outJson) {
  const o = safeOut(CWD, outJson);
  const caps = captionsFromFile(safeResolve(CWD, input));
  fs.mkdirSync(path.dirname(o), { recursive: true });
  fs.writeFileSync(o, JSON.stringify(caps, null, 1));
  out({ ok: true, words: caps.length, durationSec: +captionsEndSec(caps).toFixed(2), file: path.relative(CWD, o) });
}

// ---------------------------------------------------------------- tự kiểm tra lúc build image / đo tốc độ
function makeFixtures(dir, seconds) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-filter_complex", "[0][1]amix=inputs=2,volume=2,apulsator=hz=1.5", "-ar", "48000", f("tone.wav")]);
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=720x1280:rate=30:duration=${seconds}`, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", f("clip.mp4")]);
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "gradients=size=1280x800:duration=1:speed=0.1", "-frames:v", "1", f("shot.png")]);
}
async function cmdSelftest(opts, { seconds = 1, size = null, bench = false } = {}) {
  const ex = examples();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-video-"));
  const prev = process.cwd();
  process.chdir(work);
  CWD = process.cwd();
  const results = {};
  try {
    makeFixtures(path.join(work, "inputs"), Math.max(3, seconds));
    const words = "Xin chào các bạn, đây là bài kiểm tra phụ đề tiếng Việt có dấu đầy đủ".split(" ");
    const caps = words.map((w, i) => ({ text: (i ? " " : "") + w, startMs: i * 220, endMs: i * 220 + 200, timestampMs: null, confidence: null }));
    const props = {
      tiktok: { ...ex.tiktok, video: "inputs/clip.mp4", audio: "inputs/tone.wav", captions: caps, hook: { text: "Kiểm tra tiếng Việt", seconds: 1 } },
      // bench: mẫu ví dụ đầy đủ (22 giây, 36 giây) để đo như video thật; selftest: 1,5–3 giây cho nhanh.
      "next-tailwind": bench ? { ...ex["next-tailwind"] } : { ...ex["next-tailwind"], scenes: [{ type: "headline", seconds: Math.max(1.5, seconds), eyebrow: "Tự kiểm tra", title: "Đồ họa chuyển động tiếng Việt: ư ơ ă â ê ô đ" },
        { type: "screenshot", seconds: Math.max(1.5, seconds), image: "inputs/shot.png", title: "Ảnh chụp màn hình" }], transition: "fade" },
      audiogram: { ...ex.audiogram, audio: "inputs/tone.wav", captions: caps, clip: { startSec: 0, endSec: seconds } },
      "github-unwrapped": bench ? { ...ex["github-unwrapped"] } : { ...ex["github-unwrapped"], scenes: [{ type: "counter", seconds: Math.max(1.5, seconds), label: "Tổng đơn hàng năm", value: 12480 }] },
    };
    for (const [id, p] of Object.entries(props)) {
      fs.writeFileSync(`${id}.json`, JSON.stringify(p));
      const o = { fps: 60, size: size ?? (id === "tiktok" ? "360x640" : id === "next-tailwind" ? "640x360" : "360x360"), budget: 3600, previews: 1 };
      const t = Date.now();
      if (bench) { o.size = undefined; }
      await cmdRender(id, `${id}.json`, `outputs/${id}.mp4`, o);
      const sec = (Date.now() - t) / 1000, len = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `outputs/${id}.mp4`]));
      results[id] = { renderSec: sec, videoSec: len, framesPerSec: +((len * 60) / sec).toFixed(1) };
      const pr = JSON.parse(sh("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,r_frame_rate,sample_rate", "-of", "json", `outputs/${id}.mp4`]));
      const v = pr.streams.find((x) => x.codec_type === "video"), a = pr.streams.find((x) => x.codec_type === "audio");
      if (v?.r_frame_rate !== "60/1" || a?.sample_rate !== "48000") throw new Error(`selftest ${id}: ${v?.r_frame_rate} / ${a?.sample_rate}`);
    }
    if (!opts["skip-whisper"]) {
      const voice = path.join(work, "inputs", "giong.wav");
      sh("espeak-ng", ["-v", "vi", "-s", "150", "-w", voice, bench ? "Xin chào. ".repeat(1) + "Hôm nay chúng ta nói về cách làm việc hiệu quả, ngủ đủ giấc và giữ sức khỏe. ".repeat(6) : "Xin chào các bạn, hôm nay trời đẹp quá."]);
      const t = Date.now();
      const asr = transcribe(voice, { lang: "vi", work: path.join(work, "asr") });
      results.whisper = { sec: (Date.now() - t) / 1000, audioSec: probeDuration(voice), words: asr.length, text: asr.map((c) => c.text).join("").slice(0, 120) };
      if (!asr.length) throw new Error("selftest whisper: không nhận ra từ nào");
    }
    out({ ok: true, selftest: results });
  } finally { process.chdir(prev); CWD = prev; if (!bench) fs.rmSync(work, { recursive: true, force: true }); else log(`[bench] tệp ở ${work}`); }
}

// ---------------------------------------------------------------- main
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const [p0, p1, p2] = a.pos;
  if (a.cmd === "help") { console.log(USAGE); return; }
  if (a.cmd === "templates") {
    const { TEMPLATE_IDS, PURPOSE, DEFAULT_SIZE, SIZES } = await schemas();
    out(TEMPLATE_IDS.map((id) => ({ id, purpose: PURPOSE[id], defaultSize: DEFAULT_SIZE[id], sizes: Object.keys(SIZES), fps: [60, 30], defaultFps: DEFAULT_FPS,
      schema: `synchro-video schema ${id}`, example: `synchro-video example ${id}` })));
    return;
  }
  if (a.cmd === "schema") { const { SCHEMAS } = await schemas(); const { z } = await import("zod"); out(z.toJSONSchema(SCHEMAS[p0], { io: "input", unrepresentable: "any" })); return; }
  if (a.cmd === "example") { out(examples()[p0]); return; }
  if (a.cmd === "check") return cmdCheck(p0, p1, a.opts);
  if (a.cmd === "still") return cmdStill(p0, p1, a.opts);
  if (a.cmd === "render") return cmdRender(p0, p1, p2, a.opts);
  if (a.cmd === "captions") return cmdCaptions(p0, p1, a.opts);
  if (a.cmd === "words") return cmdWords(p0, p1);
  if (a.cmd === "selftest") return cmdSelftest(a.opts, { size: a.opts.size });
  if (a.cmd === "bench") return cmdSelftest(a.opts, { seconds: a.opts.seconds ?? 15, bench: true });
}

main().then(() => process.exit(0)).catch((e) => {
  if (e instanceof UsageError) { log(`Lỗi: ${e.message}`); process.exit(2); }
  const msg = String(e?.message ?? e);
  // Hết bộ nhớ (2 GB ở máy dựng): Chromium / ffmpeg bị giết giữa chừng, Remotion báo "signal SIGKILL" kèm cả bản cấu hình ffmpeg. Báo gọn và thoát 137
  // như máy chạy code vẫn báo hết bộ nhớ, để model đổi kích thước chứ không chạy lại đúng lệnh cũ.
  if (isOomError(msg)) {
    const at = curSize ? ` khi dựng ở ${curSize.width}x${curSize.height}` : "";
    const mem = readCgroup(readMaybe).memMax, gb = mem ? `${+(mem / 1024 ** 3).toFixed(1)} GB` : "bộ nhớ";
    log(`Lỗi: hết ${gb}${at}. Giảm --size (vd. landscape, vertical hoặc square) hoặc dùng --fps 30 rồi chạy lại; các đoạn đã dựng xong vẫn được giữ.\nChi tiết: ${trimError(msg, 200, 0)}`);
    process.exit(137);
  }
  log(`Lỗi: ${trimError(msg)}`);
  if (process.env.SYNCHRO_VIDEO_DEBUG && e?.stack) log(e.stack);
  process.exit(1);
});
