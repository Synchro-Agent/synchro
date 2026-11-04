// Các engine chạy CLI chính chủ bằng gói subscription của người dùng (ADR 0001, bước 5): Claude Code, Codex, Antigravity, Grok.
// Engine không biết tài khoản là ai: biến môi trường đăng nhập (CLAUDE_CONFIG_DIR, CODEX_HOME, HOME…) do cli_auth.engineEnv()
// dựng và truyền vào TurnRequest.env; cli_runtime lọc env, kill cả process group khi Dừng, CLI im lặng quá lâu hoặc chạm mức trần của lượt.
import path from "node:path";
import type { Attachment, Engine, ErrorCode, Event, RateWindow, TurnRequest, Usage, WebSource } from "./engine";
import { type Cli, engineHome, find, IDLE_MS, makeDir, MAX_TURN_MS, type Proc, spawnCli, stripAnsi, writeEngineFile, type Exit } from "./cli_runtime";
import { classify, redact } from "./errors";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function start(cli: Cli, args: string[], req: TurnRequest, stdin: string, timeoutMs?: number): Proc | null {
  const bin = find(cli);
  if (!bin) return null;
  // Không có workdir riêng thì chạy trong <home>/work (CLI chỉ ghi trong thư mục làm việc).
  const cwd = req.workdir ?? path.join(engineHome(), "work");
  makeDir(cwd);
  return spawnCli(bin, args, { env: req.env, cwd, stdin, signal: req.signal, idleMs: IDLE_MS, alive: req.alive, ...(timeoutMs ? { timeoutMs } : {}) });
}
// Linux không cho một tham số dòng lệnh dài quá 128 KB (MAX_ARG_STRLEN): vượt là "spawn E2BIG", lượt chết trước khi chạy. Đo bằng byte
// (tiếng Việt có dấu 2–3 byte mỗi chữ), chừa chỗ: nội dung dài hơn ARG_MAX_BYTES thì đi qua tệp hoặc stdin.
const ARG_MAX_BYTES = 100_000;
const tooLong = (s?: string) => Buffer.byteLength(s ?? "", "utf8") > ARG_MAX_BYTES;
/** Tệp tạm của lượt trong thư mục làm việc (ghi bằng user của engine). */
function turnFile(req: TurnRequest, tag: string, text: string) {
  const cwd = req.workdir ?? path.join(engineHome(), "work");
  const file = path.join(cwd, `.synchro-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.txt`);
  writeEngineFile(file, Buffer.from(text, "utf8"));
  return file;
}
/** Cắt bớt phần đầu (lịch sử cũ) để vừa ARG_MAX_BYTES, giữ phần cuối (tin nhắn mới nhất). */
function fitTail(text: string, budget: number) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= budget) return text;
  const note = "[Phần đầu cuộc trò chuyện quá dài nên đã được lược bớt; dưới đây là phần gần nhất.]\n\n";
  // Cắt theo byte rồi bỏ nửa ký tự UTF-8 ở đầu (byte tiếp nối 10xxxxxx).
  let i = buf.length - (budget - Buffer.byteLength(note));
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++;
  return note + buf.subarray(i).toString("utf8");
}

// ---------------------------------------------------------------- tệp đính kèm
/** Claude Code (--input-format stream-json): một tin nhắn người dùng gồm khối ảnh / PDF gốc rồi tới chữ, đúng như Messages API. */
function claudeInput(prompt: string, atts: Attachment[]) {
  const content = [
    ...atts.map((a) => a.kind === "image"
      ? { type: "image", source: { type: "base64", media_type: a.mime, data: a.data } }
      : { type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.data } }),
    { type: "text", text: prompt },
  ];
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}
/** Ảnh gửi bằng --image (Codex): ảnh đính kèm và ảnh từng trang của PDF scan. */
const imagePaths = (atts: Attachment[]) => atts.flatMap((a) => (a.kind === "image" ? [a.path] : (a.pages ?? []).map((p) => p.path))).filter((x): x is string => !!x);
/** Danh sách tệp đã lưu trong thư mục làm việc, để model tự mở (Antigravity: print mode chỉ nhận chữ). */
function fileList(atts: Attachment[], how: string) {
  const lines = atts.filter((a) => a.path).map((a) => `${a.n}. ${a.path} (${a.kind === "image" ? "ảnh" : "PDF"})${a.pages?.length ? `, ảnh từng trang: ${a.pages.map((p) => p.path).join(", ")}` : ""}`);
  return lines.length ? `\n\n<attachments>\nNgười dùng gửi kèm các tệp dưới đây, đã lưu nguyên dạng trong thư mục làm việc. ${how}\n${lines.join("\n")}\n</attachments>` : "";
}

async function* objects(p: Proc): AsyncIterable<Json> {
  for await (const l of p.lines) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try { yield JSON.parse(t) as Json; } catch {}
  }
}

const err = (message: string, code: ErrorCode): Event => ({ kind: "error", message: redact(message), code });

// ---------------------------------------------------------------- tìm web dựng sẵn của CLI
/** Nguồn trong kết quả của công cụ tìm web (mỗi CLI một kiểu): mọi object có url http(s), kể cả chuỗi "Links: [{"title":…,"url":…}]" của Claude Code. */
export function webSources(v: unknown, out = new Map<string, WebSource>(), depth = 0): WebSource[] {
  if (depth > 8 || out.size >= 20) return [...out.values()];
  if (typeof v === "string") {
    for (const m of v.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"(https?:[^"\s]+)"/g)) if (!out.has(m[2])) out.set(m[2], { title: m[1].replace(/\\(.)/g, "$1").slice(0, 200), url: m[2] });
  } else if (Array.isArray(v)) for (const x of v) webSources(x, out, depth + 1);
  else if (v && typeof v === "object") {
    const o = v as Json;
    if (typeof o.url === "string" && /^https?:\/\//.test(o.url) && !out.has(o.url)) out.set(o.url, { title: String(o.title ?? o.name ?? "").slice(0, 200), url: o.url });
    for (const x of Object.values(o)) if (x && typeof x !== "number" && typeof x !== "boolean") webSources(x, out, depth + 1);
  }
  return [...out.values()];
}
const WEB_TOOL = /^(WebSearch|WebFetch|web_search|search_web|web_fetch)$/;

// ---------------------------------------------------------------- khóa lượt theo tài khoản (Antigravity, Grok)
// Hai CLI này chỉ đọc cầu nối MCP từ cấu hình chung của tài khoản nên các lượt có công cụ của cùng tài khoản chạy lần lượt. Chờ lượt trước
// phải: dừng được ngay khi bấm Dừng, có giới hạn, và báo cho người dùng biết đang chờ gì (một câu "chào" từng chờ trống 2 phút rồi báo lỗi sai).
type Slot = { chain: Promise<void>; at: number };
const LOCK_WAIT_MS = 5 * 60_000;
async function* turnLock(locks: Map<string, Slot>, home: string, req: TurnRequest, name: string): AsyncGenerator<Event, (() => void) | null, unknown> {
  const held = locks.get(home);
  // Lượt giữ khóa lâu hơn mức trần của một lượt thì không thể còn chạy: bỏ qua, không để mọi lượt sau kẹt mãi.
  const prev = held && Date.now() - held.at < MAX_TURN_MS + 60_000 ? held.chain : Promise.resolve();
  let release = () => {};
  const mine = new Promise<void>((r) => { release = r; });
  const slot: Slot = { chain: prev.then(() => mine), at: Date.now() };
  locks.set(home, slot);
  void slot.chain.then(() => { if (locks.get(home) === slot) locks.delete(home); });
  if (!held) return release;
  yield { kind: "status", text: `Đang chờ lượt ${name} khác của tài khoản này xong`, wait: true };
  let stop = () => {};
  const got = await Promise.race([
    prev.then(() => "ok" as const),
    new Promise<"aborted" | "late">((ok) => {
      const t = setTimeout(() => ok("late"), req.lockMs ?? LOCK_WAIT_MS);
      const f = () => ok("aborted");
      if (req.signal?.aborted) f(); else req.signal?.addEventListener("abort", f, { once: true });
      stop = () => { clearTimeout(t); req.signal?.removeEventListener("abort", f); };
    }),
  ]);
  stop();
  if (got === "ok") { yield { kind: "status", wait: false }; return release; }
  // Bỏ chờ: nhả chỗ của mình; lượt xếp sau vẫn chờ đúng lượt đang chạy (chain vẫn gồm prev).
  release();
  yield got === "aborted" ? err("Đã dừng.", "aborted") : err(`Một lượt ${name} khác của tài khoản này đang chạy lâu nên lượt này chưa bắt đầu được. Hãy thử lại sau khi lượt đó xong hoặc chọn model khác.`, "busy");
  return null;
}
const notInstalled = (cli: Cli): Event => err(`CLI ${cli} chưa được cài trên máy chủ.`, "other");

export const timeoutText = (e: Pick<Exit, "idle">) => e.idle
  ? `CLI không có hoạt động nào trong ${Math.round(IDLE_MS / 60_000)} phút (có thể đã treo) nên Synchro dừng lượt này. Nhắn "tiếp tục" để làm tiếp từ chỗ đang dở.`
  : `Lượt này đã chạy ${Math.round(MAX_TURN_MS / 3600_000 * 10) / 10} giờ (mức tối đa mỗi lượt) nên đã dừng. Nhắn "tiếp tục" để làm tiếp từ chỗ đang dở.`;

/** Lỗi khi CLI thoát mà chưa có kết quả: Dừng, quá giờ, hoặc đoạn cuối stderr đã phân loại. */
function exitError(cli: Cli, p: Proc, e: Exit, extra = ""): Event {
  if (e.aborted) return err("Đã dừng.", "aborted");
  if (e.timedOut) return err(timeoutText(e), "timeout");
  const msg = [extra, stripAnsi(p.stderr()).trim().split("\n").slice(-6).join("\n")].filter(Boolean).join("\n") || `CLI ${cli} thoát với mã ${e.code}.`;
  return err(msg, classify(msg));
}

// Mức effort của Synchro → của CLI ("extra" là "xhigh"); Codex chưa có "max" nên dùng "xhigh".
const cliEffort = (e: string | undefined, max = "max") => (!e ? undefined : e === "extra" ? "xhigh" : e === "max" ? max : /^(minimal|low|medium|high|xhigh|ultra)$/.test(e) ? e : undefined);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Thời điểm đặt lại: CLI có thể trả giây hoặc mili giây, hoặc chuỗi ISO. */
const toMs = (v: unknown) => {
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined; }
  const n = num(v);
  return n === undefined ? undefined : n < 1e12 ? n * 1000 : n;
};

// ---------------------------------------------------------------- Claude Code
/**
 * Hạn mức gói Claude từ rate_limit_event (và api_error_params.rate_limit_info của lượt bị từ chối) của Claude Code:
 * rate_limit_info.unifiedWindows = { five_hour, seven_day, seven_day_overage_included }, mỗi cửa sổ { utilization (0–1),
 * resetsAt (giây), status: allowed | allowed_warning | rejected }; rateLimitType (five_hour, seven_day, seven_day_opus…)
 * kèm utilization / resetsAt ở cấp ngoài là cửa sổ đang gần chạm giới hạn nhất.
 */
export function claudeLimits(info: unknown): RateWindow[] {
  const i = (info ?? {}) as Json;
  const out = new Map<string, RateWindow>();
  const add = (window: string, x: Json) => {
    const u = num(x.utilization), st = typeof x.status === "string" ? x.status : undefined;
    out.set(window, { window, usedPct: u !== undefined ? Math.min(100, Math.round(u * 1000) / 10) : st === "rejected" ? 100 : undefined, resetsAt: toMs(x.resetsAt ?? x.resets_at), status: st });
  };
  if (i.unifiedWindows && typeof i.unifiedWindows === "object") for (const [k, v] of Object.entries(i.unifiedWindows as Json)) if (v && typeof v === "object") add(k, v as Json);
  if (typeof i.rateLimitType === "string" && !out.has(i.rateLimitType) && (i.utilization !== undefined || i.resetsAt !== undefined || i.status === "rejected")) add(i.rateLimitType, i);
  return [...out.values()];
}

export class ClaudeCodeEngine implements Engine {
  readonly id = "claude";
  /** tools: công cụ dựng sẵn của Claude Code được bật ("" = tắt hết; công cụ của Synchro đi qua MCP). */
  constructor(private o: { tools?: string } = {}) {}
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    // Công cụ dựng sẵn: chỉ tìm / đọc web khi người dùng bật "Tìm kiếm trên web"; công cụ của Synchro đi qua cầu nối MCP.
    const builtin = req.web ? "WebSearch,WebFetch" : this.o.tools ?? "";
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", builtin];
    const allow = [...(req.mcp ? ["mcp__synchro"] : []), ...(req.web ? ["WebSearch", "WebFetch"] : [])];
    if (req.mcp) args.push("--mcp-config", JSON.stringify({ mcpServers: { synchro: { type: "http", url: req.mcp.url } } }), "--strict-mcp-config");
    if (allow.length) args.push("--allowedTools", allow.join(","));
    // Hướng dẫn hệ thống của Synchro THAY lời nhắc mặc định của Claude Code (dành cho lập trình trong terminal, vài nghìn token mỗi lượt,
    // không dùng gì cho Synchro): lượt nhanh hơn, rẻ hơn, model không tự nhận là "Claude Code". Dài (nhiều skill, studio, connector) thì
    // qua tệp, không qua tham số (giới hạn 128 KB mỗi tham số).
    let sysFile = "";
    if (req.system && tooLong(req.system)) {
      try { sysFile = turnFile(req, "claude-sys", req.system); args.push("--system-prompt-file", sysFile); }
      catch (e) { yield err(`Không chuyển được hướng dẫn cho Claude Code: ${(e as Error).message}`, "other"); return; }
    } else if (req.system) args.push("--system-prompt", req.system);
    if (req.model) args.push("--model", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--resume", req.sessionId);
    if (req.sessionId && req.fork) args.push("--fork-session");
    // Có ảnh / PDF: gửi tin nhắn dạng stream-json để kèm khối ảnh, PDF gốc (model đọc trực tiếp, không qua chữ trích ra).
    const atts = req.attachments ?? [];
    if (atts.length) args.push("--input-format", "stream-json");
    // Công cụ của Synchro (lệnh trong workspace, build, cài gói) có thể chạy lâu: chờ tới 15 phút mỗi lời gọi.
    // Công cụ của Synchro có thể dừng chờ người dùng duyệt (chế độ quyền, trang web chưa được phép): chờ được tới hết 30 phút của lượt.
    const p = start("claude", args, req.mcp ? { ...req, env: { ...req.env, MCP_TOOL_TIMEOUT: "1800000" } } : req, atts.length ? claudeInput(req.prompt, atts) : req.prompt);
    if (sysFile) void p?.done.finally(() => rmEngineFile(req, sysFile).catch(() => {}));
    if (!p) { if (sysFile) await rmEngineFile(req, sysFile).catch(() => {}); yield notInstalled("claude"); return; }
    // gap: model bắt đầu một tin mới trong lượt (sau công cụ dựng sẵn như tìm web) — chữ của tin mới cách chữ trước một dòng trống,
    // không dính liền "…dựng deck.Đã đọc 4 skill…".
    let text = "", done = false, gap = false;
    const limits = new Map<string, RateWindow>(), webIds = new Set<string>();
    // Đo: lần đầu của từng loại sự kiện (ms từ lúc khởi động CLI), ghi một dòng [timing] khi xong — để biết thời gian chờ nằm ở đâu.
    const T0 = Date.now(), seen = new Map<string, number>();
    const mark = (o: Json) => { const k = [o.type, o.subtype, (o.event as Json | undefined)?.type].filter(Boolean).join(":"); if (!seen.has(k) && seen.size < 24) seen.set(k, Date.now() - T0); };
    for await (const o of objects(p)) {
      mark(o as Json);
      // Model đã phản hồi: có sự kiện của API (kể cả đang nghĩ) hoặc tin của model. init và rate_limit_event không tính: CLI tự in khi khởi động.
      if (o.type === "stream_event" || o.type === "assistant" || o.type === "user") yield { kind: "activity" };
      if (o.type === "assistant") {
        for (const b of (o.message?.content ?? []) as Json[]) {
          if ((b.type === "tool_use" || b.type === "server_tool_use") && WEB_TOOL.test(String(b.name ?? ""))) {
            if (typeof b.id === "string") webIds.add(b.id);
            yield { kind: "search", query: typeof b.input?.query === "string" ? b.input.query : undefined, url: typeof b.input?.url === "string" ? b.input.url : undefined };
          } else if (b.type === "web_search_tool_result") { const items = webSources(b.content); if (items.length) yield { kind: "sources", items }; }
        }
      } else if (o.type === "user" && webIds.size) {
        const hits = ((o.message?.content ?? []) as Json[]).filter((b) => b?.type === "tool_result" && webIds.has(String(b.tool_use_id)));
        if (hits.length) { const items = webSources([hits, o.tool_use_result]); if (items.length) yield { kind: "sources", items }; }
      }
      if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") yield { kind: "session", id: o.session_id, ...(typeof o.model === "string" ? { model: o.model } : {}) };
      else if (o.type === "stream_event" && o.event?.type === "message_start") gap = !!text;
      else if (o.type === "stream_event" && o.event?.type === "content_block_start" && o.event.content_block?.type === "tool_use" && String(o.event.content_block.name ?? "").startsWith("mcp__")) yield { kind: "tooluse" };
      else if (o.type === "stream_event" && o.event?.type === "content_block_delta" && o.event.delta?.type === "text_delta" && typeof o.event.delta.text === "string") {
        const t = (gap ? "\n\n" : "") + o.event.delta.text;
        gap = false;
        text += t;
        yield { kind: "text", text: t };
      } else if (o.type === "system" && o.subtype === "api_retry") {
        // Claude Code tự thử lại khi API lỗi; 401/403 thì thử lại vô ích (token hết hạn, bị thu hồi): dừng ngay, báo đăng nhập lại.
        const st = num(o.error_status) ?? num(o.status) ?? num(o.error?.status);
        const m = String(o.error?.message ?? o.error ?? o.message ?? "");
        if (st === 401 || st === 403 || (!st && classify(m) === "auth")) {
          p.kill(); done = true;
          yield err(`Claude từ chối đăng nhập (${st ?? "auth"}): ${m || "phiên đăng nhập không còn hợp lệ"}. Đăng nhập lại trong Cài đặt → Providers.`, "auth");
          break;
        }
        // Còn lại CLI tự chờ rồi thử lại: cho người dùng biết (không phải treo); bộ canh tính lại từ lúc này.
        yield { kind: "status", text: `Claude đang thử lại sau lỗi tạm thời${num(o.attempt) ? ` (lần ${o.attempt}${num(o.max_retries) ? `/${o.max_retries}` : ""})` : ""}` };
      } else if (o.type === "rate_limit_event") {
        for (const w of claudeLimits(o.rate_limit_info)) limits.set(w.window, w);
      } else if (o.type === "result") {
        console.log(`[timing] claude-events ${[...seen].map(([k, v]) => `${k}=${v}`).join(" ")}${typeof o.duration_api_ms === "number" ? ` api=${o.duration_api_ms}` : ""}${typeof o.duration_ms === "number" ? ` total=${o.duration_ms}` : ""}`);
        for (const w of claudeLimits(o.api_error_params?.rate_limit_info)) limits.set(w.window, w);
        done = true;
        const u = (o.usage ?? {}) as Json;
        const usage: Usage = { input: num(u.input_tokens) ?? 0, output: num(u.output_tokens) ?? 0, cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens), costUsd: num(o.total_cost_usd) };
        if (limits.size) usage.limits = [...limits.values()];
        yield { kind: "usage", usage };
        if (o.is_error || (o.subtype && o.subtype !== "success")) {
          const m = String(o.result || o.error || o.subtype || "Claude Code báo lỗi.");
          yield err(m, classify(m, num(o.api_error_status)));
        } else yield { kind: "final", text: typeof o.result === "string" && o.result ? o.result : text, via: "claude" };
      }
    }
    const e = await p.done;
    if (!done) yield exitError("claude", p, e);
  }
}

// ---------------------------------------------------------------- Codex
export class CodexEngine implements Engine {
  readonly id = "codex";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    // Codex không có tham số system riêng: đặt system lên đầu prompt ở lượt mở hội thoại (lượt resume đã có trong lịch sử).
    const prompt = req.system && !req.sessionId ? `${req.system}\n\n---\n\n${req.prompt}` : req.prompt;
    const args = ["exec", ...(req.sessionId ? ["resume", req.sessionId] : []), "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"'];
    // Công cụ của Synchro qua cầu nối MCP (Streamable HTTP); tìm web dựng sẵn khi người dùng bật. codex exec không có ai bấm duyệt
    // (approval_policy luôn là never), nên công cụ MCP phải được duyệt sẵn bằng default_tools_approval_mode="approve"; thiếu khóa này
    // Codex 0.164 từ chối mọi lời gọi "MCP tool call requires approval, but approval policy is never". Hộp cát chỉ đọc vẫn giữ cho
    // lệnh dựng sẵn của Codex trên máy chủ: việc thật đều chạy trong workspace qua công cụ của Synchro.
    if (req.mcp) args.push("-c", `mcp_servers.synchro.url=${JSON.stringify(req.mcp.url)}`, "-c", "mcp_servers.synchro.startup_timeout_sec=20", "-c", "mcp_servers.synchro.tool_timeout_sec=1800", "-c", 'mcp_servers.synchro.default_tools_approval_mode="approve"');
    if (req.web) args.push("-c", "tools.web_search=true");
    if (req.model) args.push("-m", req.model);
    // Mức đã được subs.resolvePlanModel chọn theo đúng các mức model này hỗ trợ (low…max, ultra).
    const ce = cliEffort(req.effort);
    if (ce) args.push("-c", `model_reasoning_effort="${ce}"`);
    // Ảnh gửi kèm (cả khi nối tiếp phiên): --image=<tệp>; PDF gốc nằm trong thư mục làm việc, chữ trích ra đã có trong prompt.
    const atts = req.attachments ?? [];
    for (const f of imagePaths(atts)) args.push(`--image=${f}`);
    args.push("-");
    const pdfs = atts.filter((a) => a.kind === "pdf");
    const p = start("codex", args, req, prompt + (pdfs.length ? fileList(pdfs, "Ảnh đính kèm đã được gửi kèm tin nhắn; PDF gốc ở đường dẫn dưới đây nếu cần đọc thêm.") : ""));
    if (!p) { yield notInstalled("codex"); return; }
    const parts: string[] = [];
    let done = false, lastErr = "", tools = false;
    const asked = new Set<string>();
    for await (const o of objects(p)) {
      // Mục đầu tiên của lượt là lúc model thật sự làm việc; thread.started, turn.started chỉ là CLI khởi động.
      if (/^item\./.test(String(o.type))) yield { kind: "activity" };
      if (/^item\.(started|completed)$/.test(String(o.type)) && o.item?.type === "web_search") {
        const q = typeof o.item.query === "string" && o.item.query ? o.item.query : typeof o.item.action?.query === "string" ? o.item.action.query : undefined;
        const url = typeof o.item.action?.url === "string" ? o.item.action.url : undefined;
        if ((q || url) && !asked.has(q ?? url!)) { asked.add(q ?? url!); yield { kind: "search", query: q, url }; if (url) yield { kind: "sources", items: [{ title: "", url }] }; }
      }
      if (o.type === "thread.started" && typeof o.thread_id === "string") yield { kind: "session", id: o.thread_id };
      else if (o.type === "item.started" && /mcp_tool_call|web_search/.test(String(o.item?.type ?? ""))) tools = true;
      else if (o.type === "item.completed" && (o.item?.type === "agent_message" || o.item?.item_type === "assistant_message") && typeof o.item.text === "string") {
        parts.push(o.item.text);
        yield { kind: "text", text: (parts.length > 1 ? "\n\n" : "") + o.item.text };
      } else if (o.type === "turn.completed") {
        done = true;
        const u = (o.usage ?? {}) as Json;
        yield { kind: "usage", usage: { input: num(u.input_tokens) ?? 0, output: num(u.output_tokens) ?? 0, cacheRead: num(u.cached_input_tokens) } };
        // Có dùng công cụ: các tin trước công cụ là lời dẫn (đã nằm trong nhật ký làm việc), câu trả lời là tin cuối.
        yield { kind: "final", text: tools && parts.length ? parts[parts.length - 1] : parts.join("\n\n"), via: "codex" };
      } else if (o.type === "turn.failed") {
        done = true;
        const m = String(o.error?.message || lastErr || "Codex báo lỗi.");
        yield err(m, classify(m));
      } else if (o.type === "error" && typeof o.message === "string") {
        // Thường chỉ là "Reconnecting…" (chỉ dùng nếu lượt thất bại); riêng 401/403 thì thử lại vô ích: dừng ngay, báo đăng nhập lại.
        lastErr = o.message;
        if (/\b40[13]\b/.test(o.message) && classify(o.message) === "auth") { p.kill(); done = true; yield err(o.message, "auth"); break; }
        if (/reconnecting|retrying/i.test(o.message)) yield { kind: "status", text: "ChatGPT đang kết nối lại" };
      }
    }
    const e = await p.done;
    if (!done) yield exitError("codex", p, e, lastErr);
  }
}

// ---------------------------------------------------------------- Antigravity
// Công cụ của Synchro cho Antigravity: agy chỉ đọc máy chủ MCP từ cấu hình chung của tài khoản (~/.gemini/config/mcp_config.json),
// không có cờ cho từng lượt như Claude Code / Codex. Mỗi lượt có công cụ: thêm cầu nối của lượt bằng chính `agy mcp add`, rồi gỡ
// khi xong; các lượt có công cụ của cùng một tài khoản chạy lần lượt để cầu nối không lẫn. Ở chế độ -p, agy tự từ chối công cụ cần duyệt;
// hook PreToolUse (~/.gemini/config/hooks.json, theo tài liệu của agy) chỉ cho phép công cụ MCP — trong cấu hình chỉ có cầu nối của
// Synchro: mcp_synchro_… khi công cụ được nạp sẵn (cầu nối đánh dấu antigravity/alwaysLoad), CallMcpTool khi agy 1.4.x để model tự tìm
// công cụ rồi gọi qua tên chung. Công cụ dựng sẵn của agy (lệnh shell, ghi tệp trên máy chủ) vẫn bị từ chối như trước.
const agyLocks = new Map<string, Slot>();
// Bật tìm web (Cài đặt / nút tìm web): cho phép thêm công cụ tìm web của chính agy (search_web — chỉ gọi dịch vụ tìm kiếm của Google,
// không đụng tới máy chủ). Công cụ đọc tệp / chạy lệnh / đọc URL bất kỳ của agy vẫn bị chặn: chúng chạy trên máy chủ bằng user của
// engine, đọc được thư mục đăng nhập của tài khoản khác và địa chỉ nội bộ.
const AGY_HOOK = (web?: boolean) => JSON.stringify({ "synchro-bridge": { PreToolUse: [{ matcher: `mcp_synchro_.*|CallMcpTool${web ? "|search_web|web_search" : ""}`, hooks: [{ type: "command", command: "cat >/dev/null; printf '{\"decision\":\"allow\"}'", timeout: 10 }] }] } });
/** Công cụ agy tự từ chối trong lượt (đọc nhật ký của lượt bằng chính user của engine, rồi xóa nhật ký). */
async function agyDenied(req: TurnRequest, log: string): Promise<string[]> {
  const sh = spawnCli("/bin/sh", ["-c", 'grep -o "soft-denying tool confirmation \\"[A-Za-z_]*\\"" "$1" 2>/dev/null; rm -f "$1"', "sh", log], { env: req.env, cwd: path.dirname(log) });
  let out = "";
  for await (const l of sh.lines) out += l + "\n";
  await sh.done;
  return [...new Set([...out.matchAll(/"([A-Za-z_]+)"/g)].map((m) => m[1]))];
}
async function agyRun(args: string[], req: TurnRequest) {
  // Lệnh ngắn (thêm / gỡ cầu nối): treo thì không được giữ khóa của tài khoản lâu hơn chừng này.
  const p = start("agy", args, { ...req, signal: undefined }, "", 60_000);
  if (!p) return false;
  for await (const _ of p.lines) { /* bỏ qua */ }
  return (await p.done).code === 0;
}
async function agyBridge(req: TurnRequest, url: string) {
  if (!(await agyRun(["mcp", "add", "synchro", url], req))) return false;
  // Ghi hook bằng đúng user của engine (thư mục đăng nhập 0700 của user đó).
  const sh = spawnCli("/bin/sh", ["-c", 'mkdir -p "$HOME/.gemini/config" && cat > "$HOME/.gemini/config/hooks.json.tmp" && mv "$HOME/.gemini/config/hooks.json.tmp" "$HOME/.gemini/config/hooks.json"'], { env: req.env, cwd: req.workdir, stdin: AGY_HOOK(req.web) });
  return (await sh.done).code === 0;
}

export class AntigravityEngine implements Engine {
  readonly id = "agy";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    if (!req.mcp) { yield* this.turn(req); return; }
    const free = yield* turnLock(agyLocks, String(req.env?.HOME ?? ""), req, "Antigravity");
    if (!free) return;
    try {
      const ok = await agyBridge(req, req.mcp.url).catch(() => false);
      // Lắp cầu nối xong mới là lúc model bắt đầu: bộ canh tính từ đây.
      yield { kind: "status" };
      yield* this.turn(ok ? req : { ...req, mcp: undefined });
    } finally {
      await agyRun(["mcp", "remove", "synchro"], req).catch(() => false);
      free();
    }
  }
  private async *turn(req: TurnRequest): AsyncIterable<Event> {
    // Print mode của agy chỉ nhận chữ: tệp gửi kèm đã lưu trong thư mục làm việc, model mở bằng công cụ xem tệp (đọc được ảnh, PDF).
    const files = fileList(req.attachments ?? [], "Hãy mở từng tệp bằng công cụ xem tệp để thấy đúng nội dung (ảnh, PDF) trước khi trả lời; không đoán nội dung tệp.");
    // Print mode của agy chỉ nhận prompt qua tham số -p: quá 128 KB thì lược phần đầu lịch sử (giữ hướng dẫn hệ thống và tin mới nhất).
    const sys = req.system && !req.sessionId ? `${req.system}\n\n---\n\n` : "";
    const body = req.prompt + files;
    const prompt = !tooLong(sys + body) ? sys + body
      : tooLong(sys) ? fitTail(sys + body, ARG_MAX_BYTES) : sys + fitTail(body, ARG_MAX_BYTES - Buffer.byteLength(sys, "utf8"));
    const args = ["--output-format", "json"];
    if (req.model) args.push("--model", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--conversation", req.sessionId);
    // Lượt có công cụ: nhật ký riêng của lượt để biết agy có tự từ chối công cụ nào không (khi đó lượt dừng sau câu dẫn đầu tiên).
    const log = req.mcp ? path.join(req.workdir ?? path.join(engineHome(), "work"), `.synchro-agy-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.log`) : "";
    if (log) args.push("--log-file", log);
    args.push("-p", prompt);
    const p = start("agy", args, req, "");
    if (!p) { yield notInstalled("agy"); return; }
    // Print mode không có sự kiện giữa chừng: nói trước để người dùng không tưởng là treo.
    yield { kind: "status", text: "Antigravity đang viết, chữ sẽ hiện một lần khi xong" };
    // agy in một object JSON duy nhất khi xong lượt (có thể trải nhiều dòng).
    let out = "";
    for await (const l of p.lines) out += l + "\n";
    const e = await p.done;
    let o: Json | null = null;
    const t = out.trim();
    try { o = JSON.parse(t.slice(t.indexOf("{"))) as Json; } catch {}
    // Lượt bị dừng hoặc CLI không in gì: nhật ký của lượt không còn ai đọc, xóa để khỏi đọng tệp trong thư mục làm việc.
    if (!o) { if (log) await rmEngineFile(req, log).catch(() => {}); yield exitError("agy", p, e); return; }
    if (typeof o.conversation_id === "string" && o.conversation_id) yield { kind: "session", id: o.conversation_id };
    const u = (o.usage ?? {}) as Json;
    if (o.usage) yield { kind: "usage", usage: { input: num(u.input_tokens) ?? 0, output: (num(u.output_tokens) ?? 0) + (num(u.thinking_tokens) ?? 0), cacheRead: num(u.cache_read_tokens) } };
    if (o.status === "ERROR" || o.error || e.code !== 0) {
      if (e.aborted || e.timedOut) { if (log) await rmEngineFile(req, log).catch(() => {}); yield exitError("agy", p, e); return; }
      const m = [o.error, stripAnsi(p.stderr()).trim()].filter(Boolean).join("\n") || "Antigravity báo lỗi.";
      if (log) await agyDenied(req, log).catch(() => []);
      // Model không nhận mức effort (agy kiểm tra trước khi chạy, chưa tốn lượt nào): chạy lại ngay, để model dùng mức mặc định.
      if (req.effort && /--effort is not supported/i.test(m)) { yield* this.turn({ ...req, effort: undefined }); return; }
      yield err(m, classify(m));
      return;
    }
    const text = typeof o.response === "string" ? o.response : "";
    // agy tự chặn công cụ (của nó hoặc của Synchro): lượt dừng sớm. Trả kèm danh sách để bên gọi nhắc model làm tiếp bằng công cụ được
    // phép (chat, Synchro Code); bên gọi hết lượt nhắc mới báo lỗi rõ ràng.
    const denied = log ? await agyDenied(req, log).catch(() => []) : [];
    if (text) yield { kind: "text", text };
    yield { kind: "final", text, via: "agy", ...(denied.length ? { denied } : {}) };
  }
}

// ---------------------------------------------------------------- Grok
// Grok CLI (xAI Grok Build) ở chế độ không giao diện: `grok --prompt-file <tệp> --output-format streaming-json`, mỗi dòng một sự kiện
// (text, thought, tool_call, tool_call_update, usage, end, error). Prompt đi qua tệp (không qua tham số dòng lệnh, vì lịch sử có thể dài).
// - Công cụ dựng sẵn (shell, đọc / sửa tệp, đọc URL) tắt: --tools chỉ giữ search_tool / use_tool (gọi công cụ MCP) và web_search khi
//   người dùng bật tìm web; thêm luật --deny cho chắc. Công cụ của Synchro đi qua cầu nối MCP "synchro" (tên synchro__<tên>).
// - Grok chỉ đọc máy chủ MCP từ cấu hình (không có cờ cho từng lượt): mỗi lượt có công cụ thêm cầu nối bằng `grok mcp add` rồi gỡ khi xong,
//   các lượt có công cụ của cùng một tài khoản chạy lần lượt (như Antigravity).
// - Ảnh / PDF gửi kèm: đã lưu trong thư mục làm việc, prompt tham chiếu bằng @<đường dẫn> (cách đính kèm tệp của Grok CLI).
const grokLocks = new Map<string, Slot>();
const GROK_DENY = ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch"];
async function grokRun(args: string[], req: TurnRequest) {
  const p = start("grok", args, { ...req, signal: undefined }, "", 60_000);
  if (!p) return false;
  for await (const _ of p.lines) { /* bỏ qua */ }
  return (await p.done).code === 0;
}
/** Xóa tệp tạm của lượt bằng chính user của engine (thư mục làm việc 0700 của user đó). */
async function rmEngineFile(req: TurnRequest, file: string) {
  const sh = spawnCli("/bin/sh", ["-c", 'rm -f "$1"', "sh", file], { env: req.env, cwd: path.dirname(file) });
  await sh.done;
}

export class GrokEngine implements Engine {
  readonly id = "grok";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    if (!req.mcp) { yield* this.turn(req); return; }
    const free = yield* turnLock(grokLocks, String(req.env?.HOME ?? ""), req, "Grok");
    if (!free) return;
    try {
      // Cầu nối của lượt trước (nếu lượt đó bị dừng giữa chừng) bị thay bằng cầu nối mới.
      await grokRun(["mcp", "remove", "synchro"], req).catch(() => false);
      const ok = await grokRun(["mcp", "add", "--transport", "http", "synchro", req.mcp.url], req).catch(() => false);
      yield { kind: "status" };
      yield* this.turn(ok ? req : { ...req, mcp: undefined });
    } finally {
      await grokRun(["mcp", "remove", "synchro"], req).catch(() => false);
      free();
    }
  }
  private async *turn(req: TurnRequest, retried = false): AsyncIterable<Event> {
    const cwd = req.workdir ?? path.join(engineHome(), "work");
    makeDir(cwd);
    const atts = (req.attachments ?? []).filter((a) => a.path);
    const refs = atts.flatMap((a) => [a.path!, ...(a.pages ?? []).map((x) => x.path).filter((x): x is string => !!x)]).map((f) => `@${path.relative(cwd, f)}`);
    // Hướng dẫn hệ thống rất dài (nhiều skill, connector) không vừa một tham số dòng lệnh (giới hạn 128 KB): đưa vào đầu tệp prompt.
    const longSys = tooLong(req.system);
    const prompt = (longSys ? `<system_instructions>\n${req.system}\n</system_instructions>\n\n` : "") + req.prompt
      + (refs.length ? `\n\n<attachments>\nNgười dùng gửi kèm các tệp dưới đây (đúng thứ tự [Ảnh / Tệp đính kèm n] ở trên): ${refs.join(" ")}\n</attachments>` : "");
    const file = path.join(cwd, `.synchro-grok-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.txt`);
    try { writeEngineFile(file, Buffer.from(prompt, "utf8")); }
    catch (e) { yield err(`Không chuyển được tin nhắn cho Grok: ${(e as Error).message}`, "other"); return; }
    // Lượt không có cầu nối (việc phụ: đặt tên, rút bộ nhớ…): tắt cả search_tool / use_tool để không gọi nhầm cầu nối của lượt khác
    // đang chạy cùng lúc. Có tệp đính kèm: không chặn Read để Grok CLI đọc được tệp @… (model vẫn không có công cụ đọc tệp vì --tools).
    const deny = GROK_DENY.filter((t) => t !== "Read" || !refs.length);
    const args = ["--prompt-file", file, "--output-format", "streaming-json", "--always-approve", "--no-memory", "--no-subagents", "--no-auto-update",
      "--tools", req.web ? "search_tool,use_tool,web_search" : "search_tool,use_tool", ...deny.flatMap((t) => ["--deny", t]), ...(req.web ? [] : ["--deny", "WebSearch", "--disable-web-search"]),
      ...(req.mcp ? [] : ["--disallowed-tools", "search_tool,use_tool"])];
    if (req.system && !longSys) args.push("--rules", req.system);
    if (req.model) args.push("-m", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--resume", req.sessionId);
    const p = start("grok", args, req, "");
    if (!p) { await rmEngineFile(req, file).catch(() => {}); yield notInstalled("grok"); return; }
    // Có dùng công cụ: phần chữ trước công cụ là lời dẫn (đã hiện trong nhật ký làm việc), câu trả lời là đoạn sau công cụ cuối cùng.
    let all = "", seg = "", tools = false, done = false, lastErr = "";
    const webCalls = new Set<string>();
    for await (const o of objects(p)) {
      // Grok không có sự kiện khởi động: mọi sự kiện (đang nghĩ, gọi công cụ…) đều là model đang làm việc. Trước đây chỉ chữ mới tính,
      // lượt mở đầu bằng công cụ hay nghĩ lâu bị coi là treo ở giây thứ 60.
      if (o.type !== "error") yield { kind: "activity" };
      if (o.type === "text" && typeof o.data === "string") { all += o.data; seg += o.data; yield { kind: "text", text: o.data }; }
      else if (o.type === "tool_call") {
        tools = true; seg = "";
        if (WEB_TOOL.test(String(o.toolName ?? "")) || o.kind === "search") {
          if (typeof o.toolCallId === "string") webCalls.add(o.toolCallId);
          yield { kind: "search", query: typeof o.rawInput?.query === "string" ? o.rawInput.query : undefined, url: typeof o.rawInput?.url === "string" ? o.rawInput.url : undefined };
        }
      } else if (o.type === "tool_call_update" && webCalls.has(String(o.toolCallId))) { const items = webSources(o.rawOutput); if (items.length) yield { kind: "sources", items }; }
      else if (o.type === "error") {
        lastErr = String(o.message ?? "Grok báo lỗi.");
        if (classify(lastErr) === "auth") { p.kill(); done = true; yield err(lastErr, "auth"); break; }
      } else if (o.type === "end") {
        done = true;
        if (typeof o.sessionId === "string" && o.sessionId) yield { kind: "session", id: o.sessionId };
        const u = (o.usage ?? {}) as Json;
        yield { kind: "usage", usage: { input: num(u.input_tokens) ?? num(u.prompt_tokens) ?? 0, output: (num(u.output_tokens) ?? num(u.completion_tokens) ?? 0) + (num(u.reasoning_tokens) ?? 0), cacheRead: num(u.cache_read_input_tokens) ?? num(u.cached_tokens), cacheWrite: num(u.cache_creation_input_tokens), costUsd: num(o.total_cost_usd) } };
        if (lastErr && !all) { yield err(lastErr, classify(lastErr)); break; }
        yield { kind: "final", text: tools && seg.trim() ? seg : all, via: "grok" };
      }
    }
    const e = await p.done;
    await rmEngineFile(req, file).catch(() => {});
    if (done) return;
    const msg = [lastErr, stripAnsi(p.stderr()).trim().split("\n").slice(-6).join("\n")].filter(Boolean).join("\n");
    // Model không nhận mức effort này (CLI kiểm tra trước khi chạy, chưa tốn lượt nào): chạy lại để model dùng mức mặc định.
    if (!retried && !all && req.effort && /effort/i.test(msg) && !e.aborted && !e.timedOut) { yield* this.turn({ ...req, effort: undefined }, true); return; }
    yield exitError("grok", p, e, lastErr);
  }
}
