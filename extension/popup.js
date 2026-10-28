// Cửa sổ bật lên của tiện ích Synchro: ghép nối bằng mã, trạng thái kết nối, quyền điều khiển (mọi tab / chỉ nhóm tab Synchro),
// chia sẻ tab đang xem, nút Dừng khi Synchro đang điều khiển, ngắt ghép nối.
import { SERVER } from "./config.js";
import { t } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (v !== undefined && v !== false) e[k] = v; } e.append(...kids.flat().filter((x) => x != null && x !== false)); return e; };
const ask = (m) => chrome.runtime.sendMessage(m);
for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);

let busy = false, err = "";
async function render(s) {
  s ??= await ask({ op: "state" });
  const st = $("#st");
  const state = s.acting ? "acting" : s.link?.state ?? "unpaired";
  st.className = `st ${state}`;
  st.textContent = s.acting ? t("acting") : state === "online" ? t("online") : state === "unpaired" ? t("unpaired") : state === "connecting" ? t("connecting") : t("offline");
  const app = $("#app");
  app.replaceChildren();
  const put = (...kids) => app.append(...kids.filter((x) => x != null && x !== false));
  if (!s.paired) {
    const server = h("input", { type: "text", id: "server", value: s.server || SERVER || "", placeholder: "https://…", spellcheck: false });
    const code = h("input", { type: "text", id: "code", placeholder: "ABCD-EFGH", maxLength: 9, autocomplete: "off", spellcheck: false });
    const go = async () => {
      const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length !== 8) { err = t("badCode"); return render(s); }
      busy = true; err = ""; render(s);
      const r = await ask({ op: "pair", server: server.value, code: c });
      busy = false; err = r.error ?? "";
      render(r.error ? s : r);
    };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    put(
      h("p", {}, t("sub")),
      h("label", {}, t("server"), server),
      h("label", {}, t("code"), code),
      h("p", { className: "k" }, t("codeHelp")),
      err || s.link?.error ? h("p", { className: "err" }, err || s.link.error) : null,
      h("button", { className: "pri", disabled: busy, on: { click: go } }, busy ? t("pairing") : t("pair")),
    );
    setTimeout(() => (server.value ? code : server).focus(), 30);
    return;
  }
  const scope = (v, title, help) => h("label", { className: "opt" }, h("input", { type: "radio", name: "scope", checked: s.scope === v, on: { change: async () => render(await ask({ op: "scope", scope: v })) } }), h("span", {}, title, h("small", {}, help)));
  const tab = s.tab;
  const restricted = !tab?.url || /^(chrome|edge|brave|about|chrome-extension):/i.test(tab.url);
  put(
    s.acting ? h("button", { className: "stop", on: { click: async () => render(await ask({ op: "stop" })) } }, t("stop")) : h("p", {}, t("idle")),
    h("div", { className: "box" },
      h("div", { className: "row" }, h("span", { className: "k" }, t("account")), h("span", { className: "ell" }, s.user?.name || s.user?.email || "")),
      h("div", { className: "row" }, h("span", { className: "k" }, "Synchro"), h("span", { className: "ell" }, (s.server || "").replace(/^https?:\/\//, ""))),
      s.link?.state !== "online" && s.link?.error ? h("p", { className: "err" }, s.link.error) : null,
    ),
    h("div", { className: "box" }, h("b", {}, t("scope")), scope("all", t("scopeAll"), t("scopeAllHelp")), scope("group", t("scopeGroup"), t("scopeGroupHelp"))),
    s.scope === "group" && tab && !restricted ? h("div", { className: "row" },
      h("span", { className: "ell" }, tab.shared ? t("shared") : tab.title || tab.url),
      h("button", { on: { click: async () => render(await ask({ op: "share", on: !tab.shared })) } }, tab.shared ? t("unshare") : t("share"))) : null,
    h("footer", {},
      h("button", { className: "link", on: { click: () => chrome.tabs.create({ url: s.server }) } }, t("open")),
      h("button", { className: "link", on: { click: async () => render(await ask({ op: "unpair" })) } }, t("unpair"))),
  );
}
chrome.runtime.onMessage.addListener((m) => { if (m.op === "changed" && !busy) render(); });
render();
