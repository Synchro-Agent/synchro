"use client";
// Sân khấu "Tạo mới" của trang Artifacts: danh sách ba loại bên trái, cảnh hoạt hình của loại đang chọn bên phải (app/syart.tsx).
// Tự chuyển sang loại kế tiếp sau mỗi lượt cảnh (7,2 giây, có vạch tiến trình); rê chuột / chọn bằng bàn phím thì dừng ở loại đó.
// Bấm một loại hoặc nút ở góc sân khấu để bắt đầu tạo (giống các thẻ cũ). Hai cảnh mờ chéo nhau; cảnh đang ẩn đứng yên ở khung hình cuối.
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { fmtCount } from "./studios";
import { StudioScene } from "./syart";

export type StudioKey = "doc" | "slides" | "design";
type Lib = { name: string; skills: number; autoTotal?: number };
type Item = { k: StudioKey; name: string; desc: string; lib?: Lib | null };
const API_KEY: Record<StudioKey, string> = { doc: "docs", slides: "slides", design: "design" };
// Nói rõ số đếm gồm cả skill tự nhận diện, không để người xem tưởng đó là thư viện chọn lọc.
const countText = (l: Lib) => (l.autoTotal ? `${fmtCount(l.skills)} skill, gồm ${fmtCount(l.autoTotal)} skill Synchro tự nhận diện` : `${fmtCount(l.skills)} skill`);
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

// Danh sách skill của một mục: tìm kiếm và tải theo trang ở máy chủ, không dựng hàng nghìn dòng trong trình duyệt.
type Row = { name: string; description: string };
function Shelf({ item, onClose }: { item: Item; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [matched, setMatched] = useState(0);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const load = (query: string, offset: number) => {
    const id = ++seq.current;
    setBusy(true);
    fetch(`/api/plugins?view=studio&studio=${API_KEY[item.k]}&q=${encodeURIComponent(query)}&offset=${offset}`).then((r) => (r.ok ? r.json() : null)).then((j: { matched: number; skills: Row[] } | null) => {
      if (id !== seq.current) return;
      setMatched(j?.matched ?? 0);
      setRows((old) => (offset ? [...old, ...(j?.skills ?? [])] : j?.skills ?? []));
    }).catch(() => {}).finally(() => { if (id === seq.current) setBusy(false); });
  };
  useEffect(() => { const t = setTimeout(() => load(q.trim(), 0), q ? 200 : 0); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal pl-modal st-shelf" role="dialog" aria-modal="true" aria-labelledby="st-shelf-h">
        <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        <h2 id="st-shelf-h">{item.name}</h2>
        <p className="d" data-notr>{item.lib ? tr(countText(item.lib)) : ""}</p>
        <p className="d">Số này gồm cả skill Synchro tự nhận diện trong các thư viện đã cài: skill của bạn, thư viện chọn lọc và danh mục skill của Claude.</p>
        <input className="field st-shelf-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm skill" aria-label="Tìm skill" autoFocus />
        <div className="st-shelf-list">
          {rows.map((r) => <div key={r.name} className="st-shelf-row"><b data-notr>{r.name}</b><span data-notr>{r.description}</span></div>)}
          {!busy && !rows.length && <div className="st-shelf-empty">Không có skill nào khớp</div>}
          {rows.length < matched && <button className="btn st-shelf-more" disabled={busy} onClick={() => load(q.trim(), rows.length)}>{busy ? <span className="art-spin sm" /> : null}Xem thêm</button>}
        </div>
      </div>
    </div>
  );
}

export function Studio({ items, onCreate }: { items: Item[]; onCreate: (k: StudioKey) => void }) {
  const [act, setAct] = useState<StudioKey>(items[0]?.k ?? "doc");
  const [runs, setRuns] = useState<Record<StudioKey, number>>({ doc: 0, slides: 0, design: 0 });
  const [hold, setHold] = useState(false);
  const [shelf, setShelf] = useState<StudioKey | null>(null);
  const reduce = useReducedMotion();
  const show = (k: StudioKey) => { setAct(k); setRuns((r) => ({ ...r, [k]: r[k] + 1 })); };
  useEffect(() => {
    if (hold || reduce || items.length < 2) return;
    const t = setTimeout(() => show(items[(items.findIndex((x) => x.k === act) + 1) % items.length].k), LOOP);
    return () => clearTimeout(t);
  }, [act, hold, reduce, items, runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = items.find((x) => x.k === act) ?? items[0];
  if (!cur) return null;
  const open = items.find((x) => x.k === shelf);
  return (
    <>
    {open && <Shelf item={open} onClose={() => setShelf(null)} />}
    <section className="st" aria-label="Tạo mới" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHold(false); }}>
      <div className="st-list">
        <div className="st-h">Tạo mới</div>
        {items.map((t) => { const Ic = ICON[t.k]; return (
          <button key={t.k} className={`st-opt ${act === t.k ? "on" : ""}`} onMouseEnter={() => act !== t.k && show(t.k)} onFocus={() => act !== t.k && show(t.k)} onClick={() => onCreate(t.k)}>
            <span className="st-ic"><Ic size={18} /></span>
            <span className="st-t"><span className="st-tt"><b>{t.name}</b>{t.lib ? <span className="st-tag" title={tr(countText(t.lib))}>{fmtCount(t.lib.skills)} skill</span> : <span className="st-tag on">Mới</span>}</span><em>{t.desc}</em></span>
            {act === t.k && !hold && !reduce && <i key={runs[t.k]} className="st-prog" aria-hidden />}
          </button>); })}
      </div>
      <div className="st-stage">
        {items.map((t) => <div key={`${t.k}-${runs[t.k]}`} className={`st-layer ${act === t.k ? "on" : ""}`}><StudioScene k={t.k} /></div>)}
        <div className="st-foot">
          {cur.lib ? <button className="st-cap st-capb" onClick={() => setShelf(cur.k)} title="Xem và tìm skill của mục này"><I.Plugins size={13} /><span>{`${countText(cur.lib)}`}</span></button> : <span className="st-cap" />}
          <button className="btn dark st-go" onClick={() => onCreate(cur.k)}>{GO[cur.k]}<I.ArrowRight size={15} /></button>
        </div>
      </div>
    </section>
    </>
  );
}
