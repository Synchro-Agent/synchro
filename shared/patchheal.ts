// Bản sửa artifact (mode="patch") trong một lượt: khối nào áp được, khối nào không, và ghép lần gửi lại vào đúng chỗ.
// Khối SEARCH không khớp mà model chỉ thấy "bản hiện tại" không đổi thì nó viết lại cả tệp (bộ slide 6 trang từng mất
// khoảng 2 trong 7,5 phút vì vậy). Model cần biết chính xác khối nào hỏng và chỗ gần giống nhất ở đâu để gửi lại đúng
// khối đó.
// Hàm thuần, dùng chung cho máy chủ và kiểm thử.
import { splitArtifacts, type ArtBlock } from "./artifacts";
import {
  applyPatches, nearest, parsePatches, patchBody, resolveArt, type ArtState, type ArtVersion, type PatchMiss,
} from "./vfs";

const BLOCK = /<artifact\b[^>]*>[\s\S]*?(?:<\/artifact>|$)/gi;
// raw: nguyên văn thẻ artifact trong chữ của lượt; prev: bản ngay trước nó; r: bản sau khi áp.
export type TurnArt = { raw: string; art: ArtBlock; prev?: ArtVersion; r: ArtVersion };

function arts(text: string): { raw: string; art: ArtBlock }[] {
  return [...text.matchAll(BLOCK)].flatMap((m) => {
    const seg = splitArtifacts(m[0]).find((g) => g.kind === "art");
    return seg?.kind === "art" ? [{ raw: m[0], art: seg.art }] : [];
  });
}

/** Đi qua chữ của lượt theo thứ tự (artifact viết giữa lượt rồi câu trả lời), áp từng artifact lên trạng thái
 *  trước lượt. */
export function walkTurn(prior: ArtState, texts: string[]): TurnArt[] {
  const st: ArtState = new Map(prior);
  const out: TurnArt[] = [];
  for (const t of texts) {
    for (const a of arts(t)) {
      const prev = st.get(a.art.ident), r = resolveArt(prev, a.art);
      st.set(a.art.ident, r);
      out.push({ ...a, prev, r });
    }
  }
  return out;
}

/** ok / failed: số khối SEARCH/REPLACE áp được / không áp được trong lượt. rewrites: số lần artifact được viết lại
 *  trọn ngay sau một bản sửa không áp được của chính nó (thứ cần về 0). */
export function patchStats(prior: ArtState, texts: string[]) {
  let ok = 0, failed = 0, rewrites = 0;
  const broken = new Set<string>();
  for (const x of walkTurn(prior, texts)) {
    if (!x.art.complete) continue;
    if (!x.art.patch) {
      if (broken.delete(x.art.ident)) rewrites++;
      continue;
    }
    ok += x.r.fix?.applied ?? 0;
    failed += x.r.fix?.failed.length ?? 0;
    if (x.r.fix?.failed.length) broken.add(x.art.ident);
    else broken.delete(x.art.ident);
  }
  return { ok, failed, rewrites };
}

/** Artifact mà bản cuối cùng trong lượt là bản sửa có khối không áp được. */
export function failingPatches(prior: ArtState, texts: string[]): TurnArt[] {
  const last = new Map<string, TurnArt>();
  for (const x of walkTurn(prior, texts)) last.set(x.art.ident, x);
  return [...last.values()].filter((x) => x.art.patch && x.art.complete && x.r.fix?.failed.length);
}

const NO_PREV = "(chưa có bản trước để sửa)";
const clip = (l: string) => (l.length > 200 ? `${l.slice(0, 200)}…` : l);
function missRow(a: ArtVersion, total: number, m: PatchMiss): string {
  const { block, search } = m;
  const first = search.split("\n").find((l) => l.trim())?.trim() ?? "";
  const why = m.why?.replace(/^\((.*)\)$/, "$1");
  if (why) return `- Khối ${block}/${total}: ${why}. SEARCH bắt đầu bằng: ${clip(first)}`;
  const near = nearest(a.content, search);
  const head = `- Khối ${block}/${total}: SEARCH không khớp với bản hiện tại (đã bỏ qua khác biệt thụt lề,`
    + ` khoảng trắng đầu / cuối dòng và dòng trống). SEARCH bắt đầu bằng: ${clip(first)}`;
  if (!near) return `${head}\n  Không có chỗ nào gần giống trong bản hiện tại: đoạn này có thể đã bị sửa hoặc xóa.`;
  const last = near.from + near.lines.length - 1;
  const lines = near.lines.map((l, i) => `${String(near.from + i).padStart(4)} | ${clip(l)}`).join("\n");
  return `${head}\n  Chỗ gần giống nhất (dòng ${near.from}–${last}):\n${lines}`;
}
/** Báo cho model bản sửa gần nhất của artifact có khối không áp được: khối nào, SEARCH bắt đầu bằng gì, chỗ gần
 *  giống nhất kèm số dòng của bản hiện tại. Rỗng khi bản sửa áp trọn. */
export function patchReport(a: ArtVersion): string {
  const f = a.fix;
  if (!f?.failed.length) return "";
  if (f.failed[0] === NO_PREV) {
    return `<patch_failed identifier="${a.ident}">\nChưa có bản nào của "${a.ident}" để áp bản sửa mode="patch":`
      + ` kiểm tra lại identifier (đúng như thẻ <artifact identifier="…"> đã viết), hoặc viết bản đầy đủ nếu đây là`
      + ` artifact mới.\n</patch_failed>`;
  }
  const total = f.total ?? f.applied + f.failed.length;
  const rows = f.misses?.length
    ? f.misses.map((m) => missRow(a, total, m))
    : f.failed.map((x) => `- ${x}`);
  const head = `Bản sửa mode="patch" gần nhất của "${a.ident}" áp được ${f.applied}/${total} khối; các khối dưới đây`
    + ` CHƯA áp nên phiên bản ${a.v} chưa có chúng:`;
  const ask = `Gửi lại một bản sửa mode="patch" chỉ gồm các khối này, SEARCH chép nguyên văn từ bản hiện tại`
    + ` (không kèm số dòng "12 | ", không rút gọn bằng "..."). Không viết lại cả tệp.`;
  const open = `<patch_failed identifier="${a.ident}" version="${a.v}">`;
  return `${open}\n${head}\n${rows.join("\n")}\n${ask}\n</patch_failed>`;
}

/** Lời nhắc ẩn khi câu trả lời kết thúc với bản sửa không áp được: nêu từng khối hỏng, chỉ xin gửi lại đúng các
 *  khối đó. */
export const HEAL_ASK = (reports: string[]) => `Hệ thống: bản sửa artifact trong câu trả lời chưa áp được trọn.
${reports.join("\n")}
Người dùng không thấy tin này; câu trả lời vừa viết được giữ nguyên. Lần trả lời này chỉ gồm artifact mode="patch"`
  + ` cùng identifier với đúng các khối đã nêu (SEARCH chép từ các dòng trên), không viết thêm lời nào và không viết`
  + ` lại cả tệp.`;

/** Ghép lần gửi lại (reply) vào bản sửa hỏng: khối đã áp của bản sửa gốc giữ nguyên, khối hỏng thay bằng khối gửi
 *  lại; reply là bản đầy đủ thì thay hẳn bản sửa. Chỉ ghép khi kết quả áp trọn mọi khối, không thì giữ nguyên
 *  (trình duyệt báo bản sửa lỗi). Trả về các cặp [nguyên văn trước, nguyên văn sau khi ghép] để thay ở mọi nơi bản
 *  sửa gốc đang nằm (câu trả lời, artifact viết giữa lượt). */
export function healFold(prior: ArtState, texts: string[], reply: string): [string, string][] {
  const fixes = arts(reply).filter((g) => g.art.complete);
  const out: [string, string][] = [];
  for (const x of failingPatches(prior, texts)) {
    const mine = fixes.filter((g) => g.art.ident === x.art.ident);
    const full = mine.filter((g) => !g.art.patch).pop();
    if (full) {
      out.push([x.raw, full.raw]);
      continue;
    }
    if (!mine.length || !x.prev) continue;
    const missed = new Set((x.r.fix?.misses ?? []).map((m) => m.block));
    const kept = parsePatches(x.art.content).filter((_, i) => !missed.has(i + 1));
    const all = [...kept, ...mine.flatMap((g) => parsePatches(g.art.content))];
    if (!applyPatches(x.prev.content, all).ok) continue;
    const open = x.raw.slice(0, x.raw.indexOf(">") + 1);
    out.push([x.raw, `${open}\n${patchBody(all)}\n</artifact>`]);
  }
  return out;
}
/** Thay các cặp của healFold trong một đoạn chữ. */
export const applySwaps = (text: string, swaps: [string, string][]) =>
  swaps.reduce((t, [a, b]) => t.split(a).join(b), text);

/** Bỏ khỏi text các khối artifact đã có nguyên văn trong seen (artifact đã tách ra giữa lượt). Bộ xử lý khóa API tách
 *  lời dẫn vào seen mà chữ đang viết của bước vẫn còn khối đó; câu trả lời cuối của CLI chứa lại mọi khối đã tách. Đọc
 *  cả hai thì bản sửa bị áp hai lần: khối chèn thêm thành hai bản, số phiên bản nhảy. */
export function dropSeen(seen: string[], text: string): string {
  return seen.length ? text.replace(BLOCK, (b) => (seen.includes(b) ? "" : b)) : text;
}
