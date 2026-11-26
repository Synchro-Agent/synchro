// Làm việc "thành tiếng" và nhắn thêm khi đang chạy (npm run dev:mock): lượt có công cụ ghi lời dẫn, công cụ, kết quả, danh sách việc;
// tin nhắn thêm được ghép vào bước kế tiếp mà không ngắt lượt; tin tới lúc model đang viết thì bước đó dừng, model đọc tin mới ngay trong
// cùng lượt (khóa API); gói subscription đọc ở lần gọi công cụ kế tiếp hoặc ngay khi CLI xong lượt, vẫn trong cùng lượt.
import fs from "node:fs";
import path from "node:path";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
// Chạy code cục bộ dùng sandbox-exec của macOS: trên máy khác (CI Linux) công cụ báo lỗi, phần nhắn thêm vẫn kiểm đủ.
const MAC = process.platform === "darwin";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const client = (cookie = "") => async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j, cookie: () => cookie };
};
const me = client(), other = client();
await me("POST", "/api/auth/signup", { email: "steer-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Steer Tester", birthDate: "2000-01-01" } });
const login = await me("POST", "/api/auth/login", { email: "steer-member@synchro.test", password: "Member-pass-123" });
await other("POST", "/api/auth/signup", { email: "steer-other@synchro.test", password: "Member-pass-123", profile: { fullName: "Steer Other", birthDate: "2000-01-01" } });
await other("POST", "/api/auth/login", { email: "steer-other@synchro.test", password: "Member-pass-123" });
const MODEL = "anthropic/claude-haiku-5-5";
const ask = (text) => me("POST", "/api/llm", { async: true, skills: true, system: "", model: MODEL, messages: [{ role: "user", content: text }], conv: "steertest" });
const wait = async (id, ms = 60_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    const r = await me("GET", `/api/runs/${id}?json=1`);
    if (r.j?.run && r.j.run.status !== "running") return r.j.run;
    await new Promise((x) => setTimeout(x, 400));
  }
  return null;
};

console.log("1. Lời dẫn, công cụ, kết quả và tin nhắn thêm ghép giữa chừng");
// Bước gọi công cụ của model mất 2,5 giây (#waittool): tin nhắn thêm tới khi lượt còn đang chạy.
let r = await ask('Tính 21 nhân 2 #waittool #tool=run_code #args={"language":"python","code":"print(21*2)"}');
const id = r.j?.run;
ok(r.s === 200 && typeof id === "string", "tạo lượt chạy nền", JSON.stringify(r.j));
await new Promise((x) => setTimeout(x, 500));
r = await me("POST", `/api/runs/${id}`, { text: "Nhân thêm 10 nữa nhé" });
ok(r.s === 200 && r.j.queued === true, "nhắn thêm khi đang chạy → xếp vào lượt, không ngắt", JSON.stringify(r.j));
ok((await other("POST", `/api/runs/${id}`, { text: "chen ngang" })).s === 404, "người khác không nhắn vào lượt của mình được");
ok((await me("POST", `/api/runs/${id}`, { text: "  " })).s === 400, "tin trống → 400");
let run = await wait(id);
const kinds = (run?.events ?? []).map((e) => e.kind);
const say = run?.events.find((e) => e.kind === "say"), tool = run?.events.find((e) => e.kind === "tool"), res = run?.events.find((e) => e.kind === "res"), steer = run?.events.find((e) => e.kind === "steer");
ok(run?.status === "done" && !!say && /công cụ/.test(say.text), `lời dẫn trước khi dùng công cụ được giữ lại: “${say?.text}”`, JSON.stringify(kinds));
ok(!!tool && !!res && JSON.parse(res.text).ref === tool.seq && JSON.parse(res.text).ok === MAC, "kết quả công cụ gắn đúng dòng công cụ", JSON.stringify([tool, res]));
// Tin tới khi model còn đang viết bước gọi công cụ (2,5 giây): bước đó dừng, model đọc tin mới ngay rồi mới gọi công cụ.
ok(!!steer && steer.text === "Nhân thêm 10 nữa nhé" && steer.seq < tool.seq && steer.at - run.createdAt < 2000, "tin nhắn thêm được đọc ngay khi model đang viết (không chờ hết bước)", JSON.stringify(kinds));
ok(!run?.result?.steer && (!MAC || /42/.test(run?.result?.text ?? "")), "lượt chạy tiếp tới hết, không còn tin chờ", JSON.stringify(run?.result).slice(0, 300));
r = await me("POST", `/api/runs/${id}`, { text: "muộn rồi" });
ok(r.s === 200 && r.j.queued === false, "lượt đã xong → queued: false (trình duyệt gửi thành tin mới)", JSON.stringify(r.j));

console.log("2. Tin tới lúc model đang viết câu trả lời: dừng bước đó, đọc tin mới ngay trong cùng lượt");
r = await ask("Viết một câu chào #slow");
const id2 = r.j?.run;
await new Promise((x) => setTimeout(x, 500));
const t2 = Date.now();
await me("POST", `/api/runs/${id2}`, { text: "Thêm một câu cảm ơn nữa" });
run = await wait(id2);
const st2 = run?.events.find((e) => e.kind === "steer");
ok(run?.status === "done" && !run.result.steer && st2?.text === "Thêm một câu cảm ơn nữa" && st2.at - t2 < 3000, "model đang viết thì dừng ngay để đọc tin mới (không chờ hết câu trả lời, không để lượt sau)", JSON.stringify({ steer: st2, ms: st2 && st2.at - t2, result: run?.result }).slice(0, 400));
const H2 = await (await fetch(`${process.env.MOCK_URL ?? "http://127.0.0.1:4010"}/_debug/hist`)).json();
ok([...(H2.anthropic ?? [])].some((b) => /<user_followup>\\nThêm một câu cảm ơn nữa/.test(JSON.stringify(b.messages ?? ""))), "lần gọi model tiếp theo có tin nhắn thêm của người dùng");

console.log("2b. Gói Claude Code: tin tới khi CLI đang trả lời → làm tiếp ngay khi CLI xong, cùng phiên, cùng lượt");
{
  const M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
  const adm = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
  if (!process.env.SYNCHRO_ADMIN_COOKIE) await adm("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
  const code = /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/claude`).then((x) => x.text()))?.[1];
  await adm("POST", "/api/engines/claude/login/start", {});
  await adm("POST", "/api/engines/claude/login/code", { code });
  const r3 = await adm("POST", "/api/llm", { async: true, skills: true, system: "", model: "sub-claude/sonnet", messages: [{ role: "user", content: "Viết một câu chào #slow" }], conv: `steer-sub-${Date.now()}` });
  await new Promise((x) => setTimeout(x, 800));
  const t3 = Date.now();
  const pr = await adm("POST", `/api/runs/${r3.j?.run}`, { text: "Thêm lời chúc ngủ ngon" });
  const done = async (id) => {
    for (let i = 0; i < 100; i++) {
      const g = await adm("GET", `/api/runs/${id}?json=1`);
      if (g.j?.run && g.j.run.status !== "running") return g.j.run;
      await new Promise((x) => setTimeout(x, 400));
    }
    return null;
  };
  const run3 = await done(r3.j?.run);
  const st3 = run3?.events.find((e) => e.kind === "steer" && e.text === "Thêm lời chúc ngủ ngon");
  // CLI giả lập viết câu trả lời mất 3 giây (#slow): trước đây tin chờ tới hết lượt; nay lượt bị cắt ngay, làm tiếp
  // cùng phiên. Sự kiện steer chỉ là lúc cắt: model thấy tin khi CLI chạy lại (--resume) đọc xong tin. CLI giả lập ghi
  // lúc tiến trình bắt đầu (born) và lúc đọc xong tin (read): born − gửi là phần của Synchro (cắt, dọn, chạy lại),
  // read − born là thời gian khởi động CLI (CLI thật khoảng 1,7–4 giây; bản giả lập gần như ngay).
  const logs = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name === "mock-claude-followups.log") logs.push(...fs.readFileSync(p, "utf8").trim().split("\n"));
    }
  };
  try {
    walk(path.resolve("data-mock/engine"));
  } catch (e) {
    console.log("  · không đọc được nhật ký CLI giả lập:", e.message);
  }
  const seen3 = logs.map((l) => JSON.parse(l)).filter((x) => x.read >= t3).sort((a, b) => a.read - b.read)[0];
  const own3 = seen3 ? seen3.born - t3 : null, spawn3 = seen3 ? seen3.read - seen3.born : null;
  console.log(`  · Claude Code: gửi → cắt lượt ${st3 ? st3.at - t3 : "?"} ms;`
    + ` gửi → CLI chạy lại (phần Synchro) ${own3 ?? "?"} ms; CLI khởi động → đọc xong tin ${spawn3 ?? "?"} ms;`
    + ` gửi → model thấy tin ${seen3 ? seen3.read - t3 : "?"} ms`);
  ok(seen3?.resume === true && own3 !== null && own3 < 1000,
    "Claude Code: phần của Synchro (gửi → CLI nối tiếp phiên chạy lại) dưới 1 giây", { seen3, own3 });
  const sub3 = run3?.status === "done" && !run3.result.steer && /lượt 2/.test(run3.result.text ?? "");
  ok(pr.j?.queued !== false && sub3 && !!st3,
    "gói: tin mới vào cùng phiên của CLI, không để lượt sau", JSON.stringify(run3?.result ?? pr.j).slice(0, 300));
  ok(!!st3 && st3.at - t3 < 1500, "Claude Code: không đợi CLI viết xong, cắt lượt, đọc tin mới ngay (dưới 1,5 giây)",
    st3 && st3.at - t3);
  await adm("POST", "/api/engines/claude/logout");

  console.log("2c. Gói Codex: tin nhắn thêm vào thẳng lượt đang chạy (turn/steer của app-server)");
  const cx = await adm("POST", "/api/engines/codex/login/start", {});
  await fetch(`${M}/mock-login/codex/approve?code=${cx.j?.userCode}`);
  for (let i = 0; i < 20 && !(await adm("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn; i++) {
    await new Promise((x) => setTimeout(x, 500));
  }
  const msg = [{ role: "user", content: "[mock:slowcodex] Viết một câu chào" }];
  const cxModel = "sub-codex/gpt-6.1-sol";
  const conv4 = `steer-cx-${Date.now()}`;
  const r4 = await adm("POST", "/api/llm", { async: true, skills: true, system: "", model: cxModel, messages: msg,
    conv: conv4 });
  await new Promise((x) => setTimeout(x, 900));
  const t4 = Date.now();
  await adm("POST", `/api/runs/${r4.j?.run}`, { text: "Thêm lời chúc ngủ ngon" });
  const run4 = await done(r4.j?.run);
  const st4 = run4?.events.find((e) => e.kind === "steer");
  console.log(`  · Codex: gửi → model nhận tin nhắn thêm ${st4 ? st4.at - t4 : "?"} ms`);
  const said4 = /nhắn thêm giữa lượt: Thêm lời chúc ngủ ngon/.test(run4?.result?.text ?? "");
  ok(run4?.status === "done" && !run4.result.steer && said4, "Codex trả lời cả tin nhắn thêm trong cùng lượt",
    JSON.stringify(run4?.result).slice(0, 300));
  ok(!!st4 && st4.at - t4 < 1500, "Codex: tin tới model ngay ở bước kế tiếp (dưới 1,5 giây)", st4 && st4.at - t4);
  await adm("POST", "/api/engines/codex/logout");
}

console.log("3. Danh sách việc");
r = await ask('Theo dõi tiến độ giúp mình #tool=update_plan #args={"items":[{"content":"Buoc mot","status":"completed"},{"content":"Buoc hai","status":"in_progress"},{"content":"Buoc ba","status":"pending"}]}');
run = await wait(r.j?.run);
const plan = run?.events.find((e) => e.kind === "plan");
const items = plan ? JSON.parse(plan.text) : [];
ok(items.length === 3 && items[1].status === "in_progress" && items[0].content === "Buoc mot", "model gọi update_plan → giao diện nhận danh sách việc", JSON.stringify(items));
ok(!(run?.events ?? []).some((e) => e.kind === "tool" && /update_plan/.test(e.text)), "update_plan không hiện như một công cụ dữ liệu");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
