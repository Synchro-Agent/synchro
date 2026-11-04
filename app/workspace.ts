// Cầu nối máy chủ Next -> dịch vụ workspace (workspace/agent.mjs trên VPS).
// Mỗi người dùng một container; mỗi phiên Synchro Code một thư mục /home/user/work/s<id>.
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
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

// Dùng node:http, không dùng fetch: fetch của Node (undici) tự cắt sau đúng 5 phút nếu chưa có header trả lời, mà /run và /exec chỉ trả lời khi
// lệnh xong (dựng video 300–600 giây luôn lỗi, container vẫn chạy, kết quả mất). Hạn chờ duy nhất là timeoutMs. Mỗi yêu cầu một kết nối riêng:
// signal ngắt kết nối thì dịch vụ workspace biết để dừng container (nút Dừng).
function post(path: string, data: string, sig: AbortSignal) {
  const u = new URL(AGENT + path);
  return new Promise<{ status: number; text: string }>((ok, no) => {
    const req = (u.protocol === "https:" ? https : http).request(u, { method: "POST", agent: false, signal: sig, headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      const ch: Buffer[] = [];
      res.on("data", (c: Buffer) => ch.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 502, text: Buffer.concat(ch).toString("utf8") }));
      res.on("error", no);
    });
    req.on("error", no);
    req.end(data);
  });
}

export async function agent<T = Record<string, unknown>>(path: string, body: Record<string, unknown>, timeoutMs = 180_000, signal?: AbortSignal): Promise<T> {
  const limit = AbortSignal.timeout(timeoutMs);
  let r: { status: number; text: string };
  try {
    r = await post(path, JSON.stringify(body), signal ? AbortSignal.any([limit, signal]) : limit);
  } catch (e) {
    if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
    throw new AuthError(limit.aborted ? "Workspace phản hồi quá lâu." : "Không kết nối được workspace.", 502);
  }
  let j: unknown = {};
  try { j = JSON.parse(r.text); } catch { /* lỗi không phải JSON: báo theo mã trạng thái */ }
  if (r.status < 200 || r.status >= 300) throw new AuthError((j as { error?: string }).error || `Workspace lỗi ${r.status}`, r.status === 401 ? 502 : r.status);
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

// Ghi tệp nhị phân vào thư mục phiên: từng khúc 12 MB (base64 qua stdin), dưới giới hạn 30 MB mỗi yêu cầu của dịch vụ workspace.
const PUT_JS = 'const fs=require("fs"),p=require("path");const[f,m]=process.argv.slice(1);let b="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>b+=c).on("end",()=>{fs.mkdirSync(p.dirname(f),{recursive:true});(m==="a"?fs.appendFileSync:fs.writeFileSync)(f,Buffer.from(b,"base64"))})';
export async function putFile(u: string, d: string, rel: string, buf: Buffer) {
  const p = cleanPath(rel), CH = 12 * 1048576;
  for (let i = 0; i === 0 || i < buf.length; i += CH) {
    const r = await exec(u, d, { argv: ["node", "-e", PUT_JS, p, i ? "a" : "w"], stdin: buf.subarray(i, i + CH).toString("base64"), timeout: 120 });
    if (r.code) throw new AuthError(`Không chép được ${p} vào workspace: ${(r.err || r.out).trim().slice(0, 200)}`, 500);
  }
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
