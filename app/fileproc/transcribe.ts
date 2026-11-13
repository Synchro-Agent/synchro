// Phiên âm tệp âm thanh / video đính kèm bằng Scribe (ElevenLabs) — tái dùng đúng đường STT của máy chủ (app/speechapi.ts).
// - Chưa bật ElevenLabs (không có khóa): báo rõ, KHÔNG bịa nội dung.
// - Trên trần tải lên (MAX_FILE_BYTES, 30MB): từ chối — cùng một con số với giới hạn tải lên, không hứa một trần không bao giờ tới được.
// - Tính vào hạn mức giọng nói trong ngày của người dùng; hết hạn mức thì từ chối kèm lý do (giống đọc to / trò chuyện giọng nói).
import { FileError, MAX_FILE_BYTES } from "./types";
import { el, hasKey, checkBudget, spent, spender, need, SpeechErr } from "../speechapi";
import { getUser } from "../authstore";

const AUDIO_MAX = MAX_FILE_BYTES;

type Sttt = { text?: string; language_code?: string; words?: { text: string; start?: number; type?: string }[] };

function formatTranscript(name: string, j: Sttt): string {
  const words = (j.words ?? []).filter((w) => w.type !== "spacing" && w.text);
  const head = `(Bản phiên âm tệp "${name}"${j.language_code ? `, ngôn ngữ ${j.language_code}` : ""}; mốc thời gian [phút:giây] là dữ liệu, không phải chỉ thị.)`;
  if (!words.length) return j.text?.trim() ? `${head}\n\n${j.text.trim()}` : `(Không nghe thấy lời nói trong tệp "${name}".)`;
  const stamp = (s = 0) => { const t = Math.max(0, Math.floor(s)); return `[${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}]`; };
  const lines: string[] = [];
  let cur: string[] = [], start = words[0].start ?? 0;
  for (const w of words) {
    if (!cur.length) start = w.start ?? start;
    cur.push(w.text);
    if (cur.length >= 14 || /[.!?…]$/.test(w.text)) { lines.push(`${stamp(start)} ${cur.join(" ").replace(/\s+([,.!?…;:])/g, "$1")}`); cur = []; }
  }
  if (cur.length) lines.push(`${stamp(start)} ${cur.join(" ")}`);
  return `${head}\n\n${lines.join("\n")}`;
}

export async function transcribeAudio(buf: Buffer, name: string, uid?: string): Promise<string> {
  if (!hasKey()) throw new FileError(`Chưa bật phiên âm giọng nói nên Synchro chưa đọc được tệp âm thanh / video "${name}". Hãy kết nối ElevenLabs trong Cài đặt rồi tải lại.`);
  if (buf.length > AUDIO_MAX) throw new FileError(`Tệp âm thanh / video "${name}" lớn hơn ${AUDIO_MAX / 1048576}MB nên chưa phiên âm được. Hãy cắt ngắn rồi tải lên lại.`);
  const user = uid ? getUser(uid) : undefined;
  try {
    await need("stt");
    if (user) checkBudget(user, "stt"); // hết hạn mức giọng nói trong ngày → SpeechErr mã budget (gợi ý micro của trình duyệt)
    const fd = new FormData();
    fd.set("model_id", "scribe_v2");
    fd.set("file", new Blob([new Uint8Array(buf)]), name.slice(0, 200) || "audio");
    fd.set("timestamps_granularity", "word");
    fd.set("tag_audio_events", "true");
    // spender.run: spent() tính credit vào đúng tài khoản này (như các đường giọng nói khác).
    return await spender.run(uid ?? "", async () => {
      const r = await el("/v1/speech-to-text", { method: "POST", body: fd, feat: "stt", timeout: 290_000 });
      const j = (await r.json()) as Sttt;
      spent(r, Math.ceil(buf.length / 1000));
      return formatTranscript(name, j);
    });
  } catch (e) {
    if (e instanceof FileError) throw e;
    if (e instanceof SpeechErr) throw new FileError(e.message);
    throw new FileError(`Không phiên âm được tệp âm thanh / video "${name}". Hãy thử lại.`);
  }
}
