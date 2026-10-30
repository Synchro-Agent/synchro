// Tải một repo git công khai bất kỳ (GitLab, Bitbucket, Codeberg / Gitea, máy chủ git riêng…; GitHub đi đường codeload riêng trong
// skillstore.ts) thành file zip trong bộ nhớ để Kho kỹ năng đọc toàn bộ repo.
// Chỉ máy chủ chạy git (clone nông, một nhánh, không submodule, không LFS). An toàn: chỉ https tới địa chỉ công khai — tên miền được
// phân giải trước, bỏ IP nội bộ, rồi ghim đúng IP đó cho git (http.curloptResolve) nên không thể bị trỏ vòng vào mạng trong; không theo
// chuyển hướng; không hỏi mật khẩu (repo riêng tư báo lỗi ngay); chỉ giao thức https; liên kết tượng trưng trong repo bị bỏ qua.
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

export class RepoError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new RepoError(m, status); };

// dev:mock / kiểm thử: cho phép repo ở máy nội bộ (máy chủ git giả lập), cả http.
const allowPrivate = () => process.env.GIT_ALLOW_PRIVATE === "1";

export type GitLink = { url: string; host: string; name: string; segs: string[]; source: string };

/**
 * Link trang web hoặc link clone → địa chỉ clone + phần còn lại (nhánh và thư mục, tách sau khi biết danh sách nhánh).
 * GitLab: /<nhóm…>/<repo>/-/(tree|blob)/<nhánh>/<thư mục> · Bitbucket: /<ws>/<repo>/src/<nhánh>/<thư mục>
 * Gitea / Codeberg / Forgejo: /<chủ>/<repo>/src/(branch|tag|commit)/<nhánh>/<thư mục> · còn lại: link clone như git nhận.
 */
export function parseGitLink(raw: string): GitLink {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return fail("Link không hợp lệ. Hãy dán link repo git dạng https://…"); }
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) fail("Chỉ nhận link https tới repo git công khai");
  if (u.username || u.password) fail("Link không được chứa tên đăng nhập / mật khẩu");
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2 && !/\.git$/.test(u.pathname)) fail("Link thiếu tên repo");
  let repoParts = parts, segs: string[] = [];
  const dash = parts.indexOf("-");
  if (dash > 1 && ["tree", "blob"].includes(parts[dash + 1])) { repoParts = parts.slice(0, dash); segs = parts.slice(dash + 2); }
  else if (parts.length > 3 && parts[2] === "src" && ["branch", "tag", "commit"].includes(parts[3])) { repoParts = parts.slice(0, 2); segs = parts.slice(4); }
  else if (parts.length > 2 && parts[2] === "src") { repoParts = parts.slice(0, 2); segs = parts.slice(3); }
  else if (parts.length > 2 && ["tree", "blob"].includes(parts[2])) { repoParts = parts.slice(0, 2); segs = parts.slice(3); }
  else { const g = parts.findIndex((p) => p.endsWith(".git")); if (g >= 0) { repoParts = parts.slice(0, g + 1); segs = parts.slice(g + 1); } }
  if (!repoParts.every((p) => /^[\w.~-]{1,200}$/.test(p))) fail("Tên repo trong link có ký tự không hợp lệ");
  const name = repoParts[repoParts.length - 1].replace(/\.git$/, "");
  const url = `${u.protocol}//${u.host}/${repoParts.join("/")}`;
  return { url, host: u.hostname, name, segs, source: `${u.host}/${repoParts.join("/").replace(/\.git$/, "")}` };
}

// IP nội bộ / đặc biệt (không cho git kết nối tới).
function privateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return privateIp(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}

async function pinFor(l: GitLink): Promise<string[]> {
  const u = new URL(l.url);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  if (net.isIP(u.hostname)) {
    if (!allowPrivate() && privateIp(u.hostname)) fail("Không đọc repo ở địa chỉ nội bộ");
    return [];
  }
  let addrs: { address: string }[];
  try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { return fail(`Không tìm thấy máy chủ ${u.hostname}`, 404); }
  const ok = addrs.filter((a) => allowPrivate() || !privateIp(a.address));
  if (!ok.length) fail("Không đọc repo ở địa chỉ nội bộ");
  return ["-c", `http.curloptResolve=${u.hostname}:${port}:${net.isIPv6(ok[0].address) ? `[${ok[0].address}]` : ok[0].address}`];
}

function git(args: string[], o: { cwd?: string; timeout: number }): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const p = spawn("git", args, {
      cwd: o.cwd ?? os.tmpdir(),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.tmpdir(), GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GCM_INTERACTIVE: "never", GIT_ASKPASS: "/bin/false", SSH_ASKPASS: "/bin/false" } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { if (out.length < 2_000_000) out += d; });
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill("SIGKILL"), o.timeout);
    p.on("close", (code) => { clearTimeout(t); res({ code: code ?? -1, out, err }); });
    p.on("error", (e) => { clearTimeout(t); res({ code: -1, out: "", err: e.message }); });
  });
}
const SAFE = (pin: string[]) => [...pin, "-c", "http.followRedirects=false", "-c", "protocol.allow=never", "-c", `protocol.${allowPrivate() ? "http" : "https"}.allow=always`, "-c", "protocol.https.allow=always", "-c", "core.symlinks=false", "-c", "credential.helper=", "-c", "core.askPass=/bin/false"];

const MAX_BYTES = 120 * 1024 * 1024, MAX_FILES = 20_000, MAX_FILE = 25 * 1024 * 1024;

/**
 * Clone nông repo rồi đóng thành zip (không có thư mục .git). Trả về thư mục con người dùng trỏ tới (nếu link có) để chọn đúng phần.
 * Nhánh có dấu "/" (feature/x): đối chiếu với danh sách nhánh thật của repo, chọn nhánh dài nhất khớp với đầu đường dẫn.
 */
export async function fetchGitRepo(raw: string): Promise<{ filename: string; buf: Buffer; sub: string; source: string; ref: string }> {
  const first = parseGitLink(raw);
  const pin = await pinFor(first);
  // Nhiều máy chủ git chỉ nhận đường dẫn có đuôi .git (không theo chuyển hướng nên thử cả hai dạng).
  const cands = first.url.endsWith(".git") ? [first.url] : [first.url, `${first.url}.git`];
  let url = "", refs = "";
  for (const c of cands) {
    const r = await git([...SAFE(pin), "ls-remote", "--symref", c], { timeout: 30_000 });
    if (r.code === 0) { url = c; refs = r.out; break; }
    if (/could not resolve|timed out|connection refused/i.test(r.err)) fail(`Không kết nối được tới ${first.host}`, 502);
  }
  if (!url) fail("Không đọc được repo: link không phải repo git công khai (repo riêng tư cần quyền truy cập)", 404);
  const heads = [...refs.matchAll(/^\w+\trefs\/(?:heads|tags)\/(.+)$/gm)].map((m) => m[1].replace(/\^\{\}$/, ""));
  const def = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(refs)?.[1] ?? "";
  // Nhánh trong link (dài nhất khớp), phần còn lại là thư mục / tệp trong repo.
  let ref = "", rest = first.segs;
  for (let i = first.segs.length; i > 0; i--) {
    const cand = first.segs.slice(0, i).join("/");
    if (heads.includes(cand)) { ref = cand; rest = first.segs.slice(i); break; }
  }
  if (!ref && first.segs.length && !/\.git$/.test(first.url)) { ref = ""; rest = first.segs; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synchro-repo-"));
  try {
    const args = [...SAFE(pin), "clone", "--depth", "1", "--single-branch", "--no-tags", "--filter=blob:limit=25m", ...(ref ? ["--branch", ref] : []), "--", url, "repo"];
    const r = await git(args, { cwd: dir, timeout: 180_000 });
    if (r.code !== 0) fail(`Không tải được repo: ${r.err.trim().split("\n").filter((l) => !/^(warning|hint):/i.test(l)).slice(-1)[0] ?? "git báo lỗi"}`.slice(0, 300), 502);
    const root = path.join(dir, "repo");
    const zip = new JSZip();
    let bytes = 0, files = 0;
    const walk = async (d: string, rel: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (e.name === ".git" && !rel) continue;
        const full = path.join(d, e.name), r2 = rel ? `${rel}/${e.name}` : e.name;
        const st = await fs.lstat(full);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { await walk(full, r2); continue; }
        if (!st.isFile() || st.size > MAX_FILE) continue;
        if (++files > MAX_FILES) fail("Repo có quá nhiều tệp để đọc", 413);
        bytes += st.size;
        if (bytes > MAX_BYTES) fail(`Repo quá lớn để đọc (>${MAX_BYTES / 1048576}MB)`, 413);
        zip.file(r2, await fs.readFile(full));
      }
    };
    await walk(root, "");
    if (!files) fail("Repo trống (không có tệp nào)", 404);
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    let sub = rest.join("/");
    // Link tới một tệp: lấy thư mục chứa tệp đó.
    if (sub && !zip.folder(sub)?.file(/.*/).length && zip.file(sub)) sub = sub.includes("/") ? sub.slice(0, sub.lastIndexOf("/")) : "";
    return { filename: `${first.name}.zip`, buf, sub, source: first.source, ref: ref || def };
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
