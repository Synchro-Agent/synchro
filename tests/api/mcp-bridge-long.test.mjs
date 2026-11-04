// Cầu nối MCP cho CLI: công cụ xong nhanh trả JSON như cũ; công cụ chạy lâu trả qua luồng SSE có nhịp giữ kết nối để thư viện HTTP của CLI không tự cắt
// (fetch của Node cắt sau 5 phút không có phản hồi). Hàm thuần, không cần máy chủ. Hành vi của CLI thật chưa kiểm được ở đây.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { mcpbridge: M } = await loadTs(["mcpbridge"]);
M.BRIDGE_SSE.after = 80; M.BRIDGE_SSE.ping = 40;

const tools = [{ name: "nhanh", description: "", input_schema: {} }, { name: "lau", description: "", input_schema: {} }];
const br = M.openBridge({ uid: "u", tools, call: async (name) => { if (name === "lau") await sleep(400); return { content: `xong ${name}`, is_error: false }; } });
const token = br.url.split("/").pop();
const post = (body, accept = "application/json, text/event-stream") => M.bridgeRoute(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json", accept }, body: JSON.stringify(body) }), token);
const call = (name, extra = {}) => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: {}, ...extra } });

let r = await post(call("nhanh"));
ok((r.headers.get("content-type") ?? "").includes("application/json") && (await r.json()).result.content[0].text === "xong nhanh", "công cụ xong nhanh: JSON như cũ");

const t0 = Date.now();
r = await post(call("lau"));
ok((r.headers.get("content-type") ?? "").includes("text/event-stream") && Date.now() - t0 < 300, "công cụ chạy lâu: mở luồng ngay, không chờ công cụ xong", Date.now() - t0);
ok(/no-transform/.test(r.headers.get("cache-control") ?? "") && !!r.headers.get("mcp-session-id"), "không bị nén gộp, có mã phiên");
let text = await r.text();
ok((text.match(/^: /gm) ?? []).length >= 3, "có nhịp giữ kết nối trong lúc chờ", text);
let msgs = text.split("\n\n").flatMap((b) => b.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))));
ok(msgs.length === 1 && msgs[0].id === 7 && msgs[0].result.content[0].text === "xong lau" && msgs[0].result.isError === false, "sự kiện cuối là kết quả của đúng yêu cầu", text);

r = await post(call("lau", { _meta: { progressToken: "p1" } }));
text = await r.text();
msgs = text.split("\n\n").flatMap((b) => b.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))));
ok(msgs.some((m) => m.method === "notifications/progress" && m.params.progressToken === "p1") && msgs.at(-1).id === 7, "client gửi progressToken thì nhận thông báo tiến độ", text);

r = await post(call("lau"), "application/json");
ok((r.headers.get("content-type") ?? "").includes("application/json") && (await r.json()).result.content[0].text === "xong lau", "client không nhận SSE: chờ rồi trả JSON");

r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
ok((await r.json()).result.tools.length === 2, "yêu cầu khác không đổi");
r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
ok(r.status === 202, "thông báo: 202 như cũ");

br.close();

// CLI hủy lời gọi hay ngắt kết nối: lời gọi đang chờ (thẻ duyệt) phải biết để thôi, không chạy công cụ ghi khi kết quả không còn ai nhận.
const seen = [];
const waitCancel = (signal) => new Promise((ok2) => { if (signal.aborted) ok2("hủy"); signal.addEventListener("abort", () => ok2("hủy"), { once: true }); setTimeout(() => ok2("hết giờ"), 3000); });
const b2 = M.openBridge({ uid: "u", tools, call: async (name, _input, cancel) => { const out = await waitCancel(cancel); seen.push(out); return { content: out, is_error: out === "hủy" }; } });
const t2 = b2.url.split("/").pop();
const post2 = (body, signal, accept = "application/json") => M.bridgeRoute(new Request("http://x/", { method: "POST", signal, headers: { "content-type": "application/json", accept }, body: JSON.stringify(body) }), t2);
let p2 = post2({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "lau", arguments: {} } });
await sleep(50);
r = await post2({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 21, reason: "timeout" } });
ok(r.status === 202, "notifications/cancelled: 202");
r = await p2;
ok((await r.json()).result.isError === true && seen[0] === "hủy", "CLI hủy lời gọi: tín hiệu tới công cụ đang chờ", seen);
r = await post2({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 999 } });
ok(r.status === 202, "hủy lời gọi không còn tồn tại: không lỗi");
const hang = new AbortController();
p2 = post2({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "lau", arguments: {} } }, hang.signal);
await sleep(50);
hang.abort();
await p2.catch(() => null);
await sleep(20);
ok(seen[1] === "hủy", "CLI ngắt kết nối khi đang chờ JSON: tín hiệu tới công cụ", seen);
r = await post2({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "lau", arguments: {} } }, undefined, "application/json, text/event-stream");
ok((r.headers.get("content-type") ?? "").includes("text/event-stream"), "công cụ lâu mở luồng SSE");
await r.body.cancel();
await sleep(20);
ok(seen[2] === "hủy", "CLI đóng luồng SSE: tín hiệu tới công cụ", seen);
let parks = 0;
b2.onPark(() => parks++);
ok(parks === 0, "chưa chờ duyệt thì chưa nhả chỗ");
b2.park(); b2.park();
ok(parks === 1, "chờ duyệt: báo cho người đã đăng ký, mỗi người một lần", parks);
// Cầu nối sống cả lượt chat: lần chạy CLI sau (nhắc làm tiếp, tin nhắn thêm) đăng ký lại, phải giữ khóa tới khi chính nó dừng chờ.
b2.onPark(() => parks++);
ok(parks === 1, "lần chạy CLI sau trên cùng cầu nối không bị nhả khóa ngay", parks);
b2.park();
ok(parks === 2, "lần chạy sau dừng chờ duyệt: nhả khóa", parks);
b2.close();
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
