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
//         trong máy chạy trình duyệt; readDownload?(u, tên) → nội dung tệp đã tải (Buffer); ports?(u) → cổng server đang chạy (trang tab mới) }.
import crypto from "node:crypto";
import http from "node:http";
import { WebSocket } from "ws";
import { BrowserError, createActor } from "./browser-act.mjs";

export { BrowserError };

const DEBUG = !!process.env.SYNCHRO_BROWSER_DEBUG;
// Tệp đã tải về đọc lại được cho model (browser_downloads op "read").
const MAX_READ = 15 * 1024 * 1024;

export class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.subs = new Map(); this.closed = false;
    ws.on("message", (m) => {
      let j; try { j = JSON.parse(m.toString()); } catch { return; }
      if (j.id && this.wait.has(j.id)) { const w = this.wait.get(j.id); this.wait.delete(j.id); j.error ? w.rej(new Error(j.error.message)) : w.res(j.result); }
      // Sự kiện của phiên con (khung con khác nguồn, nối bằng Target.setAutoAttach flatten) kèm sessionId.
      else if (j.method) for (const f of this.subs.get(j.method) ?? []) f(j.params, j.sessionId);
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
  send(method, params = {}, timeout = 20_000, sessionId) {
    if (this.closed) return Promise.reject(new Error("Trình duyệt đã ngắt kết nối"));
    const id = ++this.id;
    const t0 = Date.now();
    const slow = () => { const ms = Date.now() - t0; if (DEBUG && ms > 1000) console.log(`[browser] ${method} ${ms} ms`); };
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.wait.delete(id); slow(); rej(new Error(`${method}: quá thời gian`)); }, timeout);
      this.wait.set(id, { res: (v) => { clearTimeout(t); slow(); res(v); }, rej: (e) => { clearTimeout(t); slow(); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
  // icon: biểu tượng trang (Chrome đã tải sẵn) để hàng tab giống trình duyệt thường; chỉ địa chỉ http(s) công khai.
  const tabOf = (x) => ({ id: x.id, title: x.title, url: x.url, ...(/^https?:\/\//.test(x.faviconUrl ?? "") && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(x.faviconUrl) ? { icon: x.faviconUrl } : {}) });
  // Kiểu con trỏ tại một điểm của trang (bàn tay trên liên kết, dấu gõ chữ trên ô nhập / chữ…) để khung xem đổi con trỏ như trình duyệt thật.
  const CURSOR_AT = (x, y) => `(() => { const e = document.elementFromPoint(${x}, ${y}); if (!e) return "default";
    const c = getComputedStyle(e).cursor; if (c && c !== "auto") return c;
    if (e.closest("a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label,select,summary,[onclick]")) return "pointer";
    if (e.closest("input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),textarea,[contenteditable=''],[contenteditable=true]")) return "text";
    return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? "text" : "default"; })()`;
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
      bc.on("Browser.downloadWillBegin", (p) => { s.downloads.unshift({ id: p.guid, name: p.suggestedFilename, url: p.url, path: `${dir}/${p.suggestedFilename}`, state: "inProgress", at: Date.now() }); s.downloads.length = Math.min(s.downloads.length, 30); emit(u, { t: "download", name: p.suggestedFilename, state: "inProgress" }); });
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
    // Tab đang dùng đã đóng (cửa sổ bật lên tự đóng): quay về tab dùng trước đó.
    const t = list.find((x) => x.id === s.tab) ?? [...(s.hist ?? [])].reverse().map((id) => list.find((x) => x.id === id)).find(Boolean) ?? list[0];
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
    // Quyền của trang (thông báo, vị trí, micro / camera, bộ nhớ tạm): đặt ở cấp trình duyệt, như người dùng bấm Cho phép / Chặn.
    permission: async (u, { origin, name, setting }) => {
      const bc = await browserLevel(u);
      for (const n of name === "clipboard" ? ["clipboard-read", "clipboard-write"] : [name]) await bc.send("Browser.setPermission", { permission: { name: n }, setting: setting === "allow" ? "granted" : "denied", origin });
    },
    readDownload: async (u, d) => {
      if (!host.readDownload) throw new BrowserError(400, "Nơi này chưa đọc lại được tệp đã tải.");
      const buf = await host.readDownload(u, d.name);
      if (buf.length > MAX_READ) throw new BrowserError(413, `Tệp "${d.name}" lớn quá (${Math.round(buf.length / 1048576)} MB) để đọc lại; tối đa ${MAX_READ / 1048576} MB.`);
      return { data: buf.toString("base64"), size: buf.length, mime: "" };
    },
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
    // dpr: mật độ điểm ảnh của màn hình người xem (Retina = 2) để chữ nét; bin: khung hình gửi dạng nhị phân (không base64).
    // Chromium chạy với --force-device-scale-factor=2 (workspace/browser.sh): khung phát hình vẽ ở 2x, maxWidth thu về đúng màn hình người xem.
    let size = { w: 1280, h: 800, mobile: false, dpr: 1, bin: false };
    let c = null, lastTabs = "";
    const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
    // Khung hình theo nhịp mạng: chỉ báo Chrome đã nhận (ack, Chrome mới vẽ và nén khung kế tiếp) khi khung đã gửi đi; mạng chậm thì
    // Chrome tự giãn nhịp thay vì nén những khung sẽ bỏ, màn hình không trễ dồn; luôn gửi khung mới nhất.
    // Bậc chất lượng tự cân theo mạng (mức nén, mật độ điểm ảnh tối đa của khung phát).
    const STEPS = [{ q: 76, d: 2 }, { q: 66, d: 2 }, { q: 62, d: 1.5 }, { q: 56, d: 1.25 }, { q: 50, d: 1 }];
    // Người xem báo đã nhận từng khung (fa, khi trình duyệt xin "fa: true"): tối đa 2 khung đang trên đường đi, đo được thời gian
    // một khung tới nơi — bộ đệm mạng của hệ điều hành / nginx chứa được hàng chục khung nên không dựa vào bufferedAmount được.
    // Khung tới nơi chậm (>220 ms) thì hạ bậc, hai nhịp liền nhanh (<130 ms) thì nâng lại. Người xem bản cũ: chờ bufferedAmount như trước.
    let latest = null, flushT = null, meta = "", qi = 0, waited = 0, sent = 0, calm = 0, tuned = Date.now(), lastBytes = 0;
    let inflight = 0, ackSum = 0, ackN = 0;
    const sentAt = [];
    const e2e = () => size.bin && size.fa;
    const castDpr = () => Math.min(size.dpr, STEPS[qi].d);
    const tune = () => {
      const now = Date.now(), span = now - tuned;
      if (span < 1500 || (e2e() ? ackN < 3 : sent < 3)) return;
      const prev = qi, ratio = waited / span, avg = ackN ? ackSum / ackN : 0;
      const slow = e2e() ? avg > 220 : ratio > 0.35, fast = e2e() ? avg < 130 : ratio < 0.08;
      if (slow) { calm = 0; qi = Math.min(STEPS.length - 1, qi + ((e2e() ? avg > 500 : ratio > 0.7) ? 2 : 1)); }
      else if (fast) { if (++calm >= 2 && qi > 0) { qi--; calm = 0; } }
      else calm = 0;
      waited = 0; sent = 0; ackSum = 0; ackN = 0; tuned = now;
      if (qi === prev) return;
      send({ t: "quality", step: qi, q: STEPS[qi].q, d: castDpr() });
      c?.send("Page.stopScreencast").catch(() => {}).finally(() => startCast());
    };
    const flush = () => {
      flushT = null;
      if (!latest || ws.readyState !== WebSocket.OPEN) return;
      if (e2e() ? inflight >= 2 : ws.bufferedAmount > Math.max(48_000, lastBytes * 0.5)) { latest.waitFrom ??= Date.now(); if (!e2e()) flushT = setTimeout(flush, 8); return; }
      const f = latest; latest = null;
      if (f.waitFrom) waited += Date.now() - f.waitFrom;
      if (!size.bin) { send({ t: "frame", data: f.data, w: f.w, h: f.h }); lastBytes = f.data.length; }
      else {
        const m = `${f.w}x${f.h}`;
        if (m !== meta) { meta = m; send({ t: "meta", w: f.w, h: f.h }); }
        const buf = Buffer.from(f.data, "base64");
        lastBytes = buf.length;
        ws.send(buf);
        if (e2e()) { inflight++; sentAt.push(Date.now()); }
      }
      sent++;
      f.ack();
      tune();
    };
    const sendInfo = async () => { if (c) send({ t: "nav", ...(await info(c)) }); };
    const pushTabs = async () => {
      try {
        const list = (await pages(u)).map(tabOf);
        const j = JSON.stringify([list, s.tab]);
        if (j !== lastTabs) { lastTabs = j; send({ t: "tabs", list, active: s.tab }); }
      } catch {}
    };
    const metrics = () => c.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: size.dpr, mobile: size.mobile }).catch(() => {});
    // Chưa có khung nào sau 1,5 giây (trang tĩnh chưa vẽ lại, phát hình bị kết nối khác tắt): bật lại để màn hình không đứng.
    let lastFrame = 0, watch = null;
    const startCast = async () => {
      const cc = c, at = Date.now();
      const d = castDpr();
      await cc.send("Page.startScreencast", { format: "jpeg", quality: STEPS[qi].q + (d > 1 ? 0 : 8), maxWidth: Math.round(size.w * d), maxHeight: Math.round(size.h * d), everyNthFrame: 1 }).catch(() => {});
      clearTimeout(watch);
      watch = setTimeout(() => { if (!gone && c === cc && lastFrame < at) cc.send("Page.stopScreencast").catch(() => {}).finally(() => startCast()); }, 1500);
    };
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
      // w, h: kích thước trang theo điểm ảnh CSS (tọa độ chuột / phím gửi lại theo đơn vị này), ảnh có thể lớn hơn theo dpr.
      n.on("Page.screencastFrame", (p) => {
        const ack = () => n.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
        if (n !== c) return ack();
        lastFrame = Date.now();
        latest?.ack();
        latest = { data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight, ack };
        if (!flushT) flush();
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
    // Con trỏ: dò kiểu con trỏ ở vị trí chuột mới nhất (tối đa ~12 lần / giây), chỉ gửi khi đổi.
    let cursor = "default", cursorAt = null, cursorBusy = false;
    const probeCursor = async () => {
      if (cursorBusy || !cursorAt || !c || s.dialog) return;
      cursorBusy = true;
      const { x, y } = cursorAt; cursorAt = null;
      try {
        const r = await c.send("Runtime.evaluate", { expression: CURSOR_AT(Math.round(x), Math.round(y)), returnByValue: true }, 2000);
        const v = String(r?.result?.value ?? "default").slice(0, 40);
        if (v !== cursor) { cursor = v; send({ t: "cursor", c: v }); }
      } catch {} finally { cursorBusy = false; if (cursorAt) setTimeout(probeCursor, 80); }
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
        if (j.t === "fa") {
          // Người xem đã nhận một khung: mở chỗ cho khung kế tiếp, ghi thời gian khung đó đi tới nơi.
          inflight = Math.max(0, inflight - 1);
          const t0 = sentAt.shift();
          if (t0) { ackSum += Date.now() - t0; ackN++; }
          if (latest && !flushT) flush();
          return;
        }
        if (j.t === "size") {
          const w = Math.max(320, Math.min(j.w | 0, 2560)), h = Math.max(240, Math.min(j.h | 0, 1600));
          // Màn hình mật độ cao: tối đa 2x, khung rất lớn thì hạ xuống để hình vẫn đi kịp qua mạng.
          let dpr = Math.max(1, Math.min(Number(j.dpr) || 1, 2));
          while (dpr > 1 && w * h * dpr * dpr > 4_200_000) dpr = Math.max(1, dpr - 0.25);
          size = { w, h, mobile: !!j.mobile, dpr, bin: j.bin === true, fa: j.fa === true };
          inflight = 0; sentAt.length = 0;
          meta = "";
          await metrics();
          await c.send("Page.stopScreencast").catch(() => {});
          await startCast();
        } else if (j.t === "mouse") {
          await c.send("Input.dispatchMouseEvent", { type: j.type, x: +j.x, y: +j.y, button: j.button ?? "left", buttons: j.buttons ?? 0, clickCount: j.clickCount ?? 0, modifiers: j.mod ?? 0 });
          if (j.type === "mouseMoved") { const first = !cursorAt; cursorAt = { x: +j.x, y: +j.y }; if (first) setTimeout(probeCursor, 80); }
        } else if (j.t === "wheel") {
          await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: +j.x, y: +j.y, deltaX: +j.dx || 0, deltaY: +j.dy || 0 });
        } else if (j.t === "key") {
          await c.send("Input.dispatchKeyEvent", { type: j.type, key: j.key, code: j.code, text: j.text, unmodifiedText: j.text, windowsVirtualKeyCode: j.kc ?? 0, modifiers: j.mod ?? 0 });
        } else if (j.t === "text") {
          await c.send("Input.insertText", { text: String(j.text ?? "") });
        } else if (j.t === "go") {
          await act(u, { action: "navigate", url: j.url, user: true }).catch((e) => send({ t: "error", error: e.message }));
        } else if (j.t === "html") {
          const html = String(j.html ?? "").slice(0, 5_000_000);
          await c.send("Page.navigate", { url: "data:text/html;charset=utf-8;base64," + Buffer.from(html).toString("base64") });
        } else if (j.t === "back" || j.t === "forward" || j.t === "reload") {
          await act(u, { action: "navigate", url: j.t, user: true });
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
    // Người xem rời đi: chỉ đóng kết nối (phát hình của kết nối đó tự dừng). Không gửi stopScreencast: lệnh này tới muộn sẽ tắt luôn
    // phát hình của người xem mới trên cùng tab (đóng rồi mở lại khung trình duyệt thì màn hình đứng).
    const bye = () => { clearTimeout(flushT); clearTimeout(watch); latest?.ack(); latest = null; s.viewers.delete(viewer); host.sock?.(u, -1); clearInterval(poll); if (c) { c.switching = true; c.close(); } };
    if (gone) bye(); else ws.on("close", bye);
  }

  /** Trình duyệt / container vừa khởi động lại: bỏ các kết nối cũ. */
  const reset = (u) => { const s = st(u); s.cdp?.close(); s.cdp = null; s.bc?.close(); s.bc = null; s.dialog = null; };

  // ---------------------------------------------------------------- cookie và đăng nhập
  // Xóa sạch dữ liệu duyệt web: mọi cookie, bộ nhớ của các trang đã mở (localStorage, IndexedDB, service worker…), đóng mọi tab.
  const origins = (u) => (st(u).origins ??= new Set());
  async function wipe(u) {
    const s = st(u);
    s.base = await host.up(u);
    const bc = await browserLevel(u);
    await bc.send("Storage.clearCookies", {}).catch(() => {});
    for (const o of origins(u)) await bc.send("Storage.clearDataForOrigin", { origin: o, storageTypes: "all" }).catch(() => {});
    origins(u).clear();
    // Quyền đã cấp cho trang (vị trí, thông báo…), tệp đã tải, tab vừa dùng, chữ đã chép của phiên trước cũng không theo sang phiên sau.
    await bc.send("Browser.resetPermissions", {}).catch(() => {});
    s.downloads = []; s.hist = []; s.chooser = null; s.clip = undefined;
    const list = await pages(u);
    const blank = await devtools(u, "/json/new?about:blank", "PUT");
    for (const t of list) await devtools(u, `/json/close/${t.id}`).catch(() => {});
    s.tab = blank.id; s.cdp?.close(); s.cdp = null; s.dialog = null;
    for (const v of s.viewers) v.follow?.(blank.id);
    return { ok: true, wiped: true, url: "about:blank" };
  }
  // Thao tác của model. cookies = "session": mỗi phiên (scope) dùng trình duyệt sạch, phiên sau không thấy đăng nhập của phiên trước.
  async function tool(u, b) {
    if (b.action === "wipe") return wipe(u);
    const s = st(u);
    if (b.cookies === "session" && b.scope && s.scope !== b.scope) await wipe(u);
    if (b.scope) s.scope = b.scope;
    const r = await A.tool(u, b);
    try { const o = new URL(String(r?.url ?? "")).origin; if (/^https?:/.test(o)) origins(u).add(o); } catch {}
    return r;
  }
  return { tool, screen, reset, wipe, state: st };
}
