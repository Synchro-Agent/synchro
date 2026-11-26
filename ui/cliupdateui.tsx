"use client";
import "./styles/settings.css";
// Cài đặt → Providers → CLI updates (chỉ quản trị viên xem; bật / tắt, "Cập nhật ngay", trả về bản trước chỉ chủ sở hữu): bộ cập nhật CLI
// của các gói (server/ai/cliupdate.ts). Mỗi CLI: bản đang chạy, kết quả lần cập nhật gần nhất, bản trước để trả lại, đang theo dõi lượt đầu.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { call, ago, fmtDate } from "./adminui";
import { refreshModels } from "./models";
import { tr } from "./i18n";
import { Spinner } from "./spinner";

type Outcome = "updated" | "same" | "failed" | "smoke_failed" | "skipped" | "rolled_back" | "not_installed";
type Result = { cli: string; outcome: Outcome; from: string | null; to: string | null; detail: string; at: number };
type Row = { cli: string; name: string; installed: boolean; version: string | null; managed: boolean; prev: string | null; canRollback: boolean; probation: { ok: number; fail: number } | null; last: Result | null; bad: string[] };
type View = { on: boolean; envOff: boolean; running: boolean; lastRun: number | null; nextAt: number | null; clis: Row[]; owner: boolean };

const BADGE: Record<Outcome, [string, string]> = {
  updated: ["Updated", "ok"], same: ["Up to date", "ok"], failed: ["Update failed", "bad"], smoke_failed: ["New version failed its check", "bad"],
  skipped: ["Skipped", "old"], rolled_back: ["Rolled back", "wait"], not_installed: ["Not installed", "old"],
};

function Switch({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)} />;
}

function CliRow({ r, owner, busy, back }: { r: Row; owner: boolean; busy: boolean; back: (cli: string) => void }) {
  const [label, cls] = !r.installed ? BADGE.not_installed : r.probation ? ["Watching first chats", "wait"] : r.last ? BADGE[r.last.outcome] : ["Not checked yet", "old"];
  return (
    <div className="mr-row">
      <div className="mr-main">
        <div className="mr-name"><b>{r.name}</b><span className={`api-badge ${cls}`}><i />{label}</span></div>
        <div className="mr-key"><span className="mono-s" data-notr>{r.version ?? "—"}</span></div>
        <div className="mr-meta">
          {r.last && <span>Checked <span data-notr>{ago(r.last.at)}</span></span>}
          {r.prev && <span>Previous <span className="mono-s" data-notr>{r.prev}</span></span>}
          {r.probation && <span>First chats on this version: <span data-notr>{`${r.probation.ok} ✓ · ${r.probation.fail} ✗`}</span></span>}
        </div>
        {r.last && r.last.outcome !== "same" && r.last.detail && <div className={r.last.outcome === "failed" || r.last.outcome === "smoke_failed" ? "api-err in mr-err" : "d cu-detail"}>{r.last.outcome === "failed" || r.last.outcome === "smoke_failed" ? <><I.Alert size={14} /><span>{r.last.detail}</span></> : <span>{r.last.detail}</span>}</div>}
      </div>
      {r.canRollback && owner && <div className="mr-acts"><button className="btn" disabled={busy} onClick={() => back(r.cli)}>Roll back</button></div>}
    </div>
  );
}

export function CliUpdates() {
  const app = useApp();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const was = useRef(false);
  const load = useCallback(() => call<View>("GET", "/api/admin/cliupdate").then((x) => { setV(x); setErr(""); return x; }).catch((e) => { setErr((e as Error).message); return null; }), []);
  useEffect(() => { void load(); }, [load]);
  // Đang cập nhật (cài từng CLI mất tới vài phút): hỏi lại mỗi 3 giây tới khi xong, rồi đọc lại danh sách model (bản mới có thể có model mới).
  useEffect(() => {
    if (!v?.running) { if (was.current) { was.current = false; refreshModels(); app.say("CLI update finished. Results are below and in your Inbox"); } return; }
    was.current = true;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [v?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { setV(await call<View>("POST", "/api/admin/cliupdate", body)); } catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };
  // Quay về bản trước không xóa gì và cập nhật lại được: nút chính thường, màu đỏ chỉ để báo xóa / gỡ / thu hồi.
  const backWhy = [
    "Everyone goes back to the version that ran before the last update.", "Plan sign-ins stay as they are.",
    "Weekly updates skip this version from now on.",
  ].map((x) => tr(x)).join(" ");
  const back = (cli: string) => app.confirm("Roll back to the previous version?", backWhy, "Roll back",
    () => void post({ action: "rollback", cli }), { safe: true });
  if (err) return <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>;
  if (!v) return <p className="pv-note">Loading…</p>;
  const lock = !v.owner || v.envOff;
  return (
    <div className="mr">
      <div className="api-card mr-head">
        <div className="mr-auto">
          <div className="mr-auto-t">
            <b>Update plan CLIs every week</b>
            <span className="d">Around 04:00 server time, Synchro installs the newest Claude Code, Codex, Antigravity and Grok CLI next to the current ones and checks each new version with an administrator&apos;s existing sign-in (no chat, no plan usage). It switches only if the check passes and keeps the previous version. If the first real chats fail, Synchro switches back on its own. Plan sign-ins are never touched.</span>
          </div>
          <Switch on={v.on && !v.envOff} set={(on) => void post({ action: "auto", on })} label="Update plan CLIs every week" disabled={busy || lock} />
        </div>
        <div className="mr-check">
          <span className="d">{v.running ? "Installing and checking new versions…" : <>{v.lastRun ? <>Last run <span data-notr>{ago(v.lastRun)}</span>. </> : "Not run yet. "}{v.nextAt ? <>Next run <span data-notr>{fmtDate(v.nextAt)}</span>.</> : null}</>}</span>
          <button className="btn dark" disabled={busy || lock
            || v.running} onClick={() => void post({ action: "run" })}>{v.running
            ? <><Spinner className="api-spin" />Updating…</> : <><I.Retry size={14} />Update now</>}</button>
        </div>
        {v.envOff && <p className="api-own"><I.Lock size={12} /><span>Turned off on this server (SYNCHRO_CLI_AUTOUPDATE=0).</span></p>}
        {!v.owner && !v.envOff && <p className="api-own"><I.Lock size={12} /><span>Only the Owner can turn weekly updates on or off, update now or roll back, since this installs software on the server for everyone.</span></p>}
      </div>
      <div className="mr-list">{v.clis.map((r) => <CliRow key={r.cli} r={r} owner={v.owner} busy={busy || v.running} back={back} />)}</div>
    </div>
  );
}
