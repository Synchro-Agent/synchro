"use client";
import "../app/skills.css";
// Kho kỹ năng → "Quét skill rác" (máy chủ: server/skillscan.ts). Nút ở thanh công cụ mở hộp thoại: chọn model (mặc định Synchro tự chọn)
// rồi quét; model đọc mọi skill ở nền, kết quả hiện dần theo tab Rác / Không có tác dụng / Ổn (kèm ngành nghề), mỗi skill một lý do.
// Đóng hộp thoại hay chuyển trang thì việc quét vẫn chạy (nút có vòng xoay), quét xong khi còn ở Kho kỹ năng thì báo một dòng.
// Tắt, bật lại hay xóa skill ngay trong bảng; thư viện cho mọi người chỉ quản trị viên đổi được. Không tự tắt hay xóa gì.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, statusText } from "./apierr";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { useApp, usePref } from "./store";
import { getLang, locale } from "../app/i18n";
import { SKILLS_CHANGED } from "./skillsui";
import type { ScanItem, ScanJob, Verdict } from "../server/skillscan";

type Group = { name: string; models: { key: string; name: string }[] };
type Data = { job: ScanJob | null; count: number; models: Group[] };
async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || statusText(r.status));
  return j as T;
}
const TABS: { v: Verdict; label: string; empty: string }[] = [
  { v: "junk", label: "Junk", empty: "No junk skills found." },
  { v: "useless", label: "No real use", empty: "Every skill serves a real profession or task." },
  { v: "ok", label: "Fine", empty: "No skill passed yet." },
  { v: "unknown", label: "Not read", empty: "" },
];
const KIND_ORDER = { skill: 0, personal: 1, org: 2 } as const;
const sorted = (l: ScanItem[]) => [...l].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.where.localeCompare(b.where) || a.name.localeCompare(b.name));
const tally = (j: ScanJob) => Object.fromEntries(TABS.map((t) => [t.v, j.items.filter((x) => x.verdict === t.v).length])) as Record<Verdict, number>;
const summaryOf = (j: ScanJob) => {
  const n = tally(j);
  return `Đã quét xong ${j.total} skill: ${n.junk} skill rác, ${n.useless} skill không có tác dụng.`;
};

/** Nút ở thanh công cụ Kho kỹ năng; tự giữ trạng thái lần quét (đang chạy ở nền thì hỏi lại máy chủ định kỳ). */
export function SkillScan() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Data | null>(null);
  const openRef = useRef(open); openRef.current = open;
  // full: kèm số skill sẽ quét và danh sách model (khi mở hộp thoại); còn lại chỉ hỏi trạng thái lần quét (nhẹ, dùng khi đang chạy).
  const dRef = useRef<Data | null>(null);
  const put = useCallback((f: (x: Data | null) => Data | null) => { dRef.current = f(dRef.current); setD(dRef.current); }, []);
  const load = useCallback((full = false) => call<Partial<Data>>(`/api/skill-scan${full ? "" : "?lite"}`).then((j) => {
    put((x) => ({ job: j.job ?? null, count: j.count ?? x?.count ?? 0, models: j.models ?? x?.models ?? [] }));
    return dRef.current!;
  }), [put]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const running = d?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      load().then((j) => { if (j.job && j.job.status !== "running" && !openRef.current) app.say(summaryOf(j.job)); }).catch(() => {});
    }, open ? 1500 : 4000);
    return () => clearInterval(t);
  }, [running, open, load, app]);
  // Hộp thoại chỉ hiện khi đã có số skill và danh sách model (lần tải nhẹ lúc đầu không có hai thứ này).
  const [full, setFull] = useState(false);
  return (
    <>
      <button className={`btn pl-scan ${running ? "busy" : ""}`} aria-label="Scan for junk skills" data-tip={running ? "Scanning skills…" : "Scan for junk skills"} onClick={() => { setOpen(true); setFull(false); load(true).then(() => setFull(true)).catch(() => setFull(true)); }}>
        {running ? <span className="art-spin sm" /> : <I.Sparkles size={15} />}<span className="pl-scan-l">Scan for junk skills</span>
      </button>
      {open && createPortal(<ScanModal d={full ? d : null} setD={put} reload={load} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ScanModal({ d, setD, reload, onClose }: { d: Data | null; setD: (f: (x: Data | null) => Data | null) => void; reload: () => Promise<Data>; onClose: () => void }) {
  const app = useApp();
  const [model, setModel] = usePref<string>("scanmodel", "");
  const [intro, setIntro] = useState(false);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const job = d?.job ?? null;
  const showIntro = !!d && (intro || !job);
  const [tab, setTab] = useState<Verdict | null>(null);
  // Esc: hộp xác nhận xóa đang mở thì Esc chỉ đóng hộp đó.
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape" && ![...document.querySelectorAll(".overlay.cf-top")].some((o) => !o.closest(".closing"))) onClose(); }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [onClose]);
  // Model đã chọn lần trước không còn dùng được: về Tự động.
  const keys = (d?.models ?? []).flatMap((g) => g.models.map((m) => m.key));
  const pick = model && keys.includes(model) ? model : "";

  const start = async () => {
    setErr(""); setStarting(true);
    try { const r = await call<{ job: ScanJob }>("/api/skill-scan", "POST", { model: pick || undefined, lang: getLang() }); setD((x) => (x ? { ...x, job: r.job } : x)); setIntro(false); setTab(null); }
    catch (e) { setErr((e as Error).message); } finally { setStarting(false); }
  };
  const stop = () => call<{ job: ScanJob }>("/api/skill-scan", "DELETE").then(() => reload()).catch((e) => setErr((e as Error).message));
  const patchItems = (keys: Set<string>, f: (x: ScanItem) => ScanItem | null) =>
    setD((x) => (x?.job ? { ...x, job: { ...x.job, items: x.job.items.flatMap((it) => { if (!keys.has(it.key)) return [it]; const n = f(it); return n ? [n] : []; }) } } : x));
  // Tắt / bật lại: skill của bạn từng cái; skill thư viện gộp theo thư viện, mỗi thư viện một lần gọi.
  const setOn = async (xs: ScanItem[], on: boolean) => {
    const list = xs.filter((x) => x.manage && x.enabled !== on);
    if (!list.length) return;
    setBusy(list.length === 1 ? list[0].key : "all"); setErr("");
    try {
      for (const x of list.filter((x) => x.kind === "skill")) await call(`/api/skills/${encodeURIComponent(x.name)}`, "PATCH", { enabled: on });
      const libs = new Map<string, Record<string, boolean>>();
      for (const x of list.filter((x) => x.plugin)) libs.set(x.plugin!, { ...libs.get(x.plugin!), [x.name]: on });
      for (const [id, skills] of libs) await call(`/api/plugins/${encodeURIComponent(id)}`, "PATCH", { skills });
      patchItems(new Set(list.map((x) => x.key)), (x) => ({ ...x, enabled: on }));
      window.dispatchEvent(new Event(SKILLS_CHANGED)); window.dispatchEvent(new Event("synchro:plugins"));
      app.say(on ? `Đã bật lại ${list.length} skill` : `Đã tắt ${list.length} skill`);
    } catch (e) { setErr((e as Error).message); await reload().catch(() => {}); } finally { setBusy(null); }
  };
  // Xóa hẳn mọi skill người này quản lý: skill của bạn (mọi phiên bản và tệp) và skill trong thư viện (xóa khỏi thư viện, lần cập nhật từ repo
  // không thêm lại; thư viện không còn skill nào thì gỡ luôn). Thư viện cho mọi người: chỉ quản trị viên.
  const del = (xs: ScanItem[]) => {
    const list = xs.filter((x) => x.manage);
    if (!list.length) return;
    const one = list.length === 1, x0 = list[0];
    const fromLib = list.some((x) => x.plugin), own = list.some((x) => !x.plugin);
    const title = !one ? `Xóa ${list.length} skill?` : x0.plugin ? `Xóa skill "${x0.name}" khỏi thư viện ${x0.where}?` : `Xóa skill "${x0.name}"?`;
    const text = !fromLib ? (one ? "Mọi phiên bản và tệp của skill này sẽ bị xóa, không hoàn tác được." : "Mọi phiên bản và tệp của các skill này sẽ bị xóa, không hoàn tác được.")
      : one ? "Skill bị xóa khỏi thư viện và không quay lại khi cập nhật thư viện. Muốn có lại thì gỡ rồi cài lại thư viện."
      : own ? "Skill của bạn bị xóa cùng mọi phiên bản và tệp. Skill trong thư viện bị xóa khỏi thư viện và không quay lại khi cập nhật; thư viện không còn skill nào thì được gỡ luôn. Không hoàn tác được."
      : "Skill bị xóa khỏi thư viện và không quay lại khi cập nhật; thư viện không còn skill nào thì được gỡ luôn. Không hoàn tác được.";
    app.confirm(title, text, "Xóa", async () => {
      setBusy(one ? x0.key : "all"); setErr("");
      const gone = new Set<string>(), fails: string[] = [];
      let emptied = 0;
      for (const x of list.filter((x) => !x.plugin)) {
        try { await call(`/api/skills/${encodeURIComponent(x.name)}`, "DELETE"); gone.add(x.key); } catch (e) { fails.push(`${x.name}: ${(e as Error).message}`); }
      }
      // Mỗi thư viện một lần gọi.
      const libs = new Map<string, ScanItem[]>();
      for (const x of list.filter((x) => x.plugin)) libs.set(x.plugin!, [...(libs.get(x.plugin!) ?? []), x]);
      for (const [id, ls] of libs) {
        try {
          const r = await call<{ removed: string[]; uninstalled: boolean }>(`/api/plugins/${encodeURIComponent(id)}`, "POST", { action: "remove-skills", names: ls.map((x) => x.name) });
          for (const x of ls) if (r.removed.includes(x.name)) gone.add(x.key);
          if (r.uninstalled) emptied++;
        } catch (e) { fails.push(`${ls[0].where}: ${(e as Error).message}`); }
      }
      patchItems(gone, () => null);
      window.dispatchEvent(new Event(SKILLS_CHANGED)); window.dispatchEvent(new Event("synchro:plugins"));
      if (gone.size) app.say(emptied ? `Đã xóa ${gone.size} skill · đã gỡ ${emptied} thư viện trống` : `Đã xóa ${gone.size} skill`);
      if (fails.length) setErr(fails.join("\n"));
      setBusy(null);
    });
  };

  const n = job ? tally(job) : null;
  const cur: Verdict = tab ?? (n ? (n.junk ? "junk" : n.useless ? "useless" : "ok") : "junk");
  const rows = job ? sorted(job.items.filter((x) => x.verdict === cur)) : [];
  const running = job?.status === "running";
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
  const offable = rows.filter((x) => x.manage && x.enabled);
  const deletable = rows.filter((x) => x.manage);
  const locked = rows.some((x) => !x.manage);
  const when = job?.ended ? new Date(job.ended).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="overlay scan-ov" style={{ zIndex: "var(--z-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pl-modal scan-modal" role="dialog" aria-modal="true" aria-labelledby="scan-h">
        <button className="icon-btn scan-x" onClick={onClose} aria-label="Close"><I.X size={16} /></button>
        <h2 id="scan-h">Scan for junk skills</h2>
        <p className="d">A model reads every skill in your Skill Hub: your skills, your libraries and the libraries for everyone. It points out junk skills and skills with no real use, and explains why for each one.</p>
        {err && <div className="sk-err" role="alert"><span>{err}</span><button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setErr("")} aria-label="Close">×</button></div>}
        {!d ? <div className="pl-load"><span className="art-spin" /></div> : showIntro ? (
          <>
            <ul className="scan-kinds">
              <li><b>Junk</b><span>Empty, placeholder or test content, only a README or links, broken text, or an exact copy of another skill.</span></li>
              <li><b>No real use</b><span>Readable, but it doesn&apos;t serve any profession, field or concrete task, or only repeats what the model already does.</span></li>
              <li><b>Fine</b><span>Concrete instructions for a real profession, field or workflow, shown with the field it serves.</span></li>
            </ul>
            <div className="scan-pick">
              <label htmlFor="scan-model">Model</label>
              <select id="scan-model" className="pl-sel" value={pick} onChange={(e) => setModel(e.target.value)}>
                <option value="">Auto (Synchro chooses)</option>
                {d.models.map((g) => <optgroup key={g.name} label={g.name} data-notr>{g.models.map((m) => <option key={m.key} value={m.key} data-notr>{m.name}</option>)}</optgroup>)}
              </select>
            </div>
            <p className="scan-note"><I.InfoCircle size={14} /><span>The model reads each skill&apos;s name, description and the start of its instructions. Nothing is turned off or deleted unless you choose to.</span></p>
          </>
        ) : job && n && (
          <>
            <div className="scan-stat" aria-live="polite">
              {running ? <><span className="art-spin sm" /><span>{`Đang đọc ${job.done}/${job.total} skill · ${job.modelName}`}</span></>
                : <span>{job.status === "stopped" ? `Đã dừng ở ${job.done}/${job.total} skill · ${job.modelName} · ${when}` : `Đã quét ${job.total} skill bằng ${job.modelName} · ${when}`}</span>}
            </div>
            {running && <div className="scan-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>}
            {job.status === "error" && job.error && <div className="sk-err" role="alert"><span>{job.error}</span></div>}
            <div className="pl-seg scan-tabs" role="tablist">
              {TABS.filter((t) => t.v !== "unknown" || n.unknown).map((t) => (
                <button key={t.v} role="tab" aria-selected={cur === t.v} className={cur === t.v ? "on" : ""} onClick={() => setTab(t.v)}><span>{t.label}</span><i data-notr>{n[t.v]}</i></button>
              ))}
            </div>
            {(offable.length > 0 || deletable.length > 0 || locked) && cur !== "ok" && (
              <div className="scan-tools">
                {locked && <span className="scan-lock"><I.Lock size={13} /><span>Only an admin can change libraries for everyone.</span></span>}
                <span className="scan-sp" />
                {offable.length > 0 && <button className="btn sm" disabled={!!busy} onClick={() => setOn(offable, false)}>{busy === "all" ? <span className="art-spin sm" /> : <I.M icon="Pause" size={13} />}<span>Turn off all</span><i data-notr>{offable.length}</i></button>}
                {deletable.length > 0 && (cur === "junk" || cur === "useless") && <button className="btn sm scan-danger" disabled={!!busy} onClick={() => del(deletable)}><I.Trash size={13} /><span>Delete all</span><i data-notr>{deletable.length}</i></button>}
              </div>
            )}
            <div className={`scan-list ${cur === "ok" ? "noact" : ""}`} role="tabpanel">
              {rows.map((x) => (
                <div key={x.key} className={`scan-row ${x.enabled ? "" : "off"}`}>
                  <div className="scan-name">
                    <b data-notr data-tip={x.description || undefined}>{x.name}</b>
                    <span className="scan-where">{x.kind === "skill" ? <span>Your skills</span> : <span data-notr>{x.where}</span>}{!x.enabled && <em className="pl-b">Off</em>}</span>
                  </div>
                  <div className="scan-why">{x.field && <span className="pl-b st" data-notr>{x.field}</span>}<span data-notr>{x.why}</span></div>
                  {cur !== "ok" && (
                    <div className="scan-act">
                      {x.manage ? <>
                        <button className="btn sm" disabled={!!busy} onClick={() => setOn([x], !x.enabled)}>{busy === x.key ? <span className="art-spin sm" /> : null}{x.enabled ? "Turn off" : "Turn on"}</button>
                        <button className="icon-btn scan-del" disabled={!!busy} onClick={() => del([x])} aria-label="Delete" data-tip="Delete"><I.Trash size={14} /></button>
                      </> : <span className="scan-ro" data-tip="Only an admin can change libraries for everyone"><I.Lock size={14} /></span>}
                    </div>
                  )}
                </div>
              ))}
              {!rows.length && <div className="scan-empty">{running ? <span>Results show up here as the model reads.</span> : <span>{TABS.find((t) => t.v === cur)!.empty}</span>}</div>}
            </div>
          </>
        )}
        {d && <div className="modal-foot">
          {showIntro ? <>
            <button className="btn" onClick={() => (job ? setIntro(false) : onClose())}>Cancel</button>
            <button className="btn dark" disabled={starting || !d?.count} onClick={start}>{starting ? <span className="art-spin sm" /> : <I.Sparkles size={14} />}<span>{`Quét ${d?.count ?? 0} skill`}</span></button>
          </> : running ? <>
            <span className="scan-bg">Keeps running if you close this window.</span>
            <button className="btn" onClick={stop}>Stop</button>
          </> : <>
            <button className="btn" onClick={() => setIntro(true)}><I.Retry size={14} />Scan again</button>
            <button className="btn dark" onClick={onClose}>Done</button>
          </>}
        </div>}
      </div>
    </div>
  );
}
