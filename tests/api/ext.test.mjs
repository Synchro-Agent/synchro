// Chrome của người dùng (tiện ích Synchro): ghép nối bằng mã, lệnh browser_* của mọi model chạy qua tiện ích, phạm vi tab, Dừng ngay trong
// Chrome, hết lượt thì thôi điều khiển, gỡ trình duyệt, tải tiện ích. Tiện ích giả lập (scripts/mock-extension.mjs) chạy đúng mã của tiện ích
// thật (bản .zip) trên Chrome thật của máy này, chạy ẩn. Máy không có Chrome thì chỉ kiểm phần máy chủ.
import { spawn } from "node:child_process";
import path from "node:path";
import JSZip from "jszip";
import fs from "node:fs";
import { CDP, devJson } from "../../workspace/browser-core.mjs";
import { findChrome } from "../../scripts/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010", PAGE = `${MOCK}/_fixture/browser-quiz`;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookie = "";
  return async (method, p, body, headers = {}) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const raw = (p, body, headers = {}) => fetch(B + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body ?? {}) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const me = client();
const EMAIL = "ext-member@synchro.test";
await me("POST", "/api/auth/signup", { email: EMAIL, password: "Member-pass-123", profile: { fullName: "Ext Member", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: EMAIL, password: "Member-pass-123" });
// Quyền rõ ràng (không dựa vào quyền mặc định của tài khoản mới, có thể đã bị bộ kiểm thử khác đổi): mọi model, mọi tính năng
// (Synchro Code + Cloud sandbox để có trình duyệt của Synchro).
{
  let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  const admin = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    return r.json().catch(() => null);
  };
  if (!cookie) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
  const u = (await admin("GET", "/api/admin")).users.find((x) => x.email === EMAIL);
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
// Bắt đầu sạch: gỡ trình duyệt còn lại của lần chạy trước, dùng trình duyệt của Synchro làm mặc định.
for (const d of (await me("GET", "/api/browser/ext")).j?.devices ?? []) await me("POST", "/api/browser/ext", { op: "remove", id: d.id });
await me("PATCH", "/api/caps", { browse: true, mine: false });
const last = async () => (await fetch(`${MOCK}/_debug/last`)).json();
const ask = (model, text, extra = {}) => me("POST", "/api/llm", { system: "", model, skills: true, messages: [{ role: "user", content: text }], ...extra });
const MINE = `#browser mở ${PAGE} trên Chrome của tôi rồi làm bài giúp mình`;

console.log("1. Chưa ghép nối: model vẫn có tham số chọn trình duyệt, nhờ “Chrome của tôi” thì báo chưa kết nối (không tự làm ở trình duyệt khác)");
let r = await me("GET", "/api/browser/ext");
ok(r.s === 200 && r.j.allowed === true && r.j.devices.length === 0 && r.j.connected === false && r.j.target === "synchro", "GET /api/browser/ext: chưa có trình duyệt nào, mặc định trình duyệt của Synchro", JSON.stringify(r.j));
r = await me("GET", "/api/caps");
ok(r.j.paired === false && r.j.caps.mine === false && r.j.locks.mine === undefined, "Cài đặt → Khả năng: chưa ghép nối, chưa dùng Chrome của bạn", JSON.stringify(r.j));
r = await ask("anthropic/claude-haiku-5-5", MINE);
const L0 = await last();
const nav = L0.anthropic.tools?.find((t) => t.name === "browser_navigate");
ok(nav?.input_schema?.properties?.browser?.enum?.join() === "synchro,user", "browser_navigate có tham số browser (synchro / user)", JSON.stringify(nav));
ok(/Chrome \/ Edge \/ Brave của chính người dùng/.test(JSON.stringify(L0.anthropic.system)), "hướng dẫn <browser> nói về Chrome của người dùng");
ok(r.s === 200 && /Chưa làm được trên trình duyệt: Chrome của người dùng chưa kết nối/.test(r.j?.text ?? ""), "nhờ làm trên Chrome của tôi khi chưa kết nối → báo rõ, kèm cách cài", JSON.stringify(r.j).slice(0, 300));

console.log("2. Ghép nối bằng mã một lần, khóa riêng của trình duyệt");
ok((await raw("/api/browser/ext/pair", { code: "AAAA-BBBB" })).s === 400, "mã sai → 400");
ok((await raw("/api/browser/ext/connect", {})).s === 401, "xin vé không có khóa → 401");
ok((await raw("/api/browser/ext/connect", {}, { authorization: "Bearer sxt_khong-co-that-0123456789abcdef" })).s === 401, "khóa không có thật → 401");
const code = (await me("POST", "/api/browser/ext", { op: "code" })).j;
ok(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code?.code ?? "") && code.expiresAt > Date.now() + 9 * 60_000, "mã ghép nối dạng ABCD-EFGH, hết hạn sau 10 phút", JSON.stringify(code));
ok((await me("POST", "/api/browser/ext", { op: "code" }, { origin: "https://evil.example" })).s === 403, "lấy mã từ trang khác (CSRF) → 403");

const chrome = findChrome();
if (!chrome) {
  console.log("  (máy này không có Chrome / Chromium: bỏ qua phần chạy tiện ích giả lập)");
} else {
  const PROFILE = path.resolve("data-mock/ext-test");
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(process.execPath, ["scripts/mock-extension.mjs", "--server", B, "--code", code.code, "--headless", "--quiet", "--profile", PROFILE], { stdio: ["ignore", "pipe", "inherit"] });
  const ready = await new Promise((res) => { let buf = ""; proc.stdout.on("data", (d) => { buf += d; const l = buf.split("\n").find((x) => x.startsWith("{")); if (l) res(JSON.parse(l)); }); proc.on("exit", () => res(null)); setTimeout(() => res(null), 30_000); });
  ok(!!ready?.control, "tiện ích giả lập bật Chrome thật và ghép nối xong", JSON.stringify(ready));
  const ctl = (p, body) => fetch(`http://127.0.0.1:${ready.control}${p}`, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined }).then((x) => x.json());
  const DT = `http://127.0.0.1:${ready?.devtools}`;
  // Chạy JS trong một tab của Chrome giả lập (như người dùng thao tác trên trang).
  const inTab = async (match, expr) => {
    const t = (await devJson(`${DT}/json/list`)).find((x) => x.type === "page" && match(x.url));
    if (!t) return undefined;
    const c = await CDP.open(`ws://127.0.0.1:${ready.devtools}/devtools/page/${t.id}`);
    try { return (await c.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value; } finally { c.close(); }
  };
  try {
    for (let i = 0; i < 40 && !(await me("GET", "/api/browser/ext")).j?.connected; i++) await sleep(250);
    r = await me("GET", "/api/browser/ext");
    const dev = r.j.devices[0];
    ok(r.j.connected && r.j.devices.length === 1 && dev.connected && dev.scope === "all" && /Chrome giả lập/.test(dev.name), "trình duyệt đã kết nối, mặc định toàn quyền (mọi tab)", JSON.stringify(r.j));
    ok((await raw("/api/browser/ext/pair", { code: code.code })).s === 400, "mã đã dùng không dùng lại được");
    r = await me("GET", "/api/caps");
    ok(r.j.paired === true && r.j.caps.mine === true, "trình duyệt đầu tiên: từ giờ Synchro làm mặc định trên Chrome của bạn", JSON.stringify(r.j));
    ok((await me("GET", "/api/browser")).j?.target === "user", "GET /api/browser: mặc định Chrome của bạn");

    console.log("3. Model khóa API làm xong bài trên Chrome của người dùng (qua tiện ích), tab riêng trong nhóm Synchro");
    for (const model of ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna", "google/gemini-3.8-flash"]) {
      const t0 = Date.now();
      r = await ask(model, MINE);
      ok(r.s === 200 && /Đã làm xong trên Chrome của bạn/.test(r.j?.text ?? "") && /6\/6 thao tác/.test(r.j.text) && /Trang cuối: Đã nộp bài/.test(r.j.text), `${model}: 6/6 thao tác trên Chrome của bạn, trang cuối "Đã nộp bài" (${Date.now() - t0} ms)`, JSON.stringify(r.j).slice(0, 400));
    }
    const L = await last();
    const tr = L.anthropic.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    ok(tr.some((b) => Array.isArray(b.content) && b.content.some((x) => x.type === "image" && x.source?.data?.length > 1000)), "ảnh chụp từ Chrome của người dùng tới model");
    let st = await ctl("/state");
    const quiz = st.tabs.filter((t) => t.url.startsWith(PAGE));
    ok(quiz.length >= 1 && quiz.every((t) => t.groupId > 0) && st.tabs.some((t) => t.url === "about:blank" && t.groupId === -1), "trang mở ở tab riêng trong nhóm “Synchro”, tab sẵn có của người dùng không bị đụng", JSON.stringify(st.tabs));
    ok(st.control.attached.length === 0 && (await inTab((u) => u.startsWith(PAGE), "!!document.querySelector('synchro-control')")) === false, "hết lượt: thôi điều khiển (ngắt chrome.debugger, gỡ dải điều khiển)", JSON.stringify(st.control));
    r = await me("GET", "/api/browser/ext");
    ok(r.j.devices[0].tab?.url?.startsWith(PAGE) && r.j.devices[0].last?.label, "Synchro biết tab đang làm và thao tác gần nhất (khung trình duyệt hiện ra)", JSON.stringify(r.j.devices[0]));

    console.log("4. Mặc định theo lựa chọn của người dùng; model nói rõ thì theo model");
    r = await ask("anthropic/claude-haiku-5-5", `#browser mở ${PAGE}?mac-dinh=1 rồi làm bài`);
    st = await ctl("/state");
    ok(/Đã làm xong/.test(r.j?.text ?? "") && st.tabs.some((t) => t.url.includes("mac-dinh=1")), "không nói trình duyệt → làm trên Chrome của bạn (đang là mặc định)", JSON.stringify(r.j).slice(0, 200));
    await me("PATCH", "/api/caps", { mine: false });
    r = await ask("anthropic/claude-haiku-5-5", `#browser mở ${PAGE}?mac-dinh=2 rồi làm bài`);
    st = await ctl("/state");
    ok(/Đã làm xong trên trình duyệt/.test(r.j?.text ?? "") && !st.tabs.some((t) => t.url.includes("mac-dinh=2")), "đổi mặc định sang trình duyệt của Synchro → không đụng Chrome của bạn", JSON.stringify(r.j).slice(0, 200));
    r = await ask("anthropic/claude-haiku-5-5", `#browser mở ${PAGE}?ro=1 trên Chrome của tôi rồi làm bài`);
    st = await ctl("/state");
    ok(/Đã làm xong trên Chrome của bạn/.test(r.j?.text ?? "") && st.tabs.some((t) => t.url.includes("ro=1")), "nói “Chrome của tôi” → vẫn làm trên Chrome của bạn", JSON.stringify(r.j).slice(0, 200));
    await me("PATCH", "/api/caps", { mine: true });

    console.log("5. Gói subscription (Claude Code) qua cầu nối MCP; phạm vi tab; không bao giờ điều khiển chính Synchro");
    const mcode = async () => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${MOCK}/mock-login/claude`).then((x) => x.text()))?.[1];
    await me("POST", "/api/engines/claude/login/start", {});
    ok((await me("POST", "/api/engines/claude/login/code", { code: await mcode() })).s === 200, "đăng nhập gói Claude (giả lập)");
    const own = await ctl("/open", { url: `${PAGE}?cua-toi=1` });
    await ctl("/open", { url: `${B}/` });
    await sleep(800);
    // Danh sách tab model nhận được (kết quả đầy đủ của browser_tabs trong lời gọi model kế tiếp).
    const list = async () => {
      await ask("anthropic/claude-haiku-5-5", `#tool=browser_tabs #args={"op":"list","browser":"user"}`);
      const msgs = (await last()).anthropic.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const res = msgs.filter((b) => b.type === "tool_result").pop();
      return typeof res?.content === "string" ? res.content : JSON.stringify(res?.content ?? "");
    };
    let txt = await list();
    ok(/Các tab:/.test(txt) && txt.includes("cua-toi=1"), "toàn quyền: model thấy cả tab người dùng tự mở", txt.slice(0, 400));
    ok(!txt.includes(new URL(B).host), "không liệt kê tab của chính Synchro (trang chat)", txt.slice(0, 400));
    await ctl("/scope", { scope: "group" });
    txt = await list();
    ok(!txt.includes("cua-toi=1") && txt.includes("browser-quiz"), "chỉ nhóm tab Synchro: tab người dùng tự mở bị ẩn, tab Synchro vẫn thấy", txt.slice(0, 400));
    await ctl("/share", { tab: own.tab, on: true });
    txt = await list();
    ok(txt.includes("cua-toi=1"), "người dùng chia sẻ tab → Synchro dùng được tab đó", txt.slice(0, 400));
    ok((await me("GET", "/api/browser/ext")).j.devices[0].scope === "group", "Synchro biết phạm vi người dùng chọn");
    await ctl("/scope", { scope: "all" });
    r = await ask("sub-claude/sonnet", `#tool=browser_navigate #args={"url":"${PAGE}?mcp=1","browser":"user"}`);
    ok(/đã dùng browser_navigate: Đã mở trang\..*Bài kiểm tra thử/.test(r.j?.text ?? ""), "Claude Code mở trang trên Chrome của người dùng qua mcp__synchro__browser_navigate", JSON.stringify(r.j).slice(0, 300));
    // Gói Codex và Antigravity: cùng công cụ qua cầu nối MCP, làm trên Chrome của người dùng.
    for (const cli of ["codex", "agy"]) await me("POST", `/api/engines/${cli}/logout`);
    const cx = await me("POST", "/api/engines/codex/login/start", {});
    await fetch(`${MOCK}/mock-login/codex/approve?code=${cx.j?.userCode}`);
    for (let i = 0; i < 20 && !(await me("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn; i++) await sleep(500);
    await me("POST", "/api/engines/agy/login/start", {});
    const agyCode = /id="code"[^>]*>([^<]+)</.exec(await fetch(`${MOCK}/mock-login/agy`).then((x) => x.text()))?.[1];
    ok((await me("POST", "/api/engines/agy/login/code", { code: agyCode })).j?.state === "done", "đăng nhập gói Codex và Antigravity (giả lập)");
    for (const [model, tag] of [["sub-codex/gpt-6.1-sol", "codex"], ["sub-agy/gemini-3.8-flash", "agy"]]) {
      r = await ask(model, `#tool=browser_navigate #args={"url":"${PAGE}?${tag}=1","browser":"user"}`);
      const tabsNow = (await ctl("/state")).tabs;
      ok(/browser_navigate/.test(r.j?.text ?? "") && tabsNow.some((t) => t.url.includes(`${tag}=1`)), `${model} mở trang trên Chrome của người dùng qua cầu nối MCP`, JSON.stringify(r.j).slice(0, 300));
    }

    console.log("6. Dừng ngay trong Chrome (nút Dừng trên dải điều khiển) dừng cả lượt; lượt sau làm tiếp được");
    const runOf = async (text) => (await me("POST", "/api/llm", { system: "", model: "anthropic/claude-haiku-5-5", skills: true, async: true, messages: [{ role: "user", content: text }] })).j?.run;
    const waitRun = async (id, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { const x = (await me("GET", `/api/runs/${id}?json=1`)).j?.run; if (x && x.status !== "running") return x; } return null; };
    let t0 = Date.now();
    let run = await runOf(`#tool=browser_wait #args={"ms":25000,"browser":"user"}`);
    for (let i = 0; i < 40; i++) { const c = (await ctl("/state")).control; if (c.acting && c.attached.length) break; await sleep(200); }
    // Tab Synchro đang làm (theo tiện ích).
    const st6 = await ctl("/state"), curUrl = st6.tabs.find((t) => String(t.id) === st6.control.tab)?.url ?? "";
    const here = (u) => u === curUrl;
    const shown = await inTab(here, "!!document.querySelector('synchro-control')");
    ok(shown === true, "đang điều khiển: trang có dải “Synchro đang điều khiển tab này”");
    await inTab(here, "window.__synchroStop && (window.__synchroStop('stop'), true)");
    let done = await waitRun(run);
    ok(done?.result?.cancelled === true && Date.now() - t0 < 15_000, `bấm Dừng trong trang → lượt dừng ngay (${Date.now() - t0} ms, không chờ hết 25 giây)`, JSON.stringify(done).slice(0, 400));
    ok(done?.events?.some((e) => e.kind === "ui" && e.text === "browser:user"), "khung chat được báo Synchro làm trên Chrome của bạn (mở khung trạng thái)");
    ok((await inTab(here, "!!document.querySelector('synchro-control')")) === false && (await ctl("/state")).control.attached.length === 0, "dừng xong: gỡ dải điều khiển, ngắt chrome.debugger");
    r = await ask("anthropic/claude-haiku-5-5", MINE);
    ok(/Đã làm xong trên Chrome của bạn/.test(r.j?.text ?? ""), "lượt mới sau khi dừng: làm bình thường", JSON.stringify(r.j).slice(0, 200));
    t0 = Date.now();
    run = await runOf(`#tool=browser_wait #args={"ms":25000,"browser":"user"}`);
    for (let i = 0; i < 40; i++) { const c = (await ctl("/state")).control; if (c.acting && c.attached.length) break; await sleep(200); }
    await me("POST", "/api/browser/ext", { op: "stop" });
    done = await waitRun(run);
    ok(done?.status === "done" && Date.now() - t0 < 15_000, `nút Dừng ở khung trình duyệt của Synchro dừng thao tác trên Chrome (${Date.now() - t0} ms)`, JSON.stringify(done).slice(0, 300));
    t0 = Date.now();
    run = await runOf(`#tool=browser_wait #args={"ms":25000,"browser":"user"}`);
    for (let i = 0; i < 40; i++) { const c = (await ctl("/state")).control; if (c.acting && c.attached.length) break; await sleep(200); }
    await ctl("/cancel", {});
    done = await waitRun(run);
    ok(done?.result?.cancelled === true && Date.now() - t0 < 15_000, "bấm Hủy trên thanh “đang gỡ lỗi” của Chrome cũng là Dừng", JSON.stringify(done).slice(0, 300));

    console.log("7. Gỡ trình duyệt khỏi Synchro");
    const id = (await me("GET", "/api/browser/ext")).j.devices[0].id;
    r = await me("POST", "/api/browser/ext", { op: "remove", id });
    ok(r.s === 200 && r.j.devices.length === 0, "gỡ trình duyệt", JSON.stringify(r.j));
    for (let i = 0; i < 20 && (await ctl("/state")).link.state !== "unpaired"; i++) await sleep(200);
    st = await ctl("/state");
    ok(st.link.state === "unpaired" && !st.store.paired, "tiện ích nhận tin bị gỡ: xóa khóa, quay về màn hình ghép nối", JSON.stringify(st.link));
    r = await me("GET", "/api/caps");
    ok(r.j.paired === false && r.j.caps.mine === false, "không còn trình duyệt nào → về trình duyệt của Synchro", JSON.stringify(r.j));
    r = await ask("anthropic/claude-haiku-5-5", MINE);
    ok(/Chrome của người dùng chưa kết nối/.test(r.j?.text ?? ""), "nhờ Chrome của tôi sau khi gỡ → báo chưa kết nối", JSON.stringify(r.j).slice(0, 200));
  } finally {
    await ctl("/quit", {}).catch(() => {});
    proc.kill("SIGTERM");
  }
}

console.log("8. Tải tiện ích (.zip) gắn sẵn địa chỉ Synchro này");
const zr = await fetch(`${B}/api/browser/ext/download`);
const zip = await JSZip.loadAsync(Buffer.from(await zr.arrayBuffer())).catch(() => null);
const file = (p) => zip?.file(`synchro-chrome/${p}`)?.async("string");
const manifest = JSON.parse((await file("manifest.json")) ?? "{}");
ok(zr.status === 200 && zr.headers.get("content-type") === "application/zip" && /synchro-chrome\.zip/.test(zr.headers.get("content-disposition") ?? ""), "tải tệp synchro-chrome.zip", `${zr.status} ${zr.headers.get("content-type")}`);
ok(manifest.manifest_version === 3 && manifest.permissions?.includes("debugger") && manifest.background?.type === "module", "manifest V3, quyền debugger, service worker dạng module", JSON.stringify(manifest));
ok((await file("act.js")) === fs.readFileSync("workspace/browser-act.mjs", "utf8"), "act.js đúng là lõi thao tác của trình duyệt Synchro (workspace/browser-act.mjs)");
ok((await file("config.js"))?.includes(JSON.stringify(B)), "config.js ghi sẵn địa chỉ Synchro", await file("config.js"));
ok(!!(await file("background.js")) && !!(await file("popup.html")) && !!(await file("_locales/vi/messages.json")) && !zip?.file("synchro-chrome/build.mjs"), "đủ tệp của tiện ích, không kèm công cụ đóng gói");
const icons = [...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {}), ...[16, 24, 32].map((n) => `icons/toolbar-dark-${n}.png`), "logo.png", "logo-mask.js"];
ok(icons.length >= 12 && icons.every((p) => !!zip?.file(`synchro-chrome/${p}`)), "logo Synchro: biểu tượng tiện ích, biểu tượng thanh công cụ bản sáng và bản tối, logo cho cửa sổ tiện ích", icons.filter((p) => !zip?.file(`synchro-chrome/${p}`)).join(", "));
ok(manifest.permissions?.includes("offscreen") && /MATCH_MEDIA/.test((await file("background.js")) ?? "") && !!(await file("theme.html")), "đổi logo trên thanh công cụ theo theme sáng / tối của trình duyệt");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
