"use client";
// Xác minh email: /verify#<mã> trong thư. Mã nằm sau dấu # nên không tới nhật ký máy chủ; phải bấm nút để trình quét liên kết của hộp thư không xác minh hộ.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lockup } from "../brand";
import { tr } from "../i18n";
import { AlertCircle, Check, Mail } from "lucide-react";

const post = async (body: unknown) => {
  const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Lỗi ${r.status}`);
};
type Stage = "loading" | "ask" | "bad" | "done" | "denied";

export default function VerifyEmail() {
  const [stage, setStage] = useState<Stage>("loading");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const t = location.hash.slice(1);
    if (!t) { setStage("bad"); return; }
    setToken(t);
    post({ token: t, action: "check" }).then(() => setStage("ask"), () => setStage("bad"));
  }, []);
  const act = async (action: "confirm" | "deny") => {
    setBusy(true); setErr("");
    try { await post({ token, action }); setStage(action === "confirm" ? "done" : "denied"); history.replaceState(null, "", "/verify"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="rp">
      <div className="rp-card">
        <Link href="/" className="rp-brand" aria-label="Synchro"><Lockup height={20} className="lk-hover" /></Link>
        {stage === "loading" && <div className="rp-wait" role="status" aria-label={tr("Đang tải")}><span className="art-spin sm" /></div>}
        {stage === "ask" && <>
          <div className="rp-ico"><Mail size={20} /></div>
          <h1>Xác minh email của bạn</h1>
          <p className="rp-lead">Có người vừa tạo tài khoản Synchro bằng địa chỉ email này. Nếu là bạn, hãy xác minh để dùng đủ tính năng.</p>
          {err && <p className="auth-field-err rp-err" role="alert">{tr(err)}</p>}
          <button className="btn dark rp-go" disabled={busy} onClick={() => void act("confirm")}>{busy ? <span className="api-spin" /> : "Đúng, là tôi"}</button>
          {!sure
            ? <button className="lnk rp-back" onClick={() => setSure(true)}>Không phải tôi</button>
            : <>
              <p className="rp-hint">Tài khoản này và mọi thứ trong đó sẽ bị xóa vĩnh viễn, và email của bạn lại đăng ký được.</p>
              <button className="btn danger rp-go" disabled={busy} onClick={() => void act("deny")}>Xóa tài khoản đó</button>
            </>}
        </>}
        {stage === "bad" && <>
          <div className="rp-ico"><AlertCircle size={20} /></div>
          <h1>Đường dẫn đã hết hiệu lực</h1>
          <p className="rp-lead">Đường dẫn xác minh có thời hạn và chỉ dùng được một lần. Hãy đăng nhập rồi gửi lại thư xác minh từ dải thông báo trên cùng.</p>
          <Link className="btn dark rp-go" href="/">Đăng nhập</Link>
        </>}
        {stage === "done" && <>
          <div className="rp-ico ok"><Check size={20} /></div>
          <h1>Đã xác minh email</h1>
          <p className="rp-lead">Tài khoản của bạn đã dùng được đủ tính năng.</p>
          <Link className="btn dark rp-go" href="/">Mở Synchro</Link>
        </>}
        {stage === "denied" && <>
          <div className="rp-ico ok"><Check size={20} /></div>
          <h1>Đã xóa tài khoản đó</h1>
          <p className="rp-lead">Tài khoản lập bằng email của bạn đã bị xóa. Bạn không cần làm gì thêm.</p>
          <Link className="btn dark rp-go" href="/">Về trang chủ</Link>
        </>}
      </div>
      <nav className="rp-foot"><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản sử dụng</Link></nav>
    </main>
  );
}
