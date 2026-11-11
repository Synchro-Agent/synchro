"use client";

import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { unredact, filepathOf, autoMerge, hasHidden, splitMeta, parsePackages, checkPkg, findCron, cronInfo, type Pkg } from "./devtools";
import * as I from "./icons";
import { locale, tr, useLangReady } from "./i18n";
import { codeWraps, imageKind, inlineText, parseInline, parseMarkdown, streamSafe, type Align, type Block, type Inl, type Top } from "./mdparse";
import { ChartView, parseChart } from "./charts";
import { lazyView } from "./lazy";
import { AskCard } from "./askcard";
import { CiteText, hasCite } from "./cites";
import { TokLine, useHighlight } from "./highlight";

// Khung artifact và sơ đồ chỉ cần khi câu trả lời có hình minh họa: không nằm trong phần tải đầu của trang chat.
const ArtifactFrame = lazyView(() => import("./artifactui").then((m) => m.ArtifactFrame), null);
const MermaidSvg = lazyView(() => import("./artifactui").then((m) => m.MermaidSvg), null);
// Bọc từng chữ để hiện dần: chỉ ở các dòng cuối của câu trả lời đang viết. Tin đã xong là chữ thường: đoạn chat 120 tin từng giữ gần 20.000 thẻ <span> chỉ để phục vụ hiệu ứng đã chạy xong.
const words = (p: string, w?: boolean) => (w ? p.split(/(\s+)/).map((x, k) => (/^\s*$/.test(x) ? x : <span key={k} className="w">{x}</span>)) : p);
const MathView = lazyView(() => import("./mathview").then((m) => m.MathView), null);
function MdImage({ src, alt }: { src: string; alt: string }) {
  const [bad, setBad] = useState(false);
  const kind = imageKind(src);
  if (kind === "inline" && !bad) return <img className="md-img" src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />;
  if (kind === "link") { let host = src; try { host = new URL(src).hostname; } catch {} return <a className="md-img-link" href={src} target="_blank" rel="noopener noreferrer" title={tr("Mở ảnh ở tab mới")}><I.Image size={14} /><span>{alt || tr("Ảnh")}</span><em data-notr>{host}</em></a>; }
  return <span>{alt}</span>;
}
function inl(ns: Inl[], w?: boolean): React.ReactNode[] {
  return ns.map((n, i) => {
    // Số trích dẫn [n] của câu trả lời có tìm web: thành nút trỏ tới nguồn (chỉ khi câu trả lời có danh sách nguồn, xem cites.tsx).
    if (typeof n === "string" && hasCite(n)) return <CiteText key={i} s={n} plain={(t) => words(t, w)} />;
    if (typeof n === "string") return w ? <Fragment key={i}>{words(n, w)}</Fragment> : n;
    switch (n.t) {
      case "br": return <br key={i} />;
      case "code": return <code key={i} className="ic">{n.v}</code>;
      case "math": return <MathView key={i} v={n.v} display={n.display} />;
      case "img": return <MdImage key={i} src={n.src} alt={n.alt} />;
      case "fn": return <sup key={i} className="md-fnref">{n.id}</sup>;
      case "a": return <a key={i} href={n.href} {...(/^mailto:/i.test(n.href) ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{inl(n.c, w)}</a>;
      case "span": return <Fragment key={i}>{inl(n.c, w)}</Fragment>;
      default: { const T = n.t; return <T key={i}>{inl(n.c, w)}</T>; }
    }
  });
}
// memo: chữ đang chảy chỉ dài thêm ở dòng cuối, các dòng trước không phải dựng lại từng chữ mỗi khung hình. open: đoạn cuối đang viết dở, dấu ** chưa đóng vẫn hiện đậm.
const Inline = memo(function Inline({ t, w, open }: { t: string; w?: boolean; open?: boolean }) {
  return <>{inl(parseInline(t, { open }), w)}</>;
});

export type DevBlock = { lang: string; code: string };
export type DevCtx = { prev?: DevBlock[]; onPanel: (b: { lang: string; code: string; name: string; run?: boolean }) => void; files?: { name: string; text: string }[]; onAccept?: (name: string, code: string) => void; onExpand?: (name: string, code: string) => void };

const EXT: Record<string, string> = { typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js", jsx: "jsx", python: "py", py: "py", html: "html", css: "css", json: "json", go: "go", rust: "rs", bash: "sh", sh: "sh", sql: "sql", java: "java", yaml: "yml", md: "md" };
export function fileNameFor(lang: string, code: string): string {
  const m = code.split("\n", 1)[0].match(/^(?:\/\/|#|<!--|\/\*)\s*([\w./\\-]+\.[a-z]{1,5})\b/i);
  if (m) return m[1];
  return "code." + (EXT[lang.toLowerCase()] ?? (lang.toLowerCase() || "txt"));
}

export function diffLines(a: string, b: string): { t: "+" | "-" | " "; s: string }[] {
  const x = a.split("\n"), y = b.split("\n");
  const n = x.length, m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: "+" | "-" | " "; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: " ", s: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "-", s: x[i++] });
    else out.push({ t: "+", s: y[j++] });
  }
  while (i < n) out.push({ t: "-", s: x[i++] });
  while (j < m) out.push({ t: "+", s: y[j++] });
  return out;
}

const RUNNABLE = /^(html|js|javascript|py|python)$/i;

function Code({ lang, code, say, dev, idx, closed = true }: { lang: string; code: string; say: (m: string) => void; dev?: DevCtx; idx: number; closed?: boolean }) {
  useLangReady(); // đổi ngôn ngữ thì vẽ lại: bộ dịch trang bỏ qua .ai-msg nên nút ở đây phải tự dịch bằng tr()
  const [ok, setOk] = useState(false);
  const [diff, setDiff] = useState(false);
  const raw0 = code;
  const fp = filepathOf(raw0);
  const orig = fp ? dev?.files?.find((f) => f.name === fp || f.name.endsWith("/" + fp))?.text : undefined;
  const merged = dev ? autoMerge(unredact(raw0), orig) : null;
  const hidden = !!dev && merged === null && hasHidden(raw0);
  code = merged ?? unredact(raw0);
  const [verdict, setVerdict] = useState<"" | "ok" | "no">("");
  const name = fp ?? fileNameFor(lang, code);
  const prevAll = (dev?.prev ?? []).filter((p) => p.lang.toLowerCase() === lang.toLowerCase());
  const prev = dev?.prev?.[idx]?.lang.toLowerCase() === lang.toLowerCase() ? dev.prev[idx] : prevAll[prevAll.length - 1];
  const rows = diff && prev && !verdict ? diffLines(prev.code, code) : null;
  const add = rows?.filter((r) => r.t === "+").length ?? 0, del = rows?.filter((r) => r.t === "-").length ?? 0;
  // Tô màu cú pháp chỉ khi khối đã đóng (chữ đang chảy giữ đơn sắc, không tô lại mỗi khung hình); chưa tô xong thì như cũ.
  const toks = useHighlight(code, lang, closed && !rows);
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = name.split("/").pop() || name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500); say(tr("Đã tải") + " " + name);
  };
  return (
    <div className="codeblock" data-cb>
      <div className="cb-head"><span className="cb-name">{dev ? name : lang || "text"}</span>
        <div className="cb-tools">
          {dev && <>
            <button className={diff ? "on" : ""} disabled={!prev} title={tr(prev ? "So sánh với phiên bản trước" : "Chưa có phiên bản trước để so sánh")} onClick={() => setDiff(!diff)}><b className="cb-pm">±</b>Diff{rows && <i className="cb-cnt"><em className="a">+{add}</em><em className="d">−{del}</em></i>}</button>
            {RUNNABLE.test(lang) && <button title={tr("Chạy thử")} onClick={() => dev.onPanel({ lang, code, name, run: true })}><I.Play size={13} />{tr("Chạy")}</button>}
            <button title={tr("Mở trong khung soạn thảo")} onClick={() => dev.onPanel({ lang, code, name })}><I.AppWindow size={14} />{tr("Mở")}</button>
            <button title={tr("Tải về")} aria-label={tr("Tải về")} onClick={download}><I.Download size={14} /></button>
            <button title={tr("Sao chép đường dẫn")} aria-label={tr("Sao chép đường dẫn")} onClick={() => { navigator.clipboard?.writeText(name); say(tr("Đã sao chép đường dẫn:") + " " + name); }}><I.Connect size={14} /></button>
          </>}
          <button onClick={() => { navigator.clipboard?.writeText(code); setOk(true); say(tr("Đã sao chép mã")); setTimeout(() => setOk(false), 1500); }}>{ok ? <I.M icon="Check" size={14} /> : <I.M icon="Copy" size={14} />}{tr(ok ? "Đã chép" : "Sao chép")}</button>
        </div>
      </div>
      {merged !== null && <div className="cb-note">{tr("⚡ Đã tự ghép với tệp gốc · 0 token")}</div>}
      {hidden && <div className="cb-note warn">{tr("Một số đoạn code đã được ẩn.")}<button onClick={() => dev?.onExpand?.(name, code)}>{tr("⚡ Bung đoạn code bị ẩn")}</button></div>}
      {rows && <div className="cb-note"><button className="ok" onClick={() => { setVerdict("ok"); dev?.onAccept?.(name, code); say(tr("Đã chấp nhận thay đổi") + " " + name); }}>{tr("✓ Chấp nhận")}</button><button onClick={() => { setVerdict("no"); setDiff(false); }}>{tr("✕ Từ chối")}</button></div>}
      {verdict && <div className="cb-note">{tr(verdict === "ok" ? "Đã chấp nhận thay đổi" : "Đã từ chối thay đổi")}</div>}
      {rows ? <pre className="cb-diff">{rows.map((r, i) => <div key={i} className={r.t === "+" ? "ad" : r.t === "-" ? "dl" : ""}><span>{r.t === " " ? "" : r.t}</span>{r.s || " "}</div>)}</pre> : <pre className={[!dev && codeWraps(lang, code) ? "cb-wrap" : "", toks ? "shiki" : ""].filter(Boolean).join(" ") || undefined}>{toks ? toks.map((l, i) => <Fragment key={i}>{i ? "\n" : ""}<TokLine toks={l} /></Fragment>) : code}</pre>}
      {dev && <Widgets lang={lang} code={code} />}
    </div>
  );
}

function PkgBadge({ p }: { p: Pkg }) {
  const [st, setSt] = useState<string>("...");
  useEffect(() => { let on = true; const t = setTimeout(() => checkPkg(p).then((r) => on && setSt(r)), 900); return () => { on = false; clearTimeout(t); }; }, [p.eco, p.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const m: Record<string, [string, string]> = { "...": ["⏳", tr("đang kiểm tra")], ok: ["🟢", tr("đã xác minh")], deprecated: ["🟡", tr("đã lỗi thời")], missing: ["🔴", tr("không tồn tại — có thể AI bịa ra")], unknown: ["⚪", tr("không kiểm tra được")] };
  return <span className={`cb-pkg s-${st}`} title={p.eco}>{m[st][0]} {p.name}<em>{m[st][1]}</em></span>;
}

function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [z, setZ] = useState(1);
  const draw = async () => {
    setOpen(true); setErr("");
    try {
      const mm = (await import("mermaid")).default;
      mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default" });
      const r = await mm.render("mm" + Date.now(), code);
      setSvg(r.svg);
    } catch (e) { setErr(String((e as Error).message ?? e).slice(0, 200)); }
  };
  const save = (kind: "svg" | "png") => {
    const dl = (url: string, ext: string) => { const a = document.createElement("a"); a.href = url; a.download = "so-do." + ext; a.click(); };
    if (kind === "svg") { const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); dl(u, "svg"); setTimeout(() => URL.revokeObjectURL(u), 500); return; }
    const el = document.createElement("div"); el.innerHTML = svg;
    const s = el.querySelector("svg"); if (!s) return;
    const vb = s.viewBox.baseVal; const w = (vb?.width || 800) * 2, h = (vb?.height || 600) * 2;
    s.setAttribute("width", String(w)); s.setAttribute("height", String(h));
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); dl(c.toDataURL("image/png"), "png"); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(s));
  };
  return (
    <div className="cb-w col">
      {!open ? <button className="cb-btn" onClick={draw}>{tr("📊 Vẽ sơ đồ")}</button> : (
        <>
          <div className="cb-w"><b>{tr("Sơ đồ")}</b><button className="cb-btn" onClick={() => setZ((x) => Math.max(0.4, x - 0.2))}>−</button><span>{Math.round(z * 100)}%</span><button className="cb-btn" onClick={() => setZ((x) => Math.min(3, x + 0.2))}>+</button><button className="cb-btn" onClick={() => setZ(1)}>{tr("Đặt lại")}</button><button className="cb-btn" onClick={() => save("svg")}>SVG</button><button className="cb-btn" onClick={() => save("png")}>PNG</button></div>
          {err ? <em>{tr("Không vẽ được:")} {err}</em> : <div className="cb-mm"><div style={{ transform: `scale(${z})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: svg }} /></div>}
        </>
      )}
    </div>
  );
}

function Widgets({ lang, code }: { lang: string; code: string }) {
  const pk = /^(bash|sh|shell|zsh|console|)$/i.test(lang) ? parsePackages(code) : [];
  const cron = findCron(code);
  const ci = cron ? cronInfo(cron) : null;
  const [rx, setRx] = useState("");
  const [sample, setSample] = useState("");
  const isRx = /^(regex|regexp)$/i.test(lang);
  let hits: string[] = [], bad = false;
  if (isRx && rx.trim()) { try { const src = rx.trim().match(/^\/(.*)\/([a-z]*)$/); const r = new RegExp(src ? src[1] : rx.trim(), (src ? src[2] : "g").includes("g") ? src?.[2] ?? "g" : (src?.[2] ?? "") + "g"); hits = Array.from(sample.matchAll(r)).map((m) => m[0]); } catch { bad = true; } }
  const isMm = /^mermaid$/i.test(lang);
  if (!pk.length && !ci && !isRx && !isMm) return null;
  return (
    <div className="cb-widgets">
      {isMm && <MermaidView code={code} />}
      {pk.length > 0 && <div className="cb-w"><b>{tr("Kiểm tra gói")}</b>{pk.map((p) => <PkgBadge key={p.eco + p.name} p={p} />)}</div>}
      {ci && <div className="cb-w"><b>Cron</b><span>{ci.text}</span><em>{tr("Lần chạy kế:")} {ci.next.map((d) => d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })).join(" · ")}</em></div>}
      {isRx && <div className="cb-w col"><b>{tr("Thử regex")}</b><input aria-label={tr("Thử regex")} value={rx} placeholder={code.trim().split("\n")[0]} onChange={(e) => setRx(e.target.value)} /><input value={sample} aria-label={tr("Chuỗi mẫu để kiểm tra…")} placeholder={tr("Chuỗi mẫu để kiểm tra…")} onChange={(e) => setSample(e.target.value)} />{bad ? <em>{tr("Regex không hợp lệ")}</em> : sample && <em>{hits.length} {tr("kết quả")}{hits.length ? ": " + hits.slice(0, 8).join(" · ") : ""}</em>}</div>}
    </div>
  );
}

// Hình minh họa ngay trong chat (Cài đặt → Khả năng): ```chart, ```mermaid, ```widget. Khối chưa viết xong thì hiện chỗ chờ.
function Visual({ lang, code, closed, say }: { lang: string; code: string; closed: boolean; say: (m: string) => void }) {
  const [h, setH] = useState(120);
  const [err, setErr] = useState("");
  if (!closed) return <div className="viz-wait"><span className="art-spin sm" />{tr(lang === "chart" ? "Đang vẽ biểu đồ…" : lang === "mermaid" ? "Đang vẽ sơ đồ…" : "Đang tạo hình minh họa…")}</div>;
  if (lang === "chart") {
    const spec = parseChart(code);
    return typeof spec === "string" ? <><div className="viz-note">{tr("Không vẽ được biểu đồ")}: {spec}</div><Code lang="json" code={code} say={say} idx={0} /></> : <ChartView spec={spec} />;
  }
  if (lang === "mermaid") return <div className="viz-card"><MermaidSvg code={code} /></div>;
  return (
    <div className="viz-card viz-widget">
      {err && <div className="viz-note">{tr("Hình minh họa gặp lỗi")}: {err}</div>}
      <ArtifactFrame type="html" content={code} ai={false} title="widget" onError={setErr} onHeight={(v) => setH(Math.min(640, Math.max(48, v)))} style={{ height: h }} className="viz-frame" />
    </div>
  );
}

// Bảng trong câu trả lời: bấm tiêu đề cột để sắp xếp (hiểu số kiểu Việt "12.500", "12,5"), chép sang Excel / Sheets, tải CSV.
const plain = (c: string) => (/[*_`~<[&\\$!]/.test(c) ? inlineText(parseInline(c)) : c).trim();
function num(c: string): number | null {
  const m = plain(c).replace(/\s/g, "").match(/^[^\d-]*(-?[\d.,]+)/);
  if (!m) return null;
  let x = m[1];
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g, "");
  else x = x.replace(",", ".");
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function MdTable({ head, rows, align, say }: { head: string[]; rows: string[][]; align: Align[]; say: (m: string) => void }) {
  useLangReady();
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    if (!sort) return rows;
    const { col, dir } = sort;
    const isNum = rows.filter((r) => plain(r[col] ?? "")).every((r) => num(r[col] ?? "") !== null);
    return [...rows].sort((a, b) => dir * (isNum ? (num(a[col] ?? "") ?? 0) - (num(b[col] ?? "") ?? 0) : plain(a[col] ?? "").localeCompare(plain(b[col] ?? ""), "vi", { numeric: true })));
  }, [rows, sort]);
  const grid = [head, ...shown].map((r) => r.map(plain));
  const copy = () => { navigator.clipboard?.writeText(grid.map((r) => r.join("\t")).join("\n")).then(() => say(tr("Đã chép bảng, dán vào Excel hoặc Google Sheets được ngay")), () => say(tr("Không chép được"))); };
  const csv = () => {
    const q = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const url = URL.createObjectURL(new Blob(["\ufeff" + grid.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "bang.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const by = (k: number) => setSort((s) => (s?.col !== k ? { col: k, dir: 1 } : s.dir === 1 ? { col: k, dir: -1 } : null));
  return (
    <div className="md-tbl">
      <div className="md-tbl-bar">
        <button className="icon-btn" onClick={copy} aria-label={tr("Chép bảng")} title={tr("Chép bảng (dán vào Excel, Sheets)")}><I.Copy size={14} /></button>
        <button className="icon-btn" onClick={csv} aria-label={tr("Tải CSV")} title={tr("Tải CSV")}><I.Download size={14} /></button>
      </div>
      <table><thead><tr>{head.map((c, k) => (
        <th key={k} style={align[k] ? { textAlign: align[k] as "left" | "center" | "right" } : undefined} aria-sort={sort?.col === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
          <button className="md-th" onClick={() => by(k)} title={tr("Bấm để sắp xếp")}><Inline t={c} /><span className={`md-sort ${sort?.col === k ? "on" : ""}`}>{sort?.col === k && sort.dir === -1 ? "↓" : "↑"}</span></button>
        </th>
      ))}</tr></thead><tbody>{shown.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} style={align[j] ? { textAlign: align[j] as "left" | "center" | "right" } : undefined}><Inline t={c} /></td>)}</tr>)}</tbody></table>
    </div>
  );
}

type Ctx = { say: (m: string) => void; dev?: DevCtx; viz?: boolean; live?: boolean; tail: number; last: number };

// Khối đã phân tích → phần tử. tail: chỉ ba dòng cuối của câu đang viết còn bọc từng chữ (đủ cho phần vừa về đang mờ dần). last: đoạn cuối cùng, dấu nhấn chưa đóng vẫn hiện đúng.
function renderBlocks(bs: Block[], x: Ctx): React.ReactNode[] {
  return bs.map((b, k) => <BlockView key={k} b={b} x={x} />);
}
function BlockView({ b, x }: { b: Block; x: Ctx }): React.ReactNode {
  switch (b.t) {
    case "p": return <p><Inline t={b.s} w={b.end >= x.tail} open={b.end >= x.last} /></p>;
    case "h": {
      // Giữ đúng cấp tiêu đề (# lớn nhất … #### trở xuống cùng cỡ) để tài liệu dài vẫn thấy rõ bố cục.
      const H = `h${Math.min(b.level, 4)}` as "h1" | "h2" | "h3" | "h4";
      return <H><Inline t={b.s} w={b.end >= x.tail} open={b.end >= x.last} /></H>;
    }
    case "hr": return <hr />;
    case "quote": return <blockquote>{renderBlocks(b.c, x)}</blockquote>;
    case "table": return <MdTable head={b.head} rows={b.rows} align={b.align} say={x.say} />;
    case "math": return <MathView v={b.v} display />;
    case "fns": return <div className="md-fns">{b.items.map((f, k) => <div key={k}><sup>{f.id}</sup> <Inline t={f.s} /></div>)}</div>;
    case "list": {
      const items = b.items.map((it, k) => {
        // Đoạn đầu của mục nằm thẳng trong <li> để danh sách gọn; khối sau (danh sách con, code) xếp dưới.
        const [first, ...rest] = it.c;
        const body = first?.t === "p" ? <><Inline t={first.s} w={first.end >= x.tail} open={first.end >= x.last} />{renderBlocks(rest, x)}</> : renderBlocks(it.c, x);
        // Ô đánh dấu của checklist ("- [ ] việc", "- [x] đã xong"): hiện ô vuông, không phải chữ "[ ]".
        return it.task ? <li key={k} className="task"><span className={`tick${it.done ? " on" : ""}`} aria-hidden="true" /><div className="task-b">{body}</div></li> : <li key={k}>{body}</li>;
      });
      // start lấy theo số model viết: bước 2 nằm sau một khối code hay một đoạn văn vẫn là 2, không quay về 1.
      return b.ordered ? <ol start={b.start !== 1 ? b.start : undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case "code": {
      const l = b.lang.toLowerCase();
      if (l === "ask" && !x.dev) return <AskCard code={b.code} closed={b.closed} live={!!x.live} />;
      if (x.viz && (l === "chart" || l === "mermaid" || l === "widget")) return <Visual lang={l} code={b.code} closed={b.closed} say={x.say} />;
      // Câu trả lời đã xong mà còn dấu mở trơ trọi: không vẽ khung code rỗng.
      if (!b.closed && !b.code && x.tail === Infinity) return null;
      return <Code lang={b.lang} code={b.code} say={x.say} dev={x.dev} idx={b.idx} closed={b.closed} />;
    }
  }
}
// Mỗi khối ngoài cùng chỉ dựng lại khi chữ gốc của nó đổi: câu trả lời đang viết chỉ dựng khối cuối, không phân tích lại cả bài mỗi khung hình.
const TopView = memo(function TopView({ top, x }: { top: Top; x: Ctx }) { return <BlockView b={top.b} x={x} />; },
  (a, b) => a.top.src === b.top.src && a.top.n === b.top.n && a.x.say === b.x.say && a.x.dev === b.x.dev && a.x.viz === b.x.viz && a.x.live === b.x.live
    && (a.top.end >= a.x.tail) === (b.top.end >= b.x.tail) && (a.top.end < a.x.tail || (a.x.tail === b.x.tail && a.x.last === b.x.last)));

// live: thẻ hỏi lại còn bấm được. streaming: câu trả lời đang viết (chữ hiện dần ở đoạn cuối).
export const Markdown = memo(function Markdown({ text: text0, say, dev, viz, live, streaming }: { text: string; say: (m: string) => void; dev?: DevCtx; viz?: boolean; live?: boolean; streaming?: boolean }) {
  // Đang viết: ẩn tạm khối công thức / bảng còn dở (streamSafe) để không nháy chữ thô.
  const { text, meta } = useMemo(() => { const t = streaming ? streamSafe(text0) : text0; return dev ? splitMeta(t) : { text: t, meta: null }; }, [text0, !!dev, !!streaming]); // eslint-disable-line react-hooks/exhaustive-deps
  const { tops, lines } = useMemo(() => parseMarkdown(text), [text]);
  const x: Ctx = { say, dev, viz, live, tail: streaming ? lines - 3 : Infinity, last: streaming ? lines - 1 : Infinity };
  return (
    <>
      <div>{tops.map((t, i) => <TopView key={i} top={t} x={x} />)}</div>
      {meta && <div className="cb-cx"><span>⏱ Time {meta.time}</span><span>▤ Space {meta.space}</span>{meta.canOptimize && <span className="opt">{tr("Có thể tối ưu thêm")}</span>}</div>}
    </>
  );
});
