// Phần tra từ điển dùng chung cho giao diện (i18n.tsx, tải từ điển theo ngôn ngữ) và máy chủ (i18n-server.ts, nhập thẳng từ điển).
// Không có "use client", không nhập từ điển: ai dùng tự đưa từ điển vào.
export type Lang = "vi" | "en";
export type Dict = { map: Record<string, string>; rules: [RegExp, (m: RegExpMatchArray) => string][] };
export type Vars = Record<string, string | number>;

// Tiếng Anh cần số nhiều: "145 skill" → "145 skills". Các từ này giữ nguyên ở cả hai ngôn ngữ nên từ điển không thấy.
const PLURAL = /(\d[\d.,]*\s+)(skill|artifact|credit)\b(?!s)/g;
export const plural = (s: string) => (/skill|artifact|credit/.test(s) ? s.replace(PLURAL, (m, n: string, w: string) => (n.trim() === "1" ? m : n + w + "s")) : s);

const own = (m: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(m, k);

/** Dịch một chuỗi bằng từ điển d: khớp nguyên câu, rồi luật, rồi từng phần nối bằng " · ". Không có từ điển: giữ nguyên. */
export function trWith(d: Dict | undefined, s: string, lang: Lang): string {
  const t = s.trim();
  if (!t || !d) return s;
  const map = d.map;
  let out: string | undefined = own(map, t) ? map[t] : undefined;
  if (out === undefined) {
    for (const [re, f] of d.rules) {
      const m = t.match(re);
      if (m) { out = f(m); break; }
    }
  }
  // Chuỗi ghép bằng " · " (tên model · mô tả, giọng · ngôn ngữ…): dịch từng phần, phần không có trong từ điển (tên riêng) giữ nguyên.
  if (out === undefined && t.includes(" · ")) {
    const parts = t.split(" · "), done = parts.map((x) => trWith(d, x, lang));
    if (done.some((x, i) => x !== parts[i])) out = done.join(" · ");
  }
  const r = out === undefined ? s : s.replace(t, () => out as string);
  return lang === "en" ? plural(r) : r;
}

/** Khóa từ điển kèm ngữ cảnh cho chữ ngắn dễ trùng ("Lọc", "Thuộc", "Chủ đề"…): "Lọc ‹đồ thị›".
 *  Bộ dịch trang áp từ điển cho mọi nút chữ khớp nguyên văn, nên chữ một hai từ để làm khóa trần sẽ bị dịch nhầm ở chỗ khác
 *  (tiêu đề người dùng đặt, chữ cùng mặt chữ nhưng khác nghĩa). Khóa có ‹…› không bao giờ hiện trên trang nên chỉ trc() tra tới. */
export const ctxKey = (s: string, ctx: string) => `${s} ‹${ctx}›`;

/** Dịch chữ ngắn theo ngữ cảnh: chỉ khớp đúng khóa ctxKey (không luật, không tách " · "). Chưa có bản dịch: giữ chữ gốc. */
export function trcWith(d: Dict | undefined, s: string, ctx: string, lang: Lang): string {
  const k = ctxKey(s, ctx);
  if (!d || !own(d.map, k)) return s;
  return lang === "en" ? plural(d.map[k]) : d.map[k];
}

/** Điền {biến} vào mẫu. Mẫu có dạng "một|nhiều" (ngăn bằng |) thì chọn theo vars.n: đúng 1 lấy vế đầu. */
export function fill(tpl: string, vars: Vars): string {
  let s = tpl;
  if (own(vars as Record<string, string>, "n") && s.includes("|")) { const [one, many] = s.split("|"); s = Number(vars.n) === 1 ? one : many ?? one; }
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (own(vars as Record<string, string>, k) ? String(vars[k]) : m));
}

/** Dịch cả mẫu có {biến} (khóa trong từ điển là nguyên mẫu, ví dụ "Gói {name} đã hết hạn mức") rồi mới điền giá trị.
 *  Mẫu chưa có trong từ điển: ở tiếng Anh thì điền vào câu gốc rồi dịch như chuỗi thường (luật dịch vẫn bắt được);
 *  ở tiếng Việt giữ nguyên câu gốc, không đưa giá trị chèn (tên đoạn chat, tên người…) qua từ điển. */
export function tfWith(d: Dict | undefined, key: string, vars: Vars, lang: Lang): string {
  if (d && own(d.map, key)) { const r = fill(d.map[key], vars); return lang === "en" ? plural(r) : r; }
  const s = fill(key, vars);
  return lang === "en" ? trWith(d, s, lang) : s;
}
