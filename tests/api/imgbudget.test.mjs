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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
