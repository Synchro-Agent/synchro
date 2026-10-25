// Hội đồng phản biện: sau khi model viết xong một sản phẩm quan trọng (code, trang web, ứng dụng React),
// một hoặc hai model của hãng khác đọc lại ở nền và chỉ ra lỗi theo dòng (JSON có cấu trúc), kèm bản sửa áp được ngay.
// Dùng chung cho trình duyệt và máy chủ.
import type { ArtType } from "./artifacts";

export type Severity = "high" | "medium" | "low";
export type Finding = { line_start: number; line_end: number; severity: Severity; title: string; detail: string; suggested_fix: string; by?: string[] };
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

/** Đọc JSON model trả về (có thể nằm trong khối ```json), bỏ mục sai, giới hạn dòng trong tệp. */
export function parseFindings(text: string, lines: number, max = 8): Finding[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const first = text.search(/[[{]/), arr = text.trim().startsWith("[");
  const raw = fenced ?? (first < 0 ? "" : text.slice(first, (arr ? text.lastIndexOf("]") : text.lastIndexOf("}")) + 1));
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(j) ? j : Array.isArray((j as { findings?: unknown })?.findings) ? (j as { findings: unknown[] }).findings : [];
  const out: Finding[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const a = Math.round(Number(x?.line_start)), b = Math.round(Number(x?.line_end ?? x?.line_start));
    const title = String(x?.title ?? "").trim().slice(0, 160);
    if (!Number.isFinite(a) || a < 1 || a > lines || !title) continue;
    const severity = SEV.includes(x?.severity as Severity) ? (x.severity as Severity) : "medium";
    out.push({ line_start: a, line_end: Math.max(a, Math.min(lines, Number.isFinite(b) ? b : a)), severity, title, detail: String(x?.detail ?? "").trim().slice(0, 600), suggested_fix: typeof x?.suggested_fix === "string" ? x.suggested_fix.replace(/\n$/, "") : "" });
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
