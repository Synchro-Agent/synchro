// Độ trễ từng chặng chạy thật: gửi lượt chat qua /api/llm (lượt nền như trên trang) rồi đọc Cài đặt → Sức khỏe hệ thống (/api/admin/health):
// đủ các chặng của lượt khóa API (kiểm tra phiên, chờ chỗ, lịch sử, tra cứu, chọn model, dựng lời nhắc, TTFB của hãng, chữ đầu, công cụ, tổng).
// Chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL).
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const call = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await call("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const shownBefore = (await call("GET", "/api/admin/apikeys")).j?.main ?? ["*"];
await call("POST", "/api/admin/apikeys", { action: "main", main: ["*"] });
async function turn(text) {
  const r = await call("POST", "/api/llm", { system: "", model: "auto", skills: true, async: true, messages: [{ role: "user", content: text }] });
  let run;
  for (let i = 0; i < 300; i++) { run = (await call("GET", `/api/runs/${r.j?.run}?json=1`)).j?.run; if (run && run.status !== "running") break; await sleep(200); }
  return run;
}
try {
  const before = (await call("GET", "/api/admin/health")).j?.latency;
  ok(before && Array.isArray(before.stages) && before.stages.includes("provider_ttfb"), "Sức khỏe hệ thống có mục độ trễ", before);
  const t0 = Date.now() - 1000;
  const run = await turn("Viết code Python đọc file CSV và in tổng từng cột");
  ok(run?.status === "done" && run.result?.model?.startsWith("anthropic/"), `lượt chạy xong bằng ${run?.result?.model}`, run);
  const h = (await call("GET", "/api/admin/health")).j.latency;
  // Việc định kỳ (tasks.ts) của máy giả cũng chạy lượt chat ở nền: vòng nhớ có thể thêm hơn một lượt trong lúc chờ.
  ok(h.turns >= Math.min(500, (before.turns ?? 0) + 1), "lượt mới vào vòng nhớ", { before: before.turns, after: h.turns });
  const last = h.last.find((t) => t.model === run.result.model && t.at >= t0);
  ok(last && last.provider === "anthropic" && last.status === 200 && last.totalMs > 0, "lượt vừa chạy: hãng, model, mã, tổng thời gian", h.last);
  const rec = new Set(h.recent.filter((r) => r.provider === "anthropic").map((r) => r.stage));
  const want = ["auth", "queue", "history", "retrieval", "routing", "prompt", "provider_ttfb", "first_token", "tool", "total"];
  ok(want.every((s) => rec.has(s)), `đủ các chặng: ${want.filter((s) => !rec.has(s)).join(", ") || "đủ"}`, [...rec]);
  const get = (s) => h.recent.find((r) => r.stage === s && r.provider === "anthropic");
  ok(get("total").p50 >= get("first_token").p50 && get("first_token").p50 >= get("auth").p50, "thứ tự hợp lý: tổng ≥ chữ đầu ≥ kiểm tra phiên", { total: get("total"), first: get("first_token"), auth: get("auth") });
  ok(h.daily.some((r) => r.stage === "total" && r.provider === "anthropic" && r.n >= 1) && h.week.some((r) => r.stage === "total" && r.provider === "all"), "đã cộng vào tổng hợp hôm nay và 7 ngày (SQLite)", h.daily.filter((r) => r.stage === "total"));
} finally {
  await call("POST", "/api/admin/apikeys", { action: "main", main: shownBefore });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
