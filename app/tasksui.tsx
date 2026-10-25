"use client";
// Hộp thư (kết quả tác vụ nền) và tác vụ đã hẹn: tạo, sửa lịch, bật / tắt, chạy ngay. Số kết quả chưa đọc hiện trên thanh bên.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { Markdown } from "./md";
import { artifactsAsCode, hasArtifacts, splitArtifacts } from "./artifacts";

type Schedule = { kind: "once" | "hourly" | "daily" | "weekly"; time?: string; weekday?: number; tz: string };
type Task = { id: string; title: string; prompt: string; schedule: Schedule; model: string | null; enabled: boolean; next_run_at: number | null; last_run_at: number | null; created_at: number; runs: number };
type Item = { run: string; task: string; title: string; at: number; read: boolean; status: string; text: string; error?: string; kind?: "task" | "notice"; link?: string };
export const INBOX_CHANGED = "synchro:inbox";

const api = async <T,>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j as T;
};
const DAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
export const scheduleText = (s: Schedule) => s.kind === "once" ? tr("Một lần") : s.kind === "hourly" ? tr("Mỗi giờ") : s.kind === "daily" ? `${tr("Mỗi ngày lúc")} ${s.time}` : `${tr(DAYS[s.weekday ?? 1])} ${tr("hằng tuần lúc")} ${s.time}`;
// Kết quả có artifact: tài liệu Markdown hiện thẳng như văn bản, loại khác hiện thành khối mã.
const readable = (text: string) => (hasArtifacts(text) ? splitArtifacts(text).map((sg) => (sg.kind === "text" ? sg.text : sg.art.type === "markdown" ? `\n${sg.art.content}\n` : artifactsAsCode(`<artifact identifier="${sg.art.ident}" type="${sg.art.type}" title="${sg.art.title}">\n${sg.art.content}\n</artifact>`))).join("") : text);
const when = (t: number) => new Date(t).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
// Mẫu tác vụ hay dùng (người dùng sửa lại cho đúng việc của mình).
const TEMPLATES = [
  { title: "Bản tin buổi sáng", prompt: "Tóm tắt những việc tôi cần chú ý hôm nay: lịch họp, email quan trọng chưa trả lời, việc đến hạn. Ngắn gọn theo mức độ ưu tiên.", schedule: { kind: "daily", time: "08:00" } },
  { title: "Tổng kết tuần", prompt: "Tổng kết công việc tuần này của tôi: việc đã xong, việc còn tồn, rủi ro, và 3 ưu tiên cho tuần sau.", schedule: { kind: "weekly", weekday: 5, time: "17:00" } },
  { title: "Theo dõi đối thủ", prompt: "Tìm tin mới trong tuần về các đối thủ cạnh tranh của chúng tôi (giá, sản phẩm mới, khuyến mãi) và tóm tắt điểm đáng chú ý.", schedule: { kind: "weekly", weekday: 1, time: "09:00" } },
] as const;

/** Số kết quả chưa đọc (thanh bên), kiểm tra mỗi phút và khi quay lại tab; có kết quả mới thì báo bằng thông báo trình duyệt nếu được phép. */
export function useInboxCount(on: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => {
    if (!on) return;
    api<{ items: Item[]; unread: number }>("GET", "/api/inbox").then((j) => {
      setN(j.unread);
      const done = j.items.filter((x) => x.status !== "running" && !x.read);
      if (seen.current) for (const x of done) if (!seen.current.has(x.run) && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) new Notification(`Synchro · ${x.title}`, { body: tr("Tác vụ nền đã chạy xong. Mở Hộp thư để xem kết quả.") });
      seen.current = new Set(done.map((x) => x.run));
    }).catch(() => {});
  }, [on]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f); window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); window.removeEventListener(INBOX_CHANGED, load); };
  }, [load]);
  return n;
}

function TaskForm({ init, onClose, onSaved, say, model }: { init?: Task | null; onClose: () => void; onSaved: () => void; say: (m: string) => void; model?: string }) {
  const [title, setTitle] = useState(init?.title ?? "");
  const [prompt, setPrompt] = useState(init?.prompt ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(init?.schedule.kind ?? "daily");
  const [time, setTime] = useState(init?.schedule.time ?? "08:00");
  const [weekday, setWeekday] = useState(init?.schedule.weekday ?? 1);
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = async () => {
    setBusy(true);
    const body = { title, prompt, schedule: { kind, time, weekday, tz }, ...(init ? {} : model ? { model } : {}) };
    try {
      if (init) await api("PATCH", `/api/tasks/${init.id}`, body); else await api("POST", "/api/tasks", body);
      say(init ? tr("Đã lưu tác vụ") : kind === "once" ? tr("Đã tạo tác vụ, sẽ chạy trong vòng một phút") : tr("Đã hẹn tác vụ")); onSaved();
    } catch (e) { say((e as Error).message); setBusy(false); }
  };
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal tk-modal" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <button type="button" className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        <h2>{init ? tr("Sửa tác vụ") : tr("Tác vụ nền mới")}</h2>
        <p className="d">{tr("Synchro tự chạy yêu cầu này theo lịch, kể cả khi bạn không mở trang. Kết quả vào Hộp thư.")}</p>
        {!init && <div className="tk-tpl">{TEMPLATES.map((t) => <button type="button" key={t.title} className="chip" onClick={() => { setTitle(t.title); setPrompt(t.prompt); setKind(t.schedule.kind); setTime(t.schedule.time); if ("weekday" in t.schedule) setWeekday(t.schedule.weekday); }}>{tr(t.title)}</button>)}</div>}
        <label className="tk-l">{tr("Tên")}<input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Ví dụ: Bản tin buổi sáng")} /></label>
        <label className="tk-l">{tr("Yêu cầu")}<textarea className="field" value={prompt} maxLength={8000} rows={5} onChange={(e) => setPrompt(e.target.value)} placeholder={tr("Viết như khi nhắn cho Synchro. Connector đã kết nối (email, lịch…) được dùng như trong chat.")} /></label>
        <div className="tk-sch">
          <label className="tk-l">{tr("Lịch chạy")}<select className="field" value={kind} onChange={(e) => setKind(e.target.value as Schedule["kind"])}>
            <option value="once">{tr("Một lần, chạy ngay")}</option><option value="hourly">{tr("Mỗi giờ")}</option><option value="daily">{tr("Mỗi ngày")}</option><option value="weekly">{tr("Mỗi tuần")}</option>
          </select></label>
          {kind === "weekly" && <label className="tk-l">{tr("Vào")}<select className="field" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{DAYS.map((d, i) => <option key={i} value={i}>{tr(d)}</option>)}</select></label>}
          {(kind === "daily" || kind === "weekly") && <label className="tk-l">{tr("Lúc")}<input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>}
        </div>
        <p className="tk-tz">{tr("Giờ theo múi giờ")} <span data-notr>{tz}</span></p>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>{tr("Hủy")}</button><button className="btn dark" disabled={busy || !title.trim() || !prompt.trim()}>{busy ? <span className="art-spin sm" /> : null}{init ? tr("Lưu") : kind === "once" ? tr("Chạy") : tr("Hẹn lịch")}</button></div>
      </form>
    </div>
  );
}

export function InboxPage({ say, model, onOpenChat, onOpenMeeting }: { say: (m: string) => void; model?: string; onOpenChat: (title: string, text: string) => void; onOpenMeeting?: (id: string) => void }) {
  const [tab, setTab] = useState<"inbox" | "tasks">("inbox");
  const [items, setItems] = useState<Item[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Task | null | "new">(null);
  const load = useCallback(() => {
    api<{ items: Item[] }>("GET", "/api/inbox").then((j) => setItems(j.items)).catch((e) => say(e.message));
    api<{ tasks: Task[] }>("GET", "/api/tasks").then((j) => setTasks(j.tasks)).catch(() => {});
  }, [say]);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const read = async (ids: string[] | "all") => { await api("POST", "/api/inbox", { read: ids }).catch(() => {}); window.dispatchEvent(new Event(INBOX_CHANGED)); load(); };
  const toggle = (x: Item) => { setOpen(open === x.run ? null : x.run); if (!x.read && x.status !== "running") read([x.run]); };
  const runNow = async (t: Task) => { try { await api("POST", `/api/tasks/${t.id}/run`); say(tr("Đang chạy, kết quả sẽ vào Hộp thư")); setTab("inbox"); load(); } catch (e) { say((e as Error).message); } };
  const setOn = async (t: Task) => { try { await api("PATCH", `/api/tasks/${t.id}`, { enabled: !t.enabled }); load(); } catch (e) { say((e as Error).message); } };
  const del = async (t: Task) => { try { await api("DELETE", `/api/tasks/${t.id}`); say(tr("Đã xóa tác vụ")); load(); } catch (e) { say((e as Error).message); } };
  const unread = (items ?? []).filter((x) => !x.read && x.status !== "running").length;
  return (
    <div className="page"><div className="page-in tk">
      <div className="tk-top">
        <h1>{tr("Hộp thư")}</h1>
        <div className="pl-seg"><button className={tab === "inbox" ? "on" : ""} onClick={() => setTab("inbox")}>{tr("Kết quả")}{unread > 0 && <i className="tk-badge">{unread}</i>}</button><button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>{tr("Tác vụ đã hẹn")}</button></div>
        <span style={{ flex: 1 }} />
        {tab === "inbox" && unread > 0 && <button className="btn" onClick={() => read("all")}>{tr("Đánh dấu đã đọc hết")}</button>}
        <button className="btn dark" onClick={() => setForm("new")}><I.Plus size={14} />{tr("Tác vụ nền mới")}</button>
      </div>
      {tab === "inbox" ? (
        items === null ? <div className="empty"><span className="art-spin" /></div> : !items.length ? (
          <div className="apps-empty"><I.Clock size={22} /><b>{tr("Chưa có kết quả nào")}</b><span>{tr("Hẹn một tác vụ nền (ví dụ bản tin mỗi sáng, tổng kết cuối tuần), Synchro sẽ tự chạy và gửi kết quả vào đây.")}</span><button className="btn dark" onClick={() => setForm("new")}>{tr("Tác vụ nền mới")}</button></div>
        ) : (
          <div className="tk-list">
            {items.map((x) => (
              <div key={x.run} className={`tk-item ${x.read ? "" : "unread"} ${open === x.run ? "open" : ""}`}>
                <button className="tk-row" onClick={() => toggle(x)}>
                  <span className={`tk-dot ${x.status}`} />
                  <span className="tk-t"><b data-notr>{x.title}</b><em>{x.status === "running" ? tr("Đang chạy…") : x.status === "error" ? tr("Lỗi") : (x.text.replace(/<artifact[\s\S]*?<\/artifact>/g, "").replace(/[#*_`>]/g, "").trim().slice(0, 140) || tr("Xong"))}</em></span>
                  <span className="tk-when">{when(x.at)}</span>
                </button>
                {open === x.run && (
                  <div className="tk-body">
                    {x.status === "running" ? <div className="tk-run"><span className="art-spin sm" />{tr("Synchro đang chạy tác vụ này ở nền")}</div>
                      : x.error ? <div className="sk-err"><span>{x.error}</span></div>
                      : <div className="mdx"><Markdown text={readable(x.text)} say={say} /></div>}
                    {x.status === "done" && <div className="tk-acts">
                      {x.link?.startsWith("meeting:") ? <button className="btn" onClick={() => onOpenMeeting?.(x.link!.slice(8))}><I.Mic size={14} />{tr("Mở cuộc họp")}</button>
                        : <button className="btn" onClick={() => onOpenChat(x.title, x.text)}><I.Chat2 size={14} />{tr("Mở thành đoạn chat")}</button>}
                    </div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        tasks === null ? <div className="empty"><span className="art-spin" /></div> : !tasks.length ? (
          <div className="apps-empty"><I.Clock size={22} /><b>{tr("Chưa hẹn tác vụ nào")}</b><span>{tr("Ví dụ: 8 giờ sáng mỗi ngày tóm tắt lịch và email; chiều thứ Sáu tổng kết tuần.")}</span><button className="btn dark" onClick={() => setForm("new")}>{tr("Tác vụ nền mới")}</button></div>
        ) : (
          <div className="tk-list">
            {tasks.map((t) => (
              <div key={t.id} className={`tk-task ${t.enabled ? "" : "off"}`}>
                <span className="pl-mark" style={{ width: 36, height: 36 }}><I.Clock size={17} /></span>
                <span className="tk-t"><b data-notr>{t.title}</b><em>{scheduleText(t.schedule)}{t.enabled && t.next_run_at ? ` · ${tr("lần tới")} ${when(t.next_run_at)}` : !t.enabled ? ` · ${tr("đã tắt")}` : ""} · {t.runs} {tr("lần chạy")}</em></span>
                <button className="btn" onClick={() => runNow(t)}><I.Play size={13} />{tr("Chạy ngay")}</button>
                <button className="icon-btn" aria-label="Sửa" data-tip="Sửa" onClick={() => setForm(t)}><I.Pencil size={15} /></button>
                <button className={`toggle ${t.enabled ? "on" : ""}`} role="switch" aria-checked={t.enabled} aria-label="Bật lịch" onClick={() => setOn(t)} />
                <button className="icon-btn" aria-label="Xóa tác vụ" data-tip="Xóa tác vụ" onClick={() => del(t)}><I.Trash size={15} /></button>
              </div>
            ))}
          </div>
        )
      )}
      {form && <TaskForm init={form === "new" ? null : form} model={model} say={say} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); setTab(form === "new" ? "tasks" : tab); }} />}
    </div></div>
  );
}
