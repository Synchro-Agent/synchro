// Ô tìm của Cài đặt ra đúng dòng: mục lục khớp giao diện, tìm được bằng tiếng Việt không dấu. Không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { settingsindex: S, "i18n-dict": D } = await loadTs(["settingsindex", "i18n-dict"]);
const src = fs.readFileSync("app/settings.tsx", "utf8");
const rows = [...src.matchAll(/<Row t=(?:"([^"]+)"|\{"([^"]+)"\})/g)].map((m) => m[1] ?? m[2]).filter((x) => x !== "Loading…" && x !== "Break reminders"); // "Break reminders" thuộc tab không có trong thanh bên
const all = new Set(Object.values(S.SETTINGS_INDEX).flat());
const miss = [...new Set(rows)].filter((x) => !all.has(x));
ok(rows.length > 50 && !miss.length, `mọi dòng trong settings.tsx (${rows.length}) đều có trong mục lục`, miss.join(" | "));
const names = (x) => [x, D.EN2VI[x] ?? x];
const untr = [...all].filter((x) => !D.EN2VI[x] && !/^(Python|Node\.js|HTML and JavaScript|Email|Skills|Artifacts)$/.test(x));
ok(!untr.length, "dòng nào cũng có tên tiếng Việt để tìm", untr.join(" | "));
const tabs = Object.keys(S.SETTINGS_INDEX);
const hit = (q, t = tabs) => S.searchSettings(q, t, names).map((h) => `${h.tab}:${h.name}`);
ok(hit("speed").includes("General:Speed"), "tìm bằng tiếng Anh", hit("speed"));
ok(hit("cookies").includes("Synchro Code:Keep cookies"), "ra đúng dòng trong tab khác", hit("cookies"));
const vi = D.EN2VI["Date of birth"].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
ok(hit(vi).includes("Account:Date of birth"), `tìm tiếng Việt không dấu (“${vi}”)`, hit(vi));
ok(!hit("sign-ups", ["General", "Account"]).length && hit("sign-ups").includes("Administrator:New sign-ups"), "không hiện dòng của tab người này không mở được", hit("sign-ups"));
ok(!hit("a").length && !hit(" ").length, "gõ một chữ chưa tìm dòng");
ok(hit("e").length === 0 && S.searchSettings("co", tabs, names, 3).length === 3, "tối đa số kết quả");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
