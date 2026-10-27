// Bộ nhớ của từng người (Cài đặt → Bộ nhớ và nút "Bộ nhớ" ở khung soạn): những điều bền vững Synchro nên nhớ về người dùng
// (cách xưng hô, sở thích, công việc, dự án đang làm, cách muốn được trả lời). Lưu ở máy chủ, đưa vào mỗi lượt chat khi bật,
// và tự rút từ cuộc trò chuyện bằng model nhanh (bỏ chủ đề nhạy cảm trừ khi người dùng cho phép).
import crypto from "node:crypto";
import { db, getSetting, setSetting, type UserRow } from "./authstore";
import { quickCall } from "./ai/anymodel";
import { brainCore } from "./brain";

export type Mem = { id: string; content: string; createdAt: number; source: string };
export type MemCfg = { gen: boolean; sens: boolean };
let ready = false;
const t = () => {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS user_memory (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS user_memory_user ON user_memory(user_id, created_at);`);
    ready = true;
  }
  return d;
};
const MAX = 200;
export const memCfg = (uid: string): MemCfg => { try { return { gen: true, sens: false, ...(JSON.parse(getSetting(`mem:${uid}`, "{}")) as Partial<MemCfg>) }; } catch { return { gen: true, sens: false }; } };
export const setMemCfg = (uid: string, p: Partial<MemCfg>) => setSetting(`mem:${uid}`, JSON.stringify({ ...memCfg(uid), ...p }));
export const listMemory = (uid: string): Mem[] =>
  (t().prepare("SELECT * FROM user_memory WHERE user_id = ? ORDER BY created_at").all(uid) as { id: string; content: string; created_at: number; source: string }[]).map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at, source: r.source }));
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function addMemory(uid: string, items: string[], source = "chat"): Mem[] {
  const have = new Set(listMemory(uid).map((m) => norm(m.content)));
  const out: Mem[] = [];
  for (const raw of items) {
    const content = raw.replace(/\s+/g, " ").trim().slice(0, 300);
    if (content.length < 4 || have.has(norm(content))) continue;
    have.add(norm(content));
    const m = { id: crypto.randomBytes(8).toString("base64url"), content, createdAt: Date.now(), source };
    t().prepare("INSERT INTO user_memory (id, user_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, uid, m.content, source, m.createdAt);
    out.push(m);
  }
  // Giữ 200 mục gần nhất.
  t().prepare("DELETE FROM user_memory WHERE user_id = ? AND id NOT IN (SELECT id FROM user_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)").run(uid, uid, MAX);
  return out;
}
export const deleteMemory = (uid: string, id: string) => t().prepare("DELETE FROM user_memory WHERE user_id = ? AND id = ?").run(uid, id).changes > 0;
export const clearMemory = (uid: string) => t().prepare("DELETE FROM user_memory WHERE user_id = ?").run(uid).changes;

/**
 * Những gì Synchro biết về người dùng, đưa vào lời nhắc hệ thống như hiểu biết sẵn có của chính trợ lý (cách Claude dùng bộ nhớ và
 * "personal preferences"): hồ sơ (tên, tên gọi, lĩnh vực), phần tự giới thiệu / hướng dẫn họ viết ở Cài đặt → Tài khoản, và bộ nhớ
 * rút từ các cuộc trò chuyện (memory: khi Bộ nhớ đang bật). Kèm quy tắc dùng tự nhiên: nói như người đã quen họ, không như đang
 * đọc hồ sơ; không nhắc tới cài đặt / bộ nhớ trừ khi được hỏi; thông tin mâu thuẫn thì tin điều cụ thể và mới hơn, không bắt lỗi.
 * Tầng tĩnh của mọi lượt chat, Synchro Code và giọng nói (gói lẫn khóa API); không dùng cho lời gọi nội bộ.
 */
export function userContext(u: Pick<UserRow, "id" | "full_name" | "nickname" | "occupation" | "instructions">, o: { memory: boolean }): string {
  const full = (u.full_name || "").trim(), call = (u.nickname || "").trim(), work = (u.occupation || "").trim(), ins = (u.instructions || "").trim();
  const mem = o.memory ? listMemory(u.id).slice(-80) : [];
  const core = o.memory ? brainCore(u.id) : "";
  const facts = [
    full ? `- Tên: ${full}${call && call !== full ? `; thích được gọi là ${call}` : ""}` : call ? `- Tên gọi: ${call}` : "",
    work ? `- Lĩnh vực chọn lúc tạo tài khoản: ${work}` : "",
  ].filter(Boolean);
  if (!facts.length && !ins && !mem.length && !core) return "";
  return `<user_context>
Bạn đã quen người dùng này qua những lần trò chuyện trước. Dưới đây là những gì bạn biết về họ và cách họ muốn bạn làm việc cùng. Hãy coi đó là hiểu biết sẵn có của chính bạn, như một người bạn hay người cộng sự lâu năm vẫn nhớ rõ về họ.
${facts.length || core ? `\n<about_user>\n${[...facts, core].filter(Boolean).join("\n")}\n</about_user>\n` : ""}${mem.length ? `\n<user_memory>\nNhững điều bạn nhớ từ các cuộc trò chuyện trước (cũ trước, mới sau):\n${mem.map((m) => `- ${m.content}`).join("\n")}\n</user_memory>\n` : ""}${ins ? `\n<user_preferences>\nNgười dùng tự giới thiệu về mình và dặn cách làm việc (nguyên văn):\n${ins}\n</user_preferences>\n` : ""}
<how_to_use>
- Nói chuyện như người đã biết rõ họ: gọi tên tự nhiên, nói đúng hoàn cảnh, mục tiêu và trình độ của họ. Đừng nói như đang đọc hồ sơ của một người lạ: không dùng những cụm như "theo thông tin", "trong phần cài đặt / hồ sơ / bộ nhớ / ghi chú", "mình thấy bạn có ghi", "có thể bạn là", "mình không nhận ra bạn trực tiếp".
- Khi họ hỏi bạn có biết họ là ai, hay nhớ gì về họ: trả lời tự tin và ấm áp, tóm gọn những điều chính như một người quen. Chỉ khi họ hỏi vì sao bạn biết thì mới nói thật là Synchro ghi nhớ từ phần họ tự giới thiệu và các cuộc trò chuyện.
- Làm theo cách họ muốn (ngôn ngữ, giọng điệu, độ dài, cách giải thích, cách xưng hô) trong mọi câu trả lời mà không cần nói là đang làm theo.
- Chỉ đưa chi tiết riêng của họ vào khi nó làm câu trả lời tốt hơn. Lời chào thì chào lại ngắn gọn bằng tên, không kể lại cả tiểu sử.
- Khi các thông tin khác nhau, tin điều cụ thể và mới hơn: phần họ tự giới thiệu và bộ nhớ gần đây đúng hơn lựa chọn lúc tạo tài khoản. Không chỉ ra sự khác nhau, không bảo họ sửa cài đặt; nếu điều đó thật sự ảnh hưởng tới câu trả lời thì hỏi lại tự nhiên.
- Không bịa thêm điều không có ở trên; chưa biết thì hỏi như một người quen muốn hiểu thêm. Người dùng yêu cầu khác ngay trong đoạn chat thì làm theo yêu cầu đó.
</how_to_use>
</user_context>`;
}

const EXTRACT = (sens: boolean) => `Bạn trích xuất bộ nhớ dài hạn về NGƯỜI DÙNG từ đoạn hội thoại mới nhất.
Chỉ giữ điều bền vững, hữu ích cho các cuộc trò chuyện sau: tên / cách xưng hô, nghề nghiệp, công việc và dự án đang làm, công cụ hay dùng, sở thích, cách muốn được trả lời (ngôn ngữ, độ dài, giọng văn), mục tiêu dài hạn.
Bỏ qua: yêu cầu một lần, chi tiết của riêng câu hỏi này, điều đã có trong bộ nhớ hiện có, suy đoán không chắc chắn${sens ? "" : ", và chủ đề nhạy cảm (sức khỏe, tôn giáo, chính trị, tài chính cá nhân, đời tư)"}.
Viết mỗi mục thành một câu ngắn ở ngôi thứ ba, cùng ngôn ngữ người dùng dùng (ví dụ "Thích câu trả lời ngắn gọn, đi thẳng vào ý chính.").
Trả về DUY NHẤT một mảng JSON các chuỗi (tối đa 3 mục), hoặc [] nếu không có gì đáng nhớ.`;

/** Rút bộ nhớ từ lượt vừa xong (chạy nền, không làm chậm câu trả lời) bằng model nhanh nhất đang dùng được: gói subscription
 *  hoặc khóa API như nhau (gói thì chạy một lượt ngắn của CLI chính chủ). */
export async function learnFromTurn(user: UserRow, question: string, answer: string) {
  const cfg = memCfg(user.id);
  if (!cfg.gen || question.trim().length < 8) return;
  const existing = listMemory(user.id).map((m) => `- ${m.content}`).join("\n") || "(trống)";
  const text = await quickCall(user, EXTRACT(cfg.sens), `Bộ nhớ hiện có:\n${existing}\n\nHội thoại mới nhất:\n[người dùng] ${question.slice(0, 4000)}\n[trợ lý] ${answer.slice(0, 3000)}`, { maxTokens: 400 }).then((r) => r.text).catch(() => "");
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (!json) return;
  try {
    const items = (JSON.parse(json) as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3);
    if (items.length) addMemory(user.id, items, "chat");
  } catch {}
}
