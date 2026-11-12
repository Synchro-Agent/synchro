// Tạo ảnh bằng khóa Replicate của chủ máy chủ (app/ai/replicate.ts) trên Synchro giả lập (npm run dev:mock; SYNCHRO_URL, SYNCHRO_MOCK_URL). Chỉ gọi Replicate GIẢ LẬP
// (scripts/mock-replicate.mjs), không bao giờ gọi API thật, không tốn tiền. Bài thử tự nối khóa giả rồi gỡ ra khi xong (kể cả khi lỗi), để các bộ khác vẫn thấy máy chủ chưa có khóa.
// Kiểm: chưa có khóa thì không đổi gì; kiểm tra khóa; FLUX 1.1 Pro Ultra (model chính thức, Prefer: wait, Cancel-After); hậu tố nhiếp ảnh chỉ cho ảnh sản phẩm;
// IC-Light theo version với tên tham số đọc từ lược đồ (đổi bản thì đổi tên); chạy lâu thì hỏi lại; lỗi thì về gói của người dùng; Dừng thì hủy lượt trên Replicate;
// hạn mức ảnh mỗi ngày; ảnh chỉ tải từ máy chủ của Replicate.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.SYNCHRO_MOCK_URL ?? process.env.MOCK_URL ?? "http://127.0.0.1:4010";
const DATA = path.resolve(process.env.DATA_DIR_MOCK ?? "data-mock"), HOME = path.join(DATA, "engine");
const SUFFIX = "editorial commercial photography, shot on Hasselblad H6D-100c, 85mm f/1.4 lens, soft volumetric studio key lighting, subtle rim light, clean minimalist podium background, natural shadows, ultra-detailed texture, 8k resolution, color graded in Capture One";
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
async function account(tag, verified = true) {
  const c = client(), email = `rep-${tag}-${Date.now().toString(36)}@synchro.test`, password = "Replicate-test-123";
  await c.api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Replicate Tester", birthDate: "2000-01-01" } });
  await c.api("POST", "/api/auth/login", { email, password });
  await c.api("POST", "/api/auth/profile", { fullName: "Replicate Tester", birthDate: "2000-01-01" });
  const uid = dbq((d) => { if (verified) d.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").run(email); return d.prepare("SELECT id FROM users WHERE email = ?").get(email)?.id; });
  return { ...c, uid, email };
}
const LOGIN = { claude: ".mock-login", agy: ".gemini/antigravity-cli/antigravity-oauth-token" };
const dirOf = (cli, uid) => path.join(HOME, "logins", cli, uid);
async function signIn(a, clis) {
  for (const cli of clis) {
    const f = path.join(dirOf(cli, a.uid), LOGIN[cli]);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, "{}");
    fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true }); fs.writeFileSync(path.join(DATA, "engine-tokens", `${cli}-${a.uid}.login`), "1");
    await a.api("GET", `/api/engines/${cli}/status?fresh=1`);
  }
}
const agyLog = (a) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf("agy", a.uid), "mock-image-log.json"), "utf8")); } catch { return []; } };
const start = (a, body) => a.api("POST", "/api/llm", { async: true, skills: true, conv: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...body });
const finish = async (a, id, ms = 90_000) => { let rn = null; for (const t0 = Date.now(); Date.now() - t0 < ms;) { rn = (await a.api("GET", `/api/runs/${id}?json=1`)).j?.run; if (rn && !["running", "queued", "pending"].includes(rn.status)) break; await sleep(250); } return { s: 200, status: rn?.status, j: rn?.result ?? {}, text: String(rn?.result?.text ?? rn?.text ?? ""), events: rn?.events ?? [] }; };
const run = async (a, body) => { const r0 = await start(a, body); return r0.j?.run ? finish(a, r0.j.run) : { s: r0.s, j: r0.j ?? {}, text: String(r0.j?.text ?? ""), events: [] }; };
const tool = (args) => `#tool=generate_image #args=${JSON.stringify(args)}`;
const imgMsg = (text, b64) => [{ role: "user", content: [{ type: "image", media_type: "image/png", data: b64, name: "san-pham.png" }, { type: "text", text }] }];
const ask = (text) => [{ role: "user", content: text }];
const isImg = (f) => f && /^image\/(jpeg|png|webp)$/.test(f.mime) && !f.skipped;
const repLog = async () => (await fetch(`${M}/replicate/_log`).then((r) => r.json())).log;
const clearLog = () => fetch(`${M}/replicate/_log`, { method: "DELETE" });
const posts = (log) => log.filter((e) => e.method === "POST" && /predictions$/.test(e.path));
// Tham số của generate_image model nhận (qua API Anthropic giả lập): product_shot / product_relight chỉ có khi máy chủ có khóa Replicate.
// Lượt nền (bộ não, bộ nhớ) của tài khoản khác có thể gửi tới cùng API giả lập ngay sau đó: chỉ đọc đúng yêu cầu mang mã của lần này.
const imgProps = async () => {
  for (let i = 0; i < 4; i++) {
    const nonce = `img-props-${Date.now().toString(36)}-${i}`;
    await admin.api("POST", "/api/llm", { system: "", messages: ask(`Chào bạn ${nonce}`), model: "anthropic/claude-opus-5-5", skills: true });
    const L = (await fetch(`${M}/_debug/last`).then((r) => r.json())).anthropic;
    if (!JSON.stringify(L?.messages ?? []).includes(nonce)) { await sleep(1500); continue; }
    const t = (L.tools ?? []).find((x) => x.name === "generate_image");
    return t ? Object.keys(t.input_schema?.properties ?? {}) : null;
  }
  return null;
};
const productProps = (k) => !!k && k.includes("product_shot") && k.includes("product_relight");
const res0 = (r) => r.events.filter((e) => e.kind === "res").map((e) => e.text).join("\n");

// PNG nhỏ thật (ảnh sản phẩm người dùng gửi) và PNG ~900 KB (phải đi qua Files API).
const zlib = await import("node:zlib");
function png(w, h, noise = false) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h); for (let i = 0; i < rows.length; i++) rows[i] = noise ? (i * 2654435761) >>> 24 : 120; for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}
const SMALL = png(48, 48).toString("base64"), LARGE = png(560, 560, true).toString("base64");

const admin = client();
await admin.api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
if (!admin.cookie()) { console.error("Không đăng nhập được quản trị viên trên", B); process.exit(1); }
const removeKey = () => admin.api("DELETE", "/api/admin/apikeys?id=replicate");
await removeKey();
const budget0 = (await admin.api("GET", "/api/admin")).j?.settings?.replicateBudget;

try {
  console.log("1. Chưa có khóa: không đổi gì, giao diện nói đang chờ khóa");
  const A = await account("a");
  await signIn(A, ["claude", "agy"]);
  {
    const st = await admin.api("GET", "/api/admin/apikeys");
    const p = st.j?.providers?.find((x) => x.id === "replicate");
    ok(p && p.configured === false && p.source !== "env" && p.kind === "replicate" && p.prefix === "r8_" && p.keyUrl === "https://replicate.com/account/api-tokens", "Providers có thẻ Replicate chưa nối (không lấy REPLICATE_API_TOKEN thật từ shell: dev:mock xóa biến này)", p);
    ok(!st.j.catalog.some((c) => c.id === "replicate"), "Replicate không xuất hiện trong bộ chọn model chat");
    const ad = (await admin.api("GET", "/api/admin")).j?.settings;
    ok(ad?.replicateKey === false && ad?.replicateBudget?.user === 10 && ad?.replicateBudget?.global === 100, "Quản trị viên: hạn mức mặc định, cờ chờ khóa", ad);
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "ly cà phê", product_shot: true })}`) });
    ok(isImg(r.j.files?.[0]) && /Antigravity/.test(res0(r)) && !(await repLog()).length, "tạo ảnh vẫn đi qua gói Antigravity, không gọi Replicate", { res: res0(r), log: await repLog() });
    const k = await imgProps();
    ok(k && k.includes("reference") && !k.includes("product_shot") && !k.includes("product_relight"), "chưa có khóa: generate_image không có product_shot / product_relight", k);
  }

  console.log("2. Nối khóa: kiểm tra với Replicate, đọc lược đồ hai model");
  {
    const bad = await admin.api("POST", "/api/admin/apikeys", { id: "replicate", key: "r8_sai_khoa", baseUrl: `${M}/replicate/v1` });
    ok(bad.s === 400 && /không hợp lệ|401/.test(bad.j?.error ?? ""), "khóa sai bị từ chối, không lưu", bad.j?.error);
    await clearLog();
    const good = await admin.api("POST", "/api/admin/apikeys", { id: "replicate", key: "r8_mock_replicate_0001", baseUrl: `${M}/replicate/v1` });
    const p = good.j?.providers?.find((x) => x.id === "replicate");
    ok(good.s === 200 && p?.configured && p.info === "mock-owner" && p.status === "ok", "khóa đúng: đã nối, hiện tên tài khoản", good.j?.error ?? p);
    const log = await repLog();
    ok(log.some((e) => e.path === "/replicate/v1/account" && e.bearer) && log.some((e) => e.path.endsWith("/models/black-forest-labs/flux-1.1-pro-ultra")) && log.some((e) => e.path.endsWith("/models/zsxkib/ic-light")), "GET /account và lược đồ FLUX, IC-Light", log.map((e) => e.path));
    ok(!good.j.catalog.some((c) => c.id === "replicate"), "vẫn không có model chat nào từ Replicate");
    const ad = (await admin.api("GET", "/api/admin")).j?.settings;
    ok(ad?.replicateKey === true, "Quản trị viên: hết chờ khóa");
    const k = await imgProps(), k2 = await imgProps();
    ok(productProps(k) && JSON.stringify(k) === JSON.stringify(k2), "có khóa: generate_image có product_shot, product_relight (giống nhau giữa các lượt)", k);
    const raw = JSON.stringify(dbq((d) => d.prepare("SELECT enc_key, key_hint FROM api_providers WHERE id = 'replicate'").get()));
    ok(!raw.includes("r8_mock_replicate_0001") && /r8_moc…0001/.test(raw), "khóa lưu đã mã hóa, chỉ hiện dạng che", raw.slice(0, 120));
  }

  console.log("3. FLUX 1.1 Pro Ultra: ảnh mới từ chữ");
  {
    await clearLog();
    const n0 = agyLog(A).length;
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "con mèo cam đội mũ len", aspect_ratio: "16:9" })}`) });
    const f = r.j.files?.[0], log = await repLog(), p = posts(log)[0];
    ok(isImg(f) && f.mime === "image/png" && /Đã tạo 1 ảnh bằng Replicate/.test(res0(r)), "có ảnh, kết quả công cụ nói Replicate", res0(r));
    ok(agyLog(A).length === n0, "không chạy gói Antigravity khi Replicate tạo được");
    ok(p?.path === "/replicate/v1/models/black-forest-labs/flux-1.1-pro-ultra/predictions" && p.prefer === "wait=60" && p.cancelAfter === "5m" && p.bearer, "model chính thức: POST /models/…/predictions, Prefer: wait=60, Cancel-After", p);
    ok(p?.body?.input?.prompt === "con mèo cam đội mũ len" && p.body.input.aspect_ratio === "16:9" && p.body.input.output_format === "jpg", "ảnh thường: không nối hậu tố nhiếp ảnh; tỉ lệ, định dạng đúng lược đồ", p?.body?.input);
    ok(log.some((e) => e.path.startsWith("/replicate/delivery/") && e.bearer), "tải ảnh kết quả ngay, kèm khóa");
    ok(r.events.some((e) => e.kind === "step" && /^Đang tạo ảnh bằng Replicate/.test(e.text)), "trạng thái: đang tạo bằng Replicate", r.events.map((e) => e.text));
    const dl = await fetch(`${B}/api/outputs/${f?.id}`, { headers: { cookie: A.cookie() } });
    const b = Buffer.from(await dl.arrayBuffer());
    ok(dl.ok && b[0] === 0x89 && b[1] === 0x50, "ảnh thành tệp của người dùng, tải về được");
  }
  {
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "chai serum thủy tinh màu hổ phách.", product_shot: true, count: 2 })}`) });
    const ps = posts(await repLog());
    ok(r.j.files?.length === 2 && ps.length === 2, "2 ảnh: hai lượt FLUX (mỗi lượt một ảnh)", { files: r.j.files?.length, posts: ps.length });
    ok(ps.every((p) => p.body.input.prompt === `chai serum thủy tinh màu hổ phách, ${SUFFIX}`), "ảnh sản phẩm: nối đúng nguyên văn hậu tố của chủ dự án", ps[0]?.body?.input?.prompt);
  }

  console.log("4. IC-Light: đặt ảnh sản phẩm vào studio");
  {
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: imgMsg(`Đưa sản phẩm này vào studio ${tool({ prompt: "lọ nước hoa trên bục đá cẩm thạch", reference: "last", product_relight: true, aspect_ratio: "3:4" })}`, SMALL) });
    const p = posts(await repLog())[0];
    ok(isImg(r.j.files?.[0]) && /IC-Light/.test(res0(r)), "có ảnh, ghi chú IC-Light", res0(r));
    ok(p?.path === "/replicate/v1/predictions" && /^644802f7/.test(p.body?.version ?? ""), "model cộng đồng: POST /predictions với version từ lược đồ", p?.path);
    ok(/^data:image\/png;base64,/.test(p?.body?.input?.subject_image ?? "") && p.body.input.light_source === "Left Light", "ảnh gốc nhỏ gửi dạng data: URI, ánh sáng studio lấy đúng giá trị enum", Object.keys(p?.body?.input ?? {}));
    ok(p?.body?.input?.prompt === `lọ nước hoa trên bục đá cẩm thạch, ${SUFFIX}` && p.body.input.width === 576 && p.body.input.height === 768, "prompt có hậu tố; 3:4 → 576×768", { w: p?.body?.input?.width, h: p?.body?.input?.height });
  }
  {
    // Bản mới của ic-light đổi tên tham số: làm mới khóa (đọc lại lược đồ) thì Synchro dùng đúng tên mới.
    await fetch(`${M}/replicate/_cfg`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ icLight: "v2" }) });
    const rf = await admin.api("POST", "/api/admin/apikeys", { action: "refresh", id: "replicate" });
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: imgMsg(`Studio ${tool({ prompt: "đồng hồ", reference: "last", product_relight: true })}`, LARGE) });
    const log = await repLog(), p = posts(log)[0];
    ok(rf.s === 200 && isImg(r.j.files?.[0]) && /^58734c46/.test(p?.body?.version ?? "") && p.body.input.input_fg && p.body.input.bg_source === "Left Light" && !("subject_image" in p.body.input), "lược đồ đổi (input_fg, bg_source): tên tham số theo bản mới", p?.body?.input && Object.keys(p.body.input));
    ok(log.some((e) => e.method === "POST" && e.path === "/replicate/v1/files") && /\/replicate\/v1\/files\/file/.test(p?.body?.input?.input_fg ?? "") && log.some((e) => e.method === "DELETE" && e.path.startsWith("/replicate/v1/files/")), "ảnh gốc lớn: tải lên Files API, xóa ngay sau lượt chạy", log.map((e) => `${e.method} ${e.path}`));
    await fetch(`${M}/replicate/_cfg`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ icLight: "v1" }) });
    await admin.api("POST", "/api/admin/apikeys", { action: "refresh", id: "replicate" });
  }

  {
    // Sửa ảnh có sẵn (có ảnh gốc, không phải đặt sản phẩm vào studio): FLUX chỉ tạo ảnh mới nên không đi qua Replicate, về Antigravity như trước.
    await clearLog();
    const n0 = agyLog(A).length;
    const r = await run(A, { model: "sub-claude/haiku", messages: imgMsg(`Đổi nền ảnh này thành màu xanh ${tool({ prompt: "đổi nền thành màu xanh, giữ nguyên sản phẩm", reference: "last" })}`, SMALL) });
    const log = await repLog();
    ok(isImg(r.j.files?.[0]) && agyLog(A).length === n0 + 1 && /Antigravity/.test(res0(r)), "sửa ảnh: Antigravity làm, kết quả nói đúng gói", res0(r));
    ok(!posts(log).length && !log.some((e) => /flux-1\.1-pro-ultra\/predictions/.test(e.path)), "sửa ảnh không gọi FLUX trên Replicate", log.map((e) => `${e.method} ${e.path}`));
  }

  console.log("5. Chạy lâu, lỗi, Dừng");
  {
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "phong cảnh #slowrep" })}`) });
    const log = await repLog();
    ok(isImg(r.j.files?.[0]) && log.filter((e) => e.method === "GET" && /\/predictions\/mock/.test(e.path)).length >= 2, "chưa xong trong lượt chờ: hỏi lại urls.get tới khi xong", log.map((e) => `${e.method} ${e.path}`));
  }
  {
    await clearLog();
    const n0 = agyLog(A).length;
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "lỗi #failrep" })}`) });
    ok(isImg(r.j.files?.[0]) && agyLog(A).length === n0 + 1 && /Antigravity/.test(res0(r)), "Replicate lỗi: chuyển sang gói Antigravity của người dùng", res0(r));
    ok(r.events.some((e) => e.kind === "note" && /Replicate: .*CUDA out of memory/.test(e.text) && /Đang thử Antigravity/.test(e.text)), "ghi chú nói lý do và gói kế tiếp", r.events.filter((e) => e.kind === "note").map((e) => e.text));
  }
  {
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "hết tiền #402rep" })}`) });
    ok(isImg(r.j.files?.[0]) && /Antigravity/.test(res0(r)) && r.events.some((e) => e.kind === "note" && /khóa Replicate của máy chủ chưa dùng được/.test(e.text)), "402 hết số dư: về gói của người dùng, nói rõ", { files: r.j.files?.length, res: res0(r), st: r.status, notes: r.events.filter((e) => e.kind === "note").map((e) => e.text) });
  }
  {
    await clearLog();
    const r0 = await start(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "treo #hangrep" })}`) });
    for (let i = 0; i < 100 && !posts(await repLog()).length; i++) await sleep(100);
    await sleep(600);
    const c = await A.api("DELETE", `/api/runs/${r0.j.run}`);
    const r = await finish(A, r0.j.run, 30_000);
    await sleep(800);
    const log = await repLog();
    ok(c.s === 200 && r.status !== "running" && !r.j.files?.length, "bấm Dừng: lượt dừng, không có ảnh", { c: c.s, st: r.status });
    ok(log.some((e) => e.method === "POST" && /\/predictions\/mock\w+\/cancel$/.test(e.path)), "lượt trên Replicate bị hủy (không tính tiền tiếp)", log.map((e) => `${e.method} ${e.path}`));
  }
  // Bấm Dừng không phải cách tạo ảnh Replicate miễn phí: lượt đã gửi sang Replicate (kể cả khi Synchro chưa nhận được mã lượt chạy, Replicate vẫn chạy và tính tiền)
  // vẫn tính vào hạn mức ảnh trong ngày; lượt Replicate báo lỗi thì không tính.
  {
    const U = await account("stop");
    await signIn(U, ["claude", "agy"]);
    const imgs = () => dbq((d) => d.prepare("SELECT COALESCE(SUM(images), 0) AS n FROM replicate_budget WHERE user_id = ?").get(U.uid))?.n ?? 0;
    const stopAt = async (prompt) => {
      await clearLog();
      const r0 = await start(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt })}`) });
      for (let i = 0; i < 100 && !posts(await repLog()).length; i++) await sleep(100);
      await sleep(600);
      await U.api("DELETE", `/api/runs/${r0.j.run}`);
      return finish(U, r0.j.run, 30_000);
    };
    const n0 = imgs();
    const r1 = await stopAt("chờ lâu #waitrep");
    ok(r1.status !== "running" && !r1.j.files?.length && imgs() === n0 + 1, "Dừng khi Replicate còn giữ yêu cầu tạo: ảnh vẫn tính vào hạn mức", { st: r1.status, before: n0, after: imgs() });
    const r2 = await stopAt("treo #hangrep");
    ok(r2.status !== "running" && imgs() === n0 + 2, "Dừng khi đang chạy trên Replicate: ảnh vẫn tính vào hạn mức", { before: n0, after: imgs() });
    await clearLog();
    await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "lỗi #failrep" })}`) });
    ok(imgs() === n0 + 2, "Replicate báo lỗi (failed): không tính vào hạn mức", { before: n0, after: imgs() });
  }

  console.log("6. Hạn mức ảnh mỗi ngày");
  {
    await admin.api("PATCH", "/api/admin/settings", { replicateBudget: { user: 1, unverified: 0 } });
    const U = await account("cap"), V = await account("unv", false);
    await signIn(U, ["claude", "agy"]); await signIn(V, ["claude", "agy"]);
    await clearLog();
    const r1 = await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "một", count: 2 })}`) });
    ok(r1.j.files?.length === 1 && posts(await repLog()).length === 1 && r1.j.trace?.some((t) => /chỉ còn 1 ảnh/.test(t.summary ?? "")), "còn 1 ảnh mà xin 2: Replicate tạo 1, nói rõ với model", r1.j.trace);
    await clearLog();
    const r2 = await run(U, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "hai" })}`) });
    ok(isImg(r2.j.files?.[0]) && !posts(await repLog()).length && /Antigravity/.test(res0(r2)), "hết hạn mức: dùng gói của người đó, không gọi Replicate", res0(r2));
    const r3 = await run(V, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "ba" })}`) });
    ok(/Antigravity/.test(res0(r3)) && !posts(await repLog()).length, "tài khoản chưa xác minh email (hạn mức 0): không dùng Replicate", res0(r3));
    const ad = (await admin.api("GET", "/api/admin")).j?.settings;
    ok(ad?.replicateToday?.images >= 5 && ad.replicateToday.usd > 0, "Quản trị viên thấy số ảnh và tiền ước tính hôm nay", ad?.replicateToday);
    ok((await admin.api("GET", "/api/admin")).j?.audit?.some((e) => e.action === "admin_replicate_budget"), "đổi hạn mức có trong nhật ký quản trị");
    // Nhiều lượt cùng lúc của cùng tài khoản: hạn mức giữ chỗ trước khi gọi, không lượt nào thấy hạn mức còn nguyên rồi cùng vượt.
    await admin.api("PATCH", "/api/admin/settings", { replicateBudget: { user: 2 } });
    const Z = await account("race");
    await signIn(Z, ["claude", "agy"]);
    await clearLog();
    const rs = await Promise.all([1, 2, 3].map((i) => run(Z, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: `song song ${i} #slowrep`, count: 2 })}`) })));
    const rp = posts(await repLog()).length, viaRep = rs.filter((r) => /Replicate/.test(res0(r))).reduce((n, r) => n + (r.j.files?.length ?? 0), 0);
    const zt = dbq((d) => d.prepare("SELECT images FROM replicate_budget WHERE user_id = ? ORDER BY day DESC").get(Z.uid))?.images;
    ok(rp <= 2 && viaRep <= 2 && zt === rp && rs.every((r) => r.j.files?.length), "3 lượt song song xin 2 ảnh mỗi lượt, hạn mức 2: Replicate tạo tối đa 2, phần còn lại về gói của người đó, sổ hạn mức khớp", { posts: rp, viaRep, zt, res: rs.map(res0) });
    const W = await account("none");
    await signIn(W, ["claude"]);
    await admin.api("PATCH", "/api/admin/settings", { replicateBudget: { user: 0 } });
    const r4 = await run(W, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "bốn" })}`) });
    ok(!r4.j.files?.length && r4.j.trace?.some((t) => /hết số ảnh Replicate/.test(t.summary ?? "")), "không gói nào, hết hạn mức Replicate: báo đúng lý do", r4.j.trace);
  }

  console.log("7. Gỡ khóa: trở lại như cũ");
  {
    const d = await removeKey();
    ok(d.s === 200 && !d.j.providers.find((x) => x.id === "replicate").configured, "gỡ khóa được");
    await clearLog();
    const r = await run(A, { model: "sub-claude/haiku", messages: ask(`Tạo ảnh ${tool({ prompt: "sau khi gỡ" })}`) });
    ok(/Antigravity/.test(res0(r)) && !(await repLog()).length, "không còn gọi Replicate", res0(r));
    const k = await imgProps();
    ok(k && !productProps(k) && !k.includes("product_shot"), "gỡ khóa: generate_image bỏ product_shot / product_relight", k);
  }
} finally {
  await removeKey();
  if (budget0) await admin.api("PATCH", "/api/admin/settings", { replicateBudget: budget0 });
  await fetch(`${M}/replicate/_cfg`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ icLight: "v1" }) }).catch(() => {});
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
