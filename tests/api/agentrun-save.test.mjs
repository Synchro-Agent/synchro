// Lượt Code chạy nền tự lưu: không làm phiên đã lưu trữ quay lại, phiên có trần dung lượng, lưu thưa đi khi phiên lớn, nhiều câu hỏi duyệt cùng lúc vẫn tự dừng đúng hạn. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-agentsave-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
process.env.SYNCHRO_ASK_WAIT_MS = "60";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { authstore: AS, agentruns: A, codestore: C, codemerge: M } = await loadTs(["authstore", "agentruns", "codestore", "codemerge"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const node = (id, extra = {}) => ({ id, parent: 0, user: "u", ai: "", done: false, steps: [], ...extra });
const tool = (id, n) => ({ k: "tool", id, name: "bash", input: { command: "x" }, done: true, ok: true, summary: "xong", output: "o".repeat(n), diff: { path: "a" } });

try {
  const u = AS.createUser({ email: "a@agentsave.test", name: "A", verified: true });
  console.log("1. Không làm phiên đã lưu trữ quay lại");
  {
    C.putSession(u.id, 100, { title: "t", data: { nodes: [] } });
    C.patchSession(u.id, 100, { archived: true });
    const before = C.getSession(u.id, 100);
    await sleep(5);
    C.saveTurn(u.id, 100, node(1, { ai: "đang làm" }), "t");
    const s = C.getSession(u.id, 100);
    ok(s.archived === true, "lưu nền không bỏ trạng thái lưu trữ", s);
    ok(s.touched === before.touched, "không đẩy phiên lên đầu danh sách", s);
    ok(s.data.nodes[0].ai === "đang làm", "nội dung lượt vẫn được lưu", s.data);
    C.putSession(u.id, 101, { title: "t", data: { nodes: [] } });
    const b2 = C.getSession(u.id, 101);
    await sleep(5);
    C.saveTurn(u.id, 101, node(1), "t");
    const s2 = C.getSession(u.id, 101);
    ok(s2.archived === false && s2.touched > b2.touched, "phiên đang dùng vẫn được đẩy lên đầu như trước", s2);
    C.putSession(u.id, 100, { title: "t", data: { nodes: [] }, base: Infinity });
    ok(C.getSession(u.id, 100).archived === false, "trình duyệt lưu phiên (người dùng nhắn tiếp) vẫn bỏ lưu trữ như trước");
  }
  console.log("2. Trần dung lượng");
  {
    const small = { nodes: [node(1)] };
    ok(M.fitSession(small, 1000).data === small, "dưới trần: giữ nguyên");
    const big = () => ({ nodes: [1, 2, 3].map((id) => node(id, { ai: `trả lời ${id}`, steps: [tool("a", 40_000), tool("b", 40_000)] })) });
    const src = big(), keepSteps = src.nodes[2].steps;
    const r = M.fitSession(src, 100_000, 3);
    ok(r && r.json.length <= 100_000 && JSON.parse(r.json).nodes.length === 3, "quá trần: co xuống dưới trần", r?.json.length);
    ok(r.data.nodes[0].steps[0].output === undefined && r.data.nodes[0].steps[0].summary === "xong", "bỏ đầu ra lượt cũ trước, giữ tóm tắt", r.data.nodes[0].steps[0]);
    ok(r.data.nodes[2].steps[1].output?.length === 40_000, "lượt đang chạy giữ chi tiết lâu nhất", r.data.nodes[2].steps[1].summary);
    ok(r.data.nodes.every((n, i) => n.ai === `trả lời ${i + 1}`), "chữ trả lời không bị đụng tới");
    ok(src.nodes[2].steps === keepSteps && keepSteps[0].output.length === 40_000 && src.nodes[0].steps[0].output.length === 40_000, "không sửa bản đang chạy trong bộ nhớ");
    const r2 = M.fitSession(big(), 400, 3);
    ok(r2 && r2.json.length <= 400 && r2.data.nodes[0].steps === undefined, "trần rất thấp: bỏ cả nhật ký làm việc của lượt cũ", r2?.json.length);
    ok(M.fitSession({ nodes: [node(1, { ai: "x".repeat(5000) })] }, 1000, 2) === null, "toàn chữ trả lời không co được: báo không lưu, không cắt chữ của người dùng");
    // Qua saveTurn: phiên quá trần thật.
    const huge = Array.from({ length: 30 }, (_, i) => node(i + 1, { ai: "a", done: true, steps: Array.from({ length: 20 }, (_, j) => tool(`t${j}`, 20_000)) }));
    C.putSession(u.id, 200, { title: "t", data: { nodes: huge } });
    ok(JSON.stringify(C.getSession(u.id, 200).data).length > C.SESSION_MAX, "dựng phiên trên trần", JSON.stringify(C.getSession(u.id, 200).data).length);
    C.saveTurn(u.id, 200, node(99, { ai: "mới" }), "t");
    const s = C.getSession(u.id, 200);
    ok(JSON.stringify(s.data).length <= C.SESSION_MAX, "lượt tự lưu đưa phiên về dưới trần", JSON.stringify(s.data).length);
    ok(s.data.nodes.length === 31 && s.data.nodes.at(-1).ai === "mới", "không mất lượt nào", s.data.nodes.length);
  }
  console.log("3. Lưu thưa đi khi phiên lớn");
  {
    ok(A.saveGap(20) < 10_000, "phiên nhỏ: vẫn lưu theo nhịp 10 giây", A.saveGap(20));
    ok(A.saveGap(500) === 50_000, "mỗi lần lưu mất 500 ms: 50 giây mới lưu lại", A.saveGap(500));
    ok(A.saveGap(60_000) === 300_000, "có trần 5 phút");
  }
  console.log("4. Nhiều câu hỏi duyệt cùng lúc");
  {
    // Lượt chỉ kết thúc khi bị dừng.
    const hold = (cb) => async (emit, signal) => { cb(emit); await new Promise((r) => signal.addEventListener("abort", r, { once: true })); };
    const ask = (id) => ({ t: "ask", id, kind: "bash", title: id });
    let emit;
    const r1 = A.startAgentRun({ uid: u.id, sid: "300" }, hold((e) => { emit = e; }));
    emit(ask("a")); emit(ask("b")); emit({ t: "asked", id: "a", ok: true });
    await sleep(120);
    ok(r1.ac.signal.aborted && r1.lines.some((l) => l.e.t === "error"), "trả lời một câu, câu còn lại không ai duyệt: lượt vẫn tự dừng đúng hạn", r1.lines.map((l) => l.e.t));
    const r2 = A.startAgentRun({ uid: u.id, sid: "301" }, hold((e) => { emit = e; }));
    emit(ask("a")); emit(ask("b")); emit({ t: "asked", id: "a", ok: true }); emit({ t: "asked", id: "b", ok: true });
    await sleep(120);
    ok(!r2.ac.signal.aborted, "trả lời hết thì không tự dừng");
    r2.ac.abort();
    const r3 = A.startAgentRun({ uid: u.id, sid: "302" }, hold((e) => { emit = e; }));
    emit(ask("a")); await sleep(40); emit(ask("b")); await sleep(40);
    ok(!r3.ac.signal.aborted, "câu hỏi mới tính lại hạn", r3.lines.map((l) => l.e.t));
    emit({ t: "asked", id: "a", ok: true }); emit({ t: "asked", id: "b", ok: false });
    r3.ac.abort();
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
