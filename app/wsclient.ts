"use client";
// Gọi API workspace / GitHub / agent từ trình duyệt cho Synchro Code.
import { create } from "zustand";
import type { AgentEvent, PlanItem } from "./agentcore";

export type { AgentEvent, PlanItem };
export type WsStatus = { available: boolean; reason?: string; running?: boolean; idleMin?: number };
export type GitFile = { path: string; status: string; add: number; del: number };
export type GitState = { git: false } | { git: true; branch: string; remote: string; repo: string | null; ahead: number | null; files: GitFile[]; output?: string; pr?: { url: string; number: number } };
export type GhStatus = { configured: boolean; linked: boolean; login: string | null; repoScope: boolean };
export type GhRepo = { full: string; private: boolean; branch: string; desc: string | null; pushed: string; url: string; push: boolean };

export class WsError extends Error { constructor(m: string, public status: number) { super(m); } }
async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new WsError((j as { error?: string }).error || `Lỗi ${r.status}`, r.status);
  return j as T;
}
export const wsStatus = () => fetch("/api/ws", { cache: "no-store" }).then((r) => json<WsStatus>(r));
export const wsOp = <T = Record<string, unknown>>(op: string, sid: number | null, body: Record<string, unknown> = {}) =>
  fetch("/api/ws", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, sid: sid === null ? undefined : String(sid), ...body }) }).then((r) => json<T>(r));
export const gitOp = (sid: number, action: string, body: Record<string, unknown> = {}) => wsOp<GitState>("git", sid, { action, ...body });
export const ghStatus = () => fetch("/api/github", { cache: "no-store" }).then((r) => json<GhStatus>(r));
export const ghRepos = (q = "") => fetch(`/api/github?repos=1&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => json<{ repos: GhRepo[] }>(r)).then((j) => j.repos);
export const ghUnlink = () => fetch("/api/github", { method: "DELETE" }).then((r) => json(r));

// Kết nối GitHub trong cửa sổ nhỏ; trang /api/github/done báo kết quả qua localStorage rồi tự đóng.
export function ghConnect(): Promise<string | null> {
  return new Promise((resolve) => {
    const w = window.open("/api/github/connect", "synchro-gh", "width=760,height=780");
    if (!w) { location.href = "/api/github/connect"; return; }
    let done = false;
    const finish = (err: string | null) => { if (done) return; done = true; window.removeEventListener("storage", onStore); clearTimeout(t); resolve(err); };
    const onStore = (e: StorageEvent) => {
      if (e.key !== "synchro:gh" || !e.newValue) return;
      try { finish((JSON.parse(e.newValue) as { error?: string }).error || null); } catch { finish(null); }
    };
    window.addEventListener("storage", onStore);
    // COOP tách cửa sổ con khỏi trang này nên không đọc được w.closed; hết 10 phút thì thôi chờ.
    const t = setTimeout(() => finish("timeout"), 600_000);
  });
}

// Chạy agent: đọc NDJSON từ /api/agent, mỗi dòng là một sự kiện.
export async function streamAgent(body: Record<string, unknown>, on: (e: AgentEvent) => void, signal: AbortSignal) {
  const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new WsError((j as { error?: string }).error || `Lỗi ${r.status}`, r.status); }
  const rd = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { on(JSON.parse(line)); } catch {} }
    }
  }
}

// Trạng thái dùng chung giữa khung chat, các pane và session rail.
export type PaneKind = "terminal" | "browser" | "files" | "block";
type CodeUi = {
  status: WsStatus | null;
  setStatus: (s: WsStatus | null) => void;
  git: Record<number, GitState | undefined>;
  setGit: (sid: number, g: GitState | undefined) => void;
  openFile: { path: string; diff?: boolean; n: number } | null;
  showFile: (path: string, diff?: boolean) => void;
  termTab: { tab: "log" | "term"; n: number } | null;
  showTerm: (tab: "log" | "term") => void;
};
export const useCodeUi = create<CodeUi>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  git: {},
  setGit: (sid, g) => set((s) => ({ git: { ...s.git, [sid]: g } })),
  openFile: null,
  showFile: (path, diff) => set((s) => ({ openFile: { path, diff, n: (s.openFile?.n ?? 0) + 1 } })),
  termTab: null,
  showTerm: (tab) => set((s) => ({ termTab: { tab, n: (s.termTab?.n ?? 0) + 1 } })),
}));

export const isLocalUrl = (u: string) => /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u) || /^(about|chrome-error):/i.test(u);
export const planDone = (p?: PlanItem[]) => !!p?.length && p.every((x) => x.status === "completed");
