// Lõi điều khiển của tiện ích Synchro: chạy thao tác browser_* trên Chrome / Edge / Brave của người dùng bằng chrome.debugger,
// dùng đúng mã thao tác của trình duyệt Synchro (act.js = workspace/browser-act.mjs). Dùng chung cho tiện ích thật (background.js)
// và tiện ích giả lập khi chạy dev:mock (scripts/mock-extension.mjs, với lớp giả chrome.* trên Chrome thật).
// - Phạm vi: "all" (mặc định, toàn quyền: mọi tab) hoặc "group" (chỉ nhóm tab "Synchro" mà Synchro tự mở và tab người dùng chia sẻ).
//   Không bao giờ điều khiển tab của chính Synchro (trang chat) và trang hệ thống của trình duyệt.
// - Tab Synchro mở nằm trong nhóm tab "Synchro"; mở trang mới thì dùng tab riêng, không đè lên tab người dùng đang xem.
// - Khi điều khiển: dải "Synchro đang điều khiển tab này" + nút Dừng trong trang; Dừng (trong trang, trong cửa sổ tiện ích, hoặc nút Hủy
//   trên thanh gỡ lỗi của Chrome) hủy thao tác đang chạy và mọi thao tác còn lại của lượt đó.
// - Hết lượt (máy chủ gửi release) hoặc rảnh 2 phút: gỡ dải điều khiển và ngắt chrome.debugger (thanh "đang gỡ lỗi" của Chrome biến mất).
import { BrowserError, createActor } from "./act.js";
import { overlayScript } from "./overlay.js";
import { strings } from "./i18n.js";

const STOPPED = 499;
const IDLE_MS = 120_000;
const GROUP = "Synchro";
// Trang không gắn chrome.debugger được (trang hệ thống, cửa hàng tiện ích).
const RESTRICTED = /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|moz-extension|devtools|view-source|chrome-search|chrome-untrusted):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i;
const BLANK = /^(about:blank|chrome:\/\/newtab|chrome:\/\/new-tab-page|edge:\/\/newtab|brave:\/\/newtab|chrome-search:\/\/local-ntp)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error(msg)), ms); p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); }); });

export function createControl(chrome, o = {}) {
  const notify = (m) => o.notify?.(m);
  const self = () => { try { return o.server?.() ? new URL(o.server()).origin : ""; } catch { return ""; } };
  let scope = o.scope === "group" ? "group" : "all";
  const shared = new Set(o.shared ?? []); // tab người dùng chia sẻ (phạm vi "group")
  const mine = new Set(); // tab Synchro tự mở
  const sessions = new Map(); // tabId -> phiên chrome.debugger
  const S = { tab: "", viewers: new Set() };
  let hint = "", idleT = 0, halt = null; // halt: { turn, at } sau khi người dùng bấm Dừng
  let running = null; // { reject } của thao tác đang chạy

  // ---------------------------------------------------------------- phiên chrome.debugger theo tab (giống lớp CDP của browser-core)
  chrome.debugger.onEvent.addListener((src, method, params) => { const s = sessions.get(src.tabId); if (s) s.emit(method, params ?? {}); });
  chrome.debugger.onDetach.addListener((src, reason) => {
    const s = sessions.get(src.tabId);
    if (!s) return;
    sessions.delete(src.tabId);
    s.closed = true; s.emit("close");
    // Người dùng bấm "Hủy" trên thanh "… đang gỡ lỗi trình duyệt này": coi như bấm Dừng.
    if (reason === "canceled_by_user") stop("user");
  });
  function session(tabId) {
    const subs = new Map();
    const raw = (method, params = {}, timeout = 20_000) => withTimeout(chrome.debugger.sendCommand({ tabId }, method, params), timeout, `${method}: quá thời gian`);
    const s = {
      tabId, closed: false,
      emit(ev, p) { for (const f of subs.get(ev) ?? []) { try { f(p); } catch {} } },
      on(ev, f) { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(f); return () => subs.set(ev, (subs.get(ev) ?? []).filter((x) => x !== f)); },
      once(ev, ms) { return new Promise((res) => { const off = s.on(ev, (p) => { off(); clearTimeout(t); res(p); }); const t = setTimeout(() => { off(); res(null); }, ms); }); },
      async send(method, params = {}, timeout = 20_000) {
        if (s.closed) throw new Error("Tab đã đóng hoặc Synchro đã thôi điều khiển tab này.");
        // Ngay trước cú bấm của Synchro: dải điều khiển tạm không nhận chuột (cú bấm không trúng nút Dừng).
        if (method === "Input.dispatchMouseEvent" && (params.type === "mousePressed" || params.type === "mouseWheel")) await raw("Runtime.evaluate", { expression: "window.__synOverlay && window.__synOverlay.guard()" }, 3000).catch(() => {});
        return raw(method, params, timeout);
      },
      close() {},
    };
    return s;
  }
  async function attach(tab) {
    const have = sessions.get(tab.id);
    if (have && !have.closed) return have;
    if (BLANK.test(tab.url || tab.pendingUrl || "") && !/^about:blank/i.test(tab.url || "")) {
      // Trang tab mới của trình duyệt là trang hệ thống: đổi sang trang trống rồi mới gắn được.
      await chrome.tabs.update(tab.id, { url: "about:blank" });
      for (let i = 0; i < 20; i++) { await sleep(100); const t = await chrome.tabs.get(tab.id).catch(() => null); if (t && /^about:blank/.test(t.url || "")) break; }
    } else if (RESTRICTED.test(tab.url || "") && !/^about:/i.test(tab.url || "")) {
      throw new BrowserError(400, `Tab "${tab.title || tab.url}" là trang hệ thống của trình duyệt (${String(tab.url).split("?")[0]}), Synchro không thao tác được. Mở trang web khác (browser_navigate) hoặc chọn tab khác.`);
    }
    try { await chrome.debugger.attach({ tabId: tab.id }, "1.3"); }
    catch (e) {
      const m = String(e?.message ?? e);
      if (!/already attached/i.test(m)) throw new BrowserError(409, `Không điều khiển được tab này: ${m}. Có thể một tiện ích khác đang gỡ lỗi tab; đóng công cụ đó rồi thử lại.`);
    }
    const s = session(tab.id);
    sessions.set(tab.id, s);
    await A.prepare("me", s);
    // Dải điều khiển trong trang (cả các trang mở sau trong tab này) và nút Dừng.
    const src = overlayScript(strings());
    await s.send("Runtime.addBinding", { name: "__synchroStop" }).catch(() => {});
    s.on("Runtime.bindingCalled", (p) => { if (p.name === "__synchroStop") stop("user"); });
    await s.send("Page.addScriptToEvaluateOnNewDocument", { source: src }).catch(() => {});
    await s.send("Runtime.evaluate", { expression: src }).catch(() => {});
    return s;
  }
  async function detachAll() {
    for (const [tabId, s] of [...sessions]) {
      sessions.delete(tabId);
      s.closed = true;
      await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: "window.__synOverlay && window.__synOverlay.remove()" }).catch(() => {});
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- tab trong phạm vi
  const isSelf = (url) => { const me = self(); try { return !!me && new URL(url).origin === me; } catch { return false; } };
  async function inGroup(tab) {
    if (tab.groupId == null || tab.groupId < 0 || !chrome.tabGroups) return false;
    const g = await chrome.tabGroups.get(tab.groupId).catch(() => null);
    return g?.title === GROUP;
  }
  async function allowed(tab) {
    if (!tab || isSelf(tab.url || tab.pendingUrl || "")) return false;
    if (scope === "all" || mine.has(tab.id) || shared.has(tab.id)) return true;
    return inGroup(tab);
  }
  async function tabs() {
    const all = await chrome.tabs.query({});
    const out = [];
    for (const t of all) if (await allowed(t)) out.push(t);
    return out;
  }
  async function group(tabId) {
    if (!chrome.tabGroups || !chrome.tabs.group) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      const [g] = await chrome.tabGroups.query({ windowId: tab.windowId, title: GROUP });
      if (g) { await chrome.tabs.group({ groupId: g.id, tabIds: [tabId] }); return; }
      const id = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(id, { title: GROUP, color: "orange" });
    } catch {}
  }
  async function windowFor() {
    const cur = Number(S.tab) ? await chrome.tabs.get(Number(S.tab)).catch(() => null) : null;
    if (cur) return cur.windowId;
    const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
    return w?.id;
  }
  async function newTab(url) {
    const windowId = await windowFor();
    let tab;
    if (windowId != null) tab = await chrome.tabs.create({ url: url || "about:blank", active: true, windowId });
    else { const w = await chrome.windows.create({ url: url || "about:blank", focused: true }); tab = w.tabs?.[0] ?? (await chrome.tabs.query({ windowId: w.id }))[0]; }
    mine.add(tab.id);
    await group(tab.id);
    return tab;
  }
  // Tab đang dùng khi chưa chọn: mở trang mới → tab riêng của Synchro; đọc / chụp / bấm… → tab người dùng đang xem (toàn quyền),
  // hoặc tab Synchro / tab được chia sẻ gần nhất (phạm vi "group").
  async function pick() {
    const list = await tabs();
    if (hint !== "navigate") {
      if (scope === "all") {
        const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
        const act = list.find((t) => t.active && (w ? t.windowId === w.id : true) && !RESTRICTED.test(t.url || "") );
        if (act) return act;
      }
      const own = list.filter((t) => !RESTRICTED.test(t.url || "") || BLANK.test(t.url || "")).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
      if (own && scope === "group") return own;
    }
    const reuse = list.find((t) => mine.has(t.id));
    if (reuse) return reuse;
    return newTab("about:blank");
  }

  // ---------------------------------------------------------------- thao tác (act.js), trạng thái gửi về Synchro
  const label = (ev) => String(ev.label ?? "").replace(/^https?:\/\//, "").slice(0, 80);
  const A = createActor({
    state: () => S,
    emit: (_u, ev) => {
      if (ev.t !== "agent") return;
      if (ev.kind === "start" || ev.kind === "idle") { report(); return; }
      const s = sessions.get(Number(S.tab));
      if (s && ev.label) s.send("Runtime.evaluate", { expression: `window.__synOverlay && window.__synOverlay.set(${JSON.stringify(label(ev))})` }, 3000).catch(() => {});
      notify({ t: "act", kind: ev.kind, label: String(ev.label ?? "").slice(0, 200) });
    },
    pages: async () => (await tabs()).map((t) => ({ id: String(t.id), title: t.title ?? "", url: t.url || t.pendingUrl || "" })),
    newTab: async (_u, url) => String((await newTab(url)).id),
    closeTab: (_u, id) => chrome.tabs.remove(Number(id)),
    activate: (_u, id) => chrome.tabs.update(Number(id), { active: true }).then(() => {}),
    switched: () => { report(); },
    session: async () => {
      let tab = Number(S.tab) ? await chrome.tabs.get(Number(S.tab)).catch(() => null) : null;
      if (!(await allowed(tab))) { tab = await pick(); S.tab = String(tab.id); }
      return attach(tab);
    },
    // Chụp màn hình: tab phải đang hiện trong cửa sổ; tạm ẩn dải điều khiển để ảnh là trang thật.
    capture: async (_u, c, phase) => {
      if (phase === "start") {
        const tab = await chrome.tabs.get(c.tabId).catch(() => null);
        if (tab && !tab.active) { await chrome.tabs.update(c.tabId, { active: true }).catch(() => {}); await sleep(250); }
        await c.send("Runtime.evaluate", { expression: "window.__synOverlay && window.__synOverlay.pause(true)" }, 3000).catch(() => {});
        await sleep(60);
      } else await c.send("Runtime.evaluate", { expression: "window.__synOverlay && window.__synOverlay.pause(false)" }, 3000).catch(() => {});
    },
    allowFile: false, humanize: false, nativeDialogs: true, keepOne: false,
  });

  // page: { url, title } vừa đọc được từ trang (mới hơn chrome.tabs lúc trang vừa đổi).
  async function report(page) {
    const tab = Number(S.tab) ? await chrome.tabs.get(Number(S.tab)).catch(() => null) : null;
    const list = await tabs().catch(() => []);
    const cur = tab ? { title: (page?.url && page.title) || tab.title || "", url: page?.url || tab.url || "" } : null;
    notify({ t: "status", scope, tab: cur, tabs: list.length, acting: S.acting > 0 });
    o.onStatus?.(status());
  }
  const status = () => ({ scope, acting: S.acting > 0, tab: S.tab, attached: [...sessions.keys()], shared: [...shared], halted: !!halt });

  // Một thao tác từ máy chủ. Người dùng đã bấm Dừng trong lượt này thì từ chối mọi thao tác còn lại của lượt.
  async function call(a, turn = "") {
    if (halt && halt.turn === turn && (turn || Date.now() - halt.at < 15_000)) throw new BrowserError(STOPPED, "Người dùng đã bấm Dừng trong Chrome.");
    halt = null; S.halt = null;
    clearTimeout(idleT);
    hint = a.action === "batch" ? String(a.actions?.[0]?.action ?? "") : String(a.action ?? "");
    let r;
    try {
      r = await new Promise((ok, no) => {
        running = { no, turn };
        A.tool("me", a).then(ok, no);
      });
      return r;
    } finally {
      running = null;
      idleT = setTimeout(() => release(), IDLE_MS);
      report(r).catch(() => {});
    }
  }
  // Dừng: từ người dùng (dải trong trang, cửa sổ tiện ích, nút Hủy của Chrome) hoặc từ Synchro (nút Dừng ở khung chat).
  async function stop(by = "user") {
    const turn = running?.turn ?? "";
    halt = { turn, at: Date.now() };
    S.halt = "Người dùng đã bấm Dừng trong Chrome.";
    running?.no(new BrowserError(STOPPED, by === "user" ? "Người dùng đã bấm Dừng trong Chrome." : "Đã dừng theo yêu cầu từ Synchro."));
    running = null;
    if (by === "user") notify({ t: "stopped" });
    await detachAll();
    report().catch(() => {});
  }
  // Hết lượt: thôi điều khiển (gỡ dải, ngắt chrome.debugger); giữ tab đang dùng để lượt sau làm tiếp.
  async function release() { clearTimeout(idleT); if (S.acting > 0) return; await detachAll(); report().catch(() => {}); }

  // Tab Synchro mở ra (trang mở tab mới, window.open) thuộc về Synchro; tab đóng thì quên.
  chrome.tabs.onCreated?.addListener((t) => { if (t.openerTabId != null && (mine.has(t.openerTabId) || sessions.has(t.openerTabId))) { mine.add(t.id); group(t.id); } });
  chrome.tabs.onRemoved?.addListener((id) => { mine.delete(id); shared.delete(id); sessions.delete(id); if (Number(S.tab) === id) S.tab = ""; o.onShared?.([...shared]); });
  // Tệp tải về (thư mục Tải xuống của người dùng): báo lại cho model khi Synchro đang điều khiển.
  chrome.downloads?.onCreated?.addListener((d) => { if (!sessions.size) return; S.downloads ??= []; S.downloads.unshift({ id: d.id, name: String(d.filename || d.url || "").split(/[\\/]/).pop(), url: d.url, state: "inProgress" }); S.downloads.length = Math.min(S.downloads.length, 30); });
  chrome.downloads?.onChanged?.addListener((d) => { const x = S.downloads?.find((y) => y.id === d.id); if (!x) return; if (d.filename?.current) x.name = d.filename.current.split(/[\\/]/).pop(); if (d.state?.current === "complete") x.state = "completed"; else if (d.state?.current === "interrupted") x.state = "canceled"; });

  return {
    call, stop, release, report, status,
    scope: () => scope,
    setScope(v) { scope = v === "group" ? "group" : "all"; report().catch(() => {}); return scope; },
    async share(tabId, on = true) {
      if (on) shared.add(tabId); else shared.delete(tabId);
      if (on) await group(tabId);
      o.onShared?.([...shared]);
      report().catch(() => {});
    },
    isShared: (tabId) => shared.has(tabId) || mine.has(tabId),
  };
}
