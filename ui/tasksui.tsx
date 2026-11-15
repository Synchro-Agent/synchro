"use client";
import "./styles/skills.css";
// Hộp thư tự động hóa: giao việc bằng câu thường → Synchro lên kế hoạch (tên, lịch, trình duyệt, hướng dẫn chi tiết), người dùng xem / sửa rồi tạo.
// Việc chạy nền trên máy chủ theo lịch, kể cả khi máy người dùng tắt hay đã đóng trang. Ba mục: Kết quả (theo ngày, xem tiến độ đang chạy, nhật ký),
// Cần duyệt (đề xuất của việc tự động: tạo skill, hành động, trang web, công cụ — duyệt là Synchro làm), Việc tự động (lịch, bật / tắt, chạy ngay).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, statusText } from "./apierr";
import * as I from "./icons";
import { getLang, tr } from "../app/i18n";
import { isForeign } from "../shared/chaterror";
import { canRerun, failInfo, failLine, isExpired, TOO_OLD } from "../shared/taskerr";
import { INBOX_CHANGED, useInboxCount } from "./inboxcount";
export { INBOX_CHANGED, useInboxCount };
import { Markdown } from "./md";
import { artifactsAsCode, hasArtifacts, splitArtifacts } from "../shared/artifacts";
import { isDeck } from "../shared/artdoc";
import { AUTO, modelName, useModels } from "./models";
import { allowsModel } from "../shared/catalog";
import { useApp } from "./store";
import { ScopeChoice, useIsAdmin, type Scope } from "./skillsui";
import { TimePick } from "./timepick";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "./bulk";
import { PageBar, usePage } from "./pager";

type Schedule = { kind: "once" | "hourly" | "daily" | "weekdays" | "weekly"; time?: string; weekday?: number; every?: number; tz: string };
type BrowserPref = "auto" | "synchro" | "user";
type Engine = "chat" | "code";
type Last = { run: string; status: string; at: number } | null;
type Task = { id: string; title: string; prompt: string; schedule: Schedule; model: string | null; enabled: boolean; next_run_at: number | null; last_run_at: number | null; created_at: number; runs: number; browser: BrowserPref; memory: boolean; wait_since: number | null; retries: number; last: Last; pending: number; engine: Engine; sid: string | null };
type Item = { run: string; task: string; title: string; at: number; read: boolean; status: string; text: string; error?: string; kind?: "task" | "notice" | "action"; link?: string; note?: string; model?: string; proposals?: number };
type Proposal = { id: string; task: string | null; taskTitle: string | null; run: string | null; kind: "skill" | "action" | "site" | "tool"; title: string; summary: string; payload: Record<string, unknown>; status: "pending" | "running" | "done" | "failed" | "rejected"; result: string | null; at: number; decidedAt: number | null };
type Plan = { title: string; prompt: string; schedule: Schedule; browser: BrowserPref; engine: Engine; approvals: string[]; needs: string[] };
type RunEv = { seq: number; at: number; kind: string; text: string };

const api = async <T,>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || statusText(r.status));
  return j as T;
};
const DAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
export const scheduleText = (s: Schedule) => s.kind === "once" ? tr("Một lần") : s.kind === "hourly" ? (s.every && s.every > 1 ? `${tr("Mỗi")} ${s.every} ${tr("giờ")}` : tr("Mỗi giờ"))
  : s.kind === "daily" ? `${tr("Mỗi ngày lúc")} ${s.time}` : s.kind === "weekdays" ? `${tr("Thứ Hai – thứ Sáu lúc")} ${s.time}` : `${tr(DAYS[s.weekday ?? 1])} ${tr("hằng tuần lúc")} ${s.time}`;
// Kết quả có artifact: tài liệu Markdown hiện thẳng như văn bản, loại khác hiện thành khối mã.
const readable = (text: string) => (hasArtifacts(text) ? splitArtifacts(text).map((sg) => (sg.kind === "text" ? sg.text : sg.art.type === "markdown" ? `\n${sg.art.content}\n` : artifactsAsCode(`<artifact identifier="${sg.art.ident}" type="${sg.art.type}" title="${sg.art.title}">\n${sg.art.content}\n</artifact>`))).join("") : text);
const z = (n: number) => String(n).padStart(2, "0");
// "14:05" trong hôm nay, "14:05 · 26/10" các ngày khác.
const when = (t: number) => { const d = new Date(t), hm = `${z(d.getHours())}:${z(d.getMinutes())}`; return d.toDateString() === new Date().toDateString() ? hm : `${hm} · ${z(d.getDate())}/${z(d.getMonth() + 1)}`; };
const dayOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayLabel = (t: number) => { const today = dayOf(Date.now()); return t === today ? tr("Hôm nay") : t === today - 86_400_000 ? tr("Hôm qua") : `${tr(DAYS[new Date(t).getDay()])}, ${z(new Date(t).getDate())}/${z(new Date(t).getMonth() + 1)}`; };
// Bản trình bày (slide HTML) trong kết quả một lượt: mỗi identifier một nút "Tải PowerPoint" (G4.6, xuất ở máy chủ qua /api/artifacts/pptx —
// kết quả việc tự động không vào kho artifact và không có khung xem để xuất ngay trong trình duyệt). Bản vá dùng chung identifier với bản đầy đủ.
const decksIn = (text: string) => [...new Map(splitArtifacts(text).flatMap((sg) => (sg.kind === "art" && !sg.art.patch && sg.art.complete && isDeck(sg.art) ? [[sg.art.ident, sg.art.title] as const] : []))).entries()].map(([ident, title]) => ({ ident, title }));
/** Xuất một bản trình bày trong kết quả lượt thành .pptx ở máy chủ rồi tải về (lỗi: câu tiếng Việt của máy chủ, nơi gọi dịch bằng tr). */
async function downloadPptx(run: string, ident: string) {
  const r = await apiFetch("/api/artifacts/pptx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run, identifier: ident }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error || statusText(r.status)); }
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "presentation.pptx";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
const excerpt = (t: string) => t.replace(/<artifact[\s\S]*?<\/artifact>/g, "").replace(/[#*_`>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Việc mẫu: người dùng bấm để điền ô giao việc rồi sửa cho đúng ý mình.
const EXAMPLES = [
  { label: "Giá cổ phiếu mỗi sáng", text: "Thứ Hai đến thứ Sáu lúc 8h30 sáng, tra giá cổ phiếu FPT và VNM (giá đóng cửa hôm trước, khối lượng, tin mới), phân tích xu hướng và đưa ra gợi ý giao dịch kèm lý do và rủi ro" },
  { label: "Repo GitHub hay → skill", text: "Mỗi ngày lúc 7h sáng, lên GitHub tìm những repo mới có ý tưởng hay, tốt, đột phá ở mọi lĩnh vực, phân tích từng repo và chuyển repo đáng giá nhất thành skill (hỏi tôi trước khi tạo skill)" },
  { label: "Bản tin AI buổi sáng", text: "Mỗi ngày 7h sáng tóm tắt 5 tin công nghệ và AI quan trọng nhất trong 24 giờ qua, mỗi tin một đoạn ngắn kèm nguồn" },
  { label: "Theo dõi giá sản phẩm", text: "Mỗi 6 giờ kiểm tra giá iPhone 17 Pro 256GB ở các nhà bán lẻ lớn tại Việt Nam, so với lần trước và báo rõ nơi nào đang rẻ nhất" },
] as const;
const BROWSERS: { id: BrowserPref; label: string; hint: string }[] = [
  { id: "auto", label: "Tự chọn", hint: "Trình duyệt của Synchro trên máy chủ (chạy được cả khi máy bạn tắt); Chrome của bạn khi cần tài khoản bạn đã đăng nhập và Chrome đang mở." },
  { id: "synchro", label: "Trình duyệt của Synchro", hint: "Luôn chạy trên máy chủ, không đụng tới Chrome của bạn." },
  { id: "user", label: "Chrome của bạn", hint: "Dùng tài khoản bạn đã đăng nhập. Đến giờ mà Chrome đang tắt thì chờ bạn mở lại (tối đa 12 giờ) rồi mới chạy." },
];
// Cách làm: lượt chat đủ công cụ, hay Synchro Code trong workspace riêng của việc (repo, lệnh, pull request).
const ENGINES: { id: Engine; label: string; hint: string }[] = [
  { id: "chat", label: "Tra cứu & xử lý", hint: "Tìm web, trình duyệt, Chrome của bạn, connector, skill, chạy code. Hợp với báo cáo, phân tích, theo dõi, soạn nội dung." },
  { id: "code", label: "Synchro Code", hint: "Làm trong workspace riêng, giữ lại giữa các lần chạy: sửa tệp, chạy lệnh, git, mở pull request trên repo của bạn." },
];
// Khả năng việc tự động hay cần (tên như ở Cài đặt → Khả năng).
const CAPS: [string, string][] = [["browse", "Browser control"], ["code", "Code execution and file creation"], ["net", "Allow network egress"]];
const KIND_ICON = { skill: <I.Sparkle size={16} />, action: <I.Rocket size={16} />, site: <I.Globe size={16} />, tool: <I.Plug size={16} /> };
const KIND_LABEL = { skill: "Tạo skill", action: "Việc cần làm", site: "Cho phép trang web", tool: "Dùng công cụ" };
const APPROVE = { skill: "Tạo skill", action: "Cho phép làm", site: "Cho phép trang này", tool: "Cho phép chạy" };

const changed = () => window.dispatchEvent(new Event(INBOX_CHANGED));

// ---------------------------------------------------------------- tạo / sửa việc tự động
function ModelPick({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const m = useModels();
  const groups = m.providers.map((p) => ({ name: p.name, models: p.models.filter((x) => allowsModel(m.allowed, x.key)) })).filter((g) => g.models.length);
  return (
    <select className="field" aria-label="Model" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={AUTO}>{tr("Tự động: chọn model hợp với việc, lỗi thì chuyển model khác")}</option>
      {groups.map((g) => <optgroup key={g.name} label={g.name}>{g.models.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</optgroup>)}
      {value !== AUTO && !groups.some((g) => g.models.some((x) => x.key === value)) && <option value={value}>{modelName(value)}</option>}
    </select>
  );
}

function TaskEditor({ init, plan, onClose, onSaved, say }: { init?: Task | null; plan?: Plan | null; onClose: () => void; onSaved: (t: Task, ran: boolean) => void; say: (m: string) => void }) {
  const src = init ?? plan;
  const [title, setTitle] = useState(src?.title ?? "");
  const [prompt, setPrompt] = useState(src?.prompt ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(src?.schedule.kind ?? "daily");
  const [time, setTime] = useState(src?.schedule.time ?? "08:00");
  const [weekday, setWeekday] = useState(src?.schedule.weekday ?? 1);
  const [every, setEvery] = useState(src?.schedule.every ?? 1);
  const [browser, setBrowser] = useState<BrowserPref>(src?.browser ?? "auto");
  const codeOk = !!useApp().me?.perms.features.code;
  // Quản trị viên tắt "Your Chrome": không chọn được Chrome của bạn (việc đã đặt sẵn thì chạy bằng trình duyệt của Synchro).
  const chromeOk = useApp().me?.perms.features.chrome !== false;
  const [engine, setEngine] = useState<Engine>(codeOk ? src?.engine ?? "chat" : "chat");
  const [model, setModel] = useState(init?.model ?? AUTO);
  const [memory, setMemory] = useState(init?.memory ?? true);
  const [busy, setBusy] = useState<"" | "save" | "run">("");
  const save = async (andRun: boolean) => {
    setBusy(andRun ? "run" : "save");
    const body = { title, prompt, schedule: { kind, time, weekday, every, tz: tz() }, browser, model, memory, engine };
    try {
      const { task } = init ? await api<{ task: Task }>("PATCH", `/api/tasks/${init.id}`, body) : await api<{ task: Task }>("POST", "/api/tasks", body);
      let ran = false;
      if (andRun && kind !== "once") { await api("POST", `/api/tasks/${task.id}/run`).then(() => { ran = true; }, (e) => say((e as Error).message)); }
      say(init ? tr("Đã lưu việc tự động") : kind === "once" ? tr("Đã tạo, Synchro chạy trong vòng một phút") : ran ? tr("Đã tạo và đang chạy thử, kết quả vào Hộp thư") : tr("Đã tạo việc tự động"));
      onSaved(task, ran || kind === "once");
    } catch (e) { say((e as Error).message); setBusy(""); }
  };
  return (
    <div className="overlay" style={{ zIndex: "var(--z-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal tk-modal" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <button type="button" className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        <h2>{init ? tr("Sửa việc tự động") : plan ? tr("Kế hoạch của Synchro") : tr("Việc tự động mới")}</h2>
        <div className="tk-mbody">
        <p className="d">{init ? tr("Đổi lịch, trình duyệt hay hướng dẫn; lần chạy tới dùng ngay bản mới.") : tr("Xem lại và sửa nếu cần. Synchro chạy việc này trên máy chủ theo lịch, kể cả khi bạn tắt máy.")}</p>
        <label className="tk-l">{tr("Tên")}<input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Ví dụ: Giá cổ phiếu mỗi sáng")} data-notr /></label>
        <div className="tk-sch">
          <label className="tk-l">{tr("Lịch chạy")}<select className="field" value={kind} onChange={(e) => setKind(e.target.value as Schedule["kind"])}>
            <option value="once">{tr("Một lần, chạy ngay")}</option><option value="hourly">{tr("Mỗi vài giờ")}</option><option value="daily">{tr("Mỗi ngày")}</option><option value="weekdays">{tr("Thứ Hai – thứ Sáu")}</option><option value="weekly">{tr("Mỗi tuần")}</option>
          </select></label>
          {kind === "hourly" && <label className="tk-l">{tr("Cách nhau")}<select className="field" value={every} onChange={(e) => setEvery(Number(e.target.value))}>{[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} {tr("giờ")}</option>)}</select></label>}
          {kind === "weekly" && <label className="tk-l">{tr("Vào")}<select className="field" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{DAYS.map((d, i) => <option key={i} value={i}>{tr(d)}</option>)}</select></label>}
          {(kind === "daily" || kind === "weekdays" || kind === "weekly") && <div className="tk-l">{tr("Lúc")}<TimePick value={time} onChange={setTime} /></div>}
        </div>
        <p className="tk-tz">{tr("Giờ theo múi giờ")} <span data-notr>{tz()}</span></p>
        {codeOk && <div className="tk-l">{tr("Cách làm")}
          <div className="tk-br two" role="radiogroup">{ENGINES.map((b) => (
            <button type="button" key={b.id} role="radio" aria-checked={engine === b.id} className={engine === b.id ? "on" : ""} onClick={() => setEngine(b.id)}><b>{tr(b.label)}</b><span>{tr(b.hint)}</span></button>
          ))}</div>
        </div>}
        {engine === "chat" ? <div className="tk-l">{tr("Trình duyệt")}
          <div className="tk-br" role="radiogroup">{BROWSERS.map((b) => (
            <button type="button" key={b.id} role="radio" aria-checked={browser === b.id} className={browser === b.id ? "on" : ""} disabled={b.id === "user" && !chromeOk} onClick={() => setBrowser(b.id)}><b>{tr(b.label)}</b><span>{tr(b.hint)}</span></button>
          ))}</div>
          {!chromeOk && <p className="tk-tz">{tr(browser === "user" ? "Quản trị viên chưa cho phép tài khoản của bạn dùng Chrome của bạn: việc này sẽ chạy bằng trình duyệt của Synchro." : "Quản trị viên chưa cho phép tài khoản của bạn dùng Chrome của bạn.")}</p>}
        </div> : <p className="tk-tz">{tr("Synchro Code dùng trình duyệt của Synchro trên máy chủ khi cần mở web. Lệnh cần duyệt (khi chế độ Tự động đang tắt trong Cài đặt → Synchro Code) sẽ thành đề xuất trong Hộp thư.")}</p>}
        <label className="tk-l">{tr("Model")}<ModelPick value={model} onChange={setModel} /></label>
        <label className="tk-l">{tr("Hướng dẫn chi tiết cho Synchro")}<textarea className="field" value={prompt} maxLength={8000} rows={7} onChange={(e) => setPrompt(e.target.value)} placeholder={tr("Viết như khi nhắn cho Synchro. Connector đã kết nối (email, lịch…) được dùng như trong chat.")} data-notr /></label>
        {plan && (plan.approvals.length > 0 || plan.needs.length > 0) && <div className="tk-notes">
          {plan.approvals.length > 0 && <div><b>{tr("Synchro sẽ hỏi bạn trước khi")}</b><ul>{plan.approvals.map((a) => <li key={a} data-notr>{a}</li>)}</ul></div>}
          {plan.needs.length > 0 && <div><b>{tr("Cần có để chạy tốt")}</b><ul>{plan.needs.map((a) => <li key={a} data-notr>{a}</li>)}</ul></div>}
        </div>}
        <label className="tk-mem"><button type="button" className={`toggle ${memory ? "on" : ""}`} role="switch" aria-checked={memory} aria-label="Nhớ kết quả các lần trước" onClick={() => setMemory(!memory)} /><span><b>{tr("Nhớ kết quả các lần trước")}</b>{tr("So sánh với lần trước, không báo hay đề xuất lại điều đã có.")}</span></label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={!!busy}>{tr("Hủy")}</button>
          {!init && kind !== "once" && <button type="button" className="btn" disabled={!!busy || !title.trim() || !prompt.trim()} onClick={() => save(true)}>{busy === "run" ? <span className="art-spin sm" /> : <I.Play size={13} />}{tr("Tạo và chạy thử ngay")}</button>}
          <button className="btn dark" disabled={!!busy || !title.trim() || !prompt.trim()}>{busy === "save" ? <span className="art-spin sm" /> : null}{init ? tr("Lưu") : kind === "once" ? tr("Chạy") : tr("Tạo việc tự động")}</button>
        </div>
      </form>
    </div>
  );
}

// Ô giao việc: câu thường → kế hoạch (máy chủ hỏi model nhanh), mở thẻ kế hoạch để xem / sửa rồi tạo.
function Composer({ onPlan, onManual, say }: { onPlan: (p: Plan) => void; onManual: () => void; say: (m: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { const { plan } = await api<{ plan: Plan }>("POST", "/api/tasks/plan", { text, tz: tz() }); onPlan(plan); setText(""); }
    catch (e) { say((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="tk-comp">
      <textarea value={text} rows={2} maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }}
        placeholder={tr("Giao việc cho Synchro, ví dụ: mỗi sáng 8h tra giá cổ phiếu FPT, phân tích và gợi ý giao dịch")} aria-label={tr("Giao việc cho Synchro")} data-notr />
      <div className="tk-comp-bar">
        <div className="tk-ex">{EXAMPLES.map((x) => <button key={x.label} type="button" className="chip" onClick={() => setText(tr(x.text))}>{tr(x.label)}</button>)}</div>
        <button type="button" className="btn ghost" onClick={onManual}>{tr("Tự đặt")}</button>
        <button type="button" className="btn dark" disabled={!text.trim() || busy} onClick={go}>{busy ? <span className="art-spin sm" /> : <I.Sparkle size={14} />}{busy ? tr("Đang lên kế hoạch…") : tr("Lên kế hoạch")}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- đề xuất chờ duyệt
function ProposalCard({ p, say, onDone }: { p: Proposal; say: (m: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  // Skill đề xuất: tạo cho riêng mình hay đưa vào Thư viện cho mọi người (chỉ quản trị viên).
  const admin = useIsAdmin();
  const [scope, setScope] = useState<Scope>("me");
  const pl = p.payload as { name?: string; description?: string; skill_md?: string; files?: { path: string }[]; instructions?: string; source?: string; host?: string; url?: string; connector?: string; tool?: string; input?: unknown };
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    const edits = p.kind === "skill" ? { ...(draft === null ? {} : { skill_md: draft }), ...(scope === "org" ? { scope } : {}) } : draft === null ? undefined : { instructions: draft };
    try {
      await api("POST", "/api/inbox/proposals", { id: p.id, decision, edits });
      say(decision === "reject" ? tr("Đã bỏ qua đề xuất") : p.kind === "skill" ? tr(scope === "org" ? "Đã tạo skill và thêm vào thư viện cho mọi người" : "Đã tạo skill") : p.kind === "action" ? tr("Synchro đang làm việc đã duyệt, kết quả vào Hộp thư") : tr("Đã cho phép"));
      changed(); onDone();
    } catch (e) { say((e as Error).message); onDone(); }
    setBusy("");
  };
  const err = p.status === "pending" && p.result?.startsWith("Lỗi:") ? p.result : null;
  const body = p.kind === "skill" ? pl.skill_md ?? "" : p.kind === "action" ? pl.instructions ?? "" : "";
  return (
    <div className={`tk-prop ${p.status}`}>
      <div className="tk-prop-h">
        <span className={`tk-prop-ic ${p.kind}`}>{KIND_ICON[p.kind]}</span>
        <span className="tk-t"><b data-notr>{p.title}</b><em>{tr(KIND_LABEL[p.kind])}{p.taskTitle ? <> · <span data-notr>{p.taskTitle}</span></> : null} · {when(p.at)}</em></span>
        {p.status !== "pending" && <span className={`tk-st ${p.status}`}>{p.status === "done" ? tr("Đã duyệt") : p.status === "rejected" ? tr("Đã bỏ qua") : p.status === "running" ? tr("Đang làm") : tr("Lỗi")}</span>}
      </div>
      {p.kind === "skill" && pl.description && <p className="tk-prop-d" data-notr>{pl.description}</p>}
      {p.kind === "site" ? <p className="tk-prop-d">{tr("Việc tự động cần mở trang này nhưng trang chưa có trong danh sách trang được phép.")} <span data-notr>{pl.url || pl.host}</span></p>
        : p.kind === "tool" ? <p className="tk-prop-d">{tr("Công cụ này đang để chế độ hỏi trước mỗi lần dùng. Tham số:")} <code data-notr>{p.summary}</code></p>
        : <div className="mdx tk-prop-s"><Markdown text={p.summary} say={say} /></div>}
      {pl.source && <a className="tk-src" href={pl.source} target="_blank" rel="noopener noreferrer" data-notr><I.External size={12} />{pl.source.replace(/^https?:\/\//, "").slice(0, 80)}</a>}
      {(p.kind === "skill" || p.kind === "action") && p.status === "pending" && <>
        <button type="button" className={`tk-more ${open ? "on" : ""}`} onClick={() => setOpen(!open)}><I.Chevron size={12} />{p.kind === "skill" ? tr("Xem và sửa SKILL.md") : tr("Xem và sửa việc Synchro sẽ làm")}{pl.files?.length ? ` · ${pl.files.length} ${tr("tệp kèm theo")}` : ""}</button>
        {open && <textarea className="field mono tk-prop-md" aria-label={p.kind === "skill" ? tr("Xem và sửa SKILL.md") : tr("Xem và sửa việc Synchro sẽ làm")} value={draft ?? body} onChange={(e) => setDraft(e.target.value)} rows={12} spellCheck={false} data-notr />}
      </>}
      {err && <div className="sk-err"><span data-notr>{err}</span></div>}
      {p.kind === "skill" && p.status === "pending" && <ScopeChoice value={scope} onChange={setScope} admin={admin} disabled={!!busy} />}
      {p.status !== "pending" && p.result && <p className="tk-prop-r" data-notr>{p.result.slice(0, 600)}</p>}
      {p.status === "pending" && <div className="tk-acts">
        <button className="btn dark" disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? <span className="art-spin sm" /> : <I.Check size={14} />}{tr(APPROVE[p.kind])}</button>
        <button className="btn" disabled={!!busy} onClick={() => decide("reject")}>{tr("Bỏ qua")}</button>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- một kết quả (mở ra xem chi tiết, tiến độ, nhật ký, đề xuất của lần chạy)
const LOG_KINDS = new Set(["tool", "note", "step", "say", "ui"]);
// Lỗi nguyên văn tiếng Anh của hãng trên giao diện tiếng Việt (hay ngược lại): câu chung, nguyên văn để ở phần chi tiết (như thẻ lỗi của chat).
const foreign = (s: string) => isForeign(s, tr(s), getLang());
/** Lý do lỗi một dòng cho dòng Hộp thư (đã dịch). */
const failReason = (raw?: string) => failLine(tr(failInfo(raw, foreign).text));
function ResultBody({ x, task, say, onOpenChat, onRetry, reload }: { x: Item; task?: Task; say: (m: string) => void; onOpenChat: (title: string, text: string) => void; onRetry: (t: Task) => void; reload: () => void }) {
  const [events, setEvents] = useState<RunEv[] | null>(null);
  const [props, setProps] = useState<Proposal[]>([]);
  const [log, setLog] = useState(false);
  const [pptx, setPptx] = useState<string | null>(null);
  const { openSettings } = useApp();
  const decks = useMemo(() => (x.status === "done" && !x.error ? decksIn(x.text) : []), [x.status, x.error, x.text]);
  const getPptx = async (ident: string) => {
    if (pptx) return;
    setPptx(ident); say(tr("Đang dựng tệp PowerPoint…"));
    try { await downloadPptx(x.run, ident); say(tr("Đã tải tệp PowerPoint")); } catch (e) { say(tr((e as Error).message)); } finally { setPptx(null); }
  };
  const real = x.kind !== "notice" && x.status !== "waiting";
  useEffect(() => {
    if (!real) return;
    let stop = false;
    const load = () => {
      api<{ run: { events: RunEv[]; status: string } }>("GET", `/api/runs/${x.run}?json=1`).then((j) => { if (!stop) { setEvents(j.run.events); if (j.run.status !== "running" && x.status === "running") reload(); } }).catch(() => {});
      if (x.proposals) api<{ proposals: Proposal[] }>("GET", `/api/inbox/proposals?run=${x.run}`).then((j) => { if (!stop) setProps(j.proposals); }).catch(() => {});
    };
    load();
    const t = x.status === "running" ? setInterval(load, 3000) : null;
    return () => { stop = true; if (t) clearInterval(t); };
  }, [x.run, x.status, x.proposals, real, reload]);
  const steps = (events ?? []).filter((e) => LOG_KINDS.has(e.kind) && !(e.kind === "ui"));
  const lastStep = [...steps].reverse().find((e) => e.kind !== "say");
  return (
    <div className="tk-body">
      {x.note && <p className="tk-note"><I.InfoCircle size={13} /><span data-notr>{tr(x.note)}</span></p>}
      {x.status === "waiting" ? <div className="tk-run"><I.Clock size={14} />{tr("Đến giờ chạy nhưng Chrome của bạn đang tắt. Synchro chạy ngay khi Chrome kết nối lại, hoặc sau 12 giờ thì chạy bằng trình duyệt của Synchro.")}</div>
        : x.status === "running" ? <div className="tk-run"><span className="art-spin sm" />{lastStep ? <span data-notr>{tr(lastStep.text)}</span> : <span>{tr("Synchro đang chạy việc này trên máy chủ")}</span>}</div>
        : isExpired(x) ? <p className="tk-note"><I.Clock size={13} /><span>{tr(TOO_OLD)}</span></p>
        : x.error ? ((e) => <div className="sk-err tk-err"><span data-notr>{tr(e.text)}</span>{e.detail && <details><summary>{tr("Chi tiết kỹ thuật")}</summary><code data-notr>{e.detail}</code></details>}</div>)(failInfo(x.error, foreign))
        : <div className="mdx"><Markdown text={readable(x.text)} say={say} /></div>}
      {props.length > 0 && <div className="tk-props-in"><b>{tr("Đề xuất của lần chạy này")}</b>{props.map((p) => <ProposalCard key={p.id} p={p} say={say} onDone={() => { reload(); api<{ proposals: Proposal[] }>("GET", `/api/inbox/proposals?run=${x.run}`).then((j) => setProps(j.proposals)).catch(() => {}); }} />)}</div>}
      {log && steps.length > 0 && <ol className="tk-log">{steps.map((e) => <li key={e.seq} className={e.kind}><span>{when(e.at).split(" ·")[0]}</span><span data-notr>{e.text}</span></li>)}</ol>}
      {x.kind !== "notice" && x.status !== "waiting" && <div className="tk-acts">
        {x.status === "done" && <button className="btn" onClick={() => onOpenChat(x.title, x.text)}><I.Chat2 size={14} />{tr("Mở thành đoạn chat")}</button>}
        {decks.map((d) => <button key={d.ident} className="btn" disabled={!!pptx} aria-busy={pptx === d.ident} title={d.title} onClick={() => getPptx(d.ident)}>
          {pptx === d.ident ? <span className="art-spin sm" /> : <I.Download size={14} />}{tr("Tải PowerPoint")}{decks.length > 1 && <span className="tk-deck" data-notr>{d.title}</span>}</button>)}
        {task && x.status !== "running" && <button className="btn" onClick={() => onRetry(task)}><I.Retry size={14} />{tr("Chạy lại")}</button>}
        {steps.length > 0 && <button className="btn ghost" onClick={() => setLog(!log)}><I.List size={14} />{log ? tr("Ẩn nhật ký") : `${tr("Nhật ký")} (${steps.length})`}</button>}
        {x.model && <span className="tk-model" data-notr>{modelName(x.model)}</span>}
      </div>}
      {x.kind === "notice" && x.link?.startsWith("settings:") && <div className="tk-acts"><button className="btn" onClick={() => openSettings?.(x.link!.slice(9))}><I.Cog size={14} />{tr("Mở Cài đặt")}</button></div>}
      {x.kind === "notice" && x.link?.startsWith("app:") && <div className="tk-acts"><a className="btn" href={`/apps/${encodeURIComponent(x.link.slice(4))}#comments`} target="_blank" rel="noopener"><I.Chat2 size={14} />{tr("Mở bình luận")}</a></div>}
    </div>
  );
}

// ---------------------------------------------------------------- trang Hộp thư
const LoadErr = ({ title, err, retry }: { title: string; err: string; retry: () => void }) => <div className="err-box" role="alert"><b>{title}</b><span>{tr(err)}</span><button className="btn" onClick={retry}>{tr("Thử lại")}</button></div>;
export function InboxPage({ say, onOpenChat }: { say: (m: string) => void; model?: string; onOpenChat: (title: string, text: string) => void }) {
  const app = useApp();
  const { openSettings } = app;
  const [tab, setTab] = useState<"results" | "approve" | "jobs">("results");
  const [items, setItems] = useState<Item[] | null>(null);
  // Trang cũ hơn đã mở bằng "Xem kết quả cũ hơn"; trang đầu vẫn tự làm mới.
  const [older, setOlder] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [props, setProps] = useState<Proposal[] | null>(null);
  const [chrome, setChrome] = useState<{ allowed: boolean; connected: boolean; devices: unknown[] } | null>(null);
  const [caps, setCaps] = useState<{ caps: Record<string, boolean>; locks: Record<string, string> } | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ task?: Task; plan?: Plan } | "new" | null>(null);
  const older_ = useRef(0);
  // Mỗi tab tải riêng: lỗi của tab nào hiện ở tab đó kèm nút thử lại, không quay mãi.
  const [loadErr, setLoadErr] = useState("");
  const [tasksErr, setTasksErr] = useState("");
  const [propsErr, setPropsErr] = useState("");
  const load = useCallback(() => {
    setLoadErr(""); setTasksErr(""); setPropsErr("");
    api<{ items: Item[]; more: boolean }>("GET", "/api/inbox").then((j) => { setItems(j.items); setMore((m) => (older_.current ? m : j.more)); }).catch((e) => setLoadErr(e.message));
    api<{ tasks: Task[] }>("GET", "/api/tasks").then((j) => setTasks(j.tasks)).catch((e) => setTasksErr(e.message));
    api<{ proposals: Proposal[] }>("GET", "/api/inbox/proposals?all=1").then((j) => setProps(j.proposals)).catch((e) => setPropsErr(e.message));
  }, [say]);
  useEffect(() => {
    load();
    api<{ allowed: boolean; connected: boolean; devices: unknown[] }>("GET", "/api/browser/ext").then(setChrome).catch(() => {});
    api<{ caps: Record<string, boolean>; locks: Record<string, string> }>("GET", "/api/caps").then(setCaps).catch(() => {});
    // Tab ẩn thì thôi hỏi; quay lại tab thì cập nhật ngay.
    const t = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  const loadMore = async () => {
    const list = all, last = list.filter((x) => x.status !== "waiting").at(-1);
    if (!last || moreBusy) return;
    setMoreBusy(true);
    try {
      const j = await api<{ items: Item[]; more: boolean }>("GET", `/api/inbox?before=${last.at}`);
      older_.current++;
      setOlder((o) => [...o, ...j.items]);
      setMore(j.more);
    } catch (e) { say((e as Error).message); }
    setMoreBusy(false);
  };
  const read = async (ids: string[] | "all") => { await api("POST", "/api/inbox", { read: ids }).catch(() => {}); setOlder((o) => o.map((x) => (ids === "all" || ids.includes(x.run) ? { ...x, read: true } : x))); changed(); load(); };
  const toggle = (x: Item) => { setOpen(open === x.run ? null : x.run); if (!x.read && x.status !== "running" && x.status !== "waiting") read([x.run]); };
  // Nút "Chạy lại" ngay trên dòng lỗi: chạy lại việc đó, khóa nút tới khi máy chủ nhận lệnh.
  const [rerun, setRerun] = useState<string | null>(null);
  const rerunRow = async (x: Item) => { const t = byId.get(x.task); if (!t || rerun) return; setRerun(x.run); try { await runNow(t); } finally { setRerun(null); } };
  const runNow = async (t: Task) => { try { await api("POST", `/api/tasks/${t.id}/run`); say(tr("Đang chạy, kết quả sẽ vào Hộp thư")); setTab("results"); load(); } catch (e) { say((e as Error).message); } };
  const setOn = async (t: Task) => { try { await api("PATCH", `/api/tasks/${t.id}`, { enabled: !t.enabled }); load(); } catch (e) { say((e as Error).message); } };
  const del = (t: Task) => app.confirm(tr("Xóa việc tự động này?"), tr("Kết quả cũ trong Hộp thư cũng bị xóa."), tr("Xóa"), () => { void api("DELETE", `/api/tasks/${t.id}`).then(() => { say(tr("Đã xóa việc tự động")); load(); }).catch((e) => say((e as Error).message)); });
  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const all = useMemo(() => { const first = items ?? [], have = new Set(first.map((x) => x.run)); return [...first, ...older.filter((x) => !have.has(x.run))]; }, [items, older]);
  const unread = all.filter((x) => !x.read && x.status !== "running" && x.status !== "waiting").length;
  const pending = (props ?? []).filter((p) => p.status === "pending");
  const decided = (props ?? []).filter((p) => p.status !== "pending").slice(0, 20);
  const shown = all.filter((x) => !filter || x.task === filter);
  // Chọn hàng loạt: kết quả (đã đọc / chưa đọc / gỡ khỏi Hộp thư) và việc tự động (chạy ngay, bật / tắt lịch, xóa).
  const live = (x: Item) => x.status === "running" || x.status === "waiting";
  const bkR = useBulk(shown, (x) => x.run);
  const bkJ = useBulk(tasks ?? [], (t) => t.id);
  const resActs: BulkAct<Item>[] = [
    { id: "read", label: tr("Đánh dấu đã đọc"), icon: <I.Check size={14} />, when: (l) => l.some((x) => !x.read && !live(x)), run: (l) => read(l.filter((x) => !live(x)).map((x) => x.run)) },
    { id: "unread", label: tr("Đánh dấu chưa đọc"), icon: <I.Inbox size={14} />, when: (l) => l.some((x) => x.read), run: async (l) => { await api("POST", "/api/inbox", { unread: l.map((x) => x.run) }); const ids = new Set(l.map((x) => x.run)); setOlder((o) => o.map((x) => (ids.has(x.run) ? { ...x, read: false } : x))); changed(); load(); } },
    { id: "rm", label: tr("Gỡ khỏi Hộp thư"), icon: <I.Trash size={14} />, danger: true, when: (l) => l.some((x) => !live(x)),
      confirm: (l) => ({ title: `${tr("Gỡ")} ${l.filter((x) => !live(x)).length} ${tr("kết quả khỏi Hộp thư?")}`, text: tr("Chỉ gỡ khỏi Hộp thư; việc tự động và lịch chạy giữ nguyên. Kết quả đang chạy được giữ lại."), ok: tr("Gỡ") }),
      run: async (l) => { const ids = l.filter((x) => !live(x)).map((x) => x.run); await api("POST", "/api/inbox", { remove: ids }); setOlder((o) => o.filter((x) => !ids.includes(x.run))); changed(); load(); say(tr("Đã gỡ khỏi Hộp thư")); } },
  ];
  const jobActs: BulkAct<Task>[] = [
    { id: "run", label: tr("Chạy ngay"), icon: <I.Play size={13} />, run: async (l) => { await each(l, (t) => api("POST", `/api/tasks/${t.id}/run`)); say(tr("Đang chạy, kết quả sẽ vào Hộp thư")); setTab("results"); load(); } },
    { id: "on", label: tr("Bật lịch"), icon: <I.Power size={14} />, when: (l) => l.some((t) => !t.enabled), run: async (l) => { await each(l.filter((t) => !t.enabled), (t) => api("PATCH", `/api/tasks/${t.id}`, { enabled: true })); load(); } },
    { id: "off", label: tr("Tắt lịch"), icon: <I.Pause size={13} />, when: (l) => l.some((t) => t.enabled), run: async (l) => { await each(l.filter((t) => t.enabled), (t) => api("PATCH", `/api/tasks/${t.id}`, { enabled: false })); load(); } },
    { id: "del", label: tr("Xóa"), icon: <I.Trash size={14} />, danger: true,
      confirm: (l) => ({ title: `${tr("Xóa")} ${l.length} ${tr("việc tự động?")}`, text: tr("Kết quả cũ của các việc này trong Hộp thư cũng bị xóa."), ok: tr("Xóa") }),
      run: async (l) => { await each(l, (t) => api("DELETE", `/api/tasks/${t.id}`)); say(tr("Đã xóa việc tự động")); load(); } },
  ];
  const pgR = usePage(shown, 15, filter);
  const pgJ = usePage(tasks ?? [], 10);
  const groups = useMemo(() => { const m = new Map<number, Item[]>(); for (const x of pgR.items) { const d = dayOf(x.at); m.set(d, [...(m.get(d) ?? []), x]); } return [...m.entries()]; }, [pgR.items]);
  const active = (tasks ?? []).filter((t) => t.enabled).length;
  const needsChrome = (tasks ?? []).some((t) => t.enabled && t.browser === "user");
  // Khả năng đang tắt trong Cài đặt → Khả năng (người dùng tự tắt, không phải quản trị viên khóa): việc tự động cũng không dùng được.
  const off = caps ? CAPS.filter(([k]) => !caps.caps[k] && !caps.locks[k] && (k !== "net" || caps.caps.code)).map(([, label]) => tr(label)) : [];
  return (
    <div className="page ds-page tk-page"><div className="page-in tk">
      <header className="ds-head tk-top">
        <div className="ds-head-t"><h1>{tr("Hộp thư")}</h1><p>{tr("Giao việc một lần, Synchro tự làm theo lịch trên máy chủ, kể cả khi bạn tắt máy. Kết quả và những việc cần bạn duyệt nằm ở đây.")}</p></div>
      </header>
      <Composer say={say} onPlan={(plan) => setEdit({ plan })} onManual={() => setEdit("new")} />
      <div className="tk-status">
        <span className="tk-pill ok"><i />{active ? `${active} ${tr("việc đang chạy theo lịch trên máy chủ")}` : tr("Máy chủ Synchro sẵn sàng chạy việc của bạn")}</span>
        {off.length > 0 && <button type="button" className="tk-pill warn" onClick={() => openSettings?.("Capabilities")} data-tip="Việc tự động không dùng được những khả năng đang tắt. Bấm để mở Cài đặt → Khả năng."><i />{tr("Đang tắt")}: {off.join(", ")}</button>}
        {chrome?.allowed && <button type="button" className={`tk-pill ${chrome.connected ? "ok" : needsChrome ? "warn" : ""}`} onClick={() => openSettings?.("Capabilities")} data-tip={chrome.connected ? "Việc cần tài khoản của bạn chạy được trên Chrome của bạn" : "Mở Chrome có cài tiện ích Synchro để việc cần tài khoản của bạn chạy được"}>
          <i />{chrome.connected ? tr("Chrome của bạn đang kết nối") : chrome.devices.length ? tr("Chrome của bạn chưa kết nối") : tr("Chưa cài tiện ích Synchro cho Chrome")}
        </button>}
      </div>
      <div className="tk-tabs ds-bar">
        <div className="ds-seg pl-seg" role="tablist">
          <button role="tab" aria-selected={tab === "results"} className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>{tr("Kết quả")}{unread > 0 && <i className="tk-badge">{unread}</i>}</button>
          <button role="tab" aria-selected={tab === "approve"} className={tab === "approve" ? "on" : ""} onClick={() => setTab("approve")}>{tr("Cần duyệt")}{pending.length > 0 && <i className="tk-badge warn">{pending.length}</i>}</button>
          <button role="tab" aria-selected={tab === "jobs"} className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>{tr("Việc tự động")}{(tasks?.length ?? 0) > 0 && <i className="tk-count">{tasks!.length}</i>}</button>
        </div>
        <span style={{ flex: 1 }} />
        {tab === "results" && (tasks?.length ?? 0) > 1 && <select className="field tk-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Lọc theo việc"><option value="">{tr("Mọi việc")}</option>{tasks!.map((t) => <option key={t.id} value={t.id} data-notr>{t.title}</option>)}</select>}
        {tab === "results" && unread > 0 && !bkR.on && <button className="btn" onClick={() => read("all")}>{tr("Đánh dấu đã đọc hết")}</button>}
        {tab === "results" && <BulkButton b={bkR} />}
        {tab === "jobs" && <BulkButton b={bkJ} />}
      </div>

      {tab === "results" && (items === null ? (loadErr ? <LoadErr title={tr("Chưa tải được Hộp thư")} err={loadErr} retry={load} /> : <div className="empty"><span className="art-spin" /></div>) : !shown.length ? (
        <div className="apps-empty"><I.Inbox size={22} /><b>{tr("Chưa có kết quả nào")}</b><span>{tr("Giao một việc ở ô phía trên (ví dụ giá cổ phiếu mỗi sáng, repo GitHub hay mỗi ngày). Synchro tự chạy và gửi kết quả vào đây.")}</span></div>
      ) : (
        <div className="tk-feed">{groups.map(([d, list]) => (
          <section key={d}><h3 className="tk-day">{dayLabel(d)}</h3>
            <div className="tk-list">{list.map((x) => (
              <div key={x.run} className={`tk-item ${x.read ? "" : "unread"} ${open === x.run ? "open" : ""} ${x.status === "error" ? "failed" : ""}`} {...bulkRow(bkR, x)}>
                <div className="tk-line">
                <button className="tk-row" onClick={() => toggle(x)} aria-expanded={open === x.run}>
                  {bkR.on ? <BulkCheck on={bkR.has(x)} /> : <span className={`tk-dot ${x.status}`} />}
                  <span className="tk-t"><b data-notr>{x.title}</b><em>{x.status === "running" ? tr("Đang chạy trên máy chủ…") : x.status === "waiting" ? tr("Đang chờ Chrome của bạn kết nối") : isExpired(x) ? tr("Kết quả đã quá cũ, không còn lưu") : x.status === "error" ? <span className="tk-why" data-notr>{tr("Lỗi")}: {failReason(x.error)}</span> : ((t) => (t ? <span data-notr>{t}</span> : tr("Xong")))(excerpt(x.text))}</em></span>
                  {(x.proposals ?? 0) > 0 && <span className="tk-chip warn">{x.proposals} {tr("đề xuất")}</span>}
                  {x.kind === "action" && <span className="tk-chip">{tr("Đã duyệt")}</span>}
                  <span className="tk-when">{when(x.at).split(" ·")[0]}</span>
                </button>
                {!bkR.on && canRerun(x, all, byId.has(x.task)) && <button type="button" className="btn sm tk-rerun" disabled={rerun === x.run} aria-busy={rerun === x.run} onClick={() => rerunRow(x)} aria-label={`${tr("Chạy lại")}: ${x.title}`} data-tip="Chạy lại">
                  {rerun === x.run ? <span className="art-spin sm" /> : <I.Retry size={13} />}<span>{tr("Chạy lại")}</span></button>}
                </div>
                {open === x.run && !bkR.on && <ResultBody x={x} task={byId.get(x.task)} say={say} onOpenChat={onOpenChat} onRetry={runNow} reload={load} />}
              </div>
            ))}</div>
          </section>
        ))}<PageBar pg={pgR} />{more && <div className="tk-more"><button className="btn" disabled={moreBusy} onClick={loadMore}>{moreBusy ? <span className="art-spin sm" /> : null}{tr("Xem kết quả cũ hơn")}</button></div>}<BulkBar b={bkR} acts={resActs} noun="kết quả" /></div>
      ))}

      {tab === "approve" && (props === null ? (propsErr ? <LoadErr title={tr("Chưa tải được danh sách cần duyệt")} err={propsErr} retry={load} /> : <div className="empty"><span className="art-spin" /></div>) : !pending.length && !decided.length ? (
        <div className="apps-empty"><I.ShieldCheck size={22} /><b>{tr("Không có gì cần duyệt")}</b><span>{tr("Việc cần bạn đồng ý (tạo skill, gửi tin, mở trang web mới…) Synchro không tự làm mà gửi vào đây. Bạn chỉ việc duyệt.")}</span></div>
      ) : (
        <div className="tk-props">
          {pending.map((p) => <ProposalCard key={p.id} p={p} say={say} onDone={load} />)}
          {!pending.length && <p className="tk-empty-line"><I.Check size={14} />{tr("Đã duyệt hết. Đề xuất mới sẽ hiện ở đây.")}</p>}
          {decided.length > 0 && <><h3 className="tk-day">{tr("Đã xử lý gần đây")}</h3>{decided.map((p) => <ProposalCard key={p.id} p={p} say={say} onDone={load} />)}</>}
        </div>
      ))}

      {tab === "jobs" && (tasks === null ? (tasksErr ? <LoadErr title={tr("Chưa tải được danh sách việc tự động")} err={tasksErr} retry={load} /> : <div className="empty"><span className="art-spin" /></div>) : !tasks.length ? (
        <div className="apps-empty"><I.Clock size={22} /><b>{tr("Chưa có việc tự động nào")}</b><span>{tr("Giao việc ở ô phía trên, Synchro lên kế hoạch để bạn xem lại trước khi tạo.")}</span></div>
      ) : (
        <div className="tk-jobs">{pgJ.items.map((t) => (
          <div key={t.id} className={`tk-job ${t.enabled ? "" : "off"}`} {...bulkRow(bkJ, t)}>
            <div className="tk-job-h">
              {bkJ.on && <BulkCheck on={bkJ.has(t)} />}
              <span className="tk-t"><b data-notr>{t.title}</b><em>{scheduleText(t.schedule)}{t.wait_since ? ` · ${tr("đang chờ Chrome")}` : t.enabled && t.next_run_at ? ` · ${tr("lần tới")} ${when(t.next_run_at)}` : !t.enabled ? ` · ${tr("đã tắt")}` : ""}</em></span>
              <button className={`toggle ${t.enabled ? "on" : ""}`} role="switch" aria-checked={t.enabled} aria-label="Bật lịch" onClick={() => setOn(t)} />
            </div>
            <div className="tk-job-m">
              {t.engine === "code" ? <span className="tk-chip"><I.Code size={12} />Synchro Code</span> : <span className="tk-chip"><I.Globe size={12} />{tr(BROWSERS.find((b) => b.id === t.browser)?.label ?? "Tự chọn")}</span>}
              <span className="tk-chip" data-notr>{modelName(t.model ?? AUTO)}</span>
              <span className="tk-chip">{t.runs} {tr("lần chạy")}</span>
              {t.last && <span className={`tk-chip ${t.last.status === "error" ? "bad" : ""}`}>{t.last.status === "running" ? tr("Đang chạy") : t.last.status === "error" ? tr("Lần gần nhất lỗi") : `${tr("Lần gần nhất")} ${when(t.last.at)}`}</span>}
              {t.pending > 0 && <button type="button" className="tk-chip warn" onClick={() => setTab("approve")}>{t.pending} {tr("chờ duyệt")}</button>}
            </div>
            <p className="tk-job-p" data-notr>{t.prompt.slice(0, 220)}{t.prompt.length > 220 ? "…" : ""}</p>
            {!bkJ.on && <div className="tk-acts">
              <button className="btn" onClick={() => runNow(t)}><I.Play size={13} />{tr("Chạy ngay")}</button>
              <button className="btn" onClick={() => { setFilter(t.id); setTab("results"); }}><I.Inbox size={14} />{tr("Xem kết quả")}</button>
              <button className="btn ghost" onClick={() => setEdit({ task: t })}><I.Pencil size={14} />{tr("Sửa")}</button>
              <button className="icon-btn" aria-label="Xóa việc tự động" data-tip="Xóa việc tự động" onClick={() => del(t)}><I.Trash size={15} /></button>
            </div>}
          </div>
        ))}<PageBar pg={pgJ} /><BulkBar b={bkJ} acts={jobActs} noun="việc" /></div>
      ))}
      {edit && <TaskEditor init={edit === "new" ? null : edit.task ?? null} plan={edit === "new" ? null : edit.plan ?? null} say={say} onClose={() => setEdit(null)}
        onSaved={(_t, ran) => { setEdit(null); load(); setTab(ran ? "results" : edit !== "new" && edit.task ? tab : "jobs"); }} />}
    </div></div>
  );
}
