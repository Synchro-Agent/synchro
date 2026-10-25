// Chép lời tệp ghi âm (chỉ chạy ở máy chủ): ElevenLabs Scribe (tách người nói) nếu quản trị viên đã nhập khóa ElevenLabs,
// không thì OpenAI Whisper. Trả về văn bản, mỗi lượt nói một dòng "Người nói N: …" khi có tách người nói.
import { db } from "./authstore";
import { openSecret as unseal, serviceKey } from "./providers";

export class SttError extends Error { constructor(m: string, public status = 400) { super(m); } }
export const STT_MAX = 100 * 1024 * 1024;

type Word = { text: string; type?: string; speaker_id?: string };
// Các từ của Scribe → đoạn theo người nói.
function bySpeaker(words: Word[]): string {
  const lines: string[] = [];
  let cur = "", sp = "";
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const s = w.speaker_id ?? "";
    if (s !== sp && cur.trim()) { lines.push(`${sp ? `Người nói ${Number(sp.replace(/\D/g, "")) + 1}: ` : ""}${cur.trim()}`); cur = ""; }
    sp = s; cur += w.text;
  }
  if (cur.trim()) lines.push(`${sp ? `Người nói ${Number(sp.replace(/\D/g, "")) + 1}: ` : ""}${cur.trim()}`);
  return lines.join("\n");
}

// Khóa OpenAI quản trị viên đã nhập ở Cài đặt → API (nếu có).
function openaiKey(): { key: string; base: string } | null {
  let r: { enc_key: string; base_url: string | null } | undefined;
  try { r = db().prepare("SELECT enc_key, base_url FROM api_providers WHERE kind = 'openai' LIMIT 1").get() as typeof r; } catch { return null; }
  if (!r) return null;
  try { return { key: unseal(r.enc_key), base: (r.base_url || "https://api.openai.com/v1").replace(/\/+$/, "") }; } catch { return null; }
}

export function sttAvailable() { return !!serviceKey("elevenlabs") || !!openaiKey(); }

export async function transcribe(buf: Buffer, name: string, mime: string): Promise<{ text: string; engine: string }> {
  if (buf.length > STT_MAX) throw new SttError("Tệp ghi âm quá lớn (tối đa 100 MB).");
  const file = new Blob([new Uint8Array(buf)], { type: mime || "audio/mpeg" });
  const el = serviceKey("elevenlabs");
  if (el) {
    const fd = new FormData();
    fd.append("model_id", "scribe_v1"); fd.append("diarize", "true"); fd.append("tag_audio_events", "false"); fd.append("file", file, name);
    const r = await fetch(`${el.base}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": el.key }, body: fd, signal: AbortSignal.timeout(15 * 60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new SttError(`ElevenLabs không chép lời được (${r.status}): ${String(j?.detail?.message ?? j?.detail ?? "").slice(0, 200)}`, 502);
    return { text: Array.isArray(j.words) && j.words.some((w: Word) => w.speaker_id) ? bySpeaker(j.words) : String(j.text ?? ""), engine: "ElevenLabs Scribe" };
  }
  const oa = openaiKey();
  if (oa) {
    if (buf.length > 25 * 1024 * 1024) throw new SttError("OpenAI chỉ nhận tệp ghi âm tối đa 25 MB. Hãy cắt nhỏ tệp hoặc nhập khóa ElevenLabs.");
    const fd = new FormData();
    fd.append("model", "whisper-1"); fd.append("file", file, name);
    const r = await fetch(`${oa.base}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${oa.key}` }, body: fd, signal: AbortSignal.timeout(15 * 60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new SttError(`OpenAI không chép lời được (${r.status}): ${String(j?.error?.message ?? "").slice(0, 200)}`, 502);
    return { text: String(j.text ?? ""), engine: "OpenAI Whisper" };
  }
  throw new SttError("Synchro chưa có dịch vụ chép lời. Quản trị viên cần nhập khóa ElevenLabs hoặc OpenAI ở Cài đặt → API; trong lúc chờ, bạn dán nội dung ghi chép vào.", 503);
}
