// H2.2: mọi tệp tests/ui/*.mjs hoặc chạy trong npm run qa, hoặc nằm trong danh sách bỏ qua của scripts/qa.mjs kèm lý do; H2.1: bộ giao diện
// có workflow CI riêng (ui-qa.yml) không chặn deploy, bản giả lập build đủ bộ nhớ; tiện ích chờ
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
// B3.7: kiểm ngân sách tải đầu (vài giây, không cần máy chủ) chạy trước, rồi tới bộ API.
ok([...runs][0] === "scripts/budget.mjs" && [...runs][1] === "tests/run-all.mjs", "ngân sách tải đầu chạy trước, bộ API ngay sau", [...runs].slice(0, 3).join(", "));
ok(runs.has("tests/ui/a11y-focus.mjs") && runs.has("tests/ui/downloads.mjs") && skips.has("tests/ui/snapshots.mjs"), "a11y-focus, downloads chạy; snapshots (công cụ chụp ảnh) bỏ qua có lý do");
ok(runs.has("tests/ui/free-account.mjs"), "ma trận tài khoản miễn phí (H1.3) nằm trong QA");
const noApi = spawnSync(process.execPath, ["scripts/qa.mjs", "--list", "--no-api"], { encoding: "utf8" }).stdout;
ok(!/^tests\/run-all\.mjs/m.test(noApi) && /^tests\/ui\/audit\.mjs/m.test(noApi), "--no-api bỏ bộ API (CI chạy nó ở bước riêng), giữ bộ giao diện");

console.log("2. CI: bộ giao diện chạy được mà không chặn deploy khi chưa từng xanh");
const W = ".github/workflows/";
const deploy = fs.readFileSync(`${W}deploy.yml`, "utf8"), uiqa = fs.existsSync(`${W}ui-qa.yml`) ? fs.readFileSync(`${W}ui-qa.yml`, "utf8") : "";
const step = (y, name) => (y.split(/\n      - /).find((b) => b.includes(`name: ${name}`)) ?? "");
ok(!/scripts\/qa\.mjs/.test(deploy.replace(/^\s*#.*$/gm, "")), "deploy.yml (job verify, chặn deploy) không chạy bộ giao diện chưa từng xanh");
ok(/--max-old-space-size=4096/.test(step(deploy, "Khởi động Synchro giả lập")) && /--max-old-space-size=4096/.test(step(uiqa, "Khởi động Synchro giả lập")), "bước build bản giả lập trong CI có heap 4096 MB như bước Build production");
ok(/node scripts\/qa\.mjs --no-api/.test(uiqa) && /workflow_dispatch/.test(uiqa) && /if: github\.event_name != 'push' \|\| vars\.SYNCHRO_CI_UI == 'push'/.test(uiqa), "ui-qa.yml chạy npm run qa khi bấm tay / theo lịch; lần đẩy chỉ chạy khi bật SYNCHRO_CI_UI");
const weekly = [...uiqa.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
ok(weekly.length === 1 && /^\d+ \d+ \* \* \d$/.test(weekly[0]), "lịch của ui-qa.yml một lần mỗi tuần (≈ 320 phút Actions / tháng)", weekly);
const dm = fs.readFileSync("scripts/dev-mock.mjs", "utf8");
ok(/max-old-space-size=\$\{process\.env\.MOCK_BUILD_HEAP_MB \?\? 4096\}/.test(dm), "dev:mock:fast tự đặt heap 4096 MB cho bước build khi NODE_OPTIONS chưa đặt");

console.log("3. waitFor / settle");
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
