// Tự cập nhật CLI của các gói (app/ai/cliupdate.ts) trên Synchro giả lập (npm run dev:mock; SYNCHRO_URL). Bản phát hành giả viết vào
// data-mock/cli-releases (dev:mock đặt SYNCHRO_CLI_UPDATE_SOURCE tới đó): không gọi npm hay script cài của hãng, không tốn gì.
// Kiểm: chỉ chủ sở hữu bật / tắt, cập nhật ngay, trả về bản trước; bản mới cài cạnh bản cũ, kiểm tra bằng đăng nhập sẵn có của quản trị viên
// rồi mới đổi; bản không qua kiểm tra thì giữ bản cũ; lượt chat thật đầu tiên lỗi thì tự trả về bản trước và không cài lại bản đó;
// thư mục đăng nhập không đổi; Hộp thư của quản trị viên có kết quả; khi xong trả CLI giả lập về như cũ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loadTs } from "../lib/ts.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const DATA = path.resolve(process.env.DATA_DIR_MOCK ?? "data-mock"), HOME = path.join(DATA, "engine"), BIN = path.join(HOME, ".local", "bin");
const SRC = path.join(DATA, "cli-releases"), VERS = path.join(HOME, ".local", "versions");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const tag = Date.now().toString(36);
const owner = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await owner("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const ownerId = (await owner("GET", "/api/auth/me")).j.user.id;
const admin = client(), member = client();
for (const [c, em] of [[admin, `cu-adm-${tag}@synchro.test`], [member, `cu-mem-${tag}@synchro.test`]]) {
  await c("POST", "/api/auth/signup", { email: em, password: "Cli-update-123", profile: { fullName: "CLI Tester", birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email: em, password: "Cli-update-123" });
}
const idOf = async (c) => (await c("GET", "/api/auth/me")).j.user.id;
const adminId = await idOf(admin), memberId = await idOf(member);
for (const id of [adminId, memberId]) await owner("PATCH", `/api/admin/users/${id}`, { action: "mark_verified" });
await owner("PATCH", `/api/admin/users/${adminId}`, { action: "set_role", role: "admin" });

// Bản phát hành giả: lệnh giả lập của CLI đó + thư viện chung, dòng --version mới, có thể kèm mock-break ("smoke" / "turn").
const release = (cli, ver, line, brk) => {
  const d = path.join(SRC, cli, ver);
  fs.mkdirSync(d, { recursive: true });
  for (const f of [cli, "mock-cli-common.cjs"]) fs.copyFileSync(path.join("scripts", "mock-cli", f), path.join(d, f));
  fs.copyFileSync(path.join(BIN, "mock-cli.json"), path.join(d, "mock-cli.json"));
  fs.writeFileSync(path.join(d, "mock-version"), line);
  if (brk) fs.writeFileSync(path.join(d, "mock-break"), brk);
  fs.writeFileSync(path.join(SRC, cli, "latest"), ver);
};
// Ảnh chụp thư mục đăng nhập (tên, cỡ, giờ sửa) của mọi tài khoản: bộ cập nhật không được chép, chuyển, sửa hay xóa gì ở đây.
// Tệp mock-* là nhật ký của CLI giả lập (mock-appserver.log khi codex app-server của tài khoản khởi động, mock-prompts.json…), không phải trạng thái đăng nhập.
const snap = (root) => {
  const out = [];
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.startsWith("mock-")) { const st = fs.lstatSync(p); out.push(`${path.relative(root, p)}:${st.size}:${st.mtimeMs}`); } } };
  walk(root);
  return crypto.createHash("sha1").update(out.sort().join("\n")).digest("hex") + `/${out.length}`;
};
const view = async (c = owner) => (await c("GET", "/api/admin/cliupdate")).j;
const row = (v, cli) => v?.clis?.find((r) => r.cli === cli);
const runNow = async (body = { action: "run" }) => {
  const r = await owner("POST", "/api/admin/cliupdate", body);
  let v = r.j;
  for (let i = 0; i < 240 && v?.running; i++) { await sleep(250); v = await view(); }
  return { s: r.s, started: r.j?.running, v };
};
const chat = (text) => owner("POST", "/api/llm", { model: "sub-claude/sonnet", messages: [{ role: "user", content: text }], skills: true });
const resetBin = () => {
  for (const f of fs.readdirSync(path.join("scripts", "mock-cli"))) { const d = path.join(BIN, f); fs.rmSync(d, { force: true }); fs.copyFileSync(path.join("scripts", "mock-cli", f), d); fs.chmodSync(d, 0o755); }
  for (const f of fs.readdirSync(BIN)) if (f.endsWith(".synchro-prev") || f.endsWith(".synchro-new")) fs.rmSync(path.join(BIN, f), { force: true });
  fs.rmSync(VERS, { recursive: true, force: true });
  fs.rmSync(SRC, { recursive: true, force: true });
};

const made = [];
try {
  resetBin();
  // Chủ sở hữu đăng nhập gói Claude và Codex (tệp đăng nhập của CLI giả lập), để bước kiểm tra dùng đăng nhập sẵn có. Tệp nào bài này tạo thì xóa
  // khi xong: để lại đăng nhập Codex thì chế độ Tự động của các bộ kiểm thử giao diện chọn gói Codex thay vì Claude.
  for (const [cli, f] of [["claude", ".mock-login"], ["codex", "auth.json"]]) {
    const d = path.join(HOME, "logins", cli, ownerId), file = path.join(d, f), mark = path.join(DATA, "engine-tokens", `${cli}-${ownerId}.login`);
    for (const p of [file, mark]) if (!fs.existsSync(p)) made.push(p);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, cli === "codex" ? "{}" : "1");
    fs.mkdirSync(path.dirname(mark), { recursive: true }); fs.writeFileSync(mark, "1");
    await owner("GET", `/api/engines/${cli}/status?fresh=1`);
  }

  console.log("1. Xem và quyền");
  {
    const v = await view();
    ok(v?.owner === true && v.envOff === false && v.clis?.length === 4 && v.clis.every((r) => r.installed && /\[mock\]/.test(r.version ?? "")), "chủ sở hữu xem được 4 CLI, bản đang chạy đọc bằng --version", v);
    ok(typeof v.nextAt === "number" && v.on === true, "mặc định bật, có mốc chạy tới", { on: v.on, nextAt: v.nextAt });
    const a = await view(admin);
    ok(a?.owner === false && a.clis?.length === 4, "quản trị viên xem được, biết mình không phải chủ sở hữu", a);
    ok((await member("GET", "/api/admin/cliupdate")).s === 403, "thành viên: 403");
    for (const [n, body] of [["Cập nhật ngay", { action: "run" }], ["bật / tắt hằng tuần", { action: "auto", on: false }], ["trả về bản trước", { action: "rollback", cli: "claude" }]])
      ok((await admin("POST", "/api/admin/cliupdate", body)).s === 403, `${n}: quản trị viên 403`);
    ok((await view()).on === true, "bật / tắt không đổi sau lần bị chặn");
    let r = await owner("POST", "/api/admin/cliupdate", { action: "auto", on: false });
    ok(r.s === 200 && r.j.on === false && r.j.nextAt === null, "chủ sở hữu tắt cập nhật hằng tuần", r.j);
    r = await owner("POST", "/api/admin/cliupdate", { action: "auto", on: true });
    ok(r.s === 200 && r.j.on === true && r.j.nextAt > Date.now(), "bật lại: có mốc chạy tới", r.j);
  }

  console.log("2. Cập nhật ngay: bản mới cài cạnh bản cũ, kiểm tra rồi mới đổi");
  const logins0 = snap(path.join(HOME, "logins")), tokens0 = snap(path.join(DATA, "engine-tokens"));
  const v1 = `2.1.311-${tag}`, c1 = `0.165.0-${tag}`;
  release("claude", v1, `${v1} (Claude Code) [mock]`);
  release("codex", c1, `codex-cli ${c1} [mock]`, "smoke");
  fs.mkdirSync(path.join(SRC, "grok"), { recursive: true }); fs.writeFileSync(path.join(SRC, "grok", "latest"), "0.1.42");
  {
    const { s, started, v } = await runNow();
    ok(s === 200 && started === true, "chạy ở nền, trang thấy đang chạy", { s, started });
    const cl = row(v, "claude"), cx = row(v, "codex"), gk = row(v, "grok"), ag = row(v, "agy");
    ok(cl?.last?.outcome === "updated" && cl.version?.includes(v1) && /2\.1\.310/.test(cl.prev ?? "") && cl.managed && cl.canRollback && cl.probation?.ok === 0, "Claude Code: đã cập nhật, giữ bản trước để trả lại, bắt đầu theo dõi lượt đầu", cl);
    ok(/Đăng nhập sẵn có của quản trị viên vẫn dùng được/.test(cl?.last?.detail ?? ""), "kiểm tra bằng đăng nhập sẵn có của chủ sở hữu", cl?.last);
    const link = fs.lstatSync(path.join(BIN, "claude"));
    ok(link.isSymbolicLink() && fs.realpathSync(path.join(BIN, "claude")).startsWith(path.join(VERS, "claude") + path.sep), "lối vào .local/bin/claude là liên kết tới thư mục phiên bản", fs.readlinkSync(path.join(BIN, "claude")));
    ok(fs.existsSync(path.join(BIN, "claude.synchro-prev")), "bản cũ (tệp thật) giữ cạnh lối vào để trả lại");
    const leftover = fs.existsSync(path.join(VERS, "codex")) ? fs.readdirSync(path.join(VERS, "codex")) : [];
    ok(cx?.last?.outcome === "smoke_failed" && /0\.164\.0/.test(cx.version ?? "") && !fs.lstatSync(path.join(BIN, "codex")).isSymbolicLink() && !leftover.length, "Codex: bản mới không qua kiểm tra → vẫn dùng bản cũ, bản lỗi bị xóa", { cx, leftover });
    ok(/không trả lời được lệnh xem đăng nhập/.test(cx?.last?.detail ?? ""), "lý do: lệnh xem đăng nhập của bản mới lỗi", cx?.last?.detail);
    ok(gk?.last?.outcome === "same", "Grok: đã là bản mới nhất, không cài", gk?.last);
    ok(ag?.last?.outcome === "skipped", "Antigravity: nguồn chưa có bản phát hành, bỏ qua", ag?.last);
    const st = (await owner("GET", "/api/engines/claude/status?fresh=1")).j;
    ok(st.installed && st.version?.includes(v1) && st.loggedIn, "trạng thái gói Claude: bản mới, vẫn đăng nhập", st);
    ok(snap(path.join(HOME, "logins")) === logins0 && snap(path.join(DATA, "engine-tokens")) === tokens0, "thư mục đăng nhập của mọi tài khoản không đổi", { logins0, now: snap(path.join(HOME, "logins")) });
    const inbox = (await owner("GET", "/api/inbox")).j?.items ?? [];
    const n = inbox.find((x) => x.kind === "notice" && /Claude Code/.test(x.title) && /Codex/.test(x.text));
    ok(n && /đã cập nhật/.test(n.text) && /không qua kiểm tra/.test(n.text) && n.link === "settings:Providers", "Hộp thư của chủ sở hữu có kết quả từng CLI", inbox.slice(0, 2));
    ok(((await admin("GET", "/api/inbox")).j?.items ?? []).some((x) => x.kind === "notice" && x.title === n?.title), "quản trị viên khác cũng nhận");
    ok(!((await member("GET", "/api/inbox")).j?.items ?? []).some((x) => x.title === n?.title), "thành viên không nhận");
    const audit = (await owner("GET", "/api/admin")).j.audit;
    ok(audit.some((x) => x.action === "admin_cli_update" && x.actor_email === "admin@synchro.test"), "nhật ký ghi lần cập nhật");
  }

  console.log("3. Lượt chat thật với bản mới");
  {
    const r = await chat("chào bản mới");
    ok(r.s === 200 && r.j?.via === "claude", "chat bằng gói Claude chạy trên bản mới", r.j);
    // ≥ 1: lượt nền (đặt tên đoạn chat) chạy bằng cùng bản cũng được tính, có thể xong trước hoặc sau lúc đọc.
    ok((row(await view(), "claude")?.probation?.ok ?? 0) >= 1, "lượt chạy được tính vào thời gian theo dõi", row(await view(), "claude"));
  }

  console.log("4. Chủ sở hữu trả về bản trước");
  {
    const r = await owner("POST", "/api/admin/cliupdate", { action: "rollback", cli: "claude" });
    const cl = row(r.j, "claude");
    ok(r.s === 200 && cl?.last?.outcome === "rolled_back" && /2\.1\.310/.test(cl.version ?? "") && cl.bad.includes(v1) && !cl.canRollback && !cl.probation, "trả về 2.1.310; bản vừa bỏ vào danh sách không cài lại", cl);
    ok((await chat("chào bản cũ")).s === 200, "chat chạy trên bản cũ");
    const again = await runNow({ action: "run", cli: "claude" });
    ok(row(again.v, "claude")?.last?.outcome === "skipped" && /2\.1\.310/.test(row(again.v, "claude")?.version ?? ""), "lần cập nhật sau bỏ qua bản đã bị trả lại", row(again.v, "claude"));
  }

  console.log("5. Bản mới qua kiểm tra nhưng lượt chat thật lỗi → tự trả về bản trước");
  {
    const v2 = `2.1.312-${tag}`;
    release("claude", v2, `${v2} (Claude Code) [mock]`, "turn");
    const u = await runNow({ action: "run", cli: "claude" });
    ok(row(u.v, "claude")?.last?.outcome === "updated" && row(u.v, "claude")?.version?.includes(v2), "bản lỗi ngầm vẫn qua kiểm tra trước khi dùng (lệnh xem đăng nhập chạy)", row(u.v, "claude"));
    // Lượt lỗi được chat thử lại một lần; hai lần chạy lỗi là đủ để tự trả về bản trước, lần thử sau đó chạy trên bản trước nên người dùng vẫn có câu trả lời.
    const a = await chat("lượt một");
    ok(a.s === 200 && a.j?.via === "claude", "lượt đầu vẫn có câu trả lời (thử lại chạy trên bản trước đã được trả về)", [a.s, a.j]);
    let cl = null;
    for (let i = 0; i < 40; i++) { cl = row(await view(), "claude"); if (cl?.last?.outcome === "rolled_back") break; await sleep(250); }
    ok(cl?.last?.outcome === "rolled_back" && /2\.1\.310/.test(cl.version ?? "") && cl.bad.includes(v2) && /lượt chat đầu tiên/.test(cl.last.detail), "tự trả về bản trước, ghi lý do", cl);
    const c = await chat("lượt ba");
    ok(c.s === 200, "chat chạy lại ngay", c.j);
    const inbox = (await owner("GET", "/api/inbox")).j?.items ?? [];
    ok(inbox.some((x) => x.kind === "notice" && /Đã trả Claude Code về bản trước/.test(x.title) && /Đăng nhập gói của mọi người vẫn giữ nguyên/.test(x.text)), "Hộp thư báo đã tự trả về", inbox.slice(0, 2).map((x) => x.title));
    const all = await view();
    ok(all.clis.every((r) => !r.probation), "không còn CLI nào đang theo dõi (không ảnh hưởng các bộ kiểm thử khác)", all.clis.map((r) => [r.cli, r.probation]));
  }

  console.log("6. Hẹn giờ");
  {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cliu-"));
    const { "ai/cliupdate": CU, authstore: AS } = await loadTs(["ai/cliupdate", "authstore"]);
    const due = Date.parse("2026-11-19T10:00:00"), at = new Date(CU.nextSlot(due, due - 7 * 86_400_000));
    ok(at.getHours() === 4 && at.getMinutes() < 40 && at.getTime() >= due - 12 * 3_600_000, "mốc chạy rơi vào 04:00–04:40 giờ máy chủ quanh ngày đến hạn", at.toString());
    // Lần đầu khởi động (hạn = bây giờ + 1 giờ) lúc 05:00…15:00: 04:xx cùng ngày đã qua nên phải là 04:xx hôm sau, không cập nhật giữa ban ngày.
    const day = (h) => Date.parse(`2026-11-19T${String(h).padStart(2, "0")}:00:00`);
    const slots = [5, 9, 12, 14, 15, 16, 20, 23].map((h) => { const now = day(h), t = CU.nextSlot(now + 3_600_000, now), d = new Date(t); return { h, ok: t > now && d.getHours() === 4 && t - now < 24 * 3_600_000, at: d.toString() }; });
    ok(slots.every((x) => x.ok), "khởi động hay bật lại lúc nào cũng hẹn 04:xx sắp tới (không bao giờ là mốc đã qua)", slots.filter((x) => !x.ok));
    // Bản npm: chỉ nhận bản chính thức đã phát hành đủ lâu, không vượt thẻ latest.
    const now = Date.parse("2026-11-20T00:00:00Z"), ago = (h) => new Date(now - h * 3_600_000).toISOString();
    const time = { created: ago(9999), modified: ago(1), "2.1.300": ago(400), "2.1.310": ago(200), "2.1.311": ago(80), "2.1.312": ago(20), "2.1.313-beta.1": ago(100), "2.2.0-rc.1": ago(90), "9.0.0": ago(500) };
    ok(CU.pickRelease(time, "2.1.312", now, 72 * 3_600_000) === "2.1.311" && CU.pickRelease(time, "2.1.312", now, 10 * 3_600_000) === "2.1.312" && CU.pickRelease({ "1.0.0": ago(1) }, "1.0.0", now, 72 * 3_600_000) === null,
      "npm: bản mới nhất đã ra đủ 72 giờ (bỏ bản vừa ra, bản -beta / -rc, bản lạ vượt thẻ latest)", CU.pickRelease(time, "2.1.312", now, 72 * 3_600_000));
    // Lượt lỗi đăng nhập của một thành viên (đăng nhập gói của riêng họ hết hạn) không làm cả máy chủ trả về bản trước.
    const probe = (loginOk) => { if (globalThis.__synchroCliUpdate) globalThis.__synchroCliUpdate.st = null; AS.setSetting("cli_update", JSON.stringify({ on: true, clis: { claude: { active: null, prev: null, probation: { since: Date.now(), ok: 0, fail: 0, errors: [], loginOk, authUsers: [] }, bad: [], last: null } } })); };
    const fails = () => JSON.parse(AS.getSetting("cli_update", "{}")).clis?.claude?.probation?.fail;
    probe(false);
    for (let i = 0; i < 4; i++) CU.noteCliOutcome("claude", false, "auth expired", { uid: "u-het-han", auth: true });
    ok(fails() === 1, "một tài khoản đăng nhập hết hạn gửi 4 lượt: chỉ tính 1 lượt lỗi", fails());
    ok(CU.classifyTurn({ status: 409, json: { detail: "x", relogin: "claude" } }) === false, "lỗi đăng nhập vẫn là lượt lỗi khi chưa xác nhận được đăng nhập");
    probe(true);
    for (const uid of ["a", "b", "c"]) CU.noteCliOutcome("claude", false, "auth expired", { uid, auth: true });
    ok(fails() === 0, "bản mới đã đọc được đăng nhập sẵn có khi kiểm tra: lỗi đăng nhập của từng người không tính", fails());
    CU.noteCliOutcome("claude", false, "CLI chết", { uid: "a" });
    ok(fails() === 1, "lỗi do chính CLI (chết, không phản hồi) vẫn tính", fails());

    ok(CU.versionNum("2.1.310 (Claude Code)") === "2.1.310" && CU.versionNum("codex-cli 0.164.0") === "0.164.0" && CU.versionNum("grok 0.1.42-beta.1 [x]") === "0.1.42-beta.1", "đọc số phiên bản từ dòng --version của từng CLI");
    ok(CU.classifyTurn({ status: 200, json: {} }) === true && CU.classifyTurn({ status: 502, json: {} }) === false && CU.classifyTurn({ status: 429, json: { quota: "plan" } }) === null && CU.classifyTurn({ status: 200, json: { cancelled: true } }) === null && CU.classifyTurn({ status: 503, json: { stalled: true } }) === false, "chỉ lỗi do CLI tính là lượt lỗi (hết hạn mức, người dùng dừng thì không)");
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
} finally {
  // Trả CLI giả lập về như lúc đầu cho các bộ kiểm thử khác.
  resetBin();
  for (const p of made) fs.rmSync(p, { force: true });
  for (const cli of ["claude", "codex"]) await owner("GET", `/api/engines/${cli}/status?fresh=1`);
  for (const id of [adminId, memberId]) await owner("DELETE", `/api/admin/users/${id}`, { confirm: id === adminId ? `cu-adm-${tag}@synchro.test` : `cu-mem-${tag}@synchro.test` });
}
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
