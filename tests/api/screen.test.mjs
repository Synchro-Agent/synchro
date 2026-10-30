// Màn hình trực tiếp của trình duyệt Synchro (khung chat và Synchro Code): khung hình JPEG nhị phân, vẽ theo mật độ điểm ảnh của màn
// hình người xem (Retina 2x — chữ nét) nhưng tọa độ vẫn theo điểm ảnh CSS của trang; giao diện cũ (không xin bin) vẫn nhận base64;
// chữ có dấu (bộ gõ tiếng Việt gửi cả chữ khi ghép xong) vào đúng ô đang chọn. Máy không có Chrome thì bỏ qua.
import { findChrome } from "../../scripts/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
if (!findChrome()) { console.log("(máy này không có Chrome: bỏ qua)"); console.log("\n0 đạt, 0 lỗi"); process.exit(0); }
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), me = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await me("POST", "/api/auth/signup", { email: "screen@synchro.test", password: "Member-pass-123", profile: { fullName: "Screen Tester", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: "screen@synchro.test", password: "Member-pass-123" });
const row = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "screen@synchro.test");
await admin("PATCH", `/api/admin/users/${row.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(row.perms.features).map((k) => [k, true])) } });

// Kích thước ảnh JPEG đọc từ đoạn SOF (không cần thư viện ảnh).
function jpegSize(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}
async function open() {
  const t = await me("POST", "/api/browser", { op: "ticket" });
  const url = new URL(t.j.url, B.replace(/^http/, "ws")).toString();
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const got = { json: [], bin: [] };
  ws.onmessage = (e) => { if (typeof e.data === "string") { try { got.json.push(JSON.parse(e.data)); } catch {} } else got.bin.push(e.data); };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { ws, got, send: (o) => ws.send(JSON.stringify(o)) };
}
const until = async (f, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = f(); if (v) return v; await sleep(200); } return f(); };

console.log("1. Khung hình nhị phân, nét theo màn hình Retina, tọa độ theo trang");
const a = await open();
a.send({ t: "size", w: 800, h: 600, dpr: 2, bin: true });
a.send({ t: "html", html: `<!doctype html><meta charset="utf-8"><title>bat dau</title><body style="margin:0;font:20px sans-serif"><h1 style="margin:0;height:100px">Xin chào Synchro</h1><input id="x" autofocus style="font-size:24px;width:600px;height:50px;margin:0" oninput="document.title=this.value"></body>` });
const meta = await until(() => a.got.json.find((m) => m.t === "meta" && m.w === 800));
await until(() => a.got.bin.length, 10_000);
await sleep(1500);
const frame = a.got.bin.at(-1);
const sz = frame ? jpegSize(frame) : null;
ok(meta?.w === 800 && meta.h === 600, "kích thước trang theo điểm ảnh CSS (tọa độ chuột / phím)", a.got.json.filter((m) => m.t === "meta"));
ok(sz && sz.w === 1600 && sz.h === 1200, "ảnh vẽ ở mật độ 2x: chữ nét trên màn hình Retina", sz);
ok(!a.got.json.some((m) => m.t === "frame"), "đã xin bin thì không còn khung base64 trong JSON");

console.log("2. Gõ tiếng Việt có dấu (bộ gõ gửi cả chữ khi ghép xong)");
// Bấm vào ô nhập (tọa độ theo điểm ảnh CSS của trang) rồi gửi chữ như bộ gõ gửi khi ghép xong.
a.send({ t: "mouse", type: "mousePressed", x: 300, y: 125, button: "left", buttons: 1, clickCount: 1 });
a.send({ t: "mouse", type: "mouseReleased", x: 300, y: 125, button: "left", buttons: 0, clickCount: 1 });
a.send({ t: "text", text: "Tiếng Việt có dấu" });
const typed = await until(() => a.got.json.find((m) => m.t === "tabs" && (m.list ?? []).some((t) => t.title === "Tiếng Việt có dấu")), 8000);
ok(!!typed, "chữ có dấu vào đúng ô đang chọn", a.got.json.filter((m) => m.t === "tabs").at(-1));
a.ws.close();
await sleep(500);

console.log("3. Giao diện bản cũ (không xin bin) vẫn nhận khung base64");
const c = await open();
c.send({ t: "size", w: 640, h: 480 });
const legacy = await until(() => c.got.json.find((m) => m.t === "frame" && m.data));
ok(legacy && legacy.w === 640 && jpegSize(Uint8Array.from(Buffer.from(legacy.data, "base64")))?.w === 640 && !c.got.bin.length, "khung JSON base64 ở mật độ 1x như trước", legacy ? { w: legacy.w, h: legacy.h } : null);
c.ws.close();

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
