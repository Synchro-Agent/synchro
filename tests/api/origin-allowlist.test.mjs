// Chống CSRF (authstore.sameOrigin) khi máy chủ thật đặt APP_URL=https://synchro.net.nz: nhận đúng tên máy đó, bản www. / không www.,
// thêm tên máy bằng SYNCHRO_ALLOWED_ORIGINS; Host giả mạo không mở được cửa; Origin bị từ chối được cảnh báo một lần mỗi tên máy.
// Tự chạy được, không cần máy chủ (loadTs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-origins-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "k";

const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { const s = a.join(" "); if (s.includes("[auth]")) warns.push(s); else realWarn(...a); };
const req = (origin, hostH = "synchro.net.nz") => new Request(`https://${hostH}/api/x`, { method: "POST", headers: { ...(origin ? { origin } : {}), host: hostH } });
const passes = (A, r) => { try { A.sameOrigin(r); return true; } catch (e) { return e.status === 403 ? false : `lỗi lạ ${e}`; } };

try {
  console.log("1. APP_URL=https://synchro.net.nz, SYNCHRO_ALLOWED_ORIGINS có thêm hai địa chỉ");
  process.env.APP_URL = "https://synchro.net.nz";
  process.env.SYNCHRO_ALLOWED_ORIGINS = " staging.synchro.net.nz , https://preview.example.com:8443,,khong hop le";
  const { authstore: A } = await loadTs(["authstore"]);
  ok(passes(A, req("https://synchro.net.nz")) === true, "Origin đúng APP_URL → qua");
  ok(passes(A, req("https://www.synchro.net.nz", "www.synchro.net.nz")) === true, "bản www. của APP_URL → qua");
  ok(passes(A, req("https://staging.synchro.net.nz", "staging.synchro.net.nz")) === true && passes(A, req("https://preview.example.com:8443")) === true, "tên máy thêm bằng SYNCHRO_ALLOWED_ORIGINS (tên máy hoặc địa chỉ đầy đủ) → qua");
  ok(passes(A, req("https://preview.example.com")) === false, "đúng tên máy nhưng sai cổng → chặn");
  ok(passes(A, req("https://evil.test", "evil.test")) === false, "Host giả mạo trùng Origin lạ → vẫn chặn (Host chỉ được tin khi nằm trong danh sách)");
  ok(passes(A, req("https://synchro.net.nz.evil.test")) === false && passes(A, req("https://wwwsynchro.net.nz")) === false, "tên máy giống giống → chặn");
  ok(passes(A, req(null)) === false && passes(A, req("null")) === false, "không có Origin / Origin null → chặn");
  const list = [...A.allowedOriginHosts()].sort().join(",");
  ok(list === "preview.example.com:8443,staging.synchro.net.nz,synchro.net.nz,www.synchro.net.nz", "danh sách tên máy được nhận", list);

  console.log("2. Cảnh báo khi chặn: một dòng cho mỗi tên máy, không lặp");
  warns.length = 0;
  passes(A, req("https://lan-1.test")); passes(A, req("https://lan-1.test")); passes(A, req("https://lan-1.test/khac"));
  passes(A, req("https://lan-2.test"));
  ok(warns.length === 2 && warns[0].includes("lan-1.test") && warns[1].includes("lan-2.test"), "hai tên máy lạ → đúng hai dòng cảnh báo", warns);
  ok(warns[0].includes("synchro.net.nz"), "cảnh báo nói rõ danh sách đang nhận (để sửa cấu hình)", warns[0]);
  warns.length = 0;
  passes(A, req(null)); passes(A, req("https://synchro.net.nz"));
  ok(warns.length === 0, "không có Origin hoặc Origin hợp lệ → không cảnh báo", warns);

  console.log("3. APP_URL là www.: nhận cả tên miền gốc");
  process.env.APP_URL = "https://www.synchro.net.nz"; delete process.env.SYNCHRO_ALLOWED_ORIGINS;
  const { authstore: W } = await loadTs(["authstore"]);
  ok(passes(W, req("https://synchro.net.nz")) === true && passes(W, req("https://www.synchro.net.nz")) === true && passes(W, req("https://evil.test")) === false, "www.synchro.net.nz ↔ synchro.net.nz");

  console.log("4. Không có APP_URL (máy dev): như cũ, Origin trùng Host");
  delete process.env.APP_URL;
  process.env.SYNCHRO_ALLOWED_ORIGINS = "127.0.0.1:3000";
  const { authstore: D } = await loadTs(["authstore"]);
  ok(passes(D, req("http://localhost:3999", "localhost:3999")) === true && passes(D, req("http://localhost:3999", "localhost:4000")) === false, "Origin trùng Host → qua, khác → chặn");
  ok(passes(D, req("http://127.0.0.1:3000", "localhost:3999")) === true, "SYNCHRO_ALLOWED_ORIGINS cũng dùng được khi chưa có APP_URL");
  ok([...D.allowedOriginHosts()].join() === "127.0.0.1:3000", "IP không có bản www.", [...D.allowedOriginHosts()]);
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}
console.warn = realWarn;
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
