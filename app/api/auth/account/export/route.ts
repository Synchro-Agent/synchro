import { handle, limit, publicUser, requireUser, type UserRow } from "../../../../authstore";
import { listArtifacts, getArtifact } from "../../../../artifactstore";
import { allNotes } from "../../../../brain";
import { changesSince } from "../../../../chatstore";
import { listConnectors } from "../../../../connectors";
import { myFiles } from "../../../../fileproc/owners";
import { listShares } from "../../../../sharestore";
import { listTasks } from "../../../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = new TextEncoder();
const tick = () => new Promise((ok) => setImmediate(ok));

// Tải về mọi thứ máy chủ giữ theo tài khoản, không phụ thuộc trình duyệt đang dùng (đổi máy, mất dữ liệu trình duyệt): một tệp JSON viết dần, đoạn chat đọc theo từng trang để
// tài khoản lớn không làm đầy bộ nhớ hay chặn người khác. Không có khóa, token, mật khẩu băm. Tệp đã tải lên chỉ liệt kê (tải từng tệp ở Cài đặt → Quyền riêng tư).
async function* sections(u: UserRow): AsyncGenerator<string> {
  yield `{\n"exportedAt": ${JSON.stringify(new Date().toISOString())},\n"profile": ${JSON.stringify({ ...publicUser(u), avatar: u.avatar || null })}`;
  for (const kind of ["chat", "project"] as const) {
    yield `,\n"${kind}s": [`;
    let since = 0, first = true;
    for (;;) {
      const page = changesSince(u.id, since);
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
  const plain: [string, () => unknown][] = [
    ["brainNotes", () => allNotes(u.id)], ["tasks", () => listTasks(u.id)], ["shares", () => listShares(u.id)],
    ["connectors", () => listConnectors(u.id).map((c) => ({ id: c.id, name: c.name, url: c.url }))], ["uploadedFiles", () => myFiles(u.id).files],
  ];
  for (const [k, f] of plain) {
    let v: unknown = null;
    try { v = f(); } catch (e) { console.error("[export]", k, e); }
    yield `,\n${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    await tick();
  }
  yield "\n}\n";
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
