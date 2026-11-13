// Văn bản kết quả chạy code gửi cho model (hàm thuần). Việc dựng video, tính lại Excel in rất nhiều dòng: lỗi thật nằm ở cuối log, còn tệp, preview,
// excel_recalc là thứ model dựa vào để biết đã giao gì. Cắt giữ phần đầu trước đây làm mất lỗi vĩnh viễn; tóm tắt 30 dòng đầu làm mất các thẻ trạng thái.

// Giữ khớp với clipSink trong workspace/safefs.mjs.
export const CLIP_HEAD = 10_000, CLIP_TAIL = 30_000;
const mark = (n: number) => `\n[Đã bỏ ${n >= 2048 ? `${Math.round(n / 1024)} KB` : `${n} ký tự`} ở giữa]\n`;

/** Dài quá limit thì giữ phần đầu và phần cuối, ghi rõ đã bỏ bao nhiêu. */
export const clipOut = (t: string, limit: number, head = CLIP_HEAD, tail = CLIP_TAIL) => {
  if (t.length <= limit || t.length <= head + tail) return t;
  return t.slice(0, head) + mark(t.length - head - tail) + t.slice(-tail);
};

/** Thanh tiến trình ghi đè bằng \r (ffmpeg -stats, tqdm, curl) chỉ còn trạng thái cuối của mỗi dòng: cả nghìn lần cập nhật không còn đẩy mất log thật. */
export const tidyLog = (t: string) => {
  if (!t.includes("\r")) return t;
  return t.split("\n").map((l) => { const s = l.endsWith("\r") ? l.slice(0, -1) : l, i = s.lastIndexOf("\r"); return i < 0 ? s : s.slice(i + 1); }).join("\n");
};

/** Bộ gom một luồng: giữ head byte đầu và tail byte cuối, không tốn bộ nhớ theo độ dài log. */
export function clipSink(head = CLIP_HEAD, tail = CLIP_TAIL) {
  const first: Buffer[] = [], last: Buffer[] = [];
  let nFirst = 0, nLast = 0, dropped = 0;
  return {
    push(c: Buffer) {
      if (nFirst < head) { const a = c.subarray(0, head - nFirst); first.push(a); nFirst += a.length; c = c.subarray(a.length); }
      if (!c.length) return;
      last.push(c); nLast += c.length;
      while (last.length > 1 && nLast - last[0].length >= tail) { nLast -= last[0].length; dropped += last[0].length; last.shift(); }
    },
    text() {
      const end = Buffer.concat(last), over = Math.max(0, end.length - tail), gone = dropped + over;
      return Buffer.concat(first).toString("utf8") + (gone ? mark(gone) : "") + end.subarray(over).toString("utf8");
    },
  };
}

const ends = (t: string, head: number, tail: number) => (t.length <= head + tail ? t : t.slice(0, head) + mark(t.length - head - tail) + t.slice(-tail));

/**
 * content: nguyên văn, thẻ trạng thái đứng trước log. brief: bản thay thế khi kết quả quá dài phải lưu theo tham chiếu (refs.ts): giữ đủ thẻ trạng thái
 * (đây là điều model được phép khẳng định) và cuối stderr, nơi có lỗi thật.
 */
export function runBlocks(o: { open: string; close: string; tags: string; stdout: string; stderr: string; after?: string }) {
  const log = (out: string, err: string) => `${o.open}${o.tags}\n<stdout>\n${out}\n</stdout>\n<stderr>\n${err}\n</stderr>\n${o.close}${o.after ?? ""}`;
  return { content: log(o.stdout, o.stderr), brief: log(ends(o.stdout, 600, 900), ends(o.stderr, 0, 1500)) };
}

/** Tóm tắt một dòng cho nhật ký làm việc: người dùng đọc, không phải đọc thẻ nội bộ. */
export const plainSummary = (t: string) => t.replace(/<\/?[a-z_]+(?:\s[^<>]*)?>/gi, " ").replace(/\s+/g, " ").trim();
/**
 * Đoạn trích chữ thường của một tin nhắn (⌘K, xem trước): bỏ khối <artifact …>…</artifact> (cả khối chưa đóng khi đang viết), khối mã ```,
 * thẻ công cụ / thẻ nội bộ (plainSummary) và ký hiệu Markdown, để không lộ "<artifact identifier" trong kết quả tìm kiếm (LIVE-9).
 */
export const plainSnippet = (t: string) => plainSummary(String(t ?? "")
  .replace(/<artifact\b[\s\S]*?(?:<\/artifact>|$)/gi, " ")
  .replace(/```[\s\S]*?(?:```|$)/g, " "))
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim();
