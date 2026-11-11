// Không gian tệp ảo của artifact (dùng chung cho trình duyệt và máy chủ).
// Sửa artifact đã có không viết lại cả tệp: model gửi các khối SEARCH/REPLACE (mode="patch"), Synchro áp vào bản hiện tại
// để ra phiên bản mới. Lịch sử gửi cho model chỉ giữ MỘT bản hiện tại của mỗi artifact (<current_artifacts>), các bản cũ
// thay bằng một dòng tham chiếu, nên sửa 10 lần cũng không phình token.
import { ART_TYPES, splitArtifacts, type ArtBlock } from "./artifacts";
import { expandTemplates } from "./designtemplates";

export const PATCH_RE = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
export type Patch = { search: string; replace: string };
export type PatchResult = { ok: boolean; content: string; applied: number; failed: string[] };

export function parsePatches(body: string): Patch[] {
  return [...body.matchAll(PATCH_RE)].map((m) => ({ search: m[1], replace: m[2] }));
}

// Khớp theo dòng, bỏ qua khác biệt thụt lề và khoảng trắng cuối dòng (model hay chép sai thụt lề).
function looseFind(lines: string[], want: string[], from: number): number {
  const n = (s: string) => s.trim().replace(/\s+/g, " ");
  const w = want.map(n);
  for (let i = from; i + w.length <= lines.length; i++) {
    let k = 0;
    while (k < w.length && n(lines[i + k]) === w[k]) k++;
    if (k === w.length) return i;
  }
  return -1;
}

/** Áp lần lượt các khối SEARCH/REPLACE vào nội dung gốc. SEARCH rỗng = thêm vào cuối. */
export function applyPatches(base: string, patches: Patch[]): PatchResult {
  let content = base, applied = 0;
  const failed: string[] = [];
  for (const p of patches) {
    if (!p.search.trim()) { content = content.replace(/\n?$/, "\n") + p.replace; applied++; continue; }
    const at = content.indexOf(p.search);
    if (at !== -1) { content = content.slice(0, at) + p.replace + content.slice(at + p.search.length); applied++; continue; }
    const lines = content.split("\n"), want = p.search.split("\n");
    while (want.length && !want[want.length - 1].trim()) want.pop();
    const i = want.length ? looseFind(lines, want, 0) : -1;
    if (i === -1) { failed.push(p.search.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? ""); continue; }
    // Giữ thụt lề của bản gốc cho phần thay thế khi model viết lệch thụt lề.
    const pad = /^\s*/.exec(lines[i])![0], wpad = /^\s*/.exec(want[0])![0];
    const rep = p.replace.split("\n").map((l) => (wpad && l.startsWith(wpad) ? pad + l.slice(wpad.length) : !wpad && pad && l ? pad + l : l));
    lines.splice(i, want.length, ...rep);
    content = lines.join("\n");
    applied++;
  }
  return { ok: failed.length === 0 && applied > 0, content, applied, failed };
}

// fix: kết quả áp bản sửa (patch) của phiên bản này.
export type ArtVersion = ArtBlock & { v: number; fix?: { applied: number; failed: string[] } };
export type ArtState = Map<string, ArtVersion>;

/** Một artifact trong câu trả lời → phiên bản đầy đủ: bản patch được áp vào bản trước cùng identifier. */
export function resolveArt(prev: ArtVersion | undefined, a: ArtBlock): ArtVersion {
  const v = (prev?.v ?? 0) + 1;
  if (!a.patch) return { ...a, v };
  if (!prev) return { ...a, v, fix: { applied: 0, failed: ["(chưa có bản trước để sửa)"] } };
  // Đang viết dở: áp các khối đã đóng, phần còn lại chờ.
  const r = applyPatches(prev.content, parsePatches(a.content));
  // Bản sửa thêm trang theo mẫu điền sẵn (khối JSON) thì dựng luôn như bản đầy đủ.
  return { ...prev, title: a.title || prev.title, content: prev.type === "html" ? expandTemplates(r.content) : r.content, complete: a.complete, patch: true, fix: { applied: r.applied, failed: a.complete ? r.failed : [] }, v, patchText: a.content };
}

/** Duyệt các câu trả lời theo thứ tự, trả về trạng thái hiện tại của mọi artifact.
 *  base: bản hiện tại của artifact thuộc phần lịch sử không gửi (đã nén), làm nền cho các bản sửa phía sau. */
export function artState(texts: string[], base: ArtVersion[] = []): ArtState {
  const st: ArtState = new Map(base.map((a) => [a.ident, a]));
  for (const t of texts) for (const sg of splitArtifacts(t)) if (sg.kind === "art") st.set(sg.art.ident, resolveArt(st.get(sg.art.ident), sg.art));
  return st;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Thay nội dung artifact trong một câu trả lời cũ bằng thẻ tham chiếu (model đọc bản hiện tại ở <current_artifacts>). */
export function stubArtifacts(text: string, st: ArtState, seen: Map<string, number>): string {
  return splitArtifacts(text).map((sg) => {
    if (sg.kind === "text") return sg.text;
    const v = (seen.get(sg.art.ident) ?? 0) + 1;
    seen.set(sg.art.ident, v);
    const cur = st.get(sg.art.ident);
    const failed = sg.art.patch && cur && cur.v === v && cur.fix?.failed.length ? ` patch_failed="${esc(cur.fix.failed.join(" | "))}"` : "";
    return `<artifact identifier="${sg.art.ident}" title="${esc(sg.art.title)}" version="${v}"${sg.art.patch ? ' mode="patch"' : ""}${failed} />`;
  }).join("");
}

// Nền artifact trình duyệt gửi lên (phần lịch sử đã nén): chỉ nhận dữ liệu hợp lệ.
export function cleanBase(raw: unknown): ArtVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap((x): ArtVersion[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    const ident = typeof o.ident === "string" && /^[\w.-]{1,80}$/.test(o.ident) ? o.ident : "";
    const type = typeof o.type === "string" && (ART_TYPES as readonly string[]).includes(o.type) ? (o.type as ArtVersion["type"]) : null;
    const content = typeof o.content === "string" && o.content.length <= 400_000 ? o.content : "";
    if (!ident || !type || !content) return [];
    return [{ ident, type, title: typeof o.title === "string" ? o.title.slice(0, 200) : ident, lang: typeof o.lang === "string" ? o.lang.slice(0, 30) : null, content, complete: true, v: Math.max(1, Math.min(999, Number(o.v) || 1)) }];
  });
}
/** Bản hiện tại của mọi artifact trong các câu trả lời (trình duyệt dùng để gửi nền cho phần lịch sử đã nén). */
export const artBase = (texts: string[]) => [...artState(texts).values()].filter((a) => a.complete).map(({ ident, type, title, lang, content, v }) => ({ ident, type, title, lang, content, v }));

const MIME_OUT: Record<string, string> = { html: "text/html", react: "application/vnd.react", svg: "image/svg+xml", markdown: "text/markdown", code: "application/vnd.code", mermaid: "application/vnd.mermaid", vbhc: "application/vnd.synchro.vbhc+json" };
/** Khối <current_artifacts>: bản hiện tại của các artifact liên quan nhất (mới sửa gần đây hoặc được nhắc tới), có giới hạn kích thước. */
export function currentArtifactsBlock(st: ArtState, mention: string, max = 3, cap = 60_000): string {
  if (!st.size) return "";
  const all = [...st.values()];
  const low = mention.toLowerCase();
  const named = all.filter((a) => low.includes(a.ident) || (a.title && low.includes(a.title.toLowerCase())));
  const pick = [...named, ...all.reverse()].filter((a, i, l) => l.indexOf(a) === i).slice(0, max);
  const body = pick.map((a) => {
    const c = a.content.length > cap ? a.content.slice(0, cap) + "\n…(đã cắt bớt, phần sau không gửi)" : a.content;
    return `<artifact identifier="${a.ident}" type="${MIME_OUT[a.type] ?? a.type}" title="${esc(a.title)}"${a.lang ? ` language="${a.lang}"` : ""} version="${a.v}">\n${c}\n</artifact>`;
  }).join("\n");
  return `<current_artifacts>\nBản hiện tại của các artifact trong đoạn chat (các phiên bản cũ đã lược bỏ). Khi sửa, khối SEARCH phải chép nguyên văn từ đây.\n${body}\n</current_artifacts>`;
}
