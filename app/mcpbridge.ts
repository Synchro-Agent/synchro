// Cầu nối MCP cho gói subscription: CLI chính chủ (Claude Code, Codex) chạy trên chính máy chủ gọi được công cụ của Synchro
// (skill, plugin, connector, chạy code, đọc dữ liệu đã lưu, danh sách việc) qua một máy chủ MCP Streamable HTTP nội bộ.
// Mỗi lượt chat mở một cầu nối riêng với mã bí mật ngẫu nhiên, chỉ nhận kết nối trực tiếp từ máy chủ (không qua nginx),
// và đóng ngay khi lượt xong. Lời gọi công cụ chạy trong ngữ cảnh của lượt nên nhật ký làm việc, kết quả, tin nhắn thêm vẫn đúng chỗ.
import crypto from "node:crypto";
import { MAX_TURN_MS } from "./ai/cli_runtime";
import { currentRun, inRun } from "./runs";

export type BridgeTool = { name: string; description: string; input_schema: unknown };
// image: ảnh (base64) kèm kết quả, ví dụ ảnh chụp trình duyệt của Synchro Code (JPEG) hay ảnh connector trả về (mime cho biết loại ảnh).
type Bridge = { uid: string; run: string | null; tools: BridgeTool[]; call: (name: string, input: Record<string, unknown>) => Promise<{ content: string; is_error: boolean; image?: string; mime?: string }>; exp: number; busy: number; last: number };
const g = globalThis as unknown as { __synchroBridges?: Map<string, Bridge> };
const bridges = (g.__synchroBridges ??= new Map());

/** Địa chỉ nội bộ của Synchro mà CLI (cùng máy) gọi tới. */
export const internalUrl = () => (process.env.SYNCHRO_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/** Mở cầu nối cho lượt hiện tại; close() khi lượt xong (tự hết hạn sau 35 phút nếu quên). */
export function openBridge(o: { uid: string; tools: BridgeTool[]; call: Bridge["call"] }) {
  const now = Date.now();
  for (const [k, b] of bridges) if (b.exp < now) bridges.delete(k);
  const token = crypto.randomBytes(24).toString("base64url");
  // Sống tới hết mức trần của lượt (lượt xong thì close() xóa ngay).
  const b: Bridge = { ...o, run: currentRun(), exp: now + MAX_TURN_MS + 5 * 60_000, busy: 0, last: now };
  bridges.set(token, b);
  // alive: đang chạy công cụ thì là "bây giờ", không thì lúc công cụ gần nhất xong (để biết CLI còn làm việc).
  return { url: `${internalUrl()}/api/mcp/bridge/${token}`, close: () => { bridges.delete(token); }, alive: () => (b.busy ? Date.now() : b.last) };
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Xử lý một yêu cầu JSON-RPC của MCP; null với thông báo (không cần trả lời). */
async function handle(b: Bridge, m: Rpc): Promise<unknown | null> {
  if (m.id === undefined || m.id === null) return null;
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "synchro", title: "Synchro", version: "1.0.0" },
        instructions: "Công cụ của Synchro: skill và thư viện plugin, connector của người dùng, chạy code, đọc dữ liệu đã lưu, danh sách việc.",
      });
    case "ping": return ok(m.id, {});
    case "tools/list":
      // antigravity/alwaysLoad: Antigravity nạp sẵn công cụ (gọi thẳng mcp_synchro_…) thay vì để model tự tìm rồi gọi qua CallMcpTool.
      return ok(m.id, { tools: b.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema ?? { type: "object", properties: {} }, _meta: { "antigravity/alwaysLoad": true } })) });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      if (!b.tools.some((t) => t.name === name)) return fail(m.id, -32602, `Không có công cụ ${name}`);
      const args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
      try {
        b.busy++; b.last = Date.now();
        const r = await inRun(b.run, () => b.call(name, args)).finally(() => { b.busy--; b.last = Date.now(); });
        return ok(m.id, { content: [{ type: "text", text: r.content }, ...(r.image ? [{ type: "image", data: r.image, mimeType: r.mime ?? "image/jpeg" }] : [])], isError: r.is_error });
      } catch (e) {
        return ok(m.id, { content: [{ type: "text", text: `Lỗi: ${(e as Error).message}` }], isError: true });
      }
    }
    case "resources/list": return ok(m.id, { resources: [] });
    case "prompts/list": return ok(m.id, { prompts: [] });
  }
  return fail(m.id, -32601, `Không hỗ trợ ${m.method}`);
}

// Lời gọi xong nhanh thì trả JSON như thường. Lâu hơn (chờ người dùng duyệt, công cụ chạy lâu) thì chuyển sang luồng SSE có nhịp giữ kết nối: máy khách HTTP của CLI
// thường cắt nếu 5 phút không thấy header. Đặc tả Streamable HTTP buộc máy khách đọc được cả hai kiểu; progressToken nếu có thì báo tiến độ để CLI tính lại thời gian chờ.
const SLOW_MS = 20_000, PING_MS = 15_000;
const slowStream = (work: Promise<unknown[]>, tokens: unknown[], sid: string) => {
  const enc = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined, n = 0;
  return new Response(new ReadableStream<Uint8Array>({
    start(ctl) {
      const say = (t: string) => { try { ctl.enqueue(enc.encode(t)); } catch {} };
      say(": chờ công cụ\n\n");
      ping = setInterval(() => {
        say(": ping\n\n");
        n++;
        for (const progressToken of tokens) say(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress: n } })}\n\n`);
      }, PING_MS);
      work.then((out) => { for (const m of out) say(`event: message\ndata: ${JSON.stringify(m)}\n\n`); }, () => {}).finally(() => { clearInterval(ping); try { ctl.close(); } catch {} });
    },
    cancel() { clearInterval(ping); },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "mcp-session-id": sid } });
};

/** Route POST /api/mcp/bridge/<token>: một yêu cầu hoặc một lô yêu cầu JSON-RPC; trả JSON, lời gọi lâu thì chuyển sang luồng SSE. */
export async function bridgeRoute(req: Request, token: string): Promise<Response> {
  // Chỉ CLI chạy trên chính máy chủ: nginx luôn gắn X-Real-IP cho yêu cầu từ ngoài vào (Next không tự gắn header này).
  if (req.headers.get("x-real-ip")) return new Response("Forbidden", { status: 403 });
  const b = bridges.get(token);
  if (!b || b.exp < Date.now()) return Response.json(fail(null, -32001, "Cầu nối đã đóng (lượt chat đã xong)."), { status: 404 });
  if (req.method === "GET") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 200 });
  const body = (await req.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return Response.json(fail(null, -32700, "JSON không hợp lệ"), { status: 400 });
  const list = Array.isArray(body) ? body : [body];
  const sid = req.headers.get("mcp-session-id") ?? crypto.randomBytes(8).toString("hex");
  const work = Promise.all(list.map((m) => handle(b, m))).then((r) => r.filter((x) => x !== null));
  let slow: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([work, new Promise<null>((ok) => { slow = setTimeout(() => ok(null), SLOW_MS); })]);
  clearTimeout(slow);
  if (first === null && (req.headers.get("accept") ?? "").includes("text/event-stream")) {
    const tokens = list.map((m) => (m.params?._meta as { progressToken?: unknown } | undefined)?.progressToken).filter((t) => t !== undefined);
    return slowStream(work, tokens, sid);
  }
  const out = first ?? await work;
  if (!out.length) return new Response(null, { status: 202, headers: { "mcp-session-id": sid } });
  return Response.json(Array.isArray(body) ? out : out[0], { headers: { "mcp-session-id": sid } });
}
