// Ảnh từ URL ngoài cho artifact (chỉ chạy ở máy chủ): tải qua safeFetch (chặn địa chỉ nội bộ, kiểm tra mỗi lần chuyển hướng), chỉ nhận
// tệp ảnh tới 6 MB, nhớ tạm tối đa 100 ảnh, 64 MB và 30 phút. Dùng cho /api/artimg (khung xem trước) và máy kiểm tra hiển thị (artcheck.ts).
import "server-only";
import { externalImageUrls, genImageId, swapUrls } from "../app/artdoc";
import { readOutput } from "./outputs";
import { registerMemStat } from "./memstat";
import { safeFetch } from "./safefetch";

export type Img = { mime: string; data: Buffer };
const MAX = 6 * 1024 * 1024;
// Wikimedia và nhiều trang ảnh từ chối yêu cầu không có User-Agent riêng.
const UA = "SynchroArtifactImages/1.0 (+https://synchro.net.nz)";
// Bộ nhớ: trước đây chỉ giới hạn 100 ảnh (tới 600 MB với ảnh 6 MB) và giữ mãi. Giờ giới hạn cả số byte và thời gian, hết hạn thì tự bỏ (hẹn giờ unref).
const CACHE_N = 100, CACHE_BYTES = 64 * 1048576, CACHE_TTL = Number(process.env.SYNCHRO_ARTIMG_TTL_MS) || 30 * 60_000;
type Entry = { p: Promise<Img | null>; at: number; size: number };
type G = { __synchroArtImg2?: Map<string, Entry>; __synchroArtImgTimer?: ReturnType<typeof setTimeout> | null };
const g = globalThis as G;
const cache: Map<string, Entry> = (g.__synchroArtImg2 ??= new Map());
function trim(now = Date.now()) {
  for (const [k, e] of cache) if (now - e.at >= CACHE_TTL) cache.delete(k);
  let total = 0;
  for (const e of cache.values()) total += e.size;
  // Map giữ thứ tự thêm vào (ảnh vừa dùng được đưa xuống cuối): bỏ từ ảnh lâu không dùng nhất.
  for (const [k, e] of cache) { if (cache.size <= CACHE_N && total <= CACHE_BYTES) break; cache.delete(k); total -= e.size; }
  if (g.__synchroArtImgTimer) { clearTimeout(g.__synchroArtImgTimer); g.__synchroArtImgTimer = null; }
  if (cache.size) {
    let oldest = Infinity;
    for (const e of cache.values()) oldest = Math.min(oldest, e.at);
    g.__synchroArtImgTimer = setTimeout(() => trim(), Math.max(1000, oldest + CACHE_TTL - now));
    g.__synchroArtImgTimer.unref?.();
  }
}
/** Ảnh đang nhớ tạm (theo dõi bộ nhớ, kiểm thử). */
export const artImgStats = () => { let bytes = 0; for (const e of cache.values()) bytes += e.size; return { n: cache.size, bytes }; };
registerMemStat("artImages", () => { const s = artImgStats(); return { n: s.n, MB: Math.round(s.bytes / 1048576) }; });
/** Nhớ tạm kết quả tải theo URL; loader thay được trong kiểm thử. */
export function cachedImage(url: string, loader: (url: string) => Promise<Img | null> = load): Promise<Img | null> {
  const now = Date.now();
  let e = cache.get(url);
  if (e && now - e.at >= CACHE_TTL) { cache.delete(url); e = undefined; }
  if (e) { cache.delete(url); cache.set(url, e); return e.p; }
  const p = loader(url).catch(() => null);
  const entry: Entry = { p, at: now, size: 0 };
  cache.set(url, entry);
  // Ảnh lỗi thì lần sau thử lại.
  void p.then((x) => {
    if (cache.get(url) !== entry) return;
    if (!x) cache.delete(url); else { entry.size = x.data.length; trim(); }
  });
  trim(now);
  return p;
}

async function load(url: string): Promise<Img | null> {
  const r = await safeFetch(url, { timeout: 15_000, headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8" } });
  if (!r.ok) return null;
  const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) return null;
  if (Number(r.headers.get("content-length") ?? 0) > MAX) return null;
  const reader = r.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return { mime, data: Buffer.concat(parts) };
}

// Ảnh đã tạo của đúng tài khoản, không qua bộ nhớ tạm chung. Ảnh AI gốc vài MB thu về cỡ màn hình: dữ liệu này nhúng vào khung xem trước.
async function ownImage(uid: string, id: string): Promise<Img | null> {
  const o = readOutput(uid, id);
  if (!o || !/^image\/(png|jpeg|webp|gif)$/.test(o.mime)) return null;
  if (o.data.length > 1.5 * 1048576 && o.mime !== "image/gif") {
    const sharp = await import("sharp").then((m) => m.default, () => null);
    const small = await sharp?.(o.data).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer().catch(() => null);
    if (small && small.length < o.data.length) return { mime: "image/webp", data: small };
  }
  return { mime: o.mime, data: o.data };
}

export function fetchImage(url: string, uid?: string): Promise<Img | null> {
  const gen = genImageId(url);
  if (gen) return uid ? ownImage(uid, gen).catch(() => null) : Promise.resolve(null);
  return cachedImage(url);
}

/** Nhúng mọi ảnh từ URL ngoài trong nội dung artifact thành data: (ảnh tải không được thì giữ nguyên URL). */
export async function inlineImages(content: string, uid?: string): Promise<string> {
  const urls = externalImageUrls(content);
  if (!urls.length) return content;
  const got = await Promise.all(urls.map(async (u) => [u, await fetchImage(u, uid)] as const));
  return swapUrls(content, new Map(got.filter((g): g is readonly [string, Img] => !!g[1]).map(([u, i]) => [u, `data:${i.mime};base64,${i.data.toString("base64")}`])));
}

/** Ảnh cho bản chụp chia sẻ: dạng data: đã thu nhỏ (bản chụp có giới hạn dung lượng, ảnh Wikimedia gốc đã vài MB). SVG, GIF giữ nguyên để không mất nét, mất chuyển động. */
export async function shareImageData(url: string, uid?: string): Promise<string | null> {
  const img = await fetchImage(url, uid);
  if (!img) return null;
  if (img.data.length > 120_000 && /^image\/(png|jpeg|webp|avif|bmp)$/.test(img.mime)) {
    const sharp = await import("sharp").then((m) => m.default, () => null);
    const small = await sharp?.(img.data).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer().catch(() => null);
    if (small && small.length < img.data.length) return `data:image/webp;base64,${small.toString("base64")}`;
  }
  return `data:${img.mime};base64,${img.data.toString("base64")}`;
}
