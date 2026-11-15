// Địa chỉ #s=<mục> của Cài đặt (R5, R6, LIVE-8): giải mã an toàn, push khi mở / replace khi đổi mục / back khi đóng về trang cũ,
// mục đổi trong Cài đặt báo lên trang. Không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { hashnav: H } = await loadTs(["hashnav"]);

ok(H.decodeSettingsTab("%") === "General" && H.decodeSettingsTab("%E0") === "General", "R6: mã hóa hỏng về General, không ném lỗi");
ok(H.decodeSettingsTab("Synchro%20Code") === "Synchro Code" && H.decodeSettingsTab("") === "General", "giải mã tên có dấu cách, rỗng về General");
ok(H.settingsHash("Skill Hub") === "#s=Skill%20Hub", "địa chỉ mã hóa, so được với location.hash");
ok(H.hashStep("#c=17", "#s=General", null, false) === "push", "LIVE-8: mở Cài đặt từ đoạn chat thêm mục lịch sử");
ok(H.hashStep("#s=General", "#s=Usage", "#c=17", false) === "replace", "R5: đổi mục chỉ thay địa chỉ");
ok(H.hashStep("#s=Usage", "#c=17", "#c=17", false) === "back", "đóng về đúng trang cũ: history.back()");
ok(H.hashStep("#s=Usage", "#v=code", "#c=17", false) === "replace", "đóng để sang trang khác: replace, không lùi về trang cũ");
ok(H.hashStep("#s=Usage", "#c=17", null, false) === "replace", "Cài đặt mở từ liên kết: đóng thì replace");
ok(H.hashStep("#v=bogus", "", null, true) === "replace" && H.hashStep("", "#v=code", null, false) === "push", "R6: lần ghi đầu replace, sau đó push");
ok(H.hashStep("#c=1", "#c=1", null, false) === "none", "đã khớp: không làm gì");

const page = fs.readFileSync("ui/home.tsx", "utf8"), mo = fs.readFileSync("ui/modals.tsx", "utf8");
ok(!/decodeURIComponent\(h\.slice\(3\)\)/.test(page), "page.tsx không còn giải mã #s= trần");
ok(/<Settings initial=\{settingsTab\} onTab=\{setSettingsTab\}/.test(page) && !/<Settings key=\{settingsTab\}/.test(page), "Settings báo mục lên trang, không gắn lại khi đổi mục");
ok(/const setTab = \(t: string\) => \{ setTabState\(t\); onTab\?\.\(t\); \}/.test(mo) && /useEffect\(\(\) => \{ setTabState\(initial\); \}, \[initial\]\)/.test(mo), "Settings: đổi mục gọi onTab, mở từ ngoài thì theo initial");
ok(/if \(!known\) setTab\("General"\)/.test(mo), "R6: mục lạ / không được phép về General");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
