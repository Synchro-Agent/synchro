// Nguồn trích dẫn có favicon + số [n], logo ứng dụng Composio: máy chủ tải hộ ảnh qua bộ đệm (app/iconproxy.ts), chặn tên miền nội bộ,
// một ảnh chỉ tải một lần dù nhiều yêu cầu cùng lúc, nhớ cả lần không tải được; số trích dẫn khớp đúng thứ tự nguồn của lượt.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu riêng, máy chủ ảnh và Composio giả lập chạy ngay trong tệp này.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { COMPOSIO_KEY, composioHandler } from "../../scripts/mock-composio.mjs";
import { solidPng } from "../../scripts/mock-png.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };

const hits = new Map();
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const d of req) raw += d;
  let b = {};
  try { b = raw ? JSON.parse(raw) : {}; } catch {}
  const p = new URL(req.url, "http://x").pathname;
  const fav = /^\/favicon\/([\w.-]+)$/.exec(p);
  if (fav) {
    hits.set(fav[1], (hits.get(fav[1]) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, 80));
    if (fav[1].startsWith("noicon.")) { res.writeHead(404); res.end(); return; }
    if (fav[1].startsWith("html.")) { res.writeHead(200, { "content-type": "image/png" }); res.end("<script>alert(1)</script>"); return; }
    const png = solidPng(fav[1]);
    res.writeHead(200, { "content-type": "text/plain" }); res.end(png); return;
  }
  if (!(await composioHandler(req, res, p, b))) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cite-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cite-test-key";
process.env.MCP_ALLOW_PRIVATE = "1";
process.env.FAVICON_BASE = BASE;
process.env.COMPOSIO_BASE_URL = `${BASE}/composio/api/v3.1`;
delete process.env.COMPOSIO_API_KEY;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { iconproxy: IP, connicons: CI, composio: X, providers: PR, llmcall: L } = await loadTs(["iconproxy", "connicons", "composio", "providers", "llmcall"]);
const isPng = (i) => i && i.mime === "image/png" && i.buf[0] === 0x89;

try {
  console.log("1. Chỉ nhận tên miền công khai");
  const bad = ["localhost", "127.0.0.1", "10.0.0.1", "[::1]", "foo", "a..b", "x.internal", "printer.local", "evil.com:8080", "http://evil.com", "a b.com", "-x.com", ""];
  // Bản giả lập cho .test / .example (FAVICON_BASE); tắt đi để kiểm tra đúng luật thật.
  delete process.env.FAVICON_BASE;
  ok(bad.every((h) => IP.publicHost(h) === null), "localhost, IP, tên nội bộ, có cổng / giao thức / khoảng trắng: từ chối", bad.filter((h) => IP.publicHost(h) !== null).join(", "));
  ok(IP.publicHost("intranet.corp") === null && IP.publicHost("site.test") === null, "đuôi nội bộ (.corp, .test) bị từ chối ở bản thật");
  ok(IP.publicHost("WWW.Example.COM") === "example.com" && IP.publicHost("vnexpress.net") === "vnexpress.net" && IP.publicHost("bbc.co.uk") === "bbc.co.uk", "tên miền công khai được nhận (bỏ www., chữ thường)");
  process.env.FAVICON_BASE = BASE;

  console.log("2. Tải hộ favicon, bộ đệm");
  const all = await Promise.all([1, 2, 3, 4].map(() => IP.cachedIcon("site:news.test", () => CI.siteIcon("news.test"))));
  ok(all.every(isPng), "ảnh PNG nhận diện bằng byte đầu tệp (máy chủ báo sai Content-Type vẫn đúng)", all.map((x) => x?.mime).join(","));
  ok(hits.get("news.test") === 1, "4 yêu cầu cùng lúc chỉ tải một lần", hits.get("news.test"));
  await IP.cachedIcon("site:news.test", () => CI.siteIcon("news.test"));
  ok(hits.get("news.test") === 1, "lần sau lấy từ bộ nhớ");
  const dir = path.join(process.env.DATA_DIR, "iconcache");
  ok(fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".bin")), "ảnh được lưu xuống đĩa");
  globalThis.__synchroIcons.mem.clear();
  const disk = await IP.cachedIcon("site:news.test", () => CI.siteIcon("news.test"));
  ok(isPng(disk) && hits.get("news.test") === 1, "khởi động lại (bộ nhớ trống): đọc từ đĩa, không tải lại");
  const miss1 = await IP.cachedIcon("site:noicon.test", () => CI.siteIcon("noicon.test"));
  const miss2 = await IP.cachedIcon("site:noicon.test", () => CI.siteIcon("noicon.test"));
  ok(miss1 === null && miss2 === null && hits.get("noicon.test") === 1, "trang không có icon: null, nhớ lần hỏng (không hỏi lại mỗi lần vẽ)", hits.get("noicon.test"));
  const fake = await IP.cachedIcon("site:html.test", () => CI.siteIcon("html.test"));
  ok(fake === null, "nội dung không phải ảnh (HTML có script) bị bỏ dù Content-Type nói là ảnh");
  const resp = IP.iconResponse(disk);
  ok(/sandbox/.test(resp.headers.get("content-security-policy") ?? "") && resp.headers.get("x-content-type-options") === "nosniff", "phản hồi ảnh có CSP sandbox + nosniff (SVG mở thẳng cũng không chạy script)");
  let blocked = null;
  delete process.env.FAVICON_BASE;
  process.env.MCP_ALLOW_PRIVATE = "0";
  blocked = await CI.fetchIconBytes(`${BASE}/favicon/news.test`);
  ok(blocked === null, "safeFetch chặn địa chỉ nội bộ / http khi không phải bản giả lập");
  process.env.MCP_ALLOW_PRIVATE = "1";
  process.env.FAVICON_BASE = BASE;

  console.log("3. Logo ứng dụng Composio (meta.logo của toolkits)");
  ok(await X.toolkitLogoUrl("gmail").catch(() => "err") === null || X.composioKey() === null, "chưa có khóa: không gọi Composio");
  await PR.saveProvider({ id: "composio", key: COMPOSIO_KEY });
  const u = await X.toolkitLogoUrl("notion");
  ok(u === `${BASE}/composio/logos/notion.png`, "địa chỉ logo lấy từ meta.logo", u);
  ok(await X.toolkitLogoUrl("nologo") === null, "ứng dụng không có logo: null (giao diện hiện chữ cái đầu)");
  ok(await X.toolkitLogoUrl("../etc") === null && await X.toolkitLogoUrl("A B") === null, "slug lạ không được gửi đi");
  const logo = await IP.cachedIcon("kit:notion", async () => { const x = await X.toolkitLogoUrl("notion"); return x ? CI.fetchIconBytes(x, 256 * 1024) : null; });
  ok(isPng(logo), "ảnh logo tải qua cùng bộ đệm");
  await fetch(`${BASE}/composio/_debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: { user_id: "u_a", slug: "notion" } }) });
  await fetch(`${BASE}/composio/_debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: { user_id: "u_a", slug: "github" } }) });
  const apps = await X.listApps("u_a", true);
  const notion = apps.find((a) => a.app === "notion"), gh = apps.find((a) => a.app === "github");
  ok(gh?.img === "/api/favicon?app=github" && !gh.logo, "ứng dụng không có logo sẵn (GitHub): dùng logo Composio qua /api/favicon", JSON.stringify(gh));
  ok(notion?.logo === "notion" && !notion.img, "ứng dụng có logo sẵn trong public/connectors (Notion): giữ logo đó", JSON.stringify(notion));

  console.log("4. Số trích dẫn [n]");
  const seen = new Map();
  const cite = (url, title) => { if (!seen.has(url)) seen.set(url, title); return [...seen.keys()].indexOf(url) + 1; };
  const blocks = [
    { type: "text", text: "Mình tìm trên web." },
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.com/1", title: "A" }, { type: "web_search_result", url: "https://b.org/2", title: "B" }] },
    { type: "text", text: "Giá tăng 5% " , citations: [{ type: "web_search_result_location", url: "https://b.org/2", title: "B", cited_text: "…" }] },
    { type: "text", text: "và lãi suất giữ nguyên.", citations: [{ type: "web_search_result_location", url: "https://a.com/1", title: "A" }, { type: "web_search_result_location", url: "https://a.com/1", title: "A" }] },
  ];
  L.searchResults(blocks, cite);
  const t = L.blocksText(blocks, cite);
  ok(t === "Mình tìm trên web.\n\nGiá tăng 5%[2] và lãi suất giữ nguyên.[1]", "Anthropic: số ngay sau đoạn có dẫn, trùng nguồn một số, số theo thứ tự kết quả tìm", JSON.stringify(t));
  ok(L.blocksText(blocks) === "Mình tìm trên web.\n\nGiá tăng 5% và lãi suất giữ nguyên.", "không bật trích dẫn: chữ như cũ");
  const r = L.respParse({ output: [{ type: "message", content: [{ type: "output_text", text: "Tin A. Tin C.", annotations: [{ type: "url_citation", url: "https://c.net/x", title: "C", end_index: 13 }, { type: "url_citation", url: "https://a.com/1", title: "A", end_index: 6 }, { type: "url_citation", url: "javascript:alert(1)", end_index: 6 }] }] }] }, cite);
  ok(r.text === "Tin A.[1] Tin C.[3]", "OpenAI: url_citation đặt số ở end_index, bỏ địa chỉ không phải http(s)", JSON.stringify(r.text));
  ok(L.respParse({ output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://z.com" }] }] }] }).text === "x", "không bật trích dẫn: OpenAI như cũ");
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
