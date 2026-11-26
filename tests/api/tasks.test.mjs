// Autopilot: lịch theo múi giờ, tác vụ một lần tự chạy, chạy ngay, kết quả chưa đọc / đã đọc, đoạn chat kết quả,
// địa chỉ cũ của Hộp thư, bật tắt, quyền, xóa.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const a = client(), b = client();
for (const [c, email] of [[a, "task-a@synchro.test"], [b, "task-b@synchro.test"]]) {
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: email.split("@")[0], birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
}
// Dọn tác vụ của lần chạy trước, đánh dấu đã đọc hết.
for (const t of (await a("GET", "/api/tasks")).j?.tasks ?? []) await a("DELETE", `/api/tasks/${t.id}`);
const MODEL = "anthropic/claude-haiku-5-5";
const TZ = "Asia/Ho_Chi_Minh";

console.log("1. Lịch chạy theo múi giờ");
let r = await a("POST", "/api/tasks", { title: "Bản tin buổi sáng", prompt: "Tóm tắt việc cần làm hôm nay", schedule: { kind: "daily", time: "08:00", tz: TZ }, model: MODEL });
ok(r.s === 200 && r.j.task.enabled, "tạo tác vụ mỗi ngày lúc 08:00", JSON.stringify(r.j));
const daily = r.j.task;
const nx = new Date(daily.next_run_at);
const local = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(nx);
ok(local === "08:00" && daily.next_run_at > Date.now() && daily.next_run_at - Date.now() <= 24 * 3600_000, `lần chạy kế tiếp đúng 08:00 giờ Việt Nam, trong vòng 24 giờ (${nx.toISOString()})`, local);
r = await a("POST", "/api/tasks", { title: "Tổng kết tuần", prompt: "Tổng kết tuần", schedule: { kind: "weekly", weekday: 5, time: "17:00", tz: TZ }, model: MODEL });
const wk = new Date(r.j.task.next_run_at);
const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(wk), hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(wk);
ok(wd === "Fri" && hm === "17:00", `mỗi tuần: thứ Sáu 17:00 (${wd} ${hm})`);
r = await a("POST", "/api/tasks", { title: "", prompt: "x", schedule: { kind: "daily" } });
ok(r.s === 400, "thiếu tên → báo lỗi");

console.log("2. Tác vụ một lần tự chạy, kết quả vào Autopilot");
r = await a("POST", "/api/tasks", { title: "Kể về cà phê", prompt: "Kể ngắn về lịch sử cà phê", schedule: { kind: "once", tz: TZ }, model: MODEL });
const once = r.j.task;
let box = null;
for (let i = 0; i < 40; i++) { box = (await a("GET", "/api/autopilot")).j; if (box.items.some((x) => x.task === once.id
  && x.status === "done")) break; await sleep(1000); }
const it = box.items.find((x) => x.task === once.id);
ok(it?.status === "done" && it.text.length > 20, "bộ hẹn giờ tự chạy tác vụ, kết quả có trong Autopilot",
  JSON.stringify(it).slice(0, 300));
ok(box.unread >= 1 && !it.read, `đếm chưa đọc: ${box.unread}`);
r = (await a("GET", "/api/tasks")).j.tasks.find((x) => x.id === once.id);
ok(r && !r.enabled && r.next_run_at === null && r.runs === 1, "tác vụ một lần chạy xong thì tự tắt, không chạy lại", JSON.stringify(r));
await sleep(5000);
ok((await a("GET", "/api/autopilot")).j.items.filter((x) => x.task === once.id).length === 1, "không bị chạy hai lần");
r = await a("POST", "/api/autopilot", { read: [it.run] });
ok(r.j.items.find((x) => x.run === it.run).read && r.j.unread === box.unread - 1, "đánh dấu đã đọc");
// Kết quả thành đoạn chat thường trong kho đồng bộ (mọi thiết bị nhận về, mở ra hỏi tiếp được).
const kept = (await a("GET", `/api/chats?keys=chat:${it.chat}`)).j?.items?.[0];
const conv = kept?.data ? JSON.parse(kept.data) : null;
const ans = conv?.msgs?.[1];
ok(typeof it.chat === "number" && conv?.tags?.includes("Autopilot") && ans?.role === "ai" && ans.text === it.text,
  "kết quả thành đoạn chat thường có thẻ Autopilot, cùng nội dung",
  JSON.stringify({ chat: it.chat, conv }).slice(0, 300));
// Địa chỉ cũ của Hộp thư vẫn trả đúng dữ liệu (trang mở từ bản trước, kịch bản của người dùng).
const legacy = (await a("GET", "/api/inbox")).j;
ok(legacy?.items?.some((x) => x.run === it.run && x.chat === it.chat), "địa chỉ cũ /api/inbox vẫn trả cùng dữ liệu");

console.log("3. Chạy ngay, bật / tắt");
r = await a("POST", `/api/tasks/${daily.id}/run`);
ok(r.s === 200 && /^run_/.test(r.j.run), "chạy ngay trả về mã lượt chạy", JSON.stringify(r.j));
for (let i = 0; i < 30; i++) { box = (await a("GET", "/api/autopilot")).j; if (box.items.some((x) => x.run === r.j.run
  && x.status !== "running")) break; await sleep(1000); }
ok(box.items.find((x) => x.run === r.j.run)?.status === "done", "kết quả chạy ngay vào Autopilot");
const same = (await a("GET", "/api/tasks")).j.tasks.find((x) => x.id === daily.id);
ok(same.next_run_at === daily.next_run_at, "chạy ngay không đổi lịch hẹn");
r = await a("PATCH", `/api/tasks/${daily.id}`, { enabled: false });
ok(r.s === 200 && !r.j.task.enabled, "tắt lịch");
r = await a("PATCH", `/api/tasks/${daily.id}`, { schedule: { kind: "hourly", tz: TZ }, enabled: true });
ok(r.j.task.enabled && Math.abs(r.j.task.next_run_at - Date.now() - 3600_000) < 60_000, "đổi sang mỗi giờ và bật lại: lần tới sau 1 giờ");

console.log("4. Quyền và xóa");
ok((await b("GET", "/api/tasks")).j.tasks.every((x) => x.id !== daily.id), "tài khoản khác không thấy tác vụ");
ok((await b("PATCH", `/api/tasks/${daily.id}`, { enabled: false })).s === 404 && (await b("POST", `/api/tasks/${daily.id}/run`)).s === 404 && (await b("DELETE", `/api/tasks/${daily.id}`)).s === 404, "tài khoản khác không sửa, chạy hay xóa được");
ok((await b("GET", "/api/autopilot")).j.items.every((x) => x.task !== once.id), "Autopilot của ai người nấy xem");
r = await a("DELETE", `/api/tasks/${once.id}`);
ok(r.s === 200 && (await a("GET", "/api/autopilot")).j.items.every((x) => x.task !== once.id),
  "xóa tác vụ thì kết quả của nó cũng rời Autopilot");
ok((await fetch(`${B}/api/tasks`)).status === 401, "chưa đăng nhập → 401");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
