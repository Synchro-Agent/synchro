"use client";
// Synchro Code ở trình duyệt: cài đặt (lưu ở máy chủ), đồng bộ phiên giữa các thiết bị, trả lời câu hỏi duyệt của lượt đang chạy.
import { useSyncExternalStore } from "react";
import type { CodePrefs } from "./codestore";
import { mergeData } from "./codemerge";
import { userScope } from "./userscope";

export type { CodePrefs };
export type SessionState = "blocked" | "review" | "done" | null;
export type ServerSession = { id: number; title: string; pinned: boolean; archived: boolean; state: SessionState; reason: string | null; suggest: string | null;
  running: boolean; deleted: boolean; updated: number; touched: number; pr: { number: number; url: string | null; state: string } | null };

// ------------------------------------------------------------------ cài đặt
let prefs: CodePrefs | null = null, loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };
// Lần tải lỗi (máy chủ vừa khởi động lại, mạng chập chờn): bỏ lần tải đó và thử lại sau 3 giây, không để cài đặt "chưa tải xong" mãi.
let retry: ReturnType<typeof setTimeout> | null = null;
export function loadCodePrefs(force = false) {
  if (loading && !force) return loading;
  loading = fetch("/api/code/prefs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    if (j) { prefs = j; emit(); return; }
    loading = null;
    if (!prefs && !retry) retry = setTimeout(() => { retry = null; if (subs.size) loadCodePrefs(); }, 3000);
  });
  return loading;
}
/** Cài đặt Synchro Code của tài khoản (null khi chưa tải xong). */
export function useCodePrefs(): CodePrefs | null {
  return useSyncExternalStore((f) => { subs.add(f); if (!prefs && userScope() !== "anon") loadCodePrefs(); return () => subs.delete(f); }, () => prefs, () => null);
}
export const codePrefsNow = () => prefs;
export async function saveCodePrefs(patch: Partial<CodePrefs>): Promise<string | null> {
  const old = prefs;
  if (prefs) { prefs = { ...prefs, ...patch }; emit(); }
  const r = await fetch("/api/code/prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null);
  if (!r?.ok) { prefs = old; emit(); return ((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Không lưu được cài đặt."; }
  prefs = await r.json(); emit();
  return null;
}
/** Sau khi đổi tài khoản: tải lại cài đặt của tài khoản mới. */
export function resetCodePrefs() { prefs = null; loading = null; emit(); }

// ------------------------------------------------------------------ đồng bộ phiên
export async function listServerSessions(since = 0): Promise<{ sessions: ServerSession[]; now: number; sync: boolean } | null> {
  const r = await fetch(`/api/code/sessions?since=${since}`, { cache: "no-store" }).catch(() => null);
  return r?.ok ? r.json() : null;
}
export async function getServerSession(id: number, since = 0): Promise<(ServerSession & { data?: Record<string, unknown> | null; same?: boolean }) | null> {
  const r = await fetch(`/api/code/sessions?id=${id}&since=${since}`, { cache: "no-store" }).catch(() => null);
  return r?.ok ? r.json() : null;
}
export async function patchServerSession(id: number, p: { archived?: boolean; pinned?: boolean; title?: string; state?: SessionState }) {
  await fetch("/api/code/sessions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...p }) }).catch(() => {});
}
export async function deleteServerSession(id: number) {
  await fetch(`/api/code/sessions?id=${id}`, { method: "DELETE" }).catch(() => {});
}

// Gửi phiên lên máy chủ: gom các lần lưu liên tiếp (1,2 giây), mỗi phiên một hàng đợi. Máy chủ có lượt mới hơn (chạy nền, thiết bị khác)
// thì trả về bản đã gộp để thiết bị này cập nhật theo.
type Pending = { title: string; data: Record<string, unknown>; pinned?: boolean; timer: ReturnType<typeof setTimeout> | null; onMerged?: (d: Record<string, unknown>, updated: number) => void };
const pending = new Map<number, Pending>();
const bases = new Map<number, number>();
export const sessionBase = (id: number) => bases.get(id) ?? 0;
export const setSessionBase = (id: number, t: number) => { bases.set(id, Math.max(bases.get(id) ?? 0, t)); };
export function pushSession(id: number, title: string, data: Record<string, unknown>, onMerged?: Pending["onMerged"], pinned?: boolean) {
  const p = pending.get(id);
  if (p?.timer) clearTimeout(p.timer);
  const next: Pending = { title, data, pinned, onMerged, timer: null };
  next.timer = setTimeout(() => flushSession(id), 1200);
  pending.set(id, next);
}
/** true: đã gửi xong (hoặc không có gì chờ); false: chưa gửi được (bản trên thiết bị này vẫn còn). */
export async function flushSession(id: number): Promise<boolean> {
  const p = pending.get(id);
  if (!p) return true;
  pending.delete(id);
  if (p.timer) clearTimeout(p.timer);
  const r = await fetch("/api/code/sessions", { method: "PUT", headers: { "content-type": "application/json" }, keepalive: JSON.stringify(p.data).length < 60_000,
    body: JSON.stringify({ id, title: p.title, data: p.data, base: bases.get(id) ?? 0, ...(p.pinned !== undefined ? { pinned: p.pinned } : {}) }) }).catch(() => null);
  if (!r?.ok) return false;
  const j = (await r.json().catch(() => null)) as { updated: number; merged: boolean; data?: Record<string, unknown> } | null;
  if (!j) return false;
  bases.set(id, j.updated);
  if (j.merged && j.data) p.onMerged?.(j.data, j.updated);
  return true;
}
/** Gửi ngay mọi phiên đang chờ (đóng tab, đổi phiên). */
export function flushAll() { for (const id of [...pending.keys()]) void flushSession(id); }
/** Đăng xuất kèm xóa dữ liệu trên thiết bị: gửi ngay mọi phiên đang chờ và chờ kết quả. Trả về số phiên chưa gửi được. */
export async function flushAllNow(): Promise<number> {
  const r = await Promise.all([...pending.keys()].map((id) => flushSession(id)));
  return r.filter((x) => !x).length;
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushAll);

/** Gộp bản trên máy chủ vào bản trên thiết bị này. */
export const mergeSession = (local: Record<string, unknown> | null, remote: Record<string, unknown> | null) => mergeData(local, remote, true);

// ------------------------------------------------------------------ duyệt
export const ASK_GONE = "Câu hỏi này không còn chờ trả lời.";
export async function answerAsk(id: string, ok: boolean, o: { always?: boolean; chat?: boolean; note?: string; input?: Record<string, unknown> } = {}): Promise<string | null> {
  const r = await fetch("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ok, always: !!o.always, chat: !!o.chat, note: o.note ?? "", ...(o.input ? { input: o.input } : {}) }) }).catch(() => null);
  if (r?.ok) return null;
  if (r?.status === 409) return ASK_GONE;
  return ((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Không gửi được câu trả lời.";
}
