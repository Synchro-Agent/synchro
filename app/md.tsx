"use client";

import { useEffect, useMemo, useState } from "react";
import { unredact, filepathOf, autoMerge, hasHidden, splitMeta, parsePackages, checkPkg, findCron, cronInfo, type Pkg } from "./devtools";
import * as I from "./icons";
import { locale, tr } from "./i18n";
import { ChartView, parseChart } from "./charts";
import { ArtifactFrame, MermaidSvg } from "./artifactui";
import { AskCard } from "./askcard";

function Inline({ t }: { t: string }) {
  const parts = t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
        : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i} className="ic">{p.slice(1, -1)}</code>
        : <span key={i}>{p.split(/(\s+)/).map((w, k) => (/^\s*$/.test(w) ? w : <span key={k} className="w">{w}</span>))}</span>
      )}
    </>
  );
}

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

function Code({ lang, code, say, dev, idx }: { lang: string; code: string; say: (m: string) => void; dev?: DevCtx; idx: number }) {
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
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = name.split("/").pop() || name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500); say("Đã tải " + name);
  };
  return (
    <div className="codeblock" data-cb>
      <div className="cb-head"><span className="cb-name">{dev ? name : lang || "text"}</span>
        <div className="cb-tools">
          {dev && <>
            <button className={diff ? "on" : ""} disabled={!prev} title={prev ? "So sánh với phiên bản trước" : "Chưa có phiên bản trước để so sánh"} onClick={() => setDiff(!diff)}><b className="cb-pm">±</b>Diff{rows && <i className="cb-cnt"><em className="a">+{add}</em><em className="d">−{del}</em></i>}</button>
            {RUNNABLE.test(lang) && <button title="Chạy thử" onClick={() => dev.onPanel({ lang, code, name, run: true })}><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z" /></svg>Chạy</button>}
            <button title="Mở trong khung soạn thảo" onClick={() => dev.onPanel({ lang, code, name })}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M9.5 3v10" /></svg>Mở</button>
            <button title="Tải về" onClick={download}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" /></svg></button>
            <button title="Sao chép đường dẫn" onClick={() => { navigator.clipboard?.writeText(name); say("Đã sao chép đường dẫn: " + name); }}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.1 2.1 0 013 3l-1 1M9 11.5l-1 1a2.1 2.1 0 01-3-3l1-1" /></svg></button>
          </>}
          <button onClick={() => { navigator.clipboard?.writeText(code); setOk(true); say("Đã sao chép mã"); setTimeout(() => setOk(false), 1500); }}>{ok ? <I.Check size={14} /> : <I.Copy size={14} />}{ok ? "Đã chép" : "Sao chép"}</button>
        </div>
      </div>
      {merged !== null && <div className="cb-note">⚡ Đã tự ghép với tệp gốc · 0 token</div>}
      {hidden && <div className="cb-note warn">Một số đoạn code đã được ẩn.<button onClick={() => dev?.onExpand?.(name, code)}>⚡ Bung đoạn code bị ẩn</button></div>}
      {rows && <div className="cb-note"><button className="ok" onClick={() => { setVerdict("ok"); dev?.onAccept?.(name, code); say("Đã chấp nhận thay đổi " + name); }}>✓ Chấp nhận</button><button onClick={() => { setVerdict("no"); setDiff(false); }}>✕ Từ chối</button></div>}
      {verdict && <div className="cb-note">{verdict === "ok" ? "Đã chấp nhận thay đổi" : "Đã từ chối thay đổi"}</div>}
      {rows ? <pre className="cb-diff">{rows.map((r, i) => <div key={i} className={r.t === "+" ? "ad" : r.t === "-" ? "dl" : ""}><span>{r.t === " " ? "" : r.t}</span>{r.s || " "}</div>)}</pre> : <pre>{code}</pre>}
      {dev && <Widgets lang={lang} code={code} />}
    </div>
  );
}

function PkgBadge({ p }: { p: Pkg }) {
  const [st, setSt] = useState<string>("...");
  useEffect(() => { let on = true; const t = setTimeout(() => checkPkg(p).then((r) => on && setSt(r)), 900); return () => { on = false; clearTimeout(t); }; }, [p.eco, p.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const m: Record<string, [string, string]> = { "...": ["⏳", "đang kiểm tra"], ok: ["🟢", "đã xác minh"], deprecated: ["🟡", "đã lỗi thời"], missing: ["🔴", "không tồn tại — có thể AI bịa ra"], unknown: ["⚪", "không kiểm tra được"] };
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
      {!open ? <button className="cb-btn" onClick={draw}>📊 Vẽ sơ đồ</button> : (
        <>
          <div className="cb-w"><b>Sơ đồ</b><button className="cb-btn" onClick={() => setZ((x) => Math.max(0.4, x - 0.2))}>−</button><span>{Math.round(z * 100)}%</span><button className="cb-btn" onClick={() => setZ((x) => Math.min(3, x + 0.2))}>+</button><button className="cb-btn" onClick={() => setZ(1)}>Đặt lại</button><button className="cb-btn" onClick={() => save("svg")}>SVG</button><button className="cb-btn" onClick={() => save("png")}>PNG</button></div>
          {err ? <em>Không vẽ được: {err}</em> : <div className="cb-mm"><div style={{ transform: `scale(${z})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: svg }} /></div>}
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
      {pk.length > 0 && <div className="cb-w"><b>Kiểm tra gói</b>{pk.map((p) => <PkgBadge key={p.eco + p.name} p={p} />)}</div>}
      {ci && <div className="cb-w"><b>Cron</b><span>{ci.text}</span><em>Lần chạy kế: {ci.next.map((d) => d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })).join(" · ")}</em></div>}
      {isRx && <div className="cb-w col"><b>Thử regex</b><input value={rx} placeholder={code.trim().split("\n")[0]} onChange={(e) => setRx(e.target.value)} /><input value={sample} placeholder="Chuỗi mẫu để kiểm tra…" onChange={(e) => setSample(e.target.value)} />{bad ? <em>Regex không hợp lệ</em> : sample && <em>{hits.length} kết quả{hits.length ? ": " + hits.slice(0, 8).join(" · ") : ""}</em>}</div>}
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
const plain = (c: string) => c.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
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
function MdTable({ head, rows, say }: { head: string[]; rows: string[][]; say: (m: string) => void }) {
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
        <button className="icon-btn" onClick={copy} aria-label="Chép bảng" title="Chép bảng (dán vào Excel, Sheets)"><I.Copy size={14} /></button>
        <button className="icon-btn" onClick={csv} aria-label="Tải CSV" title="Tải CSV"><I.Download size={14} /></button>
      </div>
      <table><thead><tr>{head.map((c, k) => (
        <th key={k} aria-sort={sort?.col === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
          <button className="md-th" onClick={() => by(k)} title="Bấm để sắp xếp"><Inline t={c} /><span className={`md-sort ${sort?.col === k ? "on" : ""}`}>{sort?.col === k && sort.dir === -1 ? "↓" : "↑"}</span></button>
        </th>
      ))}</tr></thead><tbody>{shown.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}><Inline t={c} /></td>)}</tr>)}</tbody></table>
    </div>
  );
}

export function Markdown({ text: text0, say, dev, viz, live }: { text: string; say: (m: string) => void; dev?: DevCtx; viz?: boolean; live?: boolean }) {
  let cbi = 0;
  const { text, meta } = dev ? splitMeta(text0) : { text: text0, meta: null };
  const segs = text.split(/(```[\s\S]*?(?:```|$))/g);
  return (
    <>
      {segs.map((s, i) => {
        if (s.startsWith("```")) {
          const body = s.replace(/^```/, "").replace(/```$/, "");
          const nl = body.indexOf("\n");
          const lang = nl === -1 ? body : body.slice(0, nl);
          const l = lang.trim().toLowerCase();
          if (l === "ask" && !dev) return <AskCard key={i} code={nl === -1 ? "" : body.slice(nl + 1)} closed={/```\s*$/.test(s) && s.length > 6} live={!!live} />;
          if (viz && (l === "chart" || l === "mermaid" || l === "widget")) return <Visual key={i} lang={l} code={nl === -1 ? "" : body.slice(nl + 1).replace(/\n$/, "")} closed={/```\s*$/.test(s) && s.length > 6} say={say} />;
          return <Code key={i} lang={lang.trim()} code={nl === -1 ? "" : body.slice(nl + 1).replace(/\n$/, "")} say={say} dev={dev} idx={cbi++} />;
        }
        const lines = s.split("\n");
        const out: React.ReactNode[] = [];
        let list: string[] = [];
        let ord = false;
        const flush = () => {
          if (!list.length) return;
          const items = list.map((l, k) => <li key={k}><Inline t={l} /></li>);
          out.push(ord ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
          list = [];
        };
        let tbl: string[] = [];
        const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const flushT = () => {
          if (!tbl.length) return;
          const hasSep = tbl.length > 1 && /^[\s|:-]+$/.test(tbl[1]);
          const head = cells(tbl[0]), rows = tbl.slice(hasSep ? 2 : 1).map(cells);
          out.push(<MdTable key={out.length} head={head} rows={rows} say={say} />);
          tbl = [];
        };
        lines.forEach((l) => {
          if (/^\s*\|.*\|\s*$/.test(l)) { flush(); tbl.push(l); return; }
          flushT();
          const b = l.match(/^\s*[-*]\s+(.*)/);
          const n = l.match(/^\s*\d+\.\s+(.*)/);
          const h = l.match(/^(#{1,6})\s+(.*)/);
          if (b || n) { const o = !!n; if (list.length && o !== ord) flush(); ord = o; list.push((b || n)![1]); return; }
          flush();
          // Giữ đúng cấp tiêu đề (# lớn nhất … #### trở xuống cùng cỡ) để tài liệu dài vẫn thấy rõ bố cục.
          if (h) { const H = `h${Math.min(h[1].length, 4)}` as "h1" | "h2" | "h3" | "h4"; out.push(<H key={out.length}><Inline t={h[2]} /></H>); }
          else if (l.trim()) out.push(<p key={out.length}><Inline t={l} /></p>);
        });
        flush(); flushT();
        return <div key={i}>{out}</div>;
      })}
      {meta && <div className="cb-cx"><span>⏱ Time {meta.time}</span><span>▤ Space {meta.space}</span>{meta.canOptimize && <span className="opt">Có thể tối ưu thêm</span>}</div>}
    </>
  );
}

