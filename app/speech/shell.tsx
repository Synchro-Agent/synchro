"use client";
// Khung chung của từng công cụ Speech theo bố cục ElevenLabs: tiêu đề có biểu tượng, thẻ hướng dẫn nhanh cho người mới
// (tính năng là gì, 3 bước, mẹo, chi phí; thu gọn được và nhớ theo từng công cụ), vùng làm việc + bảng Cài đặt / Lịch sử bên phải.
// Màn hình hẹp: bảng bên ẩn đi, mở bằng nút “Cài đặt” / “Lịch sử” thành ngăn kéo trượt từ dưới lên.
import { useEffect, useState } from "react";
import * as I from "../icons";
import { usePref } from "../store";
import { GUIDES, toolDef, type SpeechTool } from "./data";
import { Tabs } from "./parts";
import { TOOL_ICON } from "./toolicons";

export function Head({ tool, title, desc, children }: { tool: Exclude<SpeechTool, "home">; title?: string; desc?: string; children?: React.ReactNode }) {
  const t = toolDef(tool), Ic = TOOL_ICON[tool];
  const [hidden, setHidden] = usePref<Record<string, boolean>>("spGuideHidden", {});
  const open = !hidden[tool];
  return (
    <>
      <div className="sp-head">
        <div className="sp-head-t">
          <span className={`sp-tic ${t.color}`}><Ic size={20} /></span>
          <div><h1>{title ?? t.label}</h1><p>{desc ?? t.desc}</p></div>
        </div>
        <div className="sp-head-a">
          {children}
          {!open && <button className="btn sp-guide-btn" onClick={() => setHidden({ ...hidden, [tool]: false })}><I.Help size={14} />Hướng dẫn</button>}
        </div>
      </div>
      {open && <GuideCard tool={tool} onClose={() => setHidden({ ...hidden, [tool]: true })} />}
    </>
  );
}

function GuideCard({ tool, onClose }: { tool: Exclude<SpeechTool, "home">; onClose: () => void }) {
  const g = GUIDES[tool], t = toolDef(tool);
  return (
    <section className={`sp-guide ${t.color}`} aria-label={`Hướng dẫn: ${t.label}`}>
      <div className="sp-guide-h">
        <b><I.Bulb size={15} />{`${t.label} là gì?`}</b>
        <button className="icon-btn" aria-label="Ẩn hướng dẫn" title="Ẩn hướng dẫn (mở lại bằng nút Hướng dẫn)" onClick={onClose}><I.X size={15} /></button>
      </div>
      <p className="sp-guide-what">{g.what}</p>
      <ol className="sp-guide-steps">{g.steps.map((s, i) => <li key={i}><span>{i + 1}</span>{s}</li>)}</ol>
      <div className="sp-guide-f">
        <ul className="sp-guide-tips">{g.tips.map((x) => <li key={x}>{x}</li>)}</ul>
        <span className="sp-guide-cost"><I.Gauge size={13} />{g.cost}</span>
      </div>
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
