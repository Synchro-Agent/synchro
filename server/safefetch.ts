// fetch an toàn cho địa chỉ do người dùng nhập (connector MCP, máy chủ OAuth): chỉ https, chặn địa chỉ nội bộ
// (localhost, mạng LAN, metadata đám mây) để không ai dùng Synchro gọi vào hạ tầng bên trong, và tự theo chuyển hướng có kiểm tra lại.
// Thử nghiệm cục bộ (npm run dev:mock) đặt MCP_ALLOW_PRIVATE=1 để gọi được máy chủ giả lập ở 127.0.0.1 qua http.
import "server-only";
import { lookup } from "node:dns/promises";
import { lookup as lookupCb } from "node:dns";
import { isIP } from "node:net";

export class FetchBlocked extends Error {}
// Lỗi tạm thời ở phía máy chủ từ xa (mất mạng, quá giờ, 429 / 5xx): thử lại được, không có nghĩa là mất đăng nhập hay sai địa chỉ.
// retryAfter: máy chủ bảo chờ bao lâu (mili giây, từ header Retry-After). timedOut: quá giờ chờ, khác với mất kết nối ngay (thử lại thường chỉ chờ thêm một lần nữa).
export class TempFail extends Error { constructor(m: string, public status = 0, public retryAfter?: number, public timedOut = false) { super(m); } }
export const retryAfterMs = (h: string | null | undefined) => {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
};
// Câu báo chung cho sự cố phía nhà cung cấp, để không lẫn với "không phải máy chủ MCP" hay "phiên đăng nhập hết hạn".
export const downText = (host: string, status = 0) => `${host} đang tạm thời không phản hồi${status ? ` (lỗi ${status})` : ""}. Đây là sự cố phía nhà cung cấp; hãy thử lại sau ít phút.`;
export const allowPrivate = () => process.env.MCP_ALLOW_PRIVATE === "1";

// Chống DNS rebinding (TOCTOU): checkUrl phân giải tên miền rồi fetch phân giải LẠI lúc kết nối — kẽ hở để tên miền
// đổi sang IP nội bộ giữa hai lần. Dispatcher dưới ghim việc phân giải vào đúng lúc kết nối: cùng một lần tra cứu vừa
// chặn IP nội bộ vừa là IP thật được dùng để nối, nên không còn khoảng trống đổi IP. Dựng Agent cùng lớp với dispatcher
// có sẵn của Node (không thêm thư viện); dựng không được thì trả null và fetch dùng mặc định (checkUrl vẫn chặn trước khi gọi).
// IP dạng literal không đi qua lookup (undici nối thẳng) nhưng literal không thể đổi nên checkUrl đã đủ.
function safeLookup(hostname: string, options: unknown, cb: (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void): void {
  const o = (options && typeof options === "object" ? options : {}) as { all?: boolean; family?: number; hints?: number };
  lookupCb(hostname, { all: true, family: o.family, hints: o.hints }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!list.length) return cb(new FetchBlocked(`Không tìm thấy máy chủ ${hostname}.`));
    if (!allowPrivate() && list.some((a) => isPrivate(a.address))) return cb(new FetchBlocked("Không kết nối được tới địa chỉ nội bộ."));
    if (o.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
// fetch mặc định của Node tự cắt sau 5 phút chờ header hoặc 5 phút không có dữ liệu. Công cụ connector chạy lâu (tới 20 phút) tự đặt hạn riêng,
// nên tắt giới hạn ngầm đó khi cần (long). Hai Agent dùng lại: thường và "long" (bỏ headersTimeout / bodyTimeout).
const agents: Record<"short" | "long", unknown> = { short: undefined, long: undefined };
function pinnedDispatcher(long: boolean): unknown {
  const key = long ? "long" : "short";
  if (agents[key] !== undefined) return agents[key];
  try {
    const cur = (globalThis as unknown as Record<symbol, { constructor: new (o: object) => unknown } | undefined>)[Symbol.for("undici.globalDispatcher.1")];
    agents[key] = cur ? new cur.constructor({ connect: { lookup: safeLookup }, ...(long ? { headersTimeout: 0, bodyTimeout: 0 } : {}) }) : null;
  } catch { agents[key] = null; }
  return agents[key];
}
// Trần đọc mặc định: phản hồi không được vượt quá 10MB (lời gọi luồng dài như SSE tự đặt maxBytes: 0 để bỏ trần).
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
function capBody(res: Response, maxBytes: number): Response {
  if (!res.body || maxBytes <= 0) return res;
  let seen = 0;
  const ts = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) { controller.error(new FetchBlocked(`Phản hồi vượt quá ${Math.round(maxBytes / 1048576)}MB.`)); return; }
      controller.enqueue(chunk);
    },
  });
  const wrapped = new Response(res.body.pipeThrough(ts), { status: res.status, statusText: res.statusText, headers: res.headers });
  // Response dựng lại mất .url (mặc định ""), mà connicons dùng nó để giải địa chỉ icon tương đối sau chuyển hướng: giữ lại.
  try { Object.defineProperty(wrapped, "url", { value: res.url, configurable: true }); } catch { /* chỉ đọc: bỏ qua */ }
  return wrapped;
}
// Hạn giờ gộp với tín hiệu bên ngoài. AbortSignal.any chỉ giữ tín hiệu nguồn bằng tham chiếu yếu: GC thu tín hiệu hạn giờ thì hạn không bao giờ nổ (đo được trên Node 22.11).
// Có người nghe thì Node giữ nó sống tới lúc nổ.
export function timeLimit(ms: number, outer?: AbortSignal | null): AbortSignal {
  const lim = AbortSignal.timeout(ms);
  lim.addEventListener("abort", () => {}, { once: true });
  return outer ? AbortSignal.any([outer, lim]) : lim;
}

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
  // fc/fd ULA · fe8-feb link-local (fe80::/10) · fec-fef site-local cũ (fec0::/10) · ff00::/8 multicast · 2002::/16 6to4 (nhúng IPv4, có thể trỏ vào mạng trong).
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd")
    || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb")
    || x.startsWith("fec") || x.startsWith("fed") || x.startsWith("fee") || x.startsWith("fef")
    || x.startsWith("ff") || x.startsWith("2002:");
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
export async function safeFetch(raw: string, init: RequestInit & { timeout?: number; noFollow?: boolean; secret?: string[]; maxBytes?: number } = {}): Promise<Response> {
  const { timeout = 20_000, noFollow, secret = [], maxBytes = DEFAULT_MAX_BYTES, ...rest } = init;
  const signal = timeLimit(timeout, rest.signal);
  let url = raw, method = rest.method ?? "GET", body = rest.body, headers = rest.headers;
  // Dispatcher ghim phân giải tên miền lúc kết nối (chống rebinding); lời gọi dài hơn 5 phút thì bỏ cả giới hạn ngầm của fetch.
  const dispatcher = pinnedDispatcher(timeout > 290_000);
  for (let hop = 0; hop < 6; hop++) {
    await checkUrl(url);
    const r = await fetch(url, { ...rest, ...(dispatcher ? { dispatcher } : {}), headers, method, body, signal, redirect: "manual" } as RequestInit).catch((e) => {
      // Lookup ghim chặn IP nội bộ: undici bọc lỗi connect vào .cause, trả nguyên FetchBlocked để báo đúng lý do.
      if (e instanceof FetchBlocked) throw e;
      if ((e as { cause?: unknown }).cause instanceof FetchBlocked) throw (e as { cause: FetchBlocked }).cause;
      if (signal.aborted && !(signal.reason as Error)?.name?.includes("Timeout") && !(signal.reason instanceof TempFail)) throw e;
      const late = (e as Error).name === "TimeoutError" || signal.aborted;
      throw new TempFail(late ? "Máy chủ phản hồi quá lâu." : `Không kết nối được tới ${new URL(url).host}.`, 0, undefined, late);
    });
    if (noFollow || r.status < 300 || r.status >= 400 || !r.headers.get("location")) return capBody(r, maxBytes);
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
