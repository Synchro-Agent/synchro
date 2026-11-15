// Tệp và thư mục trong nhà engine (server/ai/cli_runtime.ts): khi có user riêng của engine, makeDir / writeEngineFile / listEngineDir / removeDir
// gọi sudo bất đồng bộ (execFile), không còn spawnSync chặn cả máy chủ. Kết quả và lỗi giữ như trước.
// Tự chạy được, không cần máy chủ: "sudo" giả trong PATH bỏ phần "-n -u <user> --" rồi chạy đúng lệnh còn lại.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-enginefs-"));
const HOME = (process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"));
const BIN = path.join(tmp, "bin"), LOG = path.join(tmp, "sudo.log");
fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(HOME, { recursive: true });
fs.writeFileSync(path.join(BIN, "sudo"), `#!/bin/sh\necho "$@" >> "${LOG}"\n[ "$1" = "-n" ] && [ "$2" = "-u" ] && [ "$4" = "--" ] || exit 9\nshift 4\nexec "$@"\n`, { mode: 0o755 });
process.env.PATH = `${BIN}:${process.env.PATH}`;
const src = fs.readFileSync("server/ai/cli_runtime.ts", "utf8");
process.env.DATA_DIR = path.join(tmp, "data"); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
// Nạp chung một lần: cli_auth dùng đúng bản cli_runtime này (một bản nạp riêng sẽ đăng ký lại bộ đo RSS "cli" với danh sách CLI rỗng).
const { "ai/cli_runtime": R, "ai/cli_auth": CA } = await loadTs(["ai/cli_runtime", "ai/cli_auth"]);
const sudoCalls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).length : 0);

try {
  console.log("1. Mã nguồn: không còn spawnSync(\"sudo\") trong các hàm của lượt chat");
  const body = (name) => { const i = src.indexOf(`function ${name}(`); return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i)); };
  for (const f of ["asEngine", "makeDir", "writeEngineFile", "listEngineDir", "removeDir"]) {
    ok(body(f) && !/spawnSync/.test(body(f)), `${f} không gọi spawnSync`);
    ok(new RegExp(`export async function ${f}\\(|async function ${f}\\(`).test(src), `${f} là hàm async`);
  }

  console.log("2. Có user riêng của engine: chạy qua sudo, không chặn vòng sự kiện");
  process.env.SYNCHRO_ENGINE_USER = "synchro-engine";
  let ticks = 0;
  const iv = setInterval(() => ticks++, 1);
  const dir = path.join(HOME, "work", "u1");
  const p = R.makeDir(dir);
  ok(p instanceof Promise, "makeDir trả về Promise");
  await p;
  ok(fs.existsSync(dir) && (fs.statSync(dir).mode & 0o777) === 0o700, "tạo thư mục quyền 0700", (fs.statSync(dir).mode & 0o777).toString(8));
  ok(sudoCalls() === 1 && /-n -u synchro-engine -- env -i PATH=\/usr\/bin:\/bin mkdir -p -m 700/.test(fs.readFileSync(LOG, "utf8")), "gọi sudo -n -u <user> -- env -i … mkdir", fs.readFileSync(LOG, "utf8"));
  await R.makeDir(dir);
  ok(sudoCalls() === 1, "thư mục đã có: không gọi sudo lần nữa");

  const file = path.join(dir, "att", "a.bin"), data = Buffer.from([0, 1, 2, 250, 251, 252]);
  await R.writeEngineFile(file, data);
  ok(fs.readFileSync(file).equals(data), "ghi tệp qua stdin của sudo, nội dung nhị phân giữ nguyên");
  ok((fs.statSync(file).mode & 0o777) === 0o600, "tệp quyền 0600 (umask 077)", (fs.statSync(file).mode & 0o777).toString(8));
  const big = Buffer.alloc(3 * 1048576, 7);
  await R.writeEngineFile(path.join(dir, "big.bin"), big);
  ok(fs.statSync(path.join(dir, "big.bin")).size === big.length, "tệp 3 MB ghi đủ");

  const names = await R.listEngineDir(dir);
  ok(JSON.stringify(names.sort()) === JSON.stringify(["att", "big.bin"]), "listEngineDir đọc tên các mục", names);
  ok(JSON.stringify(await R.listEngineDir(path.join(dir, "khong-co"))) === "[]", "thư mục chưa có: rỗng, không ném lỗi");

  await R.removeDir(path.join(dir, "att"));
  ok(!fs.existsSync(path.join(dir, "att")), "removeDir xóa hẳn thư mục");
  clearInterval(iv);
  ok(ticks > 0, `vòng sự kiện vẫn chạy trong lúc chờ sudo (${ticks} nhịp)`);

  console.log("3. Lỗi giữ như trước");
  let e1 = null; try { await R.writeEngineFile("/etc/khong-duoc", data); } catch (e) { e1 = e; }
  ok(e1 && /ngoài thư mục engine/.test(e1.message), "đường dẫn ngoài nhà engine: từ chối", e1?.message);
  let e2 = null; try { await R.removeDir("/tmp/khong-duoc"); } catch (e) { e2 = e; }
  ok(e2 && /ngoài thư mục engine/.test(e2.message), "removeDir ngoài nhà engine: từ chối", e2?.message);
  fs.writeFileSync(path.join(HOME, "la-tep"), "x");
  let e3 = null; try { await R.writeEngineFile(path.join(HOME, "la-tep", "con.txt"), data); } catch (e) { e3 = e; }
  ok(e3 && /^Không ghi được tệp đính kèm cho engine: .+/.test(e3.message), "sudo báo lỗi: thông báo kèm stderr", e3?.message);
  let e4 = null; try { await R.makeDir(path.join(HOME, "la-tep", "con")); } catch (e) { e4 = e; }
  ok(e4 && /^Không tạo được thư mục của engine: .+/.test(e4.message), "mkdir lỗi: thông báo như cũ", e4?.message);
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent";
  let e5 = null; try { await R.makeDir(path.join(HOME, "moi")); } catch (e) { e5 = e; }
  process.env.PATH = savedPath;
  ok(e5 && /^Không tạo được thư mục của engine: .*ENOENT/.test(e5.message), "không chạy được sudo: báo lỗi khởi chạy", e5?.message);

  console.log("4. W23-19: thư mục đăng nhập tạo bất đồng bộ (cli_auth.ensureScopeDir), scopeDir chỉ tính đường dẫn");
  {
    process.env.SYNCHRO_ENGINE_USER = "synchro-engine";
    const authSrc = fs.readFileSync("server/ai/cli_auth.ts", "utf8");
    ok(!/makeDirSync/.test(src) && !/makeDirSync|spawnSync\(/.test(authSrc), "không còn makeDirSync / spawnSync cho thư mục đăng nhập");
    const d2 = path.join(HOME, "logins", "claude", "u1");
    ok(CA.scopeDir("claude", "u1") === d2 && !fs.existsSync(d2), "scopeDir chỉ trả đường dẫn, không tạo (không gọi sudo)");
    const before = sudoCalls();
    let ticks2 = 0;
    const iv2 = setInterval(() => ticks2++, 1);
    const pr = CA.ensureScopeDir("claude", "u1");
    ok(pr instanceof Promise, "ensureScopeDir trả về Promise");
    const got = await pr;
    clearInterval(iv2);
    const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
    ok(got === d2 && [path.join(HOME, "logins"), path.join(HOME, "logins", "claude"), d2].every((p) => mode(p) === "700"), "tạo logins/, logins/claude/, logins/claude/u1 quyền 0700", got);
    ok(sudoCalls() - before === 3 && ticks2 > 0, `qua sudo bất đồng bộ (3 lần mkdir), vòng sự kiện vẫn chạy (${ticks2} nhịp)`, sudoCalls() - before);
    await CA.ensureScopeDir("claude", "u1");
    ok(sudoCalls() - before === 3, "đã có: không gọi sudo lần nữa");
    const env = await CA.engineEnvReady("codex", "u1");
    ok(env.CODEX_HOME === path.join(HOME, "logins", "codex", "u1") && fs.existsSync(env.CODEX_HOME), "engineEnvReady: biến môi trường trỏ tới thư mục đã có", JSON.stringify(env));
    const subs = fs.readFileSync("server/ai/subs.ts", "utf8");
    ok(!/engineEnv\(/.test(subs) && /engineEnvReady\(/.test(subs), "subs.ts chạy CLI bằng engineEnvReady (thư mục đã tạo trước khi chạy)");
  }

  console.log("4b. W23-19: Dừng CLI chạy bằng user riêng: ps và sudo kill bất đồng bộ, vẫn dọn hết con cháu");
  {
    const kg = src.slice(src.indexOf("const killGroup"), src.indexOf("const kill = ()"));
    ok(kg && !/spawnSync/.test(kg) && /await descendants\(pid\)/.test(kg) && /await runCmd\("sudo"/.test(kg), "killGroup không gọi spawnSync", kg.slice(0, 300));
    ok(!/spawnSync/.test(body("descendants")) && /export async function descendants\(/.test(src), "descendants là hàm async, không spawnSync");
    // Bật CLI không qua sudo (sudo thật không chạy được ở đây), rồi mới đặt user riêng: killGroup đọc user lúc dừng và gọi "sudo" giả trong PATH.
    process.env.SYNCHRO_ENGINE_USER = "";
    const pidFile = path.join(tmp, "grand.pid");
    const p = R.spawnCli("/bin/sh", ["-c", `sleep 300 & echo $! > ${pidFile}; wait`], { timeoutMs: 60_000 });
    for (let i = 0; i < 40 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    const grand = Number(fs.readFileSync(pidFile, "utf8"));
    const alive = (x) => { try { process.kill(x, 0); return true; } catch { return false; } };
    process.env.SYNCHRO_ENGINE_USER = "synchro-engine";
    const before = sudoCalls();
    const t0 = Date.now();
    p.kill();
    const syncMs = Date.now() - t0;
    const ex = await p.done;
    ok(syncMs < 20, "kill() trả ngay, không chờ ps / sudo", `${syncMs} ms`);
    const log = fs.readFileSync(LOG, "utf8");
    ok(sudoCalls() > before && /-n -u synchro-engine -- env -i PATH=\/usr\/bin:\/bin kill -(TERM|KILL) /.test(log) && log.includes(String(grand)), "sudo -n -u <user> … kill gồm cả tiến trình cháu", log.split("\n").slice(-3).join(" | "));
    await new Promise((r) => setTimeout(r, 200));
    ok(!alive(grand) && ex.signal, "tiến trình cháu đã bị dừng; done chỉ báo xong sau khi dọn nhóm", JSON.stringify(ex));
    process.env.SYNCHRO_ENGINE_USER = "";
  }

  console.log("4c. G3.4: RSS cây tiến trình CLI cho dòng [timing] mem");
  {
    const listing = "  10     1  1024\n  11    10  2048\n  12    11  1024\n  20     1  512\n  21    20  512\n  30     1  9999\n";
    const r = R.treeRss(listing, [10, 20, 99]);
    ok(r.n === 2 && r.sumMB === 5 && r.maxMB === 4, "tổng và cây lớn nhất theo MB (bỏ CLI đã thoát)", JSON.stringify(r));
    ok(JSON.stringify(await R.cliRss()) === '{"n":0,"sumMB":0,"maxMB":0}', "không có CLI đang chạy: 0, không gọi ps");
    const p = R.spawnCli("/bin/sh", ["-c", "sleep 30"], { timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 150));
    const live = await R.cliRss();
    ok(live.n === 1 && live.sumMB > 0 && live.maxMB === live.sumMB, "một CLI đang chạy: đo được RSS thật", JSON.stringify(live));
    const { memstat: M } = await loadTs(["memstat"]);
    const line = await M.memLine(M.memNow());
    ok(/^\[timing\] mem heapUsed=\d+MB .* cli=n:1\/sumMB:\d+\/maxMB:\d+/.test(line), "dòng [timing] mem có cli=n/sumMB/maxMB", line);
    p.kill(); await p.done;
    ok(JSON.stringify(await R.cliRss()) === '{"n":0,"sumMB":0,"maxMB":0}', "CLI thoát: bỏ khỏi danh sách đo");
  }

  console.log("5. Không có user riêng: ghi thẳng như trước");
  process.env.SYNCHRO_ENGINE_USER = "";
  const before = sudoCalls();
  const d3 = path.join(HOME, "work", "u2");
  await R.makeDir(d3); await R.writeEngineFile(path.join(d3, "x.txt"), Buffer.from("hi"));
  ok(fs.readFileSync(path.join(d3, "x.txt"), "utf8") === "hi" && JSON.stringify(await R.listEngineDir(d3)) === '["x.txt"]', "tạo, ghi, đọc tên mục");
  await R.removeDir(d3);
  ok(!fs.existsSync(d3) && sudoCalls() === before, "xóa, không gọi sudo");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
