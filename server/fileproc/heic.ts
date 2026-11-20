// Ảnh HEIC / HEIF (ảnh chụp iPhone) → PNG cho model. Bản sharp dựng sẵn trên npm chỉ giải được AV1 (AVIF): bộ giải
// HEVC (libde265) không được đóng gói vì bằng sáng chế, nên ảnh iPhone từng bị từ chối. Thứ tự thử:
// 1. sharp, luôn thử trước: rẻ, giải được AVIF (kể cả tệp AVIF khai nhãn chính mif1 nên được nhận là image/heic) và
//    giải được HEVC khi sharp dựng với libvips của hệ thống có libheif + libde265.
// 2. Công cụ dòng lệnh của libheif cài trên máy chủ (ops/install-media-deps.sh), hoặc sips có sẵn trên macOS.
// Mọi lần gọi công cụ ngoài đều có trần thời gian, trần bộ nhớ (prlimit, khi máy có), ưu tiên thấp, môi trường không
// có khóa bí mật, thư mục tạm riêng.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { lowPriority, parserEnv } from "./sandbox";
import { FileError } from "../../shared/fileproc/types";

const run = promisify(execFile);
export const HEIC_TIMEOUT_MS = 60_000;
// Trần cỡ PNG đọc lại vào bộ nhớ: 40 triệu điểm ảnh RGBA không nén cùng phần đầu PNG vẫn dưới mức này.
const OUT_MAX_BYTES = 200 * 1048576;
// Trần bộ nhớ ảo của công cụ ngoài. Trần 40 triệu điểm ảnh tin kích thước tệp tự khai (hộp ispe); tệp cố ý khai sai
// thì libheif có thể cấp phát tới vài GB trước khi trần thời gian kịp dừng nó, đủ đẩy một VPS nhỏ vào OOM. Ảnh 40
// triệu điểm ảnh giải hết khoảng 500 MB (YUV, RGBA, nén PNG), nên 1,5 GB còn dư.
const MEM_MB = Number(process.env.SYNCHRO_HEIF_MEM_MB) || 1536;

/** Một công cụ giải HEIC ngoài: đường dẫn tuyệt đối và cách dựng tham số (tệp vào, tệp PNG ra). */
export type HeifTool = { bin: string; args: (src: string, out: string) => string[] };

function isExec(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    // Không có hoặc không chạy được: với người gọi, hai trường hợp này như nhau (công cụ thiếu).
    return false;
  }
}

/** Đường dẫn tuyệt đối của một lệnh: tên có "/" thì kiểm thẳng, không thì tìm trong PATH như shell. */
export function which(name: string, envPath = process.env.PATH ?? ""): string | null {
  if (name.includes("/")) return isExec(name) ? name : null;
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    if (isExec(p)) return p;
  }
  return null;
}

const toolOf = (bin: string): HeifTool => path.basename(bin) === "sips"
  ? { bin, args: (src, out) => ["-s", "format", "png", src, "--out", out] }
  : { bin, args: (src, out) => [src, out] };

/**
 * Công cụ giải HEIC có trên máy, theo thứ tự ưu tiên: SYNCHRO_HEIF_BIN (người vận hành chỉ định), heif-dec (libheif
 * từ 1.17, Ubuntu 24.04), heif-convert (libheif cũ hơn, Ubuntu 22.04), sips (macOS). Tìm lại mỗi lần gọi để cài thêm
 * không cần khởi động lại web.
 */
export function heifTools(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): HeifTool[] {
  const names = [env.SYNCHRO_HEIF_BIN, "heif-dec", "heif-convert", platform === "darwin" ? "/usr/bin/sips" : ""];
  const found: string[] = [];
  for (const n of names) {
    const bin = n ? which(n, env.PATH ?? "") : null;
    if (bin && !found.includes(bin)) found.push(bin);
  }
  return found.map(toolOf);
}

/** sharp đang chạy có nhận .heic không: bản dựng sẵn trên npm chỉ khai .avif cho bộ đọc heif (trang Sức khỏe). */
export function sharpHasHevc(): boolean {
  return !!sharp.format.heif?.input?.fileSuffix?.includes(".heic");
}

/**
 * Vùng [đầu, cuối) của hộp meta cấp cao nhất. Chỉ tìm ispe trong đó: dữ liệu ảnh nén (hộp mdat, hàng MB) có thể tình
 * cờ chứa 4 byte "ispe", đọc nhầm ra kích thước rác thì ảnh tốt bị từ chối là "quá lớn".
 */
function metaBox(buf: Buffer): [number, number] | null {
  for (let p = 0; p + 8 <= buf.length;) {
    let size = buf.readUInt32BE(p);
    let head = 8;
    if (size === 1) {
      if (p + 16 > buf.length) return null;
      size = Number(buf.readBigUInt64BE(p + 8));
      head = 16;
    } else if (size === 0) {
      size = buf.length - p;
    }
    if (size < head) return null;
    if (buf.toString("latin1", p + 4, p + 8) === "meta") return [p + head, Math.min(buf.length, p + size)];
    p += size;
  }
  return null;
}

/**
 * Kích thước lớn nhất khai trong các hộp ispe (HEIF bắt buộc mỗi ảnh có một hộp này; ảnh lưới có thêm một hộp cho cả
 * ảnh). Đọc trước khi giải mã để chặn "bom giải nén ảnh" mà không cần bộ giải HEVC. null: không thấy hộp nào, tệp
 * không phải HEIF hợp lệ.
 */
export function heifSize(buf: Buffer): { width: number; height: number } | null {
  const meta = metaBox(buf);
  if (!meta) return null;
  const [from, to] = meta;
  let best: { width: number; height: number } | null = null;
  for (let i = buf.indexOf("ispe", from); i >= 0 && i + 16 <= to; i = buf.indexOf("ispe", i + 4)) {
    const width = buf.readUInt32BE(i + 8);
    const height = buf.readUInt32BE(i + 12);
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

/** Tệp PNG công cụ ghi ra: out.png, hoặc out-1.png… khi tệp có nhiều ảnh chính (lấy ảnh đầu). */
async function outputOf(dir: string): Promise<string | null> {
  const names = (await readdir(dir)).filter((n) => /^out(-\d+)?\.png$/.test(n));
  names.sort((a, b) => (a === "out.png" ? -1 : b === "out.png" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  return names.length ? path.join(dir, names[0]) : null;
}

/**
 * Lệnh chạy công cụ dưới trần bộ nhớ: prlimit (util-linux, có sẵn trên Ubuntu) đặt RLIMIT_AS rồi exec chính công cụ,
 * nên vẫn một tiến trình (trần thời gian và SIGKILL áp đúng vào nó). Máy không có prlimit (macOS, nơi chỉ chạy sips khi
 * phát triển) thì chạy thẳng.
 */
function cappedCommand(tool: HeifTool, src: string, out: string): [string, string[]] {
  const args = tool.args(src, out);
  const prlimit = which("prlimit");
  if (!prlimit) return [tool.bin, args];
  return [prlimit, [`--as=${MEM_MB * 1048576}`, "--", tool.bin, ...args]];
}

export type HeicOptions = { timeoutMs?: number; maxPixels?: number };
export type HeicResult = { data: Buffer; via: string };
let warnedMissing = false;

/**
 * Giải một ảnh HEIC / HEIF thành PNG. tools: công cụ ngoài theo thứ tự ưu tiên, người gọi lấy từ heifTools() (tìm lại
 * mỗi lần để cài thêm không cần khởi động lại web). Lỗi nào người dùng cũng nhận một FileError nói rõ lý do và cách
 * tự xử lý.
 */
export async function heicToPng(
  buf: Buffer, name: string, tools: HeifTool[], o: HeicOptions = {},
): Promise<HeicResult> {
  const maxPixels = o.maxPixels ?? 40_000_000;
  const size = heifSize(buf);
  if (!size) throw new FileError(`Ảnh HEIC "${name}" bị hỏng, không đọc được.`);
  const { width: w, height: h } = size;
  if (w * h > maxPixels) {
    throw new FileError(
      `Ảnh "${name}" quá lớn (${w}×${h} điểm ảnh). Giới hạn ~40 triệu điểm ảnh — hãy thu nhỏ rồi tải lại.`,
    );
  }
  let sharpWhy = "";
  try {
    const data = await sharp(buf, { limitInputPixels: maxPixels, failOn: "error" }).png().toBuffer();
    return { data, via: "sharp" };
  } catch (e) {
    // Với sharp trên npm, ảnh HEVC (mọi ảnh iPhone) luôn rơi vào đây: không phải lỗi, còn công cụ ngoài để thử. Lý do
    // chỉ ghi vào nhật ký khi không còn cách nào khác.
    sharpWhy = (e as Error).message.split("\n")[0].slice(0, 200);
  }
  const tool = tools[0];
  if (!tool) {
    if (!warnedMissing) console.warn("[heic] chưa có bộ giải HEIC (chạy ops/install-media-deps.sh):", sharpWhy);
    warnedMissing = true;
    throw new FileError(
      `Không đọc được ảnh HEIC "${name}": máy chủ chưa cài bộ giải mã. Hãy lưu sang JPEG / PNG rồi tải lại.`,
    );
  }
  const timeout = o.timeoutMs ?? HEIC_TIMEOUT_MS;
  const dir = await mkdtemp(path.join(tmpdir(), "heic-"));
  try {
    const src = path.join(dir, "in.heic");
    await writeFile(src, buf);
    const [cmd, args] = cappedCommand(tool, src, path.join(dir, "out.png"));
    // MALLOC_ARENA_MAX: glibc giữ sẵn 64 MB bộ nhớ ảo cho mỗi luồng giải mã; dưới RLIMIT_AS thì ảnh thường cũng
    // có thể hết chỗ.
    const env = { ...parserEnv(), HOME: dir, TMPDIR: dir, MALLOC_ARENA_MAX: "2" };
    const job = run(cmd, args, { timeout, killSignal: "SIGKILL", maxBuffer: 1048576, env });
    lowPriority(job.child.pid);
    await job;
    const out = await outputOf(dir);
    // Thông điệp này chỉ vào nhật ký (nhánh catch bên dưới), người dùng nhận FileError "tệp có thể bị hỏng".
    if (!out) throw new Error("decoder wrote no PNG");
    if ((await stat(out)).size > OUT_MAX_BYTES) throw new FileError(`Ảnh "${name}" quá lớn sau khi giải mã.`);
    const data = await readFile(out);
    // Ảnh ra lớn hơn mọi kích thước tệp tự khai: tệp khai sai để lách trần điểm ảnh ở trên, không đưa tiếp cho sharp.
    const got = await sharp(data, { limitInputPixels: false }).metadata();
    if ((got.width ?? 0) * (got.height ?? 0) > w * h) {
      console.warn(`[heic] ${name}: giải ra ${got.width}×${got.height}, tệp khai ${w}×${h}`);
      throw new FileError(`Ảnh "${name}" quá lớn sau khi giải mã.`);
    }
    return { data, via: path.basename(tool.bin) };
  } catch (e) {
    if (e instanceof FileError) throw e;
    const err = e as Error & { killed?: boolean; signal?: string; stderr?: string };
    if (err.killed || err.signal === "SIGKILL") {
      const s = Math.round(timeout / 1000);
      console.warn(`[heic] ${path.basename(tool.bin)} quá ${s} giây, đã dừng`);
      throw new FileError(`Giải mã ảnh HEIC "${name}" quá lâu (quá ${s} giây). Hãy lưu sang JPEG / PNG rồi tải lại.`);
    }
    console.warn(`[heic] ${path.basename(tool.bin)} lỗi:`, String(err.stderr || err.message).trim().slice(0, 300));
    throw new FileError(`Không đọc được ảnh HEIC "${name}" (tệp có thể bị hỏng). Hãy lưu sang JPEG / PNG rồi tải lại.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
