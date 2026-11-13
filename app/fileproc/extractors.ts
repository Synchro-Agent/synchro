import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp, { type Metadata } from "sharp";
import jschardet from "jschardet";
import { parseInWorker, withParseSlot, withConvertSlot, lowPriority, parserEnv } from "./sandbox";
import { sniffUtf16, utf16LooksText } from "./detect";
import { transcribeAudio } from "./transcribe";
import { type ContentBlock, type Extractor, FileError, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE } from "./types";

const run = promisify(execFile);
// Trần số điểm ảnh của một tấm ảnh: chặn "bom giải nén ảnh" (ảnh 20000×20000 = 400 triệu điểm ngốn hàng GB bộ nhớ khi giải nén).
const IMAGE_MAX_PIXELS = 40_000_000;
const PDF_NATIVE = process.env.LLM_PDF_NATIVE ? process.env.LLM_PDF_NATIVE === "1" : (process.env.LLM_PROVIDER ?? "anthropic") === "anthropic";
const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 20);
// Chữ lấy nhiều trang hơn ảnh rất nhiều: rẻ, và tệp dài thì tìm đoạn liên quan (RAG). Từng chỉ lấy 20 trang đầu của mọi tệp.
const PDF_TEXT_PAGES = Math.max(PDF_MAX_PAGES, Number(process.env.PDF_TEXT_PAGES ?? 600));
// Giới hạn số trang một tệp PDF gửi thẳng cho Claude (theo tài liệu API của hãng); chưa thử được trên CLI thật.
const PDF_NATIVE_PAGES = Number(process.env.PDF_NATIVE_PAGES ?? 100);

// Giải mã văn bản, tự phát hiện encoding (mặc định UTF-8).
// Nguyên tắc: KHÔNG làm hỏng văn bản mà bản gốc (tin thẳng jschardet) đã đọc đúng. Mỗi bước mới chỉ chen vào khi có bằng chứng mạnh.
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf).replace(/^\uFEFF/, "");
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf).replace(/^\uFEFF/, "");
  // UTF-16 không có dấu BOM (tỉ lệ byte 0 ở vị trí chẵn / lẻ), và giải ra phải là chữ thật: bảng số 16-bit nhị phân không bị đọc thành ký tự điều khiển.
  const u16 = sniffUtf16(buf);
  if (u16 && utf16LooksText(buf, u16)) return new TextDecoder(u16).decode(buf).replace(/^\uFEFF/, "");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, ""); } catch { /* không phải UTF-8 trọn vẹn */ }
  const det = normLabel(jschardet.detect(buf.toString("binary")).encoding || "");
  // Gần như UTF-8 (cụt ký tự cuối, lẫn một byte lạ): giải UTF-8 không fatal, chỉ byte hỏng thành U+FFFD, thay vì đọc cả tệp theo cp1252 ra "Tiáº¿ng".
  const u8 = looseUtf8(buf);
  // jschardet nói một bảng mã CJK nhiều byte và bảng đó giải trọn vẹn: tin nó (chuỗi GBK ngắn có thể tình cờ gần giống UTF-8), trừ khi
  // chỉ hỏng đúng ký tự cuối (tệp UTF-8 bị cắt).
  const cjk = MULTI_BYTE.test(det) && (() => { try { new TextDecoder(det, { fatal: true }).decode(buf); return true; } catch { return false; } })();
  if (u8.good >= 1 && (u8.tailOnly || (!cjk && u8.good >= 3 && u8.bad * 4 <= u8.good))) return u8.text;
  // Windows-1258 (tiếng Việt): jschardet nói cp1258 thì tin như bản gốc trừ khi có bằng chứng ngược; nhãn khác thì cần bằng chứng tích cực mạnh
  // (từ chức năng tiếng Việt + đa số từ là âm tiết tiếng Việt): jschardet hay đoán tiếng Việt ngắn thành Hy Lạp.
  if (looksVietnamese1258(buf, det === "windows-1258")) return new TextDecoder("windows-1258").decode(buf).normalize("NFC");
  // jschardet nói UTF-8 (bản gốc cũng giải UTF-8 không fatal ở đây).
  if ((det === "utf-8" || det === "ascii") && u8.good >= 1) return u8.text;
  // Còn lại như bản gốc: tin nhãn của jschardet (giải không fatal), trừ hai chỗ nó hay sai có bằng chứng rõ:
  // - Mã nhiều byte (Nhật/Trung/Hàn): giải ra phải phần lớn là ký tự hợp lệ.
  // - Mã chữ không phải Latinh (Nga, Hy Lạp, Do Thái, Thái): chữ phải thật sự viết bằng byte cao (cả từ liền nhau). jschardet hay gán tiếng Ý / Pháp ngắn
  //   ("Ciò detto, può andare", "Hélène a écrit à Jérôme") thành Windows-1253 / MacCyrillic.
  // - Mã Latinh một byte khác (Windows-1250 / 1254 / 1257, iso-8859-2/9/13/15…): tin như bản gốc.
  // - Không nhãn, nhãn Tây Âu, nhãn Windows-1258 bị bác (từ có byte riêng của 1258 phần lớn không phải tiếng Việt), nhãn Node không có: cp1252.
  if (det && !WESTERN.test(det) && !det.startsWith("utf") && det !== "windows-1258") {
    const s = decodeAs(det, buf);
    if (s !== null) {
      if (MULTI_BYTE.test(det)) { if (mostlyValid(s)) return s; }
      else if (NON_LATIN_1BYTE.test(det)) { if (looksNonLatin(buf)) return s; }
      else return s;
    }
  }
  return new TextDecoder("windows-1252").decode(buf);
}

const decodeAs = (enc: string, buf: Buffer): string | null => { try { return new TextDecoder(enc).decode(buf); } catch { return null; } }; // Node không có bảng mã này (MacLatin2, cp1006…)
/** Ký tự hỏng U+FFFD không quá 1/5 số ký tự ngoài ASCII. */
function mostlyValid(s: string): boolean {
  let good = 0, bad = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 0xfffd) bad++; else if (c >= 0x80) good++; }
  return good > 0 && bad * 4 <= good;
}

/** Giải UTF-8 không fatal và đếm: good = ký tự ngoài ASCII hợp lệ, bad = U+FFFD, tailOnly = mọi thứ hợp lệ trừ một chuỗi byte bị cắt ở cuối tệp
 * (ký tự cuối bị cụt khi cắt tệp / sao chép dở). cp1252 thật gần như không bao giờ tạo ra chuỗi UTF-8 hợp lệ ("Ã©"), nên giữa tệp cần ≥3 ký tự hợp lệ. */
function looseUtf8(buf: Buffer): { text: string; good: number; bad: number; tailOnly: boolean } {
  const text = new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "");
  let good = 0, bad = 0;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 0xfffd) bad++; else if (c >= 0x80) good++; }
  // Byte dẫn đầu chuỗi nhiều byte (0xC2–0xF4) nằm trong 3 byte cuối, phần trước nó là UTF-8 trọn vẹn và phần sau toàn byte nối tiếp.
  let tailOnly = false;
  for (let k = 1; k <= Math.min(3, buf.length) && !tailOnly; k++) {
    const lead = buf[buf.length - k];
    if (lead < 0xc2 || lead > 0xf4) continue;
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
    if (k >= need || !buf.subarray(buf.length - k + 1).every((c) => c >= 0x80 && c <= 0xbf)) continue;
    try { new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, buf.length - k)); tailOnly = true; } catch { /* hỏng cả ở giữa */ }
  }
  return { text, good, bad, tailOnly };
}

// Không có "utf": UTF-8 do looseUtf8 lo, UTF-16 do BOM / sniffUtf16 lo.
const MULTI_BYTE = /^(shift_jis|euc-|gb|big5|iso-2022|hz)/;
const NON_LATIN_1BYTE = /^(windows-(125[1356]|874)|koi8|iso-8859-([5678]|11)|maccyrillic|x-mac-cyrillic|ibm8(55|66)|tis-620)/;
const WESTERN = /^(ascii|windows-1252|iso-8859-1)$/;

/** Tên bảng mã của jschardet về dạng chuẩn để so khớp (và để TextDecoder nhận): "ISO8859-7" → "iso-8859-7", "CP1250" → "windows-1250",
 * "CP932" → "shift_jis", "CP949" → "euc-kr". "MacRoman" / "MacCyrillic" cố ý để nguyên (TextDecoder không nhận, ra cp1252 như bản gốc):
 * jschardet gán hai nhãn này cho tiếng Tây Ban Nha viết hoa ("EL NIÑO") hay tiếng Ý / Pháp ngắn, còn tệp Mac Roman / Mac Kirin thật thì hiếm. */
export const normLabel = (e: string) => e.toLowerCase()
  .replace(/^iso[-_]?8859[-_]?(\d+)$/, "iso-8859-$1").replace(/^cp-?(125\d|874)$/, "windows-$1")
  .replace(/^cp-?932$/, "shift_jis").replace(/^cp-?949$/, "euc-kr");

const isAsciiLetter = (c: number) => (c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a;
/** Các "từ" theo byte: dãy liền nhau gồm chữ ASCII và byte ≥0x80 (mã một byte: byte thứ i là ký tự thứ i). */
function byteWords(head: Buffer): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < head.length;) {
    if (!(head[i] >= 0x80 || isAsciiLetter(head[i]))) { i++; continue; }
    const s = i;
    while (i < head.length && (head[i] >= 0x80 || isAsciiLetter(head[i]))) i++;
    out.push([s, i]);
  }
  return out;
}

/** Chữ Kirin / Hy Lạp / Do Thái / Thái viết cả từ bằng byte cao: ≥30% từ có byte cao chứa ≥3 byte cao liền nhau hoặc toàn byte cao ("Да", "Ναι"),
 * hoặc mọi từ có byte cao là từ một chữ với ≥3 chữ khác nhau ("В и с к у").
 * Tiếng Tây Âu chỉ có chữ có dấu lác đác, gần như không bao giờ 3 chữ có dấu liền nhau ("Café crème", "può", "Jérôme" không phải tiếng Hy Lạp / Nga).
 * Không xét tỉ lệ byte cao trên cả tệp: tiếng Nga lẫn nhiều chữ ASCII (nhật ký, mã lỗi) vẫn là tiếng Nga. */
function looksNonLatin(buf: Buffer): boolean {
  const head = buf.subarray(0, 65_536);
  let hiWords = 0, runs = 0, singles = 0;
  const singleBytes = new Set<number>();
  for (const [s, e] of byteWords(head)) {
    let run = 0, best = 0;
    for (let i = s; i < e; i++) { run = head[i] >= 0x80 ? run + 1 : 0; best = Math.max(best, run); }
    if (best) hiWords++;
    if (best >= 3 || (best === e - s && best >= 2)) runs++;
    if (e - s === 1 && best === 1) { singles++; singleBytes.add(head[s]); }
  }
  if (runs > 0 && runs / hiWords >= 0.3) return true;
  // Toàn từ một chữ byte cao, ≥3 chữ khác nhau ("В и с к у"): tiếng Tây Âu chỉ có vài từ một chữ có dấu (à, è, é, ó) và luôn kèm từ dài có dấu.
  return hiWords >= 3 && singles === hiWords && singleBytes.size >= 3;
}

// Byte mà cp1258 đọc khác cp1252 theo kiểu riêng của tiếng Việt: Ă ă Đ đ Ơ ơ Ư ư ₫ và 5 dấu thanh dạng tổ hợp (huyền, sắc, ngã, hỏi, nặng).
const VN_1258_BYTES = new Set([0xc3, 0xe3, 0xd0, 0xf0, 0xd5, 0xf5, 0xdd, 0xfd, 0xfe, 0xcc, 0xec, 0xde, 0xd2, 0xf2]);
// Một âm tiết tiếng Việt (đã bỏ dấu thanh): phụ âm đầu + vần. Nguyên âm ă / â / iê / uô / ươ… luôn cần phụ âm cuối ("ăn", không có "ăo").
// Vần -k chỉ có ở địa danh / tên Tây Nguyên (Đắk Lắk, Pắk, Krông Búk) nhưng rất hay gặp trong địa chỉ.
const VN_SYLLABLE = new RegExp(
  "^(?:ngh|ng|nh|ch|gh|gi|kh|ph|th|tr|qu|[bcdđghklmnprstvx])?(?:" +
  "(?:uyê|oă|oa|oe|uâ|uê|uy|iê|yê|uô|ươ|oo|a|ă|â|e|ê|i|o|ô|ơ|u|ư|y)(?:ch|ng|nh|c|k|m|n|p|t)" +
  "|uya|uyu|uây|uôi|ươi|ươu|iêu|yêu|oai|oay|oeo|ai|ao|au|ay|âu|ây|eo|êu|ia|iu|oa|oe|oi|ôi|ơi|ua|uê|ui|uơ|uy|ưa|ưi|ưu|a|e|ê|i|o|ô|ơ|u|ư|y)$",
);
/** Âm tiết hợp lệ: đúng luật vần, và có nhiều nhất một dấu thanh, nằm trên nguyên âm ("Toṭ" = "Totò" tiếng Ý đọc theo 1258 có dấu nặng dưới chữ t: không phải). */
const isVnSyllable = (w: string) => {
  let base = "", tones = 0;
  for (const ch of w.normalize("NFD")) {
    if (/[\u0300\u0301\u0303\u0309\u0323]/.test(ch)) { if (!/[aeiouy]/.test(base) || ++tones > 1) return false; }
    else if (!/\p{M}/u.test(ch)) base = ch;
  }
  return VN_SYLLABLE.test(w.normalize("NFD").replace(/[\u0300\u0301\u0303\u0309\u0323]/g, "").normalize("NFC"));
};
/** Từ viết tắt viết hoa có Đ (HĐ, SĐT, ĐT, ĐH, VNĐ, NĐ) và "đ" (đồng) đứng riêng: không phải âm tiết nhưng là chữ tiếng Việt thường gặp trong hoá đơn, địa chỉ. */
const isVnAbbrev = (w: string) => w === "đ" || (/^\p{Lu}{1,6}$/u.test(w) && w.includes("Đ"));

/** Từ / âm tiết rất thường gặp của tiếng Việt (chữ thường, NFC). Nhiều từ trong đây cp1258 ghi bằng đúng byte của cp1252 (giá, cho, khách, có, là), nên
 * từ điển chỉ là bằng chứng ngôn ngữ; bằng chứng bảng mã nằm ở (b): có âm tiết hợp lệ chứa byte riêng của 1258 (phòng = "pho" + dấu huyền tổ hợp, đâu, mới). */
const VN_LEXICON = new Set((
  "của và là được không có người những này cho với các một đã trong để khi thì đến từ theo về năm ngày số đơn vị công ty tiếng việt " +
  "cũng nhưng như mà nên sẽ đang phải làm lại rồi nhiều nhất đi bị gì ở ra vào sau trước hơn đây đó nào bạn tôi chúng họ mình " +
  "hàng tiền giá mã tên địa chỉ điện thoại thành phố phường quận huyện tỉnh đường hóa hoá thuế tổng cộng khách sản phẩm học thể cần " +
  "nước nam nội xin cảm ơn chào tháng giờ thị văn bản trường đại hội kết nối lỗi dữ liệu tệp tin thông báo chậm " +
  "mới đồng phở bò bún chả cà phê sữa đá trà sao đâu nhân viên phòng kinh doanh sách danh giao thứ bảy mạnh tăng hỏi bán căn hộ bao nhiêu " +
  "anh chị chi phí lợi nhuận thu đạt việc rất tốt hoàn ăn uống nhà mua hôm nay mai tuần hết còn đủ vui lòng gửi nhận"
).split(" "));
/** Đúng luật âm tiết nhưng không phải từ tiếng Việt: là "ciò" / "può" tiếng Ý (ò = 0xF2 = dấu nặng tổ hợp trong 1258) đọc theo 1258. */
const NOT_VN = new Set(["cị", "pụ"]);
/** Từ trong VN_LEXICON cũng là từ thường gặp của tiếng Tây Âu (Pháp / Ý "là", Ý "chi", Catalan "mà", tên "Theo", Ba Lan / Séc "ty"…): không tính là bằng chứng. */
const VN_LEX_AMBIG = new Set(["là", "mà", "ra", "nam", "tin", "theo", "chi", "sao", "bao", "anh", "mai", "nay", "sau", "do", "ty"]);

/** Có phải tiếng Việt mã Windows-1258 không (đọc theo 1258 rồi ghép NFC). Chỉ các từ có byte ≥0x80 được xét, chia ba loại:
 * - hợp lệ: âm tiết tiếng Việt (kể cả vần -k của địa danh Tây Nguyên: Đắk, Lắk, Pắk) hay viết tắt có Đ;
 * - sai có byte riêng của 1258 (ă đ ơ ư ₫, dấu thanh tổ hợp): chỗ cp1252 đọc khác, đọc theo 1258 ra "năo", "ađ", "cị" là bằng chứng ngược;
 * - sai không có byte riêng (café, José, André): cp1252 và 1258 đọc như nhau, tên nước ngoài trong văn bản Việt, không tính.
 * jschardet đã nói cp1258 (bản gốc tin thẳng nhãn này và đọc đúng): giữ, trừ khi từ có byte riêng sai nhiều hơn hợp lệ (tiếng Ý "Ciò detto, può andare").
 * Không có nhãn cp1258: cần bằng chứng tích cực mạnh: (a) ≥2 lần từ trong VN_LEXICON (trừ từ nhập nhằng với tiếng Tây Âu); (b) ≥1 âm tiết hợp lệ có byte
 * riêng, ≥70% số từ được tính và ≥70% số từ có byte riêng là hợp lệ. Tiếng Ý / Bồ / Iceland / Thổ / Séc không có 2 từ trong VN_LEXICON. */
export function looksVietnamese1258(buf: Buffer, detSays1258 = false): boolean {
  const head = buf.subarray(0, 65_536);
  if (!head.some((c) => VN_1258_BYTES.has(c))) return false;
  // Không ghép NFC ở bước tách từ: cp1258 một byte = một ký tự, nên vị trí trong chuỗi trùng vị trí byte.
  const raw = new TextDecoder("windows-1258").decode(head);
  if (raw.length !== head.length) return false;
  let valid = 0, ownValid = 0, ownBad = 0, lex = 0;
  for (const m of raw.matchAll(/[\p{L}\p{M}]+/gu)) {
    const bytes = head.subarray(m.index, m.index + m[0].length);
    const word = m[0].normalize("NFC"), w = word.toLowerCase();
    if (VN_LEXICON.has(w) && !VN_LEX_AMBIG.has(w)) lex++;
    if (!bytes.some((c) => c >= 0x80)) continue;
    const own = bytes.some((c) => VN_1258_BYTES.has(c));
    if ((isVnSyllable(w) && !NOT_VN.has(w)) || isVnAbbrev(word) || isVnAbbrev(w)) { valid++; if (own) ownValid++; }
    else if (own) ownBad++;
  }
  if (detSays1258) return ownBad <= ownValid;
  return lex >= 2 && ownValid >= 1 && valid >= 0.7 * (valid + ownBad) && ownValid >= 0.7 * (ownValid + ownBad);
}

// ---- 1. Ảnh: gửi thẳng, KHÔNG OCR; tự xoay theo EXIF (ảnh dọc chụp điện thoại lên đúng chiều), resize nếu cạnh dài > 1568px, HEIC/GIF → PNG ----
// failOn:"error" để ảnh hỏng báo lỗi rõ thay vì ra dữ liệu rác; limitInputPixels chặn ảnh khổng lồ.
const openImage = (b: Buffer) => sharp(b, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" });
const imageExtractor: Extractor = {
  name: "image",
  match: (k) => k.startsWith("image/"),
  async run(buf, { kind, name }) {
    let meta: Metadata;
    try { meta = await openImage(buf).metadata(); }
    catch { throw new FileError(`Ảnh "${name}" quá lớn hoặc bị hỏng nên không xử lý được (giới hạn ~40 triệu điểm ảnh).`); }
    const w = meta.width ?? 0, hgt = meta.height ?? 0;
    if (w * hgt > IMAGE_MAX_PIXELS) throw new FileError(`Ảnh "${name}" quá lớn (${w}×${hgt} điểm ảnh). Giới hạn ~40 triệu điểm ảnh — hãy thu nhỏ rồi tải lại.`);
    const heic = kind === "image/heic", gif = kind === "image/gif";
    const needRotate = (meta.orientation ?? 1) > 1;       // có cờ xoay EXIF: phải nắn lại để ảnh lên đúng chiều
    const big = Math.max(w, hgt) > IMAGE_MAX_EDGE;
    // Ảnh thường, nhỏ, không cần xoay / đổi định dạng: gửi nguyên bản cho model.
    if (!heic && !gif && !needRotate && !big && buf.length <= IMAGE_MAX_BYTES) return [{ type: "image", media_type: kind, data: buf.toString("base64") }];
    let pipe = openImage(buf).rotate();                   // rotate() không tham số = tự xoay theo EXIF rồi gỡ cờ
    if (big) pipe = pipe.resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside" });
    // HEIC (model không nhận) và GIF động (chỉ cần khung đầu): ép sang PNG.
    let out: Buffer, mt: string;
    try {
      if (heic || gif) { out = await pipe.png().toBuffer(); mt = "image/png"; }
      else { out = await pipe.toBuffer(); mt = kind; }
    } catch { throw new FileError(heic ? `Không đọc được ảnh HEIC "${name}" (máy chủ chưa hỗ trợ giải mã HEIC). Hãy lưu sang JPEG / PNG rồi tải lại.` : `Ảnh "${name}" bị hỏng, không xử lý được.`); }
    // Ảnh chụp màn hình PNG vẫn nặng sau khi thu nhỏ: nén JPEG chất lượng cao (nền trắng cho phần trong suốt) để 20 ảnh vẫn gửi được một lần.
    if (out.length > IMAGE_MAX_BYTES) {
      const jpg = await openImage(out).flatten({ background: "#ffffff" }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
      if (jpg.length < out.length) { out = jpg; mt = "image/jpeg"; }
    }
    return [{ type: "image", media_type: mt, data: out.toString("base64") }];
  },
};

// ---- 1b. Âm thanh / video: phiên âm bằng Scribe, bản chép có mốc thời gian làm nội dung tệp (hàng convert, chạy lâu) ----
const audioExtractor: Extractor = {
  name: "audio",
  match: (k) => k === "audio",
  async run(buf, { name, uid }) { return [{ type: "text", text: await withConvertSlot(uid, () => transcribeAudio(buf, name, uid)) }]; },
};

// ---- 1c. Office cũ (.doc/.xls/.ppt): chuyển bằng LibreOffice headless (chỉ khi máy chủ có cài, SYNCHRO_SOFFICE_BIN) rồi đi tiếp đường docx/xlsx/pptx ----
async function convertLegacyOffice(buf: Buffer, name: string): Promise<{ buf: Buffer; kind: string }> {
  const bin = process.env.SYNCHRO_SOFFICE_BIN;
  if (!bin) throw new FileError(`"${name}" là định dạng Office cũ (.doc/.xls/.ppt). Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  // Đoán loại từ các luồng OLE để chọn đúng đuôi nguồn và đích; LibreOffice tự nhận bộ lọc nhập theo nội dung.
  const s = buf.subarray(0, 65_536).toString("latin1");
  const [srcExt, target] = /Workbook|\bBook\b/.test(s) ? ["xls", "xlsx"] : /PowerPoint Document/.test(s) ? ["ppt", "pptx"] : ["doc", "docx"];
  const dir = await mkdtemp(path.join(tmpdir(), "soffice-"));
  try {
    const src = path.join(dir, `in.${srcExt}`), profile = path.join(dir, "profile");
    await writeFile(src, buf);
    // Hồ sơ người dùng riêng theo lần chạy + môi trường tối thiểu (không khóa bí mật): nhiều lần chạy không giẫm lên nhau, soffice không ra mạng.
    const job = run(bin, ["--headless", "--norestore", "--nologo", `-env:UserInstallation=file://${profile}`, "--convert-to", target, "--outdir", dir, src],
      { timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, env: { ...parserEnv(), HOME: dir } });
    lowPriority(job.child.pid);
    await job;
    const out = await readFile(path.join(dir, `in.${target}`));
    return { buf: out, kind: target };
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError(`Không chuyển được tệp Office cũ "${name}". Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const legacyOfficeExtractor: Extractor = {
  name: "legacy-office",
  match: (k) => k === "legacy-office",
  async run(buf, ctx) {
    const conv = await withConvertSlot(ctx.uid, () => convertLegacyOffice(buf, ctx.name));
    return [{ type: "text", text: await parseInWorker(conv.kind, conv.buf, ctx.name, ctx.uid) }];
  },
};

// ---- 2. PDF ----
const pdfExtractor: Extractor = {
  name: "pdf",
  match: (k) => k === "application/pdf",
  async run(buf, { name, uid }) {
    if (PDF_NATIVE) {
      // Provider hỗ trợ PDF trực tiếp: gửi nguyên văn bản gốc, kèm text dự phòng cho nhánh khác. Không có Python để đọc thử thì vẫn gửi như cũ.
      const fb = await withParseSlot(uid, () => pdfFallback(buf, uid)).catch((e) => { if (e instanceof BadPdf) throw new FileError(`Không đọc được "${name}": tệp PDF bị hỏng hoặc đang đặt mật khẩu.`); return null; });
      // Dài quá giới hạn số trang của API (lỗi cả lượt, có thể cả các lượt sau của phiên): gửi phần chữ, các lượt hỏi về tệp vẫn tìm được đoạn liên quan.
      if (!fb || fb.total <= PDF_NATIVE_PAGES) return [{ type: "document", media_type: "application/pdf", data: buf.toString("base64"), name, fallbackText: fb?.text, fallbackImages: fb?.images }];
      return textBlocks(fb);
    }
    return textBlocks(await withParseSlot(uid, () => pdfFallback(buf, uid)).catch((e) => { if (e instanceof BadPdf) throw new FileError(`Không đọc được "${name}": tệp PDF bị hỏng hoặc đang đặt mật khẩu.`); throw e; }));
  },
};
const textBlocks = (fb: { text: string; images: string[] }) => {
  const out: ContentBlock[] = [];
  if (fb.text) out.push({ type: "text", text: fb.text });
  out.push(...fb.images.map((data) => ({ type: "image" as const, media_type: "image/jpeg", data })));
  return out;
};

class BadPdf extends Error {}
const pyBin = () => process.env.PYTHON_BIN || path.join(process.cwd(), ".mkvenv", "bin", "python");
/** OCR một trang PDF scan bằng scripts/ocr.py (RapidOCR). Chỉ chạy khi bật SYNCHRO_OCR=1 (mặc định tắt: giữ nguyên hành vi cũ, không spawn vô ích khi máy chủ chưa cài OCR). */
async function ocrPage(imgPath: string, uid?: string): Promise<string> {
  const job = run(pyBin(), [path.join(process.cwd(), "scripts", "ocr.py"), imgPath], { maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: "SIGKILL", env: parserEnv() });
  lowPriority(job.child.pid);
  return withConvertSlot(uid, async () => (await job).stdout.trim());
}

async function pdfFallback(buf: Buffer, uid?: string): Promise<{ total: number; text: string; images: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf-"));
  const imgDir = path.join(dir, "img");
  try {
    const src = path.join(dir, "in.pdf");
    await mkdir(imgDir, { recursive: true });
    await writeFile(src, buf);
    // Môi trường tối thiểu (không khóa bí mật) + SIGKILL khi quá giờ: PDF độc hại không giữ được tiến trình hay đọc trộm biến môi trường.
    const job = run(pyBin(), [path.join(process.cwd(), "scripts", "pdf_extract.py"), src, String(PDF_MAX_PAGES), "1.3", String(PDF_TEXT_PAGES), imgDir], { maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: "SIGKILL", env: parserEnv() });
    lowPriority(job.child.pid);
    const { stdout } = await job;
    const j = JSON.parse(stdout) as { bad?: string; total: number; texts: string[]; images: string[] };
    if (j.bad) throw new BadPdf(j.bad);
    // Quyết định theo TỪNG trang: trang có dưới 20 ký tự chữ là trang scan → OCR riêng trang đó (khi đã bật OCR và có ảnh trang).
    const texts = [...j.texts];
    if (process.env.SYNCHRO_OCR === "1") {
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].replace(/\s+/g, "").length >= 20 || !j.images[i]) continue;
        const got = await ocrPage(path.join(imgDir, j.images[i]), uid).catch(() => "");
        if (got.trim()) texts[i] = got;
      }
    }
    const chars = texts.join("").replace(/\s+/g, "").length;
    const scanned = chars < 20 * Math.max(1, texts.length);
    // PDF scan không OCR được (không có lớp text, OCR tắt / thất bại): chỉ dùng ảnh trang.
    const text = scanned ? "" : texts.map((t, i) => `--- Trang ${i + 1} ---\n${t}`).join("\n\n");
    const note = !text ? "" : j.total > texts.length ? `\n\n(Chỉ có chữ của ${texts.length}/${j.total} trang đầu.)` : "";
    // Ảnh trang nằm trên đĩa tạm (không qua stdout): đọc lại và mã hoá base64 cho khối nội dung, rồi thư mục bị xoá ở finally.
    const images = await Promise.all(j.images.map((fn) => readFile(path.join(imgDir, fn)).then((b) => b.toString("base64"))));
    return { total: j.total, text: text ? text + note : j.total > PDF_MAX_PAGES ? `(PDF dạng ảnh ${j.total} trang: chỉ có ảnh của ${PDF_MAX_PAGES} trang đầu. Hãy nói rõ điều này với người dùng.)` : "", images };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---- 3. DOCX, XLSX / CSV, PPTX, ZIP: đọc trong tiến trình riêng (scripts/extract-worker.mjs), tệp độc hại hay quá lớn không kéo sập máy chủ web ----
const workerExtractor: Extractor = {
  name: "office",
  match: (k) => k === "docx" || k === "xlsx" || k === "csv" || k === "pptx" || k === "zip",
  async run(buf, { name, kind, uid }) {
    // CSV là chữ: giải mã ở đây bằng cùng decodeText với tệp .txt (UTF-16 không BOM, Windows-1258 + NFC, cp1252…) rồi gửi UTF-8 cho tiến trình đọc,
    // thay vì để tiến trình tự đoán bằng jschardet (UTF-16 không BOM ra đầy byte 0, cp1252 ra "Cittā").
    const input = kind === "csv" ? Buffer.from(decodeText(buf), "utf8") : buf;
    return [{ type: "text", text: await parseInWorker(kind, input, name, uid) }];
  },
};

// ---- 4. TXT / MD / JSON / code / HTML / XML ----
const textExtractor: Extractor = {
  name: "text",
  match: (k) => k === "text",
  async run(buf) { return [{ type: "text", text: decodeText(buf) }]; },
};

// Strategy: thêm loại mới chỉ cần thêm một extractor vào mảng này.
export const EXTRACTORS: Extractor[] = [imageExtractor, audioExtractor, legacyOfficeExtractor, pdfExtractor, workerExtractor, textExtractor];

export function pickExtractor(kind: string, name: string): Extractor {
  const e = EXTRACTORS.find((x) => x.match(kind));
  if (!e) throw new FileError(`Không hỗ trợ loại tệp của "${name}".`);
  return e;
}
