// Tự tìm logo cho connector (chỉ chạy ở máy chủ): ưu tiên icon máy chủ MCP tự khai báo (serverInfo.icons theo đặc tả),
// rồi icon trang chủ của hãng (mcp.linear.app → linear.app: apple-touch-icon / icon / SVG), rồi /favicon.ico; trang chặn máy chủ
// tải về (429, chống bot) thì hỏi dịch vụ favicon của DuckDuckGo (chỉ gửi tên miền công khai, không có dữ liệu người dùng).
// Ảnh được tải không kèm thông tin đăng nhập, qua safeFetch (chặn địa chỉ nội bộ), nhận diện bằng chữ ký đầu tệp,
// giới hạn dung lượng và lưu dạng data URI; giao diện chỉ hiện trong thẻ <img> nên SVG có script cũng không chạy được.
import { safeFetch } from "./safefetch";

export type ServerIcon = { src: string; mimeType?: string; sizes?: string[]; theme?: string };
const MAX_ICON = 64 * 1024;
const MAX_HTML = 512 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 SynchroIconFetcher/1.0";
// Tên miền hai cấp phổ biến: thương hiệu nằm ở nhãn thứ ba từ phải (vd. example.co.uk).
const TWO_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "co.kr", "com.vn", "com.br", "co.nz", "co.in", "com.sg", "com.cn", "com.tw", "com.hk"]);

async function readLimited(r: Response, max: number): Promise<Buffer | null> {
  if (!r.body) return null;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Nhận diện định dạng ảnh bằng byte đầu tệp, không tin Content-Type của máy chủ.
function sniff(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  const head = b.toString("utf8", 0, Math.min(b.length, 1024)).replace(/^﻿/, "").trimStart().toLowerCase();
  if ((head.startsWith("<svg") || head.startsWith("<?xml")) && b.toString("utf8").toLowerCase().includes("<svg")) return "image/svg+xml";
  return null;
}

/** Tải một ảnh (không kèm thông tin đăng nhập, qua safeFetch): trả byte + loại ảnh nhận diện từ đầu tệp, hoặc null. */
export async function fetchIconBytes(url: string, max = MAX_ICON): Promise<{ mime: string; buf: Buffer } | null> {
  try {
    const r = await safeFetch(url, { headers: { accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5", "user-agent": UA }, timeout: 6_000 });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const buf = await readLimited(r, max);
    const mime = buf && sniff(buf);
    return buf && mime ? { mime, buf } : null;
  } catch { return null; }
}
async function fetchImage(url: string): Promise<string | null> {
  const b = await fetchIconBytes(url);
  return b ? `data:${b.mime};base64,${b.buf.toString("base64")}` : null;
}

function fromDataUri(src: string): string | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(src);
  if (!m) return null;
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  if (buf.length > MAX_ICON) return null;
  const mime = sniff(buf);
  return mime ? `data:${mime};base64,${buf.toString("base64")}` : null;
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

// Các icon khai báo trong <head>, xếp theo độ nét: apple-touch-icon (180px) và SVG trước, favicon nhỏ sau.
function pageIcons(html: string, base: string) {
  const out: { href: string; score: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || rel.includes("mask-icon") || !/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel)) continue;
    const px = Math.max(0, ...(attr(tag, "sizes") ?? "").split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const svg = /svg/.test(attr(tag, "type") ?? "") || /\.svg(\?|#|$)/i.test(href);
    let score = rel.includes("apple-touch-icon") ? 180 : svg ? 170 : px || 32;
    if (score > 256) score = 256 - score / 1000;
    try { out.push({ href: new URL(href.replace(/&amp;/g, "&"), base).toString(), score }); } catch {}
  }
  return out.sort((a, b) => b.score - a.score);
}

// Trang chủ nên thử: tên miền thương hiệu (bỏ mcp./api./ai.…) rồi chính máy chủ MCP.
function sites(mcpUrl: string): string[] {
  const u = new URL(mcpUrl);
  const host = u.hostname.toLowerCase();
  const out: string[] = [];
  if (!/^[\d.]+$/.test(host) && !host.includes(":")) {
    const parts = host.split(".");
    const n = TWO_LEVEL.has(parts.slice(-2).join(".")) ? 3 : 2;
    if (parts.length >= n) out.push(`https://${parts.slice(-n).join(".")}/`);
  }
  out.push(`${u.protocol}//${u.host}/`);
  return [...new Set(out)];
}

async function fromSite(site: string): Promise<string | null> {
  try {
    const r = await safeFetch(site, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA }, timeout: 6_000 });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("html")) {
      const buf = await readLimited(r, MAX_HTML);
      const html = buf?.toString("utf8") ?? "";
      const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
      for (const c of pageIcons(head, r.url || site).slice(0, 4)) { const img = await fetchImage(c.href); if (img) return img; }
    } else await r.body?.cancel();
  } catch {}
  return fetchImage(new URL("/favicon.ico", site).toString());
}

// Trả về data URI của logo, hoặc null nếu không tìm được trong khoảng 12 giây.
export async function detectIcon(mcpUrl: string, serverIcons: ServerIcon[] = []): Promise<string | null> {
  const work = (async () => {
    // Icon máy chủ tự khai báo: chỉ nhận https hoặc data:, bỏ bản dành cho nền tối (logo hiện trên ô nền trắng).
    for (const ic of serverIcons.filter((x) => x && typeof x.src === "string" && x.theme !== "dark").slice(0, 4)) {
      const img = ic.src.startsWith("data:") ? fromDataUri(ic.src) : ic.src.startsWith("https://") || ic.src.startsWith("http://") ? await fetchImage(ic.src) : null;
      if (img) return img;
    }
    const list = sites(mcpUrl);
    for (const s of list) { const img = await fromSite(s); if (img) return img; }
    for (const s of list) {
      const host = new URL(s).hostname;
      if (/^[\d.]+$/.test(host) || host === "localhost") continue;
      const img = await fetchImage(`https://icons.duckduckgo.com/ip3/${host}.ico`);
      if (img) return img;
    }
    return null;
  })();
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 12_000))]).catch(() => null);
}

/** Biểu tượng của một trang web công khai (nguồn trích dẫn): icon khai báo trong <head> của trang chủ, /favicon.ico, rồi dịch vụ favicon
 *  của DuckDuckGo (chỉ gửi tên miền). Chạy ở máy chủ, trình duyệt của người dùng không gọi thẳng trang lạ. FAVICON_BASE (chỉ bản giả lập):
 *  lấy ở máy chủ giả lập thay vì Internet. */
export async function siteIcon(host: string): Promise<{ mime: string; buf: Buffer } | null> {
  const test = process.env.FAVICON_BASE;
  if (test) return fetchIconBytes(`${test.replace(/\/$/, "")}/favicon/${encodeURIComponent(host)}`);
  const work = (async () => {
    const site = `https://${host}/`;
    try {
      const r = await safeFetch(site, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA }, timeout: 5_000 });
      if (r.ok && (r.headers.get("content-type") ?? "").includes("html")) {
        const buf = await readLimited(r, MAX_HTML);
        const html = buf?.toString("utf8") ?? "";
        const end = html.search(/<\/head>/i);
        for (const c of pageIcons(end > 0 ? html.slice(0, end) : html, r.url || site).slice(0, 3)) { const img = await fetchIconBytes(c.href); if (img) return img; }
      } else await r.body?.cancel();
    } catch {}
    return (await fetchIconBytes(new URL("/favicon.ico", site).toString())) ?? fetchIconBytes(`https://icons.duckduckgo.com/ip3/${host}.ico`);
  })();
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]).catch(() => null);
}
