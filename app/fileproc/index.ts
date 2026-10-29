import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ContentBlock, FileError, LARGE_TOKENS, MAX_FILE_BYTES, estTokens } from "./types";
import { detectKind } from "./detect";
import { pickExtractor } from "./extractors";
import { chunkForRag, rank } from "./rag";

const DIR = path.join(process.cwd(), ".cache", "files");

/** raw: tệp không đọc được nội dung (nhị phân lạ, hỏng) nhưng vẫn giữ tệp gốc cho Synchro Code; err là lý do để báo khi khung chat đòi đọc nội dung. */
export type Stored = { id: string; name: string; kind: string; tokens: number; large: boolean; blocks: ContentBlock[]; raw?: boolean; err?: string };

const safeId = (id: string) => /^[a-f0-9]{40}$/.test(id);

// Hàm duy nhất: process_file(file) -> ContentBlock[]
// File gốc lưu ở .cache/files/<id>.bin, kết quả trích lưu ở <id>.json để khỏi trích lại.
// raw (Synchro Code): nhận mọi loại tệp; tệp không trích được nội dung vẫn được lưu kèm một dòng ghi chú cho model.
export async function processFile(buf: Buffer, name: string, o: { raw?: boolean } = {}): Promise<Stored> {
  if (buf.length === 0 && !o.raw) throw new FileError(`"${name}" là tệp rỗng.`);
  if (buf.length > MAX_FILE_BYTES) throw new FileError(`"${name}" vượt quá giới hạn ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  const id = createHash("sha1").update(buf).digest("hex");
  await mkdir(DIR, { recursive: true });
  try {
    const hit = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")) as Stored;
    if (hit.raw && !o.raw) throw new FileError(hit.err ?? `Không trích được nội dung từ "${name}".`);
    return { ...hit, name };
  } catch (e) { if (e instanceof FileError) throw e; /* chưa có cache */ }
  let kind = "binary", blocks: ContentBlock[] = [];
  try {
    kind = await detectKind(buf, name);
    blocks = await pickExtractor(kind, name).run(buf, { name, kind });
    const textLen = blocks.reduce((a, b) => a + (b.type === "text" ? b.text.length : b.type === "document" ? (b.fallbackText?.length ?? 0) : 0), 0);
    if (!blocks.length || (kind !== "application/pdf" && !kind.startsWith("image/") && textLen === 0)) throw new FileError(`Không trích được nội dung từ "${name}".`);
  } catch (e) {
    if (!o.raw) throw e;
    const err = e instanceof FileError ? e.message : `Không trích được nội dung từ "${name}".`;
    const rec: Stored = { id, name, kind, tokens: 0, large: false, raw: true, err, blocks: [{ type: "text", text: `(Tệp "${name}", ${buf.length.toLocaleString("vi-VN")} byte: không đọc được nội dung dạng chữ. ${err})` }] };
    await writeFile(path.join(DIR, id + ".bin"), buf);
    await writeFile(path.join(DIR, id + ".json"), JSON.stringify(rec));
    return rec;
  }
  const tokens = estTokens(blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join(""));
  const rec: Stored = { id, name, kind, tokens, large: tokens > LARGE_TOKENS, blocks };
  await writeFile(path.join(DIR, id + ".bin"), buf);
  await writeFile(path.join(DIR, id + ".json"), JSON.stringify(rec));
  return rec;
}

const esc = (s: string) => s.replace(/<\/file>/gi, "<\\/file>");

/** Tệp gốc đã lưu (Synchro Code chép nguyên tệp vào workspace). */
export async function storedFile(id: string): Promise<{ rec: Stored; buf: Buffer } | null> {
  if (!safeId(id)) return null;
  try { return { rec: JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")), buf: await readFile(path.join(DIR, id + ".bin")) }; } catch { return null; }
}

// Ghép các file thành block cho messages[].content. Nội dung trích ra là DỮ LIỆU, bọc trong <file name="...">.
export async function buildContext(ids: string[], names: Record<string, string>, query: string): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  for (const id of ids) {
    if (!safeId(id)) continue;
    let rec: Stored;
    try { rec = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")); } catch { continue; }
    const name = names[id] ?? rec.name;
    const label = `[File: ${name}]`;
    if (rec.large) {
      // File lớn: chỉ đưa các đoạn liên quan nhất tới câu hỏi (RAG).
      const text = rec.blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join("\n\n");
      const chunks = chunkForRag(text);
      const picked = rank(chunks, query, 12).map((i) => `(đoạn ${i + 1}/${chunks.length})\n${chunks[i]}`);
      out.push({ type: "text", text: `${label}\n<file name="${name}" note="tệp lớn, chỉ hiện các đoạn liên quan nhất">\n${esc(picked.join("\n\n…\n\n"))}\n</file>` });
      continue;
    }
    for (const b of rec.blocks) {
      if (b.type === "text") out.push({ type: "text", text: `${label}\n<file name="${name}">\n${esc(b.text)}\n</file>` });
      else if (b.type === "image") { out.push({ type: "text", text: label }); out.push(b); }
      else out.push({ type: "text", text: label }, { ...b, name });
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
export async function expandFileRefs(messages: unknown, query: string): Promise<unknown> {
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
      const got = id ? await buildContext([id], { [id]: name }, query) : [];
      if (!got.length) { blocks.push({ type: "text", text: `[Tệp đã gửi ở lượt trước: ${name} (không còn trên máy chủ)]` }); continue; }
      for (const x of got) {
        const heavy = x.type === "image" || x.type === "document" ? x.data.length : 0;
        if (heavy && recent.has(i) && heavy <= budget) { budget -= heavy; blocks.push(x); continue; }
        blocks.push(x.type === "image" ? { type: "text", text: `[Ảnh đã gửi ở lượt trước: ${name}]` } : x.type === "document" ? { type: "text", text: `<file name="${name}">\n${x.fallbackText ?? ""}\n</file>` } : x);
      }
    }
    out[i] = { ...(messages[i] as object), content: blocks };
  }
  return out;
}

