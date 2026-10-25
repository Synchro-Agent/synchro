// Lượt chạy bền (chỉ chạy ở máy chủ): mỗi câu trả lời của chat là một "run" lưu trong SQLite, chạy ở nền,
// không phụ thuộc kết nối của trình duyệt. Trình duyệt theo dõi tiến độ qua /api/runs/<id> (SSE, nối lại được),
// tải lại trang hay đổi máy vẫn nhận đủ kết quả. Máy chủ khởi động lại giữa chừng thì lượt đó được chạy lại từ đầu.
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getUser, type UserRow } from "./authstore";

export type RunEvent = { seq: number; at: number; kind: "step" | "tool" | "note"; text: string };
export type RunStatus = "running" | "done" | "error";
type Row = { id: string; user_id: string; conv: string | null; kind: string; status: RunStatus; req: string | null; result: string | null; http: number | null; events: string; created_at: number; updated_at: number; attempts: number };
export type PublicRun = { id: string; status: RunStatus; conv: string | null; kind: string; events: RunEvent[]; result: unknown; http: number | null; createdAt: number; updatedAt: number };

// Một lượt chạy giữ tối đa 3 lần chạy lại sau sự cố máy chủ; kết quả giữ 7 ngày rồi dọn.
const MAX_ATTEMPTS = 3;
const KEEP_MS = 7 * 24 * 3600_000;
const REQ_MAX = 8 * 1024 * 1024;

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT, kind TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL, req TEXT, result TEXT, http INTEGER, events TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1)`);
    d.exec("CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at)");
    d.exec("CREATE INDEX IF NOT EXISTS runs_status ON runs(status)");
    d.prepare("DELETE FROM runs WHERE updated_at < ?").run(Date.now() - KEEP_MS);
    ready = true;
  }
  return d;
}

// Người đang theo dõi từng lượt (các kết nối SSE); toàn cục để sống qua lần nạp lại module khi phát triển.
const g = globalThis as unknown as { __synchroRunSubs?: Map<string, Set<(e: { event?: RunEvent; done?: PublicRun }) => void>> };
const subs = (g.__synchroRunSubs ??= new Map());
const notify = (id: string, m: { event?: RunEvent; done?: PublicRun }) => { for (const f of subs.get(id) ?? []) try { f(m); } catch {} };
export function watch(id: string, f: (m: { event?: RunEvent; done?: PublicRun }) => void) {
  const s = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
  s.add(f);
  return () => { s.delete(f); if (!s.size) subs.delete(id); };
}

const pub = (r: Row): PublicRun => ({ id: r.id, status: r.status, conv: r.conv, kind: r.kind, events: JSON.parse(r.events), result: r.result ? JSON.parse(r.result) : null, http: r.http, createdAt: r.created_at, updatedAt: r.updated_at });
export function getRun(id: string, uid?: string): PublicRun | null {
  const r = init().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  return r && (!uid || r.user_id === uid) ? pub(r) : null;
}
export const listRuns = (uid: string, limit = 50) => (init().prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(uid, limit) as Row[]).map(pub);

// Tiến độ của lượt đang chạy: toolLoop gọi progress(...) mà không cần truyền id đi khắp nơi.
const scope = new AsyncLocalStorage<{ id: string }>();
export function progress(kind: RunEvent["kind"], text: string) {
  const s = scope.getStore();
  if (!s) return;
  const d = init();
  const r = d.prepare("SELECT events FROM runs WHERE id = ?").get(s.id) as { events: string } | undefined;
  if (!r) return;
  const list = JSON.parse(r.events) as RunEvent[];
  const ev: RunEvent = { seq: list.length + 1, at: Date.now(), kind, text: text.slice(0, 300) };
  list.push(ev);
  d.prepare("UPDATE runs SET events = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(list.slice(-200)), Date.now(), s.id);
  notify(s.id, { event: ev });
}

export type Exec = (body: Record<string, unknown>, user: UserRow) => Promise<{ http: number; json: unknown }>;
// Toàn cục: mỗi route của Next được đóng gói riêng, bộ chạy đăng ký ở gói này phải thấy được ở gói khác.
const ge = globalThis as unknown as { __synchroExecs?: Map<string, Exec> };
const executors = (ge.__synchroExecs ??= new Map<string, Exec>());
// Mỗi loại lượt (chat, tác vụ nền…) đăng ký hàm chạy của nó; lúc khởi động lại máy chủ dùng để chạy lại lượt dở dang.
export const registerExec = (kind: string, f: Exec) => { executors.set(kind, f); };

// Máy chủ đang tắt (deploy, khởi động lại): lỗi mạng lúc này là do tắt máy, không phải lỗi thật. Giữ lượt ở "đang chạy"
// để lần khởi động sau chạy lại, thay vì ghi một kết quả lỗi.
const gs = globalThis as unknown as { __synchroStopping?: boolean; __synchroStopHook?: boolean };
if (!gs.__synchroStopHook) {
  gs.__synchroStopHook = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { gs.__synchroStopping = true; });
}

function finish(id: string, http: number, json: unknown) {
  if (gs.__synchroStopping && http >= 500) return;
  const status: RunStatus = http >= 200 && http < 300 ? "done" : "error";
  // Lượt xong thì bỏ nội dung yêu cầu (có thể chứa ảnh, tệp) cho nhẹ cơ sở dữ liệu.
  init().prepare("UPDATE runs SET status = ?, http = ?, result = ?, req = NULL, updated_at = ? WHERE id = ?").run(status, http, JSON.stringify(json), Date.now(), id);
  const r = getRun(id);
  if (r) notify(id, { done: r });
}

function launch(id: string, kind: string, body: Record<string, unknown>, user: UserRow) {
  scope.run({ id }, () => {
    (async () => {
      // Gói này chưa nạp bộ xử lý chat (ví dụ route "Chạy ngay" của tác vụ nền): nạp rồi mới chạy.
      if (!executors.has(kind) && kind === "chat") await import("./chatengine");
      const f = executors.get(kind);
      if (!f) return { http: 500, json: { error: `Không có bộ chạy cho loại "${kind}".` } };
      return f(body, user);
    })().then((r) => finish(id, r.http, r.json), (e) => finish(id, 502, { error: String((e as Error)?.message ?? e) }));
  });
}

/** Tạo lượt mới và chạy ngay ở nền; trả về id để trình duyệt theo dõi. */
export function startRun(user: UserRow, kind: string, body: Record<string, unknown>, conv?: string | null): string {
  const id = "run_" + crypto.randomBytes(12).toString("base64url");
  const raw = JSON.stringify(body);
  const now = Date.now();
  init().prepare("INSERT INTO runs (id, user_id, conv, kind, status, req, events, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, '[]', ?, ?)")
    .run(id, user.id, conv ?? null, kind, raw.length <= REQ_MAX ? raw : null, now, now);
  launch(id, kind, body, user);
  return id;
}

/** Gọi một lần lúc máy chủ khởi động: lượt đang chạy dở khi máy chủ tắt được chạy lại (tối đa MAX_ATTEMPTS lần). */
export function resumeInterrupted() {
  const d = init();
  const rows = d.prepare("SELECT * FROM runs WHERE status = 'running'").all() as Row[];
  for (const r of rows) {
    const user = getUser(r.user_id);
    if (!r.req || !user || r.attempts >= MAX_ATTEMPTS) { finish(r.id, 503, { error: "Lượt trả lời bị gián đoạn khi máy chủ khởi động lại. Hãy gửi lại tin nhắn." }); continue; }
    d.prepare("UPDATE runs SET attempts = attempts + 1, updated_at = ? WHERE id = ?").run(Date.now(), r.id);
    scope.run({ id: r.id }, () => progress("note", "Máy chủ vừa khởi động lại, Synchro đang chạy lại lượt này"));
    launch(r.id, r.kind, JSON.parse(r.req), user);
  }
  return rows.length;
}
