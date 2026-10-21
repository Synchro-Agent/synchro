import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ContentBlock, FileError, LARGE_TOKENS, MAX_FILE_BYTES, estTokens } from "./types";
import { detectKind } from "./detect";
import { pickExtractor } from "./extractors";
import { chunkForRag, rank } from "./rag";

const DIR = path.join(process.cwd(), ".cache", "files");

export type Stored = { id: string; name: string; kind: string; tokens: number; large: boolean; blocks: ContentBlock[] };

const safeId = (id: string) => /^[a-f0-9]{40}$/.test(id);

// Hàm duy nhất: process_file(file) -> ContentBlock[]
// File gốc lưu ở .cache/files/<id>.bin, kết quả trích lưu ở <id>.json để khỏi trích lại.
export async function processFile(buf: Buffer, name: string): Promise<Stored> {
  if (buf.length === 0) throw new FileError(`"${name}" là tệp rỗng.`);
  if (buf.length > MAX_FILE_BYTES) throw new FileError(`"${name}" vượt quá giới hạn ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  const id = createHash("sha1").update(buf).digest("hex");
  await mkdir(DIR, { recursive: true });
  try { const hit = JSON.parse(await readFile(path.join(DIR, id + ".json"), "utf8")) as Stored; return { ...hit, name }; } catch { /* chưa có cache */ }
  const kind = await detectKind(buf, name);
  const blocks = await pickExtractor(kind, name).run(buf, { name, kind });
  const textLen = blocks.reduce((a, b) => a + (b.type === "text" ? b.text.length : b.type === "document" ? (b.fallbackText?.length ?? 0) : 0), 0);
  if (!blocks.length || (kind !== "application/pdf" && !kind.startsWith("image/") && textLen === 0)) throw new FileError(`Không trích được nội dung từ "${name}".`);
  const tokens = estTokens(blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).join(""));
  const rec: Stored = { id, name, kind, tokens, large: tokens > LARGE_TOKENS, blocks };
  await writeFile(path.join(DIR, id + ".bin"), buf);
  await writeFile(path.join(DIR, id + ".json"), JSON.stringify(rec));
  return rec;
}

const esc = (s: string) => s.replace(/<\/file>/gi, "<\\/file>");

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
