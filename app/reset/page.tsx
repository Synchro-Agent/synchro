"use client";
// Quên mật khẩu: /reset là biểu mẫu nhận email, /reset#<mã> (đường dẫn trong email hoặc do quản trị viên tạo) là biểu mẫu đặt mật khẩu mới.
// Mã nằm sau dấu # nên không tới nhật ký của máy chủ hay nginx.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lockup } from "../brand";
import { getLang, tr } from "../i18n";
import { AlertCircle, Check, Eye, EyeOff, Mail } from "lucide-react";

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Lỗi ${r.status}`);
  return r.json();
};
type Stage = "loading" | "ask" | "sent" | "set" | "bad" | "done";

export default function ResetPassword() {
  const [stage, setStage] = useState<Stage>("loading");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const t = location.hash.slice(1);
    try { const e = sessionStorage.getItem("forgot-email"); if (e) { setEmail(e); sessionStorage.removeItem("forgot-email"); } } catch {}
    if (!t) { setStage("ask"); return; }
    setToken(t);
    // Kiểm tra trước: đường dẫn đã hết hạn thì nói ngay, không để người dùng gõ mật khẩu rồi mới biết.
    post("/api/auth/reset", { token: t, check: true }).then(() => setStage("set"), () => { setStage("bad"); history.replaceState(null, "", "/reset"); });
  }, []);
  const ask = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr("Email chưa đúng định dạng.");
    setBusy(true); setErr("");
    try { await post("/api/auth/forgot", { email: email.trim(), lang: getLang() }); setStage("sent"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    if (pw.length < 8) return setErr("Mật khẩu cần ít nhất 8 ký tự.");
    if (pw !== again) return setErr("Hai mật khẩu chưa khớp.");
    setBusy(true); setErr("");
    try { await post("/api/auth/reset", { token, password: pw, lang: getLang() }); setStage("done"); history.replaceState(null, "", "/reset"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const again2 = () => { setErr(""); setStage("ask"); };
  const e = err && <p className="auth-field-err rp-err" role="alert">{tr(err)}</p>;
  return (
    <main className="rp">
      <div className="rp-card">
        <Link href="/" className="rp-brand" aria-label="Synchro"><Lockup height={20} className="lk-hover" /></Link>
        {stage === "loading" && <div className="rp-wait" role="status" aria-label={tr("Đang tải")}><span className="art-spin sm" /></div>}
        {stage === "ask" && <>
          <h1>Quên mật khẩu?</h1>
          <p className="rp-lead">Nhập email của tài khoản. Synchro sẽ gửi cho bạn một đường dẫn để đặt mật khẩu mới.</p>
          <form onSubmit={(ev) => { ev.preventDefault(); void ask(); }}>
            <label className="rp-l" htmlFor="rp-email">Email</label>
            <input id="rp-email" className="field" type="email" autoComplete="email" autoFocus value={email} onChange={(ev) => { setEmail(ev.target.value); setErr(""); }} />
            {e}
            <button className="btn dark rp-go" disabled={busy || !email.trim()}>{busy ? <span className="api-spin" /> : "Gửi đường dẫn"}</button>
          </form>
          <Link className="rp-back" href="/">Quay lại đăng nhập</Link>
        </>}
        {stage === "sent" && <>
          <div className="rp-ico"><Mail size={20} /></div>
          <h1>Hãy kiểm tra email</h1>
          <p className="rp-lead">Nếu <b data-notr>{email.trim()}</b> có tài khoản Synchro, bạn sẽ nhận được đường dẫn đặt lại mật khẩu trong vài phút. Đường dẫn có hiệu lực 60 phút.</p>
          <p className="rp-hint">Chưa thấy email? Hãy xem mục Spam, hoặc <button className="lnk" onClick={again2}>gửi lại</button>. Tài khoản đăng nhập bằng Google, GitHub hoặc Apple có thể đăng nhập bằng các nút đó mà không cần mật khẩu.</p>
          <Link className="rp-back" href="/">Quay lại đăng nhập</Link>
        </>}
        {stage === "set" && <>
          <h1>Đặt mật khẩu mới</h1>
          <p className="rp-lead">Sau khi lưu, mọi thiết bị sẽ được đăng xuất và bạn đăng nhập lại bằng mật khẩu mới.</p>
          <form onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
            <label className="rp-l" htmlFor="rp-new">Mật khẩu mới</label>
            <div className="rp-pw">
              <input id="rp-new" className="field" type={show ? "text" : "password"} autoComplete="new-password" autoFocus value={pw} onChange={(ev) => { setPw(ev.target.value); setErr(""); }} aria-describedby="rp-rule" />
              <button type="button" className="icon-btn" aria-label={tr(show ? "Ẩn mật khẩu" : "Hiện mật khẩu")} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <p className="rp-hint" id="rp-rule">Ít nhất 8 ký tự.</p>
            <label className="rp-l" htmlFor="rp-again">Nhập lại mật khẩu mới</label>
            <input id="rp-again" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={again} onChange={(ev) => { setAgain(ev.target.value); setErr(""); }} />
            {e}
            <button className="btn dark rp-go" disabled={busy || !pw || !again}>{busy ? <span className="api-spin" /> : "Lưu mật khẩu mới"}</button>
          </form>
        </>}
        {stage === "bad" && <>
          <div className="rp-ico"><AlertCircle size={20} /></div>
          <h1>Đường dẫn đã hết hiệu lực</h1>
          <p className="rp-lead">Đường dẫn đặt lại mật khẩu chỉ dùng được một lần và có thời hạn. Hãy yêu cầu đường dẫn mới.</p>
          <button className="btn dark rp-go" onClick={again2}>Gửi đường dẫn mới</button>
          <Link className="rp-back" href="/">Quay lại đăng nhập</Link>
        </>}
        {stage === "done" && <>
          <div className="rp-ico ok"><Check size={20} /></div>
          <h1>Đã đặt mật khẩu mới</h1>
          <p className="rp-lead">Mọi thiết bị đã được đăng xuất. Hãy đăng nhập bằng mật khẩu mới.</p>
          <Link className="btn dark rp-go" href="/">Đăng nhập</Link>
        </>}
      </div>
      <nav className="rp-foot"><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản sử dụng</Link></nav>
    </main>
  );
}
