// Mọi repo GitHub người dùng truy cập được: của mình, được mời cộng tác, và của các tổ chức
// (kể cả repo vừa chuyển sang tổ chức). GitHub chỉ trả repo của tổ chức khi token đủ điều kiện,
// và nhiều tổ chức chặn ứng dụng ngoài theo mặc định:
// - OAuth App: tổ chức bật "OAuth App access restrictions" thì repo riêng tư của tổ chức biến khỏi danh sách
//   và clone báo "not found", tới khi chủ tổ chức bấm Grant ở trang ứng dụng đã cấp quyền.
//   Thiếu quyền read:org thì tổ chức để chế độ thành viên riêng tư không hiện trong /user/orgs.
// - GitHub App: chỉ thấy repo của tài khoản / tổ chức đã cài app; quyền theo cài đặt app, không theo scope.
// - Tổ chức bật SAML SSO: token phải được cho phép riêng cho tổ chức đó
//   (GitHub gửi kèm đường dẫn trong header X-GitHub-SSO).
// Mô-đun này gom đủ các nguồn, nhận ra từng trường hợp chặn và trả đường dẫn sửa đúng chỗ
// thay vì một câu "không tìm thấy".
import "server-only";
import crypto from "node:crypto";
import { AuthError } from "./authstore";
import { GH_API, GH_WEB } from "./github";

export type GhKind = "oauth" | "app";
// Cách GitHub đang chặn một tổ chức: oauth = OAuth App access restrictions, sso = SAML SSO,
// app = GitHub App chưa cài.
export type Block = "oauth" | "sso" | "app";
export type RepoOut = {
  full: string; owner: string; private: boolean; branch: string; desc: string | null; pushed: string; url: string;
  push: boolean;
};
export type Group = { owner: string; type: "user" | "org"; count: number; block?: Block; fixUrl?: string };
export type Listing = { repos: RepoOut[]; groups: Group[]; scopes: string | null; truncated: boolean };

// Đủ cho hầu hết tài khoản; trần số trang để một tài khoản cực lớn không giữ yêu cầu quá lâu.
const USER_PAGES = 30, ORG_PAGES = 10, MAX_ORGS = 40;
const RESTRICTED = /OAuth App access restrictions/i;
const NOT_INSTALLED = /Resource not accessible by integration/i;
const expired = () => new AuthError("Kết nối GitHub đã hết hạn. Hãy kết nối lại.", 401, { reconnect: true });

// GitHub App cấp token người dùng có tiền tố ghu_, OAuth App cấp gho_ (token cũ không tiền tố cũng là OAuth App).
export const tokenKind = (token: string): GhKind => (token.startsWith("ghu_") ? "app" : "oauth");
const scopeList = (s: string | null | undefined) => String(s ?? "").split(/[\s,]+/).filter(Boolean);
/** Quyền OAuth còn thiếu để thấy mọi repo: repo (repo riêng tư) và read:org (tổ chức để thành viên riêng tư). */
export function missingScopes(kind: GhKind, scopes: string | null | undefined): string[] {
  if (kind === "app") return [];
  const s = new Set(scopeList(scopes));
  const out: string[] = [];
  if (!s.has("repo")) out.push("repo");
  if (!s.has("read:org") && !s.has("write:org") && !s.has("admin:org")) out.push("read:org");
  return out;
}
/** Trang GitHub để sửa: OAuth App là trang ứng dụng đã cấp quyền (có nút Grant / Request cạnh từng tổ chức);
 *  GitHub App là trang cài app vào tổ chức. */
export function fixUrlFor(kind: GhKind) {
  if (kind === "oauth") {
    const id = process.env.GITHUB_CLIENT_ID?.trim();
    if (id) return `${GH_WEB}/settings/connections/applications/${encodeURIComponent(id)}`;
    return `${GH_WEB}/settings/applications`;
  }
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  return slug ? `${GH_WEB}/apps/${encodeURIComponent(slug)}/installations/new` : `${GH_WEB}/settings/installations`;
}

type Res<T> = {
  ok: boolean; status: number; data: T | null; next: string | null; scopes: string | null; sso: string | null;
  message: string;
};
// Link: <https://api.github.com/user/repos?page=2>; rel="next". Chỉ theo trang kế khi nó vẫn ở máy chủ API,
// để token không bao giờ đi tới nơi khác.
function nextLink(h: string | null) {
  const m = /<([^>]+)>;\s*rel="next"/.exec(h ?? "");
  if (!m) return null;
  return m[1].startsWith(GH_API + "/") ? m[1].slice(GH_API.length) : null;
}
// X-GitHub-SSO: required; url=https://github.com/orgs/x/sso?authorization_request=…
const ssoUrl = (h: string | null) => {
  const u = /url=(\S+)/.exec(h ?? "")?.[1] ?? null;
  return u && u.startsWith(GH_WEB + "/") ? u : null;
};

async function call<T>(token: string, p: string, init: RequestInit = {}): Promise<Res<T>> {
  const r = await fetch(`${GH_API}${p}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Synchro", "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = (await r.json().catch(() => null)) as T | null;
  const message = String((data as { message?: unknown } | null)?.message ?? "");
  return { ok: r.ok, status: r.status, data: r.ok ? data : null, next: nextLink(r.headers.get("link")),
    scopes: r.headers.get("x-oauth-scopes"), sso: ssoUrl(r.headers.get("x-github-sso")), message };
}

type RawRepo = { full_name: string; private: boolean; default_branch: string; description: string | null;
  pushed_at: string | null; html_url: string; permissions?: { push?: boolean };
  owner?: { login?: string; type?: string } };
const out = (r: RawRepo): RepoOut => ({
  full: r.full_name, owner: r.owner?.login ?? r.full_name.split("/")[0], private: !!r.private, branch: r.default_branch,
  desc: r.description, pushed: r.pushed_at ?? "", url: r.html_url, push: !!r.permissions?.push,
});

// Đọc hết các trang của một danh sách. Lỗi ở trang đầu trả về để phân loại; lỗi ở trang sau thì giữ phần đã có.
async function pages<T>(token: string, first: string, max: number) {
  const items: T[] = [];
  let p: string | null = first, n = 0, head: Res<T[]> | null = null, truncated = false;
  while (p) {
    if (n >= max) { truncated = true; break; }
    const r: Res<T[]> = await call<T[]>(token, p);
    head ??= r;
    if (!r.ok || !Array.isArray(r.data)) {
      if (n) console.warn(`[github] trang ${n + 1} của ${first} lỗi ${r.status}: ${r.message}`);
      break;
    }
    items.push(...r.data);
    p = r.next;
    n++;
  }
  return { items, head: head!, truncated };
}

// Phân loại lỗi GitHub trả cho một tổ chức (403/404 của danh sách repo hay của truy vấn GraphQL).
function blockOf(kind: GhKind, r: { status: number; message: string; sso: string | null }): Block | null {
  if (r.sso) return "sso";
  if (RESTRICTED.test(r.message)) return "oauth";
  if (kind === "app" && NOT_INSTALLED.test(r.message)) return "app";
  return null;
}

// Hỏi GraphQL về repo riêng tư của tổ chức (hoặc về đúng một repo). Tổ chức chặn OAuth App thì GraphQL
// báo lỗi kèm lý do, còn REST chỉ lặng lẽ bỏ repo riêng tư đi (repo trông như không tồn tại),
// nên đây là cách chắc chắn để nhận ra.
async function probeOrg(token: string, kind: GhKind, org: string, name?: string) {
  const query = name ? "query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}"
    : "query($o:String!){organization(login:$o){repositories(privacy:PRIVATE){totalCount}}}";
  const body = JSON.stringify({ query, variables: name ? { o: org, n: name } : { o: org } });
  const r = await call<{ errors?: { message?: string }[] }>(token, "/graphql", { method: "POST", body })
    .catch((e) => { console.warn("[github] kiểm tra tổ chức", org, (e as Error).message); return null; });
  if (!r) return { block: null, sso: null };
  const msg = r.message || (r.data?.errors ?? []).map((e) => e.message ?? "").join(" ");
  return { block: blockOf(kind, { status: r.status, message: msg, sso: r.sso }), sso: r.sso };
}

/** Mọi repo người dùng truy cập được, nhóm theo chủ (cá nhân trước, rồi từng tổ chức),
 *  kèm các tổ chức đang bị chặn. */
export async function listAll(token: string, login: string): Promise<Listing> {
  const kind = tokenKind(token);
  const aff = "affiliation=owner,collaborator,organization_member";
  const mine = await pages<RawRepo>(token, `/user/repos?per_page=100&sort=pushed&${aff}`, USER_PAGES).catch((e) => {
    console.warn("[github] /user/repos", (e as Error).message);
    throw new AuthError("Chưa kết nối được GitHub. Thử lại sau ít phút.", 502);
  });
  if (mine.head.status === 401) throw expired();
  if (!mine.head.ok) throw new AuthError(`GitHub: ${mine.head.message || mine.head.status}`, 502);
  const byFull = new Map<string, RepoOut>();
  const types = new Map<string, "user" | "org">();
  for (const r of mine.items) {
    const o = out(r);
    byFull.set(r.full_name.toLowerCase(), o);
    types.set(o.owner, r.owner?.type === "Organization" ? "org" : "user");
  }
  // Token GitHub App có thể không có quyền đọc tổ chức (403): khi đó chỉ dựa vào danh sách repo ở trên.
  const orgsRes = await pages<{ login: string }>(token, "/user/orgs?per_page=100", 3).catch((e) => {
    console.warn("[github] /user/orgs", (e as Error).message);
    return null;
  });
  if (orgsRes && !orgsRes.head.ok) console.warn("[github] /user/orgs", orgsRes.head.status, orgsRes.head.message);
  const orgs = (orgsRes?.items ?? []).map((o) => o.login).slice(0, MAX_ORGS);
  // GitHub App: tổ chức chưa cài app thì không có repo nào hiện ra; danh sách cài đặt cho biết tổ chức nào đã cài.
  let installed: Set<string> | null = null;
  if (kind === "app") {
    type Ins = { installations?: { account?: { login?: string } }[] };
    const ins = await call<Ins>(token, "/user/installations?per_page=100")
      .catch((e) => { console.warn("[github] /user/installations", (e as Error).message); return null; });
    const logins = (ins?.data?.installations ?? []).map((i) => (i.account?.login ?? "").toLowerCase());
    if (ins?.ok) installed = new Set(logins);
    else if (ins) console.warn("[github] /user/installations", ins.status, ins.message);
  }
  const blocks = new Map<string, { block: Block; fixUrl: string }>();
  const own = (org: string, priv: boolean) =>
    [...byFull.values()].some((r) => r.owner.toLowerCase() === org.toLowerCase() && (!priv || r.private));
  const block = (org: string, b: Block, sso: string | null) =>
    blocks.set(org, { block: b, fixUrl: (b === "sso" && sso) || fixUrlFor(kind) });
  await Promise.all(orgs.map(async (org) => {
    types.set(org, "org");
    try {
      // Tổ chức chưa có repo nào trong danh sách chung: đọc thẳng danh sách repo của tổ chức
      // (thành viên chỉ thấy repo qua team không có trong /user/repos).
      if (!own(org, false)) {
        const url = `/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&sort=pushed`;
        const or = await pages<RawRepo>(token, url, ORG_PAGES);
        for (const r of or.items) {
          const k = r.full_name.toLowerCase();
          if (!byFull.has(k)) byFull.set(k, out(r));
        }
        const b = or.head.ok ? null : blockOf(kind, or.head);
        if (b) return void block(org, b, or.head.sso);
      }
      if (kind === "app") {
        if (installed && !installed.has(org.toLowerCase())) block(org, "app", null);
        return;
      }
      // Đã thấy repo riêng tư của tổ chức thì tổ chức không chặn; chưa thấy thì hỏi GraphQL cho chắc.
      if (own(org, true)) return;
      const p = await probeOrg(token, kind, org);
      if (p.block) block(org, p.block, p.sso);
    } catch (e) { console.warn("[github] repo của tổ chức", org, (e as Error).message); }
  }));
  const me = login.toLowerCase();
  // Repo cá nhân trước (khóa rỗng), rồi theo tên chủ; trong mỗi nhóm, repo mới đẩy code gần nhất lên đầu.
  const rank = (o: string) => (o.toLowerCase() === me ? "" : o.toLowerCase());
  const repos = [...byFull.values()].sort((a, b) => {
    const ka = rank(a.owner), kb = rank(b.owner);
    return ka < kb ? -1 : ka > kb ? 1 : b.pushed.localeCompare(a.pushed);
  });
  const groups: Group[] = [];
  for (const r of repos) {
    const g = groups.find((x) => x.owner === r.owner);
    if (g) g.count++;
    else groups.push({ owner: r.owner, type: types.get(r.owner) ?? "user", count: 1 });
  }
  for (const [org, b] of blocks) {
    const g = groups.find((x) => x.owner.toLowerCase() === org.toLowerCase());
    if (g) Object.assign(g, b);
    else groups.push({ owner: org, type: "org", count: 0, ...b });
  }
  return { repos, groups, scopes: mine.head.scopes, truncated: mine.truncated };
}

// Mỗi lần mở hộp thoại, gõ tìm hay bấm "Xem thêm" đều hỏi lại máy chủ: giữ danh sách vài phút
// để không đọc lại cả chục trang GitHub.
type Cached = { key: string; at: number; v: Promise<Listing> };
const cache = ((globalThis as { __synchroGhRepos?: Map<string, Cached> }).__synchroGhRepos ??= new Map());
const TTL = 3 * 60_000;
export function cachedListing(uid: string, token: string, login: string, fresh = false): Promise<Listing> {
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const c = cache.get(uid);
  if (!fresh && c && c.key === key && Date.now() - c.at < TTL) return c.v;
  const v = listAll(token, login);
  cache.set(uid, { key, at: Date.now(), v });
  // Lỗi không được giữ lại: lần mở sau thử lại ngay.
  v.catch(() => { if (cache.get(uid)?.v === v) cache.delete(uid); });
  if (cache.size > 500) for (const [k, x] of cache) if (Date.now() - x.at > TTL) cache.delete(k);
  return v;
}

const PAGE = 50;
/** Một trang của danh sách đã lọc theo từ khóa (tên repo, chủ, mô tả), kèm nhóm của cả danh sách lọc. */
export function pageOf(l: Listing, q: string, page: number) {
  const t = q.trim().toLowerCase();
  const hit = !t ? l.repos
    : l.repos.filter((r) => r.full.toLowerCase().includes(t) || (r.desc ?? "").toLowerCase().includes(t));
  const p = Math.max(1, Math.floor(page) || 1);
  const groups = l.groups
    .map((g) => ({ ...g, count: hit.filter((r) => r.owner === g.owner).length }))
    .filter((g) => g.count > 0 || (g.block && (!t || g.owner.toLowerCase().includes(t))));
  return { repos: hit.slice((p - 1) * PAGE, p * PAGE), groups, total: hit.length, page: p,
    more: hit.length > p * PAGE, truncated: l.truncated };
}

// Chữ cố định để giao diện dịch được nguyên câu: tên tổ chức đi riêng trong fix.org,
// nhãn nút do giao diện tự đặt theo fix.block.
export const ORG_MSG: Record<Block, string> = {
  oauth: "Tổ chức sở hữu repo này đang chặn ứng dụng bên ngoài nên Synchro chưa đọc được repo."
    + " Bấm Cấp quyền, chọn Grant cạnh tên tổ chức trên GitHub, rồi clone lại.",
  sso: "Tổ chức sở hữu repo này bật đăng nhập SAML SSO."
    + " Bấm Cho phép để Synchro dùng kết nối GitHub với tổ chức này, rồi clone lại.",
  app: "Ứng dụng GitHub của Synchro chưa được cài vào tổ chức sở hữu repo này."
    + " Bấm Cài vào tổ chức trên GitHub, rồi clone lại.",
};
export const blockedError = (kind: GhKind, block: Block, org: string, url?: string | null) =>
  new AuthError(ORG_MSG[block], 403, { fix: { url: url || fixUrlFor(kind), org, block } });

/** Clone thất bại với tài khoản đã kết nối: hỏi GitHub vì sao, để báo đúng cách sửa (cấp quyền tổ chức, SSO, cài app,
 *  kết nối lại cho đủ quyền). null: không rõ nguyên nhân, giữ thông báo chung. */
export async function diagnoseRepo(token: string, owner: string, name: string, scopes: string) {
  const kind = tokenKind(token);
  const repo = await call<unknown>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  if (repo.ok) return null;
  if (repo.status === 401) return expired();
  const b = blockOf(kind, repo);
  if (b) return blockedError(kind, b, owner, repo.sso);
  if (missingScopes(kind, repo.scopes ?? scopes).includes("repo")) {
    const m = "Kết nối GitHub hiện tại chưa có quyền đọc repo riêng tư. Bấm Kết nối lại một lần để cấp thêm quyền.";
    return new AuthError(m, 403, { reconnect: true });
  }
  // Repo riêng tư của tổ chức bị chặn trông như không tồn tại (404). GitHub App: là thành viên tổ chức
  // mà không thấy repo nghĩa là app chưa được cài vào tổ chức. OAuth App: GraphQL nói rõ tổ chức có chặn hay không.
  if (kind === "app") {
    const m = await call<{ state?: string }>(token, `/user/memberships/orgs/${encodeURIComponent(owner)}`);
    return m.ok && m.data?.state === "active" ? blockedError(kind, "app", owner) : null;
  }
  const p = await probeOrg(token, kind, owner, name);
  return p.block ? blockedError(kind, p.block, owner, p.sso) : null;
}
