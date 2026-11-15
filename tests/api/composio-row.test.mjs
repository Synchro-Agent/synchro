// Dòng Composio trong menu + → Connectors (LIVE-10): ở 390px tên không bị cắt thành "Compo…" — ghi chú trùng ý với nút "Liên kết" ẩn đi,
// ghi chú còn lại co (…) trước tên. Chỉ đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const css = fs.readFileSync("app/_shell/synchro-ds.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), page = fs.readFileSync("ui/home.tsx", "utf8");

ok(/className=\{`cm-cnt\$\{k\.state !== "blocked" \? " cm-dup" : ""\}`\}/.test(page), "ghi chú chưa liên kết / cần liên kết lại được đánh dấu trùng ý với nút");
ok(/\.cm-cx>\.cv-ell\{flex:none\}/.test(css), "tên Composio không co");
ok(/\.cm-cx \.cm-cnt\{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis\}/.test(css), "ghi chú co lại trước, có dấu …");
const narrow = [...css.matchAll(/@media \(max-width:640px\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]).find((b) => b.includes(".menu.cm-fly")) ?? "";
ok(/\.cm-cx \.cm-cnt\.cm-dup\{display:none\}/.test(narrow), "menu hẹp: ẩn ghi chú trùng ý", narrow);
ok(/\.cm-cx \.cm-cnt\.cm-dup~\.cm-rec\{margin-left:auto\}/.test(narrow), "menu hẹp: nút Liên kết vẫn sát mép phải", narrow);

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
