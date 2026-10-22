// Lưu trữ + kiểm tra skill (chỉ chạy ở server).
// "Bảng" skills / skill_files nằm trong data/skills/<user>/index.json; file gốc ở data/skills/<user>/<name>/v<N>/...
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parse as parseYaml } from "yaml";

export const USER_ID = "default"; // app chưa có đăng nhập: mọi skill thuộc về một user
const ROOT = process.env.SKILLS_DIR ?? path.join(process.cwd(), "data", "skills");

export const LIMITS = {
  zip: 20 * 1024 * 1024,
  unzipped: 100 * 1024 * 1024,
  files: 100,
  fileRead: 100_000, // ký tự tối đa trả cho model mỗi lần đọc
  bodyTokens: 5000,
  desc: 1024,
  name: 64,
  skills: 200,
  uploadsPerHour: 30,
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
  files: SkillFile[]; warnings: string[];
};
export type Preview = { name: string; description: string; body: string; files: SkillFile[]; warnings: string[]; tokens: number; exists: boolean; version: number };
export class SkillError extends Error { status = 400; }
const fail = (m: string, status = 400): never => { const e = new SkillError(m); e.status = status; throw e; };

// ---------------------------------------------------------------- index
const dir = (u = USER_ID) => path.join(ROOT, u);
let chain: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

async function readIndex(u = USER_ID): Promise<Skill[]> {
  try { return JSON.parse(await fs.readFile(path.join(dir(u), "index.json"), "utf8")); } catch { return []; }
}
async function writeIndex(list: Skill[], u = USER_ID) {
  await fs.mkdir(dir(u), { recursive: true });
  const tmp = path.join(dir(u), `index.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(list, null, 1));
  await fs.rename(tmp, path.join(dir(u), "index.json"));
}

export const listSkills = (u = USER_ID) => readIndex(u);
export const getSkill = async (name: string, u = USER_ID) => (await readIndex(u)).find((s) => s.name === name) ?? null;
export const enabledSkills = async (u = USER_ID) => (await readIndex(u)).filter((s) => s.enabled);

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
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
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
const hits: number[] = [];
function rate() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 3600_000) hits.shift();
  if (hits.length >= LIMITS.uploadsPerHour) fail(`Tải lên quá nhiều lần, thử lại sau (tối đa ${LIMITS.uploadsPerHour} lần/giờ)`, 429);
  hits.push(now);
}

export async function previewSkill(filename: string, buf: Buffer): Promise<Preview> {
  const p = await parseUpload(filename, buf);
  const cur = await getSkill(p.name);
  return { name: p.name, description: p.description, body: p.body, files: p.files, warnings: p.warnings, tokens: p.tokens, exists: !!cur, version: (cur?.version ?? 0) + 1 };
}

export function saveSkill(filename: string, buf: Buffer, enabled = true): Promise<{ skill: Skill; created: boolean }> {
  rate();
  return locked(async () => {
    const p = await parseUpload(filename, buf);
    const list = await readIndex();
    const cur = list.find((s) => s.name === p.name);
    if (!cur && list.length >= LIMITS.skills) fail(`Đã đạt giới hạn ${LIMITS.skills} skill`);
    const version = (cur ? Math.max(...cur.versions) : 0) + 1;
    const rel = path.posix.join(USER_ID, p.name, `v${version}`);
    const base = path.join(ROOT, rel);
    await fs.mkdir(base, { recursive: true });
    for (const e of p.entries) {
      const dest = path.join(base, e.path);
      if (!dest.startsWith(base + path.sep)) fail("Đường dẫn không an toàn");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.data);
    }
    const now = new Date().toISOString();
    const skill: Skill = {
      id: cur?.id ?? crypto.randomUUID(), user_id: USER_ID, name: p.name, description: p.description, body: p.body, storage_path: rel,
      enabled: cur ? cur.enabled : enabled, version, versions: [...(cur?.versions ?? []), version], created_at: cur?.created_at ?? now, updated_at: now,
      files: p.files, warnings: p.warnings,
    };
    await writeIndex(cur ? list.map((s) => (s.name === p.name ? skill : s)) : [...list, skill]);
    return { skill, created: !cur };
  });
}

export const setEnabled = (name: string, enabled: boolean) => locked(async () => {
  const list = await readIndex();
  const s = list.find((x) => x.name === name);
  if (!s) fail(`Không có skill "${name}"`, 404);
  s!.enabled = enabled;
  await writeIndex(list);
  return s!;
});

export const removeSkill = (name: string) => locked(async () => {
  const list = await readIndex();
  if (!list.some((x) => x.name === name)) fail(`Không có skill "${name}"`, 404);
  await writeIndex(list.filter((x) => x.name !== name));
  await fs.rm(path.join(ROOT, USER_ID, name), { recursive: true, force: true });
});

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

export const publicSkill = (s: Skill) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled, version: s.version, versions: s.versions, created_at: s.created_at, updated_at: s.updated_at, fileCount: s.files.length, warnings: s.warnings });
