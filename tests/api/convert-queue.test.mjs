// Lỗi 5 (ma trận tài khoản miễn phí): hai tệp ghi âm trong một tin nhắn không đọc cùng lúc được (hàng "convert" mỗi người một việc) và tệp thứ hai
// bị báo "Máy chủ đang đọc nhiều tệp cùng lúc". Nay tệp sau của cùng người xếp hàng chờ lượt của họ: có giới hạn số tệp chờ và thời gian chờ,
// quá thì nói đúng lý do. Người khác không phải chờ hàng của người này. Không cần máy chủ web.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
process.env.SYNCHRO_CONVERT_WAIT_MS = "400";
process.env.SYNCHRO_PARSE_WAIT_MS = "150";
process.env.SYNCHRO_CONVERT_MAX = "2";

const { "fileproc/sandbox": S, "shared/fileproc/types": T, "shared/i18n-ops": O } = await loadTs(["fileproc/sandbox", "shared/fileproc/types", "shared/i18n-ops"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let open; const p = new Promise((r) => (open = r)); return { p, open }; };
// Tệp ghi âm (extractors.ts audioExtractor): chờ lượt lâu (CONVERT_WAIT_MS); các việc khác của hàng convert chờ như cũ (WAIT_MS).
const LONG = { long: true };

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
  await S.withConvertSlot("u5", async () => "never", LONG).catch((e) => { err = e; });
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
console.log("6b. Trần chung cho tệp chờ theo lượt riêng (mỗi tệp chờ giữ bộ nhớ tới 30 MB): quá thì báo máy chủ bận như trước");
{
  const g = gate(), jobs = [];
  const add = (u, n) => { for (let i = 0; i < n; i++) jobs.push(S.withConvertSlot(u, async () => { await g.p; return "ok"; }).then((x) => x, (e) => e.message)); };
  add("u8", 21); add("u9", 6);
  await sleep(10);
  const w = S.slotState("convert", "u8").waiting + S.slotState("convert", "u9").waiting;
  ok(w === 24, "u8 chờ 20 tệp, u9 chờ 4 tệp: tổng 24", w);
  g.open();
  const rs = await Promise.all(jobs);
  ok(rs.filter((x) => x === "ok").length === 26 && rs.filter((x) => /Máy chủ đang đọc nhiều tệp/.test(x)).length === 1, "tệp chờ thứ 25 (của u9) bị từ chối bằng lời máy chủ bận, 26 tệp còn lại xong", rs.filter((x) => x !== "ok"));
  const z = S.slotState("convert", "u9");
  ok(z.running === 0 && z.waiting === 0 && z.global === 0, "không rò chỗ", z);
}

console.log("4b. Việc khác của hàng convert (MarkItDown, Office cũ, OCR): tổng thời gian chờ như trước (WAIT_MS), không phải 10 phút của tệp ghi âm");
{
  const g = gate();
  const a = S.withConvertSlot("u10", async () => { await g.p; });
  const t0 = Date.now();
  const e = await S.withConvertSlot("u10", async () => "never").catch((x) => x);
  const waited = Date.now() - t0;
  ok(e instanceof T.FileError && waited >= 120 && waited < 380, `chờ theo WAIT_MS (${waited} ms, đặt 150 ms; tệp ghi âm 400 ms)`, { waited, e: e?.message });
  // Tổng thời gian chờ tính cho cả hai hàng: chờ lượt riêng gần hết giờ rồi vào hàng chung thì chỉ còn phần còn lại.
  const busy = [];
  // u10 (đang chạy) + u11: cả 2 chỗ chạy đều bận.
  busy.push(S.withConvertSlot("u11", async () => { await g.p; }));
  await sleep(5);
  const t1 = Date.now();
  const late = await S.withConvertSlot("u13", async () => "never").catch((x) => x);
  ok(late instanceof T.FileError && Date.now() - t1 < 380, "hàng chung đầy chỗ chạy: chờ đúng phần thời gian còn lại rồi báo bận", { ms: Date.now() - t1, e: late?.message });
  g.open(); await Promise.all([a, ...busy]);
}

console.log("8. Người gửi bỏ tệp (gỡ thẻ, đóng tab, hết giờ chờ): rời hàng ngay, không chạy (chép lời tốn credit)");
{
  const g = gate(), ran = [];
  const first = S.withConvertSlot("u20", async () => { await g.p; return "A"; }, LONG);
  const ac = new AbortController();
  const t0 = Date.now();
  const second = S.withConvertSlot("u20", async () => { ran.push("b"); return "B"; }, { ...LONG, signal: ac.signal }).catch((e) => e);
  const third = S.withConvertSlot("u20", async () => { ran.push("c"); return "C"; }, LONG);
  await sleep(20);
  ok(S.slotState("convert", "u20").waiting === 2, "hai tệp đang chờ lượt riêng", S.slotState("convert", "u20"));
  ac.abort();
  const e2 = await second;
  ok(e2 instanceof T.FileError && /không còn chờ/.test(e2.message) && Date.now() - t0 < 200, "tệp bị bỏ: rời hàng ngay với lời báo riêng", e2?.message);
  ok(S.slotState("convert", "u20").waiting === 1, "chỉ còn tệp thứ ba chờ", S.slotState("convert", "u20"));
  g.open();
  ok((await first) === "A" && (await third) === "C" && ran.join() === "c", "tệp bị bỏ không chạy; tệp sau nó vẫn chạy", ran);
  ok(S.slotState("convert", "u20").running === 0, "không rò chỗ", S.slotState("convert", "u20"));
  ok(!!O.OPS_VI2EN[e2?.message], "lời báo có bản tiếng Anh", e2?.message);

  // Bỏ trước khi vào hàng: không chạy, không giữ chỗ.
  const pre = new AbortController(); pre.abort();
  const e3 = await S.withConvertSlot("u21", async () => { ran.push("pre"); }, { ...LONG, signal: pre.signal }).catch((e) => e);
  ok(e3 instanceof T.FileError && !ran.includes("pre") && S.slotState("convert", "u21").running === 0, "đã bỏ trước khi xin chỗ: không chạy, không giữ chỗ", e3?.message);

  // Bỏ khi đang chờ ở hàng chung (mọi chỗ chạy đều bận): rời hàng chung, chỗ của người đó trả lại.
  const g2 = gate(), hold = [];
  for (const who of ["u22", "u23"]) hold.push(S.withConvertSlot(who, async () => { await g2.p; }));
  const ac2 = new AbortController();
  const w = S.withConvertSlot("u24", async () => { ran.push("w"); }, { ...LONG, signal: ac2.signal }).catch((e) => e);
  await sleep(10);
  ok(S.slotState("convert", "u24").global === 2 && S.slotState("convert", "u24").globalWaiting === 1, "u24 chờ ở hàng chung", S.slotState("convert", "u24"));
  ac2.abort();
  const e4 = await w;
  ok(e4 instanceof T.FileError && /không còn chờ/.test(e4.message) && S.slotState("convert", "u24").globalWaiting === 0 && S.slotState("convert", "u24").running === 0, "bỏ khi chờ hàng chung: rời hàng, trả chỗ", { e: e4?.message, st: S.slotState("convert", "u24") });
  g2.open(); await Promise.all(hold);
  ok(!ran.includes("w"), "việc bị bỏ không chạy", ran);
}

console.log("9. Tệp vừa tới lượt riêng không làm hàng chung vượt trần (wait = 6)");
{
  const g = gate(), jobs = [];
  for (const who of ["v1", "v2"]) jobs.push(S.withConvertSlot(who, async () => { await g.p; }).then(() => "ok", (e) => e.message));
  const ac = new AbortController();
  const a1 = S.withConvertSlot("va", async () => {}, { ...LONG, signal: ac.signal }).catch((e) => e.message);
  const a2 = S.withConvertSlot("va", async () => "a2", LONG).then((x) => x, (e) => e.message);
  for (const who of ["v3", "v4", "v5", "v6", "v7"]) jobs.push(S.withConvertSlot(who, async () => {}, LONG).then(() => "ok", (e) => e.message));
  await sleep(10);
  ok(S.slotState("convert", "va").globalWaiting === 6 && S.slotState("convert", "va").waiting === 1, "hàng chung đầy (6), tệp thứ hai của va chờ lượt riêng", S.slotState("convert", "va"));
  // Tệp đầu của va bỏ đi (hàng chung còn 5), ngay lúc đó một người khác vào chỗ trống (lại 6): tệp thứ hai của va tới lượt riêng nhưng hàng chung đã đầy.
  const t9 = Date.now();
  ac.abort();
  jobs.push(S.withConvertSlot("v8", async () => {}, LONG).then(() => "ok", (e) => e.message));
  ok(/không còn chờ/.test(await a1), "tệp đầu đã rời hàng");
  await sleep(0);
  const peak = S.slotState("convert", "va").globalWaiting;
  const r2 = await a2;
  ok(/Máy chủ đang đọc nhiều tệp/.test(r2) && Date.now() - t9 < 150 && peak <= 6, "tệp thứ hai: báo máy chủ bận ngay, hàng chung không vượt 6", { r2, ms: Date.now() - t9, peak });
  g.open();
  const rs = await Promise.all(jobs);
  ok(rs.every((x) => x === "ok"), "các tệp khác đều xong", rs);
  ok(S.slotState("convert", "va").running === 0 && S.slotState("convert", "va").global === 0, "không rò chỗ", S.slotState("convert", "va"));
}

console.log("10. Mã nguồn: /api/files truyền tín hiệu hủy của yêu cầu; tệp ghi âm chờ lâu, các việc khác không; cùng tệp đang đọc thì dùng chung");
{
  const route = fs.readFileSync("app/api/files/route.ts", "utf8"), ex = fs.readFileSync("server/fileproc/extractors.ts", "utf8"), idx = fs.readFileSync("server/fileproc/index.ts", "utf8"), tr = fs.readFileSync("server/fileproc/transcribe.ts", "utf8");
  ok(/signal: req\.signal/.test(route), "app/api/files/route.ts: processFile(..., { signal: req.signal })");
  ok(/withConvertSlot\(uid, \(\) => transcribeAudio\(buf, name, uid, signal\), \{ long: true, signal \}\)/.test(ex), "chép lời: long + signal");
  ok(/convertLegacyOffice\(buf, ctx\.name\), \{ signal: ctx\.signal \}/.test(ex) && !/convertLegacyOffice[^\n]*long/.test(ex), "Office cũ: có signal, không chờ lâu");
  ok(/if \(signal\?\.aborted\) throw new FileError/.test(tr) && tr.indexOf("signal?.aborted") < tr.indexOf('el("/v1/speech-to-text"'), "transcribeAudio kiểm hủy ngay trước khi gửi đi chép lời");
  ok(/inflight\.get\(id\)/.test(idx) && /inflight\.delete\(id\)/.test(idx), "processFile: cùng nội dung đang đọc thì chờ lần đó (Thử lại không chép lời lần hai)");
  const AV = Number((fs.readFileSync("ui/filestate.ts", "utf8").match(/AV_TIMEOUT_MS = (\d+) \* 60_000/) ?? [])[1]) * 60_000;
  ok(10 * 60_000 + 290_000 < AV, "chờ lượt (10 phút, cả hai hàng) + một lần chép lời (290 giây) < thời gian khung soạn chờ", AV);
}

console.log("7. Lời hết giờ trên thẻ tệp có bản tiếng Anh");
{
  const en = (t) => { for (const [re, f] of O.OPS_RULES_EN) { const m = t.match(re); if (m) return f(m); } return t; };
  ok(en('Máy chủ đọc "phong-van.m4a" quá lâu (quá 16 phút). Hãy thử lại.') === 'The server took too long to read "phong-van.m4a" (over 16 minutes). Try again.', "tệp ghi âm chờ chép lời quá lâu");
  ok(en('Tải "bao-cao.pdf" lên quá lâu (quá 2 phút). Hãy thử lại.') === 'Uploading "bao-cao.pdf" took too long (over 2 minutes). Try again.', "tệp thường tải lên quá lâu");
  const fsrc = fs.readFileSync("ui/filestate.ts", "utf8");
  ok(fsrc.includes('`Máy chủ đọc "${key}" quá lâu (quá ${AV_TIMEOUT_MS / 60_000} phút). Hãy thử lại.`') && fsrc.includes('`Tải "${key}" lên quá lâu (quá 2 phút). Hãy thử lại.`'), "câu trong ui/filestate.ts khớp đúng luật dịch");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
