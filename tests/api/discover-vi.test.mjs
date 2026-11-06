// Tìm trong danh mục bằng tiếng Việt, có dấu hay không dấu. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const { claudedir: C } = await loadTs(["claudedir"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x)); };
const has = (q, w) => C.searchTerms(q).some((g) => g.includes(w));
ok(has("hóa đơn", "invoice") && has("hoa don", "invoice"), "hóa đơn ra invoice, có dấu hay không dấu", C.searchTerms("hóa đơn"));
ok(has("tài liệu", "document"), "tài liệu ra document");
ok(has("mẫu hợp đồng", "contract") && has("mẫu hợp đồng", "mau"), "từ khác vẫn giữ để lọc", C.searchTerms("mẫu hợp đồng"));
ok(JSON.stringify(C.searchTerms("invoice pdf")) === JSON.stringify([["invoice"], ["pdf"]]), "tiếng Anh giữ nguyên");
ok(!has("luathi", "legal"), "không khớp giữa từ");
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
