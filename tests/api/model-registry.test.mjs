// Sổ model tự cập nhật, chạy trọn vòng trên Synchro giả lập (npm run dev:mock): hãng ra model mới (máy chủ giả lập /_debug/add-model) →
// Synchro thấy khi dò → tự thử (chữ, công cụ, ảnh) → cho dùng, nhãn "Mới", chế độ Tự động chọn bản mới nhất của dòng → báo quản trị viên.
// Model thử không đạt thì ở "đang thử", chat không dùng; hãng từ chối tham số thì Synchro học và gửi đúng; hãng gỡ model thì người đang
// chọn nó được chuyển sang bản mới nhất cùng dòng. Quản trị viên: tắt tự nhận theo hãng, dùng ngay, ghim, ẩn.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.SYNCHRO_MOCK_URL ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const client = (cookie = "") => async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const mock = (p, body) => fetch(M + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const member = client();
await member("POST", "/api/auth/signup", { email: "reg-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Registry Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "reg-member@synchro.test", password: "Member-pass-123" });
const users = (await admin("GET", "/api/admin")).j?.users ?? [];
const mu = users.find((x) => x.email === "reg-member@synchro.test");
if (mu) await admin("PATCH", `/api/admin/users/${mu.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(mu.perms.features).map((k) => [k, true])) } });
const shownBefore = (await admin("GET", "/api/admin/apikeys")).j?.main ?? ["*"];
await admin("POST", "/api/admin/apikeys", { action: "main", main: ["*"] });

const CAPS = { image_input: { supported: true }, thinking: { supported: true, types: { enabled: { supported: false }, adaptive: { supported: true } } },
  effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } };
const check = (force) => admin("POST", "/api/admin/models", { action: "check", ...(force ? { force } : {}) });
const reg = async () => (await admin("GET", "/api/admin/models")).j;
const row = (r, key) => r?.models?.find((m) => m.key === key);
const modelsOf = async (who = member) => (await who("GET", "/api/models")).j;
const keys = (md) => (md?.providers ?? []).flatMap((p) => p.models.map((m) => m.key));
const settingsBefore = (await reg())?.settings;

try {
  await mock("/_debug/reset-models", {});
  console.log("1. Sổ model: lần đầu là nền, không đổi gì");
  let r = await check();
  // Lần chạy trước để lại model thử nghiệm (đã ngừng): xóa khỏi sổ để lần này chúng lại là model mới.
  const TEST_KEYS = ["anthropic/claude-opus-6", "anthropic/claude-sonnet-6", "openai/gpt-7-sol", "google/gemini-4.5-pro", "xai/grok-5"];
  for (const k of TEST_KEYS) if (row(r.j, k)) await admin("POST", "/api/admin/models", { action: "forget", key: k });
  ok((await admin("POST", "/api/admin/models", { action: "forget", key: "anthropic/claude-opus-5-5" })).s === 400, "không xóa được model hãng còn bán");
  r = await check();
  ok(r.s === 200 && Array.isArray(r.j?.models), "quản trị viên bấm Kiểm tra ngay → sổ model", JSON.stringify(r.j).slice(0, 300));
  const base = row(r.j, "anthropic/claude-opus-5-5");
  ok(base?.status === "active" && base.shown && !base.isNew, "model đang có: đang dùng, không gắn nhãn Mới", JSON.stringify(base));
  ok((await member("GET", "/api/admin/models")).s === 403, "thành viên không xem được sổ model");
  ok((await admin("POST", "/api/admin/models", { action: "khong-co" })).s === 400, "thao tác lạ → 400");
  const md0 = await modelsOf();
  ok(keys(md0).includes("anthropic/claude-opus-5-5") && !keys(md0).includes("anthropic/claude-opus-5"), "bộ chọn model như cũ: Opus 5.5 có, đời cũ (Opus 5) ẩn", keys(md0).join());

  console.log("2. Hãng ra Claude Opus 6: thấy, thử, cho dùng");
  await mock("/_debug/add-model", { provider: "anthropic", id: "claude-opus-6", name: "Claude Opus 6", caps: CAPS, maxOut: 64000 });
  r = await check();
  const o6 = row(r.j, "anthropic/claude-opus-6");
  ok(r.j?.report?.providers?.find((p) => p.id === "anthropic")?.added?.includes("anthropic/claude-opus-6"), "lượt dò thấy model mới của Anthropic", JSON.stringify(r.j?.report));
  ok(o6?.status === "active" && o6.test?.ok && o6.test.steps.map((s) => `${s.name}:${s.ok}`).join() === "text:true,tool:true,image:true", "tự thử: chữ, gọi công cụ, đọc ảnh đều đạt → đang dùng", JSON.stringify(o6));
  ok(o6?.isNew && o6.created && o6.maxOut === 64000 && o6.sources?.caps === "provider", "nhãn Mới; ngày ra mắt, trần token, khả năng lấy từ hãng", JSON.stringify(o6));
  const last = (await mock("/_debug/last")).anthropic;
  ok(last?.model === "claude-opus-6" && last.thinking?.type === "adaptive" && last.output_config?.effort === "low", "gọi đúng tham số của Claude đời mới: thinking adaptive + mức nỗ lực", JSON.stringify({ m: last?.model, t: last?.thinking, o: last?.output_config }));
  ok(last?.max_tokens <= 64000, "không vượt trần token đầu ra hãng báo", last?.max_tokens);
  const md1 = await modelsOf();
  const m6 = md1.providers.flatMap((p) => p.models).find((m) => m.key === "anthropic/claude-opus-6");
  ok(m6?.isNew === true && m6.name === "Claude Opus 6", "bộ chọn model của thành viên: Claude Opus 6 với nhãn Mới", JSON.stringify(m6));
  ok(keys(md1).includes("anthropic/claude-opus-5-5"), "bản trước (Opus 5.5) vẫn ở lại làm dự phòng");
  const inbox = (await admin("GET", "/api/autopilot")).j;
  const note = (inbox?.items ?? []).find((x) => /Synchro đã thêm model mới: .*Claude Opus 6/.test(x.title ?? ""));
  ok(!!note && /chữ ✓, công cụ ✓, ảnh ✓/.test(note.text ?? note.preview ?? JSON.stringify(note)), "quản trị viên nhận thông báo kèm kết quả thử", JSON.stringify(inbox?.items?.slice(0, 2)));

  console.log("3. Chế độ Tự động dùng bản mới nhất của dòng");
  const ask = await member("POST", "/api/llm", { system: "", model: "auto", skills: true, messages: [{ role: "user", content: "Làm trang web cho quán cà phê" }] });
  ok(ask.s === 200 && ask.j?.model === "anthropic/claude-opus-6", `việc khó → Opus 6 thay Opus 5.5 (${ask.j?.model})`, JSON.stringify(ask.j).slice(0, 300));

  console.log("4. Model thử không đạt: không ai dùng được, thử lại sau");
  await mock("/_debug/add-model", { provider: "openai", id: "gpt-7-sol", name: "GPT-7 Sol", fail: "all" });
  r = await check();
  let g7 = row(r.j, "openai/gpt-7-sol");
  ok(g7?.status === "testing" && !g7.shown && g7.test && !g7.test.ok && /not available/.test(g7.test.error ?? "") && g7.nextTest > Date.now(), "không đạt → đang thử, hẹn thử lại, không hiện", JSON.stringify(g7));
  ok(!keys(await modelsOf()).includes("openai/gpt-7-sol"), "bộ chọn model không có GPT-7 Sol");
  const chatBad = await member("POST", "/api/llm", { system: "", model: "auto", skills: true, messages: [{ role: "user", content: "Chứng minh rằng căn bậc hai của 2 là số vô tỉ" }] });
  ok(chatBad.s === 200 && chatBad.j?.model !== "openai/gpt-7-sol", `chat không chạy trên model chưa đạt (${chatBad.j?.model})`);
  const direct = await member("POST", "/api/llm", { system: "", model: "openai/gpt-7-sol", skills: true, messages: [{ role: "user", content: "Xin chào" }] });
  ok(direct.s === 400 && /chưa thử xong/.test(direct.j?.error ?? ""), "gửi thẳng mã model chưa đạt (không qua bộ chọn): máy chủ từ chối", JSON.stringify(direct.j).slice(0, 300));
  await mock("/_debug/add-model", { provider: "openai", id: "gpt-7-sol", name: "GPT-7 Sol" });
  r = await admin("POST", "/api/admin/models", { action: "retest", key: "openai/gpt-7-sol" });
  g7 = row(r.j, "openai/gpt-7-sol");
  ok(g7?.status === "active" && g7.test?.ok && g7.attempts === 2, "hãng sửa xong, Thử lại → đạt, đang dùng", JSON.stringify(g7));
  ok(keys(await modelsOf()).includes("openai/gpt-7-sol"), "GPT-7 Sol hiện ở bộ chọn model");

  console.log("5. Hãng từ chối một tham số: Synchro học và gửi đúng");
  await mock("/_debug/add-model", { provider: "google", id: "gemini-4.5-pro", name: "Gemini 4.5 Pro", fail: "effort" });
  r = await check();
  const gp = row(r.j, "google/gemini-4.5-pro");
  ok(gp?.status === "active" && Array.isArray(gp.caps?.effort) && gp.caps.effort.length === 0 && gp.caps.from?.effort === "test", "Gemini 4.5 Pro không nhận mức nỗ lực → ghi nhớ, vẫn đạt", JSON.stringify(gp));
  const gchat = await member("POST", "/api/llm", { system: "", model: "google/gemini-4.5-pro", effort: "high", skills: true, messages: [{ role: "user", content: "Xin chào" }] });
  ok(gchat.s === 200 && (await mock("/_debug/last")).google?.reasoning_effort === undefined, "lượt chat thật không gửi tham số đó nữa", JSON.stringify(gchat.j).slice(0, 300));

  console.log("6. Hãng gỡ model: người đã chọn được chuyển sang bản mới nhất cùng dòng");
  await mock("/_debug/add-model", { provider: "anthropic", id: "claude-sonnet-6", name: "Claude Sonnet 6", caps: CAPS });
  await check();
  await mock("/_debug/remove-model", { provider: "anthropic", id: "claude-sonnet-5-5" });
  r = await check();
  const s55 = row(r.j, "anthropic/claude-sonnet-5-5");
  ok(s55?.status === "retired" && s55.replacedBy === "anthropic/claude-sonnet-6" && s55.goneAt, "Sonnet 5.5 bị gỡ → đã ngừng, thay bằng Sonnet 6", JSON.stringify(s55));
  const md2 = await modelsOf();
  ok(!keys(md2).includes("anthropic/claude-sonnet-5-5") && md2.replaced?.["anthropic/claude-sonnet-5-5"]?.to === "anthropic/claude-sonnet-6" && md2.replaced["anthropic/claude-sonnet-5-5"].name === "Claude Sonnet 5.5",
    "danh sách model báo bản thay thế để trình duyệt chuyển người đã chọn tay và báo một lần", JSON.stringify(md2.replaced));
  ok(md2.replaced["anthropic/claude-sonnet-5-5"].why === "gone", "lý do: hãng đã gỡ");

  console.log("7. Quản trị viên: ẩn, ghim, tắt tự nhận theo hãng, dùng ngay");
  await admin("POST", "/api/admin/models", { action: "hide", key: "anthropic/claude-opus-6", on: true });
  ok(!keys(await modelsOf()).includes("anthropic/claude-opus-6"), "ẩn → không hiện ở bộ chọn model");
  await admin("POST", "/api/admin/models", { action: "hide", key: "anthropic/claude-opus-6", on: false });
  ok(keys(await modelsOf()).includes("anthropic/claude-opus-6"), "hiện lại");
  await admin("POST", "/api/admin/models", { action: "pin", key: "anthropic/claude-opus-5", on: true });
  ok(keys(await modelsOf()).includes("anthropic/claude-opus-5"), "ghim → đời cũ (Opus 5) vẫn hiện");
  await admin("POST", "/api/admin/models", { action: "pin", key: "anthropic/claude-opus-5", on: false });
  ok(!keys(await modelsOf()).includes("anthropic/claude-opus-5"), "bỏ ghim → ẩn như trước");
  await admin("POST", "/api/admin/models", { action: "provider", id: "xai", on: false });
  await mock("/_debug/add-model", { provider: "xai", id: "grok-5", name: "grok-5" });
  r = await check();
  ok(row(r.j, "xai/grok-5")?.status === "new" && !row(r.j, "xai/grok-5").test && r.j.settings.off.includes("xai"), "tắt tự nhận cho xAI → Grok 5 chờ quản trị viên, không tự thử", JSON.stringify(row(r.j, "xai/grok-5")));
  r = await admin("POST", "/api/admin/models", { action: "activate", key: "xai/grok-5" });
  ok(row(r.j, "xai/grok-5")?.status === "active" && keys(await modelsOf()).includes("xai/grok-5"), "Dùng ngay → hiện ở bộ chọn model");
  const md3 = await modelsOf();
  ok(keys(md3).includes("xai/grok-4.7") && !keys(md3).includes("xai/grok-4.6") && !keys(md3).includes("xai/grok-4.5") && row(r.j, "xai/grok-4.5")?.status === "deprecated",
    "dòng Grok có bản mới: giữ hai bản mới nhất (Grok 5, 4.7), bản cũ hơn chuyển sang đã cũ", keys(md3).filter((k) => k.startsWith("xai/")).join());
  ok(md3.replaced?.["xai/grok-4.5"]?.to === "xai/grok-5" && md3.replaced["xai/grok-4.5"].why === "old", "người đang chọn Grok 4.5 được chuyển sang Grok 5 (lý do: đã có bản mới hơn, không phải hãng gỡ)", JSON.stringify(md3.replaced));
  // Màn hình chính quản trị viên chọn tay chỉ có Grok 4.5 (nay đã cũ): Grok 5 giữ chỗ, bộ chọn không mất Grok.
  await admin("POST", "/api/admin/apikeys", { action: "main", main: ["xai/grok-4.5", "anthropic/claude-opus-6"] });
  const md4 = await modelsOf();
  ok(keys(md4).includes("xai/grok-5") && keys(md4).includes("anthropic/claude-opus-6") && !keys(md4).includes("xai/grok-4.5"), "màn hình chính chọn tay Grok 4.5 → Grok 5 giữ chỗ", keys(md4).join());
  await admin("POST", "/api/admin/apikeys", { action: "main", main: ["*"] });
  await admin("POST", "/api/admin/models", { action: "provider", id: "xai", on: true });
  r = await admin("POST", "/api/admin/models", { action: "auto", on: false });
  ok(r.j?.settings?.auto === false, "tắt tự nhận model mới cho cả máy chủ");
  await admin("POST", "/api/admin/models", { action: "auto", on: true });

  console.log("8. Giá: model mới kế thừa giá của bản gần nhất cùng dòng (ước tính, không bao giờ 0)");
  const prices = (await admin("GET", "/api/admin/usage")).j?.prices ?? [];
  const p6 = prices.find((p) => p.model === "anthropic/claude-opus-6"), g7p = prices.find((p) => p.model === "openai/gpt-7-sol");
  ok(p6?.in === 4 && p6.out === 20 && p6.src === "estimate", "Opus 6 dùng giá Opus 5.5 (ước tính)", JSON.stringify(p6));
  ok(g7p?.in === 2 && g7p.out === 10 && g7p.src === "estimate", "GPT-7 Sol dùng giá GPT-6.1 Sol thay vì giá chung $3 / $15", JSON.stringify(g7p));
  ok(prices.every((p) => p.in > 0 && p.out > 0), "không model nào có giá 0");
} finally {
  // Trả máy chủ giả lập và sổ model về như cũ để các bộ kiểm thử khác thấy đúng danh sách gốc.
  await mock("/_debug/reset-models", {});
  if (settingsBefore) { await admin("POST", "/api/admin/models", { action: "auto", on: settingsBefore.auto }); for (const id of ["xai"]) await admin("POST", "/api/admin/models", { action: "provider", id, on: !settingsBefore.off.includes(id) }); }
  await admin("POST", "/api/admin/apikeys", { action: "main", main: shownBefore });
  const rr = await check();
  for (const k of ["anthropic/claude-opus-6", "anthropic/claude-sonnet-6", "openai/gpt-7-sol", "google/gemini-4.5-pro", "xai/grok-5"]) if (row(rr.j, k)?.status === "retired") await admin("POST", "/api/admin/models", { action: "forget", key: k });
  const md = await modelsOf();
  ok(keys(md).includes("anthropic/claude-sonnet-5-5") && !keys(md).includes("anthropic/claude-opus-6") && keys(md).includes("xai/grok-4.5") && !Object.keys(md.replaced ?? {}).length,
    "dọn: danh sách gốc trở lại (Grok 4.5 dùng lại được khi Grok 5 bị gỡ), model thử nghiệm đã ngừng", keys(md).join());
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
