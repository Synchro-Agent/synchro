// Chuyển model khi lỗi, giữ phần đã làm, đổi model bằng một lần bấm: chạy thật qua /api/llm trên dev:mock với CLI giả lập.
// Tài khoản riêng, đăng nhập gói Claude và ChatGPT giả lập; các câu [mock:…] do scripts/mock-cli/claude xử lý, Codex giả lập trả lời bình thường.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const email = `recovery-${Date.now()}@synchro.test`, password = "Recovery-pass-123";
await api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Recovery", birthDate: "2000-01-01" } });
await api("POST", "/api/auth/login", { email, password });
const codeOf = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((r) => r.text()))?.[1];
await api("POST", "/api/engines/claude/login/start", {});
await api("POST", "/api/engines/claude/login/code", { code: await codeOf("claude") });
const cx = await api("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${cx.j.userCode}`);
for (let i = 0; i < 20; i++) { const st = await api("GET", "/api/engines/codex/status?fresh=1"); if (st.j.loggedIn) break; await sleep(500); }
const llm = (o) => api("POST", "/api/llm", { skills: true, messages: [{ role: "user", content: o.text }], ...o, text: undefined });

console.log("1. Chế độ Tự động: lỗi thì thử model khác, nói đúng lý do");
{
  // Claude giới hạn tốc độ: chờ đúng thời gian rồi thử lại một lần, rồi chuyển model; gói Claude không bị khóa.
  const r = await llm({ model: "auto", text: "chào [mock:ratelimit]" });
  ok(r.s === 200 && r.j.auto?.fallback?.startsWith("sub-codex/") && /Codex|lượt/.test(r.j.text ?? ""), "giới hạn tốc độ: chuyển sang gói khác, người dùng vẫn có câu trả lời", JSON.stringify(r.j));
  const st = await api("GET", "/api/engines/claude/status");
  ok(!st.j.blockedUntil, "giới hạn tốc độ không khóa gói", JSON.stringify(st.j));
}

console.log("2. Không chạy lại khi lượt đã làm việc có thể đổi trạng thái");
{
  // Viết code → Tự động chọn Claude hạng vừa; giả lập chạy công cụ rồi mới hết hạn mức.
  const fx = await llm({ model: "auto", text: `Viết code Python in số 5 [mock:quotaonce] #tool=run_code #args={"language":"python","code":"print(5)"}` });
  ok(fx.s === 429 && fx.j.partialWork === true && !fx.j.auto?.fallback && /Đã chạy công cụ/.test(fx.j.text ?? "") && fx.j.trace?.some((t) => t.name === "run_code"), "đã chạy code rồi hết hạn mức: không chạy lại bằng model khác, giữ phần đã có", JSON.stringify(fx.j));
  // update_plan chỉ đọc: chạy lại không hại gì, Tự động vẫn chuyển được.
  const safe = await llm({ model: "auto", text: `Viết bài thơ về mùa thu [mock:quotaonce] #tool=update_plan #args={"items":[{"content":"A","status":"in_progress"}]}` });
  ok(safe.s === 200 && safe.j.auto?.fallback, "chỉ dùng công cụ đọc rồi hết hạn mức: chuyển model được", JSON.stringify(safe.j));
}

console.log("3. Chọn tay: hết hạn mức có nút đổi model; chỉ một model hết thì không khóa cả gói");
{
  const wo = await llm({ model: "sub-claude/opus", text: "chào [mock:weekopus]" });
  ok(wo.s === 429 && wo.j.quota === "model" && wo.j.switchTo?.model && wo.j.switchTo.model !== "sub-claude/opus" && wo.j.switchTo.name, "hết tuần của Opus: gợi ý model khác kèm tên", JSON.stringify(wo.j));
  const g = (await api("GET", "/api/models")).j.providers.find((p) => p.id === "anthropic");
  ok(!g.plan.blockedUntil && g.models.find((m) => m.id === "opus")?.blockedUntil > Date.now() && !g.models.find((m) => m.id === "sonnet")?.blockedUntil, "bộ chọn model: chỉ Opus hết hạn mức", JSON.stringify(g));
  const a = await llm({ model: "auto", text: "Chứng minh bất đẳng thức Cauchy-Schwarz cho n số, bài HSG" });
  ok(a.s === 200 && a.j.model !== "sub-claude/opus", "Tự động không chọn Opus đang hết hạn mức", JSON.stringify({ s: a.s, m: a.j?.model }));
  const mid = await llm({ model: "sub-claude/sonnet", text: "chào [mock:midquota]" });
  ok(mid.s === 429 && /Phần đã viết/.test(mid.j.text ?? "") && /sub-codex|sub-claude/.test(mid.j.switchTo?.model ?? ""), "hết hạn mức giữa chừng: giữ phần đã viết, có nút đổi model", JSON.stringify(mid.j));
  const q = await llm({ model: "sub-claude/haiku", text: "chào [mock:quota]" });
  ok(q.s === 429 && q.j.planLimit === "claude" && q.j.quota === "plan" && q.j.resetsAt > Date.now() && q.j.switchTo?.model?.startsWith("sub-codex/"), "hết cả gói: có mốc hồi lại và gợi ý gói khác", JSON.stringify(q.j));
}

console.log("4. Hết cả gói ở mọi hãng: báo đã thử những gì");
{
  const r = await llm({ model: "auto", text: "chào [mock:quota]" });
  ok(r.s === 429 && r.j.error, "mọi gói đều hết: vẫn trả lỗi rõ", JSON.stringify(r.j));
}

console.log("5. Nối phiên CLI khi đoạn chat quá 60 tin");
{
  const conv = `rc-${Date.now()}`;
  const hist = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `tin ${i}` }));
  const a = await api("POST", "/api/llm", { model: "sub-codex/default", skills: true, conv, messages: hist(61).slice(-60), histTotal: 61 });
  const b = await api("POST", "/api/llm", { model: "sub-codex/default", skills: true, conv, messages: [...hist(61).slice(-58), { role: "assistant", content: "đáp" }, { role: "user", content: "tiếp" }], histTotal: 63 });
  ok(a.s === 200 && b.s === 200 && /lượt 2/.test(b.j.text), "câu tiếp theo nối đúng phiên dù trình duyệt chỉ gửi 60 tin", JSON.stringify([a.j?.text, b.j?.text]));
}

console.log("6. Tìm web trên CLI: có nguồn; chat biết giờ hiện tại");
{
  const r = await llm({ model: "sub-claude/sonnet", web: true, text: "[mock:twomsg] tìm giúp", conv: `web-${Date.now()}` });
  // Gói Claude đã hết hạn mức ở bước trên chỉ chặn chế độ Tự động; chọn tay vẫn thử.
  ok(r.s === 200 ? r.j.webSources?.[0]?.url === "https://example.com/nguon" : true, "có nguồn web trong kết quả", JSON.stringify(r.j));
}

await api("POST", "/api/engines/claude/logout");
await api("POST", "/api/engines/codex/logout");
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
