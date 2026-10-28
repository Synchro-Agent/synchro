// Lõi trình duyệt của Synchro: Chromium điều khiển qua CDP (Chrome DevTools Protocol). Dùng chung cho
// - dịch vụ workspace trên VPS (workspace/agent.mjs): Chromium trong container của từng người dùng;
// - workspace giả lập khi chạy dev:mock (scripts/mock-workspace.mjs): Chrome thật trên máy đang chạy.
// Hai phần:
// - tool(u, a): thao tác cho model (mọi model, qua công cụ browser_* của Synchro): mở trang, đọc trang thành cây có [ref],
//   tìm, chụp màn hình, bấm, rê chuột, gõ, nhấn phím, chọn, cuộn, kéo thả, tải tệp lên, chờ, chạy JS, tab, gộp nhiều thao tác.
// - screen(ws, u): truyền hình trực tiếp tới khung trình duyệt của người dùng, nhận chuột / bàn phím của họ, và báo cho
//   người xem biết Synchro đang làm gì (điểm bấm, chữ đang gõ) để họ theo dõi hoặc giành lại quyền điều khiển bất cứ lúc nào.
// host: { up(u) → "http://host:cổng" của DevTools (bật trình duyệt nếu chưa chạy); touch(u); sock(u, ±1); downloads(u) → thư mục tải về
//         trong máy chạy trình duyệt; ports?(u) → cổng server đang chạy (trang tab mới) }.
import crypto from "node:crypto";
import http from "node:http";
import { WebSocket } from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

export class BrowserError extends Error { constructor(status, m) { super(m); this.status = status; } }

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

// ------------------------------------------------------------------ mã chạy trong trang
// Đặt một lần cho mỗi tài liệu (window.__syn): gán [ref] bền (cùng phần tử giữ nguyên số qua các lần đọc), đọc trang thành cây chữ,
// tìm phần tử, lấy tọa độ để bấm (kể cả trong iframe cùng nguồn và shadow DOM mở), đặt giá trị ô chọn / ô nhập theo cách React nhận.
const HELPER = String.raw`(() => {
  if (window.__syn && window.__syn.v === 3) return window.__syn;
  const top = window;
  if (!top.__srefMap) { top.__srefMap = new Map(); top.__srefOf = new WeakMap(); top.__srefN = 0; }
  const refOf = (el) => { let r = top.__srefOf.get(el); if (!r) { r = ++top.__srefN; top.__srefOf.set(el, r); } top.__srefMap.set(r, el); return r; };
  const cs = (el) => { try { return getComputedStyle(el); } catch { return null; } };
  const shown = (el) => {
    const r = el.getBoundingClientRect(); if (r.width <= 0 && r.height <= 0) return false;
    const s = cs(el); return !s || (s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0);
  };
  const clean = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return n && t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const ROLE_SEL = "button,link,tab,menuitem,menuitemcheckbox,menuitemradio,checkbox,radio,switch,option,combobox,textbox,searchbox,slider,spinbutton,treeitem,gridcell".split(",");
  const roleOf = (el) => {
    const r = el.getAttribute("role"); if (r && ROLE_SEL.includes(r)) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "hidden") return null;
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox" || t === "radio") return t;
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "search") return "searchbox";
      if (t === "file") return "file";
      return "textbox";
    }
    if (el.isContentEditable && (el.getAttribute("contenteditable") === "" || el.getAttribute("contenteditable") === "true")) return "textbox";
    if (el.hasAttribute("onclick")) return "clickable";
    if (el.getAttribute("tabindex") && el.getAttribute("tabindex") !== "-1" && tag !== "body" && tag !== "html") return "clickable";
    // Trang hay dùng thẻ div có trỏ tay làm nút (đáp án, thẻ, menu): lấy phần tử ngoài cùng có trỏ tay.
    const s = cs(el);
    if (s && s.cursor === "pointer" && tag !== "label" && !(el.parentElement && cs(el.parentElement)?.cursor === "pointer")) return "clickable";
    return null;
  };
  const labelOf = (el) => {
    const a = el.getAttribute("aria-label"); if (a) return a;
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = lb.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.innerText ?? "").join(" "); if (t.trim()) return t; }
    if (el.id) { try { const l = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l?.innerText.trim()) return l.innerText; } catch {} }
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      // Nhãn bọc ngoài ô: chỉ lấy chữ của nhãn, bỏ chữ của chính ô (vd. các lựa chọn của ô chọn).
      const wrap = el.closest("label");
      if (wrap) { let t = ""; for (const n of wrap.childNodes) { if (n === el || (n.nodeType === 1 && n.matches("input,select,textarea"))) continue; t += n.textContent || ""; } if (t.trim()) return t; }
      return el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "";
    }
    const t = el.innerText; if (t && t.trim()) return t;
    const img = el.querySelector("img[alt]"); if (img?.alt) return img.alt;
    return el.getAttribute("title") || el.getAttribute("value") || "";
  };
  const stateOf = (el, role) => {
    const out = [];
    const tag = el.tagName.toLowerCase();
    if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "slider") {
      const v = el.isContentEditable ? el.innerText : el.value;
      out.push('value="' + clean(v, 120) + '"');
      if (el.placeholder && !(labelOf(el) || "").includes(el.placeholder)) out.push('placeholder="' + clean(el.placeholder, 60) + '"');
    }
    if (tag === "select") {
      const sel = [...el.selectedOptions].map((o) => clean(o.text, 60)).join(", ");
      const opts = [...el.options].slice(0, 25).map((o) => clean(o.text, 40));
      out.push('selected="' + sel + '"', "options: " + opts.join(" | ") + (el.options.length > 25 ? " | …(" + el.options.length + ")" : ""));
    }
    if (role === "checkbox" || role === "radio" || role === "switch") {
      const c = el.checked ?? el.getAttribute("aria-checked") === "true"; out.push(c ? "checked" : "unchecked");
    }
    if (el.getAttribute("aria-selected") === "true") out.push("selected");
    if (el.getAttribute("aria-pressed") === "true") out.push("pressed");
    if (el.getAttribute("aria-expanded")) out.push(el.getAttribute("aria-expanded") === "true" ? "expanded" : "collapsed");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") out.push("disabled");
    if (el.required) out.push("required");
    if (el.ownerDocument.activeElement === el) out.push("focused");
    if (role === "link") { const h = el.getAttribute("href"); if (h && !h.startsWith("javascript:")) out.push("-> " + clean(h, 100)); }
    if (role === "file") out.push(el.files && el.files.length ? "files=" + [...el.files].map((f) => f.name).join(", ") : "no file");
    return out.join(" ");
  };
  const line = (el, role) => {
    const name = clean(labelOf(el), 100);
    return "[" + refOf(el) + "] " + role + (name ? ' "' + name.replace(/"/g, "'") + '"' : "") + (stateOf(el, role) ? " " + stateOf(el, role) : "");
  };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "PATH"]);
  const BLOCK = new Set(["block", "flex", "grid", "list-item", "table", "table-row", "table-cell", "table-caption", "flow-root"]);
  // Đọc trang thành các dòng: đề mục, đoạn chữ, phần tử tương tác có [ref]. filter: "all" | "interactive".
  const outline = (filter, max) => {
    const lines = []; let buf = ""; let n = 0; let size = 0;
    const push = (s) => { if (size > max) return; lines.push(s); size += s.length + 1; };
    const flush = () => { const t = clean(buf); buf = ""; if (t && filter !== "interactive") push(t.length > 3000 ? t.slice(0, 2999) + "…" : t); };
    const walk = (node, depth) => {
      if (size > max || depth > 200) return;
      if (node.nodeType === 3) { if (filter !== "interactive") buf += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const el = node;
      if (SKIP.has(el.tagName) || el.getAttribute("aria-hidden") === "true") return;
      const s = cs(el);
      if (s && (s.display === "none" || s.visibility === "hidden")) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "iframe") {
        flush();
        let doc = null; try { doc = el.contentDocument; } catch {}
        if (doc?.body) { push("[iframe " + clean(el.getAttribute("title") || el.src, 60) + "]"); walk(doc.body, depth + 1); push("[/iframe]"); }
        else push("[iframe khác nguồn: " + clean(el.src, 80) + " — dùng ảnh chụp và bấm theo tọa độ]");
        return;
      }
      const role = roleOf(el);
      if (role && shown(el)) {
        flush(); push(line(el, role)); n++;
        // Phần tử bấm được mà bên trong còn nhiều chữ / phần tử khác (thẻ, khung đáp án): đọc tiếp bên trong.
        const inner = el.querySelector("a[href],button,input,select,textarea,[role]");
        if (!inner && (el.innerText || "").length < 200) return;
      }
      if (/^h[1-6]$/.test(tag)) { flush(); const t = clean(el.innerText, 300); if (t) push("#".repeat(Number(tag[1])) + " " + t); return; }
      if (tag === "img") { const alt = clean(el.alt, 80); if (alt && filter !== "interactive") buf += " [ảnh: " + alt + "] "; return; }
      const block = s && BLOCK.has(s.display);
      if (block) flush();
      if (el.shadowRoot) for (const c of el.shadowRoot.childNodes) walk(c, depth + 1);
      for (const c of el.childNodes) walk(c, depth + 1);
      if (block) flush();
    };
    walk(document.body || document.documentElement, 0);
    flush();
    return { lines, count: n, cut: size > max };
  };
  const all = () => {
    const out = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
        if (el.tagName === "IFRAME") { try { if (el.contentDocument) visit(el.contentDocument); } catch {} }
      }
    };
    visit(document);
    return out;
  };
  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  const S = {
    v: 3,
    read(filter, max) {
      const o = outline(filter, max);
      const se = document.scrollingElement || document.documentElement;
      return { url: location.href, title: document.title, viewport: innerWidth + "x" + innerHeight, scroll: Math.round(se.scrollTop) + "/" + Math.max(0, se.scrollHeight - innerHeight), elements: o.count, cut: o.cut, tree: o.lines.join("\n") };
    },
    text(offset, limit) {
      const parts = [document.body ? document.body.innerText : ""];
      for (const f of document.querySelectorAll("iframe")) { try { if (f.contentDocument?.body) parts.push(f.contentDocument.body.innerText); } catch {} }
      const t = parts.join("\n\n");
      return { url: location.href, title: document.title, total: t.length, offset, text: t.slice(offset, offset + limit) };
    },
    find(q, limit) {
      const words = fold(q).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hits = [];
      for (const el of all()) {
        if (SKIP.has(el.tagName) || !shown(el)) continue;
        const role = roleOf(el);
        const own = role ? labelOf(el) : [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join(" ");
        const hay = fold(own + " " + (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("title") || "") + " " + (el.getAttribute("aria-label") || ""));
        if (!hay.trim()) continue;
        const score = words.filter((w) => hay.includes(w)).length;
        if (score === words.length || (words.length > 2 && score >= words.length - 1)) hits.push({ el, role: role || "text", score: score + (role ? 0.5 : 0) + (hay.length < 80 ? 0.3 : 0) });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit).map((h) => h.role === "text" ? "[" + refOf(h.el) + "] text " + '"' + clean(h.el.innerText, 160).replace(/"/g, "'") + '"' : line(h.el, h.role));
    },
    el(ref) { const el = top.__srefMap.get(Number(ref)); return el && el.isConnected ? el : null; },
    // Tọa độ giữa phần tử theo khung nhìn của trang chính (cộng dồn vị trí iframe), sau khi cuộn nó vào giữa màn hình.
    point(ref, scroll) {
      const el = S.el(ref); if (!el) return null;
      if (scroll !== false) el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      let x = r.left + r.width / 2, y = r.top + r.height / 2, w = el.ownerDocument.defaultView;
      while (w && w !== top && w.frameElement) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; }
      let cover = "";
      try {
        const at = document.elementFromPoint(x, y);
        if (at && at !== el && !el.contains(at) && !at.contains(el) && at.tagName !== "IFRAME") cover = clean(at.innerText || at.getAttribute("aria-label") || at.tagName.toLowerCase(), 60);
      } catch {}
      return { x, y, w: r.width, h: r.height, cover, label: clean(labelOf(el), 60) };
    },
    setValue(ref, value) {
      const el = S.el(ref); if (!el) return { error: "missing" };
      const tag = el.tagName.toLowerCase();
      if (tag === "select") {
        const want = fold(value);
        const opt = [...el.options].find((o) => fold(o.value) === want || fold(o.text) === want) || [...el.options].find((o) => fold(o.text).includes(want) || fold(o.value).includes(want));
        if (!opt) return { error: "no-option", options: [...el.options].slice(0, 40).map((o) => clean(o.text, 40)) };
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        set.call(el, opt.value);
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: clean(opt.text, 60) };
      }
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio" || ["checkbox", "radio", "switch"].includes(el.getAttribute("role"))) {
        const now = el.checked ?? el.getAttribute("aria-checked") === "true";
        const want = !/^(false|0|no|off|bỏ|không)$/i.test(String(value));
        return { toggle: now !== want, checked: now };
      }
      if ("value" in el) {
        const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: clean(el.value, 60) };
      }
      return { error: "not-settable" };
    },
    // Chuẩn bị gõ: đưa con trỏ vào phần tử, chọn sẵn nội dung cũ khi cần xóa (chữ gõ sau thay thế phần được chọn).
    focus(ref, clear) {
      const el = ref == null ? document.activeElement : S.el(ref); if (!el) return false;
      el.focus();
      if (clear) {
        if (typeof el.select === "function") el.select();
        else if (el.isContentEditable) { const r = el.ownerDocument.createRange(); r.selectNodeContents(el); const s = el.ownerDocument.getSelection(); s.removeAllRanges(); s.addRange(r); }
      }
      return true;
    },
    scrollBy(ref, dx, dy) {
      const el = ref == null ? null : S.el(ref);
      if (el && !dx && !dy) { el.scrollIntoView({ block: "center" }); return true; }
      return false;
    },
    has(text, sel) {
      if (sel) { try { return !!document.querySelector(sel); } catch { return false; } }
      return fold(document.body ? document.body.innerText : "").includes(fold(text));
    },
  };
  window.__syn = S;
  return S;
})()`;
const call = (expr) => `(${HELPER}, window.__syn.${expr})`;

const KEYS = {
  Enter: [13, "\r"], Tab: [9], Escape: [27], Esc: [27], Backspace: [8], Delete: [46], Insert: [45], ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39],
  Up: [38], Down: [40], Left: [37], Right: [39], PageUp: [33], PageDown: [34], Home: [36], End: [35], " ": [32, " "], Space: [32, " "],
  F1: [112], F2: [113], F3: [114], F4: [115], F5: [116], F6: [117], F7: [118], F8: [119], F9: [120], F10: [121], F11: [122], F12: [123],
};
const MODS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, win: 4, shift: 8 };
const BUTTONS = { left: "left", right: "right", middle: "middle" };

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

  // Giống trình duyệt thật: không lộ "HeadlessChrome", ngôn ngữ tiếng Việt trước, múi giờ Việt Nam.
  async function humanize(u, c) {
    const s = st(u);
    if (s.ua) await c.send("Network.setUserAgentOverride", { userAgent: s.ua, acceptLanguage: "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7" }).catch(() => {});
    await c.send("Emulation.setTimezoneOverride", { timezoneId: host.timezone ?? "Asia/Ho_Chi_Minh" }).catch(() => {});
  }

  // Hộp thoại của trang (alert / confirm / prompt): khi Synchro đang thao tác thì tự xử lý và báo lại cho model;
  // khi người dùng tự duyệt web thì hiện cho họ chọn (khung trình duyệt nhận sự kiện "dialog").
  function watchDialogs(u, c) {
    const s = st(u);
    c.on("Page.javascriptDialogOpening", (p) => {
      if (s.dialog) return;
      s.dialog = { type: p.type, message: String(p.message ?? "").slice(0, 500), def: p.defaultPrompt ?? "", c };
      if (s.acting > 0 || !s.viewers.size) { handleDialog(u, true).catch(() => {}); return; }
      emit(u, { t: "dialog", type: p.type, message: s.dialog.message, def: s.dialog.def });
    });
    c.on("Page.javascriptDialogClosed", () => { if (s.dialog?.c === c) { s.dialog = null; emit(u, { t: "dialog", closed: true }); } });
  }
  async function handleDialog(u, accept, text) {
    const s = st(u), d = s.dialog;
    if (!d) return null;
    s.dialog = null;
    await d.c.send("Page.handleJavaScriptDialog", { accept, ...(d.type === "prompt" ? { promptText: text ?? d.def } : {}) }).catch(() => {});
    s.dialogs.push(`${d.type === "alert" ? "Thông báo" : d.type === "confirm" ? "Hộp xác nhận" : d.type === "beforeunload" ? "Hỏi rời trang" : "Hộp nhập"}: "${d.message}" → ${accept ? "đã bấm OK" : "đã bấm Hủy"}`);
    emit(u, { t: "dialog", closed: true });
    return d;
  }

  // Kết nối điều khiển dùng chung của agent: giữ log console và yêu cầu mạng gần đây để model đọc lại.
  async function agentCdp(u) {
    const s = st(u);
    if (s.cdp && !s.cdp.closed && s.cdp.tid === s.tab) return s.cdp;
    s.cdp?.close();
    const t = await activeTab(u);
    const c = await CDP.open(pageWs(u, t.id));
    c.tid = t.id;
    c.logs = []; c.net = [];
    const push = (l) => { c.logs.push(l.slice(0, 2000)); if (c.logs.length > 200) c.logs.shift(); };
    c.on("Runtime.consoleAPICalled", (p) => push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`));
    c.on("Runtime.exceptionThrown", (p) => push(`[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));
    c.on("Log.entryAdded", (p) => push(`[${p.entry.level}] ${p.entry.text}${p.entry.url ? " (" + p.entry.url + ")" : ""}`));
    c.on("Network.responseReceived", (p) => { if (p.type === "Document" || p.type === "XHR" || p.type === "Fetch") { c.net.push(`${p.response.status} ${p.type} ${p.response.url.slice(0, 300)}`); if (c.net.length > 100) c.net.shift(); } });
    c.on("Network.loadingFailed", (p) => { if (!p.canceled) { c.net.push(`FAILED ${p.type ?? ""} ${p.errorText}`); if (c.net.length > 100) c.net.shift(); } });
    watchDialogs(u, c);
    await Promise.all([c.send("Page.enable"), c.send("Runtime.enable"), c.send("Log.enable"), c.send("Network.enable")]);
    await humanize(u, c);
    // Không ai đang xem: dùng khung nhìn máy tính chuẩn (người xem đặt kích thước theo khung của họ).
    if (!s.viewers.size) await c.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    s.cdp = c;
    return c;
  }

  const evaluate = async (c, expression, timeout = 15_000) => {
    const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeout);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const info = (c) => evaluate(c, "({ url: location.href, title: document.title })", 5000).catch(() => ({ url: "", title: "" }));
  // Chờ trang tải xong sau một thao tác (bấm nút gửi, nhấn Enter…): đợi ngắn cho trang kịp phản ứng, rồi chờ readyState tối đa ~8 giây.
  async function settle(c, ms = 350) {
    await sleep(ms);
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const rs = await evaluate(c, "document.readyState", 2000).catch(() => "loading");
      if (rs === "complete" || rs === "interactive") break;
      await sleep(200);
    }
    await sleep(150);
  }
  async function pressKey(c, combo) {
    const parts = String(combo).split("+").map((x) => x.trim()).filter(Boolean);
    const key = parts.pop() ?? "Enter";
    let modifiers = 0;
    for (const m of parts) modifiers |= MODS[m.toLowerCase()] ?? 0;
    const cap = key.length > 1 ? key[0].toUpperCase() + key.slice(1).toLowerCase() : key;
    const name = KEYS[key] ? key : KEYS[cap] ? cap : null;
    const k = name === "Space" ? " " : name ?? key;
    const [code, text] = name ? KEYS[name] : [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? key : undefined];
    const useText = text && !(modifiers & ~8);
    await c.send("Input.dispatchKeyEvent", { type: useText ? "keyDown" : "rawKeyDown", key: k, windowsVirtualKeyCode: code, text: useText ? (modifiers & 8 && text.length === 1 ? text.toUpperCase() : text) : undefined, modifiers });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, windowsVirtualKeyCode: code, modifiers });
  }
  async function mouseClick(c, x, y, o = {}) {
    const button = BUTTONS[o.button] ?? "left", count = Math.max(1, Math.min(Number(o.count) || 1, 3));
    let modifiers = 0;
    for (const m of String(o.modifiers ?? "").split("+").filter(Boolean)) modifiers |= MODS[m.trim().toLowerCase()] ?? 0;
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
    for (let i = 1; i <= count; i++) {
      await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: 1, clickCount: i, modifiers });
      await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: i, modifiers });
    }
  }
  async function point(u, c, a, what = "") {
    if (a.ref != null && a.ref !== "") {
      const p = await evaluate(c, call(`point(${Number(String(a.ref).replace(/\D/g, "")) || 0})`));
      if (!p) throw new BrowserError(400, `Không còn phần tử [${a.ref}] trên trang (trang đã đổi). Hãy gọi browser_read hoặc browser_find để lấy ref mới.`);
      await sleep(120);
      return p;
    }
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new BrowserError(400, `Thiếu ref hoặc tọa độ x, y${what ? ` cho ${what}` : ""}.`);
    return { x, y, label: "", cover: "" };
  }
  // Thao tác làm trang mở tab mới (target=_blank, window.open): chuyển sang tab đó để làm tiếp, người xem cũng chuyển theo.
  async function followNewTab(u, before) {
    const s = st(u);
    await sleep(250);
    const now = await pages(u).catch(() => []);
    const fresh = now.find((x) => !before.includes(x.id));
    if (!fresh) return null;
    s.tab = fresh.id;
    s.cdp?.close(); s.cdp = null;
    for (const v of s.viewers) v.follow?.(fresh.id);
    const c = await agentCdp(u);
    await settle(c, 200);
    return { tab: fresh.id, ...(await info(c)) };
  }
  const tabsNow = async (u) => { const s = st(u); return (await pages(u)).map((x, i) => ({ i: i + 1, id: x.id, title: x.title, url: x.url, active: x.id === s.tab })); };
  async function switchTab(u, id) {
    const s = st(u);
    const list = await pages(u);
    const t = list.find((x) => x.id === id) ?? list[Number(id) - 1];
    if (!t) throw new BrowserError(400, `Không có tab ${id}. Gọi browser_tabs với action "list" để xem các tab.`);
    s.tab = t.id; s.cdp?.close(); s.cdp = null;
    for (const v of s.viewers) v.follow?.(t.id);
    await devtools(u, `/json/activate/${t.id}`).catch(() => {});
    return t;
  }
  const extra = (u) => {
    const s = st(u), out = {};
    if (s.dialogs.length) { out.dialogs = s.dialogs.splice(0); }
    const fresh = s.downloads.filter((d) => !d.told && d.state !== "inProgress");
    if (fresh.length) { out.downloads = fresh.map((d) => `${d.name} (${d.state === "completed" ? "đã tải xong" : d.state === "canceled" ? "đã hủy" : d.state})`); for (const d of fresh) d.told = true; }
    return out;
  };

  // Một thao tác của model. Kết quả luôn có url, title của trang lúc xong; thêm hộp thoại đã xử lý, tệp đã tải, tab mới nếu có.
  async function act(u, a) {
    if (!DEBUG) return act0(u, a);
    const t0 = Date.now();
    try { return await act0(u, a); } finally { console.log(`[browser] act ${a.action} ${Date.now() - t0} ms`); }
  }
  async function act0(u, a) {
    const s = st(u);
    if (a.action === "tabs") {
      await activeTab(u);
      const op = String(a.op ?? a.tab_action ?? "list");
      if (op === "new") {
        const nt = await devtools(u, `/json/new?${encodeURIComponent(String(a.url || "about:blank"))}`, "PUT");
        await switchTab(u, nt.id);
        const c = await agentCdp(u); if (a.url) await settle(c, 300);
        return { ...(await info(c)), tabs: await tabsNow(u) };
      }
      if (op === "switch") { await switchTab(u, String(a.id ?? a.index ?? "")); const c = await agentCdp(u); return { ...(await info(c)), tabs: await tabsNow(u) }; }
      if (op === "close") {
        const list = await pages(u);
        const t = list.find((x) => x.id === String(a.id)) ?? list[Number(a.id ?? a.index) - 1] ?? list.find((x) => x.id === s.tab);
        if (t) {
          if (list.length <= 1) await devtools(u, "/json/new?about:blank", "PUT");
          if (t.id === s.tab) { const next = (await pages(u)).find((x) => x.id !== t.id); if (next) await switchTab(u, next.id); }
          await devtools(u, `/json/close/${t.id}`).catch(() => {});
        }
        return { tabs: await tabsNow(u) };
      }
      return { tabs: await tabsNow(u) };
    }
    if (a.action === "dialog") {
      const d = await handleDialog(u, a.accept !== false, a.text);
      return { ...(d ? {} : { note: "Không có hộp thoại nào đang mở." }), ...extra(u) };
    }
    if (a.action === "downloads") { await activeTab(u); return { downloads: s.downloads.map((d) => ({ name: d.name, state: d.state, url: d.url })), dir: host.downloads?.(u) ?? null }; }
    // Hộp thoại còn treo từ trước (người dùng chưa chọn) làm trang đứng: agent tự bấm OK rồi mới làm tiếp.
    if (s.dialog) await handleDialog(u, true);
    const c = await agentCdp(u);
    host.touch?.(u);
    switch (a.action) {
      case "navigate": {
        const to = String(a.url ?? "").trim();
        if (to === "back" || to === "forward") {
          const h = await c.send("Page.getNavigationHistory");
          const e = h.entries[h.currentIndex + (to === "back" ? -1 : 1)];
          if (!e) return { note: to === "back" ? "Không còn trang trước." : "Không còn trang sau.", ...(await info(c)) };
          await c.send("Page.navigateToHistoryEntry", { entryId: e.id }); await settle(c, 300);
          return { ...(await info(c)), ...extra(u) };
        }
        if (to === "reload") { await c.send("Page.reload"); await settle(c, 300); return { ...(await info(c)), ...extra(u) }; }
        let url = to;
        if (!url) throw new BrowserError(400, "Thiếu địa chỉ trang.");
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url) ? "http://" + url : /\s/.test(url) || !/\./.test(url) ? `https://www.google.com/search?q=${encodeURIComponent(url)}` : "https://" + url;
        if (!/^(https?|about|data|file):/i.test(url)) throw new BrowserError(400, "Chỉ mở được địa chỉ http(s).");
        if (/^file:/i.test(url) && !host.allowFile) throw new BrowserError(400, "Không mở được tệp trên máy chủ.");
        emit(u, { t: "agent", kind: "navigate", label: url.slice(0, 200) });
        const load = c.once("Page.loadEventFired", 20_000);
        const r = await c.send("Page.navigate", { url }, 30_000);
        if (r.errorText) return { error: `Không mở được ${url}: ${r.errorText}`, ...(await info(c)) };
        // Chuyển trong cùng trang (đổi #…) không có sự kiện tải trang.
        if (r.loaderId) await load;
        await settle(c, 200);
        return { ...(await info(c)), ...extra(u) };
      }
      case "read": {
        const max = Math.max(2000, Math.min(Number(a.max_chars) || 40_000, 80_000));
        return { ...(await evaluate(c, call(`read(${JSON.stringify(a.filter === "interactive" ? "interactive" : "all")}, ${max})`), 20_000)), ...extra(u) };
      }
      case "text": {
        const off = Math.max(0, Number(a.offset) || 0), lim = Math.max(1000, Math.min(Number(a.limit) || 40_000, 80_000));
        return await evaluate(c, call(`text(${off}, ${lim})`), 20_000);
      }
      case "find": {
        const q = String(a.query ?? "").trim();
        if (!q) throw new BrowserError(400, "Thiếu nội dung cần tìm.");
        const hits = await evaluate(c, call(`find(${JSON.stringify(q)}, ${Math.max(1, Math.min(Number(a.limit) || 15, 40))})`), 20_000);
        return { ...(await info(c)), matches: hits };
      }
      case "screenshot": {
        const { data } = await c.send("Page.captureScreenshot", { format: "jpeg", quality: Math.max(30, Math.min(Number(a.quality) || 62, 90)) }, 30_000);
        return { image: data, ...(await info(c)), ...extra(u) };
      }
      case "click": case "hover": {
        const p = await point(u, c, a, a.action === "click" ? "bấm" : "rê chuột");
        const before = (await pages(u).catch(() => [])).map((x) => x.id);
        emit(u, { t: "agent", kind: a.action, x: p.x, y: p.y, label: p.label || (a.ref != null ? `[${a.ref}]` : `${Math.round(p.x)}, ${Math.round(p.y)}`) });
        if (a.action === "hover") { await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(300); return { ...(await info(c)), ...(p.cover ? { note: `Phần tử bị che bởi "${p.cover}".` } : {}) }; }
        await mouseClick(c, p.x, p.y, { button: a.button, count: a.double ? 2 : a.count, modifiers: a.modifiers });
        await settle(c, 450);
        const nt = await followNewTab(u, before);
        return { ...(nt ?? (await info(c))), ...(nt ? { note: "Trang đã mở ở tab mới; Synchro chuyển sang tab đó." } : {}), ...(p.cover ? { warning: `Có thể đã bấm trúng "${p.cover}" đang che phần tử này.` } : {}), ...extra(u) };
      }
      case "type": {
        if (a.ref != null && a.ref !== "") { const p = await point(u, c, a); emit(u, { t: "agent", kind: "type", x: p.x, y: p.y, label: String(a.text ?? "").slice(0, 80) }); await mouseClick(c, p.x, p.y); }
        await evaluate(c, call(`focus(${a.ref != null && a.ref !== "" ? Number(String(a.ref).replace(/\D/g, "")) : "null"}, ${a.clear ? "true" : "false"})`)).catch(() => {});
        if (a.clear) await pressKey(c, "Backspace");
        const text = String(a.text ?? "");
        if (text) await c.send("Input.insertText", { text });
        if (a.submit) { const before = (await pages(u).catch(() => [])).map((x) => x.id); await pressKey(c, "Enter"); await settle(c, 600); const nt = await followNewTab(u, before); if (nt) return { ...nt, ...extra(u) }; }
        return { ...(await info(c)), ...extra(u) };
      }
      case "key": {
        const seq = String(a.key ?? a.keys ?? "Enter").trim().split(/\s+/);
        const n = Math.max(1, Math.min(Number(a.repeat) || 1, 50));
        emit(u, { t: "agent", kind: "key", label: `${seq.join(" ")}${n > 1 ? ` ×${n}` : ""}` });
        for (let i = 0; i < n; i++) for (const k of seq) await pressKey(c, k);
        await settle(c, 300);
        return { ...(await info(c)), ...extra(u) };
      }
      case "select": {
        const ref = Number(String(a.ref ?? "").replace(/\D/g, ""));
        if (!ref) throw new BrowserError(400, "Thiếu ref của ô cần chọn.");
        const r = await evaluate(c, call(`setValue(${ref}, ${JSON.stringify(String(a.value ?? ""))})`));
        if (r?.error === "missing") throw new BrowserError(400, `Không còn phần tử [${ref}] trên trang. Hãy đọc lại trang.`);
        if (r?.error === "no-option") throw new BrowserError(400, `Không có lựa chọn "${a.value}". Các lựa chọn: ${r.options.join(" | ")}`);
        if (r?.error) throw new BrowserError(400, "Phần tử này không đặt giá trị được; hãy bấm hoặc gõ vào nó.");
        if (r?.toggle) { const p = await point(u, c, { ref }); await mouseClick(c, p.x, p.y); await sleep(200); }
        emit(u, { t: "agent", kind: "select", label: String(a.value ?? "").slice(0, 80) });
        return { ...(await info(c)), value: r?.value ?? (r?.toggle ? !r.checked : r?.checked), ...extra(u) };
      }
      case "scroll": {
        const ref = a.ref != null && a.ref !== "" ? Number(String(a.ref).replace(/\D/g, "")) : null;
        const dx = Number(a.dx) || 0, dy = a.dy == null && !dx && ref == null ? 600 : Number(a.dy) || 0;
        if (ref != null && !dx && !dy) { const ok = await evaluate(c, call(`scrollBy(${ref}, 0, 0)`)); if (!ok) throw new BrowserError(400, `Không còn phần tử [${ref}] trên trang.`); await sleep(250); return { ...(await info(c)) }; }
        let x, y;
        if (ref != null) { const p = await point(u, c, { ref }); x = p.x; y = p.y; } else if (a.x != null && a.y != null) { x = Number(a.x); y = Number(a.y); }
        else { const v = await evaluate(c, "({ w: innerWidth, h: innerHeight })"); x = v.w / 2; y = v.h / 2; }
        await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
        await sleep(350);
        const pos = await evaluate(c, "(() => { const s = document.scrollingElement || document.documentElement; return Math.round(s.scrollTop) + '/' + Math.max(0, s.scrollHeight - innerHeight); })()").catch(() => "");
        return { ...(await info(c)), scroll: pos };
      }
      case "drag": {
        const from = await point(u, c, a.from && typeof a.from === "object" ? a.from : { ref: a.from_ref ?? a.ref, x: a.x, y: a.y }, "điểm bắt đầu kéo");
        const to = await point(u, c, a.to && typeof a.to === "object" ? a.to : { ref: a.to_ref, x: a.to_x, y: a.to_y }, "điểm thả");
        emit(u, { t: "agent", kind: "drag", x: to.x, y: to.y, label: `${from.label || "?"} → ${to.label || "?"}` });
        await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
        await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 12; i++) { await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12, button: "left", buttons: 1 }); await sleep(25); }
        await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
        await settle(c, 300);
        return { ...(await info(c)) };
      }
      case "upload": {
        const ref = Number(String(a.ref ?? "").replace(/\D/g, ""));
        const files = (Array.isArray(a.paths) ? a.paths : [a.path]).map(String).filter(Boolean);
        if (!ref || !files.length) throw new BrowserError(400, "Cần ref của ô chọn tệp và đường dẫn tệp.");
        const r = await c.send("Runtime.evaluate", { expression: `(${HELPER}).el(${ref})`, returnByValue: false });
        if (!r.result?.objectId) throw new BrowserError(400, `Không còn phần tử [${ref}] trên trang.`);
        await c.send("DOM.setFileInputFiles", { files, objectId: r.result.objectId });
        await evaluate(c, `(() => { const el = window.__syn.el(${ref}); el && el.dispatchEvent(new Event("change", { bubbles: true })); })()`).catch(() => {});
        emit(u, { t: "agent", kind: "upload", label: files.map((f) => f.split("/").pop()).join(", ") });
        return { ...(await info(c)), uploaded: files.map((f) => f.split("/").pop()) };
      }
      case "wait": {
        const ms = Math.max(0, Math.min(Number(a.ms ?? a.seconds * 1000) || 0, 30_000));
        if (a.text == null && a.selector == null) { await sleep(ms || 1000); return { ...(await info(c)) }; }
        const end = Date.now() + Math.max(500, Math.min(Number(a.timeout) || 10_000, 30_000));
        const gone = !!a.gone;
        while (Date.now() < end) {
          const has = await evaluate(c, call(`has(${JSON.stringify(String(a.text ?? ""))}, ${a.selector != null ? JSON.stringify(String(a.selector)) : "null"})`), 3000).catch(() => false);
          if (has !== gone) return { ...(await info(c)), found: !gone };
          await sleep(300);
        }
        return { ...(await info(c)), timeout: true, note: gone ? "Hết thời gian chờ mà nội dung vẫn còn." : "Hết thời gian chờ mà chưa thấy nội dung." };
      }
      case "eval": {
        const v = await evaluate(c, String(a.expression ?? ""), 30_000);
        return { value: JSON.stringify(v ?? null)?.slice(0, 30_000) ?? "null", ...extra(u) };
      }
      case "console": { const logs = c.logs.slice(-Number(a.limit ?? 50)); if (a.clear) c.logs = []; return { logs, requests: c.net.slice(-30) }; }
      case "network": return { requests: c.net.slice(-Number(a.limit ?? 40)) };
      case "back": case "forward": case "reload": return act(u, { action: "navigate", url: a.action });
      default: throw new BrowserError(400, `Thao tác trình duyệt không hợp lệ: ${a.action}`);
    }
  }

  // Nhiều thao tác liền nhau trong một lần gọi (gõ cả biểu mẫu, chọn đáp án nhiều câu): chạy lần lượt, dừng ở thao tác lỗi đầu tiên.
  async function tool(u, a) {
    const s = st(u);
    s.acting++;
    emit(u, { t: "agent", kind: "start" });
    try {
      if (a.action !== "batch") return await act(u, a);
      const list = (Array.isArray(a.actions) ? a.actions : []).slice(0, 40);
      if (!list.length) throw new BrowserError(400, "Danh sách thao tác trống.");
      const results = [];
      for (const [i, x] of list.entries()) {
        if (!x || typeof x !== "object" || x.action === "batch") { results.push({ i: i + 1, error: "Thao tác không hợp lệ" }); break; }
        try {
          const r = await act(u, x);
          const { image, tree, text, ...rest } = r ?? {};
          results.push({ i: i + 1, action: x.action, ...rest, ...(tree ? { tree } : {}), ...(text ? { text } : {}) });
          if (r?.error) break;
        } catch (e) { results.push({ i: i + 1, action: x.action, error: e.message || String(e) }); break; }
      }
      const c = await agentCdp(u);
      return { ...(await info(c)), done: results.filter((r) => !r.error).length, total: list.length, results };
    } finally {
      s.acting--;
      emit(u, { t: "agent", kind: "idle" });
    }
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
      watchDialogs(u, n);
      n.on("close", () => { if (!n.switching && !gone) attach().catch(() => ws.close(1011, "browser closed")); });
      await n.send("Page.enable");
      await humanize(u, n);
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
  return { tool, screen, reset, state: st };
}
