// Cầu nối máy chủ Next -> dịch vụ workspace (workspace/agent.mjs trên VPS).
// Mỗi người dùng một container; mỗi phiên Synchro Code một thư mục /home/user/work/s<id>.
import crypto from "node:crypto";
import { appUrl, AuthError, can, type UserRow } from "./authstore";

const AGENT = (process.env.WS_AGENT_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.WS_AGENT_SECRET ?? "";
export const WORK = "/home/user/work";

export const wsConfigured = () => !!AGENT && SECRET.length >= 32;
export const wsAllowed = (u: UserRow) => wsConfigured() && can(u, "code") && can(u, "sandbox");
export function requireWs(u: UserRow) {
  if (!wsConfigured()) throw new AuthError("Máy chủ chưa bật workspace.", 501);
  if (!can(u, "code") || !can(u, "sandbox")) throw new AuthError("Quản trị viên chưa cho phép tài khoản của bạn dùng workspace (Cloud sandbox).", 403);
}

// Id phiên code (Date.now() ở trình duyệt) -> tên thư mục.
export function sdir(sid: unknown) {
  const s = String(sid ?? "");
  if (!/^\d{1,16}$/.test(s)) throw new AuthError("Phiên không hợp lệ.", 400);
  return "s" + s;
}

export async function agent<T = Record<string, unknown>>(path: string, body: Record<string, unknown>, timeoutMs = 180_000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(AGENT + path, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    throw new AuthError((e as Error).name === "TimeoutError" ? "Workspace phản hồi quá lâu." : "Không kết nối được workspace.", 502);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError((j as { error?: string }).error || `Workspace lỗi ${r.status}`, r.status === 401 ? 502 : r.status);
  return j as T;
}

export type ExecResult = { code: number; out: string; err: string; truncated?: boolean };
export const exec = (u: string, d: string, o: { cmd?: string; argv?: string[]; timeout?: number; stdin?: string; env?: Record<string, string> }) =>
  agent<ExecResult>("/exec", { u, d, ...o }, ((o.timeout ?? 120) + 30) * 1000);

// Thao tác file qua /opt/synchro/fsop.js trong container (đường dẫn tương đối với thư mục phiên).
export async function fsop<T = Record<string, unknown>>(u: string, d: string, op: string, path = ".", arg?: string, stdin?: string): Promise<T> {
  const r = await exec(u, d, { argv: ["node", "/opt/synchro/fsop.js", op, cleanPath(path), ...(arg !== undefined ? [arg] : [])], stdin, timeout: 60 });
  let j: { error?: string } & Record<string, unknown>;
  try { j = JSON.parse(r.out); } catch { throw new AuthError((r.err || r.out || "Lỗi thao tác file").trim().slice(0, 300), 500); }
  if (j.error) throw new AuthError(String(j.error), 400);
  return j as T;
}

// Đường dẫn tương đối, không thoát ra ngoài thư mục phiên. Chấp nhận cả đường dẫn tuyệt đối trong thư mục phiên.
export function cleanPath(p: unknown, d?: string) {
  let s = String(p ?? ".").trim().replace(/\\/g, "/");
  if (d && s.startsWith(`${WORK}/${d}`)) s = s.slice(`${WORK}/${d}`.length);
  s = s.replace(/^\/+/, "");
  const parts: string[] = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") throw new AuthError("Đường dẫn không được ra ngoài thư mục làm việc.", 400);
    parts.push(seg);
  }
  return parts.join("/") || ".";
}

// Vé WebSocket ngắn hạn cho trình duyệt (terminal / màn hình trình duyệt / tiện ích Synchro trong Chrome của người dùng: d là id thiết bị),
// ký bằng khóa chung với dịch vụ workspace.
export function ticket(req: Request, u: string, d: string, k: "term" | "log" | "screen" | "ext") {
  const body = Buffer.from(JSON.stringify({ u, d, k, exp: Date.now() + 60_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const base = (process.env.WS_PUBLIC_URL ?? appUrl(req).replace(/^http/, "ws") + "/ws-agent").replace(/\/$/, "");
  return `${base}/${k === "screen" || k === "ext" ? k : "term"}?t=${body}.${sig}`;
}

export const shq = (x: string) => `'${x.replace(/'/g, "'\\''")}'`;

// Xóa tài khoản: xóa luôn container và file workspace (không chặn nếu workspace đang tắt).
export async function destroyWorkspace(u: string) {
  if (!wsConfigured()) return;
  await agent("/destroy", { u }, 60_000).catch((e) => console.error("[workspace] destroy", e));
}
