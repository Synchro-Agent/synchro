"use client";

// Xác minh lại trước hành động nhạy cảm (thêm khóa truy cập, bật xác minh hai bước). Máy chủ trả 403 { reauth: true } khi lần đăng nhập / xác minh
// gần nhất đã quá 5 phút (authstore.requireRecentReauth). Hộp này hỏi mật khẩu hiện tại rồi chạy lại đúng yêu cầu đó kèm { password };
// tài khoản không có mật khẩu thì xác minh bằng một khóa truy cập đã có; không có cả hai (chỉ Google / GitHub / Apple) thì đăng xuất rồi đăng nhập lại:
// phiên vừa tạo được tính là vừa xác minh trong 5 phút.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../app/i18n";
import { passkeyCancelled, passkeyStepUp, passkeySupported } from "./passkeyclient";
import { useApp } from "./store";
import { Fade } from "./ui";

/** Lỗi máy chủ đòi xác minh lại (hoặc báo mật khẩu xác minh lại bị sai). */
export const needsReauth = (e: unknown) => (e as { data?: { reauth?: unknown } } | null)?.data?.reauth === true;

export type Proof = { password?: string };
type Job = { f: (p: Proof) => Promise<unknown>; ok: (v: unknown) => void; fail: (e: unknown) => void };

export function useStepUp() {
  const app = useApp();
  const [job, setJob] = useState<Job | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef<Job | null>(null);
  const hasPw = !!app.me?.hasPassword;
  const hasKey = !!app.me?.methods.includes("passkey") && passkeySupported();

  const close = (v: unknown) => { const j = live.current; live.current = null; setJob(null); setBusy(false); j?.ok(v); };
  /** Chạy f; máy chủ đòi xác minh lại thì mở hộp, xác minh xong chạy lại f. Trả về null khi người dùng hủy. */
  function run<T>(f: (p: Proof) => Promise<T>): Promise<T | null> {
    return f({}).catch((e: unknown) => {
      if (!needsReauth(e)) throw e;
      return new Promise<T | null>((ok, fail) => {
        const j: Job = { f, ok: ok as (v: unknown) => void, fail };
        live.current = j; setPw(""); setErr(""); setBusy(false); setJob(j);
      });
    });
  }
  // Chạy lại yêu cầu sau khi có bằng chứng. Mật khẩu sai (máy chủ vẫn trả { reauth: true }) thì giữ hộp mở, báo ngay dưới ô; lỗi khác trả về nơi gọi.
  const retry = async (p: Proof, before?: () => Promise<void>) => {
    const j = live.current;
    if (!j || busy) return;
    setBusy(true); setErr("");
    // Người dùng tự đóng hộp hỏi khóa lúc xác minh: giữ hộp này để chọn lại.
    if (before) try { await before(); } catch (e) { setBusy(false); if (!passkeyCancelled(e)) setErr(tr((e as Error).message || "Không xác minh được khóa truy cập. Hãy thử lại.")); return; }
    try { close(await j.f(p)); }
    catch (e) {
      if (live.current !== j) return;
      if (needsReauth(e)) { setErr(tr((e as Error).message || "Mật khẩu không đúng.")); setBusy(false); return; }
      live.current = null; setJob(null); setBusy(false); j.fail(e);
    }
  };
  const viaPassword = () => { if (pw) void retry({ password: pw }); };
  const viaPasskey = () => void retry({}, passkeyStepUp);
  const signOut = () => { close(null); app.logout(); };

  const node = typeof document !== "undefined" ? createPortal(<Fade show={!!job}>{job ? <div className="overlay" style={{ zIndex: "calc(var(--z-overlay) + 10)" }} onMouseDown={(e) => e.target === e.currentTarget && !busy && close(null)}>
    <div className="modal sm" style={{ width: "min(420px, 92vw)" }} role="dialog" aria-label={tr("Xác minh lại danh tính")}>
      <h2 style={{ fontSize: "var(--fs-4)" }}>{tr("Xác minh lại danh tính")}</h2>
      {hasPw ? <>
        <p className="d">{tr("Để thêm cách đăng nhập mới, hãy nhập mật khẩu hiện tại của bạn.")}</p>
        <input className="field" type="password" autoFocus autoComplete="current-password" placeholder={tr("Mật khẩu hiện tại")} aria-label={tr("Mật khẩu hiện tại")} value={pw}
          onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && viaPassword()} />
      </> : hasKey ? <p className="d">{tr("Để thêm cách đăng nhập mới, hãy xác minh bằng một khóa truy cập bạn đã có.")}</p>
        : <>
          <p className="d">{tr("Đăng xuất rồi đăng nhập lại để xác nhận")}</p>
          <p className="d">{tr("Tài khoản này không có mật khẩu. Sau khi đăng nhập lại, bạn có 5 phút để hoàn tất.")}</p>
        </>}
      {err && <p className="auth-field-err" role="alert">{err}</p>}
      <div className="modal-foot">
        <button className="btn" disabled={busy} onClick={() => close(null)}>{tr("Hủy")}</button>
        {hasKey && <button className={hasPw ? "btn" : "btn dark"} disabled={busy} onClick={viaPasskey}>{tr("Dùng khóa truy cập")}</button>}
        {hasPw && <button className="btn dark" disabled={busy || !pw} onClick={viaPassword}>{busy ? <span className="api-spin" /> : tr("Xác nhận")}</button>}
        {!hasPw && !hasKey && <button className="btn dark" onClick={signOut}>{tr("Đăng xuất")}</button>}
      </div>
    </div>
  </div> : null}</Fade>, document.body) : null;
  return { run, node };
}
