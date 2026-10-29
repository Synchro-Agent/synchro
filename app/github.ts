// Kết nối GitHub cho Synchro Code và Dự án: lưu token (mã hóa) của người dùng để đọc / clone / push repo riêng tư.
// Token không bao giờ gửi về trình duyệt và không ghi vào repo trong container.
// Giữ kết nối lâu dài: mã hóa bằng khóa dữ liệu cố định của máy chủ (không đổi khi đổi GitHub client secret),
// tự làm mới token có hạn (GitHub App: 8 giờ, kèm refresh token 6 tháng) và dùng token định kỳ để GitHub không thu hồi
// token bị bỏ không quá một năm. Chỉ khi bạn tự thu hồi quyền trên GitHub thì mới phải kết nối lại.
import crypto from "node:crypto";
import { AuthError, db } from "./authstore";
import { openSecret, sealSecret } from "./providers";

// Địa chỉ GitHub: mặc định github.com; dev:mock trỏ vào GitHub giả lập (scripts/mock-github.mjs) để chạy thử đủ luồng repo / PR.
export const GH_WEB = (process.env.GITHUB_WEB_URL || "https://github.com").replace(/\/$/, "");
export const GH_API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
export const GH_GIT = (process.env.GITHUB_GIT_URL || GH_WEB).replace(/\/$/, "");
/** "owner/name" của remote git (https://github.com/…, git@github.com:…, hay địa chỉ GH_GIT), null nếu không phải GitHub. */
export function repoOfRemote(remote: string | null | undefined) {
  const r = String(remote ?? "").trim().replace(/^https?:\/\/[^@/]*@/, (m) => m.replace(/[^/]*@$/, ""));
  if (r.startsWith(GH_GIT + "/")) return /^([^/]+\/[^/]+?)(\.git)?\/?$/.exec(r.slice(GH_GIT.length + 1))?.[1] ?? null;
  return /github\.com[/:]([^/]+\/[^/.\s]+)/.exec(r)?.[1] ?? null;
}

// Khóa cũ (theo GITHUB_CLIENT_SECRET): chỉ còn để đọc token lưu từ trước rồi mã hóa lại bằng khóa dữ liệu.
const OLD_KEY = crypto.createHash("sha256").update(`synchro-gh:${process.env.DATA_KEY ?? process.env.GITHUB_CLIENT_SECRET ?? "dev"}`).digest();
const enc = (s: string) => sealSecret(s);
function decOld(s: string) {
  const b = Buffer.from(s, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", OLD_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// Token mới: "iv.tag.dữ liệu" (khóa dữ liệu); token cũ: một chuỗi base64url (khóa theo client secret).
const dec = (s: string) => (s.includes(".") ? openSecret(s) : decOld(s));

type Row = { user_id: string; gh_id: string; login: string; token: string; scopes: string; created_at: number;
  refresh: string | null; expires_at: number | null; refresh_expires_at: number | null; checked_at: number | null; broken: number };
let cols = false;
const links = () => {
  const d = db();
  if (!cols) {
    const have = new Set((d.prepare("PRAGMA table_info(github_links)").all() as { name: string }[]).map((c) => c.name));
    for (const [c, t] of [["refresh", "TEXT"], ["expires_at", "INTEGER"], ["refresh_expires_at", "INTEGER"], ["checked_at", "INTEGER"], ["broken", "INTEGER NOT NULL DEFAULT 0"]])
      if (!have.has(c)) d.exec(`ALTER TABLE github_links ADD COLUMN ${c} ${t}`);
    cols = true;
  }
  return d;
};
export type LinkIn = { id: string; login: string; token: string; scopes: string; refresh?: string; expiresIn?: number; refreshExpiresIn?: number };
export function saveLink(uid: string, o: LinkIn) {
  const now = Date.now();
  links().prepare(`INSERT INTO github_links (user_id, gh_id, login, token, scopes, created_at, refresh, expires_at, refresh_expires_at, checked_at, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id) DO UPDATE SET gh_id = excluded.gh_id, login = excluded.login, token = excluded.token, scopes = excluded.scopes, created_at = excluded.created_at,
      refresh = excluded.refresh, expires_at = excluded.expires_at, refresh_expires_at = excluded.refresh_expires_at, checked_at = excluded.checked_at, broken = 0`)
    .run(uid, o.id, o.login, enc(o.token), o.scopes, now, o.refresh ? enc(o.refresh) : null, o.expiresIn ? now + o.expiresIn * 1000 : null, o.refreshExpiresIn ? now + o.refreshExpiresIn * 1000 : null, now);
}
export function getLink(uid: string) {
  const r = links().prepare("SELECT * FROM github_links WHERE user_id = ?").get(uid) as Row | undefined;
  if (!r) return null;
  try {
    const token = dec(r.token);
    // Token lưu bằng khóa cũ: mã hóa lại bằng khóa dữ liệu để đổi GitHub client secret không làm mất kết nối.
    if (!r.token.includes(".")) links().prepare("UPDATE github_links SET token = ?, refresh = ? WHERE user_id = ?").run(enc(token), r.refresh ? enc(dec(r.refresh)) : null, uid);
    return { id: r.gh_id, login: r.login, token, scopes: r.scopes, createdAt: r.created_at, expiresAt: r.expires_at, broken: !!r.broken };
  } catch { return null; }
}
export const removeLink = (uid: string) => links().prepare("DELETE FROM github_links WHERE user_id = ?").run(uid);

// Làm mới token có hạn bằng refresh token (mỗi lần làm mới GitHub cấp refresh token mới, nên kết nối tự gia hạn mãi).
async function refreshLink(r: Row): Promise<boolean> {
  if (!r.refresh) return false;
  const res = await fetch(`${GH_WEB}/login/oauth/access_token`, {
    method: "POST", headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: dec(r.refresh), client_id: process.env.GITHUB_CLIENT_ID ?? "", client_secret: process.env.GITHUB_CLIENT_SECRET ?? "" }),
  }).catch(() => null);
  const j = (await res?.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string };
  if (!j?.access_token) return false;
  saveLink(r.user_id, { id: r.gh_id, login: r.login, token: j.access_token, scopes: j.scope ?? r.scopes, refresh: j.refresh_token, expiresIn: j.expires_in, refreshExpiresIn: j.refresh_token_expires_in });
  return true;
}
/** Chạy định kỳ ở máy chủ: làm mới token sắp hết hạn, và mỗi tuần dùng thử token (GET /user) để GitHub không thu hồi vì bỏ không. */
export async function keepLinksAlive() {
  if (!process.env.GITHUB_CLIENT_ID) return;
  const now = Date.now();
  for (const r of links().prepare("SELECT * FROM github_links").all() as Row[]) {
    try {
      if (r.refresh && r.expires_at && r.expires_at - now < 60 * 60_000) { if (await refreshLink(r)) continue; }
      if (r.checked_at && now - r.checked_at < 7 * 86400_000) continue;
      const res = await fetch(`${GH_API}/user`, { headers: { Authorization: `Bearer ${dec(r.token)}`, Accept: "application/vnd.github+json", "User-Agent": "Synchro" }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 && (await refreshLink(r))) continue;
      if (res.ok || res.status === 401) links().prepare("UPDATE github_links SET checked_at = ?, broken = ? WHERE user_id = ?").run(now, res.status === 401 ? 1 : 0, r.user_id);
    } catch (e) { console.warn("[github] giữ kết nối", (e as Error).message); }
  }
}

export async function gh<T = unknown>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Synchro", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j as { message?: string }).message ?? `GitHub ${r.status}`;
    throw new AuthError(r.status === 401 ? "Kết nối GitHub đã hết hạn. Hãy kết nối lại." : r.status === 404 ? "Không tìm thấy repo (hoặc bạn chưa cấp quyền cho repo này)." : `GitHub: ${m}`, r.status === 401 ? 401 : r.status === 404 ? 404 : 502);
  }
  return j as T;
}

// "owner/name", "https://github.com/owner/name(.git)", "git@github.com:owner/name.git" -> { owner, name }
export function parseRepo(s: unknown) {
  let t = String(s ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (t.startsWith(GH_WEB + "/")) t = t.slice(GH_WEB.length + 1);
  const m = t.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/(?:tree|blob)\/.*)?$/);
  if (!m) throw new AuthError("Link repo GitHub không hợp lệ. Ví dụ: owner/repo hoặc https://github.com/owner/repo", 400);
  return { owner: m[1], name: m[2] };
}

// Biến môi trường cho git trong container: gửi token qua header HTTP, không lưu vào .git/config.
export const gitAuthEnv = (token: string): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: `http.${GH_GIT}/.extraheader`,
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
});
