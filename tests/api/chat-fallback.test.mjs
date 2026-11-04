// Chế độ Tự động và lỗi của gói, chạy thật hàm chatPost với CLI giả lập, không cần máy chủ (như engine.test): chuyển nhiều model, nói đúng lý do,
// không chạy lại khi lượt đã làm việc có tác động, giữ phần đã viết, gợi ý đổi model khi chọn tay, giờ hiện tại đi kèm tin nhắn mới nhất.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import http from "node:http";
import { startMock } from "../../scripts/mock-providers.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-fallback-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "fallback-test-key";
process.env.CODE_RUN = "local"; // run_code chạy ngay trên máy (kiểm thử), để lượt có công cụ có tác động
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
const PORT = 4800 + Math.floor(Math.random() * 500);
await startMock(PORT);
const M = `http://127.0.0.1:${PORT}`;
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: M }));

// Cầu nối MCP cần một địa chỉ HTTP: CLI giả lập gọi công cụ của Synchro như thật.
const BR = PORT + 1;
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${BR}`;
const { chatengine: CE, authstore: AU, "ai/cli_auth": A, "ai/subs": SUBS, skillstudio: ST, mcpbridge: MB, runs: RN } = await loadTs(["chatengine", "authstore", "ai/cli_auth", "ai/subs", "skillstudio", "mcpbridge", "runs"]);
http.createServer(async (q, a) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const r = await MB.bridgeRoute(new Request(`http://x${q.url}`, { method: q.method, headers: { "content-type": "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), q.url.split("/").pop());
  a.writeHead(r.status, { "content-type": "application/json" }); a.end(await r.text());
}).listen(BR, "127.0.0.1").unref();
ST.getTag("x"); // máy chủ thật tạo sẵn các bảng khi khởi động
const user = AU.createUser({ email: `fb${Date.now()}@synchro.test`, name: "FB", verified: true });
await A.startLogin("claude", user.id, "oauth");
await A.submitCode("claude", user.id, "MOCK-CLAUDE-OK");
const cx = await A.startLogin("codex", user.id);
await fetch(`${M}/mock-login/codex/approve?code=${cx.userCode}`);
for (let i = 0; i < 20 && !(await A.status("codex", user.id, { fresh: true })).loggedIn; i++) await sleep(300);
await A.status("claude", user.id, { fresh: true });

const post = async (o) => {
  const res = await CE.chatPost({ skills: true, messages: [{ role: "user", content: o.text }], ...o, text: undefined }, { user }, { feature: "chat" });
  return { s: res.status, j: await res.json() };
};

try {
  console.log("1. Tự động: lỗi thì thử model khác");
  let r = await post({ model: "auto", text: "chào [mock:ratelimit]" });
  ok(r.s === 200 && r.j.auto?.fallback?.startsWith("sub-codex/"), "giới hạn tốc độ: chờ, thử lại, rồi chuyển sang gói khác", JSON.stringify(r.j));
  ok(!SUBS.planBlock("claude", user.id), "giới hạn tốc độ không khóa gói");

  // Chạy như lượt nền thật để xem dòng tiến trình và phần đã viết.
  const runIt = async (o) => {
    const id = RN.startRun(user, "chat", { skills: true, messages: [{ role: "user", content: o.text }], ...o, text: undefined }, o.conv ?? null);
    for (let i = 0; i < 200 && RN.getRun(id, user.id).status === "running"; i++) await sleep(100);
    return RN.getRun(id, user.id);
  };
  let run = await runIt({ model: "auto", text: "chào [mock:ratelimit]" });
  ok(run.status === "done" && run.events.some((e) => /^Tự động chọn /.test(e.text)) && run.events.some((e) => /đang giới hạn tốc độ, chuyển sang /.test(e.text)) && run.events.some((e) => /Đang chờ 1 giây rồi thử lại/.test(e.text)), "dòng tiến trình nói đúng lý do chuyển model", JSON.stringify(run.events.map((e) => e.text)));

  console.log("1b. Không chạy lại khi lượt đã làm việc có tác động");
  run = await runIt({ model: "auto", text: `Viết code Python in số 5 [mock:quotaonce] #tool=run_code #args={"language":"python","code":"print(5)"}` });
  ok(run.status === "error" && run.http === 429 && run.result.partialWork === true && !run.result.auto?.fallback && /Đã chạy công cụ/.test(run.result.text ?? ""), "đã chạy code rồi hết hạn mức: không chạy lại bằng model khác, giữ phần đã viết", JSON.stringify(run.result));
  ok(run.result.switchTo?.model && run.result.trace?.some((t) => t.name === "run_code"), "giữ dấu vết công cụ, có gợi ý đổi model để làm tiếp", JSON.stringify(run.result));
  run = await runIt({ model: "auto", text: `Viết bài thơ về mùa thu [mock:quotaonce] #tool=update_plan #args={"items":[{"content":"A","status":"in_progress"}]}` });
  ok(run.status === "done" && run.result.auto?.fallback, "chỉ dùng công cụ không có tác động rồi hết hạn mức: chuyển model được", JSON.stringify(run.result));
  ok(!RN.getRun(run.id, user.id).events.some((e) => /chạy lại/.test(e.text)), "lượt không bị ghi nhận là đã có tác động");

  console.log("1c. Giờ hiện tại, nối phiên quá 60 tin");
  r = await post({ model: "sub-codex/default", text: "#nowcheck chào", tz: "Asia/Ho_Chi_Minh" });
  ok(r.s === 200 && new RegExp(`NOW: .*${new Date().getFullYear()}.*\\(Asia/Ho_Chi_Minh\\)`).test(r.j.text), "tin nhắn mới nhất kèm ngày giờ đúng múi giờ người dùng", JSON.stringify(r.j));
  r = await post({ model: "sub-codex/default", text: "#nowcheck chào", tz: "Không/Phải" });
  ok(r.s === 200 && /NOW: .*\d{4}/.test(r.j.text), "múi giờ sai: dùng giờ máy chủ, không làm hỏng lượt", JSON.stringify(r.j));
  const conv = `long-${Date.now()}`, hist = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `tin ${i}` }));
  const l1 = await post({ model: "sub-codex/default", conv, messages: hist(61).slice(-59), histTotal: 61 });
  const l2 = await post({ model: "sub-codex/default", conv, messages: [...hist(61).slice(-57), { role: "assistant", content: "đáp" }, { role: "user", content: "tiếp" }], histTotal: 63 });
  ok(l1.s === 200 && l2.s === 200 && /lượt 2/.test(l2.j.text), "câu tiếp theo nối đúng phiên dù trình duyệt chỉ gửi 60 tin", JSON.stringify([l1.j.text, l2.j.text]));

  console.log("1d. Tìm web trên CLI");
  run = await runIt({ model: "sub-claude/sonnet", web: true, text: "[mock:twomsg] tìm giúp" });
  ok(run.status === "done" && run.result.webSources?.[0]?.url === "https://example.com/nguon" && run.events.some((e) => e.kind === "tool" && /tìm trên web: mock/.test(e.text)), "lượt có tìm web: hiện bước đang tìm và trả nguồn", JSON.stringify({ r: run.result, e: run.events }));

  console.log("2. Chọn tay: có gợi ý đổi model");
  r = await post({ model: "sub-claude/opus", text: "chào [mock:weekopus]" });
  ok(r.s === 429 && r.j.quota === "model" && r.j.switchTo?.model && r.j.switchTo.model !== "sub-claude/opus" && r.j.switchTo.name, "hết tuần của Opus: gợi ý model khác kèm tên", JSON.stringify(r.j));
  r = await post({ model: "sub-claude/sonnet", text: "chào [mock:midquota]" });
  ok(r.s === 429 && /Phần đã viết/.test(r.j.text ?? "") && r.j.switchTo?.model, "hết hạn mức giữa chừng: giữ phần đã viết, có gợi ý đổi model", JSON.stringify(r.j));
  r = await post({ model: "auto", text: "Chứng minh bất đẳng thức Cauchy-Schwarz cho n số, bài HSG" });
  ok(r.s === 200 && r.j.model !== "sub-claude/opus", "Tự động không chọn Opus đang hết hạn mức", JSON.stringify({ s: r.s, m: r.j.model }));
  r = await post({ model: "sub-codex/default", text: "chào" });
  ok(r.s === 200 && !r.j.switchTo, "lượt chạy được: không có gợi ý nào", JSON.stringify(r.j));

  console.log("3. Hết cả gói");
  r = await post({ model: "sub-claude/haiku", text: "chào [mock:quota]" });
  ok(r.s === 429 && r.j.planLimit === "claude" && r.j.quota === "plan" && r.j.resetsAt > Date.now() && r.j.switchTo?.model?.startsWith("sub-codex/") && !r.j.text, "có mốc hồi lại và gợi ý gói khác", JSON.stringify(r.j));
  r = await post({ model: "auto", text: "chào" });
  ok(r.s === 200 && r.j.model.startsWith("sub-codex/"), "Tự động bỏ qua gói đang hết", JSON.stringify(r.j.model));
  r = await post({ model: "auto", text: "chào [mock:quota]" });
  ok(r.s === 429 && r.j.error && !r.j.switchTo, "mọi gói đều hết: báo rõ, không có gì để gợi ý", JSON.stringify(r.j));
  ok(r.j.error === "Các gói đã kết nối đều đã hết hạn mức." && r.j.resetsAt > Date.now(), "mọi gói đều hết: nói hết cả, kèm lúc sớm nhất có lại (không chỉ nêu gói thử sau cùng)", JSON.stringify(r.j));
} catch (e) {
  ok(false, "lỗi bất ngờ", e.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
