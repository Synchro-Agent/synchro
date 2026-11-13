// Sao lưu liên tục bằng Litestream (app/litestream.ts). Tự chạy được, không cần dev:mock.
// 1-3: cấu hình R2 và quản lý tiến trình với một litestream giả (shell script): tệp cấu hình 0600 không có khóa, khóa đi qua biến môi trường,
//      chạy lại khi đổi cấu hình, tự chạy lại khi chết, dừng khi tắt; khóa bí mật mã hóa, không ra trình duyệt.
// 4: có litestream thật (LITESTREAM_BIN hoặc trong PATH) thì chạy thật với bản sao dạng thư mục: ghi dữ liệu, chờ đồng bộ, "Kiểm tra khôi phục"
//    khôi phục ra tệp tạm, integrity_check, đếm dòng khớp dữ liệu đang chạy. Không có thì bỏ qua phần này và nói rõ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(200); } return false; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-litestream-"));
const B = "http://localhost:3200";
const realBin = (() => {
  if (process.env.LITESTREAM_BIN && fs.existsSync(process.env.LITESTREAM_BIN)) return process.env.LITESTREAM_BIN;
  try { return execFileSync("sh", ["-c", "command -v litestream"], { encoding: "utf8" }).trim() || null; } catch { return null; }
})();
// Litestream giả: ghi lại lần chạy, khóa nhận được (chỉ độ dài khóa bí mật), rồi chờ tới khi bị dừng. Có tệp "crash" thì chết ngay (mã 3).
const FAKE = path.join(tmp, "fake-litestream");
fs.writeFileSync(FAKE, `#!/bin/sh
if [ "$1" != "replicate" ]; then
  for a in "$@"; do case "$a" in *.yml) cd0=$(dirname "$a");; esac; done
  if [ "$1" = "ltx" ] && [ -f "$cd0/synced" ]; then echo '[{"max_txid":"0000000000000005","timestamp":"'"$(cat "$cd0/synced")"'"}]'; else echo '[]'; fi
  exit 0
fi
d=$(dirname "$3")
echo "start $$ key=\${LITESTREAM_ACCESS_KEY_ID:-none} secretlen=\${#LITESTREAM_SECRET_ACCESS_KEY} other=\${DATA_KEY:-none}" >> "$d/fake.log"
echo '{"time":"t","level":"INFO","msg":"litestream","version":"fake"}'
if [ -f "$d/crash" ]; then rm "$d/crash"; echo '{"level":"ERROR","msg":"sync error","error":"cannot reach bucket: AccessDenied: Access Denied, status code: 403"}'; exit 3; fi
trap 'echo "stop $$" >> "$d/fake.log"; exit 0' TERM
while true; do sleep 1; done
`, { mode: 0o755 });
// R2 giả cho lần ghi thử khi lưu (r2probe.ts): ghi nhận yêu cầu đã ký; deny = trả 403 AccessDenied như token chỉ có quyền đọc.
const http = await import("node:http");
const r2 = { deny: false, reqs: [] };
const r2srv = http.createServer((q, s) => { let n = 0; q.on("data", (d) => { n += d.length; }); q.on("end", () => {
  r2.reqs.push({ method: q.method, url: q.url, auth: String(q.headers.authorization ?? ""), sha: String(q.headers["x-amz-content-sha256"] ?? ""), n });
  if (r2.deny) { s.writeHead(403, { "content-type": "application/xml" }); s.end("<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>"); return; }
  s.writeHead(q.method === "DELETE" ? 204 : 200); s.end();
}); });
await new Promise((ok) => r2srv.listen(0, "127.0.0.1", ok));
process.env.SYNCHRO_R2_ENDPOINT = `http://127.0.0.1:${r2srv.address().port}`;
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "litestream-test"; process.env.SYNCHRO_RELAX_LIMITS = "1";
process.env.ADMIN_EMAILS = "boss@synchro.test"; process.env.LITESTREAM_BIN = FAKE;
const { authstore: AS, litestream: L, "api/admin/backup/route": R } = await loadTs(["authstore", "litestream", "api/admin/backup/route"]);
const LD = path.join(process.env.DATA_DIR, "litestream"), LOG = path.join(LD, "fake.log");
const log = () => { try { return fs.readFileSync(LOG, "utf8"); } catch { return ""; } };
const starts = () => (log().match(/^start /gm) ?? []).length, stops = () => (log().match(/^stop /gm) ?? []).length;
const req = (body, cookie) => new Request(B + "/api/admin/backup", { method: body ? "POST" : "GET", headers: { origin: B, host: "localhost:3200", "content-type": "application/json", cookie, "x-forwarded-for": "1.2.3.4" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const ACC = "0123456789abcdef0123456789abcdef", KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90", SECRET = "s3cr3t0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
try {
  const boss = AS.createUser({ email: "boss@synchro.test", name: "Boss", verified: true });
  const ck = AS.createSession(boss, req(), "password").split(";")[0];
  const u = AS.createUser({ email: "u@synchro.test", name: "U", verified: true });
  const uck = AS.createSession(u, req(), "password").split(";")[0];

  console.log("1. Chưa cấu hình: không chạy gì");
  let st = await L.litestreamAdmin();
  ok(!st.enabled && !st.running && st.binary === FAKE, "tắt, chưa chạy, thấy tệp chạy", st);
  ok(L.startLitestream().reason === "disabled" && !fs.existsSync(LOG), "chưa bật: không khởi chạy litestream");
  ok((await R.GET(req(undefined, uck))).status === 403 && (await R.POST(req({ action: "drill" }, uck))).status === 403, "người thường không xem / đổi được");

  console.log("2. Dán khóa R2, bật");
  let r = await R.POST(req({ action: "save", accountId: "khong-hop-le", bucket: "b" }, ck));
  ok(r.status === 400, "Account ID sai dạng: từ chối", r.status);
  r = await R.POST(req({ action: "save", accountId: ACC, bucket: "synchro-backup", enabled: true }, ck));
  ok(r.status === 400 && !(await L.litestreamAdmin()).enabled, "bật khi chưa có khóa: từ chối", await r.json());
  r2.deny = true;
  r = await R.POST(req({ action: "save", accountId: ACC, bucket: "synchro-backup", accessKeyId: KEY, secret: SECRET, prefix: "prod/db", enabled: true }, ck));
  let j = await r.json();
  ok(r.status === 400 && /Object Read & Write/.test(j.error) && !(await L.litestreamAdmin()).enabled && !fs.existsSync(LOG), "token không ghi được (403): từ chối lưu, báo cần quyền Object Read & Write, không chạy litestream", j);
  ok(r2.reqs.length === 1 && r2.reqs[0].method === "PUT" && r2.reqs[0].url.startsWith("/synchro-backup/prod/db/.synchro-write-test-") && r2.reqs[0].auth.startsWith(`AWS4-HMAC-SHA256 Credential=${KEY}/`) && r2.reqs[0].auth.includes("/auto/s3/aws4_request") && !r2.reqs[0].auth.includes(SECRET), "ghi thử: PUT đã ký SigV4 vào đúng bucket / thư mục, không lộ khóa bí mật", r2.reqs);
  r2.deny = false; r2.reqs = [];
  r = await R.POST(req({ action: "save", accountId: ACC, bucket: "synchro-backup", accessKeyId: KEY, secret: SECRET, prefix: "prod/db", enabled: true }, ck));
  j = await r.json();
  ok(r2.reqs.map((x) => x.method).join(",") === "PUT,DELETE" && r2.reqs[0].url === r2.reqs[1].url && r2.reqs[0].n > 0, "ghi được: ghi rồi xóa tệp thử", r2.reqs);
  ok(r.status === 200 && j.enabled && j.hasSecret && !JSON.stringify(j).includes(SECRET), "lưu và bật, trả về không có khóa bí mật", j);
  ok(!AS.getSetting("backup_r2", "").includes(SECRET) && AS.getSetting("backup_r2", "").includes(KEY), "khóa bí mật mã hóa trong cơ sở dữ liệu");
  ok(await until(() => starts() === 1), "tiến trình litestream chạy", log());
  const cfg = fs.readFileSync(path.join(LD, "litestream.yml"), "utf8");
  ok((fs.statSync(path.join(LD, "litestream.yml")).mode & 0o777) === 0o600 && (fs.statSync(LD).mode & 0o777) === 0o700, "tệp cấu hình 0600, thư mục 0700");
  ok(cfg.includes(`https://${ACC}.r2.cloudflarestorage.com`) && cfg.includes('bucket: "synchro-backup"') && cfg.includes('path: "prod/db"') && cfg.includes("region: auto") && cfg.includes(`path: "${path.join(process.env.DATA_DIR, "synchro.db")}"`), "cấu hình trỏ đúng R2, bucket, thư mục, cơ sở dữ liệu", cfg);
  ok(!cfg.includes(SECRET) && !cfg.includes(KEY), "tệp cấu hình không chứa khóa");
  ok(log().includes(`key=${KEY} secretlen=${SECRET.length} other=none`), "khóa đi qua biến môi trường; khóa khác của máy chủ (DATA_KEY) không đi theo", log());
  ok(fs.readFileSync(path.join(LD, "replicate.pid"), "utf8").trim() === String((await L.litestreamAdmin()).pid), "ghi pid để lần khởi động sau dọn tiến trình mồ côi");
  ok(AS.adminAudit(5).some((a) => a.action === "admin_backup_on"), "nhật ký: bật sao lưu liên tục");
  // scripts/r2-creds.mjs (web user đưa khóa cho scripts/backup-offsite.sh qua ống): đúng 5 dòng, giải mã được khóa bí mật.
  const cr = execFileSync(process.execPath, ["scripts/r2-creds.mjs", process.env.DATA_DIR], { encoding: "utf8", env: { ...process.env } }).split("\n");
  ok(cr.slice(0, 5).join("|") === [ACC, "synchro-backup", KEY, SECRET, "prod/db"].join("|") && cr.length === 6, "r2-creds.mjs: 5 dòng đúng thứ tự, khóa bí mật giải mã đúng");

  console.log("3. Đổi cấu hình, chết giữa chừng, tắt");
  r = await R.POST(req({ action: "save", bucket: "synchro-backup-2", secret: "" }, ck));
  ok(r.status === 200 && await until(() => starts() === 2 && stops() === 1), "đổi bucket: dừng tiến trình cũ, chạy lại theo cấu hình mới", log());
  ok(fs.readFileSync(path.join(LD, "litestream.yml"), "utf8").includes("synchro-backup-2") && log().trim().split("\n").at(-1).includes(`secretlen=${SECRET.length}`), "ô khóa bí mật trống: giữ khóa cũ");
  fs.writeFileSync(path.join(LD, "crash"), "1");
  await L.restartLitestream();
  ok(await until(async () => (await L.litestreamAdmin()).errors.some((e) => /cannot reach bucket/.test(e.msg))), "lỗi của litestream hiện ở trạng thái", (await L.litestreamAdmin()).errors);
  ok(await until(async () => { const s = await L.litestreamAdmin(); return s.running && s.restarts === 1; }, 12000), "chết ngoài ý muốn: tự chạy lại sau ít giây", await L.litestreamAdmin());
  st = await L.litestreamAdmin();
  ok(/Object Read & Write/.test(st.hint ?? "") && st.errors.some((e) => !e.resolved), "lỗi 403 trong nhật ký: có hướng sửa (cần quyền ghi)", st);
  // Sửa quyền token xong, litestream đồng bộ được: lỗi cũ đánh dấu đã hết, nhãn không còn "có lỗi".
  fs.writeFileSync(path.join(LD, "synced"), new Date(Date.now() + 1000).toISOString());
  await L.restartLitestream();
  st = await L.litestreamAdmin();
  ok(st.lastSyncAt && st.errors.length > 0 && st.errors.every((e) => e.resolved) && st.hint === null, "đồng bộ thành công sau lỗi: lỗi cũ đánh dấu đã hết, không còn hướng sửa", st);
  ok(L.errorHint("PutObject: NoSuchBucket") && /bucket/.test(L.errorHint("NoSuchBucket")) && L.errorHint("hello") === null, "nhận ra các lỗi R2 khác");
  const pid = (await L.litestreamAdmin()).pid;
  r = await R.POST(req({ action: "save", enabled: false }, ck));
  ok(r.status === 200 && !(await r.json()).running && await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }), "tắt: tiến trình dừng hẳn");
  ok(AS.adminAudit(5).some((a) => a.action === "admin_backup_off"), "nhật ký: tắt sao lưu liên tục");
  // Máy chủ trước bị giết đột ngột, litestream của nó còn chạy: lần chạy sau dừng nó trước.
  const { spawn } = await import("node:child_process");
  const orphan = spawn(FAKE, ["replicate", "-config", path.join(LD, "litestream.yml")], { stdio: "ignore", detached: true });
  fs.writeFileSync(path.join(LD, "replicate.pid"), String(orphan.pid));
  await R.POST(req({ action: "save", enabled: true }, ck));
  ok(await until(() => { try { process.kill(orphan.pid, 0); return false; } catch { return true; } }), "tiến trình mồ côi của lần chạy trước bị dừng", log());
  await L.stopLitestream();
  r = await R.POST(req({ action: "clear" }, ck));
  ok(r.status === 200 && !(await r.json()).hasSecret && AS.getSetting("backup_r2", "") === "null", "xóa cấu hình");

  console.log("4. Khôi phục thật (litestream + bản sao dạng thư mục)");
  if (!realBin) console.log("  - Bỏ qua: máy này không có litestream (đặt LITESTREAM_BIN để chạy phần này).");
  else {
    process.env.LITESTREAM_BIN = realBin;
    process.env.SYNCHRO_LITESTREAM_FILE_REPLICA = path.join(tmp, "replica");
    for (let i = 0; i < 25; i++) AS.createUser({ email: `n${i}@synchro.test`, name: `N${i}`, verified: true });
    r = await R.POST(req({ action: "save", enabled: true }, ck));
    j = await r.json();
    ok(r.status === 200 && j.running && j.testReplica, `litestream thật chạy (${execFileSync(realBin, ["version"], { encoding: "utf8" }).trim()})`, j);
    // Trạng thái hỏi lại bản sao tối đa mỗi 20 giây: chờ tới khi thấy bản sao bắt kịp.
    ok(await until(async () => { const s = await R.GET(req(undefined, ck)).then((x) => x.json()); return s.replicaTxid && s.lagTx === 0; }, 60000), "đã đồng bộ: có TXID trên bản sao, độ trễ 0", await R.GET(req(undefined, ck)).then((x) => x.json()));
    st = await L.litestreamAdmin();
    ok(st.lastSyncAt > Date.now() - 5 * 60_000 && st.localTxid, "biết lần đồng bộ gần nhất và TXID cục bộ", st);
    AS.createUser({ email: "late@synchro.test", name: "Late", verified: true });
    await sleep(3000);
    r = await R.POST(req({ action: "drill" }, ck));
    j = await r.json();
    const users = j.tables?.find((t) => t.name === "users");
    ok(r.status === 200 && j.ok && j.integrity === "ok" && j.sizeMB >= 0, "kiểm tra khôi phục: khôi phục ra tệp tạm, integrity_check = ok", j);
    ok(users && users.restored === users.live && users.live === 28, "số tài khoản trong bản khôi phục khớp dữ liệu đang chạy (kể cả tài khoản vừa tạo)", j.tables);
    ok(j.tables.every((t) => t.live === null || t.restored === t.live || t.name === "audit" || t.name === "sessions"), "các bảng chính khớp", j.tables);
    ok(!fs.readdirSync(os.tmpdir()).some((f) => f.startsWith("synchro-restore-")), "tệp khôi phục tạm đã xóa");
    ok(AS.adminAudit(5).some((a) => a.action === "admin_backup_drill" && /^ok/.test(a.detail)), "nhật ký: kiểm tra khôi phục");
    await L.stopLitestream();
    ok(!(await L.litestreamAdmin()).running, "dừng litestream");
  }
} finally {
  await L.stopLitestream().catch(() => {});
  r2srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
