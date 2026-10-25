"use client";
// "Lưu cách làm này thành skill": khi người dùng dặn một quy tắc lâu dài ("từ giờ…", "lần sau…", "luôn…", "đừng bao giờ…")
// hoặc dặn cùng một điều ở nhiều đoạn chat, dưới câu trả lời hiện gợi ý gói các lời dặn đó thành một skill.
// Người dùng sửa tên, mô tả, nội dung rồi lưu: tạo SKILL.md và gửi lên /api/skills như khi tải skill lên bằng tay.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { tr } from "./i18n";
import { SKILLS_CHANGED } from "./skillsui";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
// Lời dặn lâu dài: có từ chỉ thời gian về sau hoặc "luôn / không bao giờ".
const PERSIST = /(^|[^a-z])(tu (gio|nay|bay gio|lan nay)|lan sau|ve sau|sau nay|moi lan|lan nao cung|luon luon|luon|nho (la|rang|giup|nhe)|dung bao gio|khong bao gio|always|never|from now on|next time|every time|going forward)([^a-z]|$)/;
// Câu mệnh lệnh ("hãy viết…", "đừng dùng…", "ưu tiên…"): tính là lời dặn khi lặp lại ở nhiều đoạn chat.
// So trên chữ có dấu: bỏ dấu thì "dùng" và "đừng" trùng nhau.
const RULE = /(^|[\s,.!;:(])(hãy|đừng|không được|phải luôn|chỉ được|ưu tiên|please always|don't|do not|always use|never use|only use)(?=[\s,.!;:)]|$)/u;
const isRule = (t: string) => RULE.test(t.toLowerCase()) && !/\?\s*$/.test(t);
const STOP = new Set("tu gio nay bay lan sau ve moi nao cung luon nho la rang giup nhe nha nhen hay dung bao khong duoc phai chi cho toi minh ban em anh chi the thi va voi cua de se da dang mot nhung cac khi nay do ay nua roi la always never from now next time every please the a an to and of for in on with my me you your use only do not dont be is are going forward".split(" "));
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const similar = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b); const n = a.filter((w) => B.has(w)).length;
  return n / new Set([...a, ...b]).size;
};
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = "synchro:skill-suggest";
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const remember = (k: string) => { try { localStorage.setItem(KEY, JSON.stringify([...seen(), k].slice(-300))); } catch { /* bỏ qua */ } };

type ChatLike = { id: number; msgs: { role: string; text: string; time: number }[] };
export type Suggestion = { key: string; rules: string[]; repeated: number };

/** Gợi ý cho câu trả lời cuối của một đoạn chat: lời dặn ngay trước nó, cùng các lời dặn giống vậy ở những đoạn chat khác. */
export function suggestSkill(chat: ChatLike, all: ChatLike[]): Suggestion | null {
  const u = [...chat.msgs].reverse().find((m) => m.role === "user");
  if (!u || u.text.length < 10 || u.text.length > 1200) return null;
  // Câu trả lời cho thẻ hỏi lại ("Câu hỏi → lựa chọn") không phải lời dặn.
  if (u.text.includes("→")) return null;
  const f = fold(u.text), persist = PERSIST.test(f);
  if (!persist && !isRule(u.text)) return null;
  const w = words(u.text);
  if (w.length < 2) return null;
  const others: string[] = [];
  for (const c of all) for (const m of c.msgs) {
    if (m.role !== "user" || m === u || m.text.length > 1200 || others.includes(m.text) || m.text === u.text) continue;
    if (m.text.includes("→")) continue;
    if ((PERSIST.test(fold(m.text)) || isRule(m.text)) && similar(w, words(m.text)) >= 0.4) others.push(m.text);
  }
  if (!persist && others.length < 1) return null;
  const key = `${chat.id}:${u.time}`;
  if (seen().includes(key)) return null;
  return { key, rules: [u.text, ...others.slice(0, 4)], repeated: others.length + 1 };
}

const slug = (s: string) => words(s).slice(0, 5).join("-").slice(0, 48).replace(/-+$/, "") || "cach-lam-cua-toi";
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function skillMd(name: string, description: string, body: string) {
  // Mô tả thường có dấu hai chấm ("Cách làm đã dặn: …"): viết thành chuỗi trong ngoặc kép để YAML đọc đúng.
  return `---\nname: ${name}\ndescription: ${JSON.stringify(oneLine(description))}\n---\n\n${body.trim()}\n`;
}

export function SaveSkillChip({ chat, all, say }: { chat: ChatLike; all: ChatLike[]; say: (m: string) => void }) {
  const sug = useMemo(() => suggestSkill(chat, all), [chat, all]);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!sug || hidden) return null;
  const close = () => { remember(sug.key); setHidden(true); };
  return (
    <>
      <div className="ss-chip">
        <I.Sparkle size={14} />
        <span>{sug.repeated > 1 ? tr(`Bạn đã dặn điều này ${sug.repeated} lần.`) : tr("Đây là một lời dặn lâu dài.")}</span>
        <button className="lnk" onClick={() => setOpen(true)}>{tr("Lưu thành skill")}</button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={close} aria-label="Bỏ qua gợi ý"><I.X size={13} /></button>
      </div>
      {open && createPortal(<SaveSkillModal rules={sug.rules} onClose={() => setOpen(false)} onDone={(n) => { close(); setOpen(false); say(`Đã lưu skill ${n}`); }} />, document.body)}
    </>
  );
}

export function SaveSkillModal({ rules, onClose, onDone }: { rules: string[]; onClose: () => void; onDone: (name: string) => void }) {
  const [pick, setPick] = useState(rules.map(() => true));
  const chosen = rules.filter((_, i) => pick[i]);
  const [name, setName] = useState(slug(rules[0]));
  const [desc, setDesc] = useState(`Cách làm người dùng đã dặn: ${oneLine(rules[0]).slice(0, 160)}. Áp dụng cho mọi câu trả lời có liên quan.`);
  const [body, setBody] = useState<string | null>(null);
  const [exists, setExists] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const text = body ?? `# ${oneLine(rules[0]).slice(0, 80)}\n\nNgười dùng đã dặn Synchro làm theo các điều sau. Áp dụng mỗi khi yêu cầu có liên quan, kể cả ở đoạn chat mới:\n\n${chosen.map((r) => `- ${oneLine(r)}`).join("\n")}\n`;
  const ok = NAME_RE.test(name) && desc.trim().length >= 10 && text.trim().length >= 10;

  const send = async (dry: boolean) => {
    const fd = new FormData();
    fd.append("file", new File([skillMd(name, desc, text)], "SKILL.md", { type: "text/markdown" }));
    if (dry) fd.append("dry", "1");
    const r = await fetch("/api/skills", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || tr("Không lưu được skill"));
    return j;
  };
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      // Trùng tên skill đã có: hỏi lại trước khi lưu thành phiên bản mới.
      if (exists === null) { const j = await send(true); if (j.preview?.exists) { setExists(j.preview.version); return; } }
      await send(false);
      window.dispatchEvent(new Event(SKILLS_CHANGED));
      onDone(name);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sk-modal ss-modal" role="dialog" aria-label={tr("Lưu cách làm thành skill")}>
        <div className="sk-mh"><b>{tr("Lưu cách làm thành skill")}</b><span style={{ flex: 1 }} /><button className="icon-btn" style={{ width: 24, height: 24 }} disabled={busy} onClick={onClose}>×</button></div>
        <p className="d" style={{ margin: "0 0 12px" }}>{tr("Synchro sẽ tự đọc skill này khi yêu cầu có liên quan, ở mọi đoạn chat. Bạn tắt hoặc sửa nó trong Kho kỹ năng.")}</p>
        {rules.length > 1 && (
          <div className="ss-rules">
            <div className="ss-l">{tr("Lời dặn tìm thấy")}</div>
            {rules.map((r, i) => (
              <label key={i} className="ss-rule"><input type="checkbox" checked={pick[i]} onChange={(e) => { setPick(pick.map((p, j) => (j === i ? e.target.checked : p))); setBody(null); }} /><span data-notr>{oneLine(r).slice(0, 220)}</span></label>
            ))}
          </div>
        )}
        <label className="tk-l">{tr("Tên skill")}<input className="field" value={name} onChange={(e) => { setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-")); setExists(null); }} data-notr /></label>
        {!NAME_RE.test(name) && <div className="ss-hint">{tr("Chỉ dùng chữ thường không dấu, số và dấu gạch ngang.")}</div>}
        <label className="tk-l">{tr("Khi nào dùng")}<textarea className="field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="tk-l">SKILL.md<textarea className="field mono" rows={8} value={text} onChange={(e) => setBody(e.target.value)} /></label>
        {exists !== null && <div className="sk-note" style={{ marginTop: 10 }}>{tr(`Đã có skill tên ${name}. Lưu sẽ tạo phiên bản mới v${exists}; bản cũ vẫn khôi phục được.`)}</div>}
        {err && <div className="sk-err" role="alert" style={{ marginTop: 10 }}><span>{err}</span></div>}
        <div className="sk-actions">
          <button className="btn" disabled={busy} onClick={onClose}>{tr("Hủy")}</button>
          <button className="btn dark" disabled={busy || !ok || !chosen.length && body === null} onClick={save}>{busy ? tr("Đang lưu…") : exists !== null ? tr("Lưu phiên bản mới") : tr("Lưu skill")}</button>
        </div>
      </div>
    </div>
  );
}
