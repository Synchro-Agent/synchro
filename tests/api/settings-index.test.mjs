// Ô tìm trong Cài đặt: mọi dòng cài đặt có trong mục lục, tìm không dấu và theo chữ đang hiện đều ra đúng mục. Không cần máy chủ.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { settingsindex: S } = await loadTs(["settingsindex"]);
const src = readFileSync("ui/settings.tsx", "utf8");
const tabOf = { General: "General", Account: "Account", Privacy: "Privacy", Capabilities: "Capabilities", Memory: "Brain", CodeTab: "Synchro Code" };
const fns = [...src.matchAll(/^(?:export )?function (\w+)\(/gm)];
const missing = [];
fns.forEach((f, i) => {
  const tab = tabOf[f[1]];
  if (!tab) return;
  const body = src.slice(f.index, fns[i + 1]?.index ?? src.length);
  for (const m of body.matchAll(/<Row t="([^"]*)"/g)) if (m[1] !== "Loading…" && !S.SETTINGS_INDEX[tab].rows.includes(m[1])) missing.push(`${tab}: ${m[1]}`);
});
ok(!missing.length, "mọi dòng trong settings.tsx có trong mục lục", missing.join("; "));
const tabs = Object.keys(S.SETTINGS_INDEX), id = (s) => s;
const find = (q, lb = id) => S.searchSettings(q, tabs, lb);
ok(find("").length === tabs.length, "ô trống: đủ các mục");
ok(find("mật khẩu").some((x) => x.tab === "Account"), "'mật khẩu' ra mục Tài khoản");
ok(find("mat khau").some((x) => x.tab === "Account"), "gõ không dấu cũng ra");
const pw = find("password").find((x) => x.tab === "Account");
ok(pw?.rows.includes("Password"), "'password' chỉ đúng dòng Password", JSON.stringify(pw));
const vi = find("giao diện", (s) => (s === "Theme" ? "Giao diện" : s)).find((x) => x.tab === "General");
ok(vi?.rows.includes("Theme"), "tìm theo chữ đang hiện bằng tiếng Việt", JSON.stringify(vi));
ok(find("xyzzy không có").length === 0, "không khớp: danh sách rỗng để báo không có kết quả");
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
