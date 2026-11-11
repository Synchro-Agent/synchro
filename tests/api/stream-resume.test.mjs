// Theo dõi câu trả lời đang chạy khi rớt mạng / máy chủ khởi động lại (llm.ts waitRun, pollRun): luồng SSE đóng hẳn thì hỏi trạng thái
// định kỳ tới khi có lại kết nối, không báo lỗi ngay (câu trả lời vẫn chạy ở máy chủ). Máy chủ từ chối thật (4xx) thì báo lỗi.
// Tự chạy được, không cần dev:mock: fetch và EventSource giả lập ngay trong tệp này.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

// EventSource giả: luồng nào mở ra cũng bị đóng hẳn ngay (như nginx trả 502 lúc deploy).
let opened = 0;
globalThis.EventSource = class {
  static CLOSED = 2;
  constructor() { opened++; this.readyState = 0; setTimeout(() => { this.readyState = 2; this.onerror?.(); }, 5); }
  addEventListener() {}
  close() { this.readyState = 2; }
};
let replies = [];
let asked = 0;
globalThis.fetch = async () => {
  asked++;
  const r = replies.shift();
  if (r === "offline") throw new TypeError("Failed to fetch");
  if (typeof r === "number") return new Response("<html>Bad gateway</html>", { status: r, headers: { "content-type": "text/html" } });
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
};

const { llm: L } = await loadTs(["llm"]);

console.log("1. Rớt mạng rồi có lại: vẫn nhận đủ câu trả lời");
{
  replies = [
    "offline",
    502,
    { body: { run: { status: "running", events: [{ seq: 1, at: 1, kind: "tool", text: "Đang tìm trên web" }] }, live: { text: "Xin" } } },
    { body: { run: { status: "done", http: 200, events: [], result: { text: "Xin chào" } } } },
  ];
  const deltas = [], evs = [];
  const t0 = Date.now();
  const out = await L.waitRun("run_1", undefined, (t) => deltas.push(t), (e) => evs.push(e));
  ok(out.http === 200 && out.result.text === "Xin chào", "nhận được kết quả cuối sau khi mất kết nối", JSON.stringify(out));
  ok(deltas.includes("Xin") && evs.some((e) => e.seq === 1), "chữ đang viết và các bước vẫn tới trong lúc hỏi định kỳ", JSON.stringify({ deltas, evs }));
  ok(asked === 4, "hỏi lại cho tới khi có kết quả, không bỏ cuộc ở lần lỗi đầu", asked);
  ok(Date.now() - t0 >= 3500, "đang mất kết nối thì chờ giữa các lần hỏi (không hỏi dồn)", Date.now() - t0);
}

console.log("2. Máy chủ từ chối thật (4xx): báo lỗi");
{
  replies = [{ status: 404, body: { error: "Không tìm thấy lượt chạy." } }];
  asked = 0;
  const e = await L.waitRun("run_2").then(() => null, (x) => x);
  ok(e instanceof L.LLMError && e.status === 404 && /Không tìm thấy/.test(e.message), "404 → LLMError với lý do của máy chủ", String(e));
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
