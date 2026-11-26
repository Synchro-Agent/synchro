"use client";
// Khung chung của từng công cụ Speech theo bố cục ElevenLabs: tiêu đề có biểu tượng, thẻ hướng dẫn nhanh cho người mới
// (tính năng là gì, 3 bước, mẹo, chi phí; thu gọn được và nhớ theo từng công cụ), vùng làm việc + bảng Cài đặt / Lịch sử bên phải.
// Màn hình hẹp: bảng bên ẩn đi, mở bằng nút “Cài đặt” / “Lịch sử” thành ngăn kéo trượt từ dưới lên.
import { useEffect, useState } from "react";
import * as I from "../icons";
import { usePref } from "../store";
import { tf, tr, useLangVer } from "../i18n";
import { GUIDES, toolDef, type SpeechTool } from "../../shared/speech/data";
import { createWhatOf } from "../../shared/speech/fmt";
import { on, usePlan } from "./client";
import { Tabs } from "./parts";
import { TOOL_ICON } from "./toolicons";

// Thu gọn thì kéo nút thao tác chính (.sp-go) vào tầm nhìn: khung 660px thấp, hướng dẫn chiếm nửa trên nên nút tạo nằm dưới mép màn.
function scrollPrimaryIntoView() {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const btn = document.querySelector<HTMLElement>(".sp .sp-go");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) btn.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

export function Head({ tool, title, desc, children }: { tool: Exclude<SpeechTool, "home">; title?: string; desc?: string; children?: React.ReactNode }) {
  const t = toolDef(tool), Ic = TOOL_ICON[tool];
  const [hidden, setHidden] = usePref<Record<string, boolean>>("spGuideHidden", {});
  const [seen, setSeen] = usePref<Record<string, boolean>>("spGuideSeen", {});
  // Lần đầu mở một công cụ: hiện hướng dẫn đầy đủ. Các lần sau tự thu gọn (trừ khi người dùng tự bấm mở lại). Nhớ riêng theo từng công cụ.
  const [open, setOpen] = useState(() => (hidden[tool] !== undefined ? !hidden[tool] : !seen[tool]));
  const show = (v: boolean) => { setOpen(v); setHidden({ ...hidden, [tool]: !v }); if (!v) scrollPrimaryIntoView(); };
  useEffect(() => {
    if (!seen[tool]) setSeen({ ...seen, [tool]: true });
    if (!open) scrollPrimaryIntoView();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="sp-head">
        <div className="sp-head-t">
          <span className="sp-tic"><Ic size={20} /></span>
          <div><h1>{title ?? t.label}</h1><p>{desc ?? t.desc}</p></div>
        </div>
        <div className="sp-head-a">
          {children}
          {!open && <button className="btn sp-guide-btn" onClick={() => show(true)}><I.Help size={14} />Xem hướng dẫn</button>}
        </div>
      </div>
      {open && <GuideCard tool={tool} onClose={() => show(false)} />}
    </>
  );
}

// Thẻ hướng dẫn: tiêu đề + tính năng là gì, rồi hai cột “Cách dùng” (3 bước nối nhau) và “Mẹo hay” + chi phí.
// Thẻ hẹp (cột làm việc cạnh bảng Cài đặt, điện thoại) xếp một cột; mẹo và chi phí thu vào nút “Xem mẹo” cho gọn.
function GuideCard({ tool, onClose }: { tool: Exclude<SpeechTool, "home">; onClose: () => void }) {
  const g = GUIDES[tool], t = toolDef(tool);
  const [more, setMore] = useState(false);
  const plan = usePlan(tool === "create");
  useLangVer();
  const what = tool === "create" ? createWhatOf(plan?.connected ? (f) => on(plan, f) : null, g.what, tr, tf) : g.what;
  return (
    <section className={`sp-guide ${more ? "more" : ""}`} aria-label={`Hướng dẫn: ${t.label}`}>
      <div className="sp-guide-h">
        <span className="sp-guide-ic"><I.Bulb size={15} /></span>
        <b>{`${t.label} là gì?`}</b>
        <button className="btn sp-guide-x" title="Mở lại bằng nút Xem hướng dẫn" onClick={onClose}><I.X size={13} />Ẩn hướng dẫn</button>
      </div>
      <p className="sp-guide-what">{what}</p>
      <div className="sp-guide-body">
        <div className="sp-guide-col">
          <span className="sp-guide-l">Cách dùng</span>
          <ol className="sp-guide-steps">{g.steps.map((s, i) => <li key={i}><span>{i + 1}</span><p>{s}</p></li>)}</ol>
        </div>
        <div className="sp-guide-col side">
          <span className="sp-guide-l">Mẹo hay</span>
          <ul className="sp-guide-tips">{g.tips.map((x) => <li key={x}><I.Check size={13} /><p>{x}</p></li>)}</ul>
          <div className="sp-guide-cost"><I.Gauge size={15} /><p><b>Chi phí</b>{g.cost}</p></div>
        </div>
      </div>
      <button className="sp-guide-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Ẩn mẹo" : "Xem mẹo và chi phí"}<I.Chevron size={12} /></button>
    </section>
  );
}

/** Bố cục hai cột: vùng làm việc + bảng bên (Cài đặt / Lịch sử). `bar` là thanh tạo cố định ở đáy vùng làm việc. */
export function Split<T extends string>({ head, children, tabs, tab, setTab, side, bar, wide }: {
  head: React.ReactNode; children: React.ReactNode; tabs: { k: T; label: string; icon?: React.ReactNode }[]; tab: T; setTab: (t: T) => void; side: React.ReactNode; bar?: React.ReactNode; wide?: boolean;
}) {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sheet]);
  return (
    <div className="sp-split">
      <div className="sp-main">
        {head}
        <div className="sp-mbar">
          {tabs.map((x) => <button key={x.k} className="btn" onClick={() => { setTab(x.k); setSheet(true); }}>{x.icon}{x.label}</button>)}
        </div>
        {children}
        {bar && <div className="sp-bottom">{bar}</div>}
      </div>
      {sheet && <div className="sp-sheet-bg" onClick={() => setSheet(false)} />}
      <aside className={`sp-aside ${wide ? "wide" : ""} ${sheet ? "open" : ""}`} aria-label="Bảng bên">
        <button className="sp-grab" aria-label="Đóng bảng" onClick={() => setSheet(false)}><i /></button>
        <div className="sp-aside-h">
          {tabs.length > 1 ? <Tabs label="Bảng bên" value={tab} onChange={setTab} items={tabs} /> : <b>{tabs[0]?.label}</b>}
          <button className="icon-btn sp-sheet-x" aria-label="Đóng" onClick={() => setSheet(false)}><I.X size={16} /></button>
        </div>
        <div className="sp-aside-in">{side}</div>
      </aside>
    </div>
  );
}

/** Bố cục một cột rộng (Giọng nói, Tạo giọng, Từ điển…). */
export function Wide({ children }: { children: React.ReactNode }) {
  return <div className="sp-wide">{children}</div>;
}

/** Nhóm gợi ý dạng chip: bấm để điền / thêm vào ô nhập. */
export function Chips({ label, items, onPick, active }: { label?: string; items: [string, string][] | string[]; onPick: (v: string, label: string) => void; active?: string }) {
  return (
    <div className="sp-chips">
      {label && <span className="sp-chips-l">{label}</span>}
      {items.map((x) => { const [l, v] = Array.isArray(x) ? x : [x, x]; return <button key={l} className={`sp-tag ${active === v ? "on" : ""}`} onClick={() => onPick(v, l)}>{l}</button>; })}
    </div>
  );
}

/** Mục có tiêu đề nhỏ trong bảng Cài đặt. */
export function Group({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="sp-grp">
      <div className="sp-grp-h"><b>{title}</b>{hint && <em>{hint}</em>}{right}</div>
      {children}
    </div>
  );
}
