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

const G = globalThis as unknown as { __claudeDir?: { at: number; file: string; data: File; byId: Map<string, DirEntry>; text: Map<string, string>; tok?: Map<string, Set<string>>; df?: Map<string, number>; near?: Map<string, string[]>; weight?: Map<string, number> } };
const fileOf = () => process.env.CLAUDE_DIR_FILE || path.join(process.cwd(), "catalog", "claude-directory.json");
function load() {
  const file = fileOf();
  const c = G.__claudeDir;
  let mt = 0;
  try { mt = fs.statSync(file).mtimeMs; } catch { return null; }
  if (c && c.file === file && c.at === mt) return c;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as File;
  // "UNLICENSED" (cách ghi của npm) nghĩa là tác giả không cấp giấy phép nào, không phải The Unlicense: danh mục cũ tính nhầm là mở.
  for (const p of data.plugins) if (!p.closed && /^\s*UNLICENSED\s*$/i.test(p.license)) p.closed = true;
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
export const closedReason = (e: DirEntry) => `Giấy phép đóng (${e.license}): tác giả không cho sao chép nên Synchro không cài. ${altsOf(e).length ? `Thay bằng thư viện mở: ${altsOf(e).map((a) => dirById(a)?.name ?? a).join(", ")}.` : "Chưa có thư viện mở làm được việc tương đương."}`;
/** Mục ngành nghề của một thư viện đã cài (theo catalogId). */
export const dirCats = (catalogId: string | null) => (catalogId ? dirEntry(catalogId)?.cats ?? [] : []);

export function dirDef(e: DirEntry): PluginDef {
  return {
    catalogId: CD + e.id, slug: e.slug, name: e.name, description: e.summary || e.skills.slice(0, 12).join(", "), author: e.author, homepage: e.homepage,
    sources: [{ repo: e.repo, ref: e.commit || undefined, ...(e.path ? { path: e.path } : {}) }],
  };
}

// ---------------------------------------------------------------- thư viện mở thay thế tự tìm
// Giấy phép khai rõ là mở (danh mục không ghi giấy phép thì chưa biết, không dùng để gợi ý thay thế: gợi ý phải chắc cài được).
const OPEN_LICENSE = /^\(?\s*(MIT|MIT-0|Apache|BSD|0BSD|ISC|MPL|CC-BY|CC0|Unlicense\b|Zlib|WTFPL|PSF|Python|EPL|BSL-1\.0|LGPL|GPL|AGPL|Artistic|Unicode|BlueOak)/i;
export const openLicense = (l: string) => !!l && !/^\s*UNLICENSED\s*$/i.test(l) && l.split(/\s+(?:OR|AND|WITH)\s+/i).some((x) => OPEN_LICENSE.test(x.trim()));
const NOISE = new Set("the and for with your you from that this skill skills plugin plugins agent agents claude code tool tools using use into via of to in on a an by or is are as at it mcp server official".split(" "));
// Gộp đuôi biến thể tiếng Anh: "invoices" và "invoice", "reconciling" và "reconcile" là một từ; không gộp thì nhiều thư viện cùng việc không khớp nhau.
// Động từ và từ chung thư viện nào cũng có: trùng các từ này không nói lên hai thư viện làm cùng việc (đã qua stem).
const VERBS = new Set("creat manag connect build help workflow review account support work run runs get gets new read writ edit updat add adds list check find search generat track analyz provid assistant integration access directly easily automat your full complet".split(" "));
const stem = (w: string) => (w.length > 4 ? w.replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, "").replace(/e$/, "") : w);
const toks = (e: DirEntry) => new Set(`${e.name} ${e.summary} ${e.skills.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !NOISE.has(w)).map(stem).filter((w) => !VERBS.has(w)));
/**
 * Thư viện mở làm việc gần giống nhất với một thư viện không cài được: cùng mục ngành nghề, trùng nhiều từ hiếm trong tên, mô tả và tên skill.
 * Chỉ dùng thư viện khai giấy phép mở. Điểm dưới ngưỡng thì thôi: thà nói chưa có còn hơn gợi ý cho có.
 */
export function similarOpen(e: DirEntry, k = 3): string[] {
  const c = load();
  if (!c) return [];
  if (!c.tok) {
    c.tok = new Map(c.data.plugins.map((p) => [p.id, toks(p)]));
    c.df = new Map();
    for (const t of c.tok.values()) for (const w of t) c.df.set(w, (c.df.get(w) ?? 0) + 1);
    c.near = new Map();
    c.weight = new Map();
  }
  const memo = c.near!.get(e.id);
  if (memo) return memo.slice(0, k);
  const mine = c.tok.get(e.id) ?? toks(e), N = c.data.plugins.length, cats = new Set(e.cats);
  const idf = (w: string) => Math.log(1 + N / (1 + (c.df!.get(w) ?? 0)));
  const self = [...mine].reduce((a, w) => a + idf(w), 0) || 1, weight = c.weight!;
  if (!weight.size) for (const [id, t] of c.tok) weight.set(id, [...t].reduce((a, w) => a + idf(w), 0) || 1);
  const hits = c.data.plugins
    .filter((p) => p.id !== e.id && !p.closed && openLicense(p.license) && p.cats.some((x) => cats.has(x)))
    .map((p) => {
      const t = c.tok!.get(p.id)!;
      let s = 0, n = 0;
      for (const w of mine) if (t.has(w)) { s += idf(w); n++; }
      // cos đo theo cả hai phía: thư viện khổng lồ nhiều từ không thắng chỉ vì chứa đủ mọi từ.
      return { id: p.id, s: s / self, cos: s / Math.sqrt(self * (weight.get(p.id) ?? 1)), n };
    })
    .filter((x) => x.n >= 3 && x.s >= 0.2 && x.cos >= 0.12)
    .sort((a, b) => b.cos - a.cos).slice(0, 6);
  // Bỏ phần đuôi kém xa thư viện gần nhất: gợi ý thêm cho đủ số chỉ làm người ta mất công.
  const near = hits.filter((x) => x.cos >= hits[0].cos * 0.6).map((x) => x.id);
  c.near!.set(e.id, near);
  return near.slice(0, k);
}
/** Thư viện mở thay thế: đã chọn tay trong danh mục thì theo đó (rỗng: đã xem, không có thư viện làm cùng việc), chưa ai xem thì tự tìm. */
export const altsOf = (e: DirEntry, k = 3) => e.alt ?? similarOpen(e, k);

/** Số thư viện và số skill mỗi mục (đếm cả mục phụ, như Claude). */
export function dirCounts() {
  const out: Record<string, { plugins: number; skills: number; closed: number }> = {};
  for (const p of dirEntries()) for (const c of p.cats) { const o = (out[c] ??= { plugins: 0, skills: 0, closed: 0 }); o.plugins++; o.skills += p.skills.length; if (p.closed) o.closed++; }
  return out;
}

// Danh mục viết bằng tiếng Anh: người Việt gõ việc cần làm ("hóa đơn") phải ra đúng thư viện. Cụm dài trước để "tai lieu" không bị tách.
const VI_TERMS: [string, string[]][] = [
  ["hoa don", ["invoice", "billing"]], ["hop dong", ["contract", "agreement"]], ["tai lieu", ["document", "doc"]], ["van ban", ["document", "text"]], ["bao cao", ["report"]],
  ["trinh chieu", ["presentation", "slide"]], ["thuyet trinh", ["presentation", "slide"]], ["bang tinh", ["spreadsheet", "excel"]], ["thiet ke", ["design"]], ["hinh anh", ["image", "photo"]],
  ["ke toan", ["accounting", "bookkeep"]], ["tai chinh", ["finance", "financial"]], ["ngan sach", ["budget"]], ["thue", ["tax"]], ["phap ly", ["legal", "law"]], ["luat", ["legal", "law"]],
  ["nhan su", ["hr", "human resources"]], ["tuyen dung", ["recruit", "hiring"]], ["ban hang", ["sales"]], ["tiep thi", ["marketing"]], ["khach hang", ["customer"]], ["du lieu", ["data"]],
  ["lap trinh", ["code", "coding", "programming"]], ["kiem thu", ["test"]], ["bao mat", ["security"]], ["dich thuat", ["translat"]], ["am thanh", ["audio"]], ["giong noi", ["voice", "speech"]],
  ["hoc tap", ["learning", "study"]], ["giao duc", ["education"]], ["y te", ["health", "medical"]], ["nghien cuu", ["research"]], ["lich", ["calendar", "schedule"]], ["cuoc hop", ["meeting"]], ["bien ban", ["meeting minutes", "minutes"]],
];
const foldVi = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
/** Câu tìm thành các nhóm từ: mỗi nhóm khớp một trong các cách viết. Có dấu hay không đều như nhau. */
export function searchTerms(q: string): string[][] {
  let rest = foldVi(q.toLowerCase());
  const out: string[][] = [];
  for (const [vi, en] of VI_TERMS) {
    const re = new RegExp(`(?:^|\\s)${vi}(?=\\s|$)`);
    if (re.test(rest)) { rest = rest.replace(re, " "); out.push(en); }
  }
  for (const w of rest.split(/\s+/).filter(Boolean)) out.push([w]);
  return out;
}

/** Một trang của danh mục: lọc theo mục và từ khóa (tên, mô tả, tác giả, tên skill). */
export function dirPage(o: { cat?: string; q?: string; page?: number; size?: number; status?: (id: string) => string | undefined; avail?: (id: string) => boolean; only?: "installed" | "missing" | "unavailable" }) {
  const c = load();
  if (!c) return { items: [], total: 0, page: 0, pages: 0 };
  const words = searchTerms(o.q ?? "");
  const size = Math.min(Math.max(o.size ?? 24, 1), 100);
  const all = c.data.plugins.filter((p) => (!o.cat || p.cats.includes(o.cat)) && words.every((g) => g.some((w) => c.text.get(p.id)!.includes(w)))
    && (!o.only || (o.only === "installed" ? !!o.status?.(CD + p.id) : !o.status?.(CD + p.id) && (o.avail?.(CD + p.id) ?? true) === (o.only === "missing"))));
  const pages = Math.ceil(all.length / size), page = Math.min(Math.max(o.page ?? 0, 0), Math.max(pages - 1, 0));
  return { items: all.slice(page * size, page * size + size), total: all.length, page, pages };
}
