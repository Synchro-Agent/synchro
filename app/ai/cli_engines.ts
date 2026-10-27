// Ba engine chạy CLI chính chủ bằng gói subscription của người dùng (ADR 0001, bước 5).
// Engine không biết tài khoản là ai: biến môi trường đăng nhập (CLAUDE_CONFIG_DIR, CODEX_HOME, HOME…) do cli_auth.engineEnv()
// dựng và truyền vào TurnRequest.env; cli_runtime lọc env, kill cả process group khi Dừng hoặc quá 30 phút.
import path from "node:path";
import type { Engine, ErrorCode, Event, RateWindow, TurnRequest, Usage } from "./engine";
import { type Cli, engineHome, find, makeDir, type Proc, spawnCli, stripAnsi, type Exit } from "./cli_runtime";
import { classify, redact } from "./errors";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function start(cli: Cli, args: string[], req: TurnRequest, stdin: string): Proc | null {
  const bin = find(cli);
  if (!bin) return null;
  // Không có workdir riêng thì chạy trong <home>/work (CLI chỉ ghi trong thư mục làm việc).
  const cwd = req.workdir ?? path.join(engineHome(), "work");
  makeDir(cwd);
  return spawnCli(bin, args, { env: req.env, cwd, stdin, signal: req.signal });
}

async function* objects(p: Proc): AsyncIterable<Json> {
  for await (const l of p.lines) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try { yield JSON.parse(t) as Json; } catch {}
  }
}

const err = (message: string, code: ErrorCode): Event => ({ kind: "error", message: redact(message), code });
const notInstalled = (cli: Cli): Event => err(`CLI ${cli} chưa được cài trên máy chủ.`, "other");

/** Lỗi khi CLI thoát mà chưa có kết quả: Dừng, quá giờ, hoặc đoạn cuối stderr đã phân loại. */
function exitError(cli: Cli, p: Proc, e: Exit, extra = ""): Event {
  if (e.aborted) return err("Đã dừng.", "aborted");
  if (e.timedOut) return err("Lượt này chạy quá 30 phút nên đã dừng.", "timeout");
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
    if (req.system) args.push("--append-system-prompt", req.system);
    if (req.model) args.push("--model", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--resume", req.sessionId);
    const p = start("claude", args, req, req.prompt);
    if (!p) { yield notInstalled("claude"); return; }
    let text = "", done = false;
    const limits = new Map<string, RateWindow>();
    for await (const o of objects(p)) {
      if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") yield { kind: "session", id: o.session_id, ...(typeof o.model === "string" ? { model: o.model } : {}) };
      else if (o.type === "stream_event" && o.event?.type === "content_block_delta" && o.event.delta?.type === "text_delta" && typeof o.event.delta.text === "string") {
        text += o.event.delta.text;
        yield { kind: "text", text: o.event.delta.text };
      } else if (o.type === "system" && o.subtype === "api_retry") {
        // Claude Code tự thử lại khi API lỗi; 401/403 thì thử lại vô ích (token hết hạn, bị thu hồi): dừng ngay, báo đăng nhập lại.
        const st = num(o.error_status) ?? num(o.status) ?? num(o.error?.status);
        const m = String(o.error?.message ?? o.error ?? o.message ?? "");
        if (st === 401 || st === 403 || (!st && classify(m) === "auth")) {
          p.kill(); done = true;
          yield err(`Claude từ chối đăng nhập (${st ?? "auth"}): ${m || "phiên đăng nhập không còn hợp lệ"}. Đăng nhập lại trong Cài đặt → Providers.`, "auth");
          break;
        }
      } else if (o.type === "rate_limit_event") {
        for (const w of claudeLimits(o.rate_limit_info)) limits.set(w.window, w);
      } else if (o.type === "result") {
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
    // Công cụ của Synchro qua cầu nối MCP (Streamable HTTP); tìm web dựng sẵn khi người dùng bật.
    if (req.mcp) args.push("-c", `mcp_servers.synchro.url=${JSON.stringify(req.mcp.url)}`, "-c", "mcp_servers.synchro.startup_timeout_sec=20", "-c", "mcp_servers.synchro.tool_timeout_sec=600");
    if (req.web) args.push("-c", "tools.web_search=true");
    if (req.model) args.push("-m", req.model);
    // Mức đã được subs.resolvePlanModel chọn theo đúng các mức model này hỗ trợ (low…max, ultra).
    const ce = cliEffort(req.effort);
    if (ce) args.push("-c", `model_reasoning_effort="${ce}"`);
    args.push("-");
    const p = start("codex", args, req, prompt);
    if (!p) { yield notInstalled("codex"); return; }
    const parts: string[] = [];
    let done = false, lastErr = "", tools = false;
    for await (const o of objects(p)) {
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
      }
    }
    const e = await p.done;
    if (!done) yield exitError("codex", p, e, lastErr);
  }
}

// ---------------------------------------------------------------- Antigravity
export class AntigravityEngine implements Engine {
  readonly id = "agy";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    const prompt = req.system && !req.sessionId ? `${req.system}\n\n---\n\n${req.prompt}` : req.prompt;
    const args = ["--output-format", "json"];
    if (req.model) args.push("--model", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--conversation", req.sessionId);
    args.push("-p", prompt);
    const p = start("agy", args, req, "");
    if (!p) { yield notInstalled("agy"); return; }
    // agy in một object JSON duy nhất khi xong lượt (có thể trải nhiều dòng).
    let out = "";
    for await (const l of p.lines) out += l + "\n";
    const e = await p.done;
    let o: Json | null = null;
    const t = out.trim();
    try { o = JSON.parse(t.slice(t.indexOf("{"))) as Json; } catch {}
    if (!o) { yield exitError("agy", p, e); return; }
    if (typeof o.conversation_id === "string" && o.conversation_id) yield { kind: "session", id: o.conversation_id };
    const u = (o.usage ?? {}) as Json;
    if (o.usage) yield { kind: "usage", usage: { input: num(u.input_tokens) ?? 0, output: (num(u.output_tokens) ?? 0) + (num(u.thinking_tokens) ?? 0), cacheRead: num(u.cache_read_tokens) } };
    if (o.status === "ERROR" || o.error || e.code !== 0) {
      if (e.aborted || e.timedOut) { yield exitError("agy", p, e); return; }
      const m = [o.error, stripAnsi(p.stderr()).trim()].filter(Boolean).join("\n") || "Antigravity báo lỗi.";
      yield err(m, classify(m));
      return;
    }
    const text = typeof o.response === "string" ? o.response : "";
    if (text) yield { kind: "text", text };
    yield { kind: "final", text, via: "agy" };
  }
}
