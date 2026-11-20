import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ContentBlock, FileError, LARGE_TOKENS, MAX_FILE_BYTES, estTokens } from "../../shared/fileproc/types";
import { detectKind } from "./detect";
import { pickExtractor } from "./extractors";
import { chunkForRag, chunkSheet, rank, scored } from "./rag";
import { checkQuota, claimFile, mayUse } from "./owners";
import { minCos, queueEmbed, registerVecSource, rrf, sweepVecs, vecHash, vecQuery } from "../vecstore";
import { onTick } from "../tasks";
import { db } from "../authstore";
import { distinctName } from "../../shared/fileproc/names";

const DIR = path.join(process.cwd(), ".cache", "files");

/** raw: tệp không đọc được nội dung (nhị phân lạ, hỏng) nhưng vẫn giữ tệp gốc cho Synchro Code; err là lý do để báo khi khung chat đòi đọc nội dung. */
export type Stored = { id: string; name: string; kind: string; tokens: number; large: boolean; blocks: ContentBlock[]; raw?: boolean; err?: string; note?: string; v?: number };
// Bản cách đọc: kết quả trích được lưu mãi theo nội dung tệp, nên sửa bộ đọc bảng tính thì tệp đã tải lên vẫn mang bản cũ sai (mất cột, ngày thành số). Tăng số này là các tệp đó được đọc lại khi dùng tới.
const EXTRACT_V = 3; // 3: CSV giải mã bằng decodeText dùng chung (UTF-16 không BOM, Windows-1258 + NFC), không còn bản cũ đầy byte 0 / "Cittā".
const stale = (r: Stored) => !r.raw && (r.kind === "xlsx" || r.kind === "csv" || r.kind === "pptx") && r.v !== EXTRACT_V;
const tokensOf = (blocks: ContentBlock[]) => estTokens(blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join(""));
/** Đọc lại tệp đã lưu bằng bộ đọc hiện tại; đọc lại lỗi thì giữ bản cũ, không làm mất tệp của người dùng. */
async function refresh(rec: Stored, uid: string): Promise<Stored> {
  try {
    const buf = await readFile(path.join(DIR, rec.id + ".bin"));
    const blocks = await pickExtractor(rec.kind, rec.name).run(buf, { name: rec.name, kind: rec.kind, uid });
    const tokens = tokensOf(blocks);
    const next: Stored = { ...rec, blocks, tokens, large: tokens > LARGE_TOKENS, v: EXTRACT_V };
    await writeFile(path.join(DIR, rec.id + ".json"), JSON.stringify(next));
    return next;
  } catch { return rec; }
}

const safeId = (id: string) => /^[a-f0-9]{40}$/.test(id);
const NEEDS_TOOL = new Set(["image/heic", "legacy-office"]);
const NEEDS_TOOL_EXT = /\.(heic|heif|doc|xls|ppt)$/i;

// Hàm duy nhất: process_file(file) -> ContentBlock[]
// File gốc lưu ở .cache/files/<id>.bin, kết quả trích lưu ở <id>.json để khỏi trích lại.
// raw (Synchro Code): nhận mọi loại tệp; tệp không trích được nội dung vẫn được lưu kèm một dòng ghi chú cho model.
// Các lần đọc đang chạy theo nội dung tệp: cùng một tệp gửi lại khi lần trước chưa xong (bấm Thử lại sau khi khung soạn hết giờ chờ, tệp ghi âm
// đang chép lời) thì chờ lần đó xong rồi lấy kết quả đã lưu, không đọc / chép lời lần nữa (chép lời tốn credit giọng nói).
const inflight = ((globalThis as unknown as { __synchroFileInflight?: Map<string, Promise<void>> }).__synchroFileInflight ??= new Map());

// signal: yêu cầu tải lên của người gửi; người gửi bỏ đi thì các việc còn đang chờ lượt (chép lời, OCR, Office cũ) rời hàng và không chạy.
export async function processFile(buf: Buffer, name: string, uid: string, o: { raw?: boolean; signal?: AbortSignal } = {}): Promise<Stored> {
  if (buf.length === 0 && !o.raw) throw new FileError(`"${name}" là tệp rỗng.`);
  if (buf.length > MAX_FILE_BYTES) throw new FileError(`"${name}" vượt quá giới hạn ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  checkQuota(uid, buf.length);
  const id = createHash("sha1").update(buf).digest("hex");
  await mkdir(DIR, { recursive: true });
  try {
    let hit = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")) as Stored;
    if (stale(hit)) hit = await refresh(hit, uid);
    // Không đọc được chỉ vì máy chủ thiếu chương trình (HEIC, Office cũ): đọc lại, máy có thể vừa cài thêm. Office cũ
    // lưu khi chưa bật LibreOffice mang loại "binary", nên xét cả đuôi tệp.
    if (hit.raw && (NEEDS_TOOL.has(hit.kind) || NEEDS_TOOL_EXT.test(hit.name))) throw new Error("retry");
    if (hit.raw && !o.raw) throw new FileError(hit.err ?? `Không trích được nội dung từ "${name}".`);
    // Có đúng nội dung tệp trong tay nên được là chủ, không lộ gì thêm.
    claimFile(uid, id, buf.length, name);
    return { ...hit, name };
  } catch (e) { if (e instanceof FileError) throw e; /* chưa có cache, hoặc cần đọc lại */ }
  const cur = inflight.get(id);
  if (cur) { await cur; return processFile(buf, name, uid, o); }
  let done!: () => void;
  inflight.set(id, new Promise<void>((r) => (done = r)));
  try { return await extractAndStore(buf, name, uid, id, o); } finally { inflight.delete(id); done(); }
}

async function extractAndStore(buf: Buffer, name: string, uid: string, id: string, o: { raw?: boolean; signal?: AbortSignal }): Promise<Stored> {
  let kind = "binary", blocks: ContentBlock[] = [];
  try {
    kind = await detectKind(buf, name);
    blocks = await pickExtractor(kind, name).run(buf, { name, kind, uid, signal: o.signal });
    const textLen = blocks.reduce((a, b) => a + (b.type === "text" ? b.text.length : b.type === "document" ? (b.fallbackText?.length ?? 0) : 0), 0);
    if (!blocks.length || (kind !== "application/pdf" && !kind.startsWith("image/") && textLen === 0)) throw new FileError(`Không trích được nội dung từ "${name}".`);
  } catch (e) {
    if (!o.raw) throw e;
    const err = e instanceof FileError ? e.message : `Không trích được nội dung từ "${name}".`;
    const rec: Stored = { id, name, kind, tokens: 0, large: false, raw: true, err, blocks: [{ type: "text", text: `(Tệp "${name}", ${buf.length.toLocaleString("vi-VN")} byte: không đọc được nội dung dạng chữ. ${err})` }] };
    await writeFile(path.join(DIR, id + ".bin"), buf);
    await writeFile(path.join(DIR, id + ".json"), JSON.stringify(rec));
    claimFile(uid, id, buf.length, name);
    return rec;
  }
  const tokens = tokensOf(blocks);
  // PDF không gửi nguyên được (quá dài): báo ngay lúc tải lên để người dùng biết model chỉ đọc phần chữ.
  const note = kind === "application/pdf" && !blocks.some((b) => b.type === "document") ? `"${name}" quá dài để gửi nguyên tệp nên model sẽ đọc phần chữ, không thấy hình và bố cục.` : undefined;
  const rec: Stored = { id, name, kind, tokens, large: tokens > LARGE_TOKENS, blocks, v: EXTRACT_V, ...(note ? { note } : {}) };
  await writeFile(path.join(DIR, id + ".bin"), buf);
  await writeFile(path.join(DIR, id + ".json"), JSON.stringify(rec));
  claimFile(uid, id, buf.length, name);
  return rec;
}

const esc = (s: string) => s.replace(/<\/file>/gi, "<\\/file>");

/** Tệp gốc đã lưu (Synchro Code chép nguyên tệp vào workspace; Synchro tải tệp đính kèm lên trang web bằng browser_upload). */
export async function storedFile(id: string, uid: string): Promise<{ rec: Stored; buf: Buffer } | null> {
  if (!safeId(id) || !mayUse(uid, id)) return null;
  try { return { rec: JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")), buf: await readFile(path.join(DIR, id + ".bin")) }; } catch { return null; }
}

// Tài liệu lớn: các đoạn được embed ở nền (lần đầu tệp được hỏi tới), các lần sau chọn đoạn bằng BM25 + nghĩa (RRF). Tệp lưu theo nội dung
// (id = sha1) nên vector dùng chung cho mọi người có tệp (không gắn với người trả tiền: xóa tài khoản một người không mất vector của người khác).
// Người hỏi gần nhất (còn giữ tệp) chịu chi phí phần embed tiếp theo, trong hạn mức embed mỗi ngày của họ: người hỏi trước hết hạn mức, đã bỏ tệp
// hay bị xóa tài khoản thì tệp vẫn được embed khi người khác hỏi, và không ai trả tiền thay cho các lượt hỏi của người khác.
const FILE_CHARS = 4000;
const owns = (uid: string, id: string) => !!db().prepare("SELECT 1 FROM file_owners WHERE file_id = ? AND user_id = ?").get(id, uid);
const fileUser: Map<string, string> = ((globalThis as { __vecFileUser?: Map<string, string> }).__vecFileUser ??= new Map());
const textOf = (rec: Stored) => rec.blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join("\n\n");
// Bảng tính: chia đoạn kiểu lặp lại dòng tiêu đề; các loại khác theo đoạn văn. Hai nơi dùng chung (nhúng vector và dựng ngữ cảnh) phải chia GIỐNG nhau để chỉ số đoạn khớp vector.
const chunksOf = (rec: Stored) => (rec.kind === "xlsx" || rec.kind === "csv") ? chunkSheet(textOf(rec)) : chunkForRag(textOf(rec));
registerVecSource("file", {
  maxChars: FILE_CHARS,
  shared: true,
  userOf: (id) => { const u = fileUser.get(id); return u && owns(u, id) ? u : null; },
  alive: (id, items) => (db().prepare("SELECT 1 FROM file_owners WHERE file_id = ? LIMIT 1").get(id) ? new Set(items) : new Set()),
  pending: async (id, model, limit) => {
    if (!safeId(id)) return [];
    let rec: Stored;
    try { rec = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")); } catch { return []; }
    // So mã băm từng đoạn chứ không chỉ vị trí: tệp được đọc lại (bộ đọc mới, cách chia đoạn mới) thì đoạn đổi chữ được embed lại,
    // đoạn thừa (tệp ngắn đi) bị xóa, để kết quả tìm theo nghĩa không trỏ nhầm đoạn.
    const d = db(), have = new Map((d.prepare("SELECT item, hash FROM vec_items WHERE scope = 'file' AND owner = ? AND model = ?").all(id, model) as { item: string; hash: string }[]).map((r) => [r.item, r.hash]));
    const chunks = chunksOf(rec);
    const extra = [...have.keys()].filter((k) => Number(k.slice(k.lastIndexOf("#") + 1)) >= chunks.length);
    for (const k of extra) d.prepare("DELETE FROM vec_items WHERE scope = 'file' AND item = ?").run(k);
    return chunks.map((text, i) => ({ item: `${id}#${i}`, text, srcAt: 0 })).filter((x) => have.get(x.item) !== vecHash(x.text, FILE_CHARS)).slice(0, limit);
  },
});
let fileSweptAt = 0;
onTick("file-vec-sweep", (now) => { if (now - fileSweptAt < 6 * 3_600_000) return; fileSweptAt = now; try { sweepVecs("file", "SELECT file_id FROM file_owners", "owner"); } catch { /* bảng chưa có */ } });
/** Chọn k đoạn liên quan nhất (theo thứ tự trong tệp): BM25, cộng tìm theo nghĩa khi tệp đã có vector. */
export async function pickChunks(id: string, uid: string, chunks: string[], query: string, k: number, budgetMs = 500): Promise<number[]> {
  if (!query.trim() || chunks.length <= k) return rank(chunks, query, k);
  if (fileUser.size > 2000 && !fileUser.has(id)) fileUser.delete(fileUser.keys().next().value!);
  fileUser.delete(id); fileUser.set(id, uid);
  const vq = await vecQuery("file", id, uid, query, 30, budgetMs).catch(() => null);
  queueEmbed("file", id);
  if (!vq) return rank(chunks, query, k);
  const min = minCos(vq.model);
  const fused = rrf([scored(chunks, query).slice(0, 30).map((x) => String(x.i)), vq.hits.filter((h) => h.cos >= min).map((h) => h.item.slice(h.item.lastIndexOf("#") + 1))]);
  const top = [...fused].sort((a, b) => b[1] - a[1]).map(([i]) => Number(i)).filter((i) => i < chunks.length).slice(0, k);
  for (let i = 0; top.length < k && i < chunks.length; i++) if (!top.includes(i)) top.push(i);
  return top.sort((a, b) => a - b);
}

// Ghép các file thành block cho messages[].content. Nội dung trích ra là DỮ LIỆU, bọc trong <file name="...">.
export async function buildContext(ids: string[], names: Record<string, string>, query: string, uid: string): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  // Hai tệp khác nội dung cùng tên trong một tin: tên thứ hai thành "x (2).pdf", để model, run_code (inputs/<tên>) và
  // browser_upload phân biệt được hai tệp thay vì tệp sau che mất tệp trước.
  const shown = new Map<string, string>();
  for (const id of ids) {
    if (!safeId(id) || !mayUse(uid, id)) continue;
    let rec: Stored;
    try { rec = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")); } catch { continue; }
    if (stale(rec)) rec = await refresh(rec, uid);
    const name = distinctName(names[id] ?? rec.name, (c) => shown.has(c) && shown.get(c) !== id);
    shown.set(name, id);
    const label = `[File: ${name}]`;
    if (rec.large) {
      // File lớn: chỉ đưa các đoạn liên quan nhất tới câu hỏi (RAG).
      const chunks = chunksOf(rec);
      const picked = (await pickChunks(id, uid, chunks, query, 12)).map((i) => `(đoạn ${i + 1}/${chunks.length})\n${chunks[i]}`);
      out.push({ type: "text", text: `${label}\n<file name="${name}" id="${id}" note="tệp lớn, chỉ hiện các đoạn liên quan nhất">\n${esc(picked.join("\n\n…\n\n"))}\n</file>` });
      continue;
    }
    for (const b of rec.blocks) {
      if (b.type === "text") out.push({ type: "text", text: `${label}\n<file name="${name}" id="${id}">\n${esc(b.text)}\n</file>` });
      // Thẻ <file> rỗng mang id: model nhìn ảnh đã thu nhỏ, còn run_code và browser_upload lấy đúng bản gốc (chatFiles).
      else if (b.type === "image") { out.push({ type: "text", text: `${label}\n<file name="${name}" id="${id}"></file>` }); out.push(b); }
      else out.push({ type: "text", text: `${label}\n<file name="${name}" id="${id}"></file>` }, { ...b, name });
    }
  }
  return out;
}

/**
 * Tệp đính kèm ở các lượt trước ({ type: "file_ref", id, name } trong lịch sử): dựng lại nội dung để model trả lời lượt sau, kể cả
 * model khác vừa được chế độ Tự động chọn, vẫn thấy đúng tài liệu đoạn chat đang bàn. Ảnh / PDF của 3 lượt có tệp gần nhất gửi nguyên
 * dạng (tối đa ~20 MB); cũ hơn thì giữ phần chữ (ảnh thành dòng ghi chú) để ngữ cảnh không phình mãi.
 */
type Ref = { type?: string; id?: unknown; name?: unknown };
export async function expandFileRefs(messages: unknown, query: string, uid: string): Promise<unknown> {
  if (!Array.isArray(messages)) return messages;
  const at = messages.flatMap((m, i) => (m?.role === "user" && Array.isArray(m.content) && (m.content as Ref[]).some((b) => b?.type === "file_ref") ? [i] : []));
  if (!at.length) return messages;
  const recent = new Set(at.slice(-3));
  let budget = 20 * 1048576;
  const out = [...messages];
  for (const i of [...at].reverse()) {
    const m = messages[i] as { content: Ref[] };
    const blocks: unknown[] = [];
    // Cùng lý do như buildContext: hai tệp khác nhau cùng tên trong một tin không được mang chung một tên.
    const shown = new Map<string, string>();
    for (const b of m.content) {
      if (b?.type !== "file_ref") { blocks.push(b); continue; }
      const id = typeof b.id === "string" ? b.id : "";
      const name = distinctName(String(b.name ?? "tệp").slice(0, 200), (c) => shown.has(c) && shown.get(c) !== id);
      shown.set(name, id);
      const got = id ? await buildContext([id], { [id]: name }, query, uid) : [];
      if (!got.length) { blocks.push({ type: "text", text: `[Tệp đã gửi ở lượt trước: ${name} (không còn trên máy chủ)]` }); continue; }
      for (const x of got) {
        const heavy = x.type === "image" || x.type === "document" ? x.data.length : 0;
        if (heavy && recent.has(i) && heavy <= budget) { budget -= heavy; blocks.push(x); continue; }
        // Giữ id của tệp (như buildContext) để Synchro vẫn tải được đúng tệp gốc lên trang web (browser_upload).
        if (x.type === "image") { blocks.push({ type: "text", text: `[Ảnh đã gửi ở lượt trước: ${name}]` }, { type: "text", text: `<file name="${name}" id="${id}"></file>` }); continue; }
        blocks.push(x.type === "document" ? { type: "text", text: `<file name="${name}" id="${id}">\n${x.fallbackText ?? ""}\n</file>` } : x);
      }
    }
    out[i] = { ...(messages[i] as object), content: blocks };
  }
  return out;
}
