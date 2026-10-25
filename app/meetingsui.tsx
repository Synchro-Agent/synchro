"use client";
// Cuộc họp: tải tệp ghi âm hoặc dán ghi chép → biên bản (tóm tắt, quyết định, việc cần làm, câu hỏi mở) → việc cần làm có người phụ trách, hạn chót, nhắc việc.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { waitRun } from "./llm";
import { saveBlob } from "./artifactui";

type Minutes = { tomTat: string; thanhPhan: string[]; noiDung: string[]; quyetDinh: string[]; viec: { noiDung: string; nguoiPhuTrach: string; hanChot: string | null }[]; cauHoiMo: string[] };
type Item = { id: string; text: string; assignee: string; due: string | null; done: number };
type Meeting = { id: string; title: string; date: string; status: string; error: string | null; engine: string | null; created_at: number; transcript?: string | null; minutes?: Minutes | null; items?: Item[]; run?: string | null };
type Summary = Meeting & { items: number; done: number };
const api = async <T,>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await fetch(url, { method, headers: body === undefined || body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j as T;
};
const STATUS: Record<string, string> = { transcribing: "Đang chép lời…", summarizing: "Đang lập biên bản…", done: "Xong", error: "Lỗi" };
const vnDate = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
const today = () => new Date().toISOString().slice(0, 10);

function NewMeeting({ stt, onClose, onCreated, say, model }: { stt: boolean; onClose: () => void; onCreated: (id: string) => void; say: (m: string) => void; model?: string }) {
  const [mode, setMode] = useState<"audio" | "text">(stt ? "audio" : "text");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const go = async () => {
    setBusy(true);
    try {
      let r: { id: string };
      if (mode === "audio" && file) {
        const fd = new FormData(); fd.append("audio", file); fd.append("title", title || file.name.replace(/\.[^.]+$/, "")); fd.append("date", date); fd.append("tz", tz); if (model) fd.append("model", model);
        r = await api("POST", "/api/meetings", fd);
      } else r = await api("POST", "/api/meetings", { title: title || tr("Cuộc họp"), date, tz, transcript: text, ...(model ? { model } : {}) });
      say(tr("Đang xử lý cuộc họp ở nền")); onCreated(r.id);
    } catch (e) { say((e as Error).message); setBusy(false); }
  };
  const ready = mode === "audio" ? !!file : text.trim().length >= 30;
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal tk-modal" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <button type="button" className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        <h2>{tr("Cuộc họp mới")}</h2>
        <p className="d">{tr("Synchro chép lời (nếu là tệp ghi âm), lập biên bản và tách việc cần làm kèm người phụ trách, hạn chót.")}</p>
        <div className="pl-seg"><button type="button" className={mode === "audio" ? "on" : ""} onClick={() => setMode("audio")}>{tr("Tệp ghi âm")}</button><button type="button" className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>{tr("Dán ghi chép")}</button></div>
        <div className="tk-sch">
          <label className="tk-l">{tr("Tên cuộc họp")}<input className="field" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Ví dụ: Họp kế hoạch ra mắt")} /></label>
          <label className="tk-l" style={{ flex: "0 0 160px" }}>{tr("Ngày họp")}<input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {mode === "audio" ? (
          !stt ? <div className="sk-err"><span>{tr("Máy chủ chưa có dịch vụ chép lời (cần khóa ElevenLabs hoặc OpenAI ở Cài đặt → API). Hãy dán nội dung cuộc họp.")}</span></div> : (
            <button type="button" className="mt-drop" onClick={() => pick.current?.click()}>
              <I.Mic size={22} /><b>{file ? file.name : tr("Chọn tệp ghi âm")}</b><span>{file ? `${(file.size / 1048576).toFixed(1)} MB` : tr("MP3, M4A, WAV, MP4… tối đa 100 MB")}</span>
              <input ref={pick} type="file" hidden accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </button>
          )
        ) : <label className="tk-l">{tr("Nội dung cuộc họp")}<textarea className="field" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("Dán bản chép lời hoặc ghi chép nhanh trong cuộc họp")} /></label>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>{tr("Hủy")}</button><button className="btn dark" disabled={busy || !ready}>{busy ? <span className="art-spin sm" /> : null}{tr("Lập biên bản")}</button></div>
      </form>
    </div>
  );
}

function MeetingView({ id, onBack, onOpenChat, say }: { id: string; onBack: () => void; onOpenChat: (title: string, text: string) => void; say: (m: string) => void }) {
  const [m, setM] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<"min" | "todo" | "raw">("min");
  const load = useCallback(() => api<{ meeting: Meeting }>("GET", `/api/meetings/${id}`).then((j) => setM(j.meeting)).catch((e) => say(e.message)), [id, say]);
  useEffect(() => { load(); }, [load]);
  // Đang xử lý: theo dõi lượt chạy bền, xong thì tải lại.
  useEffect(() => {
    if (!m?.run || (m.status !== "transcribing" && m.status !== "summarizing")) return;
    let on = true;
    const t = setInterval(() => { if (on) load(); }, 4000);
    waitRun(m.run).finally(() => { if (on) load(); });
    return () => { on = false; clearInterval(t); };
  }, [m?.run, m?.status, load]);
  const patch = async (it: Item, body: Partial<{ done: boolean; assignee: string; due: string | null }>) => {
    setM((x) => (x ? { ...x, items: x.items?.map((y) => (y.id === it.id ? { ...y, ...body, done: body.done === undefined ? y.done : body.done ? 1 : 0 } as Item : y)) } : x));
    try { await api("PATCH", `/api/meetings/items/${it.id}`, body); } catch (e) { say((e as Error).message); load(); }
  };
  const asText = (mm: Meeting) => {
    const n = mm.minutes!;
    return `# ${mm.title} (${vnDate(mm.date)})\n\n${n.tomTat}\n\n## ${tr("Quyết định")}\n${n.quyetDinh.map((x) => `- ${x}`).join("\n") || "-"}\n\n## ${tr("Việc cần làm")}\n${(mm.items ?? []).map((x) => `- [${x.done ? "x" : " "}] ${x.text}${x.assignee ? ` · ${x.assignee}` : ""}${x.due ? ` · ${tr("hạn")} ${vnDate(x.due)}` : ""}`).join("\n")}\n\n## ${tr("Câu hỏi còn mở")}\n${n.cauHoiMo.map((x) => `- ${x}`).join("\n") || "-"}`;
  };
  // Biên bản Word theo thể thức Nghị định 30 (dùng lại bộ dàn trang văn bản hành chính).
  const word = async (mm: Meeting) => {
    const n = mm.minutes!;
    const spec = { loai: "bien-ban", coQuan: tr("TÊN CƠ QUAN, TỔ CHỨC"), kyHieu: "BB", diaDanh: tr("Hà Nội"), ngay: mm.date, trichYeu: mm.title,
      noiDung: [`# I. ${tr("THÀNH PHẦN THAM DỰ")}`, n.thanhPhan.join(", ") || "-", `# II. ${tr("NỘI DUNG")}`, n.tomTat, ...n.noiDung.map((x) => `- ${x}`),
        `# III. ${tr("KẾT LUẬN")}`, ...(n.quyetDinh.length ? n.quyetDinh.map((x) => `- ${x}`) : ["-"]), `# IV. ${tr("PHÂN CÔNG THỰC HIỆN")}`,
        ...(mm.items ?? []).map((x, i) => `${i + 1}. ${x.text}${x.assignee ? ` (${x.assignee})` : ""}${x.due ? `, ${tr("hạn")} ${vnDate(x.due)}` : ""}.`)],
      chucVu: tr("CHỦ TRÌ CUỘC HỌP"), nguoiKy: "……………………", noiNhan: [tr("Các thành viên dự họp;"), "Lưu: VT."] };
    const r = await fetch("/api/vbhc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: JSON.stringify(spec), name: "bien-ban-hop.docx" }) });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error || "Lỗi");
    saveBlob(await r.blob(), "bien-ban-hop.docx"); say(tr("Đã tải biên bản"));
  };
  if (!m) return <div className="empty"><span className="art-spin" /></div>;
  const busy = m.status === "transcribing" || m.status === "summarizing";
  const items = m.items ?? [];
  return (
    <div className="mt-view">
      <button className="btn mt-back" onClick={onBack}><span className="flip"><I.ChevronR size={14} /></span>{tr("Tất cả cuộc họp")}</button>
      <div className="mt-h"><h2 data-notr>{m.title}</h2><span>{vnDate(m.date)}{m.engine ? ` · ${tr("chép lời bằng")} ${m.engine}` : ""}</span></div>
      {busy ? <div className="mt-busy"><span className="art-spin" /><b>{tr(STATUS[m.status])}</b><span>{tr("Bạn có thể rời trang, Synchro vẫn xử lý ở nền.")}</span></div>
        : m.status === "error" ? <div className="sk-err"><span>{m.error}</span></div> : m.minutes && <>
          <div className="mt-acts">
            <div className="pl-seg"><button className={tab === "min" ? "on" : ""} onClick={() => setTab("min")}>{tr("Biên bản")}</button><button className={tab === "todo" ? "on" : ""} onClick={() => setTab("todo")}>{tr("Việc cần làm")} <i className="tk-badge">{items.filter((x) => !x.done).length}</i></button><button className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>{tr("Bản ghi")}</button></div>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => word(m)}><I.Download size={14} />{tr("Biên bản Word")}</button>
            <button className="btn" onClick={() => onOpenChat(m.title, asText(m))}><I.Chat2 size={14} />{tr("Hỏi tiếp trong chat")}</button>
          </div>
          {tab === "min" ? (
            <div className="mt-min">
              <p className="mt-sum">{m.minutes.tomTat}</p>
              {[["Thành phần", m.minutes.thanhPhan], ["Nội dung chính", m.minutes.noiDung], ["Quyết định", m.minutes.quyetDinh], ["Câu hỏi còn mở", m.minutes.cauHoiMo]].map(([h, l]) => (l as string[]).length ? (
                <section key={h as string}><h3>{tr(h as string)}</h3><ul>{(l as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul></section>
              ) : null)}
            </div>
          ) : tab === "todo" ? (
            !items.length ? <div className="empty"><span>{tr("Cuộc họp không có việc cần làm nào.")}</span></div> : (
              <div className="mt-todo">{items.map((x) => (
                <div key={x.id} className={`mt-item ${x.done ? "done" : ""}`}>
                  <button className={`mt-check ${x.done ? "on" : ""}`} aria-label={x.done ? "Đánh dấu chưa xong" : "Đánh dấu đã xong"} onClick={() => patch(x, { done: !x.done })}>{x.done ? <I.Check size={13} /> : null}</button>
                  <span className="mt-text">{x.text}</span>
                  <input className="mt-who" value={x.assignee} placeholder={tr("Người phụ trách")} onChange={(e) => setM((mm) => (mm ? { ...mm, items: mm.items?.map((y) => (y.id === x.id ? { ...y, assignee: e.target.value } : y)) } : mm))} onBlur={(e) => patch(x, { assignee: e.target.value })} />
                  <input className="mt-due" type="date" value={x.due ?? ""} onChange={(e) => patch(x, { due: e.target.value || null })} />
                </div>
              ))}<p className="tk-tz">{tr("Đến hạn mà chưa xong, Synchro gửi lời nhắc vào Hộp thư lúc 8 giờ sáng.")}</p></div>
            )
          ) : <pre className="mt-raw">{m.transcript}</pre>}
        </>}
    </div>
  );
}

// initial: mở thẳng một cuộc họp (từ lời nhắc trong Hộp thư).
export function MeetingsPage({ say, model, onOpenChat, initial }: { say: (m: string) => void; model?: string; onOpenChat: (title: string, text: string) => void; initial?: string | null }) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [stt, setStt] = useState(false);
  const [open, setOpen] = useState<string | null>(initial ?? null);
  useEffect(() => { if (initial) setOpen(initial); }, [initial]);
  const [form, setForm] = useState(false);
  const load = useCallback(() => api<{ meetings: Summary[]; stt: boolean }>("GET", "/api/meetings").then((j) => { setList(j.meetings); setStt(j.stt); }).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const del = async (id: string) => { try { await api("DELETE", `/api/meetings/${id}`); load(); } catch (e) { say((e as Error).message); } };
  return (
    <div className="page"><div className="page-in tk">
      {open ? <MeetingView id={open} onBack={() => { setOpen(null); load(); }} onOpenChat={onOpenChat} say={say} /> : <>
        <div className="tk-top"><h1>{tr("Cuộc họp")}</h1><span style={{ flex: 1 }} /><button className="btn dark" onClick={() => setForm(true)}><I.Plus size={14} />{tr("Cuộc họp mới")}</button></div>
        {!list ? <div className="empty"><span className="art-spin" /></div> : !list.length ? (
          <div className="apps-empty"><I.Mic size={22} /><b>{tr("Chưa có cuộc họp nào")}</b><span>{tr("Tải tệp ghi âm cuộc họp hoặc dán ghi chép: Synchro lập biên bản, tách việc cần làm, người phụ trách, hạn chót và nhắc khi đến hạn.")}</span><button className="btn dark" onClick={() => setForm(true)}>{tr("Cuộc họp mới")}</button></div>
        ) : (
          <div className="apps-list">{list.map((m) => (
            <div key={m.id} className="apps-row" role="button" tabIndex={0} onClick={() => setOpen(m.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(m.id)}>
              <span className="pl-mark" style={{ width: 36, height: 36 }}><I.Mic size={17} /></span>
              <div className="apps-t"><b data-notr>{m.title}</b><span>{vnDate(m.date)} · {m.status === "done" ? `${m.items} ${tr("việc")}, ${m.done} ${tr("đã xong")}` : tr(STATUS[m.status] ?? m.status)}</span></div>
              {(m.status === "transcribing" || m.status === "summarizing") && <span className="art-spin sm" />}
              <button className="icon-btn" aria-label="Xóa cuộc họp" data-tip="Xóa cuộc họp" onClick={(e) => { e.stopPropagation(); del(m.id); }}><I.Trash size={15} /></button>
            </div>
          ))}</div>
        )}
      </>}
      {form && <NewMeeting stt={stt} model={model} say={say} onClose={() => setForm(false)} onCreated={(id) => { setForm(false); load(); setOpen(id); }} />}
    </div></div>
  );
}
