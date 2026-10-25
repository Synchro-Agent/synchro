// Điểm chất lượng skill (chỉ chạy ở máy chủ): nút 👍 / 👎 dưới câu trả lời ghi điểm cho các skill và thư viện đã dùng trong câu trả lời đó.
// Kho kỹ năng hiện điểm và gợi ý tắt skill hay bị chê. Mỗi người chấm mỗi câu trả lời một lần (chấm lại thì thay điểm cũ).
import { db } from "./authstore";

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS skill_votes (user_id TEXT NOT NULL, msg TEXT NOT NULL, skill TEXT NOT NULL, value INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, msg, skill));
      CREATE INDEX IF NOT EXISTS skill_votes_skill ON skill_votes(skill)`);
    ready = true;
  }
  return d;
}

/** Ghi điểm: value 1 (hữu ích), -1 (không hữu ích), 0 (bỏ chấm). */
export function vote(uid: string, msg: string, skills: string[], value: number) {
  const d = init();
  const names = [...new Set(skills.filter((s) => typeof s === "string" && /^[\w.:-]{1,80}$/.test(s)))].slice(0, 20);
  const key = msg.slice(0, 120);
  d.transaction(() => {
    d.prepare("DELETE FROM skill_votes WHERE user_id = ? AND msg = ?").run(uid, key);
    if (value === 1 || value === -1) { const ins = d.prepare("INSERT INTO skill_votes (user_id, msg, skill, value, at) VALUES (?, ?, ?, ?, ?)"); for (const n of names) ins.run(uid, key, n, value, Date.now()); }
  })();
  return names.length;
}

export type Score = { up: number; down: number; low: boolean };
/** Điểm của mọi skill (cả tổ chức chấm). low: từ 3 lượt chê và chê chiếm 60% trở lên. */
export function scores(): Record<string, Score> {
  const rows = init().prepare("SELECT skill, SUM(value = 1) AS up, SUM(value = -1) AS down FROM skill_votes GROUP BY skill").all() as { skill: string; up: number; down: number }[];
  return Object.fromEntries(rows.map((r) => [r.skill, { up: r.up, down: r.down, low: r.down >= 3 && r.down / (r.up + r.down) >= 0.6 }]));
}
export function removeUserVotes(uid: string) { init().prepare("DELETE FROM skill_votes WHERE user_id = ?").run(uid); }
