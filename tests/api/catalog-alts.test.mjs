// Danh mục skill thật: mọi thư viện mở chọn tay trong catalog/alternatives.json có trong danh mục và khai giấy phép mở; thư viện đóng đều đã có
// hướng thay thế hoặc được ghi rõ là đã xem mà không có. Không cần máy chủ, không gọi mạng.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };

const { claudedir: C } = await loadTs(["claudedir"]);
const ALT = JSON.parse(fs.readFileSync("catalog/alternatives.json", "utf8"));
const all = C.dirEntries(), names = new Set(all.map((e) => e.name));
const closed = all.filter((e) => e.closed);

console.log("1. Chọn tay");
const bad = [];
for (const [name, a] of Object.entries(ALT)) {
  if (name === "_") continue;
  for (const id of a.catalog ?? []) { const o = C.dirById(id); if (!o || o.closed || (o.license && !C.openLicense(o.license))) bad.push(`${name} → ${id}`); }
}
ok(!bad.length, "thư viện chọn tay có trong danh mục, không đóng, giấy phép mở hoặc đọc lúc cài", bad.join("; "));
ok(!Object.keys(ALT).filter((n) => n !== "_" && !names.has(n)).length, "khóa của alternatives.json đúng tên thư viện trong danh mục", Object.keys(ALT).filter((n) => n !== "_" && !names.has(n)).join("; "));

console.log("2. Thư viện đóng");
ok(closed.length >= 74, "UNLICENSED của npm được tính là đóng", closed.length);
const unseen = closed.filter((e) => !e.alt);
ok(!unseen.length, "mọi thư viện đóng đều đã được xem: có thay thế hoặc ghi rõ là không có", unseen.map((e) => e.name).join("; "));
const dead = closed.flatMap((e) => (e.alt ?? []).filter((a) => !C.dirById(a)));
ok(!dead.length, "thay thế của thư viện đóng đều mở được trong danh mục", dead.join("; "));
ok(closed.filter((e) => e.alt?.length).length >= 68, "thư viện đóng có thay thế thật", closed.filter((e) => e.alt?.length).length);

console.log("3. Tự tìm cho thư viện chỉ lúc cài mới biết giấy phép đóng");
const none = all.filter((e) => !e.license && !e.closed);
const hit = none.filter((e) => C.similarOpen(e).length);
ok(hit.length / none.length >= 0.45, "hơn 45% thư viện không khai giấy phép tìm được thư viện mở gần nhất", `${hit.length}/${none.length}`);
const leak = hit.flatMap((e) => C.similarOpen(e).filter((a) => { const o = C.dirById(a); return !o || o.closed || !C.openLicense(o.license) || a === e.id; }));
ok(!leak.length, "gợi ý tự tìm chỉ gồm thư viện khai rõ giấy phép mở", leak.join("; "));
const jobs = C.similarOpen(C.dirById("vndck/mokaru-mcp"));
ok(jobs.some((a) => (C.dirById(a)?.cats ?? []).includes("career")), "ví dụ thật: thư viện tìm việc gợi ý thư viện cùng mục nghề nghiệp", JSON.stringify(jobs));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
