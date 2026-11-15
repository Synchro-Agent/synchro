// Tệp do code của model tạo ra (outputs/ của mỗi lần run_code): lưu trên đĩa máy chủ theo tài khoản, tải về qua
// /api/outputs/<id>. Chỉ chủ tài khoản tải được; tệp tự xóa sau 30 ngày; tài khoản đầy hạn mức thì tệp mới không được lưu (outputRoom), không xóa tệp cũ.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db } from "./authstore";
import { isPlaceholderPng } from "../app/artdoc";
import { diskLow } from "./diskfloor";
import { randomToken } from "./mcpauth";
import type { RunFile } from "./coderun";

// skipped: tệp code đã tạo nhưng không giao được (quá cỡ, hết hạn mức): chỉ là thẻ báo trong tin nhắn, không có trên đĩa.
// w, h: cỡ ảnh, để khung trong tin nhắn giữ đúng tỉ lệ trước khi ảnh tải xong. Tin nhắn cũ không có.
export type OutFile = { id: string; name: string; size: number; mime: string; skipped?: boolean; w?: number; h?: number };
const TTL = 30 * 86_400_000;
const ROOT = path.join(DATA_DIR, "outputs");
// Hạn mức tệp đã tạo của mỗi tài khoản: mỗi lần chạy tới 150 MB, giữ 30 ngày, không có hạn mức thì một người có thể làm đầy đĩa của mọi người.
export const OUTPUT_QUOTA_MB = () => Number(process.env.SYNCHRO_OUTPUT_QUOTA_MB) || 5000;

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf", csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown", json: "application/json",
  html: "text/html", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", py: "text/x-python", js: "text/javascript", ts: "text/plain", sql: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  zip: "application/zip", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", gltf: "model/gltf+json", glb: "model/gltf-binary",
};
export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS outputs_user ON outputs(user_id, created_at);
      CREATE INDEX IF NOT EXISTS outputs_name ON outputs(user_id, name, created_at)`);
    ready = true;
    sweep();
  }
  return d;
}

/** Đĩa đã xuống dưới sàn: lần chạy vẫn xong nhưng tệp không lưu, model phải báo cho người dùng. */
export const outputsFull = () => diskLow(DATA_DIR);

/** Xóa tệp quá 30 ngày. Chạy lúc khởi động và mỗi ngày (máy chủ có thể chạy hàng tháng không khởi động lại). */
export function sweepOutputs() { init(); sweep(); }
function sweep() {
  const d = db();
  const old = d.prepare("SELECT id, user_id FROM outputs WHERE created_at < ?").all(Date.now() - TTL) as { id: string; user_id: string }[];
  for (const o of old) fs.rmSync(path.join(ROOT, o.user_id, o.id), { force: true });
  d.prepare("DELETE FROM outputs WHERE created_at < ?").run(Date.now() - TTL);
}

const safeName = (p: string) => (path.basename(p).replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").slice(0, 120) || "tep");

/** Cỡ ảnh đọc từ phần đầu tệp (PNG, JPEG, WebP), không giải mã ảnh; không đọc được thì bỏ qua. */
export function imageSize(b: Buffer): { w: number; h: number } | null {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        // SOF0..SOF15, trừ DHT (C4), JPG (C8), DAC (CC).
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
      const k = b.toString("latin1", 12, 16);
      if (k === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (k === "VP8L") { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
      if (k === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    }
  } catch { /* tệp cụt */ }
  return null;
}

export function saveOutputs(uid: string, files: RunFile[]): OutFile[] {
  const d = init();
  if (!files.length || outputsFull()) return [];
  fs.mkdirSync(path.join(ROOT, uid), { recursive: true, mode: 0o700 });
  const saved = files.map((f) => {
    const id = randomToken(12);
    const name = safeName(f.path);
    fs.writeFileSync(path.join(ROOT, uid, id), f.data, { mode: 0o600 });
    const o = { id, name, size: f.data.length, mime: mimeOf(name) };
    d.prepare("INSERT INTO outputs (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, uid, name, o.mime, o.size, Date.now());
    const dim = o.mime.startsWith("image/") ? imageSize(f.data) : null;
    return dim && dim.w > 0 && dim.h > 0 ? { ...o, ...dim } : o;
  });
  return saved;
}

/** Số byte còn được lưu của tài khoản. */
export function outputRoom(uid: string): number {
  const used = (init().prepare("SELECT COALESCE(SUM(size), 0) AS n FROM outputs WHERE user_id = ? AND created_at >= ?").get(uid, Date.now() - TTL) as { n: number }).n;
  return Math.max(0, OUTPUT_QUOTA_MB() * 1048576 - used);
}

/** Loại ảnh theo các byte đầu tệp (PNG, JPEG, WebP, GIF); không nhận ra thì null. */
export function sniffImageMime(b: Buffer): string | null {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6))) return "image/gif";
  return null;
}

/** Ghi đè nội dung một tệp đã lưu (giữ nguyên id và đường dẫn tải về), cập nhật kích thước, mime và cỡ ảnh.
 *  Dùng cho ảnh dựng ở chế độ nền (G4): thay byte thật vào đúng ảnh giữ chỗ model đã đặt vào slide / artifact. Giữ nguyên tên để tham chiếu inputs/ không đổi;
 *  mime theo đúng byte thật (W23-2): ảnh giữ chỗ tên .png nhưng nhà cung cấp có thể trả JPEG / WebP, ghi image/png thì trình duyệt và tệp tải về sai loại. */
export function replaceOutput(uid: string, id: string, data: Buffer): OutFile | null {
  if (!/^[\w-]{8,40}$/.test(id)) return null;
  const d = init();
  const row = d.prepare("SELECT name FROM outputs WHERE id = ? AND user_id = ?").get(id, uid) as { name: string } | undefined;
  if (!row) return null;
  const p = path.join(ROOT, uid, id);
  try { fs.writeFileSync(p, data, { mode: 0o600 }); } catch { return null; }
  genFailed.delete(id);
  const named = mimeOf(row.name);
  const mime = named.startsWith("image/") ? sniffImageMime(data) ?? named : named;
  d.prepare("UPDATE outputs SET mime = ?, size = ? WHERE id = ? AND user_id = ?").run(mime, data.length, id, uid);
  const o: OutFile = { id, name: row.name, size: data.length, mime };
  const dim = mime.startsWith("image/") ? imageSize(data) : null;
  return dim && dim.w > 0 && dim.h > 0 ? { ...o, ...dim } : o;
}

// Ảnh dựng nền (G4) không xong (lỗi, hết nhà cung cấp, thiếu ảnh): nhớ trong tiến trình để /api/artimg và /api/outputs báo "hỏng" thay vì "đang chờ",
// khung xem trước và thẻ ảnh thôi hỏi lại (W23-2). Toàn cục: mỗi route của Next được đóng gói riêng. Máy chủ khởi động lại thì ảnh nền đang dựng cũng mất:
// ảnh giữ chỗ quá GEN_PENDING_MS cũng tính là hỏng.
const gGen = globalThis as unknown as { __synchroGenFailed?: Set<string> };
const genFailed = (gGen.__synchroGenFailed ??= new Set<string>());
export const GEN_PENDING_MS = 20 * 60_000;
export function markGenFailed(id: string) {
  genFailed.add(id);
  if (genFailed.size > 5000) genFailed.delete(genFailed.values().next().value!);
}
/** Trạng thái ảnh giữ chỗ của ảnh dựng nền: "pending" còn đang dựng, "failed" không dựng được; null khi byte đã là ảnh thật. */
export function genImageState(uid: string, id: string, data: Uint8Array): "pending" | "failed" | null {
  if (!isPlaceholderPng(data)) return null;
  if (genFailed.has(id)) return "failed";
  const r = init().prepare("SELECT created_at FROM outputs WHERE id = ? AND user_id = ?").get(id, uid) as { created_at: number } | undefined;
  return !r || Date.now() - r.created_at > GEN_PENDING_MS ? "failed" : "pending";
}

/** Xóa một tệp vừa tạo mà người dùng chưa nhận (bản mới của cùng đường dẫn trong cùng lượt thay thế). */
export function removeOutput(uid: string, id: string) {
  if (!/^[\w-]{8,40}$/.test(id)) return;
  init().prepare("DELETE FROM outputs WHERE id = ? AND user_id = ?").run(id, uid);
  fs.rmSync(path.join(ROOT, uid, id), { force: true });
}

/** Thông tin và đường dẫn tệp trên đĩa (không đọc nội dung): tải về theo từng đoạn cho video / tệp lớn. */
export function outputFile(uid: string, id: string): (OutFile & { path: string }) | null {
  if (!/^[\w-]{8,40}$/.test(id)) return null;
  const r = init().prepare("SELECT id, name, mime, size, created_at FROM outputs WHERE id = ? AND user_id = ?").get(id, uid) as (OutFile & { created_at: number }) | undefined;
  if (!r || Date.now() - r.created_at > TTL) return null;
  const p = path.join(ROOT, uid, id);
  if (!fs.existsSync(p)) return null;
  return { id: r.id, name: r.name, mime: r.mime, size: fs.statSync(p).size, path: p };
}

/** Tệp gần nhất cùng tên của tài khoản (tên model nhớ từ lượt trước, không có mã tệp). */
export function outputByName(uid: string, name: string): (OutFile & { data: Buffer }) | null {
  const r = init().prepare("SELECT id FROM outputs WHERE user_id = ? AND name = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1").get(uid, name, Date.now() - TTL) as { id: string } | undefined;
  return r ? readOutput(uid, r.id) : null;
}

export function readOutput(uid: string, id: string): (OutFile & { data: Buffer }) | null {
  const f = outputFile(uid, id);
  return f ? { id: f.id, name: f.name, mime: f.mime, size: f.size, data: fs.readFileSync(f.path) } : null;
}

export function removeUserOutputs(uid: string) {
  init().prepare("DELETE FROM outputs WHERE user_id = ?").run(uid);
  fs.rmSync(path.join(ROOT, uid), { recursive: true, force: true });
}
