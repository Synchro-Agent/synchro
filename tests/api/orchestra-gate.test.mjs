// Orchestra trong lượt chat thật: mỗi lời gọi gói của thành viên (một CLI riêng trên máy chủ) giữ chỗ riêng ở cổng
// lượt, kể cả khi lượt chat bao ngoài đã giữ chỗ của nó; máy đầy thì lời gọi báo bận chứ không chạy thêm CLI. Việc
// Autopilot chỉ được chia cho nhóm vài lần mỗi ngày. Không cần máy chủ: cơ sở dữ liệu tạm, cổng lượt với mức nhỏ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-orchgate-"));
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, "data"), DATA_KEY: "orch-gate-key", SYNCHRO_TURNS_GLOBAL: "2", SYNCHRO_ORCH_TASK_DAY: "2",
});
// Bộ chạy song song nới mức của cổng (SYNCHRO_RELAX_LIMITS): bài này cần đúng mức nhỏ ở trên.
delete process.env.SYNCHRO_RELAX_LIMITS;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
// Bộ hẹn giờ của cổng không giữ tiến trình: bài này tự giữ.
const keep = setInterval(() => {}, 1000);

const M = await loadTs(["authstore", "turngate", "orchestra/index"]);
const AU = M.authstore, TG = M.turngate, O = M["orchestra/index"];
const user = AU.createUser({ email: `orch${Date.now()}@synchro.test`, name: "orch", verified: true });

try {
  console.log("1. Lời gọi gói của thành viên giữ chỗ riêng");
  const run = await TG.acquire({ uid: user.id, lane: "run" });
  await TG.withSlot(run, async () => {
    ok(TG.holdsSlot(), "đang ở trong lượt chat đã giữ chỗ (như /api/llm, RunService)");
    const ctl = new AbortController();
    const mine = await O.slotFor(user, ctl.signal, false, 1000);
    ok(TG.runningOf(user.id, "quick") === 1 && TG.gateStats().running === 2,
      "lời gọi của thành viên vẫn xin chỗ, tính vào mức tài khoản và cả máy", TG.gateStats());
    let err = null;
    const t0 = Date.now();
    try {
      await O.slotFor(user, ctl.signal, false, 300);
    } catch (e) {
      err = e;
    }
    ok(/bận/.test(String(err?.message)) && Date.now() - t0 < 2000 && TG.gateStats().running === 2,
      "cả máy đầy: lời gọi báo bận sau thời gian chờ, không chạy thêm CLI", err?.message);
    const later = new AbortController();
    const waiting = O.slotFor(user, later.signal, false, 5000).then(() => "ok", (e) => e.message);
    later.abort();
    ok(/dừng/i.test(await waiting) && TG.gateStats().running === 2, "bấm Dừng lúc đang chờ chỗ: thôi chờ");
    mine();
    ok(TG.runningOf(user.id, "quick") === 0, "xong lời gọi: trả chỗ");
  });
  ok(TG.gateStats().running === 0, "lượt chat xong: không còn giữ chỗ nào");
  const bg = await O.slotFor(user, new AbortController().signal, true, 1000);
  ok(typeof bg === "function" && TG.runningOf(user.id, "quick") === 1, "lời gọi của Autopilot xin chỗ ở hàng việc nền");
  bg();

  console.log("2. Autopilot: số lần chia cho nhóm mỗi ngày");
  const d1 = new Date("2026-11-20T08:00:00Z"), d2 = new Date("2026-11-21T08:00:00Z");
  const runs = [O.taskRoom(user.id, "t1", d1), O.taskRoom(user.id, "t1", d1), O.taskRoom(user.id, "t1", d1)];
  ok(runs.join() === "true,true,false", "quá số lần trong ngày: lần sau chạy một model", runs);
  ok(O.taskRoom(user.id, "t2", d1), "việc khác đếm riêng");
  ok(O.taskRoom(user.id, "t1", d2), "sang ngày mới đếm lại");
} finally {
  clearInterval(keep);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
