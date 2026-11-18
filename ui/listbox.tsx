"use client";
// Ô chọn của app (thay mọi <select> gốc). <select> gốc trên Windows mở danh sách của hệ điều hành (nền trắng, dòng chọn xanh đậm, không bo góc,
// không tìm được trong danh sách ngôn ngữ dài) và mũi tên tự vẽ nằm lệch; ở đây danh sách là khung nổi .menu của app (cùng kính, bo 20, mục
// tròn 32px), gắn vào <body> và đặt position:fixed nên không bị khung cuộn hay hộp thoại cắt, tự lật lên trên khi phía dưới thiếu chỗ và không
// rộng quá màn hình điện thoại.
// Bàn phím theo mẫu "combobox chỉ chọn" của WAI-ARIA: tiêu điểm ở nút (hoặc ô tìm), aria-activedescendant trỏ mục đang sáng; ↑ ↓ Home End
// PageUp PageDown để đi, Enter / Space chọn, Esc đóng, gõ chữ để nhảy tới mục; danh sách dài (> 10 mục) có ô tìm, bỏ dấu tiếng Việt khi so.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { tr } from "./i18n";

/** group: tên nhóm (như <optgroup>), hiện làm tiêu đề nhỏ trước mục đầu của nhóm. */
export type DdOpt<V extends string | number = string> = { value: V; label: string; sub?: string; disabled?: boolean; notr?: boolean; group?: string };
/** Mục truyền vào: giá trị trơn (chữ hiện = giá trị), cặp [giá trị, chữ hiện] hoặc đủ thuộc tính. */
export type DdIn<V extends string | number = string> = V | readonly [V, string] | DdOpt<V>;

const toOpt = <V extends string | number>(o: DdIn<V>): DdOpt<V> =>
  Array.isArray(o) ? { value: o[0] as V, label: o[1] as string } : typeof o === "object" ? (o as DdOpt<V>) : { value: o as V, label: String(o) };
/** Bỏ dấu, chữ thường: "viet" tìm ra "Tiếng Việt". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const M = 8, GAP = 4, MAX_H = 360;

export function Dropdown<V extends string | number>({ value, options, onChange, id, label, className = "", size = "md", search, placeholder = "", disabled, minWidth = 180, notr, align = "start", block }: {
  value: V; options: readonly DdIn<V>[]; onChange: (v: V) => void;
  /** id của nút: <label htmlFor> trỏ vào đây làm tên cho trình đọc màn hình. */
  id?: string;
  /** Tên khi không có <label htmlFor> (aria-label của nút và của danh sách). */
  label?: string;
  className?: string; size?: "sm" | "md";
  /** Ô tìm trong danh sách; mặc định bật khi có hơn 10 mục. */
  search?: boolean;
  placeholder?: string; disabled?: boolean; minWidth?: number;
  /** Chữ của mục là nội dung (tên model, tên workspace…): lớp dịch không đụng vào. */
  notr?: boolean;
  /** Danh sách thẳng mép trái (mặc định) hay mép phải của nút. */
  align?: "start" | "end";
  /** Nút giãn hết bề ngang ô chứa. */
  block?: boolean;
}) {
  const opts = useMemo(() => options.map(toOpt), [options]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [act, setAct] = useState(-1);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const lid = useId().replace(/:/g, "");
  const searchable = search ?? opts.length > 10;
  const cur = opts.find((o) => o.value === value);
  const shown = useMemo(() => {
    if (!q.trim()) return opts;
    const f = fold(q.trim());
    return opts.filter((o) => fold(o.label).includes(f) || fold(tr(o.label)).includes(f) || fold(String(o.value)).includes(f) || (!!o.group && fold(o.group).includes(f)));
  }, [opts, q]);
  const optId = (i: number) => `${lid}-o${i}`;

  const show = (start?: number) => {
    if (disabled) return;
    setQ("");
    const i = start ?? opts.findIndex((o) => o.value === value);
    setAct(i >= 0 ? i : opts.findIndex((o) => !o.disabled));
    setPos({ visibility: "hidden" });
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus({ preventScroll: true }); };
  const pick = (o: DdOpt<V> | undefined) => { if (!o || o.disabled) return; close(); if (o.value !== value) onChange(o.value); };
  const step = (from: number, d: number) => {
    const n = shown.length;
    if (!n) return -1;
    let i = from;
    for (let k = 0; k < n; k++) { i = Math.min(n - 1, Math.max(0, i + d)); if (!shown[i].disabled) return i; if (i === 0 || i === n - 1) break; }
    return from;
  };
  // Gõ chữ khi danh sách không có ô tìm: nhảy tới mục bắt đầu bằng các chữ vừa gõ (như ô chọn của hệ điều hành).
  const typeahead = (ch: string) => {
    const t = typed.current, now = Date.now();
    t.s = now - t.t > 700 ? ch : t.s + ch; t.t = now;
    const f = fold(t.s), from = Math.max(0, act);
    const order = [...shown.slice(from + (t.s.length === 1 ? 1 : 0)), ...shown.slice(0, from + (t.s.length === 1 ? 1 : 0))];
    const hit = order.find((o) => !o.disabled && (fold(tr(o.label)).startsWith(f) || fold(o.label).startsWith(f)));
    return hit ? shown.indexOf(hit) : -1;
  };

  // Đặt chỗ: dưới nút nếu đủ chỗ (hoặc phía dưới rộng hơn phía trên), không thì lật lên; luôn cách mép màn hình 8px.
  const place = () => {
    const b = btn.current, p = pop.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    if (r.bottom < 0 || r.top > H) { close(false); return; }
    const w = Math.min(Math.max(r.width, minWidth), W - 2 * M);
    const left = Math.min(Math.max(M, align === "end" ? r.right - w : r.left), W - M - w);
    const inner = (list.current?.scrollHeight ?? 0) + (p.querySelector<HTMLElement>(".dd-search")?.offsetHeight ?? 0) + 10;
    const want = Math.min(inner, MAX_H), below = H - r.bottom - GAP - M, above = r.top - GAP - M;
    const down = below >= want || below >= above;
    const h = Math.max(96, Math.min(want, down ? below : above));
    setPos(down ? { left, width: w, top: r.bottom + GAP, maxHeight: h } : { left, width: w, bottom: H - r.top + GAP, maxHeight: h });
  };
  useLayoutEffect(() => { if (open) place(); }, [open, shown.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !pop.current?.contains(t)) close(false); };
    const re = () => place();
    // Esc / Tab bắt ở pha capture của window: hộp thoại chứa ô chọn không đóng theo, tiêu điểm không rơi xuống cuối trang (danh sách nằm ở cuối <body>).
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "Tab") { e.preventDefault(); close(); }
    };
    document.addEventListener("mousedown", away, true);
    addEventListener("resize", re);
    addEventListener("scroll", re, true);
    addEventListener("keydown", key, true);
    if (searchable) requestAnimationFrame(() => inp.current?.focus({ preventScroll: true }));
    return () => { document.removeEventListener("mousedown", away, true); removeEventListener("resize", re); removeEventListener("scroll", re, true); removeEventListener("keydown", key, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mục đang sáng luôn trong tầm nhìn (mở ra thì mục đang chọn nằm giữa khung).
  useLayoutEffect(() => {
    if (!open || act < 0) return;
    const el = document.getElementById(optId(act)), l = list.current;
    if (!el || !l) return;
    const top = el.offsetTop, bot = top + el.offsetHeight;
    if (top < l.scrollTop) l.scrollTop = top - 4;
    else if (bot > l.scrollTop + l.clientHeight) l.scrollTop = bot - l.clientHeight + 4;
  }, [act, open, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) { if (!open && e.altKey && e.key === "ArrowDown") { e.preventDefault(); show(); } return; }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); }
      else if (e.key.length === 1 && e.key !== " ") {
        e.preventDefault();
        if (searchable) { show(); setQ(e.key); setAct(0); }
        else { const i = typeahead(e.key); show(i >= 0 ? i : undefined); }
      }
      return;
    }
    const inSearch = e.target === inp.current;
    if (e.key === "ArrowDown") { e.preventDefault(); setAct(step(act, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAct(step(act, -1)); }
    else if (e.key === "PageDown") { e.preventDefault(); setAct(step(Math.min(shown.length - 1, act + 7), 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setAct(step(Math.max(0, act - 7), -1)); }
    else if ((e.key === "Home" || e.key === "End") && !inSearch) { e.preventDefault(); setAct(e.key === "Home" ? step(-1, 1) : step(shown.length, -1)); }
    else if (e.key === "Enter" || (e.key === " " && !inSearch)) { e.preventDefault(); pick(shown[act]); }
    else if (!inSearch && e.key.length === 1) { const i = typeahead(e.key); if (i >= 0) setAct(i); }
  };

  const valText = cur ? (cur.notr || notr ? cur.label : tr(cur.label)) : placeholder;
  return (
    <>
      <button ref={btn} type="button" id={id} role="combobox" className={`dd ${size}${block ? " block" : ""}${open ? " open" : ""} ${className}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? lid : undefined} aria-activedescendant={open && !searchable && act >= 0 ? optId(act) : undefined}
        aria-label={label ? `${tr(label)}: ${valText}` : undefined} data-value={String(value)}
        onClick={() => (open ? close() : show())} onKeyDown={onKey}>
        <span className="dd-v" data-notr={cur?.notr || notr || undefined}>{cur ? cur.label : placeholder}</span>
        <I.Chevron size={size === "sm" ? 12 : 14} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={pop} className={`menu dd-pop ${size}`} style={{ position: "fixed", zIndex: "var(--z-top)", ...pos }}>
          {searchable && (
            <div className="dd-search">
              <I.Search size={14} />
              <input ref={inp} role="combobox" aria-expanded aria-controls={lid} aria-autocomplete="list" aria-activedescendant={act >= 0 && shown[act] ? optId(act) : undefined}
                aria-label={tr("Tìm")} placeholder={tr("Tìm kiếm…")} value={q} onChange={(e) => { setQ(e.target.value); setAct(0); }} onKeyDown={onKey} />
            </div>
          )}
          <div ref={list} id={lid} role="listbox" className="dd-list" aria-label={label ? tr(label) : undefined}>
            {shown.map((o, i) => {
              const sel = o.value === value, head = o.group && o.group !== shown[i - 1]?.group;
              return (
                <Fragment key={String(o.value)}>
                {head && <div className="dd-grp" role="presentation" data-notr>{o.group}</div>}
                {/* Mục không nhận tiêu điểm: tiêu điểm ở nút / ô tìm, aria-activedescendant trỏ tới mục (mẫu combobox của WAI-ARIA), bàn phím xử lý ở onKey. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
                <div id={optId(i)} role="option" aria-selected={sel} aria-disabled={o.disabled || undefined}
                  className={`menu-item dd-opt${i === act ? " act" : ""}${sel ? " sel" : ""}`} data-value={String(o.value)}
                  onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== act && !o.disabled && setAct(i)} onClick={() => pick(o)}>
                  <span className="dd-ot"><span data-notr={o.notr || notr || undefined}>{o.label}</span>{o.sub && <small>{o.sub}</small>}</span>
                  {sel && <span className="ck"><I.Check size={15} /></span>}
                </div>
                </Fragment>
              );
            })}
            {!shown.length && <div className="dd-none">{tr("Không tìm thấy kết quả")}</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
