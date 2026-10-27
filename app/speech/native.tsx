"use client";
// Audio Native: trình phát nhúng vào website, đọc bài viết cho người xem bằng giọng ElevenLabs. Synchro gửi nội dung bài,
// ElevenLabs chuyển thành giọng nói (vài phút) và trả mã nhúng; Synchro tự hỏi lại trạng thái tới khi sẵn sàng.
import { useEffect, useState } from "react";
import * as I from "../icons";
import { MODEL_NOTE } from "./data";
import { ago, api, del, fmtNum, post, useItems, usePlan, type Item, type Voice } from "./client";
import { ErrBox, Field, Player, Select, Spin, VoiceAvatar, VoicePicker } from "./parts";
import { Head, Wide } from "./shell";
import type { ToolProps } from "./view";

export function NativeTool({ say, voice: shared }: ToolProps) {
  const plan = usePlan();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Voice | null>(null);
  const [pick, setPick] = useState(false);
  const [model, setModel] = useState("");
  const [fg, setFg] = useState("#111111");
  const [bg, setBg] = useState("#ffffff");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["native"]);
  const v = voice ?? shared;
  // Hỏi lại trạng thái các trình phát đang chuyển giọng mỗi 12 giây.
  useEffect(() => {
    const busyOnes = (items ?? []).filter((x) => x.meta.status === "converting");
    if (!busyOnes.length) return;
    const t = setTimeout(async () => {
      for (const it of busyOnes) {
        const j = await api<{ item: Item }>(`native?id=${it.id}`).catch(() => null);
        if (j) setItems((l) => l?.map((x) => (x.id === it.id ? j.item : x)) ?? null);
      }
    }, 12_000);
    return () => clearTimeout(t);
  }, [items, setItems]);
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const j = await post<{ item: Item }>("native", { title, author, text, voice: v?.id, voiceName: v?.name, model, textColor: fg, bgColor: bg });
      setItems((l) => [j.item, ...(l ?? [])]); setText(""); setTitle(""); say("Đã gửi bài sang ElevenLabs, trình phát sẽ sẵn sàng sau vài phút");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = (it: Item) => { del("items", it.id).then(() => setItems((l) => l?.filter((x) => x.id !== it.id) ?? null)).catch((e: Error) => say(e.message)); };
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => say("Đã sao chép mã nhúng"));
  return (
    <Wide>
      <Head tool="native" />
      <div className="sp-two">
        <div className="sp-card">
          <Field label="Tiêu đề bài viết" htmlFor="an-t"><input id="an-t" className="sp-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: 5 mẹo pha cà phê ngon tại nhà" /></Field>
          <Field label="Tác giả" hint="Không bắt buộc" htmlFor="an-a"><input id="an-a" className="sp-input" value={author} maxLength={100} onChange={(e) => setAuthor(e.target.value)} /></Field>
          <Field label="Nội dung bài viết" hint={`${fmtNum(text.length)} ký tự`} htmlFor="an-x"><textarea id="an-x" className="sp-input ta" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán nội dung bài viết. Mỗi đoạn cách nhau một dòng trống." /></Field>
          <div className="sp-two flat">
            <Field label="Giọng đọc"><button className="sp-vbig" onClick={() => setPick(true)}><VoiceAvatar v={v} size={26} /><span><b data-notr>{v?.name ?? "Mặc định"}</b><small>{v?.lang || "Giọng trong tài khoản"}</small></span><I.Chevron size={14} /></button></Field>
            <Select id="an-m" label="Model" value={model} options={[["", "Mặc định của ElevenLabs"], ...(plan?.tts ?? []).map((m) => [m.id, `${m.name}${MODEL_NOTE[m.id] ? ` · ${MODEL_NOTE[m.id]}` : ""}`] as [string, string])]} onChange={setModel} />
          </div>
          <div className="sp-colors">
            <label><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />Màu chữ</label>
            <label><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />Màu nền</label>
          </div>
          <Field label="Xem trước trình phát">
            <div className="sp-anprev" style={{ color: fg, background: bg }}>
              <span className="sp-anplay" style={{ background: fg, color: bg }}><I.Play size={12} /></span>
              <span><b data-notr>{title || "Nghe bài viết này"}</b><small>{v?.name ? `Giọng ${v.name}` : "Giọng AI"} · ElevenLabs</small></span>
            </div>
          </Field>
          <div className="sp-gen"><span className="sp-muted">≈ {fmtNum(text.length)} credit</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!text.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Sparkle size={14} />}{busy ? "Đang gửi…" : "Tạo trình phát"}</button></div>
          <ErrBox msg={err} />
        </div>
        <div className="sp-card">
          <div className="sp-card-h">Trình phát đã tạo</div>
          {items === null && <div className="sp-empty"><Spin /></div>}
          {items?.length === 0 && <div className="sp-empty">Mã nhúng của trình phát sẽ hiện ở đây để bạn sao chép.</div>}
          {items?.map((it) => {
            const m = it.meta as { status?: string; snippet?: string; audioUrl?: string | null; voiceName?: string; chars?: number };
            return (
              <div key={it.id} className="sp-proj">
                <div className="sp-proj-t"><I.Globe size={16} /><b data-notr>{it.title}</b>
                  <span className={`sp-pill ${m.status === "ready" ? "ok" : m.status === "failed" ? "bad" : ""}`}>{m.status === "ready" ? "Sẵn sàng" : m.status === "failed" ? "Lỗi" : "Đang chuyển giọng…"}</span>
                  <span className="sp-muted">{ago(it.createdAt)}</span><button className="icon-btn" aria-label="Xóa" onClick={() => remove(it)}><I.Trash size={14} /></button></div>
                {m.audioUrl && <Player src={m.audioUrl} label={it.title} />}
                {m.snippet && (
                  <div className="sp-code">
                    <pre data-notr>{m.snippet}</pre>
                    <button className="btn" onClick={() => copy(m.snippet!)}><I.Copy size={14} />Sao chép mã nhúng</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {pick && <VoicePicker value={v?.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </Wide>
  );
}
