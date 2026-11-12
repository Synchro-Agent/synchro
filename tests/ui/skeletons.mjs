// Khung chờ đúng kích thước (app/skeleton.tsx) trong Chrome ẩn trên npm run dev:mock: giữ chậm đúng yêu cầu mạng làm phần đó chờ (phiên đăng
// nhập, danh sách đoạn chat, nội dung đoạn chat, mã của khung artifact, mã trang cài đặt) 1,5 giây, đo khung chờ, thả ra rồi đo phần thật:
// vị trí và cỡ phải khớp (lệch tối đa vài px), và đo CLS (tổng layout-shift của trình duyệt) từ lúc mở tới lúc xong.
// - Mở app: thanh trái, thanh bên nổi, ô tìm, dòng đoạn chat, lời chào, ô soạn tin (máy tính và 375px); mở thẳng một đoạn chat: ô soạn tin dưới đáy.
// - Thiết bị mới (trình duyệt chưa có đoạn chat): dòng chờ ở thanh bên cùng cỡ dòng thật, không nói "Chưa có đoạn chat nào" khi chưa biết.
// - Đoạn chat đang tải từ máy chủ: bong bóng tin của người dùng và cột câu trả lời đúng chỗ.
// - Khung artifact đang tải: cùng chỗ, cùng bề rộng, thanh tiêu đề cùng cao (khung hẹp: tiêu đề hai hàng), có sẵn tên artifact.
// - Cài đặt đang tải: tiêu đề mục và hàng đầu tiên trùng chỗ tiêu đề mục và hàng thật.
// Chạy tay: BASE=http://localhost:3500 SHOTS=/tmp/sk node tests/ui/skeletons.mjs   (BEFORE=1: chỉ đo CLS, không đòi khung chờ — đo bản cũ)
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const BEFORE = !!process.env.BEFORE;
const HOLD = 1500;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (BEFORE) { console.log("  ·", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); return; } c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const clsLog = [];

const { cookie, uid } = await login(B);
// Một đoạn chat có tin trên máy chủ (để dựng đoạn chat "đang tải từ máy chủ").
const findSrv = async () => (await (await fetch(B + "/api/chats?since=0", { headers: { cookie } })).json()).items.filter((i) => i.kind === "chat" && !i.deleted).map((i) => JSON.parse(i.data))
  .find((c) => c.msgs?.length >= 2 && c.msgs[0].role === "user" && c.msgs[0].text.length < 30 && !c.inc);
let srv = await findSrv();
// Máy giả lập mới dựng chưa có đoạn chat nào: đẩy một đoạn chat có tin lên máy chủ (cùng đường đồng bộ của app).
if (!srv) {
  const id = Date.now() - 86_400_000, ans = "Kế hoạch gồm ba bước.\n\n1. Khảo sát khách hàng trong tuần đầu.\n2. Thử giá mới ở hai cửa hàng.\n3. Đo doanh thu và quyết định.\n\nBạn muốn tôi viết chi tiết bước nào trước?";
  const chat = { id, title: "Kế hoạch thử giá", msgs: [{ role: "user", text: "Lập kế hoạch thử giá", time: id, done: true }, { role: "ai", text: ans, done: true, time: id + 1 }, { role: "user", text: "Bước một", time: id + 2, done: true }, { role: "ai", text: "Khảo sát 50 khách quen bằng phiếu ngắn năm câu.", done: true, time: id + 3 }] };
  await fetch(B + "/api/chats", { method: "PUT", headers: { cookie, origin: B, "content-type": "application/json" }, body: JSON.stringify({ items: [{ kind: "chat", id: String(id), upd: id + 4, data: JSON.stringify(chat) }] }) });
  srv = await findSrv();
}
if (!srv) throw new Error("không đưa được đoạn chat có tin lên máy chủ");

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9374), name: "skeletons", shots: process.env.SHOTS });
const { P, ev, until } = t;
// Giữ chậm yêu cầu khớp mẫu (một lần bật một mẫu); yêu cầu khác đi thẳng. Mẫu là địa chỉ (API) hoặc { js: /…/ }: tệp mã có nội dung khớp —
// bản production đặt tên tệp mã theo số và mã băm (không có "artifactui", "settings" như bản dev), nên nhận phần mã bằng một chuỗi chỉ module đó có.
// Tệp mã giữ ở chặng nhận trả lời (đã đọc được nội dung) rồi mới thả ra trình duyệt. Tắt bộ nhớ đệm để tệp mã đã tải ở bước trước vẫn đi qua mạng.
let holdRe = null, held = 0, holdMs = HOLD;
const later = (id) => setTimeout(() => P("Fetch.continueRequest", { requestId: id }).catch(() => {}), holdMs);
t.on("Fetch.requestPaused", async (p) => {
  const go = () => P("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
  if (!holdRe) return go();
  if (holdRe instanceof RegExp) { if (holdRe.test(p.request.url)) { held++; later(p.requestId); } else go(); return; }
  if (p.responseStatusCode === undefined) return go();
  const body = await P("Fetch.getResponseBody", { requestId: p.requestId }).catch(() => null);
  const text = body ? (body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body) : "";
  if (holdRe.js.test(text)) { held++; later(p.requestId); } else go();
});
const hold = async (re, ms = HOLD) => {
  holdRe = re; held = 0; holdMs = ms;
  await P("Fetch.enable", { patterns: re instanceof RegExp ? [{ urlPattern: "*", requestStage: "Request" }] : [{ urlPattern: "*", resourceType: "Script", requestStage: "Response" }] });
};
const unhold = async () => { holdRe = null; await P("Fetch.disable"); };
await P("Network.setCacheDisabled", { cacheDisabled: true });
// Chuỗi chỉ có trong mã của khung artifact (app/artifactui.tsx) và của trang cài đặt (app/settings.tsx).
const ART_JS = { js: /art-dl-menu/ }, SETTINGS_JS = { js: /cap-domains/ };
// CLS: mọi layout-shift không do người dùng vừa bấm (bấm bằng .click() trong trang nên mọi dịch chuyển đều tính).
await P("Page.addScriptToEvaluateOnNewDocument", { source: `window.__cls = { v: 0, n: [] }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { __cls.v += e.value; __cls.n.push(Math.round(e.value * 1e4) / 1e4 + ":" + (e.sources || []).map((s) => s.node ? (s.node.className || s.node.nodeName) : "?").join("|").slice(0, 80)); } }).observe({ type: "layout-shift", buffered: true }); } catch {}` });
const clsReset = () => ev(`window.__cls ? (__cls.v = 0, __cls.n = [], 1) : 0`);
const cls = async (label) => { const c = await ev(`window.__cls ?? { v: -1, n: [] }`); clsLog.push(`${label}: ${c.v.toFixed(4)}`); console.log(`    CLS ${label}: ${c.v.toFixed(4)}${c.n.length ? " — " + c.n.slice(0, 4).join(", ") : ""}`); return c.v; };
const R = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const near = (a, b, keys, tol = 2) => !!a && !!b && keys.every((k) => Math.abs(a[k] - b[k]) <= tol);
const fmt = (a) => a ? `${["l", "t", "w", "h"].map((k) => `${k}=${Math.round(a[k] * 10) / 10}`).join(" ")}` : "không thấy";
const same = (label, a, b, keys, tol = 2) => ok(near(a, b, keys, tol), `${label}: khung chờ ${fmt(a)} · thật ${fmt(b)}`, `khung chờ ${fmt(a)} · thật ${fmt(b)} (lệch tối đa ${tol}px ở ${keys.join(",")})`);

const now = Date.now();
const art = '<artifact identifier="sk-test" type="text/html" title="Trang thử khung chờ">\n<!doctype html><h1>Thử</h1>\n</artifact>';
const local = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: now - 1000 - i, title: `Đoạn chat thử ${i + 1}`, msgs: [{ role: "user", text: "Chào", time: now - 1000 - i, done: true }, { role: "ai", text: "Chào bạn.", done: true, time: now - 999 - i }] })),
  { id: now, title: "Có artifact", msgs: [{ role: "user", text: "Làm trang", time: now, done: true }, { role: "ai", text: "Đây là trang.\n\n" + art, done: true, time: now + 1 }] },
];
// Mở hẳn trang mới (đổi mỗi phần #… thì trình duyệt không tải lại).
const go = async (url) => { await P("Page.navigate", { url: "about:blank" }); await sleep(150); await P("Page.navigate", { url }); };
const seed = async (chats) => {
  await ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("u:${uid}:")) localStorage.removeItem(k); localStorage.setItem("signedIn", "1"); localStorage.setItem("theme", "light"); ${chats ? `localStorage.setItem("u:${uid}:chats", ${JSON.stringify(JSON.stringify(chats))});` : ""} })()`);
};

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await t.size(1280, 800);
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector(".hero .composer")`, 60000);
  await sleep(2500);

  for (const [w, h, tag] of [[1280, 800, "máy tính"], [375, 760, "375px"]]) {
    const phone = w < 500;
    console.log(`\n━━ ${tag}`);
    await t.size(w, h, phone);

    // ---- 1. Mở app (chờ phiên đăng nhập) ----
    console.log("1. Mở app");
    await seed(local);
    await hold(/\/api\/auth\/me/);
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector(".boot")`, 20000);
    await sleep(500);
    const boot = { panel: await R(".boot-panel"), search: await R(".boot-search"), row: await R(".boot-rows .sk-chat"), rail: await R(".boot-rail"), greet: await R(".boot-greet"), box: await R(".boot-box") };
    await t.shot(`${w}-1-boot`);
    await until(`!!document.querySelector(".hero .composer")`, 30000);
    await unhold();
    await sleep(1800);
    const real = { panel: await R(".shell-side .sidebar"), search: await R(".side-search"), row: await R(".chat-scroll .chat-list .chat-item"), rail: await R(".rail"), greet: await R(".hero .greeting"), box: await R(".hero .composer") };
    await t.shot(`${w}-1-app`);
    if (!phone) {
      same("thanh trái", boot.rail, real.rail, ["l", "w"], 1);
      same("thanh bên nổi", boot.panel, real.panel, ["l", "t", "w", "h"], 1);
      same("ô tìm", boot.search, real.search, ["l", "t", "w", "h"], 1);
      same("dòng đoạn chat (cỡ, lề)", boot.row, real.row, ["l", "w", "h"], 1);
    } else ok(!boot.panel && !boot.rail, "điện thoại: không vẽ thanh bên (thanh bên thật là ngăn kéo đang đóng)", boot);
    same("ô soạn tin", boot.box, real.box, ["l", "t", "w", "h"], 3);
    same("dòng lời chào (trên, trái)", boot.greet, real.greet, ["l", "t"], 3);
    await cls(`${tag} · mở app`);

    // Mở thẳng một đoạn chat: vùng chính chờ dạng tin nhắn, ô soạn tin dưới đáy.
    await hold(/\/api\/auth\/me/);
    await go(`${B}/#c=${now - 1000}`);
    await until(`!!document.querySelector(".boot-dock")`, 20000);
    await sleep(300);
    const bdock = await R(".boot-dock .boot-box"), buser = await R(".boot .sk-user");
    await t.shot(`${w}-1-boot-chat`);
    await until(`!!document.querySelector(".dock .composer")`, 30000);
    await unhold();
    await sleep(1500);
    const rdock = await R(".main>.dock .composer"), ruser = await R(".thread .user-msg");
    same("mở thẳng đoạn chat: ô soạn tin dưới đáy (trái, rộng, đáy)", bdock, rdock, ["l", "w", "b"], 3);
    same("mở thẳng đoạn chat: bong bóng tin đầu (mép phải, trên)", buser, ruser, ["r", "t"], 3);
    await cls(`${tag} · mở thẳng đoạn chat`);

    // ---- 2. Thiết bị mới: danh sách đoạn chat đang về ----
    if (!phone) {
      console.log("2. Danh sách đoạn chat ở thiết bị mới");
      await seed(null);
      await hold(/\/api\/chats\?since=/);
      await P("Page.navigate", { url: B + "/" });
      await until(`!!document.querySelector(".hero .composer")`, 30000);
      await sleep(400);
      const sk = await R(".sk-list .sk-chat");
      const says = await ev(`document.querySelector(".shell-side")?.innerText.includes("Chưa có đoạn chat nào")`);
      await t.shot(`${w}-2-list-wait`);
      ok(BEFORE || (!!sk && !says), "đang về: dòng chờ, không nói “Chưa có đoạn chat nào”", { sk, says });
      await until(`!!document.querySelector(".chat-scroll .chat-list .chat-item")`, 15000);
      await unhold();
      await sleep(800);
      const row = await R(".chat-scroll .chat-list .chat-item");
      same("dòng chờ cùng cỡ dòng thật", sk, row, ["l", "w", "h"], 1);
      ok(!(await ev(`!!document.querySelector(".sk-list")`)), "về xong thì hết dòng chờ");
      await cls(`${tag} · danh sách đoạn chat`);
    }

    // ---- 3. Đoạn chat đang tải từ máy chủ ----
    console.log("3. Đoạn chat đang tải từ máy chủ");
    await seed([{ id: srv.id, title: srv.title, msgs: [], stub: true }, ...local.slice(0, 3)]);
    await hold(/\/api\/chats\?(keys|since)=/);
    await go(`${B}/#c=${srv.id}`);
    await until(`!!document.querySelector(".thread")`, 30000);
    await sleep(500);
    await clsReset();
    const su = await R(".thread .sk-user"), sa = await R(".thread .sk-ai");
    await t.shot(`${w}-3-stub-wait`);
    await until(`!!document.querySelector(".thread .user-msg")`, 15000);
    await unhold();
    await sleep(1000);
    const ru = await R(".thread .user-msg"), ra = await R(".thread .ai-msg");
    await t.shot(`${w}-3-stub-done`);
    same("bong bóng tin của người dùng (mép phải, trên, cao một dòng)", su, ru, ["r", "t", "h"], 2);
    same("cột câu trả lời (trái)", sa, ra, ["l"], 2);
    await cls(`${tag} · đoạn chat đang tải`);

    // ---- 4. Khung artifact đang tải phần mã ----
    // Đoạn chat có artifact tải trước mã khung xem ngay khi mở; giữ chậm phần mã đó từ lúc mở trang (mạng chậm) rồi bấm thẻ artifact bằng chuột
    // thật (dịch chuyển trong 0,5 giây sau cú bấm không tính vào CLS, như trình duyệt tính cho người dùng; lúc khung thật thay khung chờ thì có tính).
    console.log("4. Khung artifact");
    await seed(local);
    await hold(ART_JS, 4000);
    await go(`${B}/#c=${now}`);
    await until(`!!document.querySelector(".thread .art-card")`, 30000);
    await sleep(400);
    await clsReset();
    const card = await ev(`(() => { const c = [...document.querySelectorAll(".thread .art-card")].find((b) => b.textContent.includes("Trang thử khung chờ")); if (!c) return null; c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    ok(!!card, "thẻ artifact trong tin nhắn");
    if (card) await t.click(card[0], card[1]);
    await sleep(700);
    const threadW = await R(".thread"), sart = await R(".sk-art"), shead = await R(".sk-art-head"), sname = await ev(`document.querySelector(".sk-art .art-head-t b")?.textContent ?? ""`);
    const stillHeld = !(await ev(`!!document.querySelector(".art-panel .art-head")`));
    await t.shot(`${w}-4-art-wait`);
    ok(held > 0 && stillHeld && !!sart, `mã khung artifact còn đang tải (${held} yêu cầu bị giữ): khung chờ hiện ngay chỗ khung thật`, { held, stillHeld, sart });
    await until(`!!document.querySelector(".art-panel .art-head")`, 20000);
    await unhold();
    await sleep(900);
    const rart = await R(".art-panel"), rhead = await R(".art-panel .art-head"), thread1 = await R(".thread");
    await t.shot(`${w}-4-art-done`);
    same("khung artifact (chỗ, bề rộng, cao)", sart, rart, ["l", "t", "w", "h"], 1);
    same("thanh tiêu đề khung artifact (cao)", shead, rhead, ["h"], 2);
    ok(BEFORE || sname === "Trang thử khung chờ", "khung chờ có sẵn tên artifact", sname);
    if (!phone) same("cột chat lúc chờ đã co đúng bề rộng lúc mở xong", threadW, thread1, ["l", "t", "w", "h"], 1);
    await cls(`${tag} · khung artifact`);

    // ---- 5. Cài đặt đang tải ----
    console.log("5. Cài đặt");
    await seed(local.slice(0, 3));
    await hold(SETTINGS_JS);
    await P("Page.navigate", { url: `${B}/?settings=General` });
    await until(`!!document.querySelector(".s-body")`, 30000);
    await sleep(400);
    await clsReset();
    const sh = await R(".s-body h3"), srow = await R(".s-body .row");
    const skShown = await ev(`!!document.querySelector(".s-body .sk-srow")`);
    await t.shot(`${w}-5-settings-wait`);
    await until(`!!document.querySelector(".s-body .row:not(.sk-srow)")`, 20000);
    await unhold();
    await sleep(900);
    const rh = await R(".s-body h3"), rrow = await R(".s-body .row");
    await t.shot(`${w}-5-settings-done`);
    ok(skShown, "trang cài đặt đang tải hiện hàng chờ (không phải vòng quay giữa trang)");
    same("tiêu đề mục đầu", sh, rh, ["l", "t", "h"], 2);
    same("hàng đầu (chỗ, rộng, cao)", srow, rrow, ["l", "t", "w"], 2);
    same("hàng đầu (cao: không mô tả, nút xuống dòng ở màn hẹp như hàng thật)", srow, rrow, ["h"], 1);
    await cls(`${tag} · cài đặt`);
    // Tab tải dữ liệu riêng (Connectors): hàng chờ ngay dưới phần đầu của tab.
    await hold(/\/api\/connectors/);
    await ev(`[...document.querySelectorAll(".s-nav .s-item")].find((b) => /Connectors/.test(b.textContent))?.click()`);
    await sleep(500);
    const cSk = await ev(`!!document.querySelector(".s-body .sk-srow")`);
    await t.shot(`${w}-5-connectors-wait`);
    ok(cSk, "tab Connectors đang tải dữ liệu: hàng chờ thay chữ “Loading…”");
    await sleep(HOLD + 800);
    await unhold();
    await ev(`document.querySelector(".modal .close, .modal [aria-label='Đóng']")?.click()`);
  }

  // Giao diện tối: khung chờ vẫn thấy được (nền ánh khác màu nền).
  console.log("\n━━ giao diện tối");
  await t.size(1280, 800);
  await seed([{ id: srv.id, title: srv.title, msgs: [], stub: true }]);
  await ev(`localStorage.setItem("theme", "dark")`);
  await hold(/\/api\/chats\?(keys|since)=/);
  await go(`${B}/#c=${srv.id}`);
  await until(`!!document.querySelector(".thread .sk-ai")`, 30000).catch(() => {});
  await sleep(400);
  const contrast = await ev(`(() => { const e = document.querySelector(".thread .sk-ai .sk-line"); if (!e) return null; return { bg: getComputedStyle(e, "::after").backgroundImage.slice(0, 80), page: getComputedStyle(document.body).backgroundColor, dark: document.documentElement.dataset.theme }; })()`);
  await t.shot(`dark-3-stub-wait`);
  ok(BEFORE || (!!contrast && contrast.dark === "dark" && /gradient/.test(contrast.bg)), "giao diện tối: chữ giả có nền ánh", contrast);
  await unhold();
} catch (e) {
  fail++;
  console.log("  ✗ lỗi:", e.message);
} finally {
  t.close();
}
console.log(`\nCLS: ${clsLog.join(" · ")}`);
console.log(BEFORE ? "\n(BEFORE: chỉ đo CLS)" : `\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
