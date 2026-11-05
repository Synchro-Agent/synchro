// Ảnh từ URL ngoài cho artifact (chỉ chạy ở máy chủ): tải qua safeFetch (chặn địa chỉ nội bộ, kiểm tra mỗi lần chuyển hướng), chỉ nhận
// tệp ảnh tới 6 MB, nhớ tạm 100 ảnh gần nhất. Dùng cho /api/artimg (khung xem trước) và máy kiểm tra hiển thị (artcheck.ts).
import { externalImageUrls, genImageId, swapUrls } from "./artdoc";
import { readOutput } from "./outputs";
import { safeFetch } from "./safefetch";

export type Img = { mime: string; data: Buffer };
const MAX = 6 * 1024 * 1024;
// Wikimedia và nhiều trang ảnh từ chối yêu cầu không có User-Agent riêng.
const UA = "SynchroArtifactImages/1.0 (+https://synchro.net.nz)";
type G = { __synchroArtImg?: Map<string, Promise<Img | null>> };
const cache: Map<string, Promise<Img | null>> = ((globalThis as G).__synchroArtImg ??= new Map());

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
  let p = cache.get(url);
  if (!p) {
    p = load(url).catch(() => null);
    cache.set(url, p);
    // Ảnh lỗi thì lần sau thử lại; giữ tối đa 100 ảnh.
    p.then((x: Img | null) => { if (!x) cache.delete(url); });
    while (cache.size > 100) cache.delete(cache.keys().next().value!);
  }
  return p;
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
