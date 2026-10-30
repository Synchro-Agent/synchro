"use client";
// Nhật ký làm việc của một lượt trả lời: lời dẫn của model trước mỗi bước, các công cụ đã dùng (gom thành một dòng, bấm để xem),
// danh sách việc có đánh dấu, và dòng trạng thái (đang làm gì · bao lâu · bao nhiêu token) — thay cho màn hình trống chỉ có vòng xoay.
import { useEffect, useState } from "react";
import * as I from "./icons";
import { Loader } from "./brand";
import { tr } from "./i18n";
import { AskCard, type AskStep, type OnAnswer } from "./agentui";

export type ToolItem = { seq: number; label: string; ok?: boolean; sum?: string };
// ask: lượt đang chờ bạn duyệt (dùng trình duyệt trên trang chưa được phép).
export type Part = { k: "say"; text: string } | { k: "tools"; items: ToolItem[] } | AskStep;
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
    const item = { seq: ev.seq, label: ev.text.replace(/^Đang /, "") };
    if (last?.k === "tools") parts[parts.length - 1] = { k: "tools", items: [...last.items, item] };
    else parts.push({ k: "tools", items: [item] });
  } else if (ev.kind === "res") {
    try {
      const r = JSON.parse(ev.text) as { ref: number; ok: boolean; sum?: string };
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.k === "tools" && p.items.some((x) => x.seq === r.ref)) { parts[i] = { k: "tools", items: p.items.map((x) => (x.seq === r.ref ? { ...x, ok: r.ok, sum: r.sum } : x)) }; break; }
      }
    } catch {}
  } else if (ev.kind === "plan") {
    try { plan = JSON.parse(ev.text) as PlanItem[]; } catch {}
  } else if (ev.kind === "ask") {
    try { const a = JSON.parse(ev.text) as Omit<AskStep, "k" | "state">; parts.push({ k: "ask", id: a.id, kind: a.kind, title: a.title, detail: a.detail, host: a.host, state: "wait" }); } catch {}
  } else if (ev.kind === "asked") {
    try {
      const a = JSON.parse(ev.text) as { id: string; ok: boolean; always?: boolean };
      const i = parts.findIndex((p) => p.k === "ask" && p.id === a.id);
      if (i >= 0) parts[i] = { ...(parts[i] as AskStep), state: a.ok ? (a.always ? "always" : "ok") : "no" };
    } catch {}
  } else return { ...w, seq: ev.seq };
  return { parts, plan, seq: ev.seq };
}

function ToolGroup({ items, live }: { items: ToolItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = live && items.some((x) => x.ok === undefined);
  const bad = items.filter((x) => x.ok === false).length;
  const label = items.length === 1 ? items[0].label : `${tr("Đã dùng")} ${items.length} ${tr("công cụ")}`;
  return (
    <div className={`wl-tools ${open ? "open" : ""}`}>
      <button className="wl-tools-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running ? <span className="wl-spin" /> : bad ? <I.Alert size={13} /> : null}
        <span data-notr={items.length === 1 ? true : undefined}>{label}</span>
        {bad > 0 && <em>{bad} {tr("lỗi")}</em>}
        <I.ChevronR size={13} />
      </button>
      {open && (
        <div className="wl-tools-b">
          {items.map((x) => (
            <div key={x.seq} className={`wl-tool ${x.ok === false ? "bad" : ""}`}>
              <span className="wl-ic">{x.ok === undefined ? <span className="wl-spin" /> : x.ok ? <I.Check size={12} /> : <I.X size={12} />}</span>
              <div><b data-notr>{x.label}</b>{x.sum && <small data-notr>{x.sum}</small>}</div>
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

/** Lời dẫn và công cụ của các bước đã qua; render: cách hiện chữ (Markdown) của trang. */
export function WorkParts({ parts, live, render, onAnswer }: { parts: Part[]; live: boolean; render: (text: string) => React.ReactNode; onAnswer?: OnAnswer }) {
  return <>{parts.map((p, i) => (p.k === "say" ? <div key={i} className="wl-say">{render(p.text)}</div>
    : p.k === "ask" ? <AskCard key={p.id} a={!live && p.state === "wait" ? { ...p, state: "gone" } : p} onAnswer={live ? onAnswer : undefined} />
    : <ToolGroup key={i} items={p.items} live={live} />))}</>;
}

const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** Dòng trạng thái khi đang chạy: việc đang làm, thời gian đã chạy, số token ước lượng đã viết. */
export function WorkStatus({ label, since, chars }: { label?: string; since: number; chars: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="wl-status" role="status" aria-live="polite">
      <Loader size={14} />
      <span className="wl-st-t" key={label}>{label || tr("Đang suy nghĩ…")}</span>
      <span className="wl-st-m">{dur(now - since)}{chars > 40 ? ` · ≈ ${tok(Math.round(chars / 4))} token` : ""}</span>
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
