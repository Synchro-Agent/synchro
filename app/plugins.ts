// Plugin (chỉ chạy ở máy chủ): một gói nhiều skill cài một lần, giống Plugins của Claude, nâng cấp thêm:
// - Cài cả repo (hoặc nhiều repo) một lần, tự tìm mọi SKILL.md, bỏ bản trùng, giữ nguồn và commit để cập nhật / quay lại.
// - Trước khi cài: xem từng skill, giấy phép (chặn skill độc quyền), mức rủi ro của script (gọi mạng, chạy lệnh, đọc bí mật).
// - Hai phạm vi: "org" (quản trị viên cài một lần cho mọi tài khoản) và cá nhân (mỗi người tự cài).
// - Gắn plugin với một "studio" (Thiết kế / Trình bày / Tài liệu): bấm nút là model có cả thư viện skill đó.
// - Không làm phình prompt: skill của plugin chỉ vào cuộc trò chuyện khi studio đang bật, hoặc khi plugin được bật "dùng mọi nơi".
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { db } from "./authstore";
import { download, enabledSkillsByIds, isAllowed, isText, parseEntries, parseSkillMd, ROOT, type Entry, type Skill } from "./skillstore";
import { GH_API } from "./github";
import { classify, dropPluginTags, dropTag, keepPluginTags, pluginKey, refine, tagsOf, userStudioIds } from "./skillstudio";

export type Studio = "design" | "slides" | "docs";
export const STUDIOS: Studio[] = ["design", "slides", "docs"];
export type Source = { repo: string; ref?: string; path?: string; include?: string[]; exclude?: string[] };
export type PluginDef = { catalogId?: string; slug: string; name: string; description: string; author?: string; homepage?: string; studio?: Studio | null; everywhere?: boolean; color?: string; sources: Source[] };
export type Risk = "none" | "low" | "medium" | "high";
export type SkillReport = { name: string; description: string; dir: string; repo: string; files: number; size: number; scripts: number; license: string; licenseKind: LicenseKind; risk: Risk; flags: string[]; blocked?: string; duplicateOf?: string };
export type LicenseKind = "open" | "proprietary" | "unknown";

// skills: số skill tối đa cài từ một plugin (trước đây 80, phần dư bị bỏ qua). zip / pluginBytes / skillBytes: repo tải về tối đa 500MB, giữ lại
// tối đa 400MB skill, mỗi skill 60MB (trước đây 80 / 150 / 25MB: repo skill nhiều ảnh mẫu không cài được). perOwner / ownerBytes: mỗi tài khoản (và thư viện chung "org")
// tối đa 200 plugin và 4GB. Trước đây chỉ 40 plugin — con số đặt tùy ý, không vì
// dung lượng (cả kho dữ liệu chỉ vài trăm MB) — người dùng chạm giới hạn mà không biết đã cài bao nhiêu hay phải làm gì.
export const PLUGIN_LIMITS = { skills: 200, filesPerSkill: 5000, skillBytes: 60 * 1024 * 1024, pluginBytes: 400 * 1024 * 1024, zip: 500 * 1024 * 1024, perOwner: 200, ownerBytes: 4 * 1024 * 1024 * 1024 };
const PROOT = () => path.join(ROOT, "_plugins");
export class PluginError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new PluginError(m, status); };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, owner TEXT NOT NULL, slug TEXT NOT NULL, catalog_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL,
        author TEXT, homepage TEXT, color TEXT, studio TEXT, everywhere INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, sources TEXT NOT NULL,
        commits TEXT NOT NULL DEFAULT '{}', size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER, latest TEXT, UNIQUE(owner, slug));
      CREATE TABLE IF NOT EXISTS plugin_skills (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL,
        body TEXT NOT NULL, storage_path TEXT NOT NULL, files TEXT NOT NULL, report TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER, UNIQUE(plugin_id, name));
      CREATE TABLE IF NOT EXISTS plugin_prefs (user_id TEXT NOT NULL, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, enabled INTEGER, everywhere INTEGER, PRIMARY KEY (user_id, plugin_id));
      CREATE TABLE IF NOT EXISTS plugin_removed (plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (plugin_id, name))`);
    ready = true;
  }
  return d;
}

// ---------------------------------------------------------------- chặn thêm skill trùng link
/**
 * Khóa so trùng của một link repo: cùng một link (cả repo, hoặc cùng thư mục skill trong repo) thì cùng khóa, bất kể cách viết:
 * bỏ https / www / .git / dấu "/" cuối / ?… #…, không phân biệt hoa thường ở tên miền, chủ sở hữu và repo, bỏ tên nhánh
 * (…/tree/main/x và …/tree/master/x là cùng một thư mục), link tới tệp SKILL.md tính như link thư mục chứa nó,
 * raw.githubusercontent.com tính như github.com. Link không đọc được thì null.
 */
export function linkKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let host = u.host.toLowerCase().replace(/^www\./, "");
  let segs = u.pathname.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  let base: string[], rest: string[];
  if (host === "raw.githubusercontent.com") { host = "github.com"; base = segs.slice(0, 2); rest = segs.slice(3); }
  else if (host === "github.com") { base = segs.slice(0, 2); rest = segs[2] === "tree" || segs[2] === "blob" ? segs.slice(4) : []; }
  else {
    // GitLab: <nhóm>/<repo>/-/tree|blob/<nhánh>/<thư mục>; Gitea / Codeberg: <chủ>/<repo>/src/branch|tag|commit/<nhánh>/…; Bitbucket: …/src/<nhánh>/….
    const dash = segs.indexOf("-"), src = segs.indexOf("src");
    if (dash > 0) { base = segs.slice(0, dash); rest = /^(tree|blob)$/.test(segs[dash + 1] ?? "") ? segs.slice(dash + 3) : []; }
    else if (src >= 2) { base = segs.slice(0, src); rest = segs.slice(src + (/^(branch|tag|commit)$/.test(segs[src + 1] ?? "") ? 3 : 2)); }
    else { base = segs; rest = []; }
  }
  if (!base.length || !host) return null;
  base = base.map((x, i) => (i === base.length - 1 ? x.replace(/\.git$/i, "") : x).toLowerCase());
  if (/^SKILL\.md$/i.test(rest[rest.length - 1] ?? "")) rest = rest.slice(0, -1);
  return [host, ...base, ...rest].join("/");
}
/** Khóa so trùng của một nguồn thư viện (cả repo hoặc một thư mục); nguồn chỉ lấy vài skill chọn lọc (include) không tính là cả link. */
const sourceKey = (s: Source) => (s.include?.length ? null : linkKey(`https://github.com/${s.repo}${s.path ? `/tree/${s.ref ?? "HEAD"}/${s.path}` : ""}`));
export type LinkDup = { name: string; where: "skill" | "personal" | "org" };
/**
 * Link đã được dùng để thêm skill trước đây chưa: trong Skill của bạn, Thư viện của bạn, hoặc Thư viện cho mọi người (quản trị viên thêm).
 * Áp cho mọi tài khoản: quản trị viên so với skill riêng của mình và thư viện cho mọi người; tài khoản thường so với skill / thư viện
 * của chính mình và thư viện cho mọi người. Chỉ trùng nguyên link mới tính (thư mục khác trong cùng repo là skill khác).
 */
export function findLinkDup(uid: string, raw: string): LinkDup | null {
  const key = linkKey(raw);
  if (!key) return null;
  const d = init();
  const sk = d.prepare("SELECT name FROM skills WHERE user_id = ? AND source = ?").get(uid, key) as { name: string } | undefined;
  if (sk) return { name: sk.name, where: "skill" };
  for (const p of d.prepare("SELECT name, owner, sources, homepage FROM plugins WHERE owner = ? OR owner = 'org' ORDER BY owner = 'org' DESC").all(uid) as { name: string; owner: string; sources: string; homepage: string | null }[]) {
    const srcs = JSON.parse(p.sources) as Source[];
    // Skill lẻ đưa vào thư viện cho mọi người (không theo dõi repo): link gốc lưu ở homepage.
    const keys = srcs.length ? srcs.map(sourceKey) : [p.homepage ? linkKey(p.homepage) : null];
    if (keys.includes(key)) return { name: p.name, where: p.owner === "org" ? "org" : "personal" };
  }
  return null;
}
const WHERE: Record<LinkDup["where"], string> = { skill: "Skill của bạn", personal: "Thư viện của bạn", org: "Thư viện cho mọi người" };
/** Thông báo khi link đã được thêm (giao diện hiện nguyên câu này). */
export const linkDupMessage = (d: LinkDup) => `Skill từ link này đã có: "${d.name}" trong ${WHERE[d.where]}. Synchro không thêm skill trùng.`;

// ---------------------------------------------------------------- tải repo GitHub
const SEG = /^[A-Za-z0-9._-]{1,100}$/;
export function parseRepo(raw: string): Source {
  const t = raw.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const [owner, repo, kind, ref, ...rest] = t.split("/");
  if (!owner || !repo || !SEG.test(owner) || !SEG.test(repo)) fail("Hãy dán link repo GitHub dạng https://github.com/<chủ>/<repo> (có thể kèm /tree/<nhánh>/<thư mục>).");
  if (kind && kind !== "tree" && kind !== "blob") fail("Link GitHub không hợp lệ.");
  if (ref && !SEG.test(ref)) fail("Tên nhánh không hợp lệ.");
  const p = rest.join("/").replace(/\/SKILL\.md$/i, "");
  return { repo: `${owner}/${repo}`, ...(ref ? { ref } : {}), ...(p ? { path: p } : {}) };
}

// GitHub giả lập của dev:mock (GITHUB_API_URL / GITHUB_CODELOAD_URL): repo có trên đó thì lấy ở đó, không có thì đi GitHub thật như máy chủ thật.
const API_HOSTS = [...new Set([GH_API, "https://api.github.com"])];
const CODELOAD_HOSTS = [...new Set([(process.env.GITHUB_CODELOAD_URL ?? "https://codeload.github.com").replace(/\/$/, ""), "https://codeload.github.com"])];

// Commit hiện tại của nhánh (để ghi nhận phiên bản và kiểm tra cập nhật). Lỗi API (giới hạn lượt gọi) thì dùng tên nhánh.
async function resolveCommit(repo: string, ref = "HEAD"): Promise<string> {
  let missing = 0;
  for (const host of API_HOSTS) {
    try {
      const r = await fetch(`${host}/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: "application/vnd.github.sha", "User-Agent": "Synchro", ...(process.env.GITHUB_TOKEN && host === "https://api.github.com" ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(15_000) });
      const t = (await r.text()).trim();
      if (r.ok && /^[0-9a-f]{40}$/.test(t)) return t;
      if (r.status === 404 || r.status === 422) missing++;
    } catch {}
  }
  if (missing === API_HOSTS.length) fail(`Không tìm thấy repo hoặc nhánh ${repo}${ref !== "HEAD" ? `@${ref}` : ""} (chỉ hỗ trợ repo công khai).`, 404);
  return ref;
}
const zipCache = new Map<string, { at: number; buf: Buffer }>();
async function repoZip(repo: string, commit: string) {
  const key = `${repo}@${commit}`;
  const c = zipCache.get(key);
  if (c && Date.now() - c.at < 10 * 60_000) return c.buf;
  const [o, r] = repo.split("/");
  let buf: Buffer | null = null;
  for (const host of CODELOAD_HOSTS) if (!buf) buf = await download(`${host}/${o}/${r}/zip/${encodeURIComponent(commit)}`, PLUGIN_LIMITS.zip);
  if (!buf) return fail(`Không tải được ${repo} từ GitHub.`, 404);
  zipCache.set(key, { at: Date.now(), buf });
  for (const [k, v] of zipCache) if (Date.now() - v.at > 10 * 60_000) zipCache.delete(k);
  return buf;
}

// ---------------------------------------------------------------- đọc gói: tìm mọi skill, giấy phép, rủi ro
type Found = { dir: string; entries: Entry[]; report: SkillReport; parsed?: ReturnType<typeof parseEntries> };
const SKIP_SEG = new Set([".git", ".github", "__MACOSX", "node_modules", ".DS_Store", ".venv", "venv", "__pycache__", "dist", "build"]);
const okSeg = (s: string) => !SKIP_SEG.has(s) && (!s.startsWith(".") || s === ".claude" || s === ".agents" || s === ".claude-plugin" || s === ".codex");

export function licenseKind(text: string): { kind: LicenseKind; name: string } {
  const t = text.slice(0, 4000);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(t)) return { kind: "open", name: "MIT" };
  if (/Apache License/i.test(t)) return { kind: "open", name: "Apache-2.0" };
  if (/BSD (2|3)-Clause|Redistribution and use in source and binary forms/i.test(t)) return { kind: "open", name: "BSD" };
  if (/ISC License/i.test(t)) return { kind: "open", name: "ISC" };
  if (/Mozilla Public License/i.test(t)) return { kind: "open", name: "MPL-2.0" };
  if (/Creative Commons|CC BY/i.test(t)) return { kind: "open", name: "CC" };
  if (/^\s*MIT\s*$/m.test(t)) return { kind: "open", name: "MIT" };
  if (/All rights reserved|may not[\s\S]{0,80}(reproduce|distribute|copy)/i.test(t)) return { kind: "proprietary", name: "Độc quyền" };
  return { kind: "unknown", name: "Không rõ" };
}

// Quét nội dung để báo rủi ro trước khi cài. Script chỉ chạy trong sandbox cô lập, nhưng người dùng vẫn nên biết skill làm gì.
const RULES: [RegExp, string, Risk][] = [
  [/\b(curl|wget)\s+(-\S+\s+)*https?:|requests\.(get|post|put)|urllib\.request|\bfetch\(\s*["'`]https?:|axios\.|http\.request\(/, "Gọi mạng", "medium"],
  [/\bsubprocess\.|os\.system\(|child_process|\bexecSync\(|\bspawn\(/, "Chạy lệnh hệ thống", "medium"],
  [/rm\s+-rf\s+[~/$]|shutil\.rmtree\(|fs\.rmSync\(/, "Xóa thư mục", "medium"],
  [/~\/\.ssh|\.aws\/credentials|id_rsa|keychain|\.netrc/, "Đọc khóa / mật khẩu cục bộ", "high"],
  [/base64\s+(-d|--decode)\s*\|\s*(ba)?sh|eval\(\s*atob\(|String\.fromCharCode\([^)]{80,}/, "Mã bị làm rối", "high"],
];
const RANK: Record<Risk, number> = { none: 0, low: 1, medium: 2, high: 3 };
function scan(entries: Entry[]) {
  const flags = new Set<string>();
  let risk: Risk = "none";
  const scripts = entries.filter((e) => /\.(py|sh|bash|js|mjs|cjs|ts)$/i.test(e.path));
  if (scripts.length) risk = "low";
  for (const e of scripts) {
    const t = e.data.toString("utf8").slice(0, 400_000);
    for (const [re, label, r] of RULES) if (re.test(t)) { flags.add(label); if (RANK[r] > RANK[risk]) risk = r; }
  }
  return { risk, flags: [...flags], scripts: scripts.length };
}

// Anthropic giữ bản quyền các skill Office (docx, pdf, pptx, xlsx) và plugin trong repo claude-code: không được sao chép ra ngoài dịch vụ của họ.
const PROPRIETARY_HINT = /Anthropic[\s\S]{0,40}All rights reserved/i;

async function readPackage(repo: string, commit: string, src: Source): Promise<Found[]> {
  const zip = await JSZip.loadAsync(await repoZip(repo, commit));
  const files = Object.values(zip.files).filter((f) => !f.dir).map((f) => {
    const p = f.name.replace(/\\/g, "/").split("/").slice(1).join("/"); // bỏ thư mục gốc "<repo>-<commit>/"
    return { f, p };
  }).filter(({ p }) => p && !p.split("/").includes("..") && p.split("/").every(okSeg));
  const base = (src.path ?? "").replace(/^\/+|\/+$/g, "");
  const inBase = files.filter(({ p }) => !base || p === base || p.startsWith(base + "/"));
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  let roots = inBase.filter(({ p }) => path.posix.basename(p) === "SKILL.md").map(({ p }) => dirOf(p));
  roots = roots.filter((r) => !roots.some((o) => o !== r && (o === "" || r.startsWith(o + "/"))));
  const lic = new Map<string, string>();
  for (const { f, p } of files) if (/^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(path.posix.basename(p))) lic.set(dirOf(p), (await f.async("nodebuffer")).toString("utf8"));
  // README có mục "License" ngắn (vd. "MIT") khi repo không có file LICENSE.
  if (!lic.has("")) { const rd = files.find(({ p }) => /^readme\.md$/i.test(p)); if (rd) { const m = /##\s*Licen[cs]e\s*\n+([^\n]+)/i.exec((await rd.f.async("nodebuffer")).toString("utf8")); if (m) lic.set("", m[1]); } }
  const licenseFor = (dir: string) => { for (let d = dir; ; d = dirOf(d)) { if (lic.has(d)) return lic.get(d)!; if (!d) return ""; } };
  const out: Found[] = [];
  for (const dir of roots) {
    const rel = (p: string) => (dir ? p.slice(dir.length + 1) : p);
    const mine = inBase.filter(({ p }) => (dir ? p.startsWith(dir + "/") : true) && !roots.some((o) => o !== dir && o.startsWith(dir ? dir + "/" : "") && p.startsWith(o + "/")));
    const entries: Entry[] = [];
    let size = 0;
    for (const { f, p } of mine) {
      const r = rel(p);
      if (r !== "SKILL.md" && !isAllowed(r)) continue;
      const data = await f.async("nodebuffer");
      size += data.length;
      entries.push({ path: r, data });
    }
    const md = entries.find((e) => e.path === "SKILL.md")!;
    let name = path.posix.basename(dir) || repo.split("/")[1], description = "", blocked: string | undefined;
    try { const fm = parseSkillMd(md.data.toString("utf8")); name = fm.name; description = fm.description; }
    catch (e) { blocked = (e as Error).message; }
    const lt = licenseFor(dir);
    const lk = licenseKind(lt);
    if (lk.kind === "proprietary" || PROPRIETARY_HINT.test(lt)) blocked = "Giấy phép độc quyền: tác giả không cho sao chép skill này ra ngoài dịch vụ của họ.";
    else if (/^template(-skill)?$/.test(name)) blocked = "Đây là mẫu trống để tạo skill, không phải skill dùng được.";
    else if (size > PLUGIN_LIMITS.skillBytes) blocked = `Skill quá lớn (${(size / 1048576).toFixed(1)}MB, tối đa ${PLUGIN_LIMITS.skillBytes / 1048576}MB).`;
    else if (entries.length > PLUGIN_LIMITS.filesPerSkill + 1) blocked = `Quá nhiều file (${entries.length}, tối đa ${PLUGIN_LIMITS.filesPerSkill}).`;
    const sc = scan(entries);
    if (src.include?.length && !src.include.some((x) => x === name || x === dir || dir.endsWith("/" + x))) continue;
    if (src.exclude?.some((x) => x === name || x === dir || dir.endsWith("/" + x))) continue;
    out.push({ dir, entries, report: { name, description, dir, repo, files: entries.length, size, scripts: sc.scripts, license: lk.name, licenseKind: PROPRIETARY_HINT.test(lt) ? "proprietary" : lk.kind, risk: sc.risk, flags: sc.flags, ...(blocked ? { blocked } : {}) } });
  }
  return out;
}

// Gom mọi nguồn của plugin, bỏ skill trùng tên (giữ bản đầu tiên, ưu tiên thư mục .claude/skills và skills/).
async function collect(def: PluginDef) {
  const commits: Record<string, string> = {};
  const all: Found[] = [];
  for (const s of def.sources) {
    const commit = commits[s.repo] ?? (commits[s.repo] = await resolveCommit(s.repo, s.ref));
    all.push(...(await readPackage(s.repo, commit, s)));
  }
  const pref = (f: Found) => (/(^|\/)\.claude\/skills\//.test(f.dir + "/") ? 0 : /(^|\/)skills\//.test(f.dir + "/") ? 1 : 2);
  all.sort((a, b) => pref(a) - pref(b));
  const seen = new Map<string, Found>();
  for (const f of all) {
    const prev = seen.get(f.report.name);
    if (prev && !f.report.blocked) { f.report.duplicateOf = `${prev.report.repo}/${prev.dir}`; continue; }
    if (!prev) seen.set(f.report.name, f);
  }
  return { commits, found: all };
}

export type Preview = { def: PluginDef; skills: SkillReport[]; commits: Record<string, string>; size: number; installable: number };
export async function previewPlugin(def: PluginDef): Promise<Preview> {
  const { commits, found } = await collect(def);
  const ok = found.filter((f) => !f.report.blocked && !f.report.duplicateOf);
  return { def, skills: found.map((f) => f.report), commits, size: ok.reduce((a, f) => a + f.report.size, 0), installable: ok.length };
}

// ---------------------------------------------------------------- cài / cập nhật / gỡ
type Row = { id: string; owner: string; slug: string; catalog_id: string | null; name: string; description: string; author: string | null; homepage: string | null; color: string | null;
  studio: string | null; everywhere: number; enabled: number; sources: string; commits: string; size: number; created_at: number; updated_at: number; checked_at: number | null; latest: string | null };
type SRow = { id: string; plugin_id: string; name: string; description: string; body: string; storage_path: string; files: string; report: string; enabled: number; use_count: number; last_used_at: number | null };

const slugOk = (s: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(s);
export async function installPlugin(owner: string, def: PluginDef, opts: { skip?: string[]; by?: string } = {}) {
  const d = init();
  if (!slugOk(def.slug)) fail("Tên plugin không hợp lệ.");
  const existing = d.prepare("SELECT * FROM plugins WHERE owner = ? AND slug = ?").get(owner, def.slug) as Row | undefined;
  const used = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM plugins WHERE owner = ?").get(owner) as { n: number; b: number };
  const who = owner === "org" ? "Thư viện chung của tổ chức" : "Tài khoản của bạn";
  if (!existing && used.n >= PLUGIN_LIMITS.perOwner) fail(`${who} đã có ${used.n} plugin, mức tối đa là ${PLUGIN_LIMITS.perOwner}. Gỡ bớt plugin không dùng trong Kho kỹ năng (⋯ › Gỡ) rồi cài lại.`);
  const { commits, found } = await collect(def);
  // Skill người quản lý đã xóa khỏi thư viện (Quét skill rác → Xóa) không quay lại khi cập nhật từ repo.
  const removed = new Set(existing ? (d.prepare("SELECT name FROM plugin_removed WHERE plugin_id = ?").all(existing.id) as { name: string }[]).map((r) => r.name) : []);
  const keep = found.filter((f) => !f.report.blocked && !f.report.duplicateOf && !opts.skip?.includes(f.report.name) && !removed.has(f.report.name)).slice(0, PLUGIN_LIMITS.skills);
  if (!keep.length) fail("Không có skill nào cài được trong gói này.");
  const size = keep.reduce((a, f) => a + f.report.size, 0);
  if (size > PLUGIN_LIMITS.pluginBytes) fail(`Plugin quá lớn (${(size / 1048576).toFixed(0)}MB, tối đa ${PLUGIN_LIMITS.pluginBytes / 1048576}MB). Hãy bỏ bớt skill.`);
  if (used.b - (existing?.size ?? 0) + size > PLUGIN_LIMITS.ownerBytes) fail(`${who} đã dùng ${(used.b / 1073741824).toFixed(1)}GB cho plugin, cài thêm gói này (${(size / 1048576).toFixed(0)}MB) sẽ vượt mức ${PLUGIN_LIMITS.ownerBytes / 1073741824}GB. Gỡ bớt plugin không dùng trong Kho kỹ năng (⋯ › Gỡ) rồi cài lại.`);
  const id = existing?.id ?? "pl_" + crypto.randomBytes(8).toString("hex");
  const stamp = Date.now().toString(36);
  const prevSkills = existing ? (d.prepare("SELECT name, enabled, use_count, last_used_at FROM plugin_skills WHERE plugin_id = ?").all(id) as { name: string; enabled: number; use_count: number; last_used_at: number | null }[]) : [];
  // Skill tải lên thủ công (Thêm skill từ file zip) được giữ qua lần cài lại (restoreUploads): tệp của chúng cũng phải còn trên đĩa.
  const uploadDirs = new Set(existing ? uploadsOf(id).map((u) => u.storage_path.split("/")[2]) : []);
  const rows: SRow[] = [];
  for (const f of keep) {
    const p = parseEntries(f.entries, [], PLUGIN_LIMITS.filesPerSkill);
    const rel = path.posix.join("_plugins", id, stamp, p.name);
    const dir = path.join(ROOT, rel);
    for (const e of p.entries) {
      const dest = path.join(dir, e.path);
      if (!dest.startsWith(dir + path.sep)) fail("Đường dẫn không an toàn trong gói.");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.data);
    }
    const old = prevSkills.find((x) => x.name === p.name);
    rows.push({ id: crypto.randomUUID(), plugin_id: id, name: p.name, description: p.description, body: p.body, storage_path: rel, files: JSON.stringify(p.files), report: JSON.stringify(f.report), enabled: old ? old.enabled : 1, use_count: old?.use_count ?? 0, last_used_at: old?.last_used_at ?? null });
  }
  const now = Date.now();
  d.transaction(() => {
    if (existing) {
      d.prepare("UPDATE plugins SET name = ?, description = ?, author = ?, homepage = ?, color = ?, sources = ?, commits = ?, size = ?, updated_at = ?, checked_at = ?, latest = NULL WHERE id = ?")
        .run(def.name, def.description, def.author ?? null, def.homepage ?? null, def.color ?? null, JSON.stringify(def.sources), JSON.stringify(commits), size, now, now, id);
      d.prepare("DELETE FROM plugin_skills WHERE plugin_id = ?").run(id);
    } else {
      d.prepare(`INSERT INTO plugins (id, owner, slug, catalog_id, name, description, author, homepage, color, studio, everywhere, enabled, sources, commits, size, created_at, updated_at, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
        .run(id, owner, def.slug, def.catalogId ?? null, def.name, def.description, def.author ?? null, def.homepage ?? null, def.color ?? null, def.studio ?? null, def.everywhere ? 1 : 0, JSON.stringify(def.sources), JSON.stringify(commits), size, now, now, now);
    }
    const ins = d.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled, use_count, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of rows) ins.run(r.id, r.plugin_id, r.name, r.description, r.body, r.storage_path, r.files, r.report, r.enabled, r.use_count, r.last_used_at);
    // Skill bỏ chọn lúc cài cũng không quay lại khi cập nhật (trước đây "Cập nhật" cài lại cả những skill người dùng đã bỏ chọn).
    for (const n of opts.skip ?? []) if (found.some((f) => f.report.name === n)) d.prepare("INSERT OR IGNORE INTO plugin_removed (plugin_id, name, at) VALUES (?, ?, ?)").run(id, n, now);
  })();
  // Xóa bản cũ trên đĩa sau khi bản mới đã ghi xong.
  for (const e of await fs.readdir(path.join(PROOT(), id)).catch(() => [] as string[])) if (e !== stamp && !uploadDirs.has(e)) await fs.rm(path.join(PROOT(), id, e), { recursive: true, force: true });
  tagPlugin(id, opts.by ?? (owner === "org" ? undefined : owner));
  return getPlugin(id)!;
}

// Skill của plugin không gắn studio: Synchro tự xếp vào Tài liệu / Trình bày / Thiết kế (skillstudio.ts) để chúng vào thư viện của mục đó
// ở trang Artifacts. Plugin studio giữ đúng danh sách đã chọn, không tự thêm sang mục khác. by: tài khoản có model để xếp lại ở nền.
function tagPlugin(id: string, by?: string) {
  const pl = init().prepare("SELECT studio FROM plugins WHERE id = ?").get(id) as { studio: string | null } | undefined;
  if (!pl) return;
  const rows = init().prepare("SELECT name, description, body FROM plugin_skills WHERE plugin_id = ?").all(id) as { name: string; description: string; body: string }[];
  keepPluginTags(id, rows.map((r) => r.name));
  if (pl.studio) return;
  for (const r of rows) { const key = pluginKey(id, r.name); if (classify(key, r) && by) refine(by, key, r); }
}
/** Xếp mục cho mọi skill của plugin chưa xếp (khi máy chủ khởi động: plugin cài trước khi có tính năng này). */
export function ensurePluginTags() {
  for (const r of init().prepare("SELECT id FROM plugins WHERE studio IS NULL").all() as { id: string }[]) tagPlugin(r.id);
}

// Thêm skill từ file zip tải lên (vd. bộ skill không có trên GitHub) vào một plugin có sẵn.
export async function addZipToPlugin(id: string, buf: Buffer) {
  const d = init();
  const pl = d.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Row | undefined;
  if (!pl) fail("Không tìm thấy plugin.", 404);
  if (buf.length > PLUGIN_LIMITS.zip) fail("File zip quá lớn.");
  const zip = await JSZip.loadAsync(buf).catch(() => fail("Không đọc được file zip."));
  const files = Object.values(zip.files).filter((f) => !f.dir).map((f) => ({ f, p: f.name.replace(/\\/g, "/") })).filter(({ p }) => !p.split("/").includes("..") && !p.startsWith("/") && p.split("/").every(okSeg));
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  let roots = files.filter(({ p }) => path.posix.basename(p) === "SKILL.md").map(({ p }) => dirOf(p));
  roots = roots.filter((r) => !roots.some((o) => o !== r && (o === "" || r.startsWith(o + "/"))));
  if (!roots.length) fail("Không tìm thấy SKILL.md trong file zip.");
  const added: string[] = [];
  const stamp = "up" + Date.now().toString(36);
  for (const dir of roots) {
    const entries: Entry[] = [];
    for (const { f, p } of files) {
      if (dir && !p.startsWith(dir + "/")) continue;
      const r = dir ? p.slice(dir.length + 1) : p;
      if (r !== "SKILL.md" && !isAllowed(r)) continue;
      entries.push({ path: r, data: await f.async("nodebuffer") });
    }
    const p = parseEntries(entries, [], PLUGIN_LIMITS.filesPerSkill);
    const sc = scan(entries);
    const rel = path.posix.join("_plugins", id, stamp, p.name);
    for (const e of p.entries) { const dest = path.join(ROOT, rel, e.path); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, e.data); }
    const report: SkillReport = { name: p.name, description: p.description, dir: dir || ".", repo: "upload", files: entries.length, size: entries.reduce((a, e) => a + e.data.length, 0), scripts: sc.scripts, license: "Tải lên", licenseKind: "unknown", risk: sc.risk, flags: sc.flags };
    d.prepare(`INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(plugin_id, name) DO UPDATE SET description = excluded.description, body = excluded.body, storage_path = excluded.storage_path, files = excluded.files, report = excluded.report`)
      .run(crypto.randomUUID(), id, p.name, p.description, p.body, rel, JSON.stringify(p.files), JSON.stringify(report));
    added.push(p.name);
  }
  // Ghi nhớ để lần cập nhật từ GitHub không làm mất skill tải lên.
  const srcs = JSON.parse(pl!.sources) as Source[];
  d.prepare("UPDATE plugins SET sources = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(srcs), Date.now(), id);
  tagPlugin(id, pl!.owner === "org" ? undefined : pl!.owner);
  return { added, plugin: getPlugin(id)! };
}

/**
 * Thêm một skill (đã kiểm tra, tệp nằm ở data/skills/…) vào "Thư viện cho mọi người": một thư viện một skill của tổ chức, mọi tài khoản dùng
 * được như các thư viện khác. Tạo skill mới (dán link, tải lên, Synchro viết, lưu cách làm) chọn "cho mọi người" thì đi đường này.
 * Cùng tên thì cập nhật thư viện đó. by: người thêm (hiện ở dòng "từ …"); source: link gốc nếu có.
 */
export async function publishSkill(s: Skill, by: { name: string; source?: string }) {
  const d = init();
  const base = path.join(ROOT, s.storage_path);
  const entries: Entry[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else entries.push({ path: path.relative(base, full).split(path.sep).join("/"), data: await fs.readFile(full) });
    }
  };
  await walk(base).catch(() => fail("Không còn tệp của skill này trên máy chủ.", 410));
  const p = parseEntries(entries, [], PLUGIN_LIMITS.filesPerSkill);
  const slug = `skill-${p.name}`.slice(0, 41).replace(/-+$/, "");
  const existing = d.prepare("SELECT * FROM plugins WHERE owner = 'org' AND slug = ?").get(slug) as Row | undefined;
  if (!existing && (d.prepare("SELECT COUNT(*) AS n FROM plugins WHERE owner = 'org'").get() as { n: number }).n >= PLUGIN_LIMITS.perOwner) fail(`Thư viện cho mọi người đã đủ ${PLUGIN_LIMITS.perOwner} mục.`);
  const id = existing?.id ?? "pl_" + crypto.randomBytes(8).toString("hex");
  const stamp = "sk" + Date.now().toString(36);
  const rel = path.posix.join("_plugins", id, stamp, p.name);
  for (const e of p.entries) {
    const dest = path.join(ROOT, rel, e.path);
    if (!dest.startsWith(path.join(ROOT, rel) + path.sep)) fail("Đường dẫn không an toàn trong skill.");
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, e.data);
  }
  const sc = scan(p.entries);
  const size = p.entries.reduce((a, e) => a + e.data.length, 0);
  const report: SkillReport = { name: p.name, description: p.description, dir: ".", repo: by.source ?? "synchro", files: p.entries.length, size, scripts: sc.scripts, license: "Thêm từ Kho kỹ năng", licenseKind: "unknown", risk: sc.risk, flags: sc.flags };
  const title = /^#\s+(.+)$/m.exec(p.body)?.[1]?.replace(/[*_`]/g, "").trim().slice(0, 80) || p.name;
  const now = Date.now();
  d.transaction(() => {
    if (existing) {
      d.prepare("UPDATE plugins SET name = ?, description = ?, author = ?, homepage = ?, size = ?, updated_at = ? WHERE id = ?").run(title, p.description, by.name, by.source ?? null, size, now, id);
      d.prepare("DELETE FROM plugin_skills WHERE plugin_id = ?").run(id);
    } else {
      d.prepare(`INSERT INTO plugins (id, owner, slug, catalog_id, name, description, author, homepage, color, studio, everywhere, enabled, sources, commits, size, created_at, updated_at, checked_at)
        VALUES (?, 'org', ?, NULL, ?, ?, ?, ?, NULL, NULL, 0, 1, '[]', '{}', ?, ?, ?, ?)`).run(id, slug, title, p.description, by.name, by.source ?? null, size, now, now, now);
    }
    d.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)")
      .run(crypto.randomUUID(), id, p.name, p.description, p.body, rel, JSON.stringify(p.files), JSON.stringify(report));
  })();
  for (const e of await fs.readdir(path.join(PROOT(), id)).catch(() => [] as string[])) if (e !== stamp) await fs.rm(path.join(PROOT(), id, e), { recursive: true, force: true });
  tagPlugin(id, s.user_id);
  return getPlugin(id)!;
}

/** Xóa hẳn một số skill khỏi thư viện (tệp trên đĩa, mục ở Artifacts) và ghi nhớ để lần cập nhật từ repo không thêm lại.
 *  Thư viện không còn skill nào thì gỡ luôn thư viện (uninstalled). */
export async function removePluginSkills(id: string, names: string[]) {
  const d = init();
  const rows = (d.prepare("SELECT name, storage_path, report FROM plugin_skills WHERE plugin_id = ?").all(id) as { name: string; storage_path: string; report: string }[]).filter((r) => names.includes(r.name));
  if (!rows.length) return { removed: [] as string[], uninstalled: false };
  const now = Date.now();
  d.transaction(() => {
    for (const r of rows) {
      d.prepare("DELETE FROM plugin_skills WHERE plugin_id = ? AND name = ?").run(id, r.name);
      d.prepare("INSERT OR REPLACE INTO plugin_removed (plugin_id, name, at) VALUES (?, ?, ?)").run(id, r.name, now);
      dropTag(pluginKey(id, r.name));
    }
  })();
  const base = path.join(PROOT(), id);
  for (const r of rows) { const dir = path.join(ROOT, r.storage_path); if (dir.startsWith(base + path.sep)) await fs.rm(dir, { recursive: true, force: true }); }
  const left = d.prepare("SELECT report FROM plugin_skills WHERE plugin_id = ?").all(id) as { report: string }[];
  if (!left.length) { await removePlugin(id); return { removed: rows.map((r) => r.name), uninstalled: true }; }
  d.prepare("UPDATE plugins SET size = ?, updated_at = ? WHERE id = ?").run(left.reduce((a, r) => a + ((JSON.parse(r.report) as SkillReport).size ?? 0), 0), now, id);
  return { removed: rows.map((r) => r.name), uninstalled: false };
}

export async function removePlugin(id: string) {
  init().prepare("DELETE FROM plugins WHERE id = ?").run(id);
  dropPluginTags(id);
  await fs.rm(path.join(PROOT(), id), { recursive: true, force: true });
}

// Kiểm tra cập nhật: commit mới nhất của từng nguồn khác commit đã cài thì ghi lại để giao diện hiện nút "Cập nhật".
export async function checkUpdate(id: string) {
  const d = init();
  const pl = d.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Row | undefined;
  if (!pl) return fail("Không tìm thấy plugin.", 404);
  const srcs = JSON.parse(pl.sources) as Source[];
  const cur = JSON.parse(pl.commits) as Record<string, string>;
  const latest: Record<string, string> = {};
  for (const s of srcs) latest[s.repo] ??= await resolveCommit(s.repo, s.ref);
  const changed = Object.entries(latest).filter(([r, c]) => cur[r] && /^[0-9a-f]{40}$/.test(c) && c !== cur[r]).map(([r]) => r);
  d.prepare("UPDATE plugins SET checked_at = ?, latest = ? WHERE id = ?").run(Date.now(), changed.length ? JSON.stringify(latest) : null, id);
  return { changed };
}
export async function updatePlugin(id: string) {
  const pl = init().prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Row | undefined;
  if (!pl) return fail("Không tìm thấy plugin.", 404);
  const uploads = uploadsOf(id);
  const out = await installPlugin(pl.owner, { catalogId: pl.catalog_id ?? undefined, slug: pl.slug, name: pl.name, description: pl.description, author: pl.author ?? undefined, homepage: pl.homepage ?? undefined, color: pl.color ?? undefined, studio: (pl.studio as Studio) ?? null, everywhere: !!pl.everywhere, sources: JSON.parse(pl.sources) });
  restoreUploads(id, uploads, pl.owner);
  return out;
}
// Giữ skill tải lên thủ công (không có trên GitHub) qua lần cài lại từ GitHub.
const uploadsOf = (id: string) => init().prepare("SELECT * FROM plugin_skills WHERE plugin_id = ? AND report LIKE '%\"repo\":\"upload\"%'").all(id) as SRow[];
function restoreUploads(id: string, uploads: SRow[], owner: string) {
  if (!uploads.length) return;
  const ins = init().prepare("INSERT OR IGNORE INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled, use_count, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const u of uploads) ins.run(u.id, u.plugin_id, u.name, u.description, u.body, u.storage_path, u.files, u.report, u.enabled, u.use_count, u.last_used_at);
  tagPlugin(id, owner === "org" ? undefined : owner);
}

// ---------------------------------------------------------------- đọc
export type PublicPlugin = {
  id: string; scope: "org" | "personal"; slug: string; catalogId: string | null; name: string; description: string; author: string | null; homepage: string | null; color: string | null;
  studio: Studio | null; everywhere: boolean; enabled: boolean; mine: { enabled: boolean; everywhere: boolean }; sources: Source[]; commits: Record<string, string>; size: number;
  updatedAt: number; checkedAt: number | null; updateAvailable: boolean; skills: { id: string; name: string; description: string; enabled: boolean; report: SkillReport; useCount: number; lastUsed: number | null }[];
  risk: Risk; licenses: string[];
};
function pub(r: Row, uid?: string): PublicPlugin {
  const skills = (init().prepare("SELECT * FROM plugin_skills WHERE plugin_id = ? ORDER BY name").all(r.id) as SRow[]).map((s) => ({ id: s.id, name: s.name, description: s.description, enabled: !!s.enabled, report: JSON.parse(s.report) as SkillReport, useCount: s.use_count, lastUsed: s.last_used_at }));
  const pref = uid ? (init().prepare("SELECT enabled, everywhere FROM plugin_prefs WHERE user_id = ? AND plugin_id = ?").get(uid, r.id) as { enabled: number | null; everywhere: number | null } | undefined) : undefined;
  const risk = skills.reduce<Risk>((a, s) => (RANK[s.report.risk] > RANK[a] ? s.report.risk : a), "none");
  return {
    id: r.id, scope: r.owner === "org" ? "org" : "personal", slug: r.slug, catalogId: r.catalog_id, name: r.name, description: r.description, author: r.author, homepage: r.homepage, color: r.color,
    studio: (r.studio as Studio) ?? null, everywhere: !!r.everywhere, enabled: !!r.enabled,
    mine: { enabled: pref?.enabled === null || pref?.enabled === undefined ? true : !!pref.enabled, everywhere: pref?.everywhere === null || pref?.everywhere === undefined ? !!r.everywhere : !!pref.everywhere },
    sources: JSON.parse(r.sources), commits: JSON.parse(r.commits), size: r.size, updatedAt: r.updated_at, checkedAt: r.checked_at, updateAvailable: !!r.latest,
    skills, risk, licenses: [...new Set(skills.map((s) => s.report.license))],
  };
}
export const getPlugin = (id: string, uid?: string) => { const r = init().prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Row | undefined; return r ? pub(r, uid) : null; };
export const pluginOwner = (id: string) => (init().prepare("SELECT owner FROM plugins WHERE id = ?").get(id) as { owner: string } | undefined)?.owner ?? null;
// Plugin người này thấy: của tổ chức (quản trị viên cài) và của riêng họ.
export function listPlugins(uid: string): PublicPlugin[] {
  return (init().prepare("SELECT * FROM plugins WHERE owner = 'org' OR owner = ? ORDER BY owner = 'org' DESC, name").all(uid) as Row[]).map((r) => pub(r, uid));
}

/** Nội dung mọi skill trong các thư viện người này thấy, kể cả skill đang tắt (Kho kỹ năng → Quét skill rác). */
export function pluginSkillsOf(uid: string): { p: PublicPlugin; rows: { name: string; description: string; body: string; files: number; enabled: boolean }[] }[] {
  const st = init().prepare("SELECT name, description, body, files, enabled FROM plugin_skills WHERE plugin_id = ? ORDER BY name");
  return listPlugins(uid).map((p) => ({ p, rows: (st.all(p.id) as Pick<SRow, "name" | "description" | "body" | "files" | "enabled">[]).map((r) => ({ name: r.name, description: r.description, body: r.body, files: (JSON.parse(r.files) as unknown[]).length, enabled: !!r.enabled })) }));
}

export function setPlugin(id: string, patch:{ enabled?: boolean; everywhere?: boolean; studio?: Studio | null; skills?: Record<string, boolean> }) {
  const d = init();
  if (typeof patch.enabled === "boolean") d.prepare("UPDATE plugins SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
  if (typeof patch.everywhere === "boolean") d.prepare("UPDATE plugins SET everywhere = ? WHERE id = ?").run(patch.everywhere ? 1 : 0, id);
  if (patch.studio === null || (typeof patch.studio === "string" && STUDIOS.includes(patch.studio))) { d.prepare("UPDATE plugins SET studio = ? WHERE id = ?").run(patch.studio, id); tagPlugin(id); }
  if (patch.skills && typeof patch.skills === "object") for (const [n, on] of Object.entries(patch.skills)) d.prepare("UPDATE plugin_skills SET enabled = ? WHERE plugin_id = ? AND name = ?").run(on ? 1 : 0, id, n);
}
// Lựa chọn riêng của một người với plugin của tổ chức (tắt cho mình, dùng mọi nơi hay không).
export function setPref(uid: string, id: string, p: { enabled?: boolean; everywhere?: boolean }) {
  const d = init();
  const cur = d.prepare("SELECT enabled, everywhere FROM plugin_prefs WHERE user_id = ? AND plugin_id = ?").get(uid, id) as { enabled: number | null; everywhere: number | null } | undefined;
  d.prepare("INSERT INTO plugin_prefs (user_id, plugin_id, enabled, everywhere) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, plugin_id) DO UPDATE SET enabled = excluded.enabled, everywhere = excluded.everywhere")
    .run(uid, id, typeof p.enabled === "boolean" ? (p.enabled ? 1 : 0) : cur?.enabled ?? null, typeof p.everywhere === "boolean" ? (p.everywhere ? 1 : 0) : cur?.everywhere ?? null);
}

// ---------------------------------------------------------------- dùng trong chat
const toSkill = (s: SRow, plugin: string): Skill => ({
  id: s.id, user_id: plugin, name: s.name, description: s.description, body: s.body, storage_path: s.storage_path, enabled: true, version: 1, versions: [1],
  created_at: "", updated_at: "", files: JSON.parse(s.files), warnings: [], projects: [], use_count: s.use_count, last_used_at: null, source: null,
});
function active(uid: string) {
  return listPlugins(uid).filter((p) => p.enabled && p.mine.enabled);
}
export const MINE_LABEL = "Kho kỹ năng của bạn";
// Thư viện của một studio (khi người dùng bấm Thiết kế / Trình bày / Tài liệu, và mục lục studio trong chat thường): skill của các plugin
// gắn với studio, cộng skill Synchro tự nhận diện thuộc mục này — skill của người dùng (Kho kỹ năng) và skill của plugin không gắn studio.
// Trùng tên: skill của người dùng trước, rồi plugin studio, rồi plugin khác. auto: những skill được tự thêm (from: nguồn).
export function studioSkills(uid: string, studio: Studio): { skills: Skill[]; plugins: string[]; auto: { name: string; from: string }[] } {
  const act = active(uid);
  const rows = (id: string) => init().prepare("SELECT * FROM plugin_skills WHERE plugin_id = ? AND enabled = 1 ORDER BY name").all(id) as SRow[];
  const ps = act.filter((p) => p.studio === studio);
  const mine = enabledSkillsByIds(uid, userStudioIds(uid, studio));
  const others = act.filter((p) => !p.studio).map((p) => {
    const rs = rows(p.id), tags = tagsOf(rs.map((r) => pluginKey(p.id, r.name)));
    return { p, skills: rs.filter((r) => tags.get(pluginKey(p.id, r.name))?.studios.includes(studio)).map((r) => toSkill(r, p.id)) };
  }).filter((x) => x.skills.length);
  const skills: Skill[] = [], auto: { name: string; from: string }[] = [];
  const add = (k: Skill, from?: string) => { if (skills.some((x) => x.name === k.name)) return; skills.push(k); if (from) auto.push({ name: k.name, from }); };
  for (const k of mine) add(k, MINE_LABEL);
  for (const p of ps) for (const r of rows(p.id)) add(toSkill(r, p.id));
  for (const o of others) for (const k of o.skills) add(k, o.p.name);
  return { skills, plugins: [...ps.map((p) => p.name), ...(mine.length ? [MINE_LABEL] : []), ...others.map((o) => o.p.name)], auto };
}
/** Cho trang Artifacts: mỗi studio có bao nhiêu skill, từ đâu, skill nào được tự thêm. */
export function studioSummary(uid: string) {
  return Object.fromEntries(STUDIOS.map((s) => { const r = studioSkills(uid, s); return [s, { name: r.plugins.join(", "), skills: r.skills.length, auto: r.auto }]; })
    .filter(([, v]) => (v as { skills: number }).skills > 0)) as Partial<Record<Studio, { name: string; skills: number; auto: { name: string; from: string }[] }>>;
}
// Skill của plugin bật "dùng trong mọi cuộc trò chuyện".
export function everywhereSkills(uid: string): Skill[] {
  return active(uid).filter((p) => p.mine.everywhere).flatMap((p) => (init().prepare("SELECT * FROM plugin_skills WHERE plugin_id = ? AND enabled = 1 ORDER BY name").all(p.id) as SRow[]).map((s) => toSkill(s, p.id)));
}
// Plugin không gắn studio và chưa bật "mọi cuộc trò chuyện": vào chat thường dưới dạng một thư viện riêng, model tự mở khi cần.
export function libraryPlugins(uid: string): { slug: string; name: string; description: string; skills: Skill[] }[] {
  return active(uid).filter((p) => !p.studio && !p.mine.everywhere)
    .map((p) => ({ slug: p.slug, name: p.name, description: p.description, skills: (init().prepare("SELECT * FROM plugin_skills WHERE plugin_id = ? AND enabled = 1 ORDER BY name").all(p.id) as SRow[]).map((s) => toSkill(s, p.id)) }))
    .filter((l) => l.skills.length);
}
export function recordPluginUse(ids: string[]) {
  const st = init().prepare("UPDATE plugin_skills SET use_count = use_count + 1, last_used_at = ? WHERE id = ?");
  for (const id of ids) st.run(Date.now(), id);
}
export const studioOf = (v: unknown): Studio | null => (typeof v === "string" && (STUDIOS as string[]).includes(v) ? (v as Studio) : null);
export async function removeUserPlugins(uid: string) {
  const ids = (init().prepare("SELECT id FROM plugins WHERE owner = ?").all(uid) as { id: string }[]).map((x) => x.id);
  for (const id of ids) await removePlugin(id);
  init().prepare("DELETE FROM plugin_prefs WHERE user_id = ?").run(uid);
}
export { isText };

// ---------------------------------------------------------------- cài sẵn 3 studio cho cả tổ chức (một lần)
// Chạy khi máy chủ khởi động (instrumentation.ts). Đã cài xong một lần thì ghi nhớ, quản trị viên gỡ đi cũng không tự cài lại.
// Lỗi mạng thì thử lại ở lần khởi động sau. Tắt bằng SYNCHRO_DEFAULT_PLUGINS=0.
export async function ensureDefaultPlugins() {
  const d = init();
  d.exec("CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const { PLUGIN_DIR } = await import("./plugindir");
  const studios = PLUGIN_DIR.filter((p) => p.category === "studio");
  if (!d.prepare("SELECT 1 FROM plugin_meta WHERE key = 'defaults'").get()) {
    let ok = true;
    for (const def of studios) {
      if (d.prepare("SELECT 1 FROM plugins WHERE owner = 'org' AND catalog_id = ?").get(def.catalogId)) continue;
      try { await installPlugin("org", def); console.log(`[plugins] đã cài sẵn ${def.name}`); }
      catch (e) { ok = false; console.error(`[plugins] chưa cài được ${def.name}:`, (e as Error).message); }
    }
    if (ok) d.prepare("INSERT OR REPLACE INTO plugin_meta (key, value) VALUES ('defaults', ?)").run(String(Date.now()));
  }
  await syncStudioCatalog();
}
export async function syncStudioCatalog() {
  const d = init();
  const { PLUGIN_DIR } = await import("./plugindir");
  const studios = PLUGIN_DIR.filter((p) => p.category === "studio");
  // Danh mục studio có thêm skill (vd. sau một lượt rà các repo): cập nhật plugin studio đã cài của tổ chức theo nguồn mới, giữ studio,
  // lựa chọn bật / tắt từng skill và skill tải lên. Chỉ khi nguồn đã cài khác danh mục; quản trị viên đã gỡ thì thôi; lỗi mạng thì thử lại lần sau.
  for (const def of studios) {
    const row = d.prepare("SELECT * FROM plugins WHERE owner = 'org' AND catalog_id = ?").get(def.catalogId) as Row | undefined;
    if (!row || row.sources === JSON.stringify(def.sources)) continue;
    try {
      const uploads = uploadsOf(row.id);
      await installPlugin("org", { ...def, studio: (row.studio as Studio) ?? null, everywhere: !!row.everywhere });
      restoreUploads(row.id, uploads, "org");
      console.log(`[plugins] đã cập nhật ${def.name} theo danh mục mới`);
    } catch (e) { console.error(`[plugins] chưa cập nhật được ${def.name}:`, (e as Error).message); }
  }
}
