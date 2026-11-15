// Chữ đang viết trên luồng SSE của một lượt (server/ssedeltas.ts, dùng ở server/runs/stream.ts cho app/api/runs/[id]/route.ts): trình duyệt chậm thì gom delta,
// và (R10) luồng thông lại thì xả ngay dù model không viết thêm chữ nào: qua pull() của ReadableStream hoặc hẹn giờ ngắn. Không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ssedeltas: S } = await loadTs(["ssedeltas"]);

console.log("1. Luồng thông: gửi ngay từng delta");
{
  const sent = [];
  const g = S.deltaGate({ desired: () => 1, send: (d) => sent.push(d) });
  g.push({ s: 1, t: "a" }); g.push({ s: 1, t: "b" });
  ok(JSON.stringify(sent) === '[{"s":1,"t":"a"},{"s":1,"t":"b"}]' && g.pending === 0, "hai delta, hai khung", sent);
}

console.log("2. Trình duyệt chậm: gom lại, giữ thứ tự, bước mới (reset) không bị gộp");
{
  let desired = -1;
  const sent = [];
  const g = S.deltaGate({ desired: () => desired, send: (d) => sent.push(d), retryMs: 10_000 });
  g.push({ s: 1, t: "xin " }); g.push({ s: 1, t: "chào" }); g.push({ s: 2, reset: true }); g.push({ s: 2, t: "mới" });
  ok(sent.length === 0 && g.pending === 4, "đang chậm: chưa gửi gì", sent);
  g.flush();
  ok(JSON.stringify(sent) === '[{"s":1,"t":"xin chào"},{"s":2,"reset":true},{"s":2,"t":"mới"}]', "xả trước sự kiện khác: gộp chữ cùng bước, giữ reset", sent);
  g.stop();
}

console.log("3. R10: luồng thông lại mà không có delta mới: hẹn giờ ngắn tự xả");
{
  let desired = -1;
  const sent = [];
  const g = S.deltaGate({ desired: () => desired, send: (d) => sent.push(d), retryMs: 20 });
  g.push({ s: 1, t: "đuôi " }); g.push({ s: 1, t: "câu" });
  await sleep(60);
  ok(sent.length === 0 && g.pending === 2, "vẫn chậm: tiếp tục giữ (hẹn lại)", sent);
  desired = 0;
  await sleep(60);
  ok(JSON.stringify(sent) === '[{"s":1,"t":"đuôi câu"}]' && g.pending === 0, "desiredSize ≥ 0: xả phần đã giữ trong vài chục ms, không chờ nhịp 15 giây", sent);
  desired = -1;
  g.push({ s: 1, t: "x" });
  g.stop();
  desired = 0;
  await sleep(60);
  ok(sent.length === 1, "đóng luồng (stop): bỏ hẹn giờ, không gửi sau khi đóng", sent);
}

console.log("4. R10 với ReadableStream thật: trình duyệt đọc hết hàng đợi → pull() xả ngay");
{
  const enc = new TextEncoder(), dec = new TextDecoder();
  let gate;
  const rs = new ReadableStream({
    start(ctl) { gate = S.deltaGate({ desired: () => ctl.desiredSize, send: (d) => ctl.enqueue(enc.encode(`event: delta\ndata: ${JSON.stringify(d)}\n\n`)), retryMs: 60_000 }); },
    pull() { gate.flush(); },
  });
  // Ba khung chưa ai đọc: desiredSize âm, delta sau đó bị giữ.
  gate.push({ s: 1, t: "a" }); gate.push({ s: 1, t: "b" }); gate.push({ s: 1, t: "c" });
  gate.push({ s: 1, t: "d" }); gate.push({ s: 1, t: "e" });
  ok(gate.pending > 0, `hàng đợi đầy: đang giữ ${gate.pending} delta`, gate.pending);
  const rd = rs.getReader();
  let got = "";
  const t0 = Date.now();
  while (!/"t":"[^"]*e"/.test(got) && Date.now() - t0 < 1000) got += dec.decode((await rd.read()).value);
  ok(/"t":"[^"]*e"/.test(got) && gate.pending === 0 && Date.now() - t0 < 500, "đọc hết các khung cũ là nhận được phần đã giữ (không cần delta mới, không chờ hẹn giờ 60 giây)", got);
  rd.cancel();
}

console.log("5. Luồng của lượt (RunService) dùng bộ gom này, có pull() và dừng hẹn giờ khi đóng; route đi qua luồng đó");
{
  const src = fs.readFileSync("server/runs/stream.ts", "utf8"), route = fs.readFileSync("app/api/runs/[id]/route.ts", "utf8");
  ok(/deltaGate\(\{ desired: \(\) => ctl\.desiredSize/.test(src) && /pull\(\) \{ drained\(\); \}/.test(src) && /gate\.stop\(\)/.test(src), "stream.ts: deltaGate + pull() + gate.stop() trong end()");
  ok(/return RunService\.stream\(id, req, url\);/.test(route) && fs.readFileSync("server/runs/service.ts", "utf8").includes("runResponse(sqlite.chatSource(id)"), "route: luồng SSE của lượt chat là runResponse của RunService");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
