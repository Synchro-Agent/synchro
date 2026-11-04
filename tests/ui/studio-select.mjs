// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/studio-select.mjs
// Nút studio trong chi tiết plugin: Tự động nhận diện (mặc định), Không, Thiết kế, Trình bày, Tài liệu; dòng cho biết đã xếp bao nhiêu skill vào mục nào.
// Trang Artifacts: số skill có phân cách hàng nghìn, nói rõ gồm skill tự nhận diện, danh sách có tìm kiếm và tải theo trang.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/studio-select/";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(SCR, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-studio-select";
rmSync(PROF, { recursive: true, force: true });

let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { origin: B, cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
// Dữ liệu mẫu ghi thẳng vào data-mock rồi nhờ API xếp mục: một plugin nhỏ (hiện trong Kho kỹ năng) và một thư viện của danh mục có hơn 1.000 skill thiết kế.
const db = new (createRequire(process.cwd() + "/package.json")("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
const SMALL = "pl_uistudiosmall", BIG = "pl_uistudiobig", DESIGN = 12, DOCS = 3, MANY = 1200;
const wipe = () => db.transaction(() => { for (const id of [SMALL, BIG]) { db.prepare("DELETE FROM skill_studios WHERE key >= ? AND key < ?").run(`p:${id}:`, `p:${id};`); db.prepare("DELETE FROM plugin_skills WHERE plugin_id = ?").run(id); db.prepare("DELETE FROM plugins WHERE id = ?").run(id); } })();
wipe();
{
  const now = Date.now(), rep = JSON.stringify({ name: "x", risk: "none", license: "MIT", repo: "x", dir: ".", files: 1, size: 1, scripts: 0, licenseKind: "open", flags: [], description: "x" });
  const insP = db.prepare("INSERT INTO plugins (id, owner, slug, catalog_id, name, description, sources, created_at, updated_at) VALUES (?, 'org', ?, ?, ?, ?, '[]', ?, ?)");
  const insS = db.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled) VALUES (?, ?, ?, ?, 'Hướng dẫn.', '', '[]', ?, 1)");
  db.transaction(() => {
    insP.run(SMALL, "ui-studio-small", null, "Studio Select Fixture", "Plugin mẫu cho kiểm thử nút studio", now, now);
    for (let i = 0; i < DESIGN; i++) insS.run(`${SMALL}-d${i}`, SMALL, `uifix-logo-${i}`, "Thiết kế logo, bảng màu và phông chữ cho bộ nhận diện thương hiệu.", rep);
    for (let i = 0; i < DOCS; i++) insS.run(`${SMALL}-t${i}`, SMALL, `uifix-bao-cao-${i}`, "Viết báo cáo công việc tuần cho sếp theo mẫu của công ty: kết quả, chỉ số, vướng mắc, kế hoạch tuần tới.", rep);
    insP.run(BIG, "ui-studio-big", "cd:test/ui-studio-big", "UI Studio Big", "Thư viện mẫu của danh mục", now, now);
    for (let i = 0; i < MANY; i++) insS.run(`${BIG}-${i}`, BIG, `uibig-poster-${i}`, `Design a poster for event number ${i}.`, rep);
    insS.run(`${BIG}-zebra`, BIG, "uibig-zebra-poster", "Design a poster about zebra conservation.", rep);
  })();
}
for (const id of [SMALL, BIG]) await api("PATCH", `/api/plugins/${id}`, { studio: "auto" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9361", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9361/json/version").then((r) => r.json()).catch(() => null); }
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
const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().includes(${JSON.stringify(t)}))`;
let fails = 0, shots = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${!ok && extra ? " — " + extra : ""}`); if (!ok) fails++; };
const shot = async (name) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}${String(++shots).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64")); };
const setView = (w, h, mobile) => P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const openHub = async () => {
  if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger").catch(() => {}); await sleep(300); }
  await click(byText(".nav-item", "Kỹ năng"), "hub"); await until(`!!document.querySelector(".pl-top")`, 20000, "Kho kỹ năng");
  await sleep(500);
};
const SEL = `document.querySelector(".pl-modal select.pl-sel")`;
const setMode = async (v) => {
  await ev(`(() => { const s = ${SEL}; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, ${JSON.stringify("")} + ${JSON.stringify(v)}); s.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()`);
  await until(`${SEL}.value === ${JSON.stringify(v)}`, 5000, "chọn " + v);
  await sleep(500);
};
const rowText = () => ev(`${SEL}.closest(".pl-row").innerText`);

try {
  await setView(1440, 900, false);
  await P("Page.navigate", { url: B });
  await until(`!!document.querySelector(".nav-item")`, 60000, "trang chủ");
  await sleep(800);
  await openHub();
  await click(byText(".pl-row2, .pl-card", "Studio Select Fixture"), "plugin mẫu");
  await until(`!!${SEL}`, 10000, "hộp chi tiết plugin");
  await until(`!!document.querySelector(".pl-det")`, 10000, "dòng đã nhận diện");

  const opts = await ev(`[...${SEL}.options].map((o) => [o.value, o.textContent])`);
  check("đủ 5 lựa chọn đúng thứ tự", opts.map((o) => o[0]).join() === "auto,none,design,slides,docs", opts.map((o) => o[0]).join());
  check("tên tiếng Việt", opts.map((o) => o[1]).join() === "Tự động nhận diện,Không,Thiết kế,Trình bày,Tài liệu", opts.map((o) => o[1]).join());
  check("mặc định là Tự động nhận diện", await ev(`${SEL}.value`) === "auto");
  let t = await rowText();
  check("mô tả theo chế độ", t.includes("Synchro tự xếp từng skill"));
  check("cho biết đã xếp gì", t.includes(`${DESIGN} skill ở Thiết kế, ${DOCS} skill ở Tài liệu`));
  await shot("auto");

  await setMode("none");
  t = await rowText();
  check("Không: đổi mô tả, bỏ dòng đã xếp", t.includes("không được xếp vào mục nào") && !(await ev(`!!document.querySelector(".pl-det")`)));
  check("Không: máy chủ đã bỏ nhãn tự động", !Object.keys((await api("GET", `/api/plugins/${SMALL}`)).j.plugin.detected).length);
  await shot("none");
  await setMode("slides");
  t = await rowText();
  check("Tên mục: cả thư viện vào nút đó", t.includes("Bấm nút này") && (await api("GET", `/api/plugins/${SMALL}`)).j.plugin.studio === "slides");
  await setMode("auto");
  await until(`!!document.querySelector(".pl-det")`, 10000, "dòng đã nhận diện sau khi đổi lại");
  t = await rowText();
  check("Chuyển lại: xếp lại", t.includes(`${DESIGN} skill ở Thiết kế, ${DOCS} skill ở Tài liệu`));

  // Điện thoại: hàng nút studio không tràn khỏi hộp.
  await setView(390, 844, true);
  await sleep(400);
  const over = await ev(`(() => { const r = ${SEL}.closest(".pl-row").getBoundingClientRect(), s = ${SEL}.getBoundingClientRect(), m = document.querySelector(".pl-modal").getBoundingClientRect(); return [s.right <= r.right + 1, s.left >= r.left - 1, r.right <= m.right + 1, document.documentElement.scrollWidth <= innerWidth + 1]; })()`);
  check("điện thoại: chọn nút studio không tràn", over.every(Boolean), JSON.stringify(over));
  await shot("phone-select");
  await setView(1440, 900, false);
  await P("Page.navigate", { url: B });
  await until(`!!document.querySelector(".nav-item")`, 60000, "trang chủ");
  await sleep(800);

  // Trang Artifacts
  await click(byText(".nav-item", "Artifacts"), "Artifacts");
  await until(`!!document.querySelector(".st-tag")`, 20000, "các mục");
  const tags = await ev(`[...document.querySelectorAll(".st-opt")].map((o) => o.innerText.replace(/\\s+/g, " "))`);
  const design = tags.find((x) => x.includes("Thiết kế")) ?? "";
  check("số skill có phân cách hàng nghìn", /\b1\.2\d\d skill/.test(design), design);
  await ev(`(() => { const o = ${byText(".st-opt", "Thiết kế")}; o.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return 1; })()`);
  await until(`(document.querySelector(".st-capb")?.textContent ?? "").includes("tự nhận diện")`, 5000, "dòng nói rõ tự nhận diện");
  const cap = await ev(`document.querySelector(".st-capb").textContent`);
  check("nói rõ gồm skill tự nhận diện", /1\.2\d\d skill, gồm [\d.]+ skill Synchro tự nhận diện/.test(cap), cap);
  await shot("artifacts");
  await ev(`document.querySelector(".st-capb").click(), 1`);
  await until(`document.querySelectorAll(".st-shelf-row").length === 40`, 10000, "trang đầu của danh sách");
  check("danh sách theo trang: 40 dòng đầu", true);
  await shot("shelf");
  await click(`document.querySelector(".st-shelf-more")`, "Xem thêm");
  await until(`document.querySelectorAll(".st-shelf-row").length === 80`, 10000, "trang kế");
  check("Xem thêm: tải tiếp", true);
  await ev(`(() => { const i = document.querySelector(".st-shelf-q"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "zebra"); i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
  await until(`document.querySelectorAll(".st-shelf-row").length === 1`, 10000, "kết quả tìm");
  check("tìm trong mục", (await ev(`document.querySelector(".st-shelf-row b").textContent`)) === "uibig-zebra-poster");
  await setView(390, 844, true);
  await sleep(400);
  const m = await ev(`(() => { const b = document.querySelector(".st-shelf").getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`);
  check("điện thoại: danh sách nằm trọn màn hình", m);
  await shot("shelf-phone");
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector(".st-shelf")`, 5000, "đóng bằng Esc");
  check("đóng bằng Esc", true);
  // Mở lại ở khổ điện thoại (thanh bên đóng): dòng số skill không đè nút tạo.
  await P("Page.navigate", { url: B });
  await until(`!!document.querySelector(".nav-item")`, 60000, "trang chủ");
  await sleep(600);
  await ev(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.includes("Artifacts")).click(), 1`);
  await until(`!!document.querySelector(".st-tag")`, 20000, "các mục");
  await sleep(600);
  await ev(`(() => { const o = ${byText(".st-opt", "Thiết kế")}; o.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return 1; })()`);
  await until(`!!document.querySelector(".st-capb")`, 5000, "dòng số skill");
  await sleep(400);
  await shot("artifacts-phone");
  const oc = await ev(`(() => { const b = document.querySelector(".st-capb").getBoundingClientRect(), g = document.querySelector(".st-go").getBoundingClientRect(); return b.right <= g.left + 1 && b.left >= 0 && document.documentElement.scrollWidth <= innerWidth + 1; })()`);
  check("điện thoại: dòng số skill không đè nút tạo", oc);
  check("không có lỗi JavaScript", !errs.length, errs.join(" | "));
} catch (e) {
  fails++;
  console.log("✗ dừng giữa chừng:", e.message);
  await shot("loi").catch(() => {});
} finally {
  await api("DELETE", `/api/plugins/${SMALL}`).catch(() => {});
  await api("DELETE", `/api/plugins/${BIG}`).catch(() => {});
  wipe(); db.close();
  chrome.kill();
  console.log(`\n${fails ? `${fails} lỗi` : "Tất cả đạt"}. Ảnh: ${SCR}`);
}
process.exit(fails ? 1 : 0);
