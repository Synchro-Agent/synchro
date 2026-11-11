// File lớn: cắt đoạn ~1000 token và chọn các đoạn liên quan nhất tới câu hỏi.
// BM25 cục bộ; khi máy chủ có khóa OpenAI / Gemini, fileproc/index.ts kết hợp thêm tìm theo nghĩa (vecstore) bằng RRF.
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
