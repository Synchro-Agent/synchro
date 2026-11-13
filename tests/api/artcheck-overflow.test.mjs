// G4: check_artifact bắt slide tràn nội dung (scrollHeight/scrollWidth vs clientHeight/clientWidth), và chỉ tối đa 2 vòng kiểm tra - sửa.
// Thuần, không cần máy chủ: kiểm tra hàm so khung (slideOverflows), chuỗi PROBE có luật so mỗi slide, và lời nhắc self_check đổi còn 2 vòng.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-artcheck-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "artcheck-overflow-test";

const { artcheck: A } = await loadTs(["artcheck"]);

console.log("1. So khung từng slide (scrollHeight vs clientHeight)");
ok(A.slideOverflows({ scrollH: 900, clientH: 720, scrollW: 1280, clientW: 1280 }), "cao hơn khung → tràn", "tall");
ok(A.slideOverflows({ scrollH: 720, clientH: 720, scrollW: 1400, clientW: 1280 }), "rộng hơn khung → tràn", "wide");
ok(!A.slideOverflows({ scrollH: 722, clientH: 720, scrollW: 1281, clientW: 1280 }), "lệch trong dung sai 4px → không báo", "within tol");
ok(!A.slideOverflows({ scrollH: 720, clientH: 720, scrollW: 1280, clientW: 1280 }), "vừa khung → không báo", "fit");
ok(A.slideOverflows({ scrollH: 724, clientH: 720, scrollW: 1280, clientW: 1280 }, 2), "dung sai nhỏ hơn thì nhạy hơn", "custom tol");

console.log("2. PROBE (chạy trong Chromium) có luật so mỗi slide + trả phần tử tràn");
// PROBE là chuỗi mã; kiểm tra nó mang đúng quy tắc scrollHeight/clientHeight và nhãn lỗi mới.
const src = Object.values(A).map((v) => (typeof v === "string" ? v : "")).join("\n") + "\n" + A.ARTCHECK_RULES(true) + A.ARTCHECK_RULES(false) + JSON.stringify(A.CHECK_ARTIFACT_TOOL);
// Chuỗi PROBE nằm trong CHECK_ARTIFACT nội bộ; đọc trực tiếp tệp nguồn để chắc chắn luật có mặt.
const file = fs.readFileSync("app/artcheck.ts", "utf8");
ok(/root\.scrollHeight > root\.clientHeight \+ 4 \|\| root\.scrollWidth > root\.clientWidth \+ 4/.test(file), "PROBE so scrollHeight/scrollWidth với clientHeight/clientWidth mỗi slide", "");
ok(/phần tử tràn khỏi slide/.test(file), "PROBE trả về phần tử tràn khỏi slide", "");
ok(/slide tràn nội dung/.test(file), "PROBE báo slide tràn nội dung khi không tách được phần tử", "");

console.log("3. Bước kiểm tra - sửa tối đa 2 vòng");
ok(/tối đa 2 vòng/.test(A.ARTCHECK_RULES(true)), "self_check nói tối đa 2 vòng", A.ARTCHECK_RULES(true).match(/tối đa[^.)]*\)?/)?.[0] ?? "");
ok(!/tối đa 3 vòng/.test(A.ARTCHECK_RULES(true)), "không còn 'tối đa 3 vòng'", "");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
