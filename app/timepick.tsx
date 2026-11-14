"use client";
// Chọn giờ (HH:MM, 24 giờ) theo bộ nhận diện, thay <input type="time"> mặc định của Chrome (bảng xanh dương, AM/PM theo máy, không chỉnh
// được giao diện). Ô nhập gõ được (19:15, 1915, 7h30, 7:30 pm…); bấm vào hoặc bấm đồng hồ thì mở bảng kính: hai cột Giờ (00–23) / Phút
// (bước 5, kèm phút đang đặt nếu lệch bước), ô đang chọn màu mực, vài mốc nhanh. Bàn phím: ↓ mở bảng, ↑ / ↓ trong cột để chọn,
// Enter / Esc đóng. Bảng gắn vào body (vị trí cố định theo ô nhập) nên không bị khung cuộn của hộp thoại cắt mất.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { tr } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");
const QUICK = ["07:00", "08:00", "12:00", "17:30", "21:00"];
const W = 248;

/** "19:15", "1915", "7", "7:5", "7h30", "19.15", "7:30 pm", "8 tối" → "HH:MM"; không hợp lệ → null. */
export function parseTime(s: string): string | null {
  let t = s.trim().toLowerCase().replace(/\s+/g, "");
  const suf = /(am|pm|sáng|chiều|tối)$/.exec(t);
  if (suf) t = t.slice(0, -suf[1].length);
  let h: number, m: number, r: RegExpExecArray | null;
  if ((r = /^(\d{1,2})[:h.](\d{1,2})?$/.exec(t))) { h = +r[1]; m = r[2] ? +r[2] : 0; }
  else if (/^\d{1,2}$/.test(t)) { h = +t; m = 0; }
  else if (/^\d{3,4}$/.test(t)) { h = +t.slice(0, -2); m = +t.slice(-2); }
  else return null;
  if (suf && /pm|chiều|tối/.test(suf[1]) && h < 12) h += 12;
  if (suf && /am|sáng/.test(suf[1]) && h === 12) h = 0;
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
}

export function TimePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const wrap = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  const [h, m] = (parseTime(value) ?? "09:00").split(":").map(Number);
  const mins = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);

  const commit = () => { const v = parseTime(draft); if (v && v !== value) onChange(v); setDraft(v ?? value); };
  const set = (nh: number, nm: number, close = false) => {
    const v = `${pad(nh)}:${pad(nm)}`;
    if (v !== value) onChange(v);
    setDraft(v);
    if (close) { setOpen(false); inp.current?.focus(); }
  };
  // Mở ngay dưới ô nhập; không đủ chỗ thì mở lên trên. Đi theo ô nhập khi hộp thoại cuộn / cửa sổ đổi cỡ.
  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, innerWidth - W - 8));
    setPos(innerHeight - r.bottom < 320 && r.top > 320 ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    addEventListener("resize", place); addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [open]);
  // Mở bảng: cuộn để giờ / phút đang chọn nằm giữa cột (chỉ lúc mở, bấm chọn thì cột đứng yên).
  const shown = open && !!pos;
  useLayoutEffect(() => {
    if (!shown) return;
    pop.current?.querySelectorAll<HTMLElement>(".tpk-col").forEach((c) => {
      const on = c.querySelector<HTMLElement>("[aria-selected=true]");
      if (on) c.scrollTop = on.offsetTop - c.clientHeight / 2 + on.offsetHeight / 2;
    });
  }, [shown]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) { setOpen(false); commit(); } };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  });
  // Esc khi bảng chọn đang mở chỉ đóng bảng: bảng không phải menu đăng ký ở a11y.ts nên phím đi tiếp tới bộ Esc chung của trang (home.tsx),
  // bộ đó đóng luôn hộp thoại bên dưới (Sửa việc tự động) và mất phần đang sửa. Bảng đã đóng thì Esc đóng hộp thoại như thường.
  const stopEsc = (e: React.KeyboardEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); };
  const focusSel = () => requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(".tpk-col [aria-selected=true]")?.focus());
  // ↑ / ↓ trong một cột: chọn ô kề bên và giữ tiêu điểm ở đó.
  const colKey = (e: React.KeyboardEvent<HTMLDivElement>, pick: (i: number) => void, n: number) => {
    if (e.key === "Escape") { e.preventDefault(); stopEsc(e); setOpen(false); inp.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = Math.max(0, btns.indexOf(document.activeElement as HTMLButtonElement));
    const j = Math.min(n - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    pick(j);
    btns[j].focus();
    btns[j].scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={wrap} className={`field tpk${open ? " open" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inp.current?.focus(); setOpen(true); } }}>
      <input ref={inp} value={draft} inputMode="numeric" maxLength={8} aria-label={tr("Giờ chạy")} aria-haspopup="dialog" aria-expanded={open} spellCheck={false}
        onClick={() => setOpen(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); setOpen(false); }
          else if (e.key === "Escape") { if (open) stopEsc(e); setDraft(value); setOpen(false); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); focusSel(); }
        }} />
      <button type="button" className="tpk-ic" tabIndex={-1} aria-label={tr("Chọn giờ")} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (open) setOpen(false); else { inp.current?.focus(); setOpen(true); } }}><I.Clock size={15} /></button>
      {open && pos && createPortal(
        <div ref={pop} className="menu tpk-pop" style={pos} role="dialog" aria-label={tr("Chọn giờ")} onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "BUTTON") e.preventDefault(); }}>
          <div className="tpk-cols">
            <div className="tpk-cw"><span className="tpk-cap">{tr("Giờ")}</span>
              <div className="tpk-col" role="listbox" aria-label={tr("Giờ")} onKeyDown={(e) => colKey(e, (i) => set(i, m), 24)}>
                {Array.from({ length: 24 }, (_, i) => <button key={i} type="button" role="option" aria-selected={i === h} tabIndex={i === h ? 0 : -1} onClick={() => set(i, m)}>{pad(i)}</button>)}
              </div>
            </div>
            <span className="tpk-colon" aria-hidden>:</span>
            <div className="tpk-cw"><span className="tpk-cap">{tr("Phút")}</span>
              <div className="tpk-col" role="listbox" aria-label={tr("Phút")} onKeyDown={(e) => colKey(e, (i) => set(h, mins[i]), mins.length)}>
                {mins.map((x) => <button key={x} type="button" role="option" aria-selected={x === m} tabIndex={x === m ? 0 : -1} onClick={() => set(h, x, true)}>{pad(x)}</button>)}
              </div>
            </div>
          </div>
          <div className="tpk-quick">{QUICK.map((q) => <button key={q} type="button" className={q === value ? "on" : ""} onClick={() => { const [a, b] = q.split(":").map(Number); set(a, b, true); }}>{q}</button>)}</div>
        </div>, document.body)}
    </div>
  );
}
