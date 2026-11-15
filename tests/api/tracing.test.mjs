// Đo độ trễ từng chặng (server/tracing.ts): span theo chặng trong ngữ cảnh lượt, vòng nhớ 500 lượt, tổng hợp p50 / p95 theo ngày trong SQLite,
// dòng log OTLP/JSON hợp lệ. Tự chạy được, không cần dev:mock. Phần chạy thật qua /api/llm nằm ở latency-trace.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-trace-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "trace-test";
const { tracing: T, authstore: AS } = await loadTs(["tracing", "authstore"]);
const logs = [];
const orig = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.startsWith("[otel]") || s.startsWith("[timing]")) logs.push(s); else orig(...a); };
try {
  console.log("1. Một lượt đầy đủ");
  const at = Date.now() - 30;
  const t = T.beginTrace("chat", { at, authMs: 4 });
  await T.withTrace(t, async () => {
    await T.span("file refs", "history", () => sleep(5));
    T.addSpan("routing", "routing", Date.now() - 3);
    await T.span("skills", "retrieval", () => sleep(10));
    T.spanSync("brain recall", "retrieval", () => 1);
    T.markPrompt();
    await sleep(8);
    T.noteModel("anthropic/claude-sonnet-5-5");
    const s0 = Date.now(); await sleep(20); T.noteProviderResponse("anthropic", s0, 200);
    T.noteFirstToken(); T.noteFirstToken();
    await T.span("tool web_search", "tool", () => sleep(6), { "tool.name": "web_search" });
    await T.span("tool run_code", "tool", () => sleep(12), { "tool.name": "run_code" });
    const s1 = Date.now(); T.noteProviderResponse("anthropic", s1, 200);
  });
  T.endTrace(t, 200);
  const st = Object.fromEntries(T.stageDurations(t).filter(([s]) => s !== "tool" && s !== "retrieval"));
  ok(["auth", "history", "routing", "prompt", "provider_ttfb", "first_token", "total"].every((s) => s in st), "có đủ các chặng", T.stageDurations(t));
  ok(st.auth === 4 && st.prompt >= 7 && st.provider_ttfb >= 19 && st.first_token >= st.provider_ttfb && st.total >= st.first_token, "thời lượng hợp lý: kiểm tra phiên, dựng lời nhắc, TTFB, chữ đầu, tổng", st);
  ok(T.stageDurations(t).filter(([s]) => s === "tool").length === 2 && T.stageDurations(t).filter(([s]) => s === "retrieval").length === 2, "mỗi lần chạy công cụ, mỗi lần tra cứu là một mẫu riêng");
  ok(T.stageDurations(t).filter(([s]) => s === "provider_ttfb").length === 1 && t.spans.filter((s) => s.name.startsWith("provider.call")).length === 2, "TTFB chỉ tính lần gọi đầu; lần gọi nào cũng có span con");
  ok(t.provider === "anthropic" && t.model === "anthropic/claude-sonnet-5-5", "ghi hãng và model");
  ok(T.currentTrace() === undefined, "ngoài lượt: không có ngữ cảnh đo");
  const n0 = t.spans.length;
  await T.span("ngoài", "tool", () => 1); T.noteFirstToken(); T.noteProviderResponse("x", Date.now(), 200);
  await T.withTrace(t, () => T.span("sau khi xong", "tool", () => 1));
  ok(t.spans.length === n0, "gọi ngoài lượt, hay sau khi lượt xong (rút bộ nhớ chạy nền): không ghi nhầm vào lượt", t.spans.length - n0);

  console.log("2. Log OpenTelemetry");
  const otel = logs.find((l) => l.startsWith("[otel] "));
  const o = JSON.parse(otel.slice(7));
  const sp = o.resourceSpans[0].scopeSpans[0].spans, root = sp[0];
  ok(o.resourceSpans[0].resource.attributes.some((a) => a.key === "service.name" && a.value.stringValue === "synchro"), "resource service.name = synchro");
  ok(/^[0-9a-f]{32}$/.test(root.traceId) && /^[0-9a-f]{16}$/.test(root.spanId) && root.name === "chat.turn" && !root.parentSpanId, "span gốc: traceId 32 hex, spanId 16 hex", root);
  ok(sp.slice(1).every((s) => s.traceId === root.traceId && s.parentSpanId === root.spanId && /^[0-9a-f]{16}$/.test(s.spanId) && /^\d+$/.test(s.startTimeUnixNano) && BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano)), "span con cùng trace, trỏ về gốc, thời gian nano giây dạng chuỗi");
  ok(root.attributes.some((a) => a.key === "gen_ai.system" && a.value.stringValue === "anthropic") && root.attributes.some((a) => a.key === "http.status_code" && a.value.intValue === "200") && root.status.code === 1, "thuộc tính gen_ai.system, http.status_code, trạng thái OK");
  ok(sp.some((s) => s.name === "tool run_code" && s.attributes.some((a) => a.key === "synchro.stage" && a.value.stringValue === "tool")), "span công cụ mang synchro.stage");
  ok(!/Mat-khau|messages|content/.test(otel), "không có nội dung chat trong log");
  ok(logs.some((l) => /^\[timing\] chat anthropic 200 auth=4ms .*total=\d+ms/.test(l)), "dòng [timing] ngắn vẫn còn", logs.filter((l) => l.startsWith("[timing]")));

  console.log("3. Vòng nhớ và tổng hợp theo ngày");
  for (let i = 0; i < 520; i++) {
    const x = T.beginTrace("chat", { at: Date.now() - 100, authMs: i % 10 });
    T.withTrace(x, () => T.noteModel(i % 2 ? "openai/gpt-6" : "sub-claude/opus"));
    T.endTrace(x, i % 50 === 0 ? 502 : 200);
  }
  const sum = T.latencySummary(1);
  ok(sum.turns === 500, "giữ đúng 500 lượt gần nhất", sum.turns);
  const auth = sum.recent.find((r) => r.stage === "auth" && r.provider === "all");
  ok(auth?.n === 500 && auth.p50 >= 4 && auth.p50 <= 5 && auth.p95 === 9, "p50 / p95 của 500 lượt gần nhất", auth);
  const dAuth = sum.daily.find((r) => r.stage === "auth" && r.provider === "openai");
  ok(dAuth?.n === 260 && sum.daily.some((r) => r.provider === "sub-claude") && sum.daily.find((r) => r.stage === "auth" && r.provider === "all")?.n === 521, "SQLite đếm đủ mọi lượt trong ngày, tách theo hãng", { dAuth, all: sum.daily.find((r) => r.stage === "auth" && r.provider === "all") });
  const row = AS.db().prepare("SELECT n, samples FROM trace_daily WHERE stage = 'total' AND provider = 'openai'").get();
  ok(row && JSON.parse(row.samples).length === 260, "mẫu lưu trong bảng trace_daily", row?.n);
  ok(sum.last.length === 8 && sum.last[0].at >= sum.last[7].at, "danh sách vài lượt mới nhất");
  ok(T.latencySummary(7).daily.length >= sum.daily.length, "tổng hợp 7 ngày");
} finally { console.log = orig; fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
