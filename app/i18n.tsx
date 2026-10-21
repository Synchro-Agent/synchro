"use client";

import { useEffect } from "react";
import { usePref } from "./store";
import { EN2VI, RULES_EN, RULES_VI, VI2EN } from "./i18n-dict";

export type Lang = "vi" | "en";

let cur: Lang = "vi";
if (typeof window !== "undefined") {
  try { const v = JSON.parse(localStorage.getItem("p:uilang") ?? '"vi"'); cur = v === "en" ? "en" : "vi"; } catch {}
}
export const getLang = () => cur;
export const LANG_NAMES: Record<Lang, string> = { vi: "Tiếng Việt", en: "English" };

export function tr(s: string, lang: Lang = cur): string {
  const t = s.trim();
  if (!t) return s;
  const map = lang === "en" ? VI2EN : EN2VI;
  let out: string | undefined = Object.prototype.hasOwnProperty.call(map, t) ? map[t] : undefined;
  if (out === undefined) {
    for (const [re, f] of lang === "en" ? RULES_EN : RULES_VI) {
      const m = t.match(re);
      if (m) { out = f(m); break; }
    }
  }
  return out === undefined ? s : s.replace(t, () => out as string);
}

const SKIP = "script,style,textarea,input,code,pre,[data-notr],.ai-msg,.user-msg,.mdx,.title-edit";
const ATTRS = ["placeholder", "title", "aria-label"];
type Rec = { o: string; t: string };
const texts = new WeakMap<Text, Rec>();
const attrs = new WeakMap<Element, Record<string, Rec>>();

function doText(n: Text, lang: Lang) {
  if (n.parentElement?.closest(SKIP)) return;
  const v = n.nodeValue ?? "";
  const prev = texts.get(n);
  const o = prev && prev.t === v ? prev.o : v;
  const t = tr(o, lang);
  if (t !== v) n.nodeValue = t;
  texts.set(n, { o, t });
}

function doAttrs(e: Element, lang: Lang) {
  if (e.closest(SKIP.replace("textarea,input,", ""))) return;
  const m = attrs.get(e) ?? {};
  for (const a of ATTRS) {
    const v = e.getAttribute(a);
    if (v === null) continue;
    const prev = m[a];
    const o = prev && prev.t === v ? prev.o : v;
    const t = tr(o, lang);
    if (t !== v) e.setAttribute(a, t);
    m[a] = { o, t };
  }
  attrs.set(e, m);
}

function walk(root: Node, lang: Lang) {
  if (root.nodeType === 3) { doText(root as Text, lang); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = tw.nextNode())) doText(n as Text, lang);
  if (el.matches("[placeholder],[title],[aria-label]")) doAttrs(el, lang);
  el.querySelectorAll("[placeholder],[title],[aria-label]").forEach((x) => doAttrs(x, lang));
}

export function I18n() {
  const [lang] = usePref<Lang>("uilang", "vi");
  useEffect(() => {
    cur = lang;
    const html = document.documentElement;
    html.lang = lang;
    html.dataset.lang = lang;
    const run = () => walk(document.body, lang);
    run();
    const mo = new MutationObserver((list) => {
      mo.disconnect();
      for (const r of list) {
        if (r.type === "characterData") doText(r.target as Text, lang);
        else if (r.type === "attributes") doAttrs(r.target as Element, lang);
        else r.addedNodes.forEach((n) => walk(n, lang));
      }
      mo.observe(document.body, cfg);
    });
    const cfg: MutationObserverInit = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS };
    mo.observe(document.body, cfg);
    return () => mo.disconnect();
  }, [lang]);
  return null;
}
