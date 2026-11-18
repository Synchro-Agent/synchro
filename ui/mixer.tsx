"use client";
// Bàn trộn ngữ cảnh: xem lượt tiếp theo sẽ gửi những gì cho model và bao nhiêu token (ước tính từ đúng prompt máy chủ lắp).
// Ba tầng giống cách Synchro xếp prompt để dùng bộ đệm: cố định (hướng dẫn, skill, tài liệu ghim) → lịch sử → thay đổi mỗi lượt.
// Tắt / bật khối ở tầng cuối không làm đổi phần đầu nên không mất bộ đệm. Ngữ cảnh quá lớn thì nén lịch sử thành tóm tắt.
import { useEffect, useMemo, useRef, useState } from "react";
import { isAway } from "./clickaway";
import * as I from "./icons";
import { Dropdown } from "./listbox";
import { locale, tr } from "./i18n";
import { compactHistory, estimateContext, type CtxBlock } from "./llm";
import { chatHistory, mixExtra } from "./history";
import { fileContext } from "./filestate";
import type { Chat } from "./store";
import { useChatStore } from "./chatstore.client";

const HOT = 32_000;
const LABEL: Record<CtxBlock["key"], string> = {
  system: "Hướng dẫn và khả năng", skills: "Skill, connector, công cụ", pinned: "Tài liệu ghim",
  summary: "Tóm tắt đã nén", history: "Lịch sử hội thoại", tools: "Kết quả công cụ (tóm tắt)", artifacts: "Artifact hiện tại", dynamic: "Gợi ý skill theo câu hỏi",
};
const TIER: [CtxBlock["tier"], string, string][] = [
  ["static", "Cố định", "Giữ nguyên giữa các lượt, đọc lại từ bộ đệm nên rẻ"],
  ["history", "Lịch sử", "Các lượt trước của đoạn chat"],
  ["dynamic", "Thay đổi mỗi lượt", "Ở cuối prompt, bật tắt không làm mất bộ đệm"],
];
const KEEP = 4; // nén thì giữ nguyên 4 tin gần nhất
const PIN_MAX = 200_000;
export const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

// Bàn trộn ở ô soạn tin của đoạn chat đang mở (blueprint B2): tự đọc đoạn chat từ kho, nên ô soạn tin (memo) nhận một phần tử không đổi
// suốt lượt; skill hai câu trả lời gần nhất đã dùng (gửi kèm ước tính để giữ cùng phong cách), đổi lựa chọn thì ghi thẳng vào kho.
export function DockMixer({ chatId, busy, say }: { chatId: number; busy: boolean; say: (m: string) => void }) {
  const chat = useChatStore((s) => s.chats.find((c) => c.id === chatId));
  const msgs = chat?.msgs;
  const recentSkills = useMemo(() => [...new Set((msgs ?? []).filter((m) => m.role === "ai").slice(-2).flatMap((m) => [...(m.libs ?? []).flatMap((l) => l.skills), ...(m.skills ?? [])]))], [msgs]);
  if (!chat) return null;
  return <ContextMixer chat={chat} studio={chat.studio} busy={busy} say={say} recentSkills={recentSkills} onChange={(p) => useChatStore.getState().patchChat(chatId, p)} />;
}

export function ContextMixer({ chat, studio, recentSkills, busy, onChange, say }: {
  chat: Chat; studio?: string; recentSkills?: string[]; busy: boolean; onChange: (p: Partial<Chat>) => void; say: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [est, setEst] = useState<{ blocks: CtxBlock[]; total: number; dropped: number } | null>(null);
  const [work, setWork] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const mix = chat.mixer ?? {};
  const files = [...new Set(chat.msgs.flatMap((m) => m.files ?? []))].filter((f) => !chat.pins?.some((p) => p.name === f));
  const histCount = chat.msgs.length - (chat.compact?.upto ?? 0);

  // Ước tính lại khi đoạn chat hay lựa chọn của bàn trộn đổi (không chạy lúc model đang trả lời).
  const key = JSON.stringify([chat.id, chat.msgs.length, chat.msgs.at(-1)?.text.length, mix, chat.compact?.upto, chat.pins?.length, studio]);
  useEffect(() => {
    if (busy || !chat.msgs.length) return;
    let live = true;
    const t = setTimeout(() => {
      estimateContext({ messages: [...chatHistory(chat.msgs, chat.compact), { role: "user", content: "…" }], studio, recentSkills, conv: String(chat.id), ...mixExtra(chat) })
        .then((r) => { if (live) setEst(r); }).catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (isAway(ref.current, e.target)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);

  const setMix = (p: Partial<NonNullable<Chat["mixer"]>>) => onChange({ mixer: { ...mix, ...p } });
  const compact = async () => {
    const upto = chat.msgs.length - KEEP;
    const from = chat.compact?.upto ?? 0;
    if (upto <= from) return;
    setWork("compact");
    try {
      const old = chatHistory(chat.msgs.slice(from, upto)).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));
      const text = await compactHistory(old, chat.compact?.text);
      if (!text.trim()) throw new Error(tr("Model không trả về bản tóm tắt."));
      onChange({ compact: { upto, text, at: Date.now() } });
      say(tr("Đã nén các lượt cũ thành bản tóm tắt"));
    } catch (e) { say((e as Error).message); }
    setWork("");
  };
  const pin = async (name: string) => {
    setWork("pin:" + name);
    try {
      const { blocks, errors } = await fileContext([name], "");
      const text = blocks.slice(1).map((b) => (b.type === "text" ? b.text : b.type === "document" ? (b as { fallbackText?: string }).fallbackText ?? "" : "")).join("\n").trim();
      if (!text) throw new Error(errors[0] ?? tr("Tệp này không còn trong phiên làm việc. Hãy đính kèm lại rồi ghim."));
      const used = (chat.pins ?? []).reduce((n, p) => n + p.text.length, 0);
      if (used + text.length > PIN_MAX) throw new Error(tr("Tài liệu ghim đã gần đầy (tối đa khoảng 200.000 ký tự). Hãy bỏ ghim bớt."));
      onChange({ pins: [...(chat.pins ?? []), { name, text }] });
      say(tr("Đã ghim tài liệu vào ngữ cảnh của đoạn chat"));
    } catch (e) { say((e as Error).message); }
    setWork("");
  };

  const total = est?.total ?? 0, hot = total > HOT;
  const max = Math.max(1, ...(est?.blocks ?? []).map((b) => b.tokens));
  const row = (b: CtxBlock) => {
    const toggle = b.key === "tools" ? mix.tools !== false : b.key === "artifacts" ? mix.artifacts !== false : null;
    const off = toggle === false;
    return (
      <div key={b.key} className={`cx-row ${off ? "off" : ""}`}>
        <div className="cx-row-t"><span>{tr(LABEL[b.key])}</span><em data-notr>{off ? tr("Đang tắt") : `≈ ${kTok(b.tokens)}`}</em></div>
        <div className="cx-bar"><i style={{ width: off ? 0 : `${Math.max(b.tokens ? 2 : 0, (b.tokens / max) * 100)}%` }} /></div>
        {toggle !== null && <button className={`toggle sm ${toggle ? "on" : ""}`} role="switch" aria-checked={toggle} aria-label={tr(LABEL[b.key])} onClick={() => setMix(b.key === "tools" ? { tools: !toggle } : { artifacts: !toggle })} />}
      </div>
    );
  };
  return (
    <div className="cx-w" ref={ref}>
      <button className={`cx-pill ${hot ? "hot" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={tr("Bàn trộn ngữ cảnh")} data-tip={open ? undefined : tr("Ngữ cảnh gửi cho model")}>
        <I.Gauge size={15} /><span data-notr>{est ? kTok(total) : "…"}</span>
      </button>
      {open && (
        <div className="cx-pop" role="dialog" aria-label={tr("Bàn trộn ngữ cảnh")}>
          <div className="cx-h"><b>{tr("Ngữ cảnh của lượt tiếp theo")}</b><span>{tr("Ước tính")} ≈ <b data-notr>{total.toLocaleString(locale())}</b> token</span></div>
          {hot && <div className="cx-hot"><I.Alert size={14} /><span>{tr("Ngữ cảnh đã lớn: trả lời chậm hơn và tốn hơn. Nén lịch sử để gọn lại.")}</span></div>}
          {!est ? <div className="cx-load"><span className="art-spin sm" /></div> : TIER.map(([tier, name, hint]) => (
            <div key={tier} className="cx-tier">
              <div className="cx-tier-h"><b>{tr(name)}</b><span>{tr(hint)}</span></div>
              {est.blocks.filter((b) => b.tier === tier && (b.tokens > 0 || b.key === "tools" || b.key === "artifacts" || b.key === "pinned" || b.key === "history")).map(row)}
              {tier === "static" && (
                <div className="cx-pins">
                  {(chat.pins ?? []).map((p) => <span key={p.name} className="cx-chip" data-notr><I.Pin size={12} />{p.name}<button aria-label={tr("Bỏ ghim")} onClick={() => onChange({ pins: (chat.pins ?? []).filter((x) => x.name !== p.name) })}><I.X size={11} /></button></span>)}
                  {files.slice(0, 6).map((f) => <button key={f} className="cx-chip add" disabled={!!work} onClick={() => pin(f)} data-notr>{work === "pin:" + f ? <span className="art-spin sm" /> : <I.Plus size={12} />}{tr("Ghim")} {f}</button>)}
                  {!chat.pins?.length && !files.length && <span className="cx-note">{tr("Đính kèm tệp vào đoạn chat rồi ghim để tệp luôn có trong ngữ cảnh.")}</span>}
                </div>
              )}
              {tier === "history" && (
                <div className="cx-hist">
                  <span className="cx-hist-l">{tr("Gửi")}
                    <Dropdown<number> size="sm" label="Gửi" minWidth={170} value={mix.recent ?? 0} onChange={(v) => setMix({ recent: v || undefined })} options={[[0, "Toàn bộ"], [12, "12 tin gần nhất"], [6, "6 tin gần nhất"]]} />
                  </span>
                  {chat.compact && <button className="lnk" onClick={() => onChange({ compact: undefined })}>{tr("Bỏ nén")}</button>}
                  <span style={{ flex: 1 }} />
                  <button className={`btn ${hot ? "dark" : ""}`} disabled={!!work || histCount <= KEEP} onClick={compact} title={tr("Tóm tắt các lượt cũ (giữ 4 tin gần nhất)")}>{work === "compact" ? <span className="art-spin sm" /> : <I.Sparkle size={13} />}{tr("Nén lịch sử")}</button>
                </div>
              )}
            </div>
          ))}
          {!!est?.dropped && <p className="cx-note">{tr("Không gửi")} {est.dropped} {tr("tin cũ hơn (theo lựa chọn ở trên).")}</p>}
        </div>
      )}
    </div>
  );
}
