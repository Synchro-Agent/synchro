// Composio của bạn, phần không cần máy chủ web: chuyển hàng cũ của chế độ khóa dự án dùng chung (đã bỏ) về "chưa liên kết", xóa khóa dự án cũ,
// Connect Link chỉ nhận máy chủ của Composio, Connect Link không thành nguồn trích dẫn, câu trả lời lỡ chép link (kể cả dưới "Sources:") được dọn.
// Tự chạy được: thư mục dữ liệu riêng, không gọi ra ngoài.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cxunit-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cx-unit-key";
delete process.env.COMPOSIO_CONNECT_URL;
delete process.env.COMPOSIO_API_KEY;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { connectors: C, providers: PR, authstore: AS, composio: X, cxlink: L, catalog: CAT, cxactions: CXA } = await loadTs(["connectors", "providers", "authstore", "composio", "cxlink", "catalog", "cxactions"]);
const db = AS.db();
try {
  console.log("1. Chuyển hàng cũ của chế độ dùng chung về chưa liên kết");
  // Bảng như bản đang chạy (trước khi mô-đun connectors chạm tới): một hàng Composio kiểu cũ (phiên Tool Router, mode "composio") của chủ sở hữu.
  db.exec(`CREATE TABLE IF NOT EXISTS connectors (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, dir TEXT, enabled INTEGER NOT NULL DEFAULT 1, era TEXT,
    status TEXT NOT NULL DEFAULT 'needs_auth', error TEXT, server_name TEXT, enc_auth TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', perms TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER);
    CREATE TABLE IF NOT EXISTS api_providers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT, enc_key TEXT NOT NULL, key_hint TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ok', error TEXT, info TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const tools = JSON.stringify([{ name: "COMPOSIO_SEARCH_TOOLS", inputSchema: { type: "object" } }]);
  const now = Date.now();
  db.prepare("INSERT INTO connectors (id, user_id, name, url, dir, status, enc_auth, tools, perms, created_at, updated_at, checked_at) VALUES (?, ?, ?, ?, 'composio', 'ok', ?, ?, ?, ?, ?, ?)")
    .run("cn_old", "u_owner", "Composio", "https://backend.composio.dev/tool_router/trs_1/mcp", PR.sealSecret(JSON.stringify({ mode: "composio", session: "trs_1", fp: "abc" })), tools, JSON.stringify({ COMPOSIO_SEARCH_TOOLS: "allow" }), now, now, now);
  db.prepare("INSERT INTO connectors (id, user_id, name, url, dir, status, enc_auth, created_at, updated_at) VALUES (?, ?, ?, ?, 'composio', 'ok', ?, ?, ?)")
    .run("cn_dup", "u_owner", "Composio", "https://backend.composio.dev/tool_router/trs_2/mcp", PR.sealSecret(JSON.stringify({ mode: "composio", session: "trs_2" })), now + 1, now + 1);
  db.prepare("INSERT INTO api_providers (id, kind, name, enc_key, key_hint, created_at, updated_at) VALUES ('composio', 'composio', 'Composio', ?, 'ak_••••0001', ?, ?)").run(PR.sealSecret("ak_secret_project_key"), now, now);

  const info = C.composioInfo("u_owner", CAT.FULL_CONN);
  ok(info.state === "unlinked" && info.connector?.status === "needs_auth" && info.connector.tools.length === 0 && info.connector.url === "https://connect.composio.dev/mcp", "hàng cũ thành chưa liên kết, trỏ tới Composio Connect, không còn công cụ của phiên cũ", info);
  ok(info.connector.auth === "none" && !JSON.stringify(info).includes("trs_1"), "không còn phiên Tool Router nào trong dữ liệu trả về");
  ok(db.prepare("SELECT COUNT(*) n FROM connectors WHERE user_id = 'u_owner' AND dir = 'composio'").get().n === 1, "hàng Composio thừa của cùng tài khoản đã gỡ");
  ok(JSON.parse(db.prepare("SELECT perms FROM connectors WHERE id = 'cn_old'").get().perms).COMPOSIO_SEARCH_TOOLS === "allow", "quyền công cụ người dùng đã đặt vẫn giữ");
  await PR.adminList();
  ok(!db.prepare("SELECT 1 FROM api_providers WHERE id = 'composio'").get(), "khóa dự án Composio cũ đã xóa khỏi cơ sở dữ liệu");
  ok(!(await PR.adminList()).some((p) => p.id === "composio"), "Cài đặt → Providers không còn mục Composio");
  ok(PR.isService("composio") === false && !("composio" in PR.BUILTIN), "Composio không còn là dịch vụ cần khóa quản trị viên");

  console.log("2. Mỗi tài khoản có sẵn Composio của mình");
  const a = C.composioInfo("u_a", CAT.FULL_CONN), b = C.composioInfo("u_b", CAT.FULL_CONN);
  ok(a.state === "unlinked" && b.state === "unlinked" && a.connector.id !== b.connector.id, "hai tài khoản: hai hàng riêng, chờ liên kết", [a.connector?.id, b.connector?.id]);
  ok(a.manageUrl === "https://dashboard.composio.dev", "link Mở Composio trỏ tới trang Composio");
  ok(C.composioInfo("u_a", { custom: true, allowed: [], destructive: true }).state === "blocked", "quản trị viên không cho Composio: blocked, không có nút");
  const s = new C.ConnectorSession("u_a", { pol: CAT.FULL_CONN });
  ok(s.tools.length === 0 && s.offline.length === 1 && s.offline[0].why === "link", "lượt chat: Composio chưa liên kết là mục chờ liên kết (không có công cụ)", s.offline);
  const pr = C.connectorsPrompt(s);
  ok(/chưa liên kết Composio/.test(pr) && /connector_reconnect/.test(pr) && !/cần kết nối lại nên chưa có công cụ: Composio/.test(pr), "model được dặn mời liên kết Composio bằng nút trong khung chat khi cần ứng dụng bên ngoài", pr);
  C.removeConnector("u_a", a.connector.id);
  ok(C.composioInfo("u_a", CAT.FULL_CONN).connector.id === a.connector.id, "gỡ Composio = ngắt liên kết, hàng vẫn có sẵn");
  let threw = "";
  try { C.removeConnector("u_b", a.connector.id); } catch (e) { threw = e.message; }
  ok(/Không tìm thấy/.test(threw), "tài khoản khác không đụng được Composio của người này", threw);

  console.log("3. Connect Link chỉ của Composio");
  const good = ["https://connect.composio.dev/link/lk_abc123", "https://backend.composio.dev/api/v3/s/Xy12ab", "https://app.composio.dev/connect/gmail?x=1"];
  const bad = ["https://evil.com/link/1", "http://connect.composio.dev/link/1", "https://connect.composio.dev/mcp", "https://connect.composio.dev/", "https://docs.composio.dev/docs/x", "https://dashboard.composio.dev/x", "https://connect.composio.dev.evil.com/link/1", "https://u:p@connect.composio.dev/link/1", "javascript:alert(1)", "http://127.0.0.1:4010/composio/link/ca_1"];
  ok(good.every((u) => L.isConnectUrl(u)), "nhận link của connect / backend / app.composio.dev", good.filter((u) => !L.isConnectUrl(u)));
  ok(bad.every((u) => !L.isConnectUrl(u)), "từ chối nơi khác, http, máy chủ MCP, trang chủ, tài liệu, tên miền giả, link cục bộ ở bản thật", bad.filter((u) => L.isConnectUrl(u)));
  ok(L.isConnectUrl("http://127.0.0.1:4010/composio/link/ca_1", true) && !L.isConnectUrl("http://127.0.0.1:4010/other", true), "bản giả lập: chỉ /composio/link/ trên máy cục bộ");
  const res = JSON.stringify({ successful: true, data: { results: { gmail: { status: "initiated", redirect_url: good[0] }, slack: { redirect_url: "https://evil.com/phish" }, notion: { connect_url: good[1], toolkit: "notion" } } } });
  const links = X.connectLinks(res);
  ok(links.length === 2 && links[0].name === "Gmail" && links[0].url === good[0] && links[1].name === "Notion", "kết quả MANAGE_CONNECTIONS: nút cho Gmail và Notion, link lạ bị bỏ", links);
  ok(!X.notConnectLink(good[0]) && X.notConnectLink("https://vnexpress.net/a"), "Connect Link không vào danh sách nguồn, link thường vẫn vào");

  console.log("4. Câu trả lời lỡ chép Connect Link");
  const U = good[0];
  const shot = `Mình cần bạn kết nối Gmail trước.\n\n👉 [Kết nối Gmail](${U})\n\nKết nối xong thì nhắn lại nhé.\n\nSources:\n- [Kết nối Gmail](${U})`;
  const t = L.tidyConnectLinks(shot);
  ok(t === `Mình cần bạn kết nối Gmail trước.\n\n👉 [Kết nối Gmail](${U})\n\nKết nối xong thì nhắn lại nhé.`, "ảnh chụp của chủ sở hữu: link giữ một lần (thành nút), mục Sources chỉ có link đó bị bỏ", t);
  const mixed = `Tin mới nhất.\n\n**Nguồn:**\n- [VnExpress](https://vnexpress.net/a)\n- [Kết nối Gmail](${U})`;
  ok(L.tidyConnectLinks(mixed) === `Tin mới nhất.\n\n**Nguồn:**\n- [VnExpress](https://vnexpress.net/a)`, "mục nguồn có nguồn thật: chỉ bỏ Connect Link, giữ nguồn thật", L.tidyConnectLinks(mixed));
  const twice = `Bấm [Kết nối Gmail](${U}) nhé.\n\n- ${U}`;
  ok(L.tidyConnectLinks(twice) === `Bấm [Kết nối Gmail](${U}) nhé.`, "dòng lặp lại đúng link đã có: bỏ", L.tidyConnectLinks(twice));
  const code = "```\n" + U + "\n```";
  ok(L.tidyConnectLinks(code) === code && L.tidyConnectLinks("Không có link.") === "Không có link.", "khối code và câu trả lời thường: giữ nguyên");
  ok(L.connectName("👉 Kết nối Gmail") === "Gmail" && L.connectName("Connect Google Drive via Composio") === "Google Drive" && L.connectName("🔗") === "" && L.connectName("https://connect.composio.dev/link/x") === "", "tên ứng dụng của nút lấy từ nhãn link");

  console.log("5. Nhãn công cụ Composio trong chat (cxLabel): bằng lời thường, không lộ tên công cụ bọc ngoài");
  const lbl = (tool, input) => { const l = X.cxLabel(tool, input); return l ? `${l.app} · ${l.act}` : null; };
  // Công cụ meta: ứng dụng là "Composio", thao tác bằng lời thường.
  ok(lbl("COMPOSIO_SEARCH_TOOLS", { queries: ["gmail"] }) === "Composio · Tìm công cụ", "SEARCH_TOOLS → Composio · Tìm công cụ", lbl("COMPOSIO_SEARCH_TOOLS", {}));
  ok(lbl("COMPOSIO_GET_TOOL_SCHEMAS", { tool_slugs: ["GMAIL_FETCH_EMAILS"] }) === "Composio · Xem tham số công cụ", "GET_TOOL_SCHEMAS → Composio · Xem tham số công cụ", lbl("COMPOSIO_GET_TOOL_SCHEMAS", {}));
  ok(lbl("COMPOSIO_MANAGE_CONNECTIONS", {}) === "Composio · Quản lý kết nối", "MANAGE_CONNECTIONS → Composio · Quản lý kết nối");
  // MULTI_EXECUTE: nhãn theo thao tác thật bên trong (ứng dụng · thao tác), không phải "Composio: Multi Execute Composio Tools".
  ok(lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] }) === "Gmail · Lấy email", "MULTI_EXECUTE đọc Gmail → Gmail · Lấy email", lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] }));
  ok(lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GOOGLEDOCS_CREATE_DOCUMENT", arguments: { title: "Synchro test" } }] }) === "Google Docs · Tạo tài liệu", "MULTI_EXECUTE ghi Google Docs → Google Docs · Tạo tài liệu", lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GOOGLEDOCS_CREATE_DOCUMENT" }] }));
  // Tham số lỗi (danh sách thao tác trống / sai dạng): không rơi về tên công cụ bọc ngoài, vẫn bằng lời thường.
  ok(lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [] }) === "Composio · Chạy thao tác", "MULTI_EXECUTE tham số lỗi → Composio · Chạy thao tác", lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [] }));
  const labels = [
    lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] }),
    lbl("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [] }),
    lbl("COMPOSIO_SEARCH_TOOLS", {}), lbl("COMPOSIO_GET_TOOL_SCHEMAS", {}),
  ];
  ok(labels.every((s) => s && !/Multi Execute|Composio Tools/i.test(s)), "không nhãn nào lộ 'Multi Execute' / 'Composio Tools'", labels);

  console.log("6. Cache lược đồ công cụ Composio theo (người dùng, toolkit) 24h");
  // Toolkit lấy từ trường toolkit / app, và từ tiền tố của tool_slug.
  ok(JSON.stringify(X.cacheToolkits({ toolkit: "GMAIL" })) === '["gmail"]', "cacheToolkits lấy từ trường toolkit", X.cacheToolkits({ toolkit: "GMAIL" }));
  ok(JSON.stringify(X.cacheToolkits({ tool_slugs: ["GOOGLEDOCS_CREATE_DOCUMENT", "GMAIL_FETCH_EMAILS"] })) === '["gmail","googledocs"]', "cacheToolkits lấy toolkit từ tiền tố tool_slug (đã sắp xếp)", X.cacheToolkits({ tool_slugs: ["GOOGLEDOCS_CREATE_DOCUMENT", "GMAIL_FETCH_EMAILS"] }));
  // Khóa: giống nhau cho lần đọc y hệt; khác người dùng / toolkit / tham số thì khác; null cho công cụ không phải đọc lược đồ hoặc thiếu người dùng.
  const argsG = { tool_slugs: ["GMAIL_FETCH_EMAILS"] };
  const kA = X.schemaCacheKey("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG);
  ok(kA && kA === X.schemaCacheKey("u1", "COMPOSIO_GET_TOOL_SCHEMAS", { tool_slugs: ["GMAIL_FETCH_EMAILS"] }), "khóa y hệt cho lần đọc giống nhau", kA);
  ok(kA !== X.schemaCacheKey("u2", "COMPOSIO_GET_TOOL_SCHEMAS", argsG), "khác người dùng → khác khóa");
  ok(kA !== X.schemaCacheKey("u1", "COMPOSIO_GET_TOOL_SCHEMAS", { tool_slugs: ["SLACK_SEND_MESSAGE"] }), "khác toolkit → khác khóa");
  ok(X.schemaCacheKey("u1", "COMPOSIO_MULTI_EXECUTE_TOOL", argsG) === null && X.schemaCacheKey("", "COMPOSIO_SEARCH_TOOLS", {}) === null, "không cache công cụ không phải đọc lược đồ / thiếu người dùng");
  ok(X.isSchemaRead("COMPOSIO_SEARCH_TOOLS") && X.isSchemaRead("COMPOSIO_GET_TOOL_SCHEMAS") && !X.isSchemaRead("COMPOSIO_MULTI_EXECUTE_TOOL"), "isSchemaRead chỉ nhận SEARCH_TOOLS và GET_TOOL_SCHEMAS");
  // TTL: lấy lại trong 24h; quá hạn thì không; đổi connector thì bỏ.
  const t0 = 1_000_000_000_000;
  X.schemaCachePut("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, "SCHEMA_BODY", t0);
  ok(X.schemaCacheGet("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, t0 + 1000) === "SCHEMA_BODY", "lần đọc y hệt trong ngày lấy ngay từ cache");
  ok(X.schemaCacheGet("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, t0 + X.SCHEMA_TTL - 1) === "SCHEMA_BODY", "ngay trước 24h vẫn còn");
  ok(X.schemaCacheGet("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, t0 + X.SCHEMA_TTL) === null, "đúng 24h thì hết hạn");
  ok(X.schemaCacheGet("u2", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, t0 + 1000) === null, "người dùng khác không thấy cache của người này");
  X.schemaCachePut("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, "SCHEMA_BODY", t0);
  X.invalidateSchemaCache("u1");
  ok(X.schemaCacheGet("u1", "COMPOSIO_GET_TOOL_SCHEMAS", argsG, t0 + 1000) === null, "connector đổi → cache của người đó bị bỏ");

  console.log("7. Đọc hay ghi theo slug thật của Composio (SEC-1 / SEC-3 / R1 / W1-01): ứng dụng = tiền tố dài nhất khớp toolkit đã biết");
  // [slug, ứng dụng, đọc?]. Đọc chỉ khi động từ đọc đứng ngay sau tên ứng dụng; danh từ đứng trước (EVENTS_LIST, BATCH_GET) hay ứng dụng lạ: ghi (hỏi trước).
  const TABLE = [
    ["GMAIL_FETCH_EMAILS", "gmail", true], ["GMAIL_LIST_LABELS", "gmail", true], ["GMAIL_GET_PROFILE", "gmail", true],
    ["GOOGLEDOCS_GET_DOCUMENT_BY_ID", "googledocs", true], ["GOOGLEDRIVE_FIND_FILE", "googledrive", true], ["GOOGLEDRIVE_LIST_FILES", "googledrive", true],
    ["GOOGLECALENDAR_FIND_EVENT", "googlecalendar", true], ["GITHUB_LIST_REPOSITORY_ISSUES", "github", true], ["GITHUB_GET_A_REPOSITORY", "github", true],
    ["GITHUB_SEARCH_REPOSITORIES", "github", true], ["SLACK_LIST_ALL_CHANNELS", "slack", true], ["SLACK_FETCH_CONVERSATION_HISTORY", "slack", true],
    ["SLACK_SEARCH_MESSAGES", "slack", true], ["NOTION_QUERY_DATABASE", "notion", true], ["NOTION_SEARCH_NOTION_PAGE", "notion", true],
    ["GOOGLE_MAPS_GET_ROUTE", "google_maps", true], ["GOOGLE_SEARCH_CONSOLE_LIST_SITES", "google_search_console", true], ["HUBSPOT_LIST_CONTACTS", "hubspot", true],
    ["JIRA_GET_ISSUE", "jira", true], ["ZOHO_BOOKS_LIST_INVOICES", "zoho_books", true], ["YOUTUBE_LIST_USER_PLAYLISTS", "youtube", true],
    ["SUPABASE_LIST_ALL_PROJECTS", "supabase", true], ["LINEAR_LIST_LINEAR_ISSUES", "linear", true], ["GOOGLEBIGQUERY_GET_DATASET", "googlebigquery", true],
    // noun-first: ứng dụng vẫn đúng, nhưng không có động từ đọc ngay sau → ghi (fail-closed).
    ["GOOGLECALENDAR_EVENTS_LIST", "googlecalendar", false], ["GOOGLESHEETS_BATCH_GET", "googlesheets", false], ["GOOGLECALENDAR_EVENTS_INSERT", "googlecalendar", false],
    ["SLACK_CHAT_POST_MESSAGE", "slack", false], ["GMAIL_BATCH_DELETE_MESSAGES", "gmail", false], ["TWITTER_CREATION_OF_A_POST", "twitter", false],
    ["OUTLOOK_OUTLOOK_SEND_EMAIL", "outlook", false], ["MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", "microsoft_teams", false], ["GOOGLE_ANALYTICS_RUN_REPORT", "google_analytics", false],
    // verb-first ghi.
    ["GMAIL_SEND_EMAIL", "gmail", false], ["GMAIL_CREATE_EMAIL_DRAFT", "gmail", false], ["GMAIL_REPLY_TO_THREAD", "gmail", false], ["GMAIL_MOVE_TO_TRASH", "gmail", false],
    ["GMAIL_ADD_LABEL_TO_EMAIL", "gmail", false], ["GOOGLEDOCS_CREATE_DOCUMENT", "googledocs", false], ["GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT", "googledocs", false],
    ["GOOGLEDRIVE_UPLOAD_FILE", "googledrive", false], ["GOOGLESHEETS_BATCH_UPDATE", "googlesheets", false], ["GOOGLECALENDAR_CREATE_EVENT", "googlecalendar", false],
    ["SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", "slack", false], ["SLACK_ADD_REACTION_TO_AN_ITEM", "slack", false], ["SLACK_SET_READ_CURSOR_IN_A_CONVERSATION", "slack", false],
    ["GITHUB_CREATE_AN_ISSUE", "github", false], ["GITHUB_STAR_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER", "github", false], ["GITHUB_MARK_A_THREAD_AS_READ", "github", false],
    ["NOTION_CREATE_NOTION_PAGE", "notion", false], ["NOTION_ADD_PAGE_CONTENT", "notion", false], ["GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAP", "google_search_console", false],
    ["GOOGLE_SEARCH_CONSOLE_ADD_SITE", "google_search_console", false], ["TWITTER_DELETE_LIST", "twitter", false], ["LINKEDIN_CREATE_LINKED_IN_POST", "linkedin", false],
    ["MAILCHIMP_DELETE_LIST", "mailchimp", false], ["SUPABASE_QUERY", "supabase", false], ["ZOHO_BOOKS_CREATE_INVOICE", "zoho_books", false],
    ["GMAIL_LIST_AND_FORWARD", "gmail", false], ["GITHUB_GET_OR_CREATE", "github", false], ["GOOGLE_MAPS_LIST_AND_DELETE", "google_maps", false],
    // Ứng dụng không có trong danh sách toolkit: không đoán ranh giới, ghi.
    ["UNKNOWNAPP_LIST_THINGS", "unknownapp", false], ["ACME_CRM_LIST_DEALS", "acme", false],
  ];
  const wrong = TABLE.filter(([slug, kit, read]) => CXA.slugParts(slug).kit !== kit || CXA.slugIsRead(slug) !== read || (X.execPlan({ tools: [{ tool_slug: slug }] }).writes.length === 0) !== read)
    .map(([slug, kit, read]) => `${slug}: ${CXA.slugParts(slug).kit}/${CXA.slugIsRead(slug)} (cần ${kit}/${read})`);
  ok(TABLE.length >= 40 && !wrong.length, `bảng ${TABLE.length} slug Composio thật: đúng ứng dụng, đúng đọc / ghi`, wrong);
  ok(JSON.stringify(X.execPlan({ tools: [{ tool_slug: "SLACK_CHAT_POST_MESSAGE" }, { tool_slug: "GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAP" }] }).writes) === '["slack","google_search_console"]', "khóa quyền theo ứng dụng thật: slack, google_search_console");

  // toolkit / toolkit_slug / app do model viết vào thao tác: không dời được ranh giới, không đổi được khóa quyền.
  const spoof = [
    [{ tool_slug: "TWITTER_DELETE_LIST", toolkit: "TWITTER_DELETE" }, "twitter"],
    [{ tool_slug: "MAILCHIMP_DELETE_LIST", app: "mailchimp_delete" }, "mailchimp"],
    [{ tool_slug: "GITHUB_MARK_A_THREAD_AS_READ", toolkit: "github_mark_a_thread_as" }, "github"],
    [{ tool_slug: "SLACK_UPDATE_A_VIEW", toolkit_slug: "slack_update_a" }, "slack"],
    [{ tool_slug: "SLACK_SET_READ_CURSOR_IN_A_CONVERSATION", toolkit: "SLACK_SET" }, "slack"],
    [{ tool_slug: "GMAIL_MOVE_TO_TRASH", toolkit: "GMAIL_MOVE_TO" }, "gmail"],
    [{ tool_slug: "GMAIL_SEND_EMAIL", toolkit: "gmail_send" }, "gmail"],
    [{ tool_slug: "SLACK_SEND_MESSAGE_AND_LIST", toolkit: "slack_send_message_and" }, "slack"],
  ];
  const leaked = spoof.filter(([it, kit]) => JSON.stringify(X.execPlan({ tools: [it] }).writes) !== JSON.stringify([kit]) || X.execRead({ tools: [it] }));
  ok(!leaked.length, "toolkit giả do model khai báo: vẫn là ghi của đúng ứng dụng", leaked);
  ok(X.execRead({ tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", toolkit: "gmail" }] }), "toolkit khai báo đúng: đọc vẫn chạy luôn");
  ok(X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", toolkit: "gmail_send" }] }).app === "gmail", "thẻ duyệt cũng không theo toolkit giả");

  console.log("8. Tham số là chuỗi JSON (SEC-2): đọc ra rồi mới xét");
  const one = (slug, args) => X.execPlan({ tools: [{ tool_slug: slug, arguments: args }] }).writes.length === 0;
  ok(!one("NOTION_QUERY_DATABASE", '{"sql":"drop table x"}') && !one("GOOGLEBIGQUERY_QUERY_TABLE", '{"query":"DELETE FROM t"}'), "chuỗi JSON có sql / câu lệnh đổi dữ liệu: ghi");
  ok(one("GOOGLEBIGQUERY_QUERY_TABLE", '{"query":"select 1"}') && one("GMAIL_FETCH_EMAILS", '{"max_results":5}') && one("GMAIL_FETCH_EMAILS", ""), "chuỗi JSON thường: vẫn là đọc");
  ok(!one("GMAIL_FETCH_EMAILS", "not json") && !one("GMAIL_FETCH_EMAILS", "[1,2]") && !one("GMAIL_FETCH_EMAILS", 5) && !one("GMAIL_FETCH_EMAILS", ["x"]), "không đọc được thành đối tượng: ghi (fail-closed)");
  ok(X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GOOGLEDOCS_CREATE_DOCUMENT", arguments: '{"title":"Báo cáo"}' }] }).main === "Báo cáo", "thẻ duyệt đọc được tham số dạng chuỗi");

  console.log("10. Học toolkit, lược đồ và tài khoản từ kết quả của chính Composio (W23-7 / W1-05)");
  const sendSchema = { type: "object", properties: { recipient_email: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["recipient_email"] };
  const searchRes = JSON.stringify({ successful: true, data: {
    results: [{ use_case: "send email", primary_tool_slugs: ["GMAIL_SEND_EMAIL"], related_tool_slugs: ["GMAIL_FETCH_EMAILS"], toolkits: ["gmail"] }],
    tool_schemas: {
      GMAIL_SEND_EMAIL: { toolkit: "gmail", tool_slug: "GMAIL_SEND_EMAIL", description: "Send an email", input_schema: sendSchema },
      GMAIL_FETCH_EMAILS: { toolkit: "gmail", tool_slug: "GMAIL_FETCH_EMAILS", description: "Fetch emails", input_schema: { type: "object", properties: { max_results: { type: "integer" } } } },
      ACME_CRM_LIST_DEALS: { toolkit: "acme_crm", tool_slug: "ACME_CRM_LIST_DEALS", description: "List deals", input_schema: { type: "object", properties: {} } },
    },
    toolkit_connection_statuses: [{ toolkit: "gmail", has_active_connection: true, connection_details: { email: "me@work.com" } }],
    session: { id: "sess_1" },
  } });
  // Thẻ duyệt / execPlan tính hạn 24 giờ theo giờ thật: dùng giờ thật ở phần này.
  const tn = Date.now();
  const SEARCH = "COMPOSIO_SEARCH_TOOLS", SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS";
  ok(X.execPlan({ tools: [{ tool_slug: "ACME_CRM_LIST_DEALS" }] }, "u9").writes.join() === "acme", "trước khi Composio nói: ứng dụng lạ là ghi");
  X.schemaCachePut("u9", SEARCH, { queries: [{ use_case: "send an email via gmail" }] }, searchRes, tn);
  ok(X.execPlan({ tools: [{ tool_slug: "ACME_CRM_LIST_DEALS" }] }, "u9").writes.length === 0 && X.cxHints("u9", tn + 1).slug("ACME_CRM_LIST_DEALS") === "acme_crm", "Composio nói ACME_CRM_LIST_DEALS thuộc acme_crm: đọc, chạy luôn");
  ok(X.execPlan({ tools: [{ tool_slug: "ACME_CRM_LIST_DEALS" }] }, "u8").writes.join() === "acme", "người dùng khác không dùng hiểu biết của người này");
  ok(CXA.slugParts("GITHUB_MARK_A_THREAD_AS_READ", { slug: () => "github_mark_a_thread_as", kits: ["github_mark"] }).kit === "github", "toolkit học được nuốt động từ ghi: bỏ qua");
  // Cache theo (người dùng, toolkit): câu tìm khác chữ cho cùng toolkit vẫn trúng; toolkit khác thì không.
  const hit = X.schemaCacheLookup("u9", SEARCH, { queries: [{ use_case: "Send a quick email to Bob with Gmail" }] }, tn + 1000);
  ok(hit && hit.kits?.join() === "gmail" && hit.content.includes("GMAIL_SEND_EMAIL") && hit.content.includes("recipient_email"), "SEARCH_TOOLS khác chữ cho Gmail: lấy từ cache theo toolkit", hit);
  ok(X.schemaCacheLookup("u9", SEARCH, { queries: [{ use_case: "create a Google Docs document" }] }, tn + 1000) === null, "toolkit chưa có trong cache: tìm thật");
  ok(X.schemaCacheLookup("u9", SEARCH, { queries: [{ use_case: "send email with gmail and post to slack" }] }, tn + 1000) === null, "câu tìm nói thêm toolkit chưa có trong cache: tìm thật");
  const sh = X.schemaCacheLookup("u9", SCHEMAS, { tool_slugs: ["GMAIL_SEND_EMAIL"] }, tn + 1000);
  ok(sh && JSON.parse(sh.content).data.tool_schemas.GMAIL_SEND_EMAIL.input_schema.required[0] === "recipient_email", "GET_TOOL_SCHEMAS cho slug đã biết: lấy từ cache", sh);
  ok(X.schemaCacheLookup("u9", SCHEMAS, { tool_slugs: ["GMAIL_SEND_EMAIL", "SLACK_SEND_MESSAGE"] }, tn + 1000) === null, "có slug chưa biết: tìm thật");
  ok(X.schemaCacheLookup("u9", SEARCH, { queries: [{ use_case: "send email gmail" }] }, tn + X.SCHEMA_TTL + 1) === null, "quá 24 giờ: hết");
  const known = X.cxKnownPrompt("u9", tn + 1000);
  ok(known.includes("GMAIL_SEND_EMAIL (Gmail)") && known.includes("recipient_email*: string") && known.includes("COMPOSIO_MULTI_EXECUTE_TOOL"), "lời dặn lượt sau: công cụ đã biết kèm tham số, gọi thẳng MULTI_EXECUTE", known);
  ok(X.cxKnownPrompt("u8", tn + 1000) === "", "người dùng khác: không có");
  // Tài khoản đích trên thẻ duyệt khi model không truyền.
  const cardAcct = (u) => X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "a@b.c" } }] }, u)?.account;
  ok(cardAcct("u9") === "me@work.com" && cardAcct("u8") === undefined && cardAcct(undefined) === undefined, "thẻ duyệt hiện tài khoản Gmail đang kết nối", [cardAcct("u9"), cardAcct("u8")]);
  ok(X.cxCard("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { user_email: "other@x.com" } }] }, "u9").account === "other@x.com", "model truyền tài khoản: dùng tài khoản đó");
  X.cxLearn("u9", "COMPOSIO_MANAGE_CONNECTIONS", JSON.stringify({ data: { results: { gmail: { status: "active", connected_account_id: "ca_2", user_info: { email: "second@x.com" } } } } }), tn + 2000);
  ok(cardAcct("u9") === "second@x.com", "Composio báo lại kết nối Gmail: theo lần báo mới nhất", cardAcct("u9"));
  X.cxLearn("u9", "COMPOSIO_MANAGE_CONNECTIONS", JSON.stringify({ data: { connections: [{ toolkit: "gmail", status: "ACTIVE", email: "a@x.com" }, { toolkit: "gmail", status: "ACTIVE", email: "b@x.com" }] } }), tn + 3000);
  ok(cardAcct("u9") === undefined, "Gmail có hai tài khoản đang kết nối: không đoán", cardAcct("u9"));
  ok(X.cxLearn("u9", "COMPOSIO_MULTI_EXECUTE_TOOL", searchRes) === undefined && X.cxHints("u7") === undefined, "không học từ kết quả thao tác (dữ liệu người ngoài viết)");
  X.invalidateSchemaCache("u9");
  ok(X.schemaCacheLookup("u9", SCHEMAS, { tool_slugs: ["GMAIL_SEND_EMAIL"] }, tn + 4000) === null && X.cxKnownPrompt("u9", tn + 4000) === "" && cardAcct("u9") === undefined, "connector đổi: bỏ lược đồ và tài khoản đã biết");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
