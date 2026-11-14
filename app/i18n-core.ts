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
  if (!s.trim() || !d) return s;
  const r = trRaw(d, s);
  return lang === "en" ? plural(r) : r;
}

// Phần tra từ điển của trWith, chưa thêm số nhiều (tfWith tự thêm, chừa giá trị chèn ra).
function trRaw(d: Dict, s: string): string {
  const t = s.trim();
  if (!t) return s;
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
    const parts = t.split(" · "), done = parts.map((x) => trRaw(d, x));
    if (done.some((x, i) => x !== parts[i])) out = done.join(" · ");
  }
  return out === undefined ? s : s.replace(t, () => out as string);
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

/** Điền {biến} vào mẫu. Mẫu có dạng "một|nhiều" (ngăn bằng |) thì chọn theo vars.n: đúng 1 lấy vế đầu.
 *  shown: giá trị đem điền (mặc định là vars; tfWith điền chỗ giữ thay cho tên, tiêu đề để số nhiều không đụng tới chúng). */
export function fill(tpl: string, vars: Vars, shown: Vars = vars): string {
  let s = tpl;
  if (own(vars as Record<string, string>, "n") && s.includes("|")) { const [one, many] = s.split("|"); s = Number(vars.n) === 1 ? one : many ?? one; }
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (own(shown as Record<string, string>, k) ? String(shown[k]) : m));
}

// Giá trị chèn là con số ("5", "1,234"): để số nhiều nhìn thấy ("{n} skill" → "5 skills"). Còn lại (tên, tiêu đề người dùng đặt) giữ nguyên chữ.
const isNum = (v: string | number) => /^\s*\d[\d.,]*\s*$/.test(String(v));
const HOLD = /\uE000(\d+)\uE001/g;

/** Số nhiều tiếng Anh cho câu đã điền mà không sửa giá trị chèn: tiêu đề "5 skill" vẫn là "5 skill".
 *  Thay mỗi giá trị chữ (có trong câu) bằng chỗ giữ, thêm số nhiều, rồi trả giá trị về. */
function pluralKeep(s: string, vars: Vars): string {
  const keep = [...new Set(Object.values(vars).filter((v) => !isNum(v)).map(String).filter((v) => v && s.includes(v)))].sort((a, b) => b.length - a.length);
  let t = s;
  keep.forEach((v, i) => { t = t.split(v).join(`\uE000${i}\uE001`); });
  return plural(t).replace(HOLD, (_, i: string) => keep[Number(i)]);
}

/** Dịch cả mẫu có {biến} (khóa trong từ điển là nguyên mẫu, ví dụ "Gói {name} đã hết hạn mức") rồi mới điền giá trị.
 *  Mẫu chưa có trong từ điển: ở tiếng Anh thì điền vào câu gốc rồi dịch như chuỗi thường (luật dịch vẫn bắt được);
 *  ở tiếng Việt giữ nguyên câu gốc, không đưa giá trị chèn (tên đoạn chat, tên người…) qua từ điển. */
export function tfWith(d: Dict | undefined, key: string, vars: Vars, lang: Lang): string {
  if (d && own(d.map, key)) {
    if (lang !== "en") return fill(d.map[key], vars);
    // Số nhiều chỉ áp lên chữ của mẫu và giá trị là con số; tên, tiêu đề điền vào sau cùng nên không bị đổi.
    const held: string[] = [], shown: Vars = {};
    for (const [k, v] of Object.entries(vars)) shown[k] = isNum(v) ? v : `\uE000${held.push(String(v)) - 1}\uE001`;
    return plural(fill(d.map[key], vars, shown)).replace(HOLD, (_, i: string) => held[Number(i)]);
  }
  const s = fill(key, vars);
  if (lang !== "en" || !d) return s;
  // Mẫu chưa có khóa: luật dịch cần thấy giá trị thật, nên dịch câu đã điền rồi thêm số nhiều chừa các giá trị chữ ra.
  return pluralKeep(trRaw(d, s), vars);
}
