"use client";
// Các khung bên phải của Synchro Code: terminal (PTY thật trong workspace), trình duyệt (Chromium của workspace,
// người dùng và agent cùng điều khiển), file (cây thư mục + Monaco) và session rail (môi trường, ngữ cảnh, thay đổi git).
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@xterm/xterm/css/xterm.css";
import * as I from "./icons";
import { gitOp, isLocalUrl, useCodeUi, wsOp, type GitState, type WsStatus } from "./wsclient";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="cv-ed-load">Đang tải Monaco…</div> });
type Say = (m: string) => void;
const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

// ------------------------------------------------------------------ terminal
type TermTab = { id: number; kind: "log" | "term"; title: string };
export function TerminalPane({ sid, visible }: { sid: number; visible: boolean }) {
  const [tabs, setTabs] = useState<TermTab[]>([{ id: 1, kind: "log", title: "Agent" }, { id: 2, kind: "term", title: "Terminal" }]);
  const [act, setAct] = useState(2);
  const want = useCodeUi((s) => s.termTab);
  useEffect(() => { if (want) setAct(want.tab === "log" ? 1 : tabs.find((t) => t.kind === "term")?.id ?? 1); }, [want?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = () => { const id = Math.max(...tabs.map((t) => t.id)) + 1; setTabs([...tabs, { id, kind: "term", title: `Terminal ${tabs.filter((t) => t.kind === "term").length + 1}` }]); setAct(id); };
  const close = (id: number) => { const rest = tabs.filter((t) => t.id !== id); setTabs(rest); if (act === id) setAct(rest[rest.length - 1]?.id ?? 1); };
  return (
    <div className="tp">
      <div className="tp-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`tp-tab ${act === t.id ? "on" : ""}`}>
            <button onClick={() => setAct(t.id)}>{t.kind === "log" ? <I.Spark size={13} /> : <I.Terminal size={13} />}{t.title}</button>
            {t.kind === "term" && tabs.filter((x) => x.kind === "term").length > 1 && <button className="tp-x" onClick={() => close(t.id)} aria-label="Đóng terminal"><I.X size={11} /></button>}
          </div>
        ))}
        <button className="icon-btn tp-add" onClick={add} aria-label="Terminal mới" title="Terminal mới"><I.Plus size={14} /></button>
      </div>
      <div className="tp-body">
        {tabs.map((t) => <Term key={`${sid}-${t.id}`} sid={sid} kind={t.kind} visible={visible && act === t.id} />)}
      </div>
    </div>
  );
}

const THEMES = {
  light: { background: "#fcfcfa", foreground: "#1f1e1d", cursor: "#1f1e1d", selectionBackground: "#c9d9f7", black: "#1f1e1d", brightBlack: "#87867f", blue: "#2f6fd6", cyan: "#0f8a9a", green: "#2f8a3e", yellow: "#a26a00", red: "#c63c2f", magenta: "#9a3fb5", white: "#ebeae6" },
  dark: { background: "#141414", foreground: "#ecebe6", cursor: "#ecebe6", selectionBackground: "#35507a", black: "#141414", brightBlack: "#87867f", blue: "#6aa6ff", cyan: "#4cc7d6", green: "#6ccf7a", yellow: "#e6c45c", red: "#ff7a6b", magenta: "#d38cf0", white: "#ecebe6" },
};

function Term({ sid, kind, visible }: { sid: number; kind: "log" | "term"; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: () => void; connect: () => void; focus: () => void } | null>(null);
  const [st, setSt] = useState<"connecting" | "open" | "closed">("connecting");
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let ro: ResizeObserver | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      const t = new Terminal({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.25, cursorBlink: kind === "term", disableStdin: kind === "log", scrollback: 8000, theme: isDark() ? THEMES.dark : THEMES.light, allowProposedApi: false });
      term = t;
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(host.current);
      const refit = () => { try { if (host.current?.offsetWidth) fit.fit(); } catch {} if (ws?.readyState === 1) ws.send(JSON.stringify({ r: [t.cols, t.rows] })); };
      const connect = async () => {
        ws?.close();
        setSt("connecting");
        try {
          const { url } = await wsOp<{ url: string }>("ticket", sid, { kind });
          if (disposed) return;
          const s = new WebSocket(`${url}&cols=${t.cols}&rows=${t.rows}`);
          ws = s;
          s.binaryType = "arraybuffer";
          s.onopen = () => { setSt("open"); refit(); };
          s.onmessage = (e) => {
            if (typeof e.data === "string") { try { const j = JSON.parse(e.data); if (j.error) t.write(`\r\n\x1b[31m${j.error}\x1b[0m\r\n`); } catch {} }
            else t.write(new Uint8Array(e.data as ArrayBuffer));
          };
          s.onclose = () => { if (ws === s) { setSt("closed"); t.write("\r\n\x1b[2m[Đã ngắt kết nối]\x1b[0m\r\n"); } };
        } catch (e) { t.write(`\x1b[31m${(e as Error).message}\x1b[0m\r\n`); setSt("closed"); }
      };
      t.onData((d) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ i: d })); });
      ro = new ResizeObserver(refit);
      ro.observe(host.current);
      api.current = { fit: refit, connect, focus: () => t.focus() };
      refit();
      connect();
    })();
    const theme = new MutationObserver(() => { if (term) term.options.theme = isDark() ? THEMES.dark : THEMES.light; });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { disposed = true; theme.disconnect(); ro?.disconnect(); const s = ws; ws = null; s?.close(); term?.dispose(); };
  }, [sid, kind]);
  useEffect(() => { if (visible) setTimeout(() => { api.current?.fit(); if (kind === "term") api.current?.focus(); }, 30); }, [visible, kind]);
  return (
    <div className="tp-term" style={{ display: visible ? "flex" : "none" }}>
      <div ref={host} className="tp-xterm" />
      {st === "closed" && <button className="tp-re btn" onClick={() => api.current?.connect()}><I.Retry size={14} />Kết nối lại</button>}
      {st === "connecting" && <div className="tp-wait"><span className="ag-spin" />Đang bật workspace…</div>}
    </div>
  );
}

// ------------------------------------------------------------------ trình duyệt
const MOD = (e: React.KeyboardEvent | React.MouseEvent) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const BTN = ["left", "middle", "right"] as const;

export function BrowserPane({ sid, visible, say }: { sid: number; visible: boolean; say: Say }) {
  const [url, setUrl] = useState("");
  const [addr, setAddr] = useState("");
  const [title, setTitle] = useState("");
  const [st, setSt] = useState<"connecting" | "open" | "closed">("connecting");
  const [loading, setLoading] = useState(false);
  const [blank, setBlank] = useState(true);
  const ws = useRef<WebSocket | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const editing = useRef(false);
  const lastMove = useRef(0);
  const send = (o: Record<string, unknown>) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(o)); };

  const connect = useCallback(async () => {
    ws.current?.close();
    setSt("connecting");
    try {
      const { url: u } = await wsOp<{ url: string }>("ticket", sid, { kind: "screen" });
      const s = new WebSocket(u);
      ws.current = s;
      s.onopen = () => {
        setSt("open");
        const r = view.current?.getBoundingClientRect();
        if (r?.width) s.send(JSON.stringify({ t: "size", w: Math.round(r.width), h: Math.round(r.height) }));
      };
      s.onmessage = (e) => {
        let j: { t: string; data?: string; url?: string; title?: string; on?: boolean; error?: string };
        try { j = JSON.parse(String(e.data)); } catch { return; }
        if (j.t === "frame" && img.current) { img.current.src = `data:image/jpeg;base64,${j.data}`; setBlank(false); }
        else if (j.t === "nav") { if (j.url !== undefined) { setUrl(j.url); if (!editing.current) setAddr(j.url === "about:blank" ? "" : j.url); } if (j.title !== undefined) setTitle(j.title); }
        else if (j.t === "loading") setLoading(!!j.on);
        else if (j.t === "error" && j.error) say(j.error);
      };
      s.onclose = () => { if (ws.current === s) setSt("closed"); };
    } catch (e) { say((e as Error).message); setSt("closed"); }
  }, [sid, say]);

  // Chỉ nhận hình khi khung đang hiện (tiết kiệm băng thông); ẩn thì ngắt.
  useEffect(() => {
    if (!visible) { const s = ws.current; ws.current = null; s?.close(); return; }
    connect();
    return () => { const s = ws.current; ws.current = null; s?.close(); };
  }, [visible, connect]);

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { const r = el.getBoundingClientRect(); if (r.width > 50) send({ t: "size", w: Math.round(r.width), h: Math.round(r.height) }); }, 150); });
    ro.observe(el);
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = pt(e.clientX, e.clientY); send({ t: "wheel", ...p, dx: e.deltaX, dy: e.deltaY }); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (cx: number, cy: number) => {
    const im = img.current;
    if (!im || !im.naturalWidth) return { x: 0, y: 0 };
    const r = im.getBoundingClientRect();
    return { x: Math.round(((cx - r.left) / r.width) * im.naturalWidth), y: Math.round(((cy - r.top) / r.height) * im.naturalHeight) };
  };
  const mouse = (type: string) => (e: React.MouseEvent) => {
    if (type === "mouseMoved") { const n = Date.now(); if (n - lastMove.current < 40) return; lastMove.current = n; }
    if (type === "mousePressed") view.current?.focus();
    send({ t: "mouse", type, ...pt(e.clientX, e.clientY), button: type === "mouseMoved" ? (e.buttons & 1 ? "left" : "none") : BTN[e.button] ?? "left", buttons: e.buttons, clickCount: type === "mouseMoved" ? 0 : e.detail || 1, mod: MOD(e) });
  };
  const key = (type: "down" | "up") => (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && ["v", "c", "x"].includes(e.key.toLowerCase())) return; // để trình duyệt xử lý dán / sao chép
    e.preventDefault();
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    const text = printable ? e.key : e.key === "Enter" ? "\r" : undefined;
    send({ t: "key", type: type === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown", key: e.key, code: e.code, text: type === "down" ? text : undefined, kc: e.keyCode, mod: MOD(e) });
  };
  const go = (e: React.FormEvent) => { e.preventDefault(); editing.current = false; if (addr.trim()) send({ t: "go", url: addr.trim() }); view.current?.focus(); };
  const local = !url || isLocalUrl(url);
  return (
    <div className="bp">
      <form className="bp-bar" onSubmit={go}>
        <button type="button" className="icon-btn" onClick={() => send({ t: "back" })} aria-label="Quay lại"><I.Back size={15} /></button>
        <button type="button" className="icon-btn" onClick={() => send({ t: "forward" })} aria-label="Tiến tới"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><I.Back size={15} /></span></button>
        <button type="button" className="icon-btn" onClick={() => send({ t: "reload" })} aria-label="Tải lại">{loading ? <span className="ag-spin" /> : <I.Retry size={15} />}</button>
        <input value={addr} placeholder="Nhập địa chỉ, vd. localhost:3000 hoặc example.com" onFocus={(e) => { editing.current = true; e.target.select(); }} onBlur={() => { editing.current = false; }} onChange={(e) => setAddr(e.target.value)} spellCheck={false} data-notr />
        <button type="button" className="icon-btn" disabled={local} onClick={() => window.open(url, "_blank", "noopener")} title={local ? "Địa chỉ localhost chỉ có trong workspace" : "Mở trong trình duyệt của bạn (Chrome…)"} aria-label="Mở trong trình duyệt của bạn"><I.External size={15} /></button>
      </form>
      <div ref={view} className="bp-view" tabIndex={0} onMouseDown={mouse("mousePressed")} onMouseUp={mouse("mouseReleased")} onMouseMove={mouse("mouseMoved")} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={key("down")} onKeyUp={key("up")} onPaste={(e) => { e.preventDefault(); send({ t: "text", text: e.clipboardData.getData("text") }); }} title={title}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} alt="" draggable={false} style={{ visibility: blank ? "hidden" : "visible" }} />
        {blank && st !== "closed" && <div className="bp-empty"><span className="ag-spin" />Đang bật trình duyệt của workspace…</div>}
        {st === "closed" && <div className="bp-empty"><span>Đã ngắt kết nối trình duyệt.</span><button className="btn" onClick={connect}><I.Retry size={14} />Kết nối lại</button></div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ file
type Ent = { name: string; path: string; dir: boolean; size: number };
type Doc = { path: string; content: string; orig: string; binary?: boolean; diff?: string; truncated?: boolean };
const LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", py: "python", html: "html", css: "css", scss: "scss", json: "json", md: "markdown", go: "go", rs: "rust", sh: "shell", yml: "yaml", yaml: "yaml", sql: "sql", java: "java", rb: "ruby", php: "php", c: "c", cpp: "cpp", h: "c", xml: "xml", svg: "xml", toml: "ini", vue: "html" };
const langOf = (p: string) => LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
const name = (p: string) => p.split("/").pop() || p;

export function FilesPane({ sid, visible, say }: { sid: number; visible: boolean; say: Say }) {
  const [dirs, setDirs] = useState<Record<string, Ent[] | undefined>>({});
  const [exp, setExp] = useState<Set<string>>(new Set(["."]));
  const [docs, setDocs] = useState<Doc[]>([]);
  const [act, setAct] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const want = useCodeUi((s) => s.openFile);
  const [, force] = useState(0);
  const load = useCallback(async (p: string) => {
    try { const r = await wsOp<{ entries: Ent[] }>("list", sid, { path: p }); setDirs((d) => ({ ...d, [p]: r.entries })); }
    catch (e) { setDirs((d) => ({ ...d, [p]: [] })); if (p === ".") say((e as Error).message); }
  }, [sid, say]);
  const refresh = useCallback(() => { setDirs({}); for (const p of exp) load(p); }, [exp, load]);
  useEffect(() => { if (visible) refresh(); }, [visible, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(async (p: string, diff = false) => {
    const key = diff ? `diff:${p}` : p;
    setAct(key);
    if (docs.some((d) => d.path === key)) return;
    try {
      if (diff) {
        const r = await gitOp(sid, "diff", { path: p }) as unknown as { diff: string };
        setDocs((ds) => [...ds, { path: key, content: r.diff || "(không có thay đổi)", orig: "", diff: r.diff }]);
      } else {
        const r = await wsOp<{ content?: string; binary?: boolean; truncated?: boolean }>("read", sid, { path: p });
        setDocs((ds) => [...ds, { path: key, content: r.content ?? "", orig: r.content ?? "", binary: r.binary, truncated: r.truncated }]);
      }
    } catch (e) { say((e as Error).message); setAct(null); }
  }, [docs, sid, say]);
  useEffect(() => { if (want) open(want.path, want.diff); }, [want?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = docs.find((d) => d.path === act) ?? null;
  const save = useCallback(async () => {
    if (!cur || cur.diff !== undefined || cur.binary || cur.content === cur.orig) return;
    try { await wsOp("write", sid, { path: cur.path, content: cur.content }); setDocs((ds) => ds.map((d) => (d.path === cur.path ? { ...d, orig: d.content } : d))); say(`Đã lưu ${name(cur.path)}`); }
    catch (e) { say((e as Error).message); }
  }, [cur, sid, say]);
  const closeDoc = (p: string) => { const rest = docs.filter((d) => d.path !== p); setDocs(rest); if (act === p) setAct(rest[rest.length - 1]?.path ?? null); };
  const toggle = (p: string) => { const n = new Set(exp); if (n.has(p)) n.delete(p); else { n.add(p); if (!dirs[p]) load(p); } setExp(n); force((x) => x + 1); };

  const rows: React.ReactNode[] = [];
  const walk = (p: string, depth: number) => {
    for (const e of dirs[p] ?? []) {
      if (filter && !e.dir && !e.path.toLowerCase().includes(filter.toLowerCase())) continue;
      rows.push(
        <button key={e.path} className={`fp-row ${act === e.path ? "on" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => (e.dir ? toggle(e.path) : open(e.path))} title={e.path}>
          {e.dir ? <span className={`ag-chev ${exp.has(e.path) ? "on" : ""}`}><I.ChevronR size={11} /></span> : <span className="fp-sp" />}
          {e.dir ? <I.Folder size={14} /> : <I.File size={14} />}<span className="cv-ell" data-notr>{e.name}</span>
        </button>,
      );
      if (e.dir && exp.has(e.path)) walk(e.path, depth + 1);
    }
  };
  walk(".", 0);
  return (
    <div className="fp" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}>
      <div className="fp-main">
        {docs.length > 0 && (
          <div className="fp-tabs">
            {docs.map((d) => (
              <div key={d.path} className={`fp-tab ${act === d.path ? "on" : ""}`}>
                <button onClick={() => setAct(d.path)} title={d.path} data-notr>{d.diff !== undefined ? "Δ " : ""}{name(d.path.replace(/^diff:/, ""))}{d.content !== d.orig && d.diff === undefined ? " •" : ""}</button>
                <button className="tp-x" onClick={() => closeDoc(d.path)} aria-label="Đóng"><I.X size={11} /></button>
              </div>
            ))}
          </div>
        )}
        {!cur ? (
          <div className="fp-empty"><I.Folder size={22} /><b>File đang mở sẽ hiện ở đây</b><span>Chọn một file trong cây thư mục, hoặc bấm vào tên file trong cuộc trò chuyện.</span></div>
        ) : cur.binary ? <div className="fp-empty"><b>File nhị phân</b><span>Không hiển thị được dạng văn bản.</span></div>
          : cur.diff !== undefined ? (
            <pre className="fp-diff" data-notr>{cur.content.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>{l || " "}</div>)}</pre>
          ) : (
            <div className="fp-ed">
              <Monaco height="100%" theme={isDark() ? "vs-dark" : "light"} path={cur.path} language={langOf(cur.path)} value={cur.content}
                onChange={(v) => setDocs((ds) => ds.map((d) => (d.path === cur.path ? { ...d, content: v ?? "" } : d)))}
                options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", padding: { top: 8 }, readOnly: cur.truncated }} />
              {cur.content !== cur.orig && <button className="btn dark fp-save" onClick={save}>Lưu (⌘S)</button>}
            </div>
          )}
      </div>
      <div className="fp-tree">
        <div className="fp-search"><I.Search size={14} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc file" /><button className="icon-btn" onClick={refresh} aria-label="Làm mới" title="Làm mới"><I.Retry size={13} /></button></div>
        <div className="fp-rows">{dirs["."] === undefined ? <div className="fp-note"><span className="ag-spin" />Đang tải…</div> : rows.length ? rows : <div className="fp-note">Thư mục trống. Kết nối repo GitHub hoặc nhờ agent tạo file.</div>}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ session rail
export function SessionRail({ sid, status, git, onGit, say, context, onClose }: { sid: number | null; status: WsStatus | null; git?: GitState; onGit: (g: GitState) => void; say: Say; context: React.ReactNode; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const showFile = useCodeUi((s) => s.showFile);
  const run = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    if (sid === null) return;
    setBusy(action);
    try {
      const g = await gitOp(sid, action, body);
      onGit(g);
      if (action === "commit") setMsg("");
      if (g.git && g.pr) { say(`Đã tạo pull request #${g.pr.number}`); window.open(g.pr.url, "_blank", "noopener"); }
      else if (ok) say(ok);
    } catch (e) { say((e as Error).message); }
    setBusy("");
  };
  const stop = async () => { setBusy("stop"); try { await wsOp("stop", null); say("Đã dừng workspace (file vẫn được giữ)"); } catch (e) { say((e as Error).message); } setBusy(""); };
  const files = git?.git ? git.files : [];
  return (
    <aside className="sr">
      <div className="sr-h"><b>Phiên làm việc</b><button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button></div>
      <section>
        <h4>Môi trường</h4>
        {!status ? <p className="sr-note">Đang kiểm tra…</p> : !status.available ? <p className="sr-note">{status.reason}</p> : <>
          <div className="sr-row"><span className={`sr-dot ${status.running ? "on" : ""}`} />Workspace Linux<em>{status.running ? "đang chạy" : "đang tắt"}</em></div>
          {git?.git && git.repo && <div className="sr-row"><I.GitHub size={14} /><a href={`https://github.com/${git.repo}`} target="_blank" rel="noreferrer" data-notr>{git.repo}</a></div>}
          {git?.git && <div className="sr-row"><I.Branch size={14} /><span data-notr>{git.branch}</span>{git.ahead ? <em>{git.ahead} commit chưa push</em> : null}</div>}
          <p className="sr-note">Tự tắt sau {status.idleMin ?? 20} phút không dùng; file trong workspace vẫn được giữ.</p>
          {status.running && <button className="btn sr-btn" disabled={busy === "stop"} onClick={stop}>Dừng workspace</button>}
        </>}
      </section>
      <section>
        <h4>Ngữ cảnh</h4>
        {context}
      </section>
      <section className="sr-changes">
        <h4>Thay đổi<button className="icon-btn" onClick={() => run("status")} aria-label="Làm mới" title="Làm mới"><I.Retry size={13} /></button></h4>
        {sid === null || !status?.available ? <p className="sr-note">Chưa có workspace cho phiên này.</p>
          : !git ? <p className="sr-note">Đang tải…</p>
          : !git.git ? <><p className="sr-note">Thư mục chưa dùng git.</p><button className="btn sr-btn" disabled={!!busy} onClick={() => run("init", {}, "Đã khởi tạo git")}>Khởi tạo git</button></>
          : <>
            {files.length === 0 ? <p className="sr-note">Không có thay đổi chưa commit.</p> : (
              <div className="sr-files">
                {files.map((f) => (
                  <button key={f.path} className="sr-file" onClick={() => showFile(f.path, true)} title={f.path}>
                    <span className={`sr-st s-${f.status}`}>{f.status}</span><span className="cv-ell" data-notr>{f.path}</span>
                    <span className="ag-diff"><b>+{f.add}</b><i>−{f.del}</i></span>
                  </button>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="sr-commit">
                <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) run("commit", { message: msg }, "Đã commit"); }} placeholder="Nội dung commit" />
                <button className="btn dark" disabled={!msg.trim() || !!busy} onClick={() => run("commit", { message: msg }, "Đã commit")}>Commit</button>
              </div>
            )}
            {git.repo && (
              <div className="sr-acts">
                <button className="btn" disabled={!!busy} onClick={() => run("push", {}, "Đã push lên GitHub")}>{busy === "push" ? "Đang push…" : `Push${git.ahead ? ` (${git.ahead})` : ""}`}</button>
                <button className="btn" disabled={!!busy} onClick={() => run("pull", {}, "Đã cập nhật từ GitHub")}>Pull</button>
                <button className="btn" disabled={!!busy} onClick={() => { const b = prompt("Tên nhánh mới", `synchro/${new Date().toISOString().slice(0, 10)}`); if (b) run("branch", { name: b }, `Đã chuyển sang nhánh ${b}`); }}>Nhánh mới</button>
                <button className="btn" disabled={!!busy} onClick={() => { const t = prompt("Tiêu đề pull request", ""); if (t !== null) run("pr", { title: t }); }}>Tạo PR</button>
              </div>
            )}
          </>}
      </section>
    </aside>
  );
}
