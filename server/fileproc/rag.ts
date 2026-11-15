// File lớn: cắt đoạn ~1000 token và chọn các đoạn liên quan nhất tới câu hỏi.
// BM25 cục bộ; khi máy chủ có khóa OpenAI / Gemini, fileproc/index.ts kết hợp thêm tìm theo nghĩa (vecstore) bằng RRF.
import "server-only";
const CHUNK_CHARS = 4000;

export function chunkForRag(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of text.split(/\n{2,}/)) {
    if (p.length > CHUNK_CHARS) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += CHUNK_CHARS) out.push(p.slice(i, i + CHUNK_CHARS));
    } else if (cur.length + p.length + 2 > CHUNK_CHARS && cur) { out.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Chia đoạn cho bảng tính: lặp lại dòng tiêu đề (dòng "| cột | cột |" và dòng ngăn cách "| --- |") ở đầu MỖI đoạn,
 * để khi tìm theo nghĩa / BM25 trúng đoạn ở giữa bảng, model vẫn biết mỗi cột là cột nào. Mỗi sheet ("## Sheet:") chia riêng.
 */
export function chunkSheet(text: string): string[] {
  const out: string[] = [];
  const sections = text.split(/\n(?=## Sheet:)/);
  for (const sec of sections) {
    const lines = sec.split("\n");
    let hi = -1;
    for (let i = 0; i + 1 < lines.length; i++) if (/^\|.*\|\s*$/.test(lines[i]) && /^\|[\s\-|:]+\|\s*$/.test(lines[i + 1])) { hi = i; break; }
    if (hi < 0) { for (const c of chunkForRag(sec)) out.push(c); continue; }
    const header = lines[hi] + "\n" + lines[hi + 1];
    const head = lines.slice(0, hi + 2).join("\n"); // tên sheet + phần trên tiêu đề + chính dòng tiêu đề
    let cur = head;
    const flush = () => { if (cur.trim()) out.push(cur); };
    for (const row of lines.slice(hi + 2)) {
      if (cur.length + row.length + 1 > CHUNK_CHARS && cur !== head && cur !== header) { flush(); cur = header; }
      cur += "\n" + row;
    }
    flush();
  }
  return out;
}

const tok = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Điểm BM25 của từng đoạn, xếp giảm dần (chỉ đoạn có điểm). */
export function scored(chunks: string[], query: string): { i: number; s: number }[] {
  const q = [...new Set(tok(query))];
  const docs = chunks.map(tok);
  const avg = docs.reduce((a, d) => a + d.length, 0) / (docs.length || 1) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const score = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t); if (!f) continue;
      const n = df.get(t) ?? 0;
      s += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avg));
    }
    return s;
  });
  return score.map((s, i) => ({ i, s })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
}
export function rank(chunks: string[], query: string, k: number): number[] {
  const top = scored(chunks, query).slice(0, k).map((x) => x.i);
  // Không đoạn nào khớp chữ nào: giữ các đoạn đầu như trước.
  for (let i = 0; top.length < Math.min(k, chunks.length) && i < chunks.length; i++) if (!top.includes(i)) top.push(i);
  return top.sort((a, b) => a - b);
}
