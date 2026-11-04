// Chống zip bomb: đọc tệp nén bằng luồng và đếm số byte giải nén THẬT (kích thước khai trong tệp có thể là giả), vượt ngưỡng thì dừng ngay, không giữ gì trong bộ nhớ.
// Dùng chung cho tiến trình đọc tệp (scripts/extract-worker.mjs) và các chỗ nhận gói skill trong máy chủ web. JSZip.loadAsync chỉ đọc danh sách tệp, chưa giải nén.
export class ZipTooBig extends Error {}

export const ZIP_MAX_BYTES = 200 * 1048576;
export const ZIP_MAX_ENTRIES = 20_000;
// Gói skill / repo tải lên: nhiều tệp hơn tài liệu văn phòng, nhưng vẫn có trần để một tệp 40 MB không giải nén thành vài GB.
export const SKILL_ZIP_MAX = 400 * 1048576;

const files = (zip) => Object.values(zip.files).filter((f) => !f.dir);

/** Đọc một tệp trong zip, dừng khi đủ cap byte (trả phần đã đọc, cut = true) hoặc khi vượt budget.left (ném ZipTooBig). cap âm: chỉ đếm. */
export function readCapped(f, cap, budget = { left: Infinity }) {
  return new Promise((ok, no) => {
    const chunks = [];
    let n = 0, done = false;
    const s = f.internalStream("uint8array");
    const stop = (fn) => { if (done) return; done = true; s.pause(); fn(); };
    s.on("data", (c) => {
      if (done) return;
      budget.left -= c.length;
      if (budget.left < 0) return stop(() => no(new ZipTooBig("zip")));
      if (cap < 0) return; // chỉ đếm, không giữ gì
      const keep = Math.min(c.length, cap - n);
      if (keep > 0) { chunks.push(Buffer.from(c.buffer, c.byteOffset, keep)); n += keep; }
      if (n >= cap) stop(() => ok({ data: Buffer.concat(chunks), cut: true }));
    });
    s.on("error", (e) => stop(() => no(e)));
    s.on("end", () => stop(() => ok({ data: Buffer.concat(chunks), cut: false })));
    s.resume();
  });
}

/** Tổng kích thước tệp khai trong zip (có thể giả): dùng để từ chối sớm khi đã quá ngưỡng, không thay cho measureZip. */
export const declaredSize = (zip) => files(zip).reduce((a, f) => a + (Number(f._data?.uncompressedSize) || 0), 0);

/** Giải nén thử toàn bộ, không giữ dữ liệu: vượt max byte hoặc quá nhiều tệp thì ném ZipTooBig. Trả về tổng byte thật. */
export async function measureZip(zip, max = ZIP_MAX_BYTES, maxEntries = max > ZIP_MAX_BYTES ? 200_000 : ZIP_MAX_ENTRIES) {
  const list = files(zip);
  if (list.length > maxEntries || declaredSize(zip) > max) throw new ZipTooBig("zip");
  const budget = { left: max };
  for (const f of list) await readCapped(f, -1, budget);
  return max - budget.left;
}
