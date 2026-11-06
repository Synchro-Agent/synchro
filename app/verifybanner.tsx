"use client";
// Dải nhắc xác minh email cho tài khoản mới: không chặn chat. Gửi lại thư ngay tại đây; xác minh ở tab khác thì quay lại trang này là tự biến mất và mở đủ tính năng.
import { useEffect, useState } from "react";
import { getLang } from "./i18n";
import type { AuthUser } from "./auth";
import * as I from "./icons";

export function VerifyBanner({ me, onChange }: { me: AuthUser | null; onChange: (u: AuthUser) => void }) {
  const [state, setState] = useState<"" | "busy" | "sent" | "limit">("");
  const [hidden, setHidden] = useState(false);
  const pending = !!me?.verifyPending;
  useEffect(() => {
    if (!pending) return;
    const check = () => { if (document.visibilityState !== "visible") return; fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.user && !j.user.verifyPending) onChange(j.user); }).catch(() => {}); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [pending, onChange]);
  if (!pending || hidden) return null;
  const resend = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resend: true, lang: getLang() }) });
      setState(r.ok ? "sent" : "limit");
    } catch { setState("limit"); }
  };
  return (
    <div className="verify-banner" role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 14px", fontSize: 13, lineHeight: 1.45, background: "var(--hover)", borderBottom: ".5px solid var(--border)", color: "var(--text-2)" }}>
      <span style={{ flex: "none", display: "grid" }}><I.Alert size={15} /></span>
      <span style={{ flex: "1 1 240px", minWidth: 0 }}>
        {/* Chỉ kể tính năng bị khóa khi chúng thật sự bị khóa (quản trị viên có thể tắt yêu cầu xác minh). */}
        <span>{me?.verifyLocked ? "Confirm your email to use file attachments, connectors, scheduled tasks, voice and Synchro Code." : "Please confirm your email."}</span>{" "}
        <span data-notr style={{ overflowWrap: "anywhere" }}>{me?.email}</span>
        {state === "sent" && <> · <span>Sent. Check your inbox and Spam.</span></>}
        {state === "limit" && <> · <span>Couldn&apos;t send right now. Try again in a while, or ask your administrator.</span></>}
      </span>
      <button className="btn" style={{ height: 28 }} disabled={state === "busy"} onClick={() => void resend()}>{state === "busy" ? <span className="api-spin" /> : "Resend email"}</button>
      <button className="icon-btn" aria-label="Hide" title="Hide" onClick={() => setHidden(true)}><I.X size={14} /></button>
    </div>
  );
}
