// Hỏi người dùng trước khi Synchro làm một việc (chế độ quyền của Synchro Code, trang web chưa được phép).
// Lượt đang chạy (agent của Code, hay lượt chat chạy nền) dừng ở đây chờ câu trả lời gửi qua /api/approve; người dùng bấm Dừng thì thôi chờ.
import crypto from "node:crypto";
import { allowSite, getPrefs, siteHost, siteIn, type PermMode } from "./codestore";

export type AskKind = "edit" | "bash" | "site";
export type Ask = { id: string; kind: AskKind; tool: string; title: string; detail: string; host?: string; key: string };
export type Answer = { ok: boolean; always?: boolean; note?: string };

type Wait = { uid: string; done: (a: Answer) => void };
const g = globalThis as unknown as { __synchroAsks?: Map<string, Wait> };
const waits = (g.__synchroAsks ??= new Map());

/** Chờ người dùng trả lời câu hỏi id (hoặc tới khi lượt bị dừng: coi như từ chối). */
export function waitAnswer(uid: string, id: string, signal?: AbortSignal): Promise<Answer> {
  return new Promise((ok) => {
    const done = (a: Answer) => { waits.delete(id); signal?.removeEventListener("abort", stop); ok(a); };
    const stop = () => done({ ok: false, note: "Người dùng đã dừng." });
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop);
    waits.set(id, { uid, done });
  });
}
/** Câu trả lời từ giao diện. false: không có câu hỏi đang chờ (đã trả lời ở thiết bị khác, hay lượt đã dừng). */
export function answer(uid: string, id: string, a: Answer) {
  const w = waits.get(id);
  if (!w || w.uid !== uid) return false;
  w.done({ ok: !!a.ok, always: !!a.always, note: String(a.note ?? "").slice(0, 2000) });
  return true;
}

// ------------------------------------------------------------------ chế độ quyền của Synchro Code
// Lệnh chỉ đọc (xem, tìm, git status…) không cần hỏi ở chế độ nào.
const READ_ONLY = /^(ls|ll|pwd|cat|head|tail|wc|stat|file|tree|du|df|which|type|echo|printf|date|whoami|env|printenv|rg|grep|egrep|fgrep|find|fd|sort|uniq|cut|diff|less|more|jq|node -v|node --version|npm -v|npm ls|npm view|python3? --version|git (status|diff|log|show|branch|remote|rev-parse|ls-files|blame|describe|tag)\b)/;
export function readOnlyCmd(cmd: string) {
  const c = cmd.trim();
  // Có chuyển hướng, nối lệnh hay thay thế lệnh thì không coi là chỉ đọc.
  if (!c || /[;&|><`]|\$\(/.test(c.replace(/2>&1|\|\|?\s*(head|tail|wc|sort|uniq|grep|cut|jq|less|more)\b[^;&|><`]*/g, ""))) return false;
  return READ_ONLY.test(c) && !/\bfind\b.*\s-(delete|exec)/.test(c);
}
/** Khóa "luôn cho phép trong phiên này": mọi lần sửa tệp, hoặc các lệnh cùng chương trình (vd. mọi lệnh npm). */
export const cmdKey = (cmd: string) => `bash:${cmd.trim().split(/\s+/).slice(0, cmd.trim().startsWith("git ") || cmd.trim().startsWith("npm ") || cmd.trim().startsWith("npx ") ? 2 : 1).join(" ")}`;

export type Perm = { mode: PermMode; allow: string[] };
/** Việc này có cần hỏi ở chế độ hiện tại không (null: làm luôn). */
export function needAsk(perm: Perm, name: string, input: Record<string, unknown>): Omit<Ask, "id"> | null {
  if (perm.mode === "auto") return null;
  if (name === "write_file" || name === "edit_file") {
    if (perm.mode === "edits" || perm.allow.includes("edit")) return null;
    const p = String(input.path ?? "");
    return { kind: "edit", tool: name, key: "edit", title: name === "write_file" ? `Ghi tệp ${p}` : `Sửa tệp ${p}`,
      detail: name === "write_file" ? String(input.content ?? "").slice(0, 4000) : `- ${String(input.old_str ?? "").slice(0, 1800)}\n+ ${String(input.new_str ?? "").slice(0, 1800)}` };
  }
  if (name === "git_push" || name === "create_pull_request") {
    if (perm.allow.includes("push")) return null;
    return { kind: "bash", tool: name, key: "push", title: name === "git_push" ? "Đẩy code lên GitHub" : "Mở pull request trên GitHub",
      detail: name === "git_push" ? "git push -u origin HEAD" : String(input.title ?? "").slice(0, 300) };
  }
  if (name === "bash" || name === "run_skill_script") {
    const cmd = name === "bash" ? String(input.command ?? "") : `${String(input.skill ?? input.name ?? "")} ${String(input.script ?? input.path ?? "")}`.trim();
    if (name === "bash" && readOnlyCmd(cmd)) return null;
    const key = name === "bash" ? cmdKey(cmd) : "script";
    if (perm.allow.includes(key)) return null;
    const why = typeof input.description === "string" && input.description.trim() ? input.description.trim() : "";
    return { kind: "bash", tool: name, key, title: why || (name === "bash" ? "Chạy lệnh" : "Chạy script của skill"), detail: cmd.slice(0, 4000) };
  }
  return null;
}

// ------------------------------------------------------------------ trang web được phép (công cụ trình duyệt)
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/;
/** Trang của lời gọi công cụ trình duyệt: url khi mở trang mới, không thì trang đang mở. */
export function siteOf(name: string, input: Record<string, unknown>, current: string | null) {
  const url = name === "browser_navigate" ? String(input.url ?? "")
    : name === "browser_tabs" && typeof input.url === "string" ? input.url
    : name === "browser_batch" && Array.isArray(input.actions) ? String((input.actions as { action?: string; url?: string }[]).find((a) => a?.action === "navigate" && a.url)?.url ?? "")
    : "";
  if (url && !/^(back|forward|reload)$/i.test(url)) {
    try { return siteHost(new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname); } catch { return siteHost(url); }
  }
  return current;
}
export type SiteGate = { uid: string; current: string | null; once: Set<string> };
/** Trang h dùng được không: "ok" | "blocked" | "ask". */
export function siteRule(uid: string, h: string | null, once: Set<string>): "ok" | "blocked" | "ask" {
  if (!h || LOCAL.test(h) || h.startsWith("data:") || h === "about") return "ok";
  const p = getPrefs(uid);
  if (siteIn(h, p.blocked)) return "blocked";
  if (!p.siteAsk || siteIn(h, p.sites) || once.has(h)) return "ok";
  return "ask";
}
/** Lưu câu trả lời "Luôn cho phép trang này". */
export const rememberSite = allowSite;

export const newAskId = () => crypto.randomUUID();
