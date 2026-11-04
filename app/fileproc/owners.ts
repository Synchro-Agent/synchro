// Chủ của tệp tải lên: mã tệp là băm nội dung (cùng nội dung thì cùng một tệp trên đĩa), ai biết mã cũng từng mở được tệp.
// Mỗi người tải lên thành một chủ; chỉ chủ mới đọc được tệp; người chủ cuối cùng rời đi (tự xóa tệp, xóa đoạn chat dùng nó, xóa tài khoản) thì xóa tệp khỏi đĩa.
import { existsSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { AuthError, db } from "../authstore";
import { diskLow } from "../diskfloor";

const DIR = path.join(process.cwd(), ".cache", "files");
// Hạn mức tệp tải lên của mỗi tài khoản: một người không lấp đầy đĩa của mọi người (tệp đã giới hạn 30 MB mỗi tệp, số tệp thì chưa).
const QUOTA_MB = () => Number(process.env.SYNCHRO_UPLOAD_QUOTA_MB) || 2000;

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS file_owners (file_id TEXT NOT NULL, user_id TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (file_id, user_id));
      CREATE INDEX IF NOT EXISTS file_owners_user ON file_owners(user_id)`);
    // Tên do chính người này đặt: cùng nội dung có thể mang tên khác ở người khác. Dòng cũ chưa có tên thì đọc khi cần.
    if (!(d.prepare("PRAGMA table_info(file_owners)").all() as { name: string }[]).some((c) => c.name === "name")) d.exec("ALTER TABLE file_owners ADD COLUMN name TEXT");
    ready = true;
  }
  return d;
}

export function claimFile(uid: string, id: string, size: number, name?: string) {
  table().prepare("INSERT INTO file_owners (file_id, user_id, size, at, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(file_id, user_id) DO UPDATE SET at = excluded.at, size = excluded.size, name = COALESCE(excluded.name, name)").run(id, uid, size, Date.now(), name?.slice(0, 300) ?? null);
}

/** Tài khoản này được đọc tệp không. Tệp có từ trước khi có bảng này chưa có chủ: người đầu tiên dùng tới (phải biết đúng băm nội dung) thành chủ. */
export function mayUse(uid: string, id: string) {
  const owners = table().prepare("SELECT user_id FROM file_owners WHERE file_id = ?").all(id) as { user_id: string }[];
  if (owners.some((o) => o.user_id === uid)) return true;
  if (owners.length) return false;
  // Tệp đã bị xóa hẳn: không nhận làm chủ, nếu không thì người biết mã băm sẽ đọc được khi có người tải lại đúng tệp đó.
  if (!existsSync(path.join(DIR, id + ".json"))) return false;
  claimFile(uid, id, 0);
  return true;
}

export function uploadedBytes(uid: string) {
  return (table().prepare("SELECT COALESCE(SUM(size), 0) AS n FROM file_owners WHERE user_id = ?").get(uid) as { n: number }).n;
}

/** Trước khi nhận tệp mới: chặn khi vượt hạn mức (tính cả tệp này). */
export function checkQuota(uid: string, size: number) {
  if (diskLow(process.cwd())) throw new AuthError("Máy chủ sắp hết dung lượng nên tạm thời chưa nhận tệp mới. Hãy thử lại sau.", 507);
  if (uploadedBytes(uid) + size > QUOTA()) throw new AuthError(`Bạn đã dùng hết ${QUOTA_MB()} MB dung lượng tệp tải lên. Xóa bớt tệp cũ ở Cài đặt → Quyền riêng tư.`, 413);
}

const QUOTA = () => QUOTA_MB() * 1048576;
export type MyFile = { id: string; name: string; size: number; at: number; kind: string };
/** Cài đặt → Quyền riêng tư → Tệp đã tải lên. Tệp không còn trên đĩa thì không liệt kê; dung lượng lấy từ đĩa cho dòng cũ chưa ghi kích thước. */
export function myFiles(uid: string): { files: MyFile[]; used: number; quota: number } {
  const d = table();
  const rows = d.prepare("SELECT file_id, size, at, name FROM file_owners WHERE user_id = ? ORDER BY at DESC LIMIT 2000").all(uid) as { file_id: string; size: number; at: number; name: string | null }[];
  const others = d.prepare("SELECT 1 FROM file_owners WHERE file_id = ? AND user_id != ? LIMIT 1");
  const files = rows.flatMap((r): MyFile[] => {
    if (!/^[a-f0-9]{40}$/.test(r.file_id)) return [];
    let rec: { name?: string; kind?: string };
    try { rec = JSON.parse(readFileSync(path.join(DIR, r.file_id + ".json"), "utf8")); } catch { return []; }
    let size = r.size;
    if (!size) try { size = statSync(path.join(DIR, r.file_id + ".bin")).size; } catch { /* chỉ còn phần chữ */ }
    // Dòng cũ không có tên riêng: tên trong tệp có thể do người khác đặt, chỉ dùng khi mình là chủ duy nhất.
    return [{ id: r.file_id, name: r.name ?? (others.get(r.file_id, uid) ? "" : rec.name ?? ""), size, at: r.at, kind: rec.kind ?? "" }];
  });
  return { files, used: uploadedBytes(uid), quota: QUOTA() };
}

/** Tệp gốc để chủ tải về. Chỉ tệp người này đang là chủ. */
export function fileBin(uid: string, id: string): { path: string; name: string } | null {
  if (!/^[a-f0-9]{40}$/.test(id)) return null;
  const r = table().prepare("SELECT name FROM file_owners WHERE file_id = ? AND user_id = ?").get(id, uid) as { name: string | null } | undefined;
  const p = path.join(DIR, id + ".bin");
  return r && existsSync(p) ? { path: p, name: r.name ?? "" } : null;
}

/** Bỏ một tệp khỏi tài khoản: mất quyền đọc ngay; không còn ai là chủ thì xóa khỏi đĩa. Trả về false nếu không phải tệp của người này. */
export async function releaseFile(uid: string, id: string) {
  if (!/^[a-f0-9]{40}$/.test(id)) return false;
  const d = table();
  if (!d.prepare("DELETE FROM file_owners WHERE file_id = ? AND user_id = ?").run(id, uid).changes) return false;
  if (!d.prepare("SELECT 1 FROM file_owners WHERE file_id = ? LIMIT 1").get(id)) await Promise.all([".bin", ".json"].map((x) => rm(path.join(DIR, id + x), { force: true })));
  return true;
}

async function dropOrphans(ids: string[]) {
  const left = table().prepare("SELECT 1 FROM file_owners WHERE file_id = ? LIMIT 1");
  for (const id of ids) {
    if (!/^[a-f0-9]{40}$/.test(id) || left.get(id)) continue;
    await Promise.all([".bin", ".json"].map((x) => rm(path.join(DIR, id + x), { force: true })));
  }
}
/** Xóa tài khoản: bỏ quyền chủ của người này; tệp không còn ai là chủ thì xóa khỏi đĩa. Tệp người khác vẫn đang dùng giữ nguyên. */
export async function releaseUserFiles(uid: string) {
  const d = table();
  const ids = (d.prepare("SELECT file_id FROM file_owners WHERE user_id = ?").all(uid) as { file_id: string }[]).map((r) => r.file_id);
  d.prepare("DELETE FROM file_owners WHERE user_id = ?").run(uid);
  await dropOrphans(ids);
}
