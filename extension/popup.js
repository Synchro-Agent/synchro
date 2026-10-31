// Cửa sổ bật lên của tiện ích Synchro: ghép nối bằng mã, trạng thái kết nối, quyền điều khiển (mọi tab / chỉ nhóm tab Synchro),
// chia sẻ tab đang xem, nút Dừng khi Synchro đang điều khiển, ngắt ghép nối.
import { SERVER } from "./config.js";
import { t } from "./i18n.js";
import { lockup, mark } from "./brand.js";
import { PH } from "./phosphor.js";

const $ = (s) => document.querySelector(s);
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (k.startsWith("aria") || k === "role") e.setAttribute(k.replace(/^aria([A-Z])/, (_, c) => `aria-${c.toLowerCase()}`), v); else if (v !== undefined && v !== false) e[k] = v; } e.append(...kids.flat().filter((x) => x != null && x !== false)); return e; };
// Biểu tượng: Phosphor Regular như app (extension/phosphor.js, lưới 256), tô bằng màu chữ, dựng bằng DOM.
const icon = (n) => {
  const NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 256 256"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of PH[n] ?? []) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); s.append(e); }
  return s;
};
const ask = (m) => chrome.runtime.sendMessage(m);
// Đang chạy: mark của logo xoay theo nhịp đồng bộ (như loader trong app), thay cho chấm / vòng quay.
const loader = (px) => mark(px, "mk-load");
const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const initials = (n) => { const w = String(n || "").trim().split(/[\s@._-]+/).filter(Boolean); return ((w[0]?.[0] ?? "") + (w.length > 1 ? w.at(-1)[0] : "")).toLocaleUpperCase() || "S"; };
// Ảnh đại diện của tài khoản (ảnh tự tải lên hoặc từ Google / GitHub, máy chủ gửi khi ghép nối / kết nối); không có hoặc lỗi tải thì chữ cái đầu.
const avatar = (u, name) => {
  const box = h("span", { className: "av", ariaHidden: "true" }, initials(name));
  const src = String(u?.avatar ?? "");
  if (/^https:\/\//.test(src) || /^data:image\/(png|jpeg|webp);base64,/.test(src)) {
    const img = h("img", { src, alt: "", referrerPolicy: "no-referrer", decoding: "async" });
    img.addEventListener("load", () => box.replaceChildren(img), { once: true });
    img.addEventListener("error", () => img.remove(), { once: true });
  }
  return box;
};
// Mã ghép nối luôn hiện dạng ABCD-EFGH khi gõ / dán.
const fmtCode = (v) => { const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; };
for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
// Logo đầu cửa sổ: mở ra thì hai nửa đang khớp thành vòng tròn tách ra thành chữ S; rê chuột thì khớp lại; ghép nối xong thì khớp pha một nhịp.
const logo = lockup(17, "intro");
$("#logo").append(logo);
const synced = () => { logo.classList.remove("intro", "synced"); void logo.getBoundingClientRect(); logo.classList.add("synced"); };
// Báo theme cho background (dự phòng khi trình duyệt không có chrome.offscreen): logo trên thanh công cụ đổi theo.
chrome.runtime.sendMessage({ op: "theme", dark: matchMedia("(prefers-color-scheme: dark)").matches }).catch(() => {});

let busy = false, err = "", codeVal = "", srvVal = null, srvEdit = false;
async function render(s) {
  s ??= await ask({ op: "state" });
  const st = $("#st");
  const state = s.paused ? "paused" : s.acting ? "acting" : s.link?.state ?? "unpaired";
  st.className = `st ${state}`;
  st.replaceChildren(...(state === "acting" || state === "connecting" ? [loader(11)] : state === "paused" ? [mark(11)] : []),
    t(s.paused ? "stPaused" : s.acting ? "stActing" : state === "online" ? "stOnline" : state === "unpaired" ? "stUnpaired" : state === "connecting" ? "stConnecting" : "stOffline"));
  const app = $("#app");
  app.replaceChildren();
  const put = (...kids) => app.append(...kids.filter((x) => x != null && x !== false));
  const openSynchro = (url) => h("button", { className: "ghost", on: { click: () => chrome.tabs.create({ url }) } }, icon("open"), t("open"));
  if (!s.paired) {
    const known = s.server || SERVER || "";
    const server = h("input", { type: "text", id: "server", value: srvVal ?? known, placeholder: "https://…", spellcheck: false, on: { input: () => { srvVal = server.value; } } });
    const code = h("input", { type: "text", id: "code", className: "code", value: codeVal, placeholder: "ABCD-EFGH", maxLength: 9, autocomplete: "off", spellcheck: false, ariaLabel: t("code") });
    code.addEventListener("input", () => { code.value = codeVal = fmtCode(code.value); });
    const go = async () => {
      const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      codeVal = fmtCode(code.value);
      if (c.length !== 8) { err = t("badCode"); return render(s); }
      busy = true; err = ""; render(s);
      const r = await ask({ op: "pair", server: server.value, code: c });
      busy = false; err = r.error ?? "";
      if (!r.error) { codeVal = ""; srvVal = null; srvEdit = false; synced(); }
      render(r.error ? s : r);
    };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    server.addEventListener("keydown", (e) => { if (e.key === "Enter") code.focus(); });
    const editing = srvEdit || !known;
    const msg = err || s.link?.error;
    put(
      h("section", { className: "hero" }, h("h1", {}, t("heroTitle")), h("p", {}, t("sub"))),
      h("ol", { className: "steps" }, [t("step1"), t("step2"), t("step3")].map((x, i) => h("li", {}, h("span", { className: "n" }, String(i + 1)), h("span", {}, x)))),
      editing ? h("div", { className: "field" }, h("label", { htmlFor: "server" }, t("server")), server) : null,
      h("div", { className: "field" }, h("label", { htmlFor: "code" }, t("code")), code),
      editing ? null : h("div", { className: "srv" }, icon("globe"), h("span", { className: "ell" }, t("serverAt"), " ", h("b", {}, host(srvVal ?? known))),
        h("button", { className: "link", on: { click: () => { srvEdit = true; render(s).then(() => $("#server")?.focus()); } } }, t("change"))),
      msg ? h("p", { className: "err", role: "alert" }, icon("alert"), h("span", {}, msg)) : null,
      h("button", { className: "pri", disabled: busy, on: { click: go } }, busy ? [loader(16), t("pairing")] : [t("pair"), icon("arrow")]),
      known ? h("footer", {}, openSynchro(known)) : null,
    );
    if (!busy) setTimeout(() => (editing && !server.value ? server : code).focus(), 30);
    return;
  }
  const tab = s.tab;
  const restricted = !tab?.url || /^(chrome|edge|brave|about|chrome-extension):/i.test(tab.url);
  const name = s.user?.name || s.user?.email || "";
  const online = s.link?.state === "online";
  const bad = !online && s.link?.error;
  const seg = (v, label, ic) => h("label", {}, h("input", { type: "radio", name: "scope", value: v, checked: s.scope === v, on: { change: async () => render(await ask({ op: "scope", scope: v })) } }), icon(ic), label);
  put(
    s.acting || s.paused ? h("section", { className: `live${s.paused ? " paused" : ""}` },
      h("div", { className: "live-h" }, s.paused ? mark(22) : loader(22),
        h("div", {}, h("b", {}, t(s.paused ? "paused" : "acting")), h("small", { className: "ell" }, s.paused ? t("pausedHelp") : s.actTab?.title ? `${t("actingOn")} ${s.actTab.title}` : t("actingHelp")))),
      // Tạm dừng / Tiếp tục: thao tác đang chạy làm nốt, thao tác kế tiếp chờ tới khi bấm Tiếp tục. Dừng: dừng hẳn lượt này.
      h("div", { className: "live-a" },
        h("button", { className: `pz${s.paused ? " go" : ""}`, on: { click: async () => render(await ask({ op: s.paused ? "resume" : "pause" })) } }, h("i", { className: s.paused ? "play" : "bars" }), t(s.paused ? "resume" : "pause")),
        h("button", { className: `stop${s.paused ? " soft" : ""}`, on: { click: async () => render(await ask({ op: "stop" })) } }, h("i"), t("stop")))) : null,
    h("section", { className: "card" },
      h("div", { className: "who" }, avatar(s.user, name),
        h("div", { className: "who-t" }, h("b", { className: "ell" }, name), h("small", {}, icon("globe"), h("span", { className: "ell" }, host(s.server))))),
      s.acting || s.paused ? null : h("div", { className: `note${bad ? " bad" : ""}` },
        bad ? [icon("alert"), h("span", {}, s.link.error)]
          : online ? [mark(15), h("span", {}, h("b", {}, t("idle")), " ", t("idleHelp"))]
          : [loader(15), h("span", {}, t(s.link?.state === "connecting" ? "connecting" : "offline"))])),
    h("section", { className: "sec" },
      h("div", { className: "sec-h" }, t("scope")),
      h("div", { className: "seg", role: "radiogroup", ariaLabel: t("scope") }, seg("all", t("scopeAll"), "tabs"), seg("group", t("scopeGroup"), "group")),
      h("p", { className: "hint" }, t(s.scope === "group" ? "scopeGroupHelp" : "scopeAllHelp")),
      s.scope === "group" && tab && !restricted ? h("div", { className: "card tabrow" }, icon("tab"),
        h("div", { className: "tt" }, h("b", {}, t("share")), h("small", { className: "ell" }, tab.title || host(tab.url))),
        h("button", { className: "sw", role: "switch", ariaChecked: String(!!tab.shared), ariaLabel: t("share"), on: { click: async () => render(await ask({ op: "share", on: !tab.shared })) } })) : null),
    h("footer", {}, openSynchro(s.server),
      h("button", { className: "ghost danger", on: { click: async () => render(await ask({ op: "unpair" })) } }, icon("leave"), t("unpair"))),
  );
}
chrome.runtime.onMessage.addListener((m) => { if (m.op === "changed" && !busy) render(); });
render();
