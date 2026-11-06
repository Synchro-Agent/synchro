// Xóa tài khoản khi lượt Synchro Code đang chạy: lượt dừng và không ghi lại phiên sau khi đã xóa. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-agentpurge-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { authstore: AS, agentruns: A, codestore: C, purge: P } = await loadTs(["authstore", "agentruns", "codestore", "purge"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const node = (id) => ({ id, parent: 0, user: "bí mật của người dùng", ai: "", done: false, steps: [] });
const rows = (uid) => AS.db().prepare("SELECT COUNT(*) n FROM code_sessions WHERE user_id = ?").get(uid).n;
/** Lượt chỉ kết thúc sau khi bị dừng, rồi còn phát thêm sự kiện như CLI thoát muộn. */
const longTurn = (log) => async (emit, signal) => {
  await new Promise((res) => signal.addEventListener("abort", res, { once: true }));
  log.aborted = true;
  await sleep(20);
  emit({ t: "done", text: "kết quả sau khi đã xóa" });
};
try {
  const u = AS.createUser({ email: "a@agentpurge.test", name: "A", verified: true }), keep = AS.createUser({ email: "b@agentpurge.test", name: "B", verified: true });
  const log = {}, logB = {};
  const run = A.startAgentRun({ uid: u.id, sid: "1700", node: node(1), title: "t" }, longTurn(log));
  const runB = A.startAgentRun({ uid: keep.id, sid: "1800", node: node(1), title: "t" }, longTurn(logB));
  await sleep(10);
  ok(rows(u.id) === 1 && A.activeRun(u.id, "1700") === run, "lượt đang chạy đã lưu vào phiên như bình thường");
  // Đúng thứ tự của route: xóa dòng tài khoản trước, purge sau.
  AS.db().prepare("DELETE FROM users WHERE id = ?").run(u.id);
  await P.purgeUser(u.id);
  ok(log.aborted === true && run.ac.signal.aborted, "lượt bị dừng ngay");
  ok(A.latestRun(u.id, "1700") === null, "không còn nội dung lượt trong bộ nhớ");
  await sleep(60);
  ok(run.ended > 0, "lượt đã kết thúc");
  ok(rows(u.id) === 0, "phần lưu cuối lượt không tạo lại phiên", rows(u.id));
  ok(!logB.aborted && A.activeRun(keep.id, "1800") === runB, "lượt của người khác không bị đụng tới");
  C.saveTurn(u.id, 1700, node(2), "t"); C.patchSession(u.id, 1700, { running: false, state: "done" });
  ok(rows(u.id) === 0, "việc nền khác của tài khoản đã xóa cũng không ghi được");
  C.patchSession(keep.id, 1900, { state: "done" }); C.saveTurn(keep.id, 1900, node(3), "t");
  ok(rows(keep.id) === 2, "tài khoản còn thì vẫn lưu như cũ", rows(keep.id));
  A.stopAgentRun(keep.id, "1800");
  await sleep(60);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
