"use client";

// Cài đặt → Quản trị viên → Đăng nhập: Cloudflare Turnstile (dán khóa để bật) và chặn email dùng một lần (app/turnstile.ts).
// Khóa bí mật không bao giờ quay lại trình duyệt: ô để trống nghĩa là giữ khóa đã lưu.
import { useState } from "react";

export type TurnstileState = { on: boolean; siteKey: string; hasSecret: boolean; loginAfter: number; blockDisposable: boolean };
type ToggleT = (p: { on: boolean; set: (v: boolean) => void; label?: string }) => React.ReactElement;

export function BotProtection({ s, act, call, Toggle }: { s: TurnstileState; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; call: (m: string, u: string, b?: unknown) => Promise<unknown>; Toggle: ToggleT }) {
  const [site, setSite] = useState(s.siteKey);
  const [secret, setSecret] = useState("");
  const [after, setAfter] = useState(String(s.loginAfter));
  const dirty = site.trim() !== s.siteKey || !!secret.trim() || Number(after) !== s.loginAfter;
  const save = () => act(() => call("PATCH", "/api/admin/settings", { turnstile: { siteKey: site.trim(), secret: secret.trim(), loginAfter: Number(after) } }).then(() => setSecret("")), "Bot protection saved");
  const clear = () => act(() => call("PATCH", "/api/admin/settings", { turnstile: { clear: true } }).then(() => { setSite(""); setSecret(""); }), "Bot protection turned off");
  return <>
    <div className="adm-card bot-card">
      <div className="adm-card-h"><b>Bot protection (Cloudflare Turnstile)</b><span className={`s-badge ${s.on ? "ok" : ""}`}>{s.on ? "On" : "Off"}</span></div>
      <p className="d" style={{ margin: "0 0 10px" }}>Free from Cloudflare. Asks for a quick human check when someone signs up, requests a password reset, or keeps entering the wrong password. Most people see nothing. In the Cloudflare dashboard, open Turnstile, add a widget for this domain in Managed or Invisible mode, then paste both keys here. Until both are saved, nothing changes.</p>
      <label className="bot-l" htmlFor="ts-site">Site key</label>
      <input id="ts-site" className="field" autoComplete="off" spellCheck={false} placeholder="0x4AAAAAAA…" value={site} onChange={(e) => setSite(e.target.value)} data-notr />
      <label className="bot-l" htmlFor="ts-secret">Secret key</label>
      <input id="ts-secret" className="field" type="password" autoComplete="new-password" spellCheck={false} placeholder={s.hasSecret ? "Saved. Paste a new key to replace it." : "0x4AAAAAAA…"} value={secret} onChange={(e) => setSecret(e.target.value)} />
      <div className="adm-perm-row">
        <div><div className="t">Ask at sign-in after</div><div className="d">Failed password attempts from one address within 15 minutes.</div></div>
        <input className="field adm-num" inputMode="numeric" aria-label="Ask at sign-in after" value={after} onChange={(e) => setAfter(e.target.value.replace(/\D/g, "").slice(0, 2))} />
      </div>
      <div className="modal-foot" style={{ marginTop: 10 }}>
        {(s.siteKey || s.hasSecret) && <button className="btn" onClick={() => void clear()}>Turn off and remove keys</button>}
        <button className="btn dark" disabled={!dirty || !site.trim() || (!s.hasSecret && !secret.trim()) || !(Number(after) >= 1 && Number(after) <= 20)} onClick={() => void save()}>Save</button>
      </div>
    </div>
    <div className="row">
      <div><div className="t">Block disposable email addresses</div><div className="d">Refuse sign-ups from throwaway inbox services (about 10,000 domains, public-domain list bundled with Synchro). Sign-in with Google, GitHub or Apple isn&apos;t affected.</div></div>
      <Toggle on={s.blockDisposable} label="Block disposable email addresses" set={(v) => void act(() => call("PATCH", "/api/admin/settings", { blockDisposable: v }), "Saved")} />
    </div>
  </>;
}
