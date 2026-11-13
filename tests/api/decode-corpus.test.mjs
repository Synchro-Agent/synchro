// Bộ mẫu giải mã văn bản (Blueprint C3.5): mỗi mẫu là byte chính xác của một bảng mã thật, kết quả decodeText phải TRÙNG KHÍT chuỗi gốc.
// Nguyên tắc "không làm hỏng": thêm UTF-16 không BOM / Windows-1258 / UTF-8 gần hợp lệ không được làm sai văn bản Tây Âu, Trung Âu, Baltic, Thổ,
// Kirin, Hy Lạp, Nhật, Hàn mà bản gốc (tin thẳng jschardet) đã đọc đúng.
// Không cần máy chủ: decodeText là hàm thuần (loadTs). Chạy: node tests/api/decode-corpus.test.mjs
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

const R = createRequire(path.join(process.cwd(), "package.json"));
const jschardet = R("jschardet");
const { "fileproc/extractors": E } = await loadTs(["fileproc/extractors"]);

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const B = (...a) => Buffer.from(a);
const hex = (h) => Buffer.from(h.replace(/\s+/g, ""), "hex");

// Bộ mã hoá một byte dựng từ bảng WHATWG của TextDecoder (Node không có TextEncoder cho mã cũ). Ký tự không có trong bảng: báo lỗi ngay (mẫu sai).
const sb = (enc) => {
  const t = new Map(); const d = new TextDecoder(enc);
  for (let b = 0x80; b < 256; b++) { const c = d.decode(B(b)); if (c !== "\uFFFD") t.set(c, b); }
  return (s) => Buffer.from([...s].map((c) => {
    if (c.charCodeAt(0) < 0x80) return c.charCodeAt(0);
    if (!t.has(c)) throw new Error(`${enc} không có ký tự ${c}`);
    return t.get(c);
  }));
};
// Windows-1258 như WideCharToMultiByte của Windows: chữ dựng sẵn nếu bảng mã có (à, ê, ô, ă, ơ, ư, đ…), không thì chữ gốc + byte dấu thanh tổ hợp.
const T1258 = new Map(); { const d = new TextDecoder("windows-1258"); for (let b = 0x80; b < 256; b++) { const c = d.decode(B(b)); if (c !== "\uFFFD") T1258.set(c, b); } }
const TONE = { "\u0300": 0xcc, "\u0301": 0xec, "\u0303": 0xde, "\u0309": 0xd2, "\u0323": 0xf2 };
const cp1258 = (s) => {
  const out = [];
  for (const ch of s.normalize("NFC")) {
    if (ch.charCodeAt(0) < 0x80) { out.push(ch.charCodeAt(0)); continue; }
    if (T1258.has(ch)) { out.push(T1258.get(ch)); continue; }
    const parts = [...ch.normalize("NFD")], tone = parts.find((c) => TONE[c]), base = parts.filter((c) => !TONE[c]).join("").normalize("NFC");
    const bb = base.charCodeAt(0) < 0x80 ? base.charCodeAt(0) : T1258.get(base);
    if (bb === undefined || !tone) throw new Error(`cp1258 không ghi được ${ch}`);
    out.push(bb, TONE[tone]);
  }
  return Buffer.from(out);
};
const enc = {
  "windows-1252": sb("windows-1252"), "windows-1250": sb("windows-1250"), "windows-1257": sb("windows-1257"), "windows-1254": sb("windows-1254"),
  "windows-1251": sb("windows-1251"), "koi8-r": sb("koi8-r"), "windows-1253": sb("windows-1253"), "windows-1258": cp1258,
};

const det = (b) => jschardet.detect(b.toString("binary")).encoding;
/** Một mẫu: byte của bảng mã thật; tự kiểm mẫu (giải đúng bảng mã đó ra lại chuỗi gốc) rồi so decodeText với chuỗi gốc. */
const sample = (name, bytes, want, trueEnc) => {
  if (trueEnc) {
    const self = new TextDecoder(trueEnc).decode(bytes);
    if ((trueEnc === "windows-1258" ? self.normalize("NFC") : self) !== want) throw new Error(`mẫu "${name}" không phải ${trueEnc} hợp lệ`);
  }
  const got = E.decodeText(bytes);
  ok(got === want, `${name} [jschardet: ${det(bytes)}]`, JSON.stringify(got));
};
const round = (e, name, s) => sample(name, enc[e](s), s, e);

// ---------------------------------------------------------------------------
console.log("1. Tiếng Việt Windows-1258 (đọc ra chữ dựng sẵn NFC)");
round("windows-1258", "1258 văn xuôi dài", "Tiếng Việt là ngôn ngữ chính thức của Việt Nam. Đây là tiếng mẹ đẻ của khoảng 85% dân số Việt Nam, cùng với hơn bốn triệu người Việt hải ngoại. " +
  "Tiếng Việt được dùng trong giáo dục, báo chí và các văn bản của nhà nước. Những người học tiếng Việt thường thấy hệ thống thanh điệu là phần khó nhất.\r\n" +
  "Năm 2026, công ty đã mở thêm hai văn phòng ở Đà Nẵng và Cần Thơ để phục vụ khách hàng tốt hơn.");
round("windows-1258", "1258 câu ngắn (đã, đơn)", "Công ty đã gửi hóa đơn cho khách.");
round("windows-1258", "1258 câu ngắn (bị, đi)", "Chị bị ốm, mẹ đi chợ.");
round("windows-1258", "1258 hoá đơn (HĐ, SĐT, MST, mã, email, địa chỉ)",
  "HÓA ĐƠN GIÁ TRỊ GIA TĂNG\r\nSố HĐ: HD-2026/0001; Ký hiệu: 1C26TAA\r\nĐơn vị bán: Công ty TNHH ABC\r\nMST: 0101234567\r\n" +
  "Địa chỉ: 12 Nguyễn Trãi, P. Bến Thành, Q.1, TP.HCM\r\nSĐT: 0901 234 567 - Email: ketoan@abc.com.vn\r\nTổng cộng: 1.100.000 VNĐ");
round("windows-1258", "1258 dòng hoá đơn một dòng (HĐ, Đơn vị, SĐT)", "Số HĐ: HD-2026/0001; MST: 0101234567; Đơn vị: Cty TNHH ABC; SĐT: 0901234567");
round("windows-1258", "1258 địa chỉ trường (ĐH, CNTT, SĐT liên hệ)", "Trường ĐH Bách Khoa, Khoa CNTT. SĐT liên hệ: 0901234567.");
round("windows-1258", "1258 dòng lỗi lẫn ASCII", "ERROR Không thể đọc file config.yaml");
round("windows-1258", "1258 CSV có mã hàng", "Mã SP,Tên sản phẩm,Giá\r\nSP001,Bút bi Thiên Long,5000\r\nSP002,Vở học sinh,12000\r\nSP003,Thước kẻ,3000");
round("windows-1258", "1258 CSV họ tên / thành phố", "Họ tên,Thành phố\nNguyễn Văn An,Hà Nội\nTrần Thị Bình,Hồ Chí Minh\n");

console.log("2. Tiếng Việt UTF-8 (trọn vẹn, cụt ký tự cuối, lẫn byte lạ)");
const vnLong = "Tiếng Việt là ngôn ngữ chính thức của Việt Nam. Người Việt dùng chữ Quốc ngữ với các dấu thanh: sắc, huyền, hỏi, ngã, nặng.\n";
sample("UTF-8 tiếng Việt", Buffer.from(vnLong, "utf8"), vnLong);
sample("UTF-8 có BOM (BOM bị gỡ)", Buffer.concat([B(0xef, 0xbb, 0xbf), Buffer.from(vnLong, "utf8")]), vnLong);
sample("UTF-8 dài cụt ký tự cuối", Buffer.concat([Buffer.from(vnLong.repeat(20), "utf8"), B(0xe1, 0xbb)]), vnLong.repeat(20) + "\uFFFD");
sample("UTF-8 ngắn cụt ký tự cuối: Tiếng Việt", Buffer.concat([Buffer.from("Tiếng Việt", "utf8"), B(0xe1)]), "Tiếng Việt\uFFFD");
sample("UTF-8 ngắn cụt ký tự cuối: Xin chào", Buffer.concat([Buffer.from("Xin chào", "utf8"), B(0xe1)]), "Xin chào\uFFFD");
sample("UTF-8 ngắn cụt ký tự cuối: Giá: 50.000đ", Buffer.concat([Buffer.from("Giá: 50.000đ", "utf8"), B(0xe1)]), "Giá: 50.000đ\uFFFD");
sample("UTF-8 ngắn cụt ký tự cuối: café", Buffer.concat([Buffer.from("Hello world, café", "utf8"), B(0xc3)]), "Hello world, café\uFFFD");
const half = vnLong.repeat(5);
sample("UTF-8 dài lẫn một byte lạ 0x96", Buffer.concat([Buffer.from(half, "utf8"), B(0x96), Buffer.from(half, "utf8")]), half + "\uFFFD" + half);
sample("UTF-8 ngắn có BOM lẫn một byte lạ", Buffer.concat([Buffer.from("\uFEFFXin chào bạn, ", "utf8"), B(0x96), Buffer.from(" hẹn gặp lại.", "utf8")]), "Xin chào bạn, \uFFFD hẹn gặp lại.");

console.log("3. Tây Âu cp1252 (không thành tiếng Việt / Hy Lạp / Kirin)");
round("windows-1252", "Bồ Đào Nha dài", "São Paulo não é uma cidade pequena; as lições estão nas canções. A informação está disponível para todos os cidadãos, e a população não pára de crescer.");
round("windows-1252", "Bồ Đào Nha ngắn", "Não sei, mãe.");
round("windows-1252", "Ý ngắn: Ciò detto", "Ciò detto, può andare. Può anche restare.");
round("windows-1252", "Ý ngắn: Chi può dirlo", "Chi può dirlo? Ciò è un mistero. Nessuno può saperlo.");
round("windows-1252", "Ý ngắn: Non può farlo", "Non può farlo, ciò è vero, può darsi, ciò che può.");
round("windows-1252", "Ý ngắn: Può darsi", "Può darsi, ciò è vero.");
round("windows-1252", "Ý dài", "Così è la vita, perciò non può essere più facile. Lunedì andrò là. La città è bellissima e la gente è gentile; perché non venire? Sarò lì alle tre, poi andrò a Forlì.");
round("windows-1252", "Tây Ban Nha", "Año nuevo, vida nueva. ¿Qué tal? La señora Pérez está en la estación; mañana viajará a Córdoba.");
round("windows-1252", "Pháp ngắn", "Hélène a écrit à Jérôme.");
round("windows-1252", "Pháp ngắn: Café crème", "Café crème: 3,50€");
round("windows-1252", "Pháp dài", "Le cœur a ses raisons que la raison ne connaît point. Où êtes-vous allés cet été ? Nous étions à la mer, près de Nîmes, et c'était très agréable. Ça va être difficile, mais là, je suis sûr.");
round("windows-1252", "Iceland", "Það er gott að vera hér, þú ert með. Ég ætla að fara heim á morgun og hitta fjölskylduna mína. Ýmislegt þýðir ekkert.");
round("windows-1252", "Tây Ban Nha viết hoa (jschardet: MacRoman, bản gốc ra cp1252)", "EL NIÑO COMIÓ.");
round("windows-1252", "Đức", "Größere Änderungen müssen über die Straße geprüft werden. Schöne Grüße aus München.");

console.log("4. Trung Âu / Baltic / Thổ (jschardet đoán đúng: tin như bản gốc)");
round("windows-1250", "Ba Lan CSV (Windows-1250)", "Imię,Nazwisko,Miasto\nJan,Kowalski,Łódź\nAnna,Wiśniewska,Gdańsk");
round("windows-1250", "Ba Lan câu (Windows-1250)", "Proszę o kontakt w sprawie zamówienia. Dziękuję bardzo.");
round("windows-1250", "Ba Lan ngắn (Windows-1250)", "Cześć, jak się masz?");
round("windows-1250", "Ba Lan địa chỉ (Windows-1250)", "Imię i nazwisko: Józef Wiśniewski, Poznań, ul. Długa 5");
round("windows-1250", "Ba Lan pangram (Windows-1250)", "Zażółć gęślą jaźń. Łódź, Kraków, Wrocław.");
round("windows-1250", "Séc (Windows-1250)", "Faktura číslo 2026/001 je splatná");
round("windows-1250", "Séc câu (Windows-1250)", "Dobrý den, jak se máte? Děkuji, mám se dobře. Kde je nádraží?");
round("windows-1250", "Slovene (Windows-1250)", "Šola, čaj, žaba");
round("windows-1257", "Litva (Windows-1257)", "Ačiū labai. Klaipėda yra uostamiestis, o Vilnius – sostinė. Šiandien gražus oras.");
round("windows-1257", "Latvia (Windows-1257)", "Ļoti skaista diena Rīgā");
round("windows-1257", "Latvia CSV (Windows-1257)", "Vārds,Pilsēta\nJānis,Rīga");
round("windows-1254", "Thổ ngắn (Windows-1254)", "Lütfen kapıyı kapatın.");
round("windows-1254", "Thổ dài (Windows-1254)", "Lütfen kapıyı kapatın. Kapı açık mı? Bugün hava çok güzel, değil mi? İstanbul'da yaşıyorum ve işim çok yoğun.");

console.log("5. Kirin / Hy Lạp");
const ru = "Привет, как дела? Это тестовый файл для проверки кодировки. Москва — столица России.";
round("windows-1251", "Nga (Windows-1251)", ru);
round("koi8-r", "Nga (KOI8-R)", ru.replace("—", "-")); // KOI8-R không có dấu gạch dài
round("windows-1251", "Nga một từ hai chữ (Windows-1251)", "Да");
round("windows-1251", "Nga lẫn ASCII (Windows-1251)", "ERROR 2026-01-01 Ошибка: файл config.yaml не найден (code=404). Повторите попытку через 5 минут.");
round("windows-1253", "Hy Lạp (Windows-1253)", "Καλημέρα κόσμε. Αυτό είναι ένα δοκιμαστικό αρχείο για την κωδικοποίηση.");

console.log("6. Nhật Shift_JIS / Hàn EUC-KR (jschardet: CP932 / CP949)");
sample("Nhật (Shift_JIS)", hex("93fa967b8cea82cc8365834c8358836782c582b7814282b182ea82cd95b68e9a8352815b836882cc83658358836782c582b78142938c8b9e82cd93fa967b82cc8ef1937382c582b78142"),
  "日本語のテキストです。これは文字コードのテストです。東京は日本の首都です。", "shift_jis");
sample("Nhật hoá đơn (Shift_JIS)", hex("90bf8b818f9194d48d868146412d3130323481408d878c768be08a7a814631322c383030897e816990c58d9e816a"), "請求書番号：A-1024　合計金額：12,800円（税込）", "shift_jis");
sample("Hàn (EUC-KR)", hex("c0ccb0cdc0ba20c7d1b1b9beee20c5d8bdbac6aec0d4b4cfb4d92e20b9aec0da20c0cec4dab5f920c5d7bdbac6aec0d4b4cfb4d92e20bcadbfefc0ba20c7d1b1b9c0c720bcf6b5b5c0d4b4cfb4d92e"),
  "이것은 한국어 텍스트입니다. 문자 인코딩 테스트입니다. 서울은 한국의 수도입니다.", "euc-kr");
sample("Hàn đơn hàng (EUC-KR)", hex("c1d6b9ae20b9f8c8a33a20323032362d303034322c20b0edb0b420c0ccb8a73a20b1e8b9cebcf62c20b1ddbed73a2033352c303030bff8"), "주문 번호: 2026-0042, 고객 이름: 김민수, 금액: 35,000원", "euc-kr");

console.log("7. UTF-16 có / không BOM, và bảng số 16-bit nhị phân");
const u16s = "Họ tên,Thành phố\nNguyễn Văn An,Hà Nội\nTrần Thị Bình,Hồ Chí Minh\nHélène,Paris\n";
const le = Buffer.from(u16s, "utf16le"), be = Buffer.from(u16s, "utf16le").swap16();
sample("UTF-16LE có BOM", Buffer.concat([B(0xff, 0xfe), le]), u16s);
sample("UTF-16BE có BOM", Buffer.concat([B(0xfe, 0xff), be]), u16s);
sample("UTF-16LE không BOM", le, u16s);
sample("UTF-16BE không BOM", be, u16s);
// Bảng số nguyên 16-bit (little-endian): nửa số byte là 0 như UTF-16 nhưng giải ra toàn ký tự điều khiển, nên không được đọc thành UTF-16.
const table = Buffer.alloc(2048); for (let i = 0; i < 1024; i++) table.writeUInt16LE((i * 37) % 512, i * 2);
const tGot = E.decodeText(table);
ok(tGot !== new TextDecoder("utf-16le").decode(table) && tGot.length === table.length, "bảng 16-bit nhị phân: không giải như UTF-16 (mỗi byte một ký tự)", `${tGot.length} ký tự`);

console.log("8. Bằng chứng Windows-1258: văn bản Tây Âu không bao giờ đủ (a)");
for (const s of ["Ciò detto, può andare. Può anche restare.", "Il est là. Je suis là. Et toi, tu es là?", "Lunedì andrò là, e là resto.", "Não sei, mãe. São Paulo não pára.", "Það er gott að vera hér, þú ert með."])
  ok(E.looksVietnamese1258(enc["windows-1252"](s), true) === false, `không phải 1258 kể cả khi jschardet nói cp1258: ${s}`);
ok(E.looksVietnamese1258(enc["windows-1254"]("Kapı açık mı? Bu kız çok akıllı."), true) === false, "tiếng Thổ (ı → ư, ğ → đ) không phải 1258");
ok(E.normLabel("CP932") === "shift_jis" && E.normLabel("CP949") === "euc-kr" && E.normLabel("ISO8859-7") === "iso-8859-7" && E.normLabel("cp1258") === "windows-1258" && E.normLabel("MacRoman") === "macroman",
  "chuẩn hoá nhãn jschardet (CP932 → shift_jis, CP949 → euc-kr, iso8859-N → iso-8859-N, cpNNNN → windows-NNNN; MacRoman để nguyên như bản gốc)");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
