// Đọc to câu trả lời dài (chia phần không mất chữ) và hạn mức credit ElevenLabs trong ngày. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-speech-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "speech-budget-key";
process.env.ADMIN_EMAILS = "owner@sp.test";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { voiceflow: V, speechapi: S, authstore: AS } = await loadTs(["voiceflow", "speechapi", "authstore"]);

console.log("1. Chia câu trả lời dài");
const squash = (s) => s.replace(/\s+/g, "");
const long = Array.from({ length: 900 }, (_, i) => `Câu số ${i} nói về một chuyện gì đó đủ dài.`).join(" ");
let parts = V.splitSpeech(long);
ok(long.length > 30000 && parts.length >= 12 && parts.every((p) => p.length <= V.SPEECH_PART), `câu trả lời ${long.length} ký tự thành ${parts.length} phần, phần nào cũng dưới giới hạn`, parts.map((p) => p.length).join());
ok(squash(parts.join(" ")) === squash(long), "không mất chữ nào, phần cuối vẫn còn");
ok(parts.slice(0, -1).every((p) => /[.!?…]$/.test(p)), "ngắt ở cuối câu");
const noStop = "từ ".repeat(3000);
parts = V.splitSpeech(noStop);
ok(parts.every((p) => p.length <= V.SPEECH_PART) && squash(parts.join("")) === squash(noStop), "câu dài không có dấu chấm: ngắt ở khoảng trắng, không mất chữ");
const blob = "x".repeat(6000);
parts = V.splitSpeech(blob);
ok(parts.every((p) => p.length <= V.SPEECH_PART) && parts.join("") === blob, "một từ rất dài cũng được cắt");
ok(JSON.stringify(V.splitSpeech("Ngắn thôi.")) === '["Ngắn thôi."]', "câu ngắn: một phần");

console.log("2. Hạn mức trong ngày");
const verified = AS.createUser({ email: "v@sp.test", name: "V", verified: true }), fresh = AS.createUser({ email: "u@sp.test", name: "U", verified: false }), other = AS.createUser({ email: "o@sp.test", name: "O", verified: true });
const owner = AS.createUser({ email: "owner@sp.test", name: "Owner", verified: true });
const code = (u) => { try { S.checkBudget(u); return null; } catch (e) { return e.code; } };
ok(code(fresh) === null && code(verified) === null, "chưa dùng gì: được dùng");
const def = S.speechBudget();
ok(def.unverified < def.user && def.global === null, "tài khoản chưa xác minh có mức thấp hơn", JSON.stringify(def));
S.addSpend(fresh.id, def.unverified);
ok(code(fresh) === "budget" && S.spentToday(fresh.id) === def.unverified, "chưa xác minh: hết mức riêng thì báo budget");
ok(code(verified) === null, "tài khoản khác không bị ảnh hưởng");
S.addSpend(verified.id, def.user - 1);
ok(code(verified) === null, "còn một credit: vẫn được dùng");
S.addSpend(verified.id, 1);
ok(code(verified) === "budget", "đúng bằng mức: chặn");
ok(code(owner) === null, "quản trị viên không bị chặn");
ok(S.spentToday() === def.unverified + def.user, "cả máy chủ cộng dồn mọi tài khoản", S.spentToday());

console.log("3. Mức chung và cảnh báo");
S.setSpeechBudget({ global: S.spentToday() + 100 });
ok(code(other) === null, "còn mức chung: được dùng");
S.addSpend(other.id, 100);
ok(code(other) === "budget", "hết mức chung: tài khoản mới cũng dừng");
ok(code(owner) === null, "quản trị viên vẫn dùng được");
const alerts = AS.db().prepare("SELECT detail FROM audit WHERE action = 'speech_budget_alert'").all();
ok(alerts.length === 1 && /\d+ \/ \d+/.test(alerts[0].detail), "nhật ký quản trị báo một lần khi gần hết mức chung", JSON.stringify(alerts));
S.addSpend(owner.id, 5);
ok(AS.db().prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'speech_budget_alert'").get().n === 1, "không báo lại trong ngày");

console.log("4. Tính credit theo người gọi");
S.setSpeechBudget({ global: null, user: 1000 });
const hdr = (cost) => new Response("x", { headers: cost ? { "character-cost": String(cost) } : {} });
const before = S.spentToday(other.id);
S.spender.run(other.id, () => S.spent(hdr(40)));
ok(S.spentToday(other.id) === before + 40, "hãng báo chi phí: dùng số thật");
S.spender.run(other.id, () => S.spent(hdr(0), 25));
ok(S.spentToday(other.id) === before + 65, "hãng không báo: dùng ước lượng");
S.spent(hdr(40));
ok(S.spentToday(other.id) === before + 65, "ngoài lượt của người dùng (quét gói…): không tính cho ai");
S.setSpeechBudget({ user: -5 });
ok(S.speechBudget().user === 1000, "số không hợp lệ: giữ nguyên", JSON.stringify(S.speechBudget()));
ok(S.speechBudget().global === null, "đổi một mức không đụng mức khác (mức chung vẫn tự tính, không về 0)", JSON.stringify(S.speechBudget()));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
