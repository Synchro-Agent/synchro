// Git của một phiên Synchro Code (thư mục của phiên trong workspace): trạng thái, diff, clone, commit, nhánh, pull, push, pull request.
// Dùng chung cho khung Changes (/api/ws op "git") và công cụ git_push / create_pull_request của agent.
import { EXCLUDE_SYNCHRO } from "./uploads";
import { AuthError, type UserRow } from "./authstore";
import { getLink, gh, GH_GIT, gitAuth, parseRepo, repoOfRemote } from "./github";
import { getPrefs, prsOf, trackPr } from "./codestore";
import { exec } from "./workspace";

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

type GitFile = { path: string; status: string; add: number; del: number };
const STATUS_SH = `if [ ! -d .git ]; then echo "##NOGIT"; exit 0; fi
echo "##B $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "##R $(git remote get-url origin 2>/dev/null | sed -E 's#https://[^@/]*@#https://#')"
echo "##A $(git rev-list --count @{u}..HEAD 2>/dev/null || echo -)"
git status --porcelain=v1 -uall 2>/dev/null | head -500 | sed 's/^/##S /'
(git diff HEAD --numstat 2>/dev/null || git diff --cached --numstat) | head -500 | sed 's/^/##N /'
git ls-files --others --exclude-standard | head -300 | while IFS= read -r f; do echo "##U $(wc -l < "$f" 2>/dev/null || echo 0)	$f"; done`;

async function status(u: string, d: string) {
  const r = await exec(u, d, { cmd: STATUS_SH, timeout: 30 });
  const lines = r.out.split("\n");
  if (lines.includes("##NOGIT")) return { git: false as const };
  const val = (k: string) => lines.find((l) => l.startsWith(`##${k} `))?.slice(k.length + 3).trim() ?? "";
  const files = new Map<string, GitFile>();
  for (const l of lines) {
    if (l.startsWith("##S ")) {
      const code = l.slice(4, 6), p = l.slice(7).replace(/^.* -> /, "").replace(/^"|"$/g, "");
      files.set(p, { path: p, status: code === "??" ? "A" : code.trim().slice(0, 1) || "M", add: 0, del: 0 });
    } else if (l.startsWith("##N ") || l.startsWith("##U ")) {
      const [a, b2, ...rest] = l.slice(4).split("\t");
      const p = (l.startsWith("##U ") ? [b2, ...rest] : rest).join("\t");
      const f = files.get(p);
      if (f) { f.add = Number(a) || 0; f.del = l.startsWith("##U ") ? 0 : Number(b2) || 0; }
    }
  }
  const remote = val("R");
  return { git: true as const, branch: val("B"), remote, repo: repoOfRemote(remote), ahead: val("A") === "-" ? null : Number(val("A")), files: [...files.values()] };
}

const sidOf = (b: Record<string, unknown>) => Number(String(b.sid ?? "").replace(/\D/g, "")) || 0;
// Tên nhánh mới: tiền tố + nội dung commit gần nhất (bỏ dấu tiếng Việt), kèm đuôi ngắn để không trùng.
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
async function newBranch(u: string, d: string, prefix: string) {
  const subj = (await exec(u, d, { cmd: "git log -1 --format=%s 2>/dev/null", timeout: 15 })).out.trim();
  const name = `${prefix ? prefix + "/" : ""}${slug(subj) || "thay-doi"}-${Date.now().toString(36).slice(-4)}`;
  fail(await exec(u, d, { cmd: 'git checkout -q -b "$BR"', env: { BR: name }, timeout: 30 }), "Tạo nhánh");
  return status(u, d);
}
// PR đang mở của nhánh (mở mới nếu chưa có); Synchro ghi lại để tự sửa CI / góp ý và tự lưu trữ phiên khi PR xong.
async function ensurePr(user: UserRow, d: string, sid: number, repo: string, branch: string, base: string, token: string, title = "", body = "") {
  const owner = repo.split("/")[0];
  type Pr = { html_url: string; number: number; head: { sha: string } };
  let pr = (await gh<Pr[]>(token, `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`))[0];
  let created = false;
  if (!pr) {
    const log = await exec(user.id, d, { cmd: 'git log -1 --format=%s; echo "---"; git log --format="- %s" "origin/$B..HEAD" 2>/dev/null | head -30', env: { B: base }, timeout: 20 });
    const [subj, list = ""] = log.out.split("\n---\n");
    pr = await gh<Pr>(token, `/repos/${repo}/pulls`, { method: "POST", body: JSON.stringify({
      title: title || subj.trim() || branch, head: branch, base,
      body: body || `${list.trim() ? `Thay đổi:\n${list.trim()}\n\n` : ""}Tạo từ Synchro Code.`,
    }) });
    created = true;
  }
  if (sid) trackPr(user.id, sid, { repo, number: pr.number, url: pr.html_url, branch, base, head: pr.head?.sha });
  return { url: pr.html_url, number: pr.number, created };
}
const okBranch = (s: string) => /^[A-Za-z0-9._/-]{1,100}$/.test(s) && !s.includes("..") && !s.startsWith("-");
const tokenOf = (u: UserRow, need: boolean) => {
  const l = getLink(u.id);
  if (!l && need) throw new AuthError("Hãy kết nối GitHub trước (nút GitHub bên dưới khung chat).", 400);
  return l;
};
// Tên / email cho commit: theo tài khoản GitHub đã kết nối (email noreply), nếu không thì theo tài khoản Synchro.
const ident = (user: UserRow) => {
  const l = getLink(user.id);
  return { N: l?.login ?? user.name ?? "Synchro", M: l ? `${l.id}+${l.login}@users.noreply.github.com` : user.email };
};
const fail = (r: { code: number; out: string; err: string }, what: string) => {
  if (r.code) throw new AuthError(`${what}: ${(r.err || r.out).trim().split("\n").slice(-4).join(" ").slice(0, 400) || "lỗi " + r.code}`, 400);
};

export async function gitOp(user: UserRow, d: string, b: Record<string, unknown>) {
  const u = user.id;
  const sub = str(b.action, 20);
  if (sub === "status") return status(u, d);
  if (sub === "diff") {
    const p = str(b.path, 1000);
    const r = await exec(u, d, { cmd: `if git ls-files --error-unmatch -- "$P" >/dev/null 2>&1; then git diff HEAD -- "$P" 2>/dev/null || git diff --cached -- "$P"; else git diff --no-index -- /dev/null "$P"; fi; true`, env: { P: p }, timeout: 30 });
    return { diff: r.out.slice(0, 400_000) };
  }
  if (sub === "clone") {
    const { owner, name } = parseRepo(b.repo);
    const l = tokenOf(user, false);
    const branch = str(b.branch, 100);
    if (branch && !okBranch(branch)) throw new AuthError("Tên nhánh không hợp lệ.", 400);
    // Tệp người dùng gửi kèm (.synchro/uploads) không tính là "đã có file": cất tạm ra ngoài khi clone rồi đưa lại, git bỏ qua.
    const empty = await exec(u, d, { cmd: "ls -A | grep -vx '.synchro' | head -1", timeout: 10 });
    if (empty.out.trim()) throw new AuthError("Phiên này đã có file. Hãy tạo phiên mới để clone repo khác.", 409);
    const a = l ? gitAuth(l.token) : { env: { GIT_TERMINAL_PROMPT: "0" }, stdin: undefined, prelude: "", epilogue: "" };
    const r = await exec(u, d, {
      cmd: `${a.prelude}k=""; if [ -e .synchro ]; then k="../.synchro-giu-$$"; mv .synchro "$k"; fi; git clone --quiet ${branch ? '--branch "$BR" ' : ""}"$GH/$REPO.git" . 2>&1; c=$?; if [ -n "$k" ]; then mv "$k" .synchro; fi; ${EXCLUDE_SYNCHRO}${a.epilogue}; exit $c`,
      env: { GH: GH_GIT, REPO: `${owner}/${name}`, BR: branch, ...a.env }, stdin: a.stdin, timeout: 300,
    });
    if (r.code) throw new AuthError(/not found|could not read Username|Authentication/i.test(r.out + r.err) ? (l ? "Không tìm thấy repo hoặc tài khoản GitHub của bạn không có quyền với repo này." : "Repo riêng tư hoặc không tồn tại. Hãy kết nối GitHub để clone repo riêng tư.") : `Clone thất bại: ${(r.out || r.err).trim().slice(-300)}`, 400);
    await exec(u, d, { cmd: 'git config user.name "$N" && git config user.email "$M"', env: ident(user), timeout: 10 });
    return status(u, d);
  }
  if (sub === "init") {
    const r = await exec(u, d, { cmd: `git init -q -b main && ${EXCLUDE_SYNCHRO} && git config user.name "$N" && git config user.email "$M" && git add -A && (git commit -qm 'Khởi tạo' || true)`, env: ident(user), timeout: 30 });
    fail(r, "Khởi tạo git");
    return status(u, d);
  }
  if (sub === "commit") {
    const msg = str(b.message, 2000).trim();
    if (!msg) throw new AuthError("Hãy nhập nội dung commit.", 400);
    const r = await exec(u, d, { cmd: 'git add -A && git commit -q -m "$MSG"', env: { MSG: msg }, timeout: 60 });
    fail(r, "Commit");
    return status(u, d);
  }
  if (sub === "branch") {
    const name = str(b.name, 100);
    if (!okBranch(name)) throw new AuthError("Tên nhánh không hợp lệ.", 400);
    const r = await exec(u, d, { cmd: 'git checkout -q -b "$BR" 2>/dev/null || git checkout -q "$BR"', env: { BR: name }, timeout: 30 });
    fail(r, "Đổi nhánh");
    return status(u, d);
  }
  if (sub === "pull") {
    const l = tokenOf(user, true)!;
    const a = gitAuth(l.token);
    const r = await exec(u, d, { cmd: `${a.prelude}git pull --ff-only 2>&1${a.epilogue}`, env: a.env, stdin: a.stdin, timeout: 180 });
    fail(r, "Pull");
    return { ...(await status(u, d)), output: r.out.slice(-2000) };
  }
  // Push. Bật "Tự tạo pull request" (Cài đặt → Synchro Code): đang ở nhánh chính thì đẩy sang nhánh mới theo tiền tố, rồi mở PR nếu chưa có.
  if (sub === "push") {
    const l = tokenOf(user, true)!;
    const prefs = getPrefs(u);
    let s = await status(u, d);
    let base: string | null = null;
    if (prefs.autoPr && s.git && s.repo) {
      base = (await gh<{ default_branch: string }>(l.token, `/repos/${s.repo}`)).default_branch;
      if (s.branch === base) s = await newBranch(u, d, prefs.branchPrefix);
    }
    const a = gitAuth(l.token);
    const r = await exec(u, d, { cmd: `${a.prelude}git push -u origin HEAD 2>&1${a.epilogue}`, env: a.env, stdin: a.stdin, timeout: 180 });
    fail(r, "Push");
    const pr = base && s.git && s.repo && s.branch !== base ? await ensurePr(user, d, sidOf(b), s.repo, s.branch, base, l.token) : null;
    return { ...(await status(u, d)), output: r.out.slice(-2000), ...(pr ? { pr } : {}) };
  }
  // Mở pull request. Đang ở nhánh chính thì tạo nhánh mới theo tiền tố và đẩy lên trước.
  if (sub === "pr") {
    const l = tokenOf(user, true)!;
    let s = await status(u, d);
    if (!s.git || !s.repo) throw new AuthError("Phiên này chưa gắn với repo GitHub.", 400);
    const repo = await gh<{ default_branch: string }>(l.token, `/repos/${s.repo}`);
    const base = str(b.base, 100) || repo.default_branch;
    if (s.branch === base) {
      s = await newBranch(u, d, getPrefs(u).branchPrefix);
      if (!s.git) throw new AuthError("Không tạo được nhánh mới.", 400);
    }
    if (s.ahead === null || s.ahead > 0) { const a = gitAuth(l.token); fail(await exec(u, d, { cmd: `${a.prelude}git push -u origin HEAD 2>&1${a.epilogue}`, env: a.env, stdin: a.stdin, timeout: 180 }), "Push"); }
    const pr = await ensurePr(user, d, sidOf(b), s.repo!, s.branch, base, l.token, str(b.title, 200), str(b.body, 20_000));
    return { ...(await status(u, d)), pr };
  }
  // Pull request của phiên (Synchro theo dõi để tự sửa / tự lưu trữ).
  if (sub === "prs") return { prs: prsOf(u, sidOf(b)).map((p) => ({ repo: p.repo, number: p.number, url: p.url, branch: p.branch, state: p.state, fixes: p.fixes, note: p.note, busy: !!p.busy })) };
  throw new AuthError("Thao tác git không hợp lệ.", 400);
}
