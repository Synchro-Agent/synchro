// Hàng chờ của bộ não: tài khoản chưa chạy được việc nền không được giữ chỗ của người khác; chưa chạy được không tính là lỗi. Dùng CLI giả lập, tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-braindefer-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
Object.assign(process.env, { DATA_DIR: path.join(tmp, "data"), SYNCHRO_ENGINE_HOME: HOME, DATA_KEY: "brain-defer-key", SYNCHRO_MOCK_OFFLINE: "1", SYNCHRO_BRAIN_IDLE_MS: "1", SYNCHRO_BG_STRONG_PER_HOUR: "1" });
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 50 }));

const lines = [], log0 = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.startsWith("[timing]")) lines.push(s); else if (!s.startsWith("[design]")) log0(...a); };
const { authstore: AU, brain: BR, "ai/anymodel": AM, "ai/cli_auth": A, skillstudio: ST } = await loadTs(["authstore", "brain", "ai/anymodel", "ai/cli_auth", "skillstudio"]);
ST.getTag("x");
const mk = (e) => AU.createUser({ email: `${e}${Math.random().toString(36).slice(2, 7)}@synchro.test`, name: e, verified: true });
const chat = (u, id) => BR.importChats(u, [{ id, title: id, msgs: [{ role: "user", text: `Lập kế hoạch ra mắt sản phẩm mới, đoạn chat ${id}` }, { role: "ai", text: "Đây là kế hoạch." }] }]);
const claude = async () => { const u = mk("cl"); await A.startLogin("claude", u.id, "oauth"); await A.submitCode("claude", u.id, "MOCK-CLAUDE-OK"); await A.status("claude", u.id, { fresh: true }); return u; };
const grok = async () => { const u = mk("gr"), f = path.join(HOME, "logins", "grok", A.safeScope(u.id), ".grok/auth.json"); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, "{}"); fs.mkdirSync(path.join(process.env.DATA_DIR, "engine-tokens"), { recursive: true }); fs.writeFileSync(path.join(process.env.DATA_DIR, "engine-tokens", `grok-${A.safeScope(u.id)}.login`), "1"); A.forget("grok", u.id); await A.status("grok", u.id, { fresh: true }); return u; };

try {
  const G = await grok(), C = await claude();
  const { usable } = await AM.usableModels(G);
  ok(usable.length > 0 && usable.every((k) => k.startsWith("sub-grok/")), "tài khoản chỉ có gói Grok", usable);
  // Không có model rẻ nào: bộ nhớ và bộ não vẫn chạy trên model rẻ nhất của họ, ở nỗ lực thấp, nhưng thưa hơn.
  lines.length = 0;
  const first = await AM.quickCall(G, "x", "dùng hết phần việc nền của giờ này", { job: "brain", bg: true }).catch((e) => e);
  ok(first.model === "sub-grok/grok-4.6" || first.model === "sub-grok/grok-4.7", `chỉ có gói Grok: việc nền vẫn chạy (${first.model ?? first.message})`, first.message);
  ok(lines.some((l) => /grok \S+ low .*job=brain/.test(l)), "ở nỗ lực thấp", lines);
  const again = await AM.quickCall(G, "x", "lần thứ hai trong giờ", { job: "brain", bg: true }).catch((e) => e);
  ok(again.message === AM.NO_CHEAP, "quá phần của giờ này: để lần sau, không gọi thêm", again.message ?? again.model);
  const fg = await AM.quickCall(G, "x", "đặt tên", { job: "title" }).catch((e) => e);
  ok(!!fg.text, "việc người dùng đang chờ (đặt tên) không bị giới hạn này chặn", fg.message);
  for (const id of ["g1", "g2", "g3", "g4"]) chat(G, id);
  await new Promise((r) => setTimeout(r, 30));
  chat(C, "c1");
  await new Promise((r) => setTimeout(r, 30));
  lines.length = 0;
  await BR.distillPending();
  ok(lines.some((l) => /claude haiku low .*job=brain/.test(l)), "bốn đoạn cũ của người khác không chặn đoạn mới của người này", lines);
  const s = BR.brainGraph(G).stats;
  ok(s.pending === 4 && s.failed === 0 && !s.learnError, "chưa chạy được: vẫn trong hàng chờ, không tính lỗi, không báo lỗi", s);
  lines.length = 0;
  await BR.distillPending();
  ok(!lines.some((l) => /grok .*job=brain/.test(l)), "đã lùi lại: nhịp sau không thử lại ngay", lines);
  ok(BR.brainGraph(G).stats.pending === 4, "không mất đoạn chat nào");
  await BR.distillPending({ uid: G.id, now: true });
  ok(BR.brainGraph(G).stats.failed === 0, "bấm chạy ngay vẫn chọn được hàng đã lùi, vẫn không tính lỗi", BR.brainGraph(G).stats);
} finally {
  console.log = log0;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
