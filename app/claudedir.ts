// Danh mục skill của Claude (chỉ chạy ở máy chủ): catalog/claude-directory.json do scripts/sync-claude-directory.mjs tạo từ thư mục plugin
// công khai của Anthropic — ~3.100 thư viện, ~18.000 skill, chia theo đúng các mục ngành nghề của Claude. Mỗi thư viện ghim đúng commit
// Anthropic đã duyệt. Tab Khám phá đọc theo trang (không gửi cả danh mục xuống trình duyệt); cài từng thư viện hoặc cài cả mục (plugjob.ts).
// CLAUDE_DIR_FILE: dùng danh mục khác (kiểm thử).
import fs from "node:fs";
import path from "node:path";
import type { PluginDef } from "./plugins";

// closed: giấy phép đóng, không cài; alt: thư viện mở thay thế (id trong danh mục). github: repo mở thêm từ GitHub để thay thư viện đóng (altFor).
export type DirEntry = { id: string; slug: string; name: string; summary: string; author: string; cats: string[]; license: string; repo: string; path: string; commit: string; homepage: string; skills: string[]; verified?: string;
  closed?: boolean; alt?: string[]; github?: boolean; altFor?: string[] };
type File = { synced: string; plugins: DirEntry[] };

const G = globalThis as unknown as { __claudeDir?: { at: number; file: string; data: File; byId: Map<string, DirEntry>; text: Map<string, string> } };
const fileOf = () => process.env.CLAUDE_DIR_FILE || path.join(process.cwd(), "catalog", "claude-directory.json");
function load() {
  const file = fileOf();
  const c = G.__claudeDir;
  let mt = 0;
  try { mt = fs.statSync(file).mtimeMs; } catch { return null; }
  if (c && c.file === file && c.at === mt) return c;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as File;
  const byId = new Map(data.plugins.map((p) => [p.id, p]));
  const text = new Map(data.plugins.map((p) => [p.id, `${p.name} ${p.summary} ${p.author} ${p.skills.join(" ")}`.toLowerCase()]));
  return (G.__claudeDir = { at: mt, file, data, byId, text });
}

/** Khóa catalogId của thư viện cài từ danh mục Claude. */
export const CD = "cd:";
export const dirEntries = () => load()?.data.plugins ?? [];
export const dirEntry = (catalogId: string) => (catalogId.startsWith(CD) ? load()?.byId.get(catalogId.slice(CD.length)) ?? null : null);
export const dirSynced = () => load()?.data.synced ?? null;
export const dirById = (id: string) => load()?.byId.get(id) ?? null;
/** Lý do không cài thư viện giấy phép đóng, kèm thư viện mở thay thế. */
export const closedReason = (e: DirEntry) => `Giấy phép đóng (${e.license}): tác giả không cho sao chép nên Synchro không cài. ${e.alt?.length ? `Thay bằng thư viện mở: ${e.alt.map((a) => dirById(a)?.name ?? a).join(", ")}.` : "Chưa có thư viện mở làm được việc tương đương."}`;
/** Mục ngành nghề của một thư viện đã cài (theo catalogId). */
export const dirCats = (catalogId: string | null) => (catalogId ? dirEntry(catalogId)?.cats ?? [] : []);

export function dirDef(e: DirEntry): PluginDef {
  return {
    catalogId: CD + e.id, slug: e.slug, name: e.name, description: e.summary || e.skills.slice(0, 12).join(", "), author: e.author, homepage: e.homepage,
    sources: [{ repo: e.repo, ref: e.commit || undefined, ...(e.path ? { path: e.path } : {}) }],
  };
}

/** Số thư viện và số skill mỗi mục (đếm cả mục phụ, như Claude). */
export function dirCounts() {
  const out: Record<string, { plugins: number; skills: number; closed: number }> = {};
  for (const p of dirEntries()) for (const c of p.cats) { const o = (out[c] ??= { plugins: 0, skills: 0, closed: 0 }); o.plugins++; o.skills += p.skills.length; if (p.closed) o.closed++; }
  return out;
}

/** Một trang của danh mục: lọc theo mục và từ khóa (tên, mô tả, tác giả, tên skill). */
export function dirPage(o: { cat?: string; q?: string; page?: number; size?: number; status?: (id: string) => string | undefined; only?: "installed" | "missing" }) {
  const c = load();
  if (!c) return { items: [], total: 0, page: 0, pages: 0 };
  const words = (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const size = Math.min(Math.max(o.size ?? 24, 1), 100);
  const all = c.data.plugins.filter((p) => (!o.cat || p.cats.includes(o.cat)) && words.every((w) => c.text.get(p.id)!.includes(w))
    && (!o.only || (o.only === "installed") === !!o.status?.(CD + p.id)));
  const pages = Math.ceil(all.length / size), page = Math.min(Math.max(o.page ?? 0, 0), Math.max(pages - 1, 0));
  return { items: all.slice(page * size, page * size + size), total: all.length, page, pages };
}
