// Xuất PNG của artifact: khung cô lập không được gọi mạng (connect-src 'none') nên thư viện chụp ảnh không tự nhúng
// được phông web, ảnh ra font dự phòng và xuống dòng khác hẳn bản xem. Trang Synchro tải đúng các font trang đó khai
// báo rồi đưa vào khung dưới dạng data:. Chỉ tải phần font có ký tự trang dùng (chia theo unicode-range); lỗi hay quá
// giờ thì trả chuỗi rỗng, ảnh vẫn xuất được bằng font dự phòng.
// Nguồn phông: face.css của bộ Synchro (/kitfonts/v1/<id>/face.css, đường dẫn tệp tương đối) khi có, không thì Google
// Fonts.
import { KIT_FONTS } from "../shared/designrefs";
import { kitFaceUrl } from "../shared/kitfonts";
import { kitFontIds, usesKit } from "../shared/artkit";
import { svgExport } from "../shared/artdoc";

const SHEET = /https:\/\/fonts\.googleapis\.com\/[^"'\s)<>]+/g;
const KIT_SHEET = /https?:\/\/[^"'\s)<>]+\/kitfonts\/v1\/[\w-]+\/face\.css/g;
const FACE = /@font-face\s*\{[^}]*\}/g;
// Mỗi trọng lượng tiếng Việt cần 3 mặt (vietnamese, latin-ext, latin): bộ thiết kế nặng nhất (Plus Jakarta + Inter + JetBrains) là 33 mặt. Trần thấp hơn cắt đúng các mặt cuối theo tên họ, tức Plus Jakarta Sans 800 của tiêu đề và KPI.
const MAX_SHEETS = 6, MAX_FONTS = 48;
// Mỗi phông của bộ Synchro là một face.css: trang trộn token có tới 3 họ, cộng phông của preset nền.
const MAX_KIT_SHEETS = 8;

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
  const kit = [...new Set(content.match(KIT_SHEET) ?? [])].slice(0, MAX_KIT_SHEETS);
  // Bộ Synchro đã có đủ phông của trang: không tải thêm bản Google của cùng họ (hai mặt trùng tên, mặt sau thắng).
  const google = kit.length ? [] : [...new Set((content.match(SHEET) ?? []).map((u) => u.replace(/&amp;/g, "&")))];
  const urls = [...kit, ...google.slice(0, MAX_SHEETS)];
  const inline = content.match(FACE)?.filter((f) => /https:\/\/fonts\.gstatic\.com\//.test(f)) ?? [];
  if (!urls.length && !inline.length) return "";
  const signal = AbortSignal.timeout(ms);
  try {
    const css = await Promise.all(urls.map((u) => get(u, { signal }).then((r) => (r.ok ? r.text() : ""), () => "")));
    const chars = new Set<number>();
    for (const ch of content) chars.add(ch.codePointAt(0)!);
    // Mỗi mặt nhớ địa chỉ tệp CSS của nó: face.css của Synchro ghi tệp phông bằng đường dẫn tương đối.
    const sheetFaces = css.flatMap((c, i) => (c.match(FACE) ?? []).map((f) => ({ f, base: urls[i] })));
    const faces = [...inline.map((f) => ({ f, base: "" })), ...sheetFaces]
      .filter((x) => inRange(x.f, chars)).slice(0, MAX_FONTS);
    const out = await Promise.all(faces.map(async ({ f, base }) => {
      const m = /url\(\s*["']?([^"')\s]+)["']?\s*\)/.exec(f);
      if (!m) return "";
      let src = "";
      try {
        src = new URL(m[1], base || undefined).href;
      } catch {
        // Địa chỉ phông hỏng trong CSS: bỏ mặt đó, các mặt khác vẫn nhúng được.
        return "";
      }
      if (!/^https?:/.test(src)) return "";
      // Một tệp phông không tải được chỉ thiếu đúng mặt đó: ảnh vẫn xuất, chữ đó dùng phông dự phòng.
      const r = await get(src, { signal }).catch(() => null);
      if (!r?.ok) return "";
      const data = await r.arrayBuffer().catch(() => null);
      if (!data) return "";
      const woff2 = /\.woff2(?:[?#]|$)/.test(src) || /format\(\s*["']woff2/.test(f);
      const fmt = woff2 ? "woff2" : /\.woff(?:[?#]|$)/.test(src) ? "woff" : "ttf";
      return f.replace(m[0], `url(data:font/${fmt};base64,${b64(data)})`);
    }));
    return out.filter(Boolean).join("\n");
  } catch (e) {
    // Không nhúng được phông: ảnh vẫn xuất bằng phông dự phòng, lỗi chỉ ghi để biết vì sao ảnh khác bản xem.
    console.warn("[artfonts] không nhúng được phông", e);
    return "";
  }
}

/** Phông của bộ Synchro mà một hình SVG dùng: theo preset / data-sx-fonts, và theo tên họ viết thẳng trong
 *  font-family. */
export function svgKitFonts(svg: string): string[] {
  const named = KIT_FONTS
    .filter((f) => new RegExp(`["'\\s,:=]${f.family.replace(/ /g, "\\s")}["'\\s,;]`, "i").test(svg)).map((f) => f.id);
  return [...new Set([...(usesKit(svg) ? kitFontIds(svg) : []), ...named])];
}

/**
 * Tệp SVG tải về đứng một mình, mở ở máy không cài phông vẫn đúng: chữ logo (<text data-sx-logo>) đổi thành đường nét
 * qua /api/kitfonts/outline, chữ còn lại dùng phông nhúng dạng data: trong <style> của chính tệp. Máy chủ không đổi
 * được (không có sandbox, lỗi mạng) thì chữ logo giữ nguyên và vẫn có phông nhúng.
 */
export async function svgDownload(svg: string, origin: string, get: typeof fetch = fetch): Promise<string> {
  let out = svg;
  if (/<text\b[^>]*\bdata-sx-logo\b/.test(svg)) {
    const r = await get("/api/kitfonts/outline", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ svg }),
    }).catch((e) => {
      console.warn("[artfonts] không đổi được chữ logo thành nét", e);
      return null;
    });
    // Trả lời không đọc được: giữ chữ logo, phông nhúng bên dưới vẫn giữ đúng hình chữ.
    const j = r?.ok ? ((await r.json().catch(() => null)) as { svg?: unknown } | null) : null;
    if (typeof j?.svg === "string") out = j.svg;
  }
  const ids = svgKitFonts(out);
  const sheets = ids.map((id) => `<!-- ${kitFaceUrl(origin, id)} -->`).join("");
  const faces = ids.length ? await fontEmbedCss(`${out}${sheets}`, get) : "";
  return svgExport(out, faces);
}
