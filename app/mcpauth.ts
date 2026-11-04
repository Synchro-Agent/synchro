// Đăng nhập OAuth cho connector theo đặc tả ủy quyền của MCP (chỉ chạy ở máy chủ):
// tìm máy chủ đăng nhập qua Protected Resource Metadata (RFC 9728) → metadata của máy chủ đăng nhập (RFC 8414 / OpenID),
// đăng ký Synchro (Client ID Metadata Document → Client ID nhập tay → đăng ký động RFC 7591), PKCE S256,
// tham số resource (RFC 8707), kiểm tra iss khi quay về (RFC 9207), đổi mã lấy token và làm mới token.
import crypto from "node:crypto";
import { allowPrivate, downText, retryAfterMs, safeFetch, TempFail } from "./safefetch";

export type AsMeta = {
  issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string;
  scopes_supported?: string[]; code_challenge_methods_supported?: string[]; client_id_metadata_document_supported?: boolean;
  authorization_response_iss_parameter_supported?: boolean; token_endpoint_auth_methods_supported?: string[];
};
export type OAuthClient = { client_id: string; client_secret?: string; auth_method: "none" | "client_secret_post" | "client_secret_basic" };
export type Tokens = { access_token: string; refresh_token?: string; expires_at?: number; scope?: string };

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (n = 32) => b64url(crypto.randomBytes(n));
export const pkceChallenge = (verifier: string) => b64url(crypto.createHash("sha256").update(verifier).digest());

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
// Trạng thái có thể thử lại: 408, 425, 429 và lỗi 5xx (trừ 501, 505 là máy chủ thật sự không hỗ trợ).
export const retryableStatus = (s: number) => s === 408 || s === 425 || s === 429 || (s >= 500 && s !== 501 && s !== 505);
// Đọc metadata. seen.down: máy chủ đang lỗi tạm thời (5xx, mất mạng), khác với "không có tài liệu này" (404): chỉ khi chắc chắn không có mới đoán đường dẫn mặc định.
async function getJson(u: string, seen?: { down?: { host: string; status: number } }): Promise<Record<string, unknown> | null> {
  const host = new URL(u).host;
  for (let i = 0; ; i++) {
    try {
      const r = await safeFetch(u, { headers: { accept: "application/json" }, timeout: 15_000 });
      if (retryableStatus(r.status)) {
        await r.body?.cancel();
        if (i < 2) { await sleep(Math.min(retryAfterMs(r.headers.get("retry-after")) ?? 500 * 3 ** i, 10_000)); continue; }
        if (seen) seen.down = { host, status: r.status };
        return null;
      }
      if (!r.ok) { await r.body?.cancel(); return null; }
      const j = await r.json().catch(() => null);
      return j && typeof j === "object" ? j : null;
    } catch (e) {
      if (!(e instanceof TempFail)) return null;
      if (i < 2) { await sleep(500 * 3 ** i); continue; }
      if (seen) seen.down = { host, status: 0 };
      return null;
    }
  }
}
// Địa chỉ đăng nhập do máy chủ connector khai báo: chỉ nhận https (http chỉ khi thử nghiệm cục bộ). Nó được mở trong cửa sổ cùng nguồn với Synchro,
// nên một địa chỉ javascript: sẽ chạy mã bằng phiên của người dùng.
function checkEndpoint(raw: unknown, what: string) {
  let u: URL | null = null;
  try { u = new URL(String(raw)); } catch {}
  if (!u || !(u.protocol === "https:" || (u.protocol === "http:" && allowPrivate()))) throw new Error(`Máy chủ đăng nhập của connector khai báo địa chỉ ${what} không an toàn (phải là https).`);
}

// Đọc các tham số trong WWW-Authenticate: Bearer resource_metadata="…", scope="…", error="…"
export function parseWww(h: string) {
  const o: Record<string, string> = {};
  for (const m of h.matchAll(/([a-zA-Z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) o[m[1].toLowerCase()] = (m[2] ?? m[3]).replace(/\\(.)/g, "$1");
  return o;
}

// Địa chỉ chuẩn của máy chủ MCP dùng cho tham số resource: bỏ fragment, bỏ dấu / ở cuối.
export const canonical = (u: string) => { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); };
const sameIssuer = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

export type Discovery = { resource: string; as: AsMeta; scope?: string };

export async function discover(mcpUrl: string, www = ""): Promise<Discovery> {
  const u = new URL(mcpUrl);
  const w = parseWww(www);
  const path = u.pathname.replace(/\/$/, "");
  // 1) Protected Resource Metadata: theo header, rồi đường dẫn có path, rồi gốc tên miền.
  const prmUrls = [w.resource_metadata, path ? `${u.origin}/.well-known/oauth-protected-resource${path}` : "", `${u.origin}/.well-known/oauth-protected-resource`].filter(Boolean);
  const seen: { down?: { host: string; status: number } } = {};
  let prm: Record<string, unknown> | null = null;
  for (const x of prmUrls) { prm = await getJson(x, seen); if (prm && (Array.isArray(prm.authorization_servers) || prm.resource)) break; prm = null; }
  // Tài liệu phải nói về đúng máy chủ này (cùng tên miền), tránh bị chỉ sang máy chủ đăng nhập lạ.
  if (prm?.resource && new URL(String(prm.resource)).origin !== u.origin) prm = null;
  const asId = (Array.isArray(prm?.authorization_servers) && prm!.authorization_servers[0] ? String(prm!.authorization_servers[0]) : u.origin);
  // 2) Metadata của máy chủ đăng nhập: OAuth trước, OpenID sau (có path thì thử cả hai kiểu chèn path).
  const a = new URL(asId);
  const ap = a.pathname.replace(/\/$/, "");
  const asUrls = ap
    ? [`${a.origin}/.well-known/oauth-authorization-server${ap}`, `${a.origin}/.well-known/openid-configuration${ap}`, `${a.origin}${ap}/.well-known/openid-configuration`]
    : [`${a.origin}/.well-known/oauth-authorization-server`, `${a.origin}/.well-known/openid-configuration`];
  let md: AsMeta | null = null;
  for (const x of asUrls) { const j = await getJson(x, seen); if (j?.authorization_endpoint && j?.token_endpoint) { md = j as unknown as AsMeta; break; } }
  // Máy chủ đăng nhập đang lỗi tạm thời: báo đúng là sự cố tạm thời, không đoán đường dẫn rồi đưa người dùng tới trang 404 của hãng.
  if (!md && seen.down) throw new TempFail(downText(seen.down.host, seen.down.status), seen.down.status);
  // Máy chủ đời 2025-03-26 không có metadata: dùng đường dẫn mặc định ngay trên máy chủ MCP.
  if (!md && !prm) md = { issuer: u.origin, authorization_endpoint: `${u.origin}/authorize`, token_endpoint: `${u.origin}/token`, registration_endpoint: `${u.origin}/register` };
  if (!md) throw new Error("Không tìm thấy máy chủ đăng nhập (OAuth) của connector này.");
  md.issuer = md.issuer || asId;
  checkEndpoint(md.authorization_endpoint, "đăng nhập");
  checkEndpoint(md.token_endpoint, "lấy mã truy cập");
  if (md.registration_endpoint) checkEndpoint(md.registration_endpoint, "đăng ký ứng dụng");
  if (md.code_challenge_methods_supported?.length && !md.code_challenge_methods_supported.includes("S256")) throw new Error("Máy chủ đăng nhập của connector không hỗ trợ PKCE S256 nên không an toàn để kết nối.");
  const scopes = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as string[]) : [];
  return { resource: prm?.resource ? String(prm.resource) : canonical(mcpUrl), as: md, scope: w.scope || (scopes.length ? scopes.join(" ") : undefined) };
}

// Lấy client_id cho Synchro ở máy chủ đăng nhập này, theo thứ tự ưu tiên của đặc tả.
export async function registerClient(as: AsMeta, redirectUri: string, metadataUrl: string | null, preset?: { clientId?: string; clientSecret?: string }): Promise<OAuthClient> {
  if (preset?.clientId) {
    const m = as.token_endpoint_auth_methods_supported;
    const method = !preset.clientSecret ? "none" : m && !m.includes("client_secret_post") && m.includes("client_secret_basic") ? "client_secret_basic" : "client_secret_post";
    return { client_id: preset.clientId, client_secret: preset.clientSecret || undefined, auth_method: method };
  }
  if (metadataUrl && as.client_id_metadata_document_supported) return { client_id: metadataUrl, auth_method: "none" };
  if (as.registration_endpoint) {
    const r = await safeFetch(as.registration_endpoint, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, timeout: 20_000,
      body: JSON.stringify({ client_name: "Synchro", client_uri: new URL(redirectUri).origin, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
    });
    const j = (await r.json().catch(() => null)) as Record<string, string> | null;
    const host = new URL(as.registration_endpoint).hostname;
    if (retryableStatus(r.status)) throw new TempFail(downText(host, r.status), r.status, retryAfterMs(r.headers.get("retry-after")));
    // 401 / 403, hay 400 chê địa chỉ quay về: nhà cung cấp chỉ cho ứng dụng họ đã duyệt kết nối (vd. Figma chỉ mở MCP từ xa cho Claude, Cursor, VS Code…; Square, Intercom có danh sách tên miền) — không phải lỗi mạng hay lỗi của Synchro.
    if ((r.status === 401 || r.status === 403 || /redirect/i.test(`${j?.error ?? ""} ${j?.error_description ?? ""}`)) && !j?.client_id) throw new Error(`${host} chỉ cho các ứng dụng được họ duyệt kết nối và chưa duyệt Synchro (lỗi ${r.status}). Nếu nhà cung cấp cấp cho bạn OAuth Client ID, thêm bằng "Thêm connector tùy chỉnh" → Cài đặt nâng cao.`);
    if (!r.ok || !j?.client_id) throw new Error(`Máy chủ đăng nhập từ chối đăng ký Synchro${j?.error_description ? `: ${String(j.error_description).replace(/[.\s]+$/, "")}` : ` (lỗi ${r.status})`}.`);
    const method = j.client_secret ? (j.token_endpoint_auth_method === "client_secret_basic" ? "client_secret_basic" : "client_secret_post") : "none";
    return { client_id: j.client_id, client_secret: j.client_secret || undefined, auth_method: method };
  }
  throw new Error("Connector này không cho ứng dụng tự đăng ký. Hãy xóa rồi thêm lại bằng \"Thêm connector tùy chỉnh\" và nhập OAuth Client ID ở phần Cài đặt nâng cao.");
}

export function authorizeUrl(as: AsMeta, client: OAuthClient, o: { redirectUri: string; state: string; verifier: string; resource: string; scope?: string }) {
  const u = new URL(as.authorization_endpoint);
  const scopes = new Set((o.scope ?? "").split(/\s+/).filter(Boolean));
  // Xin refresh token bất cứ khi nào máy chủ đăng nhập hỗ trợ, kể cả khi chưa biết quyền nào khác: thiếu nó thì người dùng phải đăng nhập lại mỗi lần token hết hạn.
  if (as.scopes_supported?.includes("offline_access")) scopes.add("offline_access");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client.client_id);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("code_challenge", pkceChallenge(o.verifier));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", o.state);
  u.searchParams.set("resource", o.resource);
  if (scopes.size) u.searchParams.set("scope", [...scopes].join(" "));
  return u.toString();
}

// Dò trước trang đăng nhập bằng một state dùng một lần (không theo chuyển hướng): hãng từ chối thẳng client hay địa chỉ quay về thì người dùng không phải
// nhìn trang lỗi của hãng rồi quay lại với connector "Cần kết nối" không giải thích gì (Canva: 400 "Invalid redirect URI"). Chỉ coi là từ chối khi hãng NÓI RÕ
// điều đó; mọi trường hợp khác (200, chuyển hướng tới trang đăng nhập, 4xx mơ hồ, tường lửa chặn máy chủ, mất mạng) đều cho qua như trước, không để sót hãng đang chạy tốt.
export const REJECT_TEXT = /invalid[_\s-]*(redirect|client)|redirect[_\s-]*ur[il]\b.{0,40}(invalid|mismatch|not\s+(allowed|registered|valid|match))|unauthorized[_\s-]*client|unknown[_\s-]*client|client.{0,20}not\s+(found|registered)/i;
export async function authorizeRejected(as: AsMeta, client: OAuthClient, o: { redirectUri: string; resource: string; scope?: string }): Promise<string | null> {
  try {
    const url = authorizeUrl(as, client, { ...o, state: randomToken(16), verifier: randomToken(32) });
    const r = await safeFetch(url, { noFollow: true, timeout: 8_000, headers: { accept: "text/html,application/json" } });
    if (r.status >= 300 && r.status < 400) {
      await r.body?.cancel();
      const loc = r.headers.get("location") ?? "";
      if (!loc.startsWith(o.redirectUri)) return null;
      const err = new URL(loc).searchParams.get("error") ?? "";
      return /^(invalid_client|unauthorized_client|invalid_redirect_uri)$/.test(err) ? err : null;
    }
    if (r.status < 400 || r.status >= 500) { await r.body?.cancel(); return null; }
    const text = (await r.text()).slice(0, 64_000);
    const m = REJECT_TEXT.exec(text);
    return m ? m[0].replace(/\s+/g, " ").slice(0, 80) : null;
  } catch { return null; }
}

// RFC 9207: có iss thì phải trùng máy chủ đã chọn; máy chủ đã hứa gửi iss mà thiếu thì từ chối.
export function checkIssuer(as: Pick<AsMeta, "issuer" | "authorization_response_iss_parameter_supported">, iss: string | null) {
  if (iss !== null) return iss === as.issuer;
  return !as.authorization_response_iss_parameter_supported;
}

// Máy chủ đăng nhập trả lời rõ là không dùng được nữa (invalid_grant, invalid_client…): phải đăng nhập lại. Lỗi 5xx, 429, mất mạng thì là TempFail: đăng nhập vẫn còn nguyên.
export class TokenRejected extends Error { constructor(m: string, public oauth: string) { super(m); } }
async function tokenRequest(as: Pick<AsMeta, "token_endpoint">, client: OAuthClient, form: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (client.auth_method === "client_secret_basic") headers.authorization = "Basic " + Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret ?? "")}`).toString("base64");
  else { body.set("client_id", client.client_id); if (client.auth_method === "client_secret_post" && client.client_secret) body.set("client_secret", client.client_secret); }
  const r = await safeFetch(as.token_endpoint, { method: "POST", headers, body: body.toString(), timeout: 20_000 });
  const text = await r.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { j = Object.fromEntries(new URLSearchParams(text)); }
  if (!r.ok || !j?.access_token) {
    const code = String(j?.error ?? "");
    const host = new URL(as.token_endpoint).host;
    // Không có mã lỗi OAuth rõ ràng (trang lỗi của proxy, tường lửa), hay lỗi hãng tự nói là tạm thời: chưa thể kết luận đăng nhập đã mất.
    if (retryableStatus(r.status) || !code || code === "temporarily_unavailable" || code === "server_error" || code === "slow_down") throw new TempFail(downText(host, r.status), r.status, retryAfterMs(r.headers.get("retry-after")));
    throw new TokenRejected(String(j?.error_description || code), code);
  }
  const exp = Number(j.expires_in);
  return { access_token: String(j.access_token), refresh_token: j.refresh_token ? String(j.refresh_token) : undefined, expires_at: exp > 0 ? Date.now() + exp * 1000 : undefined, scope: j.scope ? String(j.scope) : undefined };
}

export const exchangeCode = (as: Pick<AsMeta, "token_endpoint">, client: OAuthClient, o: { code: string; verifier: string; redirectUri: string; resource: string }) =>
  tokenRequest(as, client, { grant_type: "authorization_code", code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, resource: o.resource });

export const refreshTokens = (as: Pick<AsMeta, "token_endpoint">, client: OAuthClient, o: { refreshToken: string; resource: string; scope?: string }) =>
  tokenRequest(as, client, { grant_type: "refresh_token", refresh_token: o.refreshToken, resource: o.resource, ...(o.scope ? { scope: o.scope } : {}) });
