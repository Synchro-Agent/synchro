// Thêm và gỡ cách đăng nhập: không gỡ được cách cuối cùng, không gắn được danh tính của tài khoản khác. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ident-"));
process.env.DATA_KEY = "k";
const { generateKeyPairSync } = await import("node:crypto");
process.env.APPLE_CLIENT_ID = "app.synchro.test"; process.env.APPLE_TEAM_ID = "T"; process.env.APPLE_KEY_ID = "K";
process.env.APPLE_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
const { authstore: AS, "api/auth/identities/route": IR, "api/auth/oauth/[provider]/callback/route": CB } = await loadTs(["authstore", "api/auth/identities/route", "api/auth/oauth/[provider]/callback/route"]);
const req = () => new Request("http://localhost:3200/", { headers: { host: "localhost:3200", "x-forwarded-for": "9.9.9.9" } });
const prof = (provider, subject, email) => ({ provider, subject, email, emailVerified: true, name: "N", avatar: null });
const a = AS.createUser({ email: "a@i.test", name: "A", verified: true }), b = AS.createUser({ email: "b@i.test", name: "B", verified: true });
const methods = (u) => AS.publicUser(AS.getUser(u.id)).methods;
const throws = (f) => { try { f(); return null; } catch (e) { return e; } };
AS.connectIdentity(req(), a, prof("google", "g1", "a@i.test"));
ok(methods(a).includes("google"), "thêm Google");
ok(!throws(() => AS.connectIdentity(req(), a, prof("google", "g1", "a@i.test"))), "thêm lại cùng danh tính: không lỗi");
AS.connectIdentity(req(), a, prof("apple", "hide-me", "abc@privaterelay.appleid.com"));
ok(methods(a).includes("apple"), "thêm Apple dù email khác (Ẩn email)");
const u2 = AS.oauthLogin(req(), prof("apple", "hide-me", "abc@privaterelay.appleid.com"));
ok(u2.user.id === a.id, "đăng nhập bằng Apple vào đúng tài khoản, không tạo tài khoản rỗng", u2.user.email);
const taken = throws(() => AS.connectIdentity(req(), b, prof("google", "g1", "a@i.test")));
ok(taken?.status === 409 && !methods(b).includes("google"), "danh tính của tài khoản khác: từ chối", taken?.message);
AS.disconnectIdentity(req(), a, "apple");
ok(!methods(a).includes("apple"), "gỡ Apple");
const last = throws(() => AS.disconnectIdentity(req(), AS.getUser(a.id), "google"));
ok(last?.status === 400 && methods(a).includes("google"), "không gỡ được cách cuối cùng", last?.message);
ok(throws(() => AS.disconnectIdentity(req(), AS.getUser(b.id), "github")), "chưa có cách nào: báo lỗi, không đổi gì");

console.log("Thêm Apple: Apple gửi kết quả bằng POST từ trang khác, không có cookie phiên");
{
  const O = "http://localhost:3200", host = { origin: O, host: "localhost:3200", "x-forwarded-for": "9.9.9.9" };
  const c = AS.createUser({ email: "c@i.test", name: "C", verified: true }), d = AS.createUser({ email: "d@i.test", name: "D", verified: true });
  const sess = (u) => AS.createSession(u, req(), "password").split(";")[0];
  const pendingSub = { v: "" };
  // Không gọi Apple thật: fetch giả trả id_token đúng nonce trong cookie trạng thái.
  const realFetch = globalThis.fetch;
  let nonce = "";
  globalThis.fetch = async (url) => {
    if (!String(url).startsWith("https://appleid.apple.com/auth/token")) throw new Error("đường chưa giả lập: " + url);
    const claims = { iss: "https://appleid.apple.com", aud: "app.synchro.test", exp: Math.floor(Date.now() / 1000) + 300, sub: pendingSub.v, email: "abc@privaterelay.appleid.com", email_verified: "true", nonce };
    return new Response(JSON.stringify({ id_token: `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y` }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const begin = async (session) => {
    const r = await IR.POST(new Request(O + "/api/auth/identities", { method: "POST", headers: { ...host, "content-type": "application/json", cookie: session }, body: JSON.stringify({ provider: "apple" }) }));
    const state = new URL((await r.json()).url).searchParams.get("state"), ck = r.headers.get("set-cookie").split(";")[0];
    nonce = decodeURIComponent(ck.split("=")[1]).split(".")[2];
    return { state, ck };
  };
  const finish = (ck, state, extra = "") => CB.POST(new Request(O + "/api/auth/oauth/apple/callback", { method: "POST", headers: { host: "localhost:3200", "x-forwarded-for": "9.9.9.9", "content-type": "application/x-www-form-urlencoded", cookie: ck + extra }, body: new URLSearchParams({ state, code: "ma" }).toString() }), { params: Promise.resolve({ provider: "apple" }) });
  const loc = (r) => decodeURIComponent(r.headers.get("location") ?? "");
  const appleOf = (u) => methods(u).includes("apple");

  const s1 = sess(c);
  let b = await begin(s1);
  pendingSub.v = "apple-c";
  let r = await finish(b.ck, b.state);
  ok(r.status === 303 && /Sign-in method added/.test(loc(r)) && appleOf(c), "không có cookie phiên: vẫn thêm được vào đúng tài khoản đã bấm", loc(r));
  r = await finish(b.ck, b.state);
  ok(/Couldn't add/.test(loc(r)) && !appleOf(d), "gửi lại: vé chỉ dùng một lần, không gắn nhầm ai", loc(r));

  const s2 = sess(d);
  b = await begin(s2);
  AS.db().prepare("DELETE FROM sessions WHERE user_id = ?").run(d.id);
  pendingSub.v = "apple-d";
  r = await finish(b.ck, b.state);
  ok(/Couldn't add/.test(loc(r)) && !appleOf(d), "đăng xuất giữa chừng: không thêm", loc(r));

  const s3 = sess(d), s4 = sess(c);
  b = await begin(s3);
  pendingSub.v = "apple-d2";
  r = await finish(b.ck, b.state, `; ${s4}`);
  ok(/Sign-in method added/.test(loc(r)) && appleOf(d) && AS.db().prepare("SELECT user_id FROM identities WHERE subject = 'apple-d2'").get().user_id === d.id, "tab khác đổi sang tài khoản khác: vẫn gắn vào tài khoản đã bấm", loc(r));

  r = await finish(`oauth_apple=${encodeURIComponent(`la.v.${nonce}.connect`)}`, "la");
  ok(/Couldn't add/.test(loc(r)), "không có vé, không có phiên: từ chối", loc(r));
  globalThis.fetch = realFetch;
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
