// H4.3: người dùng bấm "Chạy lại" trên dòng lỗi thì bộ hẹn giờ không tự chạy lại lần lỗi đó nữa (việc có tác dụng phụ như gửi tin không chạy hai lần);
// kết quả quá cũ ghi "expired" chứ không phải "error". Thư mục dữ liệu tạm, không chạy model nào (mọi lần chạy ở đây đều bị bỏ qua trước bước launch).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-retry-"));
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
process.env.SYNCHRO_TASK_RETRY_MS = String(10 * 60_000);

const { tasks: T, runs: R, authstore: A } = await loadTs(["tasks", "runs", "authstore"]);
const d = A.db();
T.listTasks("u1"); // tạo bảng tasks / task_runs
R.getRun(""); // tạo bảng runs
const now = Date.now(), MIN = 60_000;
const task = (id) => d.prepare("INSERT INTO tasks (id, owner, title, prompt, schedule, enabled, created_at) VALUES (?, 'u1', ?, 'x', '{\"kind\":\"once\"}', 0, ?)").run(id, id, now - 3600_000);
const run = (id, status, at, error) => d.prepare("INSERT INTO runs (id, user_id, kind, status, result, created_at, updated_at) VALUES (?, 'u1', 'chat', ?, ?, ?, ?)").run(id, status, error === undefined ? null : JSON.stringify({ error }), at, at);
const row = (id, taskId, at, kind = "run") => d.prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at, kind) VALUES (?, ?, 'u1', ?, ?, ?)").run(id, taskId, taskId, at, kind);
const retried = (id) => d.prepare("SELECT retried FROM task_runs WHERE run_id = ?").get(id).retried;

console.log("1. Bộ hẹn giờ bỏ qua lần lỗi đã có lần chạy mới hơn");
{
  task("t1"); run("old1", "error", now - 40 * MIN, "fetch failed"); row("old1", "t1", now - 40 * MIN);
  run("man1", "running", now - 5 * MIN); row("man1", "t1", now - 5 * MIN);
  // Đối chứng: việc khác lỗi gần đây, chưa ai chạy lại, chưa tới RETRY_MS → vẫn chờ tự chạy lại (retried = 0).
  task("t2"); run("old2", "error", now - 2 * MIN, "fetch failed"); row("old2", "t2", now - 2 * MIN);
  // Việc đã duyệt (kind action) mới hơn không tính là lần chạy lại của lịch.
  task("t3"); run("old3", "error", now - 1 * MIN, "fetch failed"); row("old3", "t3", now - 1 * MIN); run("act3", "done", now); row("act3", "t3", now, "action");
  const n = await T.tick(now);
  ok(n === 0, "không chạy lần nào", n);
  ok(retried("old1") === 2, "lần lỗi cũ của việc đã được chạy lại: đánh dấu xong, không tự chạy lại", retried("old1"));
  ok(retried("man1") === 0, "lần chạy mới (đang chạy) không bị đụng tới", retried("man1"));
  ok(retried("old2") === 0, "việc khác chưa ai chạy lại: vẫn chờ tự chạy lại", retried("old2"));
  ok(retried("old3") === 0, "việc đã duyệt mới hơn không chặn tự chạy lại của lịch", retried("old3"));
}

console.log("2. Chạy lại bằng tay đánh dấu các lần lỗi trước của việc đó");
{
  task("t4"); row("f4a", "t4", now - 30 * MIN); row("f4b", "t4", now - 20 * MIN); row("new4", "t4", now);
  task("t5"); row("f5", "t5", now - 30 * MIN);
  d.prepare("UPDATE task_runs SET retried = 1 WHERE run_id = 'f4a'").run();
  const changed = T.supersede("t4", "new4");
  ok(changed === 1 && retried("f4b") === 2 && retried("f4a") === 1, "chỉ lần chưa xử lý (retried 0) của việc đó đổi thành 2", JSON.stringify({ changed, a: retried("f4a"), b: retried("f4b") }));
  ok(retried("new4") === 0 && retried("f5") === 0, "lần mới và việc khác giữ nguyên");
  const src = fs.readFileSync("app/tasks.ts", "utf8");
  const rn = src.slice(src.indexOf("export async function runNow"), src.indexOf("export async function runApproved"));
  ok(/const run = launch\(r, \{ chrome \}\);[\s\S]*supersede\(r\.id, run\);/.test(rn), "runNow (POST /api/tasks/:id/run) gọi supersede sau khi chạy", rn.slice(0, 400));
}

console.log("3. Kết quả quá cũ là hết hạn, không phải lỗi");
{
  task("t6"); row("gone6", "t6", now - 400 * 24 * 3600_000);
  d.prepare("UPDATE task_runs SET retried = 2").run();
  // Dòng cũ ghi từ trước bản sửa (status error + TOO_OLD) cũng hiện là hết hạn.
  task("t7"); row("old7", "t7", now - 300 * 24 * 3600_000);
  d.prepare("UPDATE task_runs SET result = ? WHERE run_id = 'old7'").run(JSON.stringify({ status: "error", error: "Kết quả này đã quá cũ nên không còn lưu." }));
  const items = T.inbox("u1", { limit: 100 }).items;
  const g6 = items.find((x) => x.run === "gone6"), g7 = items.find((x) => x.run === "old7");
  ok(g6?.status === "expired" && /quá cũ/.test(g6.error ?? ""), "lượt đã mất trước khi lưu: expired", JSON.stringify(g6));
  ok(JSON.parse(d.prepare("SELECT result FROM task_runs WHERE run_id = 'gone6'").get().result).status === "expired", "ghi expired vào bản lưu");
  ok(g7?.status === "expired", "dòng cũ còn ghi error + quá cũ: hiện là expired", JSON.stringify(g7));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
