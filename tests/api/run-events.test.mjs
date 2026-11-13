// Bảng run_events (ghi nối thêm): mỗi bước của lượt là một dòng, không đọc-sửa-ghi lại cả danh sách mỗi lần.
// Kiểm thử không cần máy chủ (loadTs): thời gian mỗi bước phẳng ở bước 1 và bước 100 (không chậm dần theo bình phương);
// getRun trả đúng hình dạng/thứ tự như bản cũ; migration một lần; đọc cột cũ làm dự phòng; trigger xóa sự kiện khi xóa lượt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-run-events-"));
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
const keepAlive = setInterval(() => {}, 1000);

const { runs: Rn, authstore: A } = await loadTs(["runs", "authstore"]);
const d = A.db();
// Tạo một dòng runs (chỉ cần dòng tồn tại để progress ghi được); getRun kích hoạt init() tạo bảng run_events + trigger.
const mkRun = (id, status = "running", events = "[]", uid = "u1") => {
  Rn.getRun(id);
  d.prepare("INSERT INTO runs (id, user_id, kind, status, events, created_at, updated_at) VALUES (?, ?, 'chat', ?, ?, ?, ?)").run(id, uid, status, events, Date.now(), Date.now());
};

console.log("1. progress() ghi nối thêm: thời gian mỗi bước phẳng ở bước 1 vs bước 100");
mkRun("run_flat");
const emitted = [];
Rn.inRun("run_flat", () => {
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) emitted.push(Rn.progress("step", "bước " + (i + 1)));
  const firstBlock = Number(process.hrtime.bigint() - t1);
  for (let i = 10; i < 90; i++) emitted.push(Rn.progress("step", "bước " + (i + 1)));
  const t2 = process.hrtime.bigint();
  for (let i = 90; i < 100; i++) emitted.push(Rn.progress("step", "bước " + (i + 1)));
  const lastBlock = Number(process.hrtime.bigint() - t2);
  // Append-only là O(1) mỗi bước nên hai khối gần bằng nhau; bản cũ đọc/ghi lại cả mảng sẽ làm khối cuối chậm hơn nhiều lần.
  ok(lastBlock < firstBlock * 6 + 5_000_000, `10 bước cuối (${Math.round(lastBlock / 1000)}µs) không chậm dần so với 10 bước đầu (${Math.round(firstBlock / 1000)}µs)`, `last=${lastBlock}ns first=${firstBlock}ns`);
});
ok(emitted.length === 100 && emitted[0] === 1 && emitted[99] === 100, "100 bước, seq liên tục 1..100", `${emitted[0]}..${emitted[99]} (n=${emitted.length})`);
ok(d.prepare("SELECT COUNT(*) n FROM run_events WHERE run_id = ?").get("run_flat").n === 100, "run_events có đúng 100 dòng (ghi nối thêm, không ghi đè)");
ok(d.prepare("SELECT events FROM runs WHERE id = ?").get("run_flat").events === "[]", "cột runs.events không bị đụng tới (giữ để quay lui)");

console.log("2. getRun trả đúng như bản cũ (tối đa 400 bước gần nhất, thứ tự tăng dần)");
// Bản cũ lưu list.slice(-400) theo thứ tự tăng dần: dựng lại kỳ vọng từ chính các dòng đã ghi rồi so khớp từng trường.
const expectFlat = d.prepare("SELECT seq, at, kind, text FROM run_events WHERE run_id = ? ORDER BY seq ASC").all("run_flat").slice(-400);
const gotFlat = Rn.getRun("run_flat").events;
ok(JSON.stringify(gotFlat) === JSON.stringify(expectFlat), "getRun = đường cũ với lượt 100 bước (shape + thứ tự y hệt)", `n=${gotFlat.length}`);
// Lượt dài hơn 400 bước: chỉ 400 bước gần nhất, seq 51..450.
mkRun("run_big");
Rn.inRun("run_big", () => { for (let i = 0; i < 450; i++) Rn.progress("note", "n" + i); });
const big = Rn.getRun("run_big").events;
const expectBig = d.prepare("SELECT seq, at, kind, text FROM run_events WHERE run_id = ? ORDER BY seq ASC").all("run_big").slice(-400);
ok(big.length === 400 && big[0].seq === 51 && big[399].seq === 450 && JSON.stringify(big) === JSON.stringify(expectBig), "cắt còn 400 bước gần nhất như list.slice(-400)", `len=${big.length} ${big[0]?.seq}..${big[399]?.seq}`);

console.log("3. Lượt chưa chuyển sang bảng mới: getRun đọc cột runs.events (dự phòng quay lui)");
const oldEvents = [{ seq: 1, at: 111, kind: "step", text: "cũ 1" }, { seq: 2, at: 222, kind: "say", text: "cũ 2" }];
mkRun("run_old", "done", JSON.stringify(oldEvents));
ok(d.prepare("SELECT COUNT(*) n FROM run_events WHERE run_id = ?").get("run_old").n === 0, "run_events chưa có dòng nào cho lượt cũ");
ok(JSON.stringify(Rn.getRun("run_old").events) === JSON.stringify(oldEvents), "run_events trống thì đọc đúng cột cũ", JSON.stringify(Rn.getRun("run_old").events));

console.log("4. migrateEvents: chuyển một lần, chạy lại không nhân đôi (idempotent)");
const n1 = Rn.migrateEvents();
const n2 = Rn.migrateEvents();
ok(n1 === 2 && n2 === 0, "lần đầu chuyển 2 dòng của lượt cũ, lần sau 0 (INSERT OR IGNORE)", `${n1} rồi ${n2}`);
ok(JSON.stringify(d.prepare("SELECT seq, at, kind, text FROM run_events WHERE run_id = ? ORDER BY seq").all("run_old")) === JSON.stringify(oldEvents), "sự kiện cũ đã nằm trong run_events sau migration");
ok(JSON.stringify(Rn.getRun("run_old").events) === JSON.stringify(oldEvents), "getRun sau migration vẫn trả đúng như trước");
// Lượt đã có sẵn trong bảng mới không bị migration nhân đôi (events='[]' nên bị bỏ qua).
ok(d.prepare("SELECT COUNT(*) n FROM run_events WHERE run_id = ?").get("run_flat").n === 100, "lượt đã append-only không bị migration đụng tới");

console.log("5. Xóa lượt thì xóa luôn run_events (trigger, cho mọi đường dọn)");
d.prepare("DELETE FROM runs WHERE id = ?").run("run_flat");
ok(d.prepare("SELECT COUNT(*) n FROM run_events WHERE run_id = ?").get("run_flat").n === 0, "DELETE FROM runs: trigger xóa hết sự kiện của lượt");
// Đường dọn công khai sweepRuns(): lượt quá hạn bị xóa và sự kiện của nó cũng mất.
d.prepare("INSERT INTO runs (id, user_id, kind, status, events, created_at, updated_at) VALUES ('run_stale', 'u1', 'chat', 'done', '[]', 0, 0)").run();
d.prepare("INSERT INTO run_events (run_id, seq, at, kind, text) VALUES ('run_stale', 1, 0, 'step', 'x')").run();
Rn.sweepRuns();
ok(!d.prepare("SELECT 1 FROM runs WHERE id = 'run_stale'").get() && d.prepare("SELECT COUNT(*) n FROM run_events WHERE run_id = 'run_stale'").get().n === 0, "sweepRuns dọn lượt quá hạn và cả sự kiện của nó");

clearInterval(keepAlive);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
