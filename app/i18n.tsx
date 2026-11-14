"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePref } from "./store";
import { cxActEn } from "./cxactions";
import { type Dict, type Lang, type Vars, tfWith, trcWith, trWith } from "./i18n-core";

export type { Lang } from "./i18n-core";

let cur: Lang = "vi";
if (typeof window !== "undefined") {
  try { const v = JSON.parse(localStorage.getItem("p:uilang") ?? '"vi"'); cur = v === "en" ? "en" : "vi"; } catch {}
}
export const getLang = () => cur;
/** Chỉ cho nhánh không phải chữ (chọn kiểu định dạng, giá trị lưu…). Chữ hiển thị thì dùng tr / tf. */
export const isEn = () => cur === "en";

// Mỗi trình duyệt chỉ tải từ điển của ngôn ngữ đang dùng (từng chiếm một phần ba JS tải đầu). Từ điển về sau khung trang: trang chính giữ khung chờ tới lúc đó (useLangReady),
// các trang khác dịch ngay khi từ điển về. Hỏng mạng thì vẫn mở được bằng chữ gốc, không kẹt ở khung chờ.
const dicts: Partial<Record<Lang, Dict>> = {};
const loads: Partial<Record<Lang, Promise<void>>> = {};
const settled: Partial<Record<Lang, boolean>> = {};
const subs = new Set<() => void>();
let langVer = 0;
const ping = () => { langVer++; subs.forEach((f) => f()); };
export function loadDict(l: Lang): Promise<void> {
  return (loads[l] ??= (l === "en"
    ? import("./i18n-dict").then((m): Dict => ({ map: m.VI2EN, rules: m.RULES_EN }))
    : import("./i18n-vi").then((m): Dict => ({ map: m.EN2VI, rules: m.RULES_VI })))
    .then((d) => { dicts[l] = d; })
    // Tab mở từ bản cũ: tệp đã bị thay. Ném lại để ChunkGuard tải lại trang một lần; lần đổi ngôn ngữ sau tải lại từ đầu.
    .catch((e) => { loads[l] = undefined; setTimeout(() => { throw e; }); })
    .finally(() => { settled[l] = true; ping(); }));
}
if (typeof window !== "undefined") void loadDict(cur);
/** Từ điển của ngôn ngữ đang dùng đã về (hoặc tải hỏng): dựng giao diện được rồi. Đổi ngôn ngữ thì nơi dùng hook này vẽ lại. */
export const useLangReady = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => (settled[cur] ? langVer + 1 : 0), () => 0) > 0;
/** Định dạng ngày giờ, con số theo ngôn ngữ giao diện (không theo ngôn ngữ của trình duyệt). */
export const locale = () => (cur === "en" ? "en-US" : "vi-VN");
export const LANG_NAMES: Record<Lang, string> = { vi: "Tiếng Việt", en: "English" };

export function tr(s: string, lang: Lang = cur): string {
  return trWith(dicts[lang], s, lang);
}
/** Chữ ngắn dễ trùng ("Lọc", "Chủ đề"…) dịch theo ngữ cảnh: trc("Lọc", "đồ thị") tra khóa "Lọc ‹đồ thị›" (i18n-core ctxKey).
 *  Bộ dịch trang không thấy khóa này nên nút chữ "Lọc" ở chỗ khác (hay tiêu đề người dùng đặt trùng chữ) không bị đổi theo.
 *  Cả hai đối số phải là chuỗi viết thẳng để bộ quét (tests/lib/i18n-scan.mjs) kiểm được khóa. */
export function trc(s: string, ctx: string, lang: Lang = cur): string {
  return trcWith(dicts[lang], s, ctx, lang);
}
/** Câu có giá trị chèn vào: khóa từ điển là nguyên mẫu, ví dụ tf("Gói {name} đã hết hạn mức", { name }).
 *  Số nhiều tiếng Anh ghi trong bản dịch dạng "{n} step|{n} steps" (chọn theo vars.n). */
export function tf(key: string, vars: Vars, lang: Lang = cur): string {
  return tfWith(dicts[lang], key, vars, lang);
}
/** Nhãn thao tác Composio ("Tạo tài liệu", "Gửi email abc") theo ngôn ngữ giao diện.
 *  Gọi riêng ở các chỗ hiện nhãn (cxHead, toolChip, worklog); KHÔNG đưa luật "động từ + ASCII" vào RULES_EN chung,
 *  vì bộ dịch DOM sẽ áp cho mọi nút chữ và viết lại nhầm chữ tiếng Việt thường. */
export function trCx(s: string, lang: Lang = cur): string {
  return lang === "en" ? cxActEn(s, (x) => tr(x, "en")) : tr(s, lang);
}
/** Chuỗi không có bản dịch ở cả hai chiều: nội dung (tên người, mô tả từ nhà cung cấp…), đánh dấu data-notr để không lẫn với chữ giao diện. */
export const untranslated = (s: string) => !!s.trim() && tr(s, "en") === s && tr(s, "vi") === s;

const SKIP = "script,style,textarea,input,code,pre,[data-notr],.ai-msg,.user-msg,.mdx,.title-edit";
const ATTRS = ["placeholder", "title", "aria-label", "data-tip"];
type Rec = { o: string; t: string };
const texts = new WeakMap<Text, Rec>();
const attrs = new WeakMap<Element, Record<string, Rec>>();

function doText(n: Text, lang: Lang) {
  if (n.parentElement?.closest(SKIP)) return;
  const v = n.nodeValue ?? "";
  const prev = texts.get(n);
  const o = prev && prev.t === v ? prev.o : v;
  let t = tr(o, lang);
  // {n} skill trong JSX là hai nút chữ liền nhau: nhìn số ở nút trước.
  if (lang === "en" && /^\s*(?:skill|artifact|credit)\b(?!s)/.test(t)) { const p = n.previousSibling; if (p?.nodeType === 3 && /\d\s*$/.test(p.nodeValue ?? "") && !/(?:^|\D)1\s*$/.test(p.nodeValue ?? "")) t = t.replace(/(skill|artifact|credit)/, "$1s"); }
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
  if (el.matches("[placeholder],[title],[aria-label],[data-tip]")) doAttrs(el, lang);
  el.querySelectorAll("[placeholder],[title],[aria-label],[data-tip]").forEach((x) => doAttrs(x, lang));
}

let titleSrc: string | null = null, titleTr = "";
export function I18n() {
  const [lang] = usePref<Lang>("uilang", "vi");
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dataset.lang = lang;
    let mo: MutationObserver | null = null, mt: MutationObserver | null = null, off = false;
    void loadDict(lang).then(() => {
      if (off) return;
      // Đổi ngôn ngữ: chỉ chuyển khi từ điển mới đã về, nơi dùng useLangReady vẽ lại bằng ngôn ngữ mới.
      if (cur !== lang) { cur = lang; ping(); }
      walk(document.body, lang);
      // Tiêu đề thẻ trình duyệt (trang pháp lý, 404): dịch từ bản gốc để đổi qua lại được.
      if (titleSrc === null || (document.title !== titleTr && document.title !== titleSrc)) titleSrc = document.title;
      titleTr = tr(titleSrc, lang);
      if (document.title !== titleTr) document.title = titleTr;
      const cfg: MutationObserverInit = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS };
      const o = new MutationObserver((list) => {
        o.disconnect();
        for (const r of list) {
          if (r.type === "characterData") doText(r.target as Text, lang);
          else if (r.type === "attributes") doAttrs(r.target as Element, lang);
          else r.addedNodes.forEach((n) => walk(n, lang));
        }
        o.observe(document.body, cfg);
      });
      mo = o;
      o.observe(document.body, cfg);
      // Next gắn tiêu đề trang (metadata) sau khi trang đã chạy, có khi sau cả đoạn trên: /terms từng giữ tiêu đề tiếng Việt ở giao diện tiếng Anh.
      const ot = new MutationObserver(() => {
        if (document.title === titleTr) return;
        titleSrc = document.title;
        titleTr = tr(titleSrc, lang);
        if (document.title !== titleTr) document.title = titleTr;
      });
      mt = ot;
      ot.observe(document.head, { subtree: true, childList: true, characterData: true });
    });
    return () => { off = true; mo?.disconnect(); mt?.disconnect(); };
  }, [lang]);
  return null;
}
