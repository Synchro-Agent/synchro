// Chữ về gói: chỉ Claude cần gói trả phí, ChatGPT, Gemini và Grok dùng được cả tài khoản miễn phí. Người dùng miễn phí không được đọc thấy mình phải trả tiền. Tự chạy được, chỉ đọc mã nguồn và từ điển.
import { readFileSync } from "node:fs";
import { findSrc } from "../lib/srcroots.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const src = (f) => readFileSync(findSrc(f), "utf8");

const provider = src("providersui.tsx"), usage = src("usageui.tsx") + src("usagering.tsx"), subs = src("ai/subs.ts"), page = src("home.tsx"), img = src("ai/imagegen.ts"), vi = src("i18n-vi.ts"), ux = src("i18n-ux.ts");
const header = /"(Use your own AI accounts\.[^"]+)"/.exec(provider)?.[1];
ok(header && /ChatGPT, Gemini and Grok work on a free account/.test(header) && /Claude needs a Pro or Max plan/.test(header), "đầu trang Providers nói đúng ai cần trả phí", header);
ok(header && vi.includes(`"${header}"`), "đầu trang Providers có bản tiếng Việt");
for (const [name, text] of [["providersui", provider], ["page", page], ["i18n-ux", ux]]) ok(!/already pay|đang trả tiền/.test(text), `${name}: không còn nói gói bạn đang trả tiền`);
const noPlanName = /Google AI Pro|SuperGrok and X Premium|SuperGrok và X Premium/;
for (const [name, text] of [["usageui", usage], ["ai/subs", subs], ["i18n-ops", src("i18n-ops.ts")]]) ok(!noPlanName.test(text), `${name}: ghi chú hạn mức không gọi tên gói trả phí như điều kiện`);
// Bản tiếng Anh của ghi chú Mức dùng nằm trong từ điển (PLAN_NOTE, noWindows… gọi tr): xét cả bản dịch của mọi chữ tiếng Việt ở hai tệp này, dù khóa nằm ở tệp từ điển nào.
{
  const { loadTs } = await import("../lib/ts.mjs");
  const { "i18n-dict": D } = await loadTs(["i18n-dict"]);
  const keys = [...new Set([...usage.matchAll(/"([^"\n]*[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ][^"\n]*)"/gi)].map((m) => m[1]))];
  const en = keys.filter((k) => Object.prototype.hasOwnProperty.call(D.VI2EN, k)).map((k) => [k, D.VI2EN[k]]);
  const planNote = /export const PLAN_NOTE[^=]*= \{([\s\S]*?)\n\};/.exec(usage)?.[1] ?? "";
  const noteKeys = [...planNote.matchAll(/^\s*\w+: "(.+)",$/gm)].map((m) => m[1]);
  ok(noteKeys.length === 4 && noteKeys.every((k) => D.VI2EN[k]), "bốn ghi chú PLAN_NOTE có bản tiếng Anh trong từ điển", noteKeys.length);
  const bad = en.filter(([, v]) => noPlanName.test(v));
  ok(en.length > 50 && !bad.length, `bản tiếng Anh của ${en.length} chữ ở Mức dùng không gọi tên gói trả phí như điều kiện`, bad.map(([k, v]) => `${k.slice(0, 40)} → ${v}`).join("; "));
}
ok(!/gói Google AI/.test(img) && /tài khoản miễn phí cũng được/.test(img), "gợi ý sửa ảnh: tài khoản Google miễn phí cũng được");
// Ghi chú máy chủ gửi về đi qua bộ dịch: mỗi ghi chú phải có bản tiếng Việt.
const notes = /const NOTE: Record<Cli, string> = \{([\s\S]*?)\n\};/.exec(subs)?.[1] ?? "";
const list = [...notes.matchAll(/^\s*\w+: "(.+)",$/gm)].map((m) => m[1]);
ok(list.length === 4, "đọc được bốn ghi chú", list.length);
for (const t of list.filter((x) => !/fixed time/.test(x))) ok(vi.includes(`"${t}"`), "ghi chú có bản tiếng Việt: " + t.slice(0, 40));
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
