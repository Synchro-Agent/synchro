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

console.log("3b. Trang tĩnh đứng yên: máy chủ không gửi khung liên tục (không có vòng lặp chụp lại)");
{
  const d0 = await open();
  d0.ws.onmessage = ((orig) => (e) => { if (typeof e.data !== "string") d0.ws.send('{"t":"fa"}'); orig(e); })(d0.ws.onmessage);
  d0.send({ t: "size", w: 800, h: 600, dpr: 2, bin: true, fa: true });
  d0.send({ t: "html", html: "<!doctype html><meta charset=utf-8><h1>Trang tĩnh</h1>" });
  await sleep(2500);
  const n0 = d0.got.bin.length;
  await sleep(3000);
  ok(d0.got.bin.length - n0 <= 2, "3 giây đứng yên: tối đa 2 khung", { frames: d0.got.bin.length - n0 });
  d0.ws.close();
}

console.log("4. Mạng chậm: tự hạ chất lượng / độ phân giải để không trễ dồn, mạng thông thì nâng lại");
{
  const t = await me("POST", "/api/browser", { op: "ticket" });
  const w = new WebSocket(new URL(t.j.url, B.replace(/^http/, "ws")).toString());
  w.binaryType = "arraybuffer";
  const dims = [], steps = [];
  // Như khung xem của Synchro: báo đã nhận từng khung (fa). Mạng chậm giả lập: đường truyền 1,5 Mbps — khung càng nặng càng lâu tới,
  // các khung đi nối tiếp nhau trên đường truyền.
  let slow = false, linkFree = 0;
  const BPS = 1_500_000 / 8 / 1000; // byte / ms
  w.onmessage = (e) => {
    if (typeof e.data === "string") { const j = JSON.parse(e.data); if (j.t === "quality") steps.push(j); return; }
    const s = jpegSize(e.data); if (s) dims.push({ at: Date.now(), w: s.w });
    if (!slow) return w.send('{"t":"fa"}');
    linkFree = Math.max(Date.now(), linkFree) + e.data.byteLength / BPS;
    setTimeout(() => w.send('{"t":"fa"}'), linkFree - Date.now());
  };
  await new Promise((r) => (w.onopen = r));
  w.send(JSON.stringify({ t: "size", w: 900, h: 700, dpr: 2, bin: true, fa: true }));
  w.send(JSON.stringify({ t: "html", html: `<!doctype html><meta charset=utf-8><body style="margin:0"><canvas id=c width=900 height=700></canvas><script>const c=document.getElementById("c").getContext("2d");(function f(){for(let i=0;i<400;i++){c.fillStyle="hsl("+Math.random()*360+",80%,50%)";c.fillRect(Math.random()*900,Math.random()*700,40,40)}requestAnimationFrame(f)})()</script>` }));
  await until(() => dims.length > 5, 15_000);
  const full = Math.max(...dims.map((d) => d.w));
  slow = true;
  await until(() => steps.length && steps.at(-1).d < 2, 30_000);
  const t1 = Date.now();
  await sleep(2500);
  const recent = dims.filter((d) => d.at > t1);
  ok(full === 1800 && steps.length > 0 && steps[0].d === 2 && steps.at(-1).d < 2 && recent.length > 0 && recent.some((d) => d.w < 1800), "mạng chậm → hạ mức nén trước (giữ 2x), rất chậm mới hạ độ phân giải", { full, steps, recent: recent.slice(-2) });
  // Màn hình đứng yên (trang tĩnh) khi đang ở bậc thấp: khung cuối là khung 2x chất lượng cao (chữ sắc nét khi đọc).
  w.send(JSON.stringify({ t: "html", html: "<!doctype html><meta charset=utf-8><h1 style='font:40px serif'>Đứng yên để đọc</h1>" }));
  // Chờ màn hình ổn định (khung cuối đã đứng yên nửa giây).
  await until(() => dims.at(-1)?.w === 1800 && Date.now() - dims.at(-1).at > 500, 12_000, 100);
  ok(steps.at(-1).d < 2 && dims.at(-1)?.w === 1800, "đứng yên → khung cuối 2x sắc nét dù đang ở bậc thấp (refine)", { step: steps.at(-1), last: dims.slice(-3) });
  slow = false;
  w.send(JSON.stringify({ t: "html", html: `<!doctype html><meta charset=utf-8><body style="margin:0"><canvas id=c width=900 height=700></canvas><script>const c=document.getElementById("c").getContext("2d");(function f(){for(let i=0;i<400;i++){c.fillStyle="hsl("+Math.random()*360+",80%,50%)";c.fillRect(Math.random()*900,Math.random()*700,40,40)}requestAnimationFrame(f)})()</script>` }));
  await until(() => steps.at(-1)?.step === 0, 45_000);
  ok(steps.at(-1)?.step === 0, "mạng thông → nâng lại bậc cao nhất (2x)", steps.slice(-2));
  w.close();
}

console.log("5. Video: khung chỉ mang phần thay đổi (gõ phím vài KB thay vì ~250 KB một ảnh 2x), vẫn nét 2x");
{
  const v = await open();
  const bins = [], msgs = [];
  let mark = 0;
  v.ws.onmessage = (e) => {
    if (typeof e.data === "string") { const j = JSON.parse(e.data); msgs.push({ ...j, at: bins.length }); return; }
    v.ws.send('{"t":"fa"}');
    const u8 = new Uint8Array(e.data);
    bins.push({ at: Date.now(), n: u8.length, k: u8[0], jpeg: u8[0] === 0xff && u8[1] === 0xd8 });
  };
  v.send({ t: "size", w: 900, h: 700, dpr: 2, bin: true, fa: true, vid: true });
  v.send({ t: "html", html: `<!doctype html><meta charset=utf-8><body style="margin:20px;font:16px sans-serif"><input id=x autofocus style="font-size:22px;width:600px;caret-color:transparent">${Array.from({ length: 200 }, (_, i) => `<p>Dòng ${i}: trình duyệt của Synchro truyền hình bằng video, chữ nét ở mật độ 2x.</p>`).join("")}</body>` });
  const cfg = await until(() => msgs.find((m) => m.t === "video" && m.codec), 30_000);
  ok(cfg && /^(vp09|avc1|av01)\./.test(cfg.codec) && cfg.w === 900 && cfg.h === 700, "máy chủ chọn video, gửi cấu hình giải mã (codec, kích thước trang)", cfg ?? msgs.filter((m) => m.t !== "tabs").slice(-3));
  await until(() => bins.length >= 1, 15_000);
  const first = bins[cfg?.at ?? 0];
  ok(first && first.k === 1 && !first.jpeg && first.n > 5000, "khung đầu là khung khóa (cả màn hình)", first);
  await sleep(1500);
  mark = bins.length;
  for (let i = 0; i < 10; i++) { v.send({ t: "text", text: "a" }); await sleep(200); }
  await sleep(600);
  const typed = bins.slice(mark);
  const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[x.length >> 1] ?? 0; };
  ok(typed.length >= 5 && typed.every((b) => !b.jpeg) && med(typed.map((b) => b.n)) < 8000, "gõ phím: khung video nhỏ (vài KB)", { n: typed.length, median: med(typed.map((b) => b.n)), sizes: typed.map((b) => b.n).slice(0, 12) });
  mark = bins.length;
  const cfgBefore = msgs.filter((m) => m.t === "video").length;
  for (let i = 0; i < 20; i++) { v.send({ t: "wheel", x: 400, y: 400, dx: 0, dy: 80 }); await sleep(50); }
  await sleep(1200);
  const scrolled = bins.slice(mark);
  ok(scrolled.length >= 4 && med(scrolled.map((b) => b.n)) < 150_000, "cuộn: khung video nhỏ hơn hẳn ảnh 2x", { n: scrolled.length, median: med(scrolled.map((b) => b.n)) });
  // Đang cuộn Chrome chụp 1,5x cho nhanh, bộ nén phóng lên cỡ khung 2x: không mở lại bộ nén (không có cấu hình video mới), không khung khóa mới.
  ok(msgs.filter((m) => m.t === "video").length === cfgBefore && !scrolled.some((b) => b.k === 1), "cuộn: chụp nhỏ hơn khi đang cuộn mà không mở lại bộ nén", { cfgs: msgs.filter((m) => m.t === "video").length - cfgBefore, keys: scrolled.filter((b) => b.k === 1).length });
  // Tab nén video là tab ẩn: không lọt vào danh sách tab của người dùng.
  const tabs = msgs.filter((m) => m.t === "tabs").at(-1);
  ok(tabs && !(tabs.list ?? []).some((t) => /encoder\.synchro|synchro-encoder/.test(t.url)), "tab nén video không hiện trong danh sách tab", tabs?.list);
  // Bộ giải mã của người xem lỗi → xin khung khóa: màn hình đứng yên vẫn nhận lại cấu hình + khung khóa của khung gần nhất.
  await sleep(800);
  const nCfg = msgs.filter((m) => m.t === "video").length;
  mark = bins.length;
  v.send({ t: "vkey" });
  await until(() => msgs.filter((m) => m.t === "video").length > nCfg && bins.length > mark, 15_000);
  ok(msgs.filter((m) => m.t === "video").length > nCfg && bins[mark]?.k === 1, "xin khung khóa: cấu hình mới + khung khóa, kể cả khi trang đứng yên", { cfgs: msgs.filter((m) => m.t === "video").length - nCfg, next: bins[mark] });
  // Đổi kích thước khung xem: cấu hình mới theo kích thước mới.
  v.send({ t: "size", w: 800, h: 600, dpr: 2, bin: true, fa: true, vid: true });
  const cfg2 = await until(() => msgs.find((m) => m.t === "video" && m.codec && m.w === 800), 20_000);
  ok(cfg2?.h === 600, "đổi kích thước: cấu hình video mới 800x600", msgs.filter((m) => m.t === "video").slice(-2));
  // Trình duyệt của người xem không giải mã được loại video này → máy chủ quay về JPEG.
  v.send({ t: "novideo" });
  await until(() => msgs.some((m) => m.t === "video" && m.off), 10_000);
  mark = bins.length;
  v.send({ t: "text", text: "b" });
  await until(() => bins.slice(mark).some((b) => b.jpeg), 15_000);
  ok(msgs.some((m) => m.t === "video" && m.off) && bins.slice(mark).some((b) => b.jpeg), "novideo: máy chủ báo tắt video và gửi lại ảnh JPEG", bins.slice(mark, mark + 3));
  v.ws.close();
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
