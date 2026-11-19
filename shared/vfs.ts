// Không gian tệp ảo của artifact (dùng chung cho trình duyệt và máy chủ).
// Sửa artifact đã có không viết lại cả tệp: model gửi các khối SEARCH/REPLACE (mode="patch"), Synchro áp vào bản hiện tại
// để ra phiên bản mới. Lịch sử gửi cho model chỉ giữ MỘT bản hiện tại của mỗi artifact (<current_artifacts>), các bản cũ
// thay bằng một dòng tham chiếu, nên sửa 10 lần cũng không phình token.
import { ART_TYPES, splitArtifacts, type ArtBlock } from "./artifacts";
import { expandTemplates } from "./designtemplates";

export type Patch = { search: string; replace: string };
// misses: khối không áp được (số thứ tự từ 1 trong bản sửa, và SEARCH của nó), để báo cho model đúng khối nào
// cần gửi lại.
export type PatchMiss = { block: number; search: string };
export type PatchResult = { ok: boolean; content: string; applied: number; failed: string[]; misses: PatchMiss[] };

// Dấu khối nằm trên dòng riêng. Model hay viết lệch so với mẫu: CRLF, khoảng trắng cuối dòng dấu, 5–9 ký tự thay vì
// đúng 7, kiểu của Cline (------- SEARCH / +++++++ REPLACE). Đọc lệch như thế thành "không có khối nào" thì bản sửa
// không đổi gì mà cũng không báo lỗi.
const OPEN = /^[ \t]*(?:<{5,9}|-{5,9})[ \t]*SEARCH[ \t]*$/i;
const MID = /^[ \t]*={5,9}[ \t]*$/;
const CLOSE = /^[ \t]*(?:>{5,9}|\+{5,9})[ \t]*REPLACE[ \t]*$/i;
// Số dòng mà read_artifact đặt trước mỗi dòng ("  12 | "): model đôi khi chép cả vào SEARCH.
const NUMBERED = /^\s*\d+ \| ?/;

function block(s: string[], r: string[]): Patch {
  const filled = s.filter((l) => l.trim());
  if (!filled.length || !filled.every((l) => NUMBERED.test(l))) return { search: s.join("\n"), replace: r.join("\n") };
  const strip = (l: string) => l.replace(NUMBERED, "");
  return { search: s.map(strip).join("\n"), replace: r.map(strip).join("\n") };
}

/** Các khối SEARCH/REPLACE của một bản sửa. complete: bản sửa đã đóng thẻ, khối cuối thiếu dòng REPLACE vẫn được
 *  nhận (đang viết dở thì khối đó chưa xong, chờ). */
export function parsePatches(body: string, complete = true): Patch[] {
  const out: Patch[] = [];
  let state = 0, s: string[] = [], r: string[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (state === 0) {
      if (OPEN.test(line)) { state = 1; s = []; }
      continue;
    }
    if (state === 1) {
      if (MID.test(line)) { state = 2; r = []; } else s.push(line);
      continue;
    }
    if (CLOSE.test(line)) { out.push(block(s, r)); state = 0; continue; }
    // Khối mới mở khi khối trước chưa có dòng REPLACE: model quên dòng đóng, khối trước kết thúc ở đây.
    if (OPEN.test(line)) { out.push(block(s, r)); state = 1; s = []; continue; }
    r.push(line);
  }
  if (state === 2 && complete) out.push(block(s, r));
  return out;
}
/** Viết lại các khối thành nội dung của một bản sửa mode="patch". */
export const patchBody = (ps: Patch[]) =>
  ps.map((p) => `<<<<<<< SEARCH\n${p.search}\n=======\n${p.replace}\n>>>>>>> REPLACE`).join("\n");

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
// Khớp theo dòng, bỏ qua khác biệt thụt lề và khoảng trắng đầu / cuối dòng (model hay chép sai thụt lề).
function looseFind(lines: string[], want: string[]): number {
  const w = want.map(norm);
  for (let i = 0; i + w.length <= lines.length; i++) {
    let k = 0;
    while (k < w.length && norm(lines[i + k]) === w[k]) k++;
    if (k === w.length) return i;
  }
  return -1;
}
// Như looseFind nhưng bỏ qua cả dòng trống ở hai phía (model hay thêm / bớt dòng trống giữa các khối khi chép
// lại).
// Trả về [dòng đầu, dòng sau dòng cuối] của đoạn khớp.
function sparseFind(lines: string[], want: string[]): [number, number] | null {
  const w = want.map(norm).filter(Boolean);
  if (!w.length) return null;
  const idx = lines.flatMap((l, i) => (l.trim() ? [i] : []));
  for (let j = 0; j + w.length <= idx.length; j++) {
    let k = 0;
    while (k < w.length && norm(lines[idx[j + k]]) === w[k]) k++;
    if (k === w.length) return [idx[j], idx[j + w.length - 1] + 1];
  }
  return null;
}

/** Áp lần lượt các khối SEARCH/REPLACE vào nội dung gốc. SEARCH rỗng = thêm vào cuối. */
export function applyPatches(base: string, patches: Patch[]): PatchResult {
  let content = base, applied = 0;
  const failed: string[] = [], misses: PatchMiss[] = [];
  patches.forEach((p, n) => {
    if (!p.search.trim()) {
      content = content.replace(/\n?$/, "\n") + p.replace;
      applied++;
      return;
    }
    const at = content.indexOf(p.search);
    if (at !== -1) {
      content = content.slice(0, at) + p.replace + content.slice(at + p.search.length);
      applied++;
      return;
    }
    const lines = content.split("\n"), want = p.search.split("\n");
    while (want.length && !want[want.length - 1].trim()) want.pop();
    while (want.length && !want[0].trim()) want.shift();
    const i = want.length ? looseFind(lines, want) : -1;
    const span: [number, number] | null = i !== -1 ? [i, i + want.length] : sparseFind(lines, want);
    if (!span) {
      failed.push(want[0]?.trim().slice(0, 120) ?? "");
      misses.push({ block: n + 1, search: p.search });
      return;
    }
    // Giữ thụt lề của bản gốc cho phần thay thế khi model viết lệch thụt lề.
    const pad = /^\s*/.exec(lines[span[0]])![0], wpad = /^\s*/.exec(want[0])![0];
    const rep = p.replace.split("\n").map((l) => (wpad && l.startsWith(wpad) ? pad + l.slice(wpad.length) : !wpad && pad && l ? pad + l : l));
    lines.splice(span[0], span[1] - span[0], ...rep);
    content = lines.join("\n");
    applied++;
  });
  return { ok: failed.length === 0 && applied > 0, content, applied, failed, misses };
}

// Độ giống của hai dòng theo cặp ký tự (Dice), bỏ qua khoảng trắng: tìm chỗ model định sửa khi SEARCH chép lệch
// vài chữ.
function pairs(s: string) {
  const t = norm(s).toLowerCase(), out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function dice(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}
/** Chỗ trong nội dung giống SEARCH nhất (để báo model chép lại cho đúng): dòng bắt đầu (từ 1) và các dòng quanh đó,
 *  hoặc null khi không có chỗ nào đủ giống. */
export function nearest(content: string, search: string): { from: number; lines: string[] } | null {
  const lines = content.split("\n"), want = search.split("\n").filter((l) => l.trim()).slice(0, 8);
  if (!want.length || !lines.length) return null;
  const lp = lines.map(pairs), wp = want.map(pairs);
  let best = -1, score = 0;
  for (let i = 0; i < lines.length; i++) {
    let sum = 0;
    for (let k = 0; k < wp.length && i + k < lines.length; k++) sum += dice(lp[i + k], wp[k]);
    if (sum / wp.length > score) { score = sum / wp.length; best = i; }
  }
  if (best < 0 || score < 0.35) return null;
  // Đoạn gần giống cùng một dòng trước và một dòng sau: ít nhất 3 dòng ngữ cảnh.
  const from = Math.max(0, best - 1), to = Math.min(lines.length, best + Math.min(want.length, 6) + 1);
  return { from: from + 1, lines: lines.slice(from, to) };
}

// fix: kết quả áp bản sửa (patch) của phiên bản này.
// misses / total: khối nào không áp được trên tổng số khối của bản sửa đã đóng (để báo lại cho model).
export type PatchFix = { applied: number; failed: string[]; misses?: PatchMiss[]; total?: number };
export type ArtVersion = ArtBlock & { v: number; fix?: PatchFix };
export type ArtState = Map<string, ArtVersion>;

/** Một artifact trong câu trả lời → phiên bản đầy đủ: bản patch được áp vào bản trước cùng identifier. */
export function resolveArt(prev: ArtVersion | undefined, a: ArtBlock): ArtVersion {
  const v = (prev?.v ?? 0) + 1;
  if (!a.patch) return { ...a, v };
  if (!prev) return { ...a, v, fix: { applied: 0, failed: ["(chưa có bản trước để sửa)"] } };
  // Đang viết dở: áp các khối đã đóng, phần còn lại chờ.
  const ps = parsePatches(a.content, a.complete);
  const r = applyPatches(prev.content, ps);
  // Bản sửa đã đóng mà không đọc được khối nào: không đổi gì, phải báo như khối không khớp chứ không im lặng giữ
  // nguyên bản trước.
  const none = a.complete && !ps.length ? ["(không đọc được khối SEARCH/REPLACE nào)"] : [];
  const fix: PatchFix = a.complete
    ? { applied: r.applied, failed: [...none, ...r.failed], misses: r.misses, total: ps.length }
    : { applied: r.applied, failed: [] };
  // Bản sửa thêm trang theo mẫu điền sẵn (khối JSON) thì dựng luôn như bản đầy đủ.
  const content = prev.type === "html" ? expandTemplates(r.content) : r.content;
  const title = a.title || prev.title;
  return { ...prev, title, content, complete: a.complete, patch: true, fix, v, patchText: a.content };
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

const MIME_OUT: Record<string, string> = { html: "text/html", react: "application/vnd.react", svg: "image/svg+xml", markdown: "text/markdown", code: "application/vnd.code", mermaid: "application/vnd.mermaid", d2: "application/vnd.d2", vbhc: "application/vnd.synchro.vbhc+json" };
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
