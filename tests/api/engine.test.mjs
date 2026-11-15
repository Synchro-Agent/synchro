// Engine CLI (ADR 0001): EchoEngine qua engineFor, phân loại lỗi, che khóa, lọc biến môi trường, kill cả process group,
// đăng nhập theo tài khoản (claude setup-token qua pty, codex mã thiết bị, agy menu trong terminal), ba engine với CLI giả lập
// (chào rồi hỏi tiếp bằng resume), và chuyển sang khóa API khi gói hết hạn mức.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu, thư mục nhà engine và máy chủ giả lập riêng cho lượt kiểm thử.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { MOCK_KEYS, startMock } from "../../tools/mock-providers.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-engine-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "engine-test-key";
// Bộ canh lượt treo: rút còn 4 giây để thử lượt treo; các lượt giả lập khác xong trong tích tắc.
process.env.SYNCHRO_WATCH_SEC = "4";
process.env.SYNCHRO_AGY_TICK_MS = "60";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const PORT = 4300 + Math.floor(Math.random() * 500);
await startMock(PORT);
const M = `http://127.0.0.1:${PORT}`;

const mods = await loadTs(["ai/engine", "ai/selector", "ai/errors", "ai/cli_runtime", "ai/cli_auth", "ai/cli_engines", "ai/api_engine", "ai/subs", "providers", "authstore"]);
const AS0 = mods.authstore;
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
      ["RESOURCE_EXHAUSTED: You have exhausted your capacity on this model.", "quota"], ["Rate limit reached for requests", "rate"], ["Too Many Requests", "rate"],
      // Giới hạn tốc độ ngắn không phải hết gói; chờ dài (tính bằng giờ) mới là hạn mức của gói.
      ["Rate limit exceeded. Try again in 30 seconds.", "rate"], ["overloaded_error", "rate"], ["API Error: 529", "rate"], ["Rate limit exceeded: you've reached your SuperGrok usage limit. Try again in 2 hours.", "quota"], ["Too many requests, try again in 3 hours", "quota"], ["Retry-After: 20 too many requests", "rate"],
      ["Your credit balance is too low to access the Anthropic API.", "quota"], ["insufficient_quota", "quota"],
      ["Not logged in · Please run /login", "auth"], ["unexpected status 401 Unauthorized: Missing bearer", "auth"], ["authentication failed or timed out", "auth"],
      ["OAuth token has expired. Please obtain a new token.", "auth"], ["Invalid API key", "auth"], ["403 Forbidden", "auth"], ["Account on hold", "auth"],
      ["model not found", "other"], ["Internal server error", "other"], ["ECONNRESET", "other"], ["", "other"],
      // Số 401, 403 nằm trong đầu ra của một trang hay công cụ không phải lỗi đăng nhập của hãng.
      ["Tool browser_read failed: https://example.com returned 403 for this page", "other"], ["API Error: 401 authentication_error", "auth"], ["HTTP 403 forbidden from provider", "auth"],
    ];
    const bad = cases.filter(([m, k]) => X.classify(m) !== k);
    ok(!bad.length, `${cases.length} câu lỗi thật của các CLI phân loại đúng`, JSON.stringify(bad.map(([m, k]) => [m, k, X.classify(m)])));
    ok(X.classify("xyz", 401) === "auth" && X.classify("xyz", 403) === "auth" && X.classify("xyz", 429) === "rate" && X.classify("usage limit reached", 429) === "quota" && X.classify("xyz", 500) === "other", "theo mã HTTP: 401/403 → auth, 429 không nói gì thêm → giới hạn tốc độ");
    ok(X.retryAfterMs("try again in 2 hours 14 minutes") === 134 * 60_000 && X.retryAfterMs("retry after 30s") === 30_000 && X.retryAfterMs("Retry-After: 20") === 20_000 && X.retryAfterMs("resets 3pm") === null && X.retryAfterMs("xin chào") === null, "đọc được thời gian hãng bảo chờ");
    ok(/quá dài/.test(X.friendlyError("Prompt is too long", "Claude")) && /Mất kết nối/.test(X.friendlyError("socket hang up", "Grok")) && X.friendlyError("lỗi lạ", "Grok") === null, "lỗi tiếng Anh thường gặp có câu ngắn kèm việc làm được");
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
    ok((await R.descendants(p.child.pid)).includes(child), "đọc được cây tiến trình con cháu (dùng để kill khi chạy bằng user riêng)");
    p.kill();
    const ex = await p.done;
    await sleep(200);
    ok(!alive(child) && ex.signal, "Dừng → kill cả nhóm, không còn tiến trình cháu", JSON.stringify(ex));
    const t = await R.runCli("/bin/sleep", ["30"], { timeoutMs: 300 });
    ok(t.timedOut && !t.aborted, "quá thời gian → dừng, đánh dấu timedOut", JSON.stringify(t));
    const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
    const a2 = await R.runCli("/bin/sleep", ["30"], { signal: ac.signal });
    ok(a2.aborted && !a2.timedOut, "AbortSignal → dừng, đánh dấu aborted", JSON.stringify(a2));
    ok(R.MAX_TURN_MS === 180 * 60_000 && R.IDLE_MS === 40 * 60_000, "trần mỗi lượt 3 giờ, dừng khi im lặng 40 phút");
    // User hệ thống riêng (VPS): sudo chạy từ "/", env -i -C chuyển vào thư mục làm việc dưới quyền user của engine.
    process.env.SYNCHRO_ENGINE_USER = "synchro-cli";
    const cmd = R.command("/x/claude", ["-p"], { HOME: "/e", PATH: "/usr/bin:/bin", CLAUDE_CODE_OAUTH_TOKEN: "tok" }, false, "/e/work/u1");
    const cmdPty = R.command("/x/agy", [], { HOME: "/e/logins/agy/u1", PATH: "/usr/bin" }, true, "/e/logins/agy/u1");
    delete process.env.SYNCHRO_ENGINE_USER;
    ok(cmd.file === "sudo" && cmd.cwd === "/" && cmd.argv.slice(0, 8).join(" ") === "-n -u synchro-cli -- env -i -C /e/work/u1" && cmd.argv.slice(-2).join(" ") === "/x/claude -p" && Object.keys(cmd.env).join() === "PATH",
      "user riêng: sudo -n -u … -- env -i -C <thư mục làm việc> …, tiến trình sudo chạy từ /, chỉ truyền PATH cho sudo", JSON.stringify(cmd));
    ok(cmdPty.argv.includes("-C") && cmdPty.argv.includes(process.platform === "darwin" ? "/usr/bin/python3" : "script"), "user riêng + pty: bọc terminal giả bên trong sudo", JSON.stringify(cmdPty));
    const plain = R.command("/x/claude", ["-p"], { PATH: "/usr/bin" }, false, "/e/work/u1");
    ok(plain.file === "/x/claude" && plain.cwd === "/e/work/u1", "không có user riêng: chạy thẳng trong thư mục làm việc");
    // Token không nằm trên dòng lệnh (ps của mọi user đều thấy): đi qua dòng đầu của stdin, prompt theo sau vẫn tới CLI nguyên vẹn.
    ok(!cmd.argv.join(" ").includes("tok ") && !cmd.argv.some((a) => a.includes("=tok")) && cmd.stdinHead === "tok\n", "user riêng: token Claude không nằm trên dòng lệnh", JSON.stringify(cmd));
    {
      const fake = path.join(tmp, "fakebin");
      fs.mkdirSync(fake, { recursive: true });
      // sudo giả: bỏ "-n -u <user> --", chạy phần còn lại như sudo thật.
      fs.writeFileSync(path.join(fake, "sudo"), '#!/bin/sh\nshift 4\nexec "$@"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(fake, "env"), '#!/bin/sh\nexec /usr/bin/env "$@"\n', { mode: 0o755 });
      process.env.SYNCHRO_ENGINE_USER = "synchro-cli";
      const wd = path.join(tmp, "wd"); fs.mkdirSync(wd, { recursive: true });
      const r = await R.runCli("/bin/sh", ["-c", 'cat; printf "|%s|" "$CLAUDE_CODE_OAUTH_TOKEN"; pwd'], { env: { CLAUDE_CODE_OAUTH_TOKEN: "bi-mat", PATH: `${fake}:/usr/bin:/bin` }, cwd: wd, stdin: "nội dung prompt\n" }).catch((e) => ({ stdout: String(e) }));
      delete process.env.SYNCHRO_ENGINE_USER;
      ok(/^nội dung prompt\n\|bi-mat\|/.test(r.stdout) && r.stdout.includes("wd"), "CLI nhận đúng token và prompt qua stdin", JSON.stringify(r));
    }
    // Cô lập theo tài khoản (SYNCHRO_ENGINE_BWRAP=1): chỉ thấy thư mục của chính mình, /proc riêng; lệnh không gắn tài khoản (cài CLI) không qua hộp.
    {
      const lg = path.join(HOME, "logins"), wk = path.join(HOME, "work");
      const env = { CODEX_HOME: path.join(lg, "codex", "u1"), HOME, PATH: "/usr/bin" }, cwd = path.join(wk, "u1");
      ok(R.isolate("/x/codex", ["exec"], env, cwd).file === "/x/codex", "mặc định không bật hộp (cần gói bubblewrap trên máy chủ)");
      process.env.SYNCHRO_ENGINE_BWRAP = "1";
      const b = R.isolate("/x/codex", ["exec"], env, cwd), j = b.argv.join(" ");
      const noScope = R.isolate("/bin/sh", ["-c", "x"], { HOME, PATH: "/usr/bin" }, HOME);
      const root = R.isolate("/x/codex", ["app-server"], env, wk).argv.join(" ");
      const agy = R.isolate("/x/agy", [], { HOME: path.join(lg, "agy", "u1") }, path.join(wk, "u1"));
      delete process.env.SYNCHRO_ENGINE_BWRAP;
      ok(b.file === "bwrap" && j.indexOf(`--tmpfs ${lg}`) >= 0 && j.indexOf(`--tmpfs ${lg}`) < j.indexOf(`--bind ${env.CODEX_HOME} ${env.CODEX_HOME}`) && j.includes(`--bind ${cwd} ${cwd}`) && j.includes(`--chdir ${cwd}`) && j.endsWith("-- /x/codex exec"), "hộp: ẩn logins/ và work/ rồi chỉ gắn lại thư mục của tài khoản", j);
      ok(j.includes("--unshare-pid") && j.includes("--proc /proc"), "hộp: /proc riêng, không đọc được biến môi trường của lượt khác", j);
      ok(!j.includes(`--bind ${wk} `) && !root.includes(`--bind ${wk} `), "thư mục làm việc gốc không được gắn nguyên (lộ thư mục của người khác)", root);
      ok(b.env.HOME === env.CODEX_HOME && agy.env.HOME === path.join(lg, "agy", "u1"), "HOME là thư mục của tài khoản (nhà engine chỉ đọc trong hộp)", JSON.stringify(b.env));
      ok(noScope.file === "/bin/sh", "lệnh không gắn tài khoản (cài CLI, dọn thư mục) không đi qua hộp");
    }
  }

  // Cài CLI giả lập như dev:mock (chép vào <home>/.local/bin, kèm địa chỉ máy chủ giả lập).
  for (const f of fs.readdirSync("tools/mock-cli")) { fs.copyFileSync(path.join("tools/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
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
    ok(/Lượt đăng nhập này không còn/.test(threw), "dán mã khi không có lượt đăng nhập → báo rõ (máy chủ khởi động lại hoặc hết hạn), không chung chung", threw);
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
    const two = await all(S.engineFor("claude").runTurn({ prompt: "[mock:twomsg] tìm giúp", env: A.engineEnv("claude", U) }));
    const said = two.filter((e) => e.kind === "text").map((e) => e.text).join("");
    ok(said === "Mình sẽ tìm trên web.\n\nTheo kết quả tìm web: xong.", "claude: hai tin trong một lượt cách nhau một dòng trống (không dính “web.Theo”)", JSON.stringify(said));
    ok(two.some((e) => e.kind === "search" && e.query === "mock") && two.some((e) => e.kind === "sources" && e.items[0]?.url === "https://example.com/nguon" && e.items[0]?.title === "Nguồn giả"), "claude: tìm web hiện thành bước, có nguồn", JSON.stringify(two.filter((e) => e.kind === "search" || e.kind === "sources")));
    const hi = await all(S.engineFor("claude").runTurn({ prompt: "chào", env: A.engineEnv("claude", U) }));
    const firstAct = hi.findIndex((e) => e.kind === "activity"), firstSess = hi.findIndex((e) => e.kind === "session");
    ok(firstSess >= 0 && firstAct > firstSess, "claude: init chỉ là khởi động, hoạt động thật tới sau đó", JSON.stringify(hi.map((e) => e.kind).slice(0, 6)));
    const rt = await all(S.engineFor("claude").runTurn({ prompt: "[mock:retrying] chào", env: A.engineEnv("claude", U) }));
    ok(rt.some((e) => e.kind === "status" && /đang thử lại .*\(lần 1\/10\)/.test(e.text)), "claude: api_retry thành dòng trạng thái", JSON.stringify(rt.map((e) => e.kind)));
    ok(CE.webSources({ results: [{ content: [{ title: "A", url: "https://a.vn" }, { title: "B", url: "ftp://b" }] }] }).length === 1 && CE.webSources('Links: [{"title":"C \\"x\\"","url":"https://c.vn"}]')[0]?.title === 'C "x"', "đọc nguồn từ mọi dạng kết quả tìm web");
    const t0 = Date.now();
    const a401 = await E.collect(S.engineFor("claude").runTurn({ prompt: "[mock:auth401]", env: A.engineEnv("claude", U) }));
    ok(a401.error?.code === "auth" && Date.now() - t0 < 10_000, "claude: api_retry 401 → dừng ngay, báo đăng nhập lại", JSON.stringify(a401.error));
    const ac = new AbortController(); setTimeout(() => ac.abort(), 300);
    const ab = await E.collect(S.engineFor("claude").runTurn({ prompt: "[mock:auth401]", env: A.engineEnv("claude", U2), signal: ac.signal }));
    ok(ab.error?.code === "aborted" || ab.error?.code === "auth", "bấm Dừng giữa lượt → dừng tiến trình", JSON.stringify(ab.error));
  }

  // Codex: "chỉ đọc" vẫn đọc được cả đĩa, và mọi thư mục đăng nhập cùng một user hệ thống.
  {
    const dir = A.engineEnv("codex", U).CODEX_HOME, mark = path.join(dir, "shell-ran");
    const t0 = Date.now();
    const r = await E.collect(S.engineFor("codex").runTurn({ prompt: "[mock:shell] đọc ../../logins/*", env: A.engineEnv("codex", U) }));
    ok(/định chạy lệnh/.test(r.error?.message ?? "") && !r.text && Date.now() - t0 < 5000, "codex: model định chạy lệnh trên máy chủ → dừng lượt, không có câu trả lời", JSON.stringify(r));
    await sleep(1200);
    ok(!fs.existsSync(mark), "codex: tiến trình bị dừng trước khi kết quả lệnh kịp về", "tiến trình mock vẫn chạy tiếp");
    const L = CE.CODEX_LOCAL;
    ok(L.test("command_execution") && L.test("file_change") && !L.test("mcp_tool_call") && !L.test("agent_message") && !L.test("web_search") && !L.test("reasoning"), "chỉ chặn công cụ chạy trên máy chủ, không chặn công cụ Synchro / tìm web / câu trả lời");
    const src = fs.readFileSync("server/ai/cli_engines.ts", "utf8");
    ok(src.includes('"features.shell_tool=false"') && src.includes('"features.unified_exec=false"') && src.includes('"tools.view_image=false"'), "codex: gọi CLI với công cụ shell và xem tệp đã tắt");
  }

  // Codex + công cụ của Synchro: địa chỉ cầu nối (có token bí mật) nằm trong config.toml của CODEX_HOME riêng của lượt, không trên dòng lệnh.
  {
    const http = await import("node:http");
    const SECRET = "tok-bi-mat-" + Math.random().toString(36).slice(2);
    const srv = http.createServer((q, s) => {
      let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
        const m = (() => { try { return JSON.parse(b); } catch { return {}; } })();
        if (!q.url.endsWith(SECRET) || m.id === undefined) { s.writeHead(q.url.endsWith(SECRET) ? 202 : 404); return s.end(); }
        const result = m.method === "tools/list" ? { tools: [{ name: "echo" }, { name: "time" }] } : m.method === "tools/call" ? { content: [{ type: "text", text: "ok-tu-cong-cu" }] } : {};
        s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      });
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const mcp = { url: `http://127.0.0.1:${srv.address().port}/api/mcp/bridge/${SECRET}` };
    const env = A.engineEnv("codex", U), base = env.CODEX_HOME;
    // Cấu hình sẵn có của tài khoản: giữ phần khác, bỏ mục synchro cũ (trùng bảng thì TOML hỏng, codex không chạy).
    const baseCfg = 'model = "gpt-5.5"\n\n[mcp_servers.synchro]\nurl = "http://127.0.0.1:9/cu"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
    fs.writeFileSync(path.join(base, "config.toml"), baseCfg);
    const turns = () => fs.readdirSync(base).filter((n) => n.startsWith(R.CODEX_TURN_PREFIX));
    const r1 = await E.collect(S.engineFor("codex").runTurn({ prompt: "[mock:argv] chào", env, mcp }));
    ok(!r1.error && /\[công cụ Synchro: 2\]/.test(r1.text), "codex: đọc cầu nối từ config.toml của lượt, thấy công cụ", JSON.stringify(r1));
    ok(!r1.text.includes(SECRET) && /\[home \.synchro-codex-/.test(r1.text) && !/mcp_servers/.test(r1.text.match(/\[argv (.*?)\] \[home/)?.[1] ?? "x"), "codex: tham số dòng lệnh không còn địa chỉ cầu nối / mcp_servers", r1.text);
    const r2 = await E.collect(S.engineFor("codex").runTurn({ prompt: "#tool=echo dùng công cụ", sessionId: r1.session, env, mcp }));
    ok(!r2.error && /lượt 2/.test(r2.text) && /đã dùng echo: ok-tu-cong-cu/.test(r2.text), "codex: công cụ được duyệt sẵn, nối tiếp đúng phiên (sessions/ qua liên kết)", JSON.stringify(r2));
    for (let i = 0; i < 40 && turns().length; i++) await sleep(100);
    ok(!turns().length, "xong lượt: thư mục CODEX_HOME của lượt đã được dọn", turns().join());
    ok(fs.readFileSync(path.join(base, "config.toml"), "utf8") === baseCfg && fs.existsSync(path.join(base, "auth.json")), "cấu hình và đăng nhập của tài khoản giữ nguyên");
    const r3 = await E.collect(S.engineFor("codex").runTurn({ prompt: "[mock:authrefresh] chào", env, mcp }));
    for (let i = 0; i < 40 && turns().length; i++) await sleep(100);
    const auth = (() => { try { return JSON.parse(fs.readFileSync(path.join(base, "auth.json"), "utf8")); } catch { return {}; } })();
    ok(!r3.error && auth.refreshed > 0 && !fs.lstatSync(path.join(base, "auth.json")).isSymbolicLink() && fs.existsSync(path.join(base, "history.jsonl")) && !turns().length,
      "codex làm mới token (ghi tệp mới rồi đổi tên) / tạo tệp mới trong lượt: được đưa về thư mục đăng nhập", JSON.stringify({ r3, auth }));
    ok(!CE.codexMcpToml("http://x/y").includes("-c") && /default_tools_approval_mode = "approve"/.test(CE.codexMcpToml("http://x/y")) && !fs.readFileSync("server/ai/cli_engines.ts", "utf8").includes("mcp_servers.synchro.url="), "mã nguồn: không còn -c mcp_servers.synchro.url=…");
    process.env.SYNCHRO_ENGINE_BWRAP = "1";
    const scope = R.isolate("/x/codex", ["exec"], { CODEX_HOME: path.join(base, `${R.CODEX_TURN_PREFIX}abc`), HOME, PATH: "/usr/bin" }, path.join(HOME, "work"));
    delete process.env.SYNCHRO_ENGINE_BWRAP;
    ok(scope.file === "bwrap" && scope.argv.join(" ").includes(`--bind ${base} ${base}`), "hộp bwrap gắn cả thư mục đăng nhập (liên kết trỏ về đó)", scope.argv.join(" "));
    fs.rmSync(path.join(base, "config.toml"));
    srv.close();
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
    ok(bad.error?.code === "rate", "API trả 429 không kèm hết hạn mức → giới hạn tốc độ, không coi là hết gói", JSON.stringify(bad.error));
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
    const real = SUBS.agyWindows("└ Models & Quota\n  Account: [email]\nGEMINI MODELS\n  Models within this group: Gemini Flash, Gemini Pro\n  Weekly Limit Remaining\n[██████████░] 99.98%\nRefreshes in 166h 28m\n  Five Hour Limit Remaining\n[██████████] 99.94%\nRefreshes in 3h 28m\nCLAUDE AND GPT MODELS\n  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS\n  Weekly Limit Remaining\n[█████████] 99.38%\nRefreshes in 150h 1m\n  Five Hour Limit Remaining\n[████████░] 98.75%\nRefreshes in 2h 5m\n");
    const rs = real.find((w) => w.window === "gemini_session"), rw = real.find((w) => w.window === "gemini_weekly"), ow2 = real.find((w) => w.window === "other_session");
    ok(real.length === 4 && rs.usedPct === 0.06 && Math.abs(rs.resetsAt - (Date.now() + (3 * 60 + 28) * 60e3)) < 5000 && Math.abs(rw.resetsAt - (Date.now() + (166 * 60 + 28) * 60e3)) < 5000 && ow2.usedPct === 1.25,
      "Antigravity: đọc đúng bố cục thật của bảng /usage (nhãn, thanh %, dòng Refreshes in… trên các dòng riêng)", JSON.stringify(real));
    const g5 = ag.find((w) => w.window === "gemini_session"), ow = ag.find((w) => w.window === "other_weekly");
    ok(ag.length === 4 && g5.usedPct === 36 && Math.abs(g5.resetsAt - (Date.now() + (3 * 60 + 12) * 60e3)) < 5000 && ow.status === "rejected" && ow.usedPct === 100 && /Claude and GPT/.test(ow.label), "Antigravity: hai nhóm model × phiên 5 giờ / tuần từ bảng /usage", JSON.stringify(ag));

    const me = { id: U, email: "user@synchro.test", email_verified: 1, status: "active" };
    const subs = await SUBS.mergedProviders(me, await P.catalog());
    const ids = subs.filter((p) => p.source === "plan").map((p) => `${p.id}:${p.name}`).join();
    const codexModels = subs.find((p) => p.id === "openai")?.models.map((m) => m.id) ?? [];
    ok(ids === "anthropic:Claude,openai:ChatGPT,google:Gemini", "bộ chọn model gộp theo hãng: ba nhóm Claude, ChatGPT, Gemini đều đang hiện model của gói", ids);
    const gem = subs.find((p) => p.id === "google")?.models ?? [];
    ok(subs.find((p) => p.id === "anthropic")?.models.some((m) => m.key === "sub-claude/sonnet"), "Claude: opus / sonnet / haiku");
    ok(gem.map((m) => m.id).join() === "gemini-4-argon,gemini-3.8-flash,gemini-3.1-flash-lite,claude-sonnet-4-6,claude-opus-4-6-thinking,gpt-oss-120b" && gem.map((m) => m.name).join() === "Gemini 4 Argon,Gemini 3.8 Flash,Gemini 3.1 Flash Lite,Claude Sonnet 4.6 (Antigravity),Claude Opus 4.6 (Antigravity),GPT-OSS 120B (Antigravity)",
      "Gemini: đủ mọi model gói Google cấp qua Antigravity (Gemini trước, Claude / GPT ghi rõ Antigravity), gộp biến thể High / Medium / Low thành một model", JSON.stringify(gem));
    // Google đổi danh sách model (gói dùng thử → trả phí): bộ chọn model cập nhật theo trạng thái mới, không chờ 10 phút.
    const before = (await SUBS.mergedProviders(me, await P.catalog())).find((p) => p.id === "google").models.length;
    const marker = path.join(HOME, "logins", "agy", U, ".gemini", "antigravity-cli", "mock-extra-models");
    fs.writeFileSync(marker, "gemini-4-argon-ultra\tGemini 4 Argon Ultra (High)");
    await A.status("agy", U, { fresh: true });
    const after = (await SUBS.mergedProviders(me, await P.catalog())).find((p) => p.id === "google").models;
    fs.rmSync(marker); await A.status("agy", U, { fresh: true });
    ok(after.length === before + 1 && after.some((m) => m.id === "gemini-4-argon-ultra"), "danh sách model của Google đổi → bộ chọn model cập nhật ngay", JSON.stringify(after.map((m) => m.id)));
    const AG = SUBS.agyModels(["Fetching available models...", "gemini-3.8-flash-high\tGemini 3.8 Flash (High)", "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)", "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)", "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)"]);
    ok(AG.length === 3 && AG[0].name === "Gemini 3.8 Flash" && AG[0].variants.high === "gemini-3.8-flash-high" && AG[1].name === "Claude Sonnet 4.6 (Antigravity)" && AG[1].variants.default === "claude-sonnet-4-6"
      && AG[2].id === "gpt-oss-120b" && AG[2].name === "GPT-OSS 120B (Antigravity)" && AG[2].variants.medium === "gpt-oss-120b-medium", "agyModels: hiện đủ mọi model agy trả về (Gemini trước, Claude / GPT qua Antigravity sau), gộp biến thể effort", JSON.stringify(AG));
    ok(codexModels.includes("gpt-6.1-sol") && !codexModels.includes("codex-internal"), "Codex: danh sách model thật từ app-server (bỏ model ẩn)", codexModels.join());
    // Lượt chat qua gói: lượt đầu mở phiên, lượt sau nối tiếp (resume), sửa lịch sử thì mở phiên mới kèm lịch sử.
    const conv = "conv-sub-1";
    const t1 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "Trả lời ngắn.", messages: [{ role: "user", content: "chào" }], conv });
    ok(t1.status === 200 && /lượt 1/.test(t1.json.text) && t1.json.via === "claude", "subTurn: lượt đầu chạy bằng gói Claude", JSON.stringify(t1));
    const t2 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "chào" }, { role: "assistant", content: t1.json.text }, { role: "user", content: "tiếp nhé" }], conv });
    ok(t2.status === 200 && /lượt 2/.test(t2.json.text), "subTurn: câu tiếp theo nối đúng phiên CLI", JSON.stringify(t2));
    const t3 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "câu khác" }], conv });
    ok(t3.status === 200 && /lượt 1/.test(t3.json.text), "subTurn: lịch sử không khớp (sửa / tạo lại) → mở phiên mới", JSON.stringify(t3));
    // Lịch sử phiên trên đĩa: đoạn chat ẩn danh không để lại gì, xóa đoạn chat xóa mọi phiên của nó (kể cả phiên cũ đã bị thay), không đụng đoạn chat khác.
    {
      const sdir = path.join(A.scopeDir("claude", me.id), "projects", "mock");
      const sess = () => { try { return fs.readdirSync(sdir); } catch { return []; } };
      const holds = (t) => sess().some((f) => fs.readFileSync(path.join(sdir, f), "utf8").includes(t));
      ok(sess().length >= 2 && holds("câu khác"), "CLI giả lập ghi lịch sử phiên ra đĩa", sess().join());
      const inc = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "bí mật ẩn danh 1" }], conv: "conv-inc", ephemeral: true });
      await sleep(400);
      ok(inc.status === 200 && !holds("bí mật ẩn danh 1"), "ẩn danh: trả lời bình thường, lịch sử phiên bị xóa ngay", JSON.stringify(inc));
      const inc2 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "bí mật ẩn danh 1" }, { role: "assistant", content: "đáp" }, { role: "user", content: "bí mật ẩn danh 2" }], conv: "conv-inc", ephemeral: true });
      await sleep(400);
      ok(inc2.status === 200 && /lượt 1/.test(inc2.json.text) && !holds("bí mật ẩn danh"), "ẩn danh: không nối phiên, mỗi lượt gửi kèm lịch sử", JSON.stringify(inc2));
      const row = AS0.db().prepare("SELECT COUNT(*) n FROM engine_sessions WHERE user_id = ? AND conv = 'conv-inc'").get(me.id).n;
      ok(row === 0, "ẩn danh: không nhớ mã phiên");
      const once = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "đặt tên giúp mình 123" }] });
      await sleep(400);
      ok(once.status === 200 && !holds("đặt tên giúp mình 123"), "lượt không thuộc đoạn chat nào cũng không để lại lịch sử");
      const keep = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "đoạn chat khác còn giữ" }], conv: "conv-keep" });
      ok(keep.status === 200 && holds("câu khác") && holds("tiếp nhé"), "đoạn chat thường vẫn có lịch sử, kể cả phiên cũ");
      await SUBS.removeConvSessions(me.id, conv);
      ok(!holds("câu khác") && !holds("tiếp nhé"), "xóa đoạn chat: mọi phiên của nó (phiên mới lẫn phiên đã bị thay) khỏi đĩa");
      ok(holds("đoạn chat khác còn giữ"), "đoạn chat khác không bị đụng");
      ok(fs.existsSync(path.join(A.scopeDir("claude", me.id), ".mock-login")) || !!A.engineEnv("claude", me.id).CLAUDE_CODE_OAUTH_TOKEN, "đăng nhập gói còn nguyên");
      const again = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "chào" }, { role: "assistant", content: "x" }, { role: "user", content: "tiếp" }], conv });
      ok(again.status === 200 && /lượt 1/.test(again.json.text), "đoạn chat đã xóa không còn nối vào phiên cũ", JSON.stringify(again));
      await SUBS.removeConvSessions(me.id, conv);
      ok(R.removeSessionFiles("/etc", "abcdefgh12345") instanceof Promise && (await R.removeSessionFiles(A.scopeDir("claude", me.id), "*")) === undefined, "mã phiên lạ hay đường dẫn ngoài nhà engine: không làm gì");
    }
    // Quá 60 tin: trình duyệt chỉ gửi 60 tin gần nhất, nối tiếp phiên phải so với số tin thật.
    const hist = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `tin ${i}` }));
    const lg = "conv-long";
    {
      const said = [];
      await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: hist(61).slice(-59), total: 61, older: "user: phần trích", onStatus: (t) => said.push(t) });
      ok(said.some((t) => /Đoạn chat dài: .* 59 tin gần nhất, 2 tin cũ hơn/.test(t)), "mở phiên mới mà thiếu tin cũ: báo cho người dùng", JSON.stringify(said));
    }
    const l1 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: hist(61).slice(-59), total: 61, conv: lg });
    const l2 = await SUBS.subTurn({ user: me, model: "sub-claude/sonnet", system: "", messages: [...hist(61).slice(-57), { role: "assistant", content: "đáp" }, { role: "user", content: "tiếp" }], total: 63, conv: lg });
    ok(l1.status === 200 && l2.status === 200 && /lượt 2/.test(l2.json.text), "đoạn chat dài hơn 60 tin vẫn nối đúng phiên CLI", JSON.stringify([l1.json.text, l2.json.text]));
    // Lỗi của từng model, giới hạn tốc độ, lượt treo, hết hạn mức giữa chừng.
    const U3 = "user_C"; const me3 = { ...me, id: U3 };
    await A.startLogin("claude", U3, "oauth");
    await A.submitCode("claude", U3, "MOCK-CLAUDE-OK");
    const rl = await SUBS.subTurn({ user: me3, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "[mock:ratelimit] chào" }] });
    ok(rl.status === 429 && rl.json.rate === true && !rl.json.planLimit && rl.json.retryAfterMs === 1000 && !SUBS.planBlock("claude", U3), "giới hạn tốc độ: không báo hết gói, không khóa gói", JSON.stringify(rl));
    const wo = await SUBS.subTurn({ user: me3, model: "sub-claude/opus", system: "", messages: [{ role: "user", content: "[mock:weekopus] chào" }] });
    ok(wo.status === 429 && wo.json.quota === "model" && /Các model khác/.test(wo.json.error) && !SUBS.planBlock("claude", U3) && SUBS.modelBlock("claude", U3, "opus") > Date.now() + 86400_000 && !SUBS.modelBlock("claude", U3, "haiku"), "hết tuần của Opus: chỉ Opus nghỉ, Sonnet và Haiku vẫn dùng được", JSON.stringify(wo));
    let cg = (await SUBS.mergedProviders(me3, await P.catalog())).find((p) => p.id === "anthropic");
    ok(!cg.plan.blockedUntil && cg.models.find((m) => m.id === "opus")?.blockedUntil > Date.now() && !cg.models.find((m) => m.id === "haiku")?.blockedUntil, "bộ chọn model: đánh dấu đúng model hết hạn mức, gói không bị khóa", JSON.stringify(cg.models));
    const mq = await SUBS.subTurn({ user: me3, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "[mock:midquota] chào" }] });
    ok(mq.status === 429 && mq.json.text === "Phần đã viết trước khi hết hạn mức." && mq.json.quota === "model" && SUBS.modelBlock("claude", U3, "sonnet") > Date.now(), "hết hạn mức giữa chừng: giữ phần đã viết", JSON.stringify(mq));
    const okAgain = await SUBS.subTurn({ user: me3, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "chào" }] });
    ok(okAgain.status === 200 && !SUBS.modelBlock("claude", U3, "sonnet"), "lượt chạy được: bỏ ghi nhận hết hạn mức tạm của model đó", JSON.stringify(okAgain.status));
    const t0h = Date.now();
    const hang = await SUBS.subTurn({ user: me3, model: "sub-claude/haiku", system: "", messages: [{ role: "user", content: "[mock:hang] chào" }] });
    ok(hang.status === 503 && hang.json.stalled && hang.json.noRetry && Date.now() - t0h < 12_000, "model treo sau khi CLI khởi động: bộ canh dừng lượt, không chờ 40 phút", JSON.stringify(hang));
    // Báo động "cần đăng nhập lại": nhóm vẫn ở lại bộ chọn model; lượt chạy được thì tự hết.
    A.markRelogin("claude", U3);
    cg = (await SUBS.mergedProviders(me3, await P.catalog())).find((p) => p.id === "anthropic");
    ok(cg?.source === "plan" && cg.plan.relogin === true && cg.models.length > 0, "gói cần đăng nhập lại: nhóm vẫn hiện kèm ghi chú, không biến mất", JSON.stringify(cg));
    await SUBS.subTurn({ user: me3, model: "sub-claude/sonnet", system: "", messages: [{ role: "user", content: "chào" }] });
    ok(!A.needsRelogin("claude", U3), "lượt chạy được: báo động nhầm tự hết");
    ok(SUBS.linksIn("xem [Báo A](https://a.vn/x). và https://b.vn/y, <artifact id='k'>https://c.vn</artifact>").map((x) => x.url).join() === "https://a.vn/x,https://b.vn/y", "lấy nguồn từ link trong câu trả lời, bỏ phần artifact");
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

  // ------------------------------------------------------------------
  console.log("8b. Grok: hàng đợi của tài khoản, đang nghĩ không phải treo, tìm web; bộ canh; lượt có việc không chạy lại sau khởi động");
  {
    const UG = "user_G", env = A.engineEnv("grok", UG);
    fs.mkdirSync(env.GROK_HOME, { recursive: true }); fs.writeFileSync(path.join(env.GROK_HOME, "auth.json"), "{}");
    const mcp = { url: "http://127.0.0.1:9/mcp" };
    // Hàng đợi của tài khoản chỉ còn ở đường dự phòng (HOME riêng của lượt tắt hoặc dựng lỗi): tests/api/turnhome.test.mjs thử đường mặc định không xếp hàng.
    process.env.SYNCHRO_CLI_TURN_HOME = "0";
    const long = all(S.engineFor("grok").runTurn({ prompt: "[mock:holdgrok] chào", env, mcp }));
    await sleep(1500);
    let t0 = Date.now();
    const busy = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp, lockMs: 500 }));
    ok(busy.some((e) => e.kind === "status" && e.wait === true && /Đang chờ lượt Grok/.test(e.text)) && busy.at(-1).kind === "error" && busy.at(-1).code === "busy" && Date.now() - t0 < 3000, "lượt khác đang giữ cầu nối: báo đang chờ, hết hạn chờ thì báo bận (không phải lỗi sai)", JSON.stringify(busy));
    t0 = Date.now();
    const ac = new AbortController(); setTimeout(() => ac.abort(), 300);
    const st = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp, signal: ac.signal }));
    ok(st.at(-1).kind === "error" && st.at(-1).code === "aborted" && Date.now() - t0 < 2000, "đang chờ mà bấm Dừng: dừng ngay", JSON.stringify(st));
    const waited = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp }));
    ok(waited.some((e) => e.kind === "status" && e.wait === false) && waited.some((e) => e.kind === "final"), "chờ xong thì lượt chạy bình thường", JSON.stringify(waited.map((e) => e.kind)));
    ok((await long).some((e) => e.kind === "final"), "lượt đang giữ cầu nối vẫn xong");
    // Lượt giữ khóa đang chờ người dùng duyệt: lượt sau nói đúng lý do và không tính thời gian chờ.
    {
      const held = all(S.engineFor("grok").runTurn({ prompt: "[mock:holdgrok] duyệt", env, mcp, awaitingUser: () => true }));
      await sleep(1200);
      const ac2 = new AbortController(); setTimeout(() => ac2.abort(), 1500);
      const w = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp, signal: ac2.signal }));
      ok(w.some((e) => e.kind === "status" && e.wait === true && /đang chờ bạn duyệt/.test(e.text ?? "")) && w.at(-1).code === "aborted", "chat khác đang giữ thẻ duyệt: báo cần trả lời ở chat đó", JSON.stringify(w));
      const quick = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp, lockMs: 300 }));
      ok(quick.at(-1).code === "busy", "chế độ Tự động không chờ theo thẻ duyệt, vẫn chuyển model sớm", JSON.stringify(quick));
      await held;
      delete process.env.SYNCHRO_CLI_TURN_HOME;
    }
    // Không lắp được cầu nối: báo lỗi để Tự động chuyển model, không chạy tiếp với prompt đang hứa công cụ.
    {
      fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: M, failMcpAdd: true }));
      const g = await all(S.engineFor("grok").runTurn({ prompt: "chào", env, mcp }));
      fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: M }));
      ok(g.at(-1).kind === "error" && /Không nối được công cụ/.test(g.at(-1).message) && !g.some((e) => e.kind === "text"), "Grok: lắp cầu nối hỏng thì báo lỗi, không chạy lượt thiếu công cụ", JSON.stringify(g));
    }
    // Antigravity không có chữ dần: nói đã chờ bao lâu, và dòng này không làm bộ canh tính lại.
    {
      // Tài khoản này đã đăng xuất ở phần trên: cần tệp đăng nhập của CLI giả lập để lượt chạy tới lúc báo giờ.
      const agyDir = path.join(HOME, "logins", "agy", "user_A", ".gemini", "antigravity-cli");
      fs.mkdirSync(path.join(agyDir, "cache"), { recursive: true });
      fs.writeFileSync(path.join(agyDir, "antigravity-oauth-token"), "x");
      fs.writeFileSync(path.join(agyDir, "cache", "onboarding.json"), JSON.stringify({ onboardingComplete: true }));
      const ev = await all(S.engineFor("agy").runTurn({ prompt: "chào", env: A.engineEnv("agy", "user_A") }));
      ok(ev.some((e) => e.kind === "status" && e.tick === true && /vẫn đang viết, đã \d+ giây/.test(e.text ?? "")), "agy: báo thời gian đã chờ", JSON.stringify(ev));
    }
    // Tệp tạm của lượt bị giết: dọn tệp cũ, không đụng tệp mới hay tệp khác.
    {
      const dir = path.join(HOME, "work", "sweep-test"); fs.mkdirSync(path.join(dir, "att", "20200101"), { recursive: true }); fs.mkdirSync(path.join(dir, "att", "20990101"), { recursive: true });
      const oldF = path.join(dir, ".synchro-grok-old.txt"), newF = path.join(dir, ".synchro-grok-new.txt"), keep = path.join(dir, "ghi-chu.txt");
      for (const f of [oldF, newF, keep]) fs.writeFileSync(f, "x");
      const past = new Date(Date.now() - 10 * 86400_000);
      fs.utimesSync(oldF, past, past); fs.utimesSync(keep, past, past); fs.utimesSync(path.join(dir, "att", "20200101"), past, past);
      await R.sweepEngineTemp();
      ok(!fs.existsSync(oldF) && fs.existsSync(newF) && fs.existsSync(keep), "dọn .synchro-* cũ, giữ tệp mới và tệp khác");
      ok(!fs.existsSync(path.join(dir, "att", "20200101")) && fs.existsSync(path.join(dir, "att", "20990101")), "dọn thư mục đính kèm quá 7 ngày, giữ thư mục mới");
    }
    const me = { id: UG, email: "g@synchro.test", email_verified: 1, status: "active" };
    await A.status("grok", UG, { fresh: true });
    const slow = await SUBS.subTurn({ user: me, model: "sub-grok/grok-4.7", system: "", messages: [{ role: "user", content: "[mock:slowgrok] chào" }] });
    ok(slow.status === 200, "Grok nghĩ 6 giây chỉ có thought, bộ canh 4 giây: không bị coi là treo", JSON.stringify(slow));
    const web = await all(S.engineFor("grok").runTurn({ prompt: "#web chào", env, web: true }));
    ok(web.some((e) => e.kind === "search") && web.some((e) => e.kind === "sources" && e.items[0]?.url === "https://example.com/grok"), "Grok: tìm web có bước và nguồn", JSON.stringify(web.filter((e) => e.kind !== "text")));
    const W = await loadTs(["ai/watchdog"]);
    const D = W["ai/watchdog"];
    delete process.env.SYNCHRO_WATCH_SEC;
    const L = D.watchLimits("claude", "max");
    ok(L.first === 90_000 && L.idle === 30 * 60_000 && D.watchLimits("codex", "max").first > L.first && D.watchLimits("agy", "low").first < D.watchLimits("agy", "max").first, "giới hạn theo CLI và effort", JSON.stringify(L));
    const now = 1e9, sn = (o) => D.stallOf({ start: now - 100_000, last: 0, alive: 0, waiting: false, ...o }, L, now);
    ok(sn({}) === "first", "CLI khởi động xong rồi im: báo treo sau 90 giây");
    ok(sn({ waiting: true }) === null, "đang chờ lượt khác của tài khoản: không tính");
    ok(sn({ alive: now - 1000 }) === null && sn({ last: now - 29 * 60_000, start: now - 40 * 60_000 }) === null, "công cụ đang chạy, Opus nghĩ lâu ở mức cao nhất: không tính là treo");
    ok(sn({ last: now - 31 * 60_000, start: now - 40 * 60_000 }) === "idle", "im lặng quá mức của effort: báo treo");
    ok(sn({ start: now - 5000 }) === null, "CLI vừa báo đang thử lại: tính lại từ lúc đó");
    process.env.SYNCHRO_WATCH_SEC = "4";
    // Lượt đã bắt đầu việc có tác động ra ngoài: khởi động lại máy chủ không chạy lại.
    const { runs: RN, authstore: AU } = await loadTs(["runs", "authstore"]);
    RN.getRun("x");
    const ru = AU.createUser({ email: `rs${Date.now()}@synchro.test`, name: "RS", verified: true });
    const dbr = AU.db(), now2 = Date.now();
    const ins = dbr.prepare("INSERT INTO runs (id, user_id, conv, kind, status, req, events, created_at, updated_at, effects) VALUES (?, ?, NULL, 'none', 'running', '{}', '[]', ?, ?, ?)");
    ins.run("run_fx", ru.id, now2, now2, JSON.stringify(["Gmail: Gửi thư"]));
    ins.run("run_plain", ru.id, now2, now2, null);
    RN.resumeInterrupted();
    await sleep(200);
    const fx = RN.getRun("run_fx"), plain = RN.getRun("run_plain");
    ok(fx.status === "error" && /không tự chạy lại/.test(fx.result.error) && /Gmail: Gửi thư/.test(fx.result.error) && fx.result.partialWork, "khởi động lại máy chủ: lượt đã thao tác connector không chạy lại, nói rõ đã làm gì", JSON.stringify(fx));
    ok(!/không tự chạy lại/.test(JSON.stringify(plain.result)) && plain.events.some((e) => /chạy lại lượt này/.test(e.text)), "lượt chưa làm gì có tác động: vẫn chạy lại như trước", JSON.stringify(plain));
  }

  // ------------------------------------------------------------------
  console.log("9. Lượt dài: chỉ dừng khi CLI im lặng (treo), không dừng khi còn làm việc");
  {
    const run = async (script, o) => { const t0 = Date.now(); const p = R.spawnCli("/bin/sh", ["-c", script], o); for await (const _ of p.lines) { /* đọc hết */ } return { ...(await p.done), ms: Date.now() - t0 }; };
    let e = await run("sleep 5", { idleMs: 600 });
    ok(e.timedOut && e.idle && e.ms < 2500, "im lặng quá idleMs: dừng, báo idle", e);
    ok(/không có hoạt động nào trong \d+ phút/.test(CE.timeoutText(e)) && /đã chạy [\d.]+ giờ/.test(CE.timeoutText({})), "lời báo khác nhau: treo / chạm mức trần", CE.timeoutText(e));
    e = await run("for i in 1 2 3 4 5 6 7; do echo $i; sleep 0.25; done", { idleMs: 600 });
    ok(e.code === 0 && !e.timedOut && e.ms > 1500, "còn in ra đều đặn: chạy tới khi xong dù lâu hơn idleMs", e);
    e = await run("sleep 1.6", { idleMs: 600, alive: () => Date.now() });
    ok(e.code === 0 && !e.timedOut, "không in gì nhưng đang chạy công cụ (alive): không dừng", e);
    e = await run("sleep 5", { idleMs: 60_000, timeoutMs: 700 });
    ok(e.timedOut && !e.idle, "mức trần của lượt vẫn còn", e);
    ok(R.MAX_TURN_MS >= 3 * 3600_000 && R.IDLE_MS > 30 * 60_000, "mặc định: trần 3 giờ, im lặng 40 phút (> 30 phút chờ một công cụ)", { max: R.MAX_TURN_MS, idle: R.IDLE_MS });
  }
} catch (e) {
  ok(false, "lỗi bất ngờ", e.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
