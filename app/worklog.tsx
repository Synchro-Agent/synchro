"use client";
// Nhật ký làm việc của một lượt trả lời: lời dẫn của model trước mỗi bước, các công cụ đã dùng (gom thành một dòng, bấm để xem),
// danh sách việc có đánh dấu, và dòng trạng thái (đang làm gì · bao lâu · bao nhiêu token) — thay cho màn hình trống chỉ có vòng xoay.
import { useEffect, useState } from "react";
import * as I from "./icons";
import { Loader } from "./brand";
import { getLang, tr } from "./i18n";
import { AskCard, type AskStep, type OnAnswer } from "./agentui";
import { lazyView } from "./lazy";
import { IMAGE_PLANS } from "./catalog";
import { refreshModels, useModels } from "./models";
// Thẻ kết nối lại chỉ cần khi connector mất đăng nhập: không kéo cả màn hình Connectors vào phần tải đầu của trang chat.
const ReconnectCard = lazyView(() => import("./connectorsui").then((m) => m.ReconnectCard), null);

// args: tham số đã gửi cho công cụ ghi của connector (đã che khóa bí mật).
// at / end: lúc bắt đầu, lúc có kết quả (giờ máy chủ) — đồng hồ giây của công cụ đang chạy và thời gian đã chạy khi xong.
export type ToolItem = { seq: number; label: string; ok?: boolean; sum?: string; args?: string; at?: number; end?: number };
// ask: lượt đang chờ bạn duyệt (dùng trình duyệt trên trang chưa được phép, công cụ connector). conn: connector cần kết nối lại (nút ngay trong khung chat).
export type ConnPart = { k: "conn"; id: string; name: string; logo?: string; color?: string; auth?: string; refused?: boolean };
// plans: chưa tạo được ảnh vì gói (chưa đăng nhập, hết hạn mức): nút mở Providers ngay trong khung chat. why: lý do, tried: gói đã thử.
export type PlansPart = { k: "plans"; why: string; tried: string[] };
// link: Connect Link Composio vừa tạo (chỉ địa chỉ của Composio, máy chủ đã lọc): nút đăng nhập ứng dụng ngay trong khung chat.
export type LinkPart = { k: "link"; app: string; name: string; url: string };
// rate: connector đang giới hạn tốc độ (429): đồng hồ đếm ngược tới lúc thử lại được (until: giờ máy chủ, ms).
export type RatePart = { k: "rate"; name: string; until: number };
export type Part = { k: "say"; text: string } | { k: "tools"; items: ToolItem[] } | AskStep | ConnPart | PlansPart | LinkPart | RatePart;
export type PlanItem = { content: string; status: "pending" | "in_progress" | "completed" };
export type Work = { parts?: Part[]; plan?: PlanItem[]; seq?: number };
export type RunEv = { seq: number; at: number; kind: string; text: string };

/** Áp một bước của lượt chạy vào nhật ký (bỏ qua bước đã áp — mở lại trang thì máy chủ gửi lại từ đầu). */
export function applyEvent(w: Work, ev: RunEv): Work {
  if (w.seq && ev.seq <= w.seq) return w;
  const parts = [...(w.parts ?? [])];
  let plan = w.plan;
  if (ev.kind === "say") parts.push({ k: "say", text: ev.text });
  else if (ev.kind === "tool") {
    const last = parts[parts.length - 1];
    const item: ToolItem = { seq: ev.seq, label: ev.text.replace(/^Đang /, ""), ...(ev.at ? { at: ev.at } : {}) };
    if (last?.k === "tools") parts[parts.length - 1] = { k: "tools", items: [...last.items, item] };
    else parts.push({ k: "tools", items: [item] });
  } else if (ev.kind === "res") {
    try {
      const r = JSON.parse(ev.text) as { ref: number; ok: boolean; sum?: string; args?: string };
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.k === "tools" && p.items.some((x) => x.seq === r.ref)) { parts[i] = { k: "tools", items: p.items.map((x) => (x.seq === r.ref ? { ...x, ok: r.ok, sum: r.sum, args: r.args, ...(ev.at ? { end: ev.at } : {}) } : x)) }; break; }
      }
    } catch {}
  } else if (ev.kind === "plan") {
    try { plan = JSON.parse(ev.text) as PlanItem[]; } catch {}
  } else if (ev.kind === "ask") {
    try { const a = JSON.parse(ev.text) as Omit<AskStep, "k" | "state">; parts.push({ k: "ask", id: a.id, kind: a.kind, title: a.title, detail: a.detail, host: a.host, conn: a.conn, about: a.about, destructive: a.destructive, state: "wait" }); } catch {}
  } else if (ev.kind === "asked") {
    try {
      const a = JSON.parse(ev.text) as { id: string; ok: boolean; always?: boolean; chat?: boolean; gone?: boolean; typed?: boolean };
      const i = parts.findIndex((p) => p.k === "ask" && p.id === a.id);
      if (i >= 0) parts[i] = { ...(parts[i] as AskStep), state: a.typed ? "typed" : a.gone ? "gone" : a.ok ? (a.always ? "always" : a.chat ? "chat" : "ok") : "no" };
    } catch {}
  } else if (ev.kind === "plans") {
    try { const a = JSON.parse(ev.text) as { why?: string; tried?: string[] }; if (!parts.some((p) => p.k === "plans")) parts.push({ k: "plans", why: String(a.why ?? "noplan"), tried: a.tried ?? [] }); } catch {}
  } else if (ev.kind === "link") {
    try { const l = JSON.parse(ev.text) as Omit<LinkPart, "k">; if (typeof l.url === "string" && /^https?:\/\//.test(l.url) && !parts.some((p) => p.k === "link" && p.url === l.url)) parts.push({ k: "link", app: String(l.app ?? ""), name: String(l.name ?? "Composio"), url: l.url }); } catch {}
  } else if (ev.kind === "rate") {
    try { const a = JSON.parse(ev.text) as { name?: string; until?: number }; if (typeof a.until === "number") { const name = String(a.name ?? ""), k = parts.findIndex((p) => p.k === "rate" && p.name === name); const r: RatePart = { k: "rate", name, until: a.until }; if (k >= 0) parts[k] = r; else parts.push(r); } } catch {}
  } else if (ev.kind === "conn") {
    try { const c = JSON.parse(ev.text) as Omit<ConnPart, "k">; if (!parts.some((p) => p.k === "conn" && p.id === c.id)) parts.push({ ...c, k: "conn" }); } catch {}
  } else return { ...w, seq: ev.seq };
  return { parts, plan, seq: ev.seq };
}

// Nhãn công cụ máy chủ ghi bằng tiếng Việt, đã bỏ chữ "Đang" (nhật ký lưu trong đoạn chat cũ cũng vậy): dịch khi hiện theo ngôn ngữ giao diện, chữ đầu viết hoa.
const DOING = "Đang";
const toolLabel = (l: string) => { const v = [DOING, l].join(" "), t = tr(v); return t !== v ? t : l.charAt(0).toUpperCase() + l.slice(1); };
// Công cụ chạy quá 8 giây: nói rõ là vẫn đang làm (dữ liệu lớn), không để người dùng tưởng treo.
const SLOW_MS = 8000;
const secs = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
/** Đồng hồ cập nhật mỗi giây khi on (công cụ đang chạy); tắt thì đứng yên, không tốn lượt vẽ. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}
function ToolGroup({ items, live }: { items: ToolItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = live && items.some((x) => x.ok === undefined);
  const now = useNow(running);
  // Công cụ chạy lâu nhất trong nhóm đang chạy: đồng hồ giây ở dòng tiêu đề, kèm lời nhắn khi quá 8 giây.
  const cur = running ? items.filter((x) => x.ok === undefined && x.at).sort((a, b) => a.at! - b.at!)[0] : undefined;
  const runMs = cur?.at ? now - cur.at : 0;
  const bad = items.filter((x) => x.ok === false).length;
  const label = items.length === 1 ? toolLabel(items[0].label) : `${tr("Đã dùng")} ${items.length} ${tr("công cụ")}`;
  return (
    <div className={`wl-tools ${open ? "open" : ""}`}>
      <button className="wl-tools-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running ? <span className="wl-spin" /> : bad ? <I.Alert size={13} /> : null}
        <span data-notr={items.length === 1 ? true : undefined}>{label}</span>
        {bad > 0 && <em>{bad} {tr("lỗi")}</em>}
        {bad === 1 && items.length === 1 && items[0].sum ? <small className="wl-fail" data-notr title={tr(items[0].sum)}>{tr(items[0].sum)}</small> : null}
        {cur ? <span className="wl-tsec" aria-hidden="true">{secs(runMs)}</span> : null}
        <I.ChevronR size={13} />
      </button>
      {cur && runMs >= SLOW_MS ? <div className="wl-slow" role="status">{tr("Công cụ đang xử lý lượng dữ liệu lớn, vui lòng đợi thêm…")}</div> : null}
      {open && (
        <div className="wl-tools-b">
          {items.map((x) => (
            <div key={x.seq} className={`wl-tool ${x.ok === false ? "bad" : ""}`}>
              <span className="wl-ic">{x.ok === undefined ? <span className="wl-spin" /> : x.ok ? <I.Check size={12} /> : <I.X size={12} />}</span>
              <div><b data-notr>{toolLabel(x.label)}</b>{x.at && ((x.end && x.end - x.at >= 1000) || (live && x.ok === undefined)) ? <span className="wl-tsec" data-notr>{secs((x.end ?? now) - x.at)}</span> : null}{x.args && <small data-notr>{tr("Đã gửi")}: {x.args}</small>}{x.sum && <small data-notr>{tr(x.sum)}</small>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanCard({ plan, live }: { plan: PlanItem[]; live: boolean }) {
  if (!plan.length) return null;
  const done = plan.filter((x) => x.status === "completed").length;
  return (
    <div className="wl-plan" aria-label={tr("Danh sách việc")}>
      <div className="wl-plan-h">{tr("Danh sách việc")} <span>{done}/{plan.length}</span></div>
      {plan.map((x, i) => (
        <div key={i} className={`wl-pi ${x.status}`}>
          <span className="wl-pic">{x.status === "completed" ? <I.Check size={11} /> : x.status === "in_progress" && live ? <span className="wl-spin" /> : null}</span>
          <span data-notr>{x.content}</span>
        </div>
      ))}
    </div>
  );
}

/** Chưa tạo được ảnh vì gói: lý do cụ thể do model nói trong câu trả lời, thẻ này chỉ đưa tới đúng chỗ xử lý. Nói theo đúng lý do (đã đăng nhập mà hết hạn mức thì không bảo đăng nhập),
 *  và tự ẩn khi đã có gói dùng được ngoài các gói vừa hỏng (tried không gồm gói cần đăng nhập lại): danh sách model làm mới khi đăng nhập ở Providers và khi thẻ hiện, gồm cả lúc mở lại đoạn chat. */
function PlansCard({ why, tried }: { why: string; tried: string[] }) {
  const models = useModels();
  useEffect(() => { refreshModels(); }, []);
  if (!models.loaded || models.providers.some((p) => p.plan && IMAGE_PLANS.has(p.plan.cli) && !p.plan.relogin && !tried.includes(p.plan.cli))) return null;
  return (
    <div className="wl-plans" role="status">
      <I.Alert size={14} /><span>{tr(why === "noplan" ? "Đăng nhập gói tạo được ảnh ở Providers" : why === "auth" ? "Đăng nhập lại gói ở Providers để tạo ảnh" : "Các gói đã đăng nhập chưa tạo được ảnh lúc này. Có thể đăng nhập thêm gói khác ở Providers")}</span>
      <button className="btn" onClick={() => window.dispatchEvent(new Event("synchro:providers"))}>{tr("Mở Providers")}</button>
    </div>
  );
}
/** Nút đăng nhập một ứng dụng qua Composio: mở Connect Link trong tab mới; đăng nhập xong thì người dùng nhắn lại yêu cầu. */
function LinkCard({ l }: { l: LinkPart }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="wl-plans wl-link" role="group" aria-label={l.name}>
      <I.SetPlug size={14} /><span>{tr(opened ? "Đăng nhập xong thì nhắn lại yêu cầu để Synchro làm tiếp." : `Kết nối ${l.name} qua Composio để Synchro dùng được ứng dụng này.`)}</span>
      <a className="btn dark" href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>{tr(opened ? "Mở lại trang kết nối" : `Kết nối ${l.name}`)}<I.External size={12} /></a>
    </div>
  );
}
/** Connector đang giới hạn tốc độ (429): đếm ngược tới lúc thử lại được, hết giờ thì có nút Thử lại (gửi lại tin vừa rồi). */
function RateCard({ r }: { r: RatePart }) {
  const now = useNow(true), left = r.until - now, en = getLang() === "en";
  return (
    <div className="wl-plans wl-rate" role="status">
      <I.Clock size={14} />
      <span data-notr>{left > 0 ? (en ? `${r.name} is rate-limiting requests. You can try again in ${secs(left)}.` : `${r.name} đang giới hạn tốc độ. Thử lại được sau ${secs(left)}.`) : en ? `${r.name} is ready again.` : `${r.name} đã dùng lại được.`}</span>
      {left <= 0 && <button className="btn" onClick={() => window.dispatchEvent(new Event("synchro:retry"))}>{tr("Thử lại ngay")}</button>}
    </div>
  );
}
/** Lời dẫn và công cụ của các bước đã qua; render: cách hiện chữ (Markdown) của trang. */
export function WorkParts({ parts, live, render, onAnswer }: { parts: Part[]; live: boolean; render: (text: string) => React.ReactNode; onAnswer?: OnAnswer }) {
  return <>{parts.map((p, i) => (p.k === "say" ? <div key={i} className="wl-say">{render(p.text)}</div>
    : p.k === "ask" ? <AskCard key={p.id} a={!live && p.state === "wait" ? { ...p, state: "gone" } : p} onAnswer={live ? onAnswer : undefined} />
    : p.k === "conn" ? (live ? <ReconnectCard key={p.id} c={p} /> : null)
    : p.k === "plans" ? (live ? <PlansCard key={i} why={p.why} tried={p.tried} /> : null)
    : p.k === "link" ? (live ? <LinkCard key={p.url} l={p} /> : null)
    : p.k === "rate" ? (live ? <RateCard key={`rate-${p.name}`} r={p} /> : null)
    : <ToolGroup key={i} items={p.items} live={live} />))}</>;
}
/** Câu trả lời đã xong: nút kết nối lại vẫn hiện ngoài phần tổng kết thu gọn (người dùng vừa được bảo bấm nó). */
export function ConnCards({ parts }: { parts?: Part[] }) {
  const list = (parts ?? []).filter((p): p is ConnPart => p.k === "conn");
  const plans = (parts ?? []).find((p): p is PlansPart => p.k === "plans");
  const links = (parts ?? []).filter((p): p is LinkPart => p.k === "link");
  // Đồng hồ thử lại của connector bị giới hạn tốc độ: chỉ hiện khi câu trả lời xong chưa quá 1 giờ kể từ lúc thử lại được.
  const rates = (parts ?? []).filter((p): p is RatePart => p.k === "rate" && p.until > Date.now() - 3_600_000);
  // Mở lại đoạn chat khi connector đã nối xong từ trước (bằng thẻ này hay trong Cài đặt) thì không nhắc nữa. Hỏi máy chủ không được thì vẫn hiện thẻ.
  // Chỉ hỏi một lần lúc thẻ gắn: vừa kết nối lại xong ngay trên thẻ thì thẻ vẫn ở đó để báo "Đã kết nối lại".
  const [fine, setFine] = useState<string[]>([]);
  const sig = list.map((c) => c.id).join();
  useEffect(() => {
    if (!sig) return;
    let on = true;
    fetch("/api/connectors").then((r) => (r.ok ? r.json() : null)).then((j: { connectors?: { id: string; status: string }[] } | null) => {
      if (on && j?.connectors) setFine(sig.split(",").filter((id) => { const c = j.connectors!.find((x) => x.id === id); return !c || c.status === "ok"; }));
    }).catch(() => {});
    return () => { on = false; };
  }, [sig]);
  const show = list.filter((c) => !fine.includes(c.id));
  return show.length || plans || links.length || rates.length ? <>{show.map((c) => <ReconnectCard key={c.id} c={c} done />)}{links.map((l) => <LinkCard key={l.url} l={l} />)}{rates.map((r) => <RateCard key={`rate-${r.name}`} r={r} />)}{plans && <PlansCard why={plans.why} tried={plans.tried} />}</> : null;
}

/**
 * Câu trả lời đã xong: danh sách việc và nhật ký làm việc chỉ hiện lúc đang chạy; xong thì gom thành một dòng tổng kết (số việc đã xong,
 * số bước, thời gian), bấm vào để xem lại chi tiết. Câu trả lời cuối của model là phần tổng kết bằng lời.
 */
export function WorkSummary({ parts, plan, ms, stopped, render }: { parts?: Part[]; plan?: PlanItem[]; ms?: number; stopped?: boolean; render: (text: string) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const steps = stepsOf(parts), en = getLang() === "en";
  const total = plan?.length ?? 0, ok = plan?.filter((x) => x.status === "completed").length ?? 0;
  const bad = (parts ?? []).reduce((n, p) => n + (p.k === "tools" ? p.items.filter((x) => x.ok === false).length : 0), 0);
  if (!steps && !total && !(parts ?? []).length) return null;
  const bits = [
    total ? (en ? `${ok}/${total} tasks done` : `Xong ${ok}/${total} việc`) : stopped ? (en ? "Stopped" : "Đã dừng") : en ? "Done" : "Đã xong",
    steps ? (en ? `${steps} ${steps === 1 ? "step" : "steps"}` : `${steps} bước`) : "",
    ms && ms >= 1000 ? dur(ms) : "",
  ].filter(Boolean);
  return (
    <div className={`wl-sum ${open ? "open" : ""}`}>
      <button className="wl-sum-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`wl-sum-ic ${stopped || (total && ok < total) ? "part" : ""}`}>{stopped ? <I.Stop size={10} /> : <I.Check size={11} />}</span>
        <span>{bits.join(" · ")}</span>
        {bad > 0 && <em>{bad} {tr("lỗi")}</em>}
        <span className="wl-sum-more">{open ? (en ? "Hide steps" : "Ẩn các bước") : en ? "Show steps" : "Xem các bước"}</span>
        <I.ChevronR size={13} />
      </button>
      {open && (
        <div className="wl-sum-b">
          {plan?.length ? <PlanCard plan={plan} live={false} /> : null}
          {parts?.length ? <WorkParts parts={parts} live={false} render={render} /> : null}
        </div>
      )}
    </div>
  );
}

const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
/** Số bước (lần dùng công cụ) đã làm trong câu trả lời đang chạy: tiến độ thật của việc nhiều bước. */
export const stepsOf = (parts?: Part[]) => (parts ?? []).reduce((n, p) => n + (p.k === "tools" ? p.items.length : 0), 0);
/** Dòng trạng thái khi đang chạy: việc đang làm, thời gian đã chạy, số token ước lượng đã viết. */
// Trước đây hiện "≈ N token" ước từ chữ hiện trên màn hình: không tính phần model viết vào công cụ (cả bộ slide, trang web…) nên sau 20 phút
// vẫn chỉ "≈ 138 token", trông như model đứng yên. Nay hiện số bước đã làm.
export function WorkStatus({ label, since, steps }: { label?: string; since: number; steps: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="wl-status">
      {/* Trình đọc màn hình chỉ đọc khi việc đang làm đổi, không đọc đồng hồ đếm từng giây. */}
      <span className="sr-only" role="status" aria-live="polite">{tr(label || "Đang suy nghĩ…")}</span>
      <Loader size={14} />
      <span className="wl-st-t" key={label} aria-hidden="true">{tr(label || "Đang suy nghĩ…")}</span>
      <span className="wl-st-m" aria-hidden="true">{dur(now - since)}{steps > 0 ? ` · ${steps} ${getLang() === "en" ? (steps === 1 ? "step" : "steps") : "bước"}` : ""}</span>
    </div>
  );
}

/** Tin nhắn đang chờ: ghép vào việc đang chạy (steer) hoặc gửi sau khi xong (later). */
export type Queued = { id: number; chat: number; text: string; mode: "steer" | "later" };
export function QueueChips({ items, onCancel }: { items: Queued[]; onCancel: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="wl-queue">
      {items.map((q) => (
        <div key={q.id} className={`wl-q ${q.mode}`}>
          {q.mode === "steer" ? <span className="wl-spin" /> : <I.Clock size={12} />}
          <span className="wl-q-t" data-notr>{q.text}</span>
          <em>{q.mode === "steer" ? tr("Đang ghép vào việc đang làm") : tr("Gửi sau khi xong")}</em>
          {q.mode === "later" && <button className="icon-btn" aria-label={tr("Bỏ tin chờ gửi")} onClick={() => onCancel(q.id)}><I.X size={12} /></button>}
        </div>
      ))}
    </div>
  );
}
