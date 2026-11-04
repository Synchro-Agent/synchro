// fetch an toàn cho địa chỉ do người dùng nhập (connector MCP, máy chủ OAuth): chỉ https, chặn địa chỉ nội bộ
// (localhost, mạng LAN, metadata đám mây) để không ai dùng Synchro gọi vào hạ tầng bên trong, và tự theo chuyển hướng có kiểm tra lại.
// Thử nghiệm cục bộ (npm run dev:mock) đặt MCP_ALLOW_PRIVATE=1 để gọi được máy chủ giả lập ở 127.0.0.1 qua http.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchBlocked extends Error {}
// Lỗi tạm thời ở phía máy chủ từ xa (mất mạng, quá giờ, 429 / 5xx): thử lại được, không có nghĩa là mất đăng nhập hay sai địa chỉ.
// retryAfter: máy chủ bảo chờ bao lâu (mili giây, từ header Retry-After).
export class TempFail extends Error { constructor(m: string, public status = 0, public retryAfter?: number) { super(m); } }
export const retryAfterMs = (h: string | null | undefined) => {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
};
// Câu báo chung cho sự cố phía nhà cung cấp, để không lẫn với "không phải máy chủ MCP" hay "phiên đăng nhập hết hạn".
export const downText = (host: string, status = 0) => `${host} đang tạm thời không phản hồi${status ? ` (lỗi ${status})` : ""}. Đây là sự cố phía nhà cung cấp; hãy thử lại sau ít phút.`;
// fetch mặc định của Node tự cắt sau 5 phút chờ header hoặc 5 phút không có dữ liệu. Công cụ connector chạy lâu (tới 20 phút) tự đặt hạn riêng,
// nên tắt giới hạn ngầm đó: dựng Agent cùng lớp với dispatcher có sẵn của Node, không thêm thư viện. Không dựng được thì giữ mặc định (cắt ở 5 phút).
let longAgent: unknown;
function longDispatcher(): unknown {
  if (longAgent) return longAgent;
  try {
    const cur = (globalThis as unknown as Record<symbol, { constructor: new (o: object) => unknown } | undefined>)[Symbol.for("undici.globalDispatcher.1")];
    longAgent = cur ? new cur.constructor({ headersTimeout: 0, bodyTimeout: 0 }) : null;
  } catch { longAgent = null; }
  return longAgent;
}
export const allowPrivate = () => process.env.MCP_ALLOW_PRIVATE === "1";

function v4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
// IPv4 nằm trong địa chỉ IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1, NAT64 64:ff9b::…) → lấy ra để kiểm tra như IPv4.
function embeddedV4(x: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(x);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16), lo = parseInt(m[3], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
export function isPrivate(ip: string) {
  if (isIP(ip) === 4) return v4Private(ip);
  const x = ip.toLowerCase();
  const v4 = embeddedV4(x);
  if (v4) return v4Private(v4);
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
}

// Kiểm tra một URL trước khi gọi; ném FetchBlocked kèm lý do dễ hiểu.
export async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchBlocked("Địa chỉ không hợp lệ."); }
  if (u.username || u.password) throw new FetchBlocked("Địa chỉ không được chứa tên đăng nhập hay mật khẩu.");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && allowPrivate())) throw new FetchBlocked("Địa chỉ phải bắt đầu bằng https://");
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new FetchBlocked("Không kết nối được tới địa chỉ nội bộ.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch((e) => {
    // EAI_AGAIN: máy chủ tên miền trả lời chậm, thử lại được; ENOTFOUND mới là tên miền không có thật.
    if ((e as { code?: string }).code === "EAI_AGAIN") throw new TempFail(`Không kết nối được tới ${host}.`);
    throw new FetchBlocked(`Không tìm thấy máy chủ ${host}.`);
  })).map((x) => x.address);
  if (!ips.length || ips.some(isPrivate)) throw new FetchBlocked("Không kết nối được tới địa chỉ nội bộ.");
  return u;
}

// Giống fetch nhưng kiểm tra địa chỉ ở mỗi lần chuyển hướng (tối đa 5 lần) và có thời gian chờ.
// noFollow: trả nguyên phản hồi chuyển hướng (dò trang đăng nhập). secret: tên các header bí mật riêng của lời gọi này (API key của connector).
// Chuyển sang nguồn khác thì bỏ authorization, cookie và các header bí mật, để máy chủ không dùng 307 đẩy token sang tên miền lạ.
export async function safeFetch(raw: string, init: RequestInit & { timeout?: number; noFollow?: boolean; secret?: string[] } = {}): Promise<Response> {
  const { timeout = 20_000, noFollow, secret = [], ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  let url = raw, method = rest.method ?? "GET", body = rest.body, headers = rest.headers;
  // Lời gọi dài hơn 5 phút: bỏ giới hạn ngầm của fetch (xem longDispatcher), hạn thật là timeout / signal ở trên.
  const long = timeout > 290_000 ? longDispatcher() : null;
  for (let hop = 0; hop < 6; hop++) {
    await checkUrl(url);
    const r = await fetch(url, { ...rest, ...(long ? { dispatcher: long } : {}), headers, method, body, signal, redirect: "manual" } as RequestInit).catch((e) => {
      if (signal.aborted && !(signal.reason as Error)?.name?.includes("Timeout") && !(signal.reason instanceof TempFail)) throw e;
      throw new TempFail((e as Error).name === "TimeoutError" || signal.aborted ? "Máy chủ phản hồi quá lâu." : `Không kết nối được tới ${new URL(url).host}.`);
    });
    if (noFollow || r.status < 300 || r.status >= 400 || !r.headers.get("location")) return r;
    const next = new URL(r.headers.get("location")!, url);
    if (next.origin !== new URL(url).origin) {
      const drop = new Set(["authorization", "cookie", "proxy-authorization", ...secret.map((x) => x.toLowerCase())]);
      headers = Object.fromEntries([...new Headers(headers).entries()].filter(([k]) => !drop.has(k)));
    }
    url = next.toString();
    // 301/302/303 chuyển POST thành GET như trình duyệt; 307/308 giữ nguyên.
    if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
  }
  throw new Error("Máy chủ chuyển hướng quá nhiều lần.");
}
