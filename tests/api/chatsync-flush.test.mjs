// Hạn giờ của flush() lúc đăng xuất (blueprint F5): một yêu cầu mạng đứng không được treo cả bước đăng xuất, và phần chưa xong
// phải đếm được để không xóa dữ liệu chưa đồng bộ. Kiểm thử hàm thuần withDeadline (chatsynccore.ts) mà flush() dựa vào.
// Tự chạy được, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { chatsynccore: C } = await loadTs(["chatsynccore"]);
const { withDeadline, TIMED_OUT } = C;

console.log("1. Việc xong trước hạn: trả đúng kết quả");
ok((await withDeadline(Promise.resolve(42), 1000)) === 42, "resolve ngay trả về giá trị");
ok((await withDeadline(sleep(20).then(() => "xong"), 1000)) === "xong", "resolve trong hạn trả về giá trị");

console.log("2. Việc đứng quá hạn: trả TIMED_OUT, không treo");
const t0 = Date.now();
const r = await withDeadline(new Promise(() => {}), 60); // không bao giờ resolve
ok(r === TIMED_OUT, "yêu cầu đứng trả về TIMED_OUT", r);
const dt = Date.now() - t0;
ok(dt >= 55 && dt < 400, "trả về đúng quanh mốc hạn, không chờ mãi", dt);

console.log("3. ms ≤ 0: hết giờ ngay");
ok((await withDeadline(Promise.resolve(1), 0)) === TIMED_OUT, "hạn 0 trả TIMED_OUT ngay");
ok((await withDeadline(Promise.resolve(1), -5)) === TIMED_OUT, "hạn âm trả TIMED_OUT ngay");

console.log("4. Việc ném lỗi: coi như chưa xong (TIMED_OUT), không văng lỗi");
let threw = false;
let res;
try { res = await withDeadline(Promise.reject(new Error("mạng lỗi")), 1000); } catch { threw = true; }
ok(!threw && res === TIMED_OUT, "reject được nuốt và quy về TIMED_OUT", { threw, res: String(res) });

console.log("5. Resolve rồi thì bỏ qua đồng hồ: không có trả về thứ hai");
let calls = 0;
const p = withDeadline(sleep(10).then(() => { calls++; return "a"; }), 50);
ok((await p) === "a", "trả kết quả thật");
await sleep(80); // qua cả mốc hạn cũ
ok(calls === 1, "việc chỉ chạy một lần, đồng hồ không gây tác dụng phụ", calls);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
