"use client";
// Chọn hàng loạt — dùng chung cho mọi danh sách (skill, thư viện, đoạn chat, phiên code, dự án, artifact, việc tự động, ghi chú,
// connector, người dùng, giọng nói…). Nút "Chọn hàng loạt" ở đầu danh sách bật chế độ chọn: mỗi mục có ô tròn, bấm mục là chọn / bỏ chọn
// (Shift + bấm chọn cả dải), ⌘A / Ctrl+A chọn tất cả, Esc thoát. Thanh thao tác dính ở đáy danh sách: số đã chọn, Chọn tất cả,
// các thao tác của danh sách đó (Xóa luôn hỏi xác nhận) và nút đóng.
import { useEffect, useMemo, useRef, useState } from "react";
import { isAway } from "./clickaway";
import * as I from "./icons";
import { useApp } from "./store";
import { Spinner } from "./spinner";

export type BulkAct<T> = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  /** Chỉ hiện khi đúng với các mục đang chọn (vd. "Bật" khi có mục đang tắt). */
  when?: (items: T[]) => boolean;
  /** Hỏi xác nhận trước khi làm (luôn có cho Xóa). */
  confirm?: (items: T[]) => { title: string; text: string; ok: string };
  run: (items: T[], choice?: string) => unknown | Promise<unknown>;
  /** Thao tác cần chọn thêm một đích (vd. dự án): hiện menu các lựa chọn phía trên thanh, chọn xong mới chạy. */
  choices?: () => { id: string; label: string }[];
  /** Làm xong vẫn giữ chế độ chọn (mặc định: thoát). */
  stay?: boolean;
};

export type Bulk<T> = {
  on: boolean;
  start: () => void;
  exit: () => void;
  has: (x: T) => boolean;
  toggle: (x: T, e?: { shiftKey?: boolean }) => void;
  all: () => void;
  none: () => void;
  picked: T[];
  count: number;
  total: number;
};

export function useBulk<T>(items: T[], key: (x: T) => string | number): Bulk<T> {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const last = useRef<string | null>(null);
  const keys = useMemo(() => items.map((x) => String(key(x))), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const sig = keys.join("\u0001");
  // Mục đã biến mất (bị xóa, lọc đi) thì bỏ khỏi lựa chọn.
  useEffect(() => { setSel((s) => { const k = new Set(keys); const n = new Set([...s].filter((x) => k.has(x))); return n.size === s.size ? s : n; }); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = () => { setOn(false); setSel(new Set()); last.current = null; };
  const all = () => setSel(new Set(keys));
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable=true]");
      if (e.key === "Escape" && !document.querySelector(".overlay.cf-top")) { e.stopPropagation(); exit(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !typing) { e.preventDefault(); all(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [on, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (x: T, e?: { shiftKey?: boolean }) => {
    const k = String(key(x));
    setSel((s) => {
      const n = new Set(s);
      if (e?.shiftKey && last.current && keys.includes(last.current)) {
        const a = keys.indexOf(last.current), b = keys.indexOf(k);
        const add = !s.has(k);
        for (const kk of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) { if (add) n.add(kk); else n.delete(kk); }
      } else if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
    last.current = k;
  };
  const picked = items.filter((x) => sel.has(String(key(x))));
  return { on, start: () => setOn(true), exit, has: (x) => sel.has(String(key(x))), toggle, all, none: () => setSel(new Set()), picked, count: picked.length, total: keys.length };
}

/** Nút vào / ra chế độ chọn hàng loạt (đặt ở thanh đầu danh sách). */
export function BulkButton<T>({ b, compact }: { b: Bulk<T>; compact?: boolean }) {
  if (!b.total && !b.on) return null;
  return (
    <button className={`btn bk-btn${b.on ? " on" : ""}${compact ? " sm" : ""}`} aria-pressed={b.on} aria-label={b.on ? "Xong" : "Chọn hàng loạt"} onClick={() => (b.on ? b.exit() : b.start())} data-tip={b.on ? undefined : "Chọn nhiều mục để xử lý cùng lúc"}>
      {b.on ? <I.X size={14} /> : <I.ListChecks size={15} />}<span className="bk-l">{b.on ? "Xong" : "Chọn hàng loạt"}</span>
    </button>
  );
}

/** Ô tròn đánh dấu ở đầu mỗi mục khi đang chọn hàng loạt. */
export function BulkCheck({ on }: { on: boolean }) {
  return <span className={`bk-check${on ? " on" : ""}`} aria-hidden="true">{on && <I.Check size={12} />}</span>;
}

/** Thuộc tính cho một mục danh sách khi đang chọn hàng loạt: bấm là chọn / bỏ chọn, không mở mục. */
export function bulkRow<T>(b: Bulk<T>, x: T) {
  if (!b.on) return {};
  const sel = b.has(x);
  return {
    "aria-selected": sel,
    "data-bk": sel ? "on" : "off",
    onClickCapture: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); b.toggle(x, e); },
    onKeyDownCapture: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); b.toggle(x, e); } },
  };
}

/** Thanh thao tác hàng loạt: dính ở đáy khung cuộn của danh sách. */
export function BulkBar<T>({ b, acts, noun = "mục", compact }: { b: Bulk<T>; acts: BulkAct<T>[]; noun?: string; compact?: boolean }) {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pick) return;
    const h = (e: MouseEvent) => { if (isAway(bar.current, e.target)) setPick(null); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [pick]);
  if (!b.on) return null;
  const items = b.picked;
  const allOn = b.count > 0 && b.count === b.total;
  const run = async (a: BulkAct<T>, choice?: string) => {
    if (a.choices && choice === undefined) { setPick(pick === a.id ? null : a.id); return; }
    setPick(null);
    const go = async () => {
      setBusy(a.id);
      try { await a.run(items, choice); if (!a.stay) b.exit(); }
      catch (e) { app.say((e as Error).message || "Không làm được"); }
      setBusy(null);
    };
    if (a.confirm) { const c = a.confirm(items); app.confirm(c.title, c.text, c.ok, () => { void go(); }); }
    else await go();
  };
  const shown = acts.filter((a) => !a.when || (items.length > 0 && a.when(items)));
  return (
    <div className={`bk-bar${compact ? " compact" : ""}`} role="toolbar" aria-label="Thao tác hàng loạt" ref={bar}>
      <button className="bk-all" onClick={() => (allOn ? b.none() : b.all())} aria-pressed={allOn} data-tip={compact ? (allOn ? "Bỏ chọn tất cả" : "Chọn tất cả") : undefined}>
        <span className={`bk-check${allOn ? " on" : b.count ? " some" : ""}`} aria-hidden="true">{allOn ? <I.Check size={12} /> : b.count ? <I.Minus size={12} /> : null}</span>
        <span className="bk-n">{compact ? String(b.count) : b.count ? `Đã chọn ${b.count} ${noun}` : `Chọn ${noun}`}</span>
      </button>
      <span className="bk-sep" />
      <div className="bk-acts">
        {shown.map((a) => (
          <span key={a.id} className="bk-aw">
            <button className={`bk-act${a.danger ? " danger" : ""}${pick === a.id ? " open" : ""}`} disabled={!b.count || !!busy} onClick={() => run(a)} aria-label={a.label} data-tip={compact ? a.label : undefined}>
              {busy === a.id ? <Spinner className="art-spin sm" /> : a.icon}{!compact && <span>{a.label}</span>}
            </button>
            {pick === a.id && a.choices && (
              <div className="menu bk-menu" role="menu">
                {a.choices().map((c) => <button key={c.id} className="menu-item" role="menuitem" onClick={() => run(a, c.id)}><span className="cv-ell">{c.label}</span></button>)}
              </div>
            )}
          </span>
        ))}
      </div>
      <button className="icon-btn bk-x" aria-label="Thoát chọn hàng loạt" onClick={b.exit}><I.X size={15} /></button>
    </div>
  );
}

/** Chạy lần lượt cho từng mục (giữ thứ tự, dừng ở lỗi đầu tiên và báo). */
export async function each<T>(items: T[], f: (x: T) => Promise<unknown> | unknown) {
  for (const x of items) await f(x);
}
