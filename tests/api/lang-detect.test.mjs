// Ngôn ngữ lần đầu mở: theo trình duyệt cho người mới, giữ nguyên cho người đã dùng. Chạy đúng đoạn script nhúng trong layout, không cần máy chủ.
import vm from "node:vm";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { langdetect: L } = await loadTs(["langdetect"]);

const run = (store, nav, fixed, pathname = "/") => {
  const data = { ...store };
  const localStorage = new Proxy(data, { get: (d, k) => (k === "getItem" ? (x) => (x in d ? d[x] : null) : k === "setItem" ? (x, v) => { d[x] = String(v); } : d[k]), ownKeys: (d) => Reflect.ownKeys(d), getOwnPropertyDescriptor: (d, k) => Reflect.getOwnPropertyDescriptor(d, k) });
  const document = { documentElement: { dataset: {}, lang: "" } };
  const timers = [];
  vm.runInNewContext(L.langScript(fixed), { localStorage, document, navigator: { language: nav }, matchMedia: () => ({ matches: false }), Object, JSON, location: { pathname }, setTimeout: (f, ms) => timers.push([f, ms]) });
  const wait = document.documentElement.dataset.trwait;
  timers.forEach(([f]) => f());
  return { lang: document.documentElement.lang, saved: data["p:uilang"], sess: document.documentElement.dataset.sess, wait, timers: timers.map((t) => t[1]), after: document.documentElement.dataset.trwait };
};

ok(run({}, "en-US").lang === "en", "người mới, trình duyệt tiếng Anh: tiếng Anh");
ok(run({}, "fr-FR").lang === "en", "người mới, ngôn ngữ khác: tiếng Anh");
ok(run({}, "vi-VN").lang === "vi", "người mới, trình duyệt tiếng Việt: tiếng Việt");
ok(run({}, "en-US").saved === '"en"', "lưu lại để các lần sau không đổi");
ok(run({ "p:uilang": '"vi"' }, "en-US").lang === "vi", "đã chọn tiếng Việt: giữ");
ok(run({ "p:uilang": '"en"' }, "vi-VN").lang === "en", "đã chọn tiếng Anh: giữ");
ok(run({ "u:abc:chats": "[]" }, "en-US").lang === "vi", "đã có dữ liệu tài khoản, chưa từng chọn: giữ tiếng Việt như đang thấy");
ok(run({ "u:anon:projects": "[]" }, "en-US").lang === "en", "dữ liệu khách chưa đăng nhập không tính là đã dùng");
ok(run({ theme: "dark" }, "en-US").lang === "vi", "đã đổi giao diện từ trước: người cũ");
ok(run({}, "en-US", "vi").lang === "vi", "máy thử nghiệm ép ngôn ngữ");
ok(run({ signedIn: "1" }, "vi-VN").sess === "1", "đã đăng nhập ở lần trước: vẽ khung app ngay");

// Chống nháy chữ gốc (B6 bước 10): giao diện tiếng Anh ở trang dựng sẵn bằng tiếng Việt thì ẩn <body> tới khi bộ dịch chạy xong.
const terms = run({ "p:uilang": '"en"' }, "en-US", undefined, "/terms");
ok(terms.wait === "1" && terms.lang === "en", "tiếng Anh, /terms: chờ bộ dịch (html[data-trwait])", JSON.stringify(terms));
ok(terms.timers.length === 1 && terms.timers[0] === L.TRWAIT_MS && L.TRWAIT_MS <= 3000 && terms.after === undefined, `quá ${L.TRWAIT_MS} ms thì tự hiện lại (hỏng mạng, lỗi tải mã)`, JSON.stringify(terms));
ok(run({ "p:uilang": '"en"' }, "en-US", undefined, "/").wait === undefined, "trang chủ: không ẩn (Home giữ khung chờ không chữ tới khi từ điển về)");
ok(run({ "p:uilang": '"vi"' }, "en-US", undefined, "/share/abc").wait === undefined, "giao diện tiếng Việt: không chờ gì");
ok(run({}, "en-US", undefined, "/privacy").wait === "1", "người mới, trình duyệt tiếng Anh, mở thẳng /privacy: chờ bộ dịch");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
