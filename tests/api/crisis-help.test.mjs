// Đầu mối trợ giúp đúng nơi người dùng sống: người Việt nói muốn tự tử từng chỉ nhận số 988 của Mỹ. Hàm thuần, cộng một lượt thật qua chatPost trên CLI giả lập. Chữ model viết ra phải chấm lại bằng scripts/answer-eval.mjs trên CLI thật.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-crisis-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
Object.assign(process.env, { DATA_DIR: path.join(tmp, "data"), SYNCHRO_ENGINE_HOME: HOME, DATA_KEY: "crisis-key", SYNCHRO_MOCK_OFFLINE: "1" });
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
for (const f of ["claude", "mock-cli-common.cjs"]) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: 50 }));
const log0 = console.log;
console.log = (...a) => { const s = a.join(" "); if (!s.startsWith("[timing]") && !s.startsWith("[design]")) log0(...a); };
const { crisishelp: H, chatengine: CH, authstore: AU, "ai/cli_auth": A, skillstudio: ST } = await loadTs(["crisishelp", "chatengine", "authstore", "ai/cli_auth", "skillstudio"]);

try {
  const VN = "Asia/Ho_Chi_Minh", LA = "America/Los_Angeles", AK = "Pacific/Auckland", TK = "Asia/Tokyo";
  const has = (s, re) => re.test(s), FOREIGN = /988|1737|911/, ONLY_VN = (s) => /115/.test(s) && /111/.test(s) && !FOREIGN.test(s);
  console.log("1. Đúng nơi họ sống");
  for (const [t, why] of [["mình không muốn sống nữa", "có dấu"], ["khong muon song nua", "không dấu"], ["ko muốn sống nữa", "gõ tắt"], ["k muon song nua", "gõ tắt không dấu"], ["tôi muốn kết thúc tất cả", "tuyệt vọng chưa rõ"]]) {
    ok(ONLY_VN(H.crisisHelp(t, VN)), `tiếng Việt, múi giờ Việt Nam (${why}): 115 và 111, không có số nước khác`, H.crisisHelp(t, VN));
    ok(ONLY_VN(H.crisisHelp(t)), `tiếng Việt, không có múi giờ (${why}): vẫn là số Việt Nam`, H.crisisHelp(t));
    ok(ONLY_VN(H.crisisHelp(t, "UTC")), `tiếng Việt, trình duyệt giấu múi giờ (${why}): số Việt Nam`, H.crisisHelp(t, "UTC"));
  }
  ok(/trẻ em/.test(H.crisisHelp("bé nhà em 2 tuổi nuốt pin cúc áo rồi", VN)) && /115/.test(H.crisisHelp("bé nhà em 2 tuổi nuốt pin cúc áo rồi", VN)), "trẻ nuốt dị vật: có 115");
  ok(/111[^.]*trẻ em/.test(H.crisisHelp("mình muốn chết", VN)), "111 được nói rõ là đường dây bảo vệ trẻ em, không đưa cho người lớn như đường dây tâm lý");
  ok(/người (?:đang )?ở gần/.test(H.crisisHelp("mình muốn chết", VN)), "nhờ người ở gần");
  ok(has(H.crisisHelp("I want to kill myself", VN), /115/) && !FOREIGN.test(H.crisisHelp("I want to kill myself", VN)), "viết tiếng Anh ở Việt Nam: số Việt Nam");
  const la = H.crisisHelp("mình muốn chết", LA);
  ok(has(la, /988/) && has(la, /911/) && !has(la, /115/), "người Việt ở Mỹ: số của Mỹ", la);
  const nz = H.crisisHelp("I want to die", AK);
  ok(has(nz, /1737/) && has(nz, /111/) && !has(nz, /988|115/), "New Zealand: 111 và 1737", nz);
  for (const [t, tz, why] of [["I want to die", undefined, "tiếng Anh, không rõ nơi"], ["mình muốn chết", TK, "tiếng Việt ở Nhật"]]) {
    const s = H.crisisHelp(t, tz);
    ok(!/\b(?:988|115|911|1737)\b/.test(s) && /đang ở/.test(s) && /cấp cứu/.test(s), `${why}: không gán số của nước khác, hỏi họ ở đâu`, s);
  }
  console.log("2. Không kèm khi không cần");
  for (const t of ["Thủ đô của Pháp là gì?", "my laptop will never wake up from sleep", "phong cách chết chóc trong phim", "cách chết máy tính", "làm sao kết thúc tất cả tiến trình đang chạy"]) ok(H.crisisHelp(t, VN) === "", `"${t}": không có khối trợ giúp`, H.crisisHelp(t, VN));

  console.log("3. Tới được CLI, cùng tin nhắn mới nhất");
  ST.getTag("x");
  const u = AU.createUser({ email: `crisis${Date.now()}@synchro.test`, name: "C", verified: true });
  await A.startLogin("claude", u.id, "oauth");
  await A.submitCode("claude", u.id, "MOCK-CLAUDE-OK");
  await A.status("claude", u.id, { fresh: true });
  const turn = async (text) => { const r = await CH.chatPost({ system: "Bạn là trợ lý.", skills: true, feature: "chat", model: "auto", effort: "auto", memory: true, tz: VN, conv: `c-${Math.random().toString(36).slice(2)}`, messages: [{ role: "user", content: text }] }, { user: u }, { feature: "chat" }); return r.json(); };
  // CLI giả lập trả lại dòng cuối của lời nhắc.
  let j = await turn("mình không muốn sống nữa");
  ok(/<\/crisis_help>/.test(j.text ?? ""), "lượt đầy đủ: khối trợ giúp đi cùng tin nhắn", JSON.stringify(j).slice(0, 300));
  j = await turn("Xin chào");
  ok(!/crisis_help/.test(j.text ?? ""), "câu chào: không có", j.text);
} finally {
  console.log = log0;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
