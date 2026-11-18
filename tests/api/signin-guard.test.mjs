// Bảo mật T7: model không được mở trang đăng nhập của bên thứ ba (accounts.google.com, login.microsoftonline.com, github.com/login,
// appleid.apple.com…) trong trình duyệt của Synchro (chạy trên máy chủ, giữ cookie). Chặn trước khi mở; trang tự chuyển tới trang đăng nhập
// thì đóng (về trang trắng); trang đăng nhập đang mở sẵn thì không đọc, không gõ / bấm. Chrome của chính người dùng (browser="user") không bị chặn.
// Lời dặn model trỏ tới Cài đặt → Connectors (Composio). Không cần máy chủ web: dịch vụ workspace giả chạy ngay trong bài thử (cổng ngẫu nhiên).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-signin-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "signin-guard-key";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

// Dịch vụ workspace giả: ghi lại mọi lời gọi; /browser trả trang theo kịch bản của từng bước.
const calls = [];
let reply = () => ({ url: "https://example.com/", title: "Example" });
const srv = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b || "{}");
    calls.push({ path: req.url, body });
    const r = body.action === "navigate" && body.url === "about:blank" ? { url: "about:blank", title: "" } : reply(req.url, body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(r));
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.WS_AGENT_URL = `http://127.0.0.1:${srv.address().port}`;
process.env.WS_AGENT_SECRET = "x".repeat(40);

const { signinguard: G, browsertools: B, composio: X } = await loadTs(["signinguard", "browsertools", "composio"]);
try {
  console.log("1. Nhận ra trang đăng nhập của bên thứ ba");
  const yes = [
    ["https://accounts.google.com/v3/signin/identifier?continue=https://docs.google.com", "Google"],
    ["accounts.google.com", "Google"],
    ["HTTPS://ACCOUNTS.GOOGLE.COM/ServiceLogin", "Google"],
    ["https://accounts.google.com.vn/signin", "Google"],
    ["https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "Microsoft"],
    ["https://login.live.com/login.srf", "Microsoft"],
    ["https://github.com/login", "GitHub"],
    ["https://github.com/login/oauth/authorize?client_id=x", "GitHub"],
    ["https://github.com/session", "GitHub"],
    ["https://github.com/sessions/two-factor/app", "GitHub"],
    ["https://slack.com/oauth/v2/authorize", "Slack"],
    ["https://appleid.apple.com/sign-in", "Apple"],
    ["https://www.facebook.com/login.php", "Facebook"],
    ["https://x.com/i/flow/login", "X"],
    ["https://www.linkedin.com/login", "LinkedIn"],
    ["https://login.yahoo.com/", "Yahoo"],
  ];
  for (const [u, svc] of yes) ok(G.signInService(u) === svc, `${u} → ${svc}`, G.signInService(u));
  const no = [
    "https://docs.google.com/document/d/abc/edit", "https://mail.google.com/mail/u/0/", "https://www.google.com/search?q=accounts.google.com",
    "accounts google đăng nhập", "https://github.com/anthropics/claude-code", "https://github.com/loginator/repo", "https://evil.example/accounts.google.com",
    "https://accounts.google.com.evil.example/signin", "https://notaccounts.google.com/", "https://www.facebook.com/somepage", "about:blank", "back", "",
    "https://example.com/?next=https://accounts.google.com",
  ];
  for (const u of no) ok(G.signInService(u) === null, `không phải trang đăng nhập: ${u || "(trống)"}`, G.signInService(u));
  ok(JSON.stringify(G.urlsOf("browser_batch", { actions: [{ action: "click", ref: 1 }, { action: "navigate", url: "a.com" }, { action: "tabs", op: "new", url: "b.com" }, { action: "tabs", op: "switch", url: "c.com" }] })) === JSON.stringify(["a.com", "b.com"]), "urlsOf: navigate và tabs op=new trong browser_batch");

  console.log("2. Chặn trước khi mở (không gọi tới trình duyệt)");
  const ctx = () => ({ def: "synchro", scope: "chat:1" });
  for (const [name, input] of [
    ["browser_navigate", { url: "https://accounts.google.com/v3/signin" }],
    ["browser_navigate", { url: "login.microsoftonline.com" }],
    ["browser_tabs", { op: "new", url: "https://github.com/login" }],
    ["browser_batch", { actions: [{ action: "navigate", url: "https://example.com" }, { action: "navigate", url: "https://appleid.apple.com/" }] }],
  ]) {
    calls.length = 0;
    const r = await B.runBrowserTool("u1", name, input, ctx());
    ok(r.is_error && r.signin && calls.length === 0, `${name} ${JSON.stringify(input).slice(0, 80)}: chặn, không mở`, { r, calls });
  }
  const blocked = await B.runBrowserTool("u1", "browser_navigate", { url: "https://accounts.google.com/" }, ctx());
  ok(/Cài đặt → Connectors/.test(blocked.content) && /connector_reconnect/.test(blocked.content) && /browser="user"/.test(blocked.content), "lời dặn: Cài đặt → Connectors (Composio), nút liên kết, Chrome của người dùng", blocked.content);
  ok(/Không bảo người dùng đăng nhập trong trình duyệt của Synchro/.test(blocked.content), "lời dặn: không bảo người dùng đăng nhập ở trình duyệt của Synchro");
  ok(blocked.summary === "Đã chặn trang đăng nhập", "tóm tắt cố định (có bản dịch)", blocked.summary);

  console.log("3. Trang tự chuyển tới trang đăng nhập: đóng trang, không trả nội dung");
  calls.length = 0;
  reply = () => ({ url: "https://accounts.google.com/v3/signin/identifier?continue=https://docs.google.com/", title: "Đăng nhập – Tài khoản Google", tree: "[1] textbox Email" });
  const c3 = ctx();
  const r3 = await B.runBrowserTool("u1", "browser_navigate", { url: "https://docs.google.com/document/u/0/" }, c3);
  ok(r3.is_error && r3.signin === "Google" && !/textbox/.test(r3.content), "docs.google.com chuyển tới accounts.google.com: báo lỗi, không lộ trang", r3);
  ok(calls.length === 2 && calls[1].body.action === "navigate" && calls[1].body.url === "about:blank" && calls[1].body.scope === "chat:1", "đóng trang đăng nhập (về about:blank, cùng phiên trình duyệt)", calls.map((c) => c.body));
  ok(!c3.signin && r3.url === "about:blank", "sau khi đóng: lượt không còn coi trang đang mở là trang đăng nhập", { signin: c3.signin, url: r3.url });
  calls.length = 0;
  const SIGNIN = { url: "https://accounts.google.com/v3/signin/identifier?continue=https://docs.google.com/", title: "Đăng nhập – Tài khoản Google", tree: "[1] textbox Email" };
  const tabsAt = (url) => ({ tabs: [{ i: 1, id: "t1", title: "x", url, active: true }] });
  reply = (_p, b) => (b.action === "tabs" ? tabsAt("https://example.com/") : SIGNIN);
  const r3b = await B.runBrowserTool("u1", "browser_click", { ref: 3 }, ctx());
  ok(r3b.is_error && calls.length === 3 && calls[0].body.action === "tabs" && calls[1].body.action === "click" && calls[2].body.url === "about:blank", "bấm nút \"Đăng nhập bằng Google\" dẫn tới trang đăng nhập: cũng đóng", calls.map((c) => c.body));

  console.log("3b. Lượt mới, trình duyệt còn đang ở trang đăng nhập: xem tab trước thao tác gõ / bấm đầu tiên, chặn trước khi chạm vào trang");
  calls.length = 0;
  reply = (_p, b) => (b.action === "tabs" ? tabsAt(SIGNIN.url) : SIGNIN);
  const c3b = ctx();
  const r3c = await B.runBrowserTool("u1", "browser_type", { ref: 1, text: "someone@example.com" }, c3b);
  ok(r3c.is_error && r3c.signin === "Google" && calls.length === 1 && calls[0].body.action === "tabs" && calls[0].body.scope === "chat:1", "gõ đầu lượt trên trang đăng nhập còn mở: chỉ xem tab, không gõ, không đóng trang", { r3c, calls: calls.map((c) => c.body) });
  await B.runBrowserTool("u1", "browser_click", { ref: 2 }, c3b);
  ok(calls.length === 1, "thao tác sau trong cùng lượt: không xem tab lại, vẫn chặn", calls.length);
  calls.length = 0;
  reply = (_p, b) => (b.action === "tabs" ? tabsAt("https://example.com/") : { url: "https://example.com/", title: "Example" });
  const c3c = ctx();
  const r3d = await B.runBrowserTool("u1", "browser_click", { ref: 1 }, c3c);
  await B.runBrowserTool("u1", "browser_click", { ref: 2 }, c3c);
  ok(!r3d.is_error && calls.filter((c) => c.body.action === "tabs").length === 1 && calls.length === 3, "trang thường: xem tab đúng một lần mỗi lượt, rồi bấm bình thường", calls.map((c) => c.body.action));
  calls.length = 0;
  await B.runBrowserTool("u1", "browser_read", {}, ctx());
  await B.runBrowserTool("u1", "browser_navigate", { url: "https://example.com" }, ctx());
  ok(calls.every((c) => c.body.action !== "tabs"), "đọc trang / mở trang: không cần xem tab trước", calls.map((c) => c.body.action));
  reply = () => SIGNIN;

  console.log("4. Trang đăng nhập đang mở sẵn (người dùng tự mở): không đọc, không gõ, không đóng");
  calls.length = 0;
  const c4 = ctx();
  const r4 = await B.runBrowserTool("u1", "browser_read", {}, c4);
  ok(r4.is_error && !/textbox/.test(r4.content) && calls.length === 1, "đọc trang: không trả cây trang, không đóng trang của người dùng", { r4, calls: calls.length });
  ok(c4.signin?.startsWith("https://accounts.google.com/"), "lượt nhớ trang đang mở là trang đăng nhập", c4.signin);
  calls.length = 0;
  for (const [name, input] of [["browser_type", { ref: 1, text: "someone@example.com" }], ["browser_click", { ref: 2 }], ["browser_key", { key: "Enter" }], ["browser_eval", { expression: "1" }], ["browser_batch", { actions: [{ action: "type", ref: 1, text: "x" }] }]]) {
    const r = await B.runBrowserTool("u1", name, input, c4);
    ok(r.is_error && r.signin === "Google", `${name} trên trang đăng nhập: chặn`, r);
  }
  ok(calls.length === 0, "không thao tác nào tới được trình duyệt", calls.length);
  reply = () => ({ logs: ["x"] });
  await B.runBrowserTool("u1", "browser_console", {}, c4);
  const r4k = await B.runBrowserTool("u1", "browser_type", { ref: 1, text: "x" }, c4);
  ok(r4k.is_error && r4k.signin === "Google", "thao tác không trả địa chỉ trang (xem console) không xóa dấu trang đăng nhập: gõ vẫn bị chặn", r4k);
  reply = () => ({ tabs: [{ i: 1, id: "t1", title: "Đăng nhập", url: "https://accounts.google.com/", active: true }], url: "https://accounts.google.com/", title: "Đăng nhập" });
  const r4t = await B.runBrowserTool("u1", "browser_tabs", { op: "list" }, c4);
  ok(!r4t.is_error && /Các tab/.test(r4t.content), "xem danh sách tab vẫn được (để rời trang đăng nhập)", r4t);
  reply = () => ({ url: "https://example.com/", title: "Example" });
  const r4n = await B.runBrowserTool("u1", "browser_navigate", { url: "https://example.com" }, c4);
  ok(!r4n.is_error && !c4.signin, "mở trang khác: được, hết chặn", { r4n, signin: c4.signin });
  const r4c = await B.runBrowserTool("u1", "browser_click", { ref: 1 }, c4);
  ok(!r4c.is_error, "sau đó bấm trên trang thường: được", r4c);

  console.log("5. Chrome của chính người dùng (browser=\"user\") không bị chặn");
  calls.length = 0;
  reply = (p) => (p === "/ext" ? { url: "https://accounts.google.com/", title: "Google" } : { url: "https://example.com/" });
  const r5 = await B.runBrowserTool("u1", "browser_navigate", { url: "https://accounts.google.com/", browser: "user" }, ctx());
  ok(!r5.is_error && calls.length === 1 && calls[0].path === "/ext", "mở trang đăng nhập trên Chrome của người dùng: chạy bình thường", { r5, calls });

  console.log("6. Lời dặn model");
  ok(/trang đăng nhập/.test(B.BROWSER_RULES) && /Cài đặt → Connectors/.test(B.BROWSER_RULES), "BROWSER_RULES: không mở trang đăng nhập bên thứ ba, trỏ tới Cài đặt → Connectors");
  ok(!/đăng nhập bằng Google \/ Facebook/.test(B.BROWSER_RULES), "BROWSER_RULES không còn gợi ý đăng nhập bằng Google / Facebook trong cửa sổ bật lên");
  ok(/Cài đặt → Connectors/.test(X.COMPOSIO_LINK_PROMPT) && /không mở trang đăng nhập/.test(X.COMPOSIO_LINK_PROMPT) && /connector_reconnect/.test(X.COMPOSIO_LINK_PROMPT), "Composio chưa liên kết: dặn gọi connector_reconnect, nhắc Cài đặt → Connectors, không mở trang đăng nhập", X.COMPOSIO_LINK_PROMPT);

  console.log("7. Mã nguồn: khung chat hiện nút liên kết khi bị chặn; thẻ có lối tới Cài đặt → Connectors");
  const tools = fs.readFileSync("server/chat/tools.ts", "utf8"), card = fs.readFileSync("ui/connectorsui.tsx", "utf8");
  ok(/r\.signin \? x\.sess\?\.offline\.find\(\(o\) => o\.why === "link"\)/.test(tools) && /if \(link\) showReconnect\(x, link\)/.test(tools), "chat: chặn trang đăng nhập mà Composio chưa liên kết → tự hiện nút Liên kết Composio");
  ok(/openSettings\("Connectors"\)/.test(card) && /Mở Cài đặt → Connectors/.test(card), "thẻ Liên kết Composio có nút Mở Cài đặt → Connectors");

  console.log("8. browser_batch: bước giữa lô dẫn tới trang đăng nhập thì dịch vụ workspace dừng lô ngay, không gõ tiếp trên trang đó");
  calls.length = 0;
  reply = () => ({ url: "https://example.com/", title: "Example", done: 1, total: 1, results: [] });
  await B.runBrowserTool("u1", "browser_batch", { actions: [{ action: "click", ref: 1 }] }, { ...ctx(), pageKnown: true });
  const sentStop = calls.find((c) => c.body.action === "batch")?.body.stopAt;
  ok(Array.isArray(sentStop) && sentStop.length === G.SIGNIN_STOP.length && sentStop.some((g) => /google/.test(g.h)), "máy chủ gửi kèm stopAt (luật trang đăng nhập) cho lô thao tác", sentStop);
  calls.length = 0;
  await B.runBrowserTool("u1", "browser_batch", { actions: [{ action: "click", ref: 1 }], browser: "user" }, ctx());
  ok(calls.length === 1 && calls[0].path === "/ext" && !("stopAt" in (calls[0].body.a ?? calls[0].body)), "Chrome của người dùng: không gửi stopAt", calls.map((c) => c.body));
  // Luật gửi đi (nguồn regex) so khớp y như signInService.
  const re = G.SIGNIN_STOP.map((g) => ({ h: new RegExp(g.h, "i"), p: g.p ? new RegExp(g.p, "i") : null }));
  const viaStop = (u) => { try { const x = new URL(/^[a-z]+:/i.test(u) ? u : `https://${u}`); const h = x.hostname.toLowerCase(); return re.some((g) => g.h.test(h) && (!g.p || g.p.test(x.pathname))); } catch { return false; } };
  const sample = [...yes.map((x) => x[0]), ...no.filter((u) => /^https?:/.test(u))];
  ok(sample.every((u) => viaStop(u) === !!G.signInService(u)), "SIGNIN_STOP khớp đúng như signInService (trang đăng nhập / không phải)", sample.filter((u) => viaStop(u) !== !!G.signInService(u)));
  // Chạy thật vòng lô của workspace/browser-act.mjs trên một phiên CDP giả: bước 2 (bấm) chuyển trang sang accounts.google.com.
  const { createActor } = await import("../../workspace/browser-act.mjs");
  const urls = ["https://example.com/", "https://accounts.google.com/v3/signin/identifier", "https://accounts.google.com/v3/signin/identifier"];
  let step = 0;
  // Mỗi lần đọc địa chỉ trang (sau mỗi bước) là trang tiếp theo trong urls: sau bước 1 vẫn example.com, sau bước 2 đã là trang đăng nhập.
  const fakeC = { awake: true, logs: [], net: [], on() {}, send: async (m) => (m === "Runtime.evaluate" ? { result: { value: { url: urls[Math.min(step++, urls.length - 1)], title: "" } } } : {}) };
  const states = new Map();
  const A = createActor({ state: (u) => (states.has(u) ? states.get(u) : states.set(u, {}).get(u)), pages: async () => [], session: async () => fakeC, emit() {} });
  const lot = async (stopAt) => { step = 0; return A.tool("u1", { action: "batch", stopAt, actions: [{ action: "console" }, { action: "console" }, { action: "console" }, { action: "console" }] }); };
  const rStop = await lot(G.SIGNIN_STOP);
  ok(rStop.done === 2 && rStop.results.length === 3 && /trang đăng nhập/.test(rStop.results[2].error ?? ""), "lô 4 bước: chạy 2 bước, dừng trước bước 3 vì trang đã sang accounts.google.com", rStop);
  const rFree = await lot(undefined);
  ok(rFree.done === 4 && !rFree.results.some((x) => x.error), "không có stopAt (Chrome của người dùng): chạy đủ lô như cũ", rFree);
  ok((await A.tool("u1", { action: "batch", stopAt: [{ h: "(" }], actions: [{ action: "console" }, { action: "console" }] })).done === 2, "stopAt hỏng (regex sai): bỏ qua, không làm hỏng lô");

  console.log("9. Chuyển trang mà máy chủ không thấy (browser_eval đặt location.href, chuyển hướng xong muộn): không gõ / bấm trên trang đăng nhập");
  const OAUTH = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
  calls.length = 0;
  let page = "https://example.com/";
  reply = (_p, b) => {
    if (b.action === "eval") { page = OAUTH; return { value: "null" }; }
    if (b.action === "tabs") return tabsAt(page);
    return { url: page, title: page === OAUTH ? "Đăng nhập – Tài khoản Google" : "Example", tree: "[1] button Cho phép" };
  };
  const c9 = { ...ctx(), pageKnown: true };
  const e9 = await B.runBrowserTool("u1", "browser_eval", { expression: `location.href=${JSON.stringify(OAUTH)}` }, c9);
  ok(!e9.is_error && c9.moved && !c9.pageKnown, "eval không trả địa chỉ trang: lượt đánh dấu cần xem lại trang trước thao tác kế tiếp", { e9, c9 });
  const k9 = await B.runBrowserTool("u1", "browser_click", { ref: 1 }, c9);
  ok(k9.is_error && k9.signin === "Google" && /đã đóng trang đó/.test(k9.content), "bấm sau eval: chặn và đóng trang đăng nhập (do thao tác của model)", k9);
  ok(!calls.some((c) => c.body.action === "click") && calls.some((c) => c.body.url === "about:blank"), "trình duyệt không nhận lệnh bấm; trang được đưa về about:blank", calls.map((c) => `${c.body.action} ${c.body.url ?? ""}`));
  ok(calls.filter((c) => c.body.action !== "navigate").every((c) => Array.isArray(c.body.stopAt) || c.body.action === "tabs"), "mọi thao tác trên trình duyệt của Synchro gửi kèm stopAt", calls.map((c) => [c.body.action, !!c.body.stopAt]));
  // eval rồi chỉ đọc trang: cũng đóng (model gây ra), không trả nội dung.
  calls.length = 0; page = "https://example.com/";
  const c9b = { ...ctx(), pageKnown: true };
  await B.runBrowserTool("u1", "browser_eval", { expression: "go()" }, c9b);
  const r9b = await B.runBrowserTool("u1", "browser_read", {}, c9b);
  ok(r9b.is_error && r9b.signin === "Google" && !/Cho phép/.test(r9b.content) && calls.some((c) => c.body.url === "about:blank"), "đọc trang sau eval: không lộ trang, đóng trang đăng nhập", { r9b, calls: calls.map((c) => c.body.action) });
  // Chuyển hướng xong muộn (sau khi bấm đã trả kết quả): máy chủ còn tưởng trang thường, dịch vụ workspace từ chối bấm và trả địa chỉ trang.
  calls.length = 0;
  reply = (_p, b) => (b.action === "click" ? { url: OAUTH, title: "Đăng nhập", signin: true, error: "Dừng: trang đang mở là trang đăng nhập của bên thứ ba" } : { url: "https://example.com/" });
  const r9c = await B.runBrowserTool("u1", "browser_click", { ref: 1 }, { ...ctx(), pageKnown: true });
  ok(r9c.is_error && r9c.signin === "Google" && /chưa chạy/.test(r9c.content) && calls.some((c) => c.body.url === "about:blank"), "workspace từ chối bấm trên trang đăng nhập: máy chủ báo thao tác chưa chạy và đóng trang", { r9c, calls: calls.map((c) => c.body.action) });

  console.log("9b. Dịch vụ workspace (workspace/browser-act.mjs) tự kiểm trước mỗi thao tác gõ / bấm");
  {
    const sent = [];
    let at = "https://example.com/";
    const fc = { awake: true, logs: [], net: [], on() {}, once: async () => {}, send: async (m, p) => { sent.push(m); if (m === "Runtime.evaluate") return { result: { value: /location\.href/.test(p?.expression ?? "") ? { url: at, title: "" } : null } }; return {}; } };
    const st2 = new Map();
    const A2 = createActor({ state: (u) => (st2.has(u) ? st2.get(u) : st2.set(u, {}).get(u)), pages: async () => [], session: async () => fc, emit() {} });
    at = OAUTH;
    for (const action of ["click", "type", "key", "eval", "hover", "upload", "permission"]) {
      sent.length = 0;
      const r = await A2.tool("u1", { action, ref: 1, text: "x", key: "Enter", expression: "1", stopAt: G.SIGNIN_STOP });
      ok(r.signin === true && r.url === OAUTH && sent.every((m) => m === "Runtime.evaluate") && sent.length === 1, `${action} trên trang đăng nhập: không làm, trả địa chỉ trang`, { r, sent });
    }
    sent.length = 0;
    const rb = await A2.tool("u1", { action: "batch", stopAt: G.SIGNIN_STOP, actions: [{ action: "type", ref: 1, text: "x" }] });
    ok(rb.done === 0 && /trang đăng nhập/.test(rb.results[0]?.error ?? "") && !sent.includes("Input.dispatchKeyEvent") && !sent.includes("Input.insertText"), "lô bắt đầu bằng gõ trên trang đăng nhập: dừng trước bước 1", { rb, sent });
    const rn = await A2.tool("u1", { action: "console", stopAt: G.SIGNIN_STOP });
    ok(!rn.signin && Array.isArray(rn.logs), "thao tác chỉ xem (console) không bị chặn ở workspace", rn);
    at = "https://example.com/";
    const rok = await A2.tool("u1", { action: "eval", expression: "1", stopAt: G.SIGNIN_STOP });
    ok(!rok.signin && "value" in rok, "trang thường: eval chạy bình thường", rok);
    const rno = await A2.tool("u1", { action: "eval", expression: "1" });
    ok(!rno.signin && "value" in rno, "không có stopAt (Chrome của người dùng): không kiểm", rno);
  }

  console.log("10. browser_tabs op=\"new\" tới trang chuyển hướng sang trang đăng nhập: đóng như mở trang");
  calls.length = 0;
  reply = (_p, b) => (b.action === "tabs" && b.op === "new" ? { url: "https://accounts.google.com/v3/signin/identifier", title: "Sign in - Google Accounts", tabs: [{ i: 2, id: "t2", url: "https://accounts.google.com/v3/signin/identifier", active: true }] } : { url: "about:blank" });
  const c10 = ctx();
  const r10 = await B.runBrowserTool("u1", "browser_tabs", { op: "new", url: "https://www.google.com/accounts" }, c10);
  ok(r10.is_error && r10.signin === "Google" && !/Sign in - Google/.test(r10.content) && calls.some((c) => c.body.action === "navigate" && c.body.url === "about:blank"), "tab mới dẫn tới accounts.google.com: báo chặn (có signin → nút Liên kết Composio), đóng trang", { r10, calls: calls.map((c) => c.body) });
  calls.length = 0;
  reply = () => ({ url: "https://accounts.google.com/", title: "Đăng nhập", tabs: [{ i: 1, id: "t1", url: "https://accounts.google.com/", active: true }] });
  const r10b = await B.runBrowserTool("u1", "browser_tabs", { op: "switch", id: "t1" }, ctx());
  ok(!r10b.is_error && !calls.some((c) => c.body.url === "about:blank"), "chuyển sang tab đăng nhập có sẵn (người dùng mở): không đóng", { r10b, calls: calls.map((c) => c.body) });

  console.log("11. Trang đăng nhập đang mở sẵn (myaccount.google.com sau khi người dùng tự đăng nhập): lô bắt đầu bằng rời trang vẫn chạy");
  calls.length = 0;
  reply = () => ({ url: "https://example.com/", title: "Example", done: 2, total: 2, results: [] });
  const c11 = { ...ctx(), signin: "https://myaccount.google.com/", pageKnown: true };
  const r11 = await B.runBrowserTool("u1", "browser_batch", { actions: [{ action: "navigate", url: "https://example.com" }, { action: "type", ref: 1, text: "xin chào" }] }, c11);
  const sent11 = calls.find((c) => c.body.action === "batch");
  ok(!r11.is_error && sent11 && Array.isArray(sent11.body.stopAt), "lô [mở example.com, gõ]: chạy, kèm stopAt cho các bước sau", { r11, calls: calls.map((c) => c.body.action) });
  ok(!c11.signin, "rời trang xong: hết dấu trang đăng nhập", c11.signin);
  for (const first of [{ action: "tabs", op: "new", url: "https://example.com" }, { action: "tabs", op: "switch", id: "t2" }]) {
    calls.length = 0;
    const r = await B.runBrowserTool("u1", "browser_batch", { actions: [first, { action: "click", ref: 1 }] }, { ...ctx(), signin: "https://myaccount.google.com/", pageKnown: true });
    ok(!r.is_error && calls.some((c) => c.body.action === "batch"), `lô bắt đầu bằng tabs op=${first.op}: chạy`, { r, calls: calls.map((c) => c.body.action) });
  }
  for (const first of [{ action: "type", ref: 1, text: "x" }, { action: "navigate", url: "back" }, { action: "navigate", url: "https://accounts.google.com/" }]) {
    calls.length = 0;
    const r = await B.runBrowserTool("u1", "browser_batch", { actions: [first, { action: "click", ref: 1 }] }, { ...ctx(), signin: "https://myaccount.google.com/", pageKnown: true });
    ok(r.is_error && r.signin && calls.length === 0, `lô bắt đầu bằng ${first.action} ${first.url ?? ""}: vẫn chặn`, { r, calls: calls.length });
  }
  const present = await B.runBrowserTool("u1", "browser_click", { ref: 1 }, { ...ctx(), signin: "https://myaccount.google.com/", pageKnown: true });
  ok(/rời trang này trước bằng browser_navigate/.test(present.content) && !/Đừng thử lại bằng địa chỉ khác/.test(present.content), "lời từ chối khi trang đăng nhập đang mở: bảo rời trang bằng browser_navigate để làm tiếp, không cấm thử địa chỉ khác", present.content);
  ok(/Đừng thử lại bằng địa chỉ khác/.test(blocked.content), "lời từ chối khi model tự mở trang đăng nhập: vẫn dặn không thử địa chỉ khác", blocked.content);

  console.log("12. Bước công cụ trong khung chat nói đúng việc");
  ok(B.describeBrowser("browser_navigate", { url: "https://accounts.google.com/v3/signin" }) === "Đang chặn trang đăng nhập accounts.google.com", "nhãn bước: Đang chặn trang đăng nhập accounts.google.com", B.describeBrowser("browser_navigate", { url: "https://accounts.google.com/v3/signin" }));
  ok(B.describeBrowser("browser_navigate", { url: "accounts.google.com" }) === "Đang chặn trang đăng nhập accounts.google.com", "nhãn bước khi địa chỉ không có https://");
  ok(B.describeBrowser("browser_navigate", { url: "https://accounts.google.com/" }, "user") === "Đang mở accounts.google.com trên Chrome của bạn", "Chrome của người dùng: nhãn như cũ");
  ok(B.describeBrowser("browser_navigate", { url: "https://example.com/" }) === "Đang mở example.com", "trang thường: nhãn như cũ");
  ok(/\.\.\.\(r\.signin \? \{ sum: r\.summary \} : \{\}\)/.test(tools) && /sum: \(r\.sum \?\? plainSummary/.test(tools), "chat: dòng kết quả của bước dùng tóm tắt \"Đã chặn trang đăng nhập\"");
  const { "shared/i18n-dict": D } = await loadTs(["shared/i18n-dict"]);
  const en = (t) => { for (const [re, f] of D.RULES_EN) { const m = t.match(re); if (m) return f(m); } return t; };
  ok(en("Đang chặn trang đăng nhập accounts.google.com") === "Blocking the sign-in page accounts.google.com", "nhãn bước có bản tiếng Anh", en("Đang chặn trang đăng nhập accounts.google.com"));
} finally {
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
