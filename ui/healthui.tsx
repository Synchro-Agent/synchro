"use client";
import "../app/settings.css";

// Cài đặt → Sức khỏe hệ thống: quản trị viên thấy ngay máy chủ có ổn không mà không phải vào SSH. Không có nội dung chat. Số liệu từ /api/admin/health (server/ops.ts).
import { useCallback, useEffect, useState } from "react";
import { call, ago, fmtDate } from "./adminui";
import { useApp } from "./store";
import { getLang, locale, tf, tr, trc } from "../app/i18n";
import * as I from "./icons";
import type { MemSample } from "../server/memstat";
import type { LoopSample } from "../server/loopdelay";
import type { BackupStatus, Problem, WatchdogState } from "../server/ops";
import { ContinuousBackup } from "./backupui";
import { LatencyTable, type Latency } from "./latencyui";
import { SettingsSkeleton } from "./skeleton";

type Disk = { key: string; path: string; freeMB: number; totalMB: number };
type Health = {
  now: number; build: string; uptimeSec: number; agent: boolean | null; problems: Problem[]; engines: { engine: string; ok: number; fail: number; auth: number }[]; disks: Disk[]; boots24: number; lastBootAt: number | null;
  runs24: number; runsFailed24: number; errors24: number; errors: { id: number; at: number; first_at: number; source: string; detail: string; n: number }[];
  clientErrors: { id: number; at: number; source: string; detail: string; n: number }[]; client24: number;
  turns: { running: number; waiting: number; peak: number; waited: number; refused: number; limit: number; perAccount: number }; isolation: { bwrap: boolean; engineUser: boolean };
  storage: { dbMB: number; uploadsMB: number; outputsMB: number };
  mail: { sent24: number; sent7: number; failed24: number; failed7: number; lastOkAt: number | null; lastFailAt: number | null; smtp: boolean; failures: { at: number; source: string; detail: string; n: number }[] };
  dns: { domain: string; spf: boolean; dkim: boolean; dmarc: boolean } | null;
  cli: { source: string; users24: number; users7: number; n24: number; n7: number; last: number }[]; cliRecent: { at: number; source: string; n: number; email: string | null }[];
  csp: { at: number; source: string; detail: string; n: number }[];
  backup: BackupStatus | null; watchdog: WatchdogState | null; wdEvents: { at: number; event: string; detail?: string }[];
  latency?: Latency;
  mem?: { now: MemSample; history: MemSample[]; caches: Record<string, Record<string, number>>; heapLimit: number };
  // Độ trễ vòng lặp sự kiện (server/loopdelay.ts): mẫu 60 giây gần nhất; null khi bộ đo chưa bật.
  loop?: (LoopSample & { live: boolean }) | null;
};
// Bộ đệm lớn trong bộ nhớ máy chủ (server/memstat.ts): tên dễ hiểu cho quản trị viên.
const CACHE: Record<string, string> = { skillIndex: "Skill index", brainRecall: "Brain recall index", codeRuns: "Synchro Code runs kept", pluginZips: "Downloaded plugin packages", artImages: "Artifact images", d2Svgs: "D2 diagrams", approvals: "Replies waiting for approval", vectors: "Semantic search vectors" };
// Đơn vị của từng số đếm trong bộ nhớ đệm: mẫu "{n} …" dịch bằng tf (MB, KB giữ nguyên).
const UNIT: Record<string, string> = { skills: "{n} skill", words: "{n} từ", vocab: "{n} từ", building: "{n} đang dựng", n: "{n} mục", users: "{n} người", docs: "{n} ghi chú", pending: "{n} đang chờ", runs: "{n} lượt", sets: "{n} bộ đang nạp", vectors: "{n} vector", embedded: "{n} mục đã embed", calls: "{n} lần gọi API", skippedCap: "{n} lần dừng vì hạn mức", errors: "{n} lỗi", rejected: "{n} mục bị hãng từ chối", queryTimeouts: "{n} câu hỏi quá thời gian", queued: "{n} đang xếp hàng" };
const UNIT_SAME: Record<string, string> = { MB: "MB", kb: "KB" };
// Dấu · dính vào chữ trước (khoảng trắng không ngắt): giá trị xuống dòng (768px, nhãn giữ tới 45% hàng) thì dấu · không đứng đầu dòng mới.
const cacheText = (v: Record<string, number>) => Object.entries(v).map(([a, b]) => (UNIT[a] ? tf(UNIT[a], { n: b.toLocaleString(locale()) }) : `${b.toLocaleString(locale())} ${UNIT_SAME[a] ?? a}`)).join("\u00a0· ");
const CLI: Record<string, string> = { claude: "Claude", codex: "ChatGPT", agy: "Gemini", grok: "Grok" };
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB` : `${mb.toLocaleString(locale())} MB`);
// Loại thư gửi lỗi: tên một loại thư ("Password reset"), không phải nhãn nút ("Reset your password"), nên mỗi loại một khóa ngữ cảnh "loại thư".
const mailKind = (k: string): string => {
  switch (k) {
    case "reset": return trc("Đặt lại mật khẩu", "loại thư");
    case "changed": return trc("Báo đổi mật khẩu", "loại thư");
    case "verify": return trc("Xác minh email", "loại thư");
    case "signup_taken": return trc("Báo đăng ký trùng", "loại thư");
    case "alert": return trc("Cảnh báo", "loại thư");
    case "test": return trc("Thư thử", "loại thư");
    default: return trc("Khác", "loại thư");
  }
};
const WD: Record<string, string> = { restart: "Đã khởi động lại web", restart_failed: "Khởi động lại không thành công", gave_up: "Dừng tự khởi động lại: lặp lại quá nhiều, cần xử lý tay", down: "Web không trả lời", recovered: "Web trả lời lại", degraded: "Web trả lời nhưng báo có phần lỗi (đĩa hoặc dịch vụ workspace)", installed: "Đã cài watchdog" };

function problemText(p: Problem) {
  const n = (p.n ?? 0).toLocaleString(locale());
  if (p.code.startsWith("engine_fail:")) return tf("{engine}: {n} lượt lỗi trong một giờ qua, nhiều hơn số lượt thành công.", { engine: p.code.slice(12), n });
  switch (p.code) {
    case "disk_crit": return tf("Đĩa chỉ còn {free} trống: tệp tải lên mới bị từ chối, và cơ sở dữ liệu sẽ ngừng ghi nếu đầy hẳn.", { free: gb(p.n ?? 0) });
    case "disk_low": return tf("Đĩa còn {free} trống. Nên dọn hoặc mở rộng sớm.", { free: gb(p.n ?? 0) });
    case "mail_failing": return tf("{n} thư gửi lỗi trong 24 giờ qua và chưa có thư nào gửi được sau đó. Email đặt lại mật khẩu và xác minh có thể không tới người dùng.", { n });
    case "backup_none": return tr("Chưa có báo cáo sao lưu nào. Sao lưu chưa chạy trên máy này, hoặc chưa có lần chạy đầu tiên (03:00 hằng đêm).");
    case "backup_failed": return tr("Lần sao lưu gần nhất thất bại. Xem chi tiết ở mục Sao lưu.");
    case "backup_stale": return tr("Không có bản sao lưu mới trong hơn 36 giờ.");
    case "backup_integrity": return tr("Bản sao lưu mới nhất không qua kiểm tra toàn vẹn.");
    case "backup_corrupt": return tf("{n} tệp tải lên trong bản sao lưu mới nhất không khớp mã băm: nội dung đã hỏng.", { n });
    case "backup_key": return tr("Khóa mã hóa trong bản sao lưu mới nhất không mở được dữ liệu đã mã hóa: khôi phục từ bản này sẽ mất token và đăng nhập đã lưu.");
    case "backup_uploads": return tf("Bản sao lưu mới nhất thiếu {n} tệp tải lên so với cơ sở dữ liệu.", { n });
    case "watchdog_off": return tr("Watchdog không chạy: web chết sẽ không tự khởi động lại ngoài pm2. Chạy lại workspace/setup.sh trên máy chủ.");
    case "watchdog_restarts": return tf("Watchdog đã khởi động lại web {n} lần trong 24 giờ qua.", { n });
    case "cli_auth": return tf("{n} người bị hãng từ chối đăng nhập gói AI trong 24 giờ qua. Có thể CLI hoặc hãng vừa đổi gì đó.", { n });
    case "errors_many": return tf("{n} lỗi máy chủ trong 24 giờ qua.", { n });
    default: return p.code;
  }
}

function Kv({ k, v, bad, wrap }: { k: string; v: React.ReactNode; bad?: boolean; wrap?: boolean }) {
  return <div className={`adm-kv${wrap ? " wrap" : ""}`}><span>{k}</span><b data-notr style={bad ? { color: "#c6422f" } : undefined}>{v}</b></div>;
}

export function HealthPanel({ Toggle }: { Toggle: (p: { on: boolean; set: (v: boolean) => void; label?: string; disabled?: boolean }) => React.ReactElement }) {
  const app = useApp();
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; to: string; ms: number; error?: string } | null>(null);
  const load = useCallback(() => call<Health>("GET", "/api/admin/health").then((x) => { setH(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  const sendTest = async () => {
    setSending(true); setTest(null);
    try { setTest(await call("POST", "/api/admin/health", { action: "mail_test", lang: getLang() })); await load(); } catch (e) { app.say((e as Error).message); } finally { setSending(false); }
  };

  if (err) return <div className="empty" style={{ marginTop: 80 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!h) return <SettingsSkeleton />;

  const low = Math.min(...h.disks.map((d) => d.freeMB), Infinity);
  const b = h.backup, w = h.watchdog;
  const stats: [string, string, boolean?][] = [
    ["Free disk", Number.isFinite(low) ? gb(low) : "—", low < 5000], ["Database", gb(h.storage.dbMB)], ["Uploads", gb(h.storage.uploadsMB)], ["Generated files", gb(h.storage.outputsMB)],
    ["Server errors (24h)", h.errors24.toLocaleString(locale()), h.errors24 >= 200], ["Replies failed (24h)", `${h.runsFailed24.toLocaleString(locale())} / ${h.runs24.toLocaleString(locale())}`, h.runsFailed24 * 5 > h.runs24 && h.runsFailed24 > 2],
    ["Emails failed (24h)", h.mail.failed24.toLocaleString(locale()), h.mail.failed24 > 0], ["Web restarts (24h)", Math.max(0, h.boots24).toLocaleString(locale()), h.boots24 > 3],
    ["Browser errors (24h)", h.client24.toLocaleString(locale())],
    // Độ trễ vòng lặp sự kiện, p99 của phút vừa qua: trên 100 ms là có việc đồng bộ chặn mọi người dùng cùng lúc.
    ...(h.loop ? [["Event-loop delay (p99)", `${h.loop.p99.toLocaleString(locale(), { maximumFractionDigits: 1 })} ms`, h.loop.p99 > 100] as [string, string, boolean]] : []),
    ...(h.mem ? [["Server memory (heap)", `${gb(h.mem.now.heapUsed)} / ${gb(h.mem.heapLimit)}`, h.mem.now.heapUsed > h.mem.heapLimit * 0.75] as [string, string, boolean]] : []),
    // Lượt model cùng lúc so với trần cả máy; có lượt phải chờ nghĩa là trần đang chạm thật.
    ["Replies running now", `${h.turns.running} / ${h.turns.limit}`, h.turns.running >= h.turns.limit], ["Replies waiting now", h.turns.waiting.toLocaleString(locale()), h.turns.waiting > 0], ["Refused, queue full (since restart)", h.turns.refused.toLocaleString(locale()), h.turns.refused > 0],
    ["CLI isolation", h.isolation.engineUser && h.isolation.bwrap ? tr("User riêng, sandbox bật") : h.isolation.engineUser ? tr("User riêng, sandbox tắt") : trc("Tắt", "cách ly CLI"), !(h.isolation.engineUser && h.isolation.bwrap)],
  ];
  const dnsRow = (k: string, ok: boolean) => <span key={k} className={`s-badge ${ok ? "ok" : ""}`} style={{ marginLeft: 6 }} data-notr>{k} {ok ? "✓" : "✗"}</span>;

  return (
    <>
      <div className="adm-head">
        <div className="adm-badge"><I.Alert size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s-title">System health</div>
          <div className="d">What is happening on this server right now. It contains no chat content; error lines have email addresses and tokens removed.</div>
          <div className="d" style={{ marginTop: 4 }} data-notr>{`build ${h.build} · ${h.uptimeSec >= 86400 ? tf("chạy được {n} ngày", { n: Math.floor(h.uptimeSec / 86400) }) : h.uptimeSec >= 3600 ? tf("chạy được {n} giờ", { n: Math.floor(h.uptimeSec / 3600) }) : tf("chạy được {n} phút", { n: Math.floor(h.uptimeSec / 60) })}`}</div>
        </div>
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load}><I.Retry size={16} /></button>
      </div>

      {h.problems.length > 0 ? (
        <div className="adm-card" role="status">
          <div className="adm-card-h"><b>Needs attention</b></div>
          {h.problems.map((p) => <div key={p.code} className="adm-perm-row"><div className="d" data-notr style={p.level === "crit" ? { color: "#c6422f" } : undefined}>{problemText(p)}</div><span className={`s-badge`} style={{ marginLeft: 12 }}>{p.level === "crit" ? "Urgent" : "Worth a look"}</span></div>)}
        </div>
      ) : <p className="d adm-privacy"><I.Check size={14} />Nothing needs attention right now.</p>}

      <div className="adm-stats" style={{ marginTop: 12 }}>
        {stats.map(([l, n, warn]) => <div key={l} className={`adm-stat ${warn ? "warn" : ""}`}><b data-notr>{n}</b><span>{l}</span></div>)}
      </div>

      {h.latency && <>
        <h3 className="sec">Reply latency by stage</h3>
        <p className="d adm-privacy"><I.Retry size={14} />How long each part of a chat reply takes on this server, from the sign-in check to the last word. Measured on every reply; no chat content is kept. Each reply is also written to the server log as an OpenTelemetry span, ready to export later.</p>
        <LatencyTable data={h.latency} />
      </>}

      <h3 className="sec">Disk</h3>
      {h.disks.map((d) => (
        <div key={d.path} className="row">
          <div><div className="t">{d.key === "data" ? "Data disk" : "Workspace disk"}</div><div className="d mono" data-notr>{d.path}</div></div>
          <span className={`s-badge ${d.freeMB >= 5000 ? "ok" : ""}`} data-notr>{tf("{free} trống trên {total}", { free: gb(d.freeMB), total: gb(d.totalMB) })}</span>
        </div>
      ))}
      {h.agent !== null && <div className="row"><div><div className="t">Workspace service</div><div className="d">Runs code and Synchro Code workspaces.</div></div><span className={`s-badge ${h.agent ? "ok" : ""}`}>{h.agent ? "Running" : "Not answering"}</span></div>}

      {h.mem && (() => {
        const m = h.mem, first = m.history[0], hours = first ? (m.now.at - first.at) / 3_600_000 : 0, grew = first ? m.now.heapUsed - first.heapUsed : 0;
        return <>
          <h3 className="sec">Server memory</h3>
          <p className="d adm-privacy"><I.Alert size={14} />Measured every 30 minutes and written to the server log as a [timing] mem line, so slow growth shows up before the server runs out.</p>
          <div className="adm-card">
            <Kv wrap k="Heap used / limit" v={`${gb(m.now.heapUsed)} / ${gb(m.heapLimit)}`} bad={m.now.heapUsed > m.heapLimit * 0.75} />
            <Kv wrap k="Process memory (RSS)" v={gb(m.now.rss)} />
            <Kv wrap k="Outside the heap (external / buffers)" v={`${gb(m.now.external)} / ${gb(m.now.arrayBuffers)}`} />
            {hours >= 1 && <Kv wrap k="Heap change" v={`${grew >= 0 ? "+" : ""}${gb(grew)} ${tf("trong {n} giờ", { n: Math.round(hours) })}`} bad={grew > 300} />}
            {Object.entries(m.caches).map(([k, v]) => <Kv wrap key={k} k={CACHE[k] ?? k} v={cacheText(v)} />)}
          </div>
        </>;
      })()}

      {h.engines?.length > 0 && <>
        <h3 className="sec">Background replies, last 24 hours</h3>
        <div className="adm-card">{h.engines.map((e) => <div key={e.engine} className="adm-kv"><span data-notr>{e.engine}</span><b data-notr style={e.fail || e.auth ? { color: "#c6422f" } : undefined}>{tf("{ok} thành công · {fail} lỗi · {auth} lỗi đăng nhập", { ok: e.ok, fail: e.fail, auth: e.auth })}</b></div>)}</div>
      </>}

      <h3 className="sec">Email</h3>
      <p className="d adm-privacy"><I.Alert size={14} />Synchro can only see failures that happen while sending, when the receiving server refuses outright. A message that is accepted and later bounced or sent to Spam shows as sent, because no inbox receives replies for the no-reply address.</p>
      <div className="adm-card">
        <Kv k="Sent (24h / 7 days)" v={`${h.mail.sent24} / ${h.mail.sent7}`} />
        <Kv k="Failed (24h / 7 days)" v={`${h.mail.failed24} / ${h.mail.failed7}`} bad={h.mail.failed24 > 0} />
        <Kv k="Last delivered to a mail server" v={h.mail.lastOkAt ? ago(h.mail.lastOkAt) : "—"} />
        <Kv k="Last failure" v={h.mail.lastFailAt ? ago(h.mail.lastFailAt) : "—"} />
        <div className="adm-kv"><span>Sending through</span><b>{h.mail.smtp ? "SMTP service" : "This server, directly"}</b></div>
        {h.dns ? <div className="adm-kv"><span>DNS records</span><b>{dnsRow("SPF", h.dns.spf)}{dnsRow("DKIM", h.dns.dkim)}{dnsRow("DMARC", h.dns.dmarc)}</b></div> : null}
        <div className="adm-perm-row">
          <div><div className="t">Send a test email</div><div className="d">Sends to your own address and waits for the receiving server&apos;s answer.</div></div>
          <button className="btn" disabled={sending} onClick={sendTest}>{sending ? <span className="api-spin" /> : "Send test"}</button>
        </div>
        {test && <p className="d" role="status" style={test.ok ? undefined : { color: "#c6422f" }} data-notr>{test.ok
          ? tf("Máy chủ thư của {to} đã nhận thư ({sec} giây). Hãy mở hộp thư để chắc thư không vào Spam.", { to: test.to, sec: (test.ms / 1000).toFixed(1) })
          : tf("Gửi không được: {error}", { error: test.error ?? "" })}</p>}
      </div>
      {h.mail.failures.map((f, i) => (
        <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(f.at)}</span><span><span className="bad" data-notr>{mailKind(f.source)}{f.n > 1 ? ` × ${f.n}` : ""}</span><br /><span className="muted" data-notr>{f.detail}</span></span><span /></div>
      ))}

      <h3 className="sec">AI plan sign-in</h3>
      <p className="d adm-privacy"><I.Lock size={14} />Times a vendor refused someone&apos;s plan sign-in during a chat. Several people on the same plan at once usually means the CLI or the vendor changed something, not that each person needs to act.</p>
      {h.cli.length === 0 ? <div className="d" style={{ padding: "8px 0" }}>No refusals in the last 7 days.</div> : h.cli.map((c) => (
        <div key={c.source} className="row">
          <div><div className="t" data-notr>{CLI[c.source] ?? c.source}</div><div className="d" data-notr>{tf("{users24} người trong 24 giờ, {users7} người trong 7 ngày. Lần cuối {ago}.", { users24: c.users24, users7: c.users7, ago: ago(c.last) })}</div></div>
          <span className={`s-badge ${c.users24 >= 3 ? "" : "ok"}`} data-notr>{c.n24}</span>
        </div>
      ))}
      {h.cliRecent.map((c, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(c.at)}</span><span><span data-notr>{CLI[c.source] ?? c.source}{c.n > 1 ? ` × ${c.n}` : ""}</span><br /><span className="muted" data-notr>{c.email ?? "—"}</span></span><span /></div>)}

      <h3 className="sec">Backups</h3>
      <p className="d adm-privacy"><I.Alert size={14} />{b?.offsite ? "Copies are also pushed off this server." : "Copies are on the same disk as the data. A failed disk or a lost server takes them too, until an off-site destination is set."}</p>
      {!b ? <div className="d" style={{ padding: "8px 0" }}>No backup report yet.</div> : (
        <div className="adm-card">
          <Kv k="Last good backup" v={b.lastOkAt ? `${ago(b.lastOkAt)} (${fmtDate(b.lastOkAt)})` : "—"} bad={!b.lastOkAt || h.now - b.lastOkAt > 36 * 3_600_000} />
          {!b.ok && <Kv k="Last attempt failed" v={`${fmtDate(b.at)}: ${b.error ?? ""}`} bad />}
          <Kv k="Newest snapshot" v={b.snapshot ?? "—"} />
          <Kv k="Size" v={b.sizeMB != null ? gb(b.sizeMB) : "—"} />
          <Kv k="Integrity check of the newest snapshot" v={b.integrity === "ok" ? "OK" : b.integrity ?? "—"} bad={b.integrity !== "ok"} />
          <Kv k="Accounts and tables in the snapshot" v={`${b.users ?? "—"} / ${b.tables ?? "—"}`} />
          <Kv k="Encryption key included" v={b.hasKey ? "✓" : "✗"} bad={!b.hasKey} />
          <Kv k="Uploaded files (missing)" v={`${b.uploads ?? "—"} (${b.missingUploads ?? 0})`} bad={!!b.missingUploads} />
          {!!b.checked && <Kv k="Uploaded files checked against their checksum (damaged)" v={`${b.checked} (${b.corrupt ?? 0})`} bad={!!b.corrupt} />}
          {b.keyOk != null && <Kv k="Key opens the encrypted data in the snapshot" v={b.keyOk ? "✓" : "✗"} bad={!b.keyOk} />}
          {b.offsite && <Kv k="Off-site copy" v={b.offsiteOk ? "✓" : "✗"} bad={!b.offsiteOk} />}
        </div>
      )}

      <h3 className="sec">Continuous backup</h3>
      <ContinuousBackup Toggle={Toggle} />

      <h3 className="sec">Watchdog</h3>
      <p className="d adm-privacy"><I.Retry size={14} />Checks the web app every minute and restarts it after three failed checks in a row. It can&apos;t tell you if the whole server is down: that takes a monitor outside this server.</p>
      <div className="adm-card">
        <Kv k="Last check" v={w ? ago(w.at) : "—"} bad={!w || h.now - w.at > 5 * 60_000} />
        <Kv k="Restarts (24h)" v={w?.restarts24 ?? 0} bad={!!w?.restarts24} />
        {h.lastBootAt && <Kv k="Web app last started" v={fmtDate(h.lastBootAt)} />}
      </div>
      {h.wdEvents.map((e, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span data-notr>{WD[e.event] ? tr(WD[e.event]) : e.event}{e.detail ? <><br /><span className="muted">{e.detail}</span></> : null}</span><span /></div>)}

      {h.csp.length > 0 && <>
        <h3 className="sec">Script policy reports</h3>
        <p className="d adm-privacy"><I.Lock size={14} />Trial run: nothing is blocked. Each line is a script source the browser would have refused under the planned policy. Anyone can send these reports, so treat them as a hint, not proof.</p>
        {h.csp.map((e, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }} data-notr><span className="adm-chip">{e.source}</span>{e.n > 1 && <span className="adm-chip">× {e.n}</span>} {e.detail}</span></div>)}
      </>}

      <h3 className="sec">Recent server errors</h3>
      {h.errors.length === 0 ? <div className="d" style={{ padding: "8px 0" }}>No server errors recorded.</div> : h.errors.map((e) => (
        <div key={e.id} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}><span className="adm-chip" data-notr>{e.source}</span>{e.n > 1 && <span className="adm-chip" data-notr>× {e.n}</span>}<br /><span className="muted" data-notr>{e.detail}</span></span><span /></div>
      ))}

      {h.clientErrors.length > 0 && <>
        <h3 className="sec">Browser reports</h3>
        <p className="d adm-privacy"><I.Lock size={14} />Sent by browsers, and anyone can send one, so these are a hint and do not count as server errors.</p>
        {h.clientErrors.map((e) => <div key={e.id} className="adm-log"><span className="tm" data-notr>{fmtDate(e.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }} data-notr>{e.n > 1 && <span className="adm-chip">× {e.n}</span>} <span className="muted">{e.detail}</span></span><span /></div>)}
      </>}
    </>
  );
}
