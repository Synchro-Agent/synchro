// Lượt chạy bền: tạo lượt nền, theo dõi SSE, nối lại từ giữa, kết quả giữ nguyên sau khi tải lại.
// MODE=start: chỉ tạo một lượt chậm (#slow) rồi in id (để tắt máy chủ giữa chừng). MODE=check RUN=<id>: chờ lượt đó xong.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
let cookie = "";
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b && JSON.stringify(b) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
await call("POST", "/api/auth/signup", { email: "dl-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Download Tester", birthDate: "2000-01-01" } });
await call("POST", "/api/auth/login", { email: "dl-member@synchro.test", password: "Member-pass-123" });
const MODEL = "anthropic/claude-haiku-5-5";
const ask = (text) => call("POST", "/api/llm", { async: true, skills: true, system: "", model: MODEL, messages: [{ role: "user", content: text }], conv: "runtest" });
// Đọc SSE tới khi có "done" (hoặc hết giờ); trả về các bước và kết quả.
async function sse(id, after = 0, ms = 60000) {
  const r = await fetch(`${B}/api/runs/${id}${after ? `?after=${after}` : ""}`, { headers: { cookie } });
  const rd = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", steps = [], done = null, timedOut = false, clocks = [];
  const t = setTimeout(() => { timedOut = true; rd.cancel().catch(() => {}); }, ms);
  while (!done && !timedOut) {
    const { value, done: end } = await rd.read().catch(() => ({ done: true }));
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (\w+)/m.exec(blk)?.[1], data = /^data: (.*)$/m.exec(blk)?.[1];
      if (ev === "step") steps.push(JSON.parse(data)); if (ev === "done") done = JSON.parse(data); if (ev === "clock") clocks.push(JSON.parse(data).now);
    }
  }
  clearTimeout(t); rd.cancel().catch(() => {});
  return { steps, done, clocks, ctype: r.headers.get("content-type") };
}
const MODE = process.env.MODE ?? "all";
if (MODE === "start") { const r = await ask("Kể ngắn về lịch sử cà phê #slow"); console.log(r.j.run); process.exit(0); }
if (MODE === "check") {
  const id = process.env.RUN;
  const { done, steps } = await sse(id, 0, 120000);
  ok(done?.status === "done" && (done.result?.text ?? "").length > 20, `lượt bị gián đoạn khi máy chủ khởi động lại đã tự chạy lại và xong: ${done?.status}`, JSON.stringify(done).slice(0, 300));
  ok(steps.some((s) => /khởi động lại/.test(s.text)), "có ghi chú máy chủ vừa khởi động lại trong các bước", JSON.stringify(steps));
  console.log(`${pass}/${pass + fail} đạt`); process.exit(fail ? 1 : 0);
}
console.log("1. Tạo lượt nền và theo dõi");
let r = await ask("Làm trang web cho quán cà phê");
ok(r.s === 200 && /^run_/.test(r.j?.run ?? ""), "POST /api/llm (async) trả ngay mã lượt: " + r.j?.run, JSON.stringify(r));
const id = r.j.run;
const a = await sse(id);
ok(/text\/event-stream/.test(a.ctype ?? ""), "theo dõi bằng SSE");
ok(a.steps.some((s) => /Đang (đọc skill|mở thư viện)/.test(s.text)), "các bước hiện ra trong lúc chạy: " + a.steps.map((s) => s.text).join(" → "), JSON.stringify(a.steps));
ok(a.done?.status === "done" && /landing-cafe/.test(a.done.result?.text ?? "") && Array.isArray(a.done.result?.libs), "kết quả cuối đủ như /api/llm (văn bản, artifact, thư viện)", JSON.stringify(a.done).slice(0, 300));
console.log("2. Nối lại sau khi rớt kết nối / tải lại trang");
const b = await sse(id, 1);
ok(b.steps.every((s) => s.seq > 1) && b.steps.length === a.steps.length - 1, `nối lại từ bước 2: nhận ${b.steps.length}/${a.steps.length} bước, không lặp`, JSON.stringify(b.steps));
ok(b.done?.result?.text === a.done.result.text, "mở lại lượt đã xong vẫn nhận nguyên kết quả");
const j = await call("GET", `/api/runs/${id}?json=1`);
ok(j.j?.run?.status === "done", "trạng thái dạng JSON (dự phòng khi không mở được SSE)");
// Giờ máy chủ cho đồng hồ công cụ / đếm ngược ở trình duyệt (ui/clock.ts): đồng hồ máy người dùng lệch không làm sai số giây.
ok(typeof b.clocks[0] === "number" && Math.abs(b.clocks[0] - Date.now()) < 10_000 && typeof j.j?.now === "number" && Math.abs(j.j.now - Date.now()) < 10_000, "luồng SSE và trạng thái JSON kèm giờ máy chủ", JSON.stringify({ clocks: b.clocks, now: j.j?.now }));
console.log("3. Bảo mật và danh sách");
const other = await fetch(`${B}/api/runs/${id}?json=1`);
ok(other.status === 401, "không đăng nhập thì không xem được lượt");
ok((await call("GET", "/api/runs/run_khong_ton_tai?json=1")).s === 404, "mã lượt sai → 404");
const list = await call("GET", "/api/runs");
ok(list.j?.runs?.some((x) => x.id === id), "danh sách lượt gần đây có lượt vừa chạy");
console.log("4. Đang chạy: lượt chậm vẫn trả bước trước khi xong");
r = await ask("Kể ngắn về lịch sử cà phê #slow");
const c = await sse(r.j.run, 0, 1500);
ok(!c.done, "lượt chậm chưa xong sau 1,5 giây (đang chạy ở nền, không giữ kết nối)");
const c2 = await sse(r.j.run, 0, 60000);
ok(c2.done?.status === "done", "mở lại sau đó thì nhận được kết quả");
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
