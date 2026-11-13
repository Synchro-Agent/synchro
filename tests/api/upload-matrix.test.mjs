// Ma trận tải lên: ~20 tệp mẫu, mỗi tệp mang một DẤU HIỆU riêng; kiểm tra Synchro nhận đúng loại và trích đúng nội dung.
// Không cần máy chủ: detectKind / decodeText / chunkSheet là hàm thuần (loadTs), còn docx/xlsx/pptx/csv/zip chạy thẳng scripts/extract-worker.mjs.
// Các đường cần công cụ ngoài (phiên âm âm thanh: mạng; Office cũ: LibreOffice; OCR: Python) được kiểm ở mức "chọn đúng extractor + báo lý do rõ", KHÔNG bịa nội dung.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

const R = createRequire(path.join(process.cwd(), "package.json"));
const JSZip = R("jszip"), XLSX = R("xlsx");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };

const { "fileproc/detect": D, "fileproc/extractors": E, "fileproc/rag": RAG } = await loadTs(["fileproc/detect", "fileproc/extractors", "fileproc/rag"]);

const worker = path.join(process.cwd(), "scripts", "extract-worker.mjs");
const parse = (kind, buf, name = "t") => {
  const r = spawnSync(process.execPath, [worker, kind, name], { input: buf, maxBuffer: 64 * 1048576, timeout: 120_000 });
  let j = null; try { j = JSON.parse(r.stdout.toString("utf8")); } catch {}
  return j;
};
const zipOf = async (files) => { const z = new JSZip(); for (const [n, d] of Object.entries(files)) z.file(n, d); return z.generateAsync({ type: "nodebuffer" }); };
const B = (...a) => Buffer.from(a);
const kindOf = async (buf, name) => { try { return await D.detectKind(buf, name); } catch (e) { return `ERR:${e.message}`; } };

// ---------------------------------------------------------------------------
console.log("1. Nhận diện loại bằng magic bytes (18 tệp mẫu)");

// ảnh
ok(await kindOf(B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4), "a.png") === "image/png", "PNG");
ok(await kindOf(B(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46), "a.jpg") === "image/jpeg", "JPEG");
ok(await kindOf(B(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 1), "a.gif") === "image/gif", "GIF");
ok(await kindOf(Buffer.concat([B(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0), Buffer.from("WEBPxxxx")]), "a.webp") === "image/webp", "WEBP");
// HEIC: hộp ftyp, brand heic
ok(await kindOf(Buffer.concat([B(0, 0, 0, 0x18), Buffer.from("ftypheic"), Buffer.from("mif1heic")]), "p.heic") === "image/heic", "HEIC (ftyp brand heic)");
ok(await kindOf(Buffer.concat([B(0, 0, 0, 0x18), Buffer.from("ftypmif1"), Buffer.alloc(8)]), "p.heic") === "image/heic", "HEIF (brand mif1)");
// video/âm thanh (ftyp brand không phải HEIC) → phiên âm
ok(await kindOf(Buffer.concat([B(0, 0, 0, 0x18), Buffer.from("ftypisom"), Buffer.alloc(8)]), "v.mp4") === "audio", "MP4 (ftyp isom → audio)");
ok(await kindOf(Buffer.concat([B(0, 0, 0, 0x18), Buffer.from("ftypqt  "), Buffer.alloc(8)]), "v.mov") === "audio", "MOV (ftyp qt → audio)");
// âm thanh thuần
ok(await kindOf(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(16)]), "s.mp3") === "audio", "MP3 (ID3)");
ok(await kindOf(B(0xff, 0xfb, 0x90, 0x44, 0, 0), "s.mp3") === "audio", "MP3 (khung MPEG)");
ok(await kindOf(Buffer.concat([B(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0), Buffer.from("WAVEfmt ")]), "s.wav") === "audio", "WAV");
ok(await kindOf(B(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4), "s.webm") === "audio", "WebM/MKV (EBML)");
// pdf
ok(await kindOf(Buffer.from("%PDF-1.7\n%âãÏÓ"), "d.pdf") === "application/pdf", "PDF");
// ooxml
ok(await kindOf(await zipOf({ "word/document.xml": "<w/>", "[Content_Types].xml": "<x/>" }), "d.docx") === "docx", "DOCX (zip có word/document.xml)");
ok(await kindOf(await zipOf({ "xl/workbook.xml": "<w/>", "[Content_Types].xml": "<x/>" }), "s.xlsx") === "xlsx", "XLSX (zip có xl/workbook.xml)");
ok(await kindOf(await zipOf({ "ppt/presentation.xml": "<p/>", "[Content_Types].xml": "<x/>" }), "p.pptx") === "pptx", "PPTX (zip có ppt/presentation.xml)");
// tệp nhị phân lạ → FileError
ok((await kindOf(B(0, 1, 2, 3, 0xff, 0xfe, 0x7f, 0, 0x10, 0, 0, 0), "x.xyz")).startsWith("ERR:"), "tệp .xyz nhị phân bị từ chối kèm lý do");

console.log("2. Office cũ (.doc/.xls/.ppt, OLE) — cổng theo SYNCHRO_SOFFICE_BIN");
const ole = Buffer.concat([B(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), Buffer.alloc(32)]);
delete process.env.SYNCHRO_SOFFICE_BIN;
ok((await kindOf(ole, "cu.doc")).startsWith("ERR:"), "chưa cài LibreOffice: báo lưu lại thành .docx (không bịa)");
process.env.SYNCHRO_SOFFICE_BIN = "/usr/bin/soffice";
ok(await kindOf(ole, "cu.doc") === "legacy-office", "có SYNCHRO_SOFFICE_BIN: nhận legacy-office để chuyển");
delete process.env.SYNCHRO_SOFFICE_BIN;

console.log("3. Nhận diện UTF-16 không dấu BOM (byte 0 theo vị trí chẵn/lẻ)");
const vn = "Tên khách;Số tiền;Ghi chú — DAUHIEU_U16\nNguyễn Văn A;1.000.000;ổn\n";
ok(D.sniffUtf16(Buffer.from(vn, "utf16le")) === "utf-16le", "UTF-16LE không BOM → le");
ok(D.sniffUtf16(Buffer.from(vn, "utf16le").swap16()) === "utf-16be", "UTF-16BE không BOM → be");
ok(D.sniffUtf16(Buffer.from(vn, "utf8")) === null, "UTF-8 không bị nhầm là UTF-16");
ok(await kindOf(Buffer.from(vn, "utf16le"), "u.csv") === "csv", "UTF-16 không BOM .csv → csv (không coi là nhị phân)");
ok(await kindOf(Buffer.from(vn.repeat(20), "utf16le").swap16(), "u.txt") === "text", "UTF-16BE không BOM .txt → text");
ok(await kindOf(Buffer.concat([B(0xff, 0xfe), Buffer.from(vn, "utf16le")]), "bom.csv") === "csv", "UTF-16LE có BOM (FF FE) → csv, không nhầm khung MP3 (FF Ex)");
// Tệp nhị phân có mẫu byte 0 giống UTF-16LE (bảng số 16-bit 0..255, byte cao luôn 0): giải ra đầy ký tự điều khiển → vẫn bị chặn là nhị phân.
const u16bin = Buffer.alloc(4096); for (let i = 0; i < 2048; i++) u16bin.writeUInt16LE(i % 256, i * 2);
ok(D.sniffUtf16(u16bin) === "utf-16le", "nhị phân 16-bit: mẫu byte 0 trông như UTF-16LE (đúng ca cần chặn)");
ok(D.utf16LooksText(u16bin, "utf-16le") === false, "nhị phân 16-bit: giải ra nhiều ký tự điều khiển → không phải chữ");
ok(D.utf16LooksText(Buffer.from(vn, "utf16le"), "utf-16le") === true, "UTF-16 chữ thật: ít ký tự điều khiển → là chữ");
ok((await kindOf(u16bin, "data.bin")).startsWith("ERR:"), "nhị phân giống UTF-16 không BOM bị từ chối kèm lý do");
ok((await kindOf(u16bin, "data.csv")).startsWith("ERR:"), "kể cả khi đặt đuôi .csv");

console.log("4. Giải mã văn bản: lấy lại đúng DẤU HIỆU (5 kiểu mã hoá)");
const marker = "DẤU_HIỆU_Mừng_Xuân_Đinh";
ok(E.decodeText(Buffer.from(marker, "utf8")).includes(marker), "UTF-8");
ok(E.decodeText(Buffer.concat([B(0xff, 0xfe), Buffer.from(marker, "utf16le")])).includes(marker), "UTF-16LE có BOM (BOM bị gỡ)");
ok(E.decodeText(Buffer.concat([B(0xfe, 0xff), Buffer.from(marker, "utf16le").swap16()])).includes(marker), "UTF-16BE có BOM");
ok(E.decodeText(Buffer.from(marker, "utf16le")).includes(marker), "UTF-16LE không BOM");
// cp1252 và Windows-1258 đọc khác nhau ở cùng byte (0xE3: ã / ă, 0xF0: ð / đ, 0xEC: ì / dấu sắc…) và không byte nào "sai" ở cả hai:
// chỉ đọc theo 1258 khi văn bản thật sự là tiếng Việt, còn lại cp1252 (Bồ Đào Nha / Ý / Iceland không bị đổi thành Săo, coś, međ).
// Byte dựng tay: chuỗi ASCII giữ nguyên, số là byte cao của bảng mã.
const bytes = (...p) => Buffer.concat(p.map((x) => (typeof x === "string" ? Buffer.from(x, "latin1") : B(x))));
const dec = (b, want, n) => { const got = E.decodeText(b); ok(got === want, n, got); };
dec(bytes("DH1252 S", 0xe3, "o Paulo n", 0xe3, "o ", 0xe9, " uma cidade pequena; as li", 0xe7, 0xf5, "es est", 0xe3, "o nas can", 0xe7, 0xf5, "es."),
  "DH1252 São Paulo não é uma cidade pequena; as lições estão nas canções.", "cp1252 tiếng Bồ Đào Nha: São / não / lições (không thành Săo, liçơes)");
dec(bytes("Cos", 0xec, " ", 0xe8, " la vita, perci", 0xf2, " non pu", 0xf2, " essere pi", 0xf9, " facile. Luned", 0xec, " andr", 0xf2, " l", 0xe0, "."),
  "Così è la vita, perciò non può essere più facile. Lunedì andrò là.", "cp1252 tiếng Ý: così / perciò / lunedì (không thành coś)");
dec(bytes("Pu", 0xf2, " darsi, ci", 0xf2, " ", 0xe8, " vero."), "Può darsi, ciò è vero.", "cp1252 tiếng Ý ngắn: può / ciò (trông như âm tiết Việt nhưng không có ă đ ơ ư)");
dec(bytes(0xde, "a", 0xf0, " er gott a", 0xf0, " vera h", 0xe9, "r, ", 0xfe, 0xfa, " ert me", 0xf0, "."),
  "Það er gott að vera hér, þú ert með.", "cp1252 tiếng Iceland: Það / að / með (không thành ađ, međ)");
// Tiếng Việt mã Windows-1258 thật: nguyên âm có sẵn (à ê ô â ă ơ ư đ) + dấu thanh tổ hợp (0xEC sắc, 0xF2 nặng, 0xDE ngã, 0xD2 hỏi, 0xCC huyền).
dec(bytes("DH1258 Ti", 0xea, 0xec, "ng Vi", 0xea, 0xf2, "t l", 0xe0, " ng", 0xf4, "n ng", 0xfd, 0xde, " cu", 0xd2, "a ng", 0xfd, 0xf5, 0xcc, "i Vi", 0xea, 0xf2, "t Nam. ",
  0xd0, 0xe2, "y l", 0xe0, " m", 0xf4, 0xf2, "t ", 0xf0, "oa", 0xf2, "n v", 0xe3, "n ba", 0xd2, "n m", 0xe2, 0xde, "u."),
  "DH1258 Tiếng Việt là ngôn ngữ của người Việt Nam. Đây là một đoạn văn bản mẫu.", "Windows-1258 tiếng Việt: đọc đúng dấu, ghép thành chữ dựng sẵn (NFC)");
dec(bytes("Chi", 0xf2, " bi", 0xf2, " ", 0xf4, 0xec, "m, me", 0xf2, " ", 0xf0, "i ch", 0xf5, 0xf2, "."), "Chị bị ốm, mẹ đi chợ.", "Windows-1258 tiếng Việt ngắn (jschardet đoán Hy Lạp) vẫn ra tiếng Việt");

console.log("4b. UTF-8 gần như hợp lệ (C-4): một byte hỏng không làm cả tệp thành chữ lỗi cp1252");
const vnU8 = "Tiếng Việt là ngôn ngữ chính thức của Việt Nam. ".repeat(40);
const u8b = Buffer.from(vnU8, "utf8");
let got = E.decodeText(Buffer.concat([u8b, B(0xe1, 0xbb)]));
ok(got.startsWith(vnU8) && got.endsWith("�") && !got.includes("Ã"), "UTF-8 cụt ký tự cuối (jschardet: utf-8): chỉ đuôi thành U+FFFD", got.slice(0, 60) + " … " + JSON.stringify(got.slice(-4)));
got = E.decodeText(Buffer.concat([u8b.subarray(0, 500), B(0x96), u8b.subarray(500)]));
ok(got.includes("Tiếng Việt là ngôn ngữ") && got.split("�").length === 2 && !got.includes("Ã"), "UTF-8 lẫn một byte lạ 0x96 (jschardet đoán mã một byte): chỉ byte đó hỏng", got.slice(0, 60));
got = E.decodeText(Buffer.concat([Buffer.from("\uFEFFXin chào bạn, ", "utf8"), B(0x96), Buffer.from(" hẹn gặp lại.", "utf8")]));
ok(got === "Xin chào bạn, � hẹn gặp lại.", "UTF-8 ngắn có BOM + một byte lạ: BOM bị gỡ, chỉ byte lạ hỏng", got);
dec(bytes("Ca", 0xc3, 0xa9, " cr", 0xe8, "me ", 0xe0, " la vanille, tr", 0xe8, "s bon"), "CaÃ© crème à la vanille, très bon", "cp1252 có một cặp byte trùng UTF-8 hợp lệ (Ã©) vẫn đọc theo cp1252");

console.log("4c. Mã một byte Latinh khác cp1252 (C-3): chỉ tin jschardet khi có bằng chứng ngôn ngữ");
// Bộ mã hoá một byte dựng từ bảng của TextDecoder (Node không có TextEncoder cho mã cũ).
const sbEncoder = (enc) => {
  const t = new Map(); const d = new TextDecoder(enc);
  for (let b = 0x80; b < 256; b++) { const c = d.decode(B(b)); if (c !== "�") t.set(c, b); }
  return (s) => Buffer.from([...s].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : t.get(c) ?? 0x3f)));
};
const cp1252 = sbEncoder("windows-1252"), cp1250 = sbEncoder("windows-1250");
const round = (encode, s, n) => dec(encode(s), s, n);
// jschardet đoán Windows-1250 / iso8859-4 / Windows-1253 cho các mẫu Tây Âu ngắn này.
round(cp1252, "Nom,Prénom,Ville\nDupont,Hélène,Paris\nMartin,Jérôme,Lyon", "cp1252 Pháp (jschardet: Windows-1250): Hélène không thành Hélčne");
round(cp1252, "Città,Abitanti\nRoma,2800000\nForlì,118000", "cp1252 Ý (jschardet: iso8859-4, viết không gạch): Città / Forlì không thành Cittā / Forlė");
round(cp1252, "Città,Perché\nCosì,Può\nLunedì,Però", "cp1252 Ý CSV ngắn (iso8859-4): Così / Può / Però");
round(cp1252, "Café crème: 3,50€", "cp1252 Pháp (jschardet: Windows-1253): không thành chữ Hy Lạp Cafι crθme");
round(cp1252, "Le nº 5 coûte 3€", "cp1252 Pháp (Windows-1250): nº / coûte không thành nş / coűte");
round(cp1252, "Año nuevo, vida nueva. ¿Qué tal?", "cp1252 Tây Ban Nha (Windows-1250): Año / ¿Qué không thành Ańo / żQué");
round(cp1252, "Teléfono: 912 345 678. Señora Pérez, calle Mayor.", "cp1252 Tây Ban Nha: Señora");
// Văn bản Trung Âu thật vẫn đọc đúng theo Windows-1250 / iso-8859-15 vẫn ra œ và €.
round(cp1250, "Zażółć gęślą jaźń. Łódź, Kraków, Wrocław.", "Windows-1250 Ba Lan: ł / ą / ż (cp1252 ra ³ ¹ ¿ giữa chữ) vẫn tin jschardet");
round(cp1250, "Árvíztűrő tükörfúrógép. Őszi szél fúj.", "Windows-1250 Hungary: ő / ű vẫn đúng");
round(cp1250, "Dobrý den, jak se máte? Děkuji, mám se dobře. Kde je nádraží?", "Windows-1250 Séc: Děkuji / dobře vẫn đúng");
round(sbEncoder("iso-8859-15"), "L'œuvre coûte 5 € et le cœur est là.", "iso-8859-15 (jschardet: iso8859-15): œ / € đúng");
round(sbEncoder("windows-1251"), "ERROR 2026-01-01 Ошибка: файл config.yaml не найден (code=404). Повторите попытку через 5 минут.", "Windows-1251 tiếng Nga lẫn chữ ASCII vẫn ra chữ Kirin");
round(sbEncoder("windows-1253"), "Καλημέρα κόσμε. Αυτό είναι ένα δοκιμαστικό αρχείο.", "Hy Lạp (jschardet: ISO-8859-7) vẫn ra chữ Hy Lạp");
console.log("4d. Windows-1258 lẫn nhiều từ ASCII (C-1): nhật ký, địa chỉ, email, mã hàng vẫn là tiếng Việt");
// Mã hoá cp1258 như Windows: chữ dựng sẵn nếu bảng mã có, không thì chữ gốc + byte dấu thanh tổ hợp.
const T1258 = new Map(); { const d = new TextDecoder("windows-1258"); for (let b = 0x80; b < 256; b++) { const c = d.decode(B(b)); if (c !== "�") T1258.set(c, b); } }
const TONE = { "̀": 0xcc, "́": 0xec, "̃": 0xde, "̉": 0xd2, "̣": 0xf2 };
const cp1258 = (s) => {
  const out = [];
  for (const ch of s.normalize("NFC")) {
    if (ch.charCodeAt(0) < 0x80) { out.push(ch.charCodeAt(0)); continue; }
    if (T1258.has(ch)) { out.push(T1258.get(ch)); continue; }
    const parts = [...ch.normalize("NFD")], tone = parts.find((c) => TONE[c]), base = parts.filter((c) => !TONE[c]).join("").normalize("NFC");
    out.push(base.charCodeAt(0) < 0x80 ? base.charCodeAt(0) : T1258.get(base));
    if (tone) out.push(TONE[tone]);
  }
  return Buffer.from(out);
};
round(cp1258, "ERROR Không thể đọc file config.yaml", "1258 dòng lỗi: Không thể đọc (không thành thêÒ ðoòc)");
round(cp1258, "Địa chỉ: 123 Lê Lợi, P. Bến Thành, Q.1, TP.HCM. ĐT: 028 3822 1234. Email: info@abc.vn", "1258 địa chỉ lẫn TP.HCM / ĐT / email");
round(cp1258, "2026-01-01 10:00:01 INFO Server started on port 8080\n2026-01-01 10:00:02 WARN Kết nối database chậm (latency=350ms)\n2026-01-01 10:00:03 INFO OK", "1258 nhật ký nhiều dòng tiếng Anh, một dòng tiếng Việt");
round(cp1258, "Mã SP,Tên sản phẩm,Giá\nSP001,Bút bi Thiên Long,5000\nSP002,Vở học sinh,12000\nSP003,Thước kẻ,3000", "1258 CSV có mã hàng SP001");
ok(E.looksVietnamese1258(cp1258("ERROR Không thể đọc file config.yaml config.yaml config.yaml INFO WARN DEBUG")), "tỉ lệ âm tiết chỉ tính trên từ có byte cao (từ ASCII không kéo tỉ lệ xuống)");
// Dấu thanh tách rời ghi thẳng sau nguyên âm Latin-1 (a + 0xCC = à): bằng chứng xét theo byte gốc.
dec(bytes("Xin cha", 0xcc, "o, la", 0xcc, "m ba", 0xcc, "i ngay."), "Xin chào, làm bài ngay.", "1258 dấu thanh tổ hợp sau nguyên âm Latin-1 (chà, là, bà): vẫn là bằng chứng");
ok(E.looksVietnamese1258(bytes("Pu", 0xf2, " darsi, ci", 0xf2, " ", 0xe8, " vero."), true) === false, "jschardet nói cp1258 cũng không đủ cho tiếng Ý ngắn (chỉ 2 dấu thanh, không có ă đ ơ ư)");
ok(E.normLabel("ISO8859-7") === "iso-8859-7" && E.normLabel("iso8859-15") === "iso-8859-15" && E.normLabel("CP1250") === "windows-1250" && E.normLabel("MacRoman") === "macintosh", "chuẩn hoá tên bảng mã jschardet (iso8859- → iso-8859-)");

console.log("5. Trích thật qua tiến trình đọc tệp (docx/xlsx/csv/pptx/zip), mỗi tệp một DẤU HIỆU");
// csv
let t = parse("csv", Buffer.from("cot_a,cot_b\nDH_CSV_1,DH_CSV_2\n"), "m.csv")?.text ?? "";
ok(t.includes("DH_CSV_1") && t.includes("| cot_a | cot_b |"), "CSV: nội dung + tiêu đề", t);
// CSV đi đúng đường thật (extractor "office" → tiến trình đọc tệp, C-2): giải mã bằng cùng decodeText với tệp .txt, KHÔNG để tiến trình tự đoán bằng jschardet.
const office = E.EXTRACTORS.find((x) => x.name === "office");
const csvVia = async (buf, name) => { try { return (await office.run(buf, { name, kind: "csv" }))[0]?.text ?? ""; } catch (e) { return `ERR:${e.message}`; } };
const vnCsv = "Họ tên,Thành phố\nNguyễn Văn An,Hà Nội\nTrần Thị Bình,Hồ Chí Minh\n";
t = await csvVia(Buffer.from(vnCsv, "utf16le"), "u16le.csv");
ok(t.includes("| Họ tên | Thành phố |") && t.includes("| Nguyễn Văn An | Hà Nội |") && !t.includes("\u0000"), "CSV UTF-16LE không BOM qua tiến trình đọc: đúng chữ, không byte 0", JSON.stringify(t));
t = await csvVia(Buffer.from(vnCsv, "utf16le").swap16(), "u16be.csv");
ok(t.includes("| Trần Thị Bình | Hồ Chí Minh |") && !t.includes("\u0000"), "CSV UTF-16BE không BOM qua tiến trình đọc", JSON.stringify(t));
t = await csvVia(cp1258(vnCsv), "vn1258.csv");
ok(t.includes("| Nguyễn Văn An | Hà Nội |") && t.includes("Trần Thị Bình") && t === t.normalize("NFC"), "CSV Windows-1258 qua tiến trình đọc: chữ dựng sẵn (NFC), tìm được \"Nguyễn\"", JSON.stringify(t));
t = await csvVia(cp1252("Città,Perché\nCosì,Può\nLunedì,Però\n"), "it.csv");
ok(t.includes("| Città | Perché |") && t.includes("| Così | Può |") && !t.includes("ā"), "CSV cp1252 tiếng Ý qua tiến trình đọc: không thành Cittā / Cosė", JSON.stringify(t));
// xlsx
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Mã", "Tên"], ["DH_XLSX_K", "DH_XLSX_V"]]), "S");
t = parse("xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "m.xlsx")?.text ?? "";
ok(t.includes("DH_XLSX_K") && t.includes("DH_XLSX_V"), "XLSX: nội dung ô", t);
// docx (OOXML tối giản: một đoạn văn)
const docx = await zipOf({ "[Content_Types].xml": "<x/>", "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DH_DOCX_noi_dung</w:t></w:r></w:p></w:body></w:document>' });
t = parse("docx", docx, "m.docx")?.text ?? "";
ok(t.includes("DH_DOCX_noi_dung"), "DOCX: đoạn văn", t);
// zip với tệp chữ
const zbuf = await zipOf({ "src/readme.md": "DH_ZIP_trong_md", "data/x.bin": B(0, 1, 2) });
t = parse("zip", zbuf, "m.zip")?.text ?? "";
ok(t.includes("DH_ZIP_trong_md") && t.includes("src/readme.md"), "ZIP: liệt kê + nội dung tệp chữ", t);

console.log("6. PPTX: thứ tự slide theo presentation.xml, KHÔNG theo tên tệp");
// slide1 mang ALPHA, slide2 mang BETA; presentation.xml xếp rId2 (slide2) TRƯỚC rId1 (slide1).
const deck = await zipOf({
  "[Content_Types].xml": "<x/>",
  "ppt/presentation.xml": '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
  "ppt/_rels/presentation.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="t" Target="slides/slide2.xml"/></Relationships>',
  "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>DH_SLIDE_ALPHA</a:t></a:r></a:p></p:sld>",
  "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>DH_SLIDE_BETA</a:t></a:r></a:p></p:sld>",
});
t = parse("pptx", deck, "m.pptx")?.text ?? "";
ok(t.includes("DH_SLIDE_ALPHA") && t.includes("DH_SLIDE_BETA"), "cả hai slide đều tới model", t);
ok(t.indexOf("DH_SLIDE_BETA") < t.indexOf("DH_SLIDE_ALPHA"), "slide2 (BETA) đứng trước slide1 (ALPHA) đúng theo presentation.xml", t);
// Thuộc tính XML không có thứ tự cố định: tệp .rels ghi Target TRƯỚC Id (một số công cụ xuất kiểu này) vẫn phải theo presentation.xml.
const deckRev = await zipOf({
  "[Content_Types].xml": "<x/>",
  "ppt/presentation.xml": '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
  "ppt/_rels/presentation.xml.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Target=\"slides/slide1.xml\" Type=\"t\" Id=\"rId1\"/><Relationship Type='t' Target='slides/slide2.xml' Id='rId2'/></Relationships>",
  "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>DH_REV_ALPHA</a:t></a:r></a:p></p:sld>",
  "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>DH_REV_BETA</a:t></a:r></a:p></p:sld>",
});
t = parse("pptx", deckRev, "rev.pptx")?.text ?? "";
ok(t.includes("DH_REV_ALPHA") && t.indexOf("DH_REV_BETA") < t.indexOf("DH_REV_ALPHA"), ".rels ghi Target trước Id: vẫn đúng thứ tự presentation.xml", t);
// Dự phòng: presentation.xml không có sldIdLst → sắp theo tên tệp như cũ.
const deck2 = await zipOf({ "ppt/presentation.xml": "<x/>", "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>DH_A1</a:t></a:r></a:p></p:sld>", "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>DH_A2</a:t></a:r></a:p></p:sld>" });
t = parse("pptx", deck2, "m2.pptx")?.text ?? "";
ok(t.indexOf("DH_A1") < t.indexOf("DH_A2"), "không có sldIdLst: vẫn sắp theo tên (tương thích cũ)", t);

console.log("7. Bảng tính lớn: lặp lại dòng tiêu đề ở mỗi đoạn (RAG)");
const rows = ["## Sheet: Doanh thu (600 dòng, 3 cột)", "| Ngày | Khách | Tiền |", "| --- | --- | --- |"];
for (let i = 0; i < 600; i++) rows.push(`| 2026-01-${(i % 28) + 1} | Khách ${i} | ${i * 1000} |`);
const chunks = RAG.chunkSheet(rows.join("\n"));
ok(chunks.length >= 2, `chia được nhiều đoạn (${chunks.length})`);
ok(chunks.every((c) => c.includes("| Ngày | Khách | Tiền |")), "MỖI đoạn đều có dòng tiêu đề");
ok(chunks.slice(1).every((c) => /^\| Ngày \| Khách \| Tiền \|/.test(c.trimStart())), "đoạn thứ 2 trở đi bắt đầu bằng dòng tiêu đề");

console.log(`\n${fail ? "✗" : "✓"} ${pass}/${pass + fail} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
