"use client";
// Giọng nói: giọng của tôi, thư viện, thiết kế giọng từ mô tả, nhân bản nhanh/chuyên sâu, remix.
import { useState } from "react";
import * as I from "../icons";
import { KIND_LABEL, MY_VOICES, VOICES, fmtUses, type Voice } from "./data";
import { Drop, Field, Player, Range, Seg, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

const DESIGN_EX = ["Nữ miền Nam, ngoài 20 tuổi, giọng ngọt, nói nhanh, hợp video mạng xã hội", "Ông lão miền Trung trầm ấm, kể chuyện cổ tích chậm rãi", "Nam phát thanh viên Hà Nội, rõ ràng, chuẩn mực, hơi nghiêm"];

function Previews({ seed, onSave, demo }: { seed: number; onSave: (i: number) => void; demo: () => void }) {
  return (
    <div className="sp-prev">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sp-prev-c">
          <div className="sp-prev-h"><b>Bản {i + 1}</b><button className="btn" onClick={() => onSave(i)}>Lưu giọng này</button></div>
          <Player dur={8 + i} seed={seed + i * 7} onDemo={demo} />
        </div>
      ))}
    </div>
  );
}

export function VoicesTool({ say, demo, sub, setSub, go }: ToolProps) {
  const tab = (["mine", "library", "design", "clone", "remix"] as const).find((x) => x === sub) ?? "mine";
  const [mine, setMine] = useState<Voice[]>(MY_VOICES);
  const [pick, setPick] = useState<null | "remix">(null);
  // Thiết kế
  const [desc, setDesc] = useState("");
  const [preview, setPreview] = useState("");
  const [autoText, setAutoText] = useState(true);
  const [guide, setGuide] = useState(50);
  const [designed, setDesigned] = useState(0);
  // Nhân bản
  const [cloneMode, setCloneMode] = useState<"ivc" | "pvc">("ivc");
  const [samples, setSamples] = useState<{ name: string; dur: string }[]>([]);
  const [denoise, setDenoise] = useState(true);
  const [cname, setCname] = useState("");
  const [consent, setConsent] = useState(false);
  const [pvcStep, setPvcStep] = useState(0);
  // Remix
  const [src, setSrc] = useState<Voice>(MY_VOICES[2]);
  const [rprompt, setRprompt] = useState("");
  const [strength, setStrength] = useState(50);
  const [remixed, setRemixed] = useState(0);

  const save = (name: string, kind: Voice["kind"]) => { setMine((m) => [{ ...VOICES[(m.length * 3) % VOICES.length], id: "demo-" + Date.now(), name, desc: KIND_LABEL[kind!], uses: 0, kind }, ...m]); setSub("mine"); say(`Đã lưu “${name}” vào Giọng của tôi`); };

  return (
    <div className="sp-wide">
      <ToolHead title="Giọng nói" desc="Quản lý giọng, chọn từ thư viện cộng đồng, tạo giọng mới hoặc nhân bản giọng của chính bạn.">
        <Seg label="Mục" value={tab} onChange={setSub} items={[{ k: "mine", label: "Giọng của tôi" }, { k: "library", label: "Thư viện" }, { k: "design", label: "Thiết kế" }, { k: "clone", label: "Nhân bản" }, { k: "remix", label: "Remix" }]} />
      </ToolHead>

      {tab === "mine" && (
        <div className="sp-vgrid">
          {mine.map((v) => (
            <div key={v.id} className="sp-vcard">
              <div className="sp-vcard-t"><VoiceAvatar v={v} size={40} /><div><b>{v.name}</b><span>{v.desc}</span></div></div>
              <div className="sp-vcard-m"><span className={`sp-badge k-${v.kind}`}>{v.kind ? KIND_LABEL[v.kind] : "Thư viện"}</span><span className="sp-muted">{v.lang} · {v.accent}</span></div>
              <Player dur={7} seed={v.name.length * 3} onDemo={demo} />
              <div className="sp-vcard-a">
                <button className="btn dark" onClick={() => go("tts", "single")}>Dùng để đọc</button>
                <button className="btn" onClick={() => { setSrc(v); setSub("remix"); }}>Remix</button>
                <button className="icon-btn" aria-label={`Xóa ${v.name}`} onClick={() => { setMine(mine.filter((x) => x.id !== v.id)); say(`Đã xóa “${v.name}”`); }}><I.Trash size={15} /></button>
              </div>
            </div>
          ))}
          <button className="sp-vcard sp-vnew" onClick={() => setSub("design")}><I.Plus size={20} /><b>Tạo giọng mới</b><span>Thiết kế từ mô tả hoặc nhân bản</span></button>
        </div>
      )}

      {tab === "library" && (
        <>
          <LibraryGrid say={say} demo={demo} onAdd={(v) => { if (!mine.some((x) => x.id === v.id)) setMine([{ ...v, kind: "library" }, ...mine]); say(`Đã thêm “${v.name}” vào Giọng của tôi`); }} />
        </>
      )}

      {tab === "design" && (
        <div className="sp-two">
          <div className="sp-card">
            <Field label="Mô tả giọng" hint={`${desc.length}/1000`} htmlFor="vd-desc"><textarea id="vd-desc" className="sp-input ta" rows={4} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Giới tính, độ tuổi, vùng miền, chất giọng, cảm xúc, tốc độ nói…" /></Field>
            <div className="sp-exs">{DESIGN_EX.map((x) => <button key={x} className="sp-tag" onClick={() => setDesc(x)}>{x}</button>)}</div>
            <Toggle checked={autoText} onChange={setAutoText} label="Tự viết câu nghe thử" hint="Hoặc tự nhập câu bên dưới" />
            {!autoText && <Field label="Câu nghe thử" hint="100–1000 ký tự" htmlFor="vd-prev"><textarea id="vd-prev" className="sp-input ta" rows={3} value={preview} onChange={(e) => setPreview(e.target.value)} /></Field>}
            <Range id="vd-guide" label="Bám sát mô tả" value={guide} onChange={setGuide} left="Sáng tạo" right="Bám sát" show={`${guide}%`} />
            <div className="sp-gen"><span className="sp-muted">Eleven v3 · tạo 3 bản để chọn</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={desc.trim().length < 20} onClick={() => { setDesigned((n) => n + 1); demo(); }}><I.Sparkle size={14} />Tạo giọng</button></div>
          </div>
          <div className="sp-card">
            <div className="sp-card-h">Bản nghe thử</div>
            {designed ? <Previews seed={designed * 5} demo={demo} onSave={(i) => save(`Giọng thiết kế ${i + 1}`, "designed")} /> : <div className="sp-empty">Mô tả giọng bạn muốn (ít nhất 20 ký tự), rồi bấm “Tạo giọng”. Synchro trả về 3 bản để bạn chọn.</div>}
          </div>
        </div>
      )}

      {tab === "clone" && (
        <div className="sp-two">
          <div className="sp-card">
            <Seg label="Kiểu nhân bản" value={cloneMode} onChange={setCloneMode} items={[{ k: "ivc", label: "Nhân bản nhanh" }, { k: "pvc", label: "Nhân bản chuyên sâu" }]} />
            <p className="sp-note">{cloneMode === "ivc" ? "Chỉ cần 1–2 phút âm thanh sạch, có ngay sau vài giây. Hợp để dùng thử và nội dung thường ngày." : "Huấn luyện riêng từ 30 phút đến 3 giờ âm thanh, giống gần như tuyệt đối. Cần xác minh đó là giọng của chính bạn."}</p>
            <Drop title="Thả mẫu giọng vào đây" sub={cloneMode === "ivc" ? "Tối đa 25 tệp · nên 1–2 phút tổng" : "Nên 30 phút – 3 giờ · một người nói, ít tạp âm"} accept="audio/*,video/*" multiple
              onFile={(f) => setSamples((s) => [...s, ...f.map((x) => ({ name: x.name, dur: `${Math.max(1, Math.round(x.size / 16000))} giây` }))])} />
            {samples.map((s, i) => <div key={i} className="sp-doc"><I.Wave size={16} /><span className="sp-doc-n"><b>{s.name}</b><small>{s.dur}</small></span><button className="icon-btn" aria-label="Bỏ mẫu" onClick={() => setSamples(samples.filter((_, j) => j !== i))}><I.X size={14} /></button></div>)}
            <button className="sp-add" onClick={() => say("Ghi âm trực tiếp bằng micro (mẫu)")}><I.Mic size={14} />Ghi âm trực tiếp</button>
            <Toggle checked={denoise} onChange={setDenoise} label="Lọc tạp âm nền trong mẫu" />
            <Field label="Tên giọng" htmlFor="vc-name"><input id="vc-name" className="sp-input" value={cname} onChange={(e) => setCname(e.target.value)} placeholder="vd. Giọng của tôi" /></Field>
            <label className="sp-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Tôi xác nhận đây là giọng của tôi hoặc tôi có quyền và sự đồng ý để nhân bản giọng này, và sẽ không dùng để lừa đảo hay mạo danh.</span></label>
            <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!samples.length || !cname.trim() || !consent}
              onClick={() => { if (cloneMode === "ivc") { save(cname.trim(), "cloned"); demo(); } else { setPvcStep(1); demo(); } }}><I.VoicePlus size={14} />{cloneMode === "ivc" ? "Tạo giọng" : "Tiếp tục"}</button></div>
          </div>
          <div className="sp-card">
            <div className="sp-card-h">{cloneMode === "ivc" ? "Mẹo để giọng giống hơn" : "Các bước nhân bản chuyên sâu"}</div>
            {cloneMode === "ivc" ? (
              <ul className="sp-tips"><li>Thu ở phòng yên tĩnh, micro cách miệng 15–20 cm.</li><li>Đọc tự nhiên, đúng cảm xúc bạn muốn giọng có.</li><li>Tránh nhạc nền, tiếng vang và nhiều người nói.</li><li>Chất lượng mẫu quan trọng hơn độ dài.</li></ul>
            ) : (
              <ol className="sp-steps">
                {[["Tải mẫu giọng", "30 phút – 3 giờ âm thanh sạch"], ["Xác minh giọng", "Đọc to một câu ngẫu nhiên để chứng minh là bạn"], ["Huấn luyện", "Khoảng 2–4 giờ, Synchro báo khi xong"]].map(([t, d], i) => (
                  <li key={t} className={pvcStep > i ? "done" : pvcStep === i ? "cur" : ""}><span className="sp-stepn">{pvcStep > i ? <I.Check size={13} /> : i + 1}</span><div><b>{t}</b><span>{d}</span>
                    {i === 1 && pvcStep === 1 && <div className="sp-verify"><p>“Hôm nay trời Hà Nội se lạnh, tôi pha một ấm trà và đọc câu này.”</p><button className="btn dark" onClick={() => { setPvcStep(2); say("Đã xác minh giọng (mẫu)"); }}><I.Mic size={14} />Ghi âm câu xác minh</button></div>}
                    {i === 2 && pvcStep === 2 && <div className="sp-progress"><i style={{ width: "36%" }} /><span>Đang huấn luyện · 36%</span></div>}
                  </div></li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {tab === "remix" && (
        <div className="sp-two">
          <div className="sp-card">
            <Field label="Giọng gốc"><VoiceChip v={src} onClick={() => setPick("remix")} /></Field>
            <p className="sp-note">Remix được với giọng bạn sở hữu (thiết kế, nhân bản) hoặc giọng thư viện không giới hạn thời hạn.</p>
            <Field label="Muốn đổi thế nào?" htmlFor="rx-p"><textarea id="rx-p" className="sp-input ta" rows={3} value={rprompt} onChange={(e) => setRprompt(e.target.value)} placeholder="vd. Trầm hơn, thêm chút khàn, nói chậm và thì thầm hơn" /></Field>
            <div className="sp-exs">{["Trẻ hơn 10 tuổi", "Giọng miền Nam", "Vui tươi hơn", "Thêm chút khàn"].map((x) => <button key={x} className="sp-tag" onClick={() => setRprompt((p) => (p ? p + ", " : "") + x.toLowerCase())}>{x}</button>)}</div>
            <Range id="rx-s" label="Mức thay đổi" value={strength} onChange={setStrength} left="Nhẹ" right="Mạnh" show={`${strength}%`} />
            <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!rprompt.trim()} onClick={() => { setRemixed((n) => n + 1); demo(); }}><I.Swap size={14} />Remix</button></div>
          </div>
          <div className="sp-card">
            <div className="sp-card-h">Bản nghe thử</div>
            {remixed ? <Previews seed={remixed * 9} demo={demo} onSave={(i) => save(`${src.name} remix ${i + 1}`, "designed")} /> : <div className="sp-empty">Chọn giọng gốc, mô tả thay đổi rồi bấm “Remix”.</div>}
          </div>
        </div>
      )}
      {pick && <VoicePicker value={src.id} onPick={setSrc} onClose={() => setPick(null)} say={say} />}
    </div>
  );
}

function LibraryGrid({ onAdd, demo }: { say: (m: string) => void; demo: () => void; onAdd: (v: Voice) => void }) {
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("Tất cả");
  const list = VOICES.filter((v) => (lang === "Tất cả" || v.lang === lang) && `${v.name} ${v.desc} ${v.use} ${v.accent}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="sp-libf">
        <label className="sp-search"><I.Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, phong cách, vùng miền…" aria-label="Tìm giọng" /></label>
        <Seg small label="Ngôn ngữ" value={lang} onChange={setLang} items={["Tất cả", "Tiếng Việt", "Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn"].map((k) => ({ k, label: k }))} />
      </div>
      <div className="sp-vgrid">
        {list.map((v) => (
          <div key={v.id} className="sp-vcard">
            <div className="sp-vcard-t"><VoiceAvatar v={v} size={40} /><div><b>{v.name}</b><span>{v.desc}</span></div></div>
            <div className="sp-vcard-m"><span className="sp-muted">{v.lang} · {v.accent} · {v.use}</span><span className="sp-muted" style={{ marginLeft: "auto" }}>{fmtUses(v.uses)}</span></div>
            <Player dur={6} seed={v.uses % 89} onDemo={demo} />
            <div className="sp-vcard-a"><button className="btn dark" onClick={() => onAdd(v)}><I.Plus size={14} />Thêm vào giọng của tôi</button></div>
          </div>
        ))}
        {!list.length && <div className="sp-empty">Không có giọng khớp.</div>}
      </div>
    </>
  );
}
