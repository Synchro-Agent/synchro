"use client";
import "./styles/skills.css";
// Ứng dụng nội bộ: nút Xuất bản trên khung artifact, danh sách ứng dụng (trang Artifacts → Ứng dụng) và trang chạy ứng dụng /apps/<id>.
import { useEffect, useRef, useState } from "react";
import { isAway } from "./clickaway";
import { apiFetch, statusText } from "./apierr";
import * as I from "./icons";
import { locale, tr } from "./i18n";
import { ArtifactFrame, type ArtVersion, type FrameSend } from "./artifactui";
import { CommentsPanel, Presence, useLive } from "./collabui";
import { Menu } from "./ui";
import { PUBLISHABLE } from "../shared/artifacts";

export type AppInfo = { id: string; title: string; type: "html" | "react" | "svg"; visibility: "private" | "org"; conv: string; ident: string; created_at: number; updated_at: number; opens: number; mine: boolean; ownerName: string };
const api = async <T,>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || statusText(r.status));
  return j as T;
};
export { PUBLISHABLE };
const appUrl = (id: string) => `${location.origin}/apps/${id}`;

// ---------------------------------------------------------------- nút Xuất bản trên khung artifact
export function PublishButton({ conv, art, say }: { conv: string; art: ArtVersion; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<AppInfo | null | undefined>(undefined);
  const [title, setTitle] = useState(art.title);
  const [vis, setVis] = useState<"private" | "org">("org");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (isAway(ref.current, e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  // Đã xuất bản artifact này chưa: cùng đoạn chat + identifier thì cập nhật đúng ứng dụng cũ (giữ nguyên địa chỉ).
  useEffect(() => {
    if (!open) return;
    setCur(undefined);
    api<{ apps: AppInfo[] }>("GET", "/api/apps").then((r) => {
      const a = r.apps.find((x) => x.mine && x.conv === conv && x.ident === art.ident) ?? null;
      setCur(a); if (a) { setTitle(a.title); setVis(a.visibility); } else setTitle(art.title);
    }).catch(() => setCur(null));
  }, [open, conv, art.ident, art.title]);
  const publish = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string; created: boolean }>("POST", "/api/apps", { conv, ident: art.ident, title, type: art.type, content: art.content, visibility: vis });
      setCur({ ...(cur ?? {} as AppInfo), id: r.id, title, visibility: vis, conv, ident: art.ident });
      navigator.clipboard?.writeText(appUrl(r.id)).catch(() => {});
      say(r.created ? tr("Đã xuất bản ứng dụng, đã chép đường dẫn") : tr("Đã cập nhật ứng dụng lên phiên bản đang xem"));
    } catch (e) { say((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="pub-w" ref={ref}>
      <button className={`icon-btn ${cur ? "pub-on" : ""}`} onClick={() => setOpen(!open)} aria-label="Xuất bản thành ứng dụng" data-tip="Xuất bản thành ứng dụng" aria-expanded={open}><I.Rocket size={15} /></button>
      <Menu open={open} className="pub-menu">
        <div className="pub-h"><b>{cur ? tr("Ứng dụng đã xuất bản") : tr("Xuất bản thành ứng dụng")}</b><span>{tr("Một địa chỉ riêng để dùng thật: dữ liệu được lưu lại, cả nhóm cùng dùng được.")}</span></div>
        {cur === undefined ? <div className="pub-load"><span className="art-spin sm" /></div> : (
          <>
            <label className="pub-l">{tr("Tên ứng dụng")}<input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
            <div className="pub-vis" role="radiogroup">
              <button role="radio" aria-checked={vis === "org"} className={vis === "org" ? "on" : ""} onClick={() => setVis("org")}><I.Users size={15} /><span><b>{tr("Ai có đường dẫn")}</b><em>{tr("Mọi người có tài khoản Synchro và có đường dẫn đều mở được")}</em></span></button>
              <button role="radio" aria-checked={vis === "private"} className={vis === "private" ? "on" : ""} onClick={() => setVis("private")}><I.Lock size={15} /><span><b>{tr("Chỉ mình tôi")}</b><em>{tr("Chỉ bạn mở được")}</em></span></button>
            </div>
            {cur && (
              <div className="pub-link">
                <a href={`/apps/${cur.id}`} target="_blank" rel="noreferrer" data-notr>{appUrl(cur.id).replace(/^https?:\/\//, "")}</a>
                <button className="icon-btn" aria-label="Chép đường dẫn" data-tip="Chép đường dẫn" onClick={() => { navigator.clipboard?.writeText(appUrl(cur.id)); say(tr("Đã chép đường dẫn")); }}><I.Copy size={14} /></button>
              </div>
            )}
            <div className="pub-acts">
              {cur && <a className="btn" href={`/apps/${cur.id}`} target="_blank" rel="noreferrer">{tr("Mở ứng dụng")}</a>}
              <button className="btn dark" disabled={busy || !title.trim()} onClick={publish}>{busy ? <span className="art-spin sm" /> : null}{cur ? tr("Cập nhật") : tr("Xuất bản")}</button>
            </div>
            <p className="pub-note">{tr("Ứng dụng lưu dữ liệu bằng window.storage. Người dùng ứng dụng gọi AI bằng hạn mức của chính họ.")}</p>
          </>
        )}
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------- danh sách ứng dụng (trang Artifacts → Ứng dụng)
export function AppsGallery({ q, say }: { q: string; say: (m: string) => void }) {
  const [list, setList] = useState<AppInfo[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => api<{ apps: AppInfo[] }>("GET", "/api/apps").then((r) => setList(r.apps), (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <div className="empty"><span>{err}</span></div>;
  if (!list) return <div className="art-grid">{[0, 1, 2].map((i) => <div key={i} className="art-tile sk" />)}</div>;
  const shown = list.filter((a) => (a.title + " " + a.ownerName).toLowerCase().includes(q.toLowerCase()));
  if (!list.length) return <div className="apps-empty"><I.Rocket size={22} /><b>{tr("Chưa có ứng dụng nào")}</b><span>{tr("Mở một artifact (trang web, ứng dụng React) rồi bấm nút tên lửa trên khung xem trước để xuất bản thành ứng dụng dùng thật, lưu được dữ liệu, chia sẻ cho cả tổ chức.")}</span></div>;
  const remove = async (a: AppInfo) => {
    try { await api("DELETE", `/api/apps/${a.id}`); setList((l) => l?.filter((x) => x.id !== a.id) ?? null); say(tr("Đã gỡ ứng dụng")); } catch (e) { say((e as Error).message); }
  };
  return (
    <div className="apps-list">
      {shown.map((a) => (
        <div key={a.id} className="apps-row">
          <span className="pl-mark" style={{ width: 40, height: 40 }}><I.Rocket size={18} /></span>
          <div className="apps-t">
            <b data-notr>{a.title}</b>
            {/* Dấu "·" dính vào chữ đứng trước (khoảng trắng không ngắt) và "2 lượt mở", "của Lan Anh" không bị tách: màn hẹp từng đẩy
                "· 2/11/2026" xuống đầu dòng, bẻ tên "apps- / a", "Download / Tester". Gạch nối trong tên là gạch không ngắt. */}
            <span>{[a.visibility === "org" ? tr("Ai có đường dẫn") : tr("Chỉ mình tôi"), a.mine ? "" : `${tr("của")} ${a.ownerName}`.replace(/ /g, "\u00a0").replace(/-/g, "\u2011"), `${a.opens} ${tr("lượt mở")}`.replace(/ /g, "\u00a0"),
              new Date(a.updated_at).toLocaleDateString(locale())].filter(Boolean).join("\u00a0· ")}</span>
          </div>
          <a className="btn" href={`/apps/${a.id}`} target="_blank" rel="noreferrer">{tr("Mở")}</a>
          <button className="icon-btn" aria-label="Chép đường dẫn" data-tip="Chép đường dẫn" onClick={() => { navigator.clipboard?.writeText(appUrl(a.id)); say(tr("Đã chép đường dẫn")); }}><I.Copy size={15} /></button>
          {a.mine && <button className="icon-btn" aria-label="Gỡ ứng dụng" data-tip="Gỡ ứng dụng" onClick={() => remove(a)}><I.Trash size={15} /></button>}
        </div>
      ))}
      {!shown.length && <div className="empty"><span>{tr("Không có ứng dụng nào khớp.")}</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------- trang chạy ứng dụng /apps/<id>
export function AppRunner({ id }: { id: string }) {
  const [app, setApp] = useState<(AppInfo & { content: string }) | null>(null);
  const [err, setErr] = useState("");
  const [ai, setAi] = useState(false);
  const [me, setMe] = useState("");
  const [panel, setPanel] = useState(false);
  const [toast, setToast] = useState("");
  // Mã riêng của tab: ghi dữ liệu chung từ tab này thì tab này không nhận lại thông báo "vừa đổi".
  const [client] = useState(() => Math.random().toString(36).slice(2, 12));
  const frame = useRef<FrameSend | null>(null);
  const live = useLive(app ? app.id : null, client, (key) => frame.current?.({ t: "changed", key }));
  useEffect(() => {
    fetch(`/api/apps/${encodeURIComponent(id)}?open=1`).then(async (r) => {
      if (r.status === 401) { location.href = `/?next=${encodeURIComponent(location.pathname)}`; return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
      setApp(j.app); document.title = `${j.app.title} · Synchro`;
    }).catch((e) => setErr(e.message));
    // Ứng dụng gọi được AI khi tài khoản đang bật "Artifact dùng AI" (máy chủ vẫn kiểm tra lại mỗi lần gọi).
    fetch("/api/caps").then((r) => (r.ok ? r.json() : null)).then((j) => setAi(!!j?.caps?.ai)).catch(() => {});
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((j) => setMe(j?.user?.id ?? "")).catch(() => {});
    // Mở từ thông báo "nhắc bạn trong…" (#comments): mở sẵn bảng bình luận.
    if (location.hash === "#comments") setPanel(true);
  }, [id]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- rời trang ứng dụng độc lập về app chính: tải toàn trang có chủ đích
  if (err) return <div className="app-run"><div className="app-miss"><I.Rocket size={26} /><b>{tr("Không mở được ứng dụng")}</b><span>{err}</span><a className="btn" href="/">{tr("Về Synchro")}</a></div></div>;
  if (!app) return <div className="app-run"><div className="app-miss"><span className="art-spin" /></div></div>;
  const n = (live.comments ?? []).filter((c) => !c.resolved).length;
  return (
    <div className="app-run">
      <header className="app-bar">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- như trên: trang ứng dụng độc lập, về app chính bằng tải toàn trang */}
        <a href="/" className="app-home" aria-label="Synchro">Synchro</a>
        <span className="app-sep" />
        <b data-notr>{app.title}</b>
        <span className="app-meta">{app.visibility === "org" ? tr("Ai có đường dẫn") : tr("Chỉ mình tôi")}{app.mine ? "" : ` · ${tr("của")} ${app.ownerName}`}</span>
        <span style={{ flex: 1 }} />
        <Presence people={live.people} me={me} />
        <button className={`btn app-cmt ${panel ? "on" : ""}`} onClick={() => setPanel(!panel)} aria-pressed={panel}><I.Chat2 size={15} />{tr("Bình luận")}{n > 0 && <span className="cl-n">{n}</span>}</button>
      </header>
      <div className="app-body">
        <ArtifactFrame type={app.type} content={app.content} ai={ai} title={app.title} className="app-frame" store={{ app: app.id, client }} ctl={(send) => { frame.current = send; }} />
        {panel && <CommentsPanel app={app.id} me={me} owner={app.mine} comments={live.comments} setComments={live.setComments} onClose={() => setPanel(false)} say={setToast} />}
      </div>
      {toast && <div className="app-toast" role="status">{toast}</div>}
    </div>
  );
}
