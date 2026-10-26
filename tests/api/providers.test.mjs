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
  const run = await admin("POST", "/api/llm", { model: "sub-claude/haiku", messages: [{ role: "user", content: "chạy nền" }], conv: `${conv}-bg`, skills: true, async: true });
  let res = null;
  for (let i = 0; i < 40 && run.j?.run; i++) { const x = await admin("GET", `/api/runs/${run.j.run}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") { res = x.j.run; break; } await sleep(300); }
  ok(res?.http === 200 && /lượt 1/.test(res.result?.text ?? ""), "lượt chạy nền (truyền chữ dần) cũng chạy bằng gói", JSON.stringify(res));
  const us = await admin("GET", "/api/usage?provider=sub-claude");
  ok(us.j.sub?.cli === "claude" && us.j.sub.windows.some((w) => w.kind === "session" && w.usedPct > 0 && w.resetsAt > Date.now()) && us.j.sub.windows.some((w) => w.kind === "weekly"), "vòng tròn mức dùng: phiên 5 giờ + tuần của gói Claude", JSON.stringify(us.j.sub));
  const auto = await admin("POST", "/api/llm", { model: "auto", messages: [{ role: "user", content: "chào nhanh" }], conv: `${conv}-auto`, skills: true });
  ok(auto.s === 200 && auto.j.model?.startsWith("sub-claude/") && auto.j.auto, "chế độ Tự động chọn model của gói đang dùng, không tự sang khóa API", JSON.stringify({ s: auto.s, model: auto.j?.model, auto: auto.j?.auto }));
  const art = await admin("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: "vẽ biểu đồ" }], skills: true });
  ok(art.s === 200 && /có hướng dẫn artifact/.test(art.j.text), "lượt chat bằng gói được gửi kèm hướng dẫn artifact / biểu đồ của Synchro", JSON.stringify(art.j).slice(0, 200));
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
  const api = await member("POST", "/api/llm", { model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(api.s === 403, "model API dùng chung vẫn theo quyền quản trị viên đặt", JSON.stringify(api.j));
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
  ok(gm && gm.models.map((m) => m.name).join() === "Gemini 4 Argon,Gemini 3.8 Flash,Gemini 3.1 Flash Lite", "nhóm Gemini: đúng model Gemini, không lẫn Claude / GPT, không tách High / Low", JSON.stringify(gm?.models));
  const r = await member("POST", "/api/llm", { model: "sub-agy/gemini-3.8-flash", effort: "high", messages: [{ role: "user", content: "chào" }], skills: true });
  ok(r.s === 200 && /Gemini/.test(r.j.text) && /\[model gemini-3\.8-flash-high\]/.test(r.j.text), "chat bằng gói Gemini, effort ở mục Effort → biến thể High", JSON.stringify(r.j));
  const users = (await admin("GET", "/api/admin")).j.users, uid = users.find((x) => x.email === "pv-member@synchro.test").id;
  const agyDir = `${process.cwd()}/data-mock/engine/logins/agy/${uid}/.gemini/antigravity-cli`;
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
