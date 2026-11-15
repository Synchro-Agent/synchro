"use client";
// Giọng nói (giọng của tài khoản ElevenLabs, thư viện cộng đồng) và Tạo giọng (thiết kế, remix, nhân bản nhanh, nhân bản chuyên sâu).
// Nhân bản chỉ hiện khi gói cho phép (cờ của chính gói ElevenLabs); thư viện ở gói Free chỉ có giọng cho phép người dùng miễn phí.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store";
import * as I from "../icons";
import { CAT_LABEL, LANGS, api, del, fmtNum, hueOf, on, post, postForm, reloadVoices, useMyVoices, usePlan, type Voice } from "./client";
import { getLang, tr, untranslated } from "../i18n";
import { AGES, DESIGN_PRESETS, GENDERS, REMIX_IDEAS } from "../../shared/speech/data";
import { Drop, ErrBox, Field, OrbStage, Player, Range, Recorder, Seg, Select, Spin, Tabs, Toggle, VoiceAvatar, VoiceChip, VoicePicker, voiceLine } from "./parts";
import { Head, Wide } from "./shell";
import type { ToolProps } from "./view";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "../bulk";
import { PageBar, usePage } from "../pager";

type Sub = "mine" | "library" | "create" | "ivc" | "pvc" | "design" | "remix";
type Prev = { id: string; audio: string; dur: number };

function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="sp-back" onClick={onClick}><I.Back size={15} />{label}</button>;
}

function Previews({ list, onSave, busy }: { list: Prev[]; onSave: (p: Prev, i: number) => void; busy: string }) {
  return (
    <div className="sp-prev">
      {list.map((p, i) => (
        <div key={p.id} className="sp-prev-c">
          <div className="sp-prev-h"><b>Bản {i + 1}</b><button className="btn" disabled={!!busy} onClick={() => onSave(p, i)}>{busy === p.id ? <Spin /> : null}Lưu giọng này</button></div>
          <Player src={p.audio} dl={p.audio} name={`ban-nghe-thu-${i + 1}.mp3`} />
        </div>
      ))}
    </div>
  );
}

export function VoicesTool({ say, sub, setSub, go, voice, setVoice, admin, area }: ToolProps & { area: "voices" | "create" }) {
  const app = useApp();
  const plan = usePlan();
  const mine = useMyVoices();
  const can = { design: on(plan, "design"), remix: on(plan, "remix"), ivc: on(plan, "ivc"), pvc: on(plan, "pvc") };
  const creatable = (["design", "ivc", "pvc"] as const).filter((k) => can[k]);
  // Gói Free không dùng được giọng Thư viện qua API: không hiện mục Thư viện.
  const lib = !!plan?.library;
  const subs: Sub[] = area === "voices" ? (lib ? ["mine", "library"] : ["mine"]) : ["create", "ivc", "pvc", "design", "remix"];
  const want = subs.find((x) => x === sub) ?? subs[0];
  const tab: Sub = ["ivc", "pvc", "design", "remix"].includes(want) && !can[want as "ivc"] ? subs[0] : want;
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "premade" | "own">("");
  const [gender, setGender] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);
  const preview = (v: Voice) => {
    if (playing === v.id) { el.current?.pause(); setPlaying(null); return; }
    el.current?.pause();
    if (!v.preview) return;
    const a = new Audio(v.preview); el.current = a; a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(v.id)).catch(() => setPlaying(null));
  };
  const slots = plan?.voices;
  const own = (mine ?? []).filter((v) => v.category !== "premade");
  const [src, setSrc] = useState<Voice | null>(null);
  const remove = (v: Voice) => {
    app.confirm("Xóa giọng?", tr(`Xóa giọng “${v.name}” khỏi tài khoản ElevenLabs? Không hoàn tác được.`), "Xóa", () => {
      del("voices", v.id).then(() => reloadVoices(true)).then(() => say(`Đã xóa “${v.name}”`)).catch((e: Error) => say(e.message));
    });
  };
  // Quản trị viên gán chủ cho giọng không rõ của ai (có từ trước khi Synchro ghi chủ), hoặc đánh dấu dùng chung.
  const [ownerOf, setOwnerOf] = useState<Voice | null>(null);
  const [who, setWho] = useState("");
  const assign = (v: Voice) => { setWho(v.holder?.includes("@") ? v.holder : ""); setOwnerOf(v); };
  const saveOwner = () => {
    if (!ownerOf || !who.trim()) return;
    post("voices/owner", { id: ownerOf.id, owner: who.trim() }).then(() => { setOwnerOf(null); return reloadVoices(true); }).then(() => say("Đã gán chủ giọng")).catch((e: Error) => say(e.message));
  };
  const card = (v: Voice, extra?: React.ReactNode) => (
    <div key={v.id} className={`sp-vcard${bkV.on && !delOk(v) ? " bk-dim" : ""}`} {...(delOk(v) ? bulkRow(bkV, v) : {})}>
      <div className="sp-vcard-t">
        {bkV.on && delOk(v) && <BulkCheck on={bkV.has(v)} />}
        <button className="sp-avbtn" aria-label={playing === v.id ? `Dừng nghe ${v.name}` : `Nghe thử ${v.name}`} onClick={() => preview(v)} disabled={!v.preview}><VoiceAvatar v={v} size={40} playing={playing === v.id} /><span className="sp-avplay">{playing === v.id ? <I.M icon="Pause" size={12} /> : <I.M icon="Play" size={12} />}</span></button>
        <div><b data-notr>{v.name}</b><span data-notr={untranslated(v.desc) || undefined}>{v.desc}</span></div>
      </div>
      <div className="sp-vcard-m"><span className={`sp-badge k-${v.category}`}>{v.mine ? CAT_LABEL[v.category] ?? v.category : v.use || "Thư viện"}</span><span className="sp-muted">{[v.lang, v.accent, v.mine ? "" : v.gender].filter(Boolean).join(" · ")}</span></div>
      {extra}
    </div>
  );

  const shown = (mine ?? []).filter((v) => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return w.every((x) => `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.gender} ${v.age} ${v.use}`.toLowerCase().includes(x))
      && (!kind || (kind === "premade" ? v.category === "premade" : v.category !== "premade")) && (!gender || v.gender === GENDERS.find((g) => g[1] === gender)?.[0]);
  });
  // Thành viên có thể thấy giọng cũ chưa rõ chủ: chỉ gỡ được giọng máy chủ ghi là của họ. Giọng Thư viện dùng chung: chỉ quản trị viên gỡ.
  const delOk = (v: Voice) => v.category !== "premade" && (!!admin || (!!v.canDelete && !v.lib));
  const bkV = useBulk(shown.filter(delOk), (v) => v.id);
  const pgV = usePage(shown, 12, `${q}|${kind}|${gender}`);
  const voiceActs: BulkAct<Voice>[] = [
    { id: "del", label: "Xóa giọng", icon: <I.Trash size={14} />, danger: true, confirm: (l) => ({ title: `Xóa ${l.length} giọng khỏi tài khoản ElevenLabs?`, text: "Không hoàn tác được.", ok: "Xóa" }),
      run: async (l) => { await each(l, (v) => del("voices", v.id)); await reloadVoices(true); say(`Đã xóa ${l.length} giọng`); } },
  ];
  const sub2 = { ivc: "Nhân bản nhanh", pvc: "Nhân bản chuyên sâu", design: "Thiết kế giọng", remix: "Remix giọng" } as Record<string, string>;

  if (area === "voices") return (
    <Wide>
      <Head tool="voices" desc={`Giọng trong tài khoản ElevenLabs${lib ? " và thư viện cộng đồng" : ""}.${slots && slots.limit ? ` Đã dùng ${slots.used}/${slots.limit} chỗ lưu giọng.` : ""}`}>
        {lib && <Tabs label="Mục" value={tab} onChange={(k) => setSub(k)} items={[{ k: "mine", label: "Giọng của tôi" }, { k: "library", label: "Thư viện" }]} />}
      </Head>
      {tab === "mine" && (
        <>
          <div className="sp-libf">
            <label className="sp-search"><I.Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, phong cách, ngôn ngữ…" aria-label="Tìm giọng" /></label>
            <Seg small label="Loại giọng" value={kind} onChange={setKind} items={[{ k: "", label: "Tất cả" }, { k: "premade", label: "Có sẵn" }, { k: "own", label: "Tự tạo" }]} />
            <Seg small label="Giới tính" value={gender} onChange={setGender} items={[{ k: "", label: "Mọi giới tính" }, ...GENDERS.map(([l, k]) => ({ k, label: l }))]} />
            {shown.some(delOk) && <BulkButton b={bkV} compact />}
          </div>
          <div className="sp-vgrid">
            {mine === null && <div className="sp-empty"><Spin /> Đang tải giọng…</div>}
            {mine && !shown.length && <div className="sp-empty">Không có giọng khớp.</div>}
            {pgV.items.map((v) => card(v, (
              <div className="sp-vcard-a">
                <button className="btn dark" onClick={() => { setVoice(v); go("tts", "single"); }}>Dùng giọng</button>
                {can.remix && v.category !== "premade" && <button className="btn" onClick={() => { setVoice(v); go("create", "remix"); }}>Remix</button>}
                {admin && v.holder && v.holder !== "purge" && <button className="btn" title={v.holder.includes("@") ? v.holder : undefined} aria-label="Chủ giọng" onClick={() => assign(v)}>{v.holder === "none" ? "Chưa có chủ" : v.holder === "shared" ? "Dùng chung" : v.holder === "orphan" ? "Không còn chủ" : "Gán chủ"}</button>}
                {delOk(v) && <button className="icon-btn" aria-label={`Xóa ${v.name}`} onClick={() => remove(v)}><I.Trash size={15} /></button>}
              </div>
            )))}
            {(creatable.length > 0 || can.remix) && !bkV.on && <button className="sp-vcard sp-vnew" onClick={() => go("create")}><I.Plus size={20} /><b>Tạo giọng mới</b><span>Nhân bản giọng của bạn hoặc thiết kế từ mô tả</span></button>}
          </div>
        </>
      )}
      {tab === "mine" && <PageBar pg={pgV} />}
      {tab === "mine" && <BulkBar b={bkV} acts={voiceActs} noun="giọng" />}
      {tab === "library" && <LibraryGrid say={say} card={card} onUse={(v) => { setVoice(v); go("tts", "single"); }} />}
      {ownerOf && createPortal(<div className="overlay" style={{ zIndex: "var(--z-drawer)" }} onMouseDown={(e) => e.target === e.currentTarget && setOwnerOf(null)}>
        <div className="modal sm" style={{ width: 420 }}>
          <h2 style={{ fontSize: "var(--fs-4)" }}>Chủ giọng</h2>
          <p className="d">Email của chủ giọng này. Nhập shared nếu mọi thành viên được dùng.</p>
          <input className="field" autoFocus aria-label="Chủ giọng" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveOwner(); }} />
          <div className="modal-foot"><button className="btn" onClick={() => setOwnerOf(null)}>Hủy</button><button className="btn dark" disabled={!who.trim()} onClick={saveOwner}>Gán chủ</button></div>
        </div>
      </div>, document.body)}
    </Wide>
  );

  return (
    <Wide>
      <Head tool="create" title={sub2[tab]} desc={tab === "create" ? undefined : "Làm theo các bước bên dưới. Giọng tạo xong nằm trong Giọng nói."}>
        {tab !== "create" && <Back label="Tạo giọng" onClick={() => setSub("create")} />}
      </Head>
      {tab === "create" && (
        <>
          <div className="sp-create">
            {can.ivc && <CreateCard hue={185} title="Nhân bản nhanh" desc="Nhân bản giọng của bạn từ vài phút âm thanh. Tải tệp lên hoặc ghi âm trực tiếp." min="10 giây" best="3 phút" onGo={() => setSub("ivc")} />}
            {can.pvc && <CreateCard hue={322} title="Nhân bản chuyên sâu" desc="Bản nhân bản giống thật nhất. Tốt nhất với 30 phút mẫu trở lên, có xác minh chính chủ." min="10 phút" best="2 giờ" onGo={() => setSub("pvc")} />}
            {can.design && <CreateCard hue={32} title="Thiết kế giọng" desc="Tạo giọng cho người hay nhân vật từ một câu mô tả, nghe thử 3 bản rồi lưu bản ưng nhất." tags={DESIGN_PRESETS.slice(0, 4).map((x) => x[0])} onGo={() => setSub("design")} />}
          </div>
          {can.remix && (
            <div className="sp-card sp-remixcard">
              <div><b>Remix giọng</b><p>Biến đổi giọng bạn đã thiết kế hoặc nhân bản bằng câu mô tả để ra giọng mới: trẻ hơn, vùng miền khác, cảm xúc khác.{own.length ? "" : " Cần có ít nhất một giọng tự tạo."}</p></div>
              <div className="sp-exs">{REMIX_IDEAS.slice(0, 4).map((x) => <span key={x} className="sp-pill">{x}</span>)}</div>
              <button className="btn dark" disabled={!own.length} onClick={() => setSub("remix")}>Tạo mới</button>
            </div>
          )}
        </>
      )}
      {tab === "ivc" && <Ivc say={say} done={() => go("voices", "mine")} />}
      {tab === "pvc" && <Pvc say={say} done={() => go("voices", "mine")} />}
      {tab === "design" && <Design say={say} done={() => go("voices", "mine")} />}
      {tab === "remix" && <Remix say={say} own={own} src={src ?? own.find((x) => x.id === voice?.id) ?? own[0] ?? null} setSrc={setSrc} done={() => go("voices", "mine")} />}
    </Wide>
  );
}

function CreateCard({ hue, title, desc, min, best, tags, onGo }: { hue: number; title: string; desc: string; min?: string; best?: string; tags?: string[]; onGo: () => void }) {
  return (
    <div className="sp-card sp-ccard">
      <div><b>{title}</b><p>{desc}</p></div>
      <div className="sp-ccard-orb">
        {tags && <div className="sp-ctags" aria-hidden="true">{tags.map((t) => <span key={t}>{t}</span>)}</div>}
        <OrbStage hue={hue} size={120} progress={min ? 0.001 : undefined} min={min} best={best} />
      </div>
      <button className="btn dark sp-wbtn" onClick={onGo}>Tạo mới</button>
    </div>
  );
}

function LibraryGrid({ say, card, onUse }: { say: (m: string) => void; card: (v: Voice, extra?: React.ReactNode) => React.ReactNode; onUse: (v: Voice) => void }) {
  const plan = usePlan();
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("vi");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [list, setList] = useState<Voice[] | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let dead = false;
    setList(null);
    const t = setTimeout(() => {
      api<{ voices: Voice[] }>(`voices?${new URLSearchParams({ lib: "1", q, lang, gender, age })}`).then((j) => !dead && setList(j.voices)).catch((e: Error) => { if (!dead) { setList([]); say(e.message); } });
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [q, lang, gender, age]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = !!plan && plan.voices.limit > 0 && plan.voices.used >= plan.voices.limit;
  const add = async (v: Voice) => {
    setBusy(v.id);
    try {
      const j = await post<{ voiceId: string }>("voices/add", { owner: v.owner, id: v.id, name: v.name });
      await reloadVoices(true);
      setList((l) => l?.map((x) => (x.id === v.id ? { ...x, added: true } : x)) ?? null);
      say(`Đã thêm “${v.name}” vào Giọng của tôi`);
      return j.voiceId;
    } catch (e) { say((e as Error).message); return null; } finally { setBusy(""); }
  };
  return (
    <>
      <div className="sp-libf">
        <label className="sp-search"><I.Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, phong cách, vùng miền…" aria-label="Tìm giọng" /></label>
        <Select id="lib-lang" label="Ngôn ngữ" value={lang} options={LANGS.map(([c, n]) => [c, c ? n : "Tất cả ngôn ngữ"] as [string, string])} onChange={setLang} inline />
        <Seg small label="Giới tính" value={gender} onChange={setGender} items={[{ k: "", label: "Tất cả" }, ...GENDERS.map(([l, k]) => ({ k, label: l }))]} />
        <Seg small label="Độ tuổi" value={age} onChange={setAge} items={[{ k: "", label: "Mọi tuổi" }, ...AGES.map(([l, k]) => ({ k, label: l }))]} />
      </div>
      {plan?.tier === "free" && <p className="sp-note">Gói Free chỉ hiện các giọng thư viện cho phép người dùng miễn phí. Mỗi giọng thêm vào dùng một chỗ lưu giọng ({plan.voices.used}/{plan.voices.limit}).</p>}
      <div className="sp-vgrid">
        {list === null && <div className="sp-empty"><Spin /> Đang tìm trong thư viện ElevenLabs…</div>}
        {list?.map((v) => card(v, (
          <>
            <div className="sp-vcard-m"><span className="sp-muted" style={{ marginLeft: "auto" }}>{fmtNum(v.uses ?? 0)} lượt nhân bản</span></div>
            <div className="sp-vcard-a">
              {v.added ? <span className="sp-muted">Đã có trong Giọng của tôi</span> : (
                <>
                  <button className="btn dark" disabled={!!busy || full} title={full ? "Đã dùng hết chỗ lưu giọng của gói" : undefined} onClick={async () => { const id = await add(v); if (id) onUse({ ...v, id, mine: true }); }}>{busy === v.id ? <Spin /> : <I.Plus size={14} />}Thêm và dùng</button>
                  <button className="btn" disabled={!!busy || full} onClick={() => add(v)}>Chỉ thêm</button>
                </>
              )}
            </div>
          </>
        )))}
        {list?.length === 0 && <div className="sp-empty">Không có giọng khớp.</div>}
      </div>
    </>
  );
}

function Design({ say, done }: { say: (m: string) => void; done: () => void }) {
  const [desc, setDesc] = useState("");
  const [text, setText] = useState("");
  const [auto, setAuto] = useState(true);
  const [guide, setGuide] = useState(30);
  const [enhance, setEnhance] = useState(false);
  const [list, setList] = useState<Prev[]>([]);
  const [shift, setShift] = useState(0);
  const presets = Array.from({ length: 4 }, (_, i) => DESIGN_PRESETS[(shift + i) % DESIGN_PRESETS.length]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const gen = async () => {
    setBusy("gen"); setErr("");
    try { const j = await post<{ previews: Prev[] }>("design", { desc, text: auto ? "" : text, guidance: guide / 10, enhance }); setList(j.previews); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const save = async (p: Prev, i: number) => {
    setBusy(p.id);
    try { await post("voices/save", { id: p.id, name: name.trim() || `Giọng thiết kế ${i + 1}`, desc }); await reloadVoices(true); say("Đã lưu vào Giọng của tôi"); done(); }
    catch (e) { say((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Mô tả giọng" hint={`${desc.length}/1000`} htmlFor="vd-desc"><textarea id="vd-desc" className="sp-input ta" rows={4} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Giới tính, độ tuổi, vùng miền, chất giọng, cảm xúc, tốc độ nói…" /></Field>
        <div className="sp-exs">
          {presets.map(([l, d]) => <button key={l} className="sp-tag" title={d} onClick={() => setDesc(tr(d))}>{l}</button>)}
          <button className="sp-tag" aria-label="Gợi ý khác" title="Gợi ý khác" onClick={() => setShift((x) => x + 4)}><I.Retry size={12} /></button>
        </div>
        <Toggle checked={auto} onChange={setAuto} label="Tự viết câu nghe thử" hint="Hoặc tự nhập câu bên dưới" />
        {!auto && <Field label="Câu nghe thử" hint={`${text.length} · cần 100–1000 ký tự`} htmlFor="vd-prev"><textarea id="vd-prev" className="sp-input ta" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
        <Range id="vd-guide" label="Bám sát mô tả" value={guide} onChange={setGuide} left="Sáng tạo" right="Bám sát" show={`${guide}%`} />
        <Toggle checked={enhance} onChange={setEnhance} label="Để AI viết mô tả chi tiết hơn" hint="Hợp với mô tả ngắn" />
        <Field label="Tên giọng khi lưu" htmlFor="vd-name"><input id="vd-name" className="sp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="vd. Cô gái miền Tây" /></Field>
        <div className="sp-gen"><span className="sp-muted">Eleven v3 · 3 bản để chọn · tốn credit theo câu nghe thử</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={desc.trim().length < 20 || (!auto && text.trim().length < 100) || !!busy} onClick={gen}>{busy === "gen" ? <Spin /> : <I.Sparkle size={14} />}Tạo giọng</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Bản nghe thử</div>
        {list.length ? <Previews list={list} onSave={save} busy={busy} /> : <div className="sp-empty"><OrbStage hue={32} size={96} active={busy === "gen"} /><p>Mô tả giọng bạn muốn (ít nhất 20 ký tự), rồi bấm “Tạo giọng”. ElevenLabs trả về 3 bản để bạn chọn.</p></div>}
      </div>
    </div>
  );
}

function Remix({ say, own, src, setSrc, done }: { say: (m: string) => void; own: Voice[]; src: Voice | null; setSrc: (v: Voice) => void; done: () => void }) {
  const [pick, setPick] = useState(false);
  const [desc, setDesc] = useState("");
  const [strength, setStrength] = useState(50);
  const [list, setList] = useState<Prev[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const gen = async () => {
    if (!src) return;
    setBusy("gen"); setErr("");
    try { const j = await post<{ previews: Prev[] }>("remix", { voice: src.id, desc, strength: strength / 100 }); setList(j.previews); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const save = async (p: Prev, i: number) => {
    setBusy(p.id);
    try { await post("voices/save", { id: p.id, name: `${src?.name ?? "Giọng"} remix ${i + 1}`, desc: `${src?.name}: ${desc}` }); await reloadVoices(true); say("Đã lưu vào Giọng của tôi"); done(); }
    catch (e) { say((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Giọng gốc"><VoiceChip v={src} onClick={() => setPick(true)} /></Field>
        <p className="sp-note">Remix được với giọng bạn tự tạo (thiết kế, nhân bản).</p>
        <Field label="Muốn đổi thế nào?" htmlFor="rx-p"><textarea id="rx-p" className="sp-input ta" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="vd. Trầm hơn, thêm chút khàn, nói chậm và thì thầm hơn" /></Field>
        <div className="sp-exs">{REMIX_IDEAS.map((x) => <button key={x} className="sp-tag" onClick={() => setDesc((p) => (p ? p + ", " : "") + tr(x).toLowerCase())}>{x}</button>)}</div>
        <Range id="rx-s" label="Mức thay đổi" value={strength} onChange={setStrength} left="Nhẹ" right="Mạnh" show={`${strength}%`} />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!src || desc.trim().length < 5 || !!busy} onClick={gen}>{busy === "gen" ? <Spin /> : <I.Swap size={14} />}Remix</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Bản nghe thử</div>
        {list.length ? <Previews list={list} onSave={save} busy={busy} /> : <div className="sp-empty"><OrbStage hue={src ? hueOf(src.id) : 200} size={96} active={busy === "gen"} /><p>Chọn giọng gốc, mô tả thay đổi rồi bấm “Remix”.</p></div>}
      </div>
      {pick && <PickOwn own={own} value={src?.id} onPick={setSrc} onClose={() => setPick(false)} />}
    </div>
  );
}
function PickOwn({ own, value, onPick, onClose }: { own: Voice[]; value?: string; onPick: (v: Voice) => void; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Chọn giọng gốc" style={{ maxWidth: 420, padding: 16 }}>
        <div className="sp-card-h">Giọng bạn đã tạo</div>
        {own.map((v) => <button key={v.id} className={`sp-vrow ${value === v.id ? "is-sel" : ""}`} style={{ width: "100%" }} onClick={() => { onPick(v); onClose(); }}><VoiceAvatar v={v} size={28} /><div className="sp-vmeta"><b data-notr>{v.name}</b><span>{voiceLine(v)}</span></div></button>)}
      </div>
    </div>
  );
}

const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${Math.round(s % 60)} giây` : ""}` : `${Math.round(s)} giây`);
// Độ dài mẫu ước lượng ngay trên trình duyệt (đọc metadata của tệp âm thanh).
const durOf = (f: File) => new Promise<number>((ok) => { const a = new Audio(); const u = URL.createObjectURL(f); a.preload = "metadata"; a.onloadedmetadata = () => { ok(Number.isFinite(a.duration) ? a.duration : 0); URL.revokeObjectURL(u); }; a.onerror = () => { ok(0); URL.revokeObjectURL(u); }; a.src = u; });
function useSamples() {
  const [samples, setSamples] = useState<{ f: File; sec: number }[]>([]);
  const add = async (fl: File[]) => { const out = await Promise.all(fl.map(async (f) => ({ f, sec: await durOf(f) }))); setSamples((s) => [...s, ...out]); };
  return [samples, add, setSamples] as const;
}
// Đoạn văn để đọc to khi ghi âm mẫu (như ElevenLabs): AI viết đoạn mới, đọc xong một đoạn thì tự đổi sang đoạn khác cho lần ghi tiếp theo.
function ScriptRecorder({ say, onDone, max = 180 }: { say: (m: string) => void; onDone: (f: File) => void; max?: number }) {
  const [lang, setLang] = useState<"vi" | "en">(getLang() === "en" ? "en" : "vi");
  const [s, setS] = useState<{ text: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  const load = async (avoid = "") => {
    setBusy(true);
    try { setS(await post<{ text: string; source: string }>("script", { lang, avoid })); } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sp-script">
      <div className="sp-script-h">
        <b><I.Mic size={14} />Đọc to đoạn này khi ghi âm</b>
        <Seg small label="Ngôn ngữ đoạn văn" value={lang} onChange={setLang} items={[{ k: "vi", label: "Tiếng Việt" }, { k: "en", label: "Tiếng Anh" }]} />
        <button className="sp-link" disabled={busy} onClick={() => void load(s?.text ?? "")}><I.Retry size={12} />Đoạn khác</button>
      </div>
      <p className={`sp-script-t ${busy ? "busy" : ""}`} data-notr>{s?.text ?? "AI đang viết đoạn văn cho bạn đọc…"}</p>
      <div className="sp-script-f">
        <span className="sp-hint">{`Đọc tự nhiên như khi nói chuyện, nơi yên tĩnh, micro cách miệng khoảng một gang tay. Mỗi đoạn khoảng một phút${n ? ` · đã ghi ${n} đoạn` : ""}.`}</span>
        <Recorder say={say} label="Ghi âm và đọc" max={max} onDone={(f) => { onDone(f); setN((x) => x + 1); void load(s?.text ?? ""); }} />
      </div>
    </div>
  );
}

const CONSENT = "Tôi xác nhận đây là giọng của tôi hoặc tôi có quyền và sự đồng ý để nhân bản giọng này, và sẽ không dùng để lừa đảo hay mạo danh.";
function SampleList({ samples, setSamples }: { samples: { f: File; sec: number }[]; setSamples: (s: { f: File; sec: number }[]) => void }) {
  return samples.length ? <div className="sp-samples">{samples.map((x, i) => <div key={i} className="sp-doc"><I.Wave size={16} /><span className="sp-doc-n"><b data-notr>{x.f.name}</b><small>{x.sec ? fmtSec(x.sec) : "—"}</small></span><button className="icon-btn" aria-label="Bỏ mẫu" onClick={() => setSamples(samples.filter((_, j) => j !== i))}><I.X size={14} /></button></div>)}</div> : null;
}

function Ivc({ say, done }: { say: (m: string) => void; done: () => void }) {
  const [samples, add, setSamples] = useSamples();
  const [denoise, setDenoise] = useState(true);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const total = samples.reduce((n, x) => n + x.sec, 0);
  const create = async () => {
    setBusy(true); setErr("");
    const fd = new FormData();
    fd.set("name", name.trim()); fd.set("denoise", String(denoise));
    for (const s of samples) fd.append("files", s.f, s.f.name);
    try { await postForm("ivc", fd); await reloadVoices(true); say(`Đã tạo giọng “${name.trim()}”`); done(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="sp-clone">
        <div className="sp-card sp-clone-l">
          <Drop title="Tải tệp âm thanh mẫu lên" sub="Tối đa 10 MB mỗi tệp · tối đa 25 tệp · một người nói, ít tạp âm" accept="audio/*,video/*" multiple max={10 * 1024 * 1024} say={say} onFile={add} />
          <div className="sp-or"><span>hoặc ghi âm trực tiếp</span></div>
          <ScriptRecorder say={say} max={180} onDone={(f) => void add([f])} />
          <SampleList samples={samples} setSamples={setSamples} />
        </div>
        <div className="sp-card sp-clone-r">
          <OrbStage hue={185} progress={total / 180} min="10 giây" best="3 phút" active={samples.length > 0} />
          <p className="sp-muted" style={{ textAlign: "center" }}>{total ? `Đã có ${fmtSec(total)} mẫu · ` : ""}Để giọng giống nhất, hãy cung cấp khoảng 3 phút âm thanh rõ.</p>
        </div>
      </div>
      <div className="sp-card">
        <div className="sp-two flat">
          <Field label="Tên giọng" htmlFor="vc-name"><input id="vc-name" className="sp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="vd. Giọng của tôi" /></Field>
          <Toggle checked={denoise} onChange={setDenoise} label="Lọc tạp âm nền trong mẫu" hint="Nên bật nếu thu ở nơi ồn" />
        </div>
        <label className="sp-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{CONSENT}</span></label>
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!samples.length || !name.trim() || !consent || busy} onClick={create}>{busy ? <Spin /> : <I.VoicePlus size={14} />}Tạo giọng</button></div>
        <ErrBox msg={err} />
      </div>
    </>
  );
}

// Nhân bản chuyên sâu: tạo giọng → tải mẫu → đọc câu xác minh → huấn luyện (vài giờ ở ElevenLabs).
function Pvc({ say, done }: { say: (m: string) => void; done: () => void }) {
  const [samples, add, setSamples] = useSamples();
  const [name, setName] = useState("");
  const [lang, setLang] = useState("vi");
  const [denoise, setDenoise] = useState(true);
  const [consent, setConsent] = useState(false);
  const [voice, setVoiceId] = useState("");
  const [step, setStep] = useState(0);
  const [captcha, setCaptcha] = useState<{ text?: string; image?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const total = samples.reduce((n, x) => n + x.sec, 0);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const upload = () => act(async () => {
    let id = voice;
    if (!id) { id = (await post<{ voiceId: string }>("pvc/create", { name: name.trim(), lang })).voiceId; setVoiceId(id); }
    const fd = new FormData(); fd.set("voice", id); fd.set("denoise", String(denoise));
    for (const s of samples) fd.append("files", s.f, s.f.name);
    await postForm("pvc/samples", fd);
    setCaptcha(await api<{ text?: string; image?: string }>(`pvc?voice=${encodeURIComponent(id)}`));
    setStep(1);
  });
  const verify = (f: File) => act(async () => { const fd = new FormData(); fd.set("voice", voice); fd.set("recording", f, f.name); await postForm("pvc/verify", fd); setStep(2); });
  const train = () => act(async () => { const fd = new FormData(); fd.set("voice", voice); await postForm("pvc/train", fd); await reloadVoices(true); say("Đã bắt đầu huấn luyện. ElevenLabs cần vài giờ, giọng sẽ dùng được khi xong."); done(); });
  return (
    <>
      <div className="sp-clone">
        <div className="sp-card sp-clone-l">
          <Drop title="Tải tệp âm thanh mẫu lên" sub="Một người nói, ít tạp âm · tối đa 40 MB mỗi lần tải" accept="audio/*,video/*" multiple say={say} onFile={add} />
          {step === 0 && <><div className="sp-or"><span>hoặc ghi âm trực tiếp</span></div><ScriptRecorder say={say} max={600} onDone={(f) => void add([f])} /></>}
          <SampleList samples={samples} setSamples={setSamples} />
        </div>
        <div className="sp-card sp-clone-r">
          <OrbStage hue={322} progress={total / 7200} min="10 phút" best="2 giờ" active={samples.length > 0} />
          <p className="sp-muted" style={{ textAlign: "center" }}>{total ? `Đã có ${fmtSec(total)} mẫu · ` : ""}Tốt nhất với 30 phút đến 2 giờ âm thanh.</p>
        </div>
      </div>
      <div className="sp-card">
        <div className="sp-two flat">
          <Field label="Tên giọng" htmlFor="pvc-name"><input id="pvc-name" className="sp-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!!voice} /></Field>
          <Select id="pvc-lang" label="Ngôn ngữ" value={lang} options={LANGS.filter(([c]) => c)} onChange={setLang} />
        </div>
        <Toggle checked={denoise} onChange={setDenoise} label="Lọc tạp âm nền trong mẫu" />
        <ol className="sp-steps row">
          {[["Tải mẫu giọng", "30 phút – 3 giờ"], ["Xác minh giọng", "Đọc to câu ElevenLabs đưa ra"], ["Huấn luyện", "Khoảng 2–4 giờ"]].map(([t, d], i) => (
            <li key={t} className={step > i ? "done" : step === i ? "cur" : ""}><span className="sp-stepn">{step > i ? <I.Check size={13} /> : i + 1}</span><div><b>{t}</b><span>{d}</span></div></li>
          ))}
        </ol>
        {step === 1 && captcha && <div className="sp-verify">{captcha.image ? <img src={captcha.image} alt="Câu xác minh" /> : <p data-notr>“{captcha.text}”</p>}<Recorder say={say} label="Ghi âm câu xác minh" max={60} onDone={(f) => void verify(f)} /></div>}
        {step === 0 && <label className="sp-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{CONSENT}</span></label>}
        <div className="sp-gen">
          {step === 0 && <button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!samples.length || !name.trim() || !consent || busy} onClick={upload}>{busy ? <Spin /> : <I.Upload size={14} />}Tải mẫu và tiếp tục</button>}
          {step === 2 && <button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={busy} onClick={train}>{busy ? <Spin /> : <I.Sparkle size={14} />}Bắt đầu huấn luyện</button>}
        </div>
        <ErrBox msg={err} />
      </div>
    </>
  );
}
