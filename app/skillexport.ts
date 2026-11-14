// Xuất skill / thư viện thành một tệp .zip (chỉ chạy ở máy chủ): không bỏ sót gì Synchro đang giữ về skill và repo nguồn.
// - Thư mục skill y nguyên như đang lưu trên máy chủ (SKILL.md và mọi tệp, cả tệp nhị phân), dùng lại được ngay.
// - Skill lẻ: mọi phiên bản cũ còn trên máy chủ (mỗi bản một tệp .zip trong _synchro/versions/), bản tự sửa script, mục Artifacts,
//   bật / tắt (cả tài khoản và từng dự án), số lần dùng, điểm đánh giá, cảnh báo, link repo nguồn.
// - Thư viện: nguồn (repo, nhánh, thư mục, lọc skill), commit đã cài, giấy phép, rủi ro và cờ của từng skill, thư mục gốc trong repo,
//   studio, các tùy chọn bật / tắt, thời điểm cài / cập nhật / kiểm tra.
// - Mọi tệp kèm SHA-256 trong tệp thông tin để kiểm tra không thiếu, không hỏng.
// Thông tin máy đọc nằm ở _synchro/skill.json hoặc _synchro/library.json, bản dễ đọc ở _synchro/README.md. Tên thư mục bắt đầu
// bằng "_" nên không trùng tên skill nào; tải tệp .zip này lên lại Kho kỹ năng thì Synchro chỉ đọc thư mục skill (skillstore.parseUpload).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { db } from "./authstore";
import { getSkill, ROOT } from "./skillstore";
import { getPlugin, linkKey, type SkillReport } from "./plugins";
import { getTag, pluginKey, tagsOf, userKey } from "./skillstudio";
import { hashText, listPatches } from "./skillheal";
import { scores } from "./feedback";
import { trOn } from "./i18n-server";

export const META_DIR = "_synchro";
export class ExportError extends Error { constructor(m: string, public status = 400) { super(m); } }

type Lang = "vi" | "en";
type FileInfo = { path: string; size: number; sha256: string };
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const iso = (t: number | string | null | undefined) => (t === null || t === undefined || t === "" ? null : new Date(t).toISOString());

// Mọi tệp của một thư mục trên đĩa, đúng như đang lưu (đường dẫn tương đối, dấu "/").
async function readTree(base: string): Promise<{ path: string; data: Buffer }[]> {
  const out: { path: string; data: Buffer }[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push({ path: path.relative(base, full).split(path.sep).join("/"), data: await fs.readFile(full) });
    }
  };
  await walk(base);
  return out.sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path)));
}
// Thư mục skill trên đĩa; thiếu cả thư mục (dữ liệu cũ bị mất) thì dựng lại SKILL.md từ tên, mô tả và nội dung còn trong cơ sở dữ liệu,
// và ghi rõ tệp nào không còn, thay vì bỏ cả skill / cả thư viện.
async function skillTree(dir: string, s: { name: string; description: string; body: string }, listed: string[]) {
  let files: { path: string; data: Buffer }[], rebuilt = false;
  try { files = await readTree(dir); }
  catch { files = [{ path: "SKILL.md", data: Buffer.from(`---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body}\n`) }]; rebuilt = true; }
  const have = new Set(files.map((f) => f.path));
  return { files, rebuilt, missing: listed.filter((p) => !have.has(p)) };
}
const put = (zip: JSZip, prefix: string, files: { path: string; data: Buffer }[]): FileInfo[] =>
  files.map((f) => { zip.file(`${prefix}${f.path}`, f.data, { binary: true }); return { path: f.path, size: f.data.length, sha256: sha(f.data) }; });

/** Link xem được trên trình duyệt từ khóa nguồn đã lưu (plugins.linkKey: tên miền / chủ / repo / thư mục, đã bỏ tên nhánh). */
export function sourceInfo(key: string | null) {
  if (!key) return null;
  const segs = key.split("/");
  const host = segs[0];
  if (host === "github.com" && segs.length >= 3) {
    const [owner, repo, ...dir] = segs.slice(1);
    return { key, host, owner, repo, path: dir.join("/") || null, url: `https://github.com/${owner}/${repo}${dir.length ? `/tree/HEAD/${dir.join("/")}` : ""}` };
  }
  return { key, host, owner: null, repo: null, path: null, url: `https://${key}` };
}
const ghTree = (repo: string, ref: string, dir?: string | null) => `https://github.com/${repo}/tree/${ref}${dir ? `/${dir}` : ""}`;

/** Phản hồi tải về tệp .zip (tên tệp có dấu tiếng Việt vẫn giữ nhờ filename*). */
export function zipResponse(filename: string, buf: Buffer) {
  return new Response(new Uint8Array(buf), { headers: {
    "content-type": "application/zip", "content-length": String(buf.length), "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  } });
}

function zipOut(zip: JSZip) {
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "UNIX" });
}

// ---------------------------------------------------------------- skill lẻ
export async function exportSkill(uid: string, name: string, lang: Lang): Promise<{ filename: string; buf: Buffer }> {
  const s = await getSkill(uid, name);
  if (!s) throw new ExportError(trOn("Không có skill này.", lang), 404);
  const zip = new JSZip();
  const at = Date.now();
  const tree = await skillTree(path.join(ROOT, s.storage_path), s, s.files.map((f) => f.path));
  const cur = tree.files;
  const files = put(zip, `${s.name}/`, cur);
  // Phiên bản cũ: mỗi bản một .zip riêng (giữ đúng thư mục <tên skill>/ bên trong) để tệp xuất vẫn chỉ có một SKILL.md ở ngoài.
  const versions: { version: number; current: boolean; archive: string | null; files: FileInfo[]; missing?: boolean }[] = [];
  for (const v of [...new Set(s.versions)].sort((a, b) => a - b)) {
    const rel = path.posix.join(uid, s.id, `v${v}`);
    if (rel === s.storage_path) { versions.push({ version: v, current: true, archive: null, files }); continue; }
    try {
      const tree = await readTree(path.join(ROOT, rel));
      const vz = new JSZip();
      const vf = put(vz, `${s.name}/`, tree);
      const archive = `${META_DIR}/versions/v${v}.zip`;
      zip.file(archive, await zipOut(vz), { binary: true });
      versions.push({ version: v, current: false, archive, files: vf });
    } catch { versions.push({ version: v, current: false, archive: null, files: [], missing: true }); }
  }
  const hashes: Record<string, string> = {};
  for (const f of cur) if (s.files.some((x) => x.path === f.path && x.kind === "script")) hashes[f.path] = hashText(f.data.toString("utf8"));
  const fixes = listPatches(uid, s.id, hashes, true).map((p) => ({ id: p.id, path: p.path, status: p.status, mutating: p.mutating, error: p.error, attempts: p.attempts, uses: p.uses,
    createdAt: iso(p.created_at), basedOnCurrentFile: !p.stale, content: p.content ?? "" }));
  const kinds = new Map(s.files.map((f) => [f.path, f]));
  const meta = {
    format: "synchro-skill-export", formatVersion: 1, exportedAt: new Date(at).toISOString(),
    skill: {
      id: s.id, name: s.name, description: s.description, folder: `${s.name}/`, currentVersion: s.version, versions: s.versions,
      enabled: s.enabled, enabledInProjects: s.projects, createdAt: s.created_at, updatedAt: s.updated_at, useCount: s.use_count, lastUsedAt: s.last_used_at,
      warnings: s.warnings, artifactsSections: getTag(userKey(s.id)), ...(tree.rebuilt ? { skillMdRebuilt: true } : {}), ...(tree.missing.length ? { missingOnServer: tree.missing } : {}),
      files: files.map((f) => ({ ...f, mimeType: f.path === "SKILL.md" ? "text/markdown" : kinds.get(f.path)?.mime_type ?? null, kind: f.path === "SKILL.md" ? "instructions" : kinds.get(f.path)?.kind ?? null })),
    },
    source: sourceInfo(s.source),
    versions,
    selfFixes: fixes,
    feedback: scores()[s.name] ?? { up: 0, down: 0, low: false },
  };
  zip.file(`${META_DIR}/skill.json`, JSON.stringify(meta, null, 2) + "\n");
  zip.file(`${META_DIR}/README.md`, skillReadme(meta, lang));
  return { filename: `${s.name}.zip`, buf: await zipOut(zip) };
}

// ---------------------------------------------------------------- thư viện (plugin)
type PRow = { id: string; owner: string; slug: string; catalog_id: string | null; created_at: number; latest: string | null };
type SRow = { id: string; name: string; body: string; storage_path: string; files: string; report: string; last_used_at: number | null };
export async function exportPlugin(uid: string, id: string, lang: Lang): Promise<{ filename: string; buf: Buffer }> {
  const p = getPlugin(id, uid);
  const row = db().prepare("SELECT id, owner, slug, catalog_id, created_at, latest FROM plugins WHERE id = ?").get(id) as PRow | undefined;
  if (!p || !row || (row.owner !== "org" && row.owner !== uid)) throw new ExportError(trOn("Không tìm thấy thư viện.", lang), 404);
  const zip = new JSZip();
  const root = `${p.slug}/`;
  const tags = tagsOf(p.skills.map((s) => pluginKey(p.id, s.name)));
  const rows = db().prepare("SELECT id, name, body, storage_path, files, report, last_used_at FROM plugin_skills WHERE plugin_id = ? ORDER BY name").all(id) as SRow[];
  const fb = scores();
  const skills = [];
  for (const r of rows) {
    const pub = p.skills.find((x) => x.id === r.id);
    const report = JSON.parse(r.report) as SkillReport;
    const listed = JSON.parse(r.files) as { path: string; mime_type: string; kind: string }[];
    const tree = await skillTree(path.join(ROOT, r.storage_path), { name: r.name, description: pub?.description ?? "", body: r.body }, listed.map((f) => f.path));
    const folder = `${root}skills/${r.name}/`;
    const files = put(zip, folder, tree.files);
    const kinds = new Map(listed.map((f) => [f.path, f]));
    const commit = p.commits[report.repo];
    skills.push({
      id: r.id, name: r.name, description: pub?.description ?? "", folder, enabled: pub?.enabled ?? true, useCount: pub?.useCount ?? 0, lastUsedAt: iso(r.last_used_at),
      artifactsSections: tags.get(pluginKey(p.id, r.name)) ?? null, feedback: fb[r.name] ?? { up: 0, down: 0, low: false },
      origin: report.repo === "upload" ? { uploaded: true } : { repo: report.repo, folderInRepo: report.dir || null, commit: commit ?? null, url: commit ? ghTree(report.repo, commit, report.dir) : null },
      report, ...(tree.rebuilt ? { skillMdRebuilt: true } : {}), ...(tree.missing.length ? { missingOnServer: tree.missing } : {}),
      files: files.map((f) => ({ ...f, mimeType: f.path === "SKILL.md" ? "text/markdown" : kinds.get(f.path)?.mime_type ?? null, kind: f.path === "SKILL.md" ? "instructions" : kinds.get(f.path)?.kind ?? null })),
    });
  }
  const meta = {
    format: "synchro-library-export", formatVersion: 1, exportedAt: new Date().toISOString(),
    library: {
      id: p.id, slug: p.slug, catalogId: row.catalog_id, name: p.name, description: p.description, author: p.author, homepage: p.homepage, color: p.color,
      scope: p.scope, studio: p.studio, studioMode: p.studioMode, enabled: p.enabled, listEverySkill: p.everywhere, yourChoice: { enabled: p.mine.enabled, listEverySkill: p.mine.everywhere },
      folder: root, size: p.size, createdAt: iso(row.created_at), updatedAt: iso(p.updatedAt), checkedForUpdatesAt: iso(p.checkedAt),
      updateAvailable: p.updateAvailable, latestCommit: row.latest, risk: p.risk, licenses: p.licenses, feedback: fb[`lib-${p.slug}`] ?? { up: 0, down: 0, low: false },
    },
    sources: p.sources.map((s) => {
      const commit = p.commits[s.repo] ?? null;
      return { ...s, commit, url: ghTree(s.repo, commit ?? s.ref ?? "HEAD", s.path), key: linkKey(`https://github.com/${s.repo}${s.path ? `/tree/${s.ref ?? "HEAD"}/${s.path}` : ""}`) };
    }),
    commits: p.commits,
    skills,
  };
  zip.file(`${META_DIR}/library.json`, JSON.stringify(meta, null, 2) + "\n");
  zip.file(`${META_DIR}/README.md`, libraryReadme(meta, lang));
  return { filename: `${p.slug}.zip`, buf: await zipOut(zip) };
}

// ---------------------------------------------------------------- README dễ đọc
const T = {
  vi: {
    skillTitle: "Skill xuất từ Synchro", libTitle: "Thư viện skill xuất từ Synchro", exported: "Xuất lúc", contents: "Trong tệp này",
    skillDir: (n: string, v: number, c: number) => `\`${n}/\`: skill đang dùng (v${v}), SKILL.md và ${c} tệp khác, đúng như đang lưu trên máy chủ.`,
    libDir: (n: string, c: number) => `\`${n}skills/\`: ${c} skill, mỗi skill một thư mục có SKILL.md và mọi tệp, đúng như đang lưu trên máy chủ.`,
    json: (f: string) => `\`${META_DIR}/${f}\`: mọi thông tin Synchro giữ (nguồn, commit, giấy phép, trạng thái, mục Artifacts, số lần dùng, đánh giá…) và SHA-256 của từng tệp.`,
    vers: (n: number) => `\`${META_DIR}/versions/\`: ${n} phiên bản cũ còn trên máy chủ, mỗi bản một tệp .zip.`,
    source: "Repo nguồn", noSource: "Skill này không thêm từ link repo (tải lên, Synchro viết hoặc lưu từ đoạn chat).",
    link: "Link", commit: "Commit", folder: "Thư mục trong repo", license: "Giấy phép", risk: "Rủi ro của script", fixes: (n: number) => `${n} bản tự sửa script (nội dung đầy đủ trong ${META_DIR}/skill.json).`,
    readd: "Thêm lại vào Synchro",
    readdSkill: "Kho kỹ năng → Thêm → Tải lên skill, chọn tệp .zip này (hoặc kéo thả vào trang). Synchro đọc thư mục skill, bỏ qua thư mục " + META_DIR + "/.",
    readdLib: "Mở một thư viện trong Kho kỹ năng → Thêm skill từ file zip, chọn tệp .zip này; hoặc Kho kỹ năng → Thêm → Tải lên skill để chọn từng skill.",
    skills: "Các skill",
    missing: (who: string, list: string[], rebuilt: boolean) => `Lưu ý: ${who} thiếu tệp trên máy chủ từ trước khi xuất${list.length ? `: ${list.map((x) => `\`${x}\``).join(", ")}` : ""}.${rebuilt ? " SKILL.md được dựng lại từ tên, mô tả và nội dung Synchro còn giữ." : ""}`,
  },
  en: {
    skillTitle: "Skill exported from Synchro", libTitle: "Skill library exported from Synchro", exported: "Exported", contents: "In this file",
    skillDir: (n: string, v: number, c: number) => `\`${n}/\`: the skill in use (v${v}), SKILL.md and ${c} other files, exactly as stored on the server.`,
    libDir: (n: string, c: number) => `\`${n}skills/\`: ${c} skills, one folder each with SKILL.md and every file, exactly as stored on the server.`,
    json: (f: string) => `\`${META_DIR}/${f}\`: everything Synchro keeps (source, commit, licence, status, Artifacts sections, use count, ratings…) and the SHA-256 of every file.`,
    vers: (n: number) => `\`${META_DIR}/versions/\`: ${n} earlier versions still on the server, one .zip each.`,
    source: "Source repository", noSource: "This skill was not added from a repository link (uploaded, written by Synchro or saved from a chat).",
    link: "Link", commit: "Commit", folder: "Folder in the repository", license: "Licence", risk: "Script risk", fixes: (n: number) => `${n} script self-fixes (full content in ${META_DIR}/skill.json).`,
    readd: "Add it back to Synchro",
    readdSkill: "Skill Hub → Add → Upload a skill, then pick this .zip (or drop it on the page). Synchro reads the skill folder and skips " + META_DIR + "/.",
    readdLib: "Open a library in Skill Hub → Add skills from zip and pick this .zip, or Skill Hub → Add → Upload a skill to pick skills one by one.",
    skills: "Skills",
    missing: (who: string, list: string[], rebuilt: boolean) => `Note: ${who} was already missing files on the server before this export${list.length ? `: ${list.map((x) => `\`${x}\``).join(", ")}` : ""}.${rebuilt ? " SKILL.md was rebuilt from the name, description and instructions Synchro still keeps." : ""}`,
  },
};

function skillReadme(m: { exportedAt: string; skill: { name: string; description: string; currentVersion: number; files: unknown[]; missingOnServer?: string[]; skillMdRebuilt?: boolean }; source: ReturnType<typeof sourceInfo>; versions: { current: boolean; archive: string | null }[]; selfFixes: unknown[] }, lang: Lang) {
  const t = T[lang];
  const miss = m.skill.missingOnServer?.length || m.skill.skillMdRebuilt ? [`> ${t.missing(m.skill.name, m.skill.missingOnServer ?? [], !!m.skill.skillMdRebuilt)}`, ""] : [];
  const old = m.versions.filter((v) => !v.current && v.archive).length;
  return [
    `# ${m.skill.name}`, "", `${t.skillTitle}. ${t.exported} ${m.exportedAt}.`, "", `> ${m.skill.description}`, "", ...miss,
    `## ${t.contents}`, "", `- ${t.skillDir(m.skill.name, m.skill.currentVersion, m.skill.files.length - 1)}`, `- ${t.json("skill.json")}`, ...(old ? [`- ${t.vers(old)}`] : []),
    ...(m.selfFixes.length ? [`- ${t.fixes(m.selfFixes.length)}`] : []), "",
    `## ${t.source}`, "", ...(m.source ? [`- ${t.link}: ${m.source.url}`, ...(m.source.path ? [`- ${t.folder}: \`${m.source.path}\``] : [])] : [t.noSource]), "",
    `## ${t.readd}`, "", t.readdSkill, "",
  ].join("\n");
}

function libraryReadme(m: { exportedAt: string; library: { name: string; description: string; folder: string; licenses: string[]; risk: string }; sources: { repo: string; commit: string | null; url: string; path?: string }[]; skills: { name: string; report: SkillReport; origin: { url?: string | null }; missingOnServer?: string[]; skillMdRebuilt?: boolean }[] }, lang: Lang) {
  const t = T[lang];
  const miss = m.skills.filter((s) => s.missingOnServer?.length || s.skillMdRebuilt).flatMap((s) => [`> ${t.missing(s.name, s.missingOnServer ?? [], !!s.skillMdRebuilt)}`, ""]);
  return [
    `# ${m.library.name}`, "", `${t.libTitle}. ${t.exported} ${m.exportedAt}.`, "", `> ${m.library.description}`, "", ...miss,
    `## ${t.contents}`, "", `- ${t.libDir(m.library.folder, m.skills.length)}`, `- ${t.json("library.json")}`, "",
    `## ${t.source}`, "", ...m.sources.flatMap((s) => [`- ${t.link}: ${s.url}`, ...(s.commit ? [`  - ${t.commit}: \`${s.commit}\``] : []), ...(s.path ? [`  - ${t.folder}: \`${s.path}\``] : [])]), "",
    `## ${t.skills}`, "", "| Skill | " + `${t.license} | ${t.risk} | ${t.folder}` + " |", "| --- | --- | --- | --- |",
    ...m.skills.map((s) => `| ${s.name} | ${s.report.license || "—"} | ${s.report.risk} | ${s.report.dir ? `\`${s.report.dir}\`` : "—"} |`), "",
    `## ${t.readd}`, "", t.readdLib, "",
  ].join("\n");
}
