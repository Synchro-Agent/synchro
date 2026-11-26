// GitHub giả lập cho dev:mock và bộ kiểm thử: kết nối tài khoản (OAuth), API repo / pull request / CI (check runs) / bình luận,
// và máy chủ git thật (git http-backend) để clone / push từ workspace giống github.com. Mọi repo là repo git trần trong thư mục dir.
// Repo công khai (Kho kỹ năng dán link repo): /codeload/<chủ>/<repo>/zip/<nhánh> như codeload.github.com, /public-git/<chủ>/<repo>.git
// clone không cần đăng nhập (chỉ đọc) như một máy chủ git công khai bất kỳ (GitLab, Gitea…).
// CI giả lập: commit có tệp BROKEN thì lượt kiểm tra "test" lỗi (chạy xong sau ~1,5 giây kể từ lần đầu được hỏi), không có thì đạt.
// Điều khiển cho kiểm thử: POST /_mock/repo, /_mock/comment, /_mock/merge, /_mock/close, /_mock/scopes,
// /_mock/revoke ({ on }: mọi token bị thu hồi, như người dùng gỡ Synchro trên GitHub);
// GET /_mock/state, /_mock/file.
// Tổ chức: mọi chủ repo khác mock-dev là một tổ chức mock-dev tham gia. Tổ chức tên "locked-…" giả lập tổ chức bật
// OAuth App access restrictions như github.com: repo riêng tư biến khỏi danh sách, API và git báo "not found",
// chỉ GraphQL nói rõ lý do.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export const MOCK_GH_LOGIN = "mock-dev";
const USER = { id: 424242, login: MOCK_GH_LOGIN, name: "Mock Dev", avatar_url: "", type: "User" };
const OTHER = { id: 777, login: "reviewer-bot-free", type: "User" };

export async function startMockGithub(port, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  const prs = new Map(); // repo -> [pr]
  const comments = new Map(); // `${repo}#${n}` -> { issue: [], review: [] }
  const ciSeen = new Map(); // sha -> lần đầu được hỏi
  let nextComment = 1000;
  const deleted = [];
  const gitDir = (repo) => path.join(dir, `${repo}.git`);
  const git = (repo, args, input) => spawnSync("git", ["--git-dir", gitDir(repo), ...args], { encoding: "utf8", input });
  const sha = (repo, ref) => { const r = git(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]); return r.status === 0 ? r.stdout.trim() : null; };
  let revoked = false;
  const okToken = (t) => !revoked && typeof t === "string" && t.startsWith("gho_mock_");
  // Quyền của token: theo scope xin lúc kết nối, hoặc theo /_mock/scopes (giả lập kết nối cũ thiếu read:org).
  const tokenScopes = new Map();
  let lastScope = "repo,read:user,user:email", forceScope = null;
  const locked = (owner) => /^locked-/.test(owner);
  const owners = () => (!fs.existsSync(dir) ? []
    : fs.readdirSync(dir).filter((o) => fs.statSync(path.join(dir, o)).isDirectory()));
  const reposOf = (owner) => (!fs.existsSync(path.join(dir, owner)) ? []
    : fs.readdirSync(path.join(dir, owner)).map((r) => `${owner}/${r.replace(/\.git$/, "")}`));
  const RESTRICTED = (o) => "Although you appear to have the correct authorization credentials,"
    + ` the \`${o}\` organization has enabled OAuth App access restrictions,`
    + " meaning that data access to third-parties is limited.";
  const repoInfo = (repo) => ({ id: repo.length, full_name: repo, name: repo.split("/")[1], private: true, default_branch: "main", description: "Repo giả lập", pushed_at: new Date().toISOString(),
    html_url: `${base}/${repo}`, permissions: { admin: true, push: true, pull: true },
    owner: { login: repo.split("/")[0], type: repo.split("/")[0] === MOCK_GH_LOGIN ? "User" : "Organization" } });
  const exists = (repo) => fs.existsSync(gitDir(repo));
  const prOut = (repo, p) => ({ ...p, head: { ref: p.headRef, sha: sha(repo, `refs/heads/${p.headRef}`) ?? p.lastSha, repo: { full_name: repo } }, base: { ref: p.baseRef }, html_url: `${base}/${repo}/pull/${p.number}`, merged: p.merged });

  function createRepo(repo, files = { "README.md": "# Demo\n" }, branch = "main") {
    fs.rmSync(gitDir(repo), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(gitDir(repo)), { recursive: true });
    spawnSync("git", ["init", "-q", "--bare", "-b", branch, gitDir(repo)]);
    git(repo, ["config", "http.receivepack", "true"]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mockgh-"));
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), c); }
    const env = { ...process.env, GIT_AUTHOR_NAME: "Mock Dev", GIT_AUTHOR_EMAIL: "mock@example.com", GIT_COMMITTER_NAME: "Mock Dev", GIT_COMMITTER_EMAIL: "mock@example.com" };
    spawnSync("git", ["init", "-q", "-b", branch], { cwd: tmp });
    spawnSync("git", ["add", "-A"], { cwd: tmp });
    spawnSync("git", ["commit", "-qm", "Khởi tạo"], { cwd: tmp, env });
    spawnSync("git", ["push", "-q", gitDir(repo), `${branch}:${branch}`], { cwd: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
    prs.set(repo, []);
  }
  function ci(repo, s) {
    if (!s) return [];
    const first = ciSeen.get(s) ?? Date.now();
    ciSeen.set(s, first);
    if (Date.now() - first < 1500) return [{ id: 1, name: "test", status: "in_progress", conclusion: null, output: { title: null, summary: null } }];
    const broken = git(repo, ["cat-file", "-e", `${s}:BROKEN`]).status === 0;
    return [{ id: 1, name: "test", status: "completed", conclusion: broken ? "failure" : "success", html_url: `${base}/${repo}/actions/runs/1`,
      output: broken ? { title: "1 kiểm thử lỗi", summary: "FAIL tests/app.test.js\n  ✗ app khởi động được\n    Error: tệp BROKEN làm hỏng bản build (xóa tệp BROKEN để sửa)" } : { title: "Đạt", summary: "Tất cả kiểm thử đạt" } }];
  }

  // git smart HTTP qua git http-backend (CGI).
  function gitHttp(req, res, rel, auth) {
    const write = /git-receive-pack/.test(rel) || /service=git-receive-pack/.test(req.url);
    const tok = /^basic\s+(.+)$/i.exec(auth ?? "")?.[1];
    const pass = tok ? Buffer.from(tok, "base64").toString().split(":")[1] : null;
    if (auth === "public" ? write : !okToken(pass)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GitHub"' }); return res.end("Cần đăng nhập GitHub"); }
    const repo = /^\/([^/]+\/[^/]+?)\.git/.exec(rel)?.[1];
    if (!repo || !exists(repo) || (auth !== "public" && locked(repo.split("/")[0]))) {
      res.writeHead(404);
      return res.end("Repository not found");
    }
    const q = new URL(req.url, base).search.slice(1);
    const p = spawn("git", ["http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: dir, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: rel, REQUEST_METHOD: req.method, QUERY_STRING: q,
      CONTENT_TYPE: req.headers["content-type"] ?? "", HTTP_CONTENT_ENCODING: req.headers["content-encoding"] ?? "", REMOTE_USER: MOCK_GH_LOGIN, REMOTE_ADDR: "127.0.0.1", GIT_HTTP_MAX_REQUEST_BUFFER: "100M" } });
    req.pipe(p.stdin);
    let head = Buffer.alloc(0), sent = false;
    p.stdout.on("data", (d) => {
      if (sent) return res.write(d);
      head = Buffer.concat([head, d]);
      const i = head.indexOf("\r\n\r\n");
      if (i < 0) return;
      const lines = head.subarray(0, i).toString().split("\r\n");
      let status = 200;
      const h = {};
      for (const l of lines) { const k = l.indexOf(":"); const name = l.slice(0, k).trim(), v = l.slice(k + 1).trim(); if (/^status$/i.test(name)) status = parseInt(v, 10); else h[name] = v; }
      res.writeHead(status, h);
      sent = true;
      res.write(head.subarray(i + 4));
    });
    p.on("close", () => { if (!sent) res.writeHead(500); res.end(); if (write) for (const l of prs.values()) for (const x of l) x.lastSha = sha(repo, `refs/heads/${x.headRef}`) ?? x.lastSha; });
  }

  const json = (res, code, o, h = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...h });
    res.end(JSON.stringify(o));
  };
  const body = (req) => new Promise((ok) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok(Object.fromEntries(new URLSearchParams(b))); } }); });
  const html = (res, s) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>GitHub giả lập</title><body style="font:16px system-ui;max-width:560px;margin:60px auto;line-height:1.5">${s}</body>`); };

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const p = u.pathname;
    const auth = req.headers.authorization;
    try {
      if (p.startsWith("/git/")) return gitHttp(req, res, p.slice(4), auth);
      if (p.startsWith("/public-git/")) return gitHttp(req, res, p.slice("/public-git".length), "public");
      // zip của cả repo như codeload.github.com: thư mục gốc "<repo>-<nhánh>/".
      const cl = /^\/codeload\/([^/]+)\/([^/]+)\/zip\/(.+)$/.exec(p);
      if (cl) {
        const repo = `${cl[1]}/${cl[2]}`, ref = decodeURIComponent(cl[3]);
        if (!exists(repo) || !sha(repo, ref)) { res.writeHead(404); return res.end("Not Found"); }
        const z = spawnSync("git", ["--git-dir", gitDir(repo), "archive", "--format=zip", `--prefix=${cl[2]}-${ref.replace(/\//g, "-")}/`, ref], { maxBuffer: 200 << 20 });
        res.writeHead(200, { "content-type": "application/zip" });
        return res.end(z.stdout);
      }
      // ---- OAuth (cửa sổ "Kết nối GitHub") ----
      if (p === "/login/oauth/authorize") {
        lastScope = (u.searchParams.get("scope") ?? lastScope).split(/\s+/).join(",");
        const to = new URL(u.searchParams.get("redirect_uri"));
        to.searchParams.set("code", "mockcode");
        to.searchParams.set("state", u.searchParams.get("state") ?? "");
        return html(res, `<h2>GitHub (giả lập)</h2><p>Synchro muốn truy cập repo của <b>${MOCK_GH_LOGIN}</b>.</p><p><a id="allow" href="${to}">Cho phép</a></p>`);
      }
      if (p === "/login/oauth/access_token") {
        await body(req);
        const t = `gho_mock_${Math.random().toString(36).slice(2)}`, scope = forceScope ?? lastScope;
        tokenScopes.set(t, scope);
        return json(res, 200, { access_token: t, token_type: "bearer", scope });
      }
      if (p === "/_mock/scopes") { forceScope = (await body(req)).scopes ?? null; return json(res, 200, { ok: true }); }
      if (p === "/_mock/revoke") { revoked = !!(await body(req)).on; return json(res, 200, { ok: true }); }
      // ---- điều khiển cho kiểm thử ----
      if (p === "/_mock/repo") { const b = await body(req); createRepo(b.repo, b.files, b.branch); return json(res, 200, { ok: true }); }
      if (p === "/_mock/comment") {
        const b = await body(req);
        const k = `${b.repo}#${b.number}`;
        const c = comments.get(k) ?? { issue: [], review: [] };
        const who = b.login === MOCK_GH_LOGIN ? USER : { ...OTHER, login: b.login ?? OTHER.login };
        const x = { id: ++nextComment, body: b.body, user: who, created_at: new Date().toISOString(), ...(b.path ? { path: b.path, line: b.line ?? 1 } : {}) };
        (b.path ? c.review : c.issue).push(x);
        comments.set(k, c);
        return json(res, 200, x);
      }
      if (p === "/_mock/merge" || p === "/_mock/close") {
        const b = await body(req);
        const x = (prs.get(b.repo) ?? []).find((y) => y.number === Number(b.number));
        if (!x) return json(res, 404, {});
        x.state = "closed"; x.merged = p === "/_mock/merge";
        if (x.merged) git(b.repo, ["update-ref", `refs/heads/${x.baseRef}`, sha(b.repo, `refs/heads/${x.headRef}`)]);
        return json(res, 200, { ok: true });
      }
      if (p === "/_mock/state") {
        const repos = fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((o) => fs.readdirSync(path.join(dir, o)).map((r) => `${o}/${r.replace(/\.git$/, "")}`)) : [];
        return json(res, 200, { prs: Object.fromEntries([...prs].map(([r, l]) => [r, l.map((x) => prOut(r, x))])), comments: Object.fromEntries(comments), deleted,
          branches: Object.fromEntries(repos.map((r) => [r, git(r, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).stdout.split("\n").filter(Boolean)])) });
      }
      if (p === "/_mock/file") { const r = git(u.searchParams.get("repo"), ["show", `${u.searchParams.get("ref")}:${u.searchParams.get("path")}`]); return json(res, r.status ? 404 : 200, { content: r.stdout }); }
      // ---- REST API ----
      if (!p.startsWith("/api/")) return html(res, `<h2>GitHub (giả lập)</h2><p>${p}</p>`);
      const ap = p.slice(4);
      // Commit hiện tại của một nhánh (repo công khai, không cần đăng nhập) như api.github.com: Kho kỹ năng ghi commit khi cài thư viện từ link.
      const cm = req.method === "GET" && /^\/repos\/([^/]+\/[^/]+)\/commits\/([^/]+)$/.exec(ap);
      if (cm && exists(cm[1])) {
        const s = sha(cm[1], decodeURIComponent(cm[2]));
        if (!s) return json(res, 422, { message: "No commit found for SHA" });
        if (/vnd\.github\.sha/.test(req.headers.accept ?? "")) { res.writeHead(200, { "content-type": "text/plain" }); return res.end(s); }
        return json(res, 200, { sha: s });
      }
      const tok = /^Bearer\s+(.+)$/i.exec(auth ?? "")?.[1];
      if (!okToken(tok)) return json(res, 401, { message: "Bad credentials" });
      const sh = { "x-oauth-scopes": (tokenScopes.get(tok) ?? "repo,read:user,user:email").split(",").join(", ") };
      if (ap === "/user") return json(res, 200, USER, sh);
      if (ap === "/user/emails") return json(res, 200, [{ email: `${MOCK_GH_LOGIN}@users.noreply.github.com`, primary: true, verified: true }]);
      // Danh sách chia trang như api.github.com (per_page, page, Link rel="next"); tổ chức chặn ứng dụng không có mặt.
      const paged = (all) => {
        const per = Math.min(100, Number(u.searchParams.get("per_page")) || 30);
        const page = Number(u.searchParams.get("page")) || 1;
        const next = new URL(req.url, base);
        next.searchParams.set("page", String(page + 1));
        const h = page * per < all.length ? { ...sh, link: `<${base}${next.pathname}${next.search}>; rel="next"` } : sh;
        return json(res, 200, all.slice((page - 1) * per, page * per), h);
      };
      if (ap === "/user/repos") return paged(owners().filter((o) => !locked(o)).flatMap(reposOf).map(repoInfo));
      if (ap === "/user/orgs") return paged(owners().filter((o) => o !== MOCK_GH_LOGIN).map((login) => ({ login })));
      let om;
      if ((om = /^\/orgs\/([^/]+)\/repos$/.exec(ap))) return paged(locked(om[1]) ? [] : reposOf(om[1]).map(repoInfo));
      if ((om = /^\/user\/memberships\/orgs\/([^/]+)$/.exec(ap))) {
        const member = owners().includes(om[1]) && om[1] !== MOCK_GH_LOGIN;
        if (!member) return json(res, 404, { message: "Not Found" }, sh);
        return json(res, 200, { state: "active", role: "admin" }, sh);
      }
      if (ap === "/graphql") {
        const v = (await body(req)).variables ?? {};
        const err = (type, message) => json(res, 200, { data: null, errors: [{ type, message }] }, sh);
        if (locked(v.o ?? "")) return err("FORBIDDEN", RESTRICTED(v.o));
        if (!owners().includes(v.o ?? "")) return err("NOT_FOUND", "Could not resolve to a node");
        const found = v.n ? exists(`${v.o}/${v.n}`) : true;
        if (!found) return err("NOT_FOUND", "Could not resolve to a Repository");
        return json(res, 200, { data: { organization: { repositories: { totalCount: reposOf(v.o).length } } } }, sh);
      }
      const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(ap);
      if (!m) return json(res, 404, { message: "Not Found" });
      const repo = m[1], rest = m[2] ?? "";
      if (!exists(repo) || locked(repo.split("/")[0])) return json(res, 404, { message: "Not Found" });
      const list = prs.get(repo) ?? [];
      prs.set(repo, list);
      if (!rest) return json(res, 200, repoInfo(repo));
      let mm;
      if ((mm = /^\/git\/trees\/(.+)$/.exec(rest))) {
        const r = git(repo, ["ls-tree", "-r", "-l", decodeURIComponent(mm[1])]);
        return json(res, 200, { truncated: false, tree: r.stdout.split("\n").filter(Boolean).map((l) => { const [meta, f] = l.split("\t"); const [, type, , size] = meta.split(/\s+/); return { path: f, type, size: Number(size) || 0 }; }) });
      }
      if ((mm = /^\/contents\/(.+)$/.exec(rest))) {
        const r = git(repo, ["show", `${u.searchParams.get("ref") || "HEAD"}:${decodeURIComponent(mm[1])}`]);
        return r.status ? json(res, 404, { message: "Not Found" }) : json(res, 200, { content: Buffer.from(r.stdout).toString("base64"), encoding: "base64" });
      }
      if (rest === "/pulls" && req.method === "POST") {
        const b = await body(req);
        if (!sha(repo, `refs/heads/${b.head}`)) return json(res, 422, { message: "Validation Failed", errors: [{ message: `head ${b.head} không tồn tại` }] });
        if (list.some((x) => x.state === "open" && x.headRef === b.head)) return json(res, 422, { message: "A pull request already exists" });
        const x = { number: list.length + 1, title: b.title, body: b.body, state: "open", merged: false, headRef: b.head, baseRef: b.base ?? "main", lastSha: sha(repo, `refs/heads/${b.head}`), user: USER };
        list.push(x);
        return json(res, 201, prOut(repo, x));
      }
      if (rest === "/pulls") {
        const st = u.searchParams.get("state") ?? "open", head = u.searchParams.get("head")?.split(":").pop();
        return json(res, 200, list.filter((x) => (st === "all" || x.state === st) && (!head || x.headRef === head)).map((x) => prOut(repo, x)));
      }
      if ((mm = /^\/pulls\/(\d+)$/.exec(rest))) { const x = list.find((y) => y.number === Number(mm[1])); return x ? json(res, 200, prOut(repo, x)) : json(res, 404, { message: "Not Found" }); }
      if ((mm = /^\/pulls\/(\d+)\/merge$/.exec(rest)) && req.method === "PUT") {
        const x = list.find((y) => y.number === Number(mm[1]));
        if (!x) return json(res, 404, {});
        x.state = "closed"; x.merged = true;
        git(repo, ["update-ref", `refs/heads/${x.baseRef}`, sha(repo, `refs/heads/${x.headRef}`)]);
        return json(res, 200, { merged: true });
      }
      if ((mm = /^\/commits\/([0-9a-f]{7,40})\/check-runs$/.exec(rest))) { const r = ci(repo, sha(repo, mm[1])); return json(res, 200, { total_count: r.length, check_runs: r }); }
      if ((mm = /^\/(issues|pulls)\/(\d+)\/comments$/.exec(rest))) {
        const k = `${repo}#${mm[2]}`;
        const c = comments.get(k) ?? { issue: [], review: [] };
        comments.set(k, c);
        if (req.method === "POST") { const b = await body(req); const x = { id: ++nextComment, body: b.body, user: USER, created_at: new Date().toISOString() }; c.issue.push(x); return json(res, 201, x); }
        return json(res, 200, mm[1] === "issues" ? c.issue : c.review);
      }
      if ((mm = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && req.method === "DELETE") {
        const br = decodeURIComponent(mm[1]);
        if (!sha(repo, `refs/heads/${br}`)) return json(res, 422, { message: "Reference does not exist" });
        git(repo, ["update-ref", "-d", `refs/heads/${br}`]);
        deleted.push(`${repo}:${br}`);
        res.writeHead(204); return res.end();
      }
      return json(res, 404, { message: "Not Found" });
    } catch (e) {
      json(res, 500, { message: String(e?.message ?? e) });
    }
  });
  await new Promise((ok, no) => { srv.once("error", no); srv.listen(port, "127.0.0.1", ok); });
  return { base, close: () => srv.close() };
}
