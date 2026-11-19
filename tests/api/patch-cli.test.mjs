// Bước gửi lại khối sửa hỏng trên đường CLI (gói của người dùng, đường chính của tài khoản miễn phí): Claude Code giả
// lập trả bản sửa có một khối chép sai chữ. Synchro nhắc đúng một lần, ghép lần gửi lại thành một bản sửa áp trọn; lần
// gửi lại lỗi hay bị Dừng thì người dùng nhận đúng câu trả lời gốc, không kèm ghi chú lỗi của bước họ không thấy.
// Không cần máy chủ: chatPost chạy trong tiến trình với CLI giả lập (như crisis-help).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-patchcli-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
const env = { DATA_DIR: path.join(tmp, "data"), SYNCHRO_ENGINE_HOME: HOME, DATA_KEY: "patchcli-key", SYNCHRO_MOCK_OFFLINE: "1" };
Object.assign(process.env, env);
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
for (const f of ["claude", "mock-cli-common.cjs"]) {
  fs.copyFileSync(path.join("tools/mock-cli", f), path.join(BIN, f));
  fs.chmodSync(path.join(BIN, f), 0o755);
}
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 50 }));
const timing = [];
const log0 = console.log;
console.log = (...a) => {
  const s = a.join(" ");
  if (s.startsWith("[timing]")) timing.push(s);
  else if (!s.startsWith("[design]") && !s.startsWith("[otel]")) log0(...a);
};
const mods = ["chatengine", "authstore", "ai/cli_auth", "caps", "vfs", "runs", "tracing"];
const { chatengine: CH, authstore: AU, "ai/cli_auth": A, caps: CP, vfs: V, runs: RN, tracing: TR } = await loadTs(mods);

const BASE = `<!doctype html>
<html><head><title>Bản gốc</title></head>
<body>
<h1>Chào bạn</h1>
<p>Đoạn một.</p>
</body></html>`;
const FIRST = `Đây là trang:\n\n<artifact identifier="cli-doc" type="text/html" title="Trang chào">\n${BASE}\n</artifact>`;
const healLog = path.join(BIN, "mock-heal.log");
const heals = () => (fs.existsSync(healLog) ? fs.readFileSync(healLog, "utf8").split("\n").filter(Boolean).length : 0);
const docOf = (text) => V.artState([FIRST, text]).get("cli-doc");
const patchTags = (text) => (text.match(/<artifact\b[^>]*identifier="cli-doc"[^>]*mode="patch"/g) ?? []).length;

try {
  const u = AU.createUser({ email: `patchcli${Date.now()}@synchro.test`, name: "P", verified: true });
  await A.startLogin("claude", u.id, "oauth");
  await A.submitCode("claude", u.id, "MOCK-CLAUDE-OK");
  await A.status("claude", u.id, { fresh: true });
  CP.setUserCaps(u.id, { art: true });
  const turn = async (kind) => {
    fs.rmSync(healLog, { force: true });
    timing.length = 0;
    const messages = [
      { role: "user", content: "Tạo trang chào" },
      { role: "assistant", content: FIRST },
      { role: "user", content: `#clipatch ${kind}` },
    ];
    const body = {
      system: "Bạn là trợ lý.", skills: true, feature: "chat", model: "sub-claude/sonnet", noFast: true,
      conv: `pc-${Math.random().toString(36).slice(2)}`, messages,
    };
    return body;
  };
  // Trong một trace như lượt chat thật (runs/store-sqlite.ts), để có dòng [timing] của lượt.
  const post = async (body) => {
    const tr = TR.beginTrace("chat");
    const r = await TR.withTrace(tr, () => CH.chatPost(body, { user: u }, { feature: "chat" }));
    TR.endTrace(tr, r.status);
    return { status: r.status, j: await r.json() };
  };

  console.log("1. Khối hỏng được gửi lại và ghép thành một bản sửa áp trọn");
  {
    const { status, j } = await post(await turn("ok"));
    const text = String(j.text ?? ""), doc = docOf(text);
    ok(status === 200 && heals() === 1, "Synchro nhắc gửi lại đúng một lần", `${status} ${heals()} ${text}`);
    const both = doc?.content.includes("<title>Bản mới</title>") && doc?.content.includes("<h1>Xin chào bạn</h1>");
    ok(patchTags(text) === 1 && doc?.fix && !doc.fix.failed.length && both,
      "câu trả lời có một bản sửa, áp trọn cả hai thay đổi", `${JSON.stringify(doc?.fix)} ${text}`);
    ok(text.includes("Đã đổi tiêu đề và lời chào.") && !/<patch_failed|Hệ thống:/.test(text),
      "lời của câu trả lời gốc giữ nguyên, không lộ lời nhắc ẩn", text);
    const line = timing.find((l) => l.includes("patch_ok=")) ?? timing.join(" | ");
    ok(/patch_ok=2 patch_failed=0 .*patch_failed_first=1 patch_heal=ok/.test(line),
      "dòng [timing]: sau khi ghép không còn khối hỏng, vẫn giữ số khối hỏng lần đầu", line);
  }

  console.log("2. Lần gửi lại lỗi phía hãng: giao câu trả lời gốc");
  {
    const { status, j } = await post(await turn("healerror"));
    const text = String(j.text ?? ""), doc = docOf(text);
    ok(status === 200 && heals() >= 1, "đã nhắc gửi lại", `${status} ${heals()}`);
    ok(text.includes("Đã đổi tiêu đề và lời chào.") && text.includes("<h1>Chao ban</h1><!--healerror-->"),
      "người dùng nhận câu trả lời gốc (bản sửa hỏng hiện kèm nút viết lại)", text);
    ok(!/_\(|sự cố|Internal server error/.test(text), "không kèm ghi chú lỗi của bước người dùng không thấy", text);
    const line = timing.find((l) => l.includes("patch_ok=")) ?? timing.join(" | ");
    ok(/patch_failed=1 .*patch_failed_first=1 patch_heal=fail/.test(line), "dòng [timing]: lần gửi lại thất bại", line);
    ok(doc?.fix?.failed.length === 1 && doc.content.includes("<title>Bản mới</title>"),
      "khối khớp vẫn áp, khối hỏng được báo", JSON.stringify(doc?.fix));
  }

  console.log("3. Bấm Dừng khi đang gửi lại: giao câu trả lời gốc");
  {
    const stop = new AbortController();
    const body = await turn("healslow");
    const t0 = Date.now();
    const watch = setInterval(() => {
      if (heals() >= 1 || Date.now() - t0 > 60_000) stop.abort();
    }, 100);
    const { status, j } = await RN.withStop(stop.signal, () => post(body));
    clearInterval(watch);
    const text = String(j.text ?? "");
    ok(status === 200 && heals() === 1 && Date.now() - t0 < 30_000, "lượt dừng ngay, không chờ lần gửi lại",
      `${status} ${heals()} ${Date.now() - t0}`);
    ok(text.includes("Đã đổi tiêu đề và lời chào.") && text.includes("<!--healslow-->") && patchTags(text) === 1,
      "người dùng nhận đúng câu trả lời gốc", text);
  }
} finally {
  console.log = log0;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
