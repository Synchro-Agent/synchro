// Không gian tệp ảo của artifact (dùng chung cho trình duyệt và máy chủ).
// Sửa artifact đã có không viết lại cả tệp: model gửi các khối SEARCH/REPLACE (mode="patch"), Synchro áp vào bản hiện tại
// để ra phiên bản mới. Lịch sử gửi cho model chỉ giữ MỘT bản hiện tại của mỗi artifact (<current_artifacts>), các bản cũ
// thay bằng một dòng tham chiếu, nên sửa 10 lần cũng không phình token.
import { splitArtifacts, type ArtBlock } from "./artifacts";

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
  return { ...prev, title: a.title || prev.title, content: r.content, complete: a.complete, patch: true, fix: { applied: r.applied, failed: a.complete ? r.failed : [] }, v, patchText: a.content };
}

/** Duyệt các câu trả lời theo thứ tự, trả về trạng thái hiện tại của mọi artifact. */
export function artState(texts: string[]): ArtState {
  const st: ArtState = new Map();
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
