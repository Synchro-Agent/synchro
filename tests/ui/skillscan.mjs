// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/skillscan.mjs
// Kho kỹ năng → "Quét skill rác": bấm nút như người dùng, chọn model, quét mọi skill (của bạn và các thư viện) rồi xem bảng theo tab
// Rác / Không có tác dụng / Ổn / Chưa đọc được, mỗi skill một lý do (skill ổn kèm ngành nghề). Tắt và xóa ngay trong bảng, kết quả còn
// nguyên khi mở lại, quét tiếp ở nền khi đóng hộp thoại. Soát bố cục (không tràn, không đè, nằm trọn trong màn hình) ở máy tính,
// điện thoại, giao diện tối và khung Cài đặt.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/skillscan/";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(SCR, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-skillscan";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { origin: B, cookie, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
// Skill mẫu: mỗi loại kết quả ít nhất một skill (máy giả lập trả lời như model thật theo nội dung, xem mock-cli-common.cjs mockSkillScan).
const TAX = "# Kê khai thuế GTGT theo quý\n\nDùng cho kế toán doanh nghiệp Việt Nam khi lập tờ khai thuế giá trị gia tăng mẫu 01/GTGT.\n\n1. Tổng hợp hóa đơn đầu ra và đầu vào trong quý, đối chiếu với sổ kế toán.\n2. Loại hóa đơn đầu vào không đủ điều kiện khấu trừ (thiếu chứng từ thanh toán không dùng tiền mặt từ 20 triệu đồng).\n3. Tính số thuế phải nộp hoặc còn được khấu trừ chuyển kỳ sau, ghi rõ từng chỉ tiêu.\n4. Nhắc hạn nộp: ngày cuối cùng của tháng đầu quý sau.";
const SKILLS = {
  "scan-draft-todo": { d: "Skill mới", b: "TODO: viết hướng dẫn ở đây. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor." },
  "scan-empty-note": { d: "Ghi chú", b: "# Ghi chú\n\nXin chào." },
  "scan-polite-helper": { d: "Giúp trả lời tốt hơn", b: "# Trợ lý lịch sự\n\nLuôn trả lời lịch sự và thân thiện. Hãy suy nghĩ từng bước trước khi trả lời. Trả lời rõ ràng, dễ hiểu cho mọi câu hỏi của người dùng, không phân biệt chủ đề." },
  "scan-tax-vn": { d: "Lập tờ khai thuế GTGT theo quý cho doanh nghiệp Việt Nam", b: TAX },
  "scan-tax-copy": { d: "Bản sao của skill thuế", b: TAX },
  "scan-noverdict-x": { d: "Quy trình kiểm thử API trước khi phát hành", b: "# Kiểm thử API\n\nChạy bộ kiểm thử hợp đồng cho mọi endpoint, so sánh mã trạng thái và lược đồ JSON với tài liệu OpenAPI, ghi lại endpoint lệch chuẩn trước khi phát hành." },
};
// Bắt đầu từ trạng thái chưa quét lần nào; xóa mức dùng của tài khoản thử (giới hạn mức dùng không chặn model giả lập). Làm trước khi thêm
// skill: lưu skill là xếp mục Tài liệu / Trình bày / Thiết kế bằng model ở nền, hết hạn mức thì skill ở lại không nhãn mục và không thử lại.
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  const uid = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  db.exec("CREATE TABLE IF NOT EXISTS skill_scans (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL)");
  db.prepare("DELETE FROM skill_scans WHERE user_id = ?").run(uid); db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(uid); db.close(); }
for (const n of Object.keys(SKILLS)) await api("DELETE", `/api/skills/${n}`);
// Một skill rác nằm trong thư viện (đưa vào Thư viện cho mọi người thành thư viện "Mẫu thư viện" chỉ có skill đó): xóa trong bảng thì
// skill rời thư viện và thư viện trống được gỡ luôn.
const LIB = "scan-lib-placeholder";
for (const p of (await api("GET", "/api/plugins")).j.plugins ?? []) if (p.slug === `skill-${LIB}`) await api("DELETE", `/api/plugins/${p.id}`);
await api("DELETE", `/api/skills/${LIB}`);
{
  const fd = new FormData(); fd.append("file", new Blob([`---\nname: ${LIB}\ndescription: "Skill mẫu"\n---\n\n# Mẫu thư viện\n\nTODO: điền hướng dẫn ở đây. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.\n`], { type: "text/markdown" }), "SKILL.md");
  if ((await api("POST", "/api/skills", fd)).s !== 200 || (await api("POST", `/api/skills/${LIB}/share`, {})).s !== 200) throw new Error("không đưa được skill vào thư viện");
}
for (const [n, s] of Object.entries(SKILLS)) {
  const fd = new FormData(); fd.append("file", new Blob([`---\nname: ${n}\ndescription: ${JSON.stringify(s.d)}\n---\n\n${s.b}\n`], { type: "text/markdown" }), "SKILL.md");
  const r = await api("POST", "/api/skills", fd);
  if (r.s !== 200) throw new Error(`không thêm được ${n}: ${JSON.stringify(r.j)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Tải lại khi đang ở Kho kỹ năng thì trang mở lại thẳng Kho kỹ năng (#v=customize); A3 dựng sẵn tài khoản trong HTML nên không còn
// thoáng qua trang chủ có ô soạn tin: chờ khung app (thanh bên) thay vì chờ ô soạn tin.
const APP = `!!document.querySelector('.nav-item[data-nav="customize"]')`;
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9346", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9346/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(250); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const key = (k, code, vk) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }));
const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().includes(${JSON.stringify(t)}))`;
let fails = 0, shots = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };
const shot = async (name) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}${String(++shots).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64")); };
const view = async (w, h, mobile, theme = "light") => {
  await P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}` });
};
// Bố cục trong một vùng: mọi phần tử nhìn thấy nằm trọn trong vùng và trong màn hình, chữ không tràn khỏi ô của nó, nút không đè nhau.
const LAYOUT = (root) => `(() => {
  const R = document.querySelector(${JSON.stringify(root)}); if (!R) return ["không thấy " + ${JSON.stringify(root)}];
  const out = [], rb = R.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  if (rb.left < -0.5 || rb.top < -0.5 || rb.right > W + 0.5 || rb.bottom > H + 0.5) out.push("vùng ra ngoài màn hình " + JSON.stringify([rb.left, rb.top, rb.right, rb.bottom].map(Math.round)));
  const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0; };
  // Cắt bởi khung cuộn của chính hộp thoại thì không tính (danh sách cuộn được).
  const clipOf = (e) => { for (let p = e.parentElement; p && p !== R.parentElement; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(o.overflowX + o.overflowY)) return p.getBoundingClientRect(); } return rb; };
  for (const e of R.querySelectorAll("*")) {
    if (!vis(e) || e.closest("svg") && e.tagName !== "svg") continue;
    const b = e.getBoundingClientRect(), c = clipOf(e);
    if (e.closest(".scan-list") || e.closest(".scan-tabs")) { if (b.right > c.right + 1 && !e.closest(".scan-tabs")) out.push("tràn ngang: " + (e.className || e.tagName) + " " + (e.textContent || "").trim().slice(0, 40)); continue; }
    if (b.right > rb.right + 1 || b.left < rb.left - 1) out.push("ra ngoài hộp: " + (e.className || e.tagName) + " " + (e.textContent || "").trim().slice(0, 40));
    if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "hidden" && e.clientWidth > 0) out.push("chữ bị cắt: " + (e.textContent || "").trim().slice(0, 40));
  }
  // Phần nhìn thấy được của nút (cắt theo khung cuộn chứa nó): nút đã cuộn khuất dưới chân hộp thoại không tính là đè nhau.
  const seen = (e) => { const b = e.getBoundingClientRect(), c = clipOf(e); const l = Math.max(b.left, c.left), t = Math.max(b.top, c.top), r = Math.min(b.right, c.right), btm = Math.min(b.bottom, c.bottom); return r > l && btm > t ? { left: l, top: t, right: r, bottom: btm } : null; };
  const btns = [...R.querySelectorAll("button, select, .pl-search")].filter(vis).map((e) => [e, seen(e)]).filter(([, b]) => b);
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
    const [ea, a] = btns[i], [eb, b] = btns[j];
    if (ea.contains(eb) || eb.contains(ea)) continue;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push("đè nhau: " + (ea.textContent || ea.className).trim().slice(0, 30) + " / " + (eb.textContent || eb.className).trim().slice(0, 30));
  }
  return [...new Set(out)].slice(0, 12);
})()`;
// Phần tử trên cùng ở giữa hộp thoại có thuộc hộp thoại không (không bị lớp khác che).
const onTop = (sel) => `(() => { const m = document.querySelector(${JSON.stringify(sel)}); if (!m) return false; const b = m.getBoundingClientRect(); const pts = [[b.left + 20, b.top + 20], [b.right - 20, b.top + 20], [b.left + b.width / 2, b.top + b.height / 2], [b.left + 20, b.bottom - 20], [b.right - 20, b.bottom - 20]]; return pts.every(([x, y]) => m.contains(document.elementFromPoint(x, y))); })()`;
const openHub = async () => {
  if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger").catch(() => {}); await sleep(500); }
  await click(byText(".nav-item", "Kỹ năng"), "hub"); await until(`!!document.querySelector(".pl-top .pl-scan")`, 20000, "nút quét");
  await sleep(600);
};
const tabCount = (label) => ev(`(() => { const t = ${byText(".scan-tabs button", label)}; return t ? Number(t.querySelector("i").textContent) : -1; })()`);
const rowsOf = () => ev(`[...document.querySelectorAll(".scan-row")].map((r) => ({ name: r.querySelector(".scan-name b").textContent, why: r.querySelector(".scan-why").textContent.trim(), field: r.querySelector(".scan-why .pl-b")?.textContent ?? "", off: r.classList.contains("off") }))`);

try {
  // ---------------- máy tính, giao diện sáng
  await view(1440, 900, false);
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await openHub();
  // Đo giật: ghi mọi tác vụ dài (> 50ms, làm khựng giao diện) trong lúc mở hộp thoại, quét, chuyển tab, cuộn danh sách.
  await ev(`(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask" }); return true; })()`);
  check("thanh công cụ Kho kỹ năng có nút Quét skill rác", await ev(`document.querySelector(".pl-scan").textContent.includes("Quét skill rác")`));
  let lay = await ev(LAYOUT(".pl-top"));
  check("thanh công cụ không tràn, không đè", !lay.length, lay.join(" | "));
  await shot("toolbar");
  // Nhãn cạnh tên skill / thư viện (phiên bản, mục Tài liệu…) thẳng hàng với tên. Trước đây quy tắc .st của trang Artifacts rò sang nhãn
  // .pl-b.st (thêm lề dưới 32px) làm nhãn mục lệch lên trên.
  await until(`[...document.querySelectorAll(".pl-row2-h .pl-b.st")].length > 0`, 20000, "nhãn mục").catch(() => {});
  const skew = await ev(`[...document.querySelectorAll(".pl-row2-h")].flatMap((h) => { const c = [...h.children].map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }); return Math.max(...c) - Math.min(...c) > 3 ? [h.textContent.trim().slice(0, 40)] : []; })`);
  const nSt = await ev(`document.querySelectorAll(".pl-row2-h .pl-b.st").length`);
  check("nhãn cạnh tên skill thẳng hàng (kể cả nhãn mục Tài liệu / Trình bày / Thiết kế)", nSt > 0 && !skew.length, `${nSt} nhãn mục · lệch: ${skew.join(", ")}`);

  await click(`document.querySelector(".pl-scan")`, "scan");
  // Máy chủ còn chạy từ lần thử trước thì nhớ lần quét gần nhất: hộp thoại mở thẳng ra bảng kết quả, bấm Quét lại để về màn chọn model.
  await until(`!!document.querySelector(".scan-modal .scan-kinds, .scan-modal .scan-tabs")`, 10000, "hộp thoại");
  if (await ev(`!document.querySelector(".scan-modal .scan-kinds")`)) { await click(byText(".scan-modal .modal-foot .btn", "Quét lại"), "rescan first"); await until(`!!document.querySelector(".scan-modal .scan-kinds")`, 5000, "intro"); }
  await sleep(500);
  const { j: g } = await api("GET", "/api/skill-scan");
  const startText = await ev(`document.querySelector(".scan-modal .modal-foot .btn.dark").textContent`);
  check("hộp thoại giải thích ba loại và đếm đúng số skill sẽ quét", startText.includes(`Quét ${g.count} skill`) && g.count >= 6 && (await ev(`document.querySelectorAll(".scan-kinds li").length`)) === 3, `${startText} · máy chủ: ${g.count}`);
  const opts = await ev(`[...document.querySelectorAll("#scan-model option")].map((o) => o.value)`);
  check("chọn được model (Tự động + model dùng được)", opts[0] === "" && opts.length > 1, `${opts.length} lựa chọn`);
  check("hộp thoại nằm trên mọi lớp", await ev(onTop(".scan-modal")));
  lay = await ev(LAYOUT(".scan-modal"));
  check("hộp thoại (trước khi quét) không tràn, không đè", !lay.length, lay.join(" | "));
  await shot("intro");
  // Chọn model đầu tiên trong danh sách như người dùng.
  const chosen = opts[1];
  await ev(`(() => { const s = document.querySelector("#scan-model"); s.value = ${JSON.stringify(chosen)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(200);
  check("model đã chọn được giữ", (await ev(`document.querySelector("#scan-model").value`)) === chosen, chosen);

  const t0 = Date.now();
  await click(`document.querySelector(".scan-modal .modal-foot .btn.dark")`, "start");
  await until(`!!document.querySelector(".scan-modal .scan-stat")`, 15000, "bắt đầu quét");
  const sawProgress = await ev(`!!document.querySelector(".scan-modal .scan-bar") || /Đã quét/.test(document.querySelector(".scan-stat").textContent)`);
  check("đang quét: có tiến độ (số skill đã đọc, model) và nút Dừng", sawProgress);
  await shot("running");
  await until(`!document.querySelector(".scan-modal .scan-bar") && /Đã quét/.test(document.querySelector(".scan-stat")?.textContent ?? "")`, 240000, "quét xong");
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const stat = await ev(`document.querySelector(".scan-stat").textContent`);
  check("quét xong: dòng tổng kết ghi số skill và model", new RegExp(`Đã quét ${g.count} skill bằng `).test(stat), `${stat} · ${secs}s`);
  const { j: after } = await api("GET", "/api/skill-scan");
  check("máy chủ dùng đúng model đã chọn", after.job?.model === chosen, after.job?.model);

  // Tab Rác
  const nJunk = await tabCount("Skill rác"), nUseless = await tabCount("Không có tác dụng"), nOk = await tabCount("Ổn"), nUnk = await tabCount("Chưa đọc được");
  check("đủ các tab, đếm khớp tổng số skill", nJunk >= 4 && nUseless >= 1 && nOk >= 1 && nUnk >= 1 && nJunk + nUseless + nOk + nUnk === g.count, `rác ${nJunk} · không tác dụng ${nUseless} · ổn ${nOk} · chưa đọc ${nUnk} / ${g.count}`);
  let rows = await rowsOf();
  const r = (n) => rows.find((x) => x.name === n);
  check("tab Rác mở đầu tiên, có skill chữ mẫu, skill trống, bản trùng và skill rác trong thư viện", !!r("scan-draft-todo") && !!r("scan-empty-note") && !!r("scan-tax-copy") && rows.find((x) => x.name === LIB) && (await ev(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === ${JSON.stringify(LIB)})?.querySelector(".scan-where").textContent`)) === "Mẫu thư viện", rows.map((x) => x.name).join(", "));
  check("skill trong thư viện cũng có nút Xóa, tab có nút Xóa tất cả", await ev(`!![...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === ${JSON.stringify(LIB)})?.querySelector(".scan-del") && /Xóa tất cả/.test(document.querySelector(".scan-tools .scan-danger")?.textContent ?? "")`));
  check("mỗi skill rác có lý do cụ thể", rows.every((x) => x.why.length > 15) && /gần như trống/.test(r("scan-empty-note")?.why ?? "") && /Trùng hệt nội dung với “scan-tax-vn”/.test(r("scan-tax-copy")?.why ?? ""), `${r("scan-empty-note")?.why} | ${r("scan-tax-copy")?.why}`);
  lay = await ev(LAYOUT(".scan-modal"));
  check("bảng kết quả không tràn, không đè", !lay.length, lay.join(" | "));
  await shot("tab-junk");

  await click(byText(".scan-tabs button", "Không có tác dụng"), "useless tab"); await sleep(300);
  rows = await rowsOf();
  check("tab Không có tác dụng: skill chỉ dặn điều model vốn làm, nói rõ không phục vụ ngành nghề nào", /ngành nghề/.test(r("scan-polite-helper")?.why ?? ""), r("scan-polite-helper")?.why);
  await click(byText(".scan-tabs button", "Ổn"), "ok tab"); await sleep(300);
  rows = await rowsOf();
  check("tab Ổn: skill thật kèm ngành nghề", r("scan-tax-vn")?.field === "Kế toán", JSON.stringify(r("scan-tax-vn")));
  check("tab Ổn không có nút tắt / xóa", !(await ev(`!!document.querySelector(".scan-act")`)));
  // Cuộn danh sách dài (tab Ổn) bằng con lăn chuột như người dùng.
  { const c = await ev(`(() => { const b = document.querySelector(".scan-list").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    for (let i = 0; i < 10; i++) { await P("Input.dispatchMouseEvent", { type: "mouseWheel", x: c[0], y: c[1], deltaX: 0, deltaY: i < 6 ? 300 : -300 }); await sleep(60); } }
  await sleep(300);
  const lt = await ev(`window.__lt`);
  check("không giật: không tác vụ nào chặn giao diện quá 200ms (mở hộp thoại, quét, chuyển tab, cuộn)", lt.every((x) => x <= 200), `${lt.length} tác vụ dài, lâu nhất ${Math.max(0, ...lt)}ms`);
  lay = await ev(LAYOUT(".scan-modal"));
  check("tab Ổn (nhiều skill thư viện) không tràn, không đè", !lay.length, lay.join(" | "));
  await shot("tab-ok");
  await click(byText(".scan-tabs button", "Chưa đọc được"), "unknown tab"); await sleep(300);
  rows = await rowsOf();
  check("tab Chưa đọc được: skill model không trả lời, gợi ý quét lại", /Quét lại/.test(r("scan-noverdict-x")?.why ?? ""), r("scan-noverdict-x")?.why);

  // Tắt và xóa ngay trong bảng
  await click(byText(".scan-tabs button", "Skill rác"), "junk tab"); await sleep(300);
  await click(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === "scan-draft-todo").querySelector(".scan-act .btn")`, "turn off");
  await until(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === "scan-draft-todo")?.classList.contains("off")`, 10000, "đã tắt");
  const sk = (await api("GET", "/api/skills")).j.skills;
  check("bấm Tắt: skill tắt thật, hàng hiện nhãn Tắt và nút Bật lại", sk.find((x) => x.name === "scan-draft-todo")?.enabled === false && (await ev(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === "scan-draft-todo").querySelector(".scan-act .btn").textContent.includes("Bật")`)));
  await click(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === "scan-empty-note").querySelector(".scan-del")`, "delete");
  await until(`!!document.querySelector(".overlay.cf-top")`, 5000, "hộp xác nhận");
  check("hộp xác nhận xóa nằm trên hộp thoại quét", await ev(onTop(".overlay.cf-top .modal")));
  await click(`document.querySelector(".overlay.cf-top .btn.danger")`, "confirm");
  await until(`![...document.querySelectorAll(".scan-row")].some((x) => x.querySelector("b").textContent === "scan-empty-note")`, 10000, "đã xóa");
  check("bấm Xóa: skill bị xóa thật, biến khỏi bảng", (await api("GET", "/api/skills")).j.skills.every((x) => x.name !== "scan-empty-note"));
  // Xóa skill rác trong thư viện: hộp xác nhận nói rõ xóa khỏi thư viện; thư viện chỉ có skill đó thì được gỡ luôn.
  await click(`[...document.querySelectorAll(".scan-row")].find((x) => x.querySelector("b").textContent === ${JSON.stringify(LIB)}).querySelector(".scan-del")`, "delete lib skill");
  await until(`!!document.querySelector(".overlay.cf-top")`, 5000, "xác nhận xóa khỏi thư viện");
  const cf = await ev(`document.querySelector(".overlay.cf-top .modal").textContent`);
  check("xác nhận xóa skill thư viện: nói rõ xóa khỏi thư viện, không quay lại khi cập nhật", /khỏi thư viện Mẫu thư viện\?/.test(cf) && /không quay lại khi cập nhật/.test(cf), cf.slice(0, 160));
  await click(`document.querySelector(".overlay.cf-top .btn.danger")`, "confirm lib");
  await until(`![...document.querySelectorAll(".scan-row")].some((x) => x.querySelector("b").textContent === ${JSON.stringify(LIB)})`, 10000, "đã xóa khỏi thư viện");
  // Đọc lời báo trước (sống khoảng 2,5 giây), rồi mới hỏi máy chủ: máy chậm thì một lần hỏi API đủ để lời báo tắt mất.
  await until(`[...document.querySelectorAll(".toast, [role=status]")].some((e) => /đã gỡ 1 thư viện trống/.test(e.textContent))`, 4000, "báo gỡ thư viện").catch(() => {});
  const toast = await ev(`[...document.querySelectorAll(".toast, [role=status]")].map((e) => e.textContent).join(" | ")`);
  const libGone = !((await api("GET", "/api/plugins")).j.plugins ?? []).some((p) => p.slug === `skill-${LIB}`);
  check("xóa skill cuối của thư viện: thư viện trống được gỡ, báo một dòng", libGone && /đã gỡ 1 thư viện trống/.test(toast), toast.slice(0, 160));
  // Xóa tất cả trong tab Không có tác dụng.
  await click(byText(".scan-tabs button", "Không có tác dụng"), "useless tab 2"); await sleep(300);
  const nDel = await ev(`document.querySelectorAll(".scan-row").length`);
  await click(`document.querySelector(".scan-tools .scan-danger")`, "delete all");
  await until(`!!document.querySelector(".overlay.cf-top")`, 5000, "xác nhận xóa tất cả");
  const allTitle = await ev(`document.querySelector(".overlay.cf-top h2").textContent`);
  check("Xóa tất cả: hộp xác nhận ghi đúng số skill (một skill thì ghi tên)", allTitle === (nDel === 1 ? 'Xóa skill "scan-polite-helper"?' : `Xóa ${nDel} skill?`), `${allTitle} · ${nDel} hàng`);
  await click(`document.querySelector(".overlay.cf-top .btn.danger")`, "confirm all");
  await until(`!document.querySelector(".scan-row")`, 10000, "tab trống");
  check("Xóa tất cả: tab trống, skill bị xóa thật", (await api("GET", "/api/skills")).j.skills.every((x) => x.name !== "scan-polite-helper") && (await tabCount("Không có tác dụng")) === 0);
  await click(byText(".scan-tabs button", "Skill rác"), "junk tab 2"); await sleep(300);

  // Đóng rồi mở lại: kết quả còn nguyên (không quét lại), trạng thái tắt cập nhật đúng.
  await key("Escape", "Escape", 27); await sleep(400);
  check("Esc đóng hộp thoại", !(await ev(`!!document.querySelector(".scan-modal")`)));
  await click(`document.querySelector(".pl-scan")`, "scan again"); await until(`!!document.querySelector(".scan-modal .scan-tabs")`, 10000, "kết quả cũ");
  rows = await rowsOf();
  check("mở lại: thấy ngay kết quả lần trước, skill đã xóa không còn, skill đã tắt vẫn tắt", !r("scan-empty-note") && r("scan-draft-todo")?.off === true);

  // Quét lại rồi đóng hộp thoại: vẫn chạy ở nền, nút có vòng xoay, xong thì báo một dòng.
  await click(byText(".scan-modal .modal-foot .btn", "Quét lại"), "rescan"); await until(`!!document.querySelector(".scan-modal .scan-kinds")`, 5000, "intro");
  check("Quét lại giữ model đã chọn lần trước", (await ev(`document.querySelector("#scan-model").value`)) === chosen);
  await click(`document.querySelector(".scan-modal .modal-foot .btn.dark")`, "start 2"); await until(`!!document.querySelector(".scan-modal .scan-stat")`, 15000, "chạy lần 2");
  await key("Escape", "Escape", 27);
  await until(`!!document.querySelector(".pl-scan.busy .art-spin")`, 5000, "vòng xoay ở nút");
  check("đóng hộp thoại khi đang quét: nút hiện vòng xoay (vẫn quét ở nền)", true);
  await until(`!document.querySelector(".pl-scan.busy")`, 240000, "quét nền xong");
  await until(`[...document.querySelectorAll(".toast, [role=status]")].some((e) => /Đã quét xong \\d+ skill/.test(e.textContent))`, 8000, "báo xong").then(() => check("quét xong ở nền: báo một dòng tổng kết", true)).catch(() => check("quét xong ở nền: báo một dòng tổng kết", false));

  // ---------------- giao diện tối
  await view(1440, 900, false, "dark");
  await P("Page.reload"); await until(APP, 30000, "app"); await openHub();
  await click(`document.querySelector(".pl-scan")`, "scan dark"); await until(`!!document.querySelector(".scan-modal .scan-tabs")`, 10000, "dark modal"); await sleep(400);
  lay = await ev(LAYOUT(".scan-modal"));
  check("giao diện tối: không tràn, không đè", !lay.length, lay.join(" | "));
  const contrast = await ev(`(() => { const c = (s) => s.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number); const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const m = document.querySelector(".scan-modal"); let bg = getComputedStyle(m).backgroundColor; if (/rgba\\(.*, 0\\)/.test(bg) || bg === "transparent") bg = getComputedStyle(m, "::before").backgroundColor;
    const fg = getComputedStyle(document.querySelector(".scan-why span:last-child")).color; const a = L(c(bg)), b = L(c(fg)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10; })()`);
  check("giao diện tối: chữ lý do đủ tương phản với nền", contrast >= 4.5, `tỷ lệ ${contrast}`);
  await shot("dark");
  await key("Escape", "Escape", 27);

  // ---------------- điện thoại
  await view(390, 844, true);
  await P("Page.reload"); await until(APP, 30000, "app"); await openHub();
  lay = await ev(LAYOUT(".pl-top"));
  check("điện thoại: nút quét chỉ còn biểu tượng, thanh công cụ không tràn, không đè", !lay.length && (await ev(`getComputedStyle(document.querySelector(".pl-scan-l")).display === "none"`)), lay.join(" | "));
  await shot("phone-toolbar");
  await click(`document.querySelector(".pl-scan")`, "scan phone"); await until(`!!document.querySelector(".scan-modal .scan-tabs")`, 10000, "phone modal"); await sleep(400);
  lay = await ev(LAYOUT(".scan-modal"));
  check("điện thoại: hộp thoại không tràn, không đè, lý do xuống dòng dưới tên", !lay.length && (await ev(`(() => { const r = document.querySelector(".scan-row"); return r.querySelector(".scan-why").getBoundingClientRect().top >= r.querySelector(".scan-name").getBoundingClientRect().bottom - 1; })()`)), lay.join(" | "));
  const tabsCut = await ev(`(() => { const t = document.querySelector(".scan-tabs").getBoundingClientRect(), m = document.querySelector(".scan-modal").getBoundingClientRect(); return [...document.querySelectorAll(".scan-tabs button")].filter((b) => { const r = b.getBoundingClientRect(); return r.left < t.left - 1 || r.right > t.right + 1 || r.right > m.right - 1; }).map((b) => b.textContent); })()`);
  check("điện thoại: thấy trọn mọi tab (không bị cắt, không phải vuốt ngang)", !tabsCut.length, tabsCut.join(", "));
  await shot("phone-modal");
  await click(byText(".scan-modal .modal-foot .btn", "Quét lại"), "rescan phone"); await sleep(400);
  lay = await ev(LAYOUT(".scan-modal"));
  check("điện thoại: màn chọn model không tràn, không đè", !lay.length, lay.join(" | "));
  await shot("phone-intro");
  await key("Escape", "Escape", 27);

  // ---------------- Cài đặt → Kho kỹ năng (khung hẹp)
  await view(1280, 800, false);
  await P("Page.reload"); await until(APP, 30000, "app"); await sleep(800);
  await click(`document.querySelector(".rail .user, .shell-side .user, [aria-label='Tài khoản']")`, "user menu"); await sleep(500);
  await click(byText(".menu-item", "Cài đặt"), "settings"); await sleep(1000);
  await click(byText(".s-nav button", "Kho kỹ năng"), "settings hub"); await until(`!!document.querySelector(".modal.settings .pl-scan")`, 15000, "nút quét trong Cài đặt");
  await sleep(500);
  lay = await ev(LAYOUT(".modal.settings .pl-top"));
  check("Cài đặt → Kho kỹ năng: thanh công cụ không tràn, không đè", !lay.length, lay.join(" | "));
  await click(`document.querySelector(".modal.settings .pl-scan")`, "scan in settings"); await until(`!!document.querySelector(".scan-modal")`, 10000, "modal in settings"); await sleep(400);
  check("Cài đặt: hộp thoại quét nằm trên khung Cài đặt", await ev(onTop(".scan-modal")));
  await shot("settings");
} catch (e) { check("lỗi khi chạy", false, e.stack?.split("\n").slice(0, 3).join(" | ")); await shot("fail").catch(() => {}); }

for (const n of Object.keys(SKILLS)) await api("DELETE", `/api/skills/${n}`);
for (const p of (await api("GET", "/api/plugins")).j.plugins ?? []) if (p.slug === `skill-${LIB}`) await api("DELETE", `/api/plugins/${p.id}`);
check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
console.log("  ảnh chụp:", SCR);
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
