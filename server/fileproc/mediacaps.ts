// Các bộ đọc tệp cần chương trình cài trên máy chủ (ops/install-media-deps.sh): giải ảnh HEIC, chuyển Office cũ
// bằng LibreOffice, OCR trang PDF scan bằng Python. Thiếu chương trình thì tệp bị từ chối mà máy chủ vẫn chạy bình
// thường, nên trang Sức khỏe hệ thống và /api/health đo thật từng thứ (giải một ảnh HEIC mẫu, hỏi phiên bản
// LibreOffice, nạp thư viện OCR) để người vận hành thấy ngay khi thiếu.
import "server-only";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { heicToPng, heifTools, sharpHasHevc, which } from "./heic";
import { lowPriority, parserEnv, pyBin } from "./sandbox";
import type { MediaCap, MediaCaps } from "../../shared/types/health";

const run = promisify(execFile);
const TTL_MS = 10 * 60_000;
// Ảnh mẫu 64×48 do sips của macOS mã hóa HEVC: giải được nó là giải được ảnh chụp iPhone.
const PROBE_HEIC = path.join(process.cwd(), "scripts", "media-probe.heic");

const firstLine = (s: string) => s.trim().split("\n")[0].trim().slice(0, 80);

async function probeHeic(): Promise<MediaCap> {
  if (!sharpHasHevc() && !heifTools().length) return { state: "missing", on: true };
  let sample: Buffer;
  try {
    sample = await readFile(PROBE_HEIC);
  } catch (e) {
    console.error("[media] thiếu ảnh mẫu", PROBE_HEIC, (e as Error).message);
    return { state: "broken", on: true };
  }
  try {
    const out = await heicToPng(sample, "media-probe.heic");
    const m = await sharp(out.data).metadata();
    if (m.width === 64 && m.height === 48) return { state: "ok", on: true, version: out.via };
    console.warn("[media] ảnh HEIC mẫu giải ra sai kích thước:", m.width, m.height);
    return { state: "broken", on: true };
  } catch (e) {
    // Có công cụ mà không giải được ảnh mẫu: thường là thiếu libheif-plugin-libde265 (Ubuntu 24.04).
    console.warn("[media] giải ảnh HEIC mẫu lỗi:", (e as Error).message.slice(0, 200));
    return { state: "broken", on: true };
  }
}

async function probeOffice(): Promise<MediaCap> {
  const want = process.env.SYNCHRO_SOFFICE_BIN;
  if (!want) return { state: "off", on: false };
  const bin = which(want);
  if (!bin) return { state: "missing", on: true };
  // soffice --version vẫn tạo hồ sơ người dùng: cho nó một thư mục tạm riêng rồi xóa.
  const home = await mkdtemp(path.join(tmpdir(), "soffice-probe-"));
  try {
    const env = { ...parserEnv(), HOME: home };
    const job = run(bin, ["--headless", "--version"], { timeout: 30_000, killSignal: "SIGKILL", env });
    lowPriority(job.child.pid);
    return { state: "ok", on: true, version: firstLine((await job).stdout) };
  } catch (e) {
    console.warn("[media] LibreOffice không chạy được:", (e as Error).message.slice(0, 200));
    return { state: "broken", on: true };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

// Nạp đúng các mô-đun scripts/ocr.py dùng: rapidocr kéo theo onnxruntime và OpenCV (cần libgl1, GLib của hệ thống).
const OCR_CHECK = [
  "import importlib.metadata as m, rapidocr_onnxruntime, pypdfium2",
  "print('rapidocr-onnxruntime ' + m.version('rapidocr-onnxruntime'))",
].join("\n");

async function probeOcr(): Promise<MediaCap> {
  const on = process.env.SYNCHRO_OCR === "1";
  if (!on) return { state: "off", on };
  const py = which(pyBin());
  if (!py) return { state: "missing", on };
  try {
    const job = run(py, ["-c", OCR_CHECK], { timeout: 60_000, killSignal: "SIGKILL", env: parserEnv() });
    lowPriority(job.child.pid);
    return { state: "ok", on, version: firstLine((await job).stdout) };
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr || e).trim().slice(-200);
    console.warn("[media] thư viện OCR không nạp được:", why);
    return { state: "broken", on };
  }
}

type Store = { last: MediaCaps | null; running: Promise<MediaCaps> | null };
// Chung một bản cho mọi route (Next có thể nạp mô-đun này nhiều lần): một lần đo phục vụ cả /api/health lẫn
// trang quản trị.
const g = globalThis as { __synchroMediaCaps?: Store };
const store: Store = (g.__synchroMediaCaps ??= { last: null, running: null });

/** Đo lại khi kết quả cũ hơn maxAgeMs; nhiều người gọi cùng lúc dùng chung một lần đo. */
export function mediaCaps(maxAgeMs = TTL_MS): Promise<MediaCaps> {
  if (store.last && Date.now() - store.last.at < maxAgeMs) return Promise.resolve(store.last);
  store.running ??= Promise.all([probeHeic(), probeOffice(), probeOcr()])
    .then(([heic, office, ocr]) => (store.last = { at: Date.now(), heic, office, ocr }))
    .finally(() => { store.running = null; });
  return store.running;
}

/** Kết quả đo gần nhất, không chờ (/api/health phải trả lời nhanh); quá hạn thì đo lại ở nền. null: chưa đo lần nào. */
export function mediaCapsNow(): MediaCaps | null {
  if (!store.last || Date.now() - store.last.at >= TTL_MS) {
    mediaCaps().catch((e) => console.error("[media] đo khả năng đọc tệp lỗi:", e));
  }
  return store.last;
}
