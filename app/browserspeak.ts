// Đọc bằng giọng có sẵn của trình duyệt: đường đi của người chưa có khóa ElevenLabs, và phần còn lại khi giọng AI dừng giữa chừng.
// Dùng chung cho Đọc to, trò chuyện bằng giọng nói và mục Speech. Xong hay lỗi đều báo đúng một lần, không để nơi gọi kẹt ở trạng thái đang đọc.

type Reading = { over: boolean; guard: ReturnType<typeof setTimeout> | undefined };
let cur: Reading | null = null, warned = false;
// Có máy không có giọng nào và trình duyệt không báo gì cả: quá lâu chưa bắt đầu đọc thì coi như lỗi.
export const START_GUARD = 6000;

/** Giọng của máy cho đúng ngôn ngữ. missing: máy có giọng nhưng không có giọng tiếng này (danh sách rỗng là trình duyệt chưa nạp xong, chưa kết luận được). */
export function voiceFor<T extends { lang: string }>(voices: T[], lang: string): { voice?: T; missing: boolean } {
  const want = lang.toLowerCase().replace("_", "-"), base = want.split("-")[0];
  const norm = (v: T) => v.lang.toLowerCase().replace("_", "-");
  const voice = voices.find((v) => norm(v) === want) ?? voices.find((v) => norm(v).split("-")[0] === base);
  return { voice, missing: voices.length > 0 && !voice };
}

export function stopBrowserRead() {
  if (cur) { cur.over = true; clearTimeout(cur.guard); cur = null; }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Đọc lần lượt các đoạn. onEnd: đọc hết. onFail: không đọc được, kèm câu báo. onNote: đọc được nhưng máy thiếu giọng tiếng này (báo một lần mỗi phiên). */
export function readBrowser(chunks: string[], o: { lang: string; rate?: number; onStart?: (c: string) => void; onEnd: () => void; onFail: (msg: string) => void; onNote?: (msg: string) => void }) {
  stopBrowserRead();
  const s = window.speechSynthesis;
  if (!chunks.length) return o.onEnd();
  if (!s) return o.onFail("Trình duyệt không hỗ trợ đọc to");
  const { voice, missing } = voiceFor(s.getVoices?.() ?? [], o.lang);
  if (missing && !warned) { warned = true; o.onNote?.("Máy này chưa có giọng đọc cho ngôn ngữ này nên có thể đọc không rõ. Thêm giọng trong cài đặt của máy"); }
  const me: Reading = { over: false, guard: undefined };
  cur = me;
  const done = (fn: () => void) => { if (me.over) return; me.over = true; clearTimeout(me.guard); if (cur === me) cur = null; fn(); };
  const fail = () => { s.cancel(); done(() => o.onFail("Trình duyệt chưa đọc được đoạn này. Hãy kiểm tra giọng đọc của máy")); };
  me.guard = setTimeout(fail, START_GUARD);
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = o.lang; u.rate = o.rate ?? 1;
    if (voice) u.voice = voice as unknown as SpeechSynthesisVoice;
    u.onstart = () => { if (me.over) return; clearTimeout(me.guard); o.onStart?.(c); };
    if (i === chunks.length - 1) u.onend = () => done(o.onEnd);
    // Bị hủy do người dùng dừng hoặc câu mới chen vào: không phải lỗi.
    u.onerror = (e) => { if (e.error === "canceled" || e.error === "interrupted") { clearTimeout(me.guard); return; } fail(); };
    s.speak(u);
  });
}
