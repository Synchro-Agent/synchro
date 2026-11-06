// Cổng lượt, phần không cần máy chủ: việc phụ (oneShot → subTurn) phải xin chỗ, lượt đã giữ chỗ thì không xin thêm, mức chung mọi làn của một tài khoản, tài khoản chưa xác minh.
// Thư mục dữ liệu tạm và không có CLI nào được cài: subTurn dừng ở bước "chưa cài CLI", không chạy tiến trình nào, không gọi hãng nào.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-slots-"));
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
process.env.SYNCHRO_TURNS_GLOBAL = "14";
delete process.env.SYNCHRO_RELAX_LIMITS;
setInterval(() => {}, 1000);

const { turngate: G, runs: Rn, "ai/subs": S, authstore: A } = await loadTs(["turngate", "runs", "ai/subs", "authstore"]);
const tick = () => new Promise((r) => setTimeout(r, 5));
const free = (uid) => G.runningOf(uid, "run") + G.runningOf(uid, "quick") + G.runningOf(uid, "code");

console.log("1. Mức chung mọi làn của một tài khoản");
{
  ok(G.accountTotal() === 6, "mặc định 6 lượt trên mọi làn", G.accountTotal());
  const held = [];
  for (let i = 0; i < 4; i++) held.push(await G.acquire({ uid: "a", lane: "run", limit: 4 }));
  for (let i = 0; i < 2; i++) held.push(await G.acquire({ uid: "a", lane: "code", limit: 5 }));
  ok(free("a") === 6, "giữ đủ 6 lượt qua hai làn", free("a"));
  let why = null;
  const ctl = new AbortController();
  const c = G.acquire({ uid: "a", lane: "code", limit: 5, signal: ctl.signal, onWait: (w) => { why = w; } });
  await tick();
  ok(free("a") === 6 && why === "account", "làn còn chỗ nhưng hết mức chung: xếp hàng, báo do tài khoản", why);
  held.push(await G.acquire({ uid: "a", lane: "quick", limit: 6 }), await G.acquire({ uid: "a", lane: "quick", limit: 6 }));
  ok(free("a") === 8, "việc phụ vẫn có hai chỗ riêng khi chat đầy: đoạn chat vẫn được đặt tên", free("a"));
  ok((await G.acquire({ uid: "a", lane: "quick", limit: 6, maxWaitMs: 20 })) === "timeout", "việc phụ quá hai chỗ đó thì cũng chờ");
  const other = await G.acquire({ uid: "b", lane: "run", limit: 4 });
  ok(typeof other === "function", "tài khoản khác vẫn chạy được khi một tài khoản dùng hết mức của nó");
  other();
  ctl.abort();
  ok((await c) === "cancelled", "Dừng lúc chờ vẫn rời hàng");
  const q = G.acquire({ uid: "a", lane: "code", limit: 5 });
  held.shift()();
  await tick();
  ok(free("a") === 7, "chưa về dưới mức chung thì lượt chờ chưa được chạy", free("a"));
  held.shift()(); held.shift()();
  await tick();
  ok(free("a") === 6, "về dưới mức chung thì lượt chờ tự chạy", free("a"));
  (await q)();
  for (const s of held) s();
  ok(free("a") === 0 && G.gateStats().running === 0, "trả hết chỗ", free("a"));
}

console.log("2. Lượt đã giữ chỗ không xin thêm");
{
  const inner = [];
  const s = await G.acquire({ uid: "n", lane: "run", limit: 1, total: 1 });
  ok(!G.holdsSlot(), "ngoài lượt: không giữ chỗ");
  await G.withSlot(s, async () => { inner.push(G.holdsSlot()); await tick(); inner.push(G.holdsSlot()); });
  ok(inner.length === 2 && inner.every(Boolean), "trong lượt, qua cả await: đang giữ chỗ");
  ok(!G.holdsSlot(), "ngoài lượt sau khi xong: không giữ");
  ok(G.runningOf("n") === 0, "xong lượt thì trả chỗ");
  const s2 = await G.acquire({ uid: "n", lane: "run", limit: 1, total: 1 });
  let bg;
  await G.withSlot(s2, async () => { bg = (async () => { await new Promise((r) => setTimeout(r, 15)); return G.holdsSlot(); })(); });
  ok((await bg) === false, "việc nền tách ra chạy sau khi lượt xong (rút bộ nhớ) không còn được tính là giữ chỗ");
  const s3 = await G.acquire({ uid: "n", lane: "run", limit: 1, total: 1 });
  await G.withSlot(s3, async () => { throw new Error("x"); }).catch(() => {});
  ok(G.runningOf("n") === 0, "lượt lỗi vẫn trả chỗ", G.runningOf("n"));
}

console.log("3. subTurn: việc phụ phải qua cổng");
{
  const user = { id: "side", email: "side@synchro.test", email_verified: 1, role: "member", created_at: 0 };
  const call = (signal) => S.subTurn({ user, model: "sub-claude/haiku", system: "x", messages: [{ role: "user", content: "x" }], effort: "low", signal });
  const r0 = await call();
  ok(r0.status === 503 && /chưa được cài/.test(r0.json.error), "còn chỗ: chạy tiếp tới bước kiểm tra CLI", JSON.stringify(r0));
  ok(free("side") === 0, "xong thì trả chỗ", free("side"));
  const lim = Rn.quickLimit(user), total = Rn.turnsTotal(user);
  ok(lim === 6 && total === 6, "tài khoản đã xác minh: 6 việc phụ, mức chung 6", `${lim} ${total}`);
  const held = [];
  for (let i = 0; i < lim; i++) held.push(await G.acquire({ uid: "side", lane: "quick", limit: lim, total }));
  // Đầy chỗ: lời gọi phải xếp hàng, không chạy CLI. Bấm dừng khi đang chờ thì kết thúc là đã dừng.
  const ctl = new AbortController();
  let done = false;
  const w = call(ctl.signal).then((r) => { done = true; return r; });
  await tick();
  ok(!done && G.queuedOf("side", "quick") === 1, "hết chỗ: việc phụ xếp hàng thay vì mở thêm CLI", G.queuedOf("side", "quick"));
  ctl.abort();
  const rw = await w;
  ok(rw.status === 200 && rw.json.cancelled === true && rw.json.text === "", "dừng lúc đang chờ: không chạy CLI", JSON.stringify(rw));
  // Gửi dồn: hàng chờ có giới hạn, phần vượt bị từ chối ngay. Đây là ca 40 yêu cầu phản biện, 80 CLI.
  const ctl2 = new AbortController();
  const burst = Array.from({ length: 80 }, () => call(ctl2.signal));
  await tick();
  ok(free("side") === lim, "80 lời gọi cùng lúc: số chỗ đang giữ không tăng", free("side"));
  ok(G.queuedOf("side", "quick") === G.queueLimit(), "chỉ giữ đúng số lượt trong hàng chờ", G.queuedOf("side", "quick"));
  ctl2.abort();
  const rs = await Promise.all(burst);
  ok(rs.filter((r) => r.status === 503).length === 80 - G.queueLimit(), "phần vượt hàng chờ được báo máy chủ bận", rs.filter((r) => r.status === 503).length);
  // Lượt đang giữ chỗ gọi lồng vào: đã đầy cũng không chờ (không tự chặn mình).
  const s = held.pop();
  const nested = await Promise.race([G.withSlot(s, () => call()), new Promise((r) => setTimeout(() => r("treo"), 2000))]);
  ok(nested !== "treo" && nested.status === 503 && /chưa được cài/.test(nested.json.error), "lượt đã giữ chỗ gọi lồng: chạy ngay, không xin chỗ thứ hai", JSON.stringify(nested));
  for (const h of held) h();
  ok(free("side") === 0, "trả hết chỗ", free("side"));
}

console.log("4. Tài khoản chưa xác minh không lấy lại đủ chỗ qua đường chạy thẳng");
{
  const user = { id: "locked", email: "x@synchro.test", email_verified: 0, role: "member", created_at: Date.now() };
  const locked = A.verifyLocked(user);
  if (locked) {
    ok(Rn.quickLimit(user) === 2 && Rn.turnsTotal(user) === 2, "chưa xác minh: 2 việc phụ, mức chung 2", `${Rn.quickLimit(user)} ${Rn.turnsTotal(user)}`);
    const a = await G.acquire({ uid: "locked", lane: "run", limit: 2, total: 2 }), b = await G.acquire({ uid: "locked", lane: "run", limit: 2, total: 2 });
    const c = await G.acquire({ uid: "locked", lane: "quick", limit: 2, total: 2 }), d = await G.acquire({ uid: "locked", lane: "quick", limit: 2, total: 2 });
    ok(free("locked") === 4, "2 lượt chat cộng 2 việc phụ: bằng một nửa của tài khoản đã xác minh (8)", free("locked"));
    ok((await G.acquire({ uid: "locked", lane: "quick", limit: 2, total: 2, maxWaitMs: 20 })) === "timeout", "bỏ async:true không còn lấy thêm được chỗ");
    ok((await G.acquire({ uid: "locked", lane: "code", limit: 5, total: 2, maxWaitMs: 20 })) === "timeout", "làn Code cũng tính chung");
    d();
    a(); b(); c();
  } else ok(false, "tài khoản thử phải đang bị khóa xác minh");
}

console.log("4b. Tiến trình khởi động sẵn đang rảnh tính vào mức của cả máy");
{
  let idle = 3, evicted = 0;
  G.registerIdle({ count: () => idle, evict: () => { if (!idle) return false; idle--; evicted++; return true; } });
  const held = [];
  for (let i = 0; i < 11; i++) held.push(await G.acquire({ uid: `m${i}`, lane: "run", limit: 4 }));
  ok(G.gateStats().running === 11 && idle === 3 && evicted === 0, "11 lượt + 3 tiến trình rảnh = đúng mức 14: chưa ai phải nhường", `${G.gateStats().running} ${idle}`);
  ok(G.warmRoom() === false, "hết mức: không khởi động sẵn thêm");
  held.push(await G.acquire({ uid: "m12", lane: "run", limit: 4 }));
  ok(evicted === 1 && idle === 2 && G.gateStats().running === 12, "lượt thật cần chỗ: tiến trình rảnh nhường, lượt không phải chờ", `${evicted} ${idle}`);
  ok(G.gateStats().running + idle <= 14, "lượt đang chạy cộng tiến trình rảnh không vượt mức", G.gateStats().running + idle);
  held.push(await G.acquire({ uid: "m13", lane: "run", limit: 4 }), await G.acquire({ uid: "m14", lane: "run", limit: 4 }));
  ok(idle === 0 && G.gateStats().running === 14, "đủ 14 lượt thật: hết tiến trình rảnh", `${idle} ${G.gateStats().running}`);
  ok((await G.acquire({ uid: "m15", lane: "run", limit: 4, maxWaitMs: 20 })) === "timeout", "đủ lượt thật thì lượt sau mới phải chờ");
  for (const s of held) s();
  ok(G.warmRoom() === true, "máy rảnh: khởi động sẵn lại được");
  G.registerIdle({ count: () => 0, evict: () => false });
}

console.log("5. Ngắt kết nối dừng lời gọi chạy thẳng");
{
  ok(Rn.turnSignal() === undefined, "ngoài lượt, ngoài kết nối: không có tín hiệu");
  const ctl = new AbortController();
  const seen = await Rn.withStop(ctl.signal, async () => { await tick(); return Rn.turnSignal(); });
  ok(seen === ctl.signal, "lời gọi chạy thẳng dùng tín hiệu của kết nối, qua cả await");
  ok(Rn.withStop(ctl.signal, () => Rn.runSignal()) === undefined, "không giả làm lượt bền: runSignal vẫn trống");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
