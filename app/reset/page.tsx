"use client";
// Đặt lại mật khẩu bằng đường dẫn quản trị viên gửi (/reset#<mã>): chưa có dịch vụ gửi email. Mã nằm sau dấu # nên không tới nhật ký của máy chủ hay Referer.
import { useEffect, useState } from "react";
import Link from "next/link";
import { LegalDoc } from "../legal/doc";
import { tr } from "../i18n";

export default function ResetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState({ next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { setToken(location.hash.slice(1)); }, []);
  const save = async () => {
    if (pw.next !== pw.again) return setErr("Hai mật khẩu chưa khớp.");
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: pw.next }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Lỗi ${r.status}`);
      setDone(true);
      history.replaceState(null, "", "/reset");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <LegalDoc title="Đặt lại mật khẩu" updated="04/11/2026">
      {done ? <p>Mật khẩu đã được đặt lại. Mọi thiết bị đã được đăng xuất. <Link href="/">Đăng nhập</Link></p>
        : token === "" ? <p role="alert">Đường dẫn này thiếu mã đặt lại. Hãy mở đúng đường dẫn quản trị viên đã gửi.</p>
        : (
          <form style={{ display: "grid", gap: 10, maxWidth: 360 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input className="field" type="password" autoComplete="new-password" autoFocus aria-label={tr("Mật khẩu mới")} placeholder={tr("Mật khẩu mới")} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <input className="field" type="password" autoComplete="new-password" aria-label={tr("Nhập lại mật khẩu mới")} placeholder={tr("Nhập lại mật khẩu mới")} value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
            {err && <p className="auth-field-err" role="alert" style={{ margin: 0 }}>{tr(err)}</p>}
            <button className="btn dark" disabled={busy || pw.next.length < 8 || !token}>{busy ? "Đang lưu…" : "Lưu mật khẩu mới"}</button>
          </form>
        )}
    </LegalDoc>
  );
}
