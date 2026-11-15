"use client";
// Chia sẻ đoạn chat: hộp thoại tạo / cập nhật / dừng liên kết, và danh sách các liên kết trong Cài đặt → Quyền riêng tư.
import { useEffect, useState } from "react";
import * as I from "./icons";
import { locale, tr } from "../app/i18n";
import type { Chat } from "./store";

export type ShareInfo = { token: string; conv: string; title: string; size: number; createdAt: number; updatedAt: number };
const urlOf = (token: string) => `${location.origin}/share/${token}`;
const send = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || tr("Không kết nối được tới máy chủ."));
  return j;
};
const copyText = (t: string) => navigator.clipboard?.writeText(t).then(() => true, () => false) ?? Promise.resolve(false);

export function ShareModal({ chat, onClose, say }: { chat: Chat; onClose: () => void; say: (m: string) => void }) {
  const [cur, setCur] = useState<ShareInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const conv = String(chat.id);
  useEffect(() => {
    let live = true;
    send("GET", `/api/share?conv=${encodeURIComponent(conv)}`).then((j) => { if (live) setCur(j.share ?? null); }).catch((e) => { if (live) { setErr((e as Error).message); setCur(null); } });
    return () => { live = false; };
  }, [conv]);
  // Chỉ gửi vai + chữ + số tệp; máy chủ dựng lại bản chụp từ đầu. Tin đang viết dở không vào bản chụp.
  const snapshot = async () => {
    setBusy(true); setErr("");
    try {
      const msgs = chat.msgs.filter((m) => m.role === "user" || (m.done && m.text)).map((m) => ({ role: m.role, text: m.text, files: m.files?.map(() => 1), outs: m.outs?.filter((f) => !f.skipped).map(() => 1) }));
      const j = await send("POST", "/api/share", { conv, title: chat.title, msgs });
      const fresh = !cur;
      setCur(j.share);
      const ok = await copyText(urlOf(j.share.token));
      say(fresh ? (ok ? "Đã tạo liên kết và sao chép" : "Đã tạo liên kết") : "Đã cập nhật bản chia sẻ");
      // Ảnh không nhúng được (trang ảnh lỗi, ảnh quá lớn): người xem sẽ thấy ảnh hỏng, phải báo ngay cho người chia sẻ.
      if (j.missingImages > 0) setErr(`${j.missingImages} ${tr("ảnh trong artifact không kèm được vào bản chia sẻ nên người xem sẽ không thấy.")}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const stop = async () => {
    if (!cur) return;
    setBusy(true); setErr("");
    try { await send("DELETE", `/api/share?token=${encodeURIComponent(cur.token)}`); setCur(null); say("Đã dừng chia sẻ"); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sy-modal">
        <div className="sy-mh"><h2>Chia sẻ đoạn chat</h2><button className="icon-btn sy-x" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button></div>
        <div className="sy-mb sy-share">
          <p className="sy-sub" data-notr>{chat.title}</p>
          {chat.inc ? <p className="sh-hint">Đoạn chat ẩn danh không chia sẻ được.</p> : cur === undefined ? <p className="sh-hint"><span className="art-spin sm" /></p> : cur ? (<>
            <p className="sh-hint"><I.Globe size={14} /> Bất kỳ ai có liên kết đều xem được bản chụp này, không cần đăng nhập. Tin nhắn sau thời điểm chụp không tự thêm vào.</p>
            <div className="sh-link"><input readOnly aria-label="Liên kết chia sẻ" value={urlOf(cur.token)} onFocus={(e) => e.target.select()} data-notr />
              <button className="btn" onClick={() => copyText(urlOf(cur.token)).then((ok) => say(ok ? "Đã sao chép liên kết" : "Không sao chép được, hãy chép tay"))}>Sao chép</button></div>
            <p className="sh-at">Bản chụp lúc <span data-notr>{new Date(cur.updatedAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</span></p>
          </>) : (
            <p className="sh-hint"><I.Lock size={14} /> Đoạn chat này đang riêng tư. Tạo liên kết sẽ lưu một bản chụp trên máy chủ: chữ và artifact bản mới nhất. Tệp đính kèm, công cụ đã dùng và thông tin tài khoản của bạn không đi kèm.</p>
          )}
          {err && <p className="sh-err" role="alert">{tr(err)}</p>}
        </div>
        <div className="sy-mf">
          <div>
            {cur && <button className="btn danger" disabled={busy} onClick={stop}>Dừng chia sẻ</button>}
            <button className="btn" onClick={onClose}>Đóng</button>
            {!chat.inc && cur !== undefined && <button className="btn dark" disabled={busy} onClick={snapshot}>{cur ? "Cập nhật bản chụp" : "Tạo liên kết"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cài đặt → Quyền riêng tư → Đoạn chat đã chia sẻ: lấy từ máy chủ, nên đúng ở mọi thiết bị. */
export function SharedChats({ say, confirm }: { say: (m: string) => void; confirm: (title: string, text: string, ok: string, fn: () => void) => void }) {
  const [list, setList] = useState<ShareInfo[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => { setErr(""); send("GET", "/api/share").then((j) => setList(j.shares ?? [])).catch((e) => { setErr((e as Error).message); setList([]); }); };
  useEffect(load, []);
  const stop = (s: ShareInfo) => confirm("Dừng chia sẻ?", "Liên kết sẽ hết hiệu lực ngay và bản chụp trên máy chủ bị xóa.", "Dừng chia sẻ", () => {
    send("DELETE", `/api/share?token=${encodeURIComponent(s.token)}`).then(() => { setList((l) => l?.filter((x) => x.token !== s.token) ?? null); say("Đã dừng chia sẻ"); }).catch((e) => say((e as Error).message));
  });
  if (err) return <div className="empty">{tr(err)} <button className="lnk" onClick={load}>Thử lại</button></div>;
  if (!list) return <div className="empty"><span className="art-spin sm" /></div>;
  if (!list.length) return <div className="empty">No shared chats.</div>;
  return <>{list.map((s) => (
    <div key={s.token} className="item-row sh-row">
      <span className="sh-row-t"><a href={`/share/${s.token}`} target="_blank" rel="noopener noreferrer" data-notr>{s.title}</a><em data-notr>{new Date(s.updatedAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</em></span>
      <button className="btn" style={{ height: 26 }} onClick={() => copyText(urlOf(s.token)).then((ok) => say(ok ? "Đã sao chép liên kết" : "Không sao chép được, hãy chép tay"))}>Sao chép</button>
      <button className="btn danger" style={{ height: 26 }} onClick={() => stop(s)}>Stop sharing</button>
    </div>
  ))}</>;
}
