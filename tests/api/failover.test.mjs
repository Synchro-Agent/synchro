// Một hãng sập (máy chủ giả trả 529 rồi 503 cho mọi lời gọi tới Anthropic): chế độ Tự động chuyển sang hãng khác đã kết nối ngay trong lượt,
// người dùng thấy lời báo (dòng tiến trình, lời báo dưới câu trả lời và trên thanh thông báo); chọn tay model của Anthropic thì không tự đổi
// sau lưng: thẻ lỗi kèm gợi ý "Dùng model khác". Chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL, SYNCHRO_MOCK_URL).
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.SYNCHRO_MOCK_URL ?? "http://127.0.0.1:4010";
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
const outage = (provider, codes) => fetch(`${M}/_debug/outage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, codes }) }).then((r) => r.json());
// Số lời gọi tới từng hãng: bộ đếm không giới hạn của máy giả (/_debug/calls). Không đếm bằng độ dài /_debug/hist: lịch sử chỉ giữ 200
// lời gọi gần nhất, chạy sau nhiều bộ kiểm khác thì đã đầy, gọi thêm bao nhiêu độ dài vẫn là 200.
const hist = () => fetch(`${M}/_debug/calls`).then((r) => r.json());
const served = async () => (await fetch(`${M}/_debug/outage`).then((x) => x.json())).anthropic?.served ?? {};
const shownBefore = (await call("GET", "/api/admin/apikeys")).j?.main ?? ["*"];
await call("POST", "/api/admin/apikeys", { action: "main", main: ["*"] });
const CODE = "Viết code Python đọc file CSV và in tổng từng cột";
const ask = (model, text = CODE, extra = {}) => call("POST", "/api/llm", { system: "", model, skills: true, messages: [{ role: "user", content: text }], ...extra });
async function runAsync(model) {
  const r = await ask(model, CODE, { async: true });
  if (r.s !== 200 || !r.j?.run) return { start: r };
  let run;
  for (let i = 0; i < 300; i++) { run = (await call("GET", `/api/runs/${r.j.run}?json=1`)).j?.run; if (run && run.status !== "running") break; await sleep(200); }
  return { run };
}
try {
  console.log("0. Bình thường: Tự động chọn Claude cho việc viết code");
  let r = await ask("auto");
  ok(r.s === 200 && r.j.auto?.vendor === "anthropic" && r.j.model.startsWith("anthropic/") && !r.j.switched, `Tự động chọn ${r.j?.model}`, r.j);
  const anthropicModel = r.j.model;

  // Mỗi lượt Tự động chỉ gọi Anthropic một lần rồi chuyển sang hãng khác (dự phòng ưu tiên hãng khác, không gọi lại hãng đang quá tải),
  // nên lượt chạy thẳng gặp 529, lượt chạy nền gặp 503: mỗi mã lỗi được kiểm bằng một lượt riêng.
  console.log("1. Anthropic sập (529, 503): Tự động chuyển hãng trong cùng lượt");
  await outage("anthropic", [529]);
  const h0 = await hist();
  r = await ask("auto");
  const h1 = await hist();
  const s529 = await served();
  ok(r.s === 200 && !r.j.model.startsWith("anthropic/") && r.j.text, `vẫn có câu trả lời, bằng ${r.j?.model}`, r.j);
  ok(r.j.auto?.fallback === r.j.model && r.j.auto?.vendor === "anthropic", "ghi rõ đã chuyển khỏi model định chọn", r.j?.auto);
  ok((h1.anthropic ?? 0) > (h0.anthropic ?? 0), "đã thử Anthropic trước rồi mới chuyển", { h0, h1 });
  ok(typeof r.j.switched === "string" && /đang gặp lỗi, nên Synchro đã trả lời bằng/.test(r.j.switched) && r.j.notice === r.j.switched, "người dùng được báo: lời báo dưới câu trả lời và trên thanh thông báo", { switched: r.j.switched, notice: r.j.notice });
  await outage("anthropic", [503]);
  r = await runAsync("auto");
  const notes = (r.run?.events ?? []).filter((e) => e.kind === "note").map((e) => e.text);
  ok(r.run?.status === "done" && !r.run.result?.model?.startsWith("anthropic/") && r.run.result?.switched, "lượt chạy nền (như trên trang): xong bằng hãng khác", r.run ?? r.start);
  ok(notes.some((t) => /đang gặp lỗi, chuyển sang/.test(t)), "dòng tiến trình lúc đang chạy: “… đang gặp lỗi, chuyển sang …”", notes);
  const s503 = await served();
  ok(s529["529"] >= 1 && s503["503"] >= 1, "máy giả đã thật sự trả cả 529 lẫn 503", { s529, s503 });

  console.log("2. Chọn tay model của Anthropic: không tự đổi, thẻ lỗi có nút Dùng model khác");
  const h2 = await hist();
  r = await ask(anthropicModel);
  const h3 = await hist();
  ok(r.s >= 500 && !r.j.text && r.j.error, `báo lỗi (${r.s}), không trả lời bằng model khác`, r.j);
  ok(Object.keys(h3).filter((k) => k !== "anthropic").every((k) => (h3[k] ?? 0) === (h2[k] ?? 0)), "không gọi hãng nào khác sau lưng người dùng", { h2, h3 });
  ok(r.j.switchTo?.model && !r.j.switchTo.model.startsWith("anthropic/") && r.j.switchTo.name, `gợi ý sẵn model khác để bấm: ${r.j.switchTo?.name}`, r.j);
  ok(!r.j.auto && !r.j.switched, "không có dấu hiệu tự chuyển");
  r = await runAsync(anthropicModel);
  ok(r.run?.status === "error" && r.run.result?.switchTo?.model && !r.run.result?.text, "lượt chạy nền chọn tay: lỗi kèm gợi ý, không tự đổi", r.run);
  r = await ask(r.run?.result?.switchTo?.model ?? "openai/x");
  ok(r.s === 200 && r.j.text, "bấm “Dùng model khác”: lượt mới chạy được bằng model gợi ý", r.j);

  console.log("3. Anthropic hoạt động lại");
  await outage("anthropic", []);
  r = await ask("auto");
  ok(r.s === 200 && r.j.model.startsWith("anthropic/") && !r.j.switched, "Tự động quay lại Claude, không còn lời báo", r.j);
} finally {
  await outage("anthropic", []).catch(() => {});
  await call("POST", "/api/admin/apikeys", { action: "main", main: shownBefore });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
