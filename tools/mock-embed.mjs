// API embedding giả lập (OpenAI /v1/embeddings và lối tương thích OpenAI của Gemini /v1beta/openai/embeddings) cho kiểm thử tìm kiếm theo nghĩa.
// Không phải model thật: mỗi "khái niệm" (ô tô / xe hơi / automobile…) có một chiều riêng, nên câu hỏi và ghi chú cùng nghĩa mà khác chữ
// (khác ngôn ngữ, từ đồng nghĩa) vẫn gần nhau, điều BM25 không làm được. Các từ khác băm vào các chiều còn lại (trùng chữ cũng gần nhau).
// Số chiều theo model (đổi model thì đổi số chiều) và theo tham số dimensions. Chữ "#embedslow" làm chậm 3 giây, "#embed500" trả lỗi 500, "#embed400" trả lỗi 400 (nội dung bị từ chối), "#embedshort" trả thiếu một vector.
const CONCEPTS = [
  ["car", "cars", "automobile", "automobiles", "vehicle", "sedan", "ô tô", "xe hơi", "oto"],
  ["dog", "dogs", "puppy", "puppies", "chó", "cún", "chó con"],
  ["sick", "ill", "illness", "unwell", "ốm", "bệnh", "bị ốm", "sốt"],
  ["doctor", "physician", "clinic", "bác sĩ", "phòng khám"],
  ["sleep", "insomnia", "rest", "ngủ", "mất ngủ", "giấc ngủ"],
  ["budget", "money", "finance", "cost", "tiền", "ngân sách", "chi phí", "tài chính"],
  ["wedding", "marriage", "đám cưới", "cưới", "hôn lễ"],
  ["travel", "trip", "vacation", "du lịch", "chuyến đi", "kỳ nghỉ"],
];
const LOOKUP = new Map(CONCEPTS.flatMap((ws, i) => ws.map((w) => [w, i])));
const DIMS = (model) => (/large/.test(model) ? 96 : /gemini/.test(model) ? 80 : 64);
export const EMBED_LOG = { calls: 0, inputs: 0, models: {} };
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };
export function fakeEmbed(text, dim) {
  const v = new Array(dim).fill(0), nc = CONCEPTS.length;
  const toks = String(text).normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set(), words = new Set();
  for (let i = 0; i < toks.length; i++) {
    const two = i + 1 < toks.length ? `${toks[i]} ${toks[i + 1]}` : null;
    if (two && LOOKUP.has(two)) { seen.add(LOOKUP.get(two)); i++; continue; }
    if (LOOKUP.has(toks[i])) { seen.add(LOOKUP.get(toks[i])); continue; }
    // Mỗi từ tính một lần (như model thật, đoạn dài không bị lấn át bởi từ lặp lại).
    if (toks[i].length > 2 && !words.has(toks[i])) { words.add(toks[i]); v[nc + (hash(toks[i]) % (dim - nc))] += 0.35; }
  }
  for (const c of seen) v[c] += 3;
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
/** Trả true nếu đã xử lý yêu cầu. */
export async function embedHandler(p, b, auth, valid, send) {
  if (p !== "/openai/v1/embeddings" && p !== "/google/v1beta/openai/embeddings") return false;
  if (!valid(auth)) { send(401, { error: { message: "Incorrect API key provided.", type: "invalid_api_key" } }); return true; }
  const model = String(b?.model ?? "");
  if (!/embedding/.test(model)) { send(404, { error: { message: `The model \`${model}\` does not exist`, type: "invalid_request_error" } }); return true; }
  const inputs = Array.isArray(b.input) ? b.input : [b.input];
  const all = inputs.join(" ");
  // "#embed400": hãng từ chối cả lô vì một mục (như đoạn vượt giới hạn token của model).
  if (all.includes("#embed400")) { send(400, { error: { message: "This model's maximum context length is 8192 tokens", type: "invalid_request_error" } }); return true; }
  if (all.includes("#embed500")) { send(500, { error: { message: "mock embedding failure", type: "server_error" } }); return true; }
  if (all.includes("#embedslow")) await new Promise((ok) => setTimeout(ok, 3000));
  const dim = Math.min(DIMS(model), Number(b.dimensions) || Infinity);
  EMBED_LOG.calls++; EMBED_LOG.inputs += inputs.length; EMBED_LOG.models[model] = (EMBED_LOG.models[model] ?? 0) + inputs.length;
  // "#embedshort": hãng trả thiếu vector (ít hơn số đầu vào), vẫn 200.
  const out = all.includes("#embedshort") ? inputs.slice(0, -1) : inputs;
  send(200, { object: "list", model, data: out.map((s, i) => ({ object: "embedding", index: i, embedding: fakeEmbed(s, dim) })), usage: { prompt_tokens: Math.ceil(all.length / 4), total_tokens: Math.ceil(all.length / 4) } });
  return true;
}
