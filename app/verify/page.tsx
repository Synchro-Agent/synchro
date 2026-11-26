"use client";
// Xác minh email: /verify#<mã> trong thư. Mã nằm sau dấu # nên không tới nhật ký máy chủ; phải bấm nút để trình quét liên kết của hộp thư không xác minh hộ.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lockup } from "../../ui/brand";
import { tr } from "../../ui/i18n";
import { LangSwitch } from "../../ui/langswitch";
import { AlertCircle, Check, Mail } from "lucide-react";
import { Spinner } from "../../ui/spinner";

// Chỉ 400 mới nghĩa là đường dẫn hỏng. Mất mạng, 5xx, quá giới hạn thì đường dẫn vẫn tốt: không được báo hết hạn, không được bỏ mã khỏi địa chỉ.
class PostError extends Error { constructor(m: string, public status: number) { super(m); } }
const NET = "Chưa kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";
const post = async (body: unknown) => {
  const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => { throw new PostError(NET, 0); });
  if (!r.ok) throw new PostError((await r.json().catch(() => ({}))).error || NET, r.status);
  return r.json() as Promise<{ already?: boolean; email?: string }>;
};
type Stage = "loading" | "ask" | "bad" | "retry" | "already" | "done" | "denied" | "change" | "changed";

export default function VerifyEmail() {
  const [stage, setStage] = useState<Stage>("loading");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const confirmChange = async () => {
    setBusy(true); setErr("");
    try { await post({ token, action: "change-confirm" }); setStage("changed"); history.replaceState(null, "", "/verify"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const t = location.hash.slice(1);
    if (!t) { setStage("bad"); return; }
    setToken(t);
    check(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isChange = () => /[?&]change=1/.test(location.search);
  const check = (t: string) => {
    setStage("loading"); setErr("");
    if (isChange()) { post({ token: t, action: "change-check" }).then((j) => { setNewEmail(j.email ?? ""); setStage("change"); }, (e: PostError) => { if (e.status === 400) setStage("bad"); else { setErr(e.message); setStage("retry"); } }); return; }
    post({ token: t, action: "check" }).then((j) => setStage(j.already ? "already" : "ask"), (e: PostError) => { if (e.status === 400) setStage("bad"); else { setErr(e.message); setStage("retry"); } });
  };
  const act = async (action: "confirm" | "deny") => {
    setBusy(true); setErr("");
    try { await post({ token, action }); setStage(action === "confirm" ? "done" : "denied"); history.replaceState(null, "", "/verify"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="rp">
      <LangSwitch />
      <div className="rp-card">
        <Link href="/" className="rp-brand" aria-label="Synchro"><Lockup height={20} className="lk-hover" /></Link>
        {stage === "loading"
          && <div className="rp-wait" role="status" aria-label={tr("Đang tải")}><Spinner className="art-spin sm" />
          </div>}
        {stage === "ask" && <>
          <div className="rp-ico"><Mail size={20} /></div>
          <h1>Xác minh email của bạn</h1>
          <p className="rp-lead">Có người vừa tạo tài khoản Synchro bằng địa chỉ email này. Nếu là bạn, hãy xác minh để dùng đủ tính năng.</p>
          {err && <p className="auth-field-err rp-err" role="alert">{tr(err)}</p>}
          <button className="btn dark rp-go" disabled={busy} onClick={() => void act("confirm")}>{busy
            ? <Spinner className="api-spin" /> : "Đúng, là tôi"}</button>
          {!sure
            ? <button className="lnk rp-back" onClick={() => setSure(true)}>Không phải tôi</button>
            : <>
              <p className="rp-hint">Tài khoản này và mọi thứ trong đó sẽ bị xóa vĩnh viễn, và email của bạn lại đăng ký được.</p>
              <button className="btn danger rp-go" disabled={busy} onClick={() => void act("deny")}>Xóa tài khoản đó</button>
            </>}
        </>}
        {stage === "change" && <>
          <div className="rp-ico"><Mail size={20} /></div>
          <h1>Xác nhận email mới</h1>
          <p className="rp-lead">Tài khoản của bạn sẽ dùng <b data-notr>{newEmail}</b> để đăng nhập và nhận thư. Mọi thiết bị sẽ được đăng xuất.</p>
          {err && <p className="auth-field-err rp-err" role="alert">{tr(err)}</p>}
          <button className="btn dark rp-go" disabled={busy} onClick={() => void confirmChange()}>{busy
            ? <Spinner className="api-spin" /> : "Đổi sang email này"}</button>
        </>}
        {stage === "changed" && <>
          <div className="rp-ico ok"><Check size={20} /></div>
          <h1>Đã đổi email</h1>
          <p className="rp-lead">Hãy đăng nhập lại bằng email mới.</p>
          <Link className="btn dark rp-go" href="/">Đăng nhập</Link>
        </>}
        {stage === "retry" && <>
          <div className="rp-ico"><AlertCircle size={20} /></div>
          <h1>Chưa kiểm tra được đường dẫn</h1>
          <p className="rp-lead">Đường dẫn của bạn vẫn còn nguyên. {tr(err)}</p>
          <button className="btn dark rp-go" onClick={() => check(token)}>Thử lại</button>
        </>}
        {stage === "already" && <>
          <div className="rp-ico ok"><Check size={20} /></div>
          <h1>Email này đã được xác minh</h1>
          <p className="rp-lead">Bạn không cần làm gì thêm. Tài khoản của bạn đã dùng được đủ tính năng.</p>
          <Link className="btn dark rp-go" href="/">Mở Synchro</Link>
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
