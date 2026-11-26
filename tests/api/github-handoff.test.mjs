// Kết nối GitHub luôn lưu vào đúng tài khoản đã bấm Kết nối (server/ghlink.ts), chạy thật các route:
// 1. Ứng dụng máy tính: trang cấp quyền mở ở trình duyệt của máy đang đăng nhập tài khoản khác → token vào tài khoản
//    của app, tài khoản ở trình duyệt không đổi; app hỏi được kết quả, người khác không đọc được lượt của app.
// 2. Trình duyệt chưa đăng nhập → vẫn kết nối được cho tài khoản của app.
// 3. Đường dẫn trao tay chỉ dùng một lần, hết hạn thì báo rõ (app nhận lỗi), xin đường dẫn phải cùng nguồn.
// 4. Hủy ở GitHub: app nhận lời báo thay vì chờ mãi.
// 5. Web: tab khác đổi tài khoản giữa chừng → token vẫn vào tài khoản đã bấm; mất vé (khởi động lại) → không rơi về
//    tài khoản đang đăng nhập.
// Tự chạy được: GitHub giả lập ngay trong bài thử, thư mục dữ liệu riêng.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};

// GitHub giả lập: mã đổi token theo mã ?code=…, mỗi mã là một tài khoản GitHub.
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.pathname === "/login/oauth/access_token") {
    const code = new URLSearchParams(body).get("code");
    return send({ access_token: `gho_${code}`, scope: "repo,read:org,read:user,user:email" });
  }
  const tok = /^Bearer gho_(.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  if (u.pathname === "/user") return send({ id: tok.length, login: `gh-${tok}`, name: tok });
  if (u.pathname === "/user/emails") return send([{ email: `${tok}@gh.test`, primary: true, verified: true }]);
  res.writeHead(404);
  res.end("{}");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ghlink-"));
process.env.DATA_DIR = tmp;
process.env.DATA_KEY = "gh-link-key";
process.env.GITHUB_API_URL = BASE;
process.env.GITHUB_WEB_URL = BASE;
process.env.GITHUB_CLIENT_ID = "Iv1.handoff";
process.env.GITHUB_CLIENT_SECRET = "secret";

const mods = await loadTs(["server/authstore", "server/github", "app/api/github/connect/route",
  "app/api/github/route", "app/api/auth/oauth/[provider]/callback/route"]);
const AS = mods["server/authstore"], GH = mods["server/github"];
const CR = mods["app/api/github/connect/route"], GR = mods["app/api/github/route"];
const CB = mods["app/api/auth/oauth/[provider]/callback/route"];

const O = "http://localhost:3200";
const base = { host: "localhost:3200", "x-forwarded-for": "9.9.9.9" };
const mk = (email) => AS.createUser({ email, name: email.split("@")[0], verified: true });
const sess = (u) => AS.createSession(u, new Request(O + "/", { headers: base }), "password").split(";")[0];
const desk = mk("desk@h.test"), other = mk("other@h.test"), webu = mk("web@h.test");
const loc = (r) => r.headers.get("location") ?? "";
const join = (...c) => c.filter(Boolean).join("; ");

// App xin đường dẫn trao tay (cookie phiên của app).
const handoff = async (cookie, origin = O) => {
  const r = await CR.POST(new Request(O + "/api/github/connect", { method: "POST",
    headers: { ...base, ...(origin ? { origin } : {}), cookie } }));
  return { s: r.status, j: await r.json() };
};
// Trình duyệt mở một đường dẫn kết nối rồi bấm Cho phép trên GitHub (mã code = tài khoản GitHub).
const browse = async (url, browserCookie, code, ghError) => {
  const r1 = await CR.GET(new Request(url, { headers: { ...base, cookie: browserCookie } }));
  const to = loc(r1);
  if (!to.startsWith(BASE)) return { r1, to, final: to };
  const state = new URL(to).searchParams.get("state");
  const st = (r1.headers.get("set-cookie") ?? "").split(";")[0];
  const q = ghError ? `error=${ghError}&state=${state}` : `code=${code}&state=${state}`;
  const r2 = await CB.GET(new Request(`${O}/api/auth/oauth/github/callback?${q}`,
    { headers: { ...base, cookie: join(browserCookie, st) } }), { params: Promise.resolve({ provider: "github" }) });
  return { r1, to, final: loc(r2) };
};
const poll = async (cookie, id) =>
  (await GR.GET(new Request(`${O}/api/github?handoff=${encodeURIComponent(id)}`, { headers: { ...base, cookie } })))
    .json();

try {
  const sDesk = sess(desk), sOther = sess(other), sWeb = sess(webu);
  ok(AS.can(desk, "code"), "tài khoản thử dùng được Synchro Code");

  console.log("1. App: trình duyệt của máy đăng nhập tài khoản khác");
  const h1 = await handoff(sDesk);
  ok(h1.s === 200 && h1.j.id && /\/api\/github\/connect\?handoff=/.test(h1.j.url), "app nhận đường dẫn trao tay", h1);
  ok((await poll(sDesk, h1.j.id)).state === "wait", "chưa mở: đang chờ");
  const b1 = await browse(h1.j.url, sOther, "alice");
  ok(b1.to.startsWith(`${BASE}/login/oauth/authorize`), "đường dẫn mở trang cấp quyền GitHub", b1.to);
  ok(/\/api\/github\/done\?app=1$/.test(b1.final), "xong: trang mời quay lại ứng dụng", b1.final);
  ok(GH.getLink(desk.id)?.login === "gh-alice", "token lưu vào tài khoản của app", GH.getLink(desk.id));
  ok(GH.getLink(other.id) === null, "tài khoản đang đăng nhập ở trình duyệt không bị gắn GitHub");
  const p1 = await poll(sDesk, h1.j.id);
  ok(p1.state === "done" && p1.login === "gh-alice", "app hỏi kết quả: đã kết nối", p1);
  ok((await poll(sOther, h1.j.id)).state === "gone", "người khác không đọc được lượt của app");

  console.log("2. App: trình duyệt chưa đăng nhập");
  GH.removeLink(desk.id);
  const h2 = await handoff(sDesk);
  const b2 = await browse(h2.j.url, "", "bob");
  ok(/\/api\/github\/done\?app=1$/.test(b2.final) && GH.getLink(desk.id)?.login === "gh-bob",
    "kết nối được, token vào tài khoản của app", { final: b2.final, link: GH.getLink(desk.id) });

  console.log("3. Dùng một lần, hết hạn, cùng nguồn");
  const again = await CR.GET(new Request(h2.j.url, { headers: { ...base, cookie: sOther } }));
  ok(/\/api\/github\/done\?error=.+&app=1$/.test(loc(again))
    && /hết hạn hoặc đã được dùng/.test(decodeURIComponent(loc(again))),
    "mở lại đường dẫn đã dùng: báo rõ, không bắt đầu lượt mới", loc(again));
  const bad = await CR.GET(new Request(`${O}/api/github/connect?handoff=${h2.j.id}.sai-ma`, { headers: base }));
  ok(/error=/.test(loc(bad)), "đoán sai mã: từ chối", loc(bad));
  const h3 = await handoff(sDesk);
  globalThis.__synchroGhLink.handoffs.get(h3.j.id).exp = Date.now() - 1;
  const late = await CR.GET(new Request(h3.j.url, { headers: base }));
  ok(/error=/.test(loc(late)) && (await poll(sDesk, h3.j.id)).state === "gone", "quá 10 phút: hết hạn", loc(late));
  const h4 = await handoff(sDesk), h5 = await handoff(sDesk);
  ok((await poll(sDesk, h4.j.id)).state === "gone" && (await poll(sDesk, h5.j.id)).state === "wait",
    "bấm Kết nối lần nữa: lượt cũ hết hiệu lực");
  const cross = await handoff(sDesk, "https://evil.example");
  ok(cross.s === 403, "trang khác nguồn không xin được đường dẫn", cross);
  const anon = await handoff("");
  ok(anon.s === 401, "chưa đăng nhập trong app: không xin được", anon);

  console.log("4. Hủy ở GitHub");
  const h6 = await handoff(sDesk);
  const b6 = await browse(h6.j.url, sOther, null, "access_denied");
  const p6 = await poll(sDesk, h6.j.id);
  ok(p6.state === "error" && /hủy/.test(p6.error ?? "") && /app=1/.test(b6.final),
    "app nhận lời báo đã hủy", { p6, final: b6.final });

  console.log("5. Web");
  const w1 = await browse(`${O}/api/github/connect`, sWeb, "carol");
  ok(/\/api\/github\/done$/.test(w1.final) && GH.getLink(webu.id)?.login === "gh-carol",
    "web: kết nối như trước, trang báo cho tab Synchro", w1.final);
  // Tab khác đổi sang tài khoản khác giữa lúc cấp quyền: callback nhận cookie phiên của tài khoản kia.
  const r1 = await CR.GET(new Request(`${O}/api/github/connect`, { headers: { ...base, cookie: sWeb } }));
  const state = new URL(loc(r1)).searchParams.get("state");
  const st = (r1.headers.get("set-cookie") ?? "").split(";")[0];
  const cb = (cookie) => CB.GET(new Request(`${O}/api/auth/oauth/github/callback?code=dave&state=${state}`,
    { headers: { ...base, cookie } }), { params: Promise.resolve({ provider: "github" }) });
  await cb(join(sOther, st));
  ok(GH.getLink(webu.id)?.login === "gh-dave" && GH.getLink(other.id) === null,
    "đổi tài khoản giữa chừng: token vẫn vào tài khoản đã bấm Kết nối");
  const r2 = await CR.GET(new Request(`${O}/api/github/connect`, { headers: { ...base, cookie: sWeb } }));
  const state2 = new URL(loc(r2)).searchParams.get("state");
  const st2 = (r2.headers.get("set-cookie") ?? "").split(";")[0];
  globalThis.__synchroGhLink.tickets.clear();
  const lost = await CB.GET(new Request(`${O}/api/auth/oauth/github/callback?code=eve&state=${state2}`,
    { headers: { ...base, cookie: join(sOther, st2) } }), { params: Promise.resolve({ provider: "github" }) });
  ok(/error=/.test(loc(lost)) && GH.getLink(other.id) === null && GH.getLink(webu.id)?.login === "gh-dave",
    "mất vé: báo kết nối lại, không gắn vào tài khoản đang đăng nhập", loc(lost));
  const out = await CR.GET(new Request(`${O}/api/github/connect`, { headers: base }));
  ok(/error=.*%C4%91%C4%83ng%20nh%E1%BA%ADp/i.test(loc(out)) && !/app=1/.test(loc(out)),
    "web chưa đăng nhập: báo cần đăng nhập", loc(out));
} finally {
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
