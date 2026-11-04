// Ngôn ngữ lần đầu mở: theo trình duyệt cho người mới, giữ nguyên cho người đã dùng. Chạy đúng đoạn script nhúng trong layout, không cần máy chủ.
import vm from "node:vm";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { langdetect: L } = await loadTs(["langdetect"]);

const run = (store, nav, fixed) => {
  const data = { ...store };
  const localStorage = new Proxy(data, { get: (d, k) => (k === "getItem" ? (x) => (x in d ? d[x] : null) : k === "setItem" ? (x, v) => { d[x] = String(v); } : d[k]), ownKeys: (d) => Reflect.ownKeys(d), getOwnPropertyDescriptor: (d, k) => Reflect.getOwnPropertyDescriptor(d, k) });
  const document = { documentElement: { dataset: {}, lang: "" } };
  vm.runInNewContext(L.langScript(fixed), { localStorage, document, navigator: { language: nav }, matchMedia: () => ({ matches: false }), Object, JSON });
  return { lang: document.documentElement.lang, saved: data["p:uilang"], sess: document.documentElement.dataset.sess };
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

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
