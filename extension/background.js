// Service worker của tiện ích Synchro: giữ kết nối tới máy chủ Synchro (link.js), chạy thao tác trên trình duyệt (control.js),
// trả lời cửa sổ bật lên (popup.js), hiện logo Synchro trên thanh công cụ theo theme và huy hiệu (mất kết nối / Synchro đang điều khiển).
import { SERVER } from "./config.js";
import { createControl } from "./control.js";
import { t } from "./i18n.js";
import { createLink, normServer } from "./link.js";

const store = {
  get: () => chrome.storage.local.get(["server", "token", "device", "user", "scope"]),
  set: (o) => chrome.storage.local.set(o),
  remove: (keys) => chrome.storage.local.remove(keys),
};
let server = SERVER;
chrome.storage.local.get(["server"]).then((c) => { if (c.server) server = c.server; });

// Tên trình duyệt để người dùng nhận ra trong Synchro (Cài đặt → Khả năng → Trình duyệt của bạn).
function device() {
  const ua = navigator.userAgentData;
  const brands = (ua?.brands ?? []).map((b) => b.brand);
  const browser = navigator.brave ? "Brave" : brands.find((b) => /Edge/.test(b)) ? "Microsoft Edge" : brands.find((b) => /Opera/.test(b)) ? "Opera" : brands.find((b) => /Chrome/.test(b)) ? "Google Chrome" : "Chromium";
  const os = ua?.platform || (/Mac/.test(navigator.userAgent) ? "macOS" : /Win/.test(navigator.userAgent) ? "Windows" : "Linux");
  const version = (ua?.brands ?? []).find((b) => /Chrome|Edge|Chromium/.test(b.brand))?.version ?? "";
  return { name: `${browser} · ${os}`, browser, version, ext: chrome.runtime.getManifest().version };
}

let acting = false, linkState = { state: "unpaired", error: "" }, theme = "light";
function badge() {
  const on = linkState.state === "online";
  chrome.action.setBadgeText({ text: acting ? "●" : on ? "" : linkState.state === "unpaired" ? "" : "!" });
  // Bộ nhận diện v4: không màu nhấn. Đang điều khiển: huy hiệu màu mực (Carbon trên thanh sáng, Ivory trên thanh tối); mất kết nối: Graphite.
  const dark = theme === "dark";
  chrome.action.setBadgeBackgroundColor({ color: acting ? (dark ? "#EEECE5" : "#111210") : dark ? "#5C5D56" : "#85867E" });
  chrome.action.setBadgeTextColor?.({ color: acting && dark ? "#111210" : "#EEECE5" });
  chrome.action.setTitle({ title: `Synchro · ${acting ? t("acting") : on ? t("online") : linkState.state === "unpaired" ? t("pair") : t("offline")}` });
}

// Logo Synchro trên thanh công cụ theo theme sáng / tối của trình duyệt: mark Carbon trên thanh sáng, mark Ivory trên thanh tối.
// Service worker không đọc được theme, nên tài liệu ẩn theme.html đọc rồi báo về; nhớ lại lựa chọn gần nhất.
const icon = (t) => ({ 16: `icons/toolbar-${t}-16.png`, 24: `icons/toolbar-${t}-24.png`, 32: `icons/toolbar-${t}-32.png` });
function setTheme(dark) {
  const t = dark ? "dark" : "light";
  if (t === theme) return;
  theme = t;
  chrome.action.setIcon({ path: icon(t) }).catch(() => {});
  chrome.storage.local.set({ theme: t });
  badge();
}
chrome.storage.local.get(["theme"]).then((c) => { if (c.theme === "dark") setTheme(true); });
async function watchTheme() {
  try {
    if (!chrome.offscreen || (await chrome.offscreen.hasDocument?.())) return;
    await chrome.offscreen.createDocument({ url: "theme.html", reasons: ["MATCH_MEDIA"], justification: "Đổi logo Synchro trên thanh công cụ theo giao diện sáng / tối của trình duyệt." });
  } catch {}
}
watchTheme();

const control = createControl(chrome, {
  server: () => server,
  notify: (m) => link?.send(m),
  onStatus: (s) => { acting = s.acting; badge(); },
  onShared: (ids) => chrome.storage.session.set({ shared: ids }).catch(() => {}),
  save: (v) => chrome.storage.session.set({ ctl: v }).catch(() => {}),
});
const link = createLink({ store, control, device, revoked: t("revoked"), onState: (s) => { linkState = s; badge(); chrome.runtime.sendMessage({ op: "changed" }).catch(() => {}); } });

// Phạm vi đã chọn và các tab đã chia sẻ (giữ qua lần service worker khởi động lại).
chrome.storage.local.get(["scope"]).then((c) => { if (c.scope) control.setScope(c.scope); });
chrome.storage.session.get(["shared", "ctl"]).then((c) => { for (const id of c.shared ?? []) control.share(id, true); control.restore(c.ctl); }).catch(() => {});

chrome.runtime.onStartup.addListener(() => { link.connect(); watchTheme(); });
chrome.runtime.onInstalled.addListener(() => { link.connect(); chrome.alarms.create("synchro-link", { periodInMinutes: 0.5 }); });
chrome.alarms.get("synchro-link").then((a) => { if (!a || a.periodInMinutes !== 0.5) chrome.alarms.create("synchro-link", { periodInMinutes: 0.5 }); }).catch(() => {});
// Dự phòng: 30 giây kiểm tra một lần, mất kết nối thì nối lại (báo thức cũng đánh thức service worker nếu Chrome đã tắt nó).
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "synchro-link" && !link.online()) link.connect(); });
link.connect();

// Cửa sổ bật lên.
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m?.op === "theme") { setTheme(!!m.dark); return false; }
  if (m?.op === "changed") return false;
  (async () => {
    const cfg = await store.get();
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    switch (m.op) {
      case "state": break;
      case "pair": {
        const s = normServer(m.server || server);
        if (!s) return { error: t("badServer") };
        try { await link.pair(s, m.code); server = s; } catch (e) { return { error: e.message === "server" ? t("badServer") : e.message }; }
        break;
      }
      case "unpair": await link.forget(""); break;
      case "scope": control.setScope(m.scope); await store.set({ scope: control.scope() }); link.send({ t: "status", scope: control.scope() }); break;
      case "share": if (tab?.id != null) await control.share(tab.id, !!m.on); break;
      case "stop": await control.stop("user"); break;
      case "pause": control.pause(true); break;
      case "resume": control.pause(false); break;
      case "reconnect": link.connect(); break;
    }
    const st = control.status();
    const c2 = await store.get();
    // Tab Synchro đang làm, để cửa sổ tiện ích ghi "Đang làm trên: …".
    const at = (st.acting || st.paused) && Number(st.tab) ? await chrome.tabs.get(Number(st.tab)).catch(() => null) : null;
    return {
      link: link.state(), server: c2.server || server || "", user: c2.user ?? null, device: c2.device ?? null,
      scope: control.scope(), acting: st.acting, paused: st.paused, actTab: at ? { title: at.title, url: at.url } : null, tab: tab ? { id: tab.id, title: tab.title, url: tab.url, shared: control.isShared(tab.id) } : null,
      paired: !!(cfg.token || c2.token),
    };
  })().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true;
});
