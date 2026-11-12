// GET /api/chats?since=…: một trang thay đổi tới 4 MB không còn đọc liền một mạch (chặn máy chủ lúc trang vừa mở). changesSince nhường vòng sự
// kiện sau mỗi ~512 KB; mục bị ghi lại giữa chừng thì để sang trang sau, không gửi nội dung mới kèm rev cũ. Tự chạy được, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-chatasync-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SYNCHRO_MIN_FREE_MB = "1";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const tick = () => new Promise((ok) => setImmediate(ok));

try {
  const { authstore: A, chatstore: CS } = await loadTs(["authstore", "chatstore"]);
  const u = A.createUser({ email: "a@chatasync.test", name: "A", verified: true });
  const body = (i, v = 1) => JSON.stringify({ id: i, title: `Chat ${i} v${v}`, pad: "x".repeat(300_000) });
  const r = CS.pushItems(u.id, Array.from({ length: 10 }, (_, i) => ({ kind: "chat", id: String(i + 1), upd: 1000 + i, data: body(i + 1) })));
  ok(r.every((x) => x.ok), "đẩy 10 đoạn chat ~300 KB", r.filter((x) => !x.ok));

  console.log("1. Trả về Promise, nhường vòng sự kiện giữa chừng");
  let ticks = 0, on = true;
  const spin = async () => { while (on) { ticks++; await tick(); } };
  const s = spin();
  const p = CS.changesSince(u.id, 0);
  ok(p instanceof Promise, "changesSince trả về Promise");
  const page = await p;
  on = false; await s;
  ok(page.items.length === 10 && page.items.every((it, i) => JSON.parse(it.data).title === `Chat ${i + 1} v1`), "đủ 10 mục, đúng nội dung và thứ tự", page.items.map((x) => x.id));
  ok(ticks >= 3, `việc khác chạy được trong lúc đọc 3 MB (${ticks} nhịp)`, ticks);
  ok(page.next === page.items[9].rev && page.more === false, "mốc tiếp theo là rev cuối, không còn trang sau");

  console.log("2. Mục ghi lại trong lúc đang đọc: sang trang sau, không lẫn rev cũ với nội dung mới");
  const p2 = CS.changesSince(u.id, 0);
  CS.pushItems(u.id, [{ kind: "chat", id: "9", upd: 5000, data: body(9, 2) }]);
  const pg2 = await p2;
  const nine = pg2.items.find((x) => x.id === "9");
  ok(!nine || JSON.parse(nine.data).title === "Chat 9 v1", "trang này không có bản mới của mục 9 kèm rev cũ", nine && { rev: nine.rev, t: JSON.parse(nine.data).title });
  ok(pg2.items.every((x) => x.deleted || typeof x.data === "string"), "không có mục chưa xóa mà thiếu nội dung");
  const pg3 = await CS.changesSince(u.id, pg2.next);
  const nine2 = pg3.items.find((x) => x.id === "9");
  ok(nine2 && JSON.parse(nine2.data).title === "Chat 9 v2" && nine2.rev > pg2.next, "trang sau có bản mới của mục 9", pg3.items.map((x) => [x.id, x.rev]));

  console.log("3. Mục đã xóa: data null, deleted 1");
  CS.pushItems(u.id, [{ kind: "chat", id: "2", upd: 9000, deleted: true }]);
  const pg4 = await CS.changesSince(u.id, pg3.next);
  const two = pg4.items.find((x) => x.id === "2");
  ok(two && two.deleted === 1 && two.data === null, "mục 2 đã xóa", two);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
