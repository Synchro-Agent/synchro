// Cầu nối MCP cho gói subscription: CLI chính chủ (Claude Code, Codex) chạy trên chính máy chủ gọi được công cụ của Synchro
// (skill, plugin, connector, chạy code, đọc dữ liệu đã lưu, danh sách việc) qua một máy chủ MCP Streamable HTTP nội bộ.
// Mỗi lượt chat mở một cầu nối riêng với mã bí mật ngẫu nhiên, chỉ nhận kết nối trực tiếp từ máy chủ (không qua nginx),
// và đóng ngay khi lượt xong. Lời gọi công cụ chạy trong ngữ cảnh của lượt nên nhật ký làm việc, kết quả, tin nhắn thêm vẫn đúng chỗ.
import crypto from "node:crypto";
import { MAX_TURN_MS } from "./ai/cli_runtime";
import { currentRun, inRun } from "./runs";

export type BridgeTool = { name: string; description: string; input_schema: unknown };
// image: ảnh (base64) kèm kết quả, ví dụ ảnh chụp trình duyệt của Synchro Code (JPEG) hay ảnh connector trả về (mime cho biết loại ảnh).
// live: lời gọi đang chạy theo id JSON-RPC, để CLI hủy được (notifications/cancelled). cancel: tín hiệu CLI hủy lời gọi hay đã ngắt kết nối.
type Bridge = { uid: string; run: string | null; tools: BridgeTool[]; call: (name: string, input: Record<string, unknown>, cancel?: AbortSignal) => Promise<{ content: string; is_error: boolean; image?: string; mime?: string; more?: { data: string; mime: string }[] }>; exp: number; busy: number; last: number; live: Map<string, AbortController>; hold?: number; jobs: Map<string, Job>; route?: (name: string, input: Record<string, unknown>) => { name: string; input: Record<string, unknown> } | null };
type Reply = Awaited<ReturnType<Bridge["call"]>>;
// hold: CLI tự cắt mỗi lần chờ công cụ sau một khoảng cố định, nên trả lời trước hạn đó bằng mã việc; công cụ vẫn chạy, model gọi wait_for_result để chờ tiếp.
type Job = { name: string; done: Promise<Reply>; ctl: AbortController };
const g = globalThis as unknown as { __synchroBridges?: Map<string, Bridge> };
const bridges = (g.__synchroBridges ??= new Map());

// Antigravity cắt mọi lần chờ công cụ hay chờ duyệt ở khoảng 190 giây (đo trên agy 1.5.0, tool calls=1; Claude Code, Codex, Grok đều qua được 10 phút), model thấy lỗi dù công cụ vẫn chạy.
// Chưa thấy cấu hình nào của agy kéo dài được hạn này, nên cầu nối của nó trả lời trước hạn: quá hold ms thì trả "đang chạy" kèm job_id, công cụ tiếp tục chạy ở nền. Đọc ở đây để kiểm thử rút ngắn được.
export const BRIDGE_HOLD = { agy: 150_000 };
export const WAIT_TOOL: BridgeTool = {
  name: "wait_for_result",
  description: "Chờ tiếp một công cụ đang chạy dở hoặc đang chờ người dùng duyệt, khi công cụ đó vừa trả về job_id thay vì kết quả. Trả về kết quả thật khi có, hoặc lại báo đang chạy thì gọi lại với cùng job_id.",
  input_schema: { type: "object", properties: { job_id: { type: "string", description: "job_id do công cụ trả về" } }, required: ["job_id"] },
};
/** Dặn model ở hướng dẫn của lượt Antigravity (cả chat và Synchro Code). */
export const AGY_WAIT_NOTE = `\nCông cụ chạy lâu hoặc đang chờ người dùng duyệt: sau khoảng 2,5 phút công cụ trả về "đang chạy" kèm job_id thay cho kết quả. Đó không phải lỗi, việc vẫn đang chạy: gọi ngay mcp_synchro_wait_for_result với job_id đó và lặp lại tới khi có kết quả thật. Không gọi lại công cụ ban đầu, không báo thất bại, không kết thúc lượt khi còn job chưa lấy kết quả.`;
const stillRunning = (id: string, name: string): Reply => ({ is_error: false, content: `Công cụ ${name} vẫn đang chạy hoặc đang chờ người dùng duyệt, chưa có kết quả; đây không phải lỗi. job_id: ${id}. Gọi ngay wait_for_result với job_id này để chờ tiếp. Không gọi lại ${name}.` });
const rpcReply = (id: Rpc["id"], r: Reply) => ok(id, { content: [{ type: "text", text: r.content }, ...(r.image ? [{ type: "image", data: r.image, mimeType: r.mime ?? "image/jpeg" }] : []), ...(r.more ?? []).map((i) => ({ type: "image", data: i.data, mimeType: i.mime }))], isError: r.is_error });
/** Chờ việc xong trong hold ms; hết hạn (hoặc người chờ đã đi) thì null, việc vẫn chạy tiếp. */
function within(done: Promise<Reply>, ms: number, stop: AbortSignal[]): Promise<Reply | null> {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    const off = () => res(null);
    for (const s of stop) { if (s.aborted) off(); else s.addEventListener("abort", off, { once: true }); }
    done.then((r) => { clearTimeout(t); for (const s of stop) s.removeEventListener("abort", off); res(r); });
  });
}

/** Địa chỉ nội bộ của Synchro mà CLI (cùng máy) gọi tới. */
export const internalUrl = () => (process.env.SYNCHRO_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");

/** Mở cầu nối cho lượt hiện tại; close() khi lượt xong (tự hết hạn sau 35 phút nếu quên). */
/** park / onPark: lượt đang chờ người dùng duyệt (xem khóa lượt của Antigravity, Grok ở cli_engines.ts): CLI đã kết nối xong với cầu nối này nên không cần giữ chỗ trong cấu hình chung nữa. */
/** hold: xem BRIDGE_HOLD (chỉ Antigravity); CLI khác không có, hành vi không đổi. */
/** route: tên ngoài danh sách mà vẫn gọi được (connector qua proxy: model gọi thẳng tên connector_tools vừa in ra). */
export function openBridge(o: { uid: string; tools: BridgeTool[]; call: Bridge["call"]; hold?: number; route?: Bridge["route"] }) {
  const now = Date.now();
  for (const [k, b] of bridges) if (b.exp < now) bridges.delete(k);
  const token = crypto.randomBytes(24).toString("base64url");
  // Sống tới hết mức trần của lượt (lượt xong thì close() xóa ngay).
  const b: Bridge = { ...o, run: currentRun(), exp: now + MAX_TURN_MS + 5 * 60_000, busy: 0, last: now, live: new Map(), jobs: new Map() };
  const onParked: (() => void)[] = [];
  bridges.set(token, b);
  // alive: đang chạy công cụ thì là "bây giờ", không thì lúc công cụ gần nhất xong (để biết CLI còn làm việc).
  return {
    url: `${internalUrl()}/api/mcp/bridge/${token}`,
    // Lượt xong mà còn việc chưa ai lấy kết quả: không còn ai nhận, thôi chạy.
    // Lời gọi đang chờ duyệt cũng thôi: lượt đã xong thì bấm Cho phép muộn (tab cũ) không được chạy công cụ nữa.
    close: () => { bridges.delete(token); for (const j of b.jobs.values()) j.ctl.abort(); b.jobs.clear(); for (const c of b.live.values()) c.abort(); },
    /** Việc đã nhận job_id mà model chưa lấy kết quả: model kết thúc lượt sớm thì nhắc nó quay lại. */
    pendingJobs: () => [...b.jobs].map(([id, j]) => ({ id, name: j.name })),
    alive: () => (b.busy ? Date.now() : b.last),
    // Chỉ nhả lượt CLI đang chạy. Cầu nối sống cả lượt chat, có thể chạy CLI nhiều lần (nhắc làm tiếp, tin nhắn thêm): lần chạy sau cần giữ khóa tới khi nó đọc xong cấu hình,
    // mà công cụ chỉ tới được đây sau khi CLI đã khởi động, tức là sau onPark của chính lần chạy đó.
    park: () => { for (const f of onParked.splice(0)) f(); },
    onPark: (f: () => void) => { onParked.push(f); },
  };
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Công cụ trên CLI có hạn chờ (BRIDGE_HOLD): chạy như thường, quá hold thì trả job_id và để công cụ chạy tiếp ở nền (Dừng vẫn tới công cụ qua tín hiệu của lượt; cầu nối đóng thì thôi). */
async function heldCall(b: Bridge, id: Rpc["id"], name: string, args: Record<string, unknown>, gone?: AbortSignal) {
  const ctl = new AbortController(), key = String(id);
  // Trước khi trả job_id, CLI ngắt hay hủy nghĩa là không ai biết mã việc để lấy kết quả. Đã trả rồi thì kết nối của yêu cầu này không còn liên quan.
  const hang = () => ctl.abort();
  if (gone?.aborted) hang(); else gone?.addEventListener("abort", hang, { once: true });
  b.live.set(key, ctl);
  b.busy++; b.last = Date.now();
  const done = inRun(b.run, () => b.call(name, args, ctl.signal)).catch((e): Reply => ({ content: `Lỗi: ${(e as Error).message}`, is_error: true })).finally(() => { b.busy--; b.last = Date.now(); });
  const r = await within(done, b.hold!, []);
  gone?.removeEventListener("abort", hang);
  b.live.delete(key);
  if (r) return rpcReply(id, r);
  const job = `job_${crypto.randomBytes(5).toString("hex")}`;
  b.jobs.set(job, { name, done, ctl });
  return rpcReply(id, stillRunning(job, name));
}
/** wait_for_result: chờ thêm tối đa hold; có kết quả thì giao đúng một lần. Người chờ đi mất (CLI cắt, hủy) không làm công cụ dừng. */
async function waitJob(b: Bridge, id: Rpc["id"], job: string, gone?: AbortSignal) {
  const j = b.jobs.get(job);
  if (!j) return rpcReply(id, { is_error: true, content: `Không có job_id ${job}: kết quả có thể đã được trả ở lần gọi trước. Nếu vẫn cần thì gọi lại công cụ ban đầu.` });
  const ctl = new AbortController(), key = String(id);
  b.live.set(key, ctl);
  const r = await within(j.done, b.hold!, gone ? [ctl.signal, gone] : [ctl.signal]).finally(() => b.live.delete(key));
  if (!r) return rpcReply(id, stillRunning(job, j.name));
  b.jobs.delete(job);
  return rpcReply(id, r);
}

/** Xử lý một yêu cầu JSON-RPC của MCP; null với thông báo (không cần trả lời). gone: CLI đã ngắt kết nối của yêu cầu này. */
async function handle(b: Bridge, m: Rpc, gone?: AbortSignal): Promise<unknown | null> {
  if (m.id === undefined || m.id === null) {
    // CLI hủy một lời gọi (hết kiên nhẫn, model đổi ý): lời gọi đang chờ duyệt phải thôi, được duyệt muộn cũng không chạy nữa.
    if (m.method === "notifications/cancelled") b.live.get(String(m.params?.requestId))?.abort();
    return null;
  }
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "synchro", title: "Synchro", version: "1.0.0" },
        instructions: "Công cụ của Synchro: skill và thư viện plugin, connector của người dùng, chạy code, tạo ảnh, đọc dữ liệu đã lưu, danh sách việc.",
      });
    case "ping": return ok(m.id, {});
    case "tools/list":
      // antigravity/alwaysLoad: Antigravity nạp sẵn công cụ (gọi thẳng mcp_synchro_…) thay vì để model tự tìm rồi gọi qua CallMcpTool.
      return ok(m.id, { tools: [...b.tools, ...(b.hold ? [WAIT_TOOL] : [])].map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema ?? { type: "object", properties: {} }, _meta: { "antigravity/alwaysLoad": true } })) });
    case "tools/call": {
      let name = String(m.params?.name ?? "");
      let args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
      if (b.hold && name === WAIT_TOOL.name) return waitJob(b, m.id, String(args.job_id ?? ""), gone);
      if (!b.tools.some((t) => t.name === name)) {
        const to = b.route?.(name, args);
        if (!to) return fail(m.id, -32602, `Không có công cụ ${name}`);
        name = to.name; args = to.input;
      }
      if (b.hold) return heldCall(b, m.id, name, args, gone);
      const ctl = new AbortController(), key = String(m.id);
      const cancel = gone ? AbortSignal.any([ctl.signal, gone]) : ctl.signal;
      b.live.set(key, ctl);
      try {
        b.busy++; b.last = Date.now();
        const r = await inRun(b.run, () => b.call(name, args, cancel)).finally(() => { b.busy--; b.last = Date.now(); b.live.delete(key); });
        return rpcReply(m.id, r);
      } catch (e) {
        return ok(m.id, { content: [{ type: "text", text: `Lỗi: ${(e as Error).message}` }], isError: true });
      }
    }
    case "resources/list": return ok(m.id, { resources: [] });
    case "prompts/list": return ok(m.id, { prompts: [] });
  }
  return fail(m.id, -32601, `Không hỗ trợ ${m.method}`);
}

// Công cụ chạy lâu (dựng video tới 10 phút): CLI gọi cầu nối bằng HTTP, thư viện HTTP của nó có thể tự cắt khi quá lâu không có phản hồi (fetch của Node: 5 phút),
// lúc đó model thấy lỗi dù công cụ vẫn chạy. Nên công cụ chưa xong sau after ms thì mở luồng SSE (Streamable HTTP cho phép với client nhận text/event-stream),
// gửi nhịp giữ kết nối mỗi ping ms rồi kết quả cuối. Công cụ xong nhanh vẫn trả JSON như cũ. Đọc ở đây để kiểm thử rút ngắn được.
export const BRIDGE_SSE = { after: 20_000, ping: 15_000 };
const sseMsg = (x: unknown) => `event: message\ndata: ${JSON.stringify(x)}\n\n`;
function sseReply(work: Promise<unknown[]>, tokens: unknown[], sid: string, onGone: () => void) {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined, n = 0, gone = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      // Dòng chú thích SSE bị client bỏ qua; client có gửi progressToken thì thêm thông báo tiến độ để nó đặt lại hạn chờ.
      const beat = () => { n++; c.enqueue(enc.encode(": dang chay\n\n" + tokens.map((t) => sseMsg({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: t, progress: n } })).join(""))); };
      beat();
      timer = setInterval(beat, BRIDGE_SSE.ping);
      // CLI đã ngắt (cancel) thì thôi, ghi vào luồng đã đóng sẽ lỗi.
      work.catch(() => [] as unknown[]).then((out) => { clearInterval(timer); if (gone) return; c.enqueue(enc.encode(out.map(sseMsg).join(""))); c.close(); });
    },
    cancel() { gone = true; clearInterval(timer); onGone(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "mcp-session-id": sid } });
}

/** Route POST /api/mcp/bridge/<token>: một yêu cầu hoặc một lô yêu cầu JSON-RPC, trả JSON; công cụ chạy lâu thì trả qua luồng SSE (xem BRIDGE_SSE). */
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
  // CLI ngắt kết nối (req.signal, hoặc luồng SSE bị đóng): lời gọi đang chờ của yêu cầu này không còn ai nhận kết quả.
  const gone = new AbortController();
  const hangup = () => gone.abort();
  if (req.signal.aborted) hangup(); else req.signal.addEventListener("abort", hangup, { once: true });
  const work = Promise.all(list.map((m) => handle(b, m, gone.signal))).then((r) => r.filter((x) => x !== null));
  if ((req.headers.get("accept") ?? "").includes("text/event-stream") && list.some((m) => m.method === "tools/call")) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([work.then(() => true), new Promise<false>((ok) => { t = setTimeout(() => ok(false), BRIDGE_SSE.after); })]);
    clearTimeout(t);
    if (!first) return sseReply(work, list.map((m) => (m.params?._meta as { progressToken?: unknown } | undefined)?.progressToken).filter((x) => x !== undefined), sid, hangup);
  }
  const out = await work;
  if (!out.length) return new Response(null, { status: 202, headers: { "mcp-session-id": sid } });
  return Response.json(Array.isArray(body) ? out : out[0], { headers: { "mcp-session-id": sid } });
}
