// Engine CLI (ADR 0001): EchoEngine qua engineFor, phân loại lỗi, che khóa, lọc biến môi trường, kill cả process group,
// đăng nhập theo tài khoản (claude setup-token qua pty, codex mã thiết bị, agy menu trong terminal), ba engine với CLI giả lập
// (chào rồi hỏi tiếp bằng resume), và chuyển sang khóa API khi gói hết hạn mức.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu, thư mục nhà engine và máy chủ giả lập riêng cho lượt kiểm thử.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { MOCK_KEYS, startMock } from "../../scripts/mock-providers.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-engine-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "engine-test-key";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const PORT = 4300 + Math.floor(Math.random() * 500);
await startMock(PORT);
const M = `http://127.0.0.1:${PORT}`;

const mods = await loadTs(["ai/engine", "ai/selector", "ai/errors", "ai/cli_runtime", "ai/cli_auth", "ai/cli_engines", "ai/api_engine", "ai/subs", "providers"]);
const { "ai/engine": E, "ai/selector": S, "ai/errors": X, "ai/cli_runtime": R, "ai/cli_auth": A, "ai/cli_engines": CE, "ai/api_engine": API, "ai/subs": SUBS, providers: P } = mods;
const all = async (it) => { const a = []; for await (const e of it) a.push(e); return a; };

try {
  // ------------------------------------------------------------------
  console.log("1. EchoEngine qua engineFor");
  {
    const ev = await all(S.engineFor("echo").runTurn({ prompt: "xin chào Synchro", system: "ngắn gọn" }));
    const kinds = ev.map((e) => e.kind);
    ok(kinds[0] === "session" && kinds.at(-1) === "final" && kinds.includes("usage"), "thứ tự sự kiện: session → text… → usage → final", kinds.join(","));
    ok(ev.filter((e) => e.kind === "text").length > 1, "chữ về theo nhiều đoạn");
    const r = await E.collect(S.engineFor("echo").runTurn({ prompt: "xin chào", system: "hệ thống", sessionId: "s-1" }));
    ok(r.text === "[hệ thống] xin chào" && r.session === "s-1" && r.usage?.output === r.text.length && !r.error, "collect: nội dung, giữ phiên, usage", JSON.stringify(r));
    const ac = new AbortController(); ac.abort();
    const ab = await E.collect(S.engineFor("echo").runTurn({ prompt: "dừng", signal: ac.signal }));
    ok(ab.error?.code === "aborted", "Dừng → lỗi aborted", JSON.stringify(ab));
    let threw = ""; try { S.engineFor("khong-co"); } catch (e) { threw = e.message; }
    ok(/Chưa có engine/.test(threw), "nhà cung cấp lạ → báo lỗi rõ", threw);
    ok(["echo", "claude", "codex", "agy", "api:anthropic", "api:openai", "api:google"].every((p) => S.engineProviders().includes(p)), "đã đăng ký đủ engine", S.engineProviders().join(","));
  }

  // ------------------------------------------------------------------
  console.log("2. Phân loại lỗi");
  {
    const cases = [
      ["Claude AI usage limit reached|1793020000", "quota"], ["5-hour limit reached ∙ resets 3pm", "quota"], ["You've hit your usage limit. Upgrade to Pro or try again in 2 hours.", "quota"],
      ["RESOURCE_EXHAUSTED: You have exhausted your capacity on this model.", "quota"], ["Rate limit reached for requests", "quota"], ["Too Many Requests", "quota"],
      ["Your credit balance is too low to access the Anthropic API.", "quota"], ["insufficient_quota", "quota"],
      ["Not logged in · Please run /login", "auth"], ["unexpected status 401 Unauthorized: Missing bearer", "auth"], ["authentication failed or timed out", "auth"],
      ["OAuth token has expired. Please obtain a new token.", "auth"], ["Invalid API key", "auth"], ["403 Forbidden", "auth"], ["Account on hold", "auth"],
      ["model not found", "other"], ["Internal server error", "other"], ["ECONNRESET", "other"], ["", "other"],
    ];
    const bad = cases.filter(([m, k]) => X.classify(m) !== k);
    ok(!bad.length, `${cases.length} câu lỗi thật của các CLI phân loại đúng`, JSON.stringify(bad.map(([m, k]) => [m, k, X.classify(m)])));
    ok(X.classify("xyz", 401) === "auth" && X.classify("xyz", 403) === "auth" && X.classify("xyz", 429) === "quota" && X.classify("xyz", 500) === "other", "theo mã HTTP: 401/403 → auth, 429 → quota");
    const leaked = [`sk-ant-oat01-${"a".repeat(40)}`, `sk-ant-api03-${"b".repeat(40)}`, `sk-proj-${"c".repeat(40)}`, `AIza${"d".repeat(35)}`, `ya29.${"e".repeat(40)}`, `eyJ${"f".repeat(20)}.${"g".repeat(20)}.${"h".repeat(20)}`];
    const red = X.redact(`lỗi: ${leaked.join(" | ")} Bearer ${"i".repeat(30)} CLAUDE_CODE_OAUTH_TOKEN=abc123secret`);
    ok(leaked.every((k) => !red.includes(k)) && !red.includes("i".repeat(30)) && !red.includes("abc123secret") && red.includes("[đã che]") && red.startsWith("lỗi:"), "redact che mọi loại khóa và token", red);
  }

  // ------------------------------------------------------------------
  console.log("3. Lọc biến môi trường, tìm CLI, kill cả process group");
  {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-should-not-leak";
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
    const env = R.cleanEnv({ CODEX_HOME: "/x/codex", OPENAI_API_KEY: "sk-leak", DATA_KEY: "leak", NODE_OPTIONS: "--inspect" });
    ok(Object.keys(env).every((k) => R.ENV_ALLOW.includes(k)), "chỉ còn biến trong danh sách cho phép", Object.keys(env).join(","));
    ok(env.CODEX_HOME === "/x/codex" && env.HOME === HOME && !("OPENAI_API_KEY" in env) && !("DATA_KEY" in env) && !("NODE_OPTIONS" in env), "giữ biến hợp lệ truyền vào, bỏ khóa và biến lạ; HOME = thư mục nhà engine");
    ok(env.PATH.split(":")[1] === BIN && env.PATH.split(":")[0].endsWith("nobrowser"), "PATH: lệnh mở trình duyệt giả rồi tới <home>/.local/bin", env.PATH);
    const r = await R.runCli("/usr/bin/env", [], { env: { CLAUDE_CODE_OAUTH_TOKEN: "tok" } });
    const seen = r.stdout.split("\n").filter(Boolean).map((l) => l.split("=")[0]);
    ok(seen.every((k) => R.ENV_ALLOW.includes(k) || k === "PWD" || k === "SHLVL" || k === "_") && !r.stdout.includes("should-not-leak") && !r.stdout.includes("SSH_AUTH_SOCK"), "tiến trình con thật sự chỉ thấy biến được phép", seen.join(","));
    const rp = await R.runCli("/usr/bin/env", [], { pty: true });
    ok(/TERM=xterm-256color/.test(rp.stdout) && !rp.stdout.includes("should-not-leak"), "chạy trong pty: thêm TERM, vẫn lọc khóa", rp.stdout.slice(0, 200));
    delete process.env.ANTHROPIC_API_KEY; delete process.env.SSH_AUTH_SOCK;

    fs.mkdirSync(BIN, { recursive: true });
    fs.symlinkSync("/bin/echo", path.join(BIN, "codex"));
    ok(R.find("codex") === null, "find() từ chối CLI trỏ ra ngoài thư mục nhà engine");
    fs.rmSync(path.join(BIN, "codex"));
    ok(R.find("claude") === null, "chưa cài → find() trả null");

    const pidFile = path.join(tmp, "child.pid");
    const p = R.spawnCli("/bin/sh", ["-c", `sleep 300 & echo $! > ${pidFile}; wait`], { timeoutMs: 60_000 });
    await sleep(400);
    const child = Number(fs.readFileSync(pidFile, "utf8"));
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    ok(alive(child), "tiến trình cháu (sleep) đang chạy");
    ok(R.descendants(p.child.pid).includes(child), "đọc được cây tiến trình con cháu (dùng để kill khi chạy bằng user riêng)");
    p.kill();
    const ex = await p.done;
    await sleep(200);
    ok(!alive(child) && ex.signal, "Dừng → kill cả nhóm, không còn tiến trình cháu", JSON.stringify(ex));
    const t = await R.runCli("/bin/sleep", ["30"], { timeoutMs: 300 });
    ok(t.timedOut && !t.aborted, "quá thời gian → dừng, đánh dấu timedOut", JSON.stringify(t));
    const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
    const a2 = await R.runCli("/bin/sleep", ["30"], { signal: ac.signal });
    ok(a2.aborted && !a2.timedOut, "AbortSignal → dừng, đánh dấu aborted", JSON.stringify(a2));
    ok(R.MAX_TURN_MS === 30 * 60_000, "trần mỗi lượt 30 phút");
    // User hệ thống riêng (VPS): sudo chạy từ "/", env -i -C chuyển vào thư mục làm việc dưới quyền user của engine.
    process.env.SYNCHRO_ENGINE_USER = "synchro-cli";
    const cmd = R.command("/x/claude", ["-p"], { HOME: "/e", PATH: "/usr/bin:/bin", CLAUDE_CODE_OAUTH_TOKEN: "tok" }, false, "/e/work/u1");
    const cmdPty = R.command("/x/agy", [], { HOME: "/e/logins/agy/u1", PATH: "/usr/bin" }, true, "/e/logins/agy/u1");
    delete process.env.SYNCHRO_ENGINE_USER;
    ok(cmd.file === "sudo" && cmd.cwd === "/" && cmd.argv.slice(0, 8).join(" ") === "-n -u synchro-cli -- env -i -C /e/work/u1" && cmd.argv.includes("CLAUDE_CODE_OAUTH_TOKEN=tok") && cmd.argv.slice(-2).join(" ") === "/x/claude -p" && Object.keys(cmd.env).join() === "PATH",
      "user riêng: sudo -n -u … -- env -i -C <thư mục làm việc> …, tiến trình sudo chạy từ /, chỉ truyền PATH cho sudo", JSON.stringify(cmd));
    ok(cmdPty.argv.includes("-C") && cmdPty.argv.includes(process.platform === "darwin" ? "/usr/bin/python3" : "script"), "user riêng + pty: bọc terminal giả bên trong sudo", JSON.stringify(cmdPty));
    const plain = R.command("/x/claude", ["-p"], { PATH: "/usr/bin" }, false, "/e/work/u1");
    ok(plain.file === "/x/claude" && plain.cwd === "/e/work/u1", "không có user riêng: chạy thẳng trong thư mục làm việc");
  }

  // Cài CLI giả lập như dev:mock (chép vào <home>/.local/bin, kèm địa chỉ máy chủ giả lập).
  for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
  fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: M }));

  // ------------------------------------------------------------------
  console.log("4. Đăng nhập theo tài khoản");
  const U = "user_A", U2 = "user_B";
  {
    const s0 = await A.status("claude", U);
    ok(s0.installed && /mock/.test(s0.version) && !s0.loggedIn && s0.method === null, "claude: đã cài, chưa đăng nhập", JSON.stringify(s0));
    const dir = A.scopeDir("claude", U);
    ok((fs.statSync(dir).mode & 0o777) === 0o700 && (fs.statSync(path.join(HOME, "logins")).mode & 0o777) === 0o700, "thư mục cấu hình quyền 0700");
    ok(A.safeScope("../../etc") === "______etc" && A.scopeDir("claude", "../x").startsWith(path.join(HOME, "logins", "claude")), "scope không thoát ra ngoài logins/");

    // Claude setup-token (cần terminal): link → mã sai → bắt đầu lại → mã đúng → token lưu mã hóa.
    let l = await A.startLogin("claude", U);
    ok(l.state === "open_url" && l.method === "token" && l.needsCode && l.url?.startsWith(`${M}/mock-login/claude`), "setup-token: có link đăng nhập, chờ dán mã", JSON.stringify(l));
    const t0w = Date.now();
    l = await A.submitCode("claude", U, "wrong-code#state");
    ok(l.state === "error" && /OAuth error/.test(l.message ?? "") && /link mới/.test(l.message ?? "") && !(l.message ?? "").includes("wrong-code") && Date.now() - t0w < 8000,
      "mã sai (Claude báo lỗi rồi đứng chờ) → báo ngay câu lỗi của Claude, không chờ hết giờ, không lộ mã đã dán", JSON.stringify({ l, ms: Date.now() - t0w }));
    let threw = ""; try { await A.submitCode("claude", U, "x"); } catch (e) { threw = e.message; }
    ok(/Không có lượt đăng nhập/.test(threw), "dán mã khi không có lượt đăng nhập → báo lỗi", threw);
    await A.startLogin("claude", U);
    const page = await fetch(`${M}/mock-login/claude`).then((r) => r.text());
    const code = /id="code"[^>]*>([^<]+)</.exec(page)?.[1];
    l = await A.submitCode("claude", U, code);
    ok(l.state === "done", "mã đúng → đăng nhập xong", JSON.stringify(l));
    const tokFile = path.join(process.env.DATA_DIR, "engine-tokens", `claude-${U}.enc`);
    const sealed = fs.readFileSync(tokFile, "utf8");
    ok(fs.existsSync(tokFile) && !sealed.includes("sk-ant-oat01") && (fs.statSync(tokFile).mode & 0o777) === 0o600 && !fs.readdirSync(dir).some((f) => f.includes("token") && f !== ".mock-last-token"), "token lưu mã hóa (0600) trong dữ liệu Synchro, không nằm trong thư mục CLI");
    const env = A.engineEnv("claude", U);
    ok(env.CLAUDE_CODE_OAUTH_TOKEN === fs.readFileSync(path.join(dir, ".mock-last-token"), "utf8") && env.CLAUDE_CONFIG_DIR === dir, "token đọc đủ (in làm hai đợt, chữ liền không dấu cách, CLI thoát ngay), giải mã chỉ để truyền cho CLI");
    const sample = `x${"y".repeat(10)}\nYourOAuthtoken(validfor1year):\n\nsk-ant-oat01-ABCdef_123-${"z".repeat(60)}\n\nStorethistokensecurely.Youwon'tbeabletoseeitagain.`;
    ok(A.extractToken(sample) === `sk-ant-oat01-ABCdef_123-${"z".repeat(60)}`, "extractToken: đúng ranh giới token khi câu sau in liền không dấu cách");
    ok(A.extractToken(`sk-ant-oat01-${"a".repeat(50)}`) === null && A.extractToken(`sk-ant-oat01-${"a".repeat(50)}`, true)?.length === 63, "extractToken: chưa in xong thì chờ, đã thoát thì lấy phần đã in");
    const s1 = await A.status("claude", U);
    ok(s1.loggedIn && s1.method === "token", "status sau đăng nhập: token", JSON.stringify(s1));
    const s2 = await A.status("claude", U2);
    ok(!s2.loggedIn, "tài khoản khác vẫn chưa đăng nhập (mỗi người một gói)");

    // Claude auth login --claudeai (đăng nhập tài khoản claude.ai, CLI tự giữ thông tin đăng nhập).
    l = await A.startLogin("claude", U2, "oauth");
    l = await A.submitCode("claude", U2, code);
    const s3 = await A.status("claude", U2);
    ok(l.state === "done" && s3.loggedIn && s3.method === "oauth", "auth login --claudeai → đăng nhập kiểu oauth", JSON.stringify({ l, s3 }));

    // Codex: link + mã thiết bị, người dùng cho phép trên trang của hãng, CLI tự thoát.
    l = await A.startLogin("codex", U);
    ok(l.state === "open_url" && !l.needsCode && /^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(l.userCode ?? "") && l.url?.includes(l.userCode), "codex: có link và mã thiết bị", JSON.stringify(l));
    await fetch(`${M}/mock-login/codex/approve?code=${l.userCode}`);
    for (let i = 0; i < 20 && (await A.status("codex", U, { fresh: true })).login?.state !== "done"; i++) await sleep(500);
    const c1 = await A.status("codex", U, { fresh: true });
    ok(c1.loggedIn && c1.method === "chatgpt", "codex: cho phép trên trang → đã đăng nhập ChatGPT", JSON.stringify(c1));

    // Antigravity: chạy agy trong pty, tự chọn Google OAuth, dán mã.
    l = await A.startLogin("agy", U);
    ok(l.state === "open_url" && l.needsCode && l.url?.startsWith(`${M}/mock-login/agy`), "agy: qua menu trong terminal tới link đăng nhập", JSON.stringify(l));
    l = await A.submitCode("agy", U, "MOCK-AGY-OK");
    const g1 = await A.status("agy", U, { fresh: true });
    const keysLog = path.join(HOME, "logins", "agy", U, ".gemini", "antigravity-cli", "onboarding-input.log");
    ok(l.state === "done" && g1.loggedIn && g1.method === "google" && g1.models?.some((x) => x.startsWith("gemini-4-argon-high\t")) && !g1.models.some((x) => /^fetching/i.test(x)), "agy: đăng nhập xong, phiên được lưu, đọc được danh sách model (bỏ dòng Fetching…)", JSON.stringify({ l, g1 }));
    ok(!fs.existsSync(keysLog), "agy: Synchro không gõ phím nào vào màn hình làm quen (bảng màu, điều khoản)");
    ok(A.engineEnv("agy", U).HOME === A.scopeDir("agy", U), "agy: mỗi tài khoản một thư mục nhà riêng");
  }

  // ------------------------------------------------------------------
  console.log("5. Ba engine: chào, rồi hỏi tiếp bằng resume");
  for (const cli of ["claude", "codex", "agy"]) {
    const env = A.engineEnv(cli, U);
    const r1 = await E.collect(S.engineFor(cli).runTurn({ prompt: "chào", system: "Trả lời bằng tiếng Việt.", env }));
    ok(!r1.error && r1.session && /lượt 1/.test(r1.text) && r1.via === cli, `${cli}: "chào" → có phiên, có trả lời`, JSON.stringify(r1));
    const r2 = await E.collect(S.engineFor(cli).runTurn({ prompt: "bạn nhớ mình vừa nói gì không?", sessionId: r1.session, env }));
    ok(!r2.error && r2.session === r1.session && /lượt 2/.test(r2.text), `${cli}: câu tiếp theo nối đúng phiên (resume)`, JSON.stringify(r2));
    ok(r2.usage && r2.usage.output > 0, `${cli}: có số token`, JSON.stringify(r2.usage));
    const q = await E.collect(S.engineFor(cli).runTurn({ prompt: "[mock:quota] chào", env }));
    ok(q.error?.code === "quota", `${cli}: hết hạn mức → lỗi quota`, JSON.stringify(q.error));
    const no = await E.collect(S.engineFor(cli).runTurn({ prompt: "chào", env: A.engineEnv(cli, "chua_dang_nhap") }));
    ok(no.error?.code === "auth", `${cli}: chưa đăng nhập → lỗi auth`, JSON.stringify(no.error));
  }
  {
    const ev = await all(S.engineFor("claude").runTurn({ prompt: "chào", env: A.engineEnv("claude", U) }));
    const lim = ev.find((e) => e.kind === "usage")?.usage?.limits ?? [];
    ok(lim.some((w) => w.window === "five_hour" && w.usedPct > 0 && w.resetsAt > Date.now()) && lim.some((w) => w.window === "seven_day"), "claude: đọc hạn mức phiên 5 giờ và tuần từ rate_limit_event", JSON.stringify(lim));
    ok(ev.filter((e) => e.kind === "text").length > 1, "claude: chữ hiện dần (text_delta)");
    const t0 = Date.now();
    const a401 = await E.collect(S.engineFor("claude").runTurn({ prompt: "[mock:auth401]", env: A.engineEnv("claude", U) }));
    ok(a401.error?.code === "auth" && Date.now() - t0 < 10_000, "claude: api_retry 401 → dừng ngay, báo đăng nhập lại", JSON.stringify(a401.error));
    const ac = new AbortController(); setTimeout(() => ac.abort(), 300);
    const ab = await E.collect(S.engineFor("claude").runTurn({ prompt: "[mock:auth401]", env: A.engineEnv("claude", U2), signal: ac.signal }));
    ok(ab.error?.code === "aborted" || ab.error?.code === "auth", "bấm Dừng giữa lượt → dừng tiến trình", JSON.stringify(ab.error));
  }

  // ------------------------------------------------------------------
  console.log("6. Khóa API dự phòng");
  {
    const none = await E.collect(new API.ApiEngine("anthropic").runTurn({ prompt: "chào" }));
    ok(none.error && /Chưa có khóa API/.test(none.error.message), "chưa có khóa → báo rõ", JSON.stringify(none.error));
    await P.saveProvider({ id: "anthropic", key: MOCK_KEYS.anthropic, baseUrl: `${M}/anthropic` });
    const r = await E.collect(S.engineFor("api:anthropic").runTurn({ prompt: "chào", system: "ngắn gọn" }));
    ok(!r.error && r.text && r.via === "api:anthropic", "engine API Anthropic trả lời", JSON.stringify(r).slice(0, 300));
    const fb = await E.collect(API.engineWithFallback("claude").runTurn({ prompt: "[mock:quota] chào", env: A.engineEnv("claude", U) }));
    ok(!fb.error && fb.via === "api:anthropic" && fb.text, "gói Claude hết hạn mức → tự chuyển sang khóa API Anthropic", JSON.stringify(fb).slice(0, 300));
    const keep = await E.collect(API.engineWithFallback("claude").runTurn({ prompt: "chào", env: A.engineEnv("claude", U) }));
    ok(!keep.error && keep.via === "claude", "còn hạn mức → vẫn dùng gói subscription", JSON.stringify(keep).slice(0, 200));
    const auth = await E.collect(API.engineWithFallback("claude").runTurn({ prompt: "chào", env: A.engineEnv("claude", "chua_dang_nhap") }));
    ok(auth.error?.code === "auth", "lỗi đăng nhập không chuyển sang API (báo người dùng đăng nhập lại)", JSON.stringify(auth));
    const noKey = await E.collect(API.engineWithFallback("codex").runTurn({ prompt: "[mock:quota] chào", env: A.engineEnv("codex", U) }));
    ok(noKey.error?.code === "quota", "hãng chưa có khóa API → giữ lỗi quota", JSON.stringify(noKey.error));
    const bad = await E.collect(new API.ApiEngine("anthropic").runTurn({ prompt: "#429 chào" }));
    ok(bad.error?.code === "quota", "API trả 429 → lỗi quota", JSON.stringify(bad.error));
  }

  // ------------------------------------------------------------------
  console.log("7. Hạn mức gói: phiên 5 giờ và tuần");
  {
    const now = Date.now(), sec = (t) => Math.floor(t / 1000);
    const cl = CE.claudeLimits({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.83, resetsAt: sec(now + 2 * 3600e3),
      unifiedWindows: { five_hour: { utilization: 0.83, resetsAt: sec(now + 2 * 3600e3), status: "allowed_warning" }, seven_day: { utilization: 0.4, resetsAt: sec(now + 3 * 86400e3) }, seven_day_overage_included: { utilization: 0.1, resetsAt: sec(now + 3 * 86400e3) } } });
    const f = cl.find((w) => w.window === "five_hour"), w7 = cl.find((w) => w.window === "seven_day");
    ok(cl.length === 3 && f.usedPct === 83 && f.status === "allowed_warning" && Math.abs(f.resetsAt - (now + 2 * 3600e3)) < 2000 && w7.usedPct === 40, "Claude: đọc unifiedWindows (utilization 0–1, resetsAt giây → ms)", JSON.stringify(cl));
    ok(CE.claudeLimits({ status: "rejected", rateLimitType: "seven_day", resetsAt: sec(now + 86400e3) })[0]?.usedPct === 100, "Claude: bị từ chối mà không có utilization → 100%");
    const past = SUBS.project({ window: "five_hour", kind: "session", label: "", usedPct: 92, resetsAt: now - 60_000, status: "rejected" }, now);
    ok(past.usedPct === 0 && past.idle && past.resetsAt === undefined, "phiên 5 giờ đã qua mốc → 0%, bắt đầu lại ở tin nhắn sau", JSON.stringify(past));
    const wk = SUBS.project({ window: "seven_day", kind: "weekly", label: "", usedPct: 70, resetsAt: now - 3600e3 }, now);
    ok(wk.usedPct === 0 && wk.resetsAt === now - 3600e3 + 7 * 86400e3, "tuần đã qua mốc → 0%, mốc kế tiếp đúng 7 ngày sau mốc cũ (giờ cố định)", JSON.stringify(wk));
    const keep = SUBS.project({ window: "seven_day", kind: "weekly", label: "", usedPct: 70, resetsAt: now + 3600e3 }, now);
    ok(keep.usedPct === 70, "chưa tới mốc → giữ nguyên số hãng báo");
    const plus = SUBS.codexWindows({ rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: sec(now + 3600e3) }, secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: sec(now + 5 * 86400e3) }, planType: "plus", credits: { hasCredits: true, unlimited: false, balance: "12.50" } } });
    ok(plus.windows.map((w) => w.window).join() === "five_hour,seven_day" && plus.windows[0].usedPct === 42 && plus.plan === "plus" && plus.credits === "Credits: 12.50", "Codex Plus: phiên 5 giờ + tuần, gói, credits", JSON.stringify(plus));
    const pro = SUBS.codexWindows({ rateLimits: { primary: null, secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: sec(now + 6 * 86400e3) }, planType: "pro" } });
    ok(pro.windows.length === 1 && pro.windows[0].window === "seven_day", "Codex Pro: chỉ có hạn mức tuần", JSON.stringify(pro));
    const ag = SUBS.agyWindows(" Model quota\n Gemini Models\n   Five Hour Limit Remaining  64%  resets in 3h 12m\n   Weekly Limit Remaining  90%  resets in 5d 2h\n Claude and GPT Models\n   Five Hour Limit Remaining  100%\n   Weekly Limit Remaining  0%\n");
    const g5 = ag.find((w) => w.window === "gemini_session"), ow = ag.find((w) => w.window === "other_weekly");
    ok(ag.length === 4 && g5.usedPct === 36 && Math.abs(g5.resetsAt - (Date.now() + (3 * 60 + 12) * 60e3)) < 5000 && ow.status === "rejected" && ow.usedPct === 100 && /Claude and GPT/.test(ow.label), "Antigravity: hai nhóm model × phiên 5 giờ / tuần từ bảng /usage", JSON.stringify(ag));

    const me = { id: U, email: "user@synchro.test", email_verified: 1, status: "active" };
    const subs = await SUBS.mergedProviders(me, await P.catalog());
    const ids = subs.filter((p) => p.source === "plan").map((p) => `${p.id}:${p.name}`).join();
    const codexModels = subs.find((p) => p.id === "openai")?.models.map((m) => m.id) ?? [];
    ok(ids === "anthropic:Claude,openai:ChatGPT,google:Gemini", "bộ chọn model gộp theo hãng: ba nhóm Claude, ChatGPT, Gemini đều đang hiện model của gói", ids);
    const gem = subs.find((p) => p.id === "google")?.models ?? [];
    ok(subs.find((p) => p.id === "anthropic")?.models.some((m) => m.key === "sub-claude/sonnet"), "Claude: opus / sonnet / haiku");
    ok(gem.map((m) => m.id).join() === "gemini-4-argon,gemini-3.8-flash,gemini-3.1-flash-lite" && gem.map((m) => m.name).join() === "Gemini 4 Argon,Gemini 3.8 Flash,Gemini 3.1 Flash Lite",
      "Gemini: chỉ model Gemini (không lẫn Claude / GPT của Antigravity), gộp biến thể High / Medium / Low thành một model, tên chuẩn", JSON.stringify(gem));
    const AG = SUBS.agyModels(["Fetching available models...", "gemini-3.8-flash-high\tGemini 3.8 Flash (High)", "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)", "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)", "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)"]);
    ok(AG.length === 1 && AG[0].name === "Gemini 3.8 Flash" && AG[0].variants.high === "gemini-3.8-flash-high", "agyModels: đọc đúng đầu ra thật của agy 1.4.7", JSON.stringify(AG));
    ok(codexModels.includes("gpt-6.1-sol") && !codexModels.includes("codex-internal"), "Codex: danh sách model thật từ app-server (bỏ model ẩn)", codexModels.join());
    // Lượt chat qua gói: lượt đầu mở phiên, lượt sau nối tiếp (resume), sửa lịch sử thì mở phiên mới kèm lịch sử.
    const conv = "conv-sub-1";
    const t1 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "Trả lời ngắn.", messages: [{ role: "user", content: "chào" }], conv });
    ok(t1.status === 200 && /lượt 1/.test(t1.json.text) && t1.json.via === "claude", "subTurn: lượt đầu chạy bằng gói Claude", JSON.stringify(t1));
    const t2 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "chào" }, { role: "assistant", content: t1.json.text }, { role: "user", content: "tiếp nhé" }], conv });
    ok(t2.status === 200 && /lượt 2/.test(t2.json.text), "subTurn: câu tiếp theo nối đúng phiên CLI", JSON.stringify(t2));
    const t3 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "câu khác" }], conv });
    ok(t3.status === 200 && /lượt 1/.test(t3.json.text), "subTurn: lịch sử không khớp (sửa / tạo lại) → mở phiên mới", JSON.stringify(t3));
    const cl2 = await SUBS.subUsage(me, "claude");
    const oauthPlan = await SUBS.subUsage({ ...me, id: U2 }, "claude");
    ok(oauthPlan.plan === "Max" && cl2.plan === null, "tên gói: đăng nhập claude.ai cho biết gói (Max); token dài hạn thì không", JSON.stringify({ a: oauthPlan.plan, b: cl2.plan }));
    ok(cl2.windows[0]?.kind === "session" && cl2.windows[0].usedPct > 0 && cl2.windows.some((w) => w.kind === "weekly" && w.resetsAt > Date.now()), "Claude: vòng tròn có phiên 5 giờ + tuần do CLI báo", JSON.stringify(cl2));
    const q = await SUBS.subTurn({ user: { ...me, id: U2 }, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "[mock:quota] chào" }] });
    ok(q.status === 429 && q.json.planLimit === "claude" && q.json.apiModel?.startsWith("anthropic/claude-sonnet") && q.json.resetsAt > Date.now() && !q.json.via, "gói hết hạn mức → KHÔNG tự chuyển; trả model API tương đương để hỏi người dùng", JSON.stringify(q));
    ok(SUBS.planBlock("claude", U2) === q.json.resetsAt, "ghi nhận gói hết hạn mức tới mốc đặt lại hãng báo");
    let grp = (await SUBS.mergedProviders({ ...me, id: U2 }, await P.catalog())).find((p) => p.id === "anthropic");
    ok(grp?.source === "plan" && grp.plan?.blockedUntil === q.json.resetsAt && grp.models.every((m) => m.key.startsWith("sub-claude/")), "chưa đồng ý: nhóm Claude vẫn hiện model của gói (kèm mốc hồi lại)", JSON.stringify(grp));
    const until = SUBS.setApiOptIn(U2, "claude", true);
    grp = (await SUBS.mergedProviders({ ...me, id: U2 }, await P.catalog())).find((p) => p.id === "anthropic");
    ok(until === q.json.resetsAt && grp?.source === "api" && grp.models.every((m) => m.key.startsWith("anthropic/")) && grp.plan?.usingApiUntil === until, "đồng ý: nhóm Claude chuyển sang model API tới khi gói hồi lại", JSON.stringify(grp));
    SUBS.setApiOptIn(U2, "claude", false);
    grp = (await SUBS.mergedProviders({ ...me, id: U2 }, await P.catalog())).find((p) => p.id === "anthropic");
    ok(grp?.source === "plan", "quay lại gói: nhóm Claude hiện lại model của gói");
    const merged = await SUBS.mergedProviders({ ...me, id: "chua_dang_nhap" }, await P.catalog());
    ok(merged.find((p) => p.id === "anthropic")?.source === "api" && !merged.some((p) => p.id.startsWith("sub-")), "chưa đăng nhập gói: nhóm Claude hiện model API, không có nhóm riêng cho gói", JSON.stringify(merged.map((p) => [p.id, p.source])));
    const no = await SUBS.subTurn({ user: { ...me, id: "chua_dang_nhap" }, model: "sub-codex/default", system: "", messages: [{ role: "user", content: "chào" }] });
    ok(no.status === 409 && no.json.relogin === "codex", "chưa đăng nhập gói → 409, nhắc đăng nhập ở Providers", JSON.stringify(no));
    // Effort chọn ở mục Effort riêng: agy đổi sang đúng biến thể model, model không có biến thể thì truyền --effort; Claude --effort; Codex reasoning effort.
    const eff = async (model, effort) => (await SUBS.subTurn({ user: me, model, system: "", messages: [{ role: "user", content: "chào" }], effort })).json.text ?? "";
    ok(/\[model gemini-3\.8-flash-high\]/.test(await eff("sub-agy/gemini-3.8-flash", "high")) && /\[model gemini-3\.8-flash-low\]/.test(await eff("sub-agy/gemini-3.8-flash", "low")), "Gemini: effort High / Low → đúng biến thể model của agy");
    const lite = await eff("sub-agy/gemini-3.1-flash-lite", "high");
    ok(/\[model gemini-3\.1-flash-lite\]/.test(lite) && /\[effort high\]/.test(lite), "Gemini: model không có biến thể → truyền --effort", lite);
    ok(/\[model gemini-4-argon-medium\]/.test(await eff("sub-agy/gemini-4-argon")), "Gemini: chưa chọn effort → biến thể Medium");
    ok(/\[effort xhigh\]/.test(await eff("sub-claude/sonnet", "extra")) && /\[effort max\]/.test(await eff("sub-codex/gpt-6.1-sol", "max")) && /\[effort high\]/.test(await eff("sub-codex/gpt-6.1-sol", "high")), "Claude --effort, Codex model_reasoning_effort theo mục Effort");
    ok(/\[effort xhigh\]/.test(await eff("sub-codex/gpt-5.5", "max")), "Codex: model không có mức max → dùng mức cao nhất model hỗ trợ (xhigh)");
    const clm = (await SUBS.mergedProviders(me, await P.catalog())).find((p) => p.id === "anthropic").models;
    ok(clm.map((m) => m.id).join() === "fable,opus,sonnet,haiku" && clm.find((m) => m.id === "sonnet").name === "Claude Sonnet 5.5", "Claude: Fable / Opus / Sonnet / Haiku, tên theo model thật Claude Code báo (Sonnet → Claude Sonnet 5.5)", JSON.stringify(clm));
    const ag0 = await SUBS.subUsage(me, "agy");
    ok(ag0.setup && !ag0.windows.length && !fs.existsSync(path.join(HOME, "logins", "agy", U, ".gemini", "antigravity-cli", "onboarding-input.log")), "Antigravity chưa làm quen: báo cần hoàn tất, không gõ phím nào thay người dùng", JSON.stringify(ag0));
    fs.mkdirSync(path.join(HOME, "logins", "agy", U, ".gemini", "antigravity-cli", "cache"), { recursive: true });
    fs.writeFileSync(path.join(HOME, "logins", "agy", U, ".gemini", "antigravity-cli", "cache", "onboarding.json"), JSON.stringify({ onboardingComplete: true }));
    const ag2 = await SUBS.subUsage(me, "agy", { fresh: true });
    ok(!ag2.setup && ag2.windows.length === 4 && ag2.windows.some((w) => w.group === "Gemini models" && w.kind === "session" && w.usedPct > 0), "người dùng làm quen xong → đọc bảng /usage trong terminal giả", JSON.stringify(ag2));
    const cu = await SUBS.subUsage(me, "codex");
    ok(cu.plan === "Plus" && cu.windows.some((w) => w.kind === "session") && cu.windows.some((w) => w.kind === "weekly"), "Codex: hạn mức gói đọc qua app-server", JSON.stringify(cu));
  }

  // ------------------------------------------------------------------
  console.log("8. Đăng xuất");
  {
    await A.logout("claude", U);
    const s = await A.status("claude", U);
    ok(!s.loggedIn && !fs.existsSync(path.join(process.env.DATA_DIR, "engine-tokens", `claude-${U}.enc`)), "claude: đăng xuất xóa token và thư mục cấu hình");
    await A.logout("agy", U);
    ok(!(await A.status("agy", U)).loggedIn, "agy: đăng xuất");
    ok((await A.status("codex", U)).loggedIn, "đăng xuất claude không ảnh hưởng codex");
  }
} catch (e) {
  ok(false, "lỗi bất ngờ", e.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
