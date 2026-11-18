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
  const r3b = await B.runBrowserTool("u1", "browser_click", { ref: 3 }, ctx());
  ok(r3b.is_error && calls.length === 2 && calls[1].body.url === "about:blank", "bấm nút \"Đăng nhập bằng Google\" dẫn tới trang đăng nhập: cũng đóng", calls.map((c) => c.body));

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
} finally {
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
