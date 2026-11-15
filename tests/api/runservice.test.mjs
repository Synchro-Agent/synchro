// RunService (H3 bước 6c): lượt chat / tác vụ (kho SQLite) và lượt Code (kho bộ nhớ) đi qua một dịch vụ: một bản đồ lượt sống, một vòng
// điều khiển từ tiến trình khác, một định dạng luồng SSE. Thẻ mở trước bản phát hành này (đọc NDJSON) vẫn theo được lượt Code trên bản mới,
// và trình duyệt mới vẫn đọc được NDJSON của bản cũ (quay lui). Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-runservice-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
process.env.SYNCHRO_REMOTE_POLL_MS = "40";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const keepAlive = setInterval(() => {}, 1000);
const M = await loadTs(["authstore", "runs", "agentruns", "server/runs/service", "server/runs/stream", "shared/runstream", "drain"]);
const { authstore: AS, runs: RN, agentruns: AR, "server/runs/stream": ST, "shared/runstream": PS, drain: D } = M;
const RS = M["server/runs/service"].RunService;
const { wsclient: W } = await loadTs(["wsclient"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await sleep(10); return f(); };

/** Đọc thân câu trả lời tới khi đóng (hoặc stop(text) đúng, hoặc hết giờ). */
async function readBody(res, { stop, ms = 3000 } = {}) {
  const rd = res.body.getReader(), dec = new TextDecoder();
  let text = "";
  for (;;) {
    const r = await Promise.race([rd.read(), sleep(ms).then(() => ({ timeout: true }))]);
    if (r.timeout) { rd.cancel().catch(() => {}); return { text, timedOut: true }; }
    if (r.done) return { text };
    text += dec.decode(r.value, { stream: true });
    if (stop?.(text)) { rd.cancel().catch(() => {}); return { text }; }
  }
}
const frames = (text) => PS.splitSse(text).frames;
// Cách wsclient bản trước đọc NDJSON (thẻ mở trước deploy): mỗi dòng một JSON, bỏ dòng trống.
const oldTab = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
const req = (accept, extra = {}) => new Request("http://x/api/agent?sid=1", { headers: { ...(accept ? { accept } : {}), ...extra } });

try {
  const u = AS.createUser({ email: "rs@runservice.test", name: "RS", verified: true });

  console.log("1. Định dạng luồng chung (stream.ts): SSE, NDJSON kiểu cũ, mốc nối lại");
  {
    const src = (ended) => ({
      subscribe: () => () => {},
      head: () => ({ id: "x", kind: "code", status: ended ? "done" : "running", running: !ended, count: 3, node: { id: 7 } }),
      replay: () => [1, 2, 3].map((seq) => ({ seq, data: { t: "text", text: "b" + seq } })),
      snapshot: () => ({ s: 2, text: "đang viết" }),
      ended: () => (ended ? { status: "done", stopped: false, s: 3 } : null),
    });
    const sse = await readBody(ST.runResponse(src(true), { after: 1, signal: new AbortController().signal }));
    ok(sse.text.startsWith('retry: 2000\n\nevent: run\ndata: {"id":"x","kind":"code","status":"done","running":false,"count":3,"node":{"id":7}}\n\nevent: clock\ndata: {"now":'), "SSE mở đầu: retry, run (lượt nào, bao nhiêu bước), clock", sse.text.slice(0, 200));
    const f = frames(sse.text);
    ok(f.map((x) => x.event).join() === "run,clock,step,step,snapshot,done" && f.filter((x) => x.event === "step").map((x) => x.id).join() === "2,3", "chỉ gửi bước sau mốc after, rồi snapshot và done", f.map((x) => `${x.event}#${x.id ?? ""}`));
    ok(sse.text.includes('id: 2\nevent: step\ndata: {"t":"text","text":"b2"}\n\n') && sse.text.endsWith('event: done\ndata: {"status":"done","stopped":false,"s":3}\n\n'), "khung step mang id = seq, khung done mang dữ liệu nguyên vẹn", sse.text.slice(-200));
    const nd = await readBody(ST.runResponse(src(true), { after: 1, signal: new AbortController().signal, wire: "ndjson" }));
    ok(nd.text === '{"t":"run","node":{"id":7},"running":false,"count":3}\n{"t":"text","text":"b2","s":2}\n{"t":"text","text":"b3","s":3}\n{"t":"end","s":3,"stopped":false}\n', "NDJSON kiểu cũ đúng từng byte như bản trước (không clock, không snapshot)", nd.text);
    const sh = (r) => r.headers.get("content-type");
    ok(/text\/event-stream/.test(sh(ST.runResponse(src(true), { after: 0, signal: new AbortController().signal }))) && /application\/x-ndjson/.test(sh(ST.runResponse(src(true), { after: 0, signal: new AbortController().signal, wire: "ndjson" }))), "Content-Type theo định dạng");
    ok(ST.wireOf(req("text/event-stream")) === "sse" && ST.wireOf(req("application/json, text/event-stream")) === "sse" && ST.wireOf(req()) === "ndjson" && ST.wireOf(req("*/*")) === "ndjson", "chỉ yêu cầu xin text/event-stream mới nhận SSE; thẻ cũ (không xin) nhận NDJSON");
    ok(ST.afterOf(req(null, { "last-event-id": "5" })) === 5 && ST.afterOf(new Request("http://x/?after=4")) === 4 && ST.afterOf(req()) === 0, "mốc nối lại: Last-Event-ID hoặc ?after=");
    // Người xem đi mất: đóng kết nối là thôi nghe, hẹn giờ ping tắt.
    let unsub = 0;
    const ac = new AbortController();
    const live = ST.runResponse({ ...src(false), subscribe: () => () => { unsub++; } }, { after: 0, signal: ac.signal });
    const rd = live.body.getReader(); await rd.read(); ac.abort(); await sleep(10);
    ok(unsub === 1, "ngắt kết nối: hủy đăng ký đúng một lần", unsub);
  }

  console.log("2. Lượt chat (kho SQLite) qua RunService.stream: SSE như trước, thêm khung run ở đầu");
  {
    let release;
    RN.registerExec("rs-chat", async () => {
      RN.progress("step", "Đang đọc skill");
      RN.delta("Xin ");
      await new Promise((r) => { release = r; });
      RN.delta("chào");
      RN.progress("note", "gần xong");
      return { http: 200, json: { text: "Xin chào" } };
    });
    const id = RN.startRun(u, "rs-chat", {}, "c-rs");
    await until(() => release);
    const res = RS.stream(id, new Request(`http://x/api/runs/${id}`));
    const reading = readBody(res);
    await sleep(30); release();
    const { text, timedOut } = await reading;
    const f = frames(text);
    ok(!timedOut && /text\/event-stream/.test(res.headers.get("content-type")), "luồng SSE đóng sau done", { timedOut });
    const names = f.map((x) => x.event);
    ok(text.startsWith("retry: 2000\n\nevent: run\n") && names[0] === "run" && names[1] === "clock" && names.at(-1) === "done", "mở đầu retry, run, clock; kết thúc done", names);
    ok(names.every((n) => ["run", "clock", "step", "delta", "snapshot", "done"].includes(n)), "chỉ có các khung đã biết (EventSource bỏ qua khung run)", names);
    const head = JSON.parse(f[0].data);
    ok(head.id === id && head.kind === "rs-chat" && head.running === true && head.count === 1 && head.status === "running", "khung run: mã lượt, loại, đang chạy, số bước đã có", head);
    const steps = f.filter((x) => x.event === "step").map((x) => [x.id, JSON.parse(x.data)]);
    ok(steps.length === 2 && steps.every(([i, e]) => String(e.seq) === i) && steps[0][1].text === "Đang đọc skill" && steps[1][1].kind === "note", "bước: id = seq, dữ liệu là RunEvent", steps);
    ok(f.some((x) => x.event === "snapshot" && JSON.parse(x.data).text === "Xin ") && f.some((x) => x.event === "delta" && JSON.parse(x.data).t === "chào"), "mở giữa chừng: snapshot phần đã viết, rồi delta", f.map((x) => x.event + ":" + x.data).join(" | "));
    const done = JSON.parse(f.at(-1).data);
    ok(Object.keys(done).join() === "status,http,result" && done.status === "done" && done.http === 200 && done.result.text === "Xin chào", "done: {status, http, result} như bản trước", done);
    const again = frames((await readBody(RS.stream(id, new Request(`http://x/api/runs/${id}`, { headers: { "last-event-id": "1" } })))).text);
    ok(again.filter((x) => x.event === "step").map((x) => x.id).join() === "2" && again.at(-1).event === "done", "nối lại bằng Last-Event-ID: chỉ bước sau mốc, rồi kết quả", again.map((x) => x.event));
  }

  console.log("3. Lượt Code (kho bộ nhớ): SSE cho trình duyệt mới, NDJSON đúng như cũ cho thẻ mở trước deploy");
  {
    let release;
    const run = RS.startCode({ uid: u.id, sid: "3100", node: null }, async (emit) => {
      emit({ t: "text", text: "phần đầu" });
      await new Promise((r) => { release = r; });
      emit({ t: "result", id: "r1", ok: true, summary: "ảnh", image: "data:image/png;base64,AAAA" });
      emit({ t: "done", text: "xong" });
    });
    await until(() => release);
    const sseRes = RS.streamCode(run, req("text/event-stream"), 0), ndRes = RS.streamCode(run, req(), 0);
    const a = readBody(sseRes), b = readBody(ndRes);
    await sleep(30); release();
    const [sse, nd] = await Promise.all([a, b]);
    ok(/text\/event-stream/.test(sseRes.headers.get("content-type")) && /application\/x-ndjson/.test(ndRes.headers.get("content-type")), "Accept: text/event-stream → SSE; không có → NDJSON");
    const old = oldTab(nd.text);
    ok(JSON.stringify(old[0]) === '{"t":"run","node":null,"running":true,"count":1}' && JSON.stringify(old.at(-1)) === '{"t":"end","s":3,"stopped":false}' && old.slice(1, -1).map((e) => e.s).join() === "1,2,3", "NDJSON: dòng run, sự kiện kèm s, dòng end — đúng hình dạng thẻ cũ đọc", old);
    ok(old[2].image === "data:image/png;base64,AAAA", "người đang xem nhận ảnh chụp màn hình", old[2]);
    const lines = frames(sse.text).map(PS.codeLine).filter(Boolean);
    ok(JSON.stringify(lines) === JSON.stringify(old), "SSE đọc qua shared/runstream.ts ra đúng các dòng NDJSON (giao diện không phải đổi)", { lines, old });
    const replay = oldTab((await readBody(RS.streamCode(run, req(), 1))).text);
    ok(replay.map((e) => e.t).join() === "run,result,done,end" && replay[1].image === undefined && replay[0].running === false, "nối lại sau mốc 1: bỏ ảnh khỏi bộ đệm, lượt đã xong", replay);
    const viaHdr = frames((await readBody(RS.streamCode(run, req("text/event-stream", { "last-event-id": "2" })))).text);
    ok(viaHdr.filter((x) => x.event === "step").map((x) => x.id).join() === "3", "lượt Code cũng nối lại được bằng Last-Event-ID", viaHdr.map((x) => x.event));
    ok(AR.runStream(run, 0, new AbortController().signal).headers.get("content-type").includes("x-ndjson"), "agentruns.runStream (mặt tiền) giữ mặc định NDJSON như cũ");
  }

  console.log("4. Trình duyệt mới (wsclient) đọc SSE, và vẫn đọc được NDJSON khi gặp bản cũ (quay lui)");
  {
    const run = RS.startCode({ uid: u.id, sid: "3200", node: null }, async (emit) => { emit({ t: "text", text: "a" }); emit({ t: "done", text: "a" }); });
    await until(() => run.ended);
    const asked = [];
    const realFetch = globalThis.fetch;
    const collect = async (server) => {
      globalThis.fetch = async (u, o) => { asked.push(new Headers(o?.headers).get("accept")); return server(new Request("http://x" + u, { headers: o?.headers })); };
      const got = [];
      await W.attachAgent(3200, (e) => got.push(e), new AbortController().signal);
      return got;
    };
    const fresh = await collect((r) => RS.streamCode(run, r, ST.afterOf(r)));
    const legacy = await collect((r) => AR.runStream(run, ST.afterOf(r), r.signal)); // bản trước: luôn NDJSON
    globalThis.fetch = realFetch;
    ok(asked.length === 2 && asked.every((h) => h === "text/event-stream"), "wsclient xin text/event-stream", asked);
    ok(fresh.map((e) => e.t).join() === "run,text,done,end" && fresh[0].fromStart === true && fresh.at(-1).s === 2, "đọc SSE ra dòng run (từ đầu), sự kiện, end", fresh);
    ok(JSON.stringify(fresh) === JSON.stringify(legacy), "NDJSON của bản cũ cho đúng các dòng như SSE", { fresh, legacy });
    ok(PS.splitSse("event: step\r\nid: 4\r\ndata: {\"a\":1}\r\n\r\n: ping\n\nevent: done\ndata: {}\n\nevent: st").rest === "event: st" && PS.splitSse("data: x\ndata: y\n\n").frames[0].data === "x\ny", "bộ tách SSE: CRLF, chú thích, nhiều dòng data, phần còn dở");
  }

  console.log("5. Một bản đồ lượt sống cho cả hai kho; tắt êm đếm cả hai");
  {
    const reg = globalThis.__synchroRuns;
    RN.registerExec("rs-wait", async () => { const s = RN.runSignal(); await new Promise((r) => s.addEventListener("abort", r)); return { http: 200, json: { text: "", cancelled: true } }; });
    const id = RN.startRun(u, "rs-wait", {}, "c-wait");
    const run = RS.startCode({ uid: u.id, sid: "3300", node: null }, (emit, signal) => new Promise((r) => signal.addEventListener("abort", r)));
    await sleep(20);
    ok(reg instanceof Map && reg.get(id)?.store === "sqlite" && reg.get(`agent:${u.id}:3300`) === run && run.store === "memory", "lượt chat (mã run_…) và lượt Code (agent:uid:sid) nằm chung globalThis.__synchroRuns", [...reg.keys()]);
    ok(RS.busy() === 2 && RS.describe() === "1 lượt chat, 1 lượt Code" && RN.liveRunCount() === 1 && AR.activeAgentCount() === 1, "busy / describe (instrumentation tắt êm) đếm cả hai kho; tên cũ đếm từng kho", { busy: RS.busy(), d: RS.describe() });
    ok(RN.liveRunOf(u.id, "c-wait") === id && AR.latestRun(u.id, "3300") === run && AR.latestRun(u.id, id) === null && !RN.liveText(`agent:${u.id}:3300`), "mỗi kho chỉ thấy lượt của mình");
    // Dừng một lượt Code: CLI còn đang thoát nhưng không giữ việc tắt êm (như trước).
    AR.stopAgentRun(u.id, "3300");
    ok(RS.busy() === 1 && AR.activeAgentCount() === 0, "lượt Code vừa bấm Dừng thôi được đếm ngay", RS.busy());
    RS.stopUser(u.id);
    await until(() => RS.busy() === 0);
    const r = RN.getRun(id);
    ok(RS.busy() === 0 && r.status === "done" && r.result.cancelled === true && !reg.has(id), "xóa tài khoản (stopUser): dừng lượt ở cả hai kho", r);
  }

  console.log("6. Một vòng điều khiển từ tiến trình khác cho cả hai kho (deploy xanh/lam)");
  {
    RN.registerExec("rs-wait2", async () => { const s = RN.runSignal(); await new Promise((r) => s.addEventListener("abort", r)); return { http: 200, json: { text: "", cancelled: true } }; });
    const id = RN.startRun(u, "rs-wait2", {}, "c-remote");
    const run = RS.startCode({ uid: u.id, sid: "3400", node: null }, (emit, signal) => new Promise((r) => signal.addEventListener("abort", r)));
    await sleep(20);
    const poll = globalThis.__synchroRemotePoll;
    ok(!!poll, "có lượt đang chạy: vòng hỏi đang bật");
    const db = AS.db();
    db.prepare("UPDATE runs SET cancel_req = 1 WHERE id = ?").run(id);
    db.prepare("UPDATE agent_owner SET stop = 1 WHERE uid = ? AND sid = ?").run(u.id, "3400");
    await until(() => run.ac.signal.aborted && RN.getRun(id).status !== "running", 2000);
    ok(run.ac.signal.aborted && RN.getRun(id).status === "done" && globalThis.__synchroRemotePoll === poll, "lệnh Dừng ghi từ tiến trình khác tới cả lượt chat và lượt Code qua cùng một vòng hỏi (không gọi tay)", { code: run.ac.signal.aborted, chat: RN.getRun(id).status });
    await until(() => !globalThis.__synchroRemotePoll, 1000);
    ok(!globalThis.__synchroRemotePoll, "hết lượt đang chạy: vòng hỏi tự tắt");
  }

  console.log("7. Tắt êm chờ cả lượt chat lẫn lượt Code");
  {
    RN.registerExec("rs-slow", async () => { await sleep(120); return { http: 200, json: { text: "ok" } }; });
    RN.startRun(u, "rs-slow", {}, "c-slow");
    RS.startCode({ uid: u.id, sid: "3500", node: null }, async () => { await sleep(200); });
    await sleep(10);
    const r = await D.drain({ busy: RS.busy, timeoutMs: 3000, pollMs: 20 });
    ok(r.left === 0 && r.waitedMs >= 150, "drain chờ tới khi cả hai lượt xong", r);
    D.resetDrainForTest?.();
  }
} catch (e) {
  ok(false, "lỗi khi chạy", e?.stack ?? String(e));
}
clearInterval(keepAlive);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
