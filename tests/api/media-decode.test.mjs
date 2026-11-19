// Đọc ảnh HEIC, tệp Office cũ và hai tệp cùng tên trong một tin, không cần máy chủ:
// - Bộ giải HEIC (server/fileproc/heic.ts): chọn công cụ, tham số, trần thời gian, trần điểm ảnh, lỗi rõ cho người
//   dùng, bằng công cụ giả (tệp shell) nên chạy được ở mọi máy; giải thật ảnh mẫu khi máy có bộ giải (heif-dec,
//   heif-convert, sips), không có thì bỏ qua và nói rõ.
// - Office cũ: tệp .doc thật (tests/fixtures/media/legacy.doc) qua detectKind → LibreOffice (giả) → trình đọc .docx.
// - Trang Sức khỏe hệ thống (server/fileproc/mediacaps.ts): trạng thái ok / off / missing / broken của ba bộ đọc.
// - Tên thẻ tệp đính kèm (ui/filestate.ts attachKeys / attachFiles, shared/fileproc/names.ts).
import path from "node:path";
import os from "node:os";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

const R = createRequire(path.join(process.cwd(), "package.json"));
const sharp = R("sharp");
const JSZip = R("jszip");
let pass = 0;
let fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400));
};
const errOf = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const msg = (e) => e?.message ?? "";

const mods = await loadTs(["server/fileproc/heic", "server/fileproc/extractors", "server/fileproc/detect",
  "server/fileproc/mediacaps", "shared/fileproc/names", "ui/filestate"]);
const H = mods["server/fileproc/heic"];
const E = mods["server/fileproc/extractors"];
const D = mods["server/fileproc/detect"];
const M = mods["server/fileproc/mediacaps"];
const N = mods["shared/fileproc/names"];
const F = mods["ui/filestate"];

const FIX = path.join(process.cwd(), "tests", "fixtures", "media");
const HEIC = readFileSync(path.join(FIX, "tiny.heic"));
const DOC = readFileSync(path.join(FIX, "legacy.doc"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "synchro-media-"));
// Công cụ giả: tệp shell ghi PNG mẫu ra tham số cuối (heif-dec in out, sips … --out out) và ghi lại lần gọi.
const png64 = path.join(tmp, "sample.png");
const blue = { width: 64, height: 48, channels: 3, background: "#3366cc" };
writeFileSync(png64, await sharp({ create: blue }).png().toBuffer());
const script = (name, body) => {
  const p = path.join(tmp, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};
const calls = path.join(tmp, "calls.log");
const lastCall = () => readFileSync(calls, "utf8").trim().split("\n").pop();
const fakeDec = script("heif-dec", `echo "$@" >> "${calls}"; for a; do last="$a"; done; cp "${png64}" "$last"`);
const tool = (bin) => ({ bin, args: (s, o) => [s, o] });
const ctx = (name, kind) => ({ name, kind, uid: "u1" });

console.log("1. Kích thước khai trong tệp HEIF (chặn ảnh khổng lồ trước khi giải mã)");
const size = H.heifSize(HEIC);
ok(size?.width === 64 && size?.height === 48, "ảnh mẫu 64×48 đọc từ hộp ispe", JSON.stringify(size));
ok(H.heifSize(Buffer.from("không phải heif")) === null, "tệp không có hộp ispe → null");
// Hộp mdat chứa 4 byte "ispe" kèm số rác (dữ liệu nén tình cờ trùng): không được đọc nhầm thành kích thước ảnh.
const fakeMdat = Buffer.alloc(32);
fakeMdat.writeUInt32BE(32, 0);
fakeMdat.write("mdat", 4, "latin1");
fakeMdat.write("ispe", 12, "latin1");
fakeMdat.writeUInt32BE(0xffffff, 20);
fakeMdat.writeUInt32BE(0xffffff, 24);
const noisy = H.heifSize(Buffer.concat([HEIC, fakeMdat]));
ok(noisy?.width === 64 && noisy?.height === 48, "chỉ đọc ispe trong hộp meta, bỏ qua byte trùng trong mdat", noisy);

console.log("2. Chọn công cụ giải HEIC");
const bin2 = mkdtempSync(path.join(tmp, "bin-"));
for (const n of ["heif-dec", "heif-convert"]) script(path.relative(tmp, path.join(bin2, n)), "exit 0");
const pick = H.heifTools({ PATH: bin2 }, "linux").map((t) => path.basename(t.bin));
ok(pick.join(",") === "heif-dec,heif-convert", "PATH có heif-dec và heif-convert → heif-dec trước", pick);
const own = H.heifTools({ PATH: bin2, SYNCHRO_HEIF_BIN: fakeDec }, "linux").map((t) => t.bin);
ok(own[0] === fakeDec, "SYNCHRO_HEIF_BIN đứng đầu danh sách", own);
ok(H.heifTools({ PATH: path.join(tmp, "khong-co") }, "linux").length === 0, "không có công cụ nào → danh sách rỗng");
if (process.platform === "darwin") {
  const s = H.heifTools({ PATH: "" }, "darwin")[0];
  const args = s?.args("a", "b").join(" ");
  ok(path.basename(s?.bin ?? "") === "sips" && args === "-s format png a --out b", "macOS: sips -s format png … --out",
    args);
}

console.log("3. Giải HEIC bằng công cụ ngoài (giả)");
const got = await H.heicToPng(HEIC, "anh.heic", { tools: [tool(fakeDec)], sharp: false });
const gm = await sharp(got.data).metadata();
ok(gm.format === "png" && gm.width === 64 && got.via === "heif-dec", "trả PNG công cụ ghi ra, via = tên công cụ",
  `${gm.format} ${gm.width} ${got.via}`);
ok(/in\.heic \S+out\.png$/.test(lastCall()), "gọi công cụ với (tệp vào, tệp PNG ra) trong thư mục tạm", lastCall());
const sleeper = script("heif-slow", "sleep 5");
const t0 = Date.now();
const slow = await errOf(H.heicToPng(HEIC, "cham.heic", { tools: [tool(sleeper)], sharp: false, timeoutMs: 400 }));
const took = Date.now() - t0;
ok(/quá lâu/.test(msg(slow)) && took < 3000, `công cụ treo bị dừng ở trần thời gian (${took} ms), báo "quá lâu"`,
  msg(slow));
const broken = script("heif-broken", "echo 'Error decoding image' >&2; exit 1");
const bad = await errOf(H.heicToPng(HEIC, "hong.heic", { tools: [tool(broken)], sharp: false }));
ok(/tệp có thể bị hỏng/.test(msg(bad)), "công cụ báo lỗi → lý do “tệp có thể bị hỏng”", msg(bad));
const none = await errOf(H.heicToPng(HEIC, "a.heic", { tools: [], sharp: false }));
ok(/chưa cài bộ giải mã\./.test(msg(none)), "không có công cụ → “chưa cài bộ giải mã”", msg(none));
const before = readFileSync(calls, "utf8").length;
const huge = await errOf(H.heicToPng(HEIC, "to.heic", { tools: [tool(fakeDec)], sharp: false, maxPixels: 1000 }));
ok(/quá lớn \(64×48 điểm ảnh\)/.test(msg(huge)) && readFileSync(calls, "utf8").length === before,
  "vượt trần điểm ảnh → từ chối, KHÔNG gọi công cụ", msg(huge));
const rac = Buffer.from("ftypheic rác");
const junk = await errOf(H.heicToPng(rac, "rac.heic", { tools: [tool(fakeDec)], sharp: false }));
ok(/bị hỏng, không đọc được/.test(msg(junk)), "tệp không có hộp ispe → “bị hỏng”", msg(junk));

console.log("4. Đường tải lên: HEIC → PNG cho model");
process.env.SYNCHRO_HEIF_BIN = fakeDec;
const blocks = await E.pickExtractor("image/heic", "IMG_0001.HEIC").run(HEIC, ctx("IMG_0001.HEIC", "image/heic"));
ok(blocks.length === 1 && blocks[0].type === "image" && blocks[0].media_type === "image/png", "khối ảnh PNG",
  JSON.stringify(blocks[0]).slice(0, 80));
delete process.env.SYNCHRO_HEIF_BIN;

console.log("5. Giải HEIC thật (bộ giải cài trên máy này)");
if (!H.heifTools().length && !H.sharpHasHevc()) {
  console.log("  - BỎ QUA: máy này không có heif-dec / heif-convert / sips, sharp không có bộ giải HEVC"
    + " (cài libheif-examples để chạy phần này)");
} else {
  const r = await H.heicToPng(HEIC, "that.heic");
  const { data, info } = await sharp(r.data).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [...data.subarray(i, i + 3)];
  };
  const [rr, gg, bb] = at(10, 10);
  const [r2, , b2] = at(50, 40);
  ok(info.width === 64 && info.height === 48, `giải bằng ${r.via}: 64×48`, `${info.width}×${info.height}`);
  ok(rr > 200 && gg < 70 && bb < 70 && b2 > 150 && r2 < 90, "điểm (10,10) đỏ, (50,40) xanh như ảnh gốc",
    `${at(10, 10)} ${at(50, 40)}`);
}

console.log("6. Office cũ (.doc thật) → LibreOffice → trình đọc .docx");
delete process.env.SYNCHRO_SOFFICE_BIN;
ok(/Office cũ/.test(msg(await errOf(D.detectKind(DOC, "cu.doc")))), "chưa đặt SYNCHRO_SOFFICE_BIN: báo lưu lại .docx");
const W = "http://schemas.openxmlformats.org";
const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="${W}/package/2006/content-types">`
  + `<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" `
  + `ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="${W}/package/2006/relationships">`
  + `<Relationship Id="r1" Type="${W}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
  + "</Relationships>");
zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="${W}/wordprocessingml/2006/main">`
  + "<w:body><w:p><w:r><w:t>DAUHIEU_DOC_CU đã chuyển</w:t></w:r></w:p></w:body></w:document>");
const docx = path.join(tmp, "converted.docx");
writeFileSync(docx, await zip.generateAsync({ type: "nodebuffer" }));
const soffice = script("soffice", [
  `echo "$@" >> "${calls}"`,
  `if [ "$2" = "--version" ]; then echo "LibreOffice 7.6.4.1 60(Build:1)"; exit 0; fi`,
  `out=""; prev=""; for a; do [ "$prev" = "--outdir" ] && out="$a"; prev="$a"; last="$a"; done`,
  `case "$last" in *.doc) cp "${docx}" "$out/in.docx" ;; *) exit 3 ;; esac`,
].join("\n"));
process.env.SYNCHRO_SOFFICE_BIN = soffice;
ok(await D.detectKind(DOC, "cu.doc") === "legacy-office", "có SYNCHRO_SOFFICE_BIN: .doc → legacy-office");
const doc = await E.pickExtractor("legacy-office", "cu.doc").run(DOC, ctx("cu.doc", "legacy-office"));
ok(doc[0]?.type === "text" && doc[0].text.includes("DAUHIEU_DOC_CU"), "nội dung .docx đã chuyển tới model",
  JSON.stringify(doc).slice(0, 200));
ok(/--headless .*--convert-to docx --outdir \S+ \S+in\.doc$/.test(lastCall()),
  "gọi soffice --headless --convert-to docx (nhận đúng .doc)", lastCall());
process.env.SYNCHRO_SOFFICE_BIN = path.join(tmp, "khong-co-soffice");
const miss = await errOf(E.pickExtractor("legacy-office", "cu.doc").run(DOC, ctx("cu.doc", "legacy-office")));
ok(/máy chủ chưa chuyển được/.test(msg(miss)), "đặt biến mà chưa cài LibreOffice → lý do rõ, không treo", msg(miss));

console.log("7. Sức khỏe hệ thống: đo ba bộ đọc tệp");
const fakePy = script("python", `case "$2" in *rapidocr*) echo "rapidocr-onnxruntime 1.3.24"; exit 0 ;; esac; exit 1`);
process.env.SYNCHRO_HEIF_BIN = fakeDec;
process.env.SYNCHRO_SOFFICE_BIN = soffice;
process.env.SYNCHRO_OCR = "1";
process.env.PYTHON_BIN = fakePy;
let c = await M.mediaCaps(0);
const js = (x) => JSON.stringify(x);
ok(c.heic.state === "ok" && c.heic.version === "heif-dec", "HEIC: giải được ảnh mẫu → ok (heif-dec)", js(c.heic));
ok(c.office.state === "ok" && /LibreOffice 7\.6/.test(c.office.version ?? ""), "Office: soffice --version → ok",
  js(c.office));
ok(c.ocr.state === "ok" && /rapidocr/.test(c.ocr.version ?? ""), "OCR: nạp được thư viện → ok", js(c.ocr));
process.env.SYNCHRO_HEIF_BIN = broken;
process.env.SYNCHRO_SOFFICE_BIN = path.join(tmp, "khong-co-soffice");
process.env.PYTHON_BIN = script("python-hong", "echo 'ModuleNotFoundError: rapidocr_onnxruntime' >&2; exit 1");
c = await M.mediaCaps(0);
ok(c.heic.state === "broken", "HEIC: công cụ có mà giải hỏng → broken", js(c.heic));
ok(c.office.state === "missing" && c.office.on, "Office: đặt biến mà không có chương trình → missing", js(c.office));
ok(c.ocr.state === "broken", "OCR: thiếu thư viện → broken", js(c.ocr));
delete process.env.SYNCHRO_SOFFICE_BIN;
delete process.env.SYNCHRO_OCR;
c = await M.mediaCaps(0);
ok(c.office.state === "off" && c.ocr.state === "off", "chưa đặt SYNCHRO_SOFFICE_BIN / SYNCHRO_OCR → off",
  js([c.office, c.ocr]));
ok(existsSync(path.join(process.cwd(), "scripts", "media-probe.heic")), "ảnh mẫu của phép đo có trong scripts/");

console.log("8. Tên riêng cho tệp trùng tên trong một tin");
ok(N.nthName("báo cáo.pdf", 2) === "báo cáo (2).pdf", "“x (n).đuôi”");
ok(N.nthName(".env", 3) === ".env (3)" && N.nthName("README", 2) === "README (2)", "tệp ẩn, tệp không đuôi: số ở cuối");
const dn = N.distinctNames([["a.txt", "1"], ["a.txt", "2"], ["a.txt", "1"], ["a.txt", "3"]], (x) => x[0], (x) => x[1]);
ok(dn.join("|") === "a.txt|a (2).txt|a.txt|a (3).txt", "khác nội dung → số mới; trùng nội dung → chung tên", dn);
// Trình duyệt: XMLHttpRequest giả không bao giờ xong (chỉ cần trạng thái "đang tải"), đủ để kiểm khóa thẻ.
globalThis.XMLHttpRequest = class { upload = {}; open() {} send() {} abort() {} };
const t1 = new File(["DAUHIEU_MOT"], "ghi chu.txt", { lastModified: 1 });
const t2 = new File(["DAUHIEU_HAI dài hơn"], "ghi chu.txt", { lastModified: 2 });
const a = F.attachFiles([], [t1, t2]);
ok(a.files.join("|") === "ghi chu.txt|ghi chu (2).txt", "hai tệp cùng tên khác nội dung, cùng lần thêm → hai thẻ",
  a.files);
ok(F.getBlob("ghi chu.txt") === t1 && F.getBlob("ghi chu (2).txt") === t2, "mỗi thẻ giữ đúng tệp của nó");
const up = (k) => F.getStatus(k)?.state === "uploading";
ok(up("ghi chu.txt") && up("ghi chu (2).txt"), "cả hai cùng được tải lên");
const again = F.attachFiles(a.files, [t2]);
ok(again.files.join("|") === a.files.join("|") && again.keys[0] === "ghi chu (2).txt",
  "kéo lại đúng tệp thứ hai → giữ thẻ cũ, không thêm", again);
const t3 = new File(["DAUHIEU_BA"], "ghi chu.txt", { lastModified: 3 });
ok(F.attachKeys([t3], a.files)[0] === "ghi chu (3).txt", "tệp thứ ba cùng tên → “ghi chu (3).txt”");
ok(F.attachKeys([t3], [])[0] === "ghi chu.txt", "tin mới (không còn thẻ nào) → dùng lại tên gốc");

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? "✗" : "✓"} ${pass}/${pass + fail} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
