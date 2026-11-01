// Cửa sổ bật lên của tiện ích Synchro: ghép nối bằng mã, trạng thái kết nối, quyền điều khiển (mọi tab / chỉ nhóm tab Synchro),
// chia sẻ tab đang xem, nút Tạm dừng / Dừng khi Synchro đang điều khiển, ngắt ghép nối.
// Đầu cửa sổ là khối "cầu nối" (trình duyệt này ⟷ Synchro) dựng một lần rồi chỉ đổi lớp theo trạng thái, nên nhịp chạy trên cầu không giật
// khi cửa sổ vẽ lại; phần dưới (#app) vẽ lại mỗi lần trạng thái đổi.
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

let busy = false, err = "", codeVal = "", srvVal = null, srvEdit = false, shake = false;

// ---------------------------------------------------------------- khối cầu nối: nút trình duyệt — đường nối có nhịp chạy — nút Synchro
const hero = $("#hero");
const synMark = mark(20);
const chip = h("span", { className: "chip" });
const hTitle = h("h1", {}), hSub = h("p", { className: "sub" }), hActs = h("div", { className: "acts" });
hero.append(
  h("div", { className: "stage", ariaHidden: "true" },
    h("div", { className: "bridge" },
      h("span", { className: "node nb" }, icon("tab")),
      h("span", { className: "track" }, h("i", { className: "wire" }), h("i", { className: "pulse" }), chip),
      h("span", { className: "node ns" }, synMark)),
    h("div", { className: "caps" }, h("span", {}, t("nodeBrowser")), h("span", {}, "Synchro"))),
  h("div", { className: "copy" }, hTitle, hSub), hActs);
let chipFor = "";
function paintHero(state, title, sub, { bad = false, acts = [] } = {}) {
  hero.className = `hero s-${state}`;
  synMark.classList.toggle("mk-load", state === "acting" || state === "connecting");
  const c = { unpaired: "link", paused: "pause", offline: "alert", online: "check" }[state] ?? "";
  if (c !== chipFor) { chipFor = c; chip.replaceChildren(...(c ? [icon(c)] : [])); }
  hTitle.textContent = title;
  hSub.textContent = sub || "";
  hSub.classList.toggle("bad", !!bad);
  hActs.replaceChildren(...acts);
}

// Mã ghép nối 8 ô (ABCD-EFGH): ô nhập thật phủ lên trên (gõ, dán, đọc màn hình như ô nhập thường), các ô chỉ để hiển thị.
function codeBox() {
  const code = h("input", { type: "text", id: "code", className: "code", value: codeVal, maxLength: 9, autocomplete: "one-time-code", spellcheck: false, ariaLabel: t("code"), placeholder: "ABCD-EFGH" });
  const cells = Array.from({ length: 8 }, () => h("span", { className: "cell" }));
  const box = h("div", { className: `otp${shake ? " shake" : ""}${err ? " bad" : ""}` },
    h("div", { className: "cells", ariaHidden: "true" }, ...cells.slice(0, 4), h("span", { className: "dash" }), ...cells.slice(4)), code);
  const paint = () => {
    const raw = code.value.replace(/-/g, ""), focus = document.activeElement === code;
    cells.forEach((c, i) => { c.textContent = raw[i] ?? ""; c.classList.toggle("fill", !!raw[i]); c.classList.toggle("on", focus && i === Math.min(raw.length, 7)); });
    box.classList.toggle("full", raw.length === 8);
  };
  code.addEventListener("input", () => { code.value = codeVal = fmtCode(code.value); paint(); });
  for (const ev of ["focus", "blur", "keyup", "click"]) code.addEventListener(ev, paint);
  paint();
  shake = false;
  return { box, code };
}

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
    paintHero("unpaired", t("heroTitle"), t("sub"));
    const known = s.server || SERVER || "";
    const server = h("input", { type: "text", id: "server", value: srvVal ?? known, placeholder: "https://…", spellcheck: false, on: { input: () => { srvVal = server.value; } } });
    const { box, code } = codeBox();
    const go = async () => {
      const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      codeVal = fmtCode(code.value);
      if (c.length !== 8) { err = t("badCode"); shake = true; return render(s); }
      busy = true; err = ""; render(s);
      const r = await ask({ op: "pair", server: server.value, code: c });
      busy = false; err = r.error ?? "";
      if (r.error) shake = true;
      if (!r.error) { codeVal = ""; srvVal = null; srvEdit = false; synced(); }
      render(r.error ? s : r);
    };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    server.addEventListener("keydown", (e) => { if (e.key === "Enter") code.focus(); });
    const editing = srvEdit || !known;
    const msg = err || s.link?.error;
    put(
      h("ol", { className: "steps" }, [t("step1"), t("step2"), t("step3")].map((x) => h("li", {}, h("span", { className: "dot" }), h("span", {}, x)))),
      editing ? h("div", { className: "field" }, h("label", { htmlFor: "server" }, t("server")), server) : null,
      h("div", { className: "field" }, h("label", { htmlFor: "code" }, t("code")), box),
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
  // Tạm dừng / Tiếp tục: thao tác đang chạy làm nốt, thao tác kế tiếp chờ tới khi bấm Tiếp tục. Dừng: dừng hẳn lượt này.
  const acts = s.acting || s.paused ? [
    h("button", { className: `pz${s.paused ? " go" : ""}`, on: { click: async () => render(await ask({ op: s.paused ? "resume" : "pause" })) } }, icon(s.paused ? "play" : "pause"), t(s.paused ? "resume" : "pause")),
    h("button", { className: `stop${s.paused ? " soft" : ""}`, on: { click: async () => render(await ask({ op: "stop" })) } }, icon("stop"), t("stop")),
  ] : [];
  if (s.paused) paintHero("paused", t("paused"), t("pausedHelp"), { acts });
  else if (s.acting) paintHero("acting", t("acting"), s.actTab?.title ? `${t("actingOn")} ${s.actTab.title}` : t("actingHelp"), { acts });
  else if (online) paintHero("online", t("hReady"), t("idleHelp"));
  else if (s.link?.state === "connecting" && !bad) paintHero("connecting", t("hConnecting"), t("connecting"));
  else paintHero("offline", t("hOffline"), bad || t("offlineHelp"), { bad: !!bad });
  const seg = (v, label, ic) => h("label", {}, h("input", { type: "radio", name: "scope", value: v, checked: s.scope === v, on: { change: async () => render(await ask({ op: "scope", scope: v })) } }), icon(ic), label);
  put(
    h("section", { className: "card who" }, avatar(s.user, name),
      h("div", { className: "who-t" }, h("b", { className: "ell" }, name), h("small", {}, icon("globe"), h("span", { className: "ell" }, host(s.server))))),
    h("section", { className: "sec" },
      h("div", { className: "sec-h" }, t("scope")),
      h("div", { className: "seg", role: "radiogroup", ariaLabel: t("scope") }, seg("all", t("scopeAll"), "tabs"), seg("group", t("scopeGroup"), "group")),
      h("p", { className: "hint" }, t(s.scope === "group" ? "scopeGroupHelp" : "scopeAllHelp")),
      s.scope === "group" && tab && !restricted ? h("div", { className: "card tabrow" }, h("span", { className: "tab-ic" }, icon("tab")),
        h("div", { className: "tt" }, h("b", {}, t("share")), h("small", { className: "ell" }, tab.title || host(tab.url))),
        h("button", { className: "sw", role: "switch", ariaChecked: String(!!tab.shared), ariaLabel: t("share"), on: { click: async () => render(await ask({ op: "share", on: !tab.shared })) } })) : null),
    h("footer", {}, openSynchro(s.server),
      h("button", { className: "ghost danger", on: { click: async () => render(await ask({ op: "unpair" })) } }, icon("leave"), t("unpair"))),
  );
}
chrome.runtime.onMessage.addListener((m) => { if (m.op === "changed" && !busy) render(); });
// Lần mở đầu: các khối hiện lần lượt (nhẹ); những lần vẽ lại sau không chạy lại.
render().then(() => setTimeout(() => document.body.classList.remove("boot"), 700));
