// Tạo ảnh qua lượt chat thật trên Synchro giả lập (npm run dev:mock; đổi địa chỉ bằng SYNCHRO_URL, SYNCHRO_MOCK_URL): mọi model gọi được generate_image qua cầu nối MCP hoặc vòng lặp
// công cụ của khóa API, ảnh thành tệp của đúng tài khoản, nhật ký làm việc, Dừng, hạn mức dung lượng, ảnh Antigravity tự tạo, đường nhanh. Phần lõi: tests/api/imagegen.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.SYNCHRO_MOCK_URL ?? "http://127.0.0.1:4010";
const DATA = path.resolve(process.env.DATA_DIR_MOCK ?? "data-mock"), HOME = path.join(DATA, "engine");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Db = createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3");
const dbq = (fn) => { const d = new Db(path.join(DATA, "synchro.db")); d.pragma("busy_timeout = 5000"); try { return fn(d); } finally { d.close(); } };

function client() {
  let cookie = "";
  const api = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  return { api, cookie: () => cookie };
}
async function account(tag) {
  const c = client(), email = `img-${tag}-${Date.now().toString(36)}@synchro.test`, password = "Image-test-123";
  await c.api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Image Tester", birthDate: "2000-01-01" } });
  await c.api("POST", "/api/auth/login", { email, password });
  await c.api("POST", "/api/auth/profile", { fullName: "Image Tester", birthDate: "2000-01-01" });
  const uid = dbq((d) => d.prepare("SELECT id FROM users WHERE email = ?").get(email)?.id);
  return { ...c, uid, email };
}
const LOGIN = { claude: ".mock-login", agy: ".gemini/antigravity-cli/antigravity-oauth-token", grok: ".grok/auth.json", codex: "auth.json" };
const dirOf = (cli, uid) => path.join(HOME, "logins", cli, uid);
async function signIn(a, clis) {
  for (const cli of clis) {
    const f = path.join(dirOf(cli, a.uid), LOGIN[cli]);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, "{}");
    fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true }); fs.writeFileSync(path.join(DATA, "engine-tokens", `${cli}-${a.uid}.login`), "1");
    await a.api("GET", `/api/engines/${cli}/status?fresh=1`);
  }
}
const mode = (a, cli, o) => { const d = dirOf(cli, a.uid); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(d, "mock-image.json"), JSON.stringify(o)); };
const logOf = (a, cli) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(cli, a.uid), "mock-image-log.json"), "utf8")); } catch { return []; } };
const start = (a, body) => a.api("POST", "/api/llm", { async: true, skills: true, conv: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...body });
const finish = async (a, id, ms = 90_000) => { let rn = null; for (const t0 = Date.now(); Date.now() - t0 < ms;) { rn = (await a.api("GET", `/api/runs/${id}?json=1`)).j?.run; if (rn && !["running", "queued", "pending"].includes(rn.status)) break; await sleep(250); } return { s: rn?.http ?? 0, j: rn?.result ?? {}, text: String(rn?.result?.text ?? ""), events: rn?.events ?? [], status: rn?.status }; };
const run = async (a, body) => { const r0 = await start(a, body); return r0.j?.run ? finish(a, r0.j.run) : { s: r0.s, j: r0.j ?? {}, text: String(r0.j?.text ?? ""), events: [] }; };
const ask = (text) => [{ role: "user", content: text }];
const tool = (args) => `#tool=generate_image #args=${JSON.stringify(args)}`;
const isImg = (f) => f && /^image\/(jpeg|png|webp)$/.test(f.mime) && !f.skipped;

const A = await account("a");
if (!A.uid) { console.error("Không tạo được tài khoản thử trên", B); process.exit(1); }
await signIn(A, ["claude", "agy"]);

console.log("1. Model Claude gọi công cụ, ảnh thành tệp của người dùng");
{
  const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "quả táo đỏ", aspect_ratio: "16:9" })}`) });
  const f = r.j.files?.[0];
  ok(r.s === 200 && isImg(f) && f.name === "qua-tao-do.jpg", "có đúng một tệp ảnh trong câu trả lời", r.j);
  const events = r.events;
  ok(events.some((e) => e.kind === "tool" && /^Đang tạo ảnh: quả táo đỏ/.test(e.text)), "dòng công cụ trong nhật ký làm việc", events.map((e) => e.text));
  ok(events.some((e) => e.kind === "step" && e.text === "Đang tạo ảnh bằng Antigravity"), "trạng thái nói đang tạo bằng gói nào", events.map((e) => e.text));
  const res = events.find((e) => e.kind === "res" && /Đã tạo 1 ảnh bằng Antigravity/.test(e.text));
  ok(!!res && JSON.parse(res.text).ok === true, "kết quả công cụ báo thành công, nói rõ đã giao", events.filter((e) => e.kind === "res").map((e) => e.text));
  ok(/Aspect ratio: 16:9/.test(logOf(A, "agy").at(-1)?.prompt ?? ""), "tỉ lệ khung hình tới CLI");
  const dl = await fetch(`${B}/api/outputs/${f?.id}`, { headers: { cookie: A.cookie() } });
  const bytes = Buffer.from(await dl.arrayBuffer());
  ok(dl.ok && bytes[0] === 0xff && bytes[1] === 0xd8 && /attachment/.test(dl.headers.get("content-disposition") ?? ""), "tải về đúng ảnh JPEG", dl.status);
  const inl = await fetch(`${B}/api/outputs/${f?.id}?inline=1`, { headers: { cookie: A.cookie() } });
  ok(inl.ok && (inl.headers.get("content-type") ?? "").startsWith("image/jpeg"), "xem trực tiếp được", inl.headers.get("content-type"));
  const Other = await account("o");
  const no = await fetch(`${B}/api/outputs/${f?.id}`, { headers: { cookie: Other.cookie() } });
  ok(no.status === 404, "tài khoản khác không tải được", no.status);
  ok(r.j.trace?.some((t) => t.name === "generate_image" && t.status === "ok"), "dấu vết cho lượt sau (đổi model vẫn biết đã tạo ảnh gì)", r.j.trace);
  // Tài khoản khác không có gói nào: không dùng login của A.
  await signIn(Other, ["claude"]);
  const n0 = logOf(A, "agy").length;
  const p = await run(Other, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "x" })}`) });
  ok(p.s === 200 && !p.j.files?.length && logOf(A, "agy").length === n0, "tài khoản không có gói ảnh: không mượn đăng nhập của người khác", p.j);
  ok(p.events.some((e) => e.kind === "plans") && /Antigravity/.test(p.text) && p.j.trace?.some((t) => /Cài đặt → Providers/.test(t.summary)), "báo gói nào tạo được, có nút mở Providers", { t: p.j.trace, e: p.events.map((e) => e.kind) });
}

console.log("2. Mọi model đều gọi được");
{
  for (const [model, cli] of [["sub-agy/gemini-3.8-flash", "agy"], ["sub-grok/grok-4.7", "grok"], ["sub-codex/gpt-5.5", "codex"]]) {
    await signIn(A, [cli]);
    const before = logOf(A, "agy").length;
    const r = await run(A, { model, messages: ask(`Tạo ảnh ${tool({ prompt: `ảnh của ${cli}` })}`) });
    ok(r.s === 200 && isImg(r.j.files?.[0]) && /đã dùng generate_image/.test(r.text), `${model}: gọi qua cầu nối, có ảnh`, r.j);
    const lg = logOf(A, "agy");
    ok(lg.length === before + 1 && lg.at(-1).bridge === false, `${model}: lượt tạo ảnh không có cầu nối MCP`, lg.at(-1));
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(dirOf("agy", A.uid), ".gemini/config/mcp_config.json"), "utf8"));
  ok(!cfg.mcpServers?.synchro, "xong lượt: cấu hình chung của Antigravity không còn cầu nối", cfg);

  const models = (await A.api("GET", "/api/models")).j?.providers ?? [];
  const api = models.find((p) => p.source === "api" && p.kind === "deepseek")?.models?.[0]?.key ?? models.flatMap((p) => (p.source === "api" ? p.models : []))[0]?.key;
  if (api) {
    const r = await run(A, { model: api, messages: ask(`Tạo ảnh ${tool({ prompt: "ảnh qua khóa API" })}`) });
    ok(r.s === 200 && isImg(r.j.files?.[0]), `${api}: model khóa API cũng gọi được, vẫn chạy bằng gói đã đăng nhập`, r.j);
  } else ok(true, "bỏ qua model khóa API: tài khoản không có model nào");
  const au = await run(A, { model: "auto", messages: ask(`Tạo ảnh ${tool({ prompt: "ảnh ở chế độ tự động" })}`) });
  ok(au.s === 200 && isImg(au.j.files?.[0]) && au.events.some((e) => e.kind === "note" && /Tự động chọn/.test(e.text)), "chế độ Tự động: chọn model có công cụ, có ảnh", { s: au.s, f: au.j.files, e: au.events.map((e) => e.text) });
}

console.log("3. Hướng dẫn cho model");
{
  const r = await run(A, { model: "sub-claude/haiku", messages: ask("chào #mcp") });
  ok(/công cụ Synchro: \d+/.test(r.text), "lượt đầy đủ có công cụ", r.text);
  const h = (await (await fetch(`${M}/_debug/hist`)).json().catch(() => ({})));
  const models = (await A.api("GET", "/api/models")).j?.providers ?? [];
  const api = models.find((p) => p.source === "api" && p.kind === "anthropic")?.models?.[0]?.key;
  if (api) {
    await run(A, { model: api, messages: ask("chào bạn, kể một mẹo nhỏ đi") });
    const last = ((await (await fetch(`${M}/_debug/hist`)).json().catch(() => ({}))).anthropic ?? []).at(-1);
    const sys = JSON.stringify(last?.system ?? "");
    ok(last?.tools?.some((t) => t.name === "generate_image"), "khóa API: có công cụ generate_image", last?.tools?.map((t) => t.name));
    ok(sys.includes("<image_generation>") && !sys.includes("chưa có công cụ tạo ảnh"), "hướng dẫn nói có công cụ tạo ảnh, không còn câu cũ", sys.slice(0, 200));
  } else ok(!!h, "bỏ qua: không có model Anthropic khóa API");
}

console.log("4. Gói lỗi, chuyển gói");
{
  const U = await account("f");
  await signIn(U, ["claude", "agy", "grok"]);
  mode(U, "agy", { mode: "quota" });
  const r = await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "chuyển gói" })}`) });
  ok(r.s === 200 && r.j.files?.[0]?.mime === "image/png", "Antigravity hết hạn mức: ảnh từ Grok", r.j);
  ok(r.events.some((e) => e.kind === "note" && /Đang thử Grok/.test(e.text)), "báo đang chuyển gói", r.events.map((e) => e.text));
  mode(U, "grok", { mode: "quota" });
  const b = await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "hết cả" })}`) });
  ok(b.s === 200 && !b.j.files?.length && /giới hạn chi tiêu/.test(b.text), "hết cả: báo lý do thật, không có thẻ ảnh", b.j);
  const res = b.events.find((e) => e.kind === "res" && /Chưa tạo được ảnh/.test(e.text));
  ok(!!res && JSON.parse(res.text).ok === false, "dòng công cụ hiện lỗi", b.events.filter((e) => e.kind === "res"));
}

console.log("5. Dừng giữa chừng");
{
  const U = await account("s");
  await signIn(U, ["claude", "agy", "grok"]);
  mode(U, "agy", { mode: "slow" });
  const r0 = await start(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "dừng" })}`) });
  const pid = path.join(dirOf("agy", U.uid), "mock-image.pid");
  for (let i = 0; i < 120 && !fs.existsSync(pid); i++) await sleep(100);
  ok(fs.existsSync(pid), "CLI tạo ảnh đã chạy");
  const c = await U.api("DELETE", `/api/runs/${r0.j.run}`);
  const r = await finish(U, r0.j.run, 30_000);
  ok(c.s === 200 && r.status !== "running" && !r.j.files?.length, "bấm Dừng: lượt dừng, không có tệp", { c, st: r.status, f: r.j.files });
  await sleep(4000);
  let alive = true; try { process.kill(Number(fs.readFileSync(pid, "utf8")), 0); } catch { alive = false; }
  ok(!alive, "CLI tạo ảnh bị kill", pid);
  ok(!logOf(U, "grok").length, "không thử gói kế sau khi dừng");
  const work = path.join(HOME, "work", U.uid);
  ok(!fs.readdirSync(work).some((x) => x.startsWith(".synchro-img-")), "thư mục tạm đã xóa", fs.readdirSync(work));
}

console.log("6. Hạn mức dung lượng");
{
  const U = await account("q");
  await signIn(U, ["claude", "agy"]);
  dbq((d) => d.prepare("INSERT INTO outputs (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(`fake-${U.uid}`.slice(0, 40), U.uid, "lon.bin", "application/octet-stream", 6000 * 1048576, Date.now()));
  const n0 = logOf(U, "agy").length;
  const r = await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "quota" })}`) });
  ok(r.s === 200 && !r.j.files?.length && /dung lượng/.test(r.text) && logOf(U, "agy").length === n0, "hết dung lượng: báo rõ, không chạy CLI tốn hạn mức", r.text);
  dbq((d) => d.prepare("DELETE FROM outputs WHERE user_id = ?").run(U.uid));
}

console.log("7. Ảnh gốc");
{
  const U = await account("r");
  await signIn(U, ["claude", "agy"]);
  const png = createRequire(path.join(process.cwd(), "package.json"))(path.join(process.cwd(), "scripts/mock-cli/mock-cli-common.cjs")).tinyPng(8, 8).toString("base64");
  const r = await run(U, { model: "sub-claude/haiku", messages: [{ role: "user", content: [{ type: "text", text: `Đổi nền ảnh này ${tool({ prompt: "đổi nền xanh", reference: "last" })}` }, { type: "image", media_type: "image/png", data: png }] }] });
  const lg = logOf(U, "agy").at(-1);
  ok(r.s === 200 && isImg(r.j.files?.[0]) && lg?.refOk, "ảnh người dùng gửi tới được Antigravity", { lg, f: r.j.files });
  const name = r.j.files?.[0]?.name;
  const again = await run(U, { model: "sub-claude/haiku", messages: ask(`Sửa tiếp ${tool({ prompt: "thêm mây", reference: name })}`) });
  ok(again.s === 200 && isImg(again.j.files?.[0]) && logOf(U, "agy").at(-1)?.refOk, "sửa tiếp theo tên tệp ảnh đã tạo", again.j);
  const miss = await run(U, { model: "sub-claude/haiku", messages: ask(`Sửa ${tool({ prompt: "x", reference: "khong-co.png" })}`) });
  ok(miss.s === 200 && !miss.j.files?.length && /Không thấy ảnh/.test(miss.text), "không thấy ảnh gốc: báo, không tạo ảnh khác thay vào", miss.text);
}

console.log("8. Antigravity tự tạo ảnh trong lượt chat");
{
  const U = await account("n");
  await signIn(U, ["agy"]);
  const r = await run(U, { model: "sub-agy/gemini-3.8-flash", messages: ask("[mock:nativeimage] vẽ quả táo") });
  ok(r.s === 200 && isImg(r.j.files?.[0]) && !/brain|\.gemini|file:\/\//.test(r.text), "ảnh thành tệp, không lộ đường dẫn máy chủ", r.j);
  ok(!r.events.some((e) => /\.gemini|file:\/\//.test(e.text)), "nhật ký làm việc cũng không lộ", r.events.map((e) => e.text));
  const f = await run(U, { model: "sub-agy/gemini-3.8-flash", messages: ask("xin chào mocknativeimage") });
  ok(f.s === 200 && isImg(f.j.files?.[0]) && !/\.gemini|file:\/\//.test(f.text), "đường nhanh (chưa có công cụ) cũng giao ảnh", f.j);
  const inc = await run(U, { model: "sub-agy/gemini-3.8-flash", incognito: true, messages: ask("[mock:nativeimage] vẽ quả táo ẩn danh") });
  ok(inc.s === 200 && isImg(inc.j.files?.[0]), "đoạn chat ẩn danh: lấy ảnh trước khi xóa tệp phiên", inc.j);
}

console.log("9. Đường nhanh");
{
  const q = await run(A, { model: "sub-claude/haiku", messages: ask("Vẽ một con mèo") });
  ok(/công cụ Synchro: \d+/.test(q.text) || /generate_image/.test(q.text), "xin ảnh: lượt đầy đủ có công cụ", q.text);
  const h = await run(A, { model: "sub-claude/haiku", messages: ask("xin chào") });
  ok(!/công cụ Synchro/.test(h.text), "câu chào: vẫn đường nhanh", h.text);
  const c = await run(A, { model: "sub-claude/haiku", messages: ask("vẽ biểu đồ doanh thu") });
  ok(/công cụ Synchro: \d+/.test(c.text), "vẽ biểu đồ: lượt đầy đủ (dựng bằng code)", c.text);
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
