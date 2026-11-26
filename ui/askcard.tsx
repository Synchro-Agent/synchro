"use client";
// Thẻ hỏi lại: khi yêu cầu còn mơ hồ ở điểm quyết định lớn, model trả về khối ```ask (JSON câu hỏi + lựa chọn) thay vì đoán.
// Người dùng bấm chọn (hoặc gõ ý khác) rồi gửi; câu trả lời thành tin nhắn tiếp theo. Thẻ ở các lượt cũ chỉ hiện, không bấm được.
import { useMemo, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { Spinner } from "./spinner";

export type AskQ = { q: string; options: string[]; multi: boolean };
export const ASK_EVENT = "synchro:ask";
export const SKIP_TEXT = "Bạn tự chọn phương án hợp lý nhất và làm luôn.";

export function parseAsk(code: string): AskQ[] | null {
  try {
    const j = JSON.parse(code);
    const raw: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.questions) ? j.questions : [j];
    const qs = raw.map((x) => {
      const o = (x ?? {}) as { q?: unknown; question?: unknown; options?: unknown; multi?: unknown };
      return { q: String(o.q ?? o.question ?? "").trim().slice(0, 300), options: (Array.isArray(o.options) ? o.options : []).map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 6), multi: o.multi === true };
    }).filter((x) => x.q && x.options.length >= 2).slice(0, 3);
    return qs.length ? qs : null;
  } catch { return null; }
}

/** Ghép lựa chọn thành tin nhắn trả lời: một câu hỏi thì chỉ gửi lựa chọn, nhiều câu thì "Câu hỏi → lựa chọn" mỗi dòng. */
export function askAnswer(qs: AskQ[], picks: string[][]) {
  return qs.length === 1 ? picks[0].join(", ") : qs.map((q, i) => `${q.q} → ${picks[i].join(", ")}`).join("\n");
}

export function AskCard({ code, closed, live }: { code: string; closed: boolean; live: boolean }) {
  const qs = useMemo(() => (closed ? parseAsk(code) : null), [code, closed]);
  const [pick, setPick] = useState<string[][]>([]);
  const [other, setOther] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  if (!closed) return <div className="viz-wait"><Spinner className="art-spin sm" />{tr("Đang soạn câu hỏi…")}</div>;
  if (!qs) return null;
  const off = sent || !live;
  const answer = (i: number) => [...(pick[i] ?? []), ...(other[i]?.trim() ? [other[i].trim()] : [])];
  const ready = qs.every((_, i) => answer(i).length > 0);
  const fire = (text: string) => { setSent(true); window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: text })); };
  const one = qs.length === 1 && !qs[0].multi;
  const choose = (i: number, o: string) => {
    if (off) return;
    // Một câu hỏi chọn một: bấm là gửi luôn.
    if (one && !other[0]?.trim()) return fire(o);
    setPick((p) => { const n = [...p]; const cur = n[i] ?? []; n[i] = qs[i].multi ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : cur[0] === o ? [] : [o]; return n; });
  };
  return (
    <div className={`ask-card ${off ? "off" : ""}`} role="group" aria-label={tr("Synchro cần bạn chọn")}>
      <div className="ask-h"><I.Help size={15} /><span>{off ? tr(sent ? "Đã gửi lựa chọn" : "Câu hỏi của Synchro") : tr("Synchro cần bạn chọn")}</span></div>
      {qs.map((q, i) => (
        <div key={i} className="ask-q">
          <div className="ask-qt" data-notr>{q.q}{q.multi && <em>{tr("chọn được nhiều")}</em>}</div>
          <div className="ask-opts">
            {q.options.map((o) => (
              <button key={o} className={`ask-o ${(pick[i] ?? []).includes(o) ? "on" : ""}`} aria-pressed={(pick[i] ?? []).includes(o)} disabled={off} onClick={() => choose(i, o)} data-notr>
                {(pick[i] ?? []).includes(o) && <I.Check size={13} />}{o}
              </button>
            ))}
          </div>
          {!off && <input className="ask-other" placeholder={tr("Ý khác…")} value={other[i] ?? ""} onChange={(e) => setOther((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
            onKeyDown={(e) => { if (e.key === "Enter" && ready) { e.preventDefault(); fire(askAnswer(qs, qs.map((_, k) => answer(k)))); } }} />}
        </div>
      ))}
      {!off && (
        <div className="ask-f">
          <button className="lnk" onClick={() => fire(tr(SKIP_TEXT))}>{tr("Bỏ qua, cứ làm đi")}</button>
          <span style={{ flex: 1 }} />
          {!one || other[0]?.trim() ? <button className="btn dark" disabled={!ready} onClick={() => fire(askAnswer(qs, qs.map((_, k) => answer(k))))}>{tr("Gửi")}<I.Arrow size={14} /></button> : null}
        </div>
      )}
    </div>
  );
}
