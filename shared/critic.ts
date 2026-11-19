// Hội đồng phản biện: sau khi model viết xong một sản phẩm quan trọng (code, trang web, ứng dụng React),
// một hoặc hai model của hãng khác đọc lại ở nền và chỉ ra lỗi theo dòng (JSON có cấu trúc), kèm bản sửa áp được ngay.
// Dùng chung cho trình duyệt và máy chủ.
import type { ArtType } from "./artifacts";

export type Severity = "high" | "medium" | "low";
// math: lỗi số liệu kèm phép tính để máy chủ tự tính lại (expr: phép tính từ các số trong sản phẩm, shown: kết quả sản phẩm đang ghi).
export type Finding = { line_start: number; line_end: number; severity: Severity; title: string; detail: string; suggested_fix: string; by?: string[]; math?: { expr: string; shown: string } };
export type CriticEntry = { status: "run" | "done" | "error"; findings: Finding[]; by: string[]; at: number; error?: string; applied?: number[] };

const SEV: Severity[] = ["high", "medium", "low"];
export const SEV_LABEL: Record<Severity, string> = { high: "Nghiêm trọng", medium: "Nên sửa", low: "Gợi ý" };
export const CRITIC_MIN_LINES = 12;

/** Sản phẩm đáng phản biện: code, trang web, ứng dụng React đã viết xong, đủ dài. */
export function important(a: { type: ArtType; content: string; complete?: boolean }): boolean {
  return a.complete !== false && (a.type === "code" || a.type === "html" || a.type === "react") && a.content.split("\n").length >= CRITIC_MIN_LINES;
}

/** Mã băm ngắn của nội dung (FNV-1a) để gắn kết quả đúng phiên bản. */
export function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
export const criticKey = (ident: string, content: string) => `${ident}:${hashOf(content)}`;

/** Nội dung kèm số dòng để model chỉ đúng dòng. */
export const numbered = (content: string) => content.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");

/** Đọc JSON model trả về (có thể nằm trong khối ```json), bỏ mục sai, giới hạn dòng trong tệp.
 *  null: không đọc được câu trả lời, khác với [] là đọc được và không có lỗi nào: coi hai điều đó như nhau là hiện dấu "Ổn" xanh trên trang chưa ai đọc được kết quả phản biện. */
export function parseFindings(text: string, lines: number, max = 8): Finding[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const first = text.search(/[[{]/), arr = text.trim().startsWith("[");
  const raw = fenced ?? (first < 0 ? "" : text.slice(first, (arr ? text.lastIndexOf("]") : text.lastIndexOf("}")) + 1));
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  const list = Array.isArray(j) ? j : Array.isArray((j as { findings?: unknown })?.findings) ? (j as { findings: unknown[] }).findings : null;
  if (!list) return null;
  const out: Finding[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const a = Math.round(Number(x?.line_start)), b = Math.round(Number(x?.line_end ?? x?.line_start));
    const title = String(x?.title ?? "").trim().slice(0, 160);
    if (!Number.isFinite(a) || a < 1 || a > lines || !title) continue;
    const severity = SEV.includes(x?.severity as Severity) ? (x.severity as Severity) : "medium";
    const m = x?.math as { expr?: unknown; shown?: unknown } | undefined;
    const math = m && typeof m === "object" && typeof m.expr === "string" && (typeof m.shown === "string" || typeof m.shown === "number") ? { expr: m.expr.slice(0, 300), shown: String(m.shown).slice(0, 60) } : undefined;
    out.push({ line_start: a, line_end: Math.max(a, Math.min(lines, Number.isFinite(b) ? b : a)), severity, title, detail: String(x?.detail ?? "").trim().slice(0, 600), suggested_fix: typeof x?.suggested_fix === "string" ? x.suggested_fix.replace(/\n$/, "") : "", ...(math ? { math } : {}) });
  }
  return out.sort((p, q) => SEV.indexOf(p.severity) - SEV.indexOf(q.severity) || p.line_start - q.line_start).slice(0, max);
}

/** Gộp ý kiến của các model: cùng chỗ (dòng chồng nhau) thì gộp, giữ mức nặng hơn, ghi tên các model cùng thấy. */
export function mergeFindings(lists: { by: string; findings: Finding[] }[]): Finding[] {
  const out: Finding[] = [];
  for (const { by, findings } of lists) for (const f of findings) {
    const same = out.find((o) => o.line_start <= f.line_end && f.line_start <= o.line_end);
    if (!same) { out.push({ ...f, by: [by] }); continue; }
    if (!same.by?.includes(by)) same.by = [...(same.by ?? []), by];
    if (SEV.indexOf(f.severity) < SEV.indexOf(same.severity)) Object.assign(same, { severity: f.severity, title: f.title, detail: f.detail, suggested_fix: f.suggested_fix || same.suggested_fix, line_start: f.line_start, line_end: f.line_end });
    else if (!same.suggested_fix && f.suggested_fix) same.suggested_fix = f.suggested_fix;
  }
  return out.sort((p, q) => SEV.indexOf(p.severity) - SEV.indexOf(q.severity) || p.line_start - q.line_start);
}

/** Bản sửa dạng SEARCH/REPLACE (thay đúng các dòng được chỉ) để thêm vào đoạn chat như một phiên bản mới của artifact. */
// Đoạn tìm phải là duy nhất trong tệp (áp bản sửa tìm chỗ khớp đầu tiên): trùng thì nới thêm dòng trước / sau làm mốc.
export function fixPatch(content: string, f: Finding): string | null {
  if (!f.suggested_fix.trim()) return null;
  const L = content.split("\n");
  if (f.line_start < 1 || f.line_end > L.length) return null;
  let a = f.line_start - 1, b = f.line_end;
  const own = L.slice(a, b).join("\n");
  if (!own.trim() || own === f.suggested_fix) return null;
  const unique = () => { const s = L.slice(a, b).join("\n"); return content.indexOf(s) === content.lastIndexOf(s); };
  while (!unique() && (a > 0 || b < L.length)) { if (a > 0) a--; if (b < L.length) b++; }
  if (!unique()) return null;
  const before = L.slice(a, f.line_start - 1), after = L.slice(f.line_end, b);
  return `<<<<<<< SEARCH\n${L.slice(a, b).join("\n")}\n=======\n${[...before, f.suggested_fix, ...after].join("\n")}\n>>>>>>> REPLACE`;
}

// Lỗi số liệu báo nhầm (H1 T8: "tổng các thành phần không khớp giá trị đơn hàng" trong khi 11+7+5+3+6 = 32 đúng bằng 32k): model phản biện phải ghi
// phép tính vào math, máy chủ tự tính lại. Tính ra khớp với số sản phẩm ghi thì bỏ mục đó; nêu lỗi số liệu mà không kèm phép tính thì hạ xuống Gợi ý.
// Chỉ coi là "nêu lỗi số liệu" khi câu nói về tổng / phép tính VÀ có con số: "Type mismatch", "không khớp kiểu", "selector doesn't match"
// của phản biện code không phải lỗi số liệu (review W10: các mục high đó từng bị hạ xuống Gợi ý).
const NUM_CLAIM = /tổng (?:\S+ ){0,5}(?:sai|lệch|không khớp|không bằng|không đúng)|(?:sai|lệch|không khớp|không bằng|không đúng) (?:\S+ ){0,3}(?:tổng|phép tính|số liệu)|không cộng (?:ra|lại)|tính sai|tính nhầm|cộng sai|cộng nhầm|sai số liệu|số liệu (?:sai|không khớp|lệch)|doesn[’']?t (?:add up|sum)|do(?:es)? not (?:add up|sum)|miscalculat|wrong (?:sum|total)|incorrect (?:sum|total|calculation)|(?:sum|total|subtotal)s? (?:\S+ ){0,4}(?:mismatch|(?:doesn[’']?t|does not|do not) match|is wrong|is off|is incorrect)/i;
const NUMBERS = /\d/;
/** Câu nói có phải là nêu lỗi số liệu (tổng / phép tính sai, kèm con số). */
export const numericClaim = (text: string) => NUM_CLAIM.test(text) && NUMBERS.test(text);

/** Số viết kiểu Việt ("32.000", "1,5") hay kiểu Anh ("25,910.00", "1.5"), có thể kèm đơn vị (k, tr, %, đ, $), và số chữ số thập phân đang ghi. null: không đọc được. */
function readNum(raw: string): { n: number; dec: number } | null {
  let t = raw.trim().replace(/[\s\u00a0]/g, "").replace(/^[$€£₫]|(?:k|K|m|M|tr|tỷ|tỉ|%|đ|₫|vnd|VND|usd|USD|\$)$/g, "");
  if (!/^[+-]?\d[\d.,]*$/.test(t)) return null;
  let dec = 0;
  const dot = t.lastIndexOf("."), com = t.lastIndexOf(",");
  if (dot >= 0 && com >= 0) { dec = t.length - Math.max(dot, com) - 1; t = dot > com ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", "."); }
  else if (dot >= 0 || com >= 0) {
    const sep = dot >= 0 ? "." : ",", parts = t.split(sep);
    // Nhiều dấu, hoặc một dấu theo sau đúng 3 chữ số: dấu phân cách hàng nghìn. Còn lại: dấu thập phân.
    const thousands = parts.length > 2 || (parts[1].length === 3 && !/^[+-]?0$/.test(parts[0]));
    if (!thousands) dec = parts[1].length;
    t = thousands ? parts.join("") : parts.join(".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? { n, dec } : null;
}
export function parseNum(raw: string): number | null {
  return readNum(raw)?.n ?? null;
}

/** Tính phép tính đơn giản (+ − × ÷ và ngoặc) trên các số như parseNum đọc. null: không phải phép tính đọc được. */
export function evalExpr(expr: string): number | null {
  const src = expr.replace(/[−–]/g, "-").replace(/[×x·]/g, "*").replace(/÷/g, "/").replace(/=.*$/, "");
  const toks = src.match(/\d[\d.,]*(?:\s?(?:k|K|m|M|tr|tỷ|tỉ|%|đ|₫))?|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const atom = (): number | null => {
    const t = next();
    if (t === "(") { const v = sum(); return next() === ")" ? v : null; }
    if (t === "-") { const v = atom(); return v === null ? null : -v; }
    return t === undefined ? null : parseNum(t);
  };
  const prod = (): number | null => { let v = atom(); while (v !== null && (peek() === "*" || peek() === "/")) { const op = next(), w = atom(); v = w === null ? null : op === "*" ? v * w : w === 0 ? null : v / w; } return v; };
  const sum = (): number | null => { let v = prod(); while (v !== null && (peek() === "+" || peek() === "-")) { const op = next(), w = prod(); v = w === null ? null : op === "+" ? v + w : v - w; } return v; };
  const v = sum();
  return v !== null && i === toks.length && toks.some((t) => /[-+*/]/.test(t)) ? v : null;
}

/** Bỏ lỗi số liệu mà chính phép tính kèm theo cho thấy là khớp; lỗi số liệu không kèm phép tính đọc được thì hạ xuống "low".
 *  Khớp nghĩa là bằng nhau ở đúng độ chính xác của số đang ghi (nửa đơn vị của chữ số cuối: "33%" khớp 33,33; "1025" không khớp 1020),
 *  không dùng dung sai tương đối: 25.800 với 25.910 là lỗi thật dù chỉ lệch 0,42%.
 *  downgrade: false cho phản biện code / ứng dụng (chỉ tự tính lại mục có kèm math, không hạ mức theo câu chữ). */
export function checkMath(list: Finding[], opt: { downgrade?: boolean } = {}): Finding[] {
  const out: Finding[] = [];
  for (const f of list) {
    const claim = opt.downgrade !== false && numericClaim(`${f.title} ${f.detail}`);
    if (!claim && !f.math) { out.push(f); continue; }
    const got = f.math ? evalExpr(f.math.expr) : null, shown = f.math ? readNum(f.math.shown) : null;
    if (got !== null && shown !== null) {
      if (Math.abs(got - shown.n) <= 0.5 * 10 ** -shown.dec + 1e-9 * Math.max(1, Math.abs(shown.n))) continue; // tự tính lại thấy khớp: báo nhầm
      out.push(f); continue;
    }
    out.push(claim ? { ...f, severity: "low" } : f);
  }
  return out;
}
