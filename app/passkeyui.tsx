"use client";

// Cài đặt → Tài khoản → Bảo mật: thêm, đổi tên, xóa khóa truy cập (server/passkeys.ts). Đăng nhập bằng khóa nằm ở trang đăng nhập (auth.tsx).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { call as api, ago, fmtDate } from "./adminui";
import { passkeyCancelled, passkeyRegister, passkeySupported } from "./passkeyclient";
import { useStepUp } from "./stepup";
import { useApp } from "./store";
import { Fade } from "./ui";
import * as I from "./icons";

type Key = { id: string; name: string; createdAt: number; lastUsedAt: number | null; synced: boolean };
type RowT = (p: { t: React.ReactNode; d?: React.ReactNode; children?: React.ReactNode }) => React.ReactNode;

export function PasskeyRows({ Row, onChange }: { Row: RowT; onChange?: () => void }) {
  const app = useApp();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [ok] = useState(passkeySupported);
  const step = useStepUp();
  useEffect(() => { void api<{ passkeys: Key[] }>("GET", "/api/auth/passkey").then((r) => setKeys(r.passkeys)).catch(() => setKeys([])); }, []);
  const got = (list: Key[]) => { setKeys(list); onChange?.(); };
  const add = async () => {
    if (busy) return;
    setBusy(true);
    // Phiên không còn mới: máy chủ đòi xác minh lại (403 { reauth: true }), hộp xác minh hỏi mật khẩu / khóa rồi chạy lại.
    try { const r = await step.run((p) => passkeyRegister<{ passkeys: Key[] }>(p)); if (r) { got(r.passkeys); app.say("Passkey added"); } }
    catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") app.say("This device already has a passkey for your account");
      else if (!passkeyCancelled(e)) app.say((e as Error).message || "Couldn't add the passkey");
    } finally { setBusy(false); }
  };
  const rename = async () => {
    if (!edit || !edit.name.trim() || busy) return;
    setBusy(true);
    try { got((await api<{ passkeys: Key[] }>("POST", "/api/auth/passkey", { op: "rename", id: edit.id, name: edit.name })).passkeys); setEdit(null); app.say("Passkey renamed"); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };
  const remove = (k: Key) => app.confirm("Remove this passkey?", "You won't be able to sign in with it anymore. The copy saved on your device stays until you delete it there.", "Remove", async () => {
    try { got((await api<{ passkeys: Key[] }>("POST", "/api/auth/passkey", { op: "delete", id: k.id })).passkeys); app.say("Passkey removed"); }
    catch (e) { app.say((e as Error).message); }
  });

  return <>
    <Row t="Passkeys" d={ok ? "Sign in with your fingerprint, face or device PIN instead of a password. Passkeys can't be phished or reused on another site." : "This browser can't create passkeys. Try a recent version of Chrome, Safari, Edge or Firefox."}>
      <button className="btn" disabled={!ok || busy || keys === null} onClick={() => void add()}>{busy && !edit ? <span className="api-spin" /> : <><I.Plus size={14} />Add passkey</>}</button>
    </Row>
    {keys && keys.length > 0 && <div className="pk-list" role="list" aria-label="Passkeys">
      {keys.map((k) => (
        <div key={k.id} className="pk-item" role="listitem">
          <span className="pk-ic" aria-hidden><I.Key size={16} /></span>
          <div className="pk-main">
            <div className="pk-name"><span data-notr>{k.name}</span>{k.synced && <span className="adm-chip">Synced</span>}</div>
            <div className="pk-meta"><span>Added</span> <span data-notr>{fmtDate(k.createdAt)}</span><span aria-hidden> · </span>{k.lastUsedAt ? <><span>Last used</span> <span data-notr>{ago(k.lastUsedAt)}</span></> : <span>Not used yet</span>}</div>
          </div>
          <div className="pk-act">
            <button className="btn sm" onClick={() => setEdit({ id: k.id, name: k.name })}>Rename</button>
            <button className="btn sm" onClick={() => remove(k)}>Remove</button>
          </div>
        </div>
      ))}
    </div>}
    {typeof document !== "undefined" && createPortal(<Fade show={!!edit}>{edit ? <div className="overlay" style={{ zIndex: "var(--z-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
      <div className="modal sm" style={{ width: "min(400px, 92vw)" }} role="dialog" aria-label="Rename passkey">
        <h2 style={{ fontSize: "var(--fs-4)" }}>Rename passkey</h2>
        <p className="d">Use a name that tells you which device or password manager holds it.</p>
        <input className="field" autoFocus aria-label="Passkey name" maxLength={60} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void rename()} />
        <div className="modal-foot"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn dark" disabled={!edit.name.trim() || busy} onClick={() => void rename()}>Save</button></div>
      </div>
    </div> : null}</Fade>, document.body)}
    {step.node}
  </>;
}
