// Bộ nhớ thật và tìm web (npm run dev:mock): bộ nhớ lưu ở máy chủ theo từng người, tự rút từ cuộc trò chuyện, đưa vào lượt chat khi bật,
// không dùng / không học khi tắt hoặc ẩn danh; "Tìm kiếm trên web" bật công cụ tìm web phía máy chủ của hãng.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (cookie = "") => async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const me = client(), other = client();
await me("POST", "/api/auth/signup", { email: "mem-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Memory Tester", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: "mem-member@synchro.test", password: "Member-pass-123" });
await other("POST", "/api/auth/signup", { email: "mem-other@synchro.test", password: "Member-pass-123", profile: { fullName: "Memory Other", birthDate: "2000-01-01" } });
await other("POST", "/api/auth/login", { email: "mem-other@synchro.test", password: "Member-pass-123" });
const MODEL = "anthropic/claude-haiku-5-5";
// Yêu cầu chat gần nhất (bỏ lời gọi rút bộ nhớ chạy nền sau lượt).
const last = async () => [...((await (await fetch(`${M}/_debug/hist`)).json()).anthropic ?? [])].reverse().find((b) => !JSON.stringify(b.system ?? "").includes("trích xuất bộ nhớ"));
const run = async (text, extra = {}) => {
  const r = await me("POST", "/api/llm", { async: true, skills: true, system: "", model: MODEL, messages: [{ role: "user", content: text }], conv: `mem-${Date.now()}`, ...extra });
  for (let i = 0; i < 60 && r.j?.run; i++) { const x = await me("GET", `/api/runs/${r.j.run}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") return x.j.run; await sleep(300); }
  return null;
};
await me("DELETE", "/api/memory");

console.log("1. Quản lý bộ nhớ");
let r = await me("GET", "/api/memory");
ok(r.s === 200 && r.j.items.length === 0 && r.j.cfg.gen === true && r.j.cfg.sens === false, "mặc định: trống, tự rút bật, không lưu chủ đề nhạy cảm", JSON.stringify(r.j));
r = await me("POST", "/api/memory", { text: "- Làm kỹ sư dữ liệu\n- Thích câu trả lời ngắn gọn\n- Thích câu trả lời ngắn gọn" });
ok(r.s === 200 && r.j.added === 2 && r.j.items.length === 2, "nhập từ trợ lý khác: mỗi dòng một mục, bỏ trùng", JSON.stringify(r.j));
ok((await other("GET", "/api/memory")).j.items.length === 0, "người khác không thấy bộ nhớ của mình");
const first = r.j.items[0].id;
r = await me("DELETE", `/api/memory?id=${first}`);
ok(r.s === 200 && r.j.items.length === 1, "xóa từng mục");
ok((await client()("GET", "/api/memory")).s === 401, "chưa đăng nhập → 401");

console.log("2. Dùng bộ nhớ trong lượt chat");
await run("Viết một câu chào");
let L = await last();
let sys = JSON.stringify(L?.system ?? "");
ok(sys.includes("<user_memory>") && sys.includes("Thích câu trả lời ngắn gọn"), "bật Bộ nhớ → lượt chat có khối user_memory", sys.slice(0, 300));
await run("Viết một câu chào nữa", { memory: false });
L = await last();
ok(!JSON.stringify(L?.system ?? "").includes("<user_memory>"), "tắt Bộ nhớ ở khung soạn → không gửi bộ nhớ");

console.log("3. Tự rút bộ nhớ từ cuộc trò chuyện");
await run("Tên mình là Lâm Tùng, mình thích nhạc lo-fi khi làm việc");
let items = [];
for (let i = 0; i < 20; i++) { items = (await me("GET", "/api/memory")).j.items.map((x) => x.content); if (items.some((x) => /Lâm Tùng/.test(x))) break; await sleep(300); }
ok(items.some((x) => /Tên là Lâm Tùng/.test(x)) && items.some((x) => /lo-fi/.test(x)), "rút được tên và sở thích sau lượt chat", JSON.stringify(items));
const n = items.length;
await run("Tên mình là Người Ẩn, mình thích bí mật", { incognito: true });
await sleep(1500);
ok((await me("GET", "/api/memory")).j.items.length === n, "chế độ ẩn danh → không học, không lưu");
await me("POST", "/api/memory", { cfg: { gen: false } });
await run("Tên mình là Người Khác, mình thích đi bộ");
await sleep(1500);
r = await me("GET", "/api/memory");
ok(r.j.cfg.gen === false && r.j.items.length === n, "tắt \"Tự rút bộ nhớ\" → không thêm mục mới", JSON.stringify(r.j.items.map((x) => x.content)));
await me("POST", "/api/memory", { cfg: { gen: true } });

console.log("4. Tìm kiếm trên web (khóa API)");
const wr = await run("Tin mới hôm nay về AI #web", { web: true });
L = await last();
const wt = (L?.tools ?? []).find((t) => /^web_search_/.test(t.type ?? ""));
ok(!!wt && wt.name === "web_search" && wt.max_uses === 5, `bật Tìm kiếm trên web → gửi công cụ ${wt?.type} của Anthropic`, JSON.stringify(L?.tools?.map((t) => t.type ?? t.name)));
ok(wr?.events?.some((e) => e.kind === "tool" && /Đang tìm trên web: Tin mới/.test(e.text)) && /kết quả tìm web/.test(wr?.result?.text ?? ""), "lượt tìm web hiện trong nhật ký và có câu trả lời", JSON.stringify({ ev: wr?.events, t: wr?.result?.text }));
const ow = await run("Tin mới hôm nay về AI #web", { web: true, model: "openai/gpt-6-luna" });
const oreq = ((await (await fetch(`${M}/_debug/hist`)).json()).openai ?? []).at(-1);
ok((oreq?.tools ?? []).some((t) => t.type === "web_search") && ow?.events?.some((e) => e.kind === "tool" && /Đang tìm trên web: Tin mới/.test(e.text)) && /web_search của OpenAI/.test(ow?.result?.text ?? ""), "OpenAI: gửi công cụ web_search, hiện dòng tìm web và có câu trả lời", JSON.stringify({ tools: oreq?.tools?.map((t) => t.type ?? t.name), ev: ow?.events, t: ow?.result?.text }));
ok(/\n\nTheo kết quả/.test(wr?.result?.text ?? ""), "chữ trước và sau khi tìm web tách thành hai đoạn", JSON.stringify(wr?.result?.text));
await run("Chào bạn", { web: false });
L = await last();
ok(!(L?.tools ?? []).some((t) => /^web_search_/.test(t.type ?? "")), "tắt Tìm kiếm trên web → không gửi công cụ tìm web");

console.log("N. Hướng dẫn cho Synchro (Cài đặt → Tài khoản) tới được model");
{
  const INS = "Luôn trả lời bằng tiếng Việt, ngắn gọn.\nGọi tôi là anh Tùng.";
  const pr = await me("POST", "/api/auth/profile", { instructions: INS, nickname: "Tùng", occupation: "Data science" });
  ok(pr.s === 200 && pr.j.user.profile.instructions === INS, "lưu hướng dẫn lên máy chủ theo tài khoản (giữ xuống dòng)", JSON.stringify(pr.j?.user?.profile));
  ok((await me("GET", "/api/auth/me")).j.user.profile.instructions === INS, "thiết bị khác đọc lại được hướng dẫn (qua /api/auth/me)");
  await run("Viết giúp mình một câu chào");
  const sys = JSON.stringify((await last())?.system ?? "");
  ok(sys.includes("<user_preferences>") && sys.includes("Luôn trả lời bằng tiếng Việt") && sys.includes("Tùng") && sys.includes("Data science"), "lượt chat gửi kèm hướng dẫn, tên gọi và công việc cho model", sys.slice(0, 600));
  const echo = await run("#prefs");
  ok(/PREFS: .*Gọi tôi là anh Tùng/.test(echo?.result?.text ?? ""), "model nhận được hướng dẫn trong lượt chat", echo?.result?.text);
  const inc = await me("POST", "/api/llm", { skills: true, incognito: true, system: "", model: MODEL, messages: [{ role: "user", content: "#prefs" }] });
  ok(/PREFS: .*Gọi tôi là anh Tùng/.test(inc.j?.text ?? ""), "đoạn chat ẩn danh vẫn theo hướng dẫn (chỉ không dùng bộ nhớ)", JSON.stringify(inc.j).slice(0, 300));
  const raw = await me("POST", "/api/llm", { skills: false, system: "", model: MODEL, messages: [{ role: "user", content: "#prefs" }] });
  ok(/PREFS: none/.test(raw.j?.text ?? ""), "lời gọi nội bộ (đặt tên, rút bộ nhớ…) không kèm hướng dẫn", JSON.stringify(raw.j).slice(0, 300));
  const ot = await other("POST", "/api/llm", { skills: true, system: "", model: MODEL, messages: [{ role: "user", content: "#prefs" }] });
  ok(!/anh Tùng/.test(ot.j?.text ?? ""), "người khác không nhận hướng dẫn của mình", JSON.stringify(ot.j).slice(0, 300));
  const longIns = `${INS}\n${"Mình đang ôn thi THPT Quốc gia môn Toán, Vật lý, Tiếng Anh. ".repeat(120)}Kết thúc phần giới thiệu.`;
  const lg = await me("POST", "/api/auth/profile", { instructions: longIns });
  ok(lg.s === 200 && lg.j.user.profile.instructions.length > 4000 && lg.j.user.profile.instructions.endsWith("Kết thúc phần giới thiệu."), "phần giới thiệu dài hơn 4.000 ký tự được lưu trọn vẹn (không bị cắt)", JSON.stringify({ s: lg.s, len: lg.j?.user?.profile?.instructions?.length }));
  const full = await run("#prefs");
  ok(/Kết thúc phần giới thiệu\./.test(full?.result?.text ?? ""), "model nhận đủ cả phần giới thiệu dài", (full?.result?.text ?? "").slice(-200));
  ok((await me("POST", "/api/auth/profile", { instructions: "x".repeat(20001) })).s === 400, "phần giới thiệu quá 20.000 ký tự → báo lỗi");
  await run("Chào bạn");
  const ctx = JSON.stringify((await last())?.system ?? "");
  ok(ctx.includes("<user_context>") && ctx.includes("hiểu biết sẵn có của chính bạn") && ctx.includes("không dùng những cụm như") && ctx.includes("tin điều cụ thể và mới hơn"),
    "thông tin về người dùng đưa vào như hiểu biết sẵn có, kèm quy tắc nói tự nhiên (không như đọc hồ sơ, không bắt lỗi mâu thuẫn)", ctx.slice(0, 400));
  await me("POST", "/api/auth/profile", { instructions: "" });
  const cl = await run("#prefs");
  ok(!/anh Tùng/.test(cl?.result?.text ?? "") && (await me("GET", "/api/auth/me")).j.user.profile.instructions === "", "xóa hướng dẫn → model không còn nhận", cl?.result?.text);
}

await me("DELETE", "/api/memory");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
