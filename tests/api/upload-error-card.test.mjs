// Thẻ tệp lỗi: lý do hiện NGAY thành chữ dưới thẻ (không phải chỉ trong title khi rê chuột), kèm nút Thử lại / Bỏ.
// Nguồn của lý do là fileproc/detect.ts (hàm thuần, không cần máy chủ): một tệp .xyz nhị phân cho lý do rõ ràng.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { "fileproc/detect": D, "fileproc/types": T } = await loadTs(["fileproc/detect", "fileproc/types"]);

console.log("1. Tệp .xyz nhị phân: có lý do rõ ràng để hiện trên thẻ");
const bin = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x7f, 0x00, 0x10, 0x00, 0x00, 0x00]);
let reason = "", errObj = null;
try { await D.detectKind(bin, "la.xyz"); } catch (e) { reason = e.message; errObj = e; }
ok(reason.length > 0, "tệp nhị phân lạ bị từ chối kèm lý do", reason);
ok(reason.includes("la.xyz") || reason.includes("XYZ"), "lý do nêu tên hoặc loại tệp (.xyz)", reason);
ok(errObj?.constructor?.name === "FileError", "lỗi là FileError (hiển thị cho người dùng, không phải lỗi máy chủ nội bộ)", errObj?.constructor?.name);

console.log("2. Danh sách loại tệp cho hộp chọn (accept) có mặt và đủ loại chính");
ok(typeof T.UPLOAD_ACCEPT === "string" && T.UPLOAD_ACCEPT.length > 0, "UPLOAD_ACCEPT là chuỗi không rỗng");
for (const want of [".pdf", ".docx", ".xlsx", ".pptx", ".csv", "image/*", "audio/*", ".heic"])
  ok(T.UPLOAD_ACCEPT.includes(want), `accept gồm ${want}`, T.UPLOAD_ACCEPT);

console.log("3. Thẻ tệp hiện lý do thành chữ (không chỉ ở title) và có nút Thử lại / Bỏ");
const src = fs.readFileSync("ui/fileicon.tsx", "utf8");
ok(/ft-err-box/.test(src) && /ft-err-msg/.test(src), "có khối lỗi riêng (.ft-err-box) với dòng chữ lý do (.ft-err-msg)");
const i0 = src.indexOf("ft-err-box");
const box = src.slice(i0, i0 + 500);
ok(/\{st\??\.error\}/.test(box) || /\{st\.error\}/.test(box), "lý do (st.error) được in ra làm nội dung chữ, thấy ngay không cần rê chuột", box);
ok(/retryFile\(/.test(box) && /tr\("Thử lại"\)/.test(box), "có nút Thử lại gọi retryFile", box);
ok(/tr\("Bỏ"\)/.test(box) && /onRemove/.test(box), "có nút Bỏ (onRemove)", box);
ok(/import\s*\{[^}]*retryFile[^}]*\}\s*from\s*"\.\/filestate"/.test(src), "retryFile được nhập từ filestate");

console.log("4. Chữ clamp 2 dòng trong CSS (lý do dài vẫn gọn, không che cả thẻ)");
const css = fs.readFileSync("app/_shell/globals.css", "utf8");
const ci = css.indexOf(".ft-err-msg");
const crule = css.slice(ci, ci + 240);
ok(ci >= 0 && /line-clamp:\s*2/.test(crule), ".ft-err-msg giới hạn 2 dòng", crule);

console.log("5. filestate: hủy khi bỏ thẻ, hẹn giờ 120s, dedup theo tên|cỡ|lần sửa");
const fsrc = fs.readFileSync("ui/filestate.ts", "utf8");
ok(/export function abortFile\(/.test(fsrc) && /\.abort\(\)/.test(fsrc), "có abortFile hủy XHR đang chạy");
ok(/export function retryFile\(/.test(fsrc), "có retryFile để tải lại");
ok(/x\.timeout\s*=\s*(?:av \? AV_TIMEOUT_MS : )?120_?000/.test(fsrc), "XHR có timeout 120000ms (tệp ghi âm / video: AV_TIMEOUT_MS, chờ máy chủ chép lời)");
ok(/AV_TIMEOUT_MS = 16 \* 60_000/.test(fsrc), "tệp ghi âm / video chờ tối đa 16 phút (lâu hơn hàng chờ chép lời 10 phút + một lần chép lời)");
ok(/x\.ontimeout\s*=/.test(fsrc), "có xử lý ontimeout");
ok(/export const fileKey\s*=\s*\(f: File\)\s*=>\s*`\$\{f\.name\}\|\$\{f\.size\}\|\$\{f\.lastModified\}`/.test(fsrc), "fileKey = tên|cỡ|lần sửa cuối");
ok(fsrc.indexOf("f.size > MAX_FILE_BYTES") >= 0 && fsrc.indexOf("f.size > MAX_FILE_BYTES") < fsrc.indexOf("pdfThumb(f).then"), "kiểm tra 30MB đứng TRƯỚC khi dựng ảnh thu nhỏ PDF");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
