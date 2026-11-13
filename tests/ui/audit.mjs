// Soát lỗi giao diện toàn trang bằng Chrome ẩn trên npm run dev:mock. Chạy tay: node tests/ui/audit.mjs [light|dark] [desktop|tablet|mobile]
// Đi qua mọi màn hình (chat, artifact, các trang, cài đặt, menu, trang đăng nhập…) ở chế độ sáng / tối, ba chiều rộng của blueprint B1.14:
// máy tính 1440px, máy tính bảng 768px (thanh đoạn chat là bảng nổi, mặc định đóng — U3), điện thoại 390px;
// tự bắt lỗi JavaScript, phần tử tràn khỏi màn hình, chữ bị cắt không có dấu …, ảnh hỏng, phông chữ chưa tải, chữ tiếng Anh sót;
// chụp ảnh từng màn hình vào <tmp>/synchro-ui/audit/ để xem bằng mắt.
import { settle, waitFor } from "../lib/wait.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = process.env.BASE ?? "http://localhost:3200";
const OUT = process.env.AUDIT_OUT ?? (await import("node:os")).tmpdir() + "/synchro-ui/audit/";
mkdirSync(OUT, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-audit";
const THEMES = process.argv[2] ? [process.argv[2]] : ["light", "dark"];
const SIZES = process.argv[3] ? [process.argv[3]] : ["desktop", "tablet", "mobile"];
// Khung nhìn từng cỡ: 1440 / 768 / 390px (B1.14). Máy tính bảng không giả lập cảm ứng: đúng khoảng 761–860px của máy tính có cửa sổ hẹp.
const VIEW = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, tablet: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }

// Mã đặt lại mật khẩu thật (tài khoản dùng một lần, thư giả lập ở data-mock/mail) để soát ô đặt mật khẩu mới; bản chia sẻ thật để soát trang công khai.
let RESET_TOKEN = "", SHARE_TOKEN = "";
try {
  const fs = await import("node:fs"), path = await import("node:path"), who = `audit-${Date.now()}@synchro.test`, H = { "content-type": "application/json", origin: B };
  await fetch(B + "/api/auth/signup", { method: "POST", headers: H, body: JSON.stringify({ email: who, password: "Audit-pass-123", profile: { fullName: "Audit", birthDate: "2000-01-01" } }) });
  await fetch(B + "/api/auth/forgot", { method: "POST", headers: H, body: JSON.stringify({ email: who, lang: "vi" }) });
  await new Promise((r) => setTimeout(r, 600));
  const dir = path.resolve("data-mock/mail");
  for (const f of fs.readdirSync(dir)) { let m; try { m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; } if (m.to === who) { RESET_TOKEN ||= /reset#([\w-]+)/.exec(m.text ?? "")?.[1] ?? ""; fs.rmSync(path.join(dir, f)); } }
  const sh = await fetch(B + "/api/share", { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ conv: `audit-${Date.now()}`, title: "Bản chia sẻ để soát giao diện", msgs: [{ role: "user", text: "Tóm tắt giúp mình" }, { role: "ai", text: "## Tóm tắt\n\nĐây là **bản chia sẻ** để soát giao diện.\n\n- Một\n- Hai\n\n| Cột | Giá trị |\n|---|---|\n| A | 1 |" }] }) });
  SHARE_TOKEN = (await sh.json().catch(() => ({})))?.share?.token ?? "";
} catch (e) { console.error("không chuẩn bị được trang lẻ", e); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (where, what) => { problems.push(`${where}: ${what}`); };
// Một tác vụ chặn giao diện lâu hơn mức này là người dùng thấy khựng rõ rệt.
const LAG = 250;

// Kiểm tra trong trang: tràn ngang, chữ bị cắt cụt, ảnh hỏng, phông chữ, chữ tiếng Anh sót (giao diện tiếng Việt).
const CHECK = `(() => {
  const out = [], W = innerWidth, H = innerHeight;
  // checkVisibility: chữ trong <details> đang đóng vẫn có khung (Chrome chỉ ẩn bằng content-visibility), không được tính là đang hiện.
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05 && (!el.checkVisibility || el.checkVisibility()); };
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(cs.overflowX)) { const r = p.getBoundingClientRect(); if (r.right <= W + 1) return true; } if (cs.position === "fixed") break; } return false; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  if (document.scrollingElement.scrollWidth > W + 1) out.push("trang tràn ngang " + (document.scrollingElement.scrollWidth - W) + "px");
  let n = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (n > 12) break;
    if (el.closest("svg,canvas,iframe,[aria-hidden=true],.vm-wave")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > H || r.left >= W || r.right <= 0 || !vis(el)) continue;
    if (r.right > W + 2 && !clipped(el)) { out.push("tràn khỏi mép phải " + Math.round(r.right - W) + "px: " + name(el)); n++; continue; }
    if (r.left < -2 && r.right > 8 && !clipped(el) && !el.closest(".sidebar.closed") && getComputedStyle(el).position !== "sticky") { out.push("tràn khỏi mép trái " + Math.round(-r.left) + "px: " + name(el)); n++; continue; }
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (own && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis" && !el.closest("pre,code,.art-code,textarea,.sr-only,.skip-link")) { out.push("chữ bị cắt (không có …): " + name(el) + " “" + el.textContent.trim().slice(0, 40) + "”"); n++; }
  }
  // Chữ đè lên chữ: hai đoạn chữ (không lồng nhau) chồng lên nhau mà giữa chúng không có lớp che (nền đặc, kính mờ). Ví dụ thẻ chế độ
  // nằm trên danh sách việc của chat mà chữ phía sau vẫn sắc nét.
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c === "transparent" ? 0 : 1; const p = m[1].split(/[,\s/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; };
  const covers = (el) => { for (const pe of [null, "::before", "::after"]) { const cs = getComputedStyle(el, pe); if (pe && cs.content === "none") continue; if (alpha(cs.backgroundColor) >= 0.85 || (cs.backdropFilter && cs.backdropFilter !== "none") || (cs.backgroundImage !== "none" && !pe && alpha(cs.backgroundColor) > 0.5)) return true; } return false; };
  // Phần nhìn thấy được của một hình chữ nhật: cắt theo mọi khung tổ tiên có overflow khác visible (khung cuộn, chữ có dấu …), tới
  // tổ tiên stop (không tính). Chữ đã cuộn khuất hay bị dấu … che thì không tính là đè hay sát mép.
  const clip = (el, r, stop) => {
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let a = el; a && a !== document.documentElement && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") { const q = a.getBoundingClientRect(); if (cs.overflowX !== "visible") { x0 = Math.max(x0, q.left); x1 = Math.min(x1, q.right); } if (cs.overflowY !== "visible") { y0 = Math.max(y0, q.top); y1 = Math.min(y1, q.bottom); } }
      if (cs.position === "fixed") break;
    }
    return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 } : null;
  };
  const boxes = [];
  { const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
    while (tw.nextNode() && boxes.length < 3000) {
      const t = tw.currentNode, p = t.parentElement;
      if (!t.nodeValue.trim() || !p || p.closest("svg,script,style,textarea,[aria-hidden=true],.sr-only,.cm-editor,iframe") || !vis(p)) continue;
      rg.selectNodeContents(t);
      // Từng dòng của đoạn chữ (chữ xuống dòng có khung bao phủ cả hai dòng, không dùng khung bao đó).
      for (const f of rg.getClientRects()) {
        const r = clip(p, f);
        if (!r || r.width < 4 || r.height < 6 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
        boxes.push({ p, r, t: t.nodeValue.trim() });
      }
    } }
  let over = 0;
  for (let i = 0; i < boxes.length && over < 6; i++) for (let j = i + 1; j < boxes.length && over < 6; j++) {
    const A = boxes[i], Bx = boxes[j];
    if (A.p === Bx.p || A.p.contains(Bx.p) || Bx.p.contains(A.p)) continue;
    // Phần nền của hộp thoại (inert): trình duyệt bỏ qua khi dò theo điểm, nên không xác định được lớp nào che lớp nào; người dùng cũng không tương tác với nó.
    if (A.p.closest("[inert]") || Bx.p.closest("[inert]")) continue;
    const ix = Math.min(A.r.right, Bx.r.right) - Math.max(A.r.left, Bx.r.left), iy = Math.min(A.r.bottom, Bx.r.bottom) - Math.max(A.r.top, Bx.r.top);
    if (ix <= 2 || iy <= 3) continue;
    const small = Math.min(A.r.width * A.r.height, Bx.r.width * Bx.r.height);
    if (ix * iy < small * 0.25) continue;
    const cx = Math.max(A.r.left, Bx.r.left) + ix / 2, cy = Math.max(A.r.top, Bx.r.top) + iy / 2;
    const stack = document.elementsFromPoint(cx, cy);
    const ia = stack.findIndex((e) => e === A.p || A.p.contains(e) || e.contains(A.p)), ib = stack.findIndex((e) => e === Bx.p || Bx.p.contains(e) || e.contains(Bx.p));
    const top = ia >= 0 && (ib < 0 || ia <= ib) ? A : Bx, low = top === A ? Bx : A;
    // Lớp che: tổ tiên của chữ ở trên (không chứa chữ ở dưới) có nền đặc / kính mờ, hoặc phần tử nằm giữa trong ngăn xếp.
    let hid = false;
    for (let e = top.p; e && e !== document.body && !e.contains(low.p); e = e.parentElement) if (covers(e)) { hid = true; break; }
    if (!hid) { const a = stack.indexOf(top.p), b = stack.findIndex((e) => e === low.p || e.contains(low.p)); if (a >= 0 && b > a) for (const e of stack.slice(a + 1, b)) if (!e.contains(low.p) && covers(e)) { hid = true; break; } }
    if (hid) continue;
    over++; out.push("chữ đè lên chữ: “" + top.t.slice(0, 30) + "” trên “" + low.t.slice(0, 30) + "” (" + name(top.p) + " / " + name(low.p) + ")");
  }
  // Khung nổi, thẻ, hộp thoại: chữ cách mép trái / phải ít nhất 8px, không phần tử nào tràn ra ngoài khung (trừ khung cuộn).
  let edge = 0;
  for (const c of document.querySelectorAll(".menu,.model-menu,.usermenu,.model-sub,.modal,.toast,.us-card,.us-vc,.api-card:not(.bare),.cn-card,.cn-row,.dcard,.promo,.adm-card,.pj-card,.art-card,.wl-plan,.plan-card,.sy-settings .s-body .row")) {
    if (edge > 8 || !vis(c)) continue;
    const r = c.getBoundingClientRect(); if (r.width < 60 || r.height < 24 || r.bottom < 0 || r.top > H) continue;
    const cs = getComputedStyle(c), sc = /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
    for (const k of c.querySelectorAll("*")) {
      if (!vis(k) || k.closest("svg")) continue;
      // Khung nổi lồng bên trong (menu ⋯ của một thẻ…) tự được kiểm riêng.
      const nest = k.parentElement && k.parentElement.closest(".menu,.model-menu,.usermenu,.modal,.toast");
      if (nest && nest !== c && c.contains(nest)) continue;
      const q0 = k.getBoundingClientRect(); if (!q0.width || !q0.height) continue;
      const q = k.parentElement === c ? q0 : clip(k.parentElement, q0, c); if (!q) continue;
      if (!sc && (q.right > r.right + 1.5 || q.left < r.left - 1.5) && !/(fixed|absolute)/.test(getComputedStyle(k).position)) { out.push("tràn khỏi khung " + Math.round(Math.max(q.right - r.right, r.left - q.left)) + "px: " + name(k) + " trong " + name(c)); edge++; break; }
      // Chỉ đo chữ của chính phần tử (chữ trong phần tử con có ô cắt "…" riêng thì được đo khi tới phần tử con, theo đúng khung cắt của nó).
      const own = [...k.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!own.length) continue;
      let t = null;
      for (const n of own) { const rg = document.createRange(); rg.selectNodeContents(n); const b = clip(k, rg.getBoundingClientRect(), c); if (b) t = t ? { left: Math.min(t.left, b.left), top: Math.min(t.top, b.top), right: Math.max(t.right, b.right), bottom: Math.max(t.bottom, b.bottom), width: 1 } : b; }
      if (!t) continue;
      const gap = Math.min(t.left - r.left, r.right - t.right);
      if (t.width && gap < 7.5 && t.top >= r.top && t.bottom <= r.bottom) { out.push("chữ sát mép khung (" + Math.round(gap) + "px): " + name(k) + " “" + k.textContent.trim().slice(0, 30) + "” trong " + name(c)); edge++; break; }
    }
  }
  // Khung nổi (menu, bảng chọn, hộp thoại) không bị lớp khác che: dò lưới điểm bên trong, điểm nào trúng phần tử ngoài khung là bị che.
  // Ví dụ menu tài khoản mở từ thanh điều hướng khi thanh bên thu gọn từng bị ô soạn tin của chat che mất góc dưới.
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.usermenu,.model-sub,.modal,[role=dialog]")) {
    if (!vis(m) || getComputedStyle(m).pointerEvents === "none") continue;
    const q = m.getBoundingClientRect(); if (q.width < 40 || q.height < 30) continue;
    // Khung kính tự cuộn: nền và viền (::before / ::after) trôi theo nội dung, viền cắt ngang dòng cuối. Phần cuộn phải nằm bên trong khung.
    if (m.matches(".menu,.model-menu,.usermenu,.model-sub,.modal") && !m.classList.contains("fl-flat") && /(auto|scroll)/.test(getComputedStyle(m).overflowY) && getComputedStyle(m, "::before").content !== "none") out.push("khung kính tự cuộn, nền và viền sẽ trôi theo nội dung: " + name(m));
    // Tràn mép trên / dưới màn hình: mất viền, mất góc bo (menu con của menu + từng mở lên quá mép trên).
    if (q.top < -1 || q.bottom > H + 1) out.push("khung nổi tràn khỏi mép " + (q.top < -1 ? "trên " + Math.round(-q.top) : "dưới " + Math.round(q.bottom - H)) + "px: " + name(m));
    let hit = null, n = 0;
    for (let x = q.left + 8; x < q.right - 6; x += 14) for (let y = q.top + 8; y < q.bottom - 6; y += 14) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const rr = parseFloat(getComputedStyle(m).borderTopLeftRadius) || 0, dx = Math.max(q.left + rr - x, 0, x - (q.right - rr)), dy = Math.max(q.top + rr - y, 0, y - (q.bottom - rr));
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > rr * rr - 4) continue;
      const t = document.elementFromPoint(x, y);
      if (t && !m.contains(t) && !t.closest(".toast,[role=tooltip]") && !t.contains(m)) { n++; hit ??= t; }
    }
    if (n) out.push("khung nổi bị che " + n + " điểm: " + name(m) + " dưới " + name(hit));
  }
  // Khối soạn tin của đoạn chat: mọi thứ (thẻ chế độ, tin chờ gửi, ô soạn) nằm dưới vùng chuyển của dải kính mờ.
  { const d = document.querySelector(".main>.dock"); if (d && vis(d)) { const top = d.getBoundingClientRect().top + parseFloat(getComputedStyle(d).paddingTop); for (const k of d.children) if (vis(k) && k.getBoundingClientRect().height && k.getBoundingClientRect().top < top - 1) out.push("nằm trong vùng mờ dần của khối soạn tin: " + name(k));
    // Thẻ chế độ, tin chờ gửi thẳng mép trái với ô soạn tin.
    const cl = d.querySelector(".composer")?.getBoundingClientRect().left; if (cl !== undefined) for (const k of d.querySelectorAll(":scope>.dock-mode,:scope>.wl-queue")) if (vis(k) && Math.abs(k.getBoundingClientRect().left - cl) > 1.5) out.push("lệch mép trái so với ô soạn tin " + Math.round(k.getBoundingClientRect().left - cl) + "px: " + name(k)); } }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.getAttribute("src") && vis(img)) out.push("ảnh hỏng: " + img.getAttribute("src").slice(0, 80));
  if (document.fonts.status !== "loaded") out.push("phông chữ chưa tải xong");
  const bad = [...document.fonts].filter((f) => f.status === "error" && !/Fallback/.test(f.family)).map((f) => f.family);
  if (bad.length) out.push("phông lỗi: " + [...new Set(bad)].join(", "));
  // Chữ tiếng Anh sót trong giao diện tiếng Việt (bỏ qua nội dung người dùng, code, tên riêng).
  const EN = /\\b(the|and|your|with|this|that|from|will|Settings|Search|Delete|Cancel|Save|Close|Enable|Disable|Upload|Download|Loading|Untitled|Add|Remove|Edit|Copy|Share|Retry|Error|Failed|Back|Next(?!\\.js)|Done|Open|New|Preview|Learn more|Turn on|Turn off)\\b/;
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const t = walk.currentNode, v = t.nodeValue.trim(), p = t.parentElement;
    if (!v || v.length < 3 || !p || p.closest("pre,code,textarea,input,[data-notr],.ai-msg,.user-msg,.mdx,.art-code,.sk-pre,.chat-item,.title-edit,iframe,.cr-by,.pl-row2-h b")) continue;
    if (!vis(p)) continue;
    const r = p.getBoundingClientRect(); if (r.bottom < 0 || r.top > H || !r.width) continue;
    if (EN.test(v) && !/[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(v) && !seen.has(v)) { seen.add(v); out.push("chữ tiếng Anh: “" + v.slice(0, 60) + "”"); }
    if (seen.size > 8) break;
  }
  // Ô nhập nhiều dòng bo tròn kiểu viên thuốc: chữ ở bốn góc bị cắt (ô Hướng dẫn của việc tự động từng như vậy). Ô chọn bo tròn mà không
  // chừa chỗ bên phải: mũi tên nằm đè lên viền bo.
  for (const t of document.querySelectorAll("textarea")) {
    if (!vis(t)) continue; const b = t.getBoundingClientRect(); if (!b.width || b.bottom < 0 || b.top > H) continue;
    const cs = getComputedStyle(t), rad = parseFloat(cs.borderTopLeftRadius) || 0;
    const frame = parseFloat(cs.borderTopWidth) > 0 || alpha(cs.backgroundColor) > 0.05 || cs.boxShadow !== "none";
    if (frame && b.height > 56 && rad > Math.min(18, b.height / 4)) out.push("ô nhiều dòng bo tròn " + Math.round(rad) + "px, chữ ở góc bị cắt: " + name(t));
  }
  // Nút và icon nằm đè lên ô nhập (con mắt của ô mật khẩu, nút xóa, nút gửi) phải ở giữa ô theo chiều dọc, nằm gọn trong ô. Ô mật khẩu ở trang đặt lại từng lệch xuống dưới vì khung bao tính cả lề của ô.
  for (const inp of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])")) {
    if (!vis(inp)) continue; const b = inp.getBoundingClientRect(); if (b.width < 60 || b.height < 20 || b.bottom < 0 || b.top > H) continue;
    for (const k of (inp.parentElement?.children ?? [])) {
      if (k === inp || !vis(k) || !k.matches("button,a,svg,[role=button]") || getComputedStyle(k).position !== "absolute") continue;
      const c = k.getBoundingClientRect(); if (!c.width || c.left < b.left - 1 || c.right > b.right + 1) continue;
      const off = (c.top + c.bottom) / 2 - (b.top + b.bottom) / 2;
      if (Math.abs(off) > 1.5) out.push("nút trong ô nhập lệch " + Math.round(off) + "px theo chiều dọc: " + name(k) + " trong " + name(inp));
      else if (c.top < b.top - 1 || c.bottom > b.bottom + 1) out.push("nút trong ô nhập tràn khỏi ô: " + name(k));
    }
  }
  // Chữ bị ép thành cột hẹp, mỗi dòng một hai từ, trong khi ô cha còn rộng: thường do phần tử bên cạnh chiếm hết chỗ (ô số ở Quản trị từng đẩy nhãn thành một cột).
  for (const k of document.querySelectorAll("div,span,p,label,b,h3,h4")) {
    if (!vis(k) || k.closest("svg,table,pre,code,textarea,[aria-hidden=true],.sr-only,.ai-msg,.user-msg,.mdx,iframe")) continue;
    const own = [...k.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()); if (!own.length || k.children.length) continue;
    const r = k.getBoundingClientRect(); if (r.bottom < 0 || r.top > H || !r.width || r.width > 150) continue;
    const text = own.map((n) => n.nodeValue).join(" ").trim(), lh = parseFloat(getComputedStyle(k).lineHeight) || parseFloat(getComputedStyle(k).fontSize) * 1.3, lines = lh > 0 ? Math.round(r.height / lh) : 0;
    const box = k.closest(".row,.adm-perm-row,.adm-card,.modal,section")?.getBoundingClientRect();
    if (lines >= 4 && text.length / lines < 13 && box && box.width > r.width * 3) out.push("chữ bị ép hẹp " + Math.round(r.width) + "px, " + lines + " dòng: " + name(k) + " “" + text.slice(0, 30) + "”");
  }
  // Chữ gợi ý (placeholder) dài hơn ô nhập: bị cắt cụt, không có dấu … (ô hạn mức "Mặc định: không giới hạn" ở trang quản trị).
  { const cv = document.createElement("canvas").getContext("2d");
    for (const inp of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
      if (!vis(inp) || inp.value) continue; const b = inp.getBoundingClientRect(); if (!b.width || b.bottom < 0 || b.top > H) continue;
      if (inp.tagName === "TEXTAREA" && inp.clientHeight > 40) continue;
      const cs = getComputedStyle(inp); cv.font = cs.font;
      const w = cv.measureText(inp.placeholder).width, avail = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (w > avail + 2) out.push("chữ gợi ý bị cắt (" + Math.round(w) + " > " + Math.round(avail) + "px): “" + inp.placeholder.slice(0, 50) + "”");
    } }
  for (const s of document.querySelectorAll("select")) {
    if (!vis(s)) continue; const b = s.getBoundingClientRect(); if (!b.width || b.bottom < 0 || b.top > H) continue;
    // Mũi tên mặc định của trình duyệt (appearance khác none) luôn nằm sát viền phải dù chừa padding bao nhiêu.
    const cs = getComputedStyle(s), rad = parseFloat(cs.borderTopRightRadius) || 0, pr = parseFloat(cs.paddingRight) || 0, native = (cs.appearance || cs.webkitAppearance) !== "none";
    if (rad >= b.height / 2 - 3 && (native || pr < 26)) out.push("mũi tên ô chọn sát viền bo tròn (" + (native ? "mũi tên mặc định" : "chừa " + Math.round(pr) + "px") + "): " + name(s));
  }
  // Dấu "·" ngăn cách bị đẩy xuống đầu dòng sau (thẻ Khám phá: "Nhiều tác giả" / "· 32 skill · MIT"), hoặc khoảng cách hai bên dấu lệch
  // nhau (hàng connector: khoảng trắng đầu bị flex nuốt, 6px trước dấu / 3px sau dấu). Bỏ qua phần chữ bị khung cắt (line-clamp, cuộn).
  { const nodes = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = tw.nextNode());) { const p = t.parentElement; if (t.nodeValue.trim() && p && !p.closest("svg,script,style,textarea,pre,code,.mdx,.ai-msg,.user-msg,.cm-editor,iframe,[aria-hidden=true],.sr-only") && vis(p)) nodes.push(t); }
    const rect = (k, i) => { const rg = document.createRange(); rg.setStart(nodes[k], i); rg.setEnd(nodes[k], i + 1); return rg.getBoundingClientRect(); };
    const near = (k, i, dir) => { for (let j = i + dir; ; j += dir) { if (j < 0 || j >= nodes[k].nodeValue.length) { k += dir; if (k < 0 || k >= nodes.length) return null; j = dir > 0 ? -1 : nodes[k].nodeValue.length; continue; } if (nodes[k].nodeValue[j].trim()) return [k, j]; } };
    const cut = (el, r) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) { const b = p.getBoundingClientRect(); if (r.top >= b.bottom - 1 || r.bottom <= b.top + 1 || r.left >= b.right - 1 || r.right <= b.left + 1) return true; } } return false; };
    let n = 0;
    for (let k = 0; k < nodes.length && n < 6; k++) for (let i = nodes[k].nodeValue.indexOf("·"); i >= 0 && n < 6; i = nodes[k].nodeValue.indexOf("·", i + 1)) {
      const d = rect(k, i), el = nodes[k].parentElement; if (!d.width || d.bottom < 0 || d.top > H || cut(el, d)) continue;
      const box = el.closest(":not(span,b,i,em,small,strong,a,kbd,u,s,code)"), a = near(k, i, -1), z = near(k, i, 1);
      if (!a || !box || !box.contains(nodes[a[0]])) continue;
      const L = rect(...a), say = "“" + box.textContent.trim().replace(/\\s+/g, " ").slice(0, 40) + "”";
      if (L.bottom <= d.top + 2) { n++; out.push("dấu · ở đầu dòng: " + say + " (" + name(el) + ")"); continue; }
      if (!z || !box.contains(nodes[z[0]])) continue;
      const R = rect(...z); if (Math.abs(R.top - d.top) > 4 || Math.abs(L.top - d.top) > 4) continue;
      const gl = d.left - L.right, gr = R.left - d.right;
      if (gl < 16 && gr < 16 && Math.abs(gl - gr) > 2.5) { n++; out.push("khoảng cách hai bên dấu · lệch (" + Math.round(gl) + "/" + Math.round(gr) + "px): " + say + " (" + name(el) + ")"); }
    } }
  // Một chữ đứng lẻ ở dòng cuối của đoạn chữ nhiều dòng ("…các thành phần giao diện / khác." ở Cài đặt, "…hợp với việc / đó" ở bộ chọn
  // model). Chỉ xét khối có chữ trực tiếp; bỏ ô gõ, mã và câu trả lời đang chạy chữ (ở đó text-wrap-style để auto có chủ ý).
  { let n = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (n >= 6) break;
      if (el.closest("svg,script,style,textarea,input,pre,code,.cm-editor,iframe,[aria-hidden=true],.sr-only,.ai-streaming")) continue;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.display.startsWith("inline") || cs.whiteSpace.includes("nowrap") || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > H || r.right <= 0 || r.left >= W) continue;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (r.height < lh * 1.8) continue;
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), texts = [];
      for (let t; (t = tw.nextNode());) if (t.nodeValue.trim()) texts.push(t);
      const rg = document.createRange();
      // Dòng cuối: đi ngược từ ký tự cuối tới khi gặp ký tự ở dòng trên; ghi lại khung của chữ ở dòng cuối.
      let last = null, line = "", above = false, box = null;
      walk: for (let k = texts.length - 1; k >= 0; k--) { const v = texts[k].nodeValue; for (let i = v.length - 1; i >= 0; i--) {
        if (!v[i].trim()) { line = v[i] + line; continue; }
        rg.setStart(texts[k], i); rg.setEnd(texts[k], i + 1); const b = rg.getClientRects()[0]; if (!b) continue;
        if (last == null) last = b.top;
        if (Math.abs(b.top - last) > lh / 2) { above = true; break walk; }
        line = v[i] + line; box = box ? { l: Math.min(box.l, b.left), r: Math.max(box.r, b.right), t: b.top, b: b.bottom } : { l: b.left, r: b.right, t: b.top, b: b.bottom };
      } }
      const w = line.trim();
      if (!above || !w || /\\s/.test(w) || w.length > 14 || !box) continue;
      // Chữ bị khung cắt (dòng thứ ba sau line-clamp, thanh bên đang thu gọn) không ai thấy. Chữ lẻ dài (từ 40% bề ngang trở lên) không
      // tính: pretty của Chrome cũng chỉ kéo chữ khi dòng cuối quá ngắn.
      let gone = false;
      for (let p = el; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(ps.overflowX + ps.overflowY)) { const q = p.getBoundingClientRect(); if (box.t >= q.bottom - 1 || box.b <= q.top + 1 || box.l >= q.right - 1 || box.r <= q.left + 1) { gone = true; break; } } }
      if (gone || box.r - box.l >= 0.4 * (r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) continue;
      { n++; out.push("chữ đứng lẻ ở dòng cuối “" + w + "”: “" + el.textContent.trim().replace(/\\s+/g, " ").slice(0, 50) + "” (" + name(el) + ")"); }
    } }
  // Biểu tượng một mình trong ô vuông nhỏ có khung (thẻ artifact từng lệch lên góc trái): phải nằm giữa ô.
  for (const b of document.querySelectorAll("span,i,div,button")) {
    if (b.children.length !== 1 || b.firstElementChild.tagName !== "svg" || b.textContent.trim() || !vis(b)) continue;
    const q = b.getBoundingClientRect(); if (q.width < 18 || q.width > 48 || q.height < 18 || q.height > 48 || Math.abs(q.width - q.height) > 2) continue;
    const c = getComputedStyle(b); if (c.boxShadow === "none" && c.backgroundColor === "rgba(0, 0, 0, 0)" && c.borderTopWidth === "0px") continue;
    const k = b.firstElementChild.getBoundingClientRect(); if (!k.width) continue;
    const dx = k.left + k.width / 2 - (q.left + q.width / 2), dy = k.top + k.height / 2 - (q.top + q.height / 2);
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) out.push("biểu tượng lệch khỏi tâm ô " + Math.round(dx) + "," + Math.round(dy) + "px: " + name(b));
  }
  // Câu trả lời không lộ ký hiệu Markdown; chuỗi dài không dấu cách không tràn khỏi tin nhắn.
  for (const m of document.querySelectorAll(".ai-msg,.user-msg")) {
    if (m.scrollWidth > m.clientWidth + 1) out.push("chữ tràn khỏi tin nhắn: " + name(m) + " " + m.scrollWidth + ">" + m.clientWidth);
    if (!m.matches(".ai-msg")) continue;
    for (const p of m.querySelectorAll("p,li,td,th,h1,h2,h3,h4")) { if (p.closest("pre,code,.katex")) continue; const c = p.cloneNode(true); c.querySelectorAll("code,pre,.katex").forEach((x) => x.remove()); const raw = /\\*\\*\\S|~~\\S|<br\\s*\\/?>|\\]\\(https?:/.exec(c.textContent); if (raw) { out.push("ký hiệu Markdown lộ trong câu trả lời “" + raw[0] + "”: " + c.textContent.slice(0, 50)); break; } }
  }
  // Nhóm đang thu gọn không được lòi gì ra (phân trang từng nằm trơ dưới mục Code đã lưu trữ).
  for (const f of document.querySelectorAll(".fold:not(.open)")) if (f.getBoundingClientRect().height > 1 && !f.closest(".closing")) { const a = f.getAnimations?.({ subtree: false }) ?? []; if (!a.length) out.push("nhóm thu gọn vẫn cao " + Math.round(f.getBoundingClientRect().height) + "px: " + name(f)); }
  // Ảnh thu nhỏ chỉ để nhìn: không có điểm dừng Tab bên trong. Nút không lồng trong nút.
  for (const t of document.querySelectorAll(".art-thumb")) if (!t.inert) out.push("ảnh thu nhỏ không inert: " + name(t));
  for (const b of document.querySelectorAll("[role=button] button,[role=button] a[href],button button,button a[href],a[href] button")) { if (vis(b)) { out.push("nút lồng trong nút: " + name(b) + " trong " + name(b.parentElement.closest("[role=button],button,a[href]"))); break; } }
  // Nhóm thẻ: thẻ đang chọn phải báo cho trình đọc màn hình, không chỉ đổi màu.
  for (const g of document.querySelectorAll(".ds-seg,.pl-seg")) { const on = g.querySelector(":scope>button.on"); if (on && vis(on) && !on.matches("[aria-selected=true],[aria-pressed=true],[aria-current],[aria-checked=true]")) out.push("nút đang chọn không báo trạng thái: " + on.textContent.trim().slice(0, 20) + " trong " + name(g)); }
  // Tab không được rơi vào một phần tử khuất dưới lớp phủ của khung artifact: dải báo, nút trong .main phải nằm ngoài khung đang mở.
  { const art = document.querySelector(".main.has-art .art-panel, .main.has-art .art-pane"); const vb = document.querySelector(".verify-banner"); if (art && vb && vb.getBoundingClientRect().right > art.getBoundingClientRect().left + 1) out.push("dải xác minh nằm dưới khung artifact"); }
  return out;
})()`;

for (const theme of THEMES) for (const size of SIZES) {
  const tag = `${theme}-${size}`;
  console.log(`\n━━ ${tag}`);
  rmSync(PROF, { recursive: true, force: true });
  if (!VIEW[size]) throw new Error("cỡ màn hình lạ: " + size);
  const mobile = size === "mobile", tablet = size === "tablet";
  const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--remote-debugging-port=9339", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9339/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), errs = [];
  // Yêu cầu mạng đang chờ (cho ready()): bỏ EventSource / WebSocket và yêu cầu sống lâu (luồng lượt chạy, thăm dò dài) — chúng không bao giờ "xong".
  const inflight = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push("JS: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0].slice(0, 200));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push("console: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    if (m.method === "Network.responseReceived" && m.params.response.status >= 500) errs.push(`HTTP ${m.params.response.status}: ${m.params.response.url.slice(0, 100)}`);
    if (m.method === "Network.requestWillBeSent" && !["EventSource", "WebSocket", "Ping"].includes(m.params.type)) inflight.set(m.params.requestId, Date.now());
    if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") inflight.delete(m.params.requestId);
  });
  // Chrome không trả lời (hộp thoại chặn, tab treo): báo lỗi của bước đó thay vì treo cả bộ soát hàng giờ.
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; const tm = setTimeout(() => { waits.delete(id); no(new Error("Chrome không trả lời: " + method)); }, 90_000); waits.set(id, [(v) => { clearTimeout(tm); ok(v); }, (e) => { clearTimeout(tm); no(e); }]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Emulation.setDeviceMetricsOverride", VIEW[size]);
  if (mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}` });
  // Giật: ghi mọi tác vụ dài (> 50ms) của trang; mỗi bước báo tác vụ quá LAG ms xảy ra sau khi trang đã tải xong (không tính lần tải trang đầu).
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.duration), Math.round(e.startTime)]); }).observe({ type: "longtask" }); } catch {}` });
  let lagMax = 0, lagAt = "";
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  // H2.3: chờ trang đứng yên thay cho chờ cố định 0,8–2 giây trước mỗi lần soát / chụp. Đứng yên = tài liệu tải xong, phông đã nạp, không còn
  // yêu cầu mạng nào (trừ yêu cầu sống quá 15 giây: luồng lượt chạy, thăm dò dài), không còn hoạt ảnh hữu hạn đang chạy, và số phần tử / chiều cao /
  // độ dài chữ không đổi trong quiet ms. Máy nhanh đi tiếp ngay; máy chậm (CI, bản dev biên dịch lần đầu) chờ tới khi xong, tối đa max ms rồi soát
  // như cũ (lỗi bố cục khi đó vẫn bị bắt). Đo trên bản dev đang tải nặng: yêu cầu kiểm mã đặt lại mật khẩu mất 10–27 giây, nên ngưỡng 5 giây là quá ngắn.
  const READY = `(() => { const a = document.getAnimations().filter((x) => x.playState === "running" && x.effect?.getTiming?.().iterations !== Infinity).length;
    return [document.readyState, document.fonts.status, a, document.querySelectorAll("*").length, document.documentElement.scrollHeight, document.body?.innerText.length ?? 0]; })()`;
  const busyNet = () => [...inflight.values()].some((t) => Date.now() - t < 15_000);
  const ready = async (quiet = 400, max = 15_000) => {
    const end = Date.now() + max;
    await waitFor(async () => !busyNet() && (await ev(`document.readyState === "complete" && document.fonts.status === "loaded"`)), max, { every: 100 });
    await settle(async () => { const v = await ev(READY); return busyNet() || v[2] ? Math.random() : v; }, quiet, Math.max(500, end - Date.now()));
  };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const key = (k, code, vk, mods = 0) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }));
  const esc = () => key("Escape", "Escape", 27);
  let step = 0;
  const shot = async (name) => {
    await sleep(350);
    const where = `${tag}/${name}`;
    for (const e of errs.splice(0)) note(where, e);
    for (const [d, t] of await ev(`(window.__lt || []).splice(0)`).catch(() => [])) { if (t > 4000 && d > lagMax) { lagMax = d; lagAt = name; } if (t > 4000 && d > LAG) note(where, `giật: giao diện bị chặn ${d}ms`); }
    for (const p of await ev(CHECK).catch((e) => ["kiểm tra lỗi: " + e.message])) note(where, p);
    const { data } = await P("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}${tag}-${String(++step).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64"));
    console.log("  ·", name);
  };
  const ask = async (text) => {
    await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text });
    await key("Enter", "Enter", 13);
    await until(`!document.querySelector(".thinking") && !document.querySelector(".art-card.busy") && !document.querySelector(".msg-stop, .stop-btn, [aria-label='Dừng']")`, 90000, "reply " + text);
    await ready(600);
  };
  const side = async () => {
    // Điện thoại: khung artifact mở toàn màn hình, đóng trước (như người dùng bấm X) rồi mới mở thanh bên.
    if (mobile && (await ev(`!!document.querySelector(".art-panel")`))) { await click(`document.querySelector(".art-panel [aria-label='Đóng']")`, "close art").catch(() => {}); await sleep(400); }
    // Máy tính bảng: thanh điều hướng (mục Dự án, Code…, nút tài khoản) luôn hiện; bảng đoạn chat là lớp nổi có lớp phủ, không mở khi chỉ cần điều hướng.
    if (tablet) return;
    if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger").catch(() => {}); await sleep(500); } };
  const nav = async (label) => { await side(); await click(byText(".nav-item", label), label); await ready(); };
  const step0 = async (name, fn) => { try { await fn(); } catch (e) { note(`${tag}/${name}`, "không chạy được bước: " + e.message.split("\n")[0]); await shot(name + "-fail").catch(() => {}); } };

  // Trang công khai khi chưa đăng nhập.
  await step0("dang-nhap", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("input[type=email], input[type=password], form")`, 20000, "login"); await ready(); await shot("dang-nhap"); });
  await step0("dieu-khoan", async () => { await P("Page.navigate", { url: B + "/terms" }); await ready(); await shot("dieu-khoan"); });
  await step0("quyen-rieng-tu", async () => { await P("Page.navigate", { url: B + "/privacy" }); await ready(); await shot("quyen-rieng-tu"); });

  // Các trang lẻ không cần đăng nhập, đủ trạng thái (từng chỉ soát /terms, /privacy nên icon lệch ở trang đặt lại mật khẩu lọt tới người dùng).
  await step0("dat-lai-mk-nhap-email", async () => { await P("Page.navigate", { url: B + "/reset" }); await ready(); await shot("dat-lai-mk-nhap-email"); });
  await step0("dat-lai-mk-het-han", async () => { await P("Page.navigate", { url: "about:blank" }); await sleep(200); await P("Page.navigate", { url: B + "/reset#khong-hop-le-000000000000" }); await ready(600); await shot("dat-lai-mk-het-han"); });
  if (RESET_TOKEN) await step0("dat-lai-mk-nhap-moi", async () => { await P("Page.navigate", { url: "about:blank" }); await sleep(200); await P("Page.navigate", { url: B + "/reset#" + RESET_TOKEN }); await until(`!!document.querySelector("#rp-new")`, 15000, "ô mật khẩu"); await sleep(400); await shot("dat-lai-mk-nhap-moi"); });
  await step0("xac-minh-email", async () => { await P("Page.navigate", { url: B + "/verify#khong-hop-le-000000000000" }); await ready(600); await shot("xac-minh-email"); });
  await step0("tai-ung-dung", async () => { await P("Page.navigate", { url: B + "/download" }); await ready(); await shot("tai-ung-dung"); });
  if (SHARE_TOKEN) await step0("trang-chia-se", async () => { await P("Page.navigate", { url: B + "/share/" + SHARE_TOKEN }); await ready(600); await shot("trang-chia-se"); });
  await step0("khong-tim-thay", async () => { await P("Page.navigate", { url: B + "/khong-co-trang-nay" }); await ready(); await shot("khong-tim-thay"); });

  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await step0("trang-chu", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000, "app"); await ready(); await shot("trang-chu"); });
  await step0("menu-model", async () => { await click(`document.querySelector(".model-btn")`, "model"); await sleep(500); await shot("menu-model"); await esc(); await sleep(300); });
  // Người mới bắt đầu ở Tự động (CLI giả lập); ca artifact cần model của nhà cung cấp giả lập, nơi có sẵn artifact mẫu.
  await step0("chon-model-thu", async () => { await ev(`(async () => { const me = await (await fetch("/api/auth/me")).json(), m = await (await fetch("/api/models")).json(), k = m.providers.flatMap((p) => p.models).find((x) => !x.key.startsWith("sub-"))?.key; if (k) localStorage.setItem("u:" + me.user.id + ":model", k); })()`); await P("Page.reload", {}); await until(`!!document.querySelector("textarea")`, 30000, "app"); await ready(); });
  await step0("chat-artifact", async () => { await ask("Làm trang web cho quán cà phê"); await shot("chat-artifact"); });
  await step0("artifact-ma", async () => { await click(byText(".art-tabs button", "Mã"), "code"); await ready(); await shot("artifact-ma"); await click(byText(".art-tabs button", "Xem trước"), "preview"); await sleep(500); });
  await step0("tai-ve", async () => { await click(`document.querySelector(".art-acts [aria-label='Tải về']")`, "dl"); await sleep(500); await shot("menu-tai-ve"); await esc(); await sleep(300); });
  await step0("ban-tron", async () => { await click(`document.querySelector(".art-panel [aria-label='Đóng']")`, "close art").catch(() => {}); await sleep(400); await click(`document.querySelector(".cx-pill")`, "mixer"); await ready(); await shot("ban-tron-ngu-canh"); await esc(); });
  await step0("chat-bieu-do", async () => { await ask("Vẽ biểu đồ doanh thu 6 tháng"); await shot("chat-bieu-do"); });
  await step0("chat-tep", async () => { await ask("Tạo file Excel báo cáo doanh thu"); await shot("chat-tao-tep"); });
  await step0("chat-markdown", async () => { await ask("Viết kế hoạch ra mắt sản phẩm có bảng lịch trình"); await shot("chat-markdown"); });
  await step0("muc-dung", async () => { await click(`document.querySelector(".us-ring")`, "usage"); await sleep(700); await shot("muc-dung"); await esc(); await sleep(300); });
  // Đoạn chat ở chế độ Trang trình bày: thẻ "Synchro Slides" xếp trên ô soạn tin, chữ của chat cuộn xuống phía sau nó.
  await step0("che-do-slides", async () => {
    await side(); await click(`document.querySelector(".rail-new")`, "new"); await sleep(700);
    await click(byText(".hero-chip", "Trang trình bày"), "slides"); await sleep(500);
    await ask("Làm bộ slide giới thiệu quán cà phê");
    await ev(`(() => { const t = document.querySelector(".thread"); if (t) t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 120); })()`); await sleep(500);
    await shot("che-do-slides");
  });
  // Thanh bên thu gọn, mở menu tài khoản trong đoạn chat: menu nằm trên ô soạn tin (không bị che góc dưới).
  // Máy tính bảng: bảng đoạn chat vốn đã đóng (U3), mở thẳng menu tài khoản từ thanh điều hướng.
  if (!mobile) await step0("menu-nguoi-dung-thu-gon", async () => {
    if (!tablet) { await click(`document.querySelector(".rail-mark")`, "collapse"); await sleep(700); }
    await click(`document.querySelector(".rail .user")`, "user"); await sleep(600);
    await shot("menu-nguoi-dung-thu-gon"); await esc(); await sleep(300);
    if (!tablet) { await click(`document.querySelector(".rail-mark")`, "expand"); await sleep(700); }
  });
  await step0("bang-lenh", async () => { await key("k", "KeyK", 75, 4); await sleep(600); await shot("bang-lenh"); await esc(); await sleep(300); });
  await step0("artifacts", async () => { await nav("Artifacts"); await shot("artifacts"); await click(byText("button", "Ứng dụng"), "apps tab").catch(() => {}); await ready(); await shot("ung-dung"); });
  await step0("du-an", async () => { await nav("Dự án"); await shot("du-an"); });
  await step0("hop-thu", async () => { await nav("Hộp thư"); await shot("hop-thu"); });
  // Tạo / sửa việc tự động: ô Hướng dẫn nhiều dòng (gõ nội dung dài như người dùng), ô chọn model.
  await step0("viec-tu-dong", async () => {
    await click(byText(".tk-page button", "Tự đặt"), "manual task"); await until(`!!document.querySelector(".modal textarea")`, 8000, "task editor");
    await click(`document.querySelector(".modal textarea")`, "task prompt");
    await P("Input.insertText", { text: "Mục tiêu: Tìm kiếm, chọn lọc và đánh giá các repository đỉnh cao trên GitHub về design, motion graphics, animation, UI/UX.\n\nCác bước thực hiện:\n1. Tìm kiếm trên GitHub và các danh sách awesome lists.\n2. Đánh giá và chọn lọc những repo tốt nhất.\n3. Trình bày kết quả gửi vào Hộp thư." });
    await sleep(400); await shot("viec-tu-dong"); await esc(); await sleep(400);
  });
  await step0("bo-nao", async () => { await nav("Bộ não"); await shot("bo-nao"); });
  await step0("code", async () => { await nav("Code"); await shot("code"); });
  // Menu ⋮ của Synchro Code khi bảng phiên đang mở: menu nằm trên bảng phiên (từng bị bảng phiên che gần hết).
  if (!mobile) await step0("code-menu", async () => {
    if (!(await ev(`!!document.querySelector(".cv-cols>.sr, aside.sr")`))) { await click(`document.querySelector(".cv-bar [aria-label='Ẩn/hiện bảng phiên']")`, "rail"); await sleep(600); }
    await click(`document.querySelector(".cv-bar [aria-label='Thêm']")`, "more"); await sleep(600); await shot("code-menu-them"); await esc(); await sleep(300);
  });
  await step0("speech", async () => { await nav("Speech"); await shot("speech"); });
  // Kho kỹ năng: hộp chi tiết thư viện, hộp thoại Quét skill rác.
  await step0("kho-ky-nang-hop-thoai", async () => {
    await nav("Kỹ năng"); await until(`!!document.querySelector(".pl-row2")`, 15000, "hub rows");
    await click(`document.querySelector(".hub-yours .pl-row2")`, "library detail"); await sleep(700); await shot("chi-tiet-thu-vien"); await esc(); await sleep(400);
    await click(`document.querySelector(".pl-scan")`, "scan"); await until(`!!document.querySelector(".scan-modal .modal-foot")`, 15000, "scan modal"); await sleep(500); await shot("quet-skill-rac"); await esc(); await sleep(400);
  });
  await step0("kho-ky-nang", async () => { await nav("Kỹ năng"); await shot("kho-ky-nang"); await click(byText(".hub-seg button, button", "Khám phá"), "discover").catch(() => {}); await until(`!!document.querySelector(".pl-dcard")`, 10000, "discover cards").catch(() => {}); await sleep(500); await shot("kham-pha"); await click(byText("button, .cz-tab, [role=tab]", "Connectors"), "connectors").catch(() => {}); await ready(); await shot("connectors"); });
  await step0("menu-nguoi-dung", async () => { await side(); await click(`document.querySelector(".rail .user")`, "user"); await sleep(500); await shot("menu-nguoi-dung"); });
  await step0("cai-dat", async () => {
    await click(byText(".menu-item", "Cài đặt"), "settings"); await ready();
    const n = await ev(`document.querySelectorAll(".modal.settings .s-item").length`);
    for (let i = 0; i < n; i++) {
      await click(`document.querySelectorAll(".modal.settings .s-item")[${i}]`, "tab " + i); await ready();
      const t = await ev(`document.querySelectorAll(".modal.settings .s-item")[${i}].getAttribute("title")`);
      const label = "cai-dat-" + String(t).toLowerCase().replace(/\s+/g, "-");
      await shot(label);
      // Phần dưới của từng mục cũng phải được soát: bộ soát chỉ đo những gì đang trong khung nhìn, nên ô số của Quản trị từng lọt vì nằm dưới màn hình đầu.
      // Điện thoại đang tạm dừng (chủ dự án chỉ xét máy tính): cuộn hết trên điện thoại làm cả bộ soát kéo dài hơn một tiếng.
      // Máy tính bảng: hai lần cuộn mỗi mục (đủ thấy phần dưới, giữ thời gian chạy vừa phải).
      for (let k = 1; k <= (mobile ? 0 : tablet ? 2 : 8); k++) {
        const more = await ev(`(() => { const b = [...document.querySelectorAll(".modal.settings .s-body, .modal.settings .s-body *")].find((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (!b || b.scrollTop + b.clientHeight >= b.scrollHeight - 4) return false; b.scrollTop += b.clientHeight * 0.85; return true; })()`);
        if (!more) break;
        await sleep(350); await shot(label + "-" + k);
      }
    }
    await esc(); await sleep(400);
  });
  if (mobile) await step0("thanh-ben", async () => { await side(); await shot("thanh-ben"); await esc(); });
  // Máy tính bảng: bảng đoạn chat mở ra là lớp nổi trên lớp phủ tối (U3); soát lúc đang mở rồi bấm lớp phủ để đóng.
  if (tablet) await step0("thanh-ben", async () => {
    if (await ev(`!!document.querySelector(".shell-side.closed")`)) { await click(`document.querySelector(".rail-mark")`, "open panel"); await sleep(600); }
    await shot("thanh-ben");
    await P("Input.dispatchMouseEvent", { type: "mousePressed", x: VIEW.tablet.width - 24, y: VIEW.tablet.height / 2, button: "left", clickCount: 1 });
    await P("Input.dispatchMouseEvent", { type: "mouseReleased", x: VIEW.tablet.width - 24, y: VIEW.tablet.height / 2, button: "left", clickCount: 1 }); await sleep(500);
  });
  console.log(`  · tác vụ chặn giao diện lâu nhất (sau khi tải trang): ${lagMax}ms${lagAt ? ` (${lagAt})` : ""}`);
  // Chờ Chrome của vòng này thoát hẳn: vòng sau mở Chrome mới cùng cổng 9339; Chrome cũ còn giữ cổng thì vòng sau gắn nhầm vào nó
  // (còn phiên đăng nhập → bước "đăng nhập" không thấy màn đăng nhập).
  ws.close();
  await new Promise((ok) => { if (chrome.exitCode !== null) return ok(); chrome.once("exit", ok); chrome.kill(); setTimeout(() => { chrome.kill("SIGKILL"); ok(); }, 5000); });
  for (let i = 0; i < 25 && (await fetch("http://127.0.0.1:9339/json/version").then(() => true).catch(() => false)); i++) await sleep(200);
}

// Giao diện điện thoại đang tạm dừng theo quyết định của chủ dự án: vẫn soát và in ra để làm sau, nhưng không chặn deploy.
const phone = problems.filter((p) => /^\w+-mobile\//.test(p)), desk = problems.filter((p) => !phone.includes(p));
if (phone.length) { console.log(`\n── Điện thoại, chưa tính (${phone.length})`); for (const p of phone) console.log(" -", p); }
console.log(`\n━━ Vấn đề (${desk.length})`);
for (const p of desk) console.log(" -", p);
console.log(`\nẢnh chụp: ${OUT}`);
