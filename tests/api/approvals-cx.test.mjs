// Quyền ghi tính theo thao tác thật, không theo công cụ bọc ngoài (Composio Connect, connector tự thêm).
// "Luôn cho phép" ở COMPOSIO_MULTI_EXECUTE_TOOL chỉ còn áp dụng cho thao tác đọc; thao tác ghi theo quyền riêng của từng ứng dụng (mặc định Hỏi mỗi lần);
// bash / workbench từ xa và gọi API không phải GET luôn hỏi; connector tự thêm không tin readOnlyHint của máy chủ.
// Tự chạy được: thư mục dữ liệu riêng, không gọi ra ngoài.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cxperm-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cx-perm-key";
delete process.env.COMPOSIO_CONNECT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { connectors: C, providers: PR, authstore: AS, composio: X, catalog: CAT, mcp: M, cxactions: CXA, "i18n-dict": D } = await loadTs(["connectors", "providers", "authstore", "composio", "catalog", "mcp", "cxactions", "i18n-dict"]);
const db = AS.db();
const pol = CAT.FULL_CONN;
// Bộ dịch DOM dùng chung (VI2EN + RULES_EN): KHÔNG được chứa luật "động từ + ascii" của Composio (nó khớp quá rộng).
const tr = (s) => { if (Object.prototype.hasOwnProperty.call(D.VI2EN, s)) return D.VI2EN[s]; for (const [re, f] of D.RULES_EN) { const m = s.match(re); if (m) return f(m); } return s; };
// Nhãn thao tác Composio dịch riêng tại chỗ hiện nhãn: i18n.tsx trCx và luật "Đang dùng X · Y" cùng gọi cxActEn (một chỗ duy nhất, INT-6).
const trCx = (s) => CXA.cxActEn(s, tr);
try {
  // Bảng như bản đang chạy (chưa có cột app_perms): Composio đã liên kết, người dùng từng đặt "Luôn cho phép" cho công cụ bọc ngoài và cho bash.
  db.exec(`CREATE TABLE IF NOT EXISTS connectors (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, dir TEXT, enabled INTEGER NOT NULL DEFAULT 1, era TEXT,
    status TEXT NOT NULL DEFAULT 'needs_auth', error TEXT, server_name TEXT, enc_auth TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', perms TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER)`);
  const sch = { type: "object" };
  const cxTools = [
    { name: "COMPOSIO_SEARCH_TOOLS", inputSchema: sch, annotations: { readOnlyHint: true } },
    { name: "COMPOSIO_MULTI_EXECUTE_TOOL", title: "Multi Execute Composio Tools", inputSchema: sch },
    { name: "COMPOSIO_REMOTE_BASH_TOOL", inputSchema: sch },
    { name: "COMPOSIO_REMOTE_WORKBENCH", inputSchema: sch },
    { name: "COMPOSIO_PROXY_EXECUTE", inputSchema: sch },
  ];
  const now = Date.now();
  const auth = PR.sealSecret(JSON.stringify({ mode: "token", key: { header: "x-consumer-api-key", value: "ck_testkey_123456" } }));
  db.prepare("INSERT INTO connectors (id, user_id, name, url, dir, status, enc_auth, tools, perms, created_at, updated_at, checked_at) VALUES ('cn_cx', 'u_a', 'Composio', 'https://connect.composio.dev/mcp', 'composio', 'ok', ?, ?, ?, ?, ?, ?)")
    .run(auth, JSON.stringify(cxTools), JSON.stringify({ COMPOSIO_MULTI_EXECUTE_TOOL: "allow", COMPOSIO_PROXY_EXECUTE: "allow", COMPOSIO_REMOTE_BASH_TOOL: "allow", COMPOSIO_REMOTE_WORKBENCH: "chat" }), now, now, now);

  const ex = (...slugs) => ({ tools: slugs.map(([tool_slug, args]) => ({ tool_slug, arguments: args ?? {} })) });
  const LIST_DOCS = ex(["GOOGLEDOCS_SEARCH_DOCUMENTS", { query: "báo cáo" }]);
  const CREATE_DOC = ex(["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", { title: "Synchro test", markdown_text: "Xin chào" }]);
  const SEND_MAIL = ex(["GMAIL_SEND_EMAIL", { recipient_email: "a@b.c", subject: "Hi" }]);

  console.log("1. Composio: đọc chạy luôn, ghi hỏi theo từng ứng dụng");
  let s = new C.ConnectorSession("u_a", { conv: "c1", pol });
  const fq = (n) => s.tools.find((t) => t.tool.name === n)?.fq;
  const EXEC = fq("COMPOSIO_MULTI_EXECUTE_TOOL"), BASH = fq("COMPOSIO_REMOTE_BASH_TOOL"), WB = fq("COMPOSIO_REMOTE_WORKBENCH"), PROXY = fq("COMPOSIO_PROXY_EXECUTE");
  ok(!!EXEC && !!BASH && !!PROXY, "công cụ Composio có trong lượt chat", s.tools.map((t) => t.tool.name));
  ok(s.perm(EXEC, LIST_DOCS) === "allow", "liệt kê / tìm tài liệu Google Docs: không có thẻ duyệt");
  ok(s.perm(EXEC, CREATE_DOC) === "ask", "tạo tài liệu Google Docs: có thẻ duyệt dù MULTI_EXECUTE đang 'Luôn cho phép' (quyền cũ không còn mở thao tác ghi)");
  ok(s.perm(EXEC, ex(["GOOGLEDOCS_SEARCH_DOCUMENTS"], ["GOOGLEDOCS_CREATE_DOCUMENT"])) === "ask", "lời gọi trộn đọc + ghi: hỏi");
  ok(s.perm(EXEC, { tools: "GOOGLEDOCS_CREATE_DOCUMENT" }) === "ask" && s.perm(EXEC, undefined) === "ask", "tham số lạ / không có: hỏi");
  ok(s.perm(EXEC, ex(["NOTION_QUERY_DATABASE", { sql: "drop table x" }])) === "ask", "động từ đọc nhưng tham số chạy lệnh: hỏi");
  ok(s.perm(EXEC, ex(["GMAIL_GET_AND_DELETE"])) === "ask", "động từ ghi đi sau động từ đọc: hỏi");
  // QUERY / FIND đứng một mình (không rõ đọc gì): coi là ghi, có thẻ duyệt — kể cả khi tham số mang câu lệnh đổi dữ liệu.
  ok(s.perm(EXEC, ex(["SUPABASE_QUERY", { query: "drop table x" }])) === "ask", "SUPABASE_QUERY { query: 'drop table x' }: hỏi (không còn chạy ngầm)");
  ok(s.perm(EXEC, ex(["SUPABASE_QUERY", { query: "select 1" }])) === "ask" && s.perm(EXEC, ex(["AIRTABLE_FIND"])) === "ask", "QUERY / FIND đứng một mình: luôn hỏi");
  ok(s.perm(EXEC, ex(["GOOGLEBIGQUERY_QUERY", { query: "DELETE FROM t" }])) === "ask", "GOOGLEBIGQUERY_QUERY { query: 'DELETE …' }: hỏi");
  ok(s.perm(EXEC, ex(["GOOGLEBIGQUERY_GET_DATASET"])) === "allow", "GOOGLEBIGQUERY_GET_DATASET: đọc, chạy luôn");
  // Động từ ghi sau từ nối mà trước đây thiếu (FORWARD / SHARE / STAR / INVITE / REPLY / SUBMIT / ENROLL): fail-closed, có thẻ.
  ok(s.perm(EXEC, ex(["GMAIL_LIST_AND_FORWARD"])) === "ask" && s.perm(EXEC, ex(["DRIVE_FIND_AND_SHARE"])) === "ask", "LIST_AND_FORWARD, FIND_AND_SHARE: hỏi");
  // Ứng dụng tên nhiều từ không có trong MULTI_KITS (Zoho Books): tách đúng ứng dụng, thao tác đọc chạy luôn.
  ok(s.perm(EXEC, ex(["ZOHO_BOOKS_LIST_INVOICES"])) === "allow", "ZOHO_BOOKS_LIST_INVOICES: đọc, không có thẻ duyệt");
  ok(s.perm(EXEC, ex(["ZOHO_BOOKS_CREATE_INVOICE", { name: "X" }])) === "ask", "ZOHO_BOOKS_CREATE_INVOICE: ghi, hỏi");
  // Tham số dạng chuỗi JSON (Gemini): xét sau khi đọc ra, như lúc gửi đi (SEC-2).
  ok(s.perm(EXEC, ex(["SUPABASE_LIST_TABLES", '{"sql":"drop table x"}'])) === "ask" && s.perm(EXEC, ex(["GOOGLEBIGQUERY_QUERY_TABLE", '{"query":"DELETE FROM t"}'])) === "ask", "tham số chuỗi JSON có câu lệnh đổi dữ liệu: hỏi");
  ok(s.perm(EXEC, ex(["GMAIL_FETCH_EMAILS", '{"max_results":3}'])) === "allow" && s.perm(EXEC, ex(["GMAIL_FETCH_EMAILS", "{oops"])) === "ask", "chuỗi JSON thường: đọc; chuỗi hỏng: hỏi");
  // toolkit do model viết không đổi được đọc / ghi (SEC-1).
  ok(s.perm(EXEC, { tools: [{ tool_slug: "TWITTER_DELETE_LIST", toolkit: "TWITTER_DELETE" }] }) === "ask" && s.perm(EXEC, { tools: [{ tool_slug: "GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAP" }] }) === "ask", "TWITTER_DELETE_LIST với toolkit giả, GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAP: hỏi");

  s.allowAlways(EXEC, CREATE_DOC);
  ok(s.perm(EXEC, CREATE_DOC) === "allow" && s.perm(EXEC, ex(["GOOGLEDOCS_UPDATE_DOCUMENT"])) === "allow", "Luôn cho phép trên thẻ: mọi thao tác ghi của Google Docs");
  ok(s.perm(EXEC, SEND_MAIL) === "ask", "…nhưng không mở Gmail");
  ok(JSON.parse(db.prepare("SELECT perms FROM connectors WHERE id = 'cn_cx'").get().perms).COMPOSIO_MULTI_EXECUTE_TOOL === "allow" && JSON.parse(db.prepare("SELECT app_perms FROM connectors WHERE id = 'cn_cx'").get().app_perms).googledocs === "allow", "lưu theo tài khoản, theo ứng dụng (app_perms), không đổi quyền công cụ bọc ngoài");

  s.allowChat(EXEC, SEND_MAIL);
  ok(s.perm(EXEC, SEND_MAIL) === "allow", "Cho phép trong cuộc trò chuyện này: Gmail trong c1");
  ok(new C.ConnectorSession("u_a", { conv: "c2", pol }).perm(EXEC, SEND_MAIL) === "ask", "…cuộc trò chuyện khác vẫn hỏi");
  ok(s.perm(EXEC, ex(["GMAIL_SEND_EMAIL"], ["SLACK_SEND_MESSAGE"])) === "ask", "lời gọi có thêm ứng dụng chưa cho phép: hỏi");
  // Quyền cũ "Cho phép trong cuộc trò chuyện này" cho cả công cụ bọc ngoài không mở thao tác ghi.
  db.prepare("INSERT OR REPLACE INTO connector_grants (user_id, conv, connector_id, tool, created_at) VALUES ('u_a', 'c3', 'cn_cx', 'COMPOSIO_MULTI_EXECUTE_TOOL', ?)").run(Date.now());
  ok(new C.ConnectorSession("u_a", { conv: "c3", pol }).perm(EXEC, SEND_MAIL) === "ask", "quyền cũ của MULTI_EXECUTE trong cuộc trò chuyện không mở Gmail");

  let r = C.updateConnector("u_a", "cn_cx", { apps: { slack: "block" } }, pol);
  ok(s.perm(EXEC, ex(["SLACK_SEND_MESSAGE"])) === "block" && s.perm(EXEC, ex(["SLACK_LIST_CHANNELS"])) === "allow", "chặn thao tác ghi của Slack; đọc Slack vẫn chạy");
  ok(s.perm(EXEC, ex(["SLACK_CHAT_POST_MESSAGE"])) === "block" && s.perm(EXEC, { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", toolkit: "slack_send" }] }) === "block", "SLACK_CHAT_POST_MESSAGE, toolkit giả slack_send: vẫn bị chặn theo Slack (R1)");
  C.updateConnector("u_a", "cn_cx", { apps: { zoho: "block" } }, pol);
  ok(s.perm(EXEC, ex(["ZOHO_BOOKS_CREATE_INVOICE"])) === "block", "chặn zoho: áp cả cho zoho_books");
  C.updateConnector("u_a", "cn_cx", { apps: { zoho: "ask" } }, pol);
  ok(r.apps?.find((a) => a.app === "slack")?.perm === "block" && r.apps.find((a) => a.app === "googledocs")?.name === "Google Docs" && r.apps.every((a) => a.logo || a.icon), "trang Connectors: quyền từng ứng dụng kèm tên và logo", r.apps);
  const blocked = await s.call(EXEC, ex(["SLACK_SEND_MESSAGE"]));
  ok(blocked.is_error && /chặn/.test(blocked.content), "gọi thao tác của ứng dụng bị chặn: không chạy", blocked);

  console.log("2. Bash, workbench, gọi API: luôn hỏi mỗi lần");
  ok(s.perm(BASH, { command: "ls" }) === "ask" && s.perm(WB, { code: "print(1)" }) === "ask", "quyền 'Luôn cho phép' / 'Hỏi một lần' cũ của bash, workbench không còn hiệu lực");
  const pub = C.composioInfo("u_a", pol).connector;
  const bt = pub.tools.find((t) => t.name === "COMPOSIO_REMOTE_BASH_TOOL");
  ok(bt.perm === "ask" && bt.askOnly === true, "trang Connectors: bash là Hỏi mỗi lần, chỉ chọn được Hỏi / Chặn", bt);
  ok(JSON.parse(db.prepare("SELECT perms FROM connectors WHERE id = 'cn_cx'").get().perms).COMPOSIO_REMOTE_BASH_TOOL === "ask", "dữ liệu cũ đã chuyển về Hỏi mỗi lần");
  let threw = "";
  try { C.updateConnector("u_a", "cn_cx", { perms: { COMPOSIO_REMOTE_BASH_TOOL: "allow" } }, pol); } catch (e) { threw = e.message; }
  ok(/luôn hỏi trước/.test(threw), "không đặt được REMOTE_BASH thành Luôn cho phép", threw);
  try { threw = ""; C.updateConnector("u_a", "cn_cx", { perms: { COMPOSIO_PROXY_EXECUTE: "chat" } }, pol); } catch (e) { threw = e.message; }
  ok(/luôn hỏi trước/.test(threw), "không đặt được gọi API thành Hỏi một lần mỗi cuộc trò chuyện", threw);
  C.updateConnector("u_a", "cn_cx", { group: { kind: "write", perm: "allow" } }, pol);
  ok(s.perm(BASH, { command: "rm -rf /" }) === "ask" && C.composioInfo("u_a", pol).connector.tools.find((t) => t.name === "COMPOSIO_REMOTE_BASH_TOOL").perm === "ask", "đặt cả nhóm ghi thành Luôn cho phép: bash vẫn hỏi");
  s.allowAlways(BASH, { command: "ls" });
  s.allowChat(BASH, { command: "ls" });
  ok(s.perm(BASH, { command: "ls" }) === "ask", "bấm Luôn cho phép / Cho phép trong cuộc trò chuyện ở thẻ bash: lần sau vẫn hỏi");
  ok(s.perm(PROXY, { method: "POST", endpoint: "/gmail/v1/users/me/messages/send" }) === "ask" && s.perm(PROXY, { endpoint: "/x" }) === "ask", "gọi API POST (hoặc không rõ phương thức): hỏi");
  ok(s.perm(PROXY, { method: "GET", endpoint: "/gmail/v1/users/me/labels" }) === "allow", "gọi API GET: như thao tác đọc");
  C.updateConnector("u_a", "cn_cx", { perms: { COMPOSIO_REMOTE_BASH_TOOL: "block" } }, pol);
  ok(new C.ConnectorSession("u_a", { conv: "c1", pol }).tools.every((t) => t.tool.name !== "COMPOSIO_REMOTE_BASH_TOOL"), "chặn bash vẫn được");

  console.log("3. Thẻ duyệt và nhãn bằng lời thường");
  const card = X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", CREATE_DOC);
  ok(card.name === "Google Docs" && card.act === "Tạo tài liệu" && card.main === "Synchro test" && card.apps.join() === "googledocs" && !card.strict, "tạo tài liệu: Google Docs · Tạo tài liệu 'Synchro test'", card);
  ok(card.params.some(([k, v]) => k === "title" && v === "Synchro test"), "tham số chính trên thẻ", card.params);
  const mail = X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", ex(["GMAIL_FETCH_EMAILS"], ["GMAIL_SEND_EMAIL", { recipient_email: "a@b.c", connected_account_id: "me@work.com" }]));
  ok(mail.name === "Gmail" && mail.act === "Gửi email" && mail.account === "me@work.com" && mail.more === 1, "lời gọi trộn: thẻ nói về thao tác ghi, có tài khoản, +1 thao tác khác", mail);
  ok(X.cxCard("COMPOSIO_REMOTE_BASH_TOOL", { command: "ls -la" }).strict && X.cxCard("COMPOSIO_PROXY_EXECUTE", { method: "DELETE", endpoint: "/x" }).strict && !X.cxCard("COMPOSIO_PROXY_EXECUTE", { method: "GET" }).strict, "bash, gọi API không phải GET: thẻ chỉ cho phép một lần");
  const lab = (t, i) => { const l = X.cxLabel(t, i); return l && `${l.app} · ${l.act}`; };
  ok(lab("COMPOSIO_SEARCH_TOOLS", {}) === "Composio · Tìm công cụ", "Composio · Tìm công cụ", lab("COMPOSIO_SEARCH_TOOLS", {}));
  ok(lab("COMPOSIO_MULTI_EXECUTE_TOOL", CREATE_DOC) === "Google Docs · Tạo tài liệu" && !/Multi Execute|Composio Tools/.test(lab("COMPOSIO_MULTI_EXECUTE_TOOL", CREATE_DOC)), "Google Docs · Tạo tài liệu (không còn 'Composio: Multi Execute Composio Tools')");
  ok(lab("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [] }) === "Composio · Chạy thao tác", "MULTI_EXECUTE không rõ thao tác: vẫn bằng lời thường");
  // Nhiều thao tác ghi: thẻ liệt kê từng thao tác (ứng dụng · thao tác · tham số chính · tài khoản), "+N" còn lại là thao tác đọc.
  const multi = X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", ex(
    ["GMAIL_SEND_EMAIL", { recipient_email: "a@b.c", subject: "Chào", connected_account_id: "me@work.com" }],
    ["SLACK_SEND_MESSAGE", { channel: "#chung", text: "Hi" }],
    ["GITHUB_LIST_ISSUES", { repo: "x" }],
  ));
  ok(multi.writes?.length === 2 && multi.writes[0].name === "Gmail" && multi.writes[0].act === "Gửi email" && multi.writes[0].account === "me@work.com" && multi.writes[1].name === "Slack" && multi.writes[1].act === "Gửi tin nhắn", "thẻ nhiều thao tác ghi: liệt kê cả Gmail và Slack", multi.writes);
  ok(multi.more === 1 && multi.apps.join() === "gmail,slack", "+1 thao tác đọc còn lại; phạm vi quyền gồm cả hai ứng dụng ghi", multi);
  // Thẻ duyệt cho QUERY mang câu lệnh đổi dữ liệu.
  ok(!!X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", ex(["SUPABASE_QUERY", { query: "drop table x" }])), "SUPABASE_QUERY drop: có thẻ duyệt");
  ok(/^Using Google Docs · Create (a )?document$/.test(tr("Đang dùng Google Docs · Tạo tài liệu")) && trCx("Gửi tin nhắn") !== "Gửi tin nhắn" && trCx("Liệt kê pull request") === "List pull request" && tr("Tìm công cụ") === "Find tools" && trCx("Gọi API POST") === "Call API POST", "bản tiếng Anh của nhãn (qua trCx)", [tr("Đang dùng Google Docs · Tạo tài liệu"), trCx("Gửi tin nhắn"), trCx("Liệt kê pull request"), trCx("Gọi API POST")]);
  // Chống khớp quá rộng: bộ dịch DOM chung KHÔNG được viết lại nút chữ "động từ + ascii" (CX_RULE_EN không nằm trong RULES_EN chung).
  ok(tr("Đọc readme") === "Đọc readme" && tr("Gửi payload") === "Gửi payload" && trCx("Đọc readme") === "Read readme" && trCx("Gửi payload") === "Send payload", "DOM chung giữ nguyên 'Đọc readme' / 'Gửi payload'; chỉ trCx mới dịch nhãn Composio", [tr("Đọc readme"), trCx("Đọc readme"), tr("Gửi payload")]);

  console.log("4. Connector tự thêm: không tin readOnlyHint");
  const custom = [
    { name: "delete_everything", inputSchema: sch, annotations: { readOnlyHint: true } },
    { name: "search_docs", inputSchema: sch, annotations: { readOnlyHint: true } },
    { name: "get_doc", inputSchema: sch },
    { name: "get_post", inputSchema: sch },
  ];
  db.prepare("INSERT INTO connectors (id, user_id, name, url, dir, status, enc_auth, tools, perms, created_at, updated_at, checked_at) VALUES ('cn_own', 'u_a', 'Mine', 'https://mcp.example.com/mcp', NULL, 'ok', ?, ?, '{}', ?, ?, ?)")
    .run(PR.sealSecret(JSON.stringify({ mode: "none" })), JSON.stringify(custom), now, now, now);
  db.prepare("INSERT INTO connectors (id, user_id, name, url, dir, status, enc_auth, tools, perms, created_at, updated_at, checked_at) VALUES ('cn_dir', 'u_a', 'Notion', 'https://mcp.notion.com/mcp', 'notion', 'ok', ?, ?, '{}', ?, ?, ?)")
    .run(PR.sealSecret(JSON.stringify({ mode: "none" })), JSON.stringify(custom), now, now, now);
  const by = (id) => Object.fromEntries(C.listConnectors("u_a", pol).find((c) => c.id === id).tools.map((t) => [t.name, t]));
  const own = by("cn_own"), dir = by("cn_dir");
  ok(!own.delete_everything.readOnly && own.delete_everything.destructive && own.delete_everything.perm === "ask", "máy chủ tự thêm khai báo delete_everything chỉ đọc: vẫn là ghi, có thể xóa, hỏi trước", own.delete_everything);
  ok(Object.values(own).every((t) => t.perm === "ask"), "mọi công cụ của connector tự thêm mặc định Hỏi mỗi lần", Object.values(own).map((t) => `${t.name}:${t.perm}`));
  ok(own.get_doc.readOnly && own.search_docs.readOnly && !own.get_post.readOnly, "tên kết thúc bằng động từ / danh từ ghi (get_post) là ghi; get_doc, search_docs là đọc");
  ok(dir.delete_everything.readOnly && dir.delete_everything.perm === "allow" && dir.get_post.readOnly, "connector trong danh mục: vẫn theo khai báo của máy chủ như trước");
  const s2 = new C.ConnectorSession("u_a", { conv: "c9", pol });
  const ownFq = s2.tools.find((t) => t.cid === "cn_own" && t.tool.name === "delete_everything").fq;
  ok(s2.perm(ownFq, {}) === "ask" && !s2.isRead(ownFq), "lượt chat: delete_everything hỏi trước, không tính là đọc");
  ok(!M.readLike({ name: "drop_all", annotations: { readOnlyHint: true }, untrusted: true }) && M.readLike({ name: "drop_all", annotations: { readOnlyHint: true } }), "readLike bỏ qua readOnlyHint khi untrusted");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
