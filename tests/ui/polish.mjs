// Soát độ hoàn thiện giao diện (ô chọn gốc, bo viên thuốc trên chữ nhiều dòng, thanh cuộn thừa, chữ bị cắt, dải cuộn cắt mép, bố cục tự rung) ở 390/768/1440px, sáng/tối
// Kiểm thử giao diện bằng Chrome ẩn trên npm run dev:mock. Chạy tay: node tests/ui/polish.mjs [light|dark] [desktop|tablet|mobile] [đoạn tên bước…]
// Đi qua mọi trang, công cụ Speech, tab Cài đặt, hộp thoại / menu với tới được; ở mỗi trạng thái đo trong trang và BÁO LỖI (mã thoát 1) khi:
//  1. còn <select> hay <input type=color> gốc đang hiện (Windows mở danh sách / bảng màu của hệ điều hành, lệch hẳn khỏi giao diện);
//  2. phần tử có chữ nhiều dòng (ô nhập nhiều dòng, mục menu, hàng danh sách, nút xuống dòng) bo góc quá 3/8 chiều cao (bo viên thuốc cắt chữ ở góc);
//  3. khung cuộn tràn lẻ dưới 12px mà còn thanh cuộn (Windows hiện thanh có hai mũi tên mà không cuộn được gì), overflow:scroll còn thanh cuộn,
//     dải thấp dưới 48px cuộn được mà không ẩn thanh cuộn;
//  4. chữ bị khung overflow:hidden / clip cắt ngang mà không có dấu …, line-clamp hay lớp mờ;
//  5. dải cuộn ngang: mục cắt ngang ở mép mà mép đó không có lớp mờ, mục đầu / cuối bị cắt khi cuộn hết cỡ, mục đang chọn nằm khuất;
//  6. bố cục tự thay đổi trong 2 giây không ai chạm vào (đo vị trí / cỡ mọi phần tử và vị trí cuộn 6 lần): màn Giới thiệu về bạn từng cuộn tới lui;
//  7. chữ gợi ý (placeholder) bắt đầu trong phần góc bo của ô nhập nên bị góc bo cắt.
// Giao diện sáng chạy bằng tiếng Việt, tối bằng tiếng Anh (nhãn tiếng Anh thường dài hơn: hai ngôn ngữ đều được đo mà không gấp đôi thời gian).
// Lỗi được phép bỏ qua chỉ khi nằm trong ALLOW kèm lý do viết rõ. Ảnh chụp từng trạng thái ở <tmp>/synchro-ui/polish/.
import { settle, waitFor } from "../lib/wait.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";

const B = process.env.BASE ?? "http://localhost:3200";
const M = process.env.MOCK_PROVIDER ?? "http://127.0.0.1:4010";
const OUT = process.env.POLISH_OUT ?? os.tmpdir() + "/synchro-ui/polish/";
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const PROF = os.tmpdir() + "/synchro-ui/chrome-prof-polish";
const PORT = 9396;
const argv = process.argv.slice(2);
const THEMES = argv[0] && /^(light|dark)$/.test(argv[0]) ? [argv[0]] : ["light", "dark"];
const SIZES = argv[1] && /^(desktop|tablet|mobile)$/.test(argv[1]) ? [argv[1]] : ["desktop", "tablet", "mobile"];
const ONLY = argv.slice(2);
const VIEW = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, tablet: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const LANG = { light: "vi", dark: "en" };

// Lỗi được phép: mỗi dòng một mẫu (so với "bước: nội dung lỗi") và lý do. Không thêm dòng nào khi chưa viết được lý do cụ thể.
const ALLOW = [
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body, ck = cookie) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie: ck }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=") && ck === cookie) cookie = c.split(";")[0];
  return r;
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
// Speech: khóa ElevenLabs giả lập, gói Pro có Studio để mọi công cụ (kể cả Podcast & Sách nói) đều hiện.
await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${M}/elevenlabs` });
await fetch(`${M}/_debug/el`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: "pro", studio: true, lockMusic: false, used: 1000, noPerms: [] }) }).catch(() => {});
await api("GET", "/api/speech/plan?fresh=1");
// Tài khoản mới cho màn Giới thiệu về bạn (như tests/ui/authfit.mjs: sửa needsProfile trong phản hồi).
let ONB = "";
{ const H = { "content-type": "application/json", origin: B }, who = `polish-${Date.now()}@synchro.test`, pw = "polish-mock-123";
  await fetch(B + "/api/auth/signup", { method: "POST", headers: H, body: JSON.stringify({ email: who, password: pw, profile: { fullName: "Polish Tester", birthDate: "2000-01-01" } }) });
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: who, password: pw }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) ONB = c.split(";")[0]; }

// ───────────────────────────── đo trong trang (hàm thật, chuyển thành chuỗi khi gửi sang Chrome)
function POLISH() {
  const out = [], W = innerWidth, H = innerHeight, CAP = 8, count = {};
  const push = (k, m) => { count[k] = (count[k] ?? 0) + 1; if (count[k] <= CAP) out.push(m); };
  const csC = new Map(), gcs = (el) => { let c = csC.get(el); if (!c) { c = getComputedStyle(el); csC.set(el, c); } return c; };
  const visC = new Map();
  const vis = (el) => {
    if (visC.has(el)) return visC.get(el);
    let v = !!el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) && !el.closest("[inert],[aria-hidden=true],.sr-only");
    if (v) { const r = el.getBoundingClientRect(); v = r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; }
    visC.set(el, v); return v;
  };
  const name = (el) => { const c = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((x) => x && !/^(on|active|open)$/.test(x)).slice(0, 2).join(".") : ""; const t = (el.getAttribute?.("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28); return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (c ? "." + c : "") + (t ? " “" + t + "”" : ""); };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c === "transparent" ? 0 : 1; const p = m[1].split(/[,\s/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; };
  const painted = (cs) => alpha(cs.backgroundColor) > 0.02 || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.05) || (parseFloat(cs.borderBottomWidth) > 0 && alpha(cs.borderBottomColor) > 0.05) || cs.boxShadow !== "none" || cs.backgroundImage !== "none";
  const radius = (cs, b) => Math.max(...["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"].map((k) => { const v = cs[k]; const n = parseFloat(v) || 0; return v.includes("%") ? (n / 100) * Math.min(b.width, b.height) : n; }));
  const all = [...document.querySelectorAll("body *")].filter((el) => !(el instanceof SVGElement) && !el.closest("svg,iframe,.cm-editor,.katex,.monaco-editor"));

  // 1. Ô chọn / ô màu gốc của trình duyệt.
  for (const el of document.querySelectorAll("select, input[type=color]")) if (vis(el)) push("native", "còn " + (el.tagName === "SELECT" ? "<select>" : "<input type=color>") + " gốc: " + name(el));

  // 2. Bo viên thuốc trên phần tử có chữ nhiều dòng.
  const lineTops = (el, lh) => { const tops = []; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const rg = document.createRange(); let n = 0;
    for (let t; (t = tw.nextNode()) && n < 60;) { if (!t.nodeValue.trim()) continue; n++; rg.selectNodeContents(t); for (const f of rg.getClientRects()) { if (f.width < 1) continue; if (!tops.some((y) => Math.abs(y - f.top) < lh * 0.6)) tops.push(f.top); if (tops.length > 1) return 2; } }
    return tops.length; };
  for (const el of all) {
    const cs = gcs(el); if (!/px|%/.test(cs.borderTopLeftRadius + cs.borderBottomRightRadius) || cs.borderTopLeftRadius === "0px" && cs.borderBottomRightRadius === "0px") continue;
    if (!vis(el)) continue;
    const b = el.getBoundingClientRect(), rad = radius(cs, b), eff = Math.min(rad, b.height / 2, b.width / 2);
    if (eff <= Math.max(12, 0.375 * b.height) || !painted(cs)) continue;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const multi = el.tagName === "TEXTAREA" || el.isContentEditable ? el.clientHeight > lh * 1.6 : el.tagName !== "INPUT" && lineTops(el, lh) > 1;
    if (multi) push("pill", "bo viên thuốc trên phần tử nhiều dòng (cao " + Math.round(b.height) + "px, bo " + Math.round(eff) + "px): " + name(el));
  }

  // 3. Thanh cuộn thừa: tràn lẻ, overflow:scroll, dải thấp không ẩn thanh cuộn.
  for (const el of [document.scrollingElement, ...all]) {
    const cs = gcs(el), sx = /(auto|scroll)/.test(cs.overflowX), sy = /(auto|scroll)/.test(cs.overflowY);
    if (!sx && !sy || el.tagName === "INPUT" || cs.scrollbarWidth === "none") continue;
    if (el !== document.scrollingElement && !vis(el)) continue;
    const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
    if (sy && dy > 0 && dy < 12) push("tiny", "khung cuộn dọc chỉ tràn " + dy + "px mà còn thanh cuộn (Windows hiện mũi tên vô ích): " + name(el));
    else if (sx && dx > 0 && dx < 12) push("tiny", "khung cuộn ngang chỉ tràn " + dx + "px mà còn thanh cuộn (Windows hiện mũi tên vô ích): " + name(el));
    else if (/scroll/.test(cs.overflowX + cs.overflowY)) push("tiny", "overflow:scroll luôn hiện thanh cuộn kể cả khi không tràn: " + name(el));
    else if (el.clientHeight < 48 && el.tagName !== "TEXTAREA" && el !== document.scrollingElement) push("strip", "dải thấp " + el.clientHeight + "px cuộn được mà không ẩn thanh cuộn (scrollbar-width " + cs.scrollbarWidth + "): " + name(el));
  }

  // 4. Chữ bị khung overflow:hidden cắt ngang, không có dấu …, line-clamp hay lớp mờ.
  { const seen = new Set(), rg = document.createRange(), tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n = 0;
    for (let t; (t = tw.nextNode()) && n < 5000;) {
      const p = t.parentElement; if (!t.nodeValue.trim() || !p || seen.has(p)) continue; n++;
      if (p.closest("svg,script,style,textarea,input,select,pre,code,iframe,.cm-editor,.katex,[aria-hidden=true],[inert],.sr-only,.skip-link,noscript") || !vis(p)) continue;
      rg.selectNodeContents(t);
      for (const f of rg.getClientRects()) {
        if (f.width < 2 || f.bottom < 0 || f.top > H) continue;
        let a = p, soft = false;
        for (; a && a !== document.body; a = a.parentElement) {
          const cs = gcs(a);
          if (cs.textOverflow === "ellipsis" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none") || cs.maskImage !== "none" || cs.webkitMaskImage && cs.webkitMaskImage !== "none") soft = true;
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") break;
          if (cs.position === "fixed") { a = null; break; }
        }
        if (!a || a === document.body || soft) continue;
        const cs = gcs(a), q = a.getBoundingClientRect(), L = q.left + a.clientLeft, R = L + a.clientWidth, T = q.top + a.clientTop, Bt = T + a.clientHeight;
        const hx = /(hidden|clip)/.test(cs.overflowX), hy = /(hidden|clip)/.test(cs.overflowY);
        const cx = hx && ((f.right > R + 1 && f.left < R - 2) || (f.left < L - 1 && f.right > L + 2));
        const cy = hy && ((f.bottom > Bt + 3 && f.top < Bt - 3) || (f.top < T - 3 && f.bottom > T + 3));
        if (cx || cy) { seen.add(p); push("clip", "chữ bị cắt " + (cx ? "ngang " + Math.round(Math.max(f.right - R, L - f.left)) : "dọc " + Math.round(Math.max(f.bottom - Bt, T - f.top))) + "px, không có …: " + name(p) + " trong " + name(a).replace(/ “.*$/, "")); break; }
      }
    } }

  // 5. Dải cuộn ngang: mục cắt ở mép không có lớp mờ, mục đầu / cuối bị cắt khi cuộn hết cỡ, mục đang chọn khuất.
  const fadeOf = (el) => { for (const e of [el, el.parentElement]) { if (!e) continue; const cs = gcs(e); if (cs.maskImage !== "none" || (cs.webkitMaskImage && cs.webkitMaskImage !== "none")) return true; for (const pe of ["::before", "::after"]) { const ps = getComputedStyle(e, pe); if (ps.content !== "none" && /gradient/.test(ps.backgroundImage) && /(absolute|sticky|fixed)/.test(ps.position)) return true; } } return false; };
  for (const el of all) {
    const cs = gcs(el); if (!/(auto|scroll)/.test(cs.overflowX) || el.tagName === "TEXTAREA" || el.scrollWidth <= el.clientWidth + 1 || !vis(el)) continue;
    if (el.clientHeight > 160 || el.querySelector(":scope > table, :scope > pre") || el.closest("pre,.mdx table,.art-code")) continue;
    const kids = [...el.children].filter((k) => { const s = gcs(k); return !/(absolute|fixed)/.test(s.position) && s.display !== "none" && k.getBoundingClientRect().width > 0; });
    if (kids.length < 2) continue;
    const b = el.getBoundingClientRect(), L = b.left + el.clientLeft, R = L + el.clientWidth, s0 = el.scrollLeft, max = el.scrollWidth - el.clientWidth, fade = fadeOf(el);
    const rects = () => kids.map((k) => k.getBoundingClientRect());
    let rs = rects();
    if (!fade && s0 < max - 1 && rs.some((r) => r.left < R - 2 && r.right > R + 1)) push("strip-cut", "dải cuộn ngang cắt ngang mục ở mép phải mà không có lớp mờ: " + name(el).replace(/ “.*$/, ""));
    if (!fade && s0 > 1 && rs.some((r) => r.left < L - 1 && r.right > L + 2)) push("strip-cut", "dải cuộn ngang cắt ngang mục ở mép trái mà không có lớp mờ: " + name(el).replace(/ “.*$/, ""));
    const act = kids.findIndex((k) => k.matches("[aria-selected=true],[aria-pressed=true],[aria-current=page],[aria-current=true],[aria-checked=true],.on,.active"));
    if (act >= 0 && (rs[act].left < L - 1 || rs[act].right > R + 1)) push("strip-cut", "mục đang chọn nằm khuất trong dải cuộn ngang: " + name(kids[act]) + " trong " + name(el).replace(/ “.*$/, ""));
    el.scrollTo({ left: 0, behavior: "instant" }); rs = rects();
    if (Math.min(...rs.map((r) => r.left)) < L - 0.5) push("strip-cut", "mục đầu bị cắt khi cuộn về đầu: " + name(el).replace(/ “.*$/, ""));
    el.scrollTo({ left: max, behavior: "instant" }); rs = rects();
    if (Math.max(...rs.map((r) => r.right)) > R + 0.5) push("strip-cut", "mục cuối bị cắt khi cuộn hết: " + name(el).replace(/ “.*$/, ""));
    el.scrollTo({ left: s0, behavior: "instant" });
  }

  // 7. Chữ gợi ý bắt đầu trong góc bo của ô nhập (bị góc bo cắt, hay cách đường cong dưới 2px).
  for (const inp of document.querySelectorAll("input[placeholder]:not([type=checkbox]):not([type=radio]):not([type=range]), textarea[placeholder]")) {
    if (!inp.placeholder || inp.value || !vis(inp)) continue;
    const cs = gcs(inp), b = inp.getBoundingClientRect(), r = Math.min(radius(cs, b), b.height / 2, b.width / 2); if (r < 4) continue;
    const fs = parseFloat(cs.fontSize), x = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const lh = parseFloat(cs.lineHeight) || fs * 1.3;
    const y = inp.tagName === "TEXTAREA" ? parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) + Math.max(0, (lh - fs) / 2) : b.height / 2 - fs * 0.55;
    if (x < r && y < r && Math.hypot(r - x, r - y) > r - 2) push("ph", "chữ gợi ý nằm trong góc bo (bo " + Math.round(r) + "px, chữ cách mép " + Math.round(x) + "px/" + Math.round(y) + "px): " + name(inp) + " “" + inp.placeholder.slice(0, 30) + "”");
  }
  for (const [k, n] of Object.entries(count)) if (n > CAP) out.push("… còn " + (n - CAP) + " lỗi loại " + k);
  return out;
}

// 6. Bố cục tự thay đổi khi không ai chạm vào: lấy mẫu vị trí / cỡ (offset*, không tính transform của hoạt ảnh) và vị trí cuộn.
async function STAB(total, n) {
  const skipSel = "svg,canvas,video,iframe,.cm-editor,[aria-busy=true],.ai-streaming,[role=progressbar],[role=timer],.art-spin,[inert]";
  const inf = new Set(); for (const a of document.getAnimations()) if (a.playState === "running" && a.effect?.getTiming?.().iterations === Infinity && a.effect.target) inf.add(a.effect.target);
  const els = [...document.querySelectorAll("body *")].filter((el) => el instanceof HTMLElement && !el.closest(skipSel) && el.checkVisibility?.()).slice(0, 5000)
    .filter((el) => { for (let p = el; p; p = p.parentElement) if (inf.has(p)) return false; return true; });
  const sc = [document.scrollingElement, ...els.filter((el) => /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowY + getComputedStyle(el).overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1))];
  const lay = () => els.map((el) => el.isConnected ? [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight] : null);
  const scr = () => sc.map((el) => [el.scrollLeft, el.scrollTop]);
  const L = [lay()], S = [scr()];
  for (let i = 1; i < n; i++) { await new Promise((r) => setTimeout(r, total / (n - 1))); L.push(lay()); S.push(scr()); }
  const name = (el) => { const c = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""; return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (c ? "." + c : ""); };
  const res = [];
  els.forEach((el, j) => { let k = 0, d = 0; for (let i = 1; i < n; i++) { const a = L[i - 1][j], b = L[i][j]; if (!a || !b) { k = -99; break; } const m = Math.max(...a.map((v, x) => Math.abs(v - b[x]))); if (m > 0.5) { k++; d = Math.max(d, m); } } if (k >= 2 || (k === 1 && d >= 16)) res.push([k, d, name(el)]); });
  const out = [];
  // Chỉ báo phần tử ngoài cùng (con của phần tử đã đổi cũng đổi theo cỡ, không cần báo lại).
  const top = res.sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, 4);
  for (const [k, d, nm] of top) out.push(k >= 2 ? `bố cục đổi liên tục khi không ai chạm (${k}/${n - 1} lần trong ${total / 1000}s, tới ${Math.round(d)}px): ${nm}` : `bố cục tự nhảy ${Math.round(d)}px khi không ai chạm: ${nm}`);
  sc.forEach((el, j) => { const moves = S.slice(1).filter((s, i) => Math.abs(s[j][0] - S[i][j][0]) + Math.abs(s[j][1] - S[i][j][1]) > 0.5).length; if (moves) out.push(`tự cuộn ${moves} lần khi không ai chạm (${S[0][j][1]}→${S[n - 1][j][1]}px): ${el === document.scrollingElement ? "trang" : name(el)}`); });
  return out;
}

// ───────────────────────────── chạy
const problems = [], allowed = [];
const note = (where, what) => { const s = `${where}: ${what}`; const a = ALLOW.find((x) => x.re.test(s)); if (a) allowed.push(`${s}  — được phép: ${a.why}`); else problems.push(s); };
let states = 0;

for (const theme of THEMES) for (const size of SIZES) {
  const tag = `${theme}-${size}`, mobile = size === "mobile", tablet = size === "tablet", en = LANG[theme] === "en";
  console.log(`\n━━ ${tag} (${en ? "tiếng Anh" : "tiếng Việt"})`);
  rmSync(PROF, { recursive: true, force: true });
  const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0, fakeProfile = false; const waits = new Map(), inflight = new Map(), errs = [];
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; const tm = setTimeout(() => { waits.delete(id); no(new Error("Chrome không trả lời: " + method)); }, 90_000); waits.set(id, [(v) => { clearTimeout(tm); ok(v); }, (e) => { clearTimeout(tm); no(e); }]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push("JS: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0].slice(0, 200));
    if (m.method === "Network.requestWillBeSent" && !["EventSource", "WebSocket", "Ping"].includes(m.params.type)) inflight.set(m.params.requestId, Date.now());
    if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") inflight.delete(m.params.requestId);
    // Màn Giới thiệu về bạn: đổi needsProfile thành true trong HTML trang chủ và /api/auth/me (như tests/ui/authfit.mjs).
    if (m.method === "Fetch.requestPaused") {
      const { requestId } = m.params;
      try {
        if (!fakeProfile) throw 0;
        const { body, base64Encoded } = await send("Fetch.getResponseBody", { requestId }, m.sessionId);
        const txt = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
        if (m.params.resourceType === "Document") {
          const headers = (m.params.responseHeaders ?? []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
          await send("Fetch.fulfillRequest", { requestId, responseCode: m.params.responseStatusCode ?? 200, responseHeaders: headers, body: Buffer.from(txt.replace(/needsProfile(\\*)":false/g, 'needsProfile$1":true')).toString("base64") }, m.sessionId);
        } else { const j = JSON.parse(txt); if (j.user) j.user.needsProfile = true; await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(j)).toString("base64") }, m.sessionId); }
      } catch { send("Fetch.continueRequest", { requestId }, m.sessionId).catch(() => {}); }
    }
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Emulation.setDeviceMetricsOverride", VIEW[size]);
  if (mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); localStorage.setItem("p:uilang", ${JSON.stringify(JSON.stringify(LANG[theme]))}); } catch {}` });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const busyNet = () => [...inflight.values()].some((t) => Date.now() - t < 15_000);
  const READY = `(() => { const a = document.getAnimations().filter((x) => x.playState === "running" && x.effect?.getTiming?.().iterations !== Infinity).length;
    return [document.readyState, document.fonts.status, a, document.querySelectorAll("*").length, document.documentElement.scrollHeight, document.body?.innerText.length ?? 0]; })()`;
  const ready = async (quiet = 400, max = 15_000) => {
    const end = Date.now() + max;
    await waitFor(async () => !busyNet() && (await ev(`document.readyState === "complete" && document.fonts.status === "loaded"`)), max, { every: 100 });
    await settle(async () => { const v = await ev(READY); return busyNet() || v[2] ? Math.random() : v; }, quiet, Math.max(500, end - Date.now()));
  };
  const until = async (expr, ms = 30000, what = expr) => { if (!(await waitFor(() => ev(expr), ms, { every: 200 }))) throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center", behavior: "instant" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("không thấy: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  // Chuột rời khỏi phần tử vừa bấm (trạng thái rê chuột không phải trạng thái nghỉ của trang).
  const park = () => P("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: VIEW[size].height - 2 });
  const byText = (sel, re) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${re}.test(e.textContent.trim()))`;
  const key = (k, code, vk, mods = 0) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }));
  const esc = async () => { await key("Escape", "Escape", 27); await sleep(350); };
  let step = 0;
  const check = async (name) => {
    states++;
    const where = `${tag}/${name}`;
    await park();
    for (const e of errs.splice(0)) note(where, e);
    // Đo độ đứng yên trước (2 giây), rồi mới đo phần còn lại: bước 5 cuộn thử các dải ngang rồi trả lại chỗ cũ.
    for (const p of await ev(`(${STAB})(2000, 6)`).catch((e) => ["không đo được độ đứng yên: " + e.message.split("\n")[0]])) note(where, p);
    for (const p of await ev(`(${POLISH})()`).catch((e) => ["không đo được: " + e.message.split("\n")[0]])) note(where, p);
    const { data } = await P("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}${tag}-${String(++step).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64"));
    console.log("  ·", name);
  };
  const want = (name) => !ONLY.length || ONLY.some((o) => name.includes(o));
  const step0 = async (name, fn) => { if (!want(name)) return; try { await fn(); } catch (e) { note(`${tag}/${name}`, "không chạy được bước: " + e.message.split("\n")[0]); await check(name + "-fail").catch(() => {}); } };
  const side = async () => {
    if (mobile && (await ev(`!!document.querySelector(".art-panel")`))) { await click(`document.querySelector(".art-panel [aria-label='Đóng'], .art-panel [aria-label='Close']")`, "close art").catch(() => {}); await sleep(400); }
    if (tablet) return;
    if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên'], [aria-label='Open sidebar']")`, "burger").catch(() => {}); await sleep(500); }
  };
  const go = async (v) => { await side(); await click(`document.querySelector('[data-nav="${v}"]')`, v); await ready(); };
  // Các tab của trang đang mở (không phải thanh bên): bấm lần lượt, đo từng tab.
  const tabs = async (label, sel = "main [role=tablist] [role=tab], .main [role=tablist] [role=tab]", max = 8) => {
    const n = Math.min(max, await ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((t) => t.checkVisibility()).length`));
    for (let i = 1; i < n; i++) {
      await click(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((t) => t.checkVisibility())[${i}]`, `${label} tab ${i}`); await ready();
      await check(`${label}-tab${i}`);
    }
  };
  const home = async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 60000, "app"); await ready(); };

  // ── Trang công khai và màn Giới thiệu về bạn (chưa đăng nhập / tài khoản mới).
  await step0("dang-nhap", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("input[type=email]")`, 30000, "login"); await ready(); await check("dang-nhap"); });
  for (const [p, n] of [["/terms", "dieu-khoan"], ["/privacy", "quyen-rieng-tu"], ["/reset", "dat-lai-mk"], ["/download", "tai-ung-dung"], ["/khong-co-trang-nay", "khong-tim-thay"]])
    await step0(n, async () => { await P("Page.navigate", { url: B + p }); await ready(); await check(n); });
  if (ONB) await step0("gioi-thieu", async () => {
    fakeProfile = true;
    await P("Network.setCookie", { name: "synchro_session", value: ONB.split("=")[1], url: B });
    await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/me*", requestStage: "Response" }, { urlPattern: B + "/", resourceType: "Document", requestStage: "Response" }] });
    // Cửa sổ thấp (máy tính Windows phóng to 125%) là nơi màn này từng cuộn tới lui.
    const sizes = mobile ? [[390, 640, 2]] : tablet ? [[768, 600, 1]] : [[1440, 900, 1], [1100, 560, 1.25], [800, 470, 1.25]];
    for (const [w, h, d] of sizes) {
      await P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: d, mobile });
      await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("input[autocomplete=bday]")`, 30000, "onboarding"); await ready(600);
      await check(`gioi-thieu-${w}x${h}`);
      await click(`document.querySelector(".auth-root input[type=text], .auth-root input:not([type])")`, "name").catch(() => {}); await P("Input.insertText", { text: "Nguyễn Văn Thử" }); await ready();
      await check(`gioi-thieu-${w}x${h}-da-nhap`);
    }
    await P("Fetch.disable"); fakeProfile = false;
    await P("Emulation.setDeviceMetricsOverride", VIEW[size]);
  });
  await P("Network.clearBrowserCookies");
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

  // ── Trang chủ, menu, bảng lệnh, đoạn chat có artifact.
  await step0("trang-chu", async () => { await home(); await check("trang-chu"); });
  await step0("menu-model", async () => { await click(`document.querySelector(".model-btn")`, "model"); await ready(); await check("menu-model"); await esc(); });
  await step0("muc-dung", async () => { await click(`document.querySelector(".us-ring")`, "usage"); await ready(); await check("muc-dung"); await esc(); });
  await step0("bang-lenh", async () => { await key("k", "KeyK", 75, 4); await ready(); await check("bang-lenh"); await esc(); });
  await step0("menu-nguoi-dung", async () => { await side(); await click(`document.querySelector(".rail .user")`, "user"); await ready(); await check("menu-nguoi-dung"); await esc(); });
  await step0("chat-artifact", async () => {
    await ev(`(async () => { const me = await (await fetch("/api/auth/me")).json(), m = await (await fetch("/api/models")).json(), k = m.providers.flatMap((p) => p.models).find((x) => !x.key.startsWith("sub-"))?.key; if (k) localStorage.setItem("u:" + me.user.id + ":model", k); })()`);
    await home();
    await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" }); await key("Enter", "Enter", 13);
    await sleep(800);
    await until(`!document.querySelector(".thinking") && !document.querySelector(".art-card.busy") && !document.querySelector(".msg-stop, .stop-btn, [aria-label='Dừng'], [aria-label='Stop']")`, 90000, "reply");
    await ready(600); await check("chat-artifact");
  });

  // ── Các trang trên thanh điều hướng và các tab của từng trang.
  await step0("artifacts", async () => { await go("artifacts"); await check("artifacts"); await tabs("artifacts"); });
  await step0("du-an", async () => {
    await go("projects"); await check("du-an");
    await click(byText(".main button, main button", /^(Dự án mới|New project)/), "new project"); await ready(); await check("du-an-moi"); await esc();
  });
  await step0("hop-thu", async () => {
    await go("inbox"); await check("hop-thu"); await tabs("hop-thu");
    await click(byText("button", /^(Tự đặt|Set up manually)/), "manual task"); await until(`!!document.querySelector(".modal textarea")`, 8000, "task editor"); await ready();
    await check("viec-tu-dong-moi");
    // Ô chọn của hộp thoại (Dropdown thay <select>): danh sách mở ra cũng được đo.
    if (await ev(`!!document.querySelector(".modal .dd")`)) { await click(`document.querySelector(".modal .dd")`, "dropdown"); await ready(); await check("viec-tu-dong-o-chon"); await esc(); }
    await esc();
  });
  await step0("bo-nao", async () => {
    await go("brain"); await check("bo-nao");
    await click(byText(".bw-main button, .bw button, header button", /^(Đồ thị|Graph)$/), "graph tab").catch(() => {}); await ready();
    if (await ev(`!!document.querySelector(".bw-gear")`)) {
      await click(`document.querySelector(".bw-gear")`, "gear"); await ready();
      for (let i = 0; i < 4; i++) await click(`[...document.querySelectorAll(".bg-panel .bg-h[aria-expanded=false]")][0]`, "section").catch(() => {});
      if (!(await ev(`!!document.querySelector(".bg-panel .cp-sw, .bg-panel .bg-grp button")`))) await click(byText(".bg-panel button", /^(Nhóm mới|New group)/), "new group").catch(() => {});
      await ready(); await check("bo-nao-do-thi");
      if (await ev(`!!document.querySelector(".bg-panel .bg-grp button")`)) { await click(`document.querySelector(".bg-panel .bg-grp button")`, "color"); await ready(); await check("bo-nao-chon-mau"); await esc(); }
      await esc();
    }
  });
  await step0("code", async () => {
    await go("code"); await check("code");
    if (await ev(`!!document.querySelector(".cv-tb")`)) {
      await click(`[...document.querySelectorAll(".cv-tb")].pop()`, "more"); await ready(); await check("code-menu");
      await click(byText(".menu .menu-item", /Luật dự án|Project rules/), "rules").catch(() => {}); await ready(); await check("code-luat-du-an"); await esc(); await esc();
    }
  });
  await step0("speech", async () => {
    await go("speech"); await check("speech");
    const tools = await ev(`[...document.querySelectorAll('[data-nav^="sp-"]')].map((b) => b.dataset.nav).filter((k) => k !== "sp-home")`);
    for (const t of tools) {
      try {
        await side(); await click(`document.querySelector('[data-nav="${t}"]')`, t); await ready(600);
        await check(t);
        // Ô chọn đầu tiên mở ra (danh sách của Dropdown), ô màu (Audio Native).
        if (t === "sp-tts" && (await ev(`!!document.querySelector(".main .dd, main .dd")`))) { await click(`document.querySelector(".main .dd, main .dd")`, "dd"); await ready(); await check(t + "-o-chon"); await esc(); }
        if (await ev(`!!document.querySelector(".cp-sw")`)) { await click(`document.querySelector(".cp-sw")`, "color"); await ready(); await check(t + "-chon-mau"); await esc(); }
      } catch (e) { note(`${tag}/${t}`, "không chạy được bước: " + e.message.split("\n")[0]); }
    }
  });
  await step0("skill", async () => {
    await go("customize"); await until(`!!document.querySelector(".pl-row2, .pl-dcard, .hub-yours")`, 15000, "hub").catch(() => {}); await ready(); await check("skill");
    await tabs("skill", ".hub-seg button, .main [role=tablist] [role=tab]");
    await go("customize");
    if (await ev(`!!document.querySelector(".hub-yours .pl-row2")`)) { await click(`document.querySelector(".hub-yours .pl-row2")`, "library"); await ready(); await check("skill-thu-vien"); await esc(); }
    if (await ev(`!!document.querySelector(".pl-scan")`)) { await click(`document.querySelector(".pl-scan")`, "scan"); await until(`!!document.querySelector(".scan-modal .modal-foot")`, 15000, "scan").catch(() => {}); await ready(); await check("skill-quet"); await esc(); }
  });
  await step0("cai-dat", async () => {
    await side(); await click(`document.querySelector(".rail .user")`, "user"); await ready();
    await click(byText(".menu-item", /^(Cài đặt|Settings)/), "settings"); await until(`!!document.querySelector(".modal.settings .s-item")`, 15000, "settings"); await ready();
    const n = await ev(`document.querySelectorAll(".modal.settings .s-item").length`);
    for (let i = 0; i < n; i++) {
      await click(`document.querySelectorAll(".modal.settings .s-item")[${i}]`, "tab " + i); await ready();
      const label = "cai-dat-" + String(await ev(`document.querySelectorAll(".modal.settings .s-item")[${i}].getAttribute("title") || document.querySelectorAll(".modal.settings .s-item")[${i}].textContent`)).trim().toLowerCase().replace(/\s+/g, "-");
      await check(label);
      for (let k = 1; k <= 6; k++) {
        const more = await ev(`(() => { const b = [...document.querySelectorAll(".modal.settings .s-body, .modal.settings .s-body *")].find((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (!b || b.scrollTop + b.clientHeight >= b.scrollHeight - 4) return false; b.scrollTo({ top: b.scrollTop + b.clientHeight * 0.85, behavior: "instant" }); return true; })()`);
        if (!more) break;
        await ready(); await check(label + "-" + k);
      }
    }
    await esc();
  });
  if (mobile || tablet) await step0("thanh-ben", async () => {
    await home();
    if (mobile) await side(); else if (await ev(`!!document.querySelector(".shell-side.closed")`)) { await click(`document.querySelector(".rail-mark")`, "panel"); }
    await ready(); await check("thanh-ben"); await esc();
  });

  ws.close();
  await new Promise((ok) => { if (chrome.exitCode !== null) return ok(); chrome.once("exit", ok); chrome.kill(); setTimeout(() => { chrome.kill("SIGKILL"); ok(); }, 5000); });
  for (let i = 0; i < 25 && (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true).catch(() => false)); i++) await sleep(200);
}

// Cùng một lỗi ở nhiều cỡ / giao diện: gộp lại, ghi các nơi gặp.
const group = (list) => { const m = new Map(); for (const p of list) { const i = p.indexOf(": "), where = p.slice(0, i), what = p.slice(i + 2); if (!m.has(what)) m.set(what, []); m.get(what).push(where); } return m; };
if (allowed.length) { console.log(`\n── Được phép (${allowed.length})`); for (const a of allowed) console.log(" -", a); }
console.log(`\n${states} trạng thái đã đo.`);
console.log(`━━ Vấn đề (${problems.length})`);
for (const [what, where] of group(problems)) console.log(` - ${what}\n     ở ${where.slice(0, 6).join(", ")}${where.length > 6 ? ` và ${where.length - 6} nơi khác` : ""}`);
console.log(`\nẢnh chụp: ${OUT}`);
process.exitCode = problems.length ? 1 : 0;
