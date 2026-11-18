// Lỗi 5 (ma trận tài khoản miễn phí): hai tệp ghi âm trong một tin nhắn không đọc cùng lúc được (hàng "convert" mỗi người một việc) và tệp thứ hai
// bị báo "Máy chủ đang đọc nhiều tệp cùng lúc". Nay tệp sau của cùng người xếp hàng chờ lượt của họ: có giới hạn số tệp chờ và thời gian chờ,
// quá thì nói đúng lý do. Người khác không phải chờ hàng của người này. Không cần máy chủ web.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
process.env.SYNCHRO_CONVERT_WAIT_MS = "400";
process.env.SYNCHRO_CONVERT_MAX = "2";

const { "fileproc/sandbox": S, "shared/fileproc/types": T, "shared/i18n-ops": O } = await loadTs(["fileproc/sandbox", "shared/fileproc/types", "shared/i18n-ops"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let open; const p = new Promise((r) => (open = r)); return { p, open }; };

console.log("1. Hai tệp ghi âm của cùng một người: tệp sau chờ lượt, cả hai đều xong");
{
  const order = [], g1 = gate();
  const a = S.withConvertSlot("u1", async () => { order.push("a:start"); await g1.p; order.push("a:end"); return "A"; });
  const b = S.withConvertSlot("u1", async () => { order.push("b:start"); return "B"; });
  await sleep(20);
  const st = S.slotState("convert", "u1");
  ok(st.running === 1 && st.waiting === 1 && order.join() === "a:start", "tệp thứ hai đang chờ (không báo bận, không chạy chồng)", { st, order });
  g1.open();
  const [ra, rb] = await Promise.all([a, b]);
  ok(ra === "A" && rb === "B" && order.join() === "a:start,a:end,b:start", "tệp thứ hai chạy ngay sau tệp thứ nhất", order);
  const st2 = S.slotState("convert", "u1");
  ok(st2.running === 0 && st2.waiting === 0 && st2.global === 0, "xong hết thì không còn giữ chỗ", st2);
}

console.log("2. Thứ tự gửi được giữ, không ai chen ngang lúc chỗ vừa trống");
{
  const order = [], g = gate();
  const jobs = [S.withConvertSlot("u2", async () => { await g.p; order.push(1); })];
  for (let i = 2; i <= 4; i++) jobs.push(S.withConvertSlot("u2", async () => { order.push(i); }));
  await sleep(10);
  g.open();
  // Gửi thêm đúng lúc tệp đầu xong: phải đứng sau 2, 3, 4.
  await sleep(0);
  jobs.push(S.withConvertSlot("u2", async () => { order.push(5); }));
  await Promise.all(jobs);
  ok(order.join() === "1,2,3,4,5", "chạy đúng thứ tự gửi", order);
  ok(S.slotState("convert", "u2").running === 0, "không vượt một việc mỗi người", S.slotState("convert", "u2"));
}

console.log("3. Người khác không phải chờ hàng của người này");
{
  const g = gate(), done = [];
  const a = S.withConvertSlot("u3", async () => { await g.p; });
  const a2 = S.withConvertSlot("u3", async () => { done.push("u3b"); });
  const other = S.withConvertSlot("u4", async () => { done.push("u4"); });
  await other;
  ok(done.join() === "u4", "u4 chạy ngay trong khi tệp thứ hai của u3 còn chờ", done);
  g.open(); await Promise.all([a, a2]);
}

console.log("4. Chờ có giới hạn: quá thời gian thì báo đúng lý do (không phải \"máy chủ bận\")");
{
  const g = gate();
  const a = S.withConvertSlot("u5", async () => { await g.p; });
  let err = null;
  const t0 = Date.now();
  await S.withConvertSlot("u5", async () => "never").catch((e) => { err = e; });
  const waited = Date.now() - t0;
  ok(err instanceof T.FileError && /tệp trước của bạn/i.test(err.message) && !/Máy chủ đang đọc nhiều tệp/.test(err.message), "quá thời gian chờ: báo tệp trước của bạn còn đang đọc", err?.message);
  ok(waited >= 350 && waited < 3000, `chờ đúng giới hạn (${waited} ms, đặt 400 ms)`, waited);
  ok(S.slotState("convert", "u5").waiting === 0, "người hết thời gian chờ đã ra khỏi hàng", S.slotState("convert", "u5"));
  g.open(); await a;
  ok(S.slotState("convert", "u5").running === 0, "không rò chỗ sau khi có người bỏ hàng", S.slotState("convert", "u5"));
  ok(!!O.OPS_VI2EN[err?.message], "lời báo có bản tiếng Anh", err?.message);
}

console.log("5. Số tệp chờ mỗi người có giới hạn (một tin nhắn tối đa 20 tệp)");
{
  const g = gate(), jobs = [];
  for (let i = 0; i < T.MAX_FILES_PER_MESSAGE + 1; i++) jobs.push(S.withConvertSlot("u6", async () => { await g.p; }).then(() => "ok", (e) => e.message));
  let extra = null;
  await S.withConvertSlot("u6", async () => {}).catch((e) => { extra = e; });
  ok(extra instanceof T.FileError && /nhiều tệp chờ đọc/.test(extra.message), "quá 20 tệp chờ: báo rõ, không treo", extra?.message);
  ok(!!O.OPS_VI2EN[extra?.message], "lời báo có bản tiếng Anh", extra?.message);
  g.open();
  const rs = await Promise.all(jobs);
  ok(rs.every((r) => r === "ok"), "1 tệp đang đọc + 20 tệp chờ: tất cả xong", rs.filter((r) => r !== "ok"));
}

console.log("6. Hàng đọc tệp thường (parse): tệp thứ 5 của một người chờ thay vì báo bận");
{
  const g = gate(), jobs = [];
  for (let i = 0; i < 6; i++) jobs.push(S.withParseSlot("u7", async () => { await g.p; return i; }).then((x) => x, (e) => e.message));
  await sleep(10);
  const st = S.slotState("parse", "u7");
  ok(st.waiting >= 2, "tệp vượt mức chạy cùng lúc của người đó đang chờ", st);
  g.open();
  const rs = await Promise.all(jobs);
  ok(rs.join() === "0,1,2,3,4,5", "cả 6 tệp đều đọc xong", rs);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
