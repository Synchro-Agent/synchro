"use client";
// Giọng nói: giọng của tôi, thư viện cộng đồng, và trang Tạo giọng (nhân bản nhanh, chuyên sâu, thiết kế, remix).
import { useState } from "react";
import * as I from "../icons";
import { KIND_LABEL, MY_VOICES, VOICES, fmtUses, type Voice } from "./data";
import { Drop, Field, OrbStage, Player, Range, Seg, Tabs, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

type Sub = "mine" | "library" | "create" | "ivc" | "pvc" | "design" | "remix";
const DESIGN_EX = ["Nữ miền Nam, ngoài 20 tuổi, giọng ngọt, nói nhanh, hợp video mạng xã hội", "Ông lão miền Trung trầm ấm, kể chuyện cổ tích chậm rãi", "Nam phát thanh viên Hà Nội, rõ ràng, chuẩn mực, hơi nghiêm"];
const CREATE = [
  { k: "ivc" as const, title: "Nhân bản nhanh", desc: "Nhân bản giọng của bạn chỉ từ 10 giây âm thanh. Tải tệp lên hoặc ghi âm trực tiếp.", hue: 185, min: "10 giây", best: "3 phút" },
  { k: "pvc" as const, title: "Nhân bản chuyên sâu", desc: "Bản nhân bản giống thật nhất. Tốt nhất với 30 phút mẫu trở lên, có xác minh chính chủ.", hue: 322, min: "10 phút", best: "2 giờ" },
  { k: "design" as const, title: "Thiết kế giọng", desc: "Tạo giọng cho người hay nhân vật từ một câu mô tả, rồi tinh chỉnh theo ý.", hue: 32, tags: ["Giám đốc", "Cô gái miền Tây", "Lồng tiếng trailer", "Cướp biển", "Ông kể chuyện", "Chú chuột nhỏ"] },
];

function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="sp-back" onClick={onClick}><I.Back size={15} />{label}</button>;
}

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
  const tab = ((["mine", "library", "create", "ivc", "pvc", "design", "remix"] as const).find((x) => x === sub) ?? "mine") as Sub;
  const top = tab === "mine" || tab === "library" ? tab : "create";
  const [mine, setMine] = useState<Voice[]>(MY_VOICES);
  const [pick, setPick] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  // Thiết kế
  const [desc, setDesc] = useState("");
  const [preview, setPreview] = useState("");
  const [autoText, setAutoText] = useState(true);
  const [guide, setGuide] = useState(50);
  const [designed, setDesigned] = useState(0);
  // Nhân bản
  const [samples, setSamples] = useState<{ name: string; sec: number }[]>([]);
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
  const total = samples.reduce((n, x) => n + x.sec, 0);
  const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} phút ${s % 60 ? `${s % 60} giây` : ""}`.trim() : `${s} giây`);

  const clone = (pro: boolean) => {
    const target = pro ? 7200 : 180;
    return (
      <>
        <div className="sp-clone">
          <div className="sp-card sp-clone-l">
            <Drop title="Tải tệp âm thanh lên hoặc ghi âm" sub={pro ? "Tối đa 1 GB mỗi tệp · một người nói, ít tạp âm" : "Tối đa 10 MB mỗi tệp · tối đa 25 tệp"} accept="audio/*,video/*" multiple
              onFile={(f) => setSamples((s) => [...s, ...f.map((x) => ({ name: x.name, sec: Math.max(5, Math.round(x.size / 16000)) }))])} />
            {samples.length > 0 && <div className="sp-samples">{samples.map((x, i) => <div key={i} className="sp-doc"><I.Wave size={16} /><span className="sp-doc-n"><b>{x.name}</b><small>{fmtSec(x.sec)}</small></span><button className="icon-btn" aria-label="Bỏ mẫu" onClick={() => setSamples(samples.filter((_, j) => j !== i))}><I.X size={14} /></button></div>)}</div>}
            <div className="sp-clone-btns">
              <button className="btn" onClick={() => document.querySelector<HTMLInputElement>(".sp-clone-l input[type=file]")?.click()}><I.Upload size={14} />Tải tệp lên</button>
              <button className="btn" onClick={() => { setSamples((s) => [...s, { name: `Ghi âm ${s.length + 1}.webm`, sec: 45 }]); say("Đã thêm bản ghi âm (mẫu)"); }}><I.Mic size={14} />Ghi âm</button>
            </div>
          </div>
          <div className="sp-card sp-clone-r">
            <OrbStage hue={pro ? 322 : 185} progress={total / target} min={pro ? "10 phút" : "10 giây"} best={pro ? "2 giờ" : "3 phút"} active={samples.length > 0} />
            <p className="sp-muted" style={{ textAlign: "center" }}>{total ? `Đã có ${fmtSec(total)} mẫu · ` : ""}Để giọng giống nhất, hãy cung cấp {pro ? "2 giờ" : "3 phút"} âm thanh mẫu.</p>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-two flat">
            <Field label="Tên giọng" htmlFor="vc-name"><input id="vc-name" className="sp-input" value={cname} onChange={(e) => setCname(e.target.value)} placeholder="vd. Giọng của tôi" /></Field>
            <Toggle checked={denoise} onChange={setDenoise} label="Lọc tạp âm nền trong mẫu" hint="Nên bật nếu thu ở nơi ồn" />
          </div>
          {pro && (
            <ol className="sp-steps row">
              {[["Tải mẫu giọng", "30 phút – 3 giờ"], ["Xác minh giọng", "Đọc to một câu ngẫu nhiên"], ["Huấn luyện", "Khoảng 2–4 giờ"]].map(([t, d], i) => (
                <li key={t} className={pvcStep > i ? "done" : pvcStep === i ? "cur" : ""}><span className="sp-stepn">{pvcStep > i ? <I.Check size={13} /> : i + 1}</span><div><b>{t}</b><span>{d}</span></div></li>
              ))}
            </ol>
          )}
          {pro && pvcStep === 1 && <div className="sp-verify"><p>“Hôm nay trời Hà Nội se lạnh, tôi pha một ấm trà và đọc câu này.”</p><button className="btn dark" onClick={() => { setPvcStep(2); say("Đã xác minh giọng (mẫu)"); }}><I.Mic size={14} />Ghi âm câu xác minh</button></div>}
          {pro && pvcStep === 2 && <div className="sp-progress"><i style={{ width: "36%" }} /><span>Đang huấn luyện · 36%</span></div>}
          <label className="sp-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Tôi xác nhận đây là giọng của tôi hoặc tôi có quyền và sự đồng ý để nhân bản giọng này, và sẽ không dùng để lừa đảo hay mạo danh.</span></label>
          <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!samples.length || !cname.trim() || !consent || (pro && pvcStep > 0)}
            onClick={() => { if (!pro) { save(cname.trim(), "cloned"); demo(); } else { setPvcStep(1); demo(); } }}><I.VoicePlus size={14} />{pro ? "Tiếp tục xác minh" : "Tạo giọng"}</button></div>
        </div>
      </>
    );
  };

  return (
    <div className="sp-wide">
      <ToolHead title={tab === "ivc" ? "Nhân bản nhanh" : tab === "pvc" ? "Nhân bản chuyên sâu" : tab === "design" ? "Thiết kế giọng" : tab === "remix" ? "Remix giọng" : "Giọng nói"}
        desc={top === "create" && tab !== "create" ? "Làm theo các bước bên dưới. Giọng tạo xong nằm trong Giọng của tôi." : "Quản lý giọng, chọn từ thư viện cộng đồng, hoặc tạo giọng mới của riêng bạn."}>
        {tab === "create" || tab === "mine" || tab === "library" ? <Tabs label="Mục" value={top} onChange={(k) => setSub(k)} items={[{ k: "mine", label: "Giọng của tôi" }, { k: "library", label: "Thư viện" }, { k: "create", label: "Tạo giọng" }]} /> : <Back label="Tạo giọng" onClick={() => setSub("create")} />}
      </ToolHead>

      {tab === "mine" && (
        <div className="sp-vgrid">
          {mine.map((v) => (
            <div key={v.id} className="sp-vcard">
              <div className="sp-vcard-t"><VoiceAvatar v={v} size={40} playing={playing === v.id} /><div><b>{v.name}</b><span>{v.desc}</span></div></div>
              <div className="sp-vcard-m"><span className={`sp-badge k-${v.kind}`}>{v.kind ? KIND_LABEL[v.kind] : "Thư viện"}</span><span className="sp-muted">{v.lang} · {v.accent}</span></div>
              <Player dur={7} seed={v.name.length * 3} onDemo={demo} />
              <div className="sp-vcard-a">
                <button className="btn dark" onClick={() => go("tts", "single")}>Dùng để đọc</button>
                <button className="btn" onClick={() => { setSrc(v); setSub("remix"); }}>Remix</button>
                <button className="icon-btn" aria-label={`Xóa ${v.name}`} onClick={() => { setMine(mine.filter((x) => x.id !== v.id)); say(`Đã xóa “${v.name}”`); }}><I.Trash size={15} /></button>
              </div>
            </div>
          ))}
          <button className="sp-vcard sp-vnew" onClick={() => setSub("create")}><I.Plus size={20} /><b>Tạo giọng mới</b><span>Nhân bản, thiết kế hoặc remix</span></button>
        </div>
      )}

      {tab === "library" && <LibraryGrid demo={demo} onAdd={(v) => { if (!mine.some((x) => x.id === v.id)) setMine([{ ...v, kind: "library" }, ...mine]); say(`Đã thêm “${v.name}” vào Giọng của tôi`); }} />}

      {tab === "create" && (
        <>
          <div className="sp-create">
            {CREATE.map((c) => (
              <div key={c.k} className="sp-card sp-ccard">
                <div><b>{c.title}</b><p>{c.desc}</p></div>
                <div className="sp-ccard-orb">
                  {c.tags && <div className="sp-ctags" aria-hidden="true">{c.tags.map((t) => <span key={t}>{t}</span>)}</div>}
                  <OrbStage hue={c.hue} size={120} progress={c.min ? 0.001 : undefined} min={c.min} best={c.best} playing={playing === c.k} onPlay={() => setPlaying(playing === c.k ? null : c.k)} />
                </div>
                <button className="btn dark sp-wbtn" onClick={() => setSub(c.k)}>Tạo mới</button>
              </div>
            ))}
          </div>
          <div className="sp-sec-h"><b>Công cụ khác</b></div>
          <div className="sp-card sp-remixcard">
            <div><b>Remix giọng</b><p>Biến đổi giọng có sẵn bằng câu lệnh và thiết lập như cao độ, nhịp nói để ra giọng mới.</p><button className="btn dark" onClick={() => setSub("remix")}>Tạo mới</button></div>
            <div className="sp-remix-demo" aria-hidden="true"><span>Tạo phiên bản giọng nữ của giọng này</span><div><em>Giọng cao</em><em>Nói nhanh</em></div><VoiceAvatar v={VOICES[3]} size={44} playing /></div>
          </div>
        </>
      )}

      {tab === "ivc" && clone(false)}
      {tab === "pvc" && clone(true)}

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
            {designed ? <Previews seed={designed * 5} demo={demo} onSave={(i) => save(`Giọng thiết kế ${i + 1}`, "designed")} /> : <div className="sp-empty"><OrbStage hue={32} size={96} /><p>Mô tả giọng bạn muốn (ít nhất 20 ký tự), rồi bấm “Tạo giọng”. ElevenLabs trả về 3 bản để bạn chọn.</p></div>}
          </div>
        </div>
      )}

      {tab === "remix" && (
        <div className="sp-two">
          <div className="sp-card">
            <Field label="Giọng gốc"><VoiceChip v={src} onClick={() => setPick(true)} /></Field>
            <p className="sp-note">Remix được với giọng bạn sở hữu (thiết kế, nhân bản) hoặc giọng thư viện không giới hạn thời hạn.</p>
            <Field label="Muốn đổi thế nào?" htmlFor="rx-p"><textarea id="rx-p" className="sp-input ta" rows={3} value={rprompt} onChange={(e) => setRprompt(e.target.value)} placeholder="vd. Trầm hơn, thêm chút khàn, nói chậm và thì thầm hơn" /></Field>
            <div className="sp-exs">{["Trẻ hơn 10 tuổi", "Giọng miền Nam", "Vui tươi hơn", "Thêm chút khàn"].map((x) => <button key={x} className="sp-tag" onClick={() => setRprompt((p) => (p ? p + ", " : "") + x.toLowerCase())}>{x}</button>)}</div>
            <Range id="rx-s" label="Mức thay đổi" value={strength} onChange={setStrength} left="Nhẹ" right="Mạnh" show={`${strength}%`} />
            <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!rprompt.trim()} onClick={() => { setRemixed((n) => n + 1); demo(); }}><I.Swap size={14} />Remix</button></div>
          </div>
          <div className="sp-card">
            <div className="sp-card-h">Bản nghe thử</div>
            {remixed ? <Previews seed={remixed * 9} demo={demo} onSave={(i) => save(`${src.name} remix ${i + 1}`, "designed")} /> : <div className="sp-empty"><OrbStage hue={src.hue ?? 200} size={96} /><p>Chọn giọng gốc, mô tả thay đổi rồi bấm “Remix”.</p></div>}
          </div>
        </div>
      )}
      {pick && <VoicePicker value={src.id} onPick={setSrc} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}

function LibraryGrid({ onAdd, demo }: { demo: () => void; onAdd: (v: Voice) => void }) {
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
