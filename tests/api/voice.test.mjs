// Giọng nói hai luồng (Giai đoạn 3): VAD nói chen trên trình duyệt (hàm thuần), câu xác nhận và cách đọc kết quả,
// API tóm tắt để đọc to, phiên ElevenLabs Realtime có công cụ giao_viec (và tự mở phiên thường khi bị từ chối).
// Chạy trên npm run dev:mock (web 3200, LLM và ElevenLabs giả 4010).
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const B = "http://localhost:3200", LLM = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const dir = mkdtempSync(path.join(tmpdir(), "voice-"));
const load = async (f) => {
  const out = ts.transpileModule(readFileSync(`app/${f}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  writeFileSync(path.join(dir, `${f}.mjs`), out);
  return import(path.join(dir, `${f}.mjs`));
};
const { createVad } = await load("vad");
const { ackPlan, spokenPlan, localBrief, toSpeech } = await load("voiceflow");

console.log("1. VAD nói chen (mỗi khung hình 16 ms)");
// Chạy VAD qua chuỗi mức âm theo thời gian; trả về thời điểm phát hiện (ms) hoặc -1.
const run = (vad, fn, ms, out = () => 0) => { for (let t = 0; t <= ms; t += 16) if (vad.feed(fn(t), t, out(t))) return t; return -1; };
const echo = (t) => 0.1 + 0.15 * Math.abs(Math.sin(t / 37)) * Math.abs(Math.sin(t / 113)); // tiếng vọng nhấp nhô 0,10–0,25
let v = createVad();
ok(run(v, echo, 6000) === -1, "6 giây chỉ có tiếng vọng của chính Synchro: không ngắt");
v = createVad();
let at = run(v, (t) => (t < 3000 ? echo(t) : 0.55 + 0.2 * Math.abs(Math.sin(t / 50))), 6000);
ok(at >= 3000 && at - 3000 <= 200, `người dùng nói chen ở 3000 ms: phát hiện sau ${at - 3000} ms (≤ 200 ms)`, at);
v = createVad();
ok(run(v, (t) => (t >= 2000 && t < 2050 ? 0.95 : echo(t)), 4000) === -1, "tiếng động ngắn (50 ms) không tính là nói");
v = createVad();
at = run(v, (t) => (t < 2000 ? echo(t) : (t % 100) < 70 ? 0.7 : 0.05), 4000);
ok(at >= 2000 && at - 2000 <= 200, `giọng nói có khoảng lặng ngắn giữa âm tiết vẫn phát hiện (${at - 2000} ms)`, at);
v = createVad();
ok(run(v, (t) => (t < 1000 ? 0.05 : 0.45), 3000, () => 0.8) === -1, "đang phát to (giọng realtime đo được): micro 0,45 coi là tiếng vọng");
v = createVad();
ok(run(v, (t) => (t < 1000 ? 0.05 : 0.45), 3000, () => 0.1) > 0, "phát nhỏ thì cùng mức micro đó là người nói");
v = createVad();
run(v, (t) => (t < 1000 ? 0.05 : 0.8), 1500);
ok(run(v, () => 0.8, 3000) === -1, "đã báo một lần thì không báo lại cho tới khi đặt lại");
v.reset(0);
ok(run(v, (t) => (t < 1000 ? 0.05 : 0.8), 1500) > 0, "đặt lại (lượt phát mới): đo nền lại và phát hiện tiếp");

console.log("2. Câu xác nhận và cách đọc kết quả");
let a = ackPlan("Làm giúp mình trang web cho quán cà phê");
ok(a.now && a.lang === "vi" && /\S/.test(a.text), `nhờ làm việc → xác nhận ngay: “${a.text}”`);
ok(!ackPlan("Mấy giờ rồi?").now, "câu hỏi ngắn → chưa xác nhận (chỉ khi trả lời lâu)");
ok(ackPlan("Tìm cho mình giá vàng hôm nay").now && ackPlan("Search the latest news about AI", "en").lang === "en", "nhận đúng việc tìm kiếm, tiếng Anh xác nhận bằng tiếng Anh");
ok(ackPlan("Làm trang A").text !== ackPlan("Làm trang B").text, "câu xác nhận đổi luân phiên, không lặp y hệt");
ok(spokenPlan("Hôm nay là thứ Hai, ngày 26 tháng 10.") === "direct", "câu trả lời ngắn: đọc nguyên văn");
ok(spokenPlan('Đây là trang:\n\n<artifact identifier="a" type="text/html" title="Trang">\n<h1>x</h1>\n</artifact>') === "brief", "có sản phẩm: đọc tóm tắt");
ok(spokenPlan("| A | B |\n|---|---|\n| 1 | 2 |") === "brief" && spokenPlan("x ".repeat(400)) === "brief", "có bảng hoặc dài: đọc tóm tắt");
const lb = localBrief('Mình đã làm xong trang giới thiệu. Trang có ba phần.\n\n<artifact identifier="a" type="text/html" title="T">\n<h1>Tiêu đề</h1>\n</artifact>', "vi");
ok(lb.startsWith("Mình đã làm xong trang giới thiệu.") && lb.endsWith("khung chat.") && !lb.includes("<h1>"), `tóm tắt dự phòng không đọc mã: “${lb}”`);
ok(!toSpeech('Xem nhé <artifact identifier="a" type="text/html" title="T">\n<p>bí mật</p>\n</artifact> hết').join(" ").includes("bí mật"), "không bao giờ đọc to nội dung artifact");

console.log("3. API tóm tắt để đọc to");
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const ANS = `Mình đã làm trang giới thiệu quán cà phê Lumen với ba phần: giới thiệu, điểm nổi bật và đặt bàn.\n\n<artifact identifier="lumen" type="text/html" title="Trang Lumen">\n<!doctype html><h1>Lumen</h1>${"<p>nội dung dài</p>".repeat(300)}\n</artifact>\n\n\`\`\`css\nh1{color:red}\n\`\`\``;
let r = await api("POST", "/api/voice/brief", { question: "Làm trang web cho quán cà phê", answer: ANS });
ok(r.s === 200 && /khung chat/.test(r.j?.brief ?? "") && r.j.brief.length < 300 && !/[<#*`]/.test(r.j.brief), `tóm tắt ngắn, không ký hiệu, nhắc xem chi tiết: “${r.j?.brief}”`, JSON.stringify(r.j));
const L = (await fetch(`${LLM}/_debug/last`).then((x) => x.json())).anthropic;
const sent = JSON.stringify(L?.messages ?? []);
ok(JSON.stringify(L?.system ?? "").includes("<voice_brief>") && sent.includes('[sản phẩm \\"Trang Lumen\\"]') && sent.includes("[khối code]") && !sent.includes("nội dung dài"), "model chỉ nhận tên sản phẩm, không nhận nội dung artifact hay code", sent.slice(0, 300));
r = await api("POST", "/api/voice/brief", { question: "x", answer: "  " });
ok(r.s === 400, "không có câu trả lời → 400");
ok((await fetch(`${B}/api/voice/brief`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ answer: "x" }) })).status === 401, "chưa đăng nhập → 401");

console.log("4. Phiên ElevenLabs Realtime có công cụ giao_viec");
const st = await api("GET", "/api/admin/apikeys");
const had = !!st.j?.providers?.find((p) => p.id === "elevenlabs")?.configured;
if (!had) {
  r = await api("POST", "/api/voice/session");
  ok(r.s === 200 && r.j?.fallback === true && !r.j.value, "chưa có khóa ElevenLabs → dùng giọng của trình duyệt", JSON.stringify(r.j));
}
r = await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${LLM}/elevenlabs` });
ok(r.s === 200, "nhập khóa ElevenLabs (giả lập)", JSON.stringify(r.j).slice(0, 200));
await fetch(`${LLM}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: true }) });
r = await api("POST", "/api/voice/session");
let dbg = await fetch(`${LLM}/_debug/rt`).then((x) => x.json());
ok(r.s === 200 && /^ek_mock_/.test(r.j?.value ?? "") && r.j.tools === true && r.j.url === "ws://127.0.0.1:4010/elevenlabs/v1/convai/realtime", "cấp khóa tạm, phiên có công cụ, địa chỉ WebSocket theo địa chỉ API", JSON.stringify(r.j));
ok(dbg.sessions.at(-1)?.tools && /giao_viec/.test(dbg.sessions.at(-1).instructions) && !JSON.stringify(r.j).includes("sk_mock_eleven"), "hướng dẫn dặn xác nhận ngay rồi giao_viec; khóa thật không gửi về trình duyệt");
await fetch(`${LLM}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: false }) });
r = await api("POST", "/api/voice/session");
dbg = await fetch(`${LLM}/_debug/rt`).then((x) => x.json());
ok(r.s === 200 && r.j?.value && r.j.tools === false && dbg.sessions.length === 1 && !dbg.sessions[0].tools, "ElevenLabs chưa nhận công cụ → tự mở phiên thường (vẫn trò chuyện được)", JSON.stringify([r.j, dbg.sessions]));
await fetch(`${LLM}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: true }) });
if (!had) await api("DELETE", "/api/admin/apikeys?id=elevenlabs");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
