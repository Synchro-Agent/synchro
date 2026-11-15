// Engine khóa API (Anthropic, OpenAI, Gemini, xAI, DeepSeek) làm dự phòng cho engine CLI (ADR 0001, bước 6).
// Khóa do quản trị viên nhập ở Cài đặt → Providers, lưu mã hóa trong api_providers và dùng chung cho cả hệ thống.
// FallbackEngine: CLI báo hết hạn mức (quota) trước khi kịp trả chữ nào thì chuyển sang khóa API của cùng hãng.
import "server-only";
import type { Engine, Event, TurnRequest } from "./engine";
import { catalog, mainModels, resolveModel } from "../providers";
import { ALL, splitKey } from "../../shared/catalog";
import { chatOnce, HttpErr } from "../llmcall";
import { classify, redact } from "./errors";
import { engineFor, registerEngine } from "./selector";

export type ApiKind = "anthropic" | "openai" | "google" | "xai" | "deepseek";
/** Hãng của từng CLI: gói Claude → khóa Anthropic, ChatGPT (codex) → OpenAI, Gemini (agy) → Google, Grok → xAI. */
export const API_OF: Record<string, ApiKind> = { claude: "anthropic", codex: "openai", agy: "google", grok: "xai" };

type Opts = {
  maxTokens?: number;
  /** Model API nào được dùng (model quản trị viên cho hiện, quyền của người dùng). */
  allow?: (key: string) => boolean;
  /** Có được chuyển sang khóa API lúc này không (vd. người dùng còn hạn mức chi phí API của Synchro). */
  canFallback?: () => boolean;
};

/** Chọn model API: đúng khóa "hãng/model" nếu có, không thì model cùng tên của hãng đó, không thì model đầu tiên đang hiện của hãng. */
async function pickTarget(kind: ApiKind, wanted: string | undefined, allow: (k: string) => boolean) {
  const provs = (await catalog()).filter((p) => p.kind === kind);
  const main = mainModels(), shown = (k: string) => main.includes(ALL) || main.includes(k);
  const keys = provs.flatMap((p) => p.models.map((m) => m.key)).filter((k) => allow(k));
  const id = wanted ? splitKey(wanted).id || wanted : "";
  const key = keys.find((k) => k === wanted) ?? keys.find((k) => splitKey(k).id === id) ?? keys.find(shown) ?? keys[0];
  return key ? resolveModel(key) : null;
}

/** Chuyển hàm gọi lại (onDelta) thành luồng sự kiện. */
function channel<T>() {
  const q: T[] = [];
  let wake: (() => void) | null = null, closed = false;
  return {
    push: (v: T) => { q.push(v); wake?.(); },
    close: () => { closed = true; wake?.(); },
    async *drain(): AsyncIterable<T> {
      for (;;) {
        while (q.length) yield q.shift()!;
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

export class ApiEngine implements Engine {
  readonly id: string;
  constructor(private kind: ApiKind, private o: Opts = {}) { this.id = `api:${kind}`; }
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    const t = await pickTarget(this.kind, req.model, this.o.allow ?? (() => true));
    if (!t) { yield { kind: "error", message: `Chưa có khóa API ${this.kind} dùng được (quản trị viên thêm ở Cài đặt → Providers).`, code: "other" }; return; }
    const ch = channel<Event>();
    const messages = [...(req.history ?? []), { role: "user", content: req.prompt }];
    const run = chatOnce(t, req.system ?? "", messages, this.o.maxTokens ?? 8000, req.signal, undefined, (d) => ch.push({ kind: "text", text: d }))
      .then((text) => { ch.push({ kind: "final", text, via: `api:${t.provider}` }); })
      .catch((e: unknown) => {
        const m = redact((e as Error).message || "Gọi API không thành công.");
        ch.push(req.signal?.aborted ? { kind: "error", message: "Đã dừng.", code: "aborted" } : { kind: "error", message: m, code: classify(m, e instanceof HttpErr ? e.status : null) });
      })
      .finally(() => ch.close());
    yield* ch.drain();
    await run;
  }
}

type Backup = () => Engine | null | Promise<Engine | null>;

export class FallbackEngine implements Engine {
  readonly id: string;
  /** backup trả null khi không có engine dự phòng dùng được (vd. chưa có khóa API): giữ nguyên lỗi quota của gói. */
  constructor(private primary: Engine, private backup: Backup | null) { this.id = primary.id; }
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    let wrote = false;
    for await (const e of this.primary.runTurn(req)) {
      if (e.kind === "error" && (e.code === "quota" || e.code === "rate") && !wrote) {
        const b = await this.backup?.();
        if (b) {
          // Phiên của CLI không dùng được cho API: engine API nhận lịch sử qua req.history.
          for await (const x of b.runTurn({ ...req, sessionId: undefined })) yield x;
          return;
        }
      }
      if (e.kind === "text" && e.text) wrote = true;
      yield e;
    }
  }
}

/** Engine CLI của gói subscription, tự chuyển sang khóa API cùng hãng khi gói hết hạn mức (nếu quản trị viên đã thêm khóa). */
export function engineWithFallback(cli: string, o: Opts = {}): Engine {
  const kind = API_OF[cli];
  return new FallbackEngine(engineFor(cli), kind ? async () => ((o.canFallback?.() ?? true) && (await pickTarget(kind, undefined, o.allow ?? (() => true))) ? new ApiEngine(kind, o) : null) : null);
}

registerEngine("api:anthropic", () => new ApiEngine("anthropic"));
registerEngine("api:openai", () => new ApiEngine("openai"));
registerEngine("api:google", () => new ApiEngine("google"));
registerEngine("api:xai", () => new ApiEngine("xai"));
registerEngine("api:deepseek", () => new ApiEngine("deepseek"));
