// Logo của mọi model và mọi connector: model nào (gói subscription, khóa API, nhà cung cấp tương thích OpenAI, model sổ model tự dò sau này)
// cũng ra logo của hãng khi hãng nhận ra được; connector nào (danh mục cũ, Composio, ứng dụng trong Composio, MCP tự thêm) cũng có logo hoặc
// biểu tượng trang qua /api/favicon, chỉ còn chữ cái đầu khi thật sự không biết gì. Tệp logo phải có thật và không chứa script.
// Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 800)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-logos-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "logos-test-key";
delete process.env.FAVICON_BASE;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { vendorlogo: V, connlogos: CL, connectordir: CD, iconproxy: IP } = await loadTs(["vendorlogo", "connlogos", "connectordir", "iconproxy"]);
const pub = (p) => path.join(process.cwd(), "public", p.replace(/^\//, ""));
const real = (id) => (V.INLINE_LOGOS.includes(id) ? true : id in V.FILE_LOGOS && fs.existsSync(pub(V.logoSrc(id))));
const idOf = (pick) => ("id" in pick ? pick.id : null);

console.log("1. Mọi model của API giả lập (đúng danh sách các hãng trả về) có logo của hãng");
const src = fs.readFileSync(path.join(process.cwd(), "scripts", "mock-providers.mjs"), "utf8");
const arr = (name) => Function(`return ${new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);\\n`).exec(src)[1]}`)();
const lists = {
  anthropic: arr("ANTHROPIC").map((x) => x[0]), openai: arr("OPENAI"), google: arr("GOOGLE").map((x) => x[0]).filter((x) => x.startsWith("gemini")), xai: arr("XAI"), deepseek: arr("DEEPSEEK"),
};
ok(Object.values(lists).every((l) => l.length > 3), "đọc được danh sách model giả lập", JSON.stringify(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]))));
const wrong = [];
for (const [prov, ids] of Object.entries(lists)) for (const id of ids) {
  const k = `${prov}/${id}`, got = idOf(V.modelLogo(k, { id: prov, kind: prov, name: prov }));
  // chat-latest của OpenAI không mang tên dòng: lấy logo theo nhà cung cấp.
  if (got !== prov) wrong.push(`${k} → ${got}`);
}
ok(!wrong.length, "khóa API: Claude / GPT / Gemini / Grok / DeepSeek đúng logo hãng", wrong.join(", "));
const subs = { "sub-claude/opus": "anthropic", "sub-claude/default": "anthropic", "sub-codex/gpt-6.1-sol": "openai", "sub-codex/default": "openai", "sub-agy/gemini-3-pro": "google", "sub-agy/default": "google", "sub-grok/grok-4.7": "xai", "sub-grok/default": "xai" };
const sw = Object.entries(subs).filter(([k, v]) => idOf(V.modelLogo(k, null)) !== v).map(([k]) => k);
ok(!sw.length, "gói subscription (kể cả model mặc định của gói) đúng logo hãng", sw.join(", "));
ok(idOf(V.modelLogo("mock/synchro-mock", { id: "mock", kind: "mock", name: "Synchro (thử nghiệm)" })) === "synchro", "model giả lập: logo Synchro");

console.log("2. Model mở / nhà cung cấp tương thích OpenAI (OpenRouter, Groq, Together…) và model sổ model dò ra sau này");
const OPEN = {
  "meta-llama/llama-4-scout": "meta", "llama-3.3-70b-versatile": "meta", "qwen/qwen3-235b-a22b": "qwen", "Qwen/QwQ-32B": "qwen", "mistralai/mistral-large-2411": "mistral", "codestral-2508": "mistral",
  "google/gemma-3-27b-it": "gemma", "microsoft/phi-4": "microsoft", "moonshotai/kimi-k2-instruct": "moonshot", "z-ai/glm-4.6": "zhipu", "THUDM/chatglm3-6b": "zhipu",
  "cohere/command-a-03-2025": "cohere", "perplexity/sonar-pro": "perplexity", "nvidia/llama-3.1-nemotron-70b": "nvidia", "minimax/minimax-m2": "minimax",
  "ai21/jamba-large-1.7": "ai21", "ibm-granite/granite-4.0": "ibm", "01-ai/yi-large": "yi", "bytedance-seed/seed-oss-36b": "doubao", "tencent/hunyuan-a13b": "hunyuan",
  "baidu/ernie-4.5-300b": "wenxin", "allenai/olmo-2-32b": "ai2", "upstage/solar-pro-2": "upstage", "openai/gpt-oss-120b": "openai", "anthropic/claude-sonnet-4.5": "anthropic",
  "x-ai/grok-4-fast": "xai", "deepseek/deepseek-r1": "deepseek", "google/gemini-2.5-pro": "google", "o3-mini": "openai", "o4-mini-high": "openai",
};
const ow = Object.entries(OPEN).filter(([id, v]) => idOf(V.modelLogo(`c-openrouter/${id}`, { id: "c-openrouter", kind: "compatible", name: "OpenRouter", logo: "openrouter" })) !== v).map(([id, v]) => `${id} → ${idOf(V.modelLogo(`c-openrouter/${id}`, null))} (cần ${v})`);
ok(!ow.length, `${Object.keys(OPEN).length} dòng model mở qua OpenRouter: logo theo dòng model, không phải logo OpenRouter`, ow.join("; "));
ok(!V.familyOf("mosaic-7b") && !V.familyOf("solo-model") && !V.familyOf("phoenix-1") && !V.familyOf("mixedbread-large"), "không nhận nhầm (mosaic, solo, phoenix, mixedbread không phải o1 / Phi / Mistral)",
  ["mosaic-7b", "solo-model", "phoenix-1", "mixedbread-large"].map((x) => `${x}:${V.familyOf(x)}`).join(" "));
const unk = { id: "c-myhost", kind: "compatible", name: "My host", models: [{ id: "tinymodel-7b" }] };
ok(idOf(V.modelLogo("c-openrouter/acme-unknown-1", { id: "c-openrouter", kind: "compatible", name: "OpenRouter", logo: "openrouter" })) === "openrouter", "model lạ qua OpenRouter: logo OpenRouter");
const st = V.modelLogo("c-acme/acme-unknown-1", { ...unk, id: "c-acme", name: "Acme AI", logo: "site" });
ok("site" in st && st.site === "/api/favicon?p=c-acme" && st.mono === "A", "hãng lạ có tên miền công khai: biểu tượng trang qua /api/favicon?p=… (lỗi thì chữ A)", JSON.stringify(st));
const mono = V.modelLogo("c-myhost/tinymodel-7b", unk);
ok("mono" in mono && !("site" in mono) && mono.mono === "M", "máy chủ riêng không nhận ra: chữ cái đầu", JSON.stringify(mono));
const hosts = { "api.groq.com": "groq", "openrouter.ai": "openrouter", "api.together.xyz": "together", "api.fireworks.ai": "fireworks", "api.mistral.ai": "mistral", "dashscope-intl.aliyuncs.com": "qwen",
  "api.moonshot.ai": "moonshot", "open.bigmodel.cn": "zhipu", "api.deepinfra.com": "deepinfra", "api.cerebras.ai": "cerebras", "localhost:11434": "ollama", "127.0.0.1:1234": "lmstudio", "router.huggingface.co": "huggingface",
  "generativelanguage.googleapis.com": "google", "api.x.ai": "xai", "api.perplexity.ai": "perplexity", "integrate.api.nvidia.com": "nvidia", "api.siliconflow.cn": "siliconcloud" };
const hw = Object.entries(hosts).filter(([h, v]) => V.hostLogo(h) !== v).map(([h, v]) => `${h} → ${V.hostLogo(h)} (cần ${v})`);
ok(!hw.length, `${Object.keys(hosts).length} địa chỉ API đã biết → logo hãng`, hw.join("; "));
ok(V.hostLogo("api.example.org") === null && V.hostLogo("evil-openai.com.attacker.net") === null, "tên miền lạ / giả tên hãng không được nhận", V.hostLogo("evil-openai.com.attacker.net"));
ok(idOf(V.providerLogo({ id: "c-x", kind: "compatible", name: "Groq Cloud" })) === "groq" && idOf(V.providerLogo({ id: "c-y", kind: "compatible", name: "Ollama trên máy" })) === "ollama", "tên nhà cung cấp quản trị viên đặt: nhận ra hãng");
ok(idOf(V.providerLogo({ id: "c-z", kind: "compatible", name: "Nội bộ", models: [{ id: "llama-3.1-8b" }, { id: "llama-3.3-70b" }] })) === "meta", "nhà cung cấp chỉ chạy một dòng model: logo của dòng đó");
for (const k of ["anthropic", "openai", "google", "xai", "deepseek", "elevenlabs", "composio", "replicate", "mock"]) ok(real(idOf(V.providerLogo({ id: k, kind: k, name: k }))), `nhà cung cấp tích hợp sẵn ${k}: có logo`);

ok(!V.isLogoId("constructor") && !V.isLogoId("__proto__") && "mono" in V.providerLogo({ id: "__proto__", kind: "toString", name: "x" }) && "mono" in V.modelLogo("constructor/x", null), "khóa lạ (constructor, __proto__) không bị coi là logo");
console.log("3. Tệp logo: có thật, không có script hay tài nguyên ngoài, có ghi giấy phép");
const used = new Set([...Object.values(OPEN), ...Object.values(hosts), ...Object.keys(V.FILE_LOGOS), ...V.INLINE_LOGOS]);
const missing = [...used].filter((id) => !real(id));
ok(!missing.length, `${used.size} logo đều có tệp hoặc vẽ sẵn`, missing.join(", "));
const svgs = [...fs.readdirSync(pub("logos")).filter((f) => f.endsWith(".svg")).map((f) => pub(`logos/${f}`)), pub("connectors/composio.svg")];
const bad = svgs.filter((f) => /<script|\son\w+\s*=|href\s*=\s*["'](?!#)|<foreignObject|javascript:/i.test(fs.readFileSync(f, "utf8")));
ok(svgs.length > 40 && !bad.length, `${svgs.length} tệp SVG sạch (không script, không liên kết ngoài)`, bad.join(", "));
const readme = fs.readFileSync(pub("logos/README.md"), "utf8");
const unlisted = fs.readdirSync(pub("logos")).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)).filter((n) => !new RegExp(`\\b${n}\\b`).test(readme));
ok(!unlisted.length && /CC0/.test(readme) && /MIT/.test(readme), "README ghi nguồn và giấy phép của từng tệp", unlisted.join(", "));

console.log("4. Connector: danh mục cũ, Composio, ứng dụng trong Composio, MCP tự thêm");
const dirBad = CD.DIRECTORY.filter((d) => d.logo && !fs.existsSync(pub(`connectors/${d.logo}.svg`))).map((d) => d.id);
ok(!dirBad.length, "logo khai báo trong danh mục cũ đều có tệp", dirBad.join(", "));
const dirNone = CD.DIRECTORY.filter((d) => { const l = CL.connLogo({ dirLogo: d.logo, color: d.color, url: d.url }); return !l.logo && !l.site; }).map((d) => d.id);
ok(!dirNone.length, `${CD.DIRECTORY.length} connector danh mục cũ đều có logo (tệp sẵn, hoặc biểu tượng trang như canva.com, monday.com)`, dirNone.join(", "));
const cx = CL.connLogo({ composio: true, color: "#5B4BDB" });
ok(cx.logo === "composio" && fs.existsSync(pub("connectors/composio.svg")), "Composio: logo Composio đóng gói sẵn", JSON.stringify(cx));
ok(CL.connLogo({ dirLogo: "notion", url: "https://mcp.notion.com/mcp" }).logo === "notion", "connector danh mục: logo danh mục");
ok(CL.connLogo({ url: "https://mcp.linear.app/mcp" }).logo === "linear", "MCP tự thêm của hãng đã có logo (mcp.linear.app): dùng tệp có sẵn");
const icon = "data:image/png;base64,iVBORw0KGgo=";
const ci = CL.connLogo({ url: "https://mcp.acme-tools.io/mcp", icon });
ok(ci.icon === icon && ci.site === "/api/favicon?d=acme-tools.io", "MCP tự thêm có icon tự tìm: icon, dự phòng biểu tượng trang", JSON.stringify(ci));
const cs = CL.connLogo({ url: "https://mcp.acme-tools.io/mcp" });
ok(!cs.logo && !cs.icon && cs.site === "/api/favicon?d=acme-tools.io", "MCP tự thêm chưa có icon: biểu tượng trang của tên miền thương hiệu qua proxy", JSON.stringify(cs));
const iss = CL.connLogo({ url: "http://10.0.0.5:8080/mcp", issuer: "https://login.acme-corp.com" });
ok(iss.site === "/api/favicon?d=acme-corp.com", "máy chủ MCP nội bộ: biểu tượng trang của máy chủ đăng nhập OAuth", JSON.stringify(iss));
const none = CL.connLogo({ url: "http://localhost:4111/mcp" });
ok(!none.logo && !none.icon && !none.site, "máy chủ nội bộ không có gì: không hỏi favicon (chữ cái đầu)", JSON.stringify(none));
ok(CL.siteOf("https://169.254.169.254/latest") === undefined && CL.siteOf("http://metadata.google.internal/") === undefined && CL.siteOf("https://foo.local/") === undefined, "không bao giờ đưa IP / tên nội bộ vào proxy favicon");
ok(IP.brandHost("mcp.eu.acme.co.uk") === "acme.co.uk" && IP.brandHost("api.groq.com") === "groq.com", "tên miền thương hiệu (cả đuôi hai cấp)");
const g = CL.appLogo("gmail"), n = CL.appLogo("notion"), hf = CL.appLogo("cohere"), unkApp = CL.appLogo("acmeapp");
ok(g.icon === "/api/favicon?app=gmail" && !g.logo && n.logo === "notion", "ứng dụng Composio: tệp có sẵn, không có thì biểu tượng trang chủ qua /api/favicon?app=…", JSON.stringify([g, n]));
ok(hf.icon === "/logos/cohere.svg" && fs.existsSync(pub(hf.icon)), "ứng dụng có logo hãng chỉ trong public/logos (Cohere): dùng tệp đó", JSON.stringify(hf));
ok(unkApp.icon === "/api/favicon?app=acmeapp" && !unkApp.logo, "ứng dụng chưa có trong bảng: vẫn hỏi proxy (logo chính thức của Composio), proxy trả 404 thì giao diện hiện chữ cái đầu", JSON.stringify(unkApp));
// Không còn khóa dự án Composio dùng chung: logo ứng dụng không được phụ thuộc khóa nào hay API toolkits của Composio.
const route = fs.readFileSync(path.join(process.cwd(), "app", "api", "favicon", "route.ts"), "utf8");
ok(!/composioKey|toolkitLogoUrl|x-api-key|COMPOSIO_API/.test(route) && /logos\.composio\.dev/.test(route) && /APP_SITES/.test(route) && /dflt\.equals/.test(route), "/api/favicon?app=…: logo công khai của Composio (không khóa, bỏ ảnh mặc định của ứng dụng lạ) rồi trang chủ theo bảng");
ok(JSON.stringify(CL.appLogo("../etc/passwd")) === "{}" && JSON.stringify(CL.appLogo("A B")) === "{}", "slug ứng dụng lạ không thành đường dẫn");
ok(CL.composioAppOf({ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: {} }] }) === "gmail" && CL.composioAppOf({ toolkits: ["Slack"] }) === "slack" && CL.composioAppOf({ queries: [] }) === "", "lời gọi Composio → ứng dụng nó dùng (GMAIL_SEND_EMAIL → gmail)");
const sites = Object.entries(CL.APP_SITES).filter(([, h]) => !IP.publicHost(h)).map(([k]) => k);
ok(!sites.length, "trang chủ dự phòng của ứng dụng đều là tên miền công khai hợp lệ", sites.join(", "));

console.log(`\n${pass}/${pass + fail} đạt`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
