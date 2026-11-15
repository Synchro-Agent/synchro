// Hướng dẫn của dự án luôn tới được model: dự án có hướng dẫn "luôn kết thúc bằng từ KIWI-PROJ", câu hỏi ngắn → lời nhắc hệ thống CLI nhận được có hướng dẫn đó
// ở mọi đường đi (Tự động, chọn tay model, ép đường đầy đủ; trình duyệt có hay không có dữ liệu dự án), không lặp, không lấy bản cũ khi trình duyệt đã xóa.
// Dùng CLI giả lập ("#pjins" nhắc lại phần hướng dẫn dự án nó nhận được). Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-pjins-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "pjins-test-key";
process.env.SYNCHRO_MOCK_OFFLINE = "1";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
const SRC = path.join(process.cwd(), "scripts", "mock-cli");
for (const f of ["claude", "mock-cli-common.cjs"]) fs.copyFileSync(path.join(SRC, f), path.join(BIN, f));
fs.chmodSync(path.join(BIN, "claude"), 0o755);
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 50 }));

const { turnctx: T, chatengine: CH, authstore: AU, chatstore: CS, "ai/cli_auth": A, "ai/cli_pool": PO } = await loadTs(["turnctx", "chatengine", "authstore", "chatstore", "ai/cli_auth", "ai/cli_pool"]);

const INS = "Luôn kết thúc mọi câu trả lời bằng từ KIWI-PROJ.";
const SYS = "Bạn là một trợ lý AI hữu ích.";
const lines = [], log0 = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.startsWith("[timing]")) lines.push(s); else if (!s.startsWith("[design]")) log0(...a); };
const lastTurn = () => [...lines].reverse().find((l) => /^\[timing\] claude \S+ \S+ resume=/.test(l)) ?? "";

try {
  console.log("1. Hàm ghép hướng dẫn dự án");
  const H = T.PROJECT_INS_HEAD;
  let s = T.withProjectIns(SYS, INS, { base: SYS });
  ok(s.startsWith(SYS) && s.includes(`${H}\n${INS}`), "trình duyệt không có hướng dẫn: thêm từ bản máy chủ", s);
  s = T.withProjectIns("", INS, { base: SYS });
  ok(s.startsWith(SYS) && s.includes(INS), "trình duyệt không gửi lời nhắc: dùng lời nhắc mặc định rồi thêm", s);
  const has = `${SYS}\n\n${H}\n${INS}`;
  ok(T.withProjectIns(has, "Bản cũ trên máy chủ", { base: SYS }) === has, "trình duyệt đã có hướng dẫn: giữ nguyên, không lặp, không thay bằng bản máy chủ");
  ok(T.withProjectIns(SYS, INS, { clientFull: true, base: SYS }) === SYS, "trình duyệt có đủ dữ liệu dự án mà không có hướng dẫn (vừa xóa): không lấy bản máy chủ có thể còn cũ");
  ok(T.withProjectIns(SYS, "   ", { base: SYS }) === SYS && T.withProjectIns(SYS, "", {}) === SYS, "dự án không có hướng dẫn: giữ nguyên");
  ok(T.withProjectIns(SYS, "x".repeat(50_000), { base: SYS }).length < SYS.length + T.PROJECT_INS_MAX + 200, "hướng dẫn quá dài bị cắt");

  console.log("2. Lời nhắc CLI nhận được ở mọi đường đi");
  const user = AU.createUser({ email: `pjins${Date.now()}@synchro.test`, name: "Pj", verified: true });
  await A.startLogin("claude", user.id, "oauth");
  await A.submitCode("claude", user.id, "MOCK-CLAUDE-OK");
  await A.status("claude", user.id, { fresh: true });
  const pushed = CS.pushItems(user.id, [{ kind: "project", id: "7", upd: Date.now(), data: JSON.stringify({ id: 7, name: "Kiwi", desc: "", ins: INS }) }]);
  ok(Array.isArray(pushed) && pushed.length === 1, "dự án đã đồng bộ lên máy chủ", JSON.stringify(pushed));
  const turn = async (o = {}) => {
    lines.length = 0;
    const res = await CH.chatPost({ system: SYS, skills: true, feature: "chat", model: "auto", effort: "auto", memory: false, conv: `p-${Math.random().toString(36).slice(2)}`, messages: [{ role: "user", content: "Thủ đô của Pháp là gì? #pjins" }], project: 7, ...o }, { user }, { feature: "chat" });
    const j = await res.json();
    return { s: res.status, text: String(j.text ?? j.error ?? ""), line: lastTurn() };
  };
  const once = (t) => t.s === 200 && t.text.startsWith("PJINS x1: ") && t.text.includes("KIWI-PROJ");
  let r = await turn();
  ok(once(r), "Tự động, câu hỏi ngắn, trình duyệt chỉ có bản rút gọn của dự án: có hướng dẫn", r.text);
  ok(r.line && !/ fast=1/.test(r.line), "lượt có dự án đi đường đầy đủ (không phải đường nhanh không công cụ)", r.line);
  r = await turn({ model: "sub-claude/haiku", effort: "low" });
  ok(once(r), "chọn tay model của gói: có hướng dẫn", r.text);
  r = await turn({ noFast: true });
  ok(once(r), "ép đường đầy đủ: có hướng dẫn", r.text);
  r = await turn({ system: `${SYS}\n\n${T.PROJECT_INS_HEAD}\n${INS}`, pjFull: true });
  ok(once(r), "trình duyệt đã ghép hướng dẫn: đúng một lần, không lặp", r.text);
  r = await turn({ pjFull: true });
  ok(r.s === 200 && r.text === "PJINS: none", "trình duyệt có đủ dữ liệu dự án và không có hướng dẫn (vừa xóa): không lấy bản máy chủ", r.text);
  r = await turn({ project: undefined });
  ok(r.s === 200 && r.text === "PJINS: none", "đoạn chat không thuộc dự án: không có hướng dẫn dự án", r.text);
  r = await turn({ project: 8 });
  ok(r.s === 200 && r.text === "PJINS: none", "dự án khác (chưa đồng bộ): không lấy nhầm hướng dẫn", r.text);

  console.log("3. Trình duyệt gửi đúng dự án ở câu đầu của đoạn chat mới");
  const pg = fs.readFileSync("ui/home.tsx", "utf8");
  const send = pg.slice(pg.indexOf("const send = (t: string"), pg.indexOf("const runTurn = ("));
  ok(/const np = nextProj \?\? \(view === "project" \? curProj \?\? undefined : undefined\);\s*pid = np;/.test(send) && !/const pid = view === "project"/.test(send), "đoạn chat mới (cả khi chọn dự án ở khung soạn trang chủ): lượt đầu mang đúng dự án vừa gán", send.slice(0, 200));
  ok(/pr && !pr\.stub \? \{ pjFull: true \}/.test(pg), "báo cho máy chủ khi trình duyệt có đủ dữ liệu dự án");

  console.log("\n" + (fail ? `${pass}/${pass + fail} đạt` : `${pass}/${pass} đạt`));
} finally {
  console.log = log0;
  PO.dropAll();
  await sleep(100);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
