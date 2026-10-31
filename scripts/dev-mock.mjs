// Chạy Synchro ở máy cục bộ với API giả lập của các hãng: không cần khóa thật, không gọi ra Internet.
// Dữ liệu riêng trong data-mock/, bản build riêng trong .next-mock/, nên chạy song song được với npm run dev.
// Dùng: npm run dev:mock   → mở http://localhost:3200 và đăng nhập bằng tài khoản thử nghiệm in ra ở terminal.
// Xóa toàn bộ dữ liệu thử nghiệm: xóa thư mục data-mock/.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MOCK_KEYS, startMock } from "./mock-providers.mjs";
import { startMockMcp } from "./mock-mcp.mjs";
import { startMockWs } from "./mock-workspace.mjs";
import { startMockGithub } from "./mock-github.mjs";
import { writeExtension } from "../extension/build.mjs";

const PORT = Number(process.env.PORT ?? 3200), MOCK_PORT = Number(process.env.MOCK_PORT ?? 4010), MCP_PORT = Number(process.env.MCP_PORT ?? 4011), WS_PORT = Number(process.env.WS_PORT ?? 4012), GH_PORT = Number(process.env.GH_PORT ?? 4013);
// Workspace giả lập cho Synchro Code (khóa chỉ dùng trên máy này).
const WS_SECRET = "mock-workspace-secret-for-dev-only-0123456789";
const DATA = path.resolve("data-mock");
// Tài khoản quản trị chỉ tồn tại trong data-mock/ trên máy này.
const ADMIN = { email: "admin@synchro.test", password: "synchro-mock-123", fullName: "Quản trị thử nghiệm" };
const B = `http://localhost:${PORT}`, M = `http://127.0.0.1:${MOCK_PORT}`;
// GitHub giả lập (scripts/mock-github.mjs): kết nối GitHub, clone / push, pull request, CI và góp ý review chạy hoàn toàn trên máy này.
const GH = `http://127.0.0.1:${GH_PORT}`;
// GITHUB_CODELOAD_URL / GIT_ALLOW_PRIVATE: Kho kỹ năng tải repo công khai từ GitHub giả lập (zip, git clone ở 127.0.0.1).
const ghEnv = { GITHUB_CLIENT_ID: "mock-github-client", GITHUB_CLIENT_SECRET: "mock-github-secret", GITHUB_WEB_URL: GH, GITHUB_API_URL: `${GH}/api`, GITHUB_GIT_URL: `${GH}/git`, SYNCHRO_PR_TICK_MS: "3000", GITHUB_CODELOAD_URL: `${GH}/codeload`, GIT_ALLOW_PRIVATE: "1" };
const env = { ...process.env, ...ghEnv, WS_AGENT_URL: `http://127.0.0.1:${WS_PORT}`, WS_AGENT_SECRET: WS_SECRET, WS_PUBLIC_URL: `ws://localhost:${WS_PORT}/ws-agent`, SYNCHRO_INTERNAL_URL: `http://127.0.0.1:${PORT}`, DATA_DIR: DATA, NEXT_DIST_DIR: ".next-mock", ADMIN_EMAILS: ADMIN.email, APP_URL: B, MCP_ALLOW_PRIVATE: "1", CODE_RUN: "local", SYNCHRO_DEFAULT_PLUGINS: "0", SYNCHRO_TASK_TICK_MS: "3000", SYNCHRO_TASK_RETRY_MS: "4000", SYNCHRO_CHROME_WAIT_MS: "30000", SYNCHRO_RELAX_LIMITS: "1", LLM_PROVIDER: "anthropic", LLM_API_KEY: "", ELEVENLABS_API_KEY: "", DATA_KEY: "", SYNCHRO_ENGINE_HOME: path.join(DATA, "engine"), SYNCHRO_ENGINE_USER: "" };

// CLI giả lập (claude, codex, agy, grok) cho Cài đặt → Providers: chép vào <engine home>/.local/bin như CLI thật đã cài,
// kèm địa chỉ máy chủ giả lập (trang đăng nhập /mock-login/…).
const ENGINE_BIN = path.join(DATA, "engine", ".local", "bin");
fs.mkdirSync(ENGINE_BIN, { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(ENGINE_BIN, f)); fs.chmodSync(path.join(ENGINE_BIN, f), 0o755); }
fs.writeFileSync(path.join(ENGINE_BIN, "mock-cli.json"), JSON.stringify({ base: M }));

try { await startMock(MOCK_PORT); } catch (e) { console.error(`Không mở được API giả lập ở cổng ${MOCK_PORT}: ${e.message}`); process.exit(1); }
try { await startMockMcp(MCP_PORT); } catch (e) { console.error(`Không mở được máy chủ MCP giả lập ở cổng ${MCP_PORT}: ${e.message}`); process.exit(1); }
try { await startMockGithub(GH_PORT, path.join(DATA, "github")); } catch (e) { console.error(`Không mở được GitHub giả lập ở cổng ${GH_PORT}: ${e.message}`); process.exit(1); }
try { await startMockWs(WS_PORT, path.join(DATA, "ws"), WS_SECRET); } catch (e) { console.error(`Không mở được workspace giả lập ở cổng ${WS_PORT}: ${e.message}`); process.exit(1); }
// Tiện ích Synchro cho Chrome của bạn, bản giải nén trỏ tới máy này: chrome://extensions → bật Developer mode → Load unpacked → chọn thư mục.
const EXT_DIR = writeExtension(process.cwd(), B, path.join(DATA, "extension"));

if (!fs.existsSync(path.join(DATA, "synchro.db"))) {
  const r = spawnSync(process.execPath, ["scripts/create-admin.mjs", ADMIN.email], { env, input: `${ADMIN.password}\n${ADMIN.password}\n`, encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
}

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--turbopack", "-p", String(PORT)], { env, stdio: "inherit" });
const stop = () => { next.kill("SIGINT"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => process.exit(code ?? 0));

// Đợi web sẵn sàng, rồi nhập khóa giả lập qua chính Cài đặt → Providers (máy chủ tự kiểm tra, mã hóa và lấy danh sách model).
let cookie = "";
const call = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body && JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => null) };
};
for (let i = 0; ; i++) {
  try { if ((await fetch(`${B}/api/models`)).status < 500) break; } catch {}
  if (i > 150) { console.error("Web chưa khởi động sau 5 phút."); stop(); }
  await new Promise((r) => setTimeout(r, 2000));
}
const login = await call("POST", "/api/auth/login", { email: ADMIN.email, password: ADMIN.password });
if (login.status !== 200) { console.error("Không đăng nhập được tài khoản thử nghiệm:", login.j?.error); stop(); }
if (!login.j?.user?.profile?.fullName) await call("POST", "/api/auth/profile", { fullName: ADMIN.fullName, birthDate: "2000-01-01" });

const state = (await call("GET", "/api/admin/apikeys")).j;
const has = (id) => state?.providers?.find((p) => p.id === id)?.configured;
const add = [
  ["anthropic", { id: "anthropic", key: MOCK_KEYS.anthropic, baseUrl: `${M}/anthropic` }],
  ["openai", { id: "openai", key: MOCK_KEYS.openai, baseUrl: `${M}/openai/v1` }],
  ["google", { id: "google", key: MOCK_KEYS.google, baseUrl: `${M}/google/v1beta/openai` }],
  ["xai", { id: "xai", key: MOCK_KEYS.xai, baseUrl: `${M}/xai/v1` }],
  ["deepseek", { id: "deepseek", key: MOCK_KEYS.deepseek, baseUrl: `${M}/deepseek` }],
  // Speech, đọc to và trò chuyện bằng giọng nói dùng ElevenLabs giả lập (gói Free như tài khoản thật; đổi gói ở /_debug/el).
  ["elevenlabs", { id: "elevenlabs", kind: "elevenlabs", key: MOCK_KEYS.elevenlabs, baseUrl: `${M}/elevenlabs` }],
];
for (const [id, body] of add) {
  if (has(id)) continue;
  const r = await call("POST", "/api/admin/apikeys", body);
  if (r.status !== 200) console.error(`Không nối được ${id}:`, r.j?.error);
}
// Connector giả lập kết nối sẵn như đang dùng thật: Mock Notes (đăng nhập OAuth, tự bấm "Cho phép"), Mock Status (giao thức 2026),
// Mock Echo (SSE đời cũ) và DeepWiki thật (nếu có mạng). Máy chủ giả lập lưu token trong bộ nhớ nên mỗi lần chạy đều kết nối lại.
const MC = `http://127.0.0.1:${MCP_PORT}`;
async function approve(url) {
  const page = await fetch(url).then((x) => x.text()).catch(() => "");
  const link = /id="allow" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
  const back = link && (await fetch(link, { redirect: "manual" })).headers.get("location");
  if (back) await fetch(back, { headers: { cookie } });
}
const conns = (await call("GET", "/api/connectors")).j?.connectors ?? [];
for (const [name, url] of [["Mock Notes", `${MC}/mcp`], ["Mock Status", `${MC}/modern`], ["Mock Echo", `${MC}/sse`]]) {
  const have = conns.find((x) => x.url === url);
  const r = have ? await call("POST", `/api/connectors/${have.id}/connect`) : await call("POST", "/api/connectors", { name, url });
  if (r.status !== 200) { console.error(`Không nối được connector ${name}:`, r.j?.error); continue; }
  if (r.j.authorizeUrl) await approve(r.j.authorizeUrl);
}
if (!conns.some((x) => x.dir === "deepwiki")) await call("POST", "/api/connectors", { dir: "deepwiki" }).catch(() => {});
const connected = ((await call("GET", "/api/connectors")).j?.connectors ?? []).filter((x) => x.status === "ok");
// Cài đặt → Khả năng: lần chạy đầu bật đủ mọi khả năng (kể cả artifact dùng AI và truy cập mạng) để thử ngay; sau đó giữ lựa chọn của bạn.
// Code chạy trên máy này trong sandbox của macOS (CODE_RUN=local): không đọc được thư mục cá nhân, mạng chỉ tới kho thư viện.
const SEEDED = path.join(DATA, ".caps-seeded");
if (!fs.existsSync(SEEDED)) {
  const r = await call("PATCH", "/api/caps", { art: true, ai: true, inl: true, code: true, net: true });
  if (r.status === 200) fs.writeFileSync(SEEDED, new Date().toISOString());
}
const caps = (await call("GET", "/api/caps")).j;
// Mức dùng: lần chạy đầu nạp lịch sử dùng mẫu 30 ngày cho tài khoản quản trị (đặt hạn mức riêng $5 / phiên, $40 / tuần)
// để vòng tròn usage và Cài đặt → Usage có dữ liệu như đang dùng thật. Lượt chat mới vẫn được tính thật từ API giả lập.
const USAGE_SEEDED = path.join(DATA, ".usage-seeded");
if (!fs.existsSync(USAGE_SEEDED) && (await call("GET", "/api/usage")).status === 200) {
  const { default: Database } = await import("better-sqlite3");
  const sdb = new Database(path.join(DATA, "synchro.db"));
  sdb.pragma("busy_timeout = 5000");
  const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN.email)?.id;
  if (uid) {
    const now = Date.now(), H = 3600_000, D = 24 * H;
    const PRICE = { "anthropic/claude-opus-5-5": [4, 20], "anthropic/claude-sonnet-5-5": [2, 10], "anthropic/claude-fable-5-1": [10, 50], "openai/gpt-6-astra": [10, 50], "google/gemini-3.8-flash": [1.5, 9] };
    const models = Object.keys(PRICE), feats = ["chat", "chat", "chat", "code", "code", "artifact", "internal"];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ins = sdb.prepare("INSERT INTO usage_events (user_id, at, model, feature, input, output, cache_read, cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const add = (at, cost, model = models[Math.floor(rnd() * models.length)]) => {
      const [pi, po] = PRICE[model], out = Math.round((cost * 0.55) / po * 1e6), fresh = Math.round((cost * 0.35) / pi * 1e6), cache = Math.round((cost * 0.1) / (pi / 10) * 1e6);
      ins.run(uid, Math.round(at), model, feats[Math.floor(rnd() * feats.length)], fresh, out, cache, 0, cost);
    };
    const weekAnchor = now - 4.4 * D, sessionStart = now - (1 * H + 51 * 60_000);
    sdb.transaction(() => {
      for (let d = 30; d >= 5; d--) for (let k = 0, n = 2 + Math.floor(rnd() * 6); k < n; k++) add(now - d * D + rnd() * 10 * H, 0.15 + rnd() * 1.1);
      // Đầu tuần tới trước phiên hiện tại: $33.90 (cộng $4.50 của phiên = 96% của $40), rải đều, không lấn sang phiên.
      for (let k = 0, step = (sessionStart - weekAnchor - 4 * H) / 30; k < 30; k++) add(weekAnchor + 2 * H + k * step, 1.13, models[Math.floor(rnd() * 3)]);
      for (let t = sessionStart + 5 * 60_000, total = 0; total < 4.5; t += 7 * 60_000) { const c = Math.min(0.42, 4.5 - total); add(t, c, "anthropic/claude-opus-5-5"); total += c; }
      sdb.prepare("INSERT INTO usage_users (user_id, session_start, week_anchor, override) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_start = excluded.session_start, week_anchor = excluded.week_anchor, override = excluded.override")
        .run(uid, sessionStart, weekAnchor, JSON.stringify({ session: 5, weekly: 40 }));
    })();
    fs.writeFileSync(USAGE_SEEDED, new Date().toISOString());
  }
  sdb.close();
}
const usage = (await call("GET", "/api/usage?provider=anthropic")).j;
// Plugins: lần chạy đầu cài sẵn ba studio (Thiết kế / Trình bày / Tài liệu) cho cả tổ chức từ GitHub, như quản trị viên đã cài.
// Nếu có ~/Downloads/Vox Animations.zip thì thêm skill Vox vào Design Studio. Cần mạng; lỗi thì bỏ qua, cài lại ở Tùy chỉnh → Plugins.
const PLUGINS_SEEDED = path.join(DATA, ".plugins-seeded");
if (!fs.existsSync(PLUGINS_SEEDED)) {
  let ok = 0;
  for (const id of ["design-studio", "slides-studio", "docs-studio"]) {
    const r = await call("POST", "/api/plugins", { action: "install", catalogId: id, scope: "org" }).catch((e) => ({ status: 0, j: { error: String(e) } }));
    if (r.status === 200) ok++; else console.error(`Không cài được plugin ${id}:`, r.j?.error);
    if (id === "design-studio" && r.status === 200) {
      const vox = path.join(process.env.HOME ?? "", "Downloads", "Vox Animations.zip");
      if (fs.existsSync(vox)) {
        const fd = new FormData();
        fd.append("file", new Blob([fs.readFileSync(vox)], { type: "application/zip" }), "vox.zip");
        await fetch(`${B}/api/plugins/${r.j.plugin.id}`, { method: "POST", headers: { origin: B, cookie }, body: fd }).catch(() => {});
      }
    }
  }
  if (ok === 3) fs.writeFileSync(PLUGINS_SEEDED, new Date().toISOString());
}
const plugins = (await call("GET", "/api/plugins")).j?.plugins ?? [];
const models = (await call("GET", "/api/models")).j?.providers ?? [];

console.log(`
  ┌─ Synchro với API giả lập ──────────────────────────────
  │ Web:        ${B}
  │ Đăng nhập:  ${ADMIN.email} / ${ADMIN.password}
  │ Model:      ${models.map((p) => `${p.name} (${p.models.length})`).join(", ") || "chưa có"}
  │ Thử lỗi:    gõ #401, #404, #429, #500 hoặc #slow trong tin nhắn
  │ Grok:       khóa API giả lập nối sẵn; gói Grok: Cài đặt → Providers → Grok → Sign in with your plan (trang cho phép giả lập)
  │ DeepSeek:   khóa API giả lập nối sẵn (chỉ có khóa API, không có gói đăng nhập)
  │ Khóa thử:   khóa nào có chữ "mock" đều hợp lệ, API giả lập ở ${M}
  │ Connector:  ${connected.map((x) => x.name).join(", ") || "chưa có"} (đã kết nối sẵn)
  │ Thử:        "Tìm ghi chú về Synchro", "Tạo ghi chú tên Họp thứ Hai", "Xóa ghi chú n2", "Mấy giờ rồi?"
  │ Khả năng:   ${caps?.caps ? Object.entries({ Artifacts: caps.caps.art, "Artifact dùng AI": caps.caps.ai, "Hình minh họa": caps.caps.inl, "Chạy code": caps.caps.code, "Mạng": caps.caps.net }).map(([k, v]) => `${k} ${v ? "bật" : "tắt"}`).join(" · ") : "?"}
  │   Artifact: "Tạo ứng dụng todo", "Làm máy tính bỏ túi", "Tạo trang web giới thiệu quán cà phê", "Tạo app dịch", rồi "Đổi màu xanh lá"
  │   Hình:     "Vẽ biểu đồ doanh thu 6 tháng", "Tỷ lệ doanh thu theo kênh", "Vẽ sơ đồ quy trình đặt hàng", "Mô phỏng tính lãi vay"
  │   Chạy code:"Tạo file Excel báo cáo doanh thu", "Viết báo cáo tuần ra file Word", "Làm slide PowerPoint", "Xuất hóa đơn PDF",
  │             "Đếm số nguyên tố dưới 1 triệu", "Cài thư viện humanize bằng pip", "Thử truy cập mạng"
  │ Plugins:    ${plugins.map((p) => `${p.name} (${p.skills.length} skill${p.studio ? `, nút ${p.studio === "design" ? "Thiết kế" : p.studio === "slides" ? "Trình bày" : "Tài liệu"}` : ""})`).join(", ") || "chưa có"}
  │   Thử:     Artifacts → bấm "Thiết kế" rồi gõ "Làm trang web cho quán cà phê"; "Trang trình bày" → "Báo cáo quý"; "Tài liệu" → "Viết đề xuất"
  │ Chrome:     Cài đặt → Khả năng → Trình duyệt của bạn → Ghép nối, rồi một trong hai:
  │   - tiện ích giả lập (Chrome thật, cửa sổ riêng): node scripts/mock-extension.mjs --code <mã>
  │   - tiện ích thật trong Chrome của bạn: chrome://extensions → Developer mode → Load unpacked → ${path.relative(process.cwd(), EXT_DIR)}
  │   Thử:     "#browser mở ${M}/_fixture/browser-quiz trên Chrome của tôi rồi làm bài giúp mình"
  │ Mức dùng:   ${usage?.limits ? usage.limits.map((l) => `${l.key === "session" ? "phiên" : "tuần"} ${Math.round(l.pct)}% ($${l.used.toFixed(2)}${l.limit ? `/$${l.limit}` : ""})`).join(" · ") : "?"} — bấm vòng tròn cạnh tên model, hoặc Cài đặt → Usage
  └─ Ctrl+C để dừng ─────────────────────────────────────────
`);
