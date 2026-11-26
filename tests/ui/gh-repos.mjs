// Hộp thoại Repo GitHub trên giao diện thật (dev:mock, GitHub giả lập): repo nhóm theo chủ (cá nhân / tổ chức),
// tìm trên toàn bộ danh sách, "Xem thêm" tải trang sau, tổ chức chặn Synchro có nút Cấp quyền đúng trang GitHub,
// clone repo của tổ chức bị chặn báo một câu kèm nút, kết nối cũ thiếu quyền được mời kết nối lại.
// Ảnh chụp sáng / tối, máy tính / điện thoại trong thư mục tạm synchro-ui/. Chạy tay: node tests/ui/gh-repos.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:3200", GH = process.env.GH_URL ?? "http://127.0.0.1:4013";
const CDP = process.env.CDP_PORT ?? "9371";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-gh-repos-" + CDP;
rmSync(PROF, { recursive: true, force: true });
let cookie = "";
const api = async (method, p, body, extra = {}) => {
  const headers = { "content-type": "application/json", origin: B, cookie, ...extra };
  const data = body === undefined ? undefined : JSON.stringify(body);
  const r = await fetch(B + p, { method, redirect: "manual", headers, body: data });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null;
  try { j = await r.json(); } catch { /* chuyển hướng / không có nội dung JSON */ }
  return { s: r.status, j, h: r.headers };
};
const gh = (p, body) => fetch(GH + p, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
// Kết nối GitHub (giả lập) như khi bấm Cho phép trong cửa sổ cấp quyền.
const connectGh = async () => {
  const r = await api("GET", "/api/github/connect");
  const state = (r.h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const page = await fetch(r.h.get("location")).then((x) => x.text());
  const back = /id="allow" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
  await fetch(back, { redirect: "manual", headers: { cookie: `${cookie}; ${state}` } });
};

await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
if (!cookie) throw new Error("login failed");
// 55 repo cá nhân (hơn một trang 50), hai repo của tổ chức, một tổ chức chặn ứng dụng ngoài.
const tag = Date.now().toString(36);
for (let i = 0; i < 55; i++) await gh("/_mock/repo", { repo: `mock-dev/proj-${tag}-${String(i).padStart(2, "0")}` });
await gh("/_mock/repo", { repo: "acme-labs/site" });
await gh("/_mock/repo", { repo: "acme-labs/api" });
await gh("/_mock/repo", { repo: "locked-co/secret" });
await gh("/_mock/scopes", { scopes: null });
await api("DELETE", "/api/github");
await connectGh();

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run",
  "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50 && !ver; i++) {
  await sleep(200);
  ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) {
    const [ok, no] = waits.get(m.id);
    waits.delete(m.id);
    m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++seq;
  waits.set(id, [ok, no]);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
const size = (w, h, mobile = false) =>
  P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
await size(1440, 900);
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 30000, what = expr) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); }
  throw new Error("timeout: " + what);
};
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" });
    const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  }
};
const type = async (expr, text) => {
  await click(expr, "input");
  await ev(`(() => { const el = ${expr}; el.select?.(); return 1; })()`);
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  if (text) await P("Input.insertText", { text });
};
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};
const shot = async (n) => {
  const { data } = await P("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SCR}gh-repos-${n}.png`, Buffer.from(data, "base64"));
};
const M = `document.querySelector(".gh-modal")`;
const groups = `[...document.querySelectorAll(".gh-grp")].map((g) => ({ owner: g.querySelector("b")?.textContent,
  kind: g.querySelector(".gh-grp-t span")?.textContent, block: !!g.querySelector(".gh-grp-b"),
  fix: g.querySelector(".gh-fix")?.getAttribute("href") ?? null }))`;
// Không có chữ hay nút nào tràn khỏi hộp thoại, hộp thoại không rộng hơn màn hình.
const fits = `(() => { const m = ${M}.getBoundingClientRect();
  const bad = [...${M}.querySelectorAll("*")].filter((e) => {
  const b = e.getBoundingClientRect(); return b.width && (b.right > m.right + 1 || b.left < m.left - 1); })
  .map((e) => e.className || e.tagName); return { w: Math.round(m.width), vw: innerWidth, bad: bad.slice(0, 5),
  over: document.documentElement.scrollWidth > innerWidth }; })()`;
const openDialog = async () => {
  // Ngay sau khi tải trang, nút GitHub chưa biết workspace đã sẵn sàng (bấm chỉ hiện lời nhắc): bấm lại tới khi mở.
  const btn = `[...document.querySelectorAll(".cv-gh")].find((e) => e.getBoundingClientRect().width)`;
  for (let i = 0; i < 15 && !(await ev(`!!${M}`)); i++) {
    await click(btn, "GitHub button");
    await until(`!!${M}`, 2000, "dialog").catch(() => false);
  }
  await until(`!!${M} && !!document.querySelector(".gh-grp")`, 30000, "repo list");
};
const closeDialog = () => click(`${M}.querySelector(".gh-head .icon-btn")`, "close");
const theme = (t) => ev(`(document.documentElement.dataset.theme = ${JSON.stringify(t)}, 1)`);

try {
  await P("Page.navigate", { url: B + "/" });
  const nav = `[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`;
  await until(`!!${nav}`, 30000, "app");
  await click(nav, "Code nav");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button");
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace mock");

  console.log("1. Nhóm theo chủ, tổ chức bị chặn có nút Cấp quyền");
  await openDialog();
  const g = await ev(groups);
  const by = Object.fromEntries(g.map((x) => [x.owner, x]));
  ok(g[0]?.owner === "locked-co" && by["locked-co"].block,
    "tổ chức bị chặn (chưa có repo nào hiện) đứng đầu, có dòng báo", g);
  ok(/\/settings\/connections\/applications\/mock-github-client$/.test(by["locked-co"]?.fix ?? ""),
    "nút Cấp quyền mở trang ứng dụng đã cấp quyền trên GitHub", by["locked-co"]);
  ok(by["mock-dev"]?.kind === "Cá nhân" && !by["mock-dev"].block, "nhóm cá nhân", by["mock-dev"]);
  const n1 = await ev(`document.querySelectorAll(".gh-repo").length`);
  ok(n1 === 50, "trang đầu 50 repo", n1);
  ok(await ev(`/Xem thêm/.test(${M}.querySelector(".gh-more")?.textContent ?? "")`), "có nút Xem thêm");
  ok(!(await ev(`!!${M}.querySelector(".gh-scope")`)), "kết nối mới đủ quyền: không mời kết nối lại");
  let f = await ev(fits);
  ok(!f.bad.length && !f.over, "không có gì tràn khỏi hộp thoại (máy tính)", f);
  await shot("light-desktop");
  await theme("dark");
  await sleep(200);
  await shot("dark-desktop");
  await theme("light");

  console.log("2. Xem thêm và tìm kiếm");
  // Dữ liệu GitHub giả lập còn repo của các lần chạy trước: bấm Xem thêm tới hết danh sách (có giới hạn).
  for (let i = 0; i < 20 && (await ev(`!!${M}.querySelector(".gh-more")`)); i++) {
    const before = await ev(`document.querySelectorAll(".gh-repo").length`);
    await click(`${M}.querySelector(".gh-more")`, "more");
    await until(`document.querySelectorAll(".gh-repo").length > ${before}`, 15000, "next page");
  }
  const owners = await ev(groups);
  ok(owners.some((x) => x.owner === "acme-labs" && x.kind === "Tổ chức"), "trang sau có nhóm tổ chức acme-labs",
    owners);
  const all = await ev(`[...document.querySelectorAll(".gh-repo b")].map((e) => e.textContent)`);
  ok(all.filter((x) => x.startsWith(`proj-${tag}-`)).length === 55 && all.includes("site") && all.includes("api"),
    "đủ mọi repo sau khi xem thêm", all.length);
  await type(`${M}.querySelector(".gh-search input")`, "site");
  await until(`document.querySelectorAll(".gh-repo").length === 1`, 10000, "search result");
  const one = await ev(`[...document.querySelectorAll(".gh-grp b, .gh-repo b")].map((e) => e.textContent)`);
  ok(one.join(" ") === "acme-labs site", "tìm 'site': chỉ còn acme-labs/site dưới nhóm của nó", one);
  await type(`${M}.querySelector(".gh-search input")`, "");
  await until(`document.querySelectorAll(".gh-repo").length === 50`, 10000, "search cleared");

  console.log("3. Clone repo của tổ chức bị chặn");
  await type(`${M}.querySelector(".gh-url input")`, "locked-co/secret");
  await click(`${M}.querySelector(".gh-url .btn")`, "clone");
  await until(`!!${M}.querySelector(".gh-err")`, 60000, "clone error");
  const err = await ev(`({ t: ${M}.querySelector(".gh-err").innerText,
    href: ${M}.querySelector(".gh-err .gh-fix")?.href ?? "" })`);
  ok(/chặn ứng dụng bên ngoài/.test(err.t) && /locked-co/.test(err.t), "báo một câu: tổ chức chặn, kèm tên tổ chức",
    err.t);
  ok(/applications\/mock-github-client$/.test(err.href), "nút Cấp quyền ngay trong lời báo", err.href);
  f = await ev(fits);
  ok(!f.bad.length, "lời báo và nút không tràn", f);
  await shot("clone-blocked");

  console.log("4. Điện thoại");
  await closeDialog();
  await size(390, 844, true);
  await sleep(400);
  // Thu từ máy tính xuống điện thoại thì thanh bên đang mở thành ngăn kéo phủ lên nút GitHub:
  // bấm vào lớp phủ tối để đóng, như người dùng điện thoại.
  if (await ev(`!!document.querySelector(".side-scrim")`)) {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await P("Input.dispatchMouseEvent", { type, x: 382, y: 724, button: "left", clickCount: 1 });
    }
    await until(`!document.querySelector(".side-scrim")`, 5000, "drawer closed");
    await sleep(700);
  }
  await openDialog();
  f = await ev(fits);
  ok(!f.bad.length && !f.over && f.w <= 390, "điện thoại: hộp thoại vừa màn hình, không tràn", f);
  await shot("light-phone");
  await theme("dark");
  await sleep(200);
  await shot("dark-phone");
  await theme("light");
  await closeDialog();
  await size(1440, 900);

  console.log("5. Kết nối cũ thiếu read:org");
  await gh("/_mock/scopes", { scopes: "repo,read:user,user:email" });
  await connectGh();
  await openDialog();
  await until(`!!${M}.querySelector(".gh-scope")`, 10000, "reconnect banner");
  const banner = await ev(`${M}.querySelector(".gh-scope").innerText`);
  ok(/Kết nối lại GitHub một lần/.test(banner) && /Kết nối lại/.test(banner), "mời kết nối lại một lần, có nút",
    banner);
  await shot("reconnect");
  await theme("dark");
  await sleep(200);
  await shot("reconnect-dark");
  await theme("light");
  await closeDialog();

  console.log("6. Tiếng Anh");
  await ev(`localStorage.setItem("p:uilang", '"en"'), 1`);
  await P("Page.reload");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button en");
  await openDialog();
  await until(`/Reconnect GitHub once/.test(${M}.innerText)`, 10000, "english banner");
  const en = await ev(`${M}.innerText`);
  ok(/Organization/.test(en) && /Grant access/.test(en) && !/Tổ chức|Cấp quyền/.test(en)
    && await ev(`${M}.querySelector(".gh-search input").placeholder`) === "Search every repo you can access",
    "giao diện tiếng Anh dịch đủ", en.slice(0, 400));
  await shot("english");
} catch (e) { fail++; console.log("  ✗", e.message); await shot("fail").catch(() => {}); }
await ev(`localStorage.setItem("p:uilang", '"vi"'), 1`).catch(() => {});
await gh("/_mock/scopes", { scopes: null }).catch(() => {});
await api("DELETE", "/api/github").catch(() => {});
chrome.kill();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
