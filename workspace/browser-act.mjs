// Thao tác trình duyệt của Synchro cho model, không phụ thuộc cách nối tới trình duyệt. Dùng chung cho
// - workspace/browser-core.mjs: Chromium trong workspace trên VPS, Chrome trên máy khi chạy dev:mock (DevTools HTTP + WebSocket);
// - tiện ích Synchro cho Chrome / Edge / Brave của người dùng (extension/, chép vào tiện ích thành act.mjs): nối qua chrome.debugger.
// Không dùng API riêng của Node nên chạy được cả trong service worker của tiện ích.
// createActor(env) — env (mọi hàm nhận u: người dùng; tiện ích chỉ có một người dùng):
//   state(u) → đối tượng trạng thái dùng chung { tab, dialog, dialogs, downloads, acting, viewers? } (actor tự thêm trường còn thiếu)
//   session(u) → phiên CDP của tab đang dùng ({ send(method, params, timeout), on(ev, f), once(ev, ms) }), đã gọi prepare()
//   pages(u) → [{ id, title, url }] các tab model được dùng · newTab(u, url) → id · closeTab(u, id) · activate?(u, id)
//   switched(u, id) → tab đang dùng vừa đổi (bỏ phiên cũ, người xem chuyển theo) · ready?(u) → bật trình duyệt nếu chưa chạy
//   emit?(u, o) báo người xem · touch?(u) · downloadsDir?(u) · allowFile · humanize (giả trình duyệt thường: UA, ngôn ngữ, múi giờ)
//   ua?(u) · timezone · nativeDialogs (hộp thoại hiện ngay trên trình duyệt của người dùng) · keepOne (luôn giữ ít nhất một tab)
//   capture?(u, c, "start" | "end") trước / sau khi chụp màn hình (vd. ẩn dải "Synchro đang điều khiển").
// state.halt (chuỗi lý do): người dùng vừa bấm Dừng → thao tác đang chờ và các bước còn lại của browser_batch thôi ngay.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBUG = !!globalThis.process?.env?.SYNCHRO_BROWSER_DEBUG;

export class BrowserError extends Error { constructor(status, m) { super(m); this.status = status; } }

// ------------------------------------------------------------------ mã chạy trong trang
// Đặt một lần cho mỗi tài liệu (window.__syn): gán [ref] bền (cùng phần tử giữ nguyên số qua các lần đọc), đọc trang thành cây chữ,
// tìm phần tử, lấy tọa độ để bấm (kể cả trong iframe cùng nguồn và shadow DOM mở), đặt giá trị ô chọn / ô nhập theo cách React nhận.
export const HELPER = String.raw`(() => {
  if (window.__syn && window.__syn.v === 5) return window.__syn;
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
        else {
          // Khung con khác nguồn (OOPIF) Synchro đã nối được: actor thay dòng này bằng nội dung của khung (ref đánh số riêng).
          const fno = top.__synFrameNo && top.__synFrameNo.get(el);
          push(fno ? "[[frame:" + fno + "]]" : "[iframe khác nguồn: " + clean(el.src, 80) + " — dùng ảnh chụp và bấm theo tọa độ]");
        }
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
  // Ô ngày / giờ của trình duyệt: giá trị luôn theo dạng chuẩn (YYYY-MM-DD, HH:MM…); nhận cả cách viết thường gặp (29/10/2026, 2:30 PM).
  const pad = (n) => String(n).padStart(2, "0");
  const DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/;
  const day = (v) => { const m = DAY.exec(v); return !m ? null : m[1] ? m[1] + "-" + pad(m[2]) + "-" + pad(m[3]) : m[6] + "-" + pad(m[5]) + "-" + pad(m[4]); };
  const hm = (v) => {
    const m = /(\d{1,2})\s*[:hg]\s*(\d{2})?(?::(\d{2}))?\s*(am|pm|sa|ch)?/i.exec(v); if (!m) return null;
    let h = Number(m[1]); const ap = (m[4] || "").toLowerCase();
    if ((ap === "pm" || ap === "ch") && h < 12) h += 12; if ((ap === "am" || ap === "sa") && h === 12) h = 0;
    return h > 23 ? null : pad(h) + ":" + pad(m[2] || 0);
  };
  const PICK = { date: 1, time: 1, "datetime-local": 1, month: 1, week: 1, color: 1 };
  const normDate = (t, v) => {
    v = String(v).trim();
    if (t === "date") return day(v);
    if (t === "time") return hm(v);
    if (t === "datetime-local") { const d = day(v); return d ? d + "T" + (hm(v.replace(DAY, "").replace(/^[T\s,]+/, "")) || "00:00") : null; }
    if (t === "month") { let m = /^(\d{4})-(\d{1,2})/.exec(v); if (m) return m[1] + "-" + pad(m[2]); m = /^(\d{1,2})[\/.-](\d{4})/.exec(v); return m ? m[2] + "-" + pad(m[1]) : null; }
    if (t === "week") { const m = /^(\d{4})-?W(\d{1,2})/i.exec(v); return m ? m[1] + "-W" + pad(m[2]) : null; }
    if (t === "color") return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
    return v;
  };
  const kindOf = (el) => {
    if (!el) return null;
    const tag = el.tagName.toLowerCase(), itype = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : "";
    const o = { tag, itype };
    if (tag === "select") { o.multiple = el.multiple || el.size > 1; o.options = [...el.options].slice(0, 25).map((x) => clean(x.text, 40)).join(" | "); }
    return o;
  };
  const S = {
    v: 5,
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
    // scored: kèm điểm khớp để gộp kết quả với các khung con khác nguồn theo đúng thứ tự.
    find(q, limit, scored) {
      const words = fold(q).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hits = [];
      for (const el of all()) {
        if (SKIP.has(el.tagName) || el.tagName === "IFRAME" || !shown(el)) continue;
        const role = roleOf(el);
        const own = role ? labelOf(el) : [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join(" ");
        const hay = fold(own + " " + (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("title") || "") + " " + (el.getAttribute("aria-label") || ""));
        if (!hay.trim()) continue;
        const score = words.filter((w) => hay.includes(w)).length;
        if (score === words.length || (words.length > 2 && score >= words.length - 1)) hits.push({ el, role: role || "text", score: score + (role ? 0.5 : 0) + (hay.length < 80 ? 0.3 : 0) });
      }
      hits.sort((a, b) => b.score - a.score);
      const out = hits.slice(0, limit).map((h) => h.role === "text" ? "[" + refOf(h.el) + "] text " + '"' + clean(h.el.innerText, 160).replace(/"/g, "'") + '"' : line(h.el, h.role));
      return scored ? out.map((l, i) => ({ l, s: hits[i].score })) : out;
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
      return { x, y, w: r.width, h: r.height, cover, label: clean(labelOf(el), 60), ...kindOf(el) };
    },
    // Phần tử tại tọa độ (bấm theo tọa độ từ ảnh chụp): biết có trúng ô chọn / ô ngày của trình duyệt không.
    at(x, y) { const el = document.elementFromPoint(x, y); return el && el.tagName !== "IFRAME" ? { ref: refOf(el), ...kindOf(el) } : null; },
    kind(ref) { const el = ref == null ? document.activeElement : S.el(ref); return el ? { ref: refOf(el), ...kindOf(el) } : null; },
    // Vị trí vùng nội dung của khung con khác nguồn số n (đã đánh dấu) theo khung nhìn của trang này.
    frameBox(n) {
      const el = top.__synFrameEl && top.__synFrameEl.get(n); if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect(), s = cs(el);
      let x = r.left + el.clientLeft + parseFloat(s?.paddingLeft || 0), y = r.top + el.clientTop + parseFloat(s?.paddingTop || 0), w = el.ownerDocument.defaultView;
      while (w && w !== top && w.frameElement) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; }
      return { x, y };
    },
    // Ô chọn tệp gắn với phần tử: chính nó, ô của nhãn, ô nằm bên trong (nút / vùng tải lên tự làm hay bọc ô ẩn).
    fileInput(ref) {
      const el = S.el(ref); if (!el) return null;
      const isF = (e) => !!e && e.tagName === "INPUT" && (e.getAttribute("type") || "").toLowerCase() === "file";
      let f = isF(el) ? el : el.tagName === "LABEL" && isF(el.control) ? el.control : null;
      if (!f && el.querySelector) f = el.querySelector("input[type=file]");
      if (!f) { const lab = el.closest && el.closest("label"); if (lab && isF(lab.control)) f = lab.control; }
      return f ? refOf(f) : null;
    },
    // Chữ đang được chọn (bôi đen), kể cả trong ô nhập.
    selText() {
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.selectionStart != null) return a.value.slice(a.selectionStart, a.selectionEnd);
      return String(getSelection() || "");
    },
    // Dán như người thật (sự kiện paste mang dữ liệu bộ nhớ tạm): trình soạn thảo (Gmail, Notion, Slack, Google Docs…) tự xử lý chữ / định dạng.
    paste(text, html) {
      const el = document.activeElement || document.body;
      const dt = new DataTransfer(); dt.setData("text/plain", text); if (html) dt.setData("text/html", html);
      let ev; try { ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }); } catch { return false; }
      return !el.dispatchEvent(ev);
    },
    insertHTML(html) { try { return document.execCommand("insertHTML", false, html); } catch { return false; } },
    // Chuột phải chỗ trang không có menu riêng: chặn menu của trình duyệt (cửa sổ hệ điều hành Synchro không bấm được, che màn hình người dùng).
    ctxGuard() {
      top.__synCtx = "";
      const h = (e) => { top.__synCtx = e.defaultPrevented ? "page" : "native"; if (!e.defaultPrevented) e.preventDefault(); };
      addEventListener("contextmenu", h, { once: true }); setTimeout(() => removeEventListener("contextmenu", h), 3000);
      return true;
    },
    ctxDone() { const v = top.__synCtx || ""; top.__synCtx = ""; return v; },
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
      if (tag === "input" && PICK[type]) {
        const v = normDate(type, value);
        if (v == null) return { error: "bad-format", type };
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === v ? { ok: true, value: v } : { error: "bad-format", type };
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
    // Điểm để cuộn cả trang bằng con lăn: chỗ không nằm trên khung cuộn riêng (danh sách, bảng, iframe), như người thật đặt chuột ra lề trang.
    pagePoint() {
      const w = innerWidth, h = innerHeight;
      const inner = (el) => { for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        if (e.tagName === "IFRAME") return true;
        const st = cs(e); if (st && /(auto|scroll)/.test(st.overflowY + st.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) return true;
      } return false; };
      for (const [x, y] of [[w / 2, h / 2], [12, h / 2], [w - 24, h / 2], [w / 2, h * 0.3], [w / 2, h * 0.7], [12, h * 0.3], [w - 24, h * 0.7]]) {
        const el = document.elementFromPoint(x, y);
        if (el && !inner(el)) return { x, y };
      }
      return { x: w / 2, y: h / 2 };
    },
    has(text, sel) {
      if (sel) { try { return !!document.querySelector(sel); } catch { return false; } }
      return fold(document.body ? document.body.innerText : "").includes(fold(text));
    },
  };
  window.__syn = S;
  return S;
})()`;
export const call = (expr) => `(${HELPER}, window.__syn.${expr})`;

// Ghi lại lúc trang xin quyền (thông báo, vị trí, micro / camera, đọc bộ nhớ tạm): hộp hỏi quyền nằm trên giao diện trình duyệt,
// trang không đổi gì nên model cần được báo để cấp / chặn bằng browser_permission. Chạy trước mã của trang (mỗi tài liệu mới).
const PERM_HOOK = String.raw`(() => {
  if (window.__synPermHook) return; window.__synPermHook = 1;
  const log = window.__synPerm = [];
  const note = (n) => { log.push(n); if (log.length > 20) log.shift(); };
  const wrap = (o, k, n) => { try { const f = o && o[k]; if (typeof f !== "function") return; o[k] = function (...a) { note(typeof n === "function" ? n(a) : n); return f.apply(this, a); }; } catch {} };
  try { if (window.Notification) wrap(Notification, "requestPermission", "notifications"); } catch {}
  try { if (window.PushManager) wrap(PushManager.prototype, "subscribe", "notifications"); } catch {}
  try { if (window.Geolocation) { wrap(Geolocation.prototype, "getCurrentPosition", "geolocation"); wrap(Geolocation.prototype, "watchPosition", "geolocation"); } } catch {}
  try { if (window.MediaDevices) wrap(MediaDevices.prototype, "getUserMedia", (a) => [a[0] && a[0].video ? "camera" : "", a[0] && a[0].audio ? "microphone" : ""].filter(Boolean).join("+") || "camera"); } catch {}
  try { if (window.Clipboard) { wrap(Clipboard.prototype, "readText", "clipboard-read"); wrap(Clipboard.prototype, "read", "clipboard-read"); } } catch {}
})()`;

// Khung con khác nguồn (OOPIF: biểu mẫu nhúng, cổng thanh toán, khung bình luận…) là phiên CDP con: phần tử trong khung số n có ref = n * FRAME + ref.
const FRAME = 100000;
// Đánh dấu thẻ <iframe> của khung con n trên trang chứa nó (trang cao nhất cùng nguồn), để cây đọc trang ghép nội dung khung vào đúng chỗ.
const MARK = `function (n) { let w = this.ownerDocument.defaultView; for (;;) { try { if (w.parent === w || !w.parent.document) break; w = w.parent; } catch { break; } } (w.__synFrameNo = w.__synFrameNo || new WeakMap()).set(this, n); (w.__synFrameEl = w.__synFrameEl || new Map()).set(n, this); }`;
// Tệp gửi kèm (tệp đính kèm trong chat của Synchro): dựng File trong trang rồi đặt vào ô chọn tệp, hoặc thả vào vùng kéo thả tệp.
const FILES = `function (files) { const dt = new DataTransfer(); for (const f of files) { const b = atob(f.data); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); dt.items.add(new File([u], f.name, { type: f.mime || "", lastModified: Date.now() })); } return dt; }`;
const PUT = `function (files) { const dt = (${FILES})(this.multiple ? files : files.slice(0, 1)); this.files = dt.files; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return this.files.length; }`;
const DROP = `function (files, x, y) { const dt = (${FILES})(files); const o = { dataTransfer: dt, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y }; for (const t of ["dragenter", "dragover", "drop"]) this.dispatchEvent(new DragEvent(t, o)); return dt.files.length; }`;

const KEYS = {
  Enter: [13, "\r"], Tab: [9], Escape: [27], Esc: [27], Backspace: [8], Delete: [46], Insert: [45], ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39],
  Up: [38], Down: [40], Left: [37], Right: [39], PageUp: [33], PageDown: [34], Home: [36], End: [35], " ": [32, " "], Space: [32, " "],
  F1: [112], F2: [113], F3: [114], F4: [115], F5: [116], F6: [117], F7: [118], F8: [119], F9: [120], F10: [121], F11: [122], F12: [123],
};
const MODS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, win: 4, shift: 8 };
// Phím tắt soạn thảo (ctrl / cmd + A, C, X, V, Z, Y) kèm lệnh của trình duyệt: chạy đúng trên mọi máy (trên macOS, ctrl + A không chọn hết),
// sao chép / dán qua bộ nhớ tạm thật như người dùng.
const EDIT = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo", y: "redo" };
// Gõ chữ như người thật: ký tự có trên bàn phím (chữ không dấu, số, dấu câu, cách, xuống dòng) gửi đủ keydown / keyup cho từng phím;
// chữ có dấu tiếng Việt, emoji… gửi như bộ gõ (insertText). [key, code, mã phím, cần Shift].
const PUNCT = { ".": ["Period", 190], ",": ["Comma", 188], "-": ["Minus", 189], "/": ["Slash", 191], ";": ["Semicolon", 186], "'": ["Quote", 222], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "=": ["Equal", 187], "\\": ["Backslash", 220], "`": ["Backquote", 192] };
const SHIFTED = { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "{": "[", "}": "]", "|": "\\", "~": "`" };
function keyOf(ch) {
  if (/^[a-z]$/.test(ch)) return [ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), false];
  if (/^[A-Z]$/.test(ch)) return [ch, "Key" + ch, ch.charCodeAt(0), true];
  if (/^[0-9]$/.test(ch)) return [ch, "Digit" + ch, ch.charCodeAt(0), false];
  if (ch === " ") return [" ", "Space", 32, false];
  if (PUNCT[ch]) return [ch, PUNCT[ch][0], PUNCT[ch][1], false];
  if (SHIFTED[ch]) { const b = SHIFTED[ch], k = /[0-9]/.test(b) ? ["Digit" + b, b.charCodeAt(0)] : PUNCT[b]; return [ch, k[0], k[1], true]; }
  return null;
}
const BUTTONS = { left: "left", right: "right", middle: "middle" };

export function createActor(env) {
  const st = (u) => {
    const s = env.state(u);
    s.tab ??= ""; s.dialog ??= null; s.dialogs ??= []; s.downloads ??= []; s.acting ??= 0;
    return s;
  };
  const emit = (u, o) => env.emit?.(u, o);
  const pages = (u) => env.pages(u);

  // Giống trình duyệt thật: không lộ "HeadlessChrome", ngôn ngữ tiếng Việt trước, múi giờ Việt Nam.
  // (Trình duyệt thật của người dùng thì giữ nguyên như họ đang dùng.)
  async function humanize(u, c) {
    if (!env.humanize) return;
    const ua = env.ua?.(u);
    if (ua) await c.send("Network.setUserAgentOverride", { userAgent: ua, acceptLanguage: "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7" }).catch(() => {});
    await c.send("Emulation.setTimezoneOverride", { timezoneId: env.timezone ?? "Asia/Ho_Chi_Minh" }).catch(() => {});
  }

  // Hộp thoại của trang (alert / confirm / prompt): khi Synchro đang thao tác thì tự xử lý và báo lại cho model;
  // khi người dùng tự duyệt web thì để họ chọn (khung trình duyệt nhận sự kiện "dialog", hoặc hộp thoại hiện ngay trên Chrome của họ).
  function watchDialogs(u, c) {
    const s = st(u);
    c.on("Page.javascriptDialogOpening", (p) => {
      if (s.dialog) return;
      s.dialog = { type: p.type, message: String(p.message ?? "").slice(0, 500), def: p.defaultPrompt ?? "", c };
      if (s.acting > 0 || (!s.viewers?.size && !env.nativeDialogs)) { handleDialog(u, true).catch(() => {}); return; }
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

  // Chuẩn bị phiên điều khiển của agent trên một tab: giữ log console và yêu cầu mạng gần đây để model đọc lại, theo dõi hộp thoại.
  async function prepare(u, c) {
    c.logs = []; c.net = [];
    const push = (l) => { c.logs.push(l.slice(0, 2000)); if (c.logs.length > 200) c.logs.shift(); };
    c.on("Runtime.consoleAPICalled", (p) => push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`));
    c.on("Runtime.exceptionThrown", (p) => push(`[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));
    c.on("Log.entryAdded", (p) => push(`[${p.entry.level}] ${p.entry.text}${p.entry.url ? " (" + p.entry.url + ")" : ""}`));
    c.on("Network.responseReceived", (p) => { if (p.type === "Document" || p.type === "XHR" || p.type === "Fetch") { c.net.push(`${p.response.status} ${p.type} ${p.response.url.slice(0, 300)}`); if (c.net.length > 100) c.net.shift(); } });
    c.on("Network.loadingFailed", (p) => { if (!p.canceled) { c.net.push(`FAILED ${p.type ?? ""} ${p.errorText}`); if (c.net.length > 100) c.net.shift(); } });
    watchDialogs(u, c);
    // Trang mở hộp chọn tệp (bấm nút "Tải lên" của trang): chặn hộp thoại của hệ điều hành, ghi lại để browser_upload điền tệp vào.
    const s = st(u);
    c.on("Page.fileChooserOpened", (p, sid) => { if (!sid) s.chooser = { backendNodeId: p.backendNodeId, mode: p.mode, at: Date.now() }; });
    // Khung con khác nguồn: nối phiên con (cả khung lồng trong khung) để đọc và thao tác bên trong như trang thường.
    c.frames = new Map(); let fno = 0;
    const auto = (sid) => c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: "iframe" }] }, 5000, sid)
      .catch(() => c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, 5000, sid)).catch(() => {});
    c.on("Target.attachedToTarget", (p, parent) => {
      if (p.targetInfo?.type !== "iframe") return;
      c.frames.set(p.sessionId, { sid: p.sessionId, id: p.targetInfo.targetId, url: p.targetInfo.url, parent: parent || undefined, n: ++fno });
      auto(p.sessionId);
    });
    c.on("Target.detachedFromTarget", (p) => { c.frames.delete(p.sessionId); });
    await Promise.all([c.send("Page.enable"), c.send("Runtime.enable"), c.send("Log.enable"), c.send("Network.enable")]);
    await Promise.all([
      // Trang luôn coi như đang được chọn (cửa sổ Chrome ở nền, người dùng làm việc khác): ô nhập vẫn nhận focus, trang không ngừng phản hồi.
      c.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}),
      c.send("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {}),
      c.send("Page.addScriptToEvaluateOnNewDocument", { source: PERM_HOOK }).catch(() => {}),
      c.send("Runtime.evaluate", { expression: PERM_HOOK }).catch(() => {}),
      auto(),
    ]);
    await humanize(u, c);
  }

  const evaluate = async (c, expression, timeout = 15_000, sid) => {
    const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeout, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const info = (c) => evaluate(c, "({ url: location.href, title: document.title })", 5000).catch(() => ({ url: "", title: "" }));
  // Trang hiện tại cho kết quả thao tác, kèm các quyền trang vừa xin (trạng thái "prompt" = trình duyệt đang hỏi người dùng).
  async function here(c) {
    if (c.closed) return { url: "", title: "" };
    const r = await evaluate(c, "({ url: location.href, title: document.title, perm: window.__synPerm ? window.__synPerm.splice(0) : [] })", 5000).catch(() => ({ url: "", title: "", perm: [] }));
    const names = [...new Set((r.perm ?? []).flatMap((n) => String(n).split("+")))];
    delete r.perm;
    if (names.length) r.permissions = await evaluate(c, `Promise.all(${JSON.stringify(names)}.map((n) => navigator.permissions.query({ name: n }).then((x) => n + ": " + x.state, () => n)))`, 5000).catch(() => names);
    return r;
  }

  // ---------------------------------------------------------------- khung con khác nguồn
  const frameOf = (c, n) => [...(c.frames?.values() ?? [])].find((f) => f.n === n) ?? null;
  async function markFrames(c) {
    for (const f of c.frames?.values() ?? []) {
      if (f.marked) continue;
      try {
        const { backendNodeId } = await c.send("DOM.getFrameOwner", { frameId: f.id }, 5000, f.parent);
        const { object } = await c.send("DOM.resolveNode", { backendNodeId }, 5000, f.parent);
        await c.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: MARK, arguments: [{ value: f.n }] }, 5000, f.parent);
        f.marked = true;
      } catch {}
    }
  }
  // ref của model → phiên (khung) chứa phần tử và ref trong khung đó.
  function loc(c, ref) {
    const r = Number(String(ref ?? "").replace(/\D/g, "")) || 0;
    if (r < FRAME) return { ref: r, sid: undefined, f: null };
    const f = frameOf(c, Math.floor(r / FRAME));
    if (!f) throw new BrowserError(400, `Khung con chứa phần tử [${ref}] không còn trên trang. Hãy đọc lại trang.`);
    return { ref: r % FRAME, sid: f.sid, f };
  }
  const remap = (txt, n) => String(txt ?? "").replace(/^\[(\d+)\]/gm, (_, x) => `[${n * FRAME + Number(x)}]`);
  // Góc trên trái của vùng nội dung khung f theo khung nhìn của trang chính (cộng dồn khung lồng nhau).
  async function frameOffset(c, f, depth = 0) {
    const b = await evaluate(c, call(`frameBox(${f.n})`), 5000, f.parent).catch(() => null);
    if (!b) return null;
    if (!f.parent || depth > 5) return b;
    const up = [...c.frames.values()].find((x) => x.sid === f.parent);
    const o = up ? await frameOffset(c, up, depth + 1) : null;
    return o ? { x: b.x + o.x, y: b.y + o.y } : null;
  }
  // Ghép nội dung các khung con khác nguồn vào cây đọc trang (chỗ dòng [[frame:n]]).
  async function expand(c, tree, filter, max, depth = 0) {
    if (!String(tree).includes("[[frame:") || depth > 4) return { tree, count: 0 };
    let count = 0;
    const out = [];
    for (const ln of String(tree).split("\n")) {
      const m = /^\[\[frame:(\d+)\]\]$/.exec(ln);
      if (!m) { out.push(ln); continue; }
      const f = frameOf(c, Number(m[1]));
      const sub = f ? await evaluate(c, call(`read(${JSON.stringify(filter)}, ${Math.max(2000, Math.floor(max / 3))})`), 10_000, f.sid).catch(() => null) : null;
      if (!sub) { out.push(`[iframe khác nguồn${f ? " " + f.url.slice(0, 80) : ""}: chưa đọc được — dùng ảnh chụp và bấm theo tọa độ]`); continue; }
      await markFrames(c);
      const inner = await expand(c, remap(sub.tree, f.n), filter, max, depth + 1);
      count += sub.elements + inner.count;
      out.push(`[iframe ${String(sub.title || sub.url).slice(0, 80)}]`, inner.tree, "[/iframe]");
    }
    return { tree: out.join("\n"), count };
  }
  const frames = (c) => [...(c.frames?.values() ?? [])];

  // Trang ở nền (người dùng chuyển sang tab khác, thu nhỏ hay để Chrome sau ứng dụng khác): trình duyệt ngừng vẽ trang, nên cuộn vô tận,
  // hiệu ứng, danh sách tải dần không chạy. Giữ trang "đang hiện" bằng một luồng hình nhỏ (như khi chia sẻ tab) suốt lúc Synchro điều khiển,
  // không phải chuyển tab hay kéo cửa sổ lên trước.
  async function awake(c) {
    if (c.awake || c.closed || Date.now() - (c.awakeAt ?? 0) < 2000) return;
    c.awakeAt = Date.now();
    if ((await evaluate(c, "document.visibilityState", 3000).catch(() => "visible")) !== "hidden") return;
    c.awake = true;
    c.on("Page.screencastFrame", (p, sid) => { if (!sid) c.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {}); });
    await c.send("Page.startScreencast", { format: "jpeg", quality: 5, maxWidth: 160, maxHeight: 160, everyNthFrame: 30 }).catch(() => { c.awake = false; });
  }
  // Chờ trang tải xong sau một thao tác (bấm nút gửi, nhấn Enter…): đợi ngắn cho trang kịp phản ứng, rồi chờ readyState tối đa ~8 giây.
  async function settle(c, ms = 350) {
    await sleep(ms);
    const end = Date.now() + 8000;
    while (Date.now() < end && !c.closed) {
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
    const ko = key.length === 1 ? keyOf(key.toLowerCase()) ?? keyOf(key) : null;
    const [code, text] = name ? KEYS[name] : [ko ? ko[2] : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? key : undefined];
    const useText = text && !(modifiers & ~8);
    const edit = modifiers & 6 && !(modifiers & 1) && ko ? EDIT[key.toLowerCase()] : undefined;
    const commands = edit ? [edit === "undo" && modifiers & 8 ? "redo" : edit] : undefined;
    const dom = name === "Space" || name === " " ? "Space" : name ? (name.length > 3 && /^(Arrow|Page)/.test(name) ? name : { Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Esc: "Escape" }[name] ?? name) : ko?.[1];
    await c.send("Input.dispatchKeyEvent", { type: useText ? "keyDown" : "rawKeyDown", key: k, code: dom, windowsVirtualKeyCode: code, text: useText ? (modifiers & 8 && text.length === 1 ? text.toUpperCase() : text) : undefined, modifiers, ...(commands ? { commands } : {}) });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: dom, windowsVirtualKeyCode: code, modifiers });
  }
  // nl: phím xuống dòng ("shift+Enter" ở ô chat như Slack, Messenger, nơi Enter là gửi).
  async function typeText(c, text, nl = "Enter") {
    // Chữ rất dài (dán cả đoạn văn): đưa vào một lần cho nhanh, như dán.
    if (text.length > 400) { await c.send("Input.insertText", { text }); return; }
    let ime = "";
    const flush = async () => { if (ime) { await c.send("Input.insertText", { text: ime }); ime = ""; } };
    for (const ch of text) {
      if (ch === "\n" || ch === "\r") { await flush(); if (ch === "\n") await pressKey(c, nl); continue; }
      const k = keyOf(ch);
      if (!k) { ime += ch; continue; }
      await flush();
      const [key, code, vk, shift] = k, modifiers = shift ? 8 : 0;
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch, unmodifiedText: ch, modifiers });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    }
    await flush();
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
      const L = loc(c, a.ref);
      const p = await evaluate(c, call(`point(${L.ref})`), 15_000, L.sid);
      if (!p) throw new BrowserError(400, `Không còn phần tử [${a.ref}] trên trang (trang đã đổi). Hãy gọi browser_read hoặc browser_find để lấy ref mới.`);
      if (L.f) {
        // Phần tử trong khung con khác nguồn: cộng vị trí của khung trên trang (chuột, bàn phím gửi vào trang chính, trình duyệt chuyển vào khung).
        const o = await frameOffset(c, L.f);
        if (!o) throw new BrowserError(400, `Khung con chứa phần tử [${a.ref}] không còn trên trang. Hãy đọc lại trang.`);
        p.x += o.x; p.y += o.y; p.cover = "";
      }
      p.L = L;
      await sleep(120);
      return p;
    }
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new BrowserError(400, `Thiếu ref hoặc tọa độ x, y${what ? ` cho ${what}` : ""}.`);
    const at = await evaluate(c, call(`at(${x}, ${y})`), 5000).catch(() => null);
    return { x, y, label: "", cover: "", ...(at ?? {}), L: at ? { ref: at.ref, sid: undefined, f: null } : null };
  }
  // Ô chọn và ô ngày / giờ / màu của trình duyệt mở danh sách hay bảng chọn là cửa sổ riêng của hệ điều hành (Synchro không bấm vào được,
  // còn che màn hình người dùng): không bấm chuột mà đặt giá trị bằng browser_select.
  const PICKERS = { date: "YYYY-MM-DD (ví dụ 2026-10-29)", time: "HH:MM (ví dụ 14:30)", "datetime-local": "YYYY-MM-DD HH:MM", month: "YYYY-MM", week: "YYYY-Www", color: "#rrggbb" };
  const nativePicker = (p) => (p?.tag === "select" && !p.multiple) || (p?.tag === "input" && PICKERS[p.itype]);
  const pickerNote = (p, ref) => p.tag === "select"
    ? `[${ref}] là ô chọn của trình duyệt (danh sách bật lên của hệ điều hành): Synchro không mở danh sách mà chọn bằng browser_select ref=${ref} value="<chữ của lựa chọn>". Các lựa chọn: ${p.options}`
    : `[${ref}] là ô ${p.itype} của trình duyệt (bảng chọn bật lên của hệ điều hành): Synchro không mở bảng chọn mà đặt giá trị bằng browser_select ref=${ref} value="${PICKERS[p.itype]}" (hoặc browser_type).`;
  // Tab đang làm vừa tự đóng (cửa sổ đăng nhập, thanh toán bật lên tự đóng khi xong): quay về tab dùng trước đó.
  async function back(u) {
    const s = st(u);
    const open = await pages(u).catch(() => []);
    const prev = [...(s.hist ?? [])].reverse().map((id) => open.find((x) => x.id === id)).find(Boolean) ?? open[0];
    if (!prev) return { url: "", title: "" };
    s.tab = prev.id;
    await env.switched(u, prev.id);
    const c = await env.session(u);
    return { ...(await here(c)), note: "Cửa sổ / tab vừa tự đóng (thường là cửa sổ đăng nhập hay thanh toán bật lên); Synchro quay về tab trước đó." };
  }
  // Tab đang làm vừa đóng (kể cả đang đóng dở: window.close() xong trang mới biến mất).
  async function gone(u, c, tab) {
    for (let i = 0; i < 4; i++) {
      if (c.closed) return true;
      const open = await pages(u).catch(() => null);
      if (open && !open.some((x) => x.id === tab)) return true;
      if (i < 3) await sleep(120);
    }
    return c.closed;
  }
  const waitChooser = async (u, since, ms) => { const s = st(u), end = Date.now() + ms; while (Date.now() < end && !(s.chooser && s.chooser.at >= since)) await sleep(100); return s.chooser && s.chooser.at >= since ? s.chooser : null; };
  const chooserNote = "Trang vừa mở hộp chọn tệp (Synchro đã chặn hộp thoại của máy): gọi browser_upload không cần ref, với file (tên tệp đính kèm trong chat) hoặc path (đường dẫn tệp trên máy).";
  // Thao tác làm trang mở tab mới (target=_blank, window.open): chuyển sang tab đó để làm tiếp, người xem cũng chuyển theo.
  // Các tab đã dùng gần đây: đóng tab đang làm thì quay về tab dùng trước đó (như Chrome), không nhảy sang tab đầu tiên.
  const remember = (s, id) => { if (s.tab && s.tab !== id) { s.hist = (s.hist ?? []).filter((x) => x !== s.tab); s.hist.push(s.tab); if (s.hist.length > 20) s.hist.shift(); } };
  async function followNewTab(u, before) {
    const s = st(u);
    await sleep(250);
    const now = await pages(u).catch(() => []);
    const fresh = now.find((x) => !before.includes(x.id));
    if (!fresh) return null;
    remember(s, fresh.id);
    s.tab = fresh.id;
    await env.switched(u, fresh.id);
    const c = await env.session(u);
    await settle(c, 200);
    return { tab: fresh.id, ...(await info(c)) };
  }
  const tabsNow = async (u) => { const s = st(u); return (await pages(u)).map((x, i) => ({ i: i + 1, id: x.id, title: x.title, url: x.url, active: x.id === s.tab })); };
  async function switchTab(u, id) {
    const s = st(u);
    const list = await pages(u);
    const t = list.find((x) => x.id === id) ?? list[Number(id) - 1];
    if (!t) throw new BrowserError(400, `Không có tab ${id}. Gọi browser_tabs với action "list" để xem các tab.`);
    remember(s, t.id);
    s.tab = t.id;
    await env.switched(u, t.id);
    await env.activate?.(u, t.id)?.catch?.(() => {});
    return t;
  }
  // Chờ mà vẫn dừng được ngay: người dùng bấm Dừng (state.halt) thì thôi chờ.
  async function nap(u, ms) {
    const s = st(u), end = Date.now() + ms;
    while (Date.now() < end) {
      if (s.halt) throw new BrowserError(499, s.halt);
      await sleep(Math.min(250, end - Date.now()));
    }
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
      await env.ready?.(u);
      const op = String(a.op ?? a.tab_action ?? "list");
      if (op === "new") {
        const id = await env.newTab(u, String(a.url || "about:blank"));
        await switchTab(u, id);
        const c = await env.session(u); if (a.url) await settle(c, 300);
        return { ...(await info(c)), tabs: await tabsNow(u) };
      }
      if (op === "switch") { await switchTab(u, String(a.id ?? a.index ?? "")); const c = await env.session(u); return { ...(await info(c)), tabs: await tabsNow(u) }; }
      if (op === "close") {
        const list = await pages(u);
        const t = list.find((x) => x.id === String(a.id)) ?? list[Number(a.id ?? a.index) - 1] ?? list.find((x) => x.id === s.tab);
        if (t) {
          if (list.length <= 1 && env.keepOne !== false) await env.newTab(u, "about:blank");
          if (t.id === s.tab) {
            const open = (await pages(u)).filter((x) => x.id !== t.id);
            const next = [...(s.hist ?? [])].reverse().map((id) => open.find((x) => x.id === id)).find(Boolean) ?? open[0];
            if (next) await switchTab(u, next.id); else { s.tab = ""; await env.switched(u, ""); }
          }
          await Promise.resolve(env.closeTab(u, t.id)).catch(() => {});
        }
        return { tabs: await tabsNow(u) };
      }
      return { tabs: await tabsNow(u) };
    }
    if (a.action === "dialog") {
      const d = await handleDialog(u, a.accept !== false, a.text);
      return { ...(d ? {} : { note: "Không có hộp thoại nào đang mở." }), ...extra(u) };
    }
    if (a.action === "downloads") {
      await env.ready?.(u);
      // Đọc lại tệp vừa tải về (bảng tính, hóa đơn PDF, tệp xuất…) để model dùng nội dung, hoặc tải tiếp lên trang khác.
      if (String(a.op ?? "list") === "read") {
        const want = String(a.name ?? "").trim().toLowerCase();
        // Tệp trùng tên trình duyệt lưu thành "tên (1).csv": nhận cả tên gốc, lấy tệp mới nhất.
        const base = (n) => String(n).toLowerCase().replace(/ \(\d+\)(?=\.[^.]*$|$)/, "");
        const pickD = () => (want ? s.downloads.find((d) => base(d.name) === base(want)) ?? s.downloads.find((d) => d.name.toLowerCase().includes(want)) : s.downloads[0]);
        let d = pickD();
        // Tệp vừa bấm tải có khi chưa có tên thật (trình duyệt đặt tên lúc tải xong): đợi các tệp đang tải.
        for (let i = 0; i < 30 && !d && s.downloads.some((x) => x.state === "inProgress"); i++) { await nap(u, 500); d = pickD(); }
        if (!d) throw new BrowserError(404, want ? `Không thấy tệp "${a.name}" trong các tệp Synchro đã tải về. Gọi browser_downloads op="list" để xem.` : "Chưa có tệp nào được tải về.");
        for (let i = 0; i < 60 && d.state === "inProgress"; i++) { await nap(u, 500); d = pickD() ?? d; }
        if (d.state !== "completed") throw new BrowserError(409, `Tệp "${d.name}" ${d.state === "inProgress" ? "vẫn đang tải" : "tải không thành công"}.`);
        if (!env.readDownload) throw new BrowserError(400, "Nơi này chưa đọc lại được tệp đã tải.");
        const f = await env.readDownload(u, d);
        return { name: d.name, mime: f.mime || "", size: f.size ?? 0, data: f.data };
      }
      return { downloads: s.downloads.map((d) => ({ name: d.name, state: d.state, url: d.url, ...(d.path ? { path: d.path } : {}) })), dir: env.downloadsDir?.(u) ?? null };
    }
    // Hộp thoại còn treo từ trước (người dùng chưa chọn) làm trang đứng: agent tự bấm OK rồi mới làm tiếp.
    if (s.dialog) await handleDialog(u, true);
    const c = await env.session(u);
    env.touch?.(u);
    await awake(c);
    switch (a.action) {
      case "navigate": {
        const to = String(a.url ?? "").trim();
        if (to === "back" || to === "forward") {
          const h = await c.send("Page.getNavigationHistory");
          const e = h.entries[h.currentIndex + (to === "back" ? -1 : 1)];
          if (!e) return { note: to === "back" ? "Không còn trang trước." : "Không còn trang sau.", ...(await here(c)) };
          await c.send("Page.navigateToHistoryEntry", { entryId: e.id }); await settle(c, 300);
          return { ...(await here(c)), ...extra(u) };
        }
        if (to === "reload") { await c.send("Page.reload"); await settle(c, 300); return { ...(await here(c)), ...extra(u) }; }
        let url = to;
        if (!url) throw new BrowserError(400, "Thiếu địa chỉ trang.");
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url) ? "http://" + url : /\s/.test(url) || !/\./.test(url) ? `https://www.google.com/search?q=${encodeURIComponent(url)}` : "https://" + url;
        if (!/^(https?|about|data|file):/i.test(url)) throw new BrowserError(400, "Chỉ mở được địa chỉ http(s).");
        if (/^file:/i.test(url) && !env.allowFile) throw new BrowserError(400, "Không mở được tệp trên máy chủ.");
        // Người dùng tự mở trang (thanh địa chỉ): không báo "Synchro đang điều khiển".
        if (!a.user) emit(u, { t: "agent", kind: "navigate", label: url.slice(0, 200) });
        const load = c.once("Page.loadEventFired", 20_000);
        const r = await c.send("Page.navigate", { url }, 30_000);
        if (r.errorText) return { error: `Không mở được ${url}: ${r.errorText}`, ...(await here(c)) };
        // Chuyển trong cùng trang (đổi #…) không có sự kiện tải trang.
        if (r.loaderId) await load;
        await settle(c, 200);
        return { ...(await here(c)), ...extra(u) };
      }
      case "read": {
        const max = Math.max(2000, Math.min(Number(a.max_chars) || 40_000, 80_000));
        const filter = a.filter === "interactive" ? "interactive" : "all";
        await markFrames(c);
        const r = await evaluate(c, call(`read(${JSON.stringify(filter)}, ${max})`), 20_000);
        const fx = await expand(c, r.tree, filter, max);
        return { ...r, tree: fx.tree, elements: r.elements + fx.count, ...extra(u) };
      }
      case "text": {
        const off = Math.max(0, Number(a.offset) || 0), lim = Math.max(1000, Math.min(Number(a.limit) || 40_000, 80_000));
        if (!frames(c).length) return await evaluate(c, call(`text(${off}, ${lim})`), 20_000);
        // Kèm chữ trong các khung con khác nguồn.
        const main = await evaluate(c, call("text(0, 2000000)"), 20_000);
        let t = main.text;
        for (const f of frames(c)) { const x = await evaluate(c, call("text(0, 500000)"), 8000, f.sid).catch(() => null); if (x?.text?.trim()) t += `\n\n[iframe ${x.title || x.url}]\n${x.text}`; }
        return { url: main.url, title: main.title, total: t.length, offset: off, text: t.slice(off, off + lim) };
      }
      case "find": {
        const q = String(a.query ?? "").trim();
        if (!q) throw new BrowserError(400, "Thiếu nội dung cần tìm.");
        const lim = Math.max(1, Math.min(Number(a.limit) || 15, 40));
        const expr = call(`find(${JSON.stringify(q)}, ${lim}, true)`);
        const hits = await evaluate(c, expr, 20_000);
        for (const f of frames(c)) hits.push(...(await evaluate(c, expr, 8000, f.sid).catch(() => [])).map((x) => ({ l: remap(x.l, f.n), s: x.s })));
        hits.sort((x, y) => y.s - x.s);
        return { ...(await here(c)), matches: hits.slice(0, lim).map((x) => x.l) };
      }
      case "screenshot": {
        await env.capture?.(u, c, "start");
        try {
          // Màn hình độ phân giải cao (Retina): chụp theo pixel CSS để tọa độ trên ảnh dùng thẳng được cho browser_click.
          const vv = await evaluate(c, "({ d: devicePixelRatio, x: visualViewport.pageLeft, y: visualViewport.pageTop, w: visualViewport.width, h: visualViewport.height })", 5000).catch(() => null);
          const clip = vv && vv.d && vv.d !== 1 ? { x: vv.x, y: vv.y, width: vv.w, height: vv.h, scale: 1 / vv.d } : undefined;
          const { data } = await c.send("Page.captureScreenshot", { format: "jpeg", quality: Math.max(30, Math.min(Number(a.quality) || 62, 90)), ...(clip ? { clip } : {}) }, 30_000);
          return { image: data, ...(await here(c)), ...extra(u) };
        } finally { await env.capture?.(u, c, "end"); }
      }
      case "click": case "hover": {
        const p = await point(u, c, a, a.action === "click" ? "bấm" : "rê chuột");
        const ref = a.ref != null && a.ref !== "" ? a.ref : p.L?.ref;
        if (a.action === "click" && (a.button ?? "left") === "left" && !a.double && !a.modifiers && nativePicker(p)) {
          if (p.L) await evaluate(c, call(`focus(${p.L.ref}, false)`), 5000, p.L.sid).catch(() => {});
          return { ...(await here(c)), note: pickerNote(p, ref) };
        }
        const before = (await pages(u).catch(() => [])).map((x) => x.id), since = Date.now(), tab = s.tab;
        emit(u, { t: "agent", kind: a.action, x: p.x, y: p.y, label: p.label || (a.ref != null ? `[${a.ref}]` : `${Math.round(p.x)}, ${Math.round(p.y)}`) });
        if (a.action === "hover") { await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(300); return { ...(await here(c)), ...(p.cover ? { note: `Phần tử bị che bởi "${p.cover}".` } : {}) }; }
        const right = a.button === "right";
        if (right) await evaluate(c, call("ctxGuard()"), 3000, p.L?.sid).catch(() => {});
        await mouseClick(c, p.x, p.y, { button: a.button, count: a.double ? 2 : a.count, modifiers: a.modifiers });
        await settle(c, 450);
        if (await gone(u, c, tab)) return { ...(await back(u)), ...extra(u) };
        const notes = [];
        if (right && (await evaluate(c, call("ctxDone()"), 3000, p.L?.sid).catch(() => "")) === "native") notes.push("Trang không có menu chuột phải riêng; menu chuột phải của trình duyệt đã được bỏ qua (cửa sổ đó Synchro không bấm được). Việc trong menu đó làm bằng công cụ khác: sao chép bằng browser_key \"ctrl+c\", mở liên kết ở tab mới bằng browser_tabs op=\"new\" với địa chỉ liên kết, lưu ảnh bằng cách mở ảnh rồi tải về.");
        if (s.chooser && s.chooser.at >= since) notes.push(chooserNote);
        const nt = await followNewTab(u, before);
        if (nt) notes.unshift("Trang đã mở ở tab mới; Synchro chuyển sang tab đó.");
        return { ...(nt ?? (await here(c))), ...(notes.length ? { note: notes.join(" ") } : {}), ...(p.cover ? { warning: `Có thể đã bấm trúng "${p.cover}" đang che phần tử này.` } : {}), ...extra(u) };
      }
      case "type": {
        const hasRef = a.ref != null && a.ref !== "";
        const L = hasRef ? loc(c, a.ref) : { ref: null, sid: undefined, f: null };
        const text = String(a.text ?? "") || String(a.html ?? "").replace(/<[^>]+>/g, "");
        // Ô ngày / giờ / màu của trình duyệt: đặt giá trị như browser_select (gõ phím vào ô ngày phụ thuộc định dạng ngày của từng máy).
        const k = await evaluate(c, call(`kind(${hasRef ? L.ref : "null"})`), 5000, L.sid).catch(() => null);
        if (k?.tag === "input" && PICKERS[k.itype] && (hasRef || k.ref)) return act(u, { action: "select", ref: hasRef ? a.ref : k.ref, value: text });
        if (hasRef) { const p = await point(u, c, a); emit(u, { t: "agent", kind: "type", x: p.x, y: p.y, label: text.slice(0, 80) }); await mouseClick(c, p.x, p.y); }
        await evaluate(c, call(`focus(${hasRef ? L.ref : "null"}, ${a.clear ? "true" : "false"})`), 15_000, L.sid).catch(() => {});
        if (a.clear) await pressKey(c, "Backspace");
        if (text && (a.paste || a.html)) {
          // Dán: trình soạn thảo nhận sự kiện paste (giữ định dạng html); trang không tự xử lý thì chèn như trình duyệt.
          const handled = await evaluate(c, call(`paste(${JSON.stringify(text)}, ${a.html ? JSON.stringify(String(a.html)) : "null"})`), 15_000, L.sid).catch(() => false);
          if (!handled && !(a.html && (await evaluate(c, call(`insertHTML(${JSON.stringify(String(a.html))})`), 15_000, L.sid).catch(() => false)))) await c.send("Input.insertText", { text });
        } else if (text) await typeText(c, text, /shift/i.test(String(a.newline ?? "")) ? "shift+Enter" : "Enter");
        if (a.submit) { const before = (await pages(u).catch(() => [])).map((x) => x.id); await pressKey(c, "Enter"); await settle(c, 600); if (c.closed) return { ...(await back(u)), ...extra(u) }; const nt = await followNewTab(u, before); if (nt) return { ...nt, ...extra(u) }; }
        return { ...(await here(c)), ...extra(u) };
      }
      case "key": {
        const seq = String(a.key ?? a.keys ?? "Enter").trim().split(/\s+/);
        const n = Math.max(1, Math.min(Number(a.repeat) || 1, 50));
        emit(u, { t: "agent", kind: "key", label: `${seq.join(" ")}${n > 1 ? ` ×${n}` : ""}` });
        // Sao chép / cắt: ghi lại chữ đang chọn ngay lúc bấm để báo cho model (bộ nhớ tạm thật của máy cũng nhận như khi người dùng bấm).
        let sel = "";
        for (let i = 0; i < n; i++) for (const k of seq) {
          if (/^(ctrl|control|cmd|command|meta)\+[cx]$/i.test(k)) sel = (await evaluate(c, call("selText()"), 5000).catch(() => "")) || sel;
          await pressKey(c, k);
        }
        await settle(c, 300);
        if (c.closed) return { ...(await back(u)), ...extra(u) };
        if (sel) s.clip = sel;
        return { ...(await here(c)), ...(sel ? { copied: sel.slice(0, 4000) } : {}), ...extra(u) };
      }
      case "select": {
        if (a.ref == null || a.ref === "") throw new BrowserError(400, "Thiếu ref của ô cần chọn.");
        const L = loc(c, a.ref);
        if (!L.ref) throw new BrowserError(400, "Thiếu ref của ô cần chọn.");
        const r = await evaluate(c, call(`setValue(${L.ref}, ${JSON.stringify(String(a.value ?? ""))})`), 15_000, L.sid);
        if (r?.error === "missing") throw new BrowserError(400, `Không còn phần tử [${a.ref}] trên trang. Hãy đọc lại trang.`);
        if (r?.error === "no-option") throw new BrowserError(400, `Không có lựa chọn "${a.value}". Các lựa chọn: ${r.options.join(" | ")}`);
        if (r?.error === "bad-format") throw new BrowserError(400, `Giá trị "${a.value}" không hợp cho ô ${r.type}: dùng dạng ${PICKERS[r.type] ?? "đúng định dạng của ô"}.`);
        if (r?.error) throw new BrowserError(400, "Phần tử này không đặt giá trị được; hãy bấm hoặc gõ vào nó.");
        if (r?.toggle) { const p = await point(u, c, { ref: a.ref }); await mouseClick(c, p.x, p.y); await sleep(200); }
        emit(u, { t: "agent", kind: "select", label: String(a.value ?? "").slice(0, 80) });
        return { ...(await here(c)), value: r?.value ?? (r?.toggle ? !r.checked : r?.checked), ...extra(u) };
      }
      case "scroll": {
        const hasRef = a.ref != null && a.ref !== "";
        const dx = Number(a.dx) || 0, dy = a.dy == null && !dx && !hasRef ? 600 : Number(a.dy) || 0;
        if (hasRef && !dx && !dy) { const L = loc(c, a.ref); const ok = await evaluate(c, call(`scrollBy(${L.ref}, 0, 0)`), 15_000, L.sid); if (!ok) throw new BrowserError(400, `Không còn phần tử [${a.ref}] trên trang.`); await sleep(250); return { ...(await here(c)) }; }
        let x, y;
        const page = !hasRef && (a.x == null || a.y == null);
        if (hasRef) { const p = await point(u, c, { ref: a.ref }); x = p.x; y = p.y; } else if (!page) { x = Number(a.x); y = Number(a.y); }
        else ({ x, y } = await evaluate(c, call("pagePoint()")));
        const where = "(() => { const s = document.scrollingElement || document.documentElement; return [Math.round(s.scrollLeft), Math.round(s.scrollTop)]; })()";
        const was = page ? await evaluate(c, where).catch(() => null) : null;
        await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
        await sleep(350);
        // Cuộn cả trang mà con lăn không làm trang nhúc nhích (trang chặn sự kiện con lăn): cuộn thẳng trang.
        if (was) { const now = await evaluate(c, where).catch(() => was); if (now[0] === was[0] && now[1] === was[1]) await evaluate(c, `(document.scrollingElement || document.documentElement).scrollBy(${dx}, ${dy})`).catch(() => {}); }
        const pos = await evaluate(c, "(() => { const s = document.scrollingElement || document.documentElement; return Math.round(s.scrollTop) + '/' + Math.max(0, s.scrollHeight - innerHeight); })()").catch(() => "");
        return { ...(await here(c)), scroll: pos };
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
        return { ...(await here(c)) };
      }
      case "upload": {
        // Tệp đính kèm trong chat của Synchro (máy chủ gửi kèm nội dung) hoặc tệp có sẵn trên máy (đường dẫn).
        const inline = (Array.isArray(a.files) ? a.files : []).filter((f) => f && typeof f.data === "string" && f.name);
        const paths = (Array.isArray(a.paths) ? a.paths : [a.path]).map((x) => String(x ?? "")).filter(Boolean);
        if (!inline.length && !paths.length) throw new BrowserError(400, "Cần tệp để tải lên: file (tên tệp đính kèm trong chat) hoặc path (đường dẫn tệp trên máy).");
        const names = inline.length ? inline.map((f) => String(f.name)) : paths.map((f) => f.split(/[\\/]/).pop());
        const label = names.join(", ");
        const since = Date.now();
        let target = null;
        if (a.ref != null && a.ref !== "") {
          const L = loc(c, a.ref);
          const fr = await evaluate(c, call(`fileInput(${L.ref})`), 5000, L.sid);
          if (fr) {
            const o = await c.send("Runtime.evaluate", { expression: `window.__syn.el(${fr})`, returnByValue: false }, 5000, L.sid);
            if (o.result?.objectId) target = { objectId: o.result.objectId, sid: L.sid };
          } else {
            // Nút hay vùng "Tải lên" tự làm (ô chọn tệp ẩn): bấm như người dùng; trang mở hộp chọn tệp thì điền vào đó, không thì thả tệp vào.
            const p = await point(u, c, { ref: a.ref });
            await mouseClick(c, p.x, p.y);
            if (!(await waitChooser(u, since, 2500))) {
              if (inline.length) {
                const o = await c.send("Runtime.evaluate", { expression: `window.__syn.el(${L.ref})`, returnByValue: false }, 5000, L.sid);
                if (!o.result?.objectId) throw new BrowserError(400, `Không còn phần tử [${a.ref}] trên trang.`);
                await c.send("Runtime.callFunctionOn", { objectId: o.result.objectId, functionDeclaration: DROP, arguments: [{ value: inline }, { value: p.x }, { value: p.y }], returnByValue: true }, 60_000, L.sid);
              } else {
                const data = { items: [], files: paths, dragOperationsMask: 1 };
                for (const type of ["dragEnter", "dragOver", "drop"]) await c.send("Input.dispatchDragEvent", { type, x: p.x, y: p.y, data }, 20_000);
              }
              await settle(c, 300);
              emit(u, { t: "agent", kind: "upload", label });
              return { ...(await here(c)), uploaded: names, note: "Phần tử này không mở hộp chọn tệp: Synchro đã kéo thả tệp vào đó như vùng thả tệp.", ...extra(u) };
            }
          }
        }
        // Hộp chọn tệp trang vừa mở (đã chặn hộp thoại của máy).
        if (!target && s.chooser && Date.now() - s.chooser.at < 300_000) {
          const r = await c.send("DOM.resolveNode", { backendNodeId: s.chooser.backendNodeId }, 5000).catch(() => null);
          if (r?.object?.objectId) target = { objectId: r.object.objectId };
        }
        if (!target) throw new BrowserError(400, "Không thấy ô chọn tệp: truyền ref của ô tải tệp lên (hoặc nút / vùng tải lên của trang), hoặc bấm nút tải lên của trang trước rồi gọi lại browser_upload.");
        s.chooser = null;
        if (inline.length) await c.send("Runtime.callFunctionOn", { objectId: target.objectId, functionDeclaration: PUT, arguments: [{ value: inline }], returnByValue: true }, 60_000, target.sid);
        else await c.send("DOM.setFileInputFiles", { files: paths, objectId: target.objectId }, 20_000, target.sid);
        await settle(c, 250);
        emit(u, { t: "agent", kind: "upload", label });
        return { ...(await here(c)), uploaded: names, ...extra(u) };
      }
      case "wait": {
        const ms = Math.max(0, Math.min(Number(a.ms ?? a.seconds * 1000) || 0, 30_000));
        if (a.text == null && a.selector == null) { await nap(u, ms || 1000); return { ...(await here(c)) }; }
        const end = Date.now() + Math.max(500, Math.min(Number(a.timeout) || 10_000, 30_000));
        const gone = !!a.gone;
        const q = call(`has(${JSON.stringify(String(a.text ?? ""))}, ${a.selector != null ? JSON.stringify(String(a.selector)) : "null"})`);
        while (Date.now() < end) {
          let has = await evaluate(c, q, 3000).catch(() => false);
          for (const f of has ? [] : frames(c)) if (await evaluate(c, q, 3000, f.sid).catch(() => false)) { has = true; break; }
          if (has !== gone) return { ...(await here(c)), found: !gone };
          await nap(u, 300);
        }
        return { ...(await here(c)), timeout: true, note: gone ? "Hết thời gian chờ mà nội dung vẫn còn." : "Hết thời gian chờ mà chưa thấy nội dung." };
      }
      case "permission": {
        // Hộp hỏi quyền của trình duyệt (thông báo, vị trí, micro / camera, bộ nhớ tạm) nằm ngoài trang: cấp hay chặn cho trang hiện tại.
        const P = { notifications: "notifications", notification: "notifications", geolocation: "geolocation", location: "geolocation", camera: "camera", microphone: "microphone", mic: "microphone", clipboard: "clipboard", "clipboard-read": "clipboard" };
        const name = P[String(a.name ?? a.permission ?? "").toLowerCase().trim()];
        if (!name) throw new BrowserError(400, `Quyền không hợp lệ: "${a.name ?? ""}". Chọn notifications, geolocation, camera, microphone hoặc clipboard.`);
        const pg = await here(c);
        let origin = ""; try { origin = new URL(pg.url).origin; } catch {}
        if (!/^https?:/.test(origin)) throw new BrowserError(400, "Trang hiện tại không phải trang web (http / https) nên không cấp quyền được.");
        if (!env.permission) throw new BrowserError(400, "Nơi này chưa cấp quyền cho trang được.");
        const allow = a.allow !== false && !/^(false|block|deny|no|chặn)$/i.test(String(a.setting ?? ""));
        await env.permission(u, { origin, name, setting: allow ? "allow" : "block" });
        if (name === "geolocation" && allow && Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude))) await c.send("Emulation.setGeolocationOverride", { latitude: Number(a.latitude), longitude: Number(a.longitude), accuracy: 30 }).catch(() => {});
        const state = await evaluate(c, `navigator.permissions.query({ name: ${JSON.stringify(name === "clipboard" ? "clipboard-read" : name)} }).then((r) => r.state, () => "")`, 5000).catch(() => "");
        emit(u, { t: "agent", kind: "permission", label: `${name}: ${allow ? "cho phép" : "chặn"}` });
        return { ...pg, permission: name, setting: allow ? "allow" : "block", state, origin, ...extra(u) };
      }
      case "eval": {
        const v = await evaluate(c, String(a.expression ?? ""), 30_000);
        return { value: JSON.stringify(v ?? null)?.slice(0, 30_000) ?? "null", ...extra(u) };
      }
      case "console": { const logs = c.logs.slice(-Number(a.limit ?? 50)); if (a.clear) c.logs = []; return { logs, requests: c.net.slice(-30) }; }
      case "network": return { requests: c.net.slice(-Number(a.limit ?? 40)) };
      case "back": case "forward": case "reload": return act(u, { action: "navigate", url: a.action, user: a.user });
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
        if (s.halt) { results.push({ i: i + 1, action: x.action, error: s.halt }); break; }
        try {
          const r = await act(u, x);
          const { image, tree, text, ...rest } = r ?? {};
          results.push({ i: i + 1, action: x.action, ...rest, ...(tree ? { tree } : {}), ...(text ? { text } : {}) });
          if (r?.error) break;
        } catch (e) { results.push({ i: i + 1, action: x.action, error: e.message || String(e) }); break; }
      }
      const c = await env.session(u);
      return { ...(await info(c)), done: results.filter((r) => !r.error).length, total: list.length, results };
    } finally {
      s.acting--;
      emit(u, { t: "agent", kind: "idle" });
    }
  }

  return { tool, act, prepare, humanize, watchDialogs, handleDialog, info, evaluate, state: st };
}
