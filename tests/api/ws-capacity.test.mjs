// Sức chứa của dịch vụ workspace theo RAM thật (workspace/capacity.mjs, Blueprint G3): công thức từng hồ, kẹp, đặt tay ghi đè.
// Không cần Docker hay máy chủ: chỉ nạp mô-đun thuần.
import fs from "node:fs";
import * as cap from "../../workspace/capacity.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

// Máy chủ thật: 7935 MB.
const BOX = 7935;
const run = (total, raw) => cap.ramSlots({ raw, total, reserve: 2560, perMB: 2048, fallback: 3, min: 1, max: 24 });
const ws = (total, raw) => cap.ramSlots({ raw, total, reserve: 2560, perMB: 1536, fallback: 4, min: 2, max: 32 });

console.log("1. G3.1: mỗi hồ tính riêng floor((RAM − 2560) × 0,5 / MB một việc), không chia 0,5/0,3/0,2");
for (const total of [BOX, 16384, 32768, 65536]) {
  ok(run(total) === Math.max(1, Math.min(24, Math.floor((total - 2560) * 0.5 / 2048))), `RUN_MAX ở ${total} MB`, run(total));
  ok(ws(total) === Math.max(2, Math.min(32, Math.floor((total - 2560) * 0.5 / 1536))), `MAX_RUNNING ở ${total} MB`, ws(total));
}
ok(run(32768) === 7 && ws(32768) === 9, "32 GB: RUN_MAX 7, MAX_RUNNING 9 (bản chia 0,2/0,3 chỉ ra 2 và 5)", `${run(32768)} ${ws(32768)}`);
ok(run(BOX) === 1 && ws(BOX) === 2, "máy 7,9 GB: kẹp sàn (1 và 2)", `${run(BOX)} ${ws(BOX)}`);

console.log("2. Kẹp trần, đo RAM hỏng về mặc định cũ, đặt tay thì theo");
ok(run(10_000_000) === 24 && ws(10_000_000) === 32, "kẹp trần 24 / 32");
ok(run(0) === 3 && ws(0) === 4, "không đo được RAM: mặc định cũ 3 / 4");
ok(run(BOX, "5") === 5 && ws(BOX, "7") === 7, "WS_RUN_MAX / WS_MAX_RUNNING đặt tay thắng");
ok(run(BOX, "0") === 1 && run(BOX, "abc") === 1 && run(BOX, "") === 1, "đặt tay không hợp lệ: theo công thức");

console.log("3. Đọc RAM thật và đổi đơn vị");
ok(cap.readTotalMB() > 0, "readTotalMB() > 0 trên máy này", cap.readTotalMB());
ok(cap.memMB("2g", 0) === 2048 && cap.memMB("1536m", 0) === 1536 && cap.memMB("x", 9) === 9, "memMB đổi 2g / 1536m");

console.log("4. agent.mjs dùng đúng các hồ này, không còn hệ số 0,3 / 0,2");
const src = fs.readFileSync("workspace/agent.mjs", "utf8");
ok(/RUN_MAX = ramSlots\("WS_RUN_MAX", 2048, 3, 1, 24\)/.test(src), "RUN_MAX = ramSlots(WS_RUN_MAX, 2048, …)");
ok(/MAX_RUNNING = ramSlots\("WS_MAX_RUNNING", 1536, 4, 2, 32\)/.test(src), "MAX_RUNNING = ramSlots(WS_MAX_RUNNING, 1536, …)");
ok(!/ramSlots\([^)]*0\.[23],/.test(src), "không còn hệ số chia 0,3 / 0,2");
ok(!/CLI_SHARE/.test(fs.readFileSync("app/turngate.ts", "utf8")), "turngate không còn CLI_SHARE");

console.log("5. INT-1: MEDIA_MAX theo cùng RAM thật, không quá RUN_MAX, đặt tay thì theo");
{
  const media = (total, o = {}) => cap.mediaSlots({ total, reserve: 2560, runMax: run(total), cap: 4, ...o });
  ok(media(BOX) === 1 && media(16384) === 1, "8 GB và 16 GiB đều ra 1 (bản cũ theo GB thập phân ra 4 ở 16 GiB)", `${media(BOX)} ${media(16384)}`);
  ok(media(32768) === 4, "32 GB: floor(30208×0,5/3584) = 4", media(32768));
  for (const total of [BOX, 16384, 24576, 32768, 65536, 262144]) ok(media(total) <= run(total) && media(total) >= 1, `${total} MB: 1 ≤ MEDIA_MAX ≤ RUN_MAX`, `${media(total)} vs ${run(total)}`);
  ok(media(262144) === 4, "trần WS_MEDIA_CAP (4)", media(262144));
  ok(media(262144, { cap: "2" }) === 2, "WS_MEDIA_CAP đặt tay", media(262144, { cap: "2" }));
  ok(media(BOX, { raw: "3" }) === 3, "WS_MEDIA_MAX đặt tay thắng", media(BOX, { raw: "3" }));
  ok(media(0, { runMax: 3 }) === 1, "không đo được RAM: 1");
  ok(/MEDIA_MAX = mediaSlots\(\{[^}]*total: realTotalMB\(\)[^}]*runMax: RUN_MAX/.test(src) && !/os\.totalmem\(\) \/ 1e9/.test(src), "agent.mjs: mediaSlots(realTotalMB, RUN_MAX), không còn os.totalmem/1e9");
  ok(/\[timing\] mem trần theo RAM[^\n]*MEDIA_MAX=\$\{MEDIA_MAX\}/.test(src), "dòng [timing] mem trần ghi cả MEDIA_MAX");
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
