// Cài đặt → Providers qua API web (npm run dev:mock, CLI giả lập trong data-mock/engine): đăng nhập gói subscription theo từng
// tài khoản (Claude setup-token, Codex mã thiết bị, Antigravity), model của gói trong /api/models, chat bằng gói (nối tiếp phiên),
// vòng tròn mức dùng theo hạn mức của gói, số dư API đã nạp, quyền: chỉ quản trị viên cài CLI và quản lý khóa API dùng chung.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (cookie = "") => async (method, p, body, o = {}) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", ...(o.noOrigin ? {} : { origin: B }), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const member = client();
await member("POST", "/api/auth/signup", { email: "pv-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Provider Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "pv-member@synchro.test", password: "Member-pass-123" });
const codeOf = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((r) => r.text()))?.[1];

// Bắt đầu sạch: đăng xuất mọi gói của hai tài khoản thử nghiệm.
for (const who of [admin, member]) for (const cli of ["claude", "codex", "agy"]) await who("POST", `/api/engines/${cli}/logout`);

console.log("1. Trạng thái và quyền");
{
  const s = await admin("GET", "/api/engines/claude/status");
  ok(s.s === 200 && s.j.installed && /mock/.test(s.j.version) && !s.j.loggedIn, "claude: đã cài (giả lập), chưa đăng nhập", JSON.stringify(s.j));
  ok((await admin("GET", "/api/engines/khong-co/status")).s === 404, "CLI lạ → 404");
  ok((await client()("GET", "/api/engines/claude/status")).s === 401, "chưa đăng nhập Synchro → 401");
  ok((await admin("POST", "/api/engines/claude/login/start", {}, { noOrigin: true })).s === 403, "POST khác nguồn → 403");
  ok((await member("POST", "/api/engines/claude/install")).s === 403, "thành viên không cài được CLI");
  ok((await member("GET", "/api/admin/apikeys")).s === 403, "thành viên không xem được khóa API dùng chung");
  ok(typeof (await member("GET", "/api/models")).j?.sharedApi === "boolean", "danh sách model báo máy chủ có khóa API dùng chung hay không (trợ giúp Providers dựa vào đây)");
}

console.log("2. Claude: setup-token qua giao diện web");
{
  const st = await admin("POST", "/api/engines/claude/login/start", {});
  ok(st.s === 200 && st.j.state === "open_url" && st.j.needsCode && st.j.url?.startsWith(`${M}/mock-login/claude`), "bắt đầu → link đăng nhập, chờ dán mã", JSON.stringify(st.j));
  const bad = await admin("POST", "/api/engines/claude/login/code", { code: "sai-ma" });
  ok(bad.s === 200 && bad.j.state === "error" && !JSON.stringify(bad.j).includes("sai-ma"), "mã sai → báo lỗi, không lộ mã", JSON.stringify(bad.j));
  await admin("POST", "/api/engines/claude/login/start", {});
  const good = await admin("POST", "/api/engines/claude/login/code", { code: await codeOf("claude") });
  const s2 = await admin("GET", "/api/engines/claude/status?fresh=1");
  ok(good.j?.state === "done" && s2.j.loggedIn && s2.j.method === "token", "mã đúng → đã đăng nhập bằng token dài hạn", JSON.stringify({ good: good.j, s2: s2.j }));
  ok(!JSON.stringify(s2.j).includes("sk-ant-oat"), "trạng thái không chứa token");
  const m = await member("GET", "/api/engines/claude/status?fresh=1");
  ok(!m.j.loggedIn, "đăng nhập của quản trị viên không dùng chung cho thành viên");
}

console.log("3. Model của gói trong bộ chọn model và chat bằng gói");
{
  const md = await admin("GET", "/api/models");
  const grp = md.j.providers.find((p) => p.id === "anthropic");
  ok(grp?.name === "Claude" && grp.source === "plan" && grp.models.some((x) => x.key === "sub-claude/sonnet") && !md.j.providers.some((p) => p.id.startsWith("sub-")), "bộ chọn model gộp theo hãng: nhóm Claude hiện model của gói", JSON.stringify(md.j.providers.map((p) => [p.id, p.source])));
  const conv = `pv-${Date.now()}`;
  const msgs = [{ role: "user", content: "chào" }];
  const r1 = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", system: "Trả lời ngắn.", messages: msgs, conv, skills: true });
  ok(r1.s === 200 && /lượt 1/.test(r1.j.text) && r1.j.via === "claude", "chat bằng gói Claude", JSON.stringify(r1.j));
  const r2 = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", system: "Trả lời ngắn.", messages: [...msgs, { role: "assistant", content: r1.j.text }, { role: "user", content: "tiếp" }], conv, skills: true });
  ok(r2.s === 200 && /lượt 2/.test(r2.j.text), "câu tiếp theo nối đúng phiên của CLI", JSON.stringify(r2.j));
  // Hướng dẫn hệ thống rất dài (nhiều skill, studio, connector; tiếng Việt 2–3 byte mỗi chữ): Linux không cho một tham số quá 128 KB,
  // CLI không khởi động được ("spawn E2BIG", synchro.net.nz khi làm slide). CLI giả lập làm như Linux; Synchro phải đưa qua tệp.
  const longSys = "Hướng dẫn trình bày slide chỉn chu, đúng bố cục, không chữ đè chữ. ".repeat(3000);
  const big = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", system: longSys, messages: [{ role: "user", content: "làm một slide mới" }], conv: `${conv}-long`, skills: true });
  ok(big.s === 200 && !/E2BIG/.test(JSON.stringify(big.j)) && /lượt 1/.test(big.j?.text ?? ""), `hướng dẫn hệ thống ${Math.round(Buffer.byteLength(longSys) / 1024)} KB: Claude Code nhận qua tệp, không lỗi E2BIG`, JSON.stringify(big.j).slice(0, 300));
  const run = await admin("POST", "/api/llm", { model: "sub-claude/haiku", messages: [{ role: "user", content: "chạy nền" }], conv: `${conv}-bg`, skills: true, async: true });
  let res = null;
  for (let i = 0; i < 40 && run.j?.run; i++) { const x = await admin("GET", `/api/runs/${run.j.run}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") { res = x.j.run; break; } await sleep(300); }
  ok(res?.http === 200 && /lượt 1/.test(res.result?.text ?? ""), "lượt chạy nền (truyền chữ dần) cũng chạy bằng gói", JSON.stringify(res));
  const us = await admin("GET", "/api/usage?provider=sub-claude");
  ok(us.j.sub?.cli === "claude" && us.j.sub.windows.some((w) => w.kind === "session" && w.usedPct > 0 && w.resetsAt > Date.now()) && us.j.sub.windows.some((w) => w.kind === "weekly"), "vòng tròn mức dùng: phiên 5 giờ + tuần của gói Claude", JSON.stringify(us.j.sub));
  await admin("POST", "/api/auth/profile", { instructions: "Trả lời bằng tiếng Việt thật ngắn." });
  const pf = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "#prefs" }], conv: `${conv}-prefs`, skills: true });
  ok(pf.s === 200 && /PREFS: .*Trả lời bằng tiếng Việt thật ngắn/.test(pf.j.text), "gói Claude nhận Hướng dẫn cho Synchro", JSON.stringify(pf.j).slice(0, 300));
  const pc = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", feature: "code", messages: [{ role: "user", content: "#prefs" }], conv: `${conv}-prefs-code`, skills: true });
  ok(pc.s === 200 && /PREFS: .*Trả lời bằng tiếng Việt thật ngắn/.test(pc.j.text), "Synchro Code chạy bằng gói cũng nhận Hướng dẫn cho Synchro", JSON.stringify(pc.j).slice(0, 300));
  const pa = await admin("POST", "/api/llm", { model: "anthropic/claude-haiku-5-5", feature: "code", system: "", messages: [{ role: "user", content: "#prefs" }], skills: true });
  ok(pa.s === 200 && /PREFS: .*Trả lời bằng tiếng Việt thật ngắn/.test(pa.j.text), "Synchro Code chạy bằng khóa API cũng nhận Hướng dẫn cho Synchro", JSON.stringify(pa.j).slice(0, 300));
  await admin("POST", "/api/auth/profile", { instructions: "" });
  const all = (await admin("GET", "/api/usage?all=1")).j;
  const cl = all.vendors?.find((v) => v.vendor === "anthropic");
  ok(cl?.mode === "plan" && cl.sub?.windows.some((w) => w.kind === "session") && all.vendors.length === 5, "chế độ Tự động: mức dùng tự nhận Claude đang chạy bằng gói (không phải API)", JSON.stringify(all.vendors?.map((v) => [v.vendor, v.mode])));
  const det = (await admin("GET", "/api/usage/details?tz=0")).j;
  ok(det.byPlan?.some((m) => m.model === "sub-claude/sonnet" && m.turns >= 2) && (det.days.at(-1).calls.anthropic ?? 0) >= 2, "Cài đặt → Usage: lượt chạy bằng gói theo model và theo ngày", JSON.stringify({ byPlan: det.byPlan, today: det.days.at(-1) }));
  const tt = await admin("POST", "/api/title", { messages: [{ role: "user", text: "Giúp mình lên kế hoạch du lịch Đà Lạt 3 ngày" }, { role: "assistant", text: "Được, đây là lịch trình." }] });
  ok(tt.s === 200 && tt.j.title && tt.j.title.length <= 60 && !/[".]$/.test(tt.j.title) && /^sub-/.test(tt.j.model), "tự đặt tên đoạn chat theo nội dung, chạy bằng gói", JSON.stringify(tt.j));
  const auto = await admin("POST", "/api/llm", { model: "auto", messages: [{ role: "user", content: "chào nhanh" }], conv: `${conv}-auto`, skills: true });
  ok(auto.s === 200 && auto.j.model?.startsWith("sub-claude/") && auto.j.auto, "chế độ Tự động chọn model của gói đang dùng, không tự sang khóa API", JSON.stringify({ s: auto.s, model: auto.j?.model, auto: auto.j?.auto }));
  const art = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "vẽ biểu đồ" }], skills: true });
  ok(art.s === 200 && /có hướng dẫn artifact/.test(art.j.text), "lượt chat bằng gói được gửi kèm hướng dẫn artifact / biểu đồ của Synchro", JSON.stringify(art.j).slice(0, 200));
  // Cầu nối MCP: gói Claude dùng được công cụ của Synchro (skill, chạy code, danh sách việc…) như model khóa API.
  const tl = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "chào" }], skills: true });
  const n = Number(/\[công cụ Synchro: (\d+)\]/.exec(tl.j?.text ?? "")?.[1] ?? 0);
  ok(tl.s === 200 && n >= 5, `gói Claude nối được ${n} công cụ của Synchro qua cầu nối MCP`, JSON.stringify(tl.j).slice(0, 300));
  const waitRun = async (id) => { for (let i = 0; i < 60 && id; i++) { const x = await admin("GET", `/api/runs/${id}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") return x.j.run; await sleep(300); } return null; };
  const rc = await admin("POST", "/api/llm", { async: true, model: "sub-claude/sonnet", messages: [{ role: "user", content: 'Tính giúp #tool=run_code #args={"language":"python","code":"print(6*7)"}' }], conv: `${conv}-mcp`, skills: true });
  const rr = await waitRun(rc.j?.run);
  const ev = rr?.events ?? [];
  const say = ev.find((e) => e.kind === "say"), tool = ev.find((e) => e.kind === "tool"), done = ev.find((e) => e.kind === "res");
  // Chạy code cục bộ chỉ có trên macOS (sandbox-exec): máy CI Linux nhận lỗi của công cụ qua cầu nối, vẫn đủ để kiểm đường đi.
  const MAC = process.platform === "darwin";
  ok(rr?.http === 200 && (MAC ? /đã dùng run_code: .*42/ : /đã dùng run_code: .*CODE_RUN=local/).test(rr.result?.text ?? "") && !!say && /run_code/.test(say.text) && !!tool && JSON.parse(done?.text ?? "{}").ok === MAC,
    "gói Claude chạy code qua Synchro: lời dẫn, công cụ, kết quả vào nhật ký làm việc", JSON.stringify({ text: rr?.result?.text, ev: ev.map((e) => e.kind) }));
  ok(rr?.result?.trace?.some((t) => t.name === "run_code" && t.status === (MAC ? "ok" : "error")), "dấu vết công cụ được giữ cho lượt sau (đổi model vẫn biết đã làm gì)", JSON.stringify(rr?.result?.trace));
  const pl = await admin("POST", "/api/llm", { async: true, model: "sub-claude/sonnet", messages: [{ role: "user", content: 'Theo doi #tool=update_plan #args={"items":[{"content":"Buoc mot","status":"in_progress"}]}' }], conv: `${conv}-plan`, skills: true });
  const pr = await waitRun(pl.j?.run);
  ok(pr?.events?.some((e) => e.kind === "plan" && /Buoc mot/.test(e.text)), "gói Claude cập nhật danh sách việc qua cầu nối", JSON.stringify(pr?.events));
  const wb = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "tin mới hôm nay" }], skills: true, web: true });
  ok(wb.s === 200 && /\[tìm web\]/.test(wb.j.text), "bật Tìm kiếm trên web → Claude Code bật WebSearch / WebFetch", JSON.stringify(wb.j).slice(0, 200));
  const off = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(!/\[tìm web\]/.test(off.j.text), "tắt Tìm kiếm trên web → không bật công cụ tìm web");
  const nologin = await member("POST", "/api/llm", { model: "sub-claude/sonnet", messages: msgs, skills: true });
  ok(nologin.s === 409 && /Providers/.test(nologin.j.error), "thành viên chưa đăng nhập gói → 409, nhắc vào Providers", JSON.stringify(nologin.j));
}

console.log("4. Thành viên tự đăng nhập gói ChatGPT (mã thiết bị) dù không có quyền model API nào");
{
  const users = (await admin("GET", "/api/admin")).j.users;
  const u = users.find((x) => x.email === "pv-member@synchro.test");
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: [], features: u.perms.features } });
  const st = await member("POST", "/api/engines/codex/login/start", {});
  ok(st.j?.state === "open_url" && /^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(st.j.userCode ?? "") && !st.j.needsCode, "codex: link + mã một lần", JSON.stringify(st.j));
  await fetch(`${M}/mock-login/codex/approve?code=${st.j.userCode}`);
  let s = null;
  for (let i = 0; i < 20; i++) { s = (await member("GET", "/api/engines/codex/status?fresh=1")).j; if (s.loggedIn) break; await sleep(500); }
  ok(s?.loggedIn && s.method === "chatgpt", "cho phép trên trang của hãng → thành viên đã đăng nhập ChatGPT", JSON.stringify(s));
  const md = (await member("GET", "/api/models")).j;
  const keys = md.providers.find((p) => p.id === "openai" && p.source === "plan")?.models.map((m) => m.key) ?? [];
  ok(keys.includes("sub-codex/gpt-6.1-sol") && keys.every((k) => md.allowed.includes(k)) && md.providers.find((p) => p.id === "anthropic")?.source !== "plan", "thành viên: nhóm ChatGPT hiện model gói của mình (được phép dùng); nhóm Claude không lấy gói của người khác", JSON.stringify({ ids: md.providers.map((p) => [p.id, p.source]), allowed: md.allowed }));
  const r = await member("POST", "/api/llm", { model: "sub-codex/gpt-6.1-sol", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(r.s === 200 && /Codex/.test(r.j.text), "thành viên chat bằng gói của mình dù không có quyền model API", JSON.stringify(r.j));
  // Tính năng phụ chạy bằng gói như bằng khóa API (thành viên này không có quyền model khóa API nào).
  const br = await member("POST", "/api/voice/brief", { question: "Hỏi thử", answer: "Đây là một câu trả lời khá dài cần tóm tắt lại để đọc to cho người dùng nghe trong chế độ giọng nói." });
  ok(br.s === 200 && /^sub-codex\//.test(br.j?.model ?? "") && br.j.brief, "tóm tắt để đọc to chạy bằng gói khi không có khóa API", JSON.stringify(br.j));
  const cp = await member("POST", "/api/context/compact", { messages: [{ role: "user", content: "Mình muốn làm web bán cà phê" }, { role: "assistant", content: "Được, mình làm trang chủ trước." }] });
  ok(cp.s === 200 && /^sub-codex\//.test(cp.j?.model ?? "") && cp.j.summary, "nén ngữ cảnh chạy bằng gói", JSON.stringify(cp.j));
  const cx = await member("POST", "/api/llm", { model: "sub-codex/gpt-6.1-sol", messages: [{ role: "user", content: 'Tính #tool=run_code #args={"language":"python","code":"print(5*5)"}' }], skills: true });
  ok(cx.s === 200 && (process.platform === "darwin" ? /đã dùng run_code: .*25/ : /đã dùng run_code: .*CODE_RUN=local/).test(cx.j.text) && !/Mình sẽ dùng công cụ/.test(cx.j.text), "gói ChatGPT (Codex) chạy code qua cầu nối; lời dẫn không lặp trong câu trả lời", JSON.stringify(cx.j).slice(0, 300));
  const api = await member("POST", "/api/llm", { model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(api.s === 403, "model API dùng chung vẫn theo quyền quản trị viên đặt", JSON.stringify(api.j));
  await member("POST", "/api/auth/profile", { instructions: "Xưng hô là bạn và mình." });
  const mp = await member("POST", "/api/llm", { model: "sub-codex/gpt-6.1-sol", messages: [{ role: "user", content: "#prefs" }], conv: `pv-prefs-${Date.now()}`, skills: true });
  ok(mp.s === 200 && /PREFS: .*Xưng hô là bạn và mình/.test(mp.j.text), "gói ChatGPT (Codex) nhận Hướng dẫn cho Synchro", JSON.stringify(mp.j).slice(0, 300));
  await member("POST", "/api/auth/profile", { instructions: "" });
  const us = (await member("GET", "/api/usage?provider=sub-codex")).j;
  ok(us.sub?.plan === "Plus" && us.sub.windows.length === 2, "vòng tròn của gói ChatGPT Plus: phiên 5 giờ + tuần (qua app-server)", JSON.stringify(us.sub));
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: u.perms.features } });
}

console.log("5. Antigravity: đăng nhập qua terminal giả");
{
  const st = await member("POST", "/api/engines/agy/login/start", {});
  ok(st.j?.state === "open_url" && st.j.needsCode && st.j.url?.startsWith(`${M}/mock-login/agy`), "agy: link đăng nhập Google", JSON.stringify(st.j));
  const d = await member("POST", "/api/engines/agy/login/code", { code: await codeOf("agy") });
  ok(d.j?.state === "done", "dán mã → đã đăng nhập", JSON.stringify(d.j));
  const gm = (await member("GET", "/api/models")).j.providers.find((p) => p.id === "google" && p.source === "plan");
  ok(gm && gm.models.map((m) => m.name).join() === "Gemini 4 Argon,Gemini 3.8 Flash,Gemini 3.1 Flash Lite,Claude Sonnet 4.6 (Antigravity),Claude Opus 4.6 (Antigravity),GPT-OSS 120B (Antigravity)", "nhóm Gemini: đủ model agy trả về (Gemini trước, Claude / GPT qua Antigravity sau), không tách High / Low", JSON.stringify(gm?.models));
  const ag = await member("POST", "/api/llm", { model: "sub-agy/claude-opus-4-6-thinking", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(ag.s === 200 && /\[model claude-opus-4-6-thinking\]/.test(ag.j.text ?? ""), "chat bằng Claude Opus 4.6 qua gói Google (agy --model đúng mã)", JSON.stringify(ag.j).slice(0, 300));
  // Model Claude / GPT qua Antigravity không nhận --effort (agy thật dừng lượt ngay: tài khoản mới chọn "Trung bình" là hỏng mọi lượt chat).
  for (const ef of ["medium", "high"]) {
    const ce = await member("POST", "/api/llm", { model: "sub-agy/claude-opus-4-6-thinking", effort: ef, messages: [{ role: "user", content: "tóm tắt giúp tôi" }], skills: true });
    ok(ce.s === 200 && /\[model claude-opus-4-6-thinking\]/.test(ce.j?.text ?? "") && !/\[effort/.test(ce.j?.text ?? ""), `Claude Opus 4.6 qua Antigravity, mức ${ef}: không gửi --effort, lượt chạy bình thường`, JSON.stringify(ce.j).slice(0, 300));
  }
  // Model nào khác agy cũng báo không nhận effort: Synchro tự chạy lại lượt không kèm effort.
  const ne = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.1-flash-lite", effort: "high", messages: [{ role: "user", content: "chào [mock:noeffort]" }], skills: true });
  ok(ne.s === 200 && /\[model gemini-3\.1-flash-lite\]/.test(ne.j?.text ?? "") && !/\[effort/.test(ne.j?.text ?? ""), "agy báo model không nhận --effort → tự chạy lại không kèm effort", JSON.stringify(ne).slice(0, 300));
  const r = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", effort: "high", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(r.s === 200 && /Gemini/.test(r.j.text) && /\[model gemini-3\.8-flash-high\]/.test(r.j.text), "chat bằng gói Gemini, effort ở mục Effort → biến thể High", JSON.stringify(r.j));
  const users = (await admin("GET", "/api/admin")).j.users, uid = users.find((x) => x.email === "pv-member@synchro.test").id;
  const agyDir = `${process.cwd()}/data-mock/engine/logins/agy/${uid}/.gemini/antigravity-cli`;
  // Công cụ của Synchro cho Gemini qua gói: cầu nối thêm bằng `agy mcp add` cho riêng lượt, hook chỉ cho phép công cụ mcp_synchro_….
  const at = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Ghi việc #tool=update_plan #args={"items":[{"content":"Buoc mot","status":"in_progress"}]}' }], skills: true });
  ok(at.s === 200 && /\[đã dùng update_plan: Đã cập nhật/.test(at.j?.text ?? "") && !/bị từ chối/.test(at.j.text), "Gemini qua gói gọi thẳng công cụ của Synchro (cầu nối đánh dấu nạp sẵn, không bị agy từ chối)", JSON.stringify(at.j));
  const { readFileSync } = await import("node:fs");
  const cfg = `${process.cwd()}/data-mock/engine/logins/agy/${uid}/.gemini/config`;
  ok(!JSON.parse(readFileSync(`${cfg}/mcp_config.json`, "utf8")).mcpServers?.synchro && /"matcher":"mcp_synchro_\.\*\|CallMcpTool"/.test(readFileSync(`${cfg}/hooks.json`, "utf8")), "xong lượt: gỡ cầu nối khỏi cấu hình agy; hook chỉ cho phép công cụ MCP (của Synchro)");
  // agy 1.4.11: công cụ MCP nạp khi cần được gọi qua tên chung CallMcpTool — vẫn được phép, không dừng sau câu dẫn.
  const od = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Ghi việc [mock:ondemand] #tool=update_plan #args={"items":[{"content":"Buoc hai","status":"in_progress"}]}' }], skills: true });
  ok(od.s === 200 && /\[đã dùng update_plan qua CallMcpTool: Đã cập nhật/.test(od.j?.text ?? ""), "agy gọi công cụ qua CallMcpTool (nạp khi cần) vẫn chạy", JSON.stringify(od.j));
  // agy tự chặn công cụ dựng sẵn của nó (lượt dừng sau câu dẫn): Synchro nhắc dùng công cụ của Synchro và làm tiếp — không báo lỗi.
  const { readdirSync } = await import("node:fs");
  const noLogs = () => !readdirSync(`${process.cwd()}/data-mock/engine/work`, { recursive: true }).some((f) => /\.synchro-agy-.*\.log$/.test(String(f)));
  const dn = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Mở trang [mock:deny] #tool=browser_tabs #args={"op":"list"}' }], skills: true });
  ok(dn.s === 200 && /\[đã dùng browser_tabs/.test(dn.j?.text ?? "") && noLogs(), "agy tự chặn công cụ của nó → Synchro nhắc dùng công cụ của Synchro, lượt làm xong (không báo lỗi), xóa nhật ký của lượt", JSON.stringify(dn).slice(0, 400));
  // Nhắc rồi mà vẫn bị chặn: báo rõ ràng (không trả mỗi câu dẫn rồi im lặng).
  const da = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Mở trang [mock:denyall] #tool=browser_tabs #args={"op":"list"}' }], skills: true });
  ok(da.s >= 400 && /Antigravity tự chặn công cụ \(run_command\)/.test(da.j?.error ?? "") && noLogs(), "nhắc hết lượt vẫn bị chặn → báo lỗi rõ ràng", JSON.stringify(da).slice(0, 300));
  // Lỗi tạm thời của gói ở lượt đầu (chưa dùng công cụ nào): Synchro tự thử lại một lần ở phiên mới — người dùng không thấy lỗi.
  const fl = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: "chào [mock:flaky]" }], skills: true });
  ok(fl.s === 200 && /Gemini/.test(fl.j?.text ?? ""), "lỗi tạm thời ở lượt đầu → tự thử lại, lượt vẫn trả lời", JSON.stringify(fl).slice(0, 300));
  // Tìm web: bật tìm web thì agy được dùng search_web của nó; tắt thì bị chặn → nhắc → vẫn trả lời (tin nhắn nào cũng chạy).
  const ws1 = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", web: true, messages: [{ role: "user", content: "tóm tắt video này [mock:websearch] https://www.youtube.com/watch?v=abc" }], skills: true });
  ok(ws1.s === 200 && /\[đã tìm web bằng search_web\]/.test(ws1.j?.text ?? ""), "bật tìm web: agy được dùng search_web của nó", JSON.stringify(ws1).slice(0, 300));
  const ws2 = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: "tóm tắt video này [mock:websearch] https://www.youtube.com/watch?v=abc" }], skills: true });
  ok(ws2.s === 200 && (ws2.j?.text ?? "").length > 0 && !/search_web\]/.test(ws2.j.text), "tắt tìm web: search_web bị chặn → Synchro nhắc → lượt vẫn trả lời, không lỗi", JSON.stringify(ws2).slice(0, 300));
  const pre = (await member("GET", "/api/usage?provider=sub-agy&fresh=1")).j;
  const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
  ok(pre.sub?.setup && !existsSync(`${agyDir}/onboarding-input.log`), "chưa làm quen: vòng tròn báo cần hoàn tất, Synchro không bấm thay", JSON.stringify(pre.sub));
  mkdirSync(`${agyDir}/cache`, { recursive: true }); writeFileSync(`${agyDir}/cache/onboarding.json`, JSON.stringify({ onboardingComplete: true }));
  const us = (await member("GET", "/api/usage?provider=sub-agy&fresh=1")).j;
  ok(us.sub?.windows.some((w) => w.group === "Gemini models" && w.kind === "session") && us.sub.windows.some((w) => w.group === "Claude and GPT models" && w.kind === "weekly"), "vòng tròn của gói Gemini: hai nhóm model × phiên 5 giờ / tuần", JSON.stringify(us.sub));
  const c = await member("POST", "/api/engines/agy/login/start", {});
  ok(c.s === 200, "đăng nhập lại khi đang đăng nhập vẫn mở được luồng mới");
  ok((await member("DELETE", "/api/engines/agy/login/start")).j?.ok, "hủy lượt đăng nhập đang chờ");
}

console.log("5b. Ảnh và PDF gửi kèm nguyên dạng tới model (gói subscription và khóa API)");
{
  // Ảnh PNG 2×3 thật và một PDF nhỏ: model giả đọc kích thước ảnh từ chính các byte nhận được, nên sai một byte là lộ.
  const { deflateSync, crc32 } = await import("node:zlib");
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(3, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc(3 * 7, 200); for (let y = 0; y < 3; y++) rows[y * 7] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
  const pdfBuf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"), pdf = pdfBuf.toString("base64"), P = `application/pdf ${pdfBuf.length}B`;
  const msg = (text) => [{ role: "user", content: [{ type: "text", text }, { type: "image", media_type: "image/png", data: png }, { type: "document", media_type: "application/pdf", data: pdf, name: "đề bài.pdf", fallbackText: "Câu 1: chọn đáp án đúng" }] }];
  const conv = `pv-media-${Date.now()}`;
  const cl = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: msg("#media xem đề bài"), conv, skills: true });
  ok(cl.j?.text === `MEDIA: image/png 2x3 (image); ${P} (document)`, "gói Claude: ảnh và PDF gốc tới model (khối ảnh / PDF qua stream-json)", JSON.stringify(cl.j).slice(0, 300));
  const cl2 = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [...msg("#media xem đề bài"), { role: "assistant", content: cl.j.text }, ...msg("#media thêm ảnh này")], conv, skills: true });
  ok(cl2.j?.text === `MEDIA: image/png 2x3 (image); ${P} (document)`, "gói Claude, lượt nối tiếp phiên: ảnh mới vẫn tới model", JSON.stringify(cl2.j).slice(0, 300));
  const cx = await member("POST", "/api/llm", { model: "sub-codex/gpt-6.1-sol", messages: msg("#media xem đề bài"), skills: true });
  ok(cx.j?.text === "MEDIA: image/png 2x3 (--image)", "gói ChatGPT (Codex): ảnh gửi bằng --image, PDF kèm chữ trích ra và tệp gốc", JSON.stringify(cx.j).slice(0, 300));
  const ag = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", messages: msg("#media xem đề bài"), skills: true });
  ok(ag.j?.text === `MEDIA: image/png 2x3 (view_file); ${P} (view_file)`, "gói Gemini (Antigravity): model mở được ảnh và PDF trong thư mục làm việc", JSON.stringify(ag.j).slice(0, 300));
  const an = await admin("POST", "/api/llm", { model: "anthropic/claude-haiku-5-5", messages: msg("#media xem đề bài"), skills: true });
  ok(an.j?.text === `MEDIA: image/png 2x3 (image); ${P} (document)`, "khóa API Anthropic: ảnh và PDF gốc", JSON.stringify(an.j).slice(0, 300));
  const oa = await admin("POST", "/api/llm", { model: "openai/gpt-6.1-sol", messages: msg("#media xem đề bài"), skills: true });
  ok(oa.j?.text === `MEDIA: image/png 2x3 (input_image); ${P} (input_file)`, "khóa API OpenAI (Responses): ảnh và PDF gốc (input_file), không chỉ chữ trích ra", JSON.stringify(oa.j).slice(0, 300));
  // Đường tải tệp thật của giao diện: /api/files (mỗi ảnh) → /api/files/context → khối gửi model. Bộ đề 13 ảnh chụp màn hình phải đi đủ;
  // trước đây giới hạn 10 tệp làm cả lượt mất hết ảnh mà model không biết.
  const pngOf = (w, h, seed) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const row = Buffer.alloc(1 + w * 3, seed & 255); const raw = Buffer.concat(Array.from({ length: h }, (_, y) => { const r = Buffer.from(row); r[0] = 0; r[1 + (y % w) * 3] = y & 255; return r; })); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); };
  const up = async (buf, name) => { const fd = new FormData(); fd.append("file", new Blob([buf], { type: "image/png" }), name); const r = await fetch(`${B}/api/files`, { method: "POST", headers: { origin: B, cookie: process.env.SYNCHRO_ADMIN_COOKIE ?? "" }, body: fd }); return r.json(); };
  const ids = [], names = {};
  for (let i = 0; i < 13; i++) { const j = await up(pngOf(40 + i, 30 + i, i * 7 + 1), `Screenshot ${i}.png`); ids.push(j.id); names[j.id] = `Screenshot ${i}.png`; }
  const ctx = await admin("POST", "/api/files/context", { ids, names, query: "đáp án" });
  ok(ctx.s === 200 && ctx.j.blocks.filter((b) => b.type === "image").length === 13, "13 ảnh chụp màn hình qua đường tải tệp của giao diện: đủ 13 khối ảnh", JSON.stringify({ s: ctx.s, n: ctx.j?.blocks?.filter((b) => b.type === "image").length, e: ctx.j?.error }));
  const viaPlan = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: [{ type: "text", text: "#media cho tôi đáp án" }, ...ctx.j.blocks] }], skills: true });
  ok((viaPlan.j?.text ?? "").split("; ").length === 13 && /image\/png 52x42/.test(viaPlan.j.text), "cả 13 ảnh tới model qua gói (đúng từng ảnh)", (viaPlan.j?.text ?? "").slice(0, 300));
  const twenty = await admin("POST", "/api/files/context", { ids: Array.from({ length: 20 }, (_, i) => ids[i % 13]), names, query: "" });
  ok(twenty.s === 200, "nhận tới 20 tệp mỗi tin nhắn (như Claude)", twenty.s);
  const over = await admin("POST", "/api/files/context", { ids: Array.from({ length: 21 }, (_, i) => ids[i % 13]), names, query: "" });
  ok(over.s === 413 && /20 tệp/.test(over.j?.error ?? ""), "quá 20 tệp: báo rõ (giao diện chặn từ lúc đính kèm, không gửi lượt thiếu ảnh)", JSON.stringify(over.j));
  // Ảnh chụp màn hình lớn và nặng: thu nhỏ cạnh dài 1568px, còn nặng thì nén JPEG (20 ảnh vẫn gửi được dưới giới hạn 40 MB của máy chủ web).
  const noisy = (() => { const w = 2000, h = 1600, ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const raw = Buffer.alloc(h * (1 + w * 3)); for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]); })();
  const big = await up(noisy, "Screenshot big.png");
  const bigCtx = await admin("POST", "/api/files/context", { ids: [big.id], names: { [big.id]: "Screenshot big.png" }, query: "" });
  const bimg = bigCtx.j?.blocks?.find((b) => b.type === "image");
  ok(bimg?.media_type === "image/jpeg" && bimg.data.length * 0.75 < noisy.length, "ảnh chụp màn hình lớn, nặng: thu nhỏ rồi nén JPEG chất lượng cao", JSON.stringify({ mt: bimg?.media_type, kb: bimg ? Math.round(bimg.data.length * 0.75 / 1024) : null, src: Math.round(noisy.length / 1024) }));
  const gg = await admin("POST", "/api/llm", { model: "google/gemini-3.8-flash", messages: msg("#media xem đề bài"), skills: true });
  ok(gg.j?.text === "MEDIA: image/png 2x3 (image_url)", "khóa API Gemini: ảnh tới model", JSON.stringify(gg.j).slice(0, 300));
}

console.log("6. Hết hạn mức gói → hỏi trước khi dùng khóa API; số dư API đã nạp");
{
  const q = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "[mock:quota] chào" }], skills: true });
  ok(q.s === 429 && q.j.planLimit === "claude" && q.j.apiModel?.startsWith("anthropic/") && q.j.resetsAt > Date.now() && !q.j.text, "gói Claude hết hạn mức → không tự chuyển, trả model API tương đương để hỏi", JSON.stringify(q.j));
  const st = (await admin("GET", "/api/engines/claude/status")).j;
  ok(st.blockedUntil === q.j.resetsAt && !st.usingApiUntil && st.apiModel, "trạng thái gói: hết hạn mức tới mốc đặt lại, chưa dùng API", JSON.stringify(st));
  let g = (await admin("GET", "/api/models")).j.providers.find((p) => p.id === "anthropic");
  ok(g.source === "plan" && g.plan.blockedUntil === q.j.resetsAt, "chưa đồng ý: nhóm Claude vẫn là model của gói", JSON.stringify(g));
  const on = await admin("POST", "/api/engines/claude/use-api", { on: true });
  g = (await admin("GET", "/api/models")).j.providers.find((p) => p.id === "anthropic");
  ok(on.j.usingApiUntil === q.j.resetsAt && g.source === "api" && g.models.some((m) => m.key === q.j.apiModel), "đồng ý: nhóm Claude chuyển sang model API tới khi gói hồi lại", JSON.stringify(g));
  const r = await admin("POST", "/api/llm", { model: q.j.apiModel, messages: [{ role: "user", content: "chào bằng API" }], skills: true });
  ok(r.s === 200 && r.j.text, "gửi lại bằng model API được chọn", JSON.stringify(r.j).slice(0, 200));
  await admin("POST", "/api/engines/claude/use-api", { on: false });
  g = (await admin("GET", "/api/models")).j.providers.find((p) => p.id === "anthropic");
  ok(g.source === "plan", "quay lại gói", JSON.stringify(g?.source));
  const c = await admin("POST", "/api/admin/apikeys", { action: "credit", id: "anthropic", amount: 10 });
  const cr = c.j.credits?.find((x) => x.provider === "anthropic");
  ok(c.s === 200 && cr?.amount === 10 && cr.remaining <= 10, "đặt số dư đã nạp cho Anthropic", JSON.stringify(cr));
  await admin("POST", "/api/llm", { model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: "tốn tiền một chút" }], max_tokens: 200 });
  const u = (await admin("GET", "/api/usage?provider=anthropic")).j;
  ok(u.credit?.amount === 10 && u.credit.spent > 0 && u.credit.remaining < 10, "vòng tròn API: số dư trừ theo chi phí thật", JSON.stringify(u.credit));
  const add = await admin("POST", "/api/admin/apikeys", { action: "credit", id: "anthropic", add: 5 });
  const after = add.j.credits.find((x) => x.provider === "anthropic");
  ok(Math.abs(after.amount - (u.credit.remaining + 5)) < 0.01 && after.spent === 0, "nạp thêm: số dư mới = còn lại + số nạp", JSON.stringify(after));
  ok((await admin("POST", "/api/admin/apikeys", { action: "credit", id: "anthropic", amount: -1 })).s === 400, "số tiền âm → 400");
  await admin("POST", "/api/admin/apikeys", { action: "credit", id: "anthropic", amount: null });
  ok(!(await admin("GET", "/api/usage?provider=anthropic")).j.credit, "ngừng theo dõi số dư");
}

console.log("7. Đăng xuất");
{
  const o = await admin("POST", "/api/engines/claude/logout");
  const md = (await admin("GET", "/api/models")).j;
  ok(o.s === 200 && !o.j.loggedIn && md.providers.find((p) => p.id === "anthropic")?.source === "api" && !md.providers.some((p) => p.models.some((m) => m.key.startsWith("sub-claude/"))), "đăng xuất → nhóm Claude quay về model API", JSON.stringify(o.j));
  for (const cli of ["codex", "agy"]) await member("POST", `/api/engines/${cli}/logout`);
  ok(!(await member("GET", "/api/engines/codex/status?fresh=1")).j.loggedIn, "thành viên đăng xuất gói ChatGPT");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
