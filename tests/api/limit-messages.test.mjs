// H1.2: mỗi lời báo khi chạm hạn mức nói rõ hạn mức nào, bao giờ hồi lại và cách thay thế — chi phí API theo phiên / tuần (usage.ts),
// credit giọng AI mỗi ngày (speechapi.ts, theo từng việc: đọc, chép lời, khác), số ảnh AI mỗi giờ (chatengine → limitmsg.ts) — và có bản
// tiếng Anh đúng câu. Chạy thật overLimit / checkBudget trên cơ sở dữ liệu tạm. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-limits-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "limit-messages-key";
process.env.ADMIN_EMAILS = "owner@limits.test";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { limitmsg: L, usage: U, speechapi: S, authstore: AS, "i18n-dict": D } = await loadTs(["limitmsg", "usage", "speechapi", "authstore", "i18n-dict"]);
const en = (s) => { if (Object.prototype.hasOwnProperty.call(D.VI2EN, s)) return D.VI2EN[s]; for (const [re, f] of D.RULES_EN) { const m = s.match(re); if (m) return f(m); } return null; };
const VI_ONLY = /[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i;
const full = (msg, label) => {
  const p = L.limitParts(msg);
  ok(p.which && p.when && p.alt, `${label}: nói hạn mức nào, bao giờ hồi, cách thay thế`, `${JSON.stringify(p)} ${msg}`);
  const e = en(msg);
  ok(!!e && !VI_ONLY.test(e) && Object.values(L.limitParts(e)).every(Boolean), `${label}: bản tiếng Anh đủ ý, không sót tiếng Việt`, e ?? "(không có bản dịch)");
};

console.log("1. Hạn mức chi phí API của Synchro (phiên 5 giờ / tuần)");
const u = AS.createUser({ email: "free@limits.test", name: "Free", verified: true });
ok(U.overLimit(u) === null, "chưa dùng gì: không bị chặn");
const now = Date.now();
const d = AS.db();
d.prepare("INSERT INTO usage_users (user_id, session_start, week_anchor, override) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_start = excluded.session_start, week_anchor = excluded.week_anchor, override = excluded.override")
  .run(u.id, now - 3600_000, now - 86_400_000, JSON.stringify({ session: 0.01, weekly: 1000 }));
d.prepare("INSERT INTO usage_events (user_id, at, model, feature, input, output, cache_read, cache_write, cost) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1)").run(u.id, now - 60_000, "anthropic/claude-haiku-5-5", "chat");
let m = U.overLimit(u);
ok(/phiên này/.test(m ?? "") && /sau 3 giờ 59 phút|sau 4 giờ/.test(m ?? ""), "hết hạn mức phiên: nói đúng phiên, còn khoảng 4 giờ", m);
full(m, "phiên");
d.prepare("UPDATE usage_users SET override = ? WHERE user_id = ?").run(JSON.stringify({ session: 1000, weekly: 0.01 }), u.id);
m = U.overLimit(u);
ok(/hằng tuần/.test(m ?? "") && /sau 6 ngày/.test(m ?? ""), "hết hạn mức tuần: nói đúng tuần, còn 6 ngày", m);
full(m, "tuần");
ok(L.usageLimitMsg("session", now + 45 * 60_000, now).includes("sau 45 phút") && en(L.usageLimitMsg("session", now + 45 * 60_000, now))?.includes("in 45 min"), "thời gian chờ ngắn: phút, tiếng Anh “in 45 min”");
ok(en(L.usageLimitMsg("weekly", now + 86_400_000, now))?.includes("in 1 day."), "một ngày: “1 day” (số ít)", en(L.usageLimitMsg("weekly", now + 86_400_000, now)));

console.log("2. Credit giọng AI mỗi ngày (Đọc văn bản, Chép lời, tính năng khác)");
const v = AS.createUser({ email: "voice@limits.test", name: "V", verified: true });
const b = S.speechBudget();
S.addSpend(v.id, b.user);
const err = (use) => { try { S.checkBudget(v, use); return null; } catch (e) { return e; } };
for (const [use, label, want] of [["voice", "Đọc văn bản", /giọng của trình duyệt/], ["stt", "Chép lời", /nút micro/], ["other", "Lồng tiếng / nhạc", /dùng lại được khi hạn mức hồi/]]) {
  const e = err(use);
  ok(e?.code === "budget" && e.status === 429 && new RegExp(`\\(${b.user} credit\\)`).test(e.message) && want.test(e.message), `${label}: mã budget, nói mức ${b.user} credit và cách thay thế đúng việc`, e?.message);
  if (e) full(e.message, label);
}
ok(/sau \d+ (giờ|phút)/.test(err("voice")?.message ?? "") && /0 giờ UTC/.test(err("voice")?.message ?? ""), "nói giờ hồi (0 giờ UTC) thay vì chỉ “ngày mai”", err("voice")?.message);
const owner = AS.createUser({ email: "owner@limits.test", name: "Owner", verified: true });
ok((() => { try { S.checkBudget(owner, "stt"); return true; } catch { return false; } })(), "quản trị viên không bị trần credit");
ok(L.speechLimitMsg("all", 5000, "voice", Date.UTC(2026, 10, 13, 22, 30)).includes("sau 1 giờ 30 phút (0 giờ UTC)"), "trần chung cả máy chủ: giờ hồi tính tới 0 giờ UTC", L.speechLimitMsg("all", 5000, "voice", Date.UTC(2026, 10, 13, 22, 30)));
full(L.speechLimitMsg("all", 5000, "voice"), "trần chung giọng AI");

console.log("3. Ảnh AI mỗi giờ");
m = L.imageLimitMsg(40, 17 * 60_000 + 5);
ok(/40 ảnh AI mỗi giờ/.test(m) && /khoảng 18 phút/.test(m) && /SVG/.test(m), "nói trần 40 ảnh mỗi giờ, còn 18 phút, gợi ý dựng minh họa không tốn ảnh", m);
full(m, "ảnh");
const ce = fs.readFileSync("app/chatengine.ts", "utf8");
ok(!/nhiều ảnh trong một giờ qua/.test(ce) && (ce.match(/imageLimitMsg\(IMAGE_HOUR_MAX\(\), wait\)/g) ?? []).length === 2, "cả hai chỗ chặn ảnh (poster, tạo ảnh) dùng lời báo mới");

console.log("4. Thẻ lỗi trong chat hiện nguyên lời báo");
// chatError (thẻ lỗi dưới câu trả lời) thay câu dài trên 400 ký tự bằng "Lượt này gặp lỗi ở máy chủ": lời báo hạn mức phải ngắn hơn để người dùng đọc được.
const { chaterror: CE } = await loadTs(["chaterror"]);
const samples = [L.usageLimitMsg("session", now + 4 * 3600_000 - 60_000, now), L.usageLimitMsg("weekly", now + 6 * 86_400_000, now), L.speechLimitMsg("me", 3000, "stt"), L.speechLimitMsg("all", 5000, "other"), L.imageLimitMsg(40, 59 * 60_000)];
for (const s of samples) ok(s.length < 400 && CE.chatError(s).text === s, `hiện nguyên văn (${s.length} ký tự): ${s.slice(0, 50)}…`, CE.chatError(s));
ok(CE.chatError(samples[0]).act === "providers", "lời báo chi phí API có nút mở Providers (để kết nối gói)", CE.chatError(samples[0]));

console.log(`\n${pass}/${pass + fail} đạt`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
