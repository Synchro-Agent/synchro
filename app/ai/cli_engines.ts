// Các engine chạy CLI chính chủ bằng gói subscription của người dùng (ADR 0001, bước 5): Claude Code, Codex, Antigravity, Grok.
// Engine không biết tài khoản là ai: biến môi trường đăng nhập (CLAUDE_CONFIG_DIR, CODEX_HOME, HOME…) do cli_auth.engineEnv()
// dựng và truyền vào TurnRequest.env; cli_runtime lọc env, kill cả process group khi Dừng, CLI im lặng quá lâu hoặc chạm mức trần của lượt.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Attachment, Engine, ErrorCode, Event, RateWindow, TurnRequest, Usage, WebSource } from "./engine";
import { type Cli, cliRunning, CODEX_TURN_PREFIX, engineHome, find, IDLE_MS, makeDir, MAX_TURN_MS, type Proc, sessionSeen, spawnCli, stripAnsi, turnHomeBase, writeEngineFile, type Exit } from "./cli_runtime";
import { classify, redact } from "./errors";
import { forgetSession, poolStrike, prestart, takeProcess, type PoolSpec } from "./cli_pool";
import { scrubServerPaths } from "./imagefiles";
import { openTurnHome, turnHomeOn, type TurnHome } from "./turnhome";
import { CodexServerUnavailable, codexServerOn, codexServerTurn } from "./codex_server";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function start(cli: Cli, args: string[], req: TurnRequest, stdin: string, timeoutMs?: number): Promise<Proc | null> {
  const bin = find(cli);
  if (!bin) return null;
  // Không có workdir riêng thì chạy trong <home>/work (CLI chỉ ghi trong thư mục làm việc).
  const cwd = req.workdir ?? path.join(engineHome(), "work");
  await makeDir(cwd);
  const p = spawnCli(bin, args, { env: req.env, cwd, stdin, signal: req.signal, idleMs: IDLE_MS, alive: req.alive, ...(timeoutMs ? { timeoutMs } : {}) });
  // Hai CLI chỉ báo mã phiên cuối lượt: lượt tạo ảnh cần biết lượt nào còn chạy trước khi dọn phiên của nó (watchSessions).
  // HOME riêng của lượt (turnhome.ts) là thư mục con của thư mục đăng nhập: theo dõi theo thư mục đăng nhập, như lượt tạo ảnh.
  if ((cli === "agy" || cli === "grok") && req.env?.HOME) cliRunning(turnHomeBase(req.env.HOME), p);
  return p;
}
// Linux không cho một tham số dòng lệnh dài quá 128 KB (MAX_ARG_STRLEN): vượt là "spawn E2BIG", lượt chết trước khi chạy. Đo bằng byte
// (tiếng Việt có dấu 2–3 byte mỗi chữ), chừa chỗ: nội dung dài hơn ARG_MAX_BYTES thì đi qua tệp hoặc stdin.
const ARG_MAX_BYTES = 100_000;
const tooLong = (s?: string) => Buffer.byteLength(s ?? "", "utf8") > ARG_MAX_BYTES;
/** Tệp tạm của lượt trong thư mục làm việc (ghi bằng user của engine). */
async function turnFile(req: TurnRequest, tag: string, text: string) {
  const cwd = req.workdir ?? path.join(engineHome(), "work");
  const file = path.join(cwd, `.synchro-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.txt`);
  await writeEngineFile(file, Buffer.from(text, "utf8"));
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

// ---------------------------------------------------------------- khóa lượt theo tài khoản (Antigravity, Grok): chỉ còn cho đường dự phòng
// Mặc định mỗi lượt có công cụ chạy với HOME riêng (turnhome.ts, Blueprint G1) nên không xếp hàng. Khóa dưới đây chỉ dùng khi HOME riêng tắt
// (SYNCHRO_CLI_TURN_HOME=0) hoặc dựng lỗi, và cho lượt tạo ảnh (agyQuiet). Khi đó hai CLI này đọc cầu nối MCP từ cấu hình chung của tài khoản nên các lượt có công cụ của cùng tài khoản chạy lần lượt. Chờ lượt trước
// phải: dừng được ngay khi bấm Dừng, có giới hạn, và báo cho người dùng biết đang chờ gì (một câu "chào" từng chờ trống 2 phút rồi báo lỗi sai).
// Lượt đang chờ người dùng duyệt (tới 10 phút) thì nhả khóa sớm qua mcp.onPark: lúc đó CLI đã gọi tới cầu nối, tức là đã đọc xong cấu hình, nên lượt sau được ghi đè.
// Lượt nào ghi cấu hình sau cùng mới được gỡ nó khi xong (configOwner), để lượt đang chờ duyệt không gỡ mất cầu nối của lượt đang chạy.
const configOwner = new Map<string, string>();
const ownerKey = (cli: string, home: string) => `${cli}:${home}`;
// who: các lượt đang giữ hoặc xếp trước, để biết có lượt nào đang dừng chờ người dùng duyệt không. Lượt B từng hết 5 phút chờ rồi báo sai "lượt khác chạy lâu" trong khi
// lượt A chỉ đợi một cú bấm ở thẻ duyệt (thẻ đợi được 10 phút). Giờ B nói rõ cần trả lời ở đoạn chat kia và chờ tiếp chừng nào thẻ còn mở.
type Slot = { chain: Promise<void>; at: number; who: (() => boolean)[] };
const LOCK_WAIT_MS = 5 * 60_000;
async function* turnLock(locks: Map<string, Slot>, home: string, req: TurnRequest, name: string): AsyncGenerator<Event, (() => void) | null, unknown> {
  const held = locks.get(home);
  // Lượt giữ khóa lâu hơn mức trần của một lượt thì không thể còn chạy: bỏ qua, không để mọi lượt sau kẹt mãi.
  const prev = held && Date.now() - held.at < MAX_TURN_MS + 60_000 ? held.chain : Promise.resolve();
  let release = () => {};
  const mine = new Promise<void>((r) => { release = r; });
  const slot: Slot = { chain: prev.then(() => mine), at: Date.now(), who: [...(held?.who ?? []), req.awaitingUser ?? (() => false)] };
  locks.set(home, slot);
  void slot.chain.then(() => { if (locks.get(home) === slot) locks.delete(home); });
  if (!held) return release;
  yield { kind: "status", text: `Đang chờ lượt ${name} khác của tài khoản này xong`, wait: true };
  const limit = req.lockMs ?? LOCK_WAIT_MS;
  const t0 = Date.now();
  let deadline = t0 + limit, told = false, wake = () => {}, tickAt = t0;
  const st: { got: "ok" | "aborted" | "late" | null } = { got: null };
  void prev.then(() => { st.got ??= "ok"; wake(); });
  const onAbort = () => { st.got ??= "aborted"; wake(); };
  if (req.signal?.aborted) onAbort(); else req.signal?.addEventListener("abort", onAbort, { once: true });
  while (!st.got) {
    // Chế độ Tự động chờ ngắn (lockMs) rồi chuyển model nên không chờ theo thẻ duyệt.
    if (!req.lockMs && held?.who.some((f) => f())) {
      deadline = Date.now() + limit;
      if (!told) { told = true; yield { kind: "status", text: `Một đoạn chat ${name} khác đang chờ bạn duyệt. Hãy trả lời ở đoạn chat đó, lượt này sẽ chạy ngay sau đó`, wait: true }; }
    } else if (Date.now() >= deadline) { st.got = "late"; break; }
    // Nói đã chờ bao lâu: "đang chờ" trơ trơ vài phút trông như treo.
    else if (!told && Date.now() - tickAt >= 15_000) { tickAt = Date.now(); yield { kind: "status", text: `Đang chờ lượt ${name} khác của tài khoản này xong, đã ${Math.round((Date.now() - t0) / 1000)} giây`, wait: true }; }
    await new Promise<void>((ok) => { const t = setTimeout(ok, Math.min(1000, Math.max(50, deadline - Date.now()))); wake = () => { clearTimeout(t); ok(); }; });
  }
  req.signal?.removeEventListener("abort", onAbort);
  const got = st.got;
  if (got === "ok") { yield { kind: "status", wait: false }; return release; }
  // Bỏ chờ: nhả chỗ của mình; lượt xếp sau vẫn chờ đúng lượt đang chạy (chain vẫn gồm prev).
  release();
  yield got === "aborted" ? err("Đã dừng.", "aborted") : err(`Một lượt ${name} khác của tài khoản này đang chạy lâu nên lượt này chưa bắt đầu được. Hãy thử lại sau khi lượt đó xong hoặc chọn model khác.`, "busy");
  return null;
}
const notInstalled = (cli: Cli): Event => err(`CLI ${cli} chưa được cài trên máy chủ.`, "other");
const bridgeFailed = (name: string): Event => err(`Không nối được công cụ của Synchro với ${name} nên lượt này chưa chạy. Hãy thử lại hoặc chọn model khác.`, "other");

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

// Lượt dùng tiến trình khởi động sẵn: đúng các cờ của lượt thường, thêm stream-json để gửi tin qua stdin. Các cờ này chỉ đọc lúc khởi động nên nằm trong khóa của hồ.
// Lượt có công cụ (G2.2): cầu nối là địa chỉ sống của cuộc trò chuyện, ghi trong tệp cấu hình 0600 có tên theo địa chỉ + bộ công cụ (đổi bộ công cụ là khóa khác,
// không dùng nhầm tiến trình đã liệt kê bộ cũ).
const liveMcpFile = (cwd: string, live: { url: string; key: string }) => path.join(cwd, `.synchro-live-${crypto.createHash("sha256").update(`${live.url}\n${live.key}`).digest("hex").slice(0, 24)}.json`);
function poolSpec(req: Pick<TurnRequest, "system" | "model" | "effort" | "env" | "workdir" | "mcp">, bin: string, tools: string): PoolSpec {
  const cwd = req.workdir ?? path.join(engineHome(), "work"), live = req.mcp?.live;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", tools, "--input-format", "stream-json"];
  if (live) args.push("--mcp-config", liveMcpFile(cwd, live), "--strict-mcp-config", "--allowedTools", "mcp__synchro");
  if (req.system) args.push("--system-prompt", req.system);
  if (req.model) args.push("--model", req.model);
  const ce = cliEffort(req.effort);
  if (ce) args.push("--effort", ce);
  return { bin, args, env: live ? { ...req.env, MCP_TOOL_TIMEOUT: "1800000" } : req.env ?? {}, cwd, account: req.env?.CLAUDE_CONFIG_DIR ?? "" };
}
type ClaudeEnd = { done: boolean; failed: boolean; session: string | null; spoke: boolean };

export class ClaudeCodeEngine implements Engine {
  readonly id = "claude";
  /** tools: công cụ dựng sẵn của Claude Code được bật ("" = tắt hết; công cụ của Synchro đi qua MCP). */
  constructor(private o: { tools?: string } = {}) {}
  /** Khởi động sẵn tiến trình cho lượt không công cụ kế tiếp của tài khoản này (không tốn lượt nào của gói). */
  async prestart(req: Pick<TurnRequest, "system" | "model" | "effort" | "env" | "workdir">): Promise<void> {
    const bin = find("claude");
    if (!bin || tooLong(req.system)) return;
    const spec = poolSpec(req, bin, this.o.tools ?? "");
    await makeDir(spec.cwd);
    prestart(spec);
  }
  /** true: lượt đã chạy xong bằng hồ (kể cả báo lỗi). false: chưa có gì tới người dùng, chạy lại bằng tiến trình mới. */
  private async *pooled(req: TurnRequest): AsyncGenerator<Event, boolean, unknown> {
    const bin = find("claude");
    if (!bin || tooLong(req.system)) return false;
    const spec = poolSpec(req, bin, this.o.tools ?? "");
    await makeDir(spec.cwd);
    const live = req.mcp?.live;
    if (live) {
      const f = liveMcpFile(spec.cwd, live);
      // Có user riêng của engine thì Synchro không thấy tệp (thư mục 0700 của user đó): ghi lại, nội dung không đổi.
      try { if (!fs.existsSync(f)) await writeEngineFile(f, Buffer.from(JSON.stringify({ mcpServers: { synchro: { type: "http", url: live.url } } }))); }
      catch { return false; }
    }
    const lease = takeProcess(spec, req.sessionId);
    if (!lease) return false;
    yield { kind: "pool", state: lease.hit ? "hit" : "cold" };
    let r: ClaudeEnd = { done: false, failed: false, session: null, spoke: false }, closed = false;
    try {
      lease.send(claudeInput(req.prompt, req.attachments ?? []));
      // Có tiến trình sẵn thì dòng đầu tới ngay khi CLI nhận tin; vừa khởi động thì còn phải chờ khởi động xong. SYNCHRO_CLAUDE_POOL_FIRST_SEC: rút ngắn khi kiểm thử.
      const firstMs = Number(process.env.SYNCHRO_CLAUDE_POOL_FIRST_SEC) * 1000 || (lease.hit ? 12_000 : 20_000);
      r = yield* this.events(lease.events(req.signal, firstMs), () => lease.discard());
      const end = lease.ended();
      if (end === "aborted") { lease.discard(); closed = true; yield err("Đã dừng.", "aborted"); return true; }
      if (r.done) {
        // Lượt báo lỗi (hết hạn mức, đăng nhập…): không biết tiến trình còn dùng được không.
        if (r.failed) lease.discard();
        // Tiến trình của lượt có công cụ gắn với cuộc trò chuyện này (địa chỉ sống): giữ cho câu sau của nó, không khởi động sẵn bản cho đoạn chat mới.
        else { lease.release(r.session); if (!req.mcp) await this.prestart(req); }
        closed = true;
        return true;
      }
      lease.discard(); closed = true;
      if (!r.spoke) { poolStrike(end === "silent" ? "tiến trình không phản hồi tin nhắn" : "tiến trình thoát giữa lượt"); return false; }
      yield exitError("claude", lease.proc, await lease.done());
      return true;
    } finally { if (!closed) lease.discard(); }
  }
  /** Đọc sự kiện của một lượt, dù là tiến trình riêng hay tiến trình trong hồ. */
  private async *events(src: AsyncIterable<Json>, kill: () => void): AsyncGenerator<Event, ClaudeEnd, unknown> {
    // gap: model bắt đầu một tin mới trong lượt (sau công cụ dựng sẵn như tìm web) — chữ của tin mới cách chữ trước một dòng trống,
    // không dính liền "…dựng deck.Đã đọc 4 skill…".
    let text = "", done = false, gap = false, failed = false, session: string | null = null;
    const limits = new Map<string, RateWindow>(), webIds = new Set<string>();
    // Đo: lần đầu của từng loại sự kiện (ms từ lúc khởi động CLI), ghi một dòng [timing] khi xong — để biết thời gian chờ nằm ở đâu.
    const T0 = Date.now(), seen = new Map<string, number>();
    const mark = (o: Json) => { const k = [o.type, o.subtype, (o.event as Json | undefined)?.type].filter(Boolean).join(":"); if (!seen.has(k) && seen.size < 24) seen.set(k, Date.now() - T0); };
    for await (const o of src) {
      mark(o as Json);
      // Model đã phản hồi: có sự kiện của API (kể cả đang nghĩ) hoặc tin của model. init và rate_limit_event không tính: CLI tự in khi khởi động.
      // CLI đang tự rút gọn hội thoại dài cũng là đang làm việc: báo status / compact_boundary, chưa có sự kiện API nào; bộ canh 90 giây từng cắt nhầm lượt khỏe.
      if (o.type === "stream_event" || o.type === "assistant" || o.type === "user" || (o.type === "system" && (o.subtype === "status" || o.subtype === "compact_boundary"))) yield { kind: "activity" };
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
      if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") { session = o.session_id; yield { kind: "session", id: o.session_id, ...(typeof o.model === "string" ? { model: o.model } : {}) }; }
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
          kill(); done = true; failed = true;
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
        // Tiến trình sống qua nhiều lượt có thể chỉ in init một lần: mã phiên lấy thêm từ kết quả của lượt.
        if (!session && typeof o.session_id === "string") { session = o.session_id; yield { kind: "session", id: o.session_id }; }
        const u = (o.usage ?? {}) as Json;
        const usage: Usage = { input: num(u.input_tokens) ?? 0, output: num(u.output_tokens) ?? 0, cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens), costUsd: num(o.total_cost_usd) };
        if (limits.size) usage.limits = [...limits.values()];
        yield { kind: "usage", usage };
        if (o.is_error || (o.subtype && o.subtype !== "success")) {
          failed = true;
          const m = String(o.result || o.error || o.subtype || "Claude Code báo lỗi.");
          yield err(m, classify(m, num(o.api_error_status)));
        } else yield { kind: "final", text: typeof o.result === "string" && o.result ? o.result : text, via: "claude" };
      }
    }
    return { done, failed, session, spoke: !!text };
  }
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    if (req.pool && (!req.mcp || req.mcp.live) && !req.web && !req.fork && (yield* this.pooled(req))) return;
    // Lượt này nối tiếp một phiên bằng tiến trình riêng: tiến trình đang đợi sẵn với phiên đó không còn biết hết hội thoại.
    if (req.sessionId) forgetSession(req.env?.CLAUDE_CONFIG_DIR ?? "", req.sessionId);
    // Công cụ dựng sẵn: chỉ tìm / đọc web khi người dùng bật "Tìm kiếm trên web"; công cụ của Synchro đi qua cầu nối MCP.
    const builtin = req.web ? "WebSearch,WebFetch" : this.o.tools ?? "";
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", builtin];
    const allow = [...(req.mcp ? ["mcp__synchro"] : []), ...(req.web ? ["WebSearch", "WebFetch"] : [])];
    // URL cầu nối MCP mang token bí mật của lượt: qua tệp 0600 (--mcp-config nhận đường dẫn tệp), KHÔNG qua tham số dòng lệnh —
    // tham số nhìn thấy được ở /proc/<pid>/cmdline, mà các lượt chia sẻ cùng một user hệ thống của engine.
    let mcpFile = "";
    if (req.mcp) {
      try { mcpFile = await turnFile(req, "claude-mcp", JSON.stringify({ mcpServers: { synchro: { type: "http", url: req.mcp.url } } })); }
      catch (e) { yield err(`Không chuẩn bị được cấu hình công cụ cho Claude Code: ${(e as Error).message}`, "other"); return; }
      args.push("--mcp-config", mcpFile, "--strict-mcp-config");
    }
    if (allow.length) args.push("--allowedTools", allow.join(","));
    // Hướng dẫn hệ thống của Synchro THAY lời nhắc mặc định của Claude Code (dành cho lập trình trong terminal, vài nghìn token mỗi lượt,
    // không dùng gì cho Synchro): lượt nhanh hơn, rẻ hơn, model không tự nhận là "Claude Code". Dài (nhiều skill, studio, connector) thì
    // qua tệp, không qua tham số (giới hạn 128 KB mỗi tham số).
    let sysFile = "";
    if (req.system && tooLong(req.system)) {
      try { sysFile = await turnFile(req, "claude-sys", req.system); args.push("--system-prompt-file", sysFile); }
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
    const p = await start("claude", args, req.mcp ? { ...req, env: { ...req.env, MCP_TOOL_TIMEOUT: "1800000" } } : req, atts.length ? claudeInput(req.prompt, atts) : req.prompt);
    const tmpFiles = [sysFile, mcpFile].filter(Boolean);
    if (tmpFiles.length) void p?.done.finally(() => { for (const f of tmpFiles) void rmEngineFile(req, f).catch(() => {}); });
    if (!p) { for (const f of tmpFiles) await rmEngineFile(req, f).catch(() => {}); yield notInstalled("claude"); return; }
    const r = yield* this.events(objects(p), p.kill);
    const e = await p.done;
    if (!r.done) yield exitError("claude", p, e);
  }
}

// ---------------------------------------------------------------- Codex
// Cầu nối MCP của lượt mang token bí mật trong URL: KHÔNG qua -c trên dòng lệnh (ai cùng user hệ thống cũng đọc được /proc/<pid>/cmdline).
// Codex chỉ đọc máy chủ MCP từ $CODEX_HOME/config.toml, nên lượt có công cụ chạy với CODEX_HOME riêng (0700) nằm trong thư mục đăng nhập của tài khoản:
// config.toml (0600) = cấu hình sẵn có của tài khoản (bỏ mục synchro cũ nếu có) + mục [mcp_servers.synchro] của lượt; mọi mục khác (auth.json,
// sessions/ để nối tiếp phiên, history.jsonl…) là liên kết về thư mục đăng nhập, nên đăng nhập và lịch sử phiên vẫn ghi đúng chỗ. Xong lượt: tệp Codex
// vừa tạo mới, hoặc tệp thật đã thay liên kết (ghi tệp mới rồi đổi tên, như khi làm mới token trong auth.json), được chuyển về thư mục đăng nhập,
// rồi bỏ thư mục của lượt. Chạy bằng user của engine (thư mục đăng nhập 0700 của user đó); nội dung cấu hình đi qua stdin.
const CODEX_HOME_SETUP = String.raw`set -e
base=$1; t=$2
umask 077
mkdir -p "$base/sessions"
mkdir -m 700 "$t"
for f in "$base"/* "$base"/.[!.]* "$base"/..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  n=$(basename "$f")
  case "$n" in config.toml|${CODEX_TURN_PREFIX}*) continue ;; esac
  ln -s "$f" "$t/$n"
done
{
  if [ -f "$base/config.toml" ]; then
    awk '/^[[:space:]]*\[/ { skip = ($0 ~ /^[[:space:]]*\[[[:space:]]*mcp_servers\.("synchro"|synchro)[[:space:]]*(\]|\.)/) } /^[[:space:]]*mcp_servers\.("synchro"|synchro)\./ { next } !skip' "$base/config.toml"
    echo
  fi
  cat
} > "$t/config.toml"
chmod 600 "$t/config.toml"`;
const CODEX_HOME_CLEANUP = String.raw`base=$1; t=$2
case "$t" in "$base"/${CODEX_TURN_PREFIX}*) ;; *) exit 1 ;; esac
[ -d "$t" ] || exit 0
rm -f "$t/config.toml"
for f in "$t"/* "$t"/.[!.]* "$t"/..?*; do
  [ -L "$f" ] && continue
  [ -e "$f" ] || continue
  n=$(basename "$f")
  [ -d "$base/$n" ] && continue
  if [ -d "$f" ]; then [ -e "$base/$n" ] || mv "$f" "$base/$n"; else mv -f "$f" "$base/$n"; fi
done
find "$t" -depth -mindepth 1 -delete 2>/dev/null
rmdir "$t"`;
/** Mục [mcp_servers.synchro] của lượt. codex exec không có ai bấm duyệt (approval_policy luôn là never), nên công cụ MCP phải được duyệt sẵn
 *  (default_tools_approval_mode = "approve"); thiếu khóa này Codex 0.164 từ chối mọi lời gọi "MCP tool call requires approval, but approval policy is never". */
export const codexMcpToml = (url: string) => `[mcp_servers.synchro]\nurl = ${JSON.stringify(url)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 1800\ndefault_tools_approval_mode = "approve"\n`;
/** Tạo CODEX_HOME riêng của lượt (xem trên). Trả về đường dẫn; lỗi thì đã dọn phần dở. */
async function codexTurnHome(req: TurnRequest, url: string): Promise<string> {
  const base = req.env?.CODEX_HOME;
  if (!base) throw new Error("thiếu thư mục đăng nhập Codex");
  const dir = path.join(base, `${CODEX_TURN_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const p = spawnCli("/bin/sh", ["-c", CODEX_HOME_SETUP, "sh", base, dir], { env: req.env, cwd: base, stdin: codexMcpToml(url), timeoutMs: 30_000 });
  const e = await p.done;
  if (e.code !== 0) { await rmCodexHome(req, dir).catch(() => {}); throw new Error(p.stderr().trim().slice(0, 200) || `mã thoát ${e.code}`); }
  return dir;
}
/** Bỏ CODEX_HOME của lượt: chỉ nhận đúng thư mục con có tiền tố của thư mục đăng nhập. find -delete không đi theo liên kết. */
async function rmCodexHome(req: TurnRequest, dir: string) {
  const base = req.env?.CODEX_HOME;
  if (!base || path.dirname(dir) !== base || !path.basename(dir).startsWith(CODEX_TURN_PREFIX)) return;
  await spawnCli("/bin/sh", ["-c", CODEX_HOME_CLEANUP, "sh", base, dir], { env: req.env, cwd: base, stdin: "", timeoutMs: 60_000 }).done;
}
// Loại mục trong luồng sự kiện của codex exec là công cụ chạy trên máy chủ (không qua Synchro): lệnh shell, sửa / đọc tệp.
export const CODEX_LOCAL = /command|shell|exec|file_change|patch|read_file|list_dir|grep_files|view_image/i;
/** Cờ tắt shell và xem tệp của Codex (lý do ở runTurn bên dưới); lượt tạo ảnh dùng đúng các cờ này. */
export const CODEX_SAFE = ["--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "tools.view_image=false"];
export class CodexEngine implements Engine {
  readonly id = "codex";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    // Codex không có tham số system riêng: đặt system lên đầu prompt ở lượt mở hội thoại; lượt resume đã có trong lịch sử, chỉ thêm phần mới (subs.ts).
    const head = req.sessionId ? req.sysUpdate : req.system;
    const prompt = head ? `${head}\n\n---\n\n${req.prompt}` : req.prompt;
    // Hộp cát "chỉ đọc" của Codex vẫn đọc được cả đĩa, mà mọi thư mục đăng nhập thuộc cùng một user hệ thống: lệnh shell trên máy chủ đọc được
    // đăng nhập của người khác. Tắt hẳn công cụ shell và xem tệp (việc thật đều chạy trong workspace qua công cụ của Synchro); bản Codex nào không
    // nhận các khóa này thì vòng lặp dưới dừng lượt ngay khi model định chạy lệnh (CODEX_LOCAL), trước khi kết quả kịp về tới model.
    // Tắt cả image_gen dựng sẵn (gói trả phí mới có): ảnh nó tạo nằm trong thư mục trên máy chủ, không thành tệp của người dùng, câu "đã lưu" thì đã được bỏ đường dẫn nên trông như thành công mà
    // không có ảnh. Lượt chat tạo ảnh bằng generate_image của Synchro; đường nhanh thì model báo cần công cụ. Lượt tạo ảnh của imagegen.ts không đi qua đây nên vẫn có image_gen.
    // Đường ấm (Blueprint G2.3): một codex app-server sống lâu cho mỗi tài khoản, cùng cờ an toàn. Không dùng được (tắt, hết chỗ, lượt có cầu nối riêng của lượt,
    // app-server lỗi trước khi lượt bắt đầu) thì chạy codex exec như cũ, có ghi nhật ký.
    if (codexServerOn()) {
      const ce0 = cliEffort(req.effort);
      try { yield* codexServerTurn(req, prompt, req.workdir ?? path.join(engineHome(), "work"), req.model, ce0, imagePaths(req.attachments ?? [])); return; }
      catch (e) { if (!(e instanceof CodexServerUnavailable)) throw e; console.warn(`[codex-server] chạy codex exec cho lượt này: ${redact(e.message).slice(0, 200)}`); }
    }
    const args = ["exec", ...(req.sessionId ? ["resume", req.sessionId] : []), ...CODEX_SAFE, "-c", "features.image_generation=false"];
    // Công cụ của Synchro qua cầu nối MCP (Streamable HTTP): cấu hình trong CODEX_HOME riêng của lượt (codexTurnHome), không qua tham số.
    // Tìm web dựng sẵn khi người dùng bật. Hộp cát chỉ đọc vẫn giữ cho lệnh dựng sẵn của Codex trên máy chủ.
    if (req.web) args.push("-c", "tools.web_search=true");
    if (req.model) args.push("-m", req.model);
    // Mức đã được subs.resolvePlanModel chọn theo đúng các mức model này hỗ trợ (low…max, ultra).
    const ce = cliEffort(req.effort);
    if (ce) args.push("-c", `model_reasoning_effort="${ce}"`);
    // Ảnh gửi kèm (cả khi nối tiếp phiên): --image=<tệp>; PDF: chữ trích ra đã có trong prompt, trang scan đi cùng ảnh (Codex không còn công cụ mở tệp).
    for (const f of imagePaths(req.attachments ?? [])) args.push(`--image=${f}`);
    args.push("-");
    let home = "";
    if (req.mcp) {
      try { home = await codexTurnHome(req, req.mcp.url); }
      catch (e) { yield err(`Không chuẩn bị được cấu hình công cụ cho Codex: ${(e as Error).message}`, "other"); return; }
    }
    let p: Proc | null;
    try { p = await start("codex", args, home ? { ...req, env: { ...req.env, CODEX_HOME: home } } : req, prompt); }
    catch (e) { if (home) await rmCodexHome(req, home).catch(() => {}); throw e; }
    // Dọn CODEX_HOME của lượt khi CLI thoát, như tệp cấu hình MCP của Claude Code.
    if (home) void p?.done.finally(() => { void rmCodexHome(req, home).catch(() => {}); });
    if (!p) { if (home) await rmCodexHome(req, home).catch(() => {}); yield notInstalled("codex"); return; }
    const parts: string[] = [];
    let done = false, lastErr = "", tools = false, partial = "";
    const asked = new Set<string>();
    // codex exec thường chỉ báo chữ khi xong cả một mục: nói trước để người dùng không tưởng là treo.
    yield { kind: "status", text: "ChatGPT đang viết, chữ sẽ hiện khi xong từng đoạn" };
    for await (const o of objects(p)) {
      if (/^item\./.test(String(o.type)) && CODEX_LOCAL.test(String(o.item?.type ?? o.item?.item_type ?? ""))) {
        // Không ghi nội dung lệnh vào nhật ký: có thể chứa dữ liệu của người dùng.
        console.error(`[codex] chặn công cụ trên máy chủ: ${String(o.item?.type ?? o.item?.item_type).slice(0, 40)}`);
        p.kill(); done = true;
        yield err("Codex định chạy lệnh trực tiếp trên máy chủ nên Synchro đã dừng lượt này để bảo vệ dữ liệu. Hãy nhắn lại, hoặc dùng model khác.", "other");
        break;
      }
      // Mục đầu tiên của lượt là lúc model thật sự làm việc; thread.started, turn.started chỉ là CLI khởi động.
      if (/^item\./.test(String(o.type))) yield { kind: "activity" };
      if (/^item\.(started|completed)$/.test(String(o.type)) && o.item?.type === "web_search") {
        const q = typeof o.item.query === "string" && o.item.query ? o.item.query : typeof o.item.action?.query === "string" ? o.item.action.query : undefined;
        const url = typeof o.item.action?.url === "string" ? o.item.action.url : undefined;
        if ((q || url) && !asked.has(q ?? url!)) { asked.add(q ?? url!); yield { kind: "search", query: q, url }; if (url) yield { kind: "sources", items: [{ title: "", url }] }; }
      }
      if (o.type === "thread.started" && typeof o.thread_id === "string") yield { kind: "session", id: o.thread_id };
      else if (o.type === "item.started" && /mcp_tool_call|web_search/.test(String(o.item?.type ?? ""))) tools = true;
      // Bản Codex nào báo chữ dần (item.updated) thì hiện dần; chỉ phần chưa hiện mới gửi đi, mục xong không lặp lại chữ.
      else if (o.type === "item.updated" && (o.item?.type === "agent_message" || o.item?.item_type === "assistant_message") && typeof o.item.text === "string" && o.item.text.startsWith(partial) && o.item.text.length > partial.length) {
        yield { kind: "text", text: (!partial && parts.length ? "\n\n" : "") + o.item.text.slice(partial.length) };
        partial = o.item.text;
      } else if (o.type === "item.completed" && (o.item?.type === "agent_message" || o.item?.item_type === "assistant_message") && typeof o.item.text === "string") {
        parts.push(o.item.text);
        const rest = partial && o.item.text.startsWith(partial) ? o.item.text.slice(partial.length) : (parts.length > 1 ? "\n\n" : "") + o.item.text;
        partial = "";
        if (rest) yield { kind: "text", text: rest };
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
const AGY_TICK_MS = Number(process.env.SYNCHRO_AGY_TICK_MS) || 15_000;
// Bật tìm web (Cài đặt / nút tìm web): cho phép thêm công cụ tìm web của chính agy (search_web — chỉ gọi dịch vụ tìm kiếm của Google,
// không đụng tới máy chủ). Công cụ đọc tệp / chạy lệnh / đọc URL bất kỳ của agy vẫn bị chặn: chúng chạy trên máy chủ bằng user của
// engine, đọc được thư mục đăng nhập của tài khoản khác và địa chỉ nội bộ.
const AGY_HOOK = (web?: boolean) => JSON.stringify({ "synchro-bridge": { PreToolUse: [{ matcher: `mcp_synchro_.*|CallMcpTool${web ? "|search_web|web_search" : ""}`, hooks: [{ type: "command", command: "cat >/dev/null; printf '{\"decision\":\"allow\"}'", timeout: 10 }] }] } });
/** Công cụ agy tự từ chối trong lượt (đọc nhật ký của lượt bằng chính user của engine, rồi xóa nhật ký). */
export async function agyDenied(req: Pick<TurnRequest, "env" | "workdir">, log: string): Promise<string[]> {
  const sh = spawnCli("/bin/sh", ["-c", 'grep -o "soft-denying tool confirmation \\"[A-Za-z_]*\\"" "$1" 2>/dev/null; rm -f "$1"', "sh", log], { env: req.env, cwd: path.dirname(log) });
  let out = "";
  for await (const l of sh.lines) out += l + "\n";
  await sh.done;
  return [...new Set([...out.matchAll(/"([A-Za-z_]+)"/g)].map((m) => m[1]))];
}
async function agyRun(args: string[], req: TurnRequest) {
  // Lệnh ngắn (thêm / gỡ cầu nối): treo thì không được giữ khóa của tài khoản lâu hơn chừng này.
  const p = await start("agy", args, { ...req, signal: undefined }, "", 60_000);
  if (!p) return false;
  for await (const _ of p.lines) { /* bỏ qua */ }
  return (await p.done).code === 0;
}
// Ghi hook bằng đúng user của engine (thư mục đăng nhập 0700 của user đó).
const agyPutHook = (req: TurnRequest, text: string) => spawnCli("/bin/sh", ["-c", 'mkdir -p "$HOME/.gemini/config" && cat > "$HOME/.gemini/config/hooks.json.tmp" && mv "$HOME/.gemini/config/hooks.json.tmp" "$HOME/.gemini/config/hooks.json"'], { env: req.env, cwd: req.workdir, stdin: text }).done.then((e) => e.code === 0);
async function agyBridge(req: TurnRequest, url: string) {
  if (!(await agyRun(["mcp", "add", "synchro", url], req))) return false;
  return agyPutHook(req, AGY_HOOK(req.web));
}
/** Cầu nối còn trong cấu hình chung không. `agy mcp remove` trả mã lỗi cả khi vốn không có cầu nối nên phải đọc tệp; không đọc được thì coi như còn. grep: 1 không thấy, 2 không có tệp. */
const agyHasBridge = (req: TurnRequest) => spawnCli("/bin/sh", ["-c", 'grep -q "\\"synchro\\"" "$HOME/.gemini/config/mcp_config.json" 2>/dev/null'], { env: req.env, cwd: req.workdir, stdin: "", timeoutMs: 20_000 }).done.then((e) => e.code !== 1 && e.code !== 2);
/** Gỡ hook khỏi cấu hình chung; trả nội dung cũ ("" nếu không có), null nếu không gỡ được. */
async function agyTakeHook(req: TurnRequest): Promise<string | null> {
  const sh = spawnCli("/bin/sh", ["-c", 'f="$HOME/.gemini/config/hooks.json"; [ -e "$f" ] || exit 0; cat "$f" && rm -f "$f"'], { env: req.env, cwd: req.workdir, stdin: "", timeoutMs: 20_000 });
  let out = "";
  for await (const l of sh.lines) out += l + "\n";
  return (await sh.done).code === 0 ? out : null;
}

// Cầu nối của các lượt Antigravity còn đang chạy, kể cả lượt đã nhả khóa (địa chỉ → HOME của tài khoản), để lượt tạo ảnh trả lại đúng thứ nó tạm gỡ.
const agyLive = new Map<string, string>();
/**
 * Lượt tạo ảnh chạy agy với cùng HOME mà không được có quyền của lượt chat: agy chỉ đọc cầu nối và hook từ cấu hình chung, cầu nối của một lượt chat đang mở nằm sẵn ở đó (model có thể gọi lại
 * chính generate_image hay công cụ của lượt kia, câu lệnh lại có thể do trang web độc viết ra), hook của lượt chat trước vẫn cho phép search_web dù lượt này tắt tìm web.
 * Giữ khóa tài khoản rồi gỡ cả hai, giống trạng thái đã đo agy tạo được ảnh; không gỡ được thì không chạy. Lượt đang chạy đã đọc cấu hình nên không ảnh hưởng; xong thì trả lại phòng khi CLI đọc lại,
 * không còn lượt chat nào thì thôi, lượt chat sau tự ghi lại đúng quyền của nó.
 * Trả về hàm nhả; null khi không chờ được khóa hay không gỡ được (đã báo lỗi qua sự kiện).
 */
export async function* agyQuiet(req: TurnRequest): AsyncGenerator<Event, (() => Promise<void>) | null, unknown> {
  const account = String(req.env?.HOME ?? "");
  const free = yield* turnLock(agyLocks, account, req, "Antigravity");
  if (!free) return null;
  const home = ownerKey("agy", account), prev = configOwner.get(home);
  configOwner.delete(home);
  await agyRun(["mcp", "remove", "synchro"], req).catch(() => false);
  const stuck = await agyHasBridge(req).catch(() => true);
  const hooks = stuck ? null : await agyTakeHook(req).catch(() => null);
  const back = async () => {
    if (hooks && [...agyLive.values()].includes(account)) await agyPutHook(req, hooks).catch(() => false);
    if (prev && agyLive.has(prev) && !configOwner.has(home) && await agyRun(["mcp", "add", "synchro", prev], req).catch(() => false)) configOwner.set(home, prev);
    free();
  };
  if (hooks !== null) return back;
  if (stuck) { if (prev) configOwner.set(home, prev); free(); } else await back();
  yield err("Chưa tách được lượt tạo ảnh khỏi công cụ của lượt chat đang mở nên chưa chạy.", "busy");
  return null;
}

// Lượt tạo ảnh của Grok tìm ảnh bằng cách quét tệp mới trong thư mục đăng nhập (chưa biết Grok lưu ở đâu): chạy song song thì lượt này lấy nhầm ảnh của lượt kia. Khóa riêng cho ảnh:
// lượt chat của Grok không có image_gen nên không cần chờ nó.
const grokImgLocks = new Map<string, Slot>();
export const grokImageLock = (req: TurnRequest) => turnLock(grokImgLocks, String(req.env?.HOME ?? ""), req, "Grok");

// Antigravity không có định dạng trả chữ dần (--output-format json in một object khi xong). Câu dài hiện từng phần thật nhanh (tối đa 2 giây) để đọc giống các model khác và Dừng còn ý nghĩa.
// Làm sạch đường dẫn máy chủ trước khi cắt: đường dẫn bị cắt ngang hai đoạn thì làm sạch từng đoạn không bắt được. false: người dùng bấm Dừng giữa chừng.
export const REVEAL = { min: 240, tick: 30, maxMs: 2000, perSec: 1500 };
async function* revealText(raw: string, signal?: AbortSignal): AsyncGenerator<Event, boolean, unknown> {
  const text = scrubServerPaths(raw);
  if (text.length <= REVEAL.min) { yield { kind: "text", text }; return true; }
  const steps = Math.max(2, Math.ceil(Math.min(REVEAL.maxMs, (text.length / REVEAL.perSec) * 1000) / REVEAL.tick));
  const size = Math.ceil(text.length / steps);
  for (let i = 0; i < text.length;) {
    if (signal?.aborted) return false;
    let j = Math.min(text.length, i + size);
    // Không cắt giữa một ký tự ngoài BMP (emoji).
    if (j < text.length && /[\uD800-\uDBFF]/.test(text[j - 1])) j++;
    yield { kind: "text", text: text.slice(i, j) };
    i = j;
    if (i < text.length) await new Promise((ok) => setTimeout(ok, REVEAL.tick));
  }
  return true;
}
/** HOME riêng của lượt (turnhome.ts); null: tắt hoặc dựng lỗi (đã ghi nhật ký), lượt chạy theo cách cũ. */
async function turnHome(cli: "agy" | "grok", req: TurnRequest, own: Parameters<typeof openTurnHome>[2]): Promise<TurnHome | null> {
  if (!turnHomeOn() || !req.env?.HOME) return null;
  const t0 = Date.now();
  try {
    const h = await openTurnHome(cli, req, own);
    console.log(`[timing] turnhome ${cli} open=${Date.now() - t0} copied=${h.info.copied} linked=${h.info.linked}`);
    return h;
  } catch (e) {
    console.warn(`[turnhome] ${cli}: không dựng được HOME riêng của lượt, dùng cấu hình chung và khóa tài khoản: ${redact((e as Error).message).slice(0, 200)}`);
    return null;
  }
}

export class AntigravityEngine implements Engine {
  readonly id = "agy";
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    if (!req.mcp) { yield* this.turn(req); return; }
    // Cầu nối và hook chỉ nằm trong HOME riêng của lượt: không xếp hàng sau lượt khác của tài khoản, không gỡ gì của ai khi xong.
    const th = await turnHome("agy", req, {
      ".gemini/config/mcp_config.json": { mode: "json-mcp", name: "synchro", entry: { disabled: false, serverUrl: req.mcp.url } },
      ".gemini/config/hooks.json": { mode: "write", text: AGY_HOOK(req.web) },
    });
    if (th) {
      try { yield { kind: "status" }; yield* this.turn({ ...req, env: th.env }); }
      finally { void th.close(); }
      return;
    }
    yield* this.shared(req);
  }
  /** Cách cũ: cầu nối trong cấu hình chung của tài khoản, các lượt có công cụ chạy lần lượt. */
  private async *shared(req: TurnRequest): AsyncIterable<Event> {
    if (!req.mcp) return;
    const free = yield* turnLock(agyLocks, String(req.env?.HOME ?? ""), req, "Antigravity");
    if (!free) return;
    const home = ownerKey("agy", String(req.env?.HOME ?? "")), url = req.mcp.url;
    req.mcp.onPark?.(free);
    agyLive.set(url, String(req.env?.HOME ?? ""));
    try {
      // Cầu nối của lượt trước (đang chờ duyệt, hoặc bị dừng giữa chừng) bị thay bằng cầu nối mới.
      await agyRun(["mcp", "remove", "synchro"], req).catch(() => false);
      configOwner.set(home, url);
      const ok = await agyBridge(req, url).catch(() => false);
      // Không lắp được: báo lỗi để Tự động chuyển model, đừng chạy tiếp (prompt vẫn hứa load_skill, run_code nên model không làm được việc hoặc nói đã làm).
      if (!ok) { yield bridgeFailed("Antigravity"); return; }
      // Lắp cầu nối xong mới là lúc model bắt đầu: bộ canh tính từ đây.
      yield { kind: "status" };
      yield* this.turn(req);
    } finally {
      agyLive.delete(url);
      if (configOwner.get(home) === url) { configOwner.delete(home); await agyRun(["mcp", "remove", "synchro"], req).catch(() => false); }
      free();
    }
  }
  private async *turn(req: TurnRequest): AsyncIterable<Event> {
    // Print mode của agy chỉ nhận chữ: tệp gửi kèm đã lưu trong thư mục làm việc, model mở bằng công cụ xem tệp (đọc được ảnh, PDF).
    const files = fileList(req.attachments ?? [], "Hãy mở từng tệp bằng công cụ xem tệp để thấy đúng nội dung (ảnh, PDF) trước khi trả lời; không đoán nội dung tệp.");
    // Print mode của agy chỉ nhận prompt qua tham số -p: quá 128 KB thì lược phần đầu lịch sử (giữ hướng dẫn hệ thống và tin mới nhất).
    const sysHead = req.sessionId ? req.sysUpdate : req.system;
    const sys = sysHead ? `${sysHead}\n\n---\n\n` : "";
    const body = req.prompt + files;
    const prompt = !tooLong(sys + body) ? sys + body
      : tooLong(sys) ? fitTail(sys + body, ARG_MAX_BYTES) : sys + fitTail(body, ARG_MAX_BYTES - Buffer.byteLength(sys, "utf8"));
    // Bị lược bớt thì nói cho người dùng biết, đừng để họ tưởng model còn nhớ đủ.
    if (prompt.length < sys.length + body.length) yield { kind: "status", text: "Đoạn chat quá dài cho Antigravity: model chỉ đọc phần gần nhất của lịch sử" };
    const args = ["--output-format", "json"];
    if (req.model) args.push("--model", req.model);
    const ce = cliEffort(req.effort);
    if (ce) args.push("--effort", ce);
    if (req.sessionId) args.push("--conversation", req.sessionId);
    // Lượt có công cụ: nhật ký riêng của lượt để biết agy có tự từ chối công cụ nào không (khi đó lượt dừng sau câu dẫn đầu tiên).
    const log = req.mcp ? path.join(req.workdir ?? path.join(engineHome(), "work"), `.synchro-agy-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.log`) : "";
    if (log) args.push("--log-file", log);
    args.push("-p", prompt);
    const p = await start("agy", args, req, "");
    if (!p) { yield notInstalled("agy"); return; }
    // Print mode không có sự kiện giữa chừng: nói trước để người dùng không tưởng là treo.
    yield { kind: "status", text: "Antigravity đang viết, chữ sẽ hiện một lần khi xong (thường 5 đến 10 giây)" };
    // agy in một object JSON duy nhất khi xong lượt (có thể trải nhiều dòng).
    // Không có chữ dần, không có sự kiện: ít nhất nói đã chờ bao lâu. Đang chạy công cụ thì nhật ký làm việc đã nói rồi.
    let out = "";
    const it = p.lines[Symbol.asyncIterator](), T0 = Date.now();
    for (let nx = it.next(); ;) {
      let tk: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([nx, new Promise<null>((ok) => { tk = setTimeout(() => ok(null), AGY_TICK_MS); })]);
      clearTimeout(tk);
      if (r === null) {
        if (Date.now() - (req.alive?.() ?? 0) > AGY_TICK_MS) yield { kind: "status", tick: true, text: `Antigravity vẫn đang viết, đã ${Math.round((Date.now() - T0) / 1000)} giây` };
        continue;
      }
      if (r.done) break;
      out += r.value + "\n";
      nx = it.next();
    }
    const e = await p.done;
    let o: Json | null = null;
    const t = out.trim();
    try { o = JSON.parse(t.slice(t.indexOf("{"))) as Json; } catch {}
    // Lượt bị dừng hoặc CLI không in gì: nhật ký của lượt không còn ai đọc, xóa để khỏi đọng tệp trong thư mục làm việc.
    if (!o) { if (log) await rmEngineFile(req, log).catch(() => {}); yield exitError("agy", p, e); return; }
    if (typeof o.conversation_id === "string" && o.conversation_id) { if (req.env?.HOME) sessionSeen(turnHomeBase(req.env.HOME), o.conversation_id); yield { kind: "session", id: o.conversation_id }; }
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
    if (text && !(yield* revealText(text, req.signal))) { yield err("Đã dừng.", "aborted"); return; }
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
export const GROK_DENY = ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch"];
async function grokRun(args: string[], req: TurnRequest) {
  const p = await start("grok", args, { ...req, signal: undefined }, "", 60_000);
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
    // HOME riêng của lượt: config.toml của tài khoản (bỏ cầu nối cũ) rồi `grok mcp add` ghi cầu nối của lượt vào đó, đúng định dạng của Grok.
    const th = await turnHome("grok", req, { ".grok/config.toml": { mode: "toml-drop", name: "synchro" } });
    if (th) {
      let ran = false;
      try {
        const treq = { ...req, env: th.env };
        if (await grokRun(["mcp", "add", "--transport", "http", "synchro", req.mcp.url], treq).catch(() => false)) {
          ran = true;
          yield { kind: "status" };
          yield* this.turn(treq);
        } else console.warn("[turnhome] grok: lắp cầu nối vào HOME riêng không được, thử cách cũ");
      } finally { void th.close(); }
      if (ran) return;
    }
    yield* this.shared(req);
  }
  private async *shared(req: TurnRequest): AsyncIterable<Event> {
    if (!req.mcp) return;
    const free = yield* turnLock(grokLocks, String(req.env?.HOME ?? ""), req, "Grok");
    if (!free) return;
    const home = ownerKey("grok", String(req.env?.HOME ?? "")), url = req.mcp.url;
    req.mcp.onPark?.(free);
    try {
      // Cầu nối của lượt trước (nếu lượt đó bị dừng giữa chừng, hay đang chờ duyệt) bị thay bằng cầu nối mới.
      await grokRun(["mcp", "remove", "synchro"], req).catch(() => false);
      configOwner.set(home, url);
      const ok = await grokRun(["mcp", "add", "--transport", "http", "synchro", url], req).catch(() => false);
      if (!ok) { yield bridgeFailed("Grok"); return; }
      yield { kind: "status" };
      yield* this.turn(req);
    } finally {
      if (configOwner.get(home) === url) { configOwner.delete(home); await grokRun(["mcp", "remove", "synchro"], req).catch(() => false); }
      free();
    }
  }
  private async *turn(req: TurnRequest, retried = false): AsyncIterable<Event> {
    const cwd = req.workdir ?? path.join(engineHome(), "work");
    await makeDir(cwd);
    const atts = (req.attachments ?? []).filter((a) => a.path);
    const refs = atts.flatMap((a) => [a.path!, ...(a.pages ?? []).map((x) => x.path).filter((x): x is string => !!x)]).map((f) => `@${path.relative(cwd, f)}`);
    // Hướng dẫn hệ thống rất dài (nhiều skill, connector) không vừa một tham số dòng lệnh (giới hạn 128 KB): đưa vào đầu tệp prompt.
    const longSys = tooLong(req.system);
    const prompt = (longSys ? `<system_instructions>\n${req.system}\n</system_instructions>\n\n` : "") + req.prompt
      + (refs.length ? `\n\n<attachments>\nNgười dùng gửi kèm các tệp dưới đây (đúng thứ tự [Ảnh / Tệp đính kèm n] ở trên): ${refs.join(" ")}\n</attachments>` : "");
    const file = path.join(cwd, `.synchro-grok-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.txt`);
    try { await writeEngineFile(file, Buffer.from(prompt, "utf8")); }
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
    const p = await start("grok", args, req, "");
    if (!p) { await rmEngineFile(req, file).catch(() => {}); yield notInstalled("grok"); return; }
    // Có dùng công cụ: phần chữ trước công cụ là lời dẫn (đã hiện trong nhật ký làm việc), câu trả lời là đoạn sau công cụ cuối cùng.
    let all = "", seg = "", tools = false, done = false, lastErr = "";
    const webCalls = new Set<string>();
    for await (const o of objects(p)) {
      // Grok không có sự kiện khởi động: mọi sự kiện (đang nghĩ, gọi công cụ…) đều là model đang làm việc. Trước đây chỉ chữ mới tính,
      // lượt mở đầu bằng công cụ hay nghĩ lâu bị coi là treo ở giây thứ 60.
      // Trừ available_commands: CLI in ra lúc khởi động rồi có thể thử lại mãi khi hãng trả 429 (gói free), lượt im lặng hàng phút mà Tự động không chuyển model.
      if (o.type !== "error" && o.type !== "available_commands") yield { kind: "activity" };
      // Có chữ mới sau lỗi: CLI đã tự vượt qua lỗi đó, không tính nữa.
      if (o.type === "text" && typeof o.data === "string") { lastErr = ""; all += o.data; seg += o.data; yield { kind: "text", text: o.data }; }
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
        if (typeof o.sessionId === "string" && o.sessionId) { if (req.env?.HOME) sessionSeen(turnHomeBase(req.env.HOME), o.sessionId); yield { kind: "session", id: o.sessionId }; }
        const u = (o.usage ?? {}) as Json;
        yield { kind: "usage", usage: { input: num(u.input_tokens) ?? num(u.prompt_tokens) ?? 0, output: (num(u.output_tokens) ?? num(u.completion_tokens) ?? 0) + (num(u.reasoning_tokens) ?? 0), cacheRead: num(u.cache_read_input_tokens) ?? num(u.cached_tokens), cacheWrite: num(u.cache_creation_input_tokens), costUsd: num(o.total_cost_usd) } };
        // Lỗi là điều cuối cùng CLI nói, kể cả khi đã có chữ: câu trả lời bị cắt ngang, không được hiện như đã xong và không được tính là lượt tốt (Tự động còn chuyển model được).
        if (lastErr) { yield err(lastErr, classify(lastErr)); break; }
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
