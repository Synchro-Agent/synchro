// G4: ngân sách 90 giây cho lời gọi generate_image + chế độ nền (ảnh giữ chỗ, thay byte thật vào đúng id khi dựng xong).
// Thuần, không cần máy chủ: logic ngân sách (imgbudget) và ghi đè tệp đã lưu (outputs.replaceOutput).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-imgbudget-")));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "imgbudget-test";
fs.mkdirSync(tmp, { recursive: true });

const { "ai/imgbudget": B, outputs: O } = await loadTs(["ai/imgbudget", "outputs"]);

console.log("1. Ngân sách thời gian cho lời gọi công cụ");
delete process.env.SYNCHRO_IMAGE_BUDGET_SEC;
ok(B.IMG_BUDGET_MS() === 90_000, "mặc định 90 giây", B.IMG_BUDGET_MS());
process.env.SYNCHRO_IMAGE_BUDGET_SEC = "30";
ok(B.IMG_BUDGET_MS() === 30_000, "đổi bằng env", B.IMG_BUDGET_MS());
process.env.SYNCHRO_IMAGE_BUDGET_SEC = "1";
ok(B.IMG_BUDGET_MS() === 5_000, "không nhỏ hơn 5 giây", B.IMG_BUDGET_MS());
delete process.env.SYNCHRO_IMAGE_BUDGET_SEC;

console.log("2. Lời nhắn chế độ nền");
const note = B.placeholderNote({ urls: ["https://image.synchro.invalid/abc.png", "https://image.synchro.invalid/def.png"], names: ["anh-1.png", "anh-2.png"], by: "AI" });
ok(/https:\/\/image\.synchro\.invalid\/abc\.png/.test(note) && /def\.png/.test(note), "nêu đủ địa chỉ ảnh giữ chỗ", note);
ok(/inputs\/anh-1\.png/.test(note) && /inputs\/anh-2\.png/.test(note), "nêu đường dẫn inputs/ cho run_code", note);
ok(/MỘT dòng/.test(note) && /chế độ nền/.test(note) && /tự thay/.test(note), "dặn model dựng ngay, báo một dòng, ảnh tự thay vào", note);
ok(/đừng gọi lại generate_image/i.test(note), "dặn không gọi lại generate_image", note);

console.log("3. Thay byte thật vào ảnh giữ chỗ (outputs.replaceOutput)");
function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type, "latin1"); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let xx = 0; xx < w; xx++) rows.push(rgb[0], rgb[1], rgb[2]); }
  const idat = zlib.deflateSync(Buffer.from(rows));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const uid = "u-imgbudget";
const placeholder = png(1, 1, [230, 230, 230]);
const [saved] = O.saveOutputs(uid, [{ path: "anh-con-meo.png", data: placeholder }]);
ok(saved && saved.size === placeholder.length, "lưu ảnh giữ chỗ", saved);
const real = png(16, 9, [10, 120, 200]);
const after = O.replaceOutput(uid, saved.id, real);
ok(after && after.id === saved.id && after.name === saved.name, "giữ nguyên id và tên khi thay byte", after);
ok(after && after.w === 16 && after.h === 9, "cập nhật cỡ ảnh thật (16×9)", after);
const read = O.readOutput(uid, saved.id);
ok(read && read.data.equals(real) && read.size === real.length, "đọc ra byte thật đã thay vào", read && read.size);
ok(O.replaceOutput(uid, "khong-co-id-nao", real) === null, "id không tồn tại → null, không tạo tệp lạ");

console.log("4. Ảnh nền về là JPEG / WebP: mime theo byte thật (W23-2)");
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "latin1"), Buffer.alloc(64, 7)]);
const [ph2] = O.saveOutputs(uid, [{ path: "anh-nen.png", data: placeholder }]);
const j = O.replaceOutput(uid, ph2.id, jpeg);
ok(j && j.mime === "image/jpeg" && j.name === "anh-nen.png", "trả về mime image/jpeg, giữ tên cho inputs/", j);
ok(O.outputFile(uid, ph2.id)?.mime === "image/jpeg", "mime trong bảng outputs là image/jpeg (tải về, /api/artimg, /api/outputs đúng loại)", O.outputFile(uid, ph2.id)?.mime);
const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(40)]);
ok(O.replaceOutput(uid, ph2.id, webp)?.mime === "image/webp", "WebP → image/webp");
ok(O.replaceOutput(uid, ph2.id, real)?.mime === "image/png", "PNG → image/png");
ok(O.sniffImageMime(Buffer.from("không phải ảnh")) === null, "byte lạ: không đoán");

console.log("5. Trạng thái ảnh giữ chỗ: đang chờ / hỏng / xong");
const [ph3] = O.saveOutputs(uid, [{ path: "anh-cho.png", data: placeholder }]);
ok(O.genImageState(uid, ph3.id, placeholder) === "pending", "vừa giữ chỗ: đang chờ");
ok(O.genImageState(uid, ph3.id, real) === null, "byte thật: không còn chờ");
O.markGenFailed(ph3.id);
ok(O.genImageState(uid, ph3.id, placeholder) === "failed", "dựng hỏng: báo hỏng");
const { authstore: AS } = await loadTs(["authstore"]);
const [ph4] = O.saveOutputs(uid, [{ path: "anh-lau.png", data: placeholder }]);
AS.db().prepare("UPDATE outputs SET created_at = ? WHERE id = ?").run(Date.now() - O.GEN_PENDING_MS - 1000, ph4.id);
ok(O.genImageState(uid, ph4.id, placeholder) === "failed", "giữ chỗ quá lâu (máy chủ khởi động lại giữa chừng): báo hỏng");
O.replaceOutput(uid, ph3.id, real);
ok(O.genImageState(uid, ph3.id, placeholder) === "pending", "đã thay byte thật thì xóa dấu hỏng");

console.log("6. Ảnh nền về: thay vào đúng id và báo một dòng (G4.2)");
const repl = [], lost = [];
let r = B.settleBackground({ ids: ["a1", "a2"], names: ["meo.png", "cho.png"], files: [Buffer.from("x"), Buffer.from("y")], replace: (id) => (repl.push(id), true), failed: (id) => lost.push(id) });
ok(r.ok && repl.join() === "a1,a2" && !lost.length && r.line === "Ảnh meo.png, cho.png đã xong, đã thay vào artifact", "đủ ảnh: thay cả hai, một dòng báo xong", r.line);
repl.length = 0;
r = B.settleBackground({ ids: ["a1", "a2"], names: ["meo.png", "cho.png"], files: [Buffer.from("x")], replace: (id) => (repl.push(id), true), failed: (id) => lost.push(id) });
ok(!r.ok && repl.join() === "a1" && lost.join() === "a2" && /đã xong, đã thay vào artifact; không dựng được cho\.png$/.test(r.line), "trả thiếu ảnh: ảnh còn lại đánh dấu hỏng", r.line);
lost.length = 0;
r = B.settleBackground({ ids: ["a1"], names: ["meo.png"], files: null, replace: () => true, failed: (id) => lost.push(id) });
ok(!r.ok && lost.join() === "a1" && r.line === "Không dựng được ảnh meo.png, artifact vẫn giữ khung giữ chỗ", "dựng hỏng: một dòng báo hỏng", r.line);
lost.length = 0;
r = B.settleBackground({ ids: ["a1"], names: ["meo.png"], files: [Buffer.from("x")], replace: () => { throw new Error("đĩa đầy"); }, failed: (id) => lost.push(id) });
ok(!r.ok && lost.join() === "a1", "thay byte lỗi: đánh dấu hỏng, không ném lỗi");
const eng = fs.readFileSync("server/chatengine.ts", "utf8");
ok(/settleBackground\(\{ ids, names, files, failed: markGenFailed,/.test(eng) && /if \(rid && liveText\(rid\)\) \{ const seq = progress\("tool", r\.line\); if \(seq\) progress\("res"/.test(eng), "chatengine: lượt còn chạy thì dòng báo thành một bước trong nhật ký");
ok(/void gen\.then\(\(res\) => settle\(res\.ok \? res\.files\.map\(\(f\) => f\.data\) : null\), \(\) => settle\(null\)\);/.test(eng), "chatengine: dựng hỏng / lỗi cũng báo, không im lặng");
const { "i18n-dict": D } = await loadTs(["i18n-dict"]);
const en = (s) => { if (Object.prototype.hasOwnProperty.call(D.VI2EN, s)) return D.VI2EN[s]; for (const [re, f] of D.RULES_EN) { const m = s.match(re); if (m) return f(m); } return s; };
ok(en("Đang Ảnh meo.png đã xong, đã thay vào artifact") === "Image meo.png is ready and now in the artifact", "nhãn nhật ký có bản tiếng Anh", en("Đang Ảnh meo.png đã xong, đã thay vào artifact"));
ok(en("Đang Không dựng được ảnh meo.png, artifact vẫn giữ khung giữ chỗ") === "Couldn't make image meo.png; the artifact keeps the placeholder", "nhãn hỏng có bản tiếng Anh", en("Đang Không dựng được ảnh meo.png, artifact vẫn giữ khung giữ chỗ"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
