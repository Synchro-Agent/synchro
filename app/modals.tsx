"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { searchSettings } from "./settingsindex";
import * as I from "./icons";
import { UsageIcon } from "./usagering";
import { lazyView } from "./lazy";
import { SettingsSkeleton } from "./skeleton";
const SettingsBody = lazyView(() => import("./settings").then((m) => m.SettingsBody), <SettingsSkeleton />);
import { usePref, useApp } from "./store";
import { UPLOAD_ACCEPT } from "./fileproc/types";
import { tr, type Lang } from "./i18n";
import { createPortal } from "react-dom";
import { Boundary } from "./ui";

// Hộp xác nhận (Đăng xuất?, Xóa…?): tên và mô tả gắn thẳng vào hộp (alertdialog + aria-labelledby / describedby), trình đọc màn hình đọc
// "Đăng xuất?" cùng câu hỏi ngay khi hộp mở, không phụ thuộc lúc cơ chế hộp thoại chung (a11y.ts) kịp gắn tên.
// busy: đang chạy việc không thể bỏ giữa chừng (đẩy dữ liệu lên máy chủ trước khi xóa) — khóa nút Hủy và việc bấm ra nền để không đóng hộp giữa lúc chờ.
export function Confirm({ title, text, ok, onCancel, onOk, children, busy }: { title: string; text: string; ok: string; onCancel: () => void; onOk: () => void; children?: React.ReactNode; busy?: boolean }) {
  const id = useId();
  return (
    <div className="overlay cf-top" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="modal sm" style={{ width: 420, maxWidth: "calc(100vw - 32px)" }} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
        <h2 id={`${id}-t`} style={{ fontSize: 15, margin: "0 0 6px" }}>{title}</h2>
        <p id={`${id}-d`} style={{ margin: "0 0 20px", fontSize: "var(--fs-3)" }}>{text}</p>
        {children}
        <div className="modal-foot"><button className="btn" disabled={busy} onClick={onCancel}>Hủy</button><button className="btn danger" onClick={onOk}>{ok}</button></div>
      </div>
    </div>
  );
}

/**
 * Hộp xác nhận đăng xuất. "Xóa dữ liệu trên thiết bị này" (mặc định bật) xóa đoạn chat, dự án, phiên Code, bản nháp… của tài khoản khỏi
 * trình duyệt; đăng nhập lại thì tải về từ máy chủ. Trước khi xóa, đẩy hết phần chưa lên máy chủ (flush); còn phần chưa lên được (mất mạng)
 * thì báo và chờ bấm lần nữa, hoặc bỏ chọn để giữ lại. localOnly: số phiên Code chỉ lưu ở thiết bị này (chưa bật đồng bộ phiên).
 */
export function LogoutConfirm({ localOnly, flush, onCancel, onOk }: { localOnly: number; flush: () => Promise<number>; onCancel: () => void; onOk: (clear: boolean) => void }) {
  const [clear, setClear] = useState(true);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  // Hộp đã bị hủy/đóng/gỡ trong lúc chờ flush: việc đẩy dữ liệu vẫn chạy nốt, nhưng KHÔNG được đăng xuất/xóa sau khi nó xong.
  const dead = useRef(false);
  // Đặt lại khi gắn: StrictMode (dev) gắn–gỡ–gắn lại cùng ref, và Fade giữ nguyên hộp nếu mở lại trong lúc đang mờ đi.
  useEffect(() => { dead.current = false; return () => { dead.current = true; }; }, []);
  // Trong lúc bận thì nút Hủy và nền đã khóa (Confirm busy); chỉ chặn thêm trường hợp bị đóng từ ngoài.
  const cancel = () => { if (busy) return; dead.current = true; onCancel(); };
  const go = async () => {
    if (busy) return;
    if (!clear || left > 0) { onOk(clear); return; }
    dead.current = false;
    setBusy(true);
    const n = await flush().catch(() => 1);
    if (dead.current) return; // bị hủy/đóng giữa chừng: không xóa, không đăng xuất
    setBusy(false);
    if (n > 0) { setLeft(n); return; }
    onOk(true);
  };
  const note: React.CSSProperties = { margin: "-8px 0 14px 26px", fontSize: "var(--fs-2)", lineHeight: "19px" };
  return (
    <Confirm title="Đăng xuất?" text="Bạn có chắc chắn muốn đăng xuất không?" ok={busy ? "Đang lưu lên máy chủ…" : clear && left > 0 ? "Vẫn xóa và đăng xuất" : "Đăng xuất"} busy={busy} onCancel={cancel} onOk={() => void go()}>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 14px", fontSize: "var(--fs-3)" }}>
        <input type="checkbox" style={{ marginTop: 3, flex: "none" }} checked={clear} disabled={busy} onChange={(e) => { setClear(e.target.checked); setLeft(0); }} />
        <span>Xóa dữ liệu trên thiết bị này</span>
      </label>
      {!clear && <p style={note}>Dữ liệu của tài khoản này vẫn được giữ trên thiết bị cho lần đăng nhập sau.</p>}
      {clear && <p style={note}>Đoạn chat, dự án và bản nháp của tài khoản này được xóa khỏi trình duyệt. Đăng nhập lại thì tải về từ máy chủ.</p>}
      {clear && localOnly > 0 && <p style={note}>Phiên Code chỉ lưu trên thiết bị này (chưa bật Đồng bộ phiên ở Cài đặt → Synchro Code) cũng sẽ bị xóa.</p>}
      {clear && left > 0 && <p role="alert" style={{ ...note, color: "var(--danger,#c4453c)" }}>Một số đoạn chat hoặc phiên Code chưa lên được máy chủ (mất mạng hoặc máy chủ lỗi). Xóa bây giờ sẽ mất phần đó. Bỏ chọn ô trên để giữ lại trên thiết bị này.</p>}
    </Confirm>
  );
}

// Hỏi một dòng chữ, thay cho hộp hỏi có sẵn của trình duyệt: hộp đó không theo giao diện, không dịch được nút và chặn cả trang. Gắn vào <body> vì nơi gọi có thể nằm trong khung cuộn.
export function AskText({ title, init = "", ok, need, onCancel, onOk }: { title: string; init?: string; ok: string; need?: boolean; onCancel: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState(init);
  const go = () => { const t = v.trim(); if (t || !need) onOk(t); };
  return createPortal(
    <div className="overlay cf-top" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal sm" style={{ width: 420 }} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{title}</h2>
        <input className="field" autoFocus value={v} aria-label={title} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onCancel(); } }} />
        <div className="modal-foot" style={{ marginTop: 20 }}><button type="button" className="btn" onClick={onCancel}>Hủy</button><button className="btn dark" disabled={need && !v.trim()}>{ok}</button></div>
      </form>
    </div>,
    document.body,
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
        <button className="icon-btn" aria-label={tr("Đóng")} onClick={onClose} style={{ position: "absolute", top: 14, right: 14 }}><I.X size={16} /></button>
        <h2 style={{ fontSize: 18 }}>Chọn gói phù hợp với bạn</h2>
        <div className="plans">
          {plans.map(([n, p, d, b], i) => (
            <div key={n} className={`plan ${i === 1 ? "hl" : ""}`}>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 400, letterSpacing: "-.03em" }}>{n}</b>
              <div><span style={{ fontSize: "var(--fs-7)" }}>{p}</span><span className="muted"> / tháng</span></div>
              <p className="muted" style={{ fontSize: "var(--fs-2)", margin: 0, minHeight: 58 }}>{d}</p>
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
          <input ref={inp} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }} />
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

export function Settings({ onClose, theme, setTheme, initial = "General", onTab }: { onClose: () => void; theme: string; setTheme: (t: string) => void; initial?: string; onTab?: (t: string) => void }) {
  const [tab, setTabState] = useState(initial);
  // R5: đổi mục báo lên trang để địa chỉ #s=<mục> theo kịp (F5 / chia sẻ liên kết mở đúng mục). Mở từ ngoài (openSettings("Providers"),
  // Back / Forward) thì initial đổi và mục đổi theo, không cần gắn lại hộp (giữ ô tìm kiếm).
  const setTab = (t: string) => { setTabState(t); onTab?.(t); };
  useEffect(() => { setTabState(initial); }, [initial]);
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
  // Tìm theo tên mục và từng dòng cài đặt (settingsindex.ts), cả chữ gốc lẫn chữ đang hiện. Dòng khớp hiện ngay dưới mục, bấm là tới đúng chỗ.
  const names = [...items, ...custom].map(([n]) => n);
  // R6: mục lạ (#s=Foo) hoặc không được phép (#s=Administrator khi không phải quản trị, tính năng bị tắt) thì về General, cả địa chỉ.
  const known = !me || names.includes(tab);
  useEffect(() => { if (!known) setTab("General"); }, [known]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = searchSettings(q, names, (s) => tr(s));
  const f = (l: [string, React.ReactNode][]) => l.filter(([n]) => found.some((x) => x.tab === n));
  const [goRow, setGoRow] = useState<{ row: string; n: number } | null>(null);
  useEffect(() => {
    if (!goRow) return;
    // Phần thân có thể tải chậm: thử vài lần tới khi dòng hiện ra. Thẻ .t đã được dịch nên so với cả hai.
    let n = 0;
    const t = setInterval(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".s-body .row .t, .s-body h3, .s-body .adm-card-h b, .s-body .adm-perm-row .t")].find((x) => [goRow.row, tr(goRow.row)].includes(x.textContent?.trim() ?? ""));
      if (el) { const r = el.closest<HTMLElement>(".row, .adm-perm-row, .adm-card") ?? el; r.scrollIntoView({ block: "center" }); r.classList.remove("s-hit"); void r.offsetWidth; r.classList.add("s-hit"); (r.querySelector<HTMLElement>("input,button,select,a") ?? r).focus({ preventScroll: true }); }
      if (el || ++n > 12) clearInterval(t);
    }, 120);
    return () => clearInterval(t);
  }, [goRow]);
  const item = (n: string, ic: React.ReactNode) => <Fragment key={n}><button className={`s-item ${tab === n ? "on" : ""}`} aria-current={tab === n ? "page" : undefined} onClick={() => setTab(n)} title={n}>{ic}<span className="s-lbl">{n}</span></button>
    {found.find((x) => x.tab === n)?.rows.slice(0, 6).map((r) => <button key={r} className="s-found" onClick={() => { setTab(n); setGoRow({ row: r, n: Date.now() }); }}>{r}</button>)}</Fragment>;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Tên cố định: phần thân vẽ lại khi đổi mục nên tiêu đề bên trong không dùng làm tên hộp thoại được. */}
      <div className="modal settings sy-settings" aria-label="Settings">
        <div className="s-nav">
          <div className="sy-snav-h"><b>Settings</b></div>
          <div className="s-search"><I.Search size={15} /><input placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="s-group">Settings</div>
          {f(items).map(([n, ic]) => item(n, ic))}
          <div className="s-group">Customize</div>
          {f(custom).map(([n, ic]) => item(n, ic))}
          {q.trim() && !found.length && <div className="s-none" role="status">No results</div>}
        </div>
        <div className="s-body" key={known ? tab : "General"}>
          <header className="sy-sbody-h"><h2>{known ? tab : "General"}</h2><button className="icon-btn close" onClick={onClose} aria-label="Đóng"><I.X size={16} /></button></header>
          <Boundary resetKey={known ? tab : "General"}><SettingsBody tab={known ? tab : "General"} theme={theme} setTheme={setTheme} go={setTab} /></Boundary>
        </div>
      </div>
    </div>
  );
}

