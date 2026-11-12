// Lõi hội thoại (Giai đoạn 1): truyền chữ theo thời gian thực, nút Dừng hủy lượt ở máy chủ, chuẩn lịch sử của Synchro
// (đổi qua lại 3 hãng giữa chừng có gọi công cụ và sửa artifact 10 lần mà không lỗi 400, prompt không quá 15k token),
// kết quả công cụ lớn lưu theo tham chiếu (read_ref), bản sửa artifact SEARCH/REPLACE và bước tự vá khi SEARCH không khớp.
// Chạy trên npm run dev:mock (web 3200, LLM giả 4010, MCP giả 4011).
const B = "http://localhost:3200", LLM = "http://127.0.0.1:4010", MCP = "http://127.0.0.1:4011";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
// Bộ kiểm thử gọi model nhiều lần: xóa mức dùng cũ của tài khoản thử nghiệm để không chạm hạn mức.
{ const { createRequire } = await import("node:module"); const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run("admin@synchro.test"); db.close(); }

// Theo dõi một lượt qua SSE: gom chữ đang viết (delta), bước, kết quả cuối.
async function follow(run, onDelta) {
  const r = await fetch(`${B}/api/runs/${run}`, { headers: { cookie } });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", step = -1, deltas = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return { deltas, text };
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(raw)?.[1], data = /^data: (.*)$/m.exec(raw)?.[1];
      if (!data) continue;
      const d = JSON.parse(data);
      if (ev === "delta" || ev === "snapshot") { if (d.s !== step || d.reset) { step = d.s; text = ""; } text += d.t ?? d.text ?? ""; deltas++; onDelta?.(text); }
      if (ev === "done") { reader.cancel().catch(() => {}); return { deltas, text, done: d }; }
    }
  }
}
const start = async (body) => { const r = await api("POST", "/api/llm", { system: "", max_tokens: 1500, skills: true, async: true, ...body }); return r.j?.run; };
const last = () => fetch(`${LLM}/_debug/last`).then((r) => r.json());
const streams = () => fetch(`${LLM}/_debug/streams`).then((r) => r.json());

// Áp bản sửa như trình duyệt (khớp nguyên văn) để kiểm tra từng phiên bản.
const PATCH = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
function applyArt(cur, text) {
  const m = /<artifact\b([^>]*)>\n?([\s\S]*?)\n?<\/artifact>/.exec(text);
  if (!m) return { cur, kind: "none" };
  if (!/mode="patch"/.test(m[1])) return { cur: m[2], kind: "full" };
  let c = cur, n = 0, bad = 0;
  for (const p of m[2].matchAll(PATCH)) { if (c.includes(p[1])) { c = c.replace(p[1], p[2]); n++; } else bad++; }
  return { cur: c, kind: "patch", n, bad };
}

console.log("0. Chuẩn bị: bật artifact, kết nối connector có dữ liệu lớn");
// Giữ cài đặt khả năng hiện có để trả lại khi xong (bộ kiểm thử khác cần chạy code bật để dùng skill).
const capsBefore = (await api("GET", "/api/caps")).j?.caps;
await api("PATCH", "/api/caps", { art: true, ai: true, inl: true, code: false });
const before = (await api("GET", "/api/connectors")).j?.connectors ?? [];
for (const x of before) if (/Cửa hàng mẫu/.test(x.name) || x.url === `${MCP}/modern`) await api("DELETE", `/api/connectors/${x.id}`);
// Kịch bản ngân sách prompt (mục 3) là một connector duy nhất. Connector bộ kiểm thử khác để lại (connectors.test thêm DeepWiki, Context7,
// Mock Notes… và chỉ dọn ở đầu bài của nó) mang thêm ~1.700 token định nghĩa công cụ: tạm tắt trong lúc chạy, bật lại khi xong.
const paused = before.filter((x) => x.enabled !== false && !(/Cửa hàng mẫu/.test(x.name) || x.url === `${MCP}/modern`)).map((x) => x.id);
for (const id of paused) await api("PATCH", `/api/connectors/${id}`, { enabled: false });
let r = await api("POST", "/api/connectors", { name: "Cửa hàng mẫu", url: `${MCP}/modern` });
ok(r.s === 200 && r.j.connector?.tools?.some((t) => t.name === "list_orders"), "connector giả lập có công cụ list_orders", JSON.stringify(r.j).slice(0, 300));
const connId = r.j.connector?.id;
// Connector tự thêm: mọi công cụ mặc định Hỏi mỗi lần (không tin readOnlyHint của máy chủ); bài kiểm thử cần công cụ đọc chạy luôn nên tự cho phép nhóm công cụ đọc.
if (connId) await api("PATCH", `/api/connectors/${connId}`, { group: { kind: "read", perm: "allow" } });

// Làm nóng đường nghe luồng chữ: bản dev biên dịch route ở lần gọi đầu (vài giây trên máy CI), lượt trả lời ngắn có thể xong trước khi kịp nghe.
await api("GET", "/api/runs/run_warmup_0000").catch(() => {});
console.log("1. Truyền chữ theo thời gian thực");
let run = await start({ model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: "xin chào, giới thiệu ngắn về bạn" }] });
let f = await follow(run);
ok(f.deltas >= 5, `nhận chữ từng đoạn qua SSE (${f.deltas} đoạn)`);
ok(f.done?.http === 200 && f.done.result.text === f.text, "chữ ghép từ các đoạn trùng khớp câu trả lời cuối", JSON.stringify({ a: f.text.slice(0, 80), b: f.done?.result?.text?.slice(0, 80) }));
for (const model of ["openai/gpt-5.1", "google/gemini-3.6-flash"]) {
  run = await start({ model, messages: [{ role: "user", content: "xin chào" }] });
  f = await follow(run);
  ok(f.deltas >= 3 && f.done?.http === 200 && f.done.result.text === f.text, `${model.split("/")[0]}: truyền chữ đúng định dạng của hãng`, JSON.stringify(f.done).slice(0, 200));
}

console.log("2. Nút Dừng hủy lượt ở máy chủ");
const s0 = await streams();
run = await start({ model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: "kể một câu chuyện dài #streamslow" }] });
let cut = "";
const t0 = Date.now();
f = await follow(run, (t) => { if (!cut && t.length > 40) { cut = t; api("DELETE", `/api/runs/${run}`); } });
ok(f.done?.http === 200 && f.done.result.cancelled === true, "lượt kết thúc ngay với cờ đã dừng", JSON.stringify(f.done).slice(0, 200));
ok(f.done?.result.text?.length >= cut.length && f.done.result.text.length < 600, `giữ phần đã viết (${f.done?.result?.text?.length} ký tự)`);
ok(Date.now() - t0 < 6000, `dừng nhanh (${Date.now() - t0} ms)`);
await sleep(400);
const s1 = await streams();
ok(s1.aborted > s0.aborted, "luồng tới nhà cung cấp bị ngắt thật (không tốn thêm token)", JSON.stringify({ s0, s1 }));
r = await api("DELETE", `/api/runs/${run}`);
ok(r.s === 200 && r.j.cancelled === false, "dừng lượt đã xong: không làm gì");

console.log("3. Đổi qua lại 3 hãng, gọi công cụ, sửa artifact 10 lần");
const MODELS = ["anthropic/claude-sonnet-5-5", "openai/gpt-5.1", "google/gemini-3.6-flash"];
const hist = [];
let cur = "", bad400 = 0, maxTok = 0, refs = [];
const turn = async (model, text) => {
  hist.push({ role: "user", content: text });
  const id = await start({ model, messages: hist });
  const res = await follow(id);
  const out = res.done?.result ?? {};
  if (res.done?.http !== 200) { bad400++; console.log("    lỗi", model, res.done?.http, JSON.stringify(out).slice(0, 300)); }
  hist.push({ role: "assistant", content: out.text ?? "", ...(out.trace ? { trace: out.trace } : {}) });
  const prov = model.split("/")[0];
  const tok = (await last())[`${prov}_tokens`] ?? 0;
  maxTok = Math.max(maxTok, tok);
  return { out, tok, prov };
};
let t = await turn(MODELS[0], "tạo trang web giới thiệu quán cà phê");
let a = applyArt(cur, t.out.text); cur = a.cur;
ok(a.kind === "full" && cur.includes("<title>"), "lượt 1: tạo artifact trang web đầy đủ");
let patches = 0, failed = 0;
for (let n = 1; n <= 10; n++) {
  const model = MODELS[n % 3];
  const withTool = n % 2 === 1;
  t = await turn(model, withTool ? `liệt kê đơn hàng rồi sửa trang #rev ${n}` : `#rev ${n}`);
  a = applyArt(cur, t.out.text);
  if (a.kind === "patch" && !a.bad) { patches++; cur = a.cur; } else failed++;
  if (withTool) refs.push(...(t.out.trace ?? []).filter((x) => x.ref).map((x) => x.ref));
}
ok(bad400 === 0, "11 lượt qua 3 hãng, không lượt nào lỗi");
ok(patches === 10 && failed === 0, `10 lần sửa đều là bản sửa SEARCH/REPLACE áp được (${patches} / 10)`);
ok(/<!-- rev 10 -->/.test(cur) && !/<!-- rev 9 -->/.test(cur), "bản cuối có đúng thay đổi của lần sửa thứ 10");
ok(maxTok > 0 && maxTok <= 15000, `prompt lớn nhất ${maxTok} token (≤ 15k) dù mỗi lượt công cụ trả ~60 KB`);
ok(refs.length >= 5, `kết quả list_orders lưu theo tham chiếu ở mỗi lượt có công cụ (${refs.length} mã ref)`);
const L = await last();
const sentG = JSON.stringify(L.google ?? {});
ok(!sentG.includes("Khách 399") && sentG.includes("<tool_activity>") && /ref_[\w-]{6,}/.test(sentG), "lịch sử gửi đi chỉ có tóm tắt công cụ kèm mã ref, không có dữ liệu thô");
ok((sentG.match(/<current_artifacts>\\n/g) ?? []).length === 1 && /version=\\"\d+\\" \/>/.test(sentG) && (sentG.match(/<!doctype html>/g) ?? []).length === 1, "artifact chỉ gửi một bản hiện tại; bản cũ thành thẻ tham chiếu");

console.log("4. read_ref đọc đúng phần cần");
const ref = refs[refs.length - 1];
hist.push({ role: "user", content: `#tool=read_ref #args={"ref":"${ref}","query":"Cần Thơ","limit":3}` });
run = await start({ model: MODELS[1], messages: hist });
f = await follow(run);
const rr = f.done?.result?.text ?? "";
ok(f.done?.http === 200 && /Cần Thơ/.test(rr) && !/Hà Nội/.test(rr.split("nhận kết quả")[1] ?? "x Hà Nội"), "model khác hãng đọc lại dữ liệu của lượt trước theo mã ref, lọc đúng", rr.slice(0, 300));
hist.pop();

console.log("5. Bản sửa không khớp: tự vá một lần");
hist.push({ role: "user", content: "#badpatch sửa nhỏ" });
run = await start({ model: MODELS[0], messages: hist });
f = await follow(run);
a = applyArt(cur, f.done?.result?.text ?? "");
ok(f.done?.http === 200 && a.kind === "full" && a.cur.includes("<!-- healed -->"), "SEARCH không khớp → Synchro nhắc model, nhận lại bản đầy đủ đúng", (f.done?.result?.text ?? "").slice(0, 200));
hist.pop();

console.log("6. Lịch sử hỏng do trình duyệt vẫn được sửa trước khi gửi");
run = await start({ model: MODELS[0], messages: [{ role: "assistant", content: "Chào bạn" }, { role: "user", content: "" }, { role: "user", content: "hai tin liên tiếp" }, { role: "user", content: "xin chào" }] });
f = await follow(run);
ok(f.done?.http === 200, "tin đầu là trợ lý, tin rỗng, nhiều tin người dùng liên tiếp: vẫn trả lời (không lỗi 400)", JSON.stringify(f.done).slice(0, 200));
const cancelledHist = [{ role: "user", content: "liệt kê đơn hàng" }, { role: "assistant", content: "Đang lấy…", trace: [{ id: "x", name: "list_orders", label: "Cửa hàng mẫu: List orders", input: "{}", status: "cancelled_by_user", summary: "Người dùng đã dừng." }] }, { role: "user", content: "xin chào" }];
for (const model of MODELS) {
  run = await start({ model, messages: cancelledHist });
  f = await follow(run);
  ok(f.done?.http === 200, `${model.split("/")[0]}: lượt trước bị dừng giữa lúc gọi công cụ không làm hỏng lượt sau`);
}

if (connId) await api("DELETE", `/api/connectors/${connId}`);
for (const id of paused) await api("PATCH", `/api/connectors/${id}`, { enabled: true });
if (capsBefore) await api("PATCH", "/api/caps", capsBefore);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
