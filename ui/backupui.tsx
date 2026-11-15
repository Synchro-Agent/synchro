"use client";
import "./styles/settings.css";

// Cài đặt → Sức khỏe hệ thống → Sao lưu liên tục (server/litestream.ts, hướng dẫn cho chủ dịch vụ ở docs/backup-r2.md).
// Khóa bí mật không quay lại trình duyệt: ô để trống nghĩa là giữ khóa đã lưu.
import { useCallback, useEffect, useState } from "react";
import { call, ago, fmtDate } from "./adminui";
import { useApp } from "./store";
import { locale, tf, tr } from "../app/i18n";
import * as I from "./icons";

type St = {
  enabled: boolean; accountId: string; bucket: string; accessKeyId: string; hasSecret: boolean; prefix: string; testReplica: boolean; binary: string | null;
  running: boolean; pid: number | null; startedAt: number | null; restarts: number; errors: { at: number; level: string; msg: string; resolved?: boolean }[]; hint?: string | null;
  localTxid: string | null; replicaTxid: string | null; lastSyncAt: number | null; walSize: string | null; statusError: string | null; lagTx: number | null; lagSec: number | null;
  owner?: boolean;
};
type Drill = { ok: boolean; ms: number; integrity: string; sizeMB: number; txid: string | null; tables: { name: string; restored: number | null; live: number | null }[]; error?: string };
type ToggleT = (p: { on: boolean; set: (v: boolean) => void; label?: string; disabled?: boolean }) => React.ReactElement;

function Kv({ k, v, bad }: { k: string; v: React.ReactNode; bad?: boolean }) {
  return <div className="adm-kv"><span>{k}</span><b data-notr style={bad ? { color: "#c6422f" } : undefined}>{v}</b></div>;
}
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(locale()));
const txid = (t: string | null) => (t ? t.replace(/^0+(?=.)/, "") : "—");

export function ContinuousBackup({ Toggle }: { Toggle: ToggleT }) {
  const app = useApp();
  const [s, setS] = useState<St | null>(null);
  const [f, setF] = useState({ accountId: "", bucket: "", accessKeyId: "", secret: "", prefix: "synchro" });
  const [busy, setBusy] = useState("");
  const [drill, setDrill] = useState<Drill | null>(null);
  const got = (x: St) => { setS(x); setF({ accountId: x.accountId, bucket: x.bucket, accessKeyId: x.accessKeyId, secret: "", prefix: x.prefix }); };
  const load = useCallback(() => call<St>("GET", "/api/admin/backup").then(setS).catch(() => {}), []);
  useEffect(() => { void call<St>("GET", "/api/admin/backup").then(got).catch((e) => app.say(e.message)); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (k: string, body: Record<string, unknown>, ok: string) => {
    if (busy) return;
    setBusy(k);
    try { got(await call<St>("POST", "/api/admin/backup", body)); app.say(ok); } catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  };
  const runDrill = async () => {
    if (busy) return;
    setBusy("drill"); setDrill(null);
    try { setDrill(await call<Drill>("POST", "/api/admin/backup", { action: "drill" })); void load(); } catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  };
  if (!s) return <div className="d" style={{ padding: "8px 0" }}>Loading…</div>;
  const ready = !!(s.accountId && s.bucket && s.accessKeyId && s.hasSecret) || s.testReplica;
  const dirty = f.accountId !== s.accountId || f.bucket !== s.bucket || f.accessKeyId !== s.accessKeyId || !!f.secret || f.prefix !== s.prefix;
  const stale = s.enabled && s.lagSec !== null && s.lagTx !== null && s.lagTx > 0 && s.lagSec > 300;
  // Lưu / gỡ cấu hình R2 và bật / tắt chỉ chủ sở hữu (máy chủ cũng chặn); quản trị viên vẫn xem trạng thái và chạy thử khôi phục.
  const own = s.owner !== false;
  // Lỗi đã hết sau một lần đồng bộ thành công (vd. vừa sửa quyền token) không làm nhãn thành "có lỗi".
  const openErrs = s.errors.filter((e) => !e.resolved), oldErrs = s.errors.filter((e) => e.resolved);
  const state = !s.enabled ? "Off" : !s.binary ? "Not installed" : s.running ? (openErrs.length && openErrs[0].at > Date.now() - 10 * 60_000 ? "Running with errors" : "Running") : "Stopped";
  return <>
    <p className="d adm-privacy"><I.Retry size={14} />Streams every change to the database to your Cloudflare R2 bucket within seconds, so a lost server loses at most a few seconds of data. Nightly backups keep running as before. Setup steps are in docs/backup-r2.md.</p>
    <div className="adm-card bk-card">
      <div className="adm-card-h"><b>Continuous backup to Cloudflare R2</b><span className={`s-badge ${state === "Running" ? "ok" : ""}`}>{state}</span></div>
      {!s.binary && <p className="d bk-warn" role="status">This server doesn&apos;t have litestream yet. Run workspace/setup.sh on the server (every deploy runs it) and it installs a pinned, checksum-verified copy.</p>}
      {s.testReplica && <p className="d bk-warn">Test mode: replicating to a local folder instead of R2.</p>}
      {!own && <p className="api-own top"><I.Lock size={13} /><span>Only the Owner can change the R2 settings or turn continuous backup on or off. You can still check its status and test a restore.</span></p>}
      <div className="bk-grid">
        <label><span>Account ID</span><input className="field" spellCheck={false} autoComplete="off" disabled={!own} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value.trim() })} data-notr /></label>
        <label><span>Bucket</span><input className="field" spellCheck={false} autoComplete="off" placeholder="synchro-backup" disabled={!own} value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value.trim() })} data-notr /></label>
        <label><span>Access Key ID</span><input className="field" spellCheck={false} autoComplete="off" disabled={!own} value={f.accessKeyId} onChange={(e) => setF({ ...f, accessKeyId: e.target.value.trim() })} data-notr /></label>
        <label><span>Secret Access Key</span><input className="field" type="password" spellCheck={false} autoComplete="new-password" placeholder={s.hasSecret ? "Saved. Paste a new key to replace it." : ""} disabled={!own} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
        <label><span>Folder in the bucket</span><input className="field" spellCheck={false} autoComplete="off" disabled={!own} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.trim() })} data-notr /></label>
      </div>
      <div className="modal-foot bk-foot">
        {own && (s.accountId || s.hasSecret) && <button className="btn" disabled={!!busy} onClick={() => app.confirm("Remove the R2 settings?", "Continuous backup stops and the keys are deleted from this server. Copies already in your bucket stay there.", "Remove", () => void act("clear", { action: "clear" }, "R2 settings removed"))}>Remove</button>}
        <button className="btn dark" disabled={!own || !dirty || !!busy} onClick={() => void act("save", { action: "save", ...f }, "Backup settings saved")}>{busy === "save" ? <span className="api-spin" /> : "Save"}</button>
      </div>
      <div className="adm-perm-row">
        <div><div className="t">Back up continuously</div><div className="d">Runs litestream next to Synchro. It restarts on its own if it stops.</div></div>
        <Toggle on={s.enabled} label="Back up continuously" disabled={!own} set={(v) => { if (v && !ready) { app.say("Fill in Account ID, bucket, Access Key ID and Secret Access Key first"); return; } void act("toggle", { action: "save", enabled: v }, v ? "Continuous backup on" : "Continuous backup off"); }} />
      </div>
      {(s.enabled || s.replicaTxid) && <>
        <Kv k="Last sync to R2" v={s.lastSyncAt ? `${ago(s.lastSyncAt)} (${fmtDate(s.lastSyncAt)})` : "—"} bad={stale} />
        <Kv k="Behind the live database" v={s.lagTx === null ? "—" : s.lagTx === 0 ? tr("Đã bắt kịp") : `${tf("{n} giao dịch", { n: num(s.lagTx) })}${s.lagSec !== null ? ` · ${tf("{n} giây", { n: num(s.lagSec) })}` : ""}`} bad={stale} />
        <Kv k="Generation (latest TXID in R2 / on this server)" v={`${txid(s.replicaTxid)} / ${txid(s.localTxid)}`} />
        {s.walSize && <Kv k="Write-ahead log" v={s.walSize} />}
        <Kv k="Restarts since the web app started" v={num(s.restarts)} bad={s.restarts > 3} />
        {s.statusError && <Kv k="Status check" v={s.statusError} bad />}
      </>}
      {s.hint && <p className="d bk-warn" role="status">{s.hint}</p>}
      {openErrs.length > 0 && <div className="bk-errs">{openErrs.slice(0, 5).map((e, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }} data-notr><span className="adm-chip">{e.level}</span> {e.msg}</span></div>)}</div>}
      {oldErrs.length > 0 && <details className="bk-errs bk-old"><summary className="d"><span>Earlier errors (fixed by a later successful sync)</span> · <span data-notr>{oldErrs.length}</span></summary>{oldErrs.slice(0, 5).map((e, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere", opacity: 0.7 }}><span className="adm-chip">Fixed</span> <span data-notr>{e.msg}</span></span></div>)}</details>}
      <div className="adm-perm-row">
        <div><div className="t">Test restore</div><div className="d">Restores the newest copy from R2 into a temporary file, checks it with PRAGMA integrity_check, counts rows in the main tables, then deletes it. The live database isn&apos;t touched.</div></div>
        <button className="btn" disabled={!ready || !s.binary || !!busy} onClick={() => void runDrill()}>{busy === "drill" ? <span className="api-spin" /> : "Test restore"}</button>
      </div>
      {drill && <div className={`bk-drill ${drill.ok ? "ok" : "bad"}`} role="status">
        <p><b>{drill.ok ? "Restore works" : "Restore failed"}</b> <span data-notr>{`· ${(drill.ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} s · ${drill.sizeMB.toLocaleString(locale())} MB · integrity_check: ${drill.integrity}`}</span></p>
        {drill.error && <p className="d" data-notr>{drill.error}</p>}
        {drill.tables.length > 0 && <table className="tbl bk-tbl"><thead><tr><th>Table</th><th>Restored</th><th>Live now</th></tr></thead><tbody>
          {drill.tables.filter((t) => t.live !== null || t.restored !== null).map((t) => <tr key={t.name}><td className="mono" data-notr>{t.name}</td><td data-notr>{num(t.restored)}</td><td data-notr>{num(t.live)}</td></tr>)}
        </tbody></table>}
        <p className="d">Live counts can be a little higher: they include changes from the last few seconds.</p>
      </div>}
    </div>
  </>;
}
