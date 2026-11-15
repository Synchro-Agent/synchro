// Synchro Code ở máy chủ: cài đặt của từng người (dùng được ở mọi thiết bị và cho việc chạy nền), phiên Code đồng bộ giữa các thiết bị,
// và pull request Synchro theo dõi để tự sửa (CI lỗi, góp ý review) và tự lưu trữ phiên khi PR được gộp / đóng.
import "server-only";
import { db, getUser, needDisk } from "./authstore";
import { fitSession, mergeData, type CodeNode } from "../shared/codemerge";

// Kiểu dùng chung với phía bên kia: shared/types/code.ts.
import type { PermMode, CookieMode, CodePrefs } from "../shared/types/code";
export type { PermMode, CookieMode, CodePrefs } from "../shared/types/code";
export const PREF_DEFAULTS: CodePrefs = {
  classify: true, sync: true, allowBypass: true, permMode: "auto", suggest: true, archiveAfter: 0, style: "default",
  cookies: "keep", siteAsk: false, sites: [], blocked: [], branchPrefix: "synchro", autoPr: false, autoFix: false, autoArchivePr: false,
};
export const ARCHIVE_DAYS = [0, 1, 3, 7, 30];

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    // Bảng code_prefs, code_sessions, code_prs: db/migrations/001_baseline.sql.
    // Máy chủ khởi động lại giữa chừng: lượt chạy và việc tự sửa đang dở coi như đã dừng.
    d.exec("UPDATE code_sessions SET running = 0 WHERE running = 1");
    d.exec("UPDATE code_prs SET busy = 0 WHERE busy = 1");
    ready = true;
  }
  return d;
}

// ------------------------------------------------------------------ cài đặt
const host = (s: unknown) => {
  const t = String(s ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^\*\./, "");
  return /^[a-z0-9.-]{1,253}$/.test(t) && t.includes(".") || t === "localhost" ? t : "";
};
const hostList = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[\s,]+/)).map(host).filter(Boolean))].slice(0, 300);
const okPrefix = (s: unknown) => String(s ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 40);

/** Gộp và kiểm tra các trường hợp lệ (bỏ trường lạ, giữ giá trị cũ khi giá trị mới sai). */
export function cleanPrefs(cur: CodePrefs, p: Record<string, unknown>): CodePrefs {
  const o = { ...cur };
  for (const k of ["classify", "sync", "allowBypass", "suggest", "siteAsk", "autoPr", "autoFix", "autoArchivePr"] as const) if (typeof p[k] === "boolean") o[k] = p[k] as boolean;
  if (p.permMode === "ask" || p.permMode === "edits" || p.permMode === "auto") o.permMode = p.permMode;
  if (ARCHIVE_DAYS.includes(Number(p.archiveAfter))) o.archiveAfter = Number(p.archiveAfter);
  if (p.style === "default" || p.style === "explain" || p.style === "learn") o.style = p.style;
  if (p.cookies === "keep" || p.cookies === "until-stop" || p.cookies === "session") o.cookies = p.cookies;
  if (p.sites !== undefined) o.sites = hostList(p.sites);
  if (p.blocked !== undefined) o.blocked = hostList(p.blocked);
  if (p.branchPrefix !== undefined) o.branchPrefix = okPrefix(p.branchPrefix);
  // Tắt "cho phép chế độ Tự động" thì phiên mới không được mặc định là Tự động.
  if (!o.allowBypass && o.permMode === "auto") o.permMode = "edits";
  return o;
}
export function getPrefs(uid: string): CodePrefs {
  const r = init().prepare("SELECT json FROM code_prefs WHERE user_id = ?").get(uid) as { json: string } | undefined;
  let saved: Record<string, unknown> = {};
  try { saved = r ? JSON.parse(r.json) : {}; } catch {}
  return cleanPrefs(PREF_DEFAULTS, saved);
}
export function setPrefs(uid: string, patch: Record<string, unknown>) {
  const next = cleanPrefs(getPrefs(uid), patch);
  init().prepare("INSERT INTO code_prefs (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(uid, JSON.stringify(next), Date.now());
  return next;
}
/** Thêm một trang vào danh sách cho phép (người dùng bấm "Luôn cho phép trang này"). */
export function allowSite(uid: string, h: string) {
  const p = getPrefs(uid);
  const x = host(h);
  if (x && !p.sites.includes(x)) setPrefs(uid, { sites: [...p.sites, x], blocked: p.blocked.filter((b) => b !== x) });
}
export const siteHost = host;
/** Trang h có khớp danh sách (khớp cả tên miền con: cho phép example.com là cho phép mail.example.com). */
export const siteIn = (h: string, list: string[]) => list.some((x) => h === x || h.endsWith("." + x));

// ------------------------------------------------------------------ phiên Code
type SRow = { user_id: string; id: number; title: string; data: string | null; pinned: number; archived: number; state: string | null; reason: string | null;
  suggest: string | null; running: number; deleted: number; created_at: number; updated_at: number; touched_at: number };
export type SessionMeta = { id: number; title: string; pinned: boolean; archived: boolean; state: string | null; reason: string | null; suggest: string | null;
  running: boolean; deleted: boolean; updated: number; touched: number; pr: { number: number; url: string | null; state: string } | null };
const meta = (r: SRow, pr?: { number: number; url: string | null; state: string } | null): SessionMeta => ({
  id: r.id, title: r.title, pinned: !!r.pinned, archived: !!r.archived, state: r.state, reason: r.reason, suggest: r.suggest, running: !!r.running,
  deleted: !!r.deleted, updated: r.updated_at, touched: r.touched_at, pr: pr ?? null,
});

export function listSessions(uid: string, since = 0): SessionMeta[] {
  const d = init();
  const rows = d.prepare("SELECT * FROM code_sessions WHERE user_id = ? AND updated_at > ? ORDER BY touched_at DESC LIMIT 500").all(uid, since) as SRow[];
  const prs = d.prepare("SELECT sid, number, url, state FROM code_prs WHERE user_id = ? ORDER BY created_at").all(uid) as { sid: number; number: number; url: string | null; state: string }[];
  const prOf = new Map(prs.map((p) => [p.sid, p]));
  return rows.map((r) => meta(r, prOf.get(r.id)));
}
export function getSession(uid: string, id: number) {
  const r = init().prepare("SELECT * FROM code_sessions WHERE user_id = ? AND id = ?").get(uid, id) as SRow | undefined;
  if (!r) return null;
  let data: Record<string, unknown> | null = null;
  try { data = r.data ? JSON.parse(r.data) : null; } catch {}
  return { ...meta(r), data };
}

type Node = CodeNode;
export type TurnNode = CodeNode;
/** Giới hạn một phiên trên máy chủ, cho cả bản trình duyệt gửi lên và bản lượt chạy nền tự lưu. */
export const SESSION_MAX = 8_000_000;

/** Lưu phiên (từ trình duyệt hay từ việc chạy nền). Trả về bản sau khi gộp (để thiết bị gửi lên biết có lượt mới từ nơi khác). */
export function putSession(uid: string, id: number, o: { title?: string; data?: Record<string, unknown> | null; json?: string; pinned?: boolean; archived?: boolean; base?: number; touch?: boolean }) {
  const d = init();
  const now = Date.now();
  const cur = d.prepare("SELECT * FROM code_sessions WHERE user_id = ? AND id = ?").get(uid, id) as SRow | undefined;
  let data = o.data ?? null;
  let merged = false;
  // Bản trên máy chủ mới hơn bản thiết bị dựa vào: gộp để không mất lượt chạy nền hay lượt từ thiết bị khác. Không cần gộp thì đừng đọc lại cả phiên.
  if (cur && data && (o.base ?? 0) < cur.updated_at) {
    let old: Record<string, unknown> | null = null;
    try { old = cur.data ? JSON.parse(cur.data) : null; } catch {}
    if (old) { data = mergeData(old, data, true); merged = true; }
  }
  const title = (o.title ?? cur?.title ?? "Phiên code").replace(/\s+/g, " ").trim().slice(0, 120) || "Phiên code";
  const touched = o.touch === false ? cur?.touched_at ?? now : now;
  d.prepare(`INSERT INTO code_sessions (user_id, id, title, data, pinned, archived, created_at, updated_at, touched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET title = excluded.title, data = COALESCE(excluded.data, code_sessions.data), pinned = excluded.pinned,
      archived = excluded.archived, deleted = 0, updated_at = excluded.updated_at, touched_at = excluded.touched_at`)
    .run(uid, id, title, data ? (!merged && o.json) || JSON.stringify(data) : null, (o.pinned ?? !!cur?.pinned) ? 1 : 0, (o.archived ?? (o.touch === false ? !!cur?.archived : false)) ? 1 : 0, cur?.created_at ?? now, now, touched);
  return { updated: now, merged, data: merged ? data : undefined };
}
export function patchSession(uid: string, id: number, p: Partial<{ state: string | null; reason: string | null; suggest: string | null; running: boolean; archived: boolean; pinned: boolean; title: string }>) {
  if (!getUser(uid)) return;
  const d = init();
  const cur = d.prepare("SELECT * FROM code_sessions WHERE user_id = ? AND id = ?").get(uid, id) as SRow | undefined;
  const now = Date.now();
  // Phiên chưa có trên máy chủ (lượt chạy trước khi thiết bị kịp gửi phiên lên): tên để trống, thiết bị giữ tên của nó.
  if (!cur) d.prepare("INSERT INTO code_sessions (user_id, id, title, created_at, updated_at, touched_at) VALUES (?, ?, ?, ?, ?, ?)").run(uid, id, p.title ?? "", now, now, now);
  const sets: string[] = [], vals: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (!["state", "reason", "suggest", "running", "archived", "pinned", "title"].includes(k)) continue;
    sets.push(`${k} = ?`); vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  sets.push("updated_at = ?"); vals.push(now);
  // Phiên có việc mới (đang chạy / vừa có trạng thái mới) thì không còn bị coi là không hoạt động.
  if (p.running || p.state) { sets.push("touched_at = ?"); vals.push(now); }
  d.prepare(`UPDATE code_sessions SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`).run(...vals, uid, id);
}
/** Xóa phiên: giữ dấu đã xóa để thiết bị khác cũng gỡ khỏi danh sách. */
export function deleteSession(uid: string, id: number) {
  init().prepare("UPDATE code_sessions SET deleted = 1, data = NULL, updated_at = ? WHERE user_id = ? AND id = ?").run(Date.now(), uid, id);
  init().prepare("DELETE FROM code_prs WHERE user_id = ? AND sid = ?").run(uid, id);
}
/** Lưu trữ các phiên không hoạt động quá ngưỡng của người dùng (không đụng phiên đang chạy hay đã ghim). */
export function archiveIdle(uid: string) {
  const p = getPrefs(uid);
  if (!p.archiveAfter) return 0;
  const before = Date.now() - p.archiveAfter * 86_400_000;
  return init().prepare("UPDATE code_sessions SET archived = 1, updated_at = ? WHERE user_id = ? AND archived = 0 AND deleted = 0 AND running = 0 AND pinned = 0 AND touched_at < ?")
    .run(Date.now(), uid, before).changes;
}

/** Thêm một lượt vào cuối nhánh đang chọn của phiên (việc chạy nền: tự sửa PR). Trả về id lượt. */
export function appendNode(uid: string, sid: number, node: Omit<Node, "id" | "parent"> & { id?: number }) {
  const s = getSession(uid, sid);
  const data = (s?.data ?? { nodes: [], sel: {}, ctx: [] }) as { nodes: Node[]; sel: Record<number, number>; [k: string]: unknown };
  const nodes = data.nodes ?? [], sel = data.sel ?? {};
  let p = 0;
  for (;;) {
    const kids = nodes.filter((n) => n.parent === p);
    if (!kids.length) break;
    p = (kids.find((k) => k.id === sel[p]) ?? kids[kids.length - 1]).id;
  }
  const id = node.id ?? Math.max(Date.now(), ...nodes.map((n) => n.id + 1));
  data.nodes = [...nodes, { ...node, id, parent: p }];
  data.sel = { ...sel, [p]: id };
  putSession(uid, sid, { data, base: Infinity, title: s?.title });
  return id;
}
/** Thay một lượt (cập nhật dần khi lượt chạy nền đang làm). */
export function updateNode(uid: string, sid: number, id: number, fn: (n: Node) => Node) {
  const s = getSession(uid, sid);
  if (!s?.data) return;
  const data = s.data as { nodes: Node[] };
  data.nodes = (data.nodes ?? []).map((n) => (n.id === id ? fn(n) : n));
  putSession(uid, sid, { data, base: Infinity, title: s.title });
}
/** Ghi bản mới nhất của lượt đang chạy ở máy chủ (agentruns): trình duyệt có thể đã đi chỗ khác nên không còn ai đẩy lên. Phiên đã xóa thì thôi. */
export function saveTurn(uid: string, sid: number, node: Node, title?: string) {
  needDisk();
  // Việc nền của tài khoản vừa xóa: không tạo lại phiên.
  if (!getUser(uid)) return;
  const row = init().prepare("SELECT deleted FROM code_sessions WHERE user_id = ? AND id = ?").get(uid, sid) as { deleted: number } | undefined;
  if (row?.deleted) return;
  const s = getSession(uid, sid);
  const data = (s?.data ?? { nodes: [], sel: {}, ctx: [] }) as { nodes: Node[]; sel: Record<number, number>; [k: string]: unknown };
  const nodes = data.nodes ?? [];
  if (nodes.some((n) => n.id === node.id)) data.nodes = nodes.map((n) => (n.id === node.id ? { ...n, ...node } : n));
  else { data.nodes = [...nodes, node]; data.sel = { ...(data.sel ?? {}), [node.parent]: node.id }; }
  // Không có trần thì phiên lớn dần tới hàng chục MB: mỗi lần lưu chặn cả máy chủ lâu hơn, và trình duyệt gửi lên bị từ chối (413) trong khi máy chủ vẫn tự ghi thêm.
  const fit = fitSession(data, SESSION_MAX, node.id);
  if (!fit) { console.warn(`[agent] phiên ${sid} quá lớn, không lưu thêm`); return; }
  // Lưu nền không phải người dùng mở lại phiên: phiên vừa lưu trữ không được quay về danh sách đang dùng.
  putSession(uid, sid, { data: fit.data, json: fit.json, base: Infinity, title: s?.title || title, archived: !!s?.archived, touch: !s?.archived });
}

// ------------------------------------------------------------------ pull request
export type PrRow = { user_id: string; sid: number; repo: string; number: number; url: string | null; branch: string | null; base: string | null; head_sha: string | null;
  state: string; fixed_sha: string | null; seen_comment: number; busy: number; fixes: number; ci_fixes: number; note: string | null; checked_at: number | null; created_at: number };
export function trackPr(uid: string, sid: number, pr: { repo: string; number: number; url?: string; branch?: string; base?: string; head?: string }) {
  init().prepare(`INSERT INTO code_prs (user_id, sid, repo, number, url, branch, base, head_sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, repo, number) DO UPDATE SET sid = excluded.sid, url = excluded.url, branch = excluded.branch, base = excluded.base, state = 'open'`)
    .run(uid, sid, pr.repo, pr.number, pr.url ?? null, pr.branch ?? null, pr.base ?? null, pr.head ?? null, Date.now());
}
export const openPrs = () => init().prepare("SELECT * FROM code_prs WHERE state = 'open' ORDER BY checked_at IS NOT NULL, checked_at").all() as PrRow[];
export const prsOf = (uid: string, sid: number) => init().prepare("SELECT * FROM code_prs WHERE user_id = ? AND sid = ? ORDER BY created_at").all(uid, sid) as PrRow[];
export function patchPr(uid: string, repo: string, number: number, p: Partial<Omit<PrRow, "user_id" | "repo" | "number">>) {
  const ks = Object.keys(p);
  if (!ks.length) return;
  init().prepare(`UPDATE code_prs SET ${ks.map((k) => `${k} = ?`).join(", ")} WHERE user_id = ? AND repo = ? AND number = ?`)
    .run(...ks.map((k) => { const v = (p as Record<string, unknown>)[k]; return typeof v === "boolean" ? (v ? 1 : 0) : v; }), uid, repo, number);
}
