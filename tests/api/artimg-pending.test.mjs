// Ảnh dựng ở chế độ nền (W23-2): ảnh giữ chỗ 1×1 không được trình duyệt / khung xem trước giữ lại, khung hỏi lại tới khi ảnh thật thay vào.
// Hàm thuần và đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { artdoc: A } = await loadTs(["artdoc"]);

// Đúng ảnh giữ chỗ của chatengine.ts (PLACEHOLDER_PNG).
const engine = fs.readFileSync("server/chatengine.ts", "utf8");
const b64 = /const PLACEHOLDER_PNG = Buffer\.from\("([^"]+)", "base64"\)/.exec(engine)?.[1];
ok(!!b64, "tìm thấy ảnh giữ chỗ trong chatengine.ts");
ok(A.isPlaceholderPng(new Uint8Array(Buffer.from(b64 ?? "", "base64"))), "nhận ra ảnh giữ chỗ 1×1");
// PNG 2×1 và PNG lớn: không phải ảnh giữ chỗ.
const png = (w, h, extra = 0) => { const b = Buffer.alloc(33 + extra); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return new Uint8Array(b); };
ok(!A.isPlaceholderPng(png(2, 1)) && !A.isPlaceholderPng(png(1024, 1024)), "ảnh thật (khác 1×1) không bị coi là ảnh giữ chỗ");
ok(!A.isPlaceholderPng(png(1, 1, 4096)), "tệp lớn không bị coi là ảnh giữ chỗ");
ok(!A.isPlaceholderPng(new Uint8Array(Buffer.from("GIF89a\x01\x00\x01\x00", "binary"))), "không phải PNG");

ok(A.pendingRetryMs(0) === 5000 && A.pendingRetryMs(10) === 30000 && A.pendingRetryMs(40) === null, "hỏi lại 5 s, tăng tới 30 s, rồi thôi");
let total = 0; for (let n = 0; A.pendingRetryMs(n) !== null; n++) total += A.pendingRetryMs(n);
ok(total > 10 * 60_000 && total < 30 * 60_000, "tổng thời gian hỏi lại 10–30 phút", total);

const route = fs.readFileSync("app/api/artimg/route.ts", "utf8");
ok(/state = gen \? genImageState\(user\.user\.id, gen, img\.data\) : null/.test(route), "máy chủ nhận ra ảnh đang dựng nền");
ok(/"cache-control": state \? "no-store" : "private, max-age=86400"/.test(route) && /state === "pending" \? \{ "x-synchro-pending": "1" \}/.test(route), "ảnh giữ chỗ: no-store và báo đang chờ");
ok(/state === "failed" \? \{ "x-synchro-failed": "1" \}/.test(route), "ảnh nền dựng hỏng: báo hỏng để khung thôi hỏi lại");
const ui = fs.readFileSync("ui/artifactui.tsx", "utf8");
ok(/r\.headers\.get\("x-synchro-pending"\) === "1"/.test(ui), "khung xem trước đọc cờ đang chờ");
ok(/noteGenPending\(gen\)/.test(ui) && /noteGenSettled\(gen, r\.headers\.get\("x-synchro-failed"\) !== "1"\)/.test(ui), "khung xem trước báo khi ảnh nền vừa xong / hỏng");

// Báo một dòng khi ảnh nền về (W23-2): chỉ khi phiên này đã thấy ảnh đang chờ, mỗi ảnh một lần.
const fired = [];
globalThis.window = { dispatchEvent: (e) => { fired.push(e.detail); return true; } };
globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
ok(!A.noteGenSettled("anh-cu-1234", true) && !fired.length, "đoạn chat cũ (chưa thấy đang chờ): không báo");
A.noteGenPending("anh-moi-1234");
ok(A.noteGenSettled("anh-moi-1234", true) && fired.length === 1 && fired[0].id === "anh-moi-1234" && fired[0].ok === true, "ảnh vừa xong: báo một lần", JSON.stringify(fired));
ok(!A.noteGenSettled("anh-moi-1234", true) && fired.length === 1, "khung thứ hai thấy cùng ảnh: không báo lại");
A.noteGenPending("anh-hong-1234");
ok(A.noteGenSettled("anh-hong-1234", false) && fired[1]?.ok === false, "ảnh nền hỏng: báo hỏng", JSON.stringify(fired));
delete globalThis.window;
const page = fs.readFileSync("ui/home.tsx", "utf8");
ok(/window\.addEventListener\(GEN_IMG_EVENT, on\)/.test(page) && /tr\("Ảnh dựng nền đã xong và đã thay vào artifact\."\)/.test(page), "trang chat nghe sự kiện và báo một dòng");
ok(/else if \(pendingImg\.has\(u\)\) setTimeout\(\(\) => \{ if \(imgCache\.get\(u\) === mine\) imgCache\.delete\(u\); \}/.test(ui), "ảnh giữ chỗ không nằm mãi trong imgCache");
ok(/\$\{gen \? "&p=1" : ""\}/.test(ui), "địa chỉ mới cho ảnh đã dựng: bỏ qua bản giữ chỗ trình duyệt đã lưu 24 giờ");
ok(/urls\.some\(\(u\) => pendingImg\.has\(u\)\) \? pendingRetryMs\(n\)/.test(ui) && /\}, \[content, urls, n\]\);/.test(ui), "useInlineImages hỏi lại khi còn ảnh đang chờ");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
