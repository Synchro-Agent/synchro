"use client";

// Cài đặt → Tài khoản: bật, tắt xác minh hai bước (app/mfa.ts). Khóa hiện dạng chữ và liên kết otpauth: mọi ứng dụng tạo mã đều cho nhập tay, không cần thêm thư viện vẽ mã QR.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { call as api } from "./adminui";
import { Fade } from "./ui";

type Stage = null | { step: "scan"; secret: string; uri: string } | { step: "codes"; codes: string[] } | { step: "off" };
export function MfaRow({ Row, say }: { Row: (p: { t: React.ReactNode; d?: React.ReactNode; children?: React.ReactNode }) => React.ReactNode; say: (s: string) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [left, setLeft] = useState(0);
  const [st, setSt] = useState<Stage>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<{ enabled: boolean; recoveryLeft: number }>("GET", "/api/auth/mfa").then((r) => { setOn(r.enabled); setLeft(r.recoveryLeft); }).catch(() => setOn(false));
  useEffect(() => { void load(); }, []);
  const act = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } catch (e) { say((e as Error).message); } finally { setBusy(false); } };
  const start = () => act(async () => { const r = await api<{ secret: string; uri: string }>("POST", "/api/auth/mfa", { op: "start" }); setCode(""); setSt({ step: "scan", ...r }); });
  const confirm = () => act(async () => { const r = await api<{ recovery: string[] }>("POST", "/api/auth/mfa", { op: "confirm", code }); setCode(""); setSt({ step: "codes", codes: r.recovery }); await load(); });
  const off = () => act(async () => { await api("POST", "/api/auth/mfa", { op: "disable", code }); setCode(""); setSt(null); await load(); say("Two-step verification turned off"); });
  const field = (onEnter: () => void) => <input className="field" autoFocus inputMode="text" autoComplete="one-time-code" placeholder="Verification code" aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.slice(0, 20))} onKeyDown={(e) => e.key === "Enter" && code.trim() && onEnter()} />;
  return <>
    <Row t="Two-step verification" d={on ? `On. ${left} recovery code${left === 1 ? "" : "s"} left.` : "Ask for a code from an authenticator app each time you sign in."}>
      {on === null ? null : <button className="btn" disabled={busy} onClick={on ? () => { setCode(""); setSt({ step: "off" }); } : start}>{on ? "Turn off" : "Turn on"}</button>}
    </Row>
    {/* Hàng này nằm trong thẻ có overflow của Cài đặt: khung phải ra ngoài mới phủ đúng màn hình. */}
    {typeof document !== "undefined" && createPortal(<Fade show={!!st}>{st ? <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && st.step !== "codes" && setSt(null)}>
      <div className="modal sm" style={{ width: 420 }}>
        {st.step === "scan" && <>
          <h2 style={{ fontSize: 16 }}>Turn on two-step verification</h2>
          <p className="d">Add this key to your authenticator app (Google Authenticator, Authy, 1Password…), then enter the code it shows.</p>
          <p className="mono" data-notr style={{ overflowWrap: "anywhere", userSelect: "all" }}>{st.secret}</p>
          <p className="d"><a href={st.uri}>Open in authenticator app</a></p>
          {field(confirm)}
          <div className="modal-foot"><button className="btn" onClick={() => setSt(null)}>Cancel</button><button className="btn dark" disabled={!code.trim() || busy} onClick={confirm}>Turn on</button></div>
        </>}
        {st.step === "codes" && <>
          <h2 style={{ fontSize: 16 }}>Save your recovery codes</h2>
          <p className="d">Each code works once if you lose your authenticator app. They are shown only now. Without them or the app, you can't sign in.</p>
          <p className="mono" data-notr style={{ whiteSpace: "pre-wrap", userSelect: "all" }}>{st.codes.join("\n")}</p>
          <div className="modal-foot"><button className="btn" onClick={() => { void navigator.clipboard?.writeText(st.codes.join("\n")).then(() => say("Copied"), () => say("Couldn't copy")); }}>Copy</button><button className="btn dark" onClick={() => setSt(null)}>I saved them</button></div>
        </>}
        {st.step === "off" && <>
          <h2 style={{ fontSize: 16 }}>Turn off two-step verification</h2>
          <p className="d">Enter a code from your authenticator app, or a recovery code.</p>
          {field(off)}
          <div className="modal-foot"><button className="btn" onClick={() => setSt(null)}>Cancel</button><button className="btn dark" disabled={!code.trim() || busy} onClick={off}>Turn off</button></div>
        </>}
      </div>
    </div> : null}</Fade>, document.body)}
  </>;
}
