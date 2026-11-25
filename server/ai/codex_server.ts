// Một `codex app-server` sống lâu cho mỗi tài khoản (Blueprint G2.3): lượt Codex gửi qua JSON-RPC (thread/start | thread/resume → turn/start) thay vì mỗi lượt
// một `codex exec` khởi động lạnh. Tài khoản miễn phí không có Claude nên không có hồ tiến trình nào khác: đây là đường ấm duy nhất của họ.
// - Mỗi CODEX_HOME (thư mục đăng nhập) một tiến trình; giữ tối đa IDLE_MS rảnh và LIFE_MS tuổi; số tiến trình cả máy tính theo RAM (SYNCHRO_CODEX_SERVER_MAX ghi đè, 0 = tắt).
// - Cờ an toàn như codex exec (CODEX_SAFE: tắt shell, unified exec, xem ảnh, image_gen dựng sẵn; sandbox chỉ đọc; không ai duyệt) đi qua `config` của thread/start; vẫn giữ
//   chốt chặn của đường exec: thấy mục lệnh / sửa tệp trên máy chủ là dừng lượt và tắt hẳn tiến trình.
// - Công cụ của Synchro (MCP): cầu nối sống theo cuộc trò chuyện (mcpbridge.liveBridge, G2.2) nên thread đã nạp giữ đúng một địa chỉ qua nhiều lượt.
// - Một thread đã nạp chỉ đúng khi MỌI lượt của nó đi qua chính app-server đó: lượt nào của thread chạy bằng codex exec (cầu nối không có địa chỉ sống,
//   app-server hỏng) thì app-server đang giữ thread đó bị cho nghỉ trước (codexThreadLeaving), lượt sau nạp lại thread từ đĩa. Cấu hình của thread (công cụ,
//   tìm web, thư mục) chỉ đặt được lúc nạp: lượt cần cấu hình khác thì khởi động lại app-server (rảnh) rồi nạp lại, hoặc chạy exec khi app-server còn lượt khác.
// - Hỏng bất kỳ chỗ nào trước khi lượt bắt đầu (tiến trình chết, phương thức lạ, quá giờ) thì ném CodexServerUnavailable: bên gọi chạy đường exec như cũ (ghi nhật ký).
// - Synchro tắt thì stdin đóng, app-server tự thoát; tiến trình mang SYNCHRO_CLI_OWNER như mọi CLI nên dọn được nếu mồ côi.
import "server-only";
import fs from "node:fs";
import os from "node:os";
import { cliPlan, type Event, type TurnRequest } from "./engine";
import { find, makeDir, spawnCli, type Proc } from "./cli_runtime";
import { classify, redact } from "./errors";
import { registerIdle, warmRoom } from "../turngate";

type J = { [k: string]: unknown };
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export class CodexServerUnavailable extends Error {}

const IDLE_MS = 10 * 60_000, LIFE_MS = 60 * 60_000, START_MS = 20_000;
const PER_SERVER_MB = 300;
let maxCached: number | null = null;
function maxDefault(): number {
  if (maxCached !== null) return maxCached;
  let total = 0;
  try { const m = /MemTotal:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8")); if (m) total = Math.round(Number(m[1]) / 1024); } catch { total = Math.round(os.totalmem() / 1048576); }
  const n = total > 0 ? Math.floor((total - 2560) * 0.25 / PER_SERVER_MB) : NaN;
  maxCached = Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : 3;
  return maxCached;
}
const maxServers = () => { const v = process.env.SYNCHRO_CODEX_SERVER_MAX; const n = Number(v); return v !== undefined && Number.isFinite(n) && n >= 0 ? n : maxDefault(); };
/** SYNCHRO_CODEX_SERVER=0: tắt hẳn đường app-server (mọi lượt chạy codex exec như trước). */
export const codexServerOn = () => process.env.SYNCHRO_CODEX_SERVER !== "0" && maxServers() > 0;

/** Cấu hình của thread: như CODEX_SAFE + tắt image_gen dựng sẵn (lý do ở CodexEngine.runTurn), thêm tìm web và cầu nối MCP khi có. */
export function threadConfig(o: { web?: boolean; mcpUrl?: string; effort?: string }): J {
  const c: J = { "features.shell_tool": false, "features.unified_exec": false, "tools.view_image": false, "features.image_generation": false };
  if (o.web) c["tools.web_search"] = true;
  if (o.effort) c.model_reasoning_effort = o.effort;
  if (o.mcpUrl) Object.assign(c, { "mcp_servers.synchro.url": o.mcpUrl, "mcp_servers.synchro.startup_timeout_sec": 20, "mcp_servers.synchro.tool_timeout_sec": 1800, "mcp_servers.synchro.default_tools_approval_mode": "approve" });
  return c;
}

type Waiter = { ok: (v: J) => void; fail: (e: Error) => void };
/** key: mọi thứ chỉ đặt được lúc nạp thread (threadKey). */
type Thread = { key: string };
/** noThreads: bản CLI không nhận thread/start (lỗi JSON-RPC): app-server chỉ dùng cho codexRpc, lượt chạy exec ngay. */
type Srv = { home: string; proc: Proc; next: number; pending: Map<number, Waiter>; subs: Map<string, (method: string,
  params: J) => void>; threads: Map<string, Thread>; busy: number; used: number; born: number; dead: boolean;
  retired: boolean; noThreads: boolean; ready: Promise<void>;
  /** Bản CLI không có turn/steer (nhắn thêm giữa lượt): không thử lại ở mỗi tin; bên gọi cắt lượt rồi làm tiếp
   *  như CLI khác. */
  noSteer?: boolean };
/** app-server trả lỗi JSON-RPC (đã nhận và từ chối yêu cầu), khác với quá giờ / tiến trình chết (không biết yêu cầu đã chạy tới đâu). */
class RpcError extends Error {}
type G = { servers: Map<string, Srv>; starts: number };
const g: G = ((globalThis as { __synchroCodexServers?: G }).__synchroCodexServers ??= { servers: new Map(), starts: 0 });

/** Cho nghỉ: không nhận lượt mới; rảnh thì tắt ngay, đang chạy lượt thì tắt khi lượt cuối xong. own: số lượt của chính bên gọi đang tính trong busy. */
function retire(s: Srv, why: string, own = 0) {
  if (s.busy <= own) { drop(s, why); return; }
  s.retired = true;
  if (g.servers.get(s.home) === s) g.servers.delete(s.home);
}
function drop(s: Srv, why: string) {
  if (s.dead) return;
  s.dead = true;
  if (g.servers.get(s.home) === s) g.servers.delete(s.home);
  for (const w of s.pending.values()) w.fail(new CodexServerUnavailable(why));
  s.pending.clear();
  for (const f of s.subs.values()) f("synchro/closed", { reason: why });
  s.proc.kill();
}
let sweeper: ReturnType<typeof setInterval> | null = null;
function sweep() {
  const now = Date.now();
  for (const s of [...g.servers.values()]) if (!s.busy && (now - s.used > IDLE_MS || now - s.born > LIFE_MS)) drop(s, "rảnh lâu");
  if (process.platform === "linux" && os.freemem() < 800 * 1048576) for (const s of [...g.servers.values()]) if (!s.busy) drop(s, "thiếu bộ nhớ");
}
const send = (s: Srv, o: J) => s.proc.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
function call(s: Srv, method: string, params: J, ms = START_MS): Promise<J> {
  if (s.dead) return Promise.reject(new CodexServerUnavailable("app-server đã tắt"));
  const id = s.next++;
  return new Promise<J>((ok, fail) => {
    const t = setTimeout(() => { s.pending.delete(id); fail(new CodexServerUnavailable(`${method}: quá ${Math.round(ms / 1000)} giây`)); }, ms);
    s.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
    send(s, { id, method, params });
  });
}

function launch(bin: string, env: Record<string, string>, cwd: string): Srv {
  const proc = spawnCli(bin, ["app-server"], { env, cwd, timeoutMs: LIFE_MS + 30 * 60_000 });
  const s: Srv = { home: env.CODEX_HOME ?? "", proc, next: 1, pending: new Map(), subs: new Map(), threads: new Map(), busy: 0, used: Date.now(), born: Date.now(), dead: false, retired: false, noThreads: false, ready: Promise.resolve() };
  g.starts++;
  void (async () => {
    for await (const l of proc.lines) {
      let m: J;
      try { m = JSON.parse(l) as J; } catch { continue; }
      const id = m.id, method = str(m.method);
      if (typeof id === "number" && !method) {
        const w = s.pending.get(id);
        if (!w) continue;
        s.pending.delete(id);
        if (m.error) w.fail(new RpcError(str(obj(m.error).message) || "lỗi JSON-RPC")); else w.ok(obj(m.result));
      } else if (method && id !== undefined && id !== null) {
        // Máy chủ hỏi ngược (duyệt lệnh, sửa tệp, hỏi thêm thông tin): không ai duyệt trong Synchro, từ chối.
        send(s, /requestApproval$/i.test(method) ? { id, result: { decision: "decline" } } : { id, error: { code: -32601, message: "Synchro không hỗ trợ yêu cầu này" } });
      } else if (method) {
        const p = obj(m.params), tid = str(p.threadId) || str(obj(p.thread).id) || str(obj(p.turn).threadId);
        const f = tid ? s.subs.get(tid) : undefined;
        if (f) f(method, p);
      }
    }
  })().catch(() => {});
  void proc.done.then((e) => drop(s, `app-server thoát (mã ${e.code ?? e.signal})`));
  s.ready = call(s, "initialize", { clientInfo: { name: "synchro", title: "Synchro", version: "1.0" } }).then(() => { send(s, { method: "initialized" }); });
  s.ready.catch((e: Error) => drop(s, e.message));
  g.servers.set(s.home, s);
  if (!sweeper) { sweeper = setInterval(sweep, 30_000); sweeper.unref?.(); }
  return s;
}
const idleServers = () => [...g.servers.values()].filter((x) => !x.busy).sort((a, b) => a.used - b.used);
// Cổng lượt tính app-server rảnh vào mức của cả máy như tiến trình rảnh của hồ Claude Code: lượt thật cần chỗ thì cái rảnh lâu nhất nhường.
registerIdle({ count: () => idleServers().length, evict: () => { const v = idleServers()[0]; if (v) drop(v, "nhường chỗ cho lượt khác"); return !!v; } }, "codex");
const lowMem = () => process.platform === "linux" && os.freemem() < 800 * 1048576;
/**
 * app-server của tài khoản (khởi động nếu chưa có và còn chỗ). null: không có CLI, tắt, hoặc hết chỗ.
 * evict: được tắt app-server rảnh của tài khoản khác khi đã đủ số (lượt thật đang cần). Khởi động sẵn (mở trang) thì không: không đuổi ai, và chỉ khởi động
 * khi còn bộ nhớ và cổng lượt còn chỗ (warmRoom), như khởi động sẵn của hồ Claude Code.
 */
async function server(req: Pick<TurnRequest, "env" | "workdir">, cwd: string, evict = true): Promise<Srv | null> {
  const env = req.env ?? {}, home = env.CODEX_HOME;
  const bin = find("codex");
  if (!bin || !home || !codexServerOn()) return null;
  let s = g.servers.get(home);
  if (s && (s.dead || Date.now() - s.born > LIFE_MS) && !s.busy) { drop(s, "hết tuổi"); s = undefined; }
  if (!s) {
    if (!evict && (lowMem() || !warmRoom())) return null;
    if (g.servers.size >= maxServers()) {
      const idle = evict ? idleServers()[0] : undefined;
      if (!idle) return null;
      drop(idle, "nhường chỗ");
    }
    await makeDir(cwd);
    s = launch(bin, env, cwd);
  }
  await s.ready;
  return s;
}
/** Khởi động sẵn app-server của tài khoản (mở trang, đổi model sang ChatGPT): lượt đầu không phải chờ CLI khởi động. Không tốn lượt nào của gói. */
export async function prestartCodexServer(req: Pick<TurnRequest, "env" | "workdir">, cwd: string): Promise<void> {
  const s = await server(req, cwd, false).catch(() => null);
  if (s) s.used = Date.now();
}
/**
 * Gọi vài phương thức không gắn thread (model/list, account/read, account/rateLimits/read) qua app-server của tài khoản (G2.3: codexRpc dùng chung app-server
 * với lượt chat thay vì mỗi lần một tiến trình). Chưa có thì (start) khởi động như khởi động sẵn (không đuổi ai). null: không dùng được, bên gọi tự mở tiến trình ngắn hạn.
 * Phần tử null: phương thức đó lỗi (như codexRpc cũ).
 */
export async function codexServerRpc(env: Record<string, string>, cwd: string, calls: { method: string; params?: J }[], timeoutMs: number, start = true): Promise<(J | null)[] | null> {
  const have = env.CODEX_HOME ? g.servers.get(env.CODEX_HOME) : undefined;
  if (!start && (!have || have.dead)) return null;
  const s = await server({ env }, cwd, false).catch(() => null);
  if (!s || s.dead) return null;
  s.used = Date.now();
  return Promise.all(calls.map((c) => call(s, c.method, c.params ?? {}, timeoutMs).catch(() => null)));
}
export const codexServerStats = () => ({ servers: g.servers.size, starts: g.starts });
/**
 * Lượt của thread `sessionId` sắp chạy bằng codex exec (ghi thêm vào tệp phiên trên đĩa): app-server đang nạp thread đó sẽ giữ bản cũ trong bộ nhớ,
 * lượt sau qua nó mất lượt exec này. Cho app-server đó nghỉ (rảnh thì tắt ngay); lượt sau khởi động app-server mới và nạp lại thread từ đĩa.
 */
export function codexThreadLeaving(env: Record<string, string> | undefined, sessionId: string | undefined) {
  const home = env?.CODEX_HOME;
  if (!home || !sessionId) return;
  const s = g.servers.get(home);
  if (s && s.threads.has(sessionId)) retire(s, "thread chạy lượt bằng codex exec");
}
/** Đăng xuất / đăng nhập lại: tiến trình đang giữ đăng nhập cũ. */
export function dropCodexServer(home: string) { const s = g.servers.get(home); if (s) drop(s, "đăng nhập đổi"); }
export function dropAllCodexServers() { for (const s of [...g.servers.values()]) drop(s, "tắt"); }
/** CLI vừa đổi bản (cliupdate.ts): app-server đang rảnh tắt ngay, cái đang chạy lượt tắt khi xong lượt (không nhận lượt mới). */
export function retireCodexServers() { for (const s of [...g.servers.values()]) { if (!s.busy) drop(s, "đổi bản CLI"); else { s.retired = true; g.servers.delete(s.home); } } }

// Loại mục là công cụ chạy trên máy chủ (như CODEX_LOCAL của đường exec, tên v2 dạng camelCase: commandExecution, fileChange, imageView…).
const LOCAL = /command|shell|exec|filechange|file_change|patch|readfile|read_file|listdir|list_dir|grep|viewimage|view_image|imageview/i;
/** Những gì chỉ đặt được lúc nạp thread (thread/start, thread/resume): cầu nối + bộ công cụ, tìm web, thư mục làm việc. Model, nỗ lực đi theo từng turn/start. */
const threadKey = (req: TurnRequest, cwd: string) => JSON.stringify([req.mcp?.live?.url ?? "", req.mcp?.live?.key ?? "", !!req.web, cwd]);

/**
 * Chạy một lượt qua app-server. Ném CodexServerUnavailable trước khi có sự kiện nào nếu không chạy được (bên gọi về đường exec).
 * head: hướng dẫn hệ thống đặt đầu prompt như đường exec.
 */
export async function* codexServerTurn(req: TurnRequest, prompt: string, cwd: string, model: string | undefined, effort: string | undefined, images: string[]): AsyncGenerator<Event, void, unknown> {
  if (req.mcp && !req.mcp.live) throw new CodexServerUnavailable("cầu nối của lượt không có địa chỉ sống");
  const mcpUrl = req.mcp?.live?.url ?? "", want = threadKey(req, cwd);
  const t0 = Date.now();
  const get = async () => {
    const x = await server(req, cwd).catch((e: Error) => { throw e instanceof CodexServerUnavailable ? e : new CodexServerUnavailable(e.message); });
    if (!x) throw new CodexServerUnavailable("không có chỗ cho app-server");
    if (x.noThreads) throw new CodexServerUnavailable("bản Codex này không nhận lượt qua app-server");
    return x;
  };
  let s = await get();
  const had = req.sessionId ? s.threads.get(req.sessionId) : undefined;
  if (had && had.key !== want) {
    // Thread đã nạp với cấu hình khác (bộ công cụ, tìm web…): không đổi được tại chỗ. app-server rảnh thì khởi động lại và nạp lại thread với cấu hình mới;
    // đang chạy lượt khác của tài khoản thì cho nghỉ (không nhận lượt mới, tắt khi xong) và chạy lượt này bằng exec.
    if (s.busy) { retire(s, "thread cần cấu hình khác"); throw new CodexServerUnavailable("thread đã nạp với cấu hình khác"); }
    drop(s, "thread cần cấu hình khác");
    s = await get();
  }
  const warm = Date.now() - t0 < 50;
  s.busy++; s.used = Date.now();
  let tid = "", subscribed = false, started = false, touched = false, sentTurn = false;
  const q: [string, J][] = [];
  let wake: (() => void) | null = null;
  const onNote = (method: string, p: J) => { q.push([method, p]); wake?.(); };
  try {
    const cfg = threadConfig({ web: req.web, mcpUrl: mcpUrl || undefined, effort });
    const base = { model, cwd, approvalPolicy: "never", sandbox: "read-only", config: cfg };
    if (req.sessionId) {
      const loaded = s.threads.get(req.sessionId);
      // Đã kiểm tra trước khi nhận lượt; app-server không đổi giữa chừng (không có await nào ở giữa) nên chỉ còn trường hợp khớp.
      if (loaded && loaded.key !== want) throw new CodexServerUnavailable("thread đã nạp với cấu hình khác");
      tid = req.sessionId;
      s.subs.set(tid, onNote); subscribed = true;
      if (!loaded) { touched = true; await call(s, "thread/resume", { threadId: tid, ...base }); s.threads.set(tid, { key: want }); }
    } else {
      touched = true;
      const r = await call(s, "thread/start", base).catch((e: Error) => {
        // Bản CLI không có giao thức lượt qua app-server: không thử lại ở mỗi lượt.
        if (e instanceof RpcError && /method not found|unknown method|unknown variant/i.test(e.message)) s.noThreads = true;
        throw e;
      });
      tid = str(obj(r.thread).id);
      if (!tid) throw new CodexServerUnavailable("thread/start không trả mã thread");
      s.subs.set(tid, onNote); subscribed = true;
      s.threads.set(tid, { key: want });
    }
    const input: J[] = [{ type: "text", text: prompt, text_elements: [] }, ...images.map((path) => ({ type: "localImage", path }))];
    sentTurn = true;
    const tr = await call(s, "turn/start", { threadId: tid, input, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    const turnId = str(obj(tr.turn).id);
    started = true;
    console.log(`[timing] codex-server ${warm ? "warm" : "cold"} start=${Date.now() - t0}`);
    yield { kind: "pool", state: warm ? "hit" : "cold" };
    // Như thread.started của codex exec: báo mã phiên cả khi nối tiếp.
    yield { kind: "session", id: tid };
    const parts: string[] = [];
    let partial = "", tools = false, lastErr = "", done = false;
    const asked = new Set<string>();
    const interrupt = () => { if (!done && turnId) void call(s, "turn/interrupt", { threadId: tid, turnId }, 5000).catch(() => drop(s, "không dừng được lượt")); };
    // Nhắn thêm giữa lượt: Codex nhận tin vào chính lượt đang chạy (turn/steer), model đọc ở bước kế tiếp mà không bỏ
    // phần đã làm. Câu trả lời cuối chỉ gồm các tin model viết sau đó: phần trước đã vào nhật ký làm việc lúc tin tới
    // (clisteer.ts).
    let steeredAt = -1;
    const inject = async (text: string) => {
      if (done || !turnId || s.noSteer || s.dead) return false;
      try {
        const input = [{ type: "text", text, text_elements: [] }];
        await call(s, "turn/steer", { threadId: tid, input, expectedTurnId: turnId }, 5000);
        steeredAt = parts.length + (partial ? 1 : 0);
        return true;
      } catch (e) {
        const unknown = e instanceof RpcError && /method not found|unknown method|unknown variant/i.test(e.message);
        if (unknown) s.noSteer = true;
        else console.warn(`[codex] turn/steer: ${redact((e as Error).message).slice(0, 200)}`);
        return false;
      }
    };
    req.onInject?.(inject);
    if (req.signal?.aborted) interrupt(); else req.signal?.addEventListener("abort", interrupt, { once: true });
    try {
      while (!done) {
        const n = q.shift();
        if (!n) { await new Promise<void>((ok) => { wake = ok; setTimeout(ok, 1000); }); wake = null; if (s.dead && !q.length) { yield { kind: "error", message: redact(lastErr || "Codex app-server dừng giữa lượt."), code: "other" }; return; } continue; }
        const [method, p] = n;
        const item = obj(p.item), itype = str(item.type);
        if (method === "synchro/closed") { yield { kind: "error", message: redact(lastErr || `Codex dừng giữa lượt: ${str(p.reason)}`), code: classify(lastErr || "") }; return; }
        if (/^item\//.test(method) && itype && LOCAL.test(itype) && !/^(agentMessage|reasoning|userMessage|mcpToolCall|webSearch)$/.test(itype)) {
          // Như đường exec (CODEX_LOCAL): Codex định chạy công cụ trên máy chủ dù đã tắt. Dừng lượt và tắt hẳn tiến trình trước khi kết quả kịp về model.
          console.error(`[codex] chặn công cụ trên máy chủ (app-server): ${itype.slice(0, 40)}`);
          done = true; drop(s, "công cụ trên máy chủ");
          yield { kind: "error", message: "Codex định chạy lệnh trực tiếp trên máy chủ nên Synchro đã dừng lượt này để bảo vệ dữ liệu. Hãy nhắn lại, hoặc dùng model khác.", code: "other" };
          return;
        }
        if (/^item\//.test(method)) yield { kind: "activity" };
        if (method === "item/started" && (itype === "mcpToolCall" || itype === "webSearch")) tools = true;
        if ((method === "item/started" || method === "item/completed") && itype === "webSearch") {
          const qy = str(item.query) || str(obj(item.action).query), url = str(obj(item.action).url);
          if ((qy || url) && !asked.has(qy || url)) { asked.add(qy || url); yield { kind: "search", query: qy || undefined, url: url || undefined }; if (url) yield { kind: "sources", items: [{ title: "", url }] }; }
        }
        // Danh sách việc dựng sẵn của Codex (update_plan): app-server báo turn/plan/updated mỗi lần model cập nhật.
        if (method === "turn/plan/updated" || (/^item\/(started|updated|completed)$/.test(method) && itype === "todoList")) { const items = cliPlan(method === "turn/plan/updated" ? p.plan : item.items); if (items) yield { kind: "plan", items }; }
        if (method === "item/agentMessage/delta" && typeof p.delta === "string" && p.delta) {
          yield { kind: "text", text: (!partial && parts.length ? "\n\n" : "") + p.delta };
          partial += p.delta;
        } else if (method === "item/completed" && itype === "agentMessage" && typeof item.text === "string") {
          const text = item.text;
          parts.push(text);
          const rest = partial && text.startsWith(partial) ? text.slice(partial.length) : (parts.length > 1 ? "\n\n" : "") + text;
          partial = "";
          if (rest) yield { kind: "text", text: rest };
        } else if (method === "thread/tokenUsage/updated") {
          const u = obj(obj(p.tokenUsage).last);
          yield { kind: "usage", usage: { input: num(u.inputTokens) ?? 0, output: num(u.outputTokens) ?? 0, cacheRead: num(u.cachedInputTokens) } };
        } else if (method === "error") {
          const e = obj(p.error), m = str(e.message) || str(p.message);
          if (m) lastErr = m;
          if (p.willRetry === true) yield { kind: "status", text: "ChatGPT đang kết nối lại" };
          else if (/\b40[13]\b/.test(m) && classify(m) === "auth") { done = true; interrupt(); yield { kind: "error", message: redact(m), code: "auth" }; return; }
        } else if (method === "turn/completed") {
          done = true;
          const t = obj(p.turn), st = str(t.status);
          if (st === "interrupted" || req.signal?.aborted) { yield { kind: "error", message: "Đã dừng.", code: "aborted" }; return; }
          if (st === "failed") { const m = str(obj(t.error).message) || lastErr || "Codex báo lỗi."; yield { kind: "error", message: redact(m), code: classify(m) }; return; }
          const own = steeredAt >= 0 && steeredAt < parts.length ? parts.slice(steeredAt) : parts;
          yield { kind: "final", text: tools && own.length ? own[own.length - 1] : own.join("\n\n"), via: "codex" };
        }
      }
    } finally { req.signal?.removeEventListener("abort", interrupt); req.onInject?.(null); }
  } catch (e) {
    // Lượt đã bắt đầu (đã có sự kiện tới người dùng): báo lỗi, không chạy lại bằng exec.
    if (started) { yield { kind: "error", message: redact((e as Error).message || "Codex app-server lỗi giữa lượt."), code: "other" }; return; }
    // Chưa bắt đầu nhưng đã gửi thread/* hoặc turn/start: bên gọi sắp chạy exec trên cùng thread. Yêu cầu đã bị từ chối rõ ràng (lỗi JSON-RPC của thread/*)
    // thì thread chưa nạp, giữ app-server; quá giờ, tiến trình chết, hay turn/start hỏng (thread đã nạp, lượt có thể vẫn chạy muộn) thì không biết app-server
    // đang giữ gì: tắt (chỉ lượt này dùng) hoặc cho nghỉ, để không có hai bản của một thread và không có lượt chạy hai lần.
    if (sentTurn && !(e instanceof RpcError)) drop(s, "lượt không bắt đầu được");
    else if (sentTurn || (touched && !(e instanceof RpcError))) { s.threads.delete(tid); retire(s, "lượt không bắt đầu được", 1); }
    if (e instanceof CodexServerUnavailable) throw e;
    // Lỗi JSON-RPC trước khi lượt chạy (phương thức lạ, tham số không nhận): coi như không dùng được, về đường exec.
    throw new CodexServerUnavailable((e as Error).message);
  } finally {
    if (subscribed) s.subs.delete(tid);
    s.busy--; s.used = Date.now();
    if (s.retired && !s.busy) drop(s, "đổi bản CLI");
  }
}

