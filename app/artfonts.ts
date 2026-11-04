// Xuất PNG của artifact: khung cô lập không được gọi mạng (connect-src 'none') nên thư viện chụp ảnh không nhúng được Google Fonts, ảnh ra font dự phòng và
// xuống dòng khác hẳn bản xem. Trang Synchro tải đúng các font trang đó khai báo rồi đưa vào khung dưới dạng data:. Chỉ tải phần font có ký tự trang dùng
// (Google chia theo unicode-range); lỗi hay quá giờ thì trả chuỗi rỗng, ảnh vẫn xuất được bằng font dự phòng như trước.
const SHEET = /https:\/\/fonts\.googleapis\.com\/[^"'\s)<>]+/g;
const FACE = /@font-face\s*\{[^}]*\}/g;
const MAX_SHEETS = 6, MAX_FONTS = 30;

function inRange(face: string, chars: Set<number>) {
  const m = /unicode-range:\s*([^;}]+)/i.exec(face);
  if (!m) return true;
  return m[1].split(",").some((p) => {
    const r = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(p.trim());
    if (!r) return false;
    const lo = parseInt(r[1].replace(/\?/g, "0"), 16), hi = r[2] ? parseInt(r[2], 16) : parseInt(r[1].replace(/\?/g, "f"), 16);
    for (const c of chars) if (c >= lo && c <= hi) return true;
    return false;
  });
}

const b64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function fontEmbedCss(content: string, get: typeof fetch = fetch, ms = 6000): Promise<string> {
  const urls = [...new Set((content.match(SHEET) ?? []).map((u) => u.replace(/&amp;/g, "&")))].slice(0, MAX_SHEETS);
  const inline = content.match(FACE)?.filter((f) => /https:\/\/fonts\.gstatic\.com\//.test(f)) ?? [];
  if (!urls.length && !inline.length) return "";
  const signal = AbortSignal.timeout(ms);
  try {
    const css = await Promise.all(urls.map((u) => get(u, { signal }).then((r) => (r.ok ? r.text() : ""), () => "")));
    const chars = new Set<number>();
    for (const ch of content) chars.add(ch.codePointAt(0)!);
    const faces = [...inline, ...css.flatMap((c) => c.match(FACE) ?? [])].filter((f) => inRange(f, chars)).slice(0, MAX_FONTS);
    const out = await Promise.all(faces.map(async (f) => {
      const m = /url\(\s*["']?(https:\/\/fonts\.gstatic\.com\/[^"')\s]+)["']?\s*\)/.exec(f);
      if (!m) return "";
      const r = await get(m[1], { signal }).catch(() => null);
      if (!r?.ok) return "";
      const data = await r.arrayBuffer().catch(() => null);
      if (!data) return "";
      const fmt = /\.woff2(?:[?#]|$)/.test(m[1]) || /format\(\s*["']woff2/.test(f) ? "woff2" : /\.woff(?:[?#]|$)/.test(m[1]) ? "woff" : "ttf";
      return f.replace(m[0], `url(data:font/${fmt};base64,${b64(data)})`);
    }));
    return out.filter(Boolean).join("\n");
  } catch { return ""; }
}
