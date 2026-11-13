// F1 — lớp bọc route ghi (server/route.ts): mọi phương thức không phải GET phải đến từ chính trang Synchro (sameOrigin),
// route JSON từ chối Content-Type khác application/json, và đăng nhập được kiểm sau khi qua hai cổng đó.
// Tự chạy được, không cần máy chủ (loadTs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-sameorigin-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const HOST = "synchro.test", ORIGIN = `https://${HOST}`, URL0 = `${ORIGIN}/api/x`;
const reqInit = (method, { origin, cookie, ct } = {}) => {
  const h = { host: HOST };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  if (ct) h["content-type"] = ct;
  return new Request(URL0, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
};

try {
  const { "../server/route": R, authstore: A } = await loadTs(["../server/route", "authstore"]);
  const user = A.createUser({ email: "so@test", name: "SO", verified: true });
  // Tạo phiên thật để lấy cookie hợp lệ.
  const setCookie = A.createSession(user, reqInit("GET", { origin: ORIGIN }), "password");
  const cookie = setCookie.split(";")[0];

  const jsonPost = R.route({ auth: "user", json: true }, ({ user: u }) => Response.json({ ok: true, uid: u.id }));
  const plainDelete = R.route({ auth: "user" }, () => Response.json({ ok: true }));

  console.log("1. Origin lạ → 403 cho mọi phương thức ghi");
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    const h = m === "DELETE" ? plainDelete : jsonPost;
    const res = await h(reqInit(m, { origin: "https://evil.test", cookie, ct: "application/json" }));
    ok(res.status === 403, `${m} với Origin lạ → 403`, res.status);
  }

  console.log("2. Thiếu Origin (POST giả tạo không qua trình duyệt) → 403");
  const noOrigin = await jsonPost(reqInit("POST", { cookie, ct: "application/json" }));
  ok(noOrigin.status === 403, "POST không Origin → 403", noOrigin.status);

  console.log("3. Cùng Origin + đăng nhập + JSON → 200");
  const good = await jsonPost(reqInit("POST", { origin: ORIGIN, cookie, ct: "application/json" }));
  ok(good.status === 200, "POST hợp lệ → 200", good.status);
  ok((await good.json()).uid === user.id, "handler nhận đúng tài khoản");

  console.log("4. Cùng Origin nhưng Content-Type sai → 415 (trước cả khi kiểm đăng nhập)");
  const badCt = await jsonPost(reqInit("POST", { origin: ORIGIN, ct: "text/plain" }));
  ok(badCt.status === 415, "POST text/plain → 415", badCt.status);

  console.log("5. Cùng Origin, JSON, nhưng chưa đăng nhập → 401");
  const noAuth = await jsonPost(reqInit("POST", { origin: ORIGIN, ct: "application/json" }));
  ok(noAuth.status === 401, "POST không cookie → 401", noAuth.status);

  console.log("6. GET không cần Origin (đọc) → 200");
  const getRes = await R.route({ auth: "user" }, () => Response.json({ ok: true }))(reqInit("GET", { cookie }));
  ok(getRes.status === 200, "GET không Origin → 200", getRes.status);

  console.log("7. Mọi route ghi đã khai báo đều đi qua lớp bọc server/route");
  const ROOT = process.cwd();
  const WRITE_ROUTES = [
    "app/api/llm/route.ts", "app/api/files/route.ts", "app/api/files/context/route.ts",
    "app/api/markitdown/route.ts", "app/api/sandbox/route.ts", "app/api/scrape/route.ts",
    "app/api/skills/route.ts", "app/api/skills/import/route.ts",
    "app/api/skills/[name]/route.ts", "app/api/skills/[name]/share/route.ts",
  ];
  for (const rel of WRITE_ROUTES) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(/from "(\.\.\/)+server\/route"/.test(src) && /\broute\s*(<[^(]*>)?\(\s*\{/.test(src), `${rel} dùng route() của server/route`, src.slice(0, 80));
  }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
