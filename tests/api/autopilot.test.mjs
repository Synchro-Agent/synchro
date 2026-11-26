// Autopilot (trước đây là Hộp thư), không cần máy chủ: lịch (một lần vào lúc hẹn, mỗi ngày, thứ Hai–thứ Sáu, mỗi tuần,
// cron) tính theo múi giờ của việc kể cả ngày đổi giờ mùa hè; lịch sai bị từ chối kèm lý do; tạm dừng / chạy tiếp tính
// lại lần chạy kế tiếp; lần chạy xong thành đúng một đoạn chat thường trong kho đồng bộ (hỏi tiếp được) và email khi
// người dùng bật; hướng dẫn cũ nhắc tên công cụ cũ được đổi sang tên mới. Thư mục dữ liệu tạm, không gọi model nào
// (lượt chạy được ghi thẳng vào bảng runs như lúc đã chạy xong).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-autopilot-"));
const MAIL = path.join(tmp, "mail");
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
process.env.MAIL_CAPTURE_DIR = MAIL;
process.env.APP_URL = "https://synchro.test";

const mods = await loadTs(["server/schedule", "tasks", "runs", "authstore", "chatstore"]);
const { "server/schedule": S, tasks: T, runs: R, authstore: A, chatstore: CS } = mods;
const HCM = "Asia/Ho_Chi_Minh";
const U = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);
const iso = (t) => (t === null ? "null" : new Date(t).toISOString());
const throws = (f) => { try { f(); return ""; } catch (e) { return String(e.message); } };
/** Lần chạy kế tiếp của lịch s sau thời điểm after phải đúng want (UTC). */
const next = (name, s, after, want) => {
  const got = S.nextRun(s, after);
  ok(got === want, name, `${iso(got)} ≠ ${iso(want)}`);
};
const daily = (time, tz = HCM) => ({ kind: "daily", time, tz });

console.log("1. Lịch theo múi giờ của việc");
{
  // 09:00 thứ Tư 25/11/2026 ở Việt Nam (UTC+7).
  const wed = U(2026, 11, 25, 2, 0);
  next("mỗi ngày 08:00 → 08:00 hôm sau giờ Việt Nam", daily("08:00"), wed, U(2026, 11, 26, 1, 0));
  const fri = U(2026, 11, 27, 2, 0);
  next("thứ Hai–thứ Sáu: sau sáng thứ Sáu là thứ Hai", { ...daily("08:00"), kind: "weekdays" }, fri,
    U(2026, 11, 30, 1, 0));
  next("mỗi tuần: Chủ nhật 20:30", { ...daily("20:30"), kind: "weekly", weekday: 0 }, wed, U(2026, 11, 29, 13, 30));
  const at = { kind: "once", at: "2026-12-01T08:30", tz: HCM };
  next("một lần vào lúc hẹn", at, wed, U(2026, 12, 1, 1, 30));
  ok(S.nextRun(at, wed, true) === null, "việc một lần đã chạy thì không còn lần nào");
  next("một lần, chạy ngay: đến hạn luôn", { kind: "once", tz: HCM }, wed, wed);
  next("mỗi 3 giờ", { kind: "hourly", every: 3, tz: HCM }, wed, wed + 3 * 3600_000);
  next("cron 8:30 và 17:30 ngày thường → 17:30 hôm nay", { kind: "cron", cron: "30 8,17 * * 1-5", tz: HCM }, wed,
    U(2026, 11, 25, 10, 30));
  next("cron 9:00 ngày 1 hằng tháng", { kind: "cron", cron: "0 9 1 * *", tz: HCM }, wed, U(2026, 12, 1, 2, 0));
  next("cron nhận tên thứ (SUN)", { kind: "cron", cron: "0 7 * * SUN", tz: HCM }, wed, U(2026, 11, 29, 0, 0));
  // Như Vixie cron: ngày "*/2" bắt đầu bằng "*" nên phải khớp cả ngày lẻ lẫn thứ Hai (7/12), không chạy mọi ngày lẻ
  // (25/11 là thứ Tư, ngày lẻ).
  next("cron ngày */2 và thứ Hai: phải khớp cả hai", { kind: "cron", cron: "0 9 */2 * 1", tz: HCM }, wed - 3600_000,
    U(2026, 12, 7, 2, 0));
  next("cron hạn chế cả ngày lẫn thứ (không *): khớp một trong hai", { kind: "cron", cron: "0 9 1,15 * 1", tz: HCM },
    wed, U(2026, 11, 30, 2, 0));
  // New York đổi sang giờ mùa hè lúc 2:00 ngày 8/3/2026: 08:00 hôm đó là 12:00 UTC (hôm trước là 13:00 UTC).
  next("ngày đổi giờ mùa hè vẫn đúng 08:00 địa phương", daily("08:00", "America/New_York"),
    U(2026, 3, 7, 20, 0), U(2026, 3, 8, 12, 0));
  const lt = S.localTime(HCM, U(2026, 11, 26, 1, 0));
  ok(lt === "08:00 Thứ Năm 26/11/2026", "giờ địa phương để hiện và gửi email", lt);
}

console.log("2. Lịch sai bị từ chối kèm lý do");
{
  const now = U(2026, 11, 25, 2, 0);
  const rejects = (name, s, re) => {
    const m = throws(() => S.checkSchedule(S.cleanSchedule(s), now));
    ok(re ? re.test(m) : m === "", name, m || "(không lỗi)");
  };
  rejects("cron chạy mỗi phút bị từ chối", { kind: "cron", cron: "* * * * *" }, /mỗi giờ một lần/);
  rejects("cron thiếu trường", { kind: "cron", cron: "0 8 * *" }, /5 trường/);
  rejects("giờ 25 không hợp lệ", { kind: "cron", cron: "0 25 * * *" }, /Trường giờ/);
  rejects("ngày 31/2 không bao giờ tới", { kind: "cron", cron: "0 9 31 2 *" }, /không có lần chạy/);
  rejects("giờ hẹn đã qua", { kind: "once", at: "2026-11-24T08:00", tz: HCM }, /đã qua/);
  rejects("cron hợp lệ (bước 2 giờ) không lỗi", { kind: "cron", cron: "0 */2 * * 1-5", tz: HCM }, null);
  const c = S.cleanSchedule({ kind: "once", at: "2026-12-01 08:30", tz: "Không/Có" });
  ok(c.at === "2026-12-01T08:30" && c.tz === HCM, "giờ hẹn viết cách nhận được; múi giờ lạ về Asia/Ho_Chi_Minh",
    JSON.stringify(c));
  ok(S.cleanSchedule({ kind: "lạ" }).kind === "once", "loại lịch lạ về mặc định, không ném lỗi");
}

console.log("3. Việc: tạo, tạm dừng, chạy tiếp, dữ liệu cũ");
const u = A.createUser({ email: "ap@autopilot.test", name: "Ap", verified: true });
const locked = A.createUser({ email: "locked@autopilot.test", name: "Lk", verified: false });
const d = A.db();
// Việc tạo từ bản trước (hướng dẫn do bộ lên kế hoạch viết, có tên công cụ cũ), ghi thẳng trước khi mô-đun việc mở
// lần đầu.
const OLD = "INSERT INTO tasks (id, owner, title, prompt, schedule, enabled, created_at)"
  + " VALUES ('old', ?, 'Cũ', ?, ?, 0, ?)";
d.prepare(OLD)
  .run(u.id, "Gửi đề xuất bằng inbox_propose khi cần.", JSON.stringify(daily("08:00")), Date.now());
{
  const old = T.listTasks(u.id).find((t) => t.id === "old");
  ok(old && /autopilot_propose/.test(old.prompt) && !/inbox_propose/.test(old.prompt),
    "hướng dẫn cũ đổi sang tên công cụ mới", old?.prompt);
  ok(old?.schedule.kind === "daily" && old.email === false, "việc cũ vẫn đọc được lịch, mặc định không gửi email",
    JSON.stringify(old?.schedule));
  const t = T.createTask(u.id, {
    title: "Tin sáng thứ Hai", prompt: "Tóm tắt tin công nghệ", schedule: { kind: "cron", cron: "0 7 * * 1", tz: HCM },
    email: true, lang: "en",
  });
  const p = S.parts(HCM, t.next_run_at);
  ok(t.email === true && t.schedule.kind === "cron" && !("notify" in t.schedule) && p.wd === 1 && p.h === 7
    && p.mi === 0,
    "cron 7:00 thứ Hai: lần tới đúng 07:00 thứ Hai giờ Việt Nam, bật email", JSON.stringify({ s: t.schedule, p }));
  ok(T.updateTask(u.id, t.id, { enabled: false }).enabled === false, "tạm dừng");
  const on = T.updateTask(u.id, t.id, { enabled: true });
  ok(on.enabled === true && on.next_run_at > Date.now() && on.email === true,
    "chạy tiếp: tính lại lần tới từ bây giờ, giữ email", JSON.stringify(on));
  const ed = T.updateTask(u.id, t.id, { schedule: { kind: "daily", time: "21:15", tz: HCM }, email: false });
  ok(ed.schedule.kind === "daily" && ed.schedule.time === "21:15" && ed.email === false, "sửa lịch và tắt email",
    JSON.stringify(ed));
  const past = { kind: "once", at: "2020-01-01T08:00", tz: HCM };
  const bad = throws(() => T.createTask(u.id, { title: "x", prompt: "y", schedule: past }));
  ok(/đã qua/.test(bad), "tạo việc với giờ hẹn đã qua: lỗi 400 kèm lý do", bad);

  // Việc một lần vào lúc hẹn đã chạy xong: bộ hẹn giờ tắt nó; giờ hẹn giờ đã ở quá khứ (ghi thẳng như lúc đã chạy).
  const one = T.createTask(u.id, {
    title: "Hẹn một lần", prompt: "Làm một lần", schedule: { kind: "once", at: "2099-01-01T09:00", tz: HCM },
  });
  d.prepare("UPDATE tasks SET schedule = ?, enabled = 0, next_run_at = NULL, last_run_at = ? WHERE id = ?")
    .run(JSON.stringify(past), Date.now() - 3600_000, one.id);
  const form = (extra) => ({ title: "Đổi tên", prompt: "Làm một lần", schedule: past, email: true, ...extra });
  const ren = throws(() => T.updateTask(u.id, one.id, form({})));
  const got = T.listTasks(u.id).find((x) => x.id === one.id);
  ok(ren === "" && got?.title === "Đổi tên" && got.email === true && got.enabled === false && got.next_run_at === null,
    "việc một lần đã chạy: form gửi lại đúng giờ hẹn cũ thì đổi tên, bật email được, không chạy lại",
    ren || JSON.stringify(got));
  const moved = throws(() => T.updateTask(u.id, one.id, form({ schedule: { kind: "once", at: "2020-02-01T08:00", tz: HCM } })));
  ok(/đã qua/.test(moved), "đổi sang một giờ hẹn khác cũng đã qua: vẫn bị từ chối", moved);
  const again = T.updateTask(u.id, one.id, form({ schedule: { kind: "once", at: "2099-03-01T08:00", tz: HCM } }));
  ok(again.enabled === true && again.next_run_at === S.atUtc({ at: "2099-03-01T08:00", tz: HCM }),
    "việc một lần đã chạy, chọn giờ hẹn mới: hẹn lại đúng giờ mới", JSON.stringify(again));

  // Việc hẹn giờ đang tạm dừng mà giờ hẹn đã qua (chưa chạy lần nào): bật lại thì báo giờ đã qua, không chạy ngay.
  const held = T.createTask(u.id, {
    title: "Tạm dừng", prompt: "Gửi tin", schedule: { kind: "once", at: "2099-01-01T09:00", tz: HCM },
  });
  d.prepare("UPDATE tasks SET schedule = ?, enabled = 0 WHERE id = ?").run(JSON.stringify(past), held.id);
  const resume = throws(() => T.updateTask(u.id, held.id, { enabled: true }));
  const still = T.listTasks(u.id).find((x) => x.id === held.id);
  ok(/đã qua/.test(resume) && still?.enabled === false, "bật lại việc hẹn giờ đã qua: báo lý do, vẫn tạm dừng",
    resume || JSON.stringify(still));

  // Việc mỗi 3 giờ: sửa tên (form gửi lại lịch y nguyên) không lùi lần chạy kế tiếp.
  const hr = T.createTask(u.id, { title: "Mỗi 3 giờ", prompt: "Kiểm tra", schedule: { kind: "hourly", every: 3, tz: HCM } });
  const renamed = T.updateTask(u.id, hr.id, { title: "Mỗi 3 giờ (mới)", schedule: { tz: HCM, every: 3, kind: "hourly" } });
  ok(renamed.next_run_at === hr.next_run_at && renamed.title === "Mỗi 3 giờ (mới)",
    "sửa tên, lịch không đổi: giữ nguyên lần chạy kế tiếp", `${hr.next_run_at} → ${renamed.next_run_at}`);
}

console.log("4. Lần chạy xong → đoạn chat thường để hỏi tiếp, thông báo, email");
const run = (id, uid, status, result, at) =>
  d.prepare("INSERT INTO runs (id, user_id, kind, status, result, created_at, updated_at)"
    + " VALUES (?, ?, 'chat', ?, ?, ?, ?)")
    .run(id, uid, status, JSON.stringify(result), at, at + 30_000);
const row = (id, task, uid, at, title) =>
  d.prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at, kind) VALUES (?, ?, ?, ?, ?, 'run')")
    .run(id, task, uid, title, at);
const chats = (uid) => d.prepare("SELECT id, data FROM user_items WHERE user_id = ? AND kind = 'chat' AND deleted = 0")
  .all(uid);
const mails = () => (fs.existsSync(MAIL) ? fs.readdirSync(MAIL) : [])
  .map((f) => JSON.parse(fs.readFileSync(path.join(MAIL, f), "utf8")));
const tick = () => new Promise((r) => setTimeout(r, 50));
R.getRun(""); // tạo bảng runs
{
  const t = T.createTask(u.id, {
    title: "Giá vàng", prompt: "Giá vàng SJC hôm nay", schedule: { kind: "daily", time: "08:00", tz: HCM }, email: true,
    lang: "en",
  });
  const at = Date.now() - 60_000;
  const sources = [{ url: "https://sjc.com.vn", title: "SJC" }];
  const text = "Giá vàng **tăng** 1%.\n\nNguồn: sjc.com.vn";
  run("r1", u.id, "done", { text, model: "mock/a", auto: true, sources }, at);
  row("r1", t.id, u.id, at, "Giá vàng");
  T.archiveInbox();
  const it = T.inbox(u.id).items.find((x) => x.run === "r1");
  const cs = chats(u.id);
  ok(cs.length === 1 && it?.chat === Number(cs[0].id),
    "kết quả thành đúng một đoạn chat, dòng kết quả nhớ mã đoạn chat", JSON.stringify({ n: cs.length, it }));
  const c = JSON.parse(cs[0]?.data ?? "{}");
  ok(c.tags?.includes("Autopilot") && c.title?.startsWith("Giá vàng") && c.named === true,
    "đoạn chat có thẻ Autopilot, tên theo việc", JSON.stringify(c).slice(0, 300));
  const [ask, ans] = c.msgs ?? [];
  ok(ask?.role === "user" && ask.text === "Giá vàng SJC hôm nay" && ans?.role === "ai" && ans.done === true
    && /tăng/.test(ans.text) && ans.via === "mock/a" && ans.webs?.length === 1,
  "tin của người dùng là yêu cầu của việc, câu trả lời là kết quả như một lượt chat (model, nguồn)",
  JSON.stringify(c.msgs).slice(0, 400));
  T.archiveInbox(); T.inbox(u.id);
  ok(chats(u.id).length === 1, "nhịp hẹn giờ và trang Autopilot cùng đọc lại không tạo thêm đoạn chat");
  const last = T.listTasks(u.id).find((x) => x.id === t.id)?.last;
  ok(last?.chat === Number(cs[0].id), "thẻ việc có nút mở kết quả gần nhất (last.chat)", JSON.stringify(last));
  const cnt = T.inboxCount(u.id);
  const f1 = cnt.fresh.find((x) => x.run === "r1");
  ok(cnt.unread >= 1 && f1?.kind === "task" && f1.status === "done" && f1.chat === Number(cs[0].id),
    "số đếm có kết quả mới để thông báo trong app: loại, trạng thái và đoạn chat để mở thẳng", JSON.stringify(cnt));
  await tick();
  const m = mails().find((x) => x.to === u.email && /finished/.test(x.subject));
  ok(!!m && m.subject === "Autopilot finished: Giá vàng" && m.text.includes(`https://synchro.test/#c=${cs[0].id}`)
    && !/\*\*/.test(m.text),
  "email (tiếng Anh như lúc đặt): tóm tắt không còn ký hiệu Markdown, nút mở đúng đoạn chat",
  JSON.stringify(m).slice(0, 400));

  // Lần lỗi đầu: bộ hẹn giờ sẽ tự chạy lại (tối đa MAX_RETRY lần) nên chưa báo gì.
  const at2 = Date.now() - 30_000;
  run("r2", u.id, "error", { error: "fetch failed" }, at2);
  row("r2", t.id, u.id, at2, "Giá vàng");
  T.archiveInbox();
  ok(chats(u.id).length === 1 && !T.inbox(u.id).items.find((x) => x.run === "r2")?.chat,
    "lần chạy lỗi không tạo đoạn chat");
  await tick();
  const errMails = () => mails().filter((x) => /error/.test(x.subject));
  const c2 = T.inboxCount(u.id);
  ok(errMails().length === 0 && !c2.fresh.some((x) => x.run === "r2"),
    "lỗi còn được tự chạy lại: chưa gửi email, chưa thông báo trong app", JSON.stringify({ m: errMails(), c2 }));
  // Lần thử cuối (đã tự chạy lại MAX_RETRY lần) vẫn lỗi: một email, nói đã tự thử lại.
  d.prepare("UPDATE task_runs SET retried = 1 WHERE run_id = 'r2'").run();
  d.prepare("UPDATE tasks SET retries = ? WHERE id = ?").run(T.MAX_RETRY, t.id);
  const at4 = Date.now() - 25_000;
  run("r4", u.id, "error", { error: "fetch failed" }, at4);
  row("r4", t.id, u.id, at4, "Giá vàng");
  T.archiveInbox();
  await tick();
  const e = errMails();
  ok(e.length === 1 && e[0].text.includes("https://synchro.test/#v=autopilot")
    && /retried it 2 times/.test(e[0].html),
  "lần thử cuối vẫn lỗi: đúng một email báo lỗi, nói đã tự chạy lại, nút mở Autopilot", JSON.stringify(e).slice(0, 400));
  const f4 = T.inboxCount(u.id).fresh.find((x) => x.run === "r4");
  ok(f4?.status === "error" && f4.kind === "task" && f4.chat === undefined, "thông báo trong app ghi đúng là lỗi",
    JSON.stringify(f4));
  // Hết hạn mức: không chạy lại nên báo ngay ở lần đầu.
  d.prepare("UPDATE tasks SET retries = 0 WHERE id = ?").run(t.id);
  const at5 = Date.now() - 20_000;
  run("r5", u.id, "error", { error: "Hết hạn mức", usageLimit: true }, at5);
  row("r5", t.id, u.id, at5, "Giá vàng");
  T.archiveInbox();
  await tick();
  ok(errMails().length === 2, "hết hạn mức (không tự chạy lại): báo ngay", errMails().length);
  T.addNotice(u.id, "Synchro đã thêm model mới", "Có model mới");
  const nt = T.inboxCount(u.id).fresh.find((x) => x.title === "Synchro đã thêm model mới");
  ok(nt?.kind === "notice", "thông báo của Synchro có loại notice (không báo thành \"Autopilot đã xong\")",
    JSON.stringify(nt));

  const once = { kind: "once", tz: HCM };
  const t2 = T.createTask(locked.id, { title: "Chưa xác minh", prompt: "Việc", schedule: once, email: true });
  const at3 = Date.now() - 20_000;
  run("r3", locked.id, "done", { text: "Xong" }, at3);
  row("r3", t2.id, locked.id, at3, "Chưa xác minh");
  T.archiveInbox();
  await tick();
  ok(chats(locked.id).length === 1, "tài khoản chưa xác minh email vẫn nhận đoạn chat kết quả");
  ok(!mails().some((x) => x.to === locked.email), "nhưng không nhận email (chỉ email đã xác minh)");
  const ib = CS.itemsByKey(u.id, [`chat:${cs[0].id}`]);
  ok(ib.length === 1 && ib[0].rev >= 1, "thiết bị xin đúng đoạn chat theo mã (needChats) lấy được từ kho đồng bộ",
    JSON.stringify(ib.map((x) => x.id)));
}

console.log(`\n${pass}/${pass + fail} đạt`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
