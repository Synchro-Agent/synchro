// Mười lượt sửa bộ slide liên tiếp qua cả đường chạy thật của máy chủ (lượt bền /api/llm, 3 hãng giả lập): bản sửa
// mode="patch" viết lệch mẫu như model thật (CRLF, thụt lề, số dòng của read_artifact, dấu kiểu Cline, thiếu dòng
// đóng, dòng trống, một khối chép sai chữ) đều áp được; khối chép sai được Synchro báo lại, model gửi lại đúng khối đó
// và câu trả lời chỉ có một bản sửa áp trọn. Không lượt nào phải viết lại cả tệp.
// Chạy trên npm run dev:mock (web 3200, LLM giả 4010).
import { loadTs } from "../lib/ts.mjs";

const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700));
};
const { vfs: V } = await loadTs(["vfs"]);
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const headers = { "content-type": "application/json", origin: B, cookie };
  const r = await fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  // Trả lời không phải JSON (trang lỗi của Next): bài kiểm báo qua mã trạng thái, không cần nội dung.
  const j = await r.json().catch(() => null);
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });

async function follow(run) {
  const r = await fetch(`${B}/api/runs/${run}`, { headers: { cookie } });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(raw)?.[1], data = /^data: (.*)$/m.exec(raw)?.[1];
      if (ev === "done" && data) {
        // Đã có kết quả; luồng đóng lỗi lúc hủy không ảnh hưởng bài kiểm.
        reader.cancel().catch(() => {});
        return JSON.parse(data);
      }
    }
  }
}

const slide = (n, title) => `  <section class="slide">
    <p class="k">0${n} · Mục ${n}</p>
    <h2>${title}</h2>
    <div class="foot"><span>Sương Sớm</span><span>0${n} / 06</span></div>
  </section>`;
const TITLES = ["Trà shan tuyết", "Khách khó mua trà", "Truy xuất từng búp", "4,2 tỷ năm đầu", "Thị trường", "Gọi vốn"];
const DECK = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Sương Sớm — gọi vốn</title>
  <style>.slide{width:100vw;height:100vh;padding:64px;box-sizing:border-box}</style>
</head>
<body>
${TITLES.map((t, i) => slide(i + 1, t)).join("\n")}
</body>
</html>`;

const OPEN = '<artifact identifier="suong-som" type="text/html" title="Sương Sớm">';
const capsBefore = (await api("GET", "/api/caps")).j?.caps;
await api("PATCH", "/api/caps", { art: true, inl: true });
const MODELS = ["anthropic/claude-sonnet-5-5", "openai/gpt-5.1", "google/gemini-3.6-flash"];
const hist = [
  { role: "user", content: "Tạo bộ slide gọi vốn 6 trang cho trà Sương Sớm" },
  { role: "assistant", content: `Đây là bộ slide:\n\n${OPEN}\n${DECK}\n</artifact>` },
];
console.log("1. Mười lượt sửa liên tiếp, mỗi lượt một kiểu bản sửa lệch mẫu");
let applied = 0, rewrites = 0, slow = 0;
for (let n = 1; n <= 10; n++) {
  hist.push({ role: "user", content: `#messy ${n}` });
  const t0 = Date.now();
  const body = { model: MODELS[n % 3], system: "", max_tokens: 1500, skills: true, async: true, messages: hist };
  const run = (await api("POST", "/api/llm", body)).j?.run;
  const done = run ? await follow(run) : null;
  const text = String(done?.result?.text ?? "");
  hist.push({ role: "assistant", content: text });
  if (Date.now() - t0 > 60_000) slow++;
  const st = V.artState(hist.filter((m) => m.role === "assistant").map((m) => m.content)).get("suong-som");
  const fullAgain = /<artifact\b(?![^>]*mode="patch")[^>]*identifier="suong-som"/.test(text);
  if (fullAgain) rewrites++;
  const good = done?.http === 200 && !fullAgain && st?.fix && !st.fix.failed.length
    && st.content.includes(`<!-- messy ${n} -->`) && st.content.includes(`<meta name="messy" content="${n}">`);
  if (good) applied++;
  const why = `${done?.http} ${JSON.stringify(st?.fix)} ${text.slice(0, 400)}`;
  ok(good, `lượt ${n} (kiểu ${n % 8}, ${MODELS[n % 3].split("/")[0]}): bản sửa áp trọn, phiên bản ${st?.v}`, why);
}
ok(applied === 10 && rewrites === 0, `10/10 lượt áp được, 0 lượt viết lại cả tệp (${applied}/10, ${rewrites})`);
ok(slow === 0, "không lượt nào quá 60 giây trên máy giả lập");
const last = V.artState(hist.filter((m) => m.role === "assistant").map((m) => m.content)).get("suong-som");
const metas = (last.content.match(/<meta name="messy"/g) ?? []).length;
ok(last.v === 11 && metas === 10, "bản cuối: phiên bản 11, đủ 10 thay đổi, không cái nào áp hai lần", `${last.v}`);
await api("PATCH", "/api/caps", capsBefore ?? {});

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
