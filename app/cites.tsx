"use client";
// Nguồn tìm web của một câu trả lời: chip có favicon + tiêu đề + tên miền dưới câu trả lời, và số trích dẫn [n] trong câu trả lời trỏ tới chip thứ n.
// Rê chuột hay dùng phím Tab tới số [n]: thẻ nhỏ hiện tiêu đề và tên miền của nguồn. Bấm số: cuộn tới chip và làm nổi chip đó.
// Favicon tải qua /api/favicon (máy chủ tải hộ, có bộ đệm, chặn địa chỉ nội bộ): trình duyệt không gọi thẳng trang lạ hay dịch vụ ảnh của bên thứ ba.
import { createContext, Fragment, useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "./i18n";

export type WebSrc = { title: string; url: string };
export const CiteCtx = createContext<{ webs: WebSrc[]; id: string } | null>(null);

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.replace(/^https?:\/\/(?:www\.)?/, "").split("/")[0]; } };
const anchor = (id: string, n: number) => `src-${id}-${n}`;
const okUrl = (u: string) => /^https?:\/\//.test(u);

function Favicon({ url, size = 14 }: { url: string; size?: number }) {
  const host = hostOf(url);
  const [bad, setBad] = useState(false);
  if (bad || !host) return <span className="src-fav src-fav-l" style={{ width: size, height: size }} aria-hidden data-notr>{host.slice(0, 1).toUpperCase() || "?"}</span>;
  return <img className="src-fav" src={`/api/favicon?d=${encodeURIComponent(host)}`} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} />;
}

/** Hàng chip nguồn dưới câu trả lời. */
export function SourceChips({ webs, id }: { webs: WebSrc[]; id: string }) {
  if (!webs.some((w) => okUrl(w.url))) return null;
  return (
    <div className="msg-sources" role="list" aria-label={tr("Nguồn")}>
      <span>{tr("Nguồn")}</span>
      {webs.map((w, i) => (okUrl(w.url) ? (
        <a key={w.url} id={anchor(id, i + 1)} role="listitem" className="src-chip" href={w.url} target="_blank" rel="noopener noreferrer" title={`${w.title ? `${w.title}\n` : ""}${w.url}`} data-notr>
          <span className="src-n">{i + 1}</span><Favicon url={w.url} /><span className="src-t">{w.title || hostOf(w.url)}</span>{w.title ? <em className="src-h">{hostOf(w.url)}</em> : null}
        </a>
      ) : null))}
    </div>
  );
}

// Thẻ nổi của một số trích dẫn: nền đặc, nằm trọn trong màn hình (đo rồi dời vào trong ở cả mép trái và phải).
function CitePop({ w, at }: { w: WebSrc; at: DOMRect }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(), M = 8;
    const left = Math.min(Math.max(M, at.left + at.width / 2 - r.width / 2), innerWidth - r.width - M);
    const top = at.top - r.height - 6 < M ? at.bottom + 6 : at.top - r.height - 6;
    setPos({ left, top });
  }, [at]);
  // Gắn vào body: dòng tin dùng content-visibility (có containment) nên position: fixed bên trong sẽ tính theo dòng tin, không theo màn hình.
  return createPortal(
    <span ref={ref} className="cite-pop" role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} data-notr>
      <span className="cite-pop-h"><Favicon url={w.url} size={16} /><em>{hostOf(w.url)}</em></span>
      <b>{w.title || hostOf(w.url)}</b>
    </span>, document.body);
}
function Cite({ n, w, id }: { n: number; w: WebSrc; id: string }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>) => setAt(e.currentTarget.getBoundingClientRect());
  const hide = () => setAt(null);
  return (
    <>
      <a className="cite" href={`#${anchor(id, n)}`} aria-label={`${tr("Nguồn")} ${n}: ${w.title || hostOf(w.url)} (${hostOf(w.url)})`} data-notr
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          const chip = document.getElementById(anchor(id, n));
          if (!chip) return;
          chip.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          chip.classList.remove("flash"); void chip.offsetWidth; chip.classList.add("flash");
          chip.focus({ preventScroll: true });
        }}>{n}</a>
      {at && <CitePop w={w} at={at} />}
    </>
  );
}

const CITE_RE = /\[(\d{1,2})\]/g;
export const hasCite = (s: string) => /\[\d{1,2}\]/.test(s);
/** Chữ có số [n]: số trỏ đúng một nguồn của câu trả lời thành nút trích dẫn, còn lại giữ nguyên. */
export function CiteText({ s, plain }: { s: string; plain: (t: string) => React.ReactNode }) {
  const cx = useContext(CiteCtx);
  if (!cx || !cx.webs.length) return <>{plain(s)}</>;
  const out: React.ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of s.matchAll(CITE_RE)) {
    const n = Number(m[1]), w = cx.webs[n - 1];
    if (!w || !okUrl(w.url)) continue;
    if (m.index! > last) out.push(<Fragment key={k++}>{plain(s.slice(last, m.index))}</Fragment>);
    out.push(<Cite key={k++} n={n} w={w} id={cx.id} />);
    last = m.index! + m[0].length;
  }
  if (!out.length) return <>{plain(s)}</>;
  if (last < s.length) out.push(<Fragment key={k++}>{plain(s.slice(last))}</Fragment>);
  return <>{out}</>;
}
