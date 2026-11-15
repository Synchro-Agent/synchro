// Nguồn trích dẫn có favicon + số [n] (Connect Link của Composio không phải nguồn): máy chủ tải hộ ảnh qua bộ đệm (server/iconproxy.ts), chặn tên miền nội bộ,
// một ảnh chỉ tải một lần dù nhiều yêu cầu cùng lúc, nhớ cả lần không tải được; số trích dẫn khớp đúng thứ tự nguồn của lượt.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu riêng, máy chủ ảnh giả lập chạy ngay trong tệp này.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
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
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cite-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cite-test-key";
process.env.MCP_ALLOW_PRIVATE = "1";
process.env.FAVICON_BASE = BASE;
delete process.env.COMPOSIO_CONNECT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { iconproxy: IP, connicons: CI, composio: X, llmcall: L, "ai/subs": SB } = await loadTs(["iconproxy", "connicons", "composio", "llmcall", "ai/subs"]);
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
  // Bộ đệm trên đĩa có giới hạn: vòng lặp hỏi tên miền ngẫu nhiên không làm đầy đĩa; tải mới đi qua cổng giới hạn, ảnh đã có thì không.
  {
    process.env.SYNCHRO_ICON_DISK_MAX = "30";
    const tiny = { mime: "image/png", buf: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
    for (let i = 0; i < 160; i++) await IP.cachedIcon(`site:rand${i}.test`, async () => (i % 2 ? tiny : null));
    const n = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
    ok(n <= 30 + 50, "160 tên miền lạ: thư mục bộ đệm dọn về tối đa SYNCHRO_ICON_DISK_MAX mục (cộng tối đa 50 mục ghi sau lần dọn gần nhất)", n);
    IP.pruneDisk(Date.now() + 8 * 86_400_000);
    ok(!fs.readdirSync(dir).some((f) => f.endsWith(".json")), "mục hết hạn bị xóa khỏi đĩa (không chỉ bị bỏ qua khi đọc)", fs.readdirSync(dir).length);
    delete process.env.SYNCHRO_ICON_DISK_MAX;
    let gated = 0;
    const gate = () => { gated++; if (gated > 1) throw Object.assign(new Error("429"), { status: 429 }); };
    await IP.cachedIcon("site:gate1.test", async () => tiny, gate);
    await IP.cachedIcon("site:gate1.test", async () => tiny, gate);
    const denied = await IP.cachedIcon("site:gate2.test", async () => tiny, gate).then(() => "ok", (e) => e.message);
    ok(gated === 2 && denied === "429", "ảnh đã có không qua cổng giới hạn; tải mới quá giới hạn thì bị từ chối", { gated, denied });
  }
  // U11: ảnh rỗng / dưới 100 byte không phải favicon thật: /api/favicon trả 404 để giao diện hiện chữ cái đầu thay cho ô vuông trắng.
  ok(IP.usableIcon(null) === null && IP.usableIcon({ mime: "image/png", buf: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }) === null && IP.usableIcon({ mime: "image/png", buf: Buffer.alloc(0) }) === null, "ảnh rỗng, ảnh 4 byte: coi như không có ảnh");
  ok(IP.usableIcon({ mime: "image/png", buf: Buffer.alloc(IP.MIN_ICON_BYTES) }) !== null, "ảnh từ 100 byte trở lên: dùng được");
  ok(/usableIcon\(await cachedIcon\(`site:/.test(fs.readFileSync(path.join(process.cwd(), "app/api/favicon/route.ts"), "utf8")), "/api/favicon lọc ảnh quá nhỏ trước khi trả");
  let blocked = null;
  delete process.env.FAVICON_BASE;
  process.env.MCP_ALLOW_PRIVATE = "0";
  blocked = await CI.fetchIconBytes(`${BASE}/favicon/news.test`);
  ok(blocked === null, "safeFetch chặn địa chỉ nội bộ / http khi không phải bản giả lập");
  process.env.MCP_ALLOW_PRIVATE = "1";
  process.env.FAVICON_BASE = BASE;

  console.log("3. Connect Link của Composio không phải nguồn");
  const cl = "https://connect.composio.dev/link/lk_gmail123";
  const found = SB.linksIn(`Bấm 👉 [Kết nối Gmail](${cl}) nhé.\n\nSources:\n- [Kết nối Gmail](${cl})\n- [Bài báo](https://vnexpress.net/a)`);
  ok(found.length === 1 && found[0].url === "https://vnexpress.net/a", "nguồn lấy từ câu trả lời bỏ Connect Link, giữ nguồn thật", JSON.stringify(found));
  ok(!X.notConnectLink(cl) && X.notConnectLink("https://docs.composio.dev/docs/composio-connect"), "trang tài liệu Composio vẫn là nguồn được, Connect Link thì không");

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
