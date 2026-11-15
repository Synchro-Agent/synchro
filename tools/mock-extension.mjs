// Tiện ích Synchro giả lập cho npm run dev:mock và kiểm thử: chạy đúng mã của tiện ích thật (bản đóng gói như tệp .zip tải từ Synchro:
// control.js, link.js, act.js…) trên Chrome thật của máy này (cửa sổ riêng, hồ sơ riêng), qua lớp giả chrome.* (tools/mock-chrome.mjs).
// Đi đúng đường của tiện ích thật: ghép nối bằng mã → khóa riêng → vé WebSocket → /ws-agent/ext của workspace (giả lập).
// Dùng: node tools/mock-extension.mjs --code ABCD-EFGH [--server http://localhost:3200] [--headless] [--profile thư-mục]
//   Mã ghép nối: Synchro → Cài đặt → Khả năng → Trình duyệt của bạn → Ghép nối (hoặc khung trình duyệt → Chrome của bạn).
//   Đã ghép nối thì chạy lại không cần --code (khóa lưu trong hồ sơ, mặc định data-mock/ext-chrome).
// Sẵn sàng thì in một dòng JSON { ready, control, devtools }: cổng HTTP điều khiển (127.0.0.1, cho kiểm thử) và cổng DevTools của Chrome.
// Cổng điều khiển: GET /state · POST /stop (như bấm Dừng) · POST /pause, /resume (như bấm Tạm dừng / Tiếp tục) · POST /cancel (như bấm Hủy trên thanh gỡ lỗi của Chrome) · POST /scope { scope }
//   · POST /share { tab, on } · POST /open { url } (người dùng tự mở một tab) · POST /drop { ms } (mất kết nối giữa chừng, nối lại sau ms)
//   · POST /quit.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { devJson } from "../workspace/browser-core.mjs";
import { writeExtension } from "../extension/build.mjs";
import { createChrome } from "./mock-chrome.mjs";
import { findChrome } from "./mock-workspace.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true; };
const SERVER = String(arg("server", process.env.SYNCHRO_URL ?? "http://localhost:3200")).replace(/\/$/, "");
const PROFILE = path.resolve(String(arg("profile", "data-mock/ext-chrome")));
const HEADLESS = !!arg("headless", false) || process.env.MOCK_EXT_HEADLESS === "1";
const CODE = arg("code", "");
const say = (...a) => { if (!arg("quiet", false)) console.error("[tiện ích giả lập]", ...a); };

const CHROME = findChrome();
if (!CHROME) { console.error("Máy này không có Chrome / Chromium (đặt CHROME_PATH)."); process.exit(2); }
fs.mkdirSync(PROFILE, { recursive: true });

// 1. Bản tiện ích như người dùng tải về (kèm package.json để Node chạy các tệp .js dạng module).
const EXT = writeExtension(process.cwd(), SERVER, path.join(PROFILE, "extension"));
fs.writeFileSync(path.join(EXT, "package.json"), JSON.stringify({ type: "module" }));
const { createControl } = await import(pathToFileURL(path.join(EXT, "control.js")).href);
const { createLink } = await import(pathToFileURL(path.join(EXT, "link.js")).href);

// 2. Chrome thật: cửa sổ riêng (hoặc chạy ẩn khi kiểm thử), hồ sơ riêng nên không đụng Chrome bạn đang dùng.
const prof = path.join(PROFILE, "chrome");
spawnSync("pkill", ["-f", `--user-data-dir=${prof}`]);
for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(prof, f), { force: true });
// Tệp tải về vào thư mục của tiện ích giả lập (không lẫn vào thư mục Tải xuống của máy), kể cả trước khi lớp giả chrome.downloads kịp đặt.
{
  const pf = path.join(prof, "Default", "Preferences"), dl = path.join(PROFILE, "Downloads");
  let pref = {}; try { pref = JSON.parse(fs.readFileSync(pf, "utf8")); } catch {}
  pref.download = { ...(pref.download ?? {}), default_directory: dl, prompt_for_download: false, directory_upgrade: true };
  pref.savefile = { ...(pref.savefile ?? {}), default_directory: dl };
  fs.mkdirSync(path.dirname(pf), { recursive: true }); fs.writeFileSync(pf, JSON.stringify(pref));
}
const proc = spawn(CHROME, [...(HEADLESS ? ["--headless=new"] : []), "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic",
  "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${prof}`, "--window-size=1280,860", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const port = await new Promise((ok, no) => {
  let buf = "";
  const t = setTimeout(() => no(new Error("Chrome không mở cổng DevTools")), 20_000);
  proc.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(buf); if (m) { clearTimeout(t); ok(Number(m[1])); } });
  proc.on("exit", () => no(new Error("Chrome đã thoát")));
});
const base = `http://127.0.0.1:${port}`;
await devJson(`${base}/json/version`);
const shim = await createChrome(base, { downloads: path.join(PROFILE, "Downloads") });
const quit = () => { try { shim.close(); } catch {} proc.kill("SIGTERM"); setTimeout(() => process.exit(0), 300); };
process.on("SIGINT", quit); process.on("SIGTERM", quit);
proc.on("exit", () => process.exit(0));

// 3. Lõi tiện ích (giống background.js): kho khóa trong hồ sơ, kết nối tới Synchro.
const STORE = path.join(PROFILE, "ext-store.json");
const read = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const store = {
  get: async () => read(),
  set: async (o) => fs.writeFileSync(STORE, JSON.stringify({ ...read(), ...o }, null, 2)),
  remove: async (keys) => { const c = read(); for (const k of keys) delete c[k]; fs.writeFileSync(STORE, JSON.stringify(c, null, 2)); },
};
let link;
const control = createControl(shim.chrome, { server: () => SERVER, scope: read().scope, notify: (m) => link?.send(m), save: (v) => store.set({ ctl: v }) });
control.restore(read().ctl);
const device = () => ({ name: `Chrome giả lập · ${os.type() === "Darwin" ? "macOS" : os.type()}`, browser: "Google Chrome", version: "mock", ext: "mock" });
let last = "";
link = createLink({ store, control, device, WebSocket, revoked: "Trình duyệt này đã bị gỡ khỏi Synchro.", onState: (s) => { const k = `${s.state} ${s.error}`; if (k !== last) { last = k; say(s.state === "online" ? "đã kết nối với Synchro" : s.state, s.error || ""); } } });
if (CODE && CODE !== true) {
  try { const j = await link.pair(SERVER, String(CODE)); say(`đã ghép nối với tài khoản ${j.user?.email ?? ""} (${j.device?.name})`); }
  catch (e) { console.error("Không ghép nối được:", e.message); quit(); }
} else if (!read().token) { console.error("Chưa ghép nối: chạy lại với --code <mã ghép nối> (Synchro → Cài đặt → Khả năng → Trình duyệt của bạn)."); quit(); }
else link.connect();

// 4. Cổng điều khiển cho kiểm thử (chỉ nghe ở máy này).
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const ctl = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  let b = {}; try { b = JSON.parse(raw || "{}"); } catch {}
  try {
    switch (new URL(req.url, "http://x").pathname) {
      case "/state": return json(res, 200, { link: link.state(), control: control.status(), scope: control.scope(), devtools: port, tabs: await shim.chrome.tabs.query({}), store: { paired: !!read().token, device: read().device ?? null } });
      case "/stop": await control.stop("user"); return json(res, 200, { ok: true });
      case "/pause": return json(res, 200, { paused: control.pause(true) });
      case "/resume": return json(res, 200, { paused: control.pause(false) });
      case "/cancel": { const t = Number(control.status().tab); if (t) shim.chrome.debugger.cancelByUser(t); return json(res, 200, { ok: !!t }); }
      case "/scope": control.setScope(b.scope); await store.set({ scope: control.scope() }); link.send({ t: "status", scope: control.scope() }); return json(res, 200, { scope: control.scope() });
      case "/share": await control.share(Number(b.tab), b.on !== false); return json(res, 200, control.status());
      case "/open": { const t = await shim.chrome.tabs.create({ url: b.url || "about:blank", active: true }); return json(res, 200, { tab: t.id, target: shim.targetOf(t.id) }); }
      case "/drop": link.close(); setTimeout(() => link.connect(), Number(b.ms) || 1500); return json(res, 200, { ok: true });
      case "/quit": json(res, 200, { ok: true }); return quit();
    }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: e.message }); }
});
ctl.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ ready: true, control: ctl.address().port, devtools: port, server: SERVER, headless: HEADLESS }));
  say(`Chrome ${HEADLESS ? "chạy ẩn" : "đã mở"} (DevTools ${port}). Nhờ Synchro trong khung chat, ví dụ “mở trang … trên Chrome của tôi rồi điền biểu mẫu”.`);
});
