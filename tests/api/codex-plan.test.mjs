// Lỗi 8 của ma trận H1 (tài khoản miễn phí): "Tasks 0/3" đứng yên tới cuối lượt dù model đã xong bước 1. GPT qua Codex có update_plan DỰNG SẴN của Codex
// bên cạnh update_plan của Synchro; trước đây Synchro bỏ qua danh sách việc dựng sẵn nên khung chat chỉ thấy lần gọi update_plan của Synchro (đầu / cuối lượt).
// Kiểm: đổi danh sách việc của Codex (exec: mục todo_list; app-server: turn/plan/updated) sang danh sách việc của Synchro, và sự kiện "plan" tới NGAY lúc
// model cập nhật (không dồn cuối lượt) trên CLI giả lập, cả hai đường. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900)); };
const J = (x) => JSON.stringify(x);
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-codexplan-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.DATA_KEY = "codex-plan-test";
process.env.SYNCHRO_CODEX_SERVER_MAX = "2";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.SYNCHRO_ENGINE_BWRAP; delete process.env.SYNCHRO_CODEX_SERVER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); fs.mkdirSync(BIN, { recursive: true });
for (const f of fs.readdirSync("tools/mock-cli")) { fs.copyFileSync(path.join("tools/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9" }));
const { "ai/engine": EN, "ai/cli_engines": CE, "ai/codex_server": CS, "chat/planmerge": PM } = await loadTs(["ai/engine", "ai/cli_engines", "ai/codex_server", "chat/planmerge"]);
const warn0 = console.warn; console.warn = () => {};

try {
  console.log("1. Đổi danh sách việc của Codex sang của Synchro");
  ok(J(EN.cliPlan([{ text: "A", completed: true }, { text: "B", completed: false }, { text: "C", completed: false }])) === J([{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }]),
    "exec (todo_list): việc đầu chưa xong là việc đang làm, sau đó là chờ");
  ok(J(EN.cliPlan([{ text: "A", completed: true }, { text: "B", completed: true }])) === J([{ content: "A", status: "completed" }, { content: "B", status: "completed" }]), "exec: xong hết");
  ok(J(EN.cliPlan([{ step: "A", status: "completed" }, { step: "B", status: "inProgress" }, { step: "C", status: "pending" }])) === J([{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }]),
    "app-server (turn/plan/updated): inProgress → in_progress");
  ok(EN.cliPlan([]) === null && EN.cliPlan(null) === null && EN.cliPlan("x") === null && EN.cliPlan([{ text: "" }]) === null, "rỗng / sai dạng: không có danh sách");
  const long = EN.cliPlan(Array.from({ length: 20 }, (_, i) => ({ text: `Việc ${i} ` + "x".repeat(300), completed: false })));
  ok(long.length === 12 && long.every((x) => x.content.length <= 120), "tối đa 12 việc, mỗi việc 120 ký tự (như update_plan của Synchro)", long.length);

  const acct = (n) => { const d = path.join(HOME, "logins", "codex", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "auth.json"), "{}"); return { CODEX_HOME: d }; };
  const run = async (req) => {
    const t0 = Date.now(), plans = [];
    let final = null, err = null;
    for await (const e of new CE.CodexEngine().runTurn(req)) {
      if (e.kind === "plan") plans.push({ at: Date.now() - t0, done: e.items.filter((x) => x.status === "completed").length, items: e.items });
      else if (e.kind === "final") final = { text: e.text, at: Date.now() - t0 };
      else if (e.kind === "error") err = e.message;
    }
    return { plans, final, err };
  };
  const live = (r, name) => {
    ok(!r.err && r.final, `${name}: lượt xong`, r);
    ok(r.plans.map((p) => p.done).join() === "0,1,2,3", `${name}: nhận đủ 4 lần cập nhật 0→3 việc xong`, r.plans.map((p) => p.done));
    ok(J(r.plans[1]?.items.map((x) => x.status)) === J(["completed", "in_progress", "pending"]), `${name}: xong việc 1 thì việc 2 là đang làm`, r.plans[1]);
    // Mock xong một việc mỗi 1,5 giây: lần cập nhật đầu tới trước câu trả lời ≥ 4 giây, các lần cách nhau ≥ 1 giây (không dồn cuối lượt).
    const gaps = r.plans.slice(1).map((p, i) => p.at - r.plans[i].at);
    ok(r.final && r.final.at - r.plans[0].at >= 4000 && gaps.every((g) => g >= 1000), `${name}: tới ngay lúc model cập nhật`, { first: r.plans[0]?.at, final: r.final?.at, gaps });
  };

  console.log("1b. Một danh sách việc mỗi lượt khi model dùng cả hai update_plan");
  const L = (...st) => st.map((x, i) => ({ content: `Việc ${i + 1}`, status: x }));
  const N3 = (...st) => st.map((x, i) => ({ content: `native ${i + 1}`, status: x }));
  { const x = {};
    ok(J(PM.notePlan(x, "native", N3("in_progress", "pending", "pending"))) === J(N3("in_progress", "pending", "pending")), "chỉ có danh sách dựng sẵn: hiện như thường");
    ok(J(PM.notePlan(x, "synchro", L("in_progress", "pending", "pending"))) === J(L("in_progress", "pending", "pending")) && x.plan.src === "synchro", "update_plan của Synchro: thay danh sách, thành nguồn chính");
    ok(J(PM.notePlan(x, "native", N3("completed", "in_progress", "pending"))) === J(L("completed", "in_progress", "pending")), "dựng sẵn cùng số việc: cập nhật trạng thái, giữ chữ của Synchro (không nhảy sang danh sách khác)");
    ok(PM.notePlan(x, "native", N3("completed", "in_progress", "pending")) === null, "dựng sẵn không đổi trạng thái: không gửi lại");
    ok(PM.notePlan(x, "native", [...N3("completed", "completed", "in_progress"), { content: "native 4", status: "pending" }]) === null && J(x.plan.items) === J(L("completed", "in_progress", "pending")), "dựng sẵn khác số việc: bỏ qua, danh sách trên thanh việc giữ nguyên");
    ok(J(PM.notePlan(x, "synchro", L("completed", "completed", "completed"))) === J(L("completed", "completed", "completed")), "Synchro gửi lại: luôn hiện đúng như gửi");
    ok(J(PM.notePlan(x, "synchro", [])) === "[]", "Synchro gửi danh sách rỗng: vẫn gửi (như trước)"); }
  ok(J(PM.notePlan(undefined, "native", N3("pending"))) === J(N3("pending")) && PM.notePlan(undefined, "native", []) === null, "lượt không có cầu nối MCP: danh sách dựng sẵn hiện như thường");

  const promptSrc = fs.readFileSync("server/chat/prompt.ts", "utf8");
  ok(/cli === "codex" \? CODEX_PLAN_NOTE/.test(promptSrc) && /CODEX_PLAN_NOTE = "[^"]*update_plan của máy chủ synchro[^"]*xong mỗi bước/.test(promptSrc), "prompt của Codex: dặn dùng update_plan của synchro và gọi lại khi xong mỗi bước");

  console.log("2. codex exec (mục todo_list)");
  process.env.SYNCHRO_CODEX_SERVER = "0";
  live(await run({ prompt: "[mock:nativeplan] làm bảng lương", env: acct("e"), workdir: path.join(HOME, "work", "e") }), "exec");
  delete process.env.SYNCHRO_CODEX_SERVER;

  console.log("3. codex app-server (turn/plan/updated)");
  live(await run({ prompt: "[mock:nativeplan] làm bảng lương", env: acct("s"), workdir: path.join(HOME, "work", "s") }), "app-server");
  ok(CS.codexServerStats().servers >= 1, "lượt chạy qua app-server", CS.codexServerStats());

  console.log("4. Lượt thường không có danh sách việc");
  const plain = await run({ prompt: "chào", env: acct("s"), workdir: path.join(HOME, "work", "s") });
  ok(plain.final && plain.plans.length === 0, "không tự sinh danh sách việc", plain);
} finally {
  console.warn = warn0;
  CS.dropAllCodexServers();
}
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
