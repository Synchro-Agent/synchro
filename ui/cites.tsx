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

// Không có ảnh dùng được (máy chủ trả 404 khi ảnh rỗng / dưới 100 byte, ảnh 1×1 trong suốt, lỗi tải): chữ cái đầu của tên miền trên nền trung tính,
// không để ô vuông trắng trơn.
export const favLetter = (host: string) => (host.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
function Favicon({ url, size = 14 }: { url: string; size?: number }) {
  const host = hostOf(url);
  const [bad, setBad] = useState(false);
  if (bad || !host) return <span className="src-fav src-fav-l" style={{ width: size, height: size }} aria-hidden data-notr>{favLetter(host)}</span>;
  return <img className="src-fav" src={`/api/favicon?d=${encodeURIComponent(host)}`} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)}
    onLoad={(e) => { if (e.currentTarget.naturalWidth < 2 || e.currentTarget.naturalHeight < 2) setBad(true); }} />;
}

/** Số chip nguồn hiện sẵn dưới câu trả lời; phần còn lại gom vào nút "+N nguồn". */
export const SHOWN_SOURCES = 6;

/** Hàng chip nguồn dưới câu trả lời. */
export function SourceChips({ webs, id }: { webs: WebSrc[]; id: string }) {
  const [all, setAll] = useState(false);
  const ok = webs.filter((w) => okUrl(w.url)).length;
  if (!ok) return null;
  // Giữ số thứ tự gốc của nguồn (số [n] trong câu trả lời trỏ đúng chip); chip thứ 7 trở đi ẩn tới khi bấm "+N nguồn" hoặc bấm một số [n] trỏ tới nó.
  let k = 0;
  const more = ok - SHOWN_SOURCES;
  return (
    <div className="msg-sources" role="list" aria-label={tr("Nguồn")}>
      <span>{tr("Nguồn")}</span>
      {webs.map((w, i) => (okUrl(w.url) ? (
        <a key={w.url} id={anchor(id, i + 1)} role="listitem" className="src-chip" hidden={!all && k++ >= SHOWN_SOURCES} href={w.url} target="_blank" rel="noopener noreferrer" title={`${w.title ? `${w.title}\n` : ""}${w.url}`} data-notr>
          <span className="src-n">{i + 1}</span><Favicon url={w.url} /><span className="src-t">{w.title || hostOf(w.url)}</span>{w.title ? <em className="src-h">{hostOf(w.url)}</em> : null}
        </a>
      ) : null))}
      {more > 0 && <button type="button" className="src-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? tr("Thu gọn") : tr(`+${more} nguồn`)}</button>}
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
          const go = () => {
            chip.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            chip.classList.remove("flash"); void chip.offsetWidth; chip.classList.add("flash");
            chip.focus({ preventScroll: true });
          };
          // Nguồn nằm trong phần "+N nguồn" chưa mở: mở ra (React vẽ lại) rồi mới cuộn tới.
          if (chip.hidden) { chip.parentElement?.querySelector<HTMLButtonElement>(".src-more")?.click(); requestAnimationFrame(go); return; }
          go();
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
  // Các số liền nhau ([2][3]) gom một cụm không ngắt dòng giữa chừng.
  let last = 0, k = 0, run: React.ReactNode[] = [];
  const flush = () => { if (run.length) { out.push(<span key={k++} className="cite-g">{run}</span>); run = []; } };
  for (const m of s.matchAll(CITE_RE)) {
    const n = Number(m[1]), w = cx.webs[n - 1];
    if (!w || !okUrl(w.url)) continue;
    if (m.index! > last) { flush(); out.push(<Fragment key={k++}>{plain(s.slice(last, m.index))}</Fragment>); }
    run.push(<Cite key={k++} n={n} w={w} id={cx.id} />);
    last = m.index! + m[0].length;
  }
  flush();
  if (!out.length) return <>{plain(s)}</>;
  if (last < s.length) out.push(<Fragment key={k++}>{plain(s.slice(last))}</Fragment>);
  return <>{out}</>;
}
