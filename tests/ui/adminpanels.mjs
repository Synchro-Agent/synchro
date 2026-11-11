// Các bảng quản trị mới (Providers → Cập nhật CLI và Model mới, Sức khỏe hệ thống → Sao lưu liên tục, Quản trị viên → chống bot và hạn mức trả tiền)
// bằng Chrome ẩn trên npm run dev:mock: chủ sở hữu và quản trị viên (ô bị khóa kèm lời giải thích), sáng / tối, máy tính 1280 và điện thoại 375.
// Kiểm: không cuộn ngang, không phần tử nào tràn khỏi khung cài đặt hay màn hình, chữ không bị cắt, nút / ô bị khóa thật sự bị khóa với quản trị viên.
// Chụp ảnh vào <tmp>/synchro-ui/adminpanels/ (hoặc SHOTS). Chạy: node tests/ui/adminpanels.mjs  (BASE, CDP_PORT để đổi địa chỉ / cổng Chrome).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200";
const OUT = process.env.SHOTS ?? path.join(os.tmpdir(), "synchro-ui/adminpanels");
const CDP = Number(process.env.CDP_PORT ?? 9357), PROF = path.join(os.tmpdir(), `synchro-ui/chrome-prof-adminpanels-${CDP}`);
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra && !ok ? " — " + extra : ""}`); if (!ok) fails++; };

// Tài khoản: chủ sở hữu (quản trị đầu tiên của máy giả lập) và một quản trị viên tạo riêng cho lần chạy này.
const login = async (email, password) => {
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  return (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
};
const api = (cookie) => async (method, p, body) => { const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return null; } };
const ownerCookie = await login("admin@synchro.test", "synchro-mock-123");
if (!ownerCookie) throw new Error("login failed");
const O = api(ownerCookie), tag = Date.now().toString(36), adEmail = `panels-${tag}@synchro.test`, adPw = "Panels-test-123";
await fetch(B + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: adEmail, password: adPw, profile: { fullName: "Panel Admin", birthDate: "2000-01-01" } }) });
const adminCookie = await login(adEmail, adPw), adminId = (await api(adminCookie)("GET", "/api/auth/me"))?.user?.id;
await O("PATCH", `/api/admin/users/${adminId}`, { action: "mark_verified" });
await O("PATCH", `/api/admin/users/${adminId}`, { action: "set_role", role: "admin" });

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push("JS: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0].slice(0, 200));
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });

// Lỗi bố cục trong khung đang xem: cuộn ngang cả trang; phần tử hiện ra mà tràn khỏi màn hình hay khỏi khung cài đặt; chữ một dòng bị cắt mà không có dấu …;
// ô / nút trùm lên nhau trong cùng một hàng.
const CHECK = `(() => {
  const out = [], vw = document.documentElement.clientWidth, d = document.documentElement;
  if (d.scrollWidth > vw + 1) out.push("trang cuộn ngang " + d.scrollWidth + " > " + vw);
  const body = document.querySelector(".modal.settings .s-body") || document.body, bb = body.getBoundingClientRect();
  for (const el of body.querySelectorAll("button,input,select,.api-badge,.mr-row,.api-card,.adm-card,.row,.adm-perm-row,.api-own,p,span,b")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    if (r.right > Math.min(vw, bb.right) + 1.5 || r.left < Math.max(0, bb.left) - 1.5) out.push("tràn: " + (el.className || el.tagName) + " [" + (el.textContent || "").trim().slice(0, 40) + "] " + Math.round(r.left) + "–" + Math.round(r.right) + " / " + Math.round(bb.left) + "–" + Math.round(bb.right));
    const cs = getComputedStyle(el);
    if (cs.whiteSpace === "nowrap" && cs.overflow === "hidden" && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") out.push("chữ bị cắt: " + (el.textContent || "").trim().slice(0, 40));
  }
  return [...new Set(out)].slice(0, 12);
})()`;

const runs = [];
for (const who of ["owner", "admin"]) for (const theme of ["light", "dark"]) for (const size of ["desktop", "mobile"]) runs.push({ who, theme, size });
for (const { who, theme, size } of runs) {
  const mobile = size === "mobile", key = `${who}-${theme}-${size}`;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Network.setCookie", { name: "synchro_session", value: (who === "owner" ? ownerCookie : adminCookie).split("=")[1], url: B });
  await P("Emulation.setDeviceMetricsOverride", mobile ? { width: 375, height: 812, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  if (mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}` });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const shot = async (name) => { await sleep(400); const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, `${key}-${name}.png`), Buffer.from(data, "base64")); };
  // Mở Cài đặt → một mục, cuộn tới tiêu đề phần cần xem rồi chụp và đo.
  const section = async (tab, heading, name) => {
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea")`, 30000, "app"); await sleep(800);
    if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "sidebar").catch(() => {}); await sleep(600); }
    await click(`document.querySelector(".rail .user")`, "user"); await sleep(500);
    await click(`[...document.querySelectorAll(".menu-item")].find((e) => e.textContent.trim().startsWith("Cài đặt"))`, "settings"); await sleep(900);
    await click(`[...document.querySelectorAll(".modal.settings .s-item")].find((e) => ${JSON.stringify([tab].flat())}.some((t) => e.getAttribute("title") === t || e.textContent.trim() === t))`, String(tab)); await sleep(1500);
    await until(`[...document.querySelectorAll(".modal.settings h3.sec, .modal.settings .adm-card-h b")].some((e) => e.textContent.trim() === ${JSON.stringify(heading)})`, 20000, heading);
    await ev(`[...document.querySelectorAll(".modal.settings h3.sec, .modal.settings .adm-card-h b")].find((e) => e.textContent.trim() === ${JSON.stringify(heading)}).scrollIntoView({ block: "start" }); { const b = document.querySelector(".modal.settings .s-body"); if (b) b.scrollTop -= 110; }`);
    await sleep(700);
    const probs = await ev(CHECK);
    check(`${key} · ${name}: bố cục không tràn, không cuộn ngang`, !probs.length, probs.join(" | "));
    await shot(name);
    await ev(`(() => { const b = document.querySelector(".modal.settings .s-body"); if (b) b.scrollTop += b.clientHeight * 0.7; })()`); await sleep(500);
    const more = await ev(CHECK);
    check(`${key} · ${name} (phần dưới): bố cục không tràn`, !more.length, more.join(" | "));
    await shot(name + "-2");
  };
  try {
    await section(["Providers", "Nhà cung cấp"], "Cập nhật CLI", "cli-updates");
    const lock = await ev(`(() => { const h = [...document.querySelectorAll(".modal.settings h3.sec")].find((e) => e.textContent.trim() === "Cập nhật CLI"), box = h?.nextElementSibling; if (!box) return null;
      return { sw: box.querySelector(".toggle")?.disabled, run: [...box.querySelectorAll("button")].find((b) => /Cập nhật ngay|Đang cập nhật/.test(b.textContent))?.disabled, note: !!box.querySelector(".api-own"), rows: box.querySelectorAll(".mr-row").length }; })()`);
    check(`${key} · Cập nhật CLI: ${who === "owner" ? "chủ sở hữu bấm được" : "quản trị viên thấy bị khóa kèm lời giải thích"}`, !!lock && lock.rows === 4 && (who === "owner" ? !lock.sw && !lock.run && !lock.note : lock.sw && lock.run && lock.note), JSON.stringify(lock));
    await section(["Providers", "Nhà cung cấp"], "Model mới", "new-models");
    const ml = await ev(`(() => { const h = [...document.querySelectorAll(".modal.settings h3.sec")].find((e) => e.textContent.trim() === "Model mới"), box = h?.nextElementSibling; if (!box) return null;
      return { sw: box.querySelector(".mr-auto .toggle")?.disabled, check: [...box.querySelectorAll("button")].find((b) => /Kiểm tra ngay|Đang kiểm tra/.test(b.textContent))?.disabled, note: !!box.querySelector(".api-own") }; })()`);
    check(`${key} · Model mới: ${who === "owner" ? "chủ sở hữu bấm được" : "tự nhận / Kiểm tra ngay bị khóa kèm lời giải thích"}`, !!ml && (who === "owner" ? !ml.sw && !ml.check && !ml.note : ml.sw && ml.check && ml.note), JSON.stringify(ml));
    await section(["Health", "Sức khỏe hệ thống"], "Sao lưu liên tục", "backup");
    const bl = await ev(`(() => { const c = document.querySelector(".bk-card"); if (!c) return null; return { inputs: [...c.querySelectorAll("input.field")].every((i) => i.disabled), sw: c.querySelector(".toggle")?.disabled, note: !!c.querySelector(".api-own"), drill: [...c.querySelectorAll("button")].some((b) => /Kiểm tra khôi phục|Test restore/.test(b.textContent)) }; })()`);
    check(`${key} · Sao lưu liên tục: ${who === "owner" ? "chủ sở hữu sửa được" : "ô cấu hình và công tắc bị khóa, vẫn có nút thử khôi phục"}`, !!bl && bl.drill && (who === "owner" ? !bl.inputs && !bl.sw && !bl.note : bl.inputs && bl.sw && bl.note), JSON.stringify(bl));
    await section(["Administrator", "Quản trị viên"], "Chống bot (Cloudflare Turnstile)", "bot-protection");
    const tl = await ev(`(() => { const c = document.querySelector(".bot-card"); if (!c) return null; return { inputs: [...c.querySelectorAll("input.field")].every((i) => i.disabled), note: !!c.querySelector(".api-own") }; })()`);
    check(`${key} · Chống bot: ${who === "owner" ? "chủ sở hữu sửa được" : "ô khóa bị khóa kèm lời giải thích"}`, !!tl && (who === "owner" ? !tl.inputs && !tl.note : tl.inputs && tl.note), JSON.stringify(tl));
  } catch (e) { check(`${key}: mở được các bảng`, false, String(e.message).slice(0, 300)); await shot("loi"); }
  check(`${key}: không có lỗi JavaScript`, !errs.length, errs.splice(0).slice(0, 3).join(" | "));
  await send("Target.closeTarget", { targetId });
}
ws.close(); chrome.kill();
await O("DELETE", `/api/admin/users/${adminId}`, { confirm: adEmail });
console.log(`\nẢnh: ${OUT}`);
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
