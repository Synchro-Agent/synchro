// Đăng xuất kèm "Xóa dữ liệu trên thiết bị này" (blueprint F5): xóa mọi khóa u:<uid>:* của tài khoản trong localStorage và sessionStorage
// cùng bản nháp ô soạn tin, giữ cài đặt của trình duyệt và dữ liệu của tài khoản khác; sau khi xóa không còn khóa nào chứa nội dung chat.
// Đăng nhập lại từ kho trống: bộ đồng bộ bắt đầu từ mốc 0 và máy chủ trả đủ đoạn chat, dự án. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

// Kho giống Storage của trình duyệt (key / length / getItem / setItem / removeItem).
class Store {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-logout-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "logout-test"; process.env.SYNCHRO_RELAX_LIMITS = "1";
const B = "http://localhost:3200";
try {
  const { userscope: U, chatsynccore: C, authstore: AS, chatstore: CS, "api/chats/route": R } = await loadTs(["userscope", "chatsynccore", "authstore", "chatstore", "api/chats/route"]);

  console.log("1. Xóa dữ liệu của tài khoản trên thiết bị");
  const SECRET = "Nội dung chat bí mật của A";
  U.setUserScope("A");
  U.ls.set("chats", JSON.stringify([{ id: 1, title: "Chat A", msgs: [{ role: "user", text: SECRET, time: 1 }] }]));
  U.ls.set("projects", JSON.stringify([{ id: 2, name: "Dự án A", ctx: [{ text: SECRET }] }]));
  U.ls.set("p:ins", JSON.stringify("Hướng dẫn riêng của A"));
  U.ls.set("codeS:5", JSON.stringify({ msgs: [{ text: SECRET }] }));
  U.ls.set("chatSync", JSON.stringify({ cur: 9, known: { "chat:1": [1, "h"] }, dirty: {}, gone: {} }));
  U.ls.set("theme", "dark");
  sessionStorage.setItem("draft:A", SECRET);
  sessionStorage.setItem("u:A:tmp", SECRET);
  U.setUserScope("B");
  U.ls.set("chats", JSON.stringify([{ id: 7, title: "Chat B", msgs: [{ role: "user", text: "của B", time: 1 }] }]));
  sessionStorage.setItem("draft:B", "nháp của B");
  localStorage.setItem("p:uilang", "en");
  localStorage.setItem("signedIn", "1");
  U.setUserScope(null);

  const n = U.clearAccountData("A");
  const all = () => [...localStorage.keys().map((k) => [k, localStorage.getItem(k)]), ...sessionStorage.keys().map((k) => [k, sessionStorage.getItem(k)])];
  ok(n === 7, "xóa đủ 5 khóa localStorage và 2 khóa sessionStorage của A", n);
  ok(!localStorage.keys().some((k) => k.startsWith("u:A:")) && !sessionStorage.keys().some((k) => k.startsWith("u:A:") || k === "draft:A"), "không còn khóa u:A:* nào, kể cả bản nháp", all());
  ok(!all().some(([, v]) => v.includes(SECRET) || v.includes("Hướng dẫn riêng của A")), "nghiệm thu: không còn khóa nào chứa nội dung chat hay hướng dẫn của A", all());
  ok(localStorage.getItem("u:B:chats")?.includes("của B") && sessionStorage.getItem("draft:B") === "nháp của B", "dữ liệu của tài khoản B giữ nguyên");
  ok(localStorage.getItem("theme") === "dark" && localStorage.getItem("p:uilang") === "en" && localStorage.getItem("signedIn") === "1", "cài đặt của cả trình duyệt (giao diện, ngôn ngữ) giữ nguyên");
  ok(U.clearAccountData("anon") === 0 && U.clearAccountData("") === 0 && localStorage.getItem("u:B:chats"), "khách (anon) hay mã rỗng: không xóa gì");
  ok(U.clearAccountData("A") === 0, "gọi lại: không còn gì để xóa, không lỗi");
  const saved = globalThis.localStorage;
  globalThis.localStorage = { get length() { throw new Error("blocked"); }, key() { throw new Error("blocked"); } };
  let threw = false;
  try { U.clearAccountData("B"); } catch { threw = true; }
  globalThis.localStorage = saved;
  ok(!threw && localStorage.getItem("u:B:chats"), "trình duyệt chặn bộ nhớ: không ném lỗi");

  console.log("2. Đăng nhập lại từ kho trống: đồng bộ từ máy chủ");
  U.setUserScope("A");
  const meta = C.parseMeta(U.ls.get("chatSync"));
  ok(meta.cur === 0 && !Object.keys(meta.known).length && !Object.keys(meta.dirty).length && !Object.keys(meta.gone).length, "kho trống: bộ đồng bộ bắt đầu từ mốc 0, không có mục chờ đẩy hay chờ xóa", meta);
  ok(JSON.parse(U.ls.get("chats") || "[]").length === 0, "danh sách đoạn chat trên thiết bị trống trước khi tải về");
  const u = AS.createUser({ email: "a@logout.test", name: "A", verified: true });
  const ck = AS.createSession(u, new Request(B + "/", { headers: { "user-agent": "t", "x-forwarded-for": "9.9.9.9" } }), "password").split(";")[0];
  const now = Date.now();
  const res = CS.pushItems(u.id, [
    { kind: "chat", id: "1", upd: now, data: JSON.stringify({ id: 1, title: "Chat A", msgs: [{ role: "user", text: SECRET, time: 1 }] }) },
    { kind: "chat", id: "3", upd: now, data: JSON.stringify({ id: 3, title: "Chat A2", msgs: [] }) },
    { kind: "project", id: "2", upd: now, data: JSON.stringify({ id: 2, name: "Dự án A" }) },
  ]);
  ok(res.every((r) => r.ok), "máy chủ đã có đoạn chat và dự án (đẩy lên trước khi đăng xuất)", res);
  const r = await R.GET(new Request(`${B}/api/chats?since=${meta.cur}`, { headers: { cookie: ck, "user-agent": "t", "x-forwarded-for": "9.9.9.9" } }));
  const j = await r.json();
  const got = new Map((j.items ?? []).map((x) => [`${x.kind}:${x.id}`, x]));
  ok(r.status === 200 && got.size === 3 && got.get("chat:1")?.data?.includes(SECRET) && got.get("project:2")?.data, "GET /api/chats?since=0 trả đủ nội dung để dựng lại thiết bị", j);
  ok(j.next > 0 && j.more === false, "có mốc mới để lần sau chỉ lấy phần đổi", j);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
