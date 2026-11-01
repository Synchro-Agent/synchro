"use client";
// Sân khấu "Tạo mới" của trang Artifacts: danh sách ba loại bên trái, cảnh hoạt hình của loại đang chọn bên phải (app/syart.tsx).
// Tự chuyển sang loại kế tiếp sau mỗi lượt cảnh (7,2 giây, có vạch tiến trình); rê chuột / chọn bằng bàn phím thì dừng ở loại đó.
// Bấm một loại hoặc nút ở góc sân khấu để bắt đầu tạo (giống các thẻ cũ). Hai cảnh mờ chéo nhau; cảnh đang ẩn đứng yên ở khung hình cuối.
import { useEffect, useState } from "react";
import * as I from "./icons";
import { StudioScene } from "./syart";

export type StudioKey = "doc" | "slides" | "design";
type Item = { k: StudioKey; name: string; desc: string; lib?: { name: string; skills: number } | null };
const LOOP = 7200;
const ICON: Record<StudioKey, (p: { size?: number }) => React.JSX.Element> = { doc: I.Article, slides: I.Slides, design: I.PenNib };
const GO: Record<StudioKey, string> = { doc: "Tạo tài liệu", slides: "Tạo trang trình bày", design: "Tạo thiết kế" };

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const h = () => setR(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return r;
}

export function Studio({ items, onCreate }: { items: Item[]; onCreate: (k: StudioKey) => void }) {
  const [act, setAct] = useState<StudioKey>(items[0]?.k ?? "doc");
  const [runs, setRuns] = useState<Record<StudioKey, number>>({ doc: 0, slides: 0, design: 0 });
  const [hold, setHold] = useState(false);
  const reduce = useReducedMotion();
  const show = (k: StudioKey) => { setAct(k); setRuns((r) => ({ ...r, [k]: r[k] + 1 })); };
  useEffect(() => {
    if (hold || reduce || items.length < 2) return;
    const t = setTimeout(() => show(items[(items.findIndex((x) => x.k === act) + 1) % items.length].k), LOOP);
    return () => clearTimeout(t);
  }, [act, hold, reduce, items, runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = items.find((x) => x.k === act) ?? items[0];
  if (!cur) return null;
  return (
    <section className="st" aria-label="Tạo mới" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHold(false); }}>
      <div className="st-list">
        <div className="st-h">Tạo mới</div>
        {items.map((t) => { const Ic = ICON[t.k]; return (
          <button key={t.k} className={`st-opt ${act === t.k ? "on" : ""}`} onMouseEnter={() => act !== t.k && show(t.k)} onFocus={() => act !== t.k && show(t.k)} onClick={() => onCreate(t.k)}>
            <span className="st-ic"><Ic size={18} /></span>
            <span className="st-t"><span className="st-tt"><b>{t.name}</b>{t.lib ? <span className="st-tag" title={t.lib.name}>{t.lib.skills} skill</span> : <span className="st-tag on">Mới</span>}</span><em>{t.desc}</em></span>
            {act === t.k && !hold && !reduce && <i key={runs[t.k]} className="st-prog" aria-hidden />}
          </button>); })}
      </div>
      <div className="st-stage">
        {items.map((t) => <div key={`${t.k}-${runs[t.k]}`} className={`st-layer ${act === t.k ? "on" : ""}`}><StudioScene k={t.k} /></div>)}
        <div className="st-foot">
          <span className="st-cap">{cur.lib ? <><I.Plugins size={13} /><span>{cur.lib.name}</span></> : null}</span>
          <button className="btn dark st-go" onClick={() => onCreate(cur.k)}>{GO[cur.k]}<I.ArrowRight size={15} /></button>
        </div>
      </div>
    </section>
  );
}
