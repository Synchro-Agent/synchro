// Kết nối GitHub cho Synchro Code: lưu token (mã hóa) của người dùng để clone / push repo riêng tư.
// Token không bao giờ gửi về trình duyệt và không ghi vào repo trong container.
import crypto from "node:crypto";
import { AuthError, db } from "./authstore";

const KEY = crypto.createHash("sha256").update(`synchro-gh:${process.env.DATA_KEY ?? process.env.GITHUB_CLIENT_SECRET ?? "dev"}`).digest();
function enc(s: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function dec(s: string) {
  const b = Buffer.from(s, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

type Row = { user_id: string; gh_id: string; login: string; token: string; scopes: string; created_at: number };
export function saveLink(uid: string, o: { id: string; login: string; token: string; scopes: string }) {
  db().prepare(`INSERT INTO github_links (user_id, gh_id, login, token, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET gh_id = excluded.gh_id, login = excluded.login, token = excluded.token, scopes = excluded.scopes, created_at = excluded.created_at`)
    .run(uid, o.id, o.login, enc(o.token), o.scopes, Date.now());
}
export function getLink(uid: string) {
  const r = db().prepare("SELECT * FROM github_links WHERE user_id = ?").get(uid) as Row | undefined;
  if (!r) return null;
  try { return { id: r.gh_id, login: r.login, token: dec(r.token), scopes: r.scopes, createdAt: r.created_at }; } catch { return null; }
}
export const removeLink = (uid: string) => db().prepare("DELETE FROM github_links WHERE user_id = ?").run(uid);

export async function gh<T = unknown>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
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
  const t = String(s ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = t.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/(?:tree|blob)\/.*)?$/);
  if (!m) throw new AuthError("Link repo GitHub không hợp lệ. Ví dụ: owner/repo hoặc https://github.com/owner/repo", 400);
  return { owner: m[1], name: m[2] };
}

// Biến môi trường cho git trong container: gửi token qua header HTTP, không lưu vào .git/config.
export const gitAuthEnv = (token: string): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
});
