import { db, handle, limit, publicUser, requireUser, type UserRow } from "../../../../../server/authstore";
import { listArtifacts, getArtifact } from "../../../../../server/artifactstore";
import { allNotes } from "../../../../../server/brain";
import { changesSince } from "../../../../../server/chatstore";
import { getSession, listSessions } from "../../../../../server/codestore";
import { listConnectors } from "../../../../../server/connectors";
import { myFiles } from "../../../../../server/fileproc/owners";
import { listMemory } from "../../../../../server/memory";
import { listShares } from "../../../../../server/sharestore";
import { listSkills } from "../../../../../server/skillstore";
import { listTasks } from "../../../../../server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = new TextEncoder();
const tick = () => new Promise((ok) => setImmediate(ok));

// Bảng có thể chưa tồn tại (tính năng người này chưa dùng lần nào): khi đó không có gì để xuất.
const rows = (sql: string, ...args: unknown[]) => { try { return db().prepare(sql).all(...args); } catch { return []; } };
// Những gì không nằm trong tệp: trang quyền riêng tư cũng ghi đúng danh sách này.
const LEFT_OUT = ["Mật khẩu băm, khóa và token kết nối", "Nội dung tệp tải lên, tệp tạo ra và âm thanh (tệp này chỉ liệt kê; tải từng tệp ở Cài đặt → Quyền riêng tư)", "Tệp trong workspace Synchro Code", "Mức dùng chi tiết từng lượt, nhật ký bảo mật", "Lượt trả lời đang chạy hoặc vừa xong (đã nằm trong đoạn chat khi xong)"];

// Tải về mọi thứ máy chủ giữ theo tài khoản, không phụ thuộc trình duyệt đang dùng (đổi máy, mất dữ liệu trình duyệt): một tệp JSON viết dần, đoạn chat đọc theo từng trang để
// tài khoản lớn không làm đầy bộ nhớ hay chặn người khác. Không có khóa, token, mật khẩu băm. Tệp đã tải lên chỉ liệt kê (tải từng tệp ở Cài đặt → Quyền riêng tư).
async function* sections(u: UserRow): AsyncGenerator<string> {
  yield `{\n"exportedAt": ${JSON.stringify(new Date().toISOString())},\n"profile": ${JSON.stringify({ ...publicUser(u), avatar: u.avatar || null })}`;
  for (const kind of ["chat", "project"] as const) {
    yield `,\n"${kind}s": [`;
    let since = 0, first = true;
    for (;;) {
      const page = await changesSince(u.id, since);
      for (const r of page.items) {
        if (r.kind !== kind || r.deleted || !r.data) continue;
        yield `${first ? "" : ",\n"}${r.data}`;
        first = false;
      }
      if (!page.more || page.next === since) break;
      since = page.next;
      await tick();
    }
    yield "]";
  }
  yield ',\n"artifacts": [';
  let first = true;
  for (const a of listArtifacts(u.id)) {
    const full = getArtifact(u.id, a.id);
    if (!full) continue;
    yield `${first ? "" : ",\n"}${JSON.stringify(full)}`;
    first = false;
    await tick();
  }
  yield "]";
  yield ',\n"codeSessions": [';
  first = true;
  for (const s of listSessions(u.id)) {
    const full = getSession(u.id, s.id);
    if (!full) continue;
    yield `${first ? "" : ",\n"}${JSON.stringify(full)}`;
    first = false;
    await tick();
  }
  yield "]";
  const skills = await listSkills(u.id).catch(() => []);
  const plain: [string, () => unknown][] = [
    ["memory", () => listMemory(u.id)], ["instructionsHistory", () => rows("SELECT at, source, text FROM instructions_history WHERE user_id = ? ORDER BY at", u.id)],
    ["apps", () => rows("SELECT id, title, type, content, visibility, conv, ident, created_at, updated_at FROM apps WHERE owner = ?", u.id)],
    ["appData", () => rows("SELECT ref, key, value, updated_at FROM app_data WHERE owner = ? OR ref LIKE ?", u.id, `art:${u.id}:%`)],
    ["appComments", () => rows("SELECT app, body, created_at FROM app_comments WHERE user_id = ?", u.id)],
    ["skills", () => skills], ["plugins", () => rows("SELECT id, slug, catalog_id, name, description, author, homepage, enabled, created_at, updated_at FROM plugins WHERE owner = ?", u.id)],
    ["autopilot", () => rows("SELECT task_id, title, at, kind, note, result FROM task_runs WHERE owner = ? ORDER BY at", u.id)],
    ["generatedFiles", () => rows("SELECT * FROM outputs WHERE user_id = ?", u.id)], ["speechItems", () => rows("SELECT id, kind, title, mime, size, created_at FROM speech_items WHERE user_id = ?", u.id)],
    ["brainNotes", () => allNotes(u.id)], ["tasks", () => listTasks(u.id)], ["shares", () => listShares(u.id)],
    ["connectors", () => listConnectors(u.id).map((c) => ({ id: c.id, name: c.name, url: c.url }))], ["uploadedFiles", () => myFiles(u.id).files],
  ];
  for (const [k, f] of plain) {
    let v: unknown = null;
    try { v = f(); } catch (e) { console.error("[export]", k, e); }
    yield `,\n${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    await tick();
  }
  yield `,\n"notIncluded": ${JSON.stringify(LEFT_OUT)}\n}\n`;
}

export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  limit("account-export:" + user.id, 5, 60 * 60_000);
  const it = sections(user);
  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try { const n = await it.next(); if (n.done) ctl.close(); else ctl.enqueue(enc.encode(n.value)); }
      catch (e) { console.error("[export]", e); ctl.error(e); }
    },
    cancel() { void it.return(undefined); },
  });
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="synchro-du-lieu-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
