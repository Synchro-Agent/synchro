// Hộp thoại Repo GitHub trên giao diện thật (dev:mock, GitHub giả lập): repo nhóm theo chủ (cá nhân / tổ chức),
// tìm trên toàn bộ danh sách, "Xem thêm" tải trang sau, tổ chức chặn Synchro có nút Cấp quyền đúng trang GitHub,
// clone repo của tổ chức bị chặn báo một câu kèm nút, kết nối cũ thiếu quyền được mời kết nối lại, token bị thu hồi
// thì danh sách báo lỗi kèm nút Kết nối lại, trả lời tìm kiếm về muộn không đè kết quả, ứng dụng máy tính kết nối qua
// trình duyệt của máy (chưa đăng nhập) vẫn vào đúng tài khoản, hộp chọn repo của Dự án dùng cùng danh sách.
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
let pjName = "";
const api = async (method, p, body, extra = {}) => {
  const headers = { "content-type": "application/json", origin: B, cookie, ...extra };
  const data = body === undefined ? undefined : JSON.stringify(body);
  const r = await fetch(B + p, { method, redirect: "manual", headers, body: data });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null;
  // Chuyển hướng / không có nội dung JSON: j giữ null, nơi gọi xem mã trạng thái.
  try { j = await r.json(); } catch { /* xem dòng trên */ }
  return { s: r.status, j, h: r.headers };
};
const gh = (p, body) => fetch(GH + p, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
// Mở một đường dẫn kết nối như trình duyệt có cookie `who` (rỗng: chưa đăng nhập) rồi bấm Cho phép trên GitHub
// giả lập; trả về trang đích cuối cùng.
const allowAt = async (url, who) => {
  const r = await fetch(url, { redirect: "manual", headers: who ? { cookie: who } : {} });
  const state = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const page = await fetch(r.headers.get("location")).then((x) => x.text());
  const back = /id="allow" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
  if (!back) return r.headers.get("location");
  const done = await fetch(back, { redirect: "manual", headers: { cookie: [who, state].filter(Boolean).join("; ") } });
  return done.headers.get("location");
};
// Kết nối GitHub (giả lập) như khi bấm Cho phép trong cửa sổ cấp quyền của web.
const connectGh = () => allowAt(B + "/api/github/connect", cookie);

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
  // Chrome chưa mở cổng gỡ lỗi: null, vòng lặp chờ thêm một nhịp.
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
  // Biểu thức lỗi khi trang đang tải lại (phần tử chưa có): coi như chưa thỏa, hỏi lại tới hết giờ.
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
// Dòng tên nhóm, kèm dòng giải thích tổ chức bị chặn ngay sau (nếu có) và nút gỡ chặn trong một trong hai.
const groups = `[...document.querySelectorAll(".gh-grp")].map((g) => {
  const b = g.nextElementSibling?.classList.contains("gh-grp-b") ? g.nextElementSibling : null;
  const fx = g.querySelector(".gh-fix") ?? b?.querySelector(".gh-fix");
  return { owner: g.querySelector("b")?.textContent, kind: g.querySelector(".gh-grp-t span")?.textContent,
    block: !!(b || g.querySelector(".gh-grp-k")), banner: !!b, fix: fx?.getAttribute("href") ?? null };
})`;
// Không có chữ hay nút nào tràn khỏi hộp thoại, hộp thoại không rộng hơn màn hình.
const fits = `(() => { const m = ${M}.getBoundingClientRect();
  const bad = [...${M}.querySelectorAll("*")].filter((e) => {
  const b = e.getBoundingClientRect(); return b.width && (b.right > m.right + 1 || b.left < m.left - 1); })
  .map((e) => e.className || e.tagName); return { w: Math.round(m.width), vw: innerWidth, bad: bad.slice(0, 5),
  over: document.documentElement.scrollWidth > innerWidth }; })()`;
const openDialog = async (ready = `!!document.querySelector(".gh-grp")`) => {
  // Ngay sau khi tải trang, nút GitHub chưa biết workspace đã sẵn sàng (bấm chỉ hiện lời nhắc): bấm lại tới khi mở.
  const btn = `[...document.querySelectorAll(".cv-gh")].find((e) => e.getBoundingClientRect().width)`;
  for (let i = 0; i < 15 && !(await ev(`!!${M}`)); i++) {
    await click(btn, "GitHub button");
    // Chưa mở sau 2 giây: vòng lặp bấm lại.
    await until(`!!${M}`, 2000, "dialog").catch(() => false);
  }
  await until(`!!${M} && ${ready}`, 30000, "repo list");
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
  ok(g[0]?.owner === "locked-co" && by["locked-co"].block && by["locked-co"].banner,
    "tổ chức bị chặn (chưa có repo nào hiện) đứng đầu, có dòng báo", g);
  const sticky = await ev(`(() => {
    const b = document.querySelector(".gh-grp-b"), t = document.querySelector(".gh-grp");
    return { b: getComputedStyle(b).position, t: getComputedStyle(t).position, inside: t.contains(b) }; })()`);
  ok(sticky.t === "sticky" && sticky.b !== "sticky" && !sticky.inside,
    "chỉ dòng tên nhóm dính khi cuộn, dòng giải thích cuộn theo danh sách", sticky);
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
  // Lần đọc danh sách đầu tiên có thể lâu: trả lời cho ô tìm rỗng về sau trả lời cho "site" không được đè kết quả.
  await ev(`(() => { const f = window.fetch; window.__ghSlow = 0;
    window.fetch = (u, o) => /repos=1&q=&page=1/.test(String(u))
      ? new Promise((r) => setTimeout(r, 2500)).then(() => { window.__ghSlow++; return f(u, o); }) : f(u, o);
    return 1; })()`);
  await click(`${M}.querySelector(".gh-search .icon-btn")`, "reload");
  await sleep(100);
  await type(`${M}.querySelector(".gh-search input")`, "site");
  await until(`document.querySelectorAll(".gh-repo").length === 1`, 10000, "search result before slow reply");
  await until(`window.__ghSlow > 0`, 10000, "slow reply");
  await sleep(600);
  const late = await ev(`({ n: document.querySelectorAll(".gh-repo").length,
    q: ${M}.querySelector(".gh-search input").value })`);
  ok(late.n === 1 && late.q === "site", "trả lời cũ về muộn không đè kết quả tìm đang hiện", late);
  await P("Page.reload");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button after reload");
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace after reload");
  await openDialog();

  console.log("3. Clone repo của tổ chức bị chặn");
  await type(`${M}.querySelector(".gh-url input")`, "locked-co/secret");
  await click(`${M}.querySelector(".gh-url .btn")`, "clone");
  await until(`!!${M}.querySelector(".gh-err")`, 60000, "clone error");
  const err = await ev(`({ t: ${M}.querySelector(".gh-err > span").innerText,
    href: ${M}.querySelector(".gh-err .gh-fix")?.href ?? "",
    btns: ${M}.querySelectorAll(".gh-err .btn").length })`);
  ok(err.t === "Tổ chức locked-co chưa cấp quyền cho Synchro.", "báo một câu ngắn, tên tổ chức nằm trong câu", err.t);
  ok(err.btns === 1, "một nút duy nhất trong lời báo", err);
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
  await closeDialog();
  await ev(`localStorage.setItem("p:uilang", '"vi"'), 1`);

  console.log("7. Token bị thu hồi trên GitHub");
  await gh("/_mock/scopes", { scopes: null });
  // Token mới: danh sách không lấy từ bản máy chủ giữ vài phút.
  await connectGh();
  await gh("/_mock/revoke", { on: true });
  await P("Page.reload");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button");
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace");
  await openDialog(`!!${M}.querySelector(".gh-list .gh-err")`);
  const ex = await ev(`({ t: ${M}.querySelector(".gh-list .gh-err").innerText,
    btn: [...${M}.querySelectorAll(".gh-list .gh-err .btn")].map((b) => b.textContent),
    loading: /Đang tải danh sách repo/.test(${M}.querySelector(".gh-list").innerText) })`);
  ok(/hết hạn/.test(ex.t) && ex.btn.join() === "Kết nối lại" && !ex.loading,
    "danh sách: báo kết nối hết hạn, có nút Kết nối lại, không còn dòng đang tải", ex);
  await shot("list-expired");
  await theme("dark");
  await sleep(200);
  await shot("list-expired-dark");
  await theme("light");
  await gh("/_mock/revoke", { on: false });
  await closeDialog();

  console.log("8. Ứng dụng máy tính: cấp quyền ở trình duyệt của máy (chưa đăng nhập Synchro)");
  await api("DELETE", "/api/github");
  // Như view web của app: có window.synchroDesktop, cửa sổ mới không mở trong app (window.open trả null, app chuyển
  // đường dẫn sang trình duyệt của máy). Bài thử ghi lại đường dẫn để mở bằng một "trình duyệt" không có cookie.
  const { identifier } = await P("Page.addScriptToEvaluateOnNewDocument", { source: `window.synchroDesktop = {};
    window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };` });
  await P("Page.reload");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button");
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace");
  const connectBtn = `[...${M}.querySelectorAll(".gh-acc .btn")].find((b) => /Kết nối GitHub/.test(b.textContent))`;
  await openDialog(`!!${connectBtn}`);
  await click(connectBtn, "connect");
  await until(`window.__opened.length > 0 && !!${M}.querySelector(".gh-wait")`, 10000, "handoff opened");
  const link = await ev(`window.__opened[0]`);
  ok(/\/api\/github\/connect\?handoff=/.test(link), "app mở đường dẫn trao tay ở trình duyệt của máy", link);
  ok(/trình duyệt vừa mở/.test(await ev(`${M}.querySelector(".gh-wait").innerText`)),
    "app nói rõ đang chờ bước ở trình duyệt, có nút Hủy");
  await shot("desktop-wait");
  const end = await allowAt(link, "");
  ok(/\/api\/github\/done\?app=1$/.test(end ?? ""), "trình duyệt chưa đăng nhập vẫn hoàn tất, trang mời quay lại app",
    end);
  await until(`/Đã kết nối/.test(${M}.querySelector(".gh-acc").innerText) && !${M}.querySelector(".gh-wait")
    && !!document.querySelector(".gh-grp")`, 15000, "linked in app");
  const st = await api("GET", "/api/github");
  ok(st.j?.linked && st.j.login === "mock-dev", "tài khoản của app đã kết nối GitHub, danh sách repo hiện ra", st.j);
  await closeDialog();
  await P("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await P("Page.reload");
  await until(`!!document.querySelector(".cv-gh")`, 30000, "GitHub button");

  console.log("9. Thêm từ GitHub trong Dự án: cùng danh sách");
  pjName = `GH picker ${tag}`;
  await P("Page.navigate", { url: `${B}/#v=projects` });
  await until(`!!document.querySelector(".pj-new")`, 30000, "projects");
  await click(`document.querySelector(".pj-new")`, "new project");
  await until(`!!document.querySelector("#sy-pj-name")`, 8000, "project dialog");
  await type(`document.querySelector("#sy-pj-name")`, pjName);
  await click(`document.querySelector(".sy-modal .sy-mf .btn.dark")`, "create project");
  await until(`!!document.querySelector(".pj-tabbar")`, 10000, "project page");
  await click(`[...document.querySelectorAll(".pj-tabbar [role=tab]")].find((b) => /Ngữ cảnh/.test(b.textContent))`,
    "context tab");
  await click(`document.querySelector("[aria-label='Thêm ngữ cảnh']")`, "add context");
  // Menu mở có hiệu ứng: chờ mục GitHub hiện hẳn rồi mới bấm (các menu khác của trang cũng có mục cùng tên).
  const ghItem = `[...document.querySelectorAll(".menu-item")].find((b) => b.textContent.trim() === "GitHub"
    && b.getBoundingClientRect().width > 0 && getComputedStyle(b.closest(".menu") ?? b).opacity === "1")`;
  await until(`!!${ghItem}`, 5000, "GitHub menu item");
  // Bấm thẳng phần tử: click() của bài thử cuộn phần tử vào giữa màn hình, mà cuộn trang thì menu tự đóng.
  await ev(`(${ghItem}).click(), 1`);
  await until(`!!document.querySelector(".gh-imp .gh-grp")`, 30000, "project repo list");
  const pg = await ev(groups);
  const pby = Object.fromEntries(pg.map((x) => [x.owner, x]));
  ok(pby["locked-co"]?.banner && pby["mock-dev"]?.kind === "Cá nhân"
    && await ev(`!!document.querySelector(".gh-imp .gh-more")`),
  "nhóm theo chủ, tổ chức bị chặn có nút gỡ, có Xem thêm như hộp thoại Repo GitHub", pg);
  await sleep(500);
  f = await ev(fits.replaceAll(".gh-modal", ".gh-imp"));
  ok(!f.bad.length && !f.over, "hộp chọn của Dự án: không có gì tràn", f);
  await shot("project-picker");
  await theme("dark");
  await sleep(200);
  await shot("project-picker-dark");
  await theme("light");
  await click(`document.querySelector(".gh-imp .gh-repo")`, "first repo");
  await until(`/Repo khác/.test(document.querySelector(".gh-imp").innerText)`, 15000, "file list");
  ok(true, "chọn repo: sang bước chọn tệp");
} catch (e) {
  fail++;
  console.log("  ✗", e.message);
  await shot("fail").catch((x) => console.warn("  ! không chụp được ảnh lỗi:", x.message));
}
// Dọn dữ liệu thử trên GitHub giả lập và tài khoản dùng chung: bước nào hỏng thì in ra để lần chạy sau biết còn sót gì.
const warn = (what) => (e) => console.warn(`  ! dọn ${what} không được:`, e.message);
if (pjName) {
  // Xóa mọi dự án thử của bài này (kể cả của lần chạy trước bị dừng giữa chừng).
  await (async () => {
    await P("Page.navigate", { url: `${B}/#v=projects` });
    await until(`!!document.querySelector(".pj-gcard")`, 20000, "projects");
    const card = `[...document.querySelectorAll(".pj-gcard")].find((c) =>
      /^GH picker /.test(c.querySelector(".pj-gname b")?.textContent ?? ""))`;
    for (let i = 0; i < 10 && (await ev(`!!(${card})`)); i++) {
      await ev(`(() => { const c = ${card}; const b = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: b.x + 40, clientY: b.y + 40 }));
        return 1; })()`);
      const del = `(${card}).querySelector(".menu-item.del")`;
      await until(`!!${del} && ${del}.getBoundingClientRect().width > 0`, 5000, "project menu");
      await sleep(300);
      await click(del, "delete project");
      await until(`!!document.querySelector(".cf-top .btn.danger")`, 5000, "confirm dialog");
      await click(`document.querySelector(".cf-top .btn.danger")`, "confirm");
      await until(`!document.querySelector(".cf-top")`, 5000, "confirm closed");
    }
    if (await ev(`!!(${card})`)) throw new Error("vẫn còn dự án thử");
  })().catch(warn("dự án thử"));
}
await ev(`localStorage.setItem("p:uilang", '"vi"'), 1`).catch(warn("ngôn ngữ giao diện"));
await gh("/_mock/revoke", { on: false }).catch(warn("thu hồi token giả lập"));
await gh("/_mock/scopes", { scopes: null }).catch(warn("quyền token giả lập"));
await api("DELETE", "/api/github").catch(warn("kết nối GitHub"));
chrome.kill();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
