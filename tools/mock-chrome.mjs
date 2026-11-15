// Lớp giả chrome.* (debugger, tabs, tabGroups, windows, downloads, contentSettings) trên một Chrome thật điều khiển qua DevTools, để chạy đúng
// mã của tiện ích Synchro (extension/control.js, link.js) bên ngoài Chrome: tiện ích giả lập khi chạy dev:mock (tools/mock-extension.mjs) và kiểm thử.
// Chỉ có phần tiện ích dùng tới; một cửa sổ (id 1). Tab id là số như Chrome thật, ánh xạ tới target id của DevTools.
// o.downloads: thư mục tải về (chrome.downloads báo tệp tải như Chrome thật).
import path from "node:path";
import { WebSocket } from "ws";
import { CDP, devJson } from "../workspace/browser-core.mjs";

const ev = () => { const fs = new Set(); return { addListener: (f) => fs.add(f), removeListener: (f) => fs.delete(f), fire: (...a) => { for (const f of fs) { try { f(...a); } catch {} } } }; };

export async function createChrome(base, o = {}) {
  const ver = await devJson(`${base}/json/version`);
  const bc = await CDP.open(ver.webSocketDebuggerUrl.replace(/\/\/[^/]+/, `//${new URL(base).host}`));
  const ids = new Map(), tids = new Map(); // targetId <-> tab id
  const tabs = new Map(); // tab id -> { id, targetId, url, title, active, windowId, groupId, openerTabId, lastAccessed, index }
  const groups = new Map(); // group id -> { id, title, color, windowId }
  let nextTab = 100, nextGroup = 1, order = 0;
  const onCreated = ev(), onRemoved = ev(), onUpdated = ev(), onEvent = ev(), onDetach = ev();
  const pub = (t) => ({ id: t.id, windowId: 1, url: t.url, title: t.title, active: t.active, groupId: t.groupId, openerTabId: t.openerTabId, lastAccessed: t.lastAccessed, index: t.index });
  const add = (info) => {
    if (info.type !== "page" || ids.has(info.targetId)) return ids.get(info.targetId);
    const id = nextTab++;
    ids.set(info.targetId, id); tids.set(id, info.targetId);
    const t = { id, targetId: info.targetId, url: info.url, title: info.title, active: false, groupId: -1, openerTabId: info.openerId ? ids.get(info.openerId) : undefined, lastAccessed: Date.now(), index: order++ };
    tabs.set(id, t);
    onCreated.fire(pub(t));
    return id;
  };
  bc.on("Target.targetCreated", (p) => add(p.targetInfo));
  bc.on("Target.targetInfoChanged", (p) => { const id = ids.get(p.targetInfo.targetId); const t = tabs.get(id); if (t) { t.url = p.targetInfo.url; t.title = p.targetInfo.title; onUpdated.fire(id, { url: t.url, title: t.title }, pub(t)); } });
  bc.on("Target.targetDestroyed", (p) => { const id = ids.get(p.targetId); if (id == null) return; ids.delete(p.targetId); tids.delete(id); tabs.delete(id); onRemoved.fire(id, { windowId: 1 }); const s = att.get(id); if (s) { att.delete(id); s.close(); onDetach.fire({ tabId: id }, "target_closed"); } });
  await bc.send("Target.setDiscoverTargets", { discover: true });
  for (const t of (await bc.send("Target.getTargets")).targetInfos) add(t);
  const first = [...tabs.values()][0]; if (first) first.active = true;
  const get = (id) => { const t = tabs.get(Number(id)); if (!t) throw new Error(`No tab with id: ${id}.`); return t; };
  const waitTab = async (targetId) => { for (let i = 0; i < 50 && !ids.has(targetId); i++) await new Promise((r) => setTimeout(r, 40)); return ids.get(targetId) ?? add({ type: "page", targetId, url: "about:blank", title: "" }); };
  const activate = (t) => { for (const x of tabs.values()) x.active = x === t; t.lastAccessed = Date.now(); };

  // chrome.debugger: mỗi tab một WebSocket DevTools; sự kiện chuyển hết cho onEvent như Chrome.
  const att = new Map();
  const dbg = {
    async attach({ tabId }) {
      if (att.has(tabId)) throw new Error(`Another debugger is already attached to the tab with id: ${tabId}.`);
      const t = get(tabId);
      const ws = new WebSocket(`ws://${new URL(base).host}/devtools/page/${t.targetId}`, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
      await new Promise((ok, no) => { ws.once("open", ok); ws.once("error", no); });
      const s = { ws, n: 0, wait: new Map(), close: () => { try { ws.close(); } catch {} } };
      ws.on("message", (m) => {
        let j; try { j = JSON.parse(m.toString()); } catch { return; }
        if (j.id && s.wait.has(j.id)) { const w = s.wait.get(j.id); s.wait.delete(j.id); j.error ? w.no(new Error(j.error.message)) : w.ok(j.result); }
        // Phiên con (khung con khác nguồn, chrome.debugger từ Chrome 125): src kèm sessionId.
        else if (j.method) onEvent.fire(j.sessionId ? { tabId, sessionId: j.sessionId } : { tabId }, j.method, j.params);
      });
      ws.on("close", () => { for (const w of s.wait.values()) w.no(new Error("Detached while handling command.")); s.wait.clear(); if (att.get(tabId) === s) { att.delete(tabId); onDetach.fire({ tabId }, "target_closed"); } });
      att.set(tabId, s);
    },
    async detach({ tabId }) { const s = att.get(tabId); if (!s) throw new Error("Debugger is not attached to the tab with id: " + tabId); att.delete(tabId); s.close(); },
    sendCommand({ tabId, sessionId }, method, params = {}) {
      const s = att.get(tabId);
      if (!s) return Promise.reject(new Error(`Debugger is not attached to the tab with id: ${tabId}.`));
      const id = ++s.n;
      return new Promise((ok, no) => { s.wait.set(id, { ok, no }); s.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    },
    onEvent, onDetach,
    // Người dùng bấm "Hủy" trên thanh gỡ lỗi của Chrome (kiểm thử gọi để giả lập).
    cancelByUser(tabId) { const s = att.get(tabId); if (!s) return; att.delete(tabId); s.close(); onDetach.fire({ tabId }, "canceled_by_user"); },
  };

  // chrome.downloads: tệp tải về thư mục o.downloads.
  const dls = new Map(); let nextDl = 1;
  const onDlCreated = ev(), onDlChanged = ev();
  if (o.downloads) {
    await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: o.downloads, eventsEnabled: true });
    bc.on("Browser.downloadWillBegin", (p) => { const d = { id: nextDl++, url: p.url, finalUrl: p.url, filename: "", mime: "", state: "in_progress", fileSize: 0, totalBytes: 0, name: p.suggestedFilename }; dls.set(p.guid, d); onDlCreated.fire({ id: d.id, url: d.url, filename: "", state: "in_progress" }); });
    bc.on("Browser.downloadProgress", (p) => {
      const d = dls.get(p.guid); if (!d || p.state === "inProgress") return;
      d.state = p.state === "completed" ? "complete" : "interrupted"; d.filename = path.join(o.downloads, d.name); d.fileSize = d.totalBytes = p.totalBytes;
      onDlChanged.fire({ id: d.id, filename: { current: d.filename }, state: { current: d.state } });
    });
  }
  // chrome.contentSettings: quyền theo trang (Chrome thật lưu ở cài đặt trang web; ở đây đặt thẳng bằng Browser.setPermission).
  const perm = (names) => ({ async set({ primaryPattern, setting }) {
    const origin = String(primaryPattern).replace(/\/\*$/, "");
    for (const name of names) await bc.send("Browser.setPermission", { permission: { name }, setting: setting === "allow" ? "granted" : setting === "block" ? "denied" : "prompt", origin });
  } });

  const chrome = {
    debugger: dbg,
    downloads: { onCreated: onDlCreated, onChanged: onDlChanged, async search({ id } = {}) { return [...dls.values()].filter((d) => id == null || d.id === id).map(({ name, ...d }) => d); } },
    contentSettings: { notifications: perm(["notifications"]), location: perm(["geolocation"]), camera: perm(["camera"]), microphone: perm(["microphone"]), clipboard: perm(["clipboard-read", "clipboard-write"]) },
    tabs: {
      // Như Chrome: tiêu đề, địa chỉ luôn mới (sự kiện của DevTools không báo khi trang đổi tiêu đề).
      async query(q = {}) {
        const live = await devJson(`${base}/json/list`).catch(() => []);
        for (const x of live) { const t = tabs.get(ids.get(x.id)); if (t) { t.title = x.title; t.url = x.url; } }
        return [...tabs.values()].filter((t) => (q.active == null || t.active === q.active)).sort((a, b) => a.index - b.index).map(pub);
      },
      async get(id) { const t = get(id); const x = (await devJson(`${base}/json/list`).catch(() => [])).find((y) => y.id === t.targetId); if (x) { t.title = x.title; t.url = x.url; } return pub(t); },
      async create({ url = "about:blank", active = true } = {}) {
        const { targetId } = await bc.send("Target.createTarget", { url });
        const id = await waitTab(targetId);
        if (active) activate(get(id));
        return pub(get(id));
      },
      async update(id, p = {}) {
        const t = get(id);
        if (p.active) { activate(t); await bc.send("Target.activateTarget", { targetId: t.targetId }).catch(() => {}); }
        if (p.url) {
          const c = await CDP.open(`ws://${new URL(base).host}/devtools/page/${t.targetId}`);
          await c.send("Page.navigate", { url: p.url }).finally(() => c.close());
          t.url = p.url;
        }
        return pub(t);
      },
      // Như Chrome: xong khi tab đã đóng hẳn.
      async remove(id) { const t = get(id); await bc.send("Target.closeTarget", { targetId: t.targetId }); for (let i = 0; i < 50 && tabs.has(t.id); i++) await new Promise((r) => setTimeout(r, 40)); },
      async group({ tabIds, groupId }) {
        const gid = groupId ?? nextGroup++;
        if (!groups.has(gid)) groups.set(gid, { id: gid, title: "", color: "grey", windowId: 1 });
        for (const id of [].concat(tabIds)) get(id).groupId = gid;
        return gid;
      },
      onCreated, onRemoved, onUpdated,
    },
    tabGroups: {
      async get(id) { const g = groups.get(id); if (!g) throw new Error(`No group with id: ${id}.`); return { ...g }; },
      async query(q = {}) { return [...groups.values()].filter((g) => (q.title == null || g.title === q.title)).map((g) => ({ ...g })); },
      async update(id, p) { const g = groups.get(id); Object.assign(g, p); return { ...g }; },
    },
    windows: {
      async getLastFocused() { return { id: 1, type: "normal", focused: true }; },
      async create({ url }) { const t = await chrome.tabs.create({ url }); return { id: 1, tabs: [t] }; },
    },
  };
  return { chrome, close: () => { for (const s of att.values()) s.close(); bc.close(); }, targetOf: (id) => tids.get(Number(id)), tabOf: (targetId) => ids.get(targetId) };
}
