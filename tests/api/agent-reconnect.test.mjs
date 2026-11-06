// Nối lại lượt Code sau khi mất mạng: chỉ dòng phát lại từ đầu mới được dựng lại lượt; các lần nối sau giữ phần đã hiện và thẻ đang chờ duyệt. Tự chạy được, fetch giả, không cần dev:mock.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x).slice(0, 500)); };
const { wsclient: W, agentfold: F } = await loadTs(["wsclient", "agentfold"]);

const head = { t: "run", node: { id: 7 }, running: true, count: 3 };
// cut: gửi hết các dòng rồi đứt mạng ở lần đọc sau (lỗi ngay trong start sẽ làm mất các dòng đang xếp hàng).
const body = (lines, cut) => { let sent = false; return new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new TextEncoder().encode(lines.map((l) => JSON.stringify(l) + "\n").join(""))); return; } if (cut) c.error(new TypeError("network")); else c.close(); } }); };
const calls = [];
const reals = [
  (u) => { calls.push(u); return new Response(body([head, { t: "text", text: "phần đầu", s: 1 }, { t: "ask", id: "q", kind: "bash", title: "rm", s: 2 }], true)); },
  (u) => { calls.push(u); return new Response(body([head, { t: "asked", id: "q", ok: true, s: 3 }, { t: "end", s: 3 }])); },
];
let k = 0;
globalThis.fetch = async (u) => reals[k++](String(u));
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, Math.min(ms, 5), ...a); // follow chờ 3 giây giữa hai lần nối

// Đúng cách codeview dùng dòng này: fromStart thì xóa lượt, còn lại gộp sự kiện.
let node = { ai: "bản cũ trên thiết bị", steps: [{ k: "text", text: "bản cũ trên thiết bị" }] }, heads = [];
await W.attachAgent(9, (e) => {
  if (e.t === "run") { heads.push(e.fromStart); if (e.fromStart) node = { ...node, ai: "", steps: [] }; }
  else if (e.t !== "end") node = F.foldAgentEvent(node, e);
}, new AbortController().signal);
globalThis.setTimeout = realSetTimeout;

ok(calls[0].includes("after=0") && calls[1].includes("after=2"), "lần nối sau chỉ xin sự kiện sau mốc đã nhận", calls);
ok(heads[0] === true && heads[1] === false, "lần đầu phát lại từ đầu, lần nối lại thì không", heads);
ok(node.ai === "phần đầu", "phần chữ đã hiện còn nguyên sau khi nối lại", node);
const ask = node.steps.find((x) => x.k === "ask");
ok(ask && ask.state === "ok", "thẻ duyệt còn đó và nhận được kết quả", node.steps);

// Chưa nhận sự kiện nào mà đã mất mạng: máy chủ phát lại hết nên vẫn phải là từ đầu.
const seen = []; let n2 = 0;
globalThis.fetch = async () => (n2++ ? new Response(body([head, { t: "end", s: 3 }])) : new Response(body([head], true)));
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, Math.min(ms, 5), ...a);
await W.attachAgent(9, (e) => { if (e.t === "run") seen.push(e.fromStart); }, new AbortController().signal);
globalThis.setTimeout = realSetTimeout;
ok(seen.length === 2 && seen.every(Boolean), "chưa có sự kiện nào thì nối lại vẫn phát từ đầu", seen);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
