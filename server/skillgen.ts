// Repo không có SKILL.md: Synchro đọc toàn bộ repo rồi tự viết skill từ nội dung thật của repo.
// - Đọc mọi tệp: tệp văn bản (nhận theo nội dung, không chỉ theo đuôi tệp) vào references/<đường dẫn trong repo> để lúc dùng skill
//   model đọc được bất kỳ tệp nào; references/repo-tree.md liệt kê toàn bộ cây thư mục (cả ảnh / tệp nhị phân không đóng gói).
// - SKILL.md: model của chính người dùng (gói hoặc khóa API, như mọi việc phụ) viết từ bản đọc toàn repo — cây thư mục, README,
//   tài liệu và phần đầu của mọi tệp văn bản trong giới hạn độ dài một lượt; không có model / model lỗi thì dựng từ README.
import "server-only";
import path from "node:path";
import JSZip from "jszip";
import { measureZip, SKILL_ZIP_MAX } from "../scripts/zipguard.mjs";
import type { UserRow } from "./authstore";
import { oneShot, pickModel } from "./ai/anymodel";
import { parseSkillMd, type Entry } from "./skillstore";

export const GEN = { files: 3000, bytes: 40 * 1024 * 1024, file: 1024 * 1024, digest: 90_000 };

const JUNK = (seg: string) => seg === "__MACOSX" || seg === ".DS_Store" || seg === "Thumbs.db" || seg === ".git" || seg === "node_modules";
const DOC = /\.(md|markdown|mdx|rst|txt|adoc|org)$/i;
const MANIFEST = /^(package\.json|pyproject\.toml|setup\.py|setup\.cfg|requirements\.txt|cargo\.toml|go\.mod|gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|makefile|dockerfile|mix\.exs|pubspec\.yaml)$/i;
const LOCK = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|composer\.lock|gemfile\.lock|go\.sum)$/i;

// Văn bản: không có byte 0 trong 8 KB đầu và phần lớn là UTF-8 hợp lệ.
function textOf(b: Buffer): string | null {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return null;
  const t = b.toString("utf8");
  const bad = (t.slice(0, 20_000).match(/�/g) ?? []).length;
  return bad > 20 ? null : t;
}

export type RepoFile = { path: string; size: number; text: string | null; data: Buffer };

/** Mọi tệp của repo trong zip, giới hạn trong thư mục sub nếu có. stripTop: zip của GitHub có thư mục gốc "<repo>-<nhánh>/", bỏ đi. */
export async function readRepo(buf: Buffer, sub = "", o: { stripTop?: boolean } = {}): Promise<{ files: RepoFile[]; skipped: number }> {
  const zip = await JSZip.loadAsync(buf);
  await measureZip(zip, SKILL_ZIP_MAX);
  let all = Object.values(zip.files).filter((f) => !f.dir).map((f) => ({ f, p: path.posix.normalize(f.name.replace(/\\/g, "/")) }))
    .filter(({ p }) => !p.startsWith("/") && !p.split("/").includes("..") && !p.split("/").some(JUNK));
  const tops = new Set(all.map(({ p }) => p.split("/")[0]));
  if (o.stripTop && tops.size === 1 && all.every(({ p }) => p.includes("/"))) { const t = [...tops][0] + "/"; all = all.map((x) => ({ ...x, p: x.p.slice(t.length) })); }
  const want = sub.replace(/^\/+|\/+$/g, "");
  if (want) all = all.filter(({ p }) => p.startsWith(want + "/")).map((x) => ({ ...x, p: x.p.slice(want.length + 1) }));
  const files: RepoFile[] = [];
  let skipped = 0;
  for (const { f, p } of all) {
    const data = await f.async("nodebuffer");
    if (data.length > 30 * 1024 * 1024) { skipped++; continue; }
    files.push({ path: p, size: data.length, text: textOf(data), data });
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped };
}

const depth = (p: string) => p.split("/").length;
const isReadme = (p: string) => /^readme(\.[a-z]+)?$/i.test(path.posix.basename(p));
// Thứ tự ưu tiên khi đọc / đóng gói: README gốc, tài liệu, tệp khai báo dự án, rồi mã nguồn (nông trước, nhỏ trước).
function rank(f: RepoFile) {
  const b = path.posix.basename(f.path);
  if (isReadme(f.path) && depth(f.path) === 1) return 0;
  if (isReadme(f.path)) return 1;
  if (DOC.test(b) || /^(docs?|documentation|guide|guides|wiki)\//i.test(f.path)) return 2;
  if (MANIFEST.test(b) || /^(license|licence|copying|notice)/i.test(b)) return 3;
  if (LOCK.test(f.path)) return 9;
  return 4;
}
const ordered = (files: RepoFile[]) => [...files].sort((a, b) => rank(a) - rank(b) || depth(a.path) - depth(b.path) || a.size - b.size || a.path.localeCompare(b.path));

/** Cây thư mục gọn: mỗi tệp một dòng kèm cỡ (đủ để model và người đọc thấy toàn bộ repo). */
function treeOf(files: RepoFile[], max = 4000) {
  const lines = files.map((f) => `${f.path} (${f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}${f.text === null ? ", nhị phân" : ""})`);
  return lines.length > max ? [...lines.slice(0, max), `… và ${lines.length - max} tệp nữa`] : lines;
}

/** Bản đọc toàn repo cho model: cây thư mục + nội dung (README đầy đủ nhất có thể, mọi tệp văn bản khác ít nhất phần đầu). */
export function digestOf(files: RepoFile[], source: string, budget = GEN.digest) {
  const text = ordered(files.filter((f) => f.text !== null && !LOCK.test(f.path)));
  const exts = new Map<string, number>();
  for (const f of files) { const e = path.posix.extname(f.path).toLowerCase() || "(không đuôi)"; exts.set(e, (exts.get(e) ?? 0) + 1); }
  let out = `Repo: ${source}\nTổng ${files.length} tệp (${text.length} tệp văn bản). Loại tệp: ${[...exts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => `${e} ×${n}`).join(", ")}\n\n<cay_thu_muc>\n`;
  const tree = treeOf(files);
  let treeText = tree.join("\n");
  if (treeText.length > budget * 0.25) treeText = treeText.slice(0, Math.floor(budget * 0.25)) + "\n…";
  out += `${treeText}\n</cay_thu_muc>\n\n`;
  let left = budget - out.length;
  // README gốc: tới 35% ngân sách; phần còn lại chia đều cho các tệp văn bản khác theo thứ tự ưu tiên.
  const blocks: string[] = [];
  for (let i = 0; i < text.length && left > 400; i++) {
    const f = text[i];
    const share = i === 0 && isReadme(f.path) ? Math.floor(budget * 0.35) : Math.max(600, Math.floor(left / Math.max(1, Math.min(text.length - i, 60))));
    const body = f.text!.length > share ? `${f.text!.slice(0, share)}\n[… cắt bớt, tệp dài ${f.text!.length} ký tự]` : f.text!;
    const b = `<tep path="${f.path}">\n${body}\n</tep>\n`;
    blocks.push(b.slice(0, left));
    left -= Math.min(b.length, left);
  }
  return out + blocks.join("\n");
}

const kebab = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "repo-skill";
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|~-]+/g, " ").replace(/\s+/g, " ").trim();

/** SKILL.md dựng từ README khi không có model (vẫn đủ để dùng: mục lục + chỉ dẫn tới tệp trong references/). */
export function fallbackSkill(files: RepoFile[], repoName: string, source: string) {
  const readme = ordered(files.filter((f) => f.text !== null)).find((f) => isReadme(f.path));
  const t = readme?.text ?? "";
  const title = /^#\s+(.+)$/m.exec(t)?.[1]?.replace(/[*_`]/g, "").trim() || repoName;
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^(#|!\[|<|\[!\[|\||```)/.test(p) && plain(p).length > 40);
  const intro = plain(paras[0] ?? "").slice(0, 400);
  const heads = [...t.matchAll(/^(##+)\s+(.+)$/gm)].slice(0, 40).map((m) => `${"  ".repeat(Math.min(m[1].length - 2, 2))}- ${m[2].replace(/[*_`[\]]/g, "").replace(/\(#[^)]*\)/g, "").trim()}`);
  const docs = ordered(files.filter((f) => f.text !== null && rank(f) <= 3)).slice(0, 25).map((f) => `- references/${f.path}`);
  const desc = `${intro || `Kiến thức và công cụ từ repo ${source}.`} Dùng khi người dùng hỏi về ${title} hoặc cần làm việc dựa trên repo ${source}.`.replace(/\s+/g, " ").slice(0, 900);
  return `---\nname: ${kebab(repoName)}\ndescription: ${JSON.stringify(desc)}\n---\n# ${title}\n\n${intro || `Skill tạo từ repo ${source}.`}\n\n## Nội dung chính của repo\n${heads.join("\n") || "- (README không có mục lục)"}\n\n## Cách dùng skill này\n- Toàn bộ tệp văn bản của repo nằm trong references/ với đúng đường dẫn như trong repo; cây thư mục đầy đủ ở references/repo-tree.md.\n- Bắt đầu từ ${readme ? `references/${readme.path}` : "references/repo-tree.md"}, rồi mở đúng tệp liên quan tới câu hỏi trước khi trả lời; trích dẫn tên tệp khi dùng nội dung của nó.\n\n## Tệp nên đọc trước\n${docs.join("\n") || "- references/repo-tree.md"}\n`;
}

const SYSTEM = `Bạn viết một Agent Skill (tệp SKILL.md) từ nội dung thật của một repo git, để model khác dùng đúng kiến thức / công cụ trong repo.
Đầu ra CHỈ là nội dung tệp SKILL.md (không bọc trong \`\`\`, không lời dẫn), đúng dạng:
---
name: <tên kebab-case tiếng Anh, chỉ a-z 0-9 và dấu gạch ngang, tối đa 60 ký tự>
description: <một đoạn tối đa 700 ký tự: skill làm được gì và KHI NÀO nên dùng (các cụm từ người dùng hay nói)>
---
# <Tiêu đề>
<Hướng dẫn cho model: mục đích; khi nào dùng; quy trình từng bước; kiến thức, quy tắc, lệnh, API, cấu hình quan trọng rút ra từ repo (cụ thể, đúng như repo); ví dụ ngắn; lỗi hay gặp.>
## Tệp tham khảo
<danh sách các tệp quan trọng nhất kèm một dòng mô tả, ghi đường dẫn dạng references/<đường dẫn trong repo>>
Quy tắc: mọi tệp văn bản của repo được đóng gói ở references/<đường dẫn trong repo> (giữ nguyên đường dẫn), cây thư mục đầy đủ ở references/repo-tree.md — chỉ nhắc tới đường dẫn có trong cây thư mục. Chỉ dựa trên nội dung repo được đưa, không bịa lệnh / API. Viết cùng ngôn ngữ với README của repo. Phần thân dài 400–2500 từ, gọn, có cấu trúc.`;

/** Tạo skill (danh sách tệp, có SKILL.md ở gốc) từ toàn bộ repo. */
export async function skillFromRepo(user: UserRow, files: RepoFile[], o: { repoName: string; source: string; skipped?: number; signal?: AbortSignal }): Promise<{ entries: Entry[]; warnings: string[]; model: string | null }> {
  const warnings: string[] = [];
  if (!files.length) throw new Error("Repo không có tệp nào để đọc");
  const text = ordered(files.filter((f) => f.text !== null && !LOCK.test(f.path)));
  const bin = files.length - text.length;
  // Đóng gói: mọi tệp văn bản (ưu tiên tài liệu) trong giới hạn; tệp quá lớn / vượt giới hạn chỉ có trong cây thư mục.
  const pack: RepoFile[] = [];
  let bytes = 0, over = 0;
  for (const f of text) {
    if (f.size > GEN.file || pack.length >= GEN.files || bytes + f.size > GEN.bytes) { over++; continue; }
    pack.push(f); bytes += f.size;
  }
  let md = "", model: string | null = null;
  // Antigravity nhận prompt qua một tham số dòng lệnh (Linux giới hạn 128 KB mỗi tham số): giữ bản đọc dưới ~100 KB theo byte UTF-8
  // (repo nhiều chữ Trung / Nhật — 3 byte mỗi chữ — thì đọc ít ký tự hơn).
  let digest = digestOf(files, o.source);
  for (let b = GEN.digest, n = 0; Buffer.byteLength(digest) > 100_000 && n < 6; n++) { b = Math.floor((b * 95_000) / Buffer.byteLength(digest)); digest = digestOf(files, o.source, b); }
  const pick = await pickModel(user, { text: "đọc tài liệu repo rồi viết hướng dẫn chi tiết", attachments: 0, turns: 1, studio: false }).catch(() => null);
  if (pick) {
    try {
      const raw = await oneShot(user, pick.model, SYSTEM, [{ role: "user", content: `Viết SKILL.md cho repo dưới đây. Tên gợi ý: ${kebab(o.repoName)}.\n\n${digest}` }], { maxTokens: 6000, signal: o.signal, feature: "skill-gen" });
      const cleaned = raw.trim().replace(/^```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```\s*$/i, "$1").replace(/^[\s\S]*?(?=^---\s*$)/m, "").trim();
      const p = parseSkillMd(cleaned);
      if (p.body.length < 200) throw new Error("SKILL.md quá ngắn");
      md = p.repaired ?? cleaned; model = pick.model;
    } catch (e) {
      warnings.push(`Model chưa viết được SKILL.md (${String((e as Error).message ?? e).slice(0, 160)}), nên Synchro dựng skill từ README của repo`);
    }
  } else warnings.push("Chưa có model nào để viết SKILL.md (chưa đăng nhập gói hoặc chưa có khóa API), nên Synchro dựng skill từ README của repo");
  if (!md) md = fallbackSkill(files, o.repoName, o.source);
  const tree = `# Cây thư mục của ${o.source}\n\n${files.length} tệp. Tệp văn bản nằm trong references/ với đúng đường dẫn dưới đây (trừ tệp đánh dấu "không đóng gói").\n\n${treeOf(files, 20_000).map((l, i) => { const f = files[i]; return `- ${l}${f && !pack.includes(f) ? " — không đóng gói" : ""}`; }).join("\n")}\n`;
  const entries: Entry[] = [
    { path: "SKILL.md", data: Buffer.from(md) },
    { path: "references/repo-tree.md", data: Buffer.from(tree) },
    ...pack.map((f) => ({ path: `references/${f.path}`, data: f.data })),
  ];
  warnings.unshift(`Repo không có SKILL.md: Synchro đã đọc toàn bộ ${files.length} tệp của repo${model ? " và nhờ model viết SKILL.md" : ""}. Hãy đọc lại nội dung bên dưới trước khi thêm`);
  if (bin) warnings.push(`${bin} tệp nhị phân (ảnh, tệp nén…) chỉ có tên trong references/repo-tree.md, không đóng gói`);
  if (over) warnings.push(`${over} tệp văn bản quá lớn hoặc vượt giới hạn ${GEN.files} tệp / ${GEN.bytes / 1048576}MB nên chỉ có tên trong references/repo-tree.md`);
  if (o.skipped) warnings.push(`${o.skipped} tệp lớn hơn 30MB được bỏ qua`);
  return { entries, warnings, model };
}
