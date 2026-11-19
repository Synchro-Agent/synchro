// Composio liên kết lại bằng khóa / tài khoản khác (W1-05 / W23-7): lược đồ công cụ và tài khoản đích đã biết của tài khoản Composio cũ phải bỏ ngay,
// dù danh sách công cụ meta của Composio giống hệt nhau ở mọi tài khoản. Tự chạy được: thư mục dữ liệu riêng và một máy chủ MCP giả lập trong tệp này.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };

// Máy chủ MCP giả lập kiểu Composio Connect: công cụ meta giống nhau cho mọi khóa.
const TOOLS = ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_MULTI_EXECUTE_TOOL"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } }));
const keys = [];
const server = http.createServer(async (req, res) => {
  const send = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (new URL(req.url, "http://x").pathname !== "/mcp") return send(404, {});
  if (req.method !== "POST") return send(req.method === "DELETE" ? 200 : 405, {});
  let s = ""; for await (const d of req) s += d;
  const m = JSON.parse(s || "{}");
  if (req.headers["x-consumer-api-key"]) keys.push(req.headers["x-consumer-api-key"]);
  if (m.method === "server/discover") return send(404, {});
  if (m.id === undefined) { res.writeHead(202); return res.end(); }
  if (m.method === "initialize") return send(200, { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "composio" } } });
  if (m.method === "tools/list") return send(200, { jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
  return send(200, { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cxrelink-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cx-relink-key";
process.env.MCP_ALLOW_PRIVATE = "1";
process.env.COMPOSIO_CONNECT_URL = `${BASE}/mcp`;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { connectors: C, composio: X } = await loadTs(["connectors", "composio"]);

const req = new Request("http://localhost:3200/x", { headers: { host: "localhost:3200" } });
const uid = "u_relink";
const pol = { custom: true, allowed: ["*"], destructive: true };
const SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS";
const args = { tool_slugs: ["GMAIL_SEND_EMAIL"] };
const schemaRes = JSON.stringify({ successful: true, data: { tool_schemas: { GMAIL_SEND_EMAIL: { toolkit: "gmail", tool_slug: "GMAIL_SEND_EMAIL", input_schema: { type: "object", properties: { recipient_email: { type: "string" } } } } } } });
const learnOld = () => {
  X.schemaCachePut(uid, SCHEMAS, args, schemaRes);
  X.cxLearn(uid, "COMPOSIO_MANAGE_CONNECTIONS", JSON.stringify({ data: { results: { gmail: { toolkit: "gmail", status: "active", connected_account_id: "ca_old", email: "old@x.com" } } } }));
};
const known = () => ({ schema: X.schemaCacheGet(uid, SCHEMAS, args) !== null, account: X.cxAccount(uid, "gmail") ?? null });

try {
  console.log("1. Dán khóa ck_ mới đè lên khóa đang chạy tốt");
  ok(C.composioInfo(uid, pol).state === "unlinked", "Composio có sẵn, chưa liên kết");
  await C.linkComposio(req, uid, pol, { key: "ck_first_account_1" });
  ok(C.composioInfo(uid, pol).state === "linked" && keys.includes("ck_first_account_1"), "liên kết bằng khóa thứ nhất");
  learnOld();
  ok(known().schema && known().account === "old@x.com", "đã biết lược đồ và tài khoản Gmail của tài khoản Composio cũ", JSON.stringify(known()));
  await C.linkComposio(req, uid, pol, { key: "ck_second_account_2" });
  ok(C.composioInfo(uid, pol).state === "linked" && keys.at(-1) === "ck_second_account_2", "đổi sang khóa thứ hai (cùng danh sách công cụ meta)");
  ok(!known().schema && known().account === null, "khóa mới: bỏ lược đồ và tài khoản đích của tài khoản cũ", JSON.stringify(known()));

  console.log("2. Kiểm tra lại cùng khóa (danh sách công cụ không đổi): giữ cache");
  learnOld();
  const id = C.composioInfo(uid, pol).connector.id;
  await C.refreshConnector(uid, id, pol);
  ok(known().schema && known().account === "old@x.com", "kiểm tra lại định kỳ không xóa cache 24 giờ", JSON.stringify(known()));

  console.log("3. Khóa mới bị từ chối: không đổi gì");
  ok(await C.linkComposio(req, uid, pol, { key: "ck_bad key" }).then(() => false, () => true), "khóa sai dạng bị từ chối");
  ok(known().schema && known().account === "old@x.com", "khóa bị từ chối: cache vẫn nguyên", JSON.stringify(known()));

  console.log("4. Ứng dụng đã nối cho bộ định tuyến: toolkit Composio báo đang kết nối, mất khi ngắt liên kết");
  const doc = { toolkit: "googledocs", status: "active", connected_account_id: "ca_docs", email: "a@x.com" };
  const docs = { googledocs: doc };
  X.cxLearn(uid, "COMPOSIO_MANAGE_CONNECTIONS", JSON.stringify({ data: { results: docs } }));
  const apps = C.connectedApps(uid);
  ok(apps.includes("Gmail") && apps.includes("Google Docs"), "Gmail và Google Docs đang kết nối", JSON.stringify(apps));
  C.unlinkComposio(uid, pol);
  const left = C.connectedApps(uid);
  ok(!left.length, "ngắt liên kết Composio: không còn ứng dụng nào", JSON.stringify(left));
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
