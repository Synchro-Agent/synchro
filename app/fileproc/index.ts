import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ContentBlock, FileError, LARGE_TOKENS, MAX_FILE_BYTES, estTokens } from "./types";
import { detectKind } from "./detect";
import { pickExtractor } from "./extractors";
import { chunkForRag, rank } from "./rag";
import { checkQuota, claimFile, mayUse } from "./owners";

const DIR = path.join(process.cwd(), ".cache", "files");

/** raw: tệp không đọc được nội dung (nhị phân lạ, hỏng) nhưng vẫn giữ tệp gốc cho Synchro Code; err là lý do để báo khi khung chat đòi đọc nội dung. */
export type Stored = { id: string; name: string; kind: string; tokens: number; large: boolean; blocks: ContentBlock[]; raw?: boolean; err?: string; note?: string; v?: number };
// Bản cách đọc: kết quả trích được lưu mãi theo nội dung tệp, nên sửa bộ đọc bảng tính thì tệp đã tải lên vẫn mang bản cũ sai (mất cột, ngày thành số). Tăng số này là các tệp đó được đọc lại khi dùng tới.
const EXTRACT_V = 2;
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

// Hàm duy nhất: process_file(file) -> ContentBlock[]
// File gốc lưu ở .cache/files/<id>.bin, kết quả trích lưu ở <id>.json để khỏi trích lại.
// raw (Synchro Code): nhận mọi loại tệp; tệp không trích được nội dung vẫn được lưu kèm một dòng ghi chú cho model.
export async function processFile(buf: Buffer, name: string, uid: string, o: { raw?: boolean } = {}): Promise<Stored> {
  if (buf.length === 0 && !o.raw) throw new FileError(`"${name}" là tệp rỗng.`);
  if (buf.length > MAX_FILE_BYTES) throw new FileError(`"${name}" vượt quá giới hạn ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  checkQuota(uid, buf.length);
  const id = createHash("sha1").update(buf).digest("hex");
  await mkdir(DIR, { recursive: true });
  try {
    let hit = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")) as Stored;
    if (stale(hit)) hit = await refresh(hit, uid);
    if (hit.raw && !o.raw) throw new FileError(hit.err ?? `Không trích được nội dung từ "${name}".`);
    // Có đúng nội dung tệp trong tay nên được là chủ, không lộ gì thêm.
    claimFile(uid, id, buf.length, name);
    return { ...hit, name };
  } catch (e) { if (e instanceof FileError) throw e; /* chưa có cache */ }
  let kind = "binary", blocks: ContentBlock[] = [];
  try {
    kind = await detectKind(buf, name);
    blocks = await pickExtractor(kind, name).run(buf, { name, kind, uid });
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

// Ghép các file thành block cho messages[].content. Nội dung trích ra là DỮ LIỆU, bọc trong <file name="...">.
export async function buildContext(ids: string[], names: Record<string, string>, query: string, uid: string): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  for (const id of ids) {
    if (!safeId(id) || !mayUse(uid, id)) continue;
    let rec: Stored;
    try { rec = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")); } catch { continue; }
    if (stale(rec)) rec = await refresh(rec, uid);
    const name = names[id] ?? rec.name;
    const label = `[File: ${name}]`;
    if (rec.large) {
      // File lớn: chỉ đưa các đoạn liên quan nhất tới câu hỏi (RAG).
      const text = rec.blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join("\n\n");
      const chunks = chunkForRag(text);
      const picked = rank(chunks, query, 12).map((i) => `(đoạn ${i + 1}/${chunks.length})\n${chunks[i]}`);
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
    for (const b of m.content) {
      if (b?.type !== "file_ref") { blocks.push(b); continue; }
      const id = typeof b.id === "string" ? b.id : "", name = String(b.name ?? "tệp").slice(0, 200);
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
