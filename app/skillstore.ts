// Lưu trữ + kiểm tra skill (chỉ chạy ở server).
// Bảng skills / skill_files / skill_enablement nằm trong data/synchro.db; file gốc ở data/skills/<user_id>/<skill_id>/v<N>/...
// Mọi hàm đều nhận userId: skill của người này không bao giờ lộ sang người khác.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { parse as parseYaml } from "yaml";
import { db, DATA_DIR } from "./authstore";
import { runner } from "./coderun";

export const ROOT = process.env.SKILLS_DIR ?? path.join(DATA_DIR, "skills");

export const LIMITS = {
  zip: 20 * 1024 * 1024,
  unzipped: 100 * 1024 * 1024,
  files: 5000,        // số tệp tối đa mỗi skill (skill thật có thể kèm cả nghìn ảnh / biểu tượng mẫu); dung lượng giới hạn ở unzipped
  fileRead: 100_000, // ký tự tối đa trả cho model mỗi lần đọc
  bodyTokens: 5000,
  desc: 1024,        // nên ngắn hơn mức này (cảnh báo)
  descMax: 2048,     // dài hơn mức này thì từ chối
  name: 64,
  skills: 200,             // số skill tối đa mỗi tài khoản
  userBytes: 300 * 1024 * 1024, // dung lượng skill tối đa mỗi tài khoản (mọi phiên bản)
  uploadsPerHour: 60,      // mỗi tài khoản
  githubZip: 60 * 1024 * 1024, // zip tải từ GitHub (cả repo, chỉ giữ thư mục skill được chọn)
  scriptOut: 20_000,       // ký tự stdout/stderr tối đa trả về khi chạy script
};

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".rst", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".xsd", ".xsl", ".dtd", ".svg", ".html", ".htm", ".css", ".scss", ".less",
  ".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".lua", ".pl", ".r", ".sql",
  ".graphql", ".proto", ".tex", ".bib", ".vue", ".svelte", ".ipynb"]);
const BIN_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf", ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".ttf", ".otf", ".woff", ".woff2"]);
// File không có đuôi nhưng là văn bản quen thuộc trong repo
const TEXT_NAMES = new Set(["LICENSE", "LICENCE", "README", "NOTICE", "COPYING", "AUTHORS", "CHANGELOG", "Makefile", "Dockerfile"]);
const MIME: Record<string, string> = {
  ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".py": "text/x-python", ".svg": "image/svg+xml", ".yaml": "text/yaml", ".yml": "text/yaml", ".html": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".ts": "text/typescript", ".sh": "text/x-shellscript", ".xml": "application/xml", ".toml": "text/plain", ".ini": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".pdf": "application/pdf", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".xsd": "application/xml",
};
export const isText = (p: string) => TEXT_EXT.has(extOf(p)) || (!extOf(p) && TEXT_NAMES.has(path.posix.basename(p)));
export const isAllowed = (p: string) => isText(p) || BIN_EXT.has(extOf(p));

export type SkillFile = { path: string; size: number; mime_type: string; kind: "reference" | "script" | "asset" };
export type Skill = {
  id: string; user_id: string; name: string; description: string; body: string; storage_path: string;
  enabled: boolean; version: number; versions: number[]; created_at: string; updated_at: string;
  files: SkillFile[]; warnings: string[]; projects: string[]; use_count: number; last_used_at: string | null;
};
// Gói chứa nhiều skill: trả về danh sách để người dùng chọn (dir dùng làm `pick` khi gửi lại).
export type SkillChoice = { dir: string; name: string; description: string; error?: string; exists: boolean };
export type Preview = { name: string; description: string; body: string; files: SkillFile[]; warnings: string[]; tokens: number; exists: boolean; version: number };
export class SkillError extends Error { status = 400; }
// Chuyển lỗi thành phản hồi API. Gói có nhiều skill không phải lỗi: trả danh sách để giao diện cho chọn.
export const skillErr = (e: unknown) =>
  e instanceof MultiSkillError ? Response.json({ choices: e.choices, message: e.message })
  : e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status })
  : (console.error("[skills]", e), Response.json({ error: "Lỗi máy chủ khi xử lý skill" }, { status: 500 }));
/** Gói / repo không có SKILL.md nào: link GitHub / git thì Synchro đọc toàn repo và tự viết skill (app/skillgen.ts). */
export class NoSkillError extends SkillError {}
export class MultiSkillError extends SkillError { constructor(public choices: SkillChoice[]) { super(`Gói có ${choices.length} skill. Hãy chọn skill muốn thêm.`); this.status = 300; } }
const fail = (m: string, status = 400): never => { const e = new SkillError(m); e.status = status; throw e; };

// ---------------------------------------------------------------- đọc từ DB
type Row = { id: string; user_id: string; name: string; description: string; body: string; storage_path: string; enabled: number; version: number; versions: string; warnings: string; created_at: number; updated_at: number; use_count: number | null; last_used_at: number | null };
// Ghi chú về script tính theo máy chủ lúc đọc (không lưu cố định lúc tải lên): có nơi chạy code thì không cần ghi chú gì.
// Bỏ ghi chú cũ đã lưu ở các bản trước (nhắc tới quyền Sandbox theo tài khoản, không còn đúng).
function scriptNote(files: SkillFile[], stored: string[]): string[] {
  const out = stored.filter((w) => !/^Gói có script/.test(w));
  if (files.some((f) => f.kind === "script") && !runner()) out.push("Gói có script. Máy chủ chưa có nơi chạy code nên model chỉ đọc script như tài liệu, không chạy");
  return out;
}
function hydrate(r: Row): Skill {
  const files = db().prepare("SELECT path, size, mime_type, kind FROM skill_files WHERE skill_id = ? ORDER BY path").all(r.id) as SkillFile[];
  const projects = (db().prepare("SELECT scope_id FROM skill_enablement WHERE skill_id = ? AND scope = 'project'").all(r.id) as { scope_id: string }[]).map((x) => x.scope_id);
  return {
    id: r.id, user_id: r.user_id, name: r.name, description: r.description, body: r.body, storage_path: r.storage_path,
    enabled: !!r.enabled, version: r.version, versions: JSON.parse(r.versions), warnings: scriptNote(files, JSON.parse(r.warnings)),
    created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(), files, projects,
    use_count: r.use_count ?? 0, last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  };
}

export const listSkills = async (uid: string) => (db().prepare("SELECT * FROM skills WHERE user_id = ? ORDER BY name").all(uid) as Row[]).map(hydrate);
export const getSkill = async (uid: string, name: string) => {
  const r = db().prepare("SELECT * FROM skills WHERE user_id = ? AND name = ?").get(uid, name) as Row | undefined;
  return r ? hydrate(r) : null;
};
// Skill model được dùng: bật cho cả tài khoản, hoặc bật riêng trong dự án đang chat.
export const enabledSkills = async (uid: string, projectId?: string | null) =>
  (db().prepare(`SELECT * FROM skills WHERE user_id = ? AND (enabled = 1 ${projectId ? "OR id IN (SELECT skill_id FROM skill_enablement WHERE scope = 'project' AND scope_id = ?)" : ""}) ORDER BY name`)
    .all(...(projectId ? [uid, projectId] : [uid])) as Row[]).map(hydrate);

// ---------------------------------------------------------------- validate
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const extOf = (p: string) => path.posix.extname(p).toLowerCase();
const kindOf = (p: string): SkillFile["kind"] =>
  /^references\//.test(p) ? "reference"
  : /^scripts\//.test(p) || [".py", ".sh", ".js", ".ts"].includes(extOf(p)) ? "script"
  : /^assets\//.test(p) || BIN_EXT.has(extOf(p)) ? "asset" : "reference";
export const estTokens = (s: string) => Math.ceil(s.length / 4);

function cleanPath(p: string): string {
  const n = p.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").includes("..")) fail(`Đường dẫn không an toàn trong file nén: "${p}" (chứa ".." hoặc bắt đầu bằng "/")`);
  return path.posix.normalize(n);
}

// SKILL.md ngoài đời hay viết frontmatter chưa đúng YAML (dấu ngoặc kép giữa câu: description: "Dùng khi" người dùng hỏi…; dấu ":" trong
// description không bọc ngoặc) — Claude Code vẫn đọc được. Synchro sửa từng dòng "khóa: giá trị" hỏng thành chuỗi JSON (là YAML hợp lệ),
// giá trị viết tiếp ở các dòng thụt vào gộp lại; dòng hợp lệ và khối lồng nhau giữ nguyên.
function repairFrontmatter(src: string): string {
  const lines = src.split("\n"), out: string[] = [];
  const unquote = (v: string) => {
    const t = v.trim();
    if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"');
    if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    return t;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]+(\S.*)$/);
    if (!m || /^[|>][-+0-9]*\s*$/.test(m[2])) { out.push(lines[i]); continue; }
    let j = i;
    while (j + 1 < lines.length && /^[ \t]+\S/.test(lines[j + 1])) j++;
    const chunk = lines.slice(i, j + 1).join("\n");
    try { parseYaml(chunk); out.push(chunk); }
    catch { out.push(`${m[1]}: ${JSON.stringify(unquote([m[2], ...lines.slice(i + 1, j + 1).map((l) => l.trim())].join(" ")))}`); }
    i = j;
  }
  return out.join("\n");
}

// repaired: cả tệp SKILL.md với frontmatter đã sửa (chỉ có khi bản gốc chưa đúng YAML) — lưu bản này để mọi nơi đọc skill đều đọc được.
export function parseSkillMd(raw: string): { name: string; description: string; body: string; repaired?: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return fail("SKILL.md phải bắt đầu bằng phần frontmatter YAML (--- ... ---) chứa name và description");
  let fm: unknown, fixed: string | null = null;
  try { fm = parseYaml(m[1]); } catch (e) {
    fixed = repairFrontmatter(m[1]);
    try { fm = parseYaml(fixed); } catch { return fail("Frontmatter YAML không hợp lệ: " + String((e as Error).message).split("\n")[0]); }
  }
  if (!fm || typeof fm !== "object") return fail("Frontmatter của SKILL.md đang trống");
  const o = fm as Record<string, unknown>;
  if (o.name === undefined || o.name === null || String(o.name).trim() === "") fail("Thiếu trường name trong SKILL.md");
  if (o.description === undefined || o.description === null || String(o.description).trim() === "") fail("Thiếu trường description trong SKILL.md");
  const name = String(o.name).trim();
  const description = String(o.description).replace(/\s+/g, " ").trim();
  if (name.length > LIMITS.name) fail(`name quá dài (${name.length} ký tự, tối đa ${LIMITS.name})`);
  if (!NAME_RE.test(name)) fail(`name "${name}" không hợp lệ: chỉ dùng chữ thường, số và dấu gạch ngang (ví dụ: brand-style)`);
  if (description.length > LIMITS.descMax) fail(`description quá dài (${description.length} ký tự, tối đa ${LIMITS.descMax})`);
  const body = text.slice(m[0].length).trim();
  return { name, description, body, ...(fixed !== null ? { repaired: `---\n${fixed}\n---\n${text.slice(m[0].length)}` } : {}) };
}

// Cảnh báo khi SKILL.md nhắc tới file không có trong gói. Bỏ qua đường dẫn mẫu ({lang}/…, <tên>, *.md)
// và chỉ xét thư mục quen thuộc của skill hoặc thư mục có thật trong gói, để không báo nhầm file đầu ra.
const SKILL_DIRS = new Set(["references", "reference", "scripts", "assets", "templates", "examples", "docs"]);
function missingRefs(body: string, have: Set<string>): string[] {
  const dirs = new Set([...SKILL_DIRS, ...[...have].filter((p) => p.includes("/")).map((p) => p.split("/")[0])]);
  const out = new Set<string>();
  const cands = [...body.matchAll(/`([^`\s]+)`/g), ...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  for (let c of cands) {
    c = c.replace(/^\.\//, "").replace(/[#?].*$/, "");
    if (!c || /^[a-z]+:/i.test(c) || c.startsWith("/") || c.startsWith("~") || /[{}<>*$[\]]/.test(c)) continue;
    const ext = extOf(c);
    if (!(TEXT_EXT.has(ext) || BIN_EXT.has(ext)) || !c.includes("/")) continue;
    if (!dirs.has(c.split("/")[0])) continue;
    if (!have.has(c)) out.add(c);
  }
  return [...out].slice(0, 10).map((c) => `SKILL.md nhắc tới "${c}" nhưng gói không có file này`);
}

export type Parsed = { name: string; description: string; body: string; entries: { path: string; data: Buffer }[]; warnings: string[]; files: SkillFile[]; tokens: number };
export type Entry = { path: string; data: Buffer };

// Kiểm tra nội dung một skill đã tách thành danh sách file (path tương đối, có SKILL.md ở gốc).
export function parseEntries(entries: Entry[], warnings: string[], maxFiles = LIMITS.files): Parsed {
  if (entries.length > maxFiles + 1) fail(`Quá nhiều file (${entries.length}, tối đa ${maxFiles})`);
  const md = entries.find((e) => e.path === "SKILL.md");
  if (!md) return fail("Không tìm thấy SKILL.md");
  const { name, description, body, repaired } = parseSkillMd(md.data.toString("utf8"));
  if (repaired) {
    entries = entries.map((e) => (e === md ? { path: e.path, data: Buffer.from(repaired) } : e));
    warnings.push("Frontmatter của SKILL.md chưa đúng cú pháp YAML (vd. dấu ngoặc kép giữa câu, dấu \":\" chưa bọc ngoặc): Synchro đã tự sửa, nội dung giữ nguyên");
  }
  const files: SkillFile[] = entries.filter((e) => e.path !== "SKILL.md").map((e) => ({ path: e.path, size: e.data.length, mime_type: MIME[extOf(e.path)] ?? (isText(e.path) ? "text/plain" : "application/octet-stream"), kind: kindOf(e.path) }));
  const tokens = estTokens(body);
  if (!body) warnings.push("Phần nội dung SKILL.md đang trống: model sẽ không có hướng dẫn nào để làm theo");
  if (description.length > LIMITS.desc) warnings.push(`description dài ${description.length} ký tự (nên ≤ ${LIMITS.desc}): mô tả nằm trong prompt của mọi đoạn chat nên càng ngắn càng tiết kiệm`);
  if (tokens > LIMITS.bodyTokens) warnings.push(`SKILL.md khá dài (~${tokens} token, nên ≤ ${LIMITS.bodyTokens}). Hãy tách bớt sang thư mục references/`);
  warnings.push(...missingRefs(body, new Set(files.map((f) => f.path))));
  return { name, description, body, entries, warnings, files, tokens };
}

const frontName = (raw: string) => { try { const p = parseSkillMd(raw); return { name: p.name, description: p.description }; } catch (e) { return { name: "", description: "", error: (e as Error).message }; } };

// `pick`: thư mục của skill cần lấy khi gói (vd. zip cả repo GitHub) chứa nhiều skill.
export async function parseUpload(filename: string, buf: Buffer, opts: { pick?: string; maxZip?: number; uid?: string } = {}): Promise<Parsed> {
  const warnings: string[] = [];
  const maxZip = opts.maxZip ?? LIMITS.zip;
  const isZip = /\.zip$/i.test(filename) || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (!isZip) {
    if (!/\.(md|markdown)$/i.test(filename)) fail("Chỉ nhận file .zip (thư mục skill) hoặc một file SKILL.md");
    if (buf.length > 1048576) fail("SKILL.md quá lớn (tối đa 1MB)");
    return parseEntries([{ path: "SKILL.md", data: buf }], warnings);
  }
  if (buf.length > maxZip) fail(`File zip quá lớn (${(buf.length / 1048576).toFixed(1)}MB, tối đa ${maxZip / 1048576}MB)`);
  let zip: JSZip;
  // JSZip tự chuẩn hóa ".." nên phải kiểm tra tên gốc ngay lúc đọc.
  let unsafe = "";
  try {
    zip = await JSZip.loadAsync(buf, { decodeFileName: (b) => {
      const n = (typeof b === "string" ? b : Buffer.from(b as Uint8Array).toString("utf8")).replace(/\\/g, "/");
      if (!unsafe && (n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").includes(".."))) unsafe = n;
      return n;
    } });
  } catch { return fail("Không đọc được file zip (file bị hỏng hoặc không phải zip)"); }
  if (unsafe) fail(`Đường dẫn không an toàn trong file nén: "${unsafe}" (chứa ".." hoặc bắt đầu bằng "/")`);
  // Bỏ rác của hệ điều hành và thư mục ẩn (.git, .github…): không phải một phần của skill.
  const all = Object.values(zip.files).filter((f) => !f.dir).map((f) => ({ f, p: cleanPath(f.name) }))
    .filter(({ p }) => !p.split("/").some((seg) => seg === "__MACOSX" || seg === ".DS_Store" || seg === "Thumbs.db" || seg.startsWith(".")));
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  // SKILL.md ở bất kỳ độ sâu nào; skill lồng trong skill khác không tính là skill riêng.
  let roots = all.filter(({ p }) => path.posix.basename(p) === "SKILL.md").map(({ f, p }) => ({ f, dir: dirOf(p) }));
  roots = roots.filter((r) => !roots.some((o) => o !== r && o.dir !== r.dir && (o.dir === "" || r.dir.startsWith(o.dir + "/"))));
  if (roots.length === 0) throw new NoSkillError("Không tìm thấy SKILL.md trong file nén");
  let root = roots[0];
  if (opts.pick !== undefined) {
    const want = opts.pick.replace(/^\/+|\/+$/g, "");
    const hit = roots.find((r) => r.dir === want);
    if (!hit) fail(`Không có skill nào ở thư mục "${want || "(gốc)"}" trong gói`);
    root = hit!;
  } else if (roots.length > 1) {
    const have = opts.uid ? new Set((db().prepare("SELECT name FROM skills WHERE user_id = ?").all(opts.uid) as { name: string }[]).map((x) => x.name)) : new Set<string>();
    const choices: SkillChoice[] = [];
    for (const r of roots.slice(0, 200)) {
      const fm = frontName((await r.f.async("nodebuffer")).toString("utf8"));
      choices.push({ dir: r.dir, ...fm, exists: have.has(fm.name) });
    }
    throw new MultiSkillError(choices);
  }
  const prefix = root.dir ? root.dir + "/" : "";
  const mine = all.filter(({ p }) => p.startsWith(prefix));
  if (prefix && all.length > mine.length && roots.length === 1) warnings.push(`Bỏ qua ${all.length - mine.length} file nằm ngoài thư mục skill`);
  if (mine.length > LIMITS.files + 1) fail(`Quá nhiều file (${mine.length}, tối đa ${LIMITS.files})`);
  const entries: Entry[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const { f, p } of mine) {
    const rel = p.slice(prefix.length);
    if (rel !== "SKILL.md" && !isAllowed(rel)) { skipped.push(rel); continue; }
    const data = await f.async("nodebuffer");
    total += data.length;
    if (total > LIMITS.unzipped) fail(`Dung lượng sau khi giải nén quá lớn (>${LIMITS.unzipped / 1048576}MB)`);
    entries.push({ path: rel, data });
  }
  if (skipped.length) warnings.push(`Bỏ qua ${skipped.length} file có định dạng không hỗ trợ: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}`);
  return parseEntries(entries, warnings);
}

// ---------------------------------------------------------------- upload
const hits = new Map<string, number[]>();
function rate(uid: string) {
  const now = Date.now();
  const h = (hits.get(uid) ?? []).filter((t) => now - t < 3600_000);
  if (h.length >= LIMITS.uploadsPerHour) fail(`Tải lên quá nhiều lần, thử lại sau (tối đa ${LIMITS.uploadsPerHour} lần/giờ)`, 429);
  h.push(now);
  hits.set(uid, h);
}

// Tổng dung lượng file skill (mọi phiên bản) của một tài khoản trên đĩa.
async function usedBytes(uid: string) {
  let total = 0;
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(path.join(ROOT, uid));
  return total;
}

type UpOpts = { pick?: string; maxZip?: number };
export async function previewSkill(uid: string, filename: string, buf: Buffer, opts: UpOpts = {}): Promise<Preview> {
  const p = await parseUpload(filename, buf, { ...opts, uid });
  const cur = await getSkill(uid, p.name);
  return { name: p.name, description: p.description, body: p.body, files: p.files, warnings: p.warnings, tokens: p.tokens, exists: !!cur, version: (cur?.version ?? 0) + 1 };
}

// Ghi tuần tự theo từng tài khoản để hai lần tải cùng lúc không tạo trùng phiên bản.
const chains = new Map<string, Promise<unknown>>();
const locked = <T>(uid: string, fn: () => Promise<T>): Promise<T> => {
  const r = (chains.get(uid) ?? Promise.resolve()).then(fn, fn);
  chains.set(uid, r.catch(() => {}));
  return r;
};

export function saveSkill(uid: string, filename: string, buf: Buffer, opts: UpOpts & { enabled?: boolean } = {}): Promise<{ skill: Skill; created: boolean }> {
  rate(uid);
  return locked(uid, async () => storeParsed(uid, await parseUpload(filename, buf, { ...opts, uid }), opts.enabled ?? true));
}
/** Xem trước / lưu skill đã tách thành danh sách tệp (có SKILL.md ở gốc) — skill Synchro tự viết từ repo không có SKILL.md. */
export async function previewParsed(uid: string, p: Parsed): Promise<Preview> {
  const cur = await getSkill(uid, p.name);
  return { name: p.name, description: p.description, body: p.body, files: p.files, warnings: p.warnings, tokens: p.tokens, exists: !!cur, version: (cur?.version ?? 0) + 1 };
}
export function saveParsed(uid: string, p: Parsed, enabled = true): Promise<{ skill: Skill; created: boolean }> {
  rate(uid);
  return locked(uid, () => storeParsed(uid, p, enabled));
}
async function storeParsed(uid: string, p: Parsed, enabled: boolean): Promise<{ skill: Skill; created: boolean }> {
  const cur = await getSkill(uid, p.name);
  const count = (db().prepare("SELECT COUNT(*) n FROM skills WHERE user_id = ?").get(uid) as { n: number }).n;
  if (!cur && count >= LIMITS.skills) fail(`Đã đạt giới hạn ${LIMITS.skills} skill cho mỗi tài khoản`);
  const size = p.entries.reduce((a, e) => a + e.data.length, 0);
  if ((await usedBytes(uid)) + size > LIMITS.userBytes) fail(`Đã hết dung lượng skill của tài khoản (${LIMITS.userBytes / 1048576}MB). Hãy xóa bớt skill cũ`);
  const id = cur?.id ?? crypto.randomUUID();
  const version = (cur ? Math.max(...cur.versions) : 0) + 1;
  const rel = path.posix.join(uid, id, `v${version}`);
  const base = path.join(ROOT, rel);
  await fs.mkdir(base, { recursive: true });
  for (const e of p.entries) {
    const dest = path.join(base, e.path);
    if (!dest.startsWith(base + path.sep)) fail("Đường dẫn không an toàn");
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, e.data);
  }
  const now = Date.now();
  const versions = JSON.stringify([...(cur?.versions ?? []), version]);
  db().transaction(() => {
    if (cur) {
      // Phiên bản mới thay bản hiện hành; file của bản cũ vẫn nằm trên đĩa.
      db().prepare("UPDATE skills SET description = ?, body = ?, storage_path = ?, version = ?, versions = ?, warnings = ?, updated_at = ? WHERE id = ?")
        .run(p.description, p.body, rel, version, versions, JSON.stringify(p.warnings), now, id);
      db().prepare("DELETE FROM skill_files WHERE skill_id = ?").run(id);
    } else {
      db().prepare("INSERT INTO skills (id, user_id, name, description, body, storage_path, enabled, version, versions, warnings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, uid, p.name, p.description, p.body, rel, enabled ? 1 : 0, version, versions, JSON.stringify(p.warnings), now, now);
    }
    const ins = db().prepare("INSERT INTO skill_files (skill_id, path, size, mime_type, kind) VALUES (?, ?, ?, ?, ?)");
    for (const f of p.files) ins.run(id, f.path, f.size, f.mime_type, f.kind);
  })();
  return { skill: (await getSkill(uid, p.name))!, created: !cur };
}

// Quay lại một phiên bản cũ đã lưu trên đĩa (đọc lại và kiểm tra như lúc tải lên).
export const restoreVersion = (uid: string, name: string, v: number) => locked(uid, async () => {
  const s = await getSkill(uid, name);
  if (!s) return fail(`Không có skill "${name}"`, 404);
  if (!s.versions.includes(v)) return fail(`Skill "${name}" không có phiên bản v${v}`, 404);
  if (v === s.version) return s;
  const rel = path.posix.join(uid, s.id, `v${v}`);
  const base = path.join(ROOT, rel);
  const entries: Entry[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else entries.push({ path: path.relative(base, full).split(path.sep).join("/"), data: await fs.readFile(full) });
    }
  };
  try { await walk(base); } catch { return fail(`Không còn file của phiên bản v${v} trên máy chủ`, 410); }
  const p = parseEntries(entries, []);
  if (p.name !== s.name) return fail("Phiên bản này có tên skill khác, không khôi phục được");
  db().transaction(() => {
    db().prepare("UPDATE skills SET description = ?, body = ?, storage_path = ?, version = ?, warnings = ?, updated_at = ? WHERE id = ?")
      .run(p.description, p.body, rel, v, JSON.stringify(p.warnings), Date.now(), s.id);
    db().prepare("DELETE FROM skill_files WHERE skill_id = ?").run(s.id);
    const ins = db().prepare("INSERT INTO skill_files (skill_id, path, size, mime_type, kind) VALUES (?, ?, ?, ?, ?)");
    for (const f of p.files) ins.run(s.id, f.path, f.size, f.mime_type, f.kind);
  })();
  return (await getSkill(uid, name))!;
});

// Ghi nhận skill vừa được model dùng (hiện "đã dùng N lần" trong danh sách).
export function recordUse(uid: string, names: string[]) {
  const q = db().prepare("UPDATE skills SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ? WHERE user_id = ? AND name = ?");
  for (const n of new Set(names)) q.run(Date.now(), uid, n);
}

export async function setEnabled(uid: string, name: string, enabled: boolean) {
  const s = await getSkill(uid, name);
  if (!s) return fail(`Không có skill "${name}"`, 404);
  db().prepare("UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), s.id);
  return (await getSkill(uid, name))!;
}

const PROJECT_RE = /^[\w-]{1,64}$/;
export async function setProjectEnabled(uid: string, name: string, projectId: string, enabled: boolean) {
  if (!PROJECT_RE.test(projectId)) fail("Mã dự án không hợp lệ");
  const s = await getSkill(uid, name);
  if (!s) return fail(`Không có skill "${name}"`, 404);
  if (enabled) db().prepare("INSERT OR IGNORE INTO skill_enablement (skill_id, scope, scope_id) VALUES (?, 'project', ?)").run(s.id, projectId);
  else db().prepare("DELETE FROM skill_enablement WHERE skill_id = ? AND scope = 'project' AND scope_id = ?").run(s.id, projectId);
  return (await getSkill(uid, name))!;
}

export const removeSkill = (uid: string, name: string) => locked(uid, async () => {
  const s = await getSkill(uid, name);
  if (!s) return fail(`Không có skill "${name}"`, 404);
  db().prepare("DELETE FROM skills WHERE id = ?").run(s.id);
  await fs.rm(path.join(ROOT, uid, s.id), { recursive: true, force: true });
});

// Xóa toàn bộ file skill khi tài khoản bị xóa (bảng đã tự xóa theo khóa ngoại).
export const removeUserSkillFiles = (uid: string) => fs.rm(path.join(ROOT, uid), { recursive: true, force: true });

// ---------------------------------------------------------------- đọc file
// Chỉ đọc file có trong danh sách skill_files của đúng skill đó, không nhận đường dẫn tự do.
// Tìm file theo đường dẫn model đưa: đúng tên trước, nếu không có thì không phân biệt hoa thường
// (nhiều SKILL.md viết "FORMS.md" trong khi file thật là "forms.md").
export function findFile(s: Skill, p: string) {
  const want = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (want === "SKILL.md") return { path: "SKILL.md", size: 0, mime_type: "text/markdown", kind: "reference" as const };
  const exact = s.files.find((x) => x.path === want);
  if (exact) return exact;
  const ci = s.files.filter((x) => x.path.toLowerCase() === want.toLowerCase());
  return ci.length === 1 ? ci[0] : undefined;
}

export async function readSkillFile(s: Skill, p: string): Promise<{ text: string; truncated: boolean; binary: boolean; size: number }> {
  const f = findFile(s, p);
  if (!f) return fail(`File "${p}" không thuộc skill "${s.name}". Các file có sẵn: ${s.files.slice(0, 40).map((x) => x.path).join(", ") || "(không có)"}${s.files.length > 40 ? ` … và ${s.files.length - 40} tệp nữa` : ""}`, 404);
  const buf = await fs.readFile(path.join(ROOT, s.storage_path, f!.path));
  if (BIN_EXT.has(extOf(f!.path))) return { text: "", truncated: false, binary: true, size: buf.length };
  const t = buf.toString("utf8");
  return { text: t.slice(0, LIMITS.fileRead), truncated: t.length > LIMITS.fileRead, binary: false, size: buf.length };
}

// Nội dung gốc của một file trong skill (đã kiểm tra thuộc danh sách file của skill), dùng khi chép vào sandbox.
export async function readSkillRaw(s: Skill, p: string): Promise<Buffer> {
  if (p !== "SKILL.md" && !s.files.some((f) => f.path === p)) fail(`File "${p}" không thuộc skill "${s.name}"`, 404);
  return fs.readFile(path.join(ROOT, s.storage_path, p));
}

export const publicSkill = (s: Skill) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled, version: s.version, versions: s.versions, created_at: s.created_at, updated_at: s.updated_at, fileCount: s.files.length, warnings: s.warnings, projects: s.projects, useCount: s.use_count, lastUsed: s.last_used_at, scripts: s.files.filter((f) => f.kind === "script").length });

// ---------------------------------------------------------------- nhập từ GitHub
// Nhận link github.com/<owner>/<repo>[/tree|blob/<ref>/<path>] của repo công khai. Chỉ tải từ codeload.github.com
// (URL do máy chủ tự dựng từ owner/repo/ref đã kiểm tra), nên không thể bị lợi dụng để gọi tới địa chỉ khác.
const SEG = /^[A-Za-z0-9._-]{1,100}$/;
export function parseGithubUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return fail("Link không hợp lệ. Hãy dán link GitHub dạng https://github.com/<chủ>/<repo>/tree/<nhánh>/<thư mục>"); }
  if (u.hostname === "raw.githubusercontent.com") {
    const [owner, repo, ...rest] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repo || rest.length < 2) fail("Link raw GitHub không hợp lệ");
    return { owner, repo, segs: rest, file: true };
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") fail("Chỉ hỗ trợ link từ github.com");
  const [owner, repo0, kind, ...rest] = u.pathname.split("/").filter(Boolean);
  const repo = (repo0 ?? "").replace(/\.git$/, "");
  if (!owner || !repo || !SEG.test(owner) || !SEG.test(repo)) fail("Link GitHub thiếu tên chủ sở hữu hoặc repo");
  if (kind && kind !== "tree" && kind !== "blob") fail("Hãy dán link tới repo hoặc một thư mục trong repo (dạng /tree/<nhánh>/...)");
  return { owner, repo, segs: kind ? rest : [], file: kind === "blob" };
}

export async function download(url: string, max: number) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Synchro" } });
  if (r.status === 404) return null;
  if (!r.ok || !r.body) fail(`GitHub trả lỗi ${r.status}`, 502);
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    n += c.length;
    if (n > max) fail(`Repo quá lớn để tải (>${max / 1048576}MB). Hãy tải thư mục skill thành zip rồi upload`);
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

// Tải zip của repo rồi trỏ `pick` vào đúng thư mục skill trong link. Nhánh có dấu "/" được thử dần.
export async function fetchGithubSkill(raw: string, pick?: string): Promise<{ filename: string; buf: Buffer; pick?: string; source: string }> {
  const g = parseGithubUrl(raw);
  const tries = g.segs.length ? Array.from({ length: Math.min(g.segs.length, 4) }, (_, i) => ({ ref: g.segs.slice(0, i + 1).join("/"), rest: g.segs.slice(i + 1) })) : [{ ref: "HEAD", rest: [] as string[] }];
  for (const t of tries) {
    if (!t.ref.split("/").every((x) => SEG.test(x))) continue;
    const buf = await download(`${process.env.GITHUB_CODELOAD_URL ?? "https://codeload.github.com"}/${g.owner}/${g.repo}/zip/${t.ref.split("/").map(encodeURIComponent).join("/")}`, LIMITS.githubZip);
    if (!buf) continue;
    let rest = t.rest;
    if (g.file && rest.length) rest = rest[rest.length - 1].toLowerCase().endsWith(".md") ? rest.slice(0, -1) : rest;
    // zip của GitHub có một thư mục gốc "<repo>-<ref>/"
    const top = (await JSZip.loadAsync(buf)).file(/.*/)[0]?.name.split("/")[0] ?? "";
    const want = pick ?? (rest.length ? [top, ...rest].join("/") : undefined);
    return { filename: `${g.repo}.zip`, buf, pick: want, source: `github.com/${g.owner}/${g.repo}` };
  }
  return fail("Không tìm thấy repo hoặc nhánh trên GitHub (chỉ hỗ trợ repo công khai)", 404);
}
