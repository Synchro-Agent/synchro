// File lớn: cắt đoạn ~1000 token và chọn các đoạn liên quan nhất tới câu hỏi.
// Dùng BM25 cục bộ (không cần embedding API / vector DB). Muốn dùng embedding thật,
// chỉ cần thay hàm `rank` bên dưới.
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

export function rank(chunks: string[], query: string, k: number): number[] {
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
  return score.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]).sort((a, b) => a - b);
}
