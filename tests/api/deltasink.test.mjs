// Bộ gộp chữ đang chảy (ui/deltasink.ts, blueprint B2) và hai nơi dùng nó trong home.tsx. Tự chạy được, không cần dev:mock.
// 1. Hành vi: gộp theo khung hình, cách nhau ít nhất 45 ms, drop / mine / cancel; cancel() không xóa mẩu đang chờ (pending()).
// 2. Lượt lỗi: cả lượt đang gửi lẫn lượt nối lại sau khi tải trang đều dùng sink.pending() làm chữ dự phòng. Tab nền không chạy
//    requestAnimationFrame nên có khi chưa vẽ mẩu nào: bỏ pending() thì thẻ lỗi trống, mất cả câu đã chảy về.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };

// Đồng hồ và khung hình giả: frame() chạy các hàm đã hẹn ở thời điểm now.
let now = 1000, frames = new Map(), fid = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true, writable: true });
globalThis.requestAnimationFrame = (f) => { frames.set(++fid, f); return fid; };
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
const frame = (at) => { if (at !== undefined) now = at; const fs_ = [...frames.values()]; frames = new Map(); for (const f of fs_) f(now); };

const { deltasink: D } = await loadTs(["deltasink"]);
const make = (mineRef = { v: true }) => { const out = []; return { out, mineRef, s: D.deltaSink(() => mineRef.v, (t) => out.push(t)) }; };

console.log("── gộp theo khung hình");
{
  const { out, s } = make();
  s.push("a"); s.push("ab"); s.push("abc");
  ok(out.length === 0 && frames.size === 1, "nhiều mẩu trước khung hình: chưa vẽ, chỉ hẹn một khung hình");
  ok(s.pending() === "abc", "pending() là mẩu mới nhất");
  frame(1100);
  ok(out.length === 1 && out[0] === "abc" && s.pending() === null, "khung hình: vẽ một lần với mẩu mới nhất");
  s.push("abcd");
  frame(1120);
  ok(out.length === 1 && frames.size === 1, "chưa đủ 45 ms từ lần vẽ trước: hẹn lại, chưa vẽ");
  frame(1150);
  ok(out.length === 2 && out[1] === "abcd", "đủ 45 ms: vẽ");
  frame(1300);
  ok(out.length === 2, "không có mẩu mới: khung hình sau không vẽ");
}

console.log("── drop / mine / cancel");
{
  const { out, s, mineRef } = make();
  s.push("lời dẫn"); s.drop();
  ok(s.pending() === null, "drop(): bỏ mẩu đang chờ");
  frame(2000);
  ok(out.length === 0, "sau drop: khung hình không vẽ");
  s.push("x"); mineRef.v = false; frame(2100);
  ok(out.length === 0 && s.pending() === "x", "lần theo dõi hết hiệu lực (mine() = false): không vẽ, mẩu vẫn còn trong pending()");
  mineRef.v = true;
  const b = make();
  b.s.push("chưa vẽ"); b.s.cancel();
  ok(frames.size === 0 || ![...frames.values()].length, "cancel(): bỏ khung hình đã hẹn");
  frame(2200);
  ok(b.out.length === 0, "sau cancel: không vẽ nữa");
  ok(b.s.pending() === "chưa vẽ", "cancel() không xóa pending(): nơi gọi vẫn đọc được chữ chưa vẽ");
}

console.log("── tab nền: requestAnimationFrame không chạy, lượt lỗi giữa chừng");
{
  const { out, s } = make();
  for (let n = 1; n <= 50; n++) s.push("chữ ".repeat(n).trim());
  s.cancel();
  frames = new Map();
  ok(out.length === 0 && s.pending() === "chữ ".repeat(50).trim(), "chưa vẽ mẩu nào nhưng pending() còn cả câu đã chảy về");
  // Mô phỏng nhánh lỗi của lượt nối lại: không có d.text, tin nhắn trống.
  const m = { text: "" }, kept = "";
  const pend = s.pending();
  ok((kept || pend || m.text) === "chữ ".repeat(50).trim(), "kept || pending() || m.text giữ được chữ (trước đây chỉ kept || m.text = trống)");
}

console.log("── home.tsx: cả hai nơi dùng deltaSink đều lấy pending() khi lượt lỗi");
{
  const src = fs.readFileSync("ui/home.tsx", "utf8");
  ok(/import \{ deltaSink \} from "\.\/deltasink";/.test(src) && !/function deltaSink\(/.test(src), "home.tsx dùng ui/deltasink.ts (không có bản sao riêng)");
  const at = [...src.matchAll(/const sink = deltaSink\(/g)].map((m) => m.index);
  ok(at.length === 2, `đúng hai nơi dùng deltaSink (lượt đang gửi, lượt nối lại): ${at.length}`);
  const seg = (k) => src.slice(at[k], k + 1 < at.length ? at[k + 1] : at[k] + 12000);
  // Lượt đang gửi (streamReply): khối if (failed) dùng sink.pending() khi máy chủ không trả lại phần đã viết.
  const send = seg(0);
  ok(/if \(failed\) \{[^]*?sink\.pending\(\)[^]*?patch\(/.test(send), "lượt đang gửi: nhánh lỗi lấy sink.pending()");
  ok(/notice\?\.partial \? reply : sink\.pending\(\)/.test(send), "lượt đang gửi: chữ máy chủ giữ được (partial) trước, không thì pending()");
  ok(/if \(!mine\(\)\) \{\s*const pend = sink\.pending\(\);[^]*?m\.text \|\| reply \|\| pend/.test(send), "lượt đang gửi bị Dừng: m.text || reply || pending()");
  // Lượt nối lại (attachRun): nhánh từ chối của promise.
  const res = seg(1);
  ok(/attachRun\(/.test(res), "đoạn thứ hai là lượt nối lại (attachRun)");
  const rej = res.slice(res.indexOf("}, (e) => {"));
  ok(res.includes("}, (e) => {") && /const pend = sink\.pending\(\);[^]*?text: kept \|\| pend \|\| m\.text/.test(rej), "lượt nối lại: nhánh lỗi dùng kept || pending() || m.text", rej.slice(0, 600));
  ok(/if \(stopped\) \{ const pend = sink\.pending\(\);[^]*?m\.text \|\| text \|\| pend/.test(res), "lượt nối lại bị Dừng: m.text || text || pending()");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
