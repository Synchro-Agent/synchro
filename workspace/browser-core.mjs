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
//         trong máy chạy trình duyệt; readDownload?(u, tên) → nội dung tệp đã tải (Buffer); ports?(u) → cổng server đang chạy (trang tab mới);
//         pageVideo?: true → máy không có ffmpeg thì nén video ngay trong Chromium (workspace/browser-video.mjs) }.
import crypto from "node:crypto";
import http from "node:http";
import { WebSocket } from "ws";
import { BrowserError, createActor } from "./browser-act.mjs";
import { ffmpegBin, ffmpegEncoder, isEncoderTab, jpegSize, openEncoderPage, videoOff } from "./browser-video.mjs";

export { BrowserError };

const DEBUG = !!process.env.SYNCHRO_BROWSER_DEBUG;
// Tệp đã tải về đọc lại được cho model (browser_downloads op "read").
const MAX_READ = 15 * 1024 * 1024;
// Chất lượng JPEG Chrome chụp khi truyền bằng video (ảnh chỉ đi tới bộ nén trên máy chủ, không qua mạng của người xem). 70: Chrome
// chụp / ffmpeg đọc nhẹ hơn, sau khi nén x264 nhìn không khác 85.
const VIDEO_Q = 70;
// Đang cuộn / kéo (bánh xe, kéo thanh cuộn, phím cuộn): Chrome chụp ở mật độ này cho nhanh (đo trên VPS 2 CPU: 2x 20 → 1,5x 25 khung / giây),
// bộ nén phóng lên cỡ khung 2x; dừng MOTION_MS thì chụp lại 2x (chữ đứng yên luôn sắc nét). Gõ chữ luôn ở 2x.
const MOTION_DPR = 1.5, MOTION_MS = 350;

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
  // Tab nén video (workspace/browser-video.mjs) là tab ẩn của Synchro: không phải tab của người dùng hay của model.
  const pages = async (u) => (await devtools(u, "/json/list")).filter((t) => t.type === "page" && !isEncoderTab(t) && t.id !== st(u).venc?.id);
  // icon: biểu tượng trang (Chrome đã tải sẵn) để hàng tab giống trình duyệt thường; chỉ địa chỉ http(s) công khai.
  const tabOf = (x) => ({ id: x.id, title: x.title, url: x.url, ...(/^https?:\/\//.test(x.faviconUrl ?? "") && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(x.faviconUrl) ? { icon: x.faviconUrl } : {}) });
  // Kiểu con trỏ tại một điểm của trang (bàn tay trên liên kết, dấu gõ chữ trên ô nhập / chữ…) để khung xem đổi con trỏ như trình duyệt thật.
  const CURSOR_AT = (x, y) => `(() => { const e = document.elementFromPoint(${x}, ${y}); if (!e) return "default";
    const c = getComputedStyle(e).cursor; if (c && c !== "auto") return c;
    if (e.closest("a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label,select,summary,[onclick]")) return "pointer";
    if (e.closest("input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),textarea,[contenteditable=''],[contenteditable=true]")) return "text";
    return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? "text" : "default"; })()`;
  // Vùng cuộn dưới con trỏ, để khung xem dịch trang ngay khi người dùng cuộn (dự đoán cuộn) thay vì chờ hình từ máy chủ:
  // root — bánh xe ở đây cuộn cả trang (không có vùng cuộn riêng như khung chat, danh sách); top / bottom — chiều cao thanh cố định / dính
  // ở mép trên / dưới (đứng yên khi cuộn, khung xem không dịch phần đó); max — vị trí cuộn lớn nhất; bg — màu nền (phần lộ ra khi dịch).
  const SCROLL_AT = (x, y) => `(() => { const se = document.scrollingElement || document.documentElement, H = innerHeight, W = innerWidth;
    const skip = (e) => !e || e === se || e === document.body || e === document.documentElement;
    let root = se.scrollHeight > H + 1;
    for (let e = document.elementFromPoint(${x}, ${y}); !skip(e); e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === "auto" || o === "scroll" || o === "overlay") && e.scrollHeight > e.clientHeight + 1) { root = false; break; }
    }
    const edge = (py, top) => { let v = 0; for (const px of [W * 0.1, W * 0.5, W * 0.9]) {
      for (let e = document.elementFromPoint(px, py); !skip(e); e = e.parentElement) {
        const p = getComputedStyle(e).position;
        if (p === "fixed" || p === "sticky") { const r = e.getBoundingClientRect(); if (r.height < H * 0.4 && r.width > W * 0.5) v = Math.max(v, top ? r.bottom : H - r.top); break; }
      } } return Math.max(0, Math.min(v, H * 0.4)); };
    let top = 0; for (const py of [2, 24, 48, 72]) top = Math.max(top, edge(py, true));
    let bottom = 0; for (const py of [H - 2, H - 24]) bottom = Math.max(bottom, edge(py, false));
    const bg = (e) => { const c = e && getComputedStyle(e).backgroundColor; return c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c) ? c : ""; };
    return { root, top: Math.round(top), bottom: Math.round(bottom), max: Math.max(0, Math.round(se.scrollHeight - H)), bg: bg(document.body) || bg(document.documentElement) || "rgb(255, 255, 255)" }; })()`;
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

  // Bộ nén video trong Chromium (một tab ẩn cho mỗi trình duyệt), chỉ dùng khi host cho phép và máy không có ffmpeg.
  async function pageVideo(u) {
    const s = st(u);
    if (s.venc && !s.venc.closed) return s.venc;
    return (s.vencP ??= (async () => {
      const bc = await browserLevel(u);
      s.venc = await openEncoderPage(bc, (id) => CDP.open(pageWs(u, id)));
      return s.venc;
    })().finally(() => { s.vencP = null; }));
  }
  /** Nguồn bộ nén video cho người xem: hàm tạo bộ nén (async), hoặc null nếu chỉ có JPEG. */
  async function videoMaker(u) {
    if (videoOff()) return null;
    const bin = await ffmpegBin();
    if (bin) return async (o) => ffmpegEncoder(bin, o);
    if (!host.pageVideo || process.env.SYNCHRO_VIDEO === "ffmpeg") return null;
    if (!(await pageVideo(u).catch(() => null))) return null;
    return async (o) => (await pageVideo(u).catch(() => null))?.encoder(o) ?? null;
  }

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
    let size = { w: 1280, h: 800, mobile: false, dpr: 1, bin: false, vq: VIDEO_Q };
    let c = null, lastTabs = "";
    const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
    // Khung hình theo nhịp mạng: chỉ báo Chrome đã nhận (ack, Chrome mới vẽ và nén khung kế tiếp) khi khung đã gửi đi; mạng chậm thì
    // Chrome tự giãn nhịp thay vì nén những khung sẽ bỏ, màn hình không trễ dồn; luôn gửi khung mới nhất.
    // Bậc chất lượng tự cân theo mạng (mức nén, mật độ điểm ảnh tối đa của khung phát).
    // Giữ 2x lâu nhất có thể (chữ nét), chỉ hạ mức nén; mạng rất chậm mới hạ độ phân giải. Màn hình đứng yên thì gửi thêm một khung
    // 2x chất lượng cao (refine) nên lúc đọc vẫn sắc nét dù lúc cuộn đang ở bậc thấp.
    const STEPS = [{ q: 76, d: 2 }, { q: 62, d: 2 }, { q: 50, d: 2 }, { q: 55, d: 1.5 }, { q: 50, d: 1.25 }, { q: 50, d: 1 }];
    // Người xem báo đã nhận từng khung (fa, khi trình duyệt xin "fa: true"): tối đa 2 khung đang trên đường đi, đo được thời gian
    // một khung tới nơi — bộ đệm mạng của hệ điều hành / nginx chứa được hàng chục khung nên không dựa vào bufferedAmount được.
    // Thời gian khung tới nơi trừ đi mức nền (khứ hồi + xử lý cố định, lấy nhỏ nhất gần đây) là phần do cỡ khung / băng thông:
    // >90 ms thì hạ bậc, hai nhịp liền <35 ms thì nâng lại. Người xem bản cũ: chờ bufferedAmount như trước.
    let latest = null, flushT = null, meta = "", qi = 0, waited = 0, sent = 0, calm = 0, tuned = Date.now(), lastBytes = 0;
    let inflight = 0, ackSum = 0, ackN = 0, ackMin = Infinity, base = 0, refineT = null, refined = true, lastRefine = 0, dropUntil = 0, lastInput = 0;
    const sentAt = [];
    // Video (người xem xin "vid: true" và máy chủ có bộ nén, workspace/browser-video.mjs): khung JPEG 2x chất lượng cao vào bộ nén,
    // người xem nhận khung video (1 byte cờ khung khóa + dữ liệu). Tối đa một khung trong bộ nén và 2 khung trên đường đi; bận thì
    // giữ khung mới nhất (Chrome chờ báo nhận) — mạng chậm thì ít khung hơn nhưng khung nào cũng nét. Không cần hạ chất lượng hay refine.
    // mk: hàm tạo bộ nén; vid: { enc, w, h (điểm ảnh của ảnh), css: { w, h }, cfg, sent }; vbusy: lúc đưa khung vào bộ nén (0 = rảnh).
    let mk = null, vid = null, vbusy = 0, lastPushed = null, motion = false, motionT = null, posY = NaN;
    // Số đo từng khâu (người xem xin "stats: true", vd. công cụ đo độ trễ): mỗi 2 giây gửi { t: "stats" } — số khung Chrome gửi, khung bỏ
    // vì đang bận, khung vào / ra bộ nén, thời gian nén, cỡ ảnh JPEG, thời gian từ thao tác của người dùng tới khung Chrome kế tiếp.
    const stat = { cast: 0, drop: 0, push: 0, out: 0, encMs: 0, encMax: 0, jpg: 0, bytes: 0, inLat: [], inAt: 0 };
    const e2e = () => size.bin && size.fa;
    const castDpr = () => Math.min(size.dpr, STEPS[qi].d);
    const tune = () => {
      const now = Date.now(), span = now - tuned;
      if (span < 1500 || (e2e() ? ackN < 3 : sent < 3)) return;
      const prev = qi, ratio = waited / span, avg = ackN ? ackSum / ackN : 0;
      if (ackN) base = base ? Math.min(ackMin, base + 15) : ackMin;
      const excess = avg - base;
      const slow = e2e() ? excess > 90 : ratio > 0.35, fast = e2e() ? excess < 35 : ratio < 0.08;
      if (slow) { calm = 0; qi = Math.min(STEPS.length - 1, qi + ((e2e() ? excess > 300 : ratio > 0.7) ? 2 : 1)); }
      else if (fast) { if (++calm >= 2 && qi > 0) { qi--; calm = 0; } }
      else calm = 0;
      waited = 0; sent = 0; ackSum = 0; ackN = 0; ackMin = Infinity; tuned = now;
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
        // Khung refine lớn hơn hẳn khung thường: không tính vào thời gian khung tới nơi (không làm bộ tự cân tưởng mạng chậm).
        if (e2e()) { inflight++; sentAt.push(f.refine ? 0 : Date.now()); }
      }
      sent++;
      f.ack();
      tune();
      if (size.bin && !f.refine) { refined = false; clearTimeout(refineT); refineT = setTimeout(refine, 350); }
    };
    // Màn hình đứng yên 350 ms khi đang ở bậc thấp (mạng chậm): một khung chất lượng cao ở đúng mật độ điểm ảnh của người xem để
    // chữ sắc nét khi đọc. Tối đa một khung mỗi 2 giây; khung Chrome tự vẽ lại ngay sau lần chụp được bỏ qua (không thành vòng lặp).
    // Chỉ khi người dùng ngừng thao tác 1,2 giây: khung lớn này không chen trước khung của phím vừa gõ (trễ vọt 500–600 ms).
    const refine = async () => {
      refineT = null;
      if (refined || gone || !c || mk || ws.readyState !== WebSocket.OPEN || s.dialog) return;
      if (qi === 0 && castDpr() >= size.dpr) { refined = true; return; }
      const wait = Math.max(latest || (e2e() && inflight >= 2) ? 200 : 0, lastRefine + 2000 - Date.now(), lastInput + 1200 - Date.now());
      if (wait > 0) { refineT = setTimeout(refine, wait); return; }
      refined = true;
      try {
        const r = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 88 }, 5000);
        if (!r?.data || latest || gone) return;
        lastRefine = Date.now(); dropUntil = lastRefine + 300;
        latest = { data: r.data, w: size.w, h: size.h, ack: () => {}, refine: true };
        flush();
      } catch {}
    };
    // Video: đưa khung mới nhất vào bộ nén khi bộ nén rảnh và đường đi còn chỗ.
    const pump = async () => {
      if (!mk || !latest || vbusy || ws.readyState !== WebSocket.OPEN || inflight >= 2) return;
      const f = latest; latest = null;
      const buf = Buffer.from(f.data, "base64"), d = jpegSize(buf);
      if (!d) { f.ack(); return; }
      vbusy = Date.now();
      // Cỡ khung video cố định theo mật độ đầy đủ của người xem; ảnh chụp nhỏ hơn lúc đang cuộn được bộ nén phóng lên.
      const tw = Math.round(size.w * size.dpr), th = Math.round(size.h * size.dpr);
      if (!vid || vid.w !== tw || vid.h !== th) {
        vid?.enc.close();
        vid = null;
        const enc = await mk({ w: tw, h: th }).catch(() => null);
        if (gone || !mk) { enc?.close(); vbusy = 0; f.ack(); return; }
        if (!enc) { f.ack(); return videoFail("không mở được bộ nén"); }
        vid = { enc, w: tw, h: th, css: null, cfg: null, sent: false };
        enc.onConfig = (cfg) => { if (vid?.enc === enc) { vid.cfg = cfg; vid.sent = false; } };
        enc.onFrame = (o) => { if (vid?.enc === enc) out(o); };
        enc.onError = (e) => { if (vid?.enc === enc) videoFail(e); };
      }
      vid.css = { w: f.w, h: f.h }; vid.y = f.y;
      lastPushed = { data: f.data, w: f.w, h: f.h, y: f.y };
      vid.at = Date.now(); stat.push++;
      vid.enc.push(buf);
      f.ack();
    };
    const out = ({ key, data }) => {
      vbusy = 0;
      if (vid?.at) { const d = Date.now() - vid.at; stat.encMs += d; stat.encMax = Math.max(stat.encMax, d); }
      stat.out++; stat.bytes += data.length;
      if (ws.readyState === WebSocket.OPEN) {
        // Cấu hình giải mã đi trước khung khóa đầu tiên của mỗi bộ nén (mở lại khi đổi kích thước / người xem xin khung khóa).
        if (!vid.sent) {
          if (!key || !vid.cfg) return next();
          send({ t: "video", codec: vid.cfg.codec, ...(vid.cfg.desc ? { desc: vid.cfg.desc.toString("base64") } : {}), w: vid.css.w, h: vid.css.h });
          vid.sent = true; meta = `${vid.css.w}x${vid.css.h}`; posY = NaN;
        }
        // Vị trí cuộn của trang lúc Chrome chụp khung này (dự đoán cuộn ở khung xem): chỉ gửi khi đổi, ngay trước khung.
        if (size.sp && Number.isFinite(vid.y) && vid.y !== posY) { posY = vid.y; send({ t: "pos", y: Math.round(vid.y * 10) / 10 }); }
        const m = `${vid.css.w}x${vid.css.h}`;
        if (m !== meta) { meta = m; send({ t: "meta", w: vid.css.w, h: vid.css.h }); }
        ws.send(Buffer.concat([Buffer.from([key ? 1 : 0]), data]));
        inflight++; sentAt.push(Date.now());
      }
      next();
    };
    // Bộ nén lỗi: quay về JPEG cho kết nối này (người xem chuyển theo khi nhận video off).
    const videoFail = (why) => {
      if (DEBUG) console.log(`[browser] video → jpeg: ${why}`);
      const was = !!mk;
      mk = null; vid?.enc.close(); vid = null; vbusy = 0; meta = ""; inflight = 0; sentAt.length = 0;
      if (was) send({ t: "video", off: true });
      if (c && !gone) c.send("Page.stopScreencast").catch(() => {}).finally(() => startCast());
    };
    const vwatch = setInterval(() => { if (vbusy && Date.now() - vbusy > 4000) videoFail("bộ nén không trả khung"); }, 1000);
    const next = () => (mk ? pump().catch((e) => videoFail(e?.message)) : !flushT && flush());
    // Bắt đầu / hết cuộn (chỉ khi truyền bằng video): đổi mật độ chụp rồi phát lại (vài ms, không mở lại bộ nén).
    const moving = () => {
      if (!mk || size.dpr <= MOTION_DPR) return;
      clearTimeout(motionT);
      motionT = setTimeout(() => { motion = false; if (c && !gone) c.send("Page.stopScreencast").catch(() => {}).finally(() => startCast()); }, MOTION_MS);
      if (motion) return;
      motion = true;
      if (c && !gone) c.send("Page.stopScreencast").catch(() => {}).finally(() => startCast());
    };
    const statT = setInterval(() => {
      if (size.stats) send({ t: "stats", cast: stat.cast, drop: stat.drop, push: stat.push, out: stat.out, encMs: stat.out ? Math.round(stat.encMs / stat.out) : 0, encMax: stat.encMax,
        jpgKB: stat.cast ? Math.round(stat.jpg / stat.cast / 1024) : 0, outKB: stat.out ? Math.round((stat.bytes / stat.out / 1024) * 10) / 10 : 0,
        inLat: stat.inLat.length ? Math.round(stat.inLat.reduce((a, b) => a + b, 0) / stat.inLat.length) : null, inflight, video: !!mk });
      Object.assign(stat, { cast: 0, drop: 0, push: 0, out: 0, encMs: 0, encMax: 0, jpg: 0, bytes: 0, inLat: [] });
    }, 2000);
    const sendInfo = async () => { if (c) sendNav(await info(c)); };
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
      // Video: khung vào bộ nén luôn ở đúng mật độ điểm ảnh của người xem, chất lượng cao (bộ nén lo phần dung lượng).
      const d = mk ? (motion ? Math.min(size.dpr, MOTION_DPR) : size.dpr) : castDpr();
      await cc.send("Page.startScreencast", { format: "jpeg", quality: mk ? size.vq : STEPS[qi].q + (d > 1 ? 0 : 8), maxWidth: Math.round(size.w * d), maxHeight: Math.round(size.h * d), everyNthFrame: 1 }).catch(() => {});
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
        if (lastFrame < dropUntil) { dropUntil = 0; return ack(); }
        // Chrome thỉnh thoảng giao khung cũ hơn sau khung mới (nhất là khi máy bận, lúc phát lại sau đổi mật độ chụp): khung chụp lúc 25,718 s
        // tới sau khung 25,735 s. Gửi nó đi thì màn hình giật lùi một nhịp khi đang cuộn và vị trí cuộn kèm khung đi lùi (900 → 800).
        // Bỏ khung có thời điểm chụp sớm hơn khung mới nhất đã nhận của kết nối này.
        const ts = p.metadata?.timestamp;
        if (Number.isFinite(ts)) { if (ts < (n.lastTs ?? 0)) { stat.drop++; return ack(); } n.lastTs = ts; }
        stat.cast++; stat.jpg += p.data.length * 0.75; if (latest) stat.drop++;
        if (stat.inAt) { stat.inLat.push(lastFrame - stat.inAt); stat.inAt = 0; }
        latest?.ack();
        latest = { data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight, y: p.metadata.scrollOffsetY ?? 0, ack };
        next();
      });
      n.on("Page.frameNavigated", (p) => { if (!p.frame.parentId) { sendNav({ url: p.frame.url }); pushTabs(); } });
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
    // Người xem xin "sp: true" (dự đoán cuộn): dò thêm vùng cuộn dưới con trỏ (SCROLL_AT), gửi { t: "sinfo" } khi đổi.
    let cursor = "default", cursorAt = null, cursorBusy = false, sinfo = "", lastPt = null;
    const probeCursor = async () => {
      if (cursorBusy || !cursorAt || !c || s.dialog) return;
      cursorBusy = true;
      const { x, y } = cursorAt; cursorAt = null;
      try {
        const X = Math.round(x), Y = Math.round(y);
        const r = await c.send("Runtime.evaluate", { expression: size.sp ? `({ c: ${CURSOR_AT(X, Y)}, s: ${SCROLL_AT(X, Y)} })` : CURSOR_AT(X, Y), returnByValue: true }, 2000);
        const val = r?.result?.value;
        const v = String((size.sp ? val?.c : val) ?? "default").slice(0, 40);
        if (v !== cursor) { cursor = v; send({ t: "cursor", c: v }); }
        if (size.sp && val?.s) { const j = JSON.stringify(val.s); if (j !== sinfo) { sinfo = j; send({ t: "sinfo", ...val.s }); } }
      } catch {} finally { cursorBusy = false; if (cursorAt) setTimeout(probeCursor, 80); }
    };
    // Đang cuộn: dò lại vùng cuộn (thanh dính có thể vừa bám mép, trang dài thêm), tối đa ~4 lần / giây.
    let scrollProbeAt = 0;
    const probeScroll = (x, y) => {
      if (!size.sp || Date.now() - scrollProbeAt < 250) return;
      scrollProbeAt = Date.now();
      const first = !cursorAt; cursorAt = lastPt = { x, y }; if (first) setTimeout(probeCursor, 0);
    };
    // Trang mới / tải xong: khung xem bỏ vùng cuộn đã biết (nav) — dò lại ở vị trí chuột gần nhất, gửi lại cả khi giống trang trước.
    const sendNav = (o) => {
      send({ t: "nav", ...o });
      sinfo = "";
      if (size.sp && lastPt) { const first = !cursorAt; cursorAt = lastPt; if (first) setTimeout(probeCursor, 150); }
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
          if (t0) { const d = Date.now() - t0; ackSum += d; ackN++; ackMin = Math.min(ackMin, d); }
          if (latest) next();
          return;
        }
        if (j.t === "vkey" || j.t === "novideo") {
          // Người xem cần khung khóa (bộ giải mã vừa lỗi / mở lại): bộ nén mới, nén lại khung gần nhất nếu màn hình đang đứng yên.
          // novideo: trình duyệt của người xem không giải mã được loại video này → JPEG.
          if (j.t === "novideo") return videoFail("người xem không giải mã được");
          if (!mk) return;
          vid?.enc.close(); vid = null; vbusy = 0;
          if (!latest && lastPushed) latest = { ...lastPushed, ack: () => {} };
          return next();
        }
        if (j.t === "size") {
          const w = Math.max(320, Math.min(j.w | 0, 2560)), h = Math.max(240, Math.min(j.h | 0, 1600));
          // Màn hình mật độ cao: tối đa 2x, khung rất lớn thì hạ xuống để hình vẫn đi kịp qua mạng.
          let dpr = Math.max(1, Math.min(Number(j.dpr) || 1, 2));
          while (dpr > 1 && w * h * dpr * dpr > 4_200_000) dpr = Math.max(1, dpr - 0.25);
          // vq: chất lượng JPEG Chrome chụp để đưa vào bộ nén video (thử nghiệm / công cụ đo; mặc định VIDEO_Q).
          size = { w, h, mobile: !!j.mobile, dpr, bin: j.bin === true, fa: j.fa === true, stats: j.stats === true, sp: j.sp === true, vq: Number.isFinite(j.vq) ? Math.max(30, Math.min(95, j.vq | 0)) : VIDEO_Q };
          inflight = 0; sentAt.length = 0;
          meta = "";
          const had = !!mk;
          mk = j.vid === true && size.bin && size.fa ? await videoMaker(u).catch(() => null) : null;
          vid?.enc.close(); vid = null; vbusy = 0; lastPushed = null;
          if (had && !mk) send({ t: "video", off: true });
          await metrics();
          await c.send("Page.stopScreencast").catch(() => {});
          await startCast();
        } else if (j.t === "mouse") {
          if (j.type !== "mouseMoved") { lastInput = now; stat.inAt ||= now; }
          else if (j.buttons) moving(); // kéo thanh cuộn / kéo chọn: trang chạy theo chuột
          await c.send("Input.dispatchMouseEvent", { type: j.type, x: +j.x, y: +j.y, button: j.button ?? "left", buttons: j.buttons ?? 0, clickCount: j.clickCount ?? 0, modifiers: j.mod ?? 0 });
          if (j.type === "mouseMoved") { const first = !cursorAt; cursorAt = lastPt = { x: +j.x, y: +j.y }; if (first) setTimeout(probeCursor, 80); }
        } else if (j.t === "wheel") {
          lastInput = now; stat.inAt ||= now; moving(); probeScroll(+j.x, +j.y);
          await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: +j.x, y: +j.y, deltaX: +j.dx || 0, deltaY: +j.dy || 0 });
        } else if (j.t === "key") {
          lastInput = now; stat.inAt ||= now;
          if (/^(PageUp|PageDown|ArrowUp|ArrowDown|Home|End)$/.test(String(j.key)) || (j.key === " " && j.type === "keyDown")) moving();
          await c.send("Input.dispatchKeyEvent", { type: j.type, key: j.key, code: j.code, text: j.text, unmodifiedText: j.text, windowsVirtualKeyCode: j.kc ?? 0, modifiers: j.mod ?? 0 });
        } else if (j.t === "text") {
          lastInput = now; stat.inAt ||= now;
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
    const bye = () => { clearTimeout(flushT); clearTimeout(watch); clearTimeout(refineT); clearTimeout(motionT); clearInterval(vwatch); clearInterval(statT); vid?.enc.close(); vid = null; mk = null; latest?.ack(); latest = null; s.viewers.delete(viewer); host.sock?.(u, -1); clearInterval(poll); if (c) { c.switching = true; c.close(); } };
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
