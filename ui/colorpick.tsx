"use client";
// Ô chọn màu của app (thay <input type="color"> gốc). Ô gốc hiện một chấm tròn trơn và mở bảng màu của hệ điều hành (Windows: hộp thoại
// "Color" cũ); ở đây là nút mẫu màu bo góc kèm mã hex, bấm mở khung .menu của app: bảng màu gợi ý, ô nhập mã hex, và nút "Màu khác…"
// mở bảng màu của trình duyệt cho ai cần chọn tự do. Bàn phím: ← → ↑ ↓ đi trong bảng màu, Enter / Space chọn, Esc đóng.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { tr, trc } from "./i18n";

const PRESETS = ["#111111", "#3e3f39", "#6b6c66", "#a3a49c", "#d9d6cc", "#f4f3ee", "#ffffff", "#c6422f",
  "#e8833a", "#e0a500", "#2a7048", "#1baf7a", "#2a78d6", "#1e3a8a", "#6250d6", "#e87ba4"];
const COLS = 8, M = 8;
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** "#abc" / "abc" / "#AABBCC" → "#aabbcc"; không hợp lệ thì null. */
export const normHex = (s: string) => {
  const m = s.trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
};

export function ColorField({ value, onChange, label, presets = PRESETS, size = "md" }: { value: string; onChange: (hex: string) => void; label: string; presets?: string[]; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), native = useRef<HTMLInputElement>(null);
  const cur = normHex(value) ?? value;
  useEffect(() => setHex(cur), [cur]);

  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus({ preventScroll: true }); };
  const set = (h: string) => { const n = normHex(h); if (n && n !== cur) onChange(n); };
  const place = () => {
    const b = btn.current, p = pop.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect(), W = innerWidth, H = innerHeight, w = Math.min(p.offsetWidth || 260, W - 2 * M), h = p.offsetHeight;
    if (r.bottom < 0 || r.top > H) { close(false); return; }
    const left = Math.min(Math.max(M, r.left), W - M - w);
    const down = H - r.bottom - 6 - M >= h || H - r.bottom > r.top;
    setPos(down ? { left, top: r.bottom + 6 } : { left, bottom: H - r.top + 6 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !pop.current?.contains(t)) close(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const re = () => place();
    document.addEventListener("mousedown", away, true);
    addEventListener("keydown", key, true);
    addEventListener("resize", re);
    addEventListener("scroll", re, true);
    requestAnimationFrame(() => (pop.current?.querySelector<HTMLElement>(".cp-sw[aria-pressed=true]") ?? pop.current?.querySelector<HTMLElement>(".cp-sw"))?.focus({ preventScroll: true }));
    return () => { document.removeEventListener("mousedown", away, true); removeEventListener("keydown", key, true); removeEventListener("resize", re); removeEventListener("scroll", re, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ← → ↑ ↓ trong bảng màu (lưới 8 cột).
  const gridKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? COLS : e.key === "ArrowUp" ? -COLS : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.min(presets.length - 1, Math.max(0, i + d));
    pop.current?.querySelectorAll<HTMLElement>(".cp-sw")[n]?.focus();
  };
  const name = `${tr(label)}: ${cur}`;
  return (
    <>
      <button ref={btn} type="button" className={`cp ${size}${open ? " open" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={name} onClick={() => (open ? close() : setOpen(true))}>
        <span className="cp-chip" style={{ background: cur }} />
        <span className="cp-l"><span>{label}</span><code data-notr>{cur.toUpperCase()}</code></span>
        <I.Chevron size={13} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={pop} className="menu cp-pop" role="dialog" aria-label={tr(label)} style={{ position: "fixed", zIndex: "var(--z-top)", ...pos }}>
          <div className="cp-grid">
            {presets.map((c, i) => (
              <button key={c} type="button" className="cp-sw" style={{ "--c": c } as React.CSSProperties} aria-label={c.toUpperCase()} aria-pressed={c === cur} data-tip={c.toUpperCase()}
                onClick={() => { set(c); close(); }} onKeyDown={(e) => gridKey(e, i)}>{c === cur && <I.Check size={13} />}</button>
            ))}
          </div>
          <div className="cp-row">
            <span className="cp-chip lg" style={{ background: normHex(hex) ?? cur }} />
            <label className="cp-hex"><span>#</span>
              <input value={hex.replace(/^#/, "")} maxLength={7} spellCheck={false} aria-label={trc("Mã màu", "ô chọn màu")} data-notr
                onChange={(e) => { setHex(`#${e.target.value.replace(/^#/, "")}`); const n = normHex(e.target.value); if (n && n.length === 7 && e.target.value.replace(/^#/, "").length === 6) set(n); }}
                onBlur={() => { const n = normHex(hex); if (n) set(n); else setHex(cur); }}
                onKeyDown={(e) => { if (e.key === "Enter") { const n = normHex(hex); if (n) { set(n); close(); } } }} />
            </label>
            <button type="button" className="btn cp-more" onClick={() => native.current?.click()}><I.Palette size={14} />{trc("Màu khác…", "ô chọn màu")}</button>
            <input ref={native} type="color" className="cp-native" tabIndex={-1} aria-hidden value={/^#[0-9a-f]{6}$/i.test(cur) ? cur : "#000000"} onChange={(e) => set(e.target.value)} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
