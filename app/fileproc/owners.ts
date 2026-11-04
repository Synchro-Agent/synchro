// Chủ của tệp tải lên: mã tệp là băm nội dung (cùng nội dung thì cùng một tệp trên đĩa), ai biết mã cũng từng mở được tệp.
// Mỗi người tải lên thành một chủ; chỉ chủ mới đọc được tệp; người chủ cuối cùng rời đi (xóa tài khoản) thì xóa tệp khỏi đĩa.
import { rm } from "node:fs/promises";
import path from "node:path";
import { AuthError, db } from "../authstore";

const DIR = path.join(process.cwd(), ".cache", "files");
// Hạn mức tệp tải lên của mỗi tài khoản: một người không lấp đầy đĩa của mọi người (tệp đã giới hạn 30 MB mỗi tệp, số tệp thì chưa).
const QUOTA_MB = () => Number(process.env.SYNCHRO_UPLOAD_QUOTA_MB) || 2000;

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS file_owners (file_id TEXT NOT NULL, user_id TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (file_id, user_id));
      CREATE INDEX IF NOT EXISTS file_owners_user ON file_owners(user_id)`);
    ready = true;
  }
  return d;
}

export function claimFile(uid: string, id: string, size: number) {
  table().prepare("INSERT INTO file_owners (file_id, user_id, size, at) VALUES (?, ?, ?, ?) ON CONFLICT(file_id, user_id) DO UPDATE SET at = excluded.at, size = excluded.size").run(id, uid, size, Date.now());
}

/** Tài khoản này được đọc tệp không. Tệp có từ trước khi có bảng này chưa có chủ: người đầu tiên dùng tới (phải biết đúng băm nội dung) thành chủ. */
export function mayUse(uid: string, id: string) {
  const owners = table().prepare("SELECT user_id FROM file_owners WHERE file_id = ?").all(id) as { user_id: string }[];
  if (owners.some((o) => o.user_id === uid)) return true;
  if (owners.length) return false;
  claimFile(uid, id, 0);
  return true;
}

export function uploadedBytes(uid: string) {
  return (table().prepare("SELECT COALESCE(SUM(size), 0) AS n FROM file_owners WHERE user_id = ?").get(uid) as { n: number }).n;
}

/** Trước khi nhận tệp mới: chặn khi vượt hạn mức (tính cả tệp này). */
export function checkQuota(uid: string, size: number) {
  if (uploadedBytes(uid) + size > QUOTA_MB() * 1048576) throw new AuthError(`Bạn đã dùng hết ${QUOTA_MB()} MB dung lượng tệp tải lên.`, 413);
}

/** Xóa tài khoản: bỏ quyền chủ của người này; tệp không còn ai là chủ thì xóa khỏi đĩa. Tệp người khác vẫn đang dùng giữ nguyên. */
export async function releaseUserFiles(uid: string) {
  const d = table();
  const ids = (d.prepare("SELECT file_id FROM file_owners WHERE user_id = ?").all(uid) as { file_id: string }[]).map((r) => r.file_id);
  d.prepare("DELETE FROM file_owners WHERE user_id = ?").run(uid);
  const left = d.prepare("SELECT 1 FROM file_owners WHERE file_id = ? LIMIT 1");
  for (const id of ids) {
    if (!/^[a-f0-9]{40}$/.test(id) || left.get(id)) continue;
    await Promise.all([".bin", ".json"].map((x) => rm(path.join(DIR, id + x), { force: true })));
  }
}
