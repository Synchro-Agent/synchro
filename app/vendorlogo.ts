// Logo của model và nhà cung cấp (dùng chung cho trình duyệt, máy chủ và kiểm thử): mọi model đều có logo, kể cả model của gói subscription,
// nhà cung cấp tương thích OpenAI tự thêm và model sổ model tự dò sau này. Thứ tự: dòng model nhận ra từ mã (claude, gpt, gemini, llama, qwen…),
// rồi loại nhà cung cấp tích hợp sẵn, rồi tên miền API đã biết (openrouter.ai, api.groq.com…), rồi biểu tượng trang của tên miền API
// (tải hộ qua /api/favicon?p=<mã nhà cung cấp>, trình duyệt không thấy địa chỉ API), cuối cùng là chữ cái đầu.
// Ảnh nằm ở public/logos (giấy phép ghi trong public/logos/README.md); Claude, OpenAI, Gemini, Grok, DeepSeek, ElevenLabs vẽ trong ui/brands.tsx.

/** Logo vẽ sẵn trong ui/brands.tsx. */
export const INLINE_LOGOS = ["anthropic", "openai", "google", "xai", "deepseek", "elevenlabs"] as const;
/** Logo tệp trong public/logos: "img" giữ màu thương hiệu (hiện đúng cả nền sáng lẫn tối), "mask" tô bằng color (không có thì currentColor, đổi theo giao diện). */
export const FILE_LOGOS: Record<string, { mode: "img" | "mask"; color?: string; src?: string }> = {
  meta: { mode: "mask", color: "#0467DF" }, mistral: { mode: "mask", color: "#FA520F" }, qwen: { mode: "mask", color: "#6950EF" }, moonshot: { mode: "mask" },
  perplexity: { mode: "mask", color: "#1FB8CD" }, nvidia: { mode: "mask", color: "#76B900" }, openrouter: { mode: "mask" }, ollama: { mode: "mask" },
  replicate: { mode: "mask" }, lmstudio: { mode: "mask" }, vllm: { mode: "mask", color: "#30A2FF" }, cloudflare: { mode: "mask", color: "#F38020" },
  gemma: { mode: "img" }, microsoft: { mode: "img" }, zhipu: { mode: "img" }, cohere: { mode: "img" }, together: { mode: "img" }, fireworks: { mode: "img" },
  stepfun: { mode: "img" }, doubao: { mode: "img" }, hunyuan: { mode: "img" }, baichuan: { mode: "img" }, deepinfra: { mode: "img" }, sambanova: { mode: "img" },
  ai2: { mode: "img" }, internlm: { mode: "img" }, wenxin: { mode: "img" }, spark: { mode: "img" }, upstage: { mode: "img" }, minimax: { mode: "img" },
  huggingface: { mode: "img" }, novita: { mode: "img" }, siliconcloud: { mode: "img" }, hyperbolic: { mode: "img" }, xinference: { mode: "img" },
  groq: { mode: "mask" }, ai21: { mode: "mask" }, ibm: { mode: "mask" }, inflection: { mode: "mask" }, reka: { mode: "mask" }, liquid: { mode: "mask" },
  lambda: { mode: "mask" }, nebius: { mode: "mask" }, cerebras: { mode: "mask" }, yi: { mode: "mask" },
  composio: { mode: "mask", src: "/connectors/composio.svg" },
  synchro: { mode: "img", src: "/brand/synchro-mark-small-adaptive.svg" },
};
/** Logo tệp đã khai báo (Object.hasOwn: "constructor", "__proto__"… không được tính là logo). */
export const isFileLogo = (id: string) => Object.hasOwn(FILE_LOGOS, id);
export const logoSrc = (id: string) => (isFileLogo(id) ? FILE_LOGOS[id].src : undefined) ?? `/logos/${id}.svg`;
export const isLogoId = (id: string) => (INLINE_LOGOS as readonly string[]).includes(id) || isFileLogo(id);

/** Logo đã quyết định: id (logo có sẵn), site (biểu tượng trang của nhà cung cấp qua /api/favicon), hoặc chữ cái đầu. */
export type LogoPick = { id: string } | { site: string; mono: string } | { mono: string };

// Dòng model nhận ra từ mã model (cả mã kèm tên hãng như "meta-llama/llama-4-scout", "accounts/fireworks/models/qwen3…").
// Xếp từ cụ thể tới chung: gemma trước gemini/google, codestral trước code…
const FAMILIES: [RegExp, string][] = [
  [/claude|anthropic|(^|[^a-z])(opus|sonnet|haiku|fable)([^a-z]|$)/, "anthropic"],
  [/gemma/, "gemma"],
  [/gemini|(^|[^a-z])(google|palm|bison|learnlm|imagen|veo)([^a-z]|$)/, "google"],
  [/(^|[^a-z])(gpt|chatgpt|codex|openai|dall-e|whisper|sora|davinci|babbage)|(^|[^a-z0-9])o[1-9]([^a-z0-9]|$)/, "openai"],
  [/grok|x-ai|(^|[^a-z])xai([^a-z]|$)/, "xai"],
  [/deepseek/, "deepseek"],
  // Nemotron của NVIDIA dựng trên Llama: xét trước Llama.
  [/nemotron|nvidia/, "nvidia"],
  [/llama|(^|[^a-z])meta([^a-z]|$)|meta-/, "meta"],
  [/qwen|qwq|qvq|tongyi|alibaba|dashscope/, "qwen"],
  [/mistral|mixtral|codestral|pixtral|ministral|magistral|devstral|voxtral/, "mistral"],
  [/(^|[^a-z])phi-?\d|microsoft|wizardlm|mai-ds/, "microsoft"],
  [/kimi|moonshot/, "moonshot"],
  [/(^|[^a-z])(glm|chatglm|cogview|codegeex)|zhipu|z-ai|thudm/, "zhipu"],
  [/cohere|command-r|command-a|(^|[^a-z])aya([^a-z]|$)|c4ai/, "cohere"],
  [/sonar|perplexity|pplx/, "perplexity"],
  [/minimax|(^|[^a-z])abab/, "minimax"],
  [/jamba|ai21/, "ai21"],
  [/granite|(^|[^a-z])ibm([^a-z]|$)/, "ibm"],
  [/(^|[^a-z])yi-|01-ai/, "yi"],
  [/doubao|bytedance|seed-?oss|(^|[^a-z])seed-\d/, "doubao"],
  [/hunyuan|tencent/, "hunyuan"],
  [/baichuan/, "baichuan"],
  [/step-\d|stepfun/, "stepfun"],
  [/ernie|wenxin|baidu/, "wenxin"],
  [/internlm|intern-s1/, "internlm"],
  [/olmo|allenai|(^|[^a-z])tulu/, "ai2"],
  [/solar|upstage/, "upstage"],
  [/reka-/, "reka"],
  [/(^|[^a-z])lfm-?\d|liquid/, "liquid"],
  [/inflection|(^|[^a-z])pi-\d/, "inflection"],
  [/(^|[^a-z])spark|iflytek/, "spark"],
];
/** Hãng của một mã model theo dòng model, hoặc null khi không nhận ra. */
export function familyOf(id: string): string | null {
  const s = id.toLowerCase();
  for (const [re, v] of FAMILIES) if (re.test(s)) return v;
  return null;
}

// Tên miền API của các hãng / nền tảng chạy model đã biết.
const HOSTS: [RegExp, string][] = [
  [/(^|\.)anthropic\.com$|(^|\.)claude\.(ai|com)$/, "anthropic"], [/(^|\.)openai\.(com|azure\.com)$/, "openai"], [/(^|\.)googleapis\.com$|(^|\.)google\.com$/, "google"],
  [/(^|\.)x\.ai$/, "xai"], [/(^|\.)deepseek\.com$/, "deepseek"], [/(^|\.)openrouter\.ai$/, "openrouter"], [/(^|\.)groq\.com$/, "groq"],
  [/(^|\.)together\.(xyz|ai)$/, "together"], [/(^|\.)fireworks\.ai$/, "fireworks"], [/(^|\.)mistral\.ai$/, "mistral"], [/(^|\.)aliyuncs\.com$|(^|\.)alibabacloud\.com$/, "qwen"],
  [/(^|\.)moonshot\.(ai|cn)$/, "moonshot"], [/(^|\.)bigmodel\.cn$|(^|\.)z\.ai$/, "zhipu"], [/(^|\.)cohere\.(com|ai)$/, "cohere"], [/(^|\.)perplexity\.ai$/, "perplexity"],
  [/(^|\.)nvidia\.com$/, "nvidia"], [/(^|\.)minimax(i)?\.(io|chat|com)$|(^|\.)minimaxi\.com$/, "minimax"], [/(^|\.)huggingface\.co$|(^|\.)hf\.space$/, "huggingface"],
  [/(^|\.)deepinfra\.com$/, "deepinfra"], [/(^|\.)sambanova\.ai$/, "sambanova"], [/(^|\.)cerebras\.ai$/, "cerebras"], [/(^|\.)novita\.ai$/, "novita"],
  [/(^|\.)siliconflow\.(cn|com)$/, "siliconcloud"], [/(^|\.)hyperbolic\.xyz$/, "hyperbolic"], [/(^|\.)nebius\.(com|ai)$/, "nebius"], [/(^|\.)lambda(labs)?\.(ai|com)$/, "lambda"],
  [/(^|\.)cloudflare\.com$/, "cloudflare"], [/(^|\.)replicate\.com$/, "replicate"], [/(^|\.)ai21\.com$/, "ai21"], [/(^|\.)volces\.com$|(^|\.)volcengine\.com$/, "doubao"],
  [/(^|\.)tencent(cloudapi)?\.com$|(^|\.)hunyuan\./, "hunyuan"], [/(^|\.)baichuan-ai\.com$/, "baichuan"], [/(^|\.)stepfun\.com$/, "stepfun"], [/(^|\.)baidubce\.com$|(^|\.)baidu\.com$/, "wenxin"],
  [/(^|\.)upstage\.ai$/, "upstage"], [/(^|\.)lingyiwanwu\.com$|(^|\.)01\.ai$/, "yi"], [/(^|\.)elevenlabs\.io$/, "elevenlabs"], [/(^|\.)composio\.dev$/, "composio"],
];
/** Hãng theo tên miền API (api.groq.com → groq), null khi không biết. Cổng 11434 là Ollama, 1234 là LM Studio (chạy trên máy). */
export function hostLogo(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  const [name, port] = h.split(/:(?=\d+$)/);
  for (const [re, v] of HOSTS) if (re.test(name)) return v;
  if (port === "11434" || /(^|\.)ollama/.test(name)) return "ollama";
  if (port === "1234" || /lmstudio/.test(name)) return "lmstudio";
  if (/vllm/.test(name)) return "vllm";
  return null;
}

// Loại nhà cung cấp tích hợp sẵn → logo (mock: bản giả lập của Synchro).
const KIND: Record<string, string> = { anthropic: "anthropic", openai: "openai", google: "google", xai: "xai", deepseek: "deepseek", elevenlabs: "elevenlabs", composio: "composio", replicate: "replicate", mock: "synchro" };
// Gói subscription: "sub-claude/…" là Claude…
const SUB: Record<string, string> = { "sub-claude": "anthropic", "sub-codex": "openai", "sub-agy": "google", "sub-grok": "xai" };

const NAMES: [RegExp, string][] = [[/openrouter/, "openrouter"], [/groq/, "groq"], [/together/, "together"], [/fireworks/, "fireworks"], [/ollama/, "ollama"],
  [/lm ?studio/, "lmstudio"], [/vllm/, "vllm"], [/hugging ?face/, "huggingface"], [/deepinfra/, "deepinfra"], [/sambanova/, "sambanova"], [/cerebras/, "cerebras"],
  [/novita/, "novita"], [/silicon ?(flow|cloud)/, "siliconcloud"], [/hyperbolic/, "hyperbolic"], [/nebius/, "nebius"], [/lambda/, "lambda"], [/cloudflare|workers ai/, "cloudflare"],
  [/azure/, "microsoft"], [/vertex/, "google"], [/xinference/, "xinference"]];
const nameLogo = (name: string) => { const s = name.toLowerCase(); for (const [re, v] of NAMES) if (re.test(s)) return v; return familyOf(s); };

/** Chữ cái đầu cho ô chữ (bỏ tiền tố "Claude ", "c-"…, lấy chữ cái hoặc số đầu tiên). */
export const monoOf = (name: string) => (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase();

/** Gợi ý logo của nhà cung cấp do máy chủ tính (catalog → ProviderInfo.logo): id logo, "site" (có biểu tượng trang qua /api/favicon?p=…), hoặc không có. */
export type ProviderHint = { id: string; kind?: string; name?: string; logo?: string; models?: { id: string }[] };

/** Logo của một nhà cung cấp (dòng hãng trong bộ chọn model, thẻ Providers). */
export function providerLogo(p: ProviderHint): LogoPick {
  const sub = Object.hasOwn(SUB, p.id) ? SUB[p.id] : undefined;
  if (sub) return { id: sub };
  if (p.kind && p.kind !== "compatible" && Object.hasOwn(KIND, p.kind)) return { id: KIND[p.kind] };
  if (p.logo && p.logo !== "site" && isLogoId(p.logo)) return { id: p.logo };
  // Nhà cung cấp chỉ chạy một dòng model (máy chủ Llama riêng, khóa Mistral qua địa chỉ tương thích…): logo của dòng đó.
  const fams = new Set((p.models ?? []).map((m) => familyOf(m.id)));
  if (fams.size === 1) { const f = [...fams][0]; if (f) return { id: f }; }
  // Tên quản trị viên đặt cho nhà cung cấp ("OpenRouter", "Groq", "Ollama trên máy"): nhận ra hãng theo tên.
  const fromName = nameLogo(p.name ?? "");
  if (fromName) return { id: fromName };
  const mono = monoOf(p.name ?? p.id);
  return p.logo === "site" ? { site: `/api/favicon?p=${encodeURIComponent(p.id)}`, mono } : { mono };
}

/** Logo của một model: dòng model trước (model Llama qua OpenRouter vẫn là Meta), không nhận ra thì logo của nhà cung cấp. */
export function modelLogo(key: string, p?: ProviderHint | null, name?: string): LogoPick {
  const i = key.indexOf("/");
  const prov = i < 0 ? "" : key.slice(0, i), id = i < 0 ? key : key.slice(i + 1);
  const sub = Object.hasOwn(SUB, prov) ? SUB[prov] : undefined;
  if (sub) return { id: sub };
  const fam = familyOf(id) ?? (name ? familyOf(name) : null);
  if (fam) return { id: fam };
  if (p) return providerLogo(p);
  if (Object.hasOwn(KIND, prov)) return { id: KIND[prov] };
  return { mono: monoOf(name || id) };
}
