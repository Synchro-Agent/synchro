// Tệp và thư mục trong nhà engine (app/ai/cli_runtime.ts): khi có user riêng của engine, makeDir / writeEngineFile / listEngineDir / removeDir
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
const src = fs.readFileSync("app/ai/cli_runtime.ts", "utf8");
const { "ai/cli_runtime": R } = await loadTs(["ai/cli_runtime"]);
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

  console.log("4. makeDirSync (thư mục đăng nhập, scopeDir) vẫn đồng bộ");
  const d2 = path.join(HOME, "logins", "claude", "u1");
  ok(R.makeDirSync(d2) === undefined && fs.existsSync(d2), "tạo thư mục đồng bộ");

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
