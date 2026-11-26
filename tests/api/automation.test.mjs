// Autopilot tự động hóa: giao việc bằng câu thường → kế hoạch; việc chạy nền ở máy chủ (không cần trang mở) với đủ công
// cụ, nhớ kết quả cũ; đề xuất chờ duyệt (tạo skill, hành động, trang web mới) → người dùng duyệt thì Synchro làm;
// Chrome của người dùng: chờ Chrome kết nối rồi chạy, chờ quá lâu thì chạy bằng trình duyệt của Synchro; lỗi thì tự
// chạy lại; quyền sở hữu; /api/llm không nhận thông tin việc tự động.
// dev:mock đặt SYNCHRO_TASK_TICK_MS=3000, SYNCHRO_TASK_RETRY_MS=4000, SYNCHRO_CHROME_WAIT_MS=30000.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findChrome } from "../../tools/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010", PAGE = `${MOCK}/_fixture/browser-quiz`;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  return async (method, p, body, headers = {}) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), a = client(), b = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
for (const [c, email] of [[a, "auto-a@synchro.test"], [b, "auto-b@synchro.test"]]) {
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: email.split("@")[0], birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
}
// Đủ quyền (Synchro Code + Cloud sandbox để có trình duyệt của Synchro, skill, connector).
const rowA = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "auto-a@synchro.test");
await admin("PATCH", `/api/admin/users/${rowA.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(rowA.perms.features).map((k) => [k, true])) } });
// Dọn việc của lần chạy trước (xóa việc thì xóa luôn đề xuất còn chờ), gỡ trình duyệt đã ghép nối, trả cài đặt trang web về mặc định.
for (const t of (await a("GET", "/api/tasks")).j?.tasks ?? []) await a("DELETE", `/api/tasks/${t.id}`);
for (const p of (await a("GET", "/api/autopilot/proposals")).j?.proposals ?? []) await a("POST",
  "/api/autopilot/proposals", { id: p.id, decision: "reject" });
for (const d of (await a("GET", "/api/browser/ext")).j?.devices ?? []) await a("POST", "/api/browser/ext", { op: "remove", id: d.id });
await a("PATCH", "/api/code/prefs", { siteAsk: false, sites: [], blocked: [] });
await a("POST", "/api/autopilot", { read: "all" });
// Bộ não của tài khoản thử bắt đầu trống (ghi chú cũ được nhắc lại vào lượt chạy sẽ làm lệch kịch bản của model giả).
await a("DELETE", "/api/brain");
const M = "anthropic/claude-haiku-5-5", TZ = "Asia/Ho_Chi_Minh";
// Tên riêng cho mỗi lần chạy kiểm thử (đề xuất đã duyệt / bỏ qua của lần trước vẫn được tính là trùng).
const TAG = Date.now().toString(36), SK = `repo-radar-${TAG}`, MAIL = `Gửi bản tin cho nhóm ${TAG}`, POST = `Đăng bài lên mạng xã hội ${TAG}`, HOST = `news-${TAG}.example.org`;
const hist = async () => (await fetch(`${MOCK}/_debug/hist`)).json();
// Yêu cầu gần nhất khớp re; auto: chỉ lượt chạy của việc tự động (bỏ qua lời gọi chạy nền khác như đặt tên, bộ não chép lại cả đoạn chat).
const reqWith = async (re, auto = true) => [...((await hist()).anthropic ?? [])].reverse().find((x) => (!auto || /<automation>/.test(JSON.stringify(x.system ?? ""))) && re.test(JSON.stringify(x)));
const itemsOf = async (taskId) => ((await a("GET", "/api/autopilot")).j?.items ?? []).filter((x) => x.task === taskId);
async function until(f, ms = 40_000, step = 1000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await sleep(step); } return v; }
const fmt = (t, o) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", ...o }).format(new Date(t));

console.log("1. Lịch mới: các ngày làm việc, mỗi N giờ; trình duyệt và nhớ kết quả cũ");
let r = await a("POST", "/api/tasks", { title: "Giá cổ phiếu", prompt: "Tra giá FPT", schedule: { kind: "weekdays", time: "08:30", tz: TZ }, model: M });
const wd = r.j?.task;
ok(r.s === 200 && wd.schedule.kind === "weekdays" && fmt(wd.next_run_at, { hour: "2-digit", minute: "2-digit" }) === "08:30" && !["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(wd.next_run_at))), `thứ Hai – thứ Sáu 08:30, không rơi vào cuối tuần (${new Date(wd.next_run_at).toISOString()})`, JSON.stringify(r.j));
ok(wd.browser === "auto" && wd.memory === true && wd.pending === 0 && wd.last === null, "mặc định: trình duyệt tự chọn, nhớ kết quả cũ", JSON.stringify(wd));
r = await a("POST", "/api/tasks", { title: "Giá iPhone", prompt: "Kiểm tra giá", schedule: { kind: "hourly", every: 3, tz: TZ }, browser: "lung-tung", model: M });
ok(r.s === 200 && r.j.task.schedule.every === 3 && Math.abs(r.j.task.next_run_at - Date.now() - 3 * 3600_000) < 60_000 && r.j.task.browser === "auto", "mỗi 3 giờ; trình duyệt không hợp lệ → tự chọn", JSON.stringify(r.j));
r = await a("PATCH", `/api/tasks/${r.j.task.id}`, { browser: "synchro", memory: false });
ok(r.j?.task?.browser === "synchro" && r.j.task.memory === false, "sửa trình duyệt và tắt nhớ", JSON.stringify(r.j));
for (const t of (await a("GET", "/api/tasks")).j.tasks) await a("DELETE", `/api/tasks/${t.id}`);

console.log("2. Giao việc bằng câu thường → kế hoạch (model nhanh lên kế hoạch, chưa tạo việc)");
r = await a("POST", "/api/tasks/plan", { text: "Thứ Hai đến thứ Sáu lúc 8h30 sáng, tra giá cổ phiếu FPT và VNM, phân tích xu hướng và đưa ra gợi ý giao dịch", tz: TZ });
let p = r.j?.plan;
ok(r.s === 200 && p.schedule.kind === "weekdays" && p.schedule.time === "08:30" && p.schedule.tz === TZ && p.browser === "auto" && /FPT/.test(p.prompt) && p.title, "giá cổ phiếu: thứ Hai – thứ Sáu 08:30, hướng dẫn chi tiết", JSON.stringify(r.j));
// Model nhanh lên kế hoạch do chế độ Tự động chọn, có thể thuộc hãng bất kỳ (tùy hạn mức còn lại sau các bộ kiểm trước): tìm ở mọi hãng.
const planReq = Object.values(await hist()).flat().reverse().find((x) => x && /<automation_plan>/.test(JSON.stringify(x)));
ok(!!planReq && /Việc cần tự động hóa:/.test(JSON.stringify(planReq.messages ?? planReq.input ?? planReq.contents ?? planReq)), "lời giao việc tới model kèm hướng dẫn lên kế hoạch", JSON.stringify(planReq ?? {}).slice(0, 200));
r = await a("POST", "/api/tasks/plan", { text: "Mỗi ngày lúc 7h sáng lên GitHub tìm những repo có ý tưởng hay, đột phá, phân tích rồi chuyển repo đáng giá nhất thành skill (hỏi tôi trước khi tạo)", tz: TZ });
p = r.j?.plan;
ok(r.s === 200 && p.schedule.kind === "daily" && p.schedule.time === "07:00" && p.approvals.length > 0
  && /autopilot_propose/.test(p.prompt), "repo GitHub → skill: mỗi ngày 07:00, có bước chờ duyệt", JSON.stringify(r.j));
r = await a("POST", "/api/tasks/plan", { text: "Mỗi tối 9h đọc hộp thư Gmail của tôi và tóm tắt email quan trọng", tz: TZ });
ok(r.j?.plan?.browser === "user" && r.j.plan.schedule.time === "21:00", "việc cần tài khoản của người dùng → Chrome của bạn, 21:00", JSON.stringify(r.j));
ok((await a("POST", "/api/tasks/plan", { text: "  ", tz: TZ })).s === 400, "lời giao việc trống → 400");
ok(((await a("GET", "/api/tasks")).j?.tasks ?? []).length === 0, "lên kế hoạch chưa tạo việc nào");

console.log("3. Việc chạy nền ở máy chủ: đủ công cụ, gửi đề xuất chờ duyệt thay vì tự làm");
const SKILL = `---\nname: ${SK}\ndescription: Dùng khi cần tóm tắt nhanh một repo GitHub mới và đánh giá ý tưởng của nó.\n---\n# Repo radar\n\n1. Đọc README.\n2. Tóm tắt ý tưởng chính.\n`;
const SEQ = [
  { tool: "autopilot_propose", args: { kind: "skill", title: "Repo Radar",
    summary: "Repo **radar** tóm tắt repo mới rất nhanh.", source: "https://github.com/example/radar", skill_md: SKILL,
    files: [{ path: "references/notes.md", content: "# Ghi chú\nNguồn: radar" }] } },
  { tool: "autopilot_propose", args: { kind: "action", title: MAIL, summary: "Gửi bản tóm tắt repo cho nhóm qua email.",
    instructions: "Soạn bản tin 3 dòng về repo radar và báo lại nội dung." } },
  { tool: "autopilot_propose", args: { kind: "action", title: POST, summary: "Đăng bài giới thiệu repo.",
    instructions: "Đăng bài." } },
  { tool: "autopilot_propose", args: { kind: "skill", title: "Hỏng", summary: "SKILL.md sai định dạng",
    skill_md: "không có frontmatter" } },
];
r = await a("POST", "/api/tasks", { title: "Repo GitHub hay", prompt: `Tìm repo hay trên GitHub #seq=${JSON.stringify(SEQ)}`, schedule: { kind: "once", tz: TZ }, model: M });
const job = r.j?.task;
let it = await until(async () => (await itemsOf(job.id)).find((x) => x.status !== "running"));
ok(it?.status === "done", "bộ hẹn giờ tự chạy việc, không cần trang mở", JSON.stringify(it).slice(0, 300));
ok(it?.proposals === 3 && /SKILL\.md chưa đúng/.test(it.text),
  "3 đề xuất hợp lệ vào Autopilot; SKILL.md sai thì model được báo để sửa", JSON.stringify(it).slice(0, 400));
const runReq = await reqWith(/<automation>[\s\S]*Repo GitHub hay/);
const sys = JSON.stringify(runReq?.system ?? "");
ok(/<automation>/.test(sys) && /<automation_tools>/.test(sys) && /trình duyệt của Synchro/.test(sys)
  && runReq.tools.some((t) => t.name === "autopilot_propose")
  && runReq.tools.some((t) => /^web_search_/.test(t.type ?? "")),
  "model nhận bối cảnh việc tự động, công cụ đề xuất, tìm web, hướng dẫn trình duyệt", sys.slice(0, 300));
ok(runReq?.tools.some((t) => t.name === "browser_navigate"), "có công cụ trình duyệt (trình duyệt của Synchro trên máy chủ)");
let box = (await a("GET", "/api/autopilot")).j;
ok(box.pending === 3 && box.unread >= 1, `Autopilot: ${box.pending} chờ duyệt, ${box.unread} chưa đọc`,
  JSON.stringify({ pending: box.pending, unread: box.unread }));
let props = (await a("GET", "/api/autopilot/proposals")).j.proposals;
const pSkill = props.find((x) => x.kind === "skill"), pMail = props.find((x) => x.title === MAIL), pPost = props.find((x) => x.title === POST);
ok(pSkill?.title === SK && pSkill.taskTitle === "Repo GitHub hay" && pSkill.payload.source === "https://github.com/example/radar" && pSkill.payload.files.length === 1 && pSkill.run === it.run, "đề xuất skill: tên theo SKILL.md, nguồn, tệp kèm, gắn với lần chạy", JSON.stringify(pSkill).slice(0, 300));
ok(((await a("GET", `/api/autopilot/proposals?run=${it.run}`)).j.proposals ?? []).length === 3,
  "đề xuất theo từng lần chạy");
ok(((await a("GET", "/api/skills")).j?.skills ?? []).every((s) => s.name !== SK), "chưa duyệt thì chưa tạo skill");
let jobs = (await a("GET", "/api/tasks")).j.tasks;
ok(jobs.find((t) => t.id === job.id)?.pending === 3 && jobs.find((t) => t.id === job.id)?.last?.status === "done", "danh sách việc: số đề xuất chờ duyệt, lần chạy gần nhất", JSON.stringify(jobs[0]).slice(0, 300));

console.log("4. Nhớ kết quả cũ và đề xuất đã gửi (không đề xuất lại)");
r = await a("POST", `/api/tasks/${job.id}/run`);
const run2 = r.j?.run;
it = await until(async () => (await itemsOf(job.id)).find((x) => x.run === run2 && x.status !== "running"));
const req2 = await reqWith(/<previous_runs>/);
const msg2 = JSON.stringify(req2?.messages?.[0] ?? "");
ok(/<previous_runs>/.test(msg2) && /Lần chạy lúc/.test(msg2) && msg2.includes(`[chờ duyệt] Skill: ${SK}`), "lần sau nhận kết quả lần trước và các đề xuất đã gửi", msg2.slice(0, 400));
ok(/Lần chạy thứ 2/.test(JSON.stringify(req2?.system ?? "")), "biết đây là lần chạy thứ mấy");
ok(it?.status === "done" && !it.proposals && /đã có trong mục Cần duyệt của Autopilot/.test(it.text) && (await a("GET",
  "/api/autopilot")).j.pending === 3, "đề xuất trùng không gửi lại", JSON.stringify(it).slice(0, 300));

console.log("5. Duyệt đề xuất: Synchro làm ngay; người khác không duyệt được");
ok((await b("POST", "/api/autopilot/proposals", { id: pSkill.id, decision: "approve" })).s === 404 && ((await b("GET",
  "/api/autopilot/proposals")).j.proposals ?? []).length === 0, "tài khoản khác không thấy, không duyệt được");
ok((await a("POST", "/api/autopilot/proposals", { id: pSkill.id, decision: "approve" },
  { origin: "https://evil.example" })).s === 403, "duyệt từ trang khác (CSRF) → 403");
const edited = SKILL.replace("2. Tóm tắt ý tưởng chính.", "2. Tóm tắt ý tưởng chính.\n3. Chấm điểm độ đột phá 1–10.");
r = await a("POST", "/api/autopilot/proposals", { id: pSkill.id, decision: "approve", edits: { skill_md: edited } });
ok(r.s === 200 && r.j.proposal.status === "done" && r.j.proposal.result?.includes(`Đã tạo skill ${SK}`), "duyệt skill (đã sửa SKILL.md) → tạo skill ngay", JSON.stringify(r.j).slice(0, 300));
const sk = ((await a("GET", "/api/skills")).j?.skills ?? []).find((s) => s.name === SK);
const body = (await a("GET", `/api/skills/${SK}`)).j?.skill;
ok(sk && sk.enabled !== false && (body?.files ?? []).some((f) => f.path === "references/notes.md"), "skill có trong danh sách, đang bật, kèm tệp references/notes.md", JSON.stringify({ sk, files: body?.files }).slice(0, 300));
ok(/Chấm điểm độ đột phá/.test(body?.body ?? ""), "nội dung skill là bản người dùng đã sửa", JSON.stringify(body).slice(0, 200));
ok((await a("POST", "/api/autopilot/proposals", { id: pSkill.id, decision: "approve" })).s === 409,
  "duyệt lại lần nữa → 409, không tạo hai lần");
r = await a("POST", "/api/autopilot/proposals", { id: pMail.id, decision: "approve" });
ok(r.s === 200 && r.j.proposal.status === "done" && /^run_/.test(r.j.run ?? ""), "duyệt hành động → Synchro chạy việc đó ngay", JSON.stringify(r.j).slice(0, 300));
it = await until(async () => (await itemsOf(job.id)).find((x) => x.run === r.j.run && x.status !== "running"));
const actReq = await reqWith(new RegExp(`Người dùng đã duyệt đề xuất \\\\"${MAIL}\\\\"`));
ok(it?.status === "done" && it.kind === "action" && it.title === `Đã duyệt: ${MAIL}` && !!actReq
  && /Soạn bản tin 3 dòng/.test(JSON.stringify(actReq.messages)),
  "kết quả việc đã duyệt vào Autopilot; model nhận đúng việc được duyệt", JSON.stringify(it).slice(0, 300));
r = await a("POST", "/api/autopilot/proposals", { id: pPost.id, decision: "reject" });
ok(r.s === 200 && r.j.proposal.status === "rejected", "bỏ qua đề xuất", JSON.stringify(r.j));
box = (await a("GET", "/api/autopilot")).j;
ok(box.pending === 0, "hết đề xuất chờ duyệt", box.pending);
props = (await a("GET", "/api/autopilot/proposals?all=1")).j.proposals;
ok(props.filter((x) => x.task === job.id).map((x) => x.status).sort().join(",") === "done,done,rejected", "lịch sử đề xuất: đã duyệt / đã bỏ qua", JSON.stringify(props.map((x) => [x.title, x.status])));
await a("POST", `/api/tasks/${job.id}/run`);
await until(async () => (await itemsOf(job.id)).filter((x) => x.kind === "task").length === 3 && (await itemsOf(job.id)).every((x) => x.status !== "running"));
const req3 = await reqWith(new RegExp(`\\[người dùng bỏ qua\\] ${POST}`));
ok(!!req3 && JSON.stringify(req3.messages).includes(`[đã duyệt] Skill: ${SK}`), "lần chạy sau biết đề xuất nào đã duyệt, đã bỏ qua");

console.log("6. Trang web chưa được phép trong lượt chạy nền → đề xuất cho phép trang (không treo chờ hỏi)");
await a("PATCH", "/api/code/prefs", { siteAsk: true, sites: [], blocked: [] });
r = await a("POST", "/api/tasks", { title: "Đọc tin", prompt: `#browser mở https://${HOST}/hom-nay rồi tóm tắt`, schedule: { kind: "once", tz: TZ }, model: M, browser: "synchro" });
const siteJob = r.j.task;
const t0 = Date.now();
it = await until(async () => (await itemsOf(siteJob.id)).find((x) => x.status !== "running"));
ok(it?.status === "done" && /chưa có trong danh sách trang được phép/.test(it.text) && Date.now() - t0 < 30_000, "lượt chạy không treo: model được báo, làm tiếp bằng nguồn khác", JSON.stringify(it).slice(0, 300));
const pSite = (await a("GET", "/api/autopilot/proposals")).j.proposals.find((x) => x.kind === "site");
ok(pSite?.payload.host === HOST && pSite.task === siteJob.id, "đề xuất cho phép trang mới", JSON.stringify(pSite));
r = await a("POST", "/api/autopilot/proposals", { id: pSite.id, decision: "approve" });
ok(r.s === 200 && ((await a("GET", "/api/code/prefs")).j?.sites ?? []).includes(HOST), "duyệt → trang vào danh sách được phép, lần sau dùng được", JSON.stringify(r.j));
await a("PATCH", "/api/code/prefs", { siteAsk: false, sites: [], blocked: [] });

console.log("7. Lỗi thì tự chạy lại (tối đa 2 lần)");
r = await a("POST", "/api/tasks", { title: "Hay lỗi", prompt: "Kiểm tra #500", schedule: { kind: "once", tz: TZ }, model: M });
const errJob = r.j.task;
const tries = await until(async () => { const l = await itemsOf(errJob.id); return l.length >= 3 && l.every((x) => x.status === "error") ? l : null; }, 60_000);
ok(tries?.length === 3 && tries.some((x) => /Thử lại lần 1\/2/.test(x.note ?? "")) && tries.some((x) => /Thử lại lần 2\/2/.test(x.note ?? "")), "lỗi → chạy lại 2 lần, ghi rõ lần thử", JSON.stringify((tries ?? []).map((x) => [x.status, x.note])));
await sleep(9000);
ok((await itemsOf(errJob.id)).length === 3, "hết 2 lần thử thì thôi, không chạy lại mãi");

console.log("8. Việc dùng Chrome của bạn: Chrome đang tắt thì chờ, quá lâu thì chạy bằng trình duyệt của Synchro");
r = await a("POST", "/api/tasks", { title: "Việc trên Chrome", prompt: "Tóm tắt trang đang mở", schedule: { kind: "weekly", weekday: 1, time: "08:00", tz: TZ }, model: M, browser: "user" });
const chromeJob = r.j.task;
r = await a("POST", `/api/tasks/${chromeJob.id}/run`);
ok(r.s === 409 && /Chrome chưa kết nối/.test(r.j?.error ?? ""), "chạy ngay khi Chrome chưa kết nối → báo rõ", JSON.stringify(r.j));
await a("DELETE", `/api/tasks/${chromeJob.id}`);
r = await a("POST", "/api/tasks", { title: "Chờ Chrome", prompt: "Đọc trang tin trên Chrome của tôi", schedule: { kind: "once", tz: TZ }, model: M, browser: "user" });
const waitJob = r.j.task;
const w = await until(async () => (await itemsOf(waitJob.id)).find((x) => x.status === "waiting"), 15_000);
ok(!!w && !!(await a("GET", "/api/tasks")).j.tasks.find((t) => t.id === waitJob.id)?.wait_since,
  "đến giờ mà Chrome tắt → \"đang chờ Chrome\" trong Autopilot", JSON.stringify(w));
it = await until(async () => (await itemsOf(waitJob.id)).find((x) => x.status === "done"), 60_000);
const reqW = await reqWith(/Chrome của người dùng không kết nối suốt/);
ok(it && /Chrome của người dùng không kết nối/.test(it.note ?? "") && /Chrome không kết nối/.test(JSON.stringify(reqW?.system ?? "")), "chờ quá lâu → chạy bằng trình duyệt của Synchro, ghi rõ lý do", JSON.stringify(it).slice(0, 300));

const chrome = findChrome();
if (!chrome) console.log("  (máy này không có Chrome / Chromium: bỏ qua phần Chrome của người dùng kết nối lại)");
else {
  r = await a("POST", "/api/tasks", { title: "Bài trên Chrome", prompt: `#browser mở ${PAGE} rồi làm bài`, schedule: { kind: "once", tz: TZ }, model: M, browser: "user" });
  const cj = r.j.task;
  ok(!!(await until(async () => (await itemsOf(cj.id)).find((x) => x.status === "waiting"), 10_000)), "việc dùng Chrome đang chờ");
  const code = (await a("POST", "/api/browser/ext", { op: "code" })).j;
  const PROFILE = path.resolve("data-mock/ext-auto");
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(process.execPath, ["tools/mock-extension.mjs", "--server", B, "--code", code.code, "--headless", "--quiet", "--profile", PROFILE], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    it = await until(async () => (await itemsOf(cj.id)).find((x) => x.status === "done" || x.status === "error"), 60_000);
    const ev = it ? (await a("GET", `/api/runs/${it.run}?json=1`)).j?.run?.events ?? [] : [];
    ok(it?.status === "done" && ev.some((e) => e.kind === "ui" && e.text === "browser:user") && /Đã làm xong/.test(it.text), "Chrome kết nối lại → chạy ngay trên Chrome của bạn", JSON.stringify(it).slice(0, 300));
    const sysU = JSON.stringify((await reqWith(/Bài trên Chrome/))?.system ?? "");
    ok(/mặc định dùng Chrome của người dùng/.test(sysU), "model được dặn dùng Chrome của người dùng (đang kết nối)");
  } finally {
    // Chrome còn ghi hồ sơ vài trăm ms sau khi bị dừng: xóa ngay thì rmdir báo ENOTEMPTY (máy CI Linux).
    const exited = new Promise((res) => proc.once("exit", res));
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    for (const d of (await a("GET", "/api/browser/ext")).j?.devices ?? []) await a("POST", "/api/browser/ext", { op: "remove", id: d.id });
    fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

console.log("9. /api/llm không nhận thông tin việc tự động từ trình duyệt; xóa việc thì xóa đề xuất còn chờ");
r = await a("POST", "/api/llm", { system: "", model: M, skills: true, task: { id: job.id, browser: "user", chrome: true }, messages: [{ role: "user", content: `Thử #seq=${JSON.stringify([SEQ[1]])}` }] });
const direct = await reqWith(/Thử #seq=/, false);
ok(r.s === 200 && !direct?.tools?.some((t) => t.name === "autopilot_propose")
  && !/<automation_tools>/.test(JSON.stringify(direct?.system ?? "")),
  "chat thường không có công cụ đề xuất dù trình duyệt gửi kèm task", JSON.stringify(r.j).slice(0, 200));
r = await a("POST", "/api/tasks", { title: "Tạm", prompt: `x #seq=${JSON.stringify([{ tool: "autopilot_propose",
  args: { kind: "action", title: "Việc tạm", summary: "tạm", instructions: "tạm" } }])}`, schedule: { kind: "once",
  tz: TZ }, model: M });
const tmp = r.j.task;
await until(async () => (await itemsOf(tmp.id)).find((x) => x.status === "done"));
ok((await a("GET", "/api/autopilot")).j.pending >= 1, "việc tạm gửi một đề xuất");
await a("DELETE", `/api/tasks/${tmp.id}`);
ok(!(await a("GET", "/api/autopilot/proposals")).j.proposals.some((x) => x.task === tmp.id),
  "xóa việc → đề xuất còn chờ của việc đó cũng mất");

console.log("10. Việc làm trên repo chạy bằng Synchro Code: workspace riêng giữ lại giữa các lần chạy, lệnh cần duyệt thành đề xuất");
r = await a("POST", "/api/tasks/plan", { text: "Mỗi tối thứ Sáu cập nhật thư viện cho repo của tôi, chạy kiểm thử rồi mở pull request", tz: TZ });
ok(r.j?.plan?.engine === "code" && r.j.plan.schedule.kind === "weekly" && r.j.plan.schedule.weekday === 5, "việc trên repo → Synchro Code, thứ Sáu hằng tuần", JSON.stringify(r.j?.plan ?? r.j).slice(0, 300));
const CODE_ACT = `Mở pull request cập nhật thư viện ${TAG}`;
const CSEQ = [
  { tool: "write_file", args: { path: "bao-cao.md", content: `# Báo cáo ${TAG}\nThư viện đã cập nhật.` } },
  { tool: "bash", args: { command: "cat bao-cao.md", description: "Xem báo cáo" } },
  { tool: "autopilot_propose", args: { kind: "action", title: CODE_ACT,
    summary: "Đã cập nhật 3 thư viện, kiểm thử đạt.", instructions: "Đẩy nhánh và mở pull request." } },
];
r = await a("POST", "/api/tasks", { title: "Cập nhật thư viện", prompt: `Cập nhật thư viện #seq=${JSON.stringify(CSEQ)}`, schedule: { kind: "once", tz: TZ }, model: M, engine: "code" });
const codeJob = r.j?.task;
ok(r.s === 200 && codeJob.engine === "code" && /^9\d{14}$/.test(codeJob.sid ?? ""), "việc chạy bằng Synchro Code có workspace riêng", JSON.stringify(r.j).slice(0, 300));
it = await until(async () => (await itemsOf(codeJob.id)).find((x) => x.status !== "running"), 60_000);
ok(it?.status === "done" && /Đã chạy 3 bước/.test(it.text) && it.text.includes(`# Báo cáo ${TAG}`) && it.proposals === 1, "Synchro Code chạy nền: ghi tệp, chạy lệnh, gửi đề xuất", JSON.stringify(it).slice(0, 400));
const codeReq = await reqWith(/workspace riêng của việc này/);
ok(!!codeReq && ["write_file", "bash", "autopilot_propose"].every((n) => codeReq.tools.some((t) => t.name === n)),
  "model nhận bối cảnh workspace riêng và đủ công cụ Synchro Code + autopilot_propose",
  JSON.stringify(codeReq?.tools?.map((t) => t.name) ?? []));
const files = (await a("POST", "/api/ws", { op: "list", sid: codeJob.sid, path: "." })).j?.entries ?? [];
ok(files.some((f) => f.name === "bao-cao.md"), "tệp nằm trong workspace của việc", JSON.stringify(files.map((f) => f.name)));
ok(!((await a("GET", "/api/code/sessions")).j?.sessions ?? []).some((x) => String(x.id) === codeJob.sid), "không tạo phiên rác trong danh sách Code");
await a("PATCH", `/api/tasks/${codeJob.id}`, { prompt: `Đọc lại báo cáo #seq=${JSON.stringify([CSEQ[1]])}` });
r = await a("POST", `/api/tasks/${codeJob.id}/run`);
it = await until(async () => (await itemsOf(codeJob.id)).find((x) => x.run === r.j?.run && x.status !== "running"), 60_000);
ok(it?.status === "done" && it.text.includes(`# Báo cáo ${TAG}`), "lần chạy sau vẫn thấy tệp của lần trước (workspace giữ lại)", JSON.stringify(it).slice(0, 300));
await a("PATCH", "/api/code/prefs", { allowBypass: false });
const CMD = `echo xin-chao-${TAG} > ket-qua.txt`;
await a("PATCH", `/api/tasks/${codeJob.id}`, { prompt: `Ghi kết quả #seq=${JSON.stringify([{ tool: "bash", args: { command: CMD, description: "Ghi kết quả" } }])}` });
const t1 = Date.now();
r = await a("POST", `/api/tasks/${codeJob.id}/run`);
it = await until(async () => (await itemsOf(codeJob.id)).find((x) => x.run === r.j?.run && x.status !== "running"), 60_000);
const pCmd = (await a("GET", "/api/autopilot/proposals")).j.proposals.find((x) => x.task === codeJob.id
  && x.kind === "action" && (x.payload.allow ?? []).length);
ok(it?.status === "done" && Date.now() - t1 < 40_000 && /cần người dùng duyệt trước/.test(it.text) && pCmd?.summary.includes(CMD), "chế độ Tự động tắt: lệnh cần duyệt thành đề xuất, lượt chạy không treo", JSON.stringify({ it: it?.text?.slice(0, 200), pCmd }).slice(0, 400));
r = await a("POST", "/api/autopilot/proposals", { id: pCmd.id, decision: "approve",
  edits: { instructions: `Chạy lệnh đã duyệt #seq=${JSON.stringify([{ tool: "bash", args: { command: CMD,
  description: "Ghi kết quả" } }])}` } });
it = await until(async () => (await itemsOf(codeJob.id)).find((x) => x.run === r.j?.run && x.status !== "running"), 60_000);
const out = (await a("POST", "/api/ws", { op: "read", sid: codeJob.sid, path: "ket-qua.txt" })).j;
ok(it?.status === "done" && it.kind === "action" && JSON.stringify(out ?? {}).includes(`xin-chao-${TAG}`), "duyệt → Synchro chạy đúng lệnh đó trong workspace của việc", JSON.stringify({ it: it?.text?.slice(0, 200), out }).slice(0, 400));
await a("PATCH", "/api/code/prefs", { allowBypass: true });
const rowB = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "auto-b@synchro.test");
await admin("PATCH", `/api/admin/users/${rowB.id}`, { action: "set_perms", perms: { models: ["*"], features: { ...rowB.perms.features, code: false } } });
r = await b("POST", "/api/tasks", { title: "Không có quyền", prompt: "x", schedule: { kind: "daily", time: "08:00", tz: TZ }, engine: "code" });
ok(r.s === 403 && /Synchro Code/.test(r.j?.error ?? ""), "tài khoản không được dùng Synchro Code → không tạo được việc chạy bằng Synchro Code", JSON.stringify(r.j));

for (const t of (await a("GET", "/api/tasks")).j.tasks) await a("DELETE", `/api/tasks/${t.id}`);
await a("DELETE", `/api/skills/${SK}`);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
