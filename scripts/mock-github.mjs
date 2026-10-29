// GitHub giả lập cho dev:mock và bộ kiểm thử: kết nối tài khoản (OAuth), API repo / pull request / CI (check runs) / bình luận,
// và máy chủ git thật (git http-backend) để clone / push từ workspace giống github.com. Mọi repo là repo git trần trong thư mục dir.
// CI giả lập: commit có tệp BROKEN thì lượt kiểm tra "test" lỗi (chạy xong sau ~1,5 giây kể từ lần đầu được hỏi), không có thì đạt.
// Điều khiển cho kiểm thử: POST /_mock/repo, /_mock/comment, /_mock/merge, /_mock/close; GET /_mock/state, /_mock/file.
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
  const okToken = (t) => typeof t === "string" && t.startsWith("gho_mock_");
  const repoInfo = (repo) => ({ id: repo.length, full_name: repo, name: repo.split("/")[1], private: true, default_branch: "main", description: "Repo giả lập", pushed_at: new Date().toISOString(),
    html_url: `${base}/${repo}`, permissions: { admin: true, push: true, pull: true }, owner: { login: repo.split("/")[0] } });
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
    if (!okToken(pass)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GitHub"' }); return res.end("Cần đăng nhập GitHub"); }
    const repo = /^\/([^/]+\/[^/]+?)\.git/.exec(rel)?.[1];
    if (!repo || !exists(repo)) { res.writeHead(404); return res.end("Repository not found"); }
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

  const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const body = (req) => new Promise((ok) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok(Object.fromEntries(new URLSearchParams(b))); } }); });
  const html = (res, s) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>GitHub giả lập</title><body style="font:16px system-ui;max-width:560px;margin:60px auto;line-height:1.5">${s}</body>`); };

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const p = u.pathname;
    const auth = req.headers.authorization;
    try {
      if (p.startsWith("/git/")) return gitHttp(req, res, p.slice(4), auth);
      // ---- OAuth (cửa sổ "Kết nối GitHub") ----
      if (p === "/login/oauth/authorize") {
        const to = new URL(u.searchParams.get("redirect_uri"));
        to.searchParams.set("code", "mockcode");
        to.searchParams.set("state", u.searchParams.get("state") ?? "");
        return html(res, `<h2>GitHub (giả lập)</h2><p>Synchro muốn truy cập repo của <b>${MOCK_GH_LOGIN}</b>.</p><p><a id="allow" href="${to}">Cho phép</a></p>`);
      }
      if (p === "/login/oauth/access_token") { await body(req); return json(res, 200, { access_token: `gho_mock_${Math.random().toString(36).slice(2)}`, token_type: "bearer", scope: "repo,read:user,user:email" }); }
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
      if (!okToken(/^Bearer\s+(.+)$/i.exec(auth ?? "")?.[1])) return json(res, 401, { message: "Bad credentials" });
      if (ap === "/user") return json(res, 200, USER);
      if (ap === "/user/emails") return json(res, 200, [{ email: `${MOCK_GH_LOGIN}@users.noreply.github.com`, primary: true, verified: true }]);
      if (ap === "/user/repos") {
        const list = fs.existsSync(path.join(dir, MOCK_GH_LOGIN)) ? fs.readdirSync(path.join(dir, MOCK_GH_LOGIN)).map((r) => repoInfo(`${MOCK_GH_LOGIN}/${r.replace(/\.git$/, "")}`)) : [];
        return json(res, 200, list);
      }
      const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(ap);
      if (!m) return json(res, 404, { message: "Not Found" });
      const repo = m[1], rest = m[2] ?? "";
      if (!exists(repo)) return json(res, 404, { message: "Not Found" });
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
