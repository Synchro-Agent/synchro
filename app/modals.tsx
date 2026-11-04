"use client";

import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { UsageIcon } from "./usageui";
import { lazyView } from "./lazy";
const SettingsBody = lazyView(() => import("./settings").then((m) => m.SettingsBody));
import { usePref, useApp } from "./store";
import { tr, type Lang } from "./i18n";
import { createPortal } from "react-dom";
import { Boundary } from "./ui";

export function Confirm({ title, text, ok, onCancel, onOk, children }: { title: string; text: string; ok: string; onCancel: () => void; onOk: () => void; children?: React.ReactNode }) {
  return (
    <div className="overlay cf-top" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal sm" style={{ width: 420 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>{title}</h2>
        <p style={{ margin: "0 0 20px", fontSize: 14 }}>{text}</p>
        {children}
        <div className="modal-foot"><button className="btn" onClick={onCancel}>Hủy</button><button className="btn danger" onClick={onOk}>{ok}</button></div>
      </div>
    </div>
  );
}

export function LangModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [lang, setLang] = usePref<Lang>("uilang", "vi");
  const [, setVlang] = usePref("vlang", "Vietnamese");
  // [mã, tên, tên tiếng Anh, chữ đại diện, mã vùng]
  const LANGS: [Lang, string, string, string, string][] = [["vi", "Tiếng Việt", "Vietnamese", "Vi", "VI-VN"], ["en", "English", "English (US)", "En", "EN-US"]];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sy-modal sy-lang">
        <div className="sy-mh">
          <h2>Chọn ngôn ngữ của bạn</h2>
          <button className="icon-btn sy-x" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button>
        </div>
        <div className="sy-mb">
          <label className="sy-search"><I.Search size={15} /><input autoFocus placeholder="Tìm ngôn ngữ" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="sy-langs" data-notr>
            {LANGS.filter(([, n, e]) => (n + e).toLowerCase().includes(q.toLowerCase())).map(([k, n, e, g, code]) => (
              <button key={k} className={lang === k ? "on" : ""} aria-pressed={lang === k} onClick={() => { setLang(k); setVlang(k === "en" ? "English" : "Vietnamese"); onClose(); }}>
                <span className="g"><span>{g}</span></span>
                <span><b>{n}</b><em>{code} · {e}</em></span>
                {lang === k && <span className="ck"><I.Check size={13} /></span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectModal({ onClose, onCreate, init, title = "Tạo dự án", ok = "Tạo dự án" }: { onClose: () => void; onCreate: (n: string, d: string) => void; init?: { name: string; desc: string }; title?: string; ok?: string }) {
  const [n, setN] = useState(init?.name ?? "");
  const [d, setD] = useState(init?.desc ?? "");
  const go = () => n.trim() && onCreate(n.trim(), d.trim());
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sy-modal" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }}>
        <div className="sy-mh">
          <h2>{title}</h2>
          <button className="icon-btn sy-x" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button>
        </div>
        <div className="sy-mb">
          <div className="sy-fieldrow">
            <div>
              <label htmlFor="sy-pj-name">Tên dự án</label>
              <small>Tên ngắn để tìm lại dự án ở thanh bên và trang Dự án.</small>
              <input id="sy-pj-name" className="sy-input" autoFocus placeholder="Ví dụ: Ra mắt Synchro bản di động" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} />
            </div>
          </div>
          <div className="sy-fieldrow">
            <div>
              <label htmlFor="sy-pj-desc">Mục tiêu và bối cảnh</label>
              <small>Synchro đọc phần này trước mỗi đoạn chat trong dự án.</small>
              <textarea id="sy-pj-desc" className="sy-input" rows={4} placeholder="Dự án nhằm đạt điều gì, cho ai, đang ở giai đoạn nào…" value={d} onChange={(e) => setD(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="sy-mf">
          <span className="sy-kbd" data-notr>⌘ ⏎</span>
          <div>
            <button className="btn" onClick={onClose}>Hủy</button>
            <button className="btn dark" disabled={!n.trim()} style={!n.trim() ? { opacity: 0.45 } : undefined} onClick={go}>{ok}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function UpgradeModal({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const plans = [
    ["Free", "$0", "Trò chuyện trên web, iOS, Android và máy tính", "Gói hiện tại"],
    ["Pro", "$17", "Nhiều lượt dùng hơn, Synchro Code, Projects, nghiên cứu", "Nâng cấp lên Pro"],
    ["Max", "$100", "Gấp 5–20 lần Pro, truy cập sớm tính năng mới", "Nâng cấp lên Max"],
  ];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm" style={{ width: 760 }}>
        <button className="icon-btn" onClick={onClose} style={{ position: "absolute", top: 14, right: 14 }}><I.X size={16} /></button>
        <h2 style={{ fontSize: 18 }}>Chọn gói phù hợp với bạn</h2>
        <div className="plans">
          {plans.map(([n, p, d, b], i) => (
            <div key={n} className={`plan ${i === 1 ? "hl" : ""}`}>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 400, letterSpacing: "-.03em" }}>{n}</b>
              <div><span style={{ fontSize: 28 }}>{p}</span><span className="muted"> / tháng</span></div>
              <p className="muted" style={{ fontSize: 13, margin: 0, minHeight: 58 }}>{d}</p>
              <button className={`btn ${i ? "dark" : ""}`} disabled={!i} style={!i ? { opacity: 0.5 } : undefined} onClick={() => { say("Đây là bản demo, chưa có thanh toán thật"); onClose(); }}>{b}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UploadModal({ onClose, onFiles, onConverted }: { onClose: () => void; onFiles: (f: File[]) => void; onConverted?: (f: File, md: string) => void; say?: (m: string) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const mdIn = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  const convert = async (f: File) => {
    setErr(""); setBusy(f.name);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/markitdown", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Không chuyển được tệp");
      const md = String(j.markdown || "");
      const out = new File([md], f.name.replace(/\.[^.]+$/, "") + ".md", { type: "text/markdown" });
      setBusy("");
      if (onConverted) onConverted(out, md); else onFiles([out]);
      return;
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sy-modal upl">
        <div className="sy-mh"><h2>Tải lên hoặc thêm tệp</h2><button className="icon-btn sy-x" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button></div>
        <div className={`upl-zone ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onFiles(f); }}>
          <b>Kéo tệp hoặc ảnh vào đây</b>
          <span>Tài liệu, hình ảnh, bảng tính và tệp mã</span>
          <input ref={inp} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }} />
          <input ref={mdIn} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) convert(f); }} />
          <button className="btn" onClick={() => inp.current?.click()} disabled={!!busy}>Chọn tệp</button>
          <button className="btn upl-md" onClick={() => mdIn.current?.click()} disabled={!!busy}>
            {busy ? <><i className="upl-spin" />Đang chuyển {busy}… (tệp quét sẽ qua OCR, có thể mất ~1 phút)</> : "Chọn tệp và chuyển thành markdown"}
          </button>
          {err && <em className="upl-err">{err}</em>}
          <small className="upl-hint">Hỗ trợ PDF, Word, Excel, PowerPoint, HTML, CSV, JSON, ảnh, âm thanh, EPUB, ZIP… (MarkItDown)</small>
        </div>
      </div>
    </div>, document.body);
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [["Đoạn chat mới", "⇧⌘O"], ["Tìm kiếm đoạn chat", "⌘K"], ["Mở/đóng thanh bên", "⌘."], ["Mở cài đặt", "⇧⌘,"], ["Phím tắt", "⌘/"], ["Xuống dòng trong tin nhắn", "⇧⏎"], ["Đóng hộp thoại / menu", "Esc"]];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sy-modal sy-keys">
        <div className="sy-mh"><h2>Phím tắt</h2><button className="icon-btn sy-x" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button></div>
        <div className="sy-mb">{rows.map(([a, k]) => <div key={a} className="sy-krow"><span>{a}</span><kbd className="kbd" data-notr>{k}</kbd></div>)}</div>
      </div>
    </div>
  );
}

export function Settings({ onClose, theme, setTheme, initial = "General" }: { onClose: () => void; theme: string; setTheme: (t: string) => void; initial?: string }) {
  const [tab, setTab] = useState(initial);
  const [q, setQ] = useState("");
  const me = useApp().me;
  const admin = me?.isAdmin;
  const feat = me?.perms.features;
  const items: [string, React.ReactNode][] = [
    ["General", <I.SetGeneral key="g" />], ...(admin ? [["Administrator", <I.SetAdmin key="ad" />] as [string, React.ReactNode], ["Health", <I.Alert key="hl" size={18} />] as [string, React.ReactNode]] : []), ["Account", <I.SetAccount key="a" />], ["Privacy", <I.SetPrivacy key="p" />],
    ["Capabilities", <I.SetCapabilities key="c" />], ["Usage", <UsageIcon key="u" size={18} />], ["Brain", <I.Brain key="m" size={18} />],
    ...(feat?.code !== false ? [["Synchro Code", <I.Code key="cc" />] as [string, React.ReactNode]] : []),
    ["Providers", <I.SetChip key="pv" />],
  ];
  const custom: [string, React.ReactNode][] = [
    ...(feat?.skills !== false ? [["Skill Hub", <I.Plugins key="pl" />] as [string, React.ReactNode]] : []),
    ...(feat?.connectors !== false ? [["Connectors", <I.Connectors key="cn" />] as [string, React.ReactNode]] : []),
  ];
  // Tìm theo cả tên gốc (tiếng Anh) lẫn tên đang hiện ở giao diện tiếng Việt.
  const f = (l: [string, React.ReactNode][]) => l.filter(([n]) => [n, tr(n, "vi")].some((x) => x.toLowerCase().includes(q.trim().toLowerCase())));
  const item = (n: string, ic: React.ReactNode) => <button key={n} className={`s-item ${tab === n ? "on" : ""}`} aria-current={tab === n ? "page" : undefined} onClick={() => setTab(n)} title={n}>{ic}<span className="s-lbl">{n}</span></button>;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings sy-settings">
        <div className="s-nav">
          <div className="sy-snav-h"><b>Settings</b></div>
          <div className="s-search"><I.Search size={15} /><input placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="s-group">Settings</div>
          {f(items).map(([n, ic]) => item(n, ic))}
          <div className="s-group">Customize</div>
          {f(custom).map(([n, ic]) => item(n, ic))}
        </div>
        <div className="s-body" key={tab}>
          <header className="sy-sbody-h"><h2>{tab}</h2><button className="icon-btn close" onClick={onClose} aria-label="Đóng"><I.X size={16} /></button></header>
          <Boundary resetKey={tab}><SettingsBody tab={tab} theme={theme} setTheme={setTheme} go={setTab} /></Boundary>
        </div>
      </div>
    </div>
  );
}

