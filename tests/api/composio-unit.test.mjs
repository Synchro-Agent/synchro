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

const { connectors: C, providers: PR, authstore: AS, composio: X, cxlink: L, catalog: CAT } = await loadTs(["connectors", "providers", "authstore", "composio", "cxlink", "catalog"]);
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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
