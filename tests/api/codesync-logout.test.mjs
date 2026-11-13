// Đăng xuất kèm xóa dữ liệu, đang bật Đồng bộ phiên (blueprint F5): flushAllNow phải đếm ĐÚNG số phiên Code chưa chắc đã lên máy
// chủ, gồm cả phiên từng đẩy thất bại nên đã rơi khỏi hàng chờ (không chỉ phiên còn trong hàng chờ trong bộ nhớ), và không treo khi
// mạng đứng. Giả lập fetch, chạy hàm thuần flushAllNow (codesync.ts). Tự chạy được, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

// Giả lập fetch cho /api/code/sessions: PUT = flushSession, GET = listServerSessions.
let serverIds = new Set();      // phiên máy chủ đang có (không xóa)
let putFails = new Set();       // id mà PUT thất bại (mạng/máy chủ lỗi)
let listStall = false;          // GET danh sách đứng (mạng lỗi lúc đăng xuất)
const res = (okFlag, json) => ({ ok: okFlag, status: okFlag ? 200 : 500, json: async () => json });
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || "GET";
  if (method === "PUT") {
    const b = JSON.parse(opts.body);
    if (putFails.has(b.id)) return res(false, { error: "lỗi" });
    serverIds.add(b.id);
    return res(true, { updated: Date.now(), merged: false });
  }
  if (listStall) return new Promise(() => {}); // không bao giờ resolve
  return res(true, { sessions: [...serverIds].map((id) => ({ id, deleted: false })), now: Date.now(), sync: true });
};

const { codesync: CS } = await loadTs(["codesync"]);
const { pushSession, flushAllNow } = CS;
const reset = () => { serverIds = new Set(); putFails = new Set(); listStall = false; };

try {
  console.log("1. Không có gì chờ, không có phiên local: 0");
  reset();
  ok((await flushAllNow([])) === 0, "0 phiên chưa đồng bộ");

  console.log("2. Phiên đang chờ gửi xong + có trên máy chủ: 0");
  reset();
  pushSession(1, "A", { v: 1 });
  ok((await flushAllNow([1])) === 0, "gửi xong, máy chủ đã có → 0", [...serverIds]);

  console.log("3. Phiên chỉ có ở máy, máy chủ không có (lần đẩy trước thất bại, đã rơi khỏi hàng chờ): đếm là chưa đồng bộ");
  reset();
  serverIds.add(1); // chỉ phiên 1 ở máy chủ; phiên 2 chưa bao giờ lên được
  ok((await flushAllNow([1, 2])) === 1, "phiên 2 (local, không trên máy chủ) được đếm — chính là lỗi F5/fix 3", [...serverIds]);

  console.log("4. Phiên đang chờ mà PUT thất bại: đếm là chưa đồng bộ");
  reset();
  putFails.add(3);
  pushSession(3, "C", { v: 1 });
  ok((await flushAllNow([3])) === 1, "PUT lỗi → 1 (không bị trùng đếm với bước so máy chủ)");

  console.log("5. Hỗn hợp: 1 gửi xong, 1 PUT lỗi, 1 chỉ có ở máy → 2 chưa đồng bộ");
  reset();
  serverIds.add(10);        // phiên 10 đã có trên máy chủ từ trước
  putFails.add(11);         // phiên 11 đang chờ, PUT lỗi
  pushSession(10, "ok", { v: 2 });
  pushSession(11, "fail", { v: 1 });
  ok((await flushAllNow([10, 11, 12])) === 2, "chỉ 11 (PUT lỗi) và 12 (không trên máy chủ) bị đếm", [...serverIds]);

  console.log("6. Mạng đứng lúc lấy danh sách: không treo, giữ lại tất cho chắc");
  reset();
  listStall = true;
  const t0 = Date.now();
  const n = await flushAllNow([20, 21], 150);
  const dt = Date.now() - t0;
  ok(n === 2, "không kiểm được danh sách → đếm hết local là chưa đồng bộ (không xóa nhầm)", n);
  ok(dt >= 140 && dt < 1500, "trả về quanh mốc hạn, không chờ mãi", dt);
} finally { /* fetch giả lập, không có gì để dọn */ }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
