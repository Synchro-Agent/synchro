"use client";
// Các khung bên phải của Synchro Code: terminal (PTY thật trong workspace), trình duyệt (Chromium của workspace,
// người dùng và agent cùng điều khiển), file (cây thư mục + Monaco) và session rail (môi trường, ngữ cảnh, thay đổi git).
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@xterm/xterm/css/xterm.css";
import * as I from "./icons";
import { gitOp, isLocalUrl, useCodeUi, wsOp, type GitState, type PrInfo, type WsStatus } from "./wsclient";

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

type BTab = { id: string; title: string; url: string };
type Viewport = "responsive" | "desktop" | "tablet" | "mobile";
const VIEWPORTS: { k: Viewport; label: string; w?: number; h?: number; mobile?: boolean }[] = [
  { k: "responsive", label: "Tự co giãn" }, { k: "desktop", label: "Máy tính · 1280×800", w: 1280, h: 800 },
  { k: "tablet", label: "Máy tính bảng · 768×1024", w: 768, h: 1024, mobile: true }, { k: "mobile", label: "Điện thoại · 390×844", w: 390, h: 844, mobile: true },
];
const blankUrl = (u: string) => !u || u === "about:blank" || u.startsWith("chrome://newtab");
const hostOf = (u: string) => { try { const x = new URL(u); return x.host || u; } catch { return u; } };

// Trình duyệt của workspace (giống trình duyệt tích hợp của Claude): hàng tab, thanh địa chỉ, trang tab mới (gợi ý server đang chạy
// ở Synchro Code), menu ⋮ (mở bằng trình duyệt của bạn, sao chép URL, lưu ảnh chụp, mở file HTML, khung nhìn, xóa dữ liệu) và nút phóng to.
// Dùng ở Synchro Code (sid: phiên code) và ở khung chat / trang Trình duyệt (ticket: vé của /api/browser). Khi Synchro đang tự thao tác:
// dải "Synchro đang điều khiển" (nút Dừng), chấm sáng ở chỗ vừa bấm; hộp thoại của trang hiện cho người dùng tự chọn khi Synchro không thao tác.
type AgentAct = { kind: string; label?: string; x?: number; y?: number; at: number };
type PageDialog = { type: string; message: string; def: string };
export function BrowserPane({ sid, ticket, visible, say, onClose, onExpand, expanded, autoOpen, setAutoOpen, onStop, busy }: { sid?: number; ticket?: () => Promise<string>; visible: boolean; say: Say; onClose?: () => void; onExpand?: () => void; expanded?: boolean; autoOpen?: boolean; setAutoOpen?: (v: boolean) => void; onStop?: () => void; busy?: boolean }) {
  const [url, setUrl] = useState("");
  const [addr, setAddr] = useState("");
  const [focus, setFocus] = useState(false);
  const [tabs, setTabs] = useState<BTab[]>([]);
  const [active, setActive] = useState("");
  const [st, setSt] = useState<"connecting" | "open" | "closed">("connecting");
  const [loading, setLoading] = useState(false);
  const [blank, setBlank] = useState(true);
  const [ports, setPorts] = useState<number[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [vp, setVp] = useState<Viewport>("responsive");
  const [navd, setNavd] = useState(false); // đã nhận địa chỉ thật của tab (tránh coi nhầm là tab mới lúc vừa kết nối)
  const [agentOn, setAgentOn] = useState(false);
  const [act, setAct] = useState<AgentAct | null>(null);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [promptText, setPromptText] = useState("");
  const idleT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ws = useRef<WebSocket | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const addrIn = useRef<HTMLInputElement>(null);
  const htmlIn = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const lastMove = useRef(0);
  const vpRef = useRef(vp); vpRef.current = vp;
  const send = (o: Record<string, unknown>) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(o)); };
  const sendSize = (to?: WebSocket) => {
    const out = (o: Record<string, unknown>) => (to ? to.readyState === 1 && to.send(JSON.stringify(o)) : send(o));
    const v = VIEWPORTS.find((x) => x.k === vpRef.current);
    if (v?.w) return out({ t: "size", w: v.w, h: v.h, mobile: v.mobile });
    const r = view.current?.getBoundingClientRect();
    if (r && r.width > 50) out({ t: "size", w: Math.round(r.width), h: Math.round(r.height) });
  };
  // Mỗi lần kết nối có một số thứ tự: lần kết nối cũ (vé về muộn, hiệu ứng chạy hai lần) tự hủy, không để lại kết nối
  // "mồ côi" vẫn đẩy hình khổ mặc định vào khung.
  const gen = useRef(0);

  const connect = useCallback(async () => {
    const my = ++gen.current;
    ws.current?.close();
    ws.current = null;
    setSt("connecting");
    setNavd(false);
    try {
      const u = ticket ? await ticket() : (await wsOp<{ url: string }>("ticket", sid!, { kind: "screen" })).url;
      if (my !== gen.current) return;
      const s = new WebSocket(u);
      ws.current = s;
      s.onopen = () => { if (ws.current !== s) return s.close(); setSt("open"); sendSize(s); };
      s.onmessage = (e) => {
        if (ws.current !== s) return;
        let j: { t: string; data?: string; url?: string; title?: string; on?: boolean; error?: string; list?: unknown; active?: string };
        try { j = JSON.parse(String(e.data)); } catch { return; }
        if (j.t === "frame" && img.current) { img.current.src = `data:image/jpeg;base64,${j.data}`; setBlank(false); }
        else if (j.t === "nav") { if (j.url !== undefined) { setUrl(j.url); setNavd(true); if (!editing.current) setAddr(blankUrl(j.url) ? "" : j.url); } }
        else if (j.t === "tabs") {
          // Giữ thứ tự tab đã thấy; tab mới thêm vào bên phải (Chromium trả tab mới nhất lên đầu).
          const list = j.list as BTab[];
          setTabs((old) => [...old.filter((o) => list.some((x) => x.id === o.id)).map((o) => list.find((x) => x.id === o.id)!), ...list.filter((x) => !old.some((o) => o.id === x.id)).reverse()]);
          setActive(j.active ?? "");
        }
        else if (j.t === "ports") setPorts(j.list as number[]);
        else if (j.t === "loading") setLoading(!!j.on);
        else if (j.t === "cleared") say("Đã xóa dữ liệu duyệt web");
        else if (j.t === "error" && j.error) say(j.error);
        else if (j.t === "agent") {
          const a = j as unknown as AgentAct & { kind: string };
          if (a.kind === "start") { clearTimeout(idleT.current); setAgentOn(true); }
          else if (a.kind === "idle") { clearTimeout(idleT.current); idleT.current = setTimeout(() => setAgentOn(false), 1500); }
          else { setAgentOn(true); setAct({ kind: a.kind, label: a.label, x: a.x, y: a.y, at: Date.now() }); }
        }
        else if (j.t === "dialog") {
          const d = j as unknown as PageDialog & { closed?: boolean };
          if (d.closed) setDialog(null); else { setDialog({ type: d.type, message: d.message, def: d.def }); setPromptText(d.def ?? ""); }
        }
        else if (j.t === "download") {
          const d = j as unknown as { name: string; state: string };
          say(d.state === "inProgress" ? `Đang tải về: ${d.name}` : d.state === "completed" ? `Đã tải về ${d.name} (thư mục Downloads của workspace)` : `Không tải được ${d.name}`);
        }
      };
      s.onclose = () => { if (ws.current === s) setSt("closed"); };
    } catch (e) { if (my === gen.current) { say((e as Error).message); setSt("closed"); } }
  }, [sid, ticket, say]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chỉ nhận hình khi khung đang hiện (tiết kiệm băng thông); ẩn thì ngắt.
  useEffect(() => {
    if (!visible) { gen.current++; const s = ws.current; ws.current = null; s?.close(); return; }
    connect();
    return () => { gen.current++; const s = ws.current; ws.current = null; s?.close(); };
  }, [visible, connect]);

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (vpRef.current === "responsive") sendSize(); }, 150); });
    ro.observe(el);
    const wheel = (e: WheelEvent) => { if (vpRef.current !== "responsive" && e.shiftKey) return; e.preventDefault(); const p = pt(e.clientX, e.clientY); send({ t: "wheel", ...p, dx: e.deltaX, dy: e.deltaY }); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { sendSize(); }, [vp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trang tab mới: gợi ý các server đang chạy trong workspace, cập nhật vài giây một lần.
  const isNew = st === "open" && navd && blankUrl(url);
  useEffect(() => {
    if (!isNew || !visible || sid == null) return;
    send({ t: "ports" });
    const i = setInterval(() => send({ t: "ports" }), 4000);
    setTimeout(() => addrIn.current?.focus(), 50);
    return () => clearInterval(i);
  }, [isNew, visible, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);

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
  const go = (to: string) => { editing.current = false; if (to.trim()) { send({ t: "go", url: to.trim() }); setAddr(to.trim()); } addrIn.current?.blur(); view.current?.focus(); };
  const local = blankUrl(url) || isLocalUrl(url) || url.startsWith("data:");
  const shot = () => {
    const src = img.current?.src;
    if (!src || blank) return say("Chưa có hình để lưu");
    const a = document.createElement("a");
    a.href = src; a.download = `synchro-${hostOf(url).replace(/[^\w.-]+/g, "_") || "trang"}-${Date.now()}.jpg`; a.click();
  };
  const openHtml = async (f?: File | null) => { if (!f) return; send({ t: "html", html: await f.text() }); say(`Đã mở ${f.name}`); };
  const item = (label: string, fn: () => void, o: { disabled?: boolean; check?: boolean; danger?: boolean; icon?: React.ReactNode } = {}) => (
    <button className={`menu-item bp-mi ${o.danger ? "del" : ""}`} disabled={o.disabled} onClick={() => { setMenu(false); fn(); }}>{o.icon}<span>{label}</span>{o.check && <span className="ck"><I.Check size={14} /></span>}</button>
  );
  const fixed = VIEWPORTS.find((x) => x.k === vp)?.w;

  return (
    <div className="bp">
      <div className="bp-tabs">
        <div className="bp-tablist">
          {tabs.map((t) => (
            <div key={t.id} className={`bp-tab ${t.id === active ? "on" : ""}`} title={t.url}>
              <button onClick={() => send({ t: "tab", id: t.id })}><I.Globe size={13} /><span className="cv-ell" data-notr>{blankUrl(t.url) ? "Tab mới" : t.title || hostOf(t.url)}</span></button>
              <button className="tp-x" onClick={() => send({ t: "closetab", id: t.id })} aria-label="Đóng tab"><I.X size={11} /></button>
            </div>
          ))}
          <button className="icon-btn bp-new" onClick={() => send({ t: "newtab" })} aria-label="Tab mới" title="Tab mới"><I.Plus size={15} /></button>
        </div>
        <div className="bp-acts" ref={menuRef}>
          <button className={`icon-btn ${menu ? "on" : ""}`} onClick={() => setMenu(!menu)} aria-label="Tùy chọn trình duyệt" title="Tùy chọn"><I.Dots size={16} /></button>
          {onExpand && <button className="icon-btn" onClick={onExpand} aria-label={expanded ? "Thu nhỏ" : "Phóng to"} title={expanded ? "Thu nhỏ" : "Phóng to"}>{expanded ? <I.Collapse size={15} /> : <I.Expand size={15} />}</button>}
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Đóng trình duyệt" title="Đóng"><I.X size={15} /></button>}
          {menu && (
            <div className="menu bp-menu">
              {item("Mở trong trình duyệt của bạn", () => window.open(url, "_blank", "noopener"), { disabled: local, icon: <I.External size={15} /> })}
              {item("Sao chép URL", () => { navigator.clipboard?.writeText(url); say("Đã sao chép URL"); }, { disabled: blankUrl(url), icon: <I.Copy size={15} /> })}
              {item("Lưu ảnh chụp màn hình", shot, { icon: <I.Camera size={15} /> })}
              {item("Mở file HTML…", () => htmlIn.current?.click(), { icon: <I.File size={15} /> })}
              <hr />
              <div className="cv-mh">Khung nhìn</div>
              {VIEWPORTS.map((v) => <div key={v.k}>{item(v.label, () => setVp(v.k), { check: vp === v.k })}</div>)}
              <hr />
              {setAutoOpen && <>{item(sid == null ? "Tự mở khi Synchro dùng trình duyệt" : "Tự mở trình duyệt khi agent dùng", () => setAutoOpen(!autoOpen), { check: autoOpen })}<hr /></>}
              {item("Xóa dữ liệu duyệt web", () => send({ t: "clear" }), { danger: true })}
            </div>
          )}
          <input ref={htmlIn} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { openHtml(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
      <form className="bp-bar" onSubmit={(e) => { e.preventDefault(); go(addr); }}>
        <button type="button" className="icon-btn" onClick={() => send({ t: "back" })} aria-label="Quay lại"><I.Back size={15} /></button>
        <button type="button" className="icon-btn" onClick={() => send({ t: "forward" })} aria-label="Tiến tới"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><I.Back size={15} /></span></button>
        <button type="button" className="icon-btn" onClick={() => send({ t: "reload" })} aria-label="Tải lại">{loading ? <span className="ag-spin" /> : <I.Retry size={15} />}</button>
        <input ref={addrIn} className={focus || !addr ? "" : "rest"} value={focus ? addr : addr ? hostOf(addr) + (() => { try { const x = new URL(addr); return x.pathname === "/" ? "" : x.pathname; } catch { return ""; } })() : ""}
          placeholder="Nhập địa chỉ" spellCheck={false} data-notr
          onFocus={(e) => { editing.current = true; setFocus(true); setTimeout(() => e.target.select(), 0); }}
          onBlur={() => { editing.current = false; setFocus(false); }} onChange={(e) => setAddr(e.target.value)} />
        <button type="button" className="icon-btn" disabled={local} onClick={() => window.open(url, "_blank", "noopener")} title={local ? "Địa chỉ localhost chỉ có trong workspace" : "Mở trong trình duyệt của bạn"} aria-label="Mở trong trình duyệt của bạn"><I.External size={15} /></button>
      </form>
      <div ref={view} className={`bp-view ${fixed ? "fixed" : ""}`} tabIndex={0} onMouseDown={mouse("mousePressed")} onMouseUp={mouse("mouseReleased")} onMouseMove={mouse("mouseMoved")} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={key("down")} onKeyUp={key("up")} onPaste={(e) => { e.preventDefault(); send({ t: "text", text: e.clipboardData.getData("text") }); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} alt="" draggable={false} style={{ visibility: blank || isNew ? "hidden" : "visible", width: fixed ? `min(100%, ${fixed}px)` : undefined }} />
        {act && Date.now() - act.at < 900 && act.x != null && img.current?.naturalWidth ? (() => {
          const im = img.current!.getBoundingClientRect(), vr = view.current!.getBoundingClientRect();
          return <span key={act.at} className="bp-ripple" style={{ left: im.left - vr.left + (act.x! / img.current!.naturalWidth) * im.width, top: im.top - vr.top + (act.y! / img.current!.naturalHeight) * im.height }} />;
        })() : null}
        {(agentOn || busy) && (
          <div className="bp-agent" onMouseDown={(e) => e.stopPropagation()}>
            <span className="bp-agent-dot" />
            <span className="bp-agent-t"><b>Synchro đang điều khiển trình duyệt</b>{act?.label ? <span data-notr>{act.kind === "type" ? `Gõ “${act.label}”` : act.kind === "navigate" ? `Mở ${hostOf(act.label)}` : act.kind === "key" ? `Nhấn ${act.label}` : act.kind === "select" ? `Chọn “${act.label}”` : `${act.kind === "hover" ? "Rê chuột" : act.kind === "drag" ? "Kéo thả" : act.kind === "upload" ? "Tải tệp" : "Bấm"} ${act.label}`}</span> : null}</span>
            {onStop && <button className="btn sm" onClick={onStop}><I.Stop size={12} />Dừng</button>}
          </div>
        )}
        {dialog && (
          <div className="bp-dialog-w" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="bp-dialog" role="alertdialog" aria-label="Hộp thoại của trang">
              <span className="bp-dialog-h">{hostOf(url)} cho biết</span>
              <p data-notr>{dialog.message}</p>
              {dialog.type === "prompt" && <input className="field" autoFocus value={promptText} onChange={(e) => setPromptText(e.target.value)} />}
              <div className="bp-dialog-a">
                {dialog.type !== "alert" && <button className="btn sm" onClick={() => { send({ t: "dialog", accept: false }); setDialog(null); }}>Hủy</button>}
                <button className="btn sm dark" autoFocus={dialog.type !== "prompt"} onClick={() => { send({ t: "dialog", accept: true, text: promptText }); setDialog(null); }}>OK</button>
              </div>
            </div>
          </div>
        )}
        {isNew && sid == null && (
          <div className="bp-newtab" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bp-nt-in">
              <p className="bp-nt-note txt">Gõ địa chỉ hoặc từ khóa ở thanh trên (từ khóa sẽ tìm trên Google). Hoặc nhờ Synchro trong khung chat, ví dụ “mở trang … rồi điền biểu mẫu giúp mình”: Synchro tự thao tác ngay tại đây, bạn xem và giành lại quyền điều khiển bất cứ lúc nào.</p>
              {[["google.com", "Google"], ["youtube.com", "YouTube"], ["vi.wikipedia.org", "Wikipedia"]].map(([h, n]) => (
                <div key={h} className="bp-nt-row"><div><span>{n}</span><code data-notr>{h}</code></div><button className="btn" onClick={() => go(`https://${h}`)}>Mở</button></div>
              ))}
            </div>
          </div>
        )}
        {isNew && sid != null && (
          <div className="bp-newtab" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bp-nt-in">
              {ports === null ? <p className="bp-nt-note"><span className="ag-spin" />Đang tìm server trong workspace…</p>
                : ports.length ? <>
                  <p className="bp-nt-note">Đã tìm thấy server đang chạy trong workspace.</p>
                  {ports.map((p) => (
                    <div key={p} className="bp-nt-row"><div><span>localhost · cổng {p}</span><code data-notr>http://localhost:{p}</code></div><button className="btn" onClick={() => go(`http://localhost:${p}`)}>Mở</button></div>
                  ))}
                </> : <p className="bp-nt-note txt">Chưa có server nào chạy trong workspace. Nhập địa chỉ ở trên, hoặc nhờ agent chạy dự án (vd. <code>npm run dev</code>).</p>}
            </div>
          </div>
        )}
        {blank && !isNew && st !== "closed" && <div className="bp-empty"><span className="ag-spin" />{sid == null ? "Đang bật trình duyệt…" : "Đang bật trình duyệt của workspace…"}</div>}
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
// Các thẻ thu gọn được, giống Claude: Môi trường, Ngữ cảnh, Thay đổi.
function Sec({ id, title, open, onToggle, right, children }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="sr-sec">
      <div className="sr-sec-h">
        <button onClick={() => onToggle(id)}>{title}<span className={`sr-chev ${open ? "" : "off"}`}><I.Chevron size={13} /></span></button>
        {right}
      </div>
      {open && <div className="sr-sec-b">{children}</div>}
    </section>
  );
}

// Nằm trong cột chat, ngay dưới hàng nút (giống Claude); đóng bằng nút session rail phía trên.
export function SessionRail({ sid, status, git, onGit, say, context }: { sid: number | null; status: WsStatus | null; git?: GitState; onGit: (g: GitState) => void; say: Say; context: React.ReactNode; onClose?: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [list, setList] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = (id: string) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const showFile = useCodeUi((s) => s.showFile);
  const run = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    if (sid === null) return;
    setBusy(action);
    try {
      const g = await gitOp(sid, action, body);
      onGit(g);
      if (action === "commit") setMsg("");
      if (g.git && g.pr?.created !== false && g.pr) { say(`Đã tạo pull request #${g.pr.number}`); window.open(g.pr.url, "_blank", "noopener"); loadPrs(); }
      else if (g.git && g.pr) { say(`Đã push · pull request #${g.pr.number}`); loadPrs(); }
      else if (ok) say(ok);
    } catch (e) { say((e as Error).message); }
    setBusy("");
  };
  const stop = async () => { setBusy("stop"); try { await wsOp("stop", null); say("Đã dừng workspace (file vẫn được giữ)"); } catch (e) { say((e as Error).message); } setBusy(""); };
  // Pull request của phiên: trạng thái và việc Synchro tự sửa (cập nhật mỗi 15 giây khi khung đang mở).
  const [prs, setPrs] = useState<PrInfo[]>([]);
  const loadPrs = useCallback(() => { if (sid !== null && status?.available) wsOp<{ prs: PrInfo[] }>("git", sid, { action: "prs" }).then((j) => setPrs(j.prs ?? [])).catch(() => {}); }, [sid, status?.available]);
  useEffect(() => { loadPrs(); const t = setInterval(loadPrs, 15_000); return () => clearInterval(t); }, [loadPrs]);
  const prState = (p: PrInfo) => (p.busy ? "Synchro đang tự sửa" : p.state === "merged" ? "Đã gộp" : p.state === "closed" ? "Đã đóng" : "Đang mở");
  const files = git?.git ? git.files : [];
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  const ready = sid !== null && !!status?.available;
  return (
    <aside className="sr">
      <Sec id="env" title="Môi trường" open={!closed.includes("env")} onToggle={toggle}>
        {!status ? <p className="sr-note">Đang kiểm tra…</p> : !status.available ? <p className="sr-note">{status.reason}</p> : <>
          <div className="sr-row" title={status.running ? `Đang chạy · tự tắt sau ${status.idleMin ?? 20} phút không dùng, file vẫn được giữ` : "Đang tắt · tự bật khi cần"}><I.Monitor size={16} /><span>Workspace Linux</span><i className={`sr-dot ${status.running ? "on" : ""}`} />
            {status.running ? <button className="sr-link" disabled={busy === "stop"} onClick={stop}>Dừng</button> : <em>đang tắt</em>}</div>
          <div className="sr-row"><I.Folder size={16} /><span className="cv-ell" data-notr>{git?.git && git.repo ? git.repo.split("/")[1] : "work"}<i className="sr-dim"> · {sid !== null ? `s${sid}` : "chưa có phiên"}</i></span></div>
          {git?.git && <div className="sr-row"><I.Branch size={16} /><span className="cv-ell" data-notr>{git.branch}</span>{git.ahead ? <em>{git.ahead} chưa push</em> : null}</div>}
          {git?.git && git.repo && <div className="sr-row"><I.GitHub size={15} /><a className="cv-ell" href={`https://github.com/${git.repo}`} target="_blank" rel="noreferrer" data-notr>{git.repo}</a></div>}
        </>}
      </Sec>
      {prs.length > 0 && (
        <Sec id="pr" title="Pull request" open={!closed.includes("pr")} onToggle={toggle}>
          {prs.map((p) => (
            <div key={p.repo + p.number} className="sr-pr">
              <div className="sr-row">{p.busy ? <span className="wl-spin" /> : <I.Branch size={16} />}
                <a className="cv-ell" href={p.url ?? undefined} target="_blank" rel="noreferrer"><span data-notr>#{p.number}</span> · {prState(p)}</a>
              </div>
              {p.note && <p className="sr-note sr-pr-note">{p.note}</p>}
            </div>
          ))}
        </Sec>
      )}
      <Sec id="ctx" title="Ngữ cảnh" open={!closed.includes("ctx")} onToggle={toggle}>{context}</Sec>
      <Sec id="chg" title="Thay đổi" open={!closed.includes("chg")} onToggle={toggle}
        right={ready && git?.git ? <button className="icon-btn sr-mini" onClick={() => run("status")} aria-label="Làm mới" title="Làm mới"><I.Retry size={13} /></button> : undefined}>
        {!ready ? <p className="sr-note">Chưa có workspace cho phiên này.</p>
          : !git ? <p className="sr-note">Đang tải…</p>
          : !git.git ? <div className="sr-row"><I.Branch size={16} /><span className="sr-dim">Chưa dùng git</span><button className="ctxp-btn" disabled={!!busy} onClick={() => run("init", {}, "Đã khởi tạo git")}>Khởi tạo git</button></div>
          : <>
            <div className="sr-row">
              <button className="sr-sum" onClick={() => setList(!list)} disabled={!files.length} title={files.length ? "Xem các file thay đổi" : undefined}>
                <I.File size={16} />{files.length ? <span className="ag-diff"><b>+{add}</b><i>−{del}</i></span> : <span className="sr-dim">Không có thay đổi</span>}
              </button>
              {git.repo && <button className="ctxp-btn" disabled={!!busy} onClick={() => { const t = prompt("Tiêu đề pull request", ""); if (t !== null) run("pr", { title: t }); }}>Tạo PR</button>}
            </div>
            {list && files.length > 0 && (
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
                <button className="ctxp-btn" disabled={!msg.trim() || !!busy} onClick={() => run("commit", { message: msg }, "Đã commit")}>Commit</button>
              </div>
            )}
            {git.repo && (
              <div className="sr-acts">
                <button className="ctxp-btn" disabled={!!busy} onClick={() => run("push", {}, "Đã push lên GitHub")}>{busy === "push" ? "Đang push…" : `Push${git.ahead ? ` (${git.ahead})` : ""}`}</button>
                <button className="ctxp-btn" disabled={!!busy} onClick={() => run("pull", {}, "Đã cập nhật từ GitHub")}>Pull</button>
                <button className="ctxp-btn" disabled={!!busy} onClick={() => { const b = prompt("Tên nhánh mới", `synchro/${new Date().toISOString().slice(0, 10)}`); if (b) run("branch", { name: b }, `Đã chuyển sang nhánh ${b}`); }}>Nhánh mới</button>
              </div>
            )}
          </>}
      </Sec>
    </aside>
  );
}
