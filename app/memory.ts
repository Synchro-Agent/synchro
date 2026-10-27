// Bộ nhớ của từng người (Cài đặt → Bộ nhớ và nút "Bộ nhớ" ở khung soạn): những điều bền vững Synchro nên nhớ về người dùng
// (cách xưng hô, sở thích, công việc, dự án đang làm, cách muốn được trả lời). Lưu ở máy chủ, đưa vào mỗi lượt chat khi bật,
// và tự rút từ cuộc trò chuyện bằng model nhanh (bỏ chủ đề nhạy cảm trừ khi người dùng cho phép).
import crypto from "node:crypto";
import { db, getSetting, setSetting, type UserRow } from "./authstore";
import { quickCall } from "./ai/anymodel";

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

/** Khối bộ nhớ đưa vào lời nhắc hệ thống của lượt chat (rỗng nếu chưa có gì). */
/**
 * Hồ sơ và hướng dẫn người dùng tự viết ở Cài đặt → Tài khoản ("Hướng dẫn cho Synchro"): tầng tĩnh của mọi lượt chat,
 * Synchro Code và trò chuyện bằng giọng nói (gói subscription lẫn khóa API). Không áp dụng cho lời gọi nội bộ.
 */
export function profileBlock(u: Pick<UserRow, "full_name" | "nickname" | "occupation" | "instructions">): string {
  const call = (u.nickname || u.full_name || "").trim(), work = (u.occupation || "").trim(), ins = (u.instructions || "").trim();
  if (!call && !work && !ins) return "";
  return `<user_preferences>
Người dùng tự viết những điều này trong Cài đặt của Synchro để áp dụng ở mọi đoạn chat. Làm theo trong mọi câu trả lời, trừ khi người dùng yêu cầu khác ngay trong đoạn chat; không cần nói là đã đọc phần này.
${[call && `Tên người dùng muốn được gọi: ${call}`, work && `Công việc: ${work}`].filter(Boolean).join("\n")}${ins ? `${call || work ? "\n" : ""}Hướng dẫn của người dùng:\n${ins}` : ""}
</user_preferences>`;
}

export function memoryBlock(uid: string): string {
  const list = listMemory(uid);
  if (!list.length) return "";
  return `<user_memory>
Những điều đã biết về người dùng từ các cuộc trò chuyện trước (dùng khi liên quan, không nhắc lại nguyên văn nếu không cần):
${list.slice(-80).map((m) => `- ${m.content}`).join("\n")}
</user_memory>`;
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
