// Ghép phần sửa sau lời nhắc <auto_check> vào câu trả lời gốc (review W10, H1 lỗi 9).
// Synchro tự kiểm bộ slide lúc model định trả lời xong; thấy lỗi thì nhắc model sửa. Câu trả lời model đã viết cho người dùng (lời tóm tắt bộ slide)
// được giữ nguyên, không bị thay bằng câu trả lời cho lời nhắc ẩn. Bản sửa của model gộp vào đúng artifact gốc trong câu trả lời: bản sửa
// mode="patch" áp vào bản đầy đủ (hoặc nối vào bản sửa gốc), bản viết lại trọn thay chỗ bản cũ, nên người dùng thấy MỘT thẻ artifact, không phải
// thẻ bản đầy đủ cộng thẻ bản sửa cùng ghi "Phiên bản 1". Tệp thuần: tests/api/deck-quality.test.mjs.
import { splitArtifacts, type ArtBlock } from "./artifacts";
import { applyPatches, parsePatches } from "./vfs";

/** Câu trả lời của model khi giữ nguyên (cố ý) sau lời nhắc. */
export const KEEP = "<keep/>";
const KEEP_RE = /<keep\s*\/?>(?:\s*<\/keep>)?/gi;
const BLOCK = /<artifact\b[^>]*>[\s\S]*?(?:<\/artifact>|$)/gi;

type Hit = { at: number; end: number; raw: string; art: ArtBlock };
const blocks = (text: string): Hit[] => [...text.matchAll(BLOCK)].flatMap((m) => {
  const seg = splitArtifacts(m[0]).find((s) => s.kind === "art");
  return seg?.kind === "art" ? [{ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, raw: m[0], art: seg.art }] : [];
});
const openTag = (raw: string) => raw.slice(0, raw.indexOf(">") + 1);

/** original: câu trả lời gốc (đã giữ lại); before: artifact viết giữa lượt trước lời nhắc (turnArts); reply: mọi chữ model viết sau lời nhắc
 *  (artifact viết giữa lượt sau lời nhắc + câu trả lời cuối). Trả về câu trả lời ghép và turnArts mới. */
export function foldFix(original: string, before: string[], reply: string): { text: string; before: string[] } {
  let text = original;
  const arts = [...before];
  const kept: string[] = [];
  let fixed = 0;
  // Bản cuối cùng mang identifier này: ở câu trả lời gốc trước, không có thì ở artifact viết giữa lượt.
  const target = (ident: string): { where: number; hit: Hit } | null => {
    const inText = blocks(text).filter((h) => h.art.ident === ident && h.art.complete).pop();
    if (inText) return { where: -1, hit: inText };
    for (let i = arts.length - 1; i >= 0; i--) { const h = blocks(arts[i]).filter((b) => b.art.ident === ident && b.art.complete).pop(); if (h) return { where: i, hit: h }; }
    return null;
  };
  const put = (t: { where: number; hit: Hit }, raw: string) => {
    const src = t.where < 0 ? text : arts[t.where], next = src.slice(0, t.hit.at) + raw + src.slice(t.hit.end);
    if (t.where < 0) text = next; else arts[t.where] = next;
  };
  let rest = reply;
  for (const b of blocks(reply)) {
    // Bản sửa viết dở (dừng giữa chừng): bỏ, bản gốc vẫn còn nguyên.
    if (!b.art.complete) { rest = rest.replace(b.raw, ""); continue; }
    const t = target(b.art.ident);
    if (!t) { kept.push(b.raw); rest = rest.replace(b.raw, ""); continue; }
    if (!b.art.patch) { put(t, b.raw); fixed++; rest = rest.replace(b.raw, ""); continue; }
    const body = b.raw.slice(openTag(b.raw).length).replace(/<\/artifact>\s*$/, "");
    if (t.hit.art.patch) {
      // Bản gốc cũng là bản sửa: nối các khối SEARCH/REPLACE, áp lần lượt như hai bản sửa liền nhau.
      put(t, `${openTag(t.hit.raw)}${t.hit.raw.slice(openTag(t.hit.raw).length).replace(/<\/artifact>\s*$/, "").replace(/\n?$/, "\n")}${body.replace(/^\n/, "")}</artifact>`);
      fixed++; rest = rest.replace(b.raw, ""); continue;
    }
    const r = applyPatches(t.hit.art.content, parsePatches(b.art.content));
    // Áp không được: giữ bản sửa riêng như trước (trình duyệt báo bản sửa lỗi, có nút nhờ viết lại).
    if (!r.ok) { kept.push(b.raw); rest = rest.replace(b.raw, ""); continue; }
    put(t, `${openTag(t.hit.raw)}\n${r.content}\n</artifact>`);
    fixed++; rest = rest.replace(b.raw, "");
  }
  // Lời của model sau lời nhắc chỉ giữ khi đã sửa được gì đó (một câu nói đã chỉnh gì). Giữ nguyên (<keep/>) hay chỉ nói lý do thì đó là lời
  // đáp cho lời nhắc ẩn, người dùng không cần đọc.
  const note = fixed || kept.length ? rest.replace(KEEP_RE, "").replace(/\n{3,}/g, "\n\n").trim() : "";
  const tail = [note, ...kept].filter(Boolean).join("\n\n");
  return { text: tail ? `${text.trimEnd()}\n\n${tail}` : text, before: arts };
}

/** H1 lỗi 9: model viết trọn bộ slide giữa lượt (trước khi gọi check_artifact), rồi câu trả lời cuối chỉ có bản sửa mode="patch". Ghép hai thứ đó
 *  thành hai thẻ "Phiên bản 1" (bấm thẻ nào cũng mở bản cũ). Bản sửa trong câu trả lời cuối mà bản đầy đủ nằm trong artifact viết giữa lượt
 *  thì áp thẳng vào bản đó và bỏ khỏi câu trả lời: người dùng thấy một thẻ, đúng bản đã sửa. Áp không được thì giữ nguyên như cũ. */
export function foldPatches(arts: string[], text: string): { arts: string[]; text: string } {
  const out = [...arts];
  let t = text;
  for (const b of blocks(text)) {
    if (!b.art.patch || !b.art.complete) continue;
    // Bản cuối cùng cùng identifier trong phần viết giữa lượt phải là bản đầy đủ (đã có bản sửa giữa lượt thì áp chồng lên bản đó sẽ sai thứ tự: để nguyên).
    let at = -1, hit: Hit | undefined;
    for (let i = out.length - 1; i >= 0 && !hit; i--) { hit = blocks(out[i]).filter((h) => h.art.ident === b.art.ident).pop(); if (hit) at = i; }
    if (!hit || hit.art.patch || !hit.art.complete) continue;
    const r = applyPatches(hit.art.content, parsePatches(b.art.content));
    if (!r.ok) continue;
    out[at] = out[at].slice(0, hit.at) + `${openTag(hit.raw)}\n${r.content}\n</artifact>` + out[at].slice(hit.end);
    t = t.replace(b.raw, "");
  }
  return { arts: out, text: t === text ? text : t.replace(/\n{3,}/g, "\n\n").trim() };
}
