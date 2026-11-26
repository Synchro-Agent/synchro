// Cộng tác trên ứng dụng nội bộ (chỉ chạy ở máy chủ): bình luận có @nhắc tên (người được nhắc nhận thông báo trong
// Autopilot), và kênh trực tiếp: ai đang mở ứng dụng, dữ liệu chung vừa đổi, bình luận mới — mọi người đang mở thấy
// ngay, không cần tải lại.
import "server-only";
import crypto from "node:crypto";
import { db, getUser, type UserRow } from "./authstore";
import { appPeople, AppError, getApp, noteVisit } from "./appstore";
import { addNotice } from "./tasks";
import { enter, publish, type LiveEvent } from "./live";

const fail = (m: string, status = 400): never => { throw new AppError(m, status); };
// Bảng app_comments: db/migrations/001_baseline.sql (bộ chạy migration tạo khi mở cơ sở dữ liệu).
function init() {
  return db();
}
const nameOf = (u?: Pick<UserRow, "name" | "email" | "full_name" | "nickname"> | null) => (u ? u.nickname || u.full_name || u.name || u.email.split("@")[0] : "");

/** Vào phòng trực tiếp của ứng dụng; trả về hàm rời phòng. */
export function join(u: UserRow, app: string, send: (e: LiveEvent) => void) {
  seeApp(u, app);
  noteVisit(u.id, app);
  return enter(app, u.id, nameOf(u), send);
}

// ---------------------------------------------------------------- bình luận
export type PublicComment = { id: string; app: string; user: { id: string; name: string }; body: string; mentions: { id: string; name: string }[]; resolved: boolean; at: number; mine: boolean; canEdit: boolean };
type Row = { id: string; app: string; user_id: string; body: string; mentions: string; resolved: number; created_at: number };
function pub(r: Row, uid: string, appOwner: boolean): PublicComment {
  const ids: string[] = JSON.parse(r.mentions || "[]");
  return { id: r.id, app: r.app, user: { id: r.user_id, name: nameOf(getUser(r.user_id)) || "?" }, body: r.body, mentions: ids.map((id) => ({ id, name: nameOf(getUser(id)) })).filter((m) => m.name),
    resolved: !!r.resolved, at: r.created_at, mine: r.user_id === uid, canEdit: r.user_id === uid || appOwner };
}
const seeApp = (u: UserRow, app: string) => getApp(u.id, app) ?? fail("Không tìm thấy ứng dụng hoặc bạn không có quyền dùng.", 404);
export const checkApp = (u: UserRow, app: string) => { seeApp(u, app); };

export function listComments(u: UserRow, app: string) {
  const a = seeApp(u, app);
  return (init().prepare("SELECT * FROM app_comments WHERE app = ? ORDER BY created_at LIMIT 500").all(app) as Row[]).map((r) => pub(r, u.id, a.mine));
}

const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
/** Người có thể nhắc tên: chủ ứng dụng và những người đã mở / bình luận ứng dụng này (ứng dụng riêng thì chỉ chủ). Không bao giờ là toàn bộ người dùng
 *  và không trả email: đăng ký đang mở, người lạ không được dò danh sách thành viên qua ô @nhắc.
 *  Tìm không cần dấu; tên bắt đầu bằng chữ đã gõ xếp trước, rồi tên chứa chữ đó. */
export function mentionable(u: UserRow, app: string, q: string) {
  seeApp(u, app);
  const f = fold(q.trim()).slice(0, 60);
  const rows = appPeople(app).filter((id) => id !== u.id).map((id) => getUser(id)).filter((r): r is UserRow => r?.status === "active" && !!getApp(r.id, app));
  const score = (r: UserRow) => {
    if (!f) return 1;
    const n = fold(nameOf(r));
    if (n.startsWith(f) || n.split(/\s+/).some((w) => w.startsWith(f))) return 3;
    return n.includes(f) ? 2 : 0;
  };
  return rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 8).map(({ r }) => ({ id: r.id, name: nameOf(r) }));
}

export function addComment(u: UserRow, app: string, body: unknown, mentions: unknown) {
  const a = seeApp(u, app);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) fail("Bình luận đang trống.");
  if (text.length > 4000) fail("Bình luận tối đa 4.000 ký tự.");
  const d = init();
  if ((d.prepare("SELECT COUNT(*) AS n FROM app_comments WHERE app = ?").get(app) as { n: number }).n >= 2000) fail("Ứng dụng đã có quá nhiều bình luận.");
  // Chỉ giữ người đã tham gia ứng dụng và thật sự xem được nó: không gửi được thông báo cho một người lạ bất kỳ trên Synchro.
  noteVisit(u.id, app);
  const people = new Set(appPeople(app));
  const ids = [...new Set((Array.isArray(mentions) ? mentions : []).filter((x): x is string => typeof x === "string"))].slice(0, 20)
    .filter((id) => id !== u.id && people.has(id) && getUser(id)?.status === "active" && !!getApp(id, app));
  const row: Row = { id: "cmt_" + crypto.randomBytes(8).toString("base64url"), app, user_id: u.id, body: text, mentions: JSON.stringify(ids), resolved: 0, created_at: Date.now() };
  d.prepare("INSERT INTO app_comments (id, app, user_id, body, mentions, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.id, row.app, row.user_id, row.body, row.mentions, 0, row.created_at);
  const who = nameOf(u), link = `app:${app}`;
  for (const id of ids) addNotice(id, `${who} nhắc bạn trong ${a.title}`, text, link);
  // Chủ ứng dụng biết có bình luận mới (trừ khi chính họ viết hoặc đã được nhắc).
  const owner = a.mine ? u.id : (d.prepare("SELECT owner FROM apps WHERE id = ?").get(app) as { owner: string } | undefined)?.owner;
  if (owner && owner !== u.id && !ids.includes(owner)) addNotice(owner, `${who} bình luận trong ${a.title}`, text, link);
  publish(app, { type: "comment", comment: pub(row, "", false) });
  return pub(row, u.id, a.mine);
}

export function updateComment(u: UserRow, id: string, patch: { resolved?: unknown; delete?: boolean }) {
  const d = init();
  const r = d.prepare("SELECT * FROM app_comments WHERE id = ?").get(id) as Row | undefined;
  if (!r) fail("Không tìm thấy bình luận.", 404);
  const a = seeApp(u, r!.app);
  if (r!.user_id !== u.id && !a.mine) fail("Chỉ người viết hoặc chủ ứng dụng sửa được bình luận này.", 403);
  if (patch.delete) { d.prepare("DELETE FROM app_comments WHERE id = ?").run(id); publish(r!.app, { type: "comment-update", id, deleted: true }); return null; }
  const resolved = patch.resolved === true;
  d.prepare("UPDATE app_comments SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, id);
  publish(r!.app, { type: "comment-update", id, resolved });
  return pub({ ...r!, resolved: resolved ? 1 : 0 }, u.id, a.mine);
}

export function removeUserComments(uid: string) { init().prepare("DELETE FROM app_comments WHERE user_id = ?").run(uid); }
export function removeAppComments(app: string) { init().prepare("DELETE FROM app_comments WHERE app = ?").run(app); }
