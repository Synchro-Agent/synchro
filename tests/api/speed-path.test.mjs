// Thời gian chờ trước chữ đầu tiên: việc nền chạy bằng model rẻ nhất và không lấn lượt chat, tiến trình khởi động sẵn khớp đúng lượt thật, dòng [timing] đủ để đo trên máy chủ thật.
// Dùng CLI giả lập: chỉ kiểm tra đường đi và khóa của hồ tiến trình. Mọi con số thời gian ở đây không nói gì về tốc độ thật. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(50); } return false; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-speed-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "speed-test-key";
process.env.SYNCHRO_CLAUDE_POOL_MAX = "6";
process.env.SYNCHRO_MOCK_OFFLINE = "1";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
const SRC = path.join(process.cwd(), "scripts", "mock-cli");
for (const f of ["claude", "mock-cli-common.cjs"]) fs.copyFileSync(path.join(SRC, f), path.join(BIN, f));
fs.chmodSync(path.join(BIN, "claude"), 0o755);
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 200 }));

const { router: R, "ai/anymodel": AM, "ai/cli_pool": PO, chatengine: CH, authstore: AU, "ai/cli_auth": A, skillstudio: ST, turngate: TG, "ai/subs": SUBS } =
  await loadTs(["router", "ai/anymodel", "ai/cli_pool", "chatengine", "authstore", "ai/cli_auth", "skillstudio", "turngate", "ai/subs"]);

// Giữ lại dòng [timing] để kiểm tra các trường mà người vận hành sẽ đọc trên máy chủ thật.
const lines = [], log0 = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.startsWith("[timing]")) lines.push(s); else if (!s.startsWith("[design]")) log0(...a); };
const lastTurn = () => [...lines].reverse().find((l) => /^\[timing\] claude \S+ \S+ resume=/.test(l)) ?? "";

try {
  console.log("1. Việc phụ: model rẻ nhất, không tính chi phí chờ chữ");
  const CL = ["sub-claude/fable", "sub-claude/opus", "sub-claude/sonnet", "sub-claude/haiku"];
  const CX = ["sub-codex/gpt-6.1-astra", "sub-codex/gpt-6.1-sol", "sub-codex/gpt-6-luna"];
  const AG = ["sub-agy/gemini-3.8-argon", "sub-agy/gemini-3.8-pro", "sub-agy/gemini-3.8-flash"];
  const GR = ["sub-grok/grok-build", "sub-grok/grok-4.7"];
  for (const [list, want, why] of [
    [[...CL, ...CX, ...AG, ...GR], "sub-claude/haiku", "đủ các gói: Haiku"],
    [CX, "sub-codex/gpt-6-luna", "chỉ ChatGPT: Luna, không phải Sol"],
    [["sub-claude/opus", "sub-claude/sonnet", ...CX], "sub-codex/gpt-6-luna", "Haiku tạm hết hạn mức: Luna rẻ hơn Sonnet dù hiện chữ chậm"],
    [AG, "sub-agy/gemini-3.8-flash", "chỉ Gemini: Flash"],
    [["sub-codex/gpt-6.1-sol", "sub-codex/gpt-6.1-astra"], "sub-codex/gpt-6.1-sol", "không có hạng nhanh: hạng cân bằng"],
    [["sub-claude/fable", "sub-claude/opus"], "sub-claude/opus", "Fable tính vào tiền thật: không chọn"],
    [GR, "sub-grok/grok-4.7", "Grok Build chỉ để viết code"],
  ]) { const got = R.sideModel(list); ok(got === want, `${why}: ${got}`, got); }
  ok(R.sideModel(["sub-claude/haiku", "sub-codex/gpt-6-luna"], { avoid: ["sub-claude/haiku"] }) === "sub-codex/gpt-6-luna", "CLI đang treo: tránh");
  ok(R.sideModel(["sub-claude/haiku"], { avoid: ["sub-claude/haiku"] }) === "sub-claude/haiku", "chỉ còn CLI đang treo: vẫn dùng");
  ok(R.sideModel([]) === null, "không có model nào");
  for (const k of ["sub-codex/gpt-6.1-sol", "sub-claude/sonnet"]) ok(R.tierOf(k) === "balanced", `${k} được coi là hạng cân bằng`);

  console.log("2. Việc nền thật qua quickCall");
  ST.getTag("x");
  const user = AU.createUser({ email: `speed${Date.now()}@synchro.test`, name: "Speed", verified: true });
  await A.startLogin("claude", user.id, "oauth");
  await A.submitCode("claude", user.id, "MOCK-CLAUDE-OK");
  await A.status("claude", user.id, { fresh: true });
  const q = await AM.quickCall(user, "Đặt tên.", "Đoạn chat cần đặt tên: x", { job: "title" });
  ok(q.model === "sub-claude/haiku", `chạy bằng model rẻ nhất của gói: ${q.model}`, q.model);
  ok(/\[timing\] claude haiku low .*job=title/.test(lastTurn()), "nỗ lực thấp, dòng [timing] ghi tên việc", lastTurn());
  ok(/ chunks=\d+ /.test(lastTurn()), "dòng [timing] có số đợt chữ: chunks=1 nghĩa là chữ đầu chính là cả câu trả lời", lastTurn());
  AM.noteStall(user.id, "claude");
  const stalled = await AM.quickCall(user, "Đặt tên.", "x");
  ok(stalled.model === "sub-claude/haiku", "chỉ có một gói mà đang treo: việc phụ vẫn chạy", stalled.model);
  AM.clearStall(user.id, "claude");

  console.log("3. Việc nền không lấn chỗ của lượt chat");
  {
    fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 700 }));
    lines.length = 0;
    const jobs = Array.from({ length: 5 }, (_, i) => AM.quickCall(user, "Chưng cất.", `việc ${i}`, { job: "brain", bg: true }).catch((e) => e));
    await until(() => TG.runningOf(user.id, "quick") > 0);
    await sleep(300);
    ok(TG.runningOf(user.id, "quick") <= 2, `5 việc nền cùng lúc: chỉ ${TG.runningOf(user.id, "quick")} CLI chạy, còn lại xếp hàng`, TG.runningOf(user.id, "quick"));
    ok(TG.queuedOf(user.id, "quick") === 3, "3 việc còn lại đang chờ", TG.queuedOf(user.id, "quick"));
    const fg = await AM.quickCall(user, "Đặt tên.", "việc đang được chờ", { job: "title" });
    ok(!!fg.text, "đặt tên (người dùng đang nhìn) không phải xếp sau việc nền");
    const done = await Promise.all(jobs);
    ok(done.every((x) => x.text), "cả 5 việc nền cuối cùng đều xong", JSON.stringify(done.map((x) => x.message ?? "ok")));
    fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 200 }));
  }

  console.log("\n" + (fail ? `${pass}/${pass + fail} đạt` : `${pass}/${pass} đạt`));
} finally {
  console.log = log0;
  PO.dropAll();
  await sleep(100);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
