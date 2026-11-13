"use client";
// Gọi API workspace / GitHub / agent từ trình duyệt cho Synchro Code.
import { create } from "zustand";
import type { AgentEvent, PlanItem } from "./agentcore";
import { postTurn } from "./turnretry";

export type { AgentEvent, PlanItem };
export type WsStatus = { available: boolean; reason?: string; running?: boolean; idleMin?: number };
export type GitFile = { path: string; status: string; add: number; del: number };
export type GitState = { git: false } | { git: true; branch: string; remote: string; repo: string | null; ahead: number | null; files: GitFile[]; output?: string; pr?: { url: string; number: number; created?: boolean } };
// Pull request của phiên mà Synchro theo dõi (tự sửa CI / góp ý, tự lưu trữ khi xong).
export type PrInfo = { repo: string; number: number; url: string | null; branch: string | null; state: string; fixes: number; note: string | null; busy: boolean };
export type GhStatus = { configured: boolean; allowed: boolean; linked: boolean; login: string | null; repoScope: boolean };
export type GhRepo = { full: string; private: boolean; branch: string; desc: string | null; pushed: string; url: string; push: boolean };

export class WsError extends Error { constructor(m: string, public status: number) { super(m); } }
/** Máy chủ từ chối lượt mới vì phiên đã có lượt đang chạy: nối vào lượt đó, không phải lỗi. */
export const alreadyRunning = (e: unknown) => e instanceof WsError && e.status === 409;
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

// Dòng của lượt agent: sự kiện (kèm số thứ tự s), mở đầu { t: "run" }, kết thúc { t: "end" }.
// fromStart: dòng này phát lại từ sự kiện đầu tiên. Nối lại sau khi mất mạng thì false: chỉ có sự kiện sau mốc đã nhận.
export type RunHead = { t: "run"; node: Record<string, unknown> | null; running: boolean; count: number; s?: undefined; fromStart?: boolean };
export type AgentLine = (AgentEvent & { s?: number }) | RunHead | { t: "end"; s?: number; stopped?: boolean };
async function readLines(r: Response, on: (e: AgentLine) => void) {
  const rd = r.body!.getReader();
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
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
// Nối lại lượt đang chạy ở máy chủ, tự thử lại khi mất mạng. false: máy chủ không còn lượt này (vừa khởi động lại) hoặc nối không được quá lâu.
async function follow(sid: string, on: (e: AgentLine) => void, signal: AbortSignal, st: { seq: number; ended: boolean }) {
  // 202: lượt đang chạy nốt ở bản cũ trong lúc deploy (tối đa ~30 giây): chờ rồi hỏi lại, tối đa ~90 giây, không tính là lỗi.
  let elsewhere = 0;
  for (let fails = 0; fails < 60 && !signal.aborted; ) {
    try {
      const r = await fetch(`/api/agent?sid=${encodeURIComponent(sid)}&after=${st.seq}`, { signal, cache: "no-store" });
      if (r.status === 202) { if (++elsewhere > 45) return false; await sleep(2000, signal); continue; }
      if (r.status === 204 || r.status === 401) return false;
      if (r.ok && r.body) { fails = 0; await readLines(r, on); if (st.ended) return true; } else fails++;
    } catch { if (signal.aborted) return true; fails++; }
    await sleep(3000, signal);
  }
  return signal.aborted;
}
export const GONE = "Máy chủ vừa khởi động lại hoặc mất kết nối quá lâu nên không theo dõi tiếp được lượt này. Phần đã làm vẫn còn trong workspace.";

// Chạy agent: đọc NDJSON từ /api/agent. Lượt chạy ở máy chủ độc lập với kết nối: signal chỉ ngừng nghe, muốn dừng lượt thì gọi stopAgent.
export async function streamAgent(body: Record<string, unknown>, on: (e: AgentLine) => void, signal: AbortSignal) {
  const st = { seq: 0, ended: false, started: false };
  const seen = (e: AgentLine) => { if (e.s) st.seq = e.s; if (e.t === "run") st.started = true; if (e.t === "end") st.ended = true; on(e); };
  try {
    const r = await postTurn("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new WsError((j as { error?: string }).error || `Lỗi ${r.status}`, r.status); }
    await readLines(r, seen);
  } catch (e) {
    if (signal.aborted || e instanceof WsError || !st.started) throw e;
  }
  if (!st.ended && !signal.aborted && !(await follow(String(body.sid), seen, signal, st))) on({ t: "error", error: GONE });
}
/** Mở lại phiên: lượt của phiên còn ở máy chủ không. gone: máy chủ trả lời chắc chắn là không có lượt nào; null: chưa biết (mất mạng, hết phiên đăng nhập). */
export async function agentRunInfo(sid: number | string): Promise<{ running: boolean; node: number | null; gone?: boolean } | null> {
  try { const r = await fetch(`/api/agent?sid=${sid}&json=1`, { cache: "no-store" }); return r.status === 204 ? { running: false, node: null, gone: true } : r.status === 200 ? await r.json() : null; } catch { return null; }
}
/** Nối vào lượt đang có của phiên từ đầu: nhận lại mọi sự kiện rồi theo dõi tiếp. */
export async function attachAgent(sid: number | string, on: (e: AgentLine) => void, signal: AbortSignal) {
  const st = { seq: 0, ended: false };
  const seen = (e: AgentLine) => { if (e.s) st.seq = e.s; if (e.t === "end") st.ended = true; on(e.t === "run" ? { ...e, fromStart: st.seq === 0 } : e); };
  if (!(await follow(String(sid), seen, signal, st))) on({ t: "error", error: GONE });
}
/** Nút Dừng. */
export const stopAgent = (sid: number | string) => fetch(`/api/agent?sid=${sid}`, { method: "DELETE" }).catch(() => {});
/** Rời phiên khi lượt còn chạy: báo khi lượt xong để danh sách phiên thôi hiện đang chạy (cả khi tắt đồng bộ). */
export function watchAgentEnd(sid: number | string, done: () => void) {
  const t = setInterval(() => { void agentRunInfo(sid).then((j) => { if (!j?.running) { clearInterval(t); done(); } }); }, 5000);
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
