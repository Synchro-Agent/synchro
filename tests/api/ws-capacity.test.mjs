// Sức chứa của dịch vụ workspace theo RAM thật (workspace/capacity.mjs, Blueprint G3): công thức từng hồ, kẹp, đặt tay ghi đè.
// Không cần Docker hay máy chủ: chỉ nạp mô-đun thuần.
import fs from "node:fs";
import * as cap from "../../workspace/capacity.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

// Máy chủ thật: 7935 MB.
const BOX = 7935;
const run = (total, raw) => cap.ramSlots({ raw, total, reserve: 2560, perMB: 2048, fallback: 3, min: 2, max: 24 });
const ws = (total, raw) => cap.ramSlots({ raw, total, reserve: 2560, perMB: 1536, fallback: 4, min: 3, max: 32 });

console.log("1. G3.1: mỗi hồ tính riêng floor((RAM − 2560) × 0,5 / MB một việc), không chia 0,5/0,3/0,2");
for (const total of [BOX, 16384, 32768, 65536]) {
  ok(run(total) === Math.max(2, Math.min(24, Math.floor((total - 2560) * 0.5 / 2048))), `RUN_MAX ở ${total} MB`, run(total));
  ok(ws(total) === Math.max(3, Math.min(32, Math.floor((total - 2560) * 0.5 / 1536))), `MAX_RUNNING ở ${total} MB`, ws(total));
}
ok(run(32768) === 7 && ws(32768) === 9, "32 GB: RUN_MAX 7, MAX_RUNNING 9 (bản chia 0,2/0,3 chỉ ra 2 và 5)", `${run(32768)} ${ws(32768)}`);
ok(run(BOX) === 2 && ws(BOX) === 3, "W23-1: máy 7,9 GB kẹp sàn 2 chỗ chạy code (đủ cho 2 container giữ sẵn) và 3 workspace", `${run(BOX)} ${ws(BOX)}`);

console.log("2. Kẹp trần, đo RAM hỏng về mặc định cũ, đặt tay thì theo");
ok(run(10_000_000) === 24 && ws(10_000_000) === 32, "kẹp trần 24 / 32");
ok(run(0) === 3 && ws(0) === 4, "không đo được RAM: mặc định cũ 3 / 4");
ok(run(BOX, "5") === 5 && ws(BOX, "7") === 7, "WS_RUN_MAX / WS_MAX_RUNNING đặt tay thắng");
ok(run(BOX, "0") === 2 && run(BOX, "abc") === 2 && run(BOX, "") === 2, "đặt tay không hợp lệ: theo công thức");

console.log("3. Đọc RAM thật và đổi đơn vị");
ok(cap.readTotalMB() > 0, "readTotalMB() > 0 trên máy này", cap.readTotalMB());
ok(cap.memMB("2g", 0) === 2048 && cap.memMB("1536m", 0) === 1536 && cap.memMB("x", 9) === 9, "memMB đổi 2g / 1536m");
ok(cap.memMB("2.5g", 0) === 2560 && cap.memMB("1.5g", 1024) === 1536 && cap.memMB("512k", 0) === 1 && cap.memMB("3GB", 0) === 3072 && cap.memMB(" 1g ", 0) === 1024, "memMB đọc số thập phân và đơn vị (2.5g = 2560, 1.5g = 1536)", `${cap.memMB("2.5g", 0)} ${cap.memMB("1.5g", 1024)}`);
ok(cap.memMB("2gx", 7) === 7 && cap.memMB("1,5g", 7) === 7 && cap.memMB("-1", 7) === 7 && cap.memMB("", 7) === 7, "memMB: chuỗi sai định dạng trả mặc định (không đọc nửa chừng)");
ok(cap.memBytes("2.5g") === 2684354560 && cap.memBytes("3072m") === 3221225472 && cap.memBytes("-1") === -1 && cap.memBytes("lạ") === 0, "memBytes khớp số byte Docker lưu (2.5g = 2684354560)");

console.log("4. agent.mjs dùng đúng các hồ này, không còn hệ số 0,3 / 0,2");
const src = fs.readFileSync("workspace/agent.mjs", "utf8");
ok(/RUN_MAX = ramSlots\("WS_RUN_MAX", 2048, 3, RUN_MIN, 24\)/.test(src) && /RUN_MIN = Math\.max\(2, Math\.min\(24, Number\.isFinite\(WARM\) \? WARM : 2\)\)/.test(src), "RUN_MAX = ramSlots(WS_RUN_MAX, 2048, …), sàn max(2, số container giữ sẵn)");
ok(/MAX_RUNNING = ramSlots\("WS_MAX_RUNNING", 1536, 4, 3, 32\)/.test(src), "MAX_RUNNING = ramSlots(WS_MAX_RUNNING, 1536, …), sàn 3");
{
  // W23-1: lần dựng video giữ chỗ dựng (mediaQ), không giữ thêm chỗ chạy chung (runQ).
  const body = src.slice(src.indexOf("async function runOnce("), src.indexOf("// Proxy cho code"));
  ok(/if \(!media\) \{\s*try \{ freeSlot = await runQ\.acquire\(/.test(body) && /let freeSlot = \(\) => \{\}, freeMedia = \(\) => \{\};/.test(body), "runOnce: chỉ lần chạy không phải dựng video mới lấy runQ", body.slice(0, 200));
  ok(/runQ\.running > 0 \|\| mediaQ\.running > 0 \|\| replying > 0/.test(src), "tắt dịch vụ chờ cả lần dựng video đang dở");
}
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

console.log("6. W23-5 / G3.3: --memory-swap lớn hơn --memory cho cả workspace lẫn lần chạy code");
{
  ok(/"--memory", MEMORY, "--memory-swap", MEMORY_SWAP/.test(src), "workspace: --memory-swap MEMORY_SWAP");
  ok(/"--memory", RUN_MEMORY, "--memory-swap", RUN_MEMORY_SWAP/.test(src), "chạy code (boxLimits): --memory-swap RUN_MEMORY_SWAP");
  ok(!/"--memory-swap", (RUN_)?MEMORY[,\]]/.test(src), "không còn --memory-swap bằng đúng --memory");
  const swapSrc = /const swapOf = [^\n]+/.exec(src)?.[0] ?? "";
  const swapOf = new Function("memMB", `${swapSrc}; return swapOf;`)(cap.memMB);
  ok(swapOf("2g", "1g") === "3072m" && swapOf("1536m", "1g") === "2560m", "mặc định: RAM + 1 GB (2g → 3072m, 1536m → 2560m)", `${swapOf("2g", "1g")} ${swapOf("1536m", "1g")}`);
  ok(swapOf("lạ", "1g") === "lạ", "RAM đọc không được: giữ swap = RAM (Docker không nhận swap < RAM)");
  ok(swapOf("2g", "1.5g") === "3584m" && swapOf("2.5g", "1g") === "3584m", "WS_SWAP_EXTRA / RAM thập phân: 2g + 1.5g = 3584m (trước đây ra 2049m)", `${swapOf("2g", "1.5g")} ${swapOf("2.5g", "1g")}`);
  ok(/const swapBytes = memBytes\(MEMORY_SWAP\)/.test(src) && /!updated\.has\(want\)/.test(src) && /updated\.add\(want\)/.test(src), "ensure(): so số byte thật, mỗi container chỉ docker update một lần");
  ok(/env\("WS_RUN_MEMORY_SWAP"/.test(src) && /env\("WS_MEMORY_SWAP"/.test(src), "đặt tay được bằng WS_RUN_MEMORY_SWAP / WS_MEMORY_SWAP");
  ok(/swapOld \? \["--memory", MEMORY, "--memory-swap", MEMORY_SWAP\]/.test(src), "workspace tạo từ bản trước được docker update swap tại chỗ");
}

console.log("7. W23-4 / G3.2: hàng chờ có vị trí cho RAM và chỗ workspace");
{
  const line = cap.createWaitLine({ pollMs: 5 });
  let free = false;
  ok((await line.wait(async () => true)).pos === 0, "đủ chỗ: đi ngay, vị trí 0");
  const seen = [[], [], []];
  const ps = [0, 1, 2].map((i) => line.wait(async () => free, { deadlineMs: 2000, onPos: (p) => seen[i].push(p) }));
  await new Promise((r) => setTimeout(r, 30));
  ok(line.length === 3 && seen.map((x) => x[0]).join() === "1,2,3", "ba người chờ được báo vị trí 1, 2, 3", JSON.stringify(seen));
  free = true;
  const rs = await Promise.all(ps);
  ok(rs.every((r) => r.ok === true) && rs.map((r) => r.pos).join() === "1,2,3", "có chỗ: đi theo thứ tự, mỗi người biết vị trí lúc vào hàng", JSON.stringify(rs));
  // Vị trí đọc theo nhịp hỏi (pollMs) nên có thể nhảy cóc (3 → 1), nhưng luôn giảm dần và tới 1 trước khi đi.
  ok(seen[2][0] === 3 && seen[2].at(-1) === 1 && seen[2].every((p, i) => i === 0 || p < seen[2][i - 1]), "người cuối thấy vị trí giảm dần từ 3 về 1", JSON.stringify(seen[2]));
  ok(line.length === 0, "hàng trống sau khi mọi người đi");
  free = false;
  const a = line.wait(async () => free, { deadlineMs: 2000 });
  const t = await line.wait(async () => free, { deadlineMs: 40 });
  ok(t.ok === false && t.pos === 2, "hết giờ chờ: ok = false kèm vị trí hiện tại (2)", JSON.stringify(t));
  const ac = new AbortController();
  const c = line.wait(async () => free, { signal: ac.signal, deadlineMs: 2000 });
  ac.abort();
  ok((await c).ok === "aborted", "người dùng dừng: rời hàng");
  free = true;
  ok((await a).ok === true && line.length === 0, "người đầu vẫn đi được, hàng sạch");
  let calls = 0;
  const l2 = cap.createWaitLine({ pollMs: 5 });
  const first = l2.wait(async () => { calls++; return calls > 3; }, { deadlineMs: 2000 });
  let secondChecked = false;
  const second = l2.wait(async () => { secondChecked = true; return true; }, { deadlineMs: 2000 });
  await first; await second;
  ok(!secondChecked || calls > 3, "người sau không được thử trước người đứng đầu");
}
{
  ok(/memLine\.wait\(async \(\) => \(await memAvailableMB\(\)\) >= needMB/.test(src), "waitMem dùng hàng có vị trí");
  ok(/roomLine\.wait\(\(\) => freeRoom\(u\)/.test(src) && /vị trí \$\{r\.pos\} trong hàng chờ/.test(src), "makeRoom xếp hàng có vị trí thay vì 503 ngay");
  ok(/waitMem\(WS_FLOOR_MB/.test(src), "bật workspace cũng chờ RAM (trước docker run)");
  ok(/vị trí \$\{m\.pos\} trong hàng chờ bộ nhớ/.test(src), "hết giờ chờ RAM: lời báo có vị trí");
  ok(/\.\.\.\(queue \? \{ queue \} : \{\}\)/.test(src), "runOnce trả queue cho người gọi");
  const cr = fs.readFileSync("app/coderun.ts", "utf8");
  ok(/queue\?: RunQueue/.test(cr) && /\.\.\.\(queue \? \{ queue \} : \{\}\)/.test(cr), "coderun chuyển queue sang RunOutput");
  ok(/RUN_QUEUE_ALLOW_SEC\) \* 1000/.test(cr), "coderun chờ đủ lâu cho hàng chờ của workspace (không bỏ ngang trước khi có vị trí)");
}
{
  // Người dùng thấy vị trí trong hàng ở dòng tiến trình của lượt chat, có bản tiếng Anh.
  const ce = fs.readFileSync("app/chatengine.ts", "utf8");
  ok(/if \(r\.queue\) progress\("note", queueNote\(r\.queue\)\)/.test(ce), "run_code báo vị trí hàng chờ thành dòng tiến trình");
  const { loadTs } = await import("../lib/ts.mjs");
  const { "i18n-dict": { RULES_EN } } = await loadTs(["i18n-dict"]);
  const cr = fs.readFileSync("app/coderun.ts", "utf8");
  const body = cr.match(/export function queueNote\(q: RunQueue\): string \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const queueNote = new Function("q", body);
  const en = (t) => { for (const [re, f] of RULES_EN) { const m = t.match(re); if (m) return f(m); } return null; };
  const a = queueNote({ pos: 3, waitedSec: 41.6 }), b = queueNote({ pos: 0, waitedSec: 7 });
  ok(a === "Lần chạy code đã xếp hàng ở vị trí 3, chờ 42 giây", "dòng tiến trình nói vị trí 3", a);
  ok(b === "Lần chạy code đã chờ 7 giây vì máy chủ đang bận", "chỉ chờ RAM (không có hàng): nói số giây", b);
  ok(en(a) === "The code run was queued at position 3, waited 42 seconds" && en(b) === "The code run waited 7 seconds because the server was busy", "có bản tiếng Anh", `${en(a)} | ${en(b)}`);
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
