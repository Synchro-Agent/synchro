"use client";
import "./styles/skills.css";
// Danh mục skill của Claude trong tab Khám phá của Skill Hub: lưới mục ngành nghề có số thư viện / đã cài (như Customize → Directory của Claude),
// danh sách thư viện theo trang (máy chủ lọc, không gửi cả ~3.100 thư viện xuống trình duyệt), cài từng thư viện, và với quản trị viên:
// cài tất cả (cả danh mục hoặc một mục) ở nền, kèm tiến độ và danh sách thư viện không cài được.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { locale, tr } from "./i18n";
import { apiFetch, statusText } from "./apierr";
import { PLUGIN_CATS } from "../shared/plugindir";
import { Pager } from "./pager";

type Item = { id: string; name: string; summary: string; author: string; cats: string[]; license: string; skillCount: number; skills: string[]; homepage: string; verified: string | null; installed: string | null;
  closed: boolean; closedWhy: string | null; failed: boolean; failedWhy: string | null; github: boolean; altFor: string[]; altAuto: boolean; alt: { id: string; name: string; installed: string | null }[] };
type Fail = { id: string; name: string; reason: string; kind: "license" | "missing" | "other" };
type Job = { cat: string | null; paused?: number | null; started: number; finished: number | null; stopped: boolean; total: number; done: number; installed: number; skills: number; failed: Fail[]; current: string[]; running: boolean };
type Data = { totals: { plugins: number; skills: number; installed: number; closed: number; failed: number }; cats: Record<string, { plugins: number; skills: number; installed: number; closed: number; failed: number }>; items: Item[]; total: number; page: number; pages: number; admin: boolean; canInstall: boolean; job: Job | null };

const PER = 24;
const n = (x: number) => x.toLocaleString(locale());
const Icon = ({ name, size = 15 }: { name: string; size?: number }) => { const C = (I as unknown as Record<string, (p: { size?: number }) => React.ReactElement>)[name] ?? I.Plugins; return <C size={size} />; };
const CAT = new Map(PLUGIN_CATS.map((c) => [c.key, c]));

export function ClaudeDirectory({ q, onOpen, onChanged }: { q: string; onOpen: (pluginId: string) => void; onChanged: () => void }) {
  const app = useApp();
  const [cat, setCat] = useState<string | null>(null);
  const [only, setOnly] = useState<"" | "missing" | "installed" | "unavailable">("");
  const [page, setPage] = useState(0);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showFails, setShowFails] = useState(false);
  const [allCats, setAllCats] = useState(false);
  const seq = useRef(0);
  const qq = q.trim();
  useEffect(() => { setPage(0); }, [cat, only, qq]);
  const load = useCallback(async () => {
    const id = ++seq.current;
    const u = new URLSearchParams({ page: String(page), size: String(PER), q: qq, ...(cat ? { cat } : {}), ...(only ? { only } : {}) });
    try {
      const r = await apiFetch(`/api/plugins/catalog?${u}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || statusText(r.status));
      if (id === seq.current) { setD(j); setErr(""); }
    } catch (e) { if (id === seq.current) setErr((e as Error).message); }
  }, [page, qq, cat, only]);
  // Gõ tìm kiếm: chờ người dùng ngừng gõ một chút rồi mới hỏi máy chủ.
  useEffect(() => { const t = setTimeout(load, qq ? 250 : 0); return () => clearTimeout(t); }, [load, qq]);
  // Đang cài hàng loạt: cập nhật tiến độ mỗi 3 giây; xong thì báo Kho kỹ năng tải lại danh sách thư viện.
  const running = !!d?.job?.running;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !running) onChanged();
    was.current = running;
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load, onChanged]);

  const install = async (x: Pick<Item, "id">) => {
    setBusy(x.id);
    try {
      const r = await apiFetch("/api/plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "install", catalogId: x.id, scope: d?.admin ? "org" : "personal" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || statusText(r.status));
      app.say(`${j.plugin.name} ${tr("is installed and ready to use")}`);
      onChanged(); await load();
    } catch (e) { app.say((e as Error).message); await load(); }
    setBusy(null);
  };
  const job = async (action: "install-all" | "stop", c?: string | null, retry = false) => {
    try {
      const r = await apiFetch("/api/plugins/catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, cat: c ?? null, retry }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || statusText(r.status));
      await load();
    } catch (e) { app.say((e as Error).message); }
  };
  // Còn phải cài: trừ thư viện giấy phép đóng và thư viện đã cài lỗi từ nguồn của nó (nút Cài tất cả không còn hiện mãi vì chúng).
  const missing = (c: string) => (d?.cats[c]?.plugins ?? 0) - (d?.cats[c]?.installed ?? 0) - (d?.cats[c]?.closed ?? 0) - (d?.cats[c]?.failed ?? 0);
  const missingAll = d ? d.totals.plugins - d.totals.installed - d.totals.closed - d.totals.failed : 0;
  const altNames = (x: Item) => x.alt.map((a, i) => <span key={a.id}>{i > 0 && ", "}{a.installed ? <button className="cd-link" data-notr onClick={() => onOpen(a.installed!)}>{a.name}</button> : d?.canInstall ? <button className="cd-link" data-notr disabled={!!busy || running} aria-label={`${tr("Install")} ${a.name}`} onClick={() => install(a)}>{busy === a.id ? <span className="art-spin sm" /> : null}{a.name}</button> : <span data-notr>{a.name}</span>}</span>);
  // Không có thư viện mở làm cùng việc: vẫn có đường đi tiếp, mở cả mục ngành nghề của thư viện đó.
  const browse = (x: Item) => { const c = x.cats[0]; return c && c !== cat && CAT.has(c) ? <> <button className="cd-link" onClick={() => { setCat(c); setOnly(""); }}>{tr("See other libraries in")} {tr(CAT.get(c)!.label)}</button></> : null; };
  const askAll = (c: string | null) => {
    const left = c ? missing(c) : missingAll;
    const label = c ? tr(CAT.get(c)?.label ?? c) : tr("the whole directory");
    // Một chuỗi nguyên để từ điển dịch tìm được đúng khóa.
    const why = tr("that is not installed yet goes into Libraries for everyone. It runs on the server in the "
      + "background: you can close this page. Libraries whose license does not allow copying are skipped and listed.");
    const title = `${tr("Install")} ${n(left)} ${tr("libraries")}?`;
    const run = () => void job("install-all", c);
    app.confirm(title, `${tr("Every library of")} ${label} ${why}`, "Install", run, { safe: true });
  };

  if (err && !d) return <div className="empty" style={{ marginTop: 24 }}><I.Alert size={22} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!d) return <div className="empty" style={{ marginTop: 24 }}><span className="art-spin" /></div>;
  if (!d.totals.plugins) return null;
  // 55 mục: hiện các mục lớn trước, phần còn lại mở bằng "Thêm mục" (màn hẹp không phải cuộn qua hàng chục dòng nhãn). Mục đang chọn luôn hiện.
  const all = PLUGIN_CATS.filter((c) => d.cats[c.key]?.plugins);
  const FEW = 17;
  const cats = allCats ? all : all.filter((c, i) => i < FEW || c.key === cat);
  const j = d.job && (d.job.running || d.job.total) ? d.job : null;
  // Còn thư viện cài được (trừ thư viện giấy phép đóng, Synchro không cài).
  const pct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
  const licenseFails = j?.failed.filter((f) => f.kind === "license").length ?? 0;
  return (
    <section className="cd">
      <div className="pl-sec">Claude skill directory <i>{n(d.totals.plugins)}</i><span className="pl-sec-d"><span>{n(d.totals.skills)} skill ·</span> <span>{n(d.totals.installed)} {tr("installed")}</span></span>
        {d.admin && (missingAll > 0 || d.totals.failed > 0) && <span className="pl-sec-r">{d.totals.failed > 0 && <button className="btn sm" disabled={running} onClick={() => job("install-all", null, true)}><I.Retry size={14} />{tr("Retry failed libraries")} ({n(d.totals.failed)})</button>}{missingAll > 0 && <button className="btn dark sm" disabled={running} onClick={() => askAll(null)}><I.Download size={14} />Install all</button>}</span>}
      </div>
      <p className="d cd-lead">Every library with skills from Claude&apos;s public directory, sorted into the same categories as Claude. Each library is pinned to the commit Anthropic reviewed.</p>
      <p className="d cd-lead">Synchro reads each library&apos;s license when installing. A closed license is not installed, and open libraries are offered instead. A library that states no license is installed and marked as unknown on its page, so check it before commercial use.</p>
      {j && (
        <div className={`cd-job${j.running ? " on" : ""}`}>
          <div className="cd-job-h">
            {j.running ? <span className="art-spin sm" /> : <I.Check size={15} />}
            <b>{j.running ? (j.paused ? tr("Paused: GitHub is limiting downloads") : tr("Installing libraries")) : j.stopped ? tr("Installation stopped") : tr("Installation finished")}</b>
            <span data-notr>{n(j.done)} / {n(j.total)}</span>
            <span className="cd-job-s">{n(j.installed)} {tr("installed")} · {n(j.skills)} skill{j.failed.length ? <> · <button className="cd-link" onClick={() => setShowFails(!showFails)}>{n(j.failed.length)} {tr("not installed")}</button></> : null}</span>
            <span style={{ flex: 1 }} />
            {j.running ? <button className="btn sm" onClick={() => job("stop")}>Stop</button> : d.admin && (j.cat ? missing(j.cat) : missingAll) > 0 ? <button className="btn sm" onClick={() => askAll(j.cat)}>Continue</button> : null}
          </div>
          <div className="cd-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
          {j.running && j.current.length > 0 && <div className="cd-job-now"><span>Now:</span> <span data-notr>{j.current.join(", ")}</span></div>}
          {showFails && j.failed.length > 0 && (
            <div className="cd-fails">
              {licenseFails > 0 && <p className="d">{n(licenseFails)} {tr("libraries have a license that does not allow copying; Synchro looks for open alternatives with the same skills.")}</p>}
              {j.failed.slice(0, 300).map((f) => <div key={f.id} className="cd-fail"><b data-notr>{f.name}</b><span data-notr>{f.reason}</span></div>)}
            </div>
          )}
        </div>
      )}
      <div className="cd-cats" role="listbox" aria-label="Categories">
        <button role="option" aria-selected={!cat} className={`cd-cat${!cat ? " on" : ""}`} onClick={() => setCat(null)}><I.SquaresFour size={15} /><span>All</span><em data-notr>{n(d.totals.plugins)}</em></button>
        {cats.map((c) => { const v = d.cats[c.key]; return (
          <button key={c.key} role="option" aria-selected={cat === c.key} className={`cd-cat${cat === c.key ? " on" : ""}`} onClick={() => setCat(cat === c.key ? null : c.key)} title={`${n(v.skills)} skill`}>
            <Icon name={c.icon} /><span>{c.label}</span><em data-notr>{v.installed ? `${n(v.installed)}/` : ""}{n(v.plugins)}</em>
          </button>
        ); })}
        {all.length > FEW && <button className="cd-cat more" aria-expanded={allCats} onClick={() => setAllCats(!allCats)}>{allCats ? <><I.Minus size={15} /><span>Fewer categories</span></> : <><I.Plus size={15} /><span>More categories</span><em data-notr>{all.length - FEW}</em></>}</button>}
      </div>
      <div className="cd-tools">
        <div className="pl-seg" role="tablist"><button role="tab" aria-selected={!only} className={!only ? "on" : ""} onClick={() => setOnly("")}>All</button><button role="tab" aria-selected={only === "missing"} className={only === "missing" ? "on" : ""} onClick={() => setOnly("missing")}>Not installed</button>{d.totals.closed + d.totals.failed > 0 && <button role="tab" aria-selected={only === "unavailable"} className={only === "unavailable" ? "on" : ""} onClick={() => setOnly("unavailable")}>Unavailable</button>}<button role="tab" aria-selected={only === "installed"} className={only === "installed" ? "on" : ""} onClick={() => setOnly("installed")}>Installed</button></div>
        <span className="cd-count" data-notr>{n(d.total)}</span>
        <span style={{ flex: 1 }} />
        {d.admin && cat && missing(cat) > 0 && <button className="btn sm" disabled={running} onClick={() => askAll(cat)}><I.Download size={14} /><span>{tr("Install all in")} {tr(CAT.get(cat)?.label ?? cat)}</span></button>}
      </div>
      {d.items.length ? (
        <div className="pl-dgrid">
          {d.items.map((x) => (
            <div key={x.id} className={`pl-dcard${x.installed ? " click" : ""}`} onClick={x.installed ? (e) => { if (!(e.target as Element).closest("button,a")) onOpen(x.installed!); } : undefined}>
              <span className="pl-mark" style={{ width: 44, height: 44 }}><Icon name={CAT.get(x.cats[0])?.icon ?? "Plugins"} size={21} /></span>
              <div className="pl-dcard-t">
                <b data-notr>{x.name}</b>
                <span data-notr>{x.summary || x.skills.join(", ")}</span>
                {x.failed && <div className="cd-alt" title={x.failedWhy ?? undefined}><I.Alert size={12} /><span>{d.admin ? tr("Could not install from its source.") : tr("Not available right now: it could not be installed from its source.")}{x.alt.length ? <> {x.altAuto ? tr("Similar open libraries:") : tr("Open alternatives:")} {altNames(x)}</> : browse(x)}</span></div>}
                {x.closed && <div className="cd-alt" title={x.closedWhy ?? undefined}><I.Lock size={12} /><span>{tr("Closed license, not installed.")}{x.alt.length ? <> {x.altAuto ? tr("Similar open libraries:") : tr("Open alternatives:")} {altNames(x)}</> : <> {tr("No open alternative yet.")}{browse(x)}</>}</span></div>}
                {x.github && x.altFor.length > 0 && <div className="cd-alt"><I.GitHub size={12} /><span>{tr("Open alternative to")} <span data-notr>{x.altFor.join(", ")}</span></span></div>}
                {/* Thư mục của Claude không ghi giấy phép cho mọi thư viện (vd. của Anthropic): khi đó không đoán, giấy phép thật được đọc từ repo lúc cài. */}
                <em><span><span data-notr>{x.author}</span> ·</span> <span>{x.github ? "GitHub" : `${x.skillCount} skill`}</span>{x.license ? <> <span>· <span data-notr>{x.license}</span></span></> : !x.github ? <> <span>· <span>No license stated</span></span></> : null}{x.verified === "anthropic" ? <> <span>· Anthropic</span></> : x.verified === "partner" ? <> <span>· {tr("Partner")}</span></> : null}</em>
              </div>
              {x.closed ? <span className="pl-plus done" aria-label="Closed license" data-tip="Closed license"><I.Lock size={14} /></span>
                : x.installed ? <button className="pl-plus done" aria-label="Installed" data-tip="Installed" onClick={() => onOpen(x.installed!)}><I.Check size={15} /></button>
                : x.failed ? (d.admin ? <button className="pl-plus" aria-label={`${tr("Retry")} ${x.name}`} data-tip="Retry" disabled={!!busy || running} onClick={() => install(x)}>{busy === x.id ? <span className="art-spin sm" /> : <I.Retry size={15} />}</button> : <span className="pl-plus done" aria-label="Could not install" data-tip="Could not install"><I.Alert size={14} /></span>)
                : d.canInstall ? <button className="pl-plus" aria-label={`Install ${x.name}`} data-tip="Install" disabled={!!busy || running} onClick={() => install(x)}>{busy === x.id ? <span className="art-spin sm" /> : <I.Plus size={15} />}</button> : null}
            </div>
          ))}
        </div>
      ) : <div className="empty" style={{ marginTop: 24 }}><span>No libraries match.</span></div>}
      <Pager page={d.page + 1} pages={Math.max(d.pages, 1)} from={d.total ? d.page * PER + 1 : 0} to={Math.min((d.page + 1) * PER, d.total)} total={d.total} onPage={(p) => setPage(p - 1)} />
    </section>
  );
}
