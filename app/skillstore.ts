// Lưu trữ + kiểm tra skill (chỉ chạy ở server).
// Bảng skills / skill_files / skill_enablement nằm trong data/synchro.db; file gốc ở data/skills/<user_id>/<skill_id>/v<N>/...
// Mọi hàm đều nhận userId: skill của người này không bao giờ lộ sang người khác.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { parse as parseYaml } from "yaml";
import { db, DATA_DIR } from "./authstore";

const ROOT = process.env.SKILLS_DIR ?? path.join(DATA_DIR, "skills");

export const LIMITS = {
  zip: 20 * 1024 * 1024,
  unzipped: 100 * 1024 * 1024,
  files: 100,
  fileRead: 100_000, // ký tự tối đa trả cho model mỗi lần đọc
  bodyTokens: 5000,
  desc: 1024,
  name: 64,
  skills: 200,             // số skill tối đa mỗi tài khoản
  userBytes: 300 * 1024 * 1024, // dung lượng skill tối đa mỗi tài khoản (mọi phiên bản)
  uploadsPerHour: 30,      // mỗi tài khoản
};

const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".tsv", ".py", ".svg", ".yaml", ".yml", ".html", ".css", ".js", ".ts", ".sh", ".xml", ".toml", ".ini"]);
const BIN_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MIME: Record<string, string> = {
  ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".py": "text/x-python", ".svg": "image/svg+xml", ".yaml": "text/yaml", ".yml": "text/yaml", ".html": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".ts": "text/typescript", ".sh": "text/x-shellscript", ".xml": "application/xml", ".toml": "text/plain", ".ini": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};

export type SkillFile = { path: string; size: number; mime_type: string; kind: "reference" | "script" | "asset" };
export type Skill = {
  id: string; user_id: string; name: string; description: string; body: string; storage_path: string;
  enabled: boolean; version: number; versions: number[]; created_at: string; updated_at: string;
  files: SkillFile[]; warnings: string[]; projects: string[];
};
export type Preview = { name: string; description: string; body: string; files: SkillFile[]; warnings: string[]; tokens: number; exists: boolean; version: number };
export class SkillError extends Error { status = 400; }
const fail = (m: string, status = 400): never => { const e = new SkillError(m); e.status = status; throw e; };

// ---------------------------------------------------------------- đọc từ DB
type Row = { id: string; user_id: string; name: string; description: string; body: string; storage_path: string; enabled: number; version: number; versions: string; warnings: string; created_at: number; updated_at: number };
function hydrate(r: Row): Skill {
  const files = db().prepare("SELECT path, size, mime_type, kind FROM skill_files WHERE skill_id = ? ORDER BY path").all(r.id) as SkillFile[];
  const projects = (db().prepare("SELECT scope_id FROM skill_enablement WHERE skill_id = ? AND scope = 'project'").all(r.id) as { scope_id: string }[]).map((x) => x.scope_id);
  return {
    id: r.id, user_id: r.user_id, name: r.name, description: r.description, body: r.body, storage_path: r.storage_path,
    enabled: !!r.enabled, version: r.version, versions: JSON.parse(r.versions), warnings: JSON.parse(r.warnings),
    created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(), files, projects,
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
  /^scripts\//.test(p) || [".py", ".sh", ".js", ".ts"].includes(extOf(p)) ? "script"
  : /^assets\//.test(p) || BIN_EXT.has(extOf(p)) ? "asset" : "reference";
export const estTokens = (s: string) => Math.ceil(s.length / 4);

function cleanPath(p: string): string {
  const n = p.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").includes("..")) fail(`Đường dẫn không an toàn trong file nén: "${p}" (chứa ".." hoặc bắt đầu bằng "/")`);
  return path.posix.normalize(n);
}

function parseSkillMd(raw: string) {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return fail("SKILL.md phải bắt đầu bằng phần frontmatter YAML (--- ... ---) chứa name và description");
  let fm: unknown;
  try { fm = parseYaml(m[1]); } catch (e) { return fail("Frontmatter YAML không hợp lệ: " + String((e as Error).message).split("\n")[0]); }
  if (!fm || typeof fm !== "object") return fail("Frontmatter của SKILL.md đang trống");
  const o = fm as Record<string, unknown>;
  if (o.name === undefined || o.name === null || String(o.name).trim() === "") fail("Thiếu trường name trong SKILL.md");
  if (o.description === undefined || o.description === null || String(o.description).trim() === "") fail("Thiếu trường description trong SKILL.md");
  const name = String(o.name).trim();
  const description = String(o.description).replace(/\s+/g, " ").trim();
  if (name.length > LIMITS.name) fail(`name quá dài (${name.length} ký tự, tối đa ${LIMITS.name})`);
  if (!NAME_RE.test(name)) fail(`name "${name}" không hợp lệ: chỉ dùng chữ thường, số và dấu gạch ngang (ví dụ: brand-style)`);
  if (description.length > LIMITS.desc) fail(`description quá dài (${description.length} ký tự, tối đa ${LIMITS.desc})`);
  return { name, description, body: text.slice(m[0].length).trim() };
}

// Cảnh báo khi SKILL.md nhắc tới file không có trong gói.
function missingRefs(body: string, have: Set<string>): string[] {
  const out = new Set<string>();
  const cands = [...body.matchAll(/`([^`\s]+)`/g), ...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  for (let c of cands) {
    c = c.replace(/^\.\//, "").replace(/[#?].*$/, "");
    if (!c || /^[a-z]+:/i.test(c) || c.startsWith("/") || c.startsWith("~")) continue;
    const ext = extOf(c);
    if (!(TEXT_EXT.has(ext) || BIN_EXT.has(ext))) continue;
    if (!c.includes("/") && !/^[\w.-]+$/.test(c)) continue;
    if (!have.has(c) && c !== "SKILL.md" && c.includes("/")) out.add(c);
  }
  return [...out].map((c) => `SKILL.md nhắc tới "${c}" nhưng gói không có file này`);
}

type Parsed = { name: string; description: string; body: string; entries: { path: string; data: Buffer }[]; warnings: string[]; files: SkillFile[]; tokens: number };

export async function parseUpload(filename: string, buf: Buffer): Promise<Parsed> {
  const warnings: string[] = [];
  let entries: { path: string; data: Buffer }[] = [];
  const isZip = /\.zip$/i.test(filename) || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (isZip) {
    if (buf.length > LIMITS.zip) fail(`File zip quá lớn (${(buf.length / 1048576).toFixed(1)}MB, tối đa ${LIMITS.zip / 1048576}MB)`);
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
    const all = Object.values(zip.files).filter((f) => !f.dir);
    let declared = 0;
    for (const f of all) declared += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (declared > LIMITS.unzipped) fail(`Dung lượng sau khi giải nén quá lớn (>${LIMITS.unzipped / 1048576}MB)`);
    let paths = all.map((f) => ({ f, p: cleanPath(f.name) })).filter(({ p }) => !p.startsWith("__MACOSX/") && !p.split("/").some((s) => s === ".DS_Store" || s === "Thumbs.db"));
    const roots = paths.filter(({ p }) => path.posix.basename(p) === "SKILL.md" && p.split("/").length <= 2);
    if (roots.length === 0) fail("Không tìm thấy SKILL.md ở gốc thư mục skill");
    if (roots.length > 1) fail(`Có ${roots.length} file SKILL.md (${roots.map((r) => r.p).join(", ")}); mỗi gói chỉ được chứa một skill`);
    const prefix = roots[0].p.includes("/") ? roots[0].p.slice(0, roots[0].p.lastIndexOf("/") + 1) : "";
    const outside = paths.filter(({ p }) => !p.startsWith(prefix)).length;
    if (outside) warnings.push(`Bỏ qua ${outside} file nằm ngoài thư mục skill`);
    paths = paths.filter(({ p }) => p.startsWith(prefix));
    // thư mục ẩn (.git...) không phải một phần của skill
    paths = paths.filter(({ p }) => !p.slice(prefix.length).split("/").some((s) => s.startsWith(".")));
    if (paths.length > LIMITS.files + 1) fail(`Quá nhiều file (${paths.length}, tối đa ${LIMITS.files})`);
    let total = 0;
    for (const { f, p } of paths) {
      const rel = p.slice(prefix.length);
      const ext = extOf(rel);
      if (rel !== "SKILL.md" && !TEXT_EXT.has(ext) && !BIN_EXT.has(ext)) fail(`Định dạng file không được hỗ trợ: "${rel}" (cho phép: ${[...TEXT_EXT, ...BIN_EXT].join(" ")})`);
      const data = await f.async("nodebuffer");
      total += data.length;
      if (total > LIMITS.unzipped) fail(`Dung lượng sau khi giải nén quá lớn (>${LIMITS.unzipped / 1048576}MB)`);
      entries.push({ path: rel, data });
    }
  } else if (/\.md$/i.test(filename) || /\.markdown$/i.test(filename)) {
    if (buf.length > 1048576) fail("SKILL.md quá lớn (tối đa 1MB)");
    entries = [{ path: "SKILL.md", data: buf }];
  } else fail("Chỉ nhận file .zip (thư mục skill) hoặc một file SKILL.md");
  if (entries.length > LIMITS.files + 1) fail(`Quá nhiều file (${entries.length}, tối đa ${LIMITS.files})`);

  const md = entries.find((e) => e.path === "SKILL.md");
  if (!md) return fail("Không tìm thấy SKILL.md");
  const { name, description, body } = parseSkillMd(md.data.toString("utf8"));
  const files: SkillFile[] = entries.filter((e) => e.path !== "SKILL.md").map((e) => ({ path: e.path, size: e.data.length, mime_type: MIME[extOf(e.path)] ?? "application/octet-stream", kind: kindOf(e.path) }));
  const tokens = estTokens(body);
  if (!body) warnings.push("Phần nội dung SKILL.md đang trống: model sẽ không có hướng dẫn nào để làm theo");
  if (tokens > LIMITS.bodyTokens) warnings.push(`SKILL.md khá dài (~${tokens} token, nên ≤ ${LIMITS.bodyTokens}). Hãy tách bớt sang thư mục references/`);
  warnings.push(...missingRefs(body, new Set(files.map((f) => f.path))));
  if (files.some((f) => f.kind === "script")) warnings.push("Gói có script. Synchro chỉ đọc script như tài liệu tham khảo, không chạy chúng");
  return { name, description, body, entries, warnings, files, tokens };
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

export async function previewSkill(uid: string, filename: string, buf: Buffer): Promise<Preview> {
  const p = await parseUpload(filename, buf);
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

export function saveSkill(uid: string, filename: string, buf: Buffer, enabled = true): Promise<{ skill: Skill; created: boolean }> {
  rate(uid);
  return locked(uid, async () => {
    const p = await parseUpload(filename, buf);
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
  });
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
export async function readSkillFile(s: Skill, p: string): Promise<{ text: string; truncated: boolean; binary: boolean; size: number }> {
  const want = p.replace(/\\/g, "/").replace(/^\.\//, "");
  const f = s.files.find((x) => x.path === want) ?? (want === "SKILL.md" ? { path: "SKILL.md", size: 0, mime_type: "text/markdown", kind: "reference" as const } : undefined);
  if (!f) return fail(`File "${p}" không thuộc skill "${s.name}". Các file có sẵn: ${s.files.map((x) => x.path).join(", ") || "(không có)"}`, 404);
  const buf = await fs.readFile(path.join(ROOT, s.storage_path, f.path));
  if (BIN_EXT.has(extOf(f.path))) return { text: "", truncated: false, binary: true, size: buf.length };
  const t = buf.toString("utf8");
  return { text: t.slice(0, LIMITS.fileRead), truncated: t.length > LIMITS.fileRead, binary: false, size: buf.length };
}

export const publicSkill = (s: Skill) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled, version: s.version, versions: s.versions, created_at: s.created_at, updated_at: s.updated_at, fileCount: s.files.length, warnings: s.warnings, projects: s.projects });
