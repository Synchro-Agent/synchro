// Lõi trình duyệt của Synchro: Chromium điều khiển qua CDP (Chrome DevTools Protocol). Dùng chung cho
// - dịch vụ workspace trên VPS (workspace/agent.mjs): Chromium trong container của từng người dùng;
// - workspace giả lập khi chạy dev:mock (scripts/mock-workspace.mjs): Chrome thật trên máy đang chạy.
// Hai phần:
// - tool(u, a): thao tác cho model (mọi model, qua công cụ browser_* của Synchro): mở trang, đọc trang thành cây có [ref],
//   tìm, chụp màn hình, bấm, rê chuột, gõ, nhấn phím, chọn, cuộn, kéo thả, tải tệp lên, chờ, chạy JS, tab, gộp nhiều thao tác
//   (phần thao tác nằm ở workspace/browser-act.mjs, dùng chung với tiện ích Synchro cho Chrome của người dùng).
// - screen(ws, u): truyền hình trực tiếp tới khung trình duyệt của người dùng, nhận chuột / bàn phím của họ, và báo cho
//   người xem biết Synchro đang làm gì (điểm bấm, chữ đang gõ) để họ theo dõi hoặc giành lại quyền điều khiển bất cứ lúc nào.
// host: { up(u) → "http://host:cổng" của DevTools (bật trình duyệt nếu chưa chạy); touch(u); sock(u, ±1); downloads(u) → thư mục tải về
//         trong máy chạy trình duyệt; ports?(u) → cổng server đang chạy (trang tab mới) }.
import crypto from "node:crypto";
import http from "node:http";
import { WebSocket } from "ws";
import { BrowserError, createActor } from "./browser-act.mjs";

export { BrowserError };

const DEBUG = !!process.env.SYNCHRO_BROWSER_DEBUG;

export class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.subs = new Map(); this.closed = false;
    ws.on("message", (m) => {
      let j; try { j = JSON.parse(m.toString()); } catch { return; }
      if (j.id && this.wait.has(j.id)) { const w = this.wait.get(j.id); this.wait.delete(j.id); j.error ? w.rej(new Error(j.error.message)) : w.res(j.result); }
      else if (j.method) for (const f of this.subs.get(j.method) ?? []) f(j.params);
    });
    ws.on("close", () => { this.closed = true; for (const w of this.wait.values()) w.rej(new Error("Trình duyệt đã ngắt kết nối")); this.wait.clear(); for (const f of this.subs.get("close") ?? []) f(); });
    ws.on("error", () => {});
  }
  static open(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
      const t = setTimeout(() => { ws.terminate(); rej(new Error("Không kết nối được trình duyệt")); }, 8000);
      ws.once("open", () => { clearTimeout(t); res(new CDP(ws)); });
      ws.once("error", (e) => { clearTimeout(t); rej(e); });
    });
  }
  send(method, params = {}, timeout = 20_000) {
    if (this.closed) return Promise.reject(new Error("Trình duyệt đã ngắt kết nối"));
    const id = ++this.id;
    const t0 = Date.now();
    const slow = () => { const ms = Date.now() - t0; if (DEBUG && ms > 1000) console.log(`[browser] ${method} ${ms} ms`); };
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.wait.delete(id); slow(); rej(new Error(`${method}: quá thời gian`)); }, timeout);
      this.wait.set(id, { res: (v) => { clearTimeout(t); slow(); res(v); }, rej: (e) => { clearTimeout(t); slow(); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(ev, f) { if (!this.subs.has(ev)) this.subs.set(ev, []); this.subs.get(ev).push(f); return () => this.subs.set(ev, (this.subs.get(ev) ?? []).filter((x) => x !== f)); }
  once(ev, ms) { return new Promise((res) => { const off = this.on(ev, (p) => { off(); clearTimeout(t); res(p); }); const t = setTimeout(() => { off(); res(null); }, ms); }); }
  close() { try { this.ws.close(); } catch {} }
}

/** Vé WebSocket do máy chủ Next ký (HMAC): { u, d, k, exp }. */
export function verifyTicket(secret, t, okUser, okDir) {
  const [body, sig] = String(t ?? "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest()).toString("base64url");
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString());
    return o.exp > Date.now() && okUser(o.u) && okDir(o.d) ? o : null;
  } catch { return null; }
}

// Gọi HTTP của DevTools (/json/list, /json/new…): mỗi lần một kết nối mới, có hẹn giờ cứng. Không dùng fetch: máy chủ HTTP
// của DevTools giữ kết nối sống nhưng có lúc không trả lời yêu cầu thứ hai trên cùng kết nối, fetch treo tới vài phút.
export function devJson(url, method = "GET", timeout = 5000) {
  return new Promise((res, rej) => {
    const req = http.request(url, { method, agent: false, headers: { connection: "close" } }, (r) => {
      let b = "";
      r.setEncoding("utf8");
      r.on("data", (c) => { b += c; });
      r.on("end", () => {
        clearTimeout(t);
        if ((r.statusCode ?? 0) >= 400) return rej(new Error(`DevTools ${r.statusCode}`));
        try { res(JSON.parse(b || "null")); } catch { res(b); }
      });
      r.on("error", (e) => { clearTimeout(t); rej(e); });
    });
    const t = setTimeout(() => req.destroy(new Error("DevTools: quá thời gian")), timeout);
    req.on("error", (e) => { clearTimeout(t); rej(e); });
    req.end();
  });
}

export function createBrowser(host) {
  const S = new Map(); // u -> { tab, cdp, base, dialog, dialogs, downloads, viewers:Set, acting, bc }
  const st = (u) => { let s = S.get(u); if (!s) { s = { tab: "", cdp: null, base: "", dialog: null, dialogs: [], downloads: [], viewers: new Set(), acting: 0, bc: null, ua: "" }; S.set(u, s); } return s; };
  const emit = (u, o) => { for (const v of st(u).viewers) v.send(o); };

  const devtools = (u, path, method = "GET") => devJson(`${st(u).base}${path}`, method);
  const wsUrl = (u, raw) => { const s = st(u); const b = new URL(s.base); const x = new URL(raw); x.host = b.host; return x.toString(); };
  const pages = async (u) => (await devtools(u, "/json/list")).filter((t) => t.type === "page");
  const tabOf = (x) => ({ id: x.id, title: x.title, url: x.url });
  const pageWs = (u, id) => `ws://${new URL(st(u).base).host}/devtools/page/${id}`;

  // Kết nối cấp trình duyệt: tải tệp về thư mục của người dùng, theo dõi tệp đang tải.
  async function browserLevel(u) {
    const s = st(u);
    if (s.bc && !s.bc.closed) return s.bc;
    const v = await devtools(u, "/json/version");
    s.ua = String(v["User-Agent"] ?? "").replace("HeadlessChrome", "Chrome");
    const bc = await CDP.open(wsUrl(u, v.webSocketDebuggerUrl));
    s.bc = bc;
    const dir = host.downloads?.(u);
    if (dir) {
      await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true }).catch(() => {});
      bc.on("Browser.downloadWillBegin", (p) => { s.downloads.unshift({ id: p.guid, name: p.suggestedFilename, url: p.url, state: "inProgress", at: Date.now() }); s.downloads.length = Math.min(s.downloads.length, 30); emit(u, { t: "download", name: p.suggestedFilename, state: "inProgress" }); });
      bc.on("Browser.downloadProgress", (p) => { const d = s.downloads.find((x) => x.id === p.guid); if (d && p.state !== "inProgress") { d.state = p.state; d.bytes = p.totalBytes; emit(u, { t: "download", name: d.name, state: p.state }); } });
    }
    return bc;
  }

  // Bật trình duyệt nếu chưa chạy; trả về tab đang dùng (tab người dùng hay agent chọn gần nhất, mặc định tab đầu).
  async function activeTab(u) {
    const s = st(u);
    s.base = await host.up(u);
    await browserLevel(u).catch(() => {});
    let list = await pages(u);
    if (!list.length) { await devtools(u, "/json/new?about:blank", "PUT"); list = await pages(u); }
    host.touch?.(u);
    const t = list.find((x) => x.id === s.tab) ?? list[0];
    s.tab = t.id;
    return t;
  }

  // Thao tác của model (workspace/browser-act.mjs) trên tab đang dùng; người xem khung trình duyệt chuyển theo khi agent đổi tab.
  const A = createActor({
    state: st, emit, pages: (u) => pages(u).then((l) => l.map(tabOf)),
    ready: (u) => activeTab(u),
    newTab: async (u, url) => (await devtools(u, `/json/new?${encodeURIComponent(url)}`, "PUT")).id,
    closeTab: (u, id) => devtools(u, `/json/close/${id}`),
    activate: (u, id) => devtools(u, `/json/activate/${id}`).catch(() => {}),
    switched: (u, id) => { const s = st(u); s.cdp?.close(); s.cdp = null; for (const v of s.viewers) v.follow?.(id); },
    session: (u) => agentCdp(u),
    touch: host.touch, downloadsDir: host.downloads, allowFile: !!host.allowFile,
    humanize: true, ua: (u) => st(u).ua, timezone: host.timezone,
  });

  // Kết nối điều khiển dùng chung của agent: giữ log console và yêu cầu mạng gần đây để model đọc lại.
  async function agentCdp(u) {
    const s = st(u);
    if (s.cdp && !s.cdp.closed && s.cdp.tid === s.tab) return s.cdp;
    s.cdp?.close();
    const t = await activeTab(u);
    const c = await CDP.open(pageWs(u, t.id));
    c.tid = t.id;
    await A.prepare(u, c);
    // Không ai đang xem: dùng khung nhìn máy tính chuẩn (người xem đặt kích thước theo khung của họ).
    if (!s.viewers.size) await c.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    s.cdp = c;
    return c;
  }
  const info = A.info, act = A.act, handleDialog = A.handleDialog;

  // ---------------------------------------------------------------- màn hình trực tiếp cho người dùng
  async function screen(ws, u) {
    const queue = [];
    let handle = null, gone = false;
    ws.on("message", (m) => (handle ? handle(m) : queue.push(m)));
    ws.on("close", () => { gone = true; });
    const s = st(u);
    await activeTab(u);
    if (gone) return;
    host.sock?.(u, 1);
    let size = { w: 1280, h: 800, mobile: false };
    let c = null, lastTabs = "";
    const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
    const sendInfo = async () => { if (c) send({ t: "nav", ...(await info(c)) }); };
    const pushTabs = async () => {
      try {
        const list = (await pages(u)).map(tabOf);
        const j = JSON.stringify([list, s.tab]);
        if (j !== lastTabs) { lastTabs = j; send({ t: "tabs", list, active: s.tab }); }
      } catch {}
    };
    const metrics = () => c.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.mobile }).catch(() => {});
    const startCast = () => c.send("Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 }).catch(() => {});
    // Gắn màn hình vào một tab (đổi tab = đóng kết nối cũ, mở kết nối tới tab mới). Agent làm việc trên cùng tab này.
    const attach = async (id) => {
      const list = await pages(u);
      let target = list.find((x) => x.id === id) ?? list.find((x) => x.id === s.tab) ?? list[0];
      if (!target) target = await devtools(u, "/json/new?about:blank", "PUT");
      const old = c;
      if (old) { old.switching = true; old.close(); }
      const n = await CDP.open(pageWs(u, target.id));
      c = n;
      if (s.tab !== target.id) { s.tab = target.id; s.cdp?.close(); s.cdp = null; }
      n.on("Page.screencastFrame", (p) => {
        send({ t: "frame", data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight });
        n.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      });
      n.on("Page.frameNavigated", (p) => { if (!p.frame.parentId) { send({ t: "nav", url: p.frame.url }); pushTabs(); } });
      n.on("Page.loadEventFired", () => { sendInfo(); pushTabs(); });
      n.on("Page.frameStartedLoading", () => send({ t: "loading", on: true }));
      n.on("Page.frameStoppedLoading", () => send({ t: "loading", on: false }));
      A.watchDialogs(u, n);
      n.on("close", () => { if (!n.switching && !gone) attach().catch(() => ws.close(1011, "browser closed")); });
      await n.send("Page.enable");
      await A.humanize(u, n);
      await metrics();
      await startCast();
      await sendInfo();
      await pushTabs();
      if (s.dialog) send({ t: "dialog", type: s.dialog.type, message: s.dialog.message, def: s.dialog.def });
    };
    const viewer = { send, follow: (id) => { attach(id).catch(() => {}); } };
    s.viewers.add(viewer);
    await attach(s.tab);
    if (s.acting > 0) send({ t: "agent", kind: "start" });
    // Tab mới do trang mở (window.open, target=_blank) hoặc do agent: cập nhật danh sách định kỳ.
    const poll = setInterval(pushTabs, 2000);
    let lastTouch = 0;
    handle = async (m) => {
      const now = Date.now(); if (now - lastTouch > 10_000) { lastTouch = now; host.touch?.(u); }
      let j; try { j = JSON.parse(m.toString()); } catch { return; }
      try {
        if (j.t === "size") {
          size = { w: Math.max(320, Math.min(j.w | 0, 2560)), h: Math.max(240, Math.min(j.h | 0, 1600)), mobile: !!j.mobile };
          await metrics();
          await c.send("Page.stopScreencast").catch(() => {});
          await startCast();
        } else if (j.t === "mouse") {
          await c.send("Input.dispatchMouseEvent", { type: j.type, x: +j.x, y: +j.y, button: j.button ?? "left", buttons: j.buttons ?? 0, clickCount: j.clickCount ?? 0, modifiers: j.mod ?? 0 });
        } else if (j.t === "wheel") {
          await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: +j.x, y: +j.y, deltaX: +j.dx || 0, deltaY: +j.dy || 0 });
        } else if (j.t === "key") {
          await c.send("Input.dispatchKeyEvent", { type: j.type, key: j.key, code: j.code, text: j.text, unmodifiedText: j.text, windowsVirtualKeyCode: j.kc ?? 0, modifiers: j.mod ?? 0 });
        } else if (j.t === "text") {
          await c.send("Input.insertText", { text: String(j.text ?? "") });
        } else if (j.t === "go") {
          await act(u, { action: "navigate", url: j.url }).catch((e) => send({ t: "error", error: e.message }));
        } else if (j.t === "html") {
          const html = String(j.html ?? "").slice(0, 5_000_000);
          await c.send("Page.navigate", { url: "data:text/html;charset=utf-8;base64," + Buffer.from(html).toString("base64") });
        } else if (j.t === "back" || j.t === "forward" || j.t === "reload") {
          await act(u, { action: "navigate", url: j.t });
        } else if (j.t === "tab") {
          if (j.id !== s.tab) await attach(String(j.id));
        } else if (j.t === "newtab") {
          const nt = await devtools(u, `/json/new?${encodeURIComponent(String(j.url ?? "about:blank"))}`, "PUT");
          await attach(nt.id);
        } else if (j.t === "closetab") {
          const id = String(j.id);
          const list = await pages(u);
          if (list.length <= 1) await devtools(u, "/json/new?about:blank", "PUT");
          const next = (await pages(u)).find((x) => x.id !== id);
          if (id === s.tab && next) await attach(next.id);
          await devtools(u, `/json/close/${id}`).catch(() => {});
          lastTabs = ""; await pushTabs();
        } else if (j.t === "dialog") {
          await handleDialog(u, !!j.accept, j.text);
        } else if (j.t === "clear") {
          await c.send("Network.clearBrowserCookies").catch(() => {});
          await c.send("Network.clearBrowserCache").catch(() => {});
          await c.send("Storage.clearDataForOrigin", { origin: "*", storageTypes: "all" }).catch(() => {});
          send({ t: "cleared" });
        } else if (j.t === "ports") {
          send({ t: "ports", list: host.ports ? await host.ports(u).catch(() => []) : [] });
        }
      } catch (e) { send({ t: "error", error: e.message }); }
    };
    for (const m of queue.splice(0)) handle(m);
    const bye = () => { s.viewers.delete(viewer); host.sock?.(u, -1); clearInterval(poll); if (c) { c.switching = true; c.send("Page.stopScreencast").catch(() => {}).finally(() => c.close()); } };
    if (gone) bye(); else ws.on("close", bye);
  }

  /** Trình duyệt / container vừa khởi động lại: bỏ các kết nối cũ. */
  const reset = (u) => { const s = st(u); s.cdp?.close(); s.cdp = null; s.bc?.close(); s.bc = null; s.dialog = null; };
  return { tool: A.tool, screen, reset, state: st };
}
