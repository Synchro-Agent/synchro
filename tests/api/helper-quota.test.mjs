// Gói w10-quota (nhóm A, chi phí và hạn mức): việc phụ trên gói của người dùng có ngân sách và dừng khi gói gần chạm giới hạn (ai/helperquota.ts);
// "tin nhắn hôm nay" chỉ đếm lượt của người dùng (lỗi 12); khóa API chung có quy tắc cho tài khoản thường: cho / chặn, hạng model cao nhất
// (mặc định không Opus), hạn mức tiền theo ngày (lỗi 4 phần quản trị). Chạy thật trên cơ sở dữ liệu tạm. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-helper-quota-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "helper-quota-key";
process.env.ADMIN_EMAILS = "owner@quota.test";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { "server/ai/helperquota": H, "server/auth/sharedkey": K, usage: U, authstore: AS, limitmsg: L, "i18n-dict": D } =
  await loadTs(["server/ai/helperquota", "server/auth/sharedkey", "usage", "authstore", "limitmsg", "i18n-dict"]);
const en = (s) => { if (Object.prototype.hasOwnProperty.call(D.VI2EN, s)) return D.VI2EN[s]; for (const [re, f] of D.RULES_EN) { const m = s.match(re); if (m) return f(m); } return null; };

console.log("1. Ngân sách việc phụ trên gói (helperVerdict)");
const cfg = { stopPct: 70, base: 4, perTurn: 2, max: 30 };
const v = (x) => H.helperVerdict({ helpers: 0, userTurns: 0, windows: [], blockedUntil: null, ...x }, 1_000, cfg);
ok(v({}).ok && v({}).cap === 4, "chưa có lượt nào: vẫn còn 4 việc phụ (đặt tên đoạn chat đầu tiên)", JSON.stringify(v({})));
ok(!v({ helpers: 4 }).ok && v({ helpers: 4 }).why === "budget", "hết 4 việc phụ khi người dùng chưa nhắn gì: dừng", JSON.stringify(v({ helpers: 4 })));
ok(v({ helpers: 13, userTurns: 5 }).ok && !v({ helpers: 14, userTurns: 5 }).ok, "5 tin nhắn của người dùng: tối đa 4 + 2×5 = 14 việc phụ (không còn chuyện 57 việc phụ cho 9 tin nhắn)");
ok(v({ helpers: 29, userTurns: 100 }).ok && !v({ helpers: 30, userTurns: 100 }).ok, "trần 30 việc phụ mỗi ngày dù nhắn nhiều");
ok(v({ windows: [{ usedPct: 69 }] }).ok && v({ windows: [{ usedPct: 70 }] }).why === "near-limit", "một cửa sổ của gói đã dùng 70%: dừng việc phụ, phần còn lại cho tin nhắn của người dùng");
ok(v({ windows: [{ usedPct: 10, status: "rejected" }] }).why === "near-limit", "cửa sổ bị hãng từ chối: dừng");
ok(v({ blockedUntil: 2_000 }).why === "blocked" && v({ blockedUntil: 500 }).ok, "gói đang bị chặn (hãng báo hết hạn mức): dừng; mốc đã qua thì chạy lại");
ok(H.THROTTLED_JOBS.has("title") && H.THROTTLED_JOBS.has("brain") && H.THROTTLED_JOBS.has("critic-auto") && H.THROTTLED_JOBS.has("memory") && !H.THROTTLED_JOBS.has("critic") && !H.THROTTLED_JOBS.has("compact"),
  "việc tự động chịu ngân sách; việc người dùng bấm (phản biện tay, nén ngữ cảnh) thì không");
ok(H.isUserVia("codex") && H.isUserVia("sub-codex") && !H.isUserVia("job:title") && !H.isUserVia("warm"), "engine_turns.via: job:… và warm không phải tin nhắn của người dùng");

console.log("2. Rút bộ nhớ ngay trên gói chỉ khi câu tự nói về mình (factLike)");
for (const s of ["Tên mình là Lâm Tùng, mình thích nhạc lo-fi", "Mình là học sinh lớp 12", "Gọi mình là Tùng nhé", "Trả lời ngắn gọn thôi", "My name is Ann", "I prefer short answers",
  "Nhớ giúp mình: mình dị ứng tôm", "Mình là kỹ sư điện, thích câu trả lời ngắn, nhớ giúp mình nhé", "Tôi là giáo viên tiểu học", "Mình sống ở Đà Nẵng", "Tôi làm việc ở một công ty logistics",
  "Từ giờ trở đi xưng hô anh em nhé", "I'm a nurse, keep it short", "I work as a data analyst", "Call me Sam", "From now on, answer in Vietnamese", "Remember that I'm vegetarian"])
  ok(H.factLike(s), `có: ${s}`);
// Yêu cầu thường ngày mở đầu bằng ngôi thứ nhất (muốn / cần / có / đang / làm / dùng, I'm / I use) không phải câu tự mô tả: để bộ não chưng cất sau.
for (const s of ["2+2 bằng mấy", "Tỷ giá USD hôm nay", "Viết hàm sắp xếp mảng bằng Python", "Translate this to English: hello", "Làm slide gọi vốn 6 trang",
  "Mình muốn làm slide giới thiệu sản phẩm", "Tôi cần viết email xin nghỉ phép", "Em có bài toán này, giải giúp em", "Mình cần code python đọc file CSV", "tôi đang học react, giải thích useEffect",
  "Tôi muốn hỏi về thời tiết Hà Nội", "I'm trying to fix this bug", "I use Next.js, how do I add auth", "Mình đang làm luận văn về AI", "Tôi có một file excel cần lọc", "Em làm bài tập này thế nào",
  "Mình dùng Windows 11, sao không cài được Node", "Cách ghi nhớ từ vựng tiếng Anh nhanh", "Tôi là ai trong câu chuyện này?", "Mình thích bài này, viết thêm một đoạn", "I'm a bit confused about closures",
  "I like this, make it longer", "Đếm ngược từ giờ đến Tết còn bao lâu", "Giải thích định luật Ohm thật ngắn gọn", "Cho mình một ví dụ với pin 9V"])
  ok(!H.factLike(s), `không: ${s}`);

console.log("3. Khóa API chung cho tài khoản thường (auth/sharedkey.ts, canModel)");
const owner = AS.createUser({ email: "owner@quota.test", name: "Owner", verified: true });
const free = AS.createUser({ email: "free@quota.test", name: "Free", verified: true });
const other = AS.createUser({ email: "other@quota.test", name: "Other", verified: true });
const OPUS = "anthropic/claude-opus-5-5", FABLE = "anthropic/claude-fable-5-1", SONNET = "anthropic/claude-sonnet-5-5", HAIKU = "anthropic/claude-haiku-5-5";
ok(AS.isAdmin(owner) && !AS.isAdmin(free), "chủ sở hữu là quản trị viên, tài khoản miễn phí thì không");
ok(!AS.canModel(free, OPUS) && !AS.canModel(free, FABLE), "mặc định: tài khoản thường không chạy Opus / Fable trên khóa chung");
ok(AS.canModel(free, SONNET) && AS.canModel(free, HAIKU), "mặc định: Sonnet, Haiku vẫn dùng được");
ok(AS.canModel(free, "sub-claude/opus") && AS.canModel(free, "sub-codex/gpt-6.1-sol"), "model của gói người dùng tự đăng nhập không bị quy tắc khóa chung chặn");
ok(AS.canModel(owner, OPUS) && AS.canModel(owner, FABLE), "quản trị viên dùng được mọi model");
ok(/chỉ chạy được bằng gói bạn tự đăng nhập/.test(AS.modelDeniedMsg(free, OPUS)) && !!en(AS.modelDeniedMsg(free, OPUS)), "lời báo nói đúng lý do (hạng model trên khóa chung), có bản tiếng Anh", AS.modelDeniedMsg(free, OPUS));
U.setConfig({ sharedTop: "strong" });
ok(AS.canModel(free, OPUS), "quản trị viên cho tới hạng mạnh: Opus dùng được");
U.setConfig({ sharedTop: "fast" });
ok(!AS.canModel(free, SONNET) && AS.canModel(free, HAIKU), "chỉ model nhanh: Sonnet bị chặn, Haiku còn");
U.setConfig({ sharedTop: "balanced", sharedKey: false });
ok(!AS.canModel(free, HAIKU) && /chưa cho tài khoản của bạn dùng khóa API chung/.test(AS.modelDeniedMsg(free, HAIKU)) && !!en(AS.modelDeniedMsg(free, HAIKU)), "tắt khóa chung: mọi model khóa API bị chặn, lời báo nói rõ", AS.modelDeniedMsg(free, HAIKU));
U.setOverride(other.id, { shared: true, top: "strong" });
ok(AS.canModel(other, OPUS) && !AS.canModel(free, OPUS), "cho riêng một người dùng khóa chung tới hạng mạnh; người khác vẫn theo mặc định");
U.setOverride(other.id, { shared: false });
U.setConfig({ sharedKey: true });
ok(!AS.canModel(other, HAIKU) && AS.canModel(free, HAIKU), "chặn riêng một người; mặc định mở lại cho người khác");
U.setOverride(other.id, null);
ok(AS.canModel(other, HAIKU) && !AS.canModel(other, OPUS), "bỏ hạn mức riêng: về mặc định (tới hạng cân bằng)");
const cfgNow = U.getConfig();
ok(cfgNow.sharedKey === true && cfgNow.sharedTop === "balanced" && cfgNow.daily === null, "cấu hình lưu đúng", JSON.stringify(cfgNow));
U.setConfig({ sharedTop: "bogus" });
ok(U.getConfig().sharedTop === "balanced", "giá trị lạ không ghi đè");
const row = U.adminUsage([free, owner]);
ok(row[0].shared?.top === "balanced" && row[1].shared === null, "danh sách quản trị: quy tắc khóa chung của từng người (quản trị viên: không áp)", JSON.stringify(row.map((r) => r.shared)));

console.log("4. Hạn mức tiền theo ngày (UTC)");
ok(!U.usageState(free).limits.some((l) => l.key === "daily"), "chưa đặt: không có dòng hạn mức ngày");
U.setConfig({ daily: 0.01 });
ok(U.usageState(free).limits.some((l) => l.key === "daily" && l.limit === 0.01), "đặt $0.01 mỗi ngày: có dòng hạn mức ngày");
U.withUsage(free.id, "chat", () => U.recordUsage(OPUS, { input_tokens: 10_000, output_tokens: 1_000 }));
const msg = U.overLimit(free);
ok(!!msg && /hôm nay/.test(msg), "dùng quá $0.01 trong ngày: bị chặn, nói là hạn mức của hôm nay", msg);
const parts = msg ? L.limitParts(msg) : {};
ok(parts.which && parts.when && parts.alt, "lời báo đủ ba ý: hạn mức nào, bao giờ hồi, cách thay thế", JSON.stringify(parts));
const e = msg ? en(msg) : null;
ok(!!e && /today's API cost limit/.test(e) && /00:00 UTC/.test(e), "có bản tiếng Anh", e);
U.setOverride(free.id, { daily: null });
ok(U.overLimit(free) === null, "hạn mức riêng 'không giới hạn' thay mặc định");
ok(U.overLimit(owner) === null, "quản trị viên không bị hạn mức ngày khi hạn mức không áp cho quản trị viên");

console.log("5. Đếm lượt của gói: tin nhắn của người dùng tách khỏi việc phụ (lỗi 12), ngân sách việc phụ theo số đếm thật");
const { "server/ai/subs": S } = await loadTs(["server/ai/subs"]);
const put = (via, n, at = Date.now()) => { for (let i = 0; i < n; i++) AS.db().prepare("INSERT INTO engine_turns (user_id, cli, at, via, model) VALUES (?, 'codex', ?, ?, 'sub-codex/gpt-6-luna')").run(free.id, at, via); };
put("job:title", 1); put("job:memory", 2); put("warm", 1);
ok(JSON.stringify(S.todayCounts(free.id, "codex")) === JSON.stringify({ turns: 0, helpers: 4 }), "4 việc phụ, 0 tin nhắn: hôm nay 0 tin nhắn", JSON.stringify(S.todayCounts(free.id, "codex")));
ok(!S.helperRoom(free.id, "codex").ok, "chưa có tin nhắn nào mà đã 4 việc phụ: việc phụ tự động dừng");
put("codex", 3);
put("codex", 5, Date.now() - 3 * 86_400_000);
ok(JSON.stringify(S.todayCounts(free.id, "codex")) === JSON.stringify({ turns: 3, helpers: 4 }), "3 tin nhắn hôm nay (lượt hôm trước không tính), 4 việc phụ", JSON.stringify(S.todayCounts(free.id, "codex")));
const room = S.helperRoom(free.id, "codex");
ok(room.ok && room.cap === 10, "3 tin nhắn: được tới 4 + 2×3 = 10 việc phụ", JSON.stringify(room));
// Việc người dùng tự bấm (quét skill nhiều đợt, phản biện tay) và lượt làm tiếp trong cùng tin nhắn: hiện trong "việc nền", không tiêu ngân sách việc tự động.
put("job:skill-scan", 20); put("job:critic", 2); put("job:cont", 3);
ok(JSON.stringify(S.todayCounts(free.id, "codex")) === JSON.stringify({ turns: 3, helpers: 29 }), "quét skill, phản biện tay, lượt làm tiếp: đếm vào việc nền (29), không thành tin nhắn", JSON.stringify(S.todayCounts(free.id, "codex")));
ok(S.helperRoom(free.id, "codex").ok, "20 đợt quét skill người dùng tự bấm không làm việc tự động (đặt tên, bộ nhớ) dừng cả ngày", JSON.stringify(S.helperRoom(free.id, "codex")));
put("job:brain", 6);
ok(!S.helperRoom(free.id, "codex").ok, "đủ 10 việc phụ tự động: dừng tới khi người dùng nhắn thêm");
ok(H.CONT_JOB === "cont" && !H.THROTTLED_JOBS.has(H.CONT_JOB) && !H.isUserVia(`job:${H.CONT_JOB}`), "lượt làm tiếp (nhắc làm tiếp, chờ kết quả công cụ) ghi job:cont: không phải tin nhắn mới, không chịu ngân sách");
const src = (f) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
for (const f of ["server/chat/routing.ts", "server/agentcore.ts"])
  ok(/job: cont \? CONT_JOB : undefined/.test(src(f)) && /cont = !more\.length;/.test(src(f)), `${f}: lượt làm tiếp gắn job:cont, tin nhắn thêm của người dùng (<user_followup>) vẫn là lượt của người dùng`);

console.log("6. Rút bộ nhớ không đáng một lượt gói không chuyển sang khóa API chung (anymodel.ts quickCall planOk)");
const am = src("server/ai/anymodel.ts");
ok(/if \(o\.planOk === false && subCli\(model\)\) throw new OneShotErr\(NO_CHEAP, 503\);/.test(am) && !/planOk[\s\S]{0,400}tierOf\(k\) === "fast"/.test(am), "planOk: false trên gói: bỏ (để bộ não chưng cất sau), không chọn model khóa API thay");
ok(/planOk: factLike\(question\)/.test(src("server/memory.ts")), "memory.ts: chỉ rút ngay trên gói khi câu tự mô tả mình");

console.log("7. Vòng trong \"khóa API chung\": chỉ tính lượt của người dùng, không tính việc nền (usage.ts Limit.turn)");
const bg = AS.createUser({ email: "bg@quota.test", name: "Bg", verified: true });
U.withUsage(bg.id, "internal", () => U.recordUsage("openai/gpt-6-luna", { prompt_tokens: 2000, completion_tokens: 200 }));
U.withUsage(bg.id, "embed", () => U.recordUsage("openai/text-embedding-3-small", { prompt_tokens: 500, completion_tokens: 0 }));
let ls = U.usageState(bg).limits;
ok(ls.some((l) => l.used > 0) && ls.every((l) => l.turn === 0), "chỉ có rút bộ nhớ và embedding trên khóa API: đã dùng > 0 nhưng phần lượt người dùng = 0 (không hiện vòng trong)", JSON.stringify(ls));
U.withUsage(bg.id, "chat", () => U.recordUsage(SONNET, { input_tokens: 2000, output_tokens: 500 }));
ls = U.usageState(bg).limits;
ok(ls.filter((l) => l.active).every((l) => l.turn > 0 && l.turn <= l.used), "một lượt chat chạy bằng khóa API: phần lượt người dùng > 0", JSON.stringify(ls));
U.setOverride(bg.id, { daily: 5 });
const dl = U.usageState(bg).limits.find((l) => l.key === "daily");
ok(!!dl && dl.turn > 0 && dl.limit === 5, "hạn mức ngày riêng: có dòng daily kèm phần lượt người dùng", JSON.stringify(dl));
const ui = src("ui/usageui.tsx");
ok(/daily: "Hôm nay · chi phí API"/.test(ui) && /daily: "Đặt lại lúc 0 giờ UTC\./.test(ui) && !/l\.key === "session" \? tr\("Phiên hiện tại"\) : tr\("Hằng tuần · mọi model"\)/.test(ui),
  "Cài đặt → Usage: dòng hạn mức ngày có tên và cách đặt lại riêng (không còn mượn chữ hằng tuần)");
ok(D.OPS_VI2EN?.["Đặt lại lúc 0 giờ UTC. Chỉ tính các lượt chạy bằng khóa API."] || en("Đặt lại lúc 0 giờ UTC. Chỉ tính các lượt chạy bằng khóa API."), "có bản tiếng Anh");

console.log(`\n${pass}/${pass + fail} đạt`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
