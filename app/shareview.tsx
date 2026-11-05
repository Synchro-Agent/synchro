"use client";
// Trang xem một đoạn chat được chia sẻ. Người xem chưa đăng nhập, nên trang không gọi API nào của tài khoản: artifact chạy trong đúng khung cô lập
// như trong chat (sandbox không cùng nguồn gốc, CSP chặn mạng), không có AI, không có kho dữ liệu; chữ của người dùng là văn bản thuần.
import { useEffect, useState } from "react";
import { ArtifactFrame, MermaidSvg, PublicFrames, VbhcView } from "./artifactui";
import { Lockup } from "./brand";
import { locale, tr, useLangReady } from "./i18n";
import { LangSwitch } from "./langswitch";
import { Markdown } from "./md";
import type { ShareSeg, ShareSnap } from "./sharesnap";

const noop = () => {};
function ArtSeg({ s }: { s: Extract<ShareSeg, { k: "art" }> }) {
  // Poster 3:4 co vừa chiều cao khung (artkit.ts) nên khung thấp sẽ cho poster bé: mở khung đủ cao ngay từ đầu.
  const [h, setH] = useState(/\bsx-poster\b/.test(s.content) ? 900 : 420);
  const body = s.type === "html" || s.type === "react" || s.type === "svg"
    ? <ArtifactFrame type={s.type} content={s.content} ai={false} title={s.title} onHeight={(v) => setH(Math.min(1400, Math.max(160, v)))} style={{ height: h }} className="sh-frame" />
    : s.type === "markdown" ? <div className="sh-doc"><Markdown text={s.content} say={noop} /></div>
    : s.type === "mermaid" ? <div className="sh-doc"><MermaidSvg code={s.content} /></div>
    : s.type === "vbhc" ? <VbhcView content={s.content} title={s.title} />
    : <div className="sh-doc"><Markdown text={"```" + (s.lang ?? "") + "\n" + s.content + "\n```"} say={noop} /></div>;
  const live = s.type === "html" || s.type === "react" || s.type === "svg";
  return <figure className="sh-art"><figcaption data-notr>{s.title}</figcaption>{live && <p className="sh-warn">{tr("Phần này do người chia sẻ tạo, không phải trang của Synchro. Đừng nhập mật khẩu hay thông tin thanh toán vào đây.")}</p>}{body}</figure>;
}

// Báo cáo nội dung giả mạo, lừa đảo: người xem không có tài khoản vẫn báo được.
function ReportLink({ token }: { token: string }) {
  const [st, setSt] = useState<"" | "form" | "busy" | "sent" | "err">("");
  const [why, setWhy] = useState("");
  const send = async () => {
    setSt("busy");
    const r = await fetch("/api/share/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, reason: why }) }).catch(() => null);
    setSt(r?.ok ? "sent" : "err");
  };
  if (st === "sent") return <span role="status">{tr("Đã gửi báo cáo. Cảm ơn bạn.")}</span>;
  if (!st) return <button className="lnk sh-report" onClick={() => setSt("form")}>{tr("Báo cáo nội dung này")}</button>;
  return (
    <span className="sh-report-form">
      <input className="field" autoFocus maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tr("Nội dung này có vấn đề gì?")} aria-label={tr("Nội dung này có vấn đề gì?")} />
      <button className="btn" disabled={st === "busy"} onClick={send}>{tr("Gửi báo cáo")}</button>
      {st === "err" && <span role="alert">{tr("Chưa gửi được, hãy thử lại sau ít phút.")}</span>}
    </span>
  );
}

export function ShareView({ snap, at, token }: { snap: ShareSnap; at: number; token: string }) {
  // Khung artifact, ngày giờ và ngôn ngữ phụ thuộc trình duyệt: dựng sau khi gắn để không lệch với bản dựng ở máy chủ.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Vẽ lại khi từ điển về hoặc đổi ngôn ngữ: chữ trong câu trả lời không qua bộ dịch tự động.
  useLangReady();
  return (
    <main className="sh-page">
      <header className="sh-head">
        <a href="/" className="brand-lock" aria-label="Synchro"><Lockup height={20} className="lk-hover" /></a>
        <span className="sh-tools"><span className="sh-tag">Bản chia sẻ chỉ đọc</span><LangSwitch inline /></span>
      </header>
      <h1 data-notr>{snap.title}</h1>
      {ready && <PublicFrames.Provider value={true}><p className="sh-at">{tr("Bản chụp lúc")} <span data-notr>{new Date(at).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</span></p>
      {!!snap.imgs?.missing && <p className="sh-note"><span data-notr>{snap.imgs.missing}</span> {tr("ảnh trong bản chia sẻ này không tải được.")}</p>}
      <div className="sh-thread">
        {snap.msgs.map((m, i) => (
          <section key={i} className={m.r === "u" ? "sh-u" : "sh-a"} aria-label={tr(m.r === "u" ? "Người dùng" : "Synchro")}>
            {m.r === "u"
              ? m.segs.map((s, k) => (s.k === "text" ? <div key={k} className="user-msg sh-utext" data-notr>{s.t}</div> : null))
              : <div className="ai-msg">{m.segs.map((s, k) => (s.k === "text" ? <Markdown key={k} text={s.t} say={noop} viz />
                : s.k === "art" ? <ArtSeg key={k} s={s} />
                : <p key={k} className="sh-note">{tr("Phiên bản cũ của")} “<span data-notr>{s.title}</span>”, {tr("bản mới nhất ở phía dưới.")}</p>))}</div>}
            {!!(m.files || m.outs) && <p className="sh-note">{m.files ? `${m.files} ${tr("tệp đính kèm")}` : `${m.outs} ${tr("tệp đã tạo")}`} {tr("không có trong bản chia sẻ.")}</p>}
          </section>
        ))}
      </div>
      <footer className="sh-foot">
        <span>{tr("Nội dung do người chia sẻ chọn đăng và có thể chứa lỗi của AI.")}</span>
        <nav><ReportLink token={token} /><a href="/">Synchro</a><a href="/privacy">{tr("Quyền riêng tư")}</a><a href="/terms">{tr("Điều khoản sử dụng")}</a></nav>
      </footer></PublicFrames.Provider>}
    </main>
  );
}
