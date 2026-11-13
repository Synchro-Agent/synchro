// H2.2: mọi tệp tests/ui/*.mjs hoặc chạy trong npm run qa, hoặc nằm trong danh sách bỏ qua của scripts/qa.mjs kèm lý do; tiện ích chờ
// theo điều kiện (tests/lib/wait.mjs) trả đúng giá trị và không chờ quá hạn. Không cần máy chủ.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { waitFor, settle } from "../lib/wait.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 1200)); };

console.log("1. Danh sách bộ kiểm của npm run qa");
const r = spawnSync(process.execPath, ["scripts/qa.mjs", "--list"], { encoding: "utf8" });
ok(r.status === 0, "qa.mjs --list chạy được", r.stderr || r.stdout);
const out = r.stdout;
const [listed, skipped] = out.split(/\n\d+ bộ sẽ chạy; bỏ qua có lý do:\n/);
const runs = new Set((listed ?? "").split("\n").map((l) => l.split(" ")[0]).filter(Boolean));
const skips = new Map((skipped ?? "").split("\n").map((l) => /^\s+(tests\/ui\/\S+): (.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const files = fs.readdirSync("tests/ui").filter((f) => f.endsWith(".mjs")).map((f) => `tests/ui/${f}`);
const orphan = files.filter((f) => !runs.has(f) && !skips.has(f));
ok(!orphan.length, `mọi tệp tests/ui/*.mjs (${files.length}) đều chạy hoặc bỏ qua có lý do`, orphan.join(", "));
ok([...skips.values()].every((why) => why.trim().length >= 20), "mỗi tệp bỏ qua có lý do rõ ràng", JSON.stringify([...skips]));
ok(![...skips.keys()].some((f) => runs.has(f)), "tệp bỏ qua không bị chạy");
ok(runs.has("tests/run-all.mjs") && [...runs][0] === "tests/run-all.mjs", "bộ API chạy đầu tiên", [...runs].slice(0, 3).join(", "));
ok(runs.has("tests/ui/a11y-focus.mjs") && runs.has("tests/ui/downloads.mjs") && skips.has("tests/ui/snapshots.mjs"), "a11y-focus, downloads chạy; snapshots (công cụ chụp ảnh) bỏ qua có lý do");
ok(runs.has("tests/ui/free-account.mjs"), "ma trận tài khoản miễn phí (H1.3) nằm trong QA");
const noApi = spawnSync(process.execPath, ["scripts/qa.mjs", "--list", "--no-api"], { encoding: "utf8" }).stdout;
ok(!/^tests\/run-all\.mjs/m.test(noApi) && /^tests\/ui\/audit\.mjs/m.test(noApi), "--no-api bỏ bộ API (CI chạy nó ở bước riêng), giữ bộ giao diện");

console.log("2. waitFor / settle");
let n = 0, t = Date.now();
ok(await waitFor(() => (++n >= 3 ? "xong" : 0), 2000) === "xong" && Date.now() - t < 1500, "trả giá trị đầu tiên truthy, không chờ hết hạn", Date.now() - t);
t = Date.now();
ok(await waitFor(async () => { throw new Error("chưa"); }, 250) === false && Date.now() - t < 1000, "điều kiện ném lỗi: coi là chưa được, hết hạn trả false", Date.now() - t);
let v = 0; t = Date.now();
const iv = setInterval(() => { if (v < 3) v++; }, 60);
ok(await settle(() => v, 250, 3000) === 3, "settle đợi giá trị đứng yên", v);
clearInterval(iv);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
