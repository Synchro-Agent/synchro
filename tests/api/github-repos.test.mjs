// Repo GitHub của mọi nơi người dùng truy cập được (server/ghrepos.ts), với GitHub giả lập ngay trong bài thử:
// 1. Danh sách đọc hết mọi trang (Link rel="next"), không theo trang kế trỏ sang máy chủ khác.
// 2. Repo của tổ chức: tổ chức chỉ thấy qua team, tổ chức chặn OAuth App (GraphQL báo lý do), tổ chức bật SAML SSO
//    (header X-GitHub-SSO) — mỗi loại chặn có đúng trang GitHub để gỡ.
// 3. Nhóm theo chủ (cá nhân trước), chia trang 50, tìm trên toàn bộ danh sách.
// 4. Thiếu quyền: kết nối cũ chỉ có "repo" thì thiếu read:org; token GitHub App không tính scope.
// 5. Clone thất bại: chỉ ra tổ chức chặn / thiếu quyền repo / hết hạn, còn repo không tồn tại thì giữ thông báo chung.
// 6. GitHub App: tổ chức chưa cài app có nút cài app.
// 7. Kết nối GitHub xin thêm quyền read:org.
// Tự chạy được: thư mục dữ liệu riêng, không gọi ra ngoài.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};

const ME = "owner-dev";
const RESTRICT_MSG = "Although you appear to have the correct authorization credentials, the `locked` organization"
  + " has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.";
const repo = (full, o = {}) => ({
  full_name: full, private: !!o.private, default_branch: "main", description: o.desc ?? null,
  pushed_at: o.pushed ?? "2026-01-01T00:00:00Z", html_url: `https://github.com/${full}`, permissions: { push: true },
  owner: { login: full.split("/")[0], type: o.org ? "Organization" : "User" } });
// 220 repo cá nhân (3 trang), 2 repo của acme (có repo riêng tư), 1 repo cộng tác của người khác.
const PERSONAL = Array.from({ length: 220 }, (_, i) => repo(`${ME}/p${String(i).padStart(3, "0")}`,
  { pushed: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    desc: i === 7 ? "needle in description" : null }));
const USER_REPOS = [...PERSONAL, repo("acme/web", { org: true, private: true }), repo("acme/docs", { org: true }),
  repo("friend/shared", { private: true })];
const seen = [];
let scopes = "repo, read:org, read:user, user:email";
const installs = ["acme"];
let evilNext = false;

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  seen.push(`${req.method} ${p}${u.search}`);
  const tok = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const send = (code, body, h = {}) => {
    const sc = tok.startsWith("ghu_") ? "" : scopes;
    res.writeHead(code, { "content-type": "application/json", "x-oauth-scopes": sc, ...h });
    res.end(JSON.stringify(body));
  };
  if (tok === "gho_expired") return send(401, { message: "Bad credentials" });
  let body = "";
  for await (const c of req) body += c;
  if (p === "/user/repos") {
    // Token GitHub App chỉ thấy repo của nơi đã cài app (ở đây: acme).
    const all = !tok.startsWith("ghu_") ? USER_REPOS
      : USER_REPOS.filter((r) => r.owner.login === "acme" || r.owner.login === ME);
    const page = Number(u.searchParams.get("page") ?? 1), per = 100;
    const last = Math.ceil(all.length / per);
    const nextUrl = evilNext ? "https://evil.example/user/repos?page=2"
      : `${BASE}/user/repos?page=${page + 1}&per_page=100`;
    const link = `<${nextUrl}>; rel="next", <${BASE}/user/repos?page=${last}>; rel="last"`;
    return send(200, all.slice((page - 1) * per, page * per), page < last ? { link } : {});
  }
  if (p === "/user/orgs") {
    return send(200, ["acme", "teamonly", "locked", "ssoorg", "emptyorg"].map((login) => ({ login })));
  }
  if (p === "/orgs/teamonly/repos") {
    return send(200, [repo("teamonly/api", { org: true, private: true }), repo("teamonly/cli", { org: true })]);
  }
  if (p === "/orgs/locked/repos") return send(200, []);
  if (p === "/orgs/emptyorg/repos") return send(200, []);
  if (p === "/orgs/ssoorg/repos") {
    return send(403, { message: "Resource protected by organization SAML enforcement." },
      { "x-github-sso": "required; url=https://github.com/orgs/ssoorg/sso?authorization_request=abc" });
  }
  if (p === "/graphql") {
    const v = JSON.parse(body || "{}").variables ?? {};
    if (v.o === "locked") return send(200, { data: null, errors: [{ type: "FORBIDDEN", message: RESTRICT_MSG }] });
    if (v.o === "emptyorg") return send(200, { data: { organization: { repositories: { totalCount: 0 } } } });
    if (v.o === ME) return send(200, { data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] });
    return send(200, { data: { organization: { repositories: { totalCount: 0 } } } });
  }
  if (p === "/user/installations") {
    return send(200, { installations: installs.map((login) => ({ account: { login } })) });
  }
  if (p === "/user/memberships/orgs/locked") return send(200, { state: "active", role: "admin" });
  if (p === "/user/memberships/orgs/teamonly") return send(200, { state: "active", role: "member" });
  if (p === "/repos/blocked403/x") return send(403, { message: RESTRICT_MSG });
  if (p.startsWith("/repos/")) return send(404, { message: "Not Found" });
  return send(404, { message: "Not Found" });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ghrepos-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "gh-repos-key";
process.env.GITHUB_API_URL = BASE;
process.env.GITHUB_WEB_URL = "https://github.com";
process.env.GITHUB_CLIENT_ID = "Iv1.testclient";
process.env.GITHUB_CLIENT_SECRET = "secret";
process.env.GITHUB_APP_SLUG = "synchro-test";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { "server/ghrepos": G, "server/oauth": O } = await loadTs(["server/ghrepos", "server/oauth"]);
try {
  console.log("1. Đọc hết các trang");
  const l = await G.listAll("gho_full", ME);
  const pages = seen.filter((s) => s.startsWith("GET /user/repos")).length;
  ok(pages === 3, "đọc đủ 3 trang của /user/repos theo Link rel=next", seen.filter((s) => s.includes("/user/repos")));
  ok(l.repos.filter((r) => r.owner === ME).length === 220, "đủ 220 repo cá nhân (không dừng ở 100)", l.repos.length);
  ok(seen.some((s) => s.includes("affiliation=owner,collaborator,organization_member")),
    "hỏi cả repo cộng tác và repo tổ chức");
  ok(l.scopes === scopes, "đọc quyền thật của token từ header X-OAuth-Scopes", l.scopes);

  console.log("2. Repo và chặn của từng tổ chức");
  const has = (f) => l.repos.some((r) => r.full === f);
  ok(has("acme/web") && has("acme/docs"), "repo của tổ chức có trong danh sách chung");
  ok(has("teamonly/api") && has("teamonly/cli"), "tổ chức chỉ thấy qua team: đọc thêm /orgs/{org}/repos");
  ok(has("friend/shared"), "repo được mời cộng tác của người khác");
  ok(!seen.includes("GET /orgs/acme/repos?type=all&per_page=100&sort=pushed"),
    "tổ chức đã có repo trong danh sách chung thì không đọc lại");
  const g = Object.fromEntries(l.groups.map((x) => [x.owner, x]));
  ok(g.locked?.block === "oauth" && g.locked.count === 0 && g.locked.type === "org",
    "tổ chức chặn OAuth App được nhận ra qua GraphQL", g.locked);
  ok(g.locked?.fixUrl === "https://github.com/settings/connections/applications/Iv1.testclient",
    "nút sửa mở trang cấp quyền của đúng ứng dụng (Grant cạnh tổ chức)", g.locked?.fixUrl);
  ok(g.ssoorg?.block === "sso" && g.ssoorg.fixUrl === "https://github.com/orgs/ssoorg/sso?authorization_request=abc",
    "tổ chức bật SAML SSO: nút mở đúng trang cho phép token", g.ssoorg);
  ok(!g.emptyorg && !g.acme?.block && !g.teamonly?.block,
    "tổ chức không chặn (kể cả chưa có repo) không bị báo nhầm", l.groups);

  console.log("3. Nhóm, chia trang, tìm kiếm");
  ok(l.groups[0].owner === ME && l.groups[0].type === "user" && l.groups[0].count === 220,
    "nhóm cá nhân đứng đầu", l.groups[0]);
  ok(g.acme?.type === "org" && g.acme.count === 2 && g.friend?.type === "user",
    "nhóm theo chủ: tổ chức / người cộng tác", l.groups);
  ok(l.repos[0].full === `${ME}/p219`, "trong nhóm, repo mới đẩy code gần nhất lên đầu", l.repos[0]);
  const p1 = G.pageOf(l, "", 1), p5 = G.pageOf(l, "", 5);
  ok(p1.repos.length === 50 && p1.more && p1.total === l.repos.length,
    "trang 1: 50 repo, còn trang sau", { n: p1.repos.length, more: p1.more });
  ok(p5.repos.length === l.repos.length - 200 && !p5.more,
    "trang cuối: phần còn lại, hết trang", { n: p5.repos.length });
  ok(p1.groups.some((x) => x.owner === "locked" && x.block), "tổ chức bị chặn vẫn hiện (để thấy nút gỡ chặn)");
  const s1 = G.pageOf(l, "p007", 1), s2 = G.pageOf(l, "NEEDLE", 1), s3 = G.pageOf(l, "teamonly", 1);
  ok(s1.repos.length === 1 && s1.repos[0].full === `${ME}/p007`, "tìm thấy repo ở trang thứ ba của GitHub", s1.repos);
  ok(s2.repos.length === 1, "tìm theo mô tả, không phân biệt hoa thường", s2.repos);
  ok(s3.groups.length === 1 && s3.groups[0].owner === "teamonly" && s3.groups[0].count === 2,
    "nhóm theo kết quả tìm", s3.groups);
  ok(!G.pageOf(l, "p007", 1).groups.some((x) => x.owner === "locked"),
    "tìm repo khác thì không kèm tổ chức bị chặn không liên quan");

  console.log("4. Quyền còn thiếu");
  ok(JSON.stringify(G.missingScopes("oauth", "repo,read:user,user:email")) === '["read:org"]',
    "kết nối cũ (chỉ repo): thiếu read:org");
  ok(G.missingScopes("oauth", "repo, admin:org").length === 0, "admin:org bao gồm read:org");
  ok(JSON.stringify(G.missingScopes("oauth", "")) === '["repo","read:org"]', "không có quyền nào: thiếu cả hai");
  ok(G.tokenKind("ghu_abc") === "app" && G.missingScopes("app", "").length === 0, "token GitHub App: không tính scope");
  ok(G.tokenKind("gho_abc") === "oauth" && G.tokenKind("0123abcd") === "oauth", "token OAuth App (kể cả kiểu cũ)");

  console.log("5. Clone thất bại: vì sao");
  const d1 = await G.diagnoseRepo("gho_full", "locked", "secret", scopes);
  ok(d1?.status === 403 && d1.extra?.fix?.block === "oauth" && d1.extra.fix.org === "locked"
    && d1.extra.fix.url.endsWith("/applications/Iv1.testclient"),
  "repo riêng tư của tổ chức chặn OAuth App (trông như 404): nút Cấp quyền", d1 && { m: d1.message, x: d1.extra });
  ok(/chặn ứng dụng bên ngoài/.test(d1?.message ?? ""), "thông báo một câu, nói rõ cách sửa", d1?.message);
  const d2 = await G.diagnoseRepo("gho_full", "blocked403", "x", scopes);
  ok(d2?.extra?.fix?.block === "oauth", "GitHub trả thẳng 403 kèm lý do chặn", d2?.extra);
  scopes = "read:user";
  const d3 = await G.diagnoseRepo("gho_old", "acme", "web", "read:user");
  ok(d3?.extra?.reconnect === true && !d3.extra.fix,
    "thiếu quyền repo: mời kết nối lại", d3 && { m: d3.message, x: d3.extra });
  scopes = "repo, read:org, read:user, user:email";
  const d4 = await G.diagnoseRepo("gho_full", ME, "khong-co", scopes);
  ok(d4 === null, "repo không tồn tại thật: giữ thông báo chung (không đổ lỗi cho tổ chức)", d4?.message);
  const d5 = await G.diagnoseRepo("gho_expired", "acme", "web", scopes);
  ok(d5?.status === 401 && d5.extra?.reconnect, "token hết hạn: mời kết nối lại", d5?.extra);
  let threw = null;
  try { await G.listAll("gho_expired", ME); } catch (e) { threw = e; }
  ok(threw?.status === 401 && threw.extra?.reconnect,
    "danh sách với token hết hạn: lỗi 401 kèm kết nối lại", threw?.message);

  console.log("6. GitHub App");
  const la = await G.listAll("ghu_apptoken", ME);
  const ga = Object.fromEntries(la.groups.map((x) => [x.owner, x]));
  ok(!ga.acme?.block && ga.acme?.count === 2, "tổ chức đã cài app: thấy repo, không báo chặn", ga.acme);
  ok(ga.locked?.block === "app" && ga.locked.fixUrl === "https://github.com/apps/synchro-test/installations/new",
    "tổ chức chưa cài app: nút cài app vào tổ chức", ga.locked);
  const d6 = await G.diagnoseRepo("ghu_apptoken", "teamonly", "api", "");
  ok(d6?.extra?.fix?.block === "app" && d6.extra.fix.org === "teamonly",
    "clone repo của tổ chức chưa cài app: nút cài", d6?.extra);

  console.log("7. Không gửi token sang máy chủ khác; bộ nhớ tạm");
  evilNext = true;
  seen.length = 0;
  const le = await G.listAll("gho_full", ME);
  ok(le.repos.filter((r) => r.owner === ME).length === 100
    && seen.filter((s) => s.includes("/user/repos")).length === 1,
    "trang kế trỏ sang máy chủ khác: dừng, không theo", seen);
  evilNext = false;
  seen.length = 0;
  const c1 = await G.cachedListing("u1", "gho_full", ME), n1 = seen.length;
  const c2 = await G.cachedListing("u1", "gho_full", ME);
  ok(c1 === c2 && seen.length === n1, "mở lại hộp thoại trong vài phút: không đọc lại GitHub");
  await G.cachedListing("u1", "gho_full", ME, true);
  ok(seen.length > n1, "Tải lại: đọc lại từ GitHub");
  const n2 = seen.length;
  await G.cachedListing("u1", "gho_new", ME);
  ok(seen.length > n2, "kết nối lại (token mới): đọc danh sách mới");

  console.log("8. Kết nối GitHub xin đủ quyền");
  const st = O.start(new Request("https://synchro.test/api/github/connect"), "github", "link");
  const sc = new URL(st.url).searchParams.get("scope") ?? "";
  ok(sc.split(" ").includes("repo") && sc.split(" ").includes("read:org"), "xin quyền repo và read:org", sc);
  const login = O.start(new Request("https://synchro.test/api/auth/oauth/github"), "github", "login");
  const lg = new URL(login.url).searchParams.get("scope");
  ok(!/repo|read:org/.test(lg ?? ""), "đăng nhập thường không xin quyền repo", lg);
} finally {
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
