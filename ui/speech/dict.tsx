"use client";
// Từ điển phát âm (ElevenLabs Pronunciation Dictionaries): mỗi quy tắc “gặp từ này thì đọc thế này” (đọc thay bằng chữ khác, hoặc phiên âm IPA),
// bật trong Đọc văn bản để AI đọc đúng tên riêng, thương hiệu, từ viết tắt.
import { useEffect, useState } from "react";
import * as I from "../icons";
import { useApp, usePref } from "../store";
import { tr } from "../../app/i18n";
import { api, post, reloadDicts, setDicts, useDicts, type Dict, type Item, type Rule } from "./client";
import { ErrBox, Field, Player, Spin } from "./parts";
import { Head, Wide } from "./shell";
import type { ToolProps } from "./view";

type Row = Rule & { key: number };
type DictSel = { id: string; version: string; name: string };
const EXAMPLES: [string, string][] = [["AI", "ây ai"], ["Synchro", "xin-crô"], ["TP.HCM", "thành phố Hồ Chí Minh"], ["kg", "ki lô gam"], ["ElevenLabs", "e-le-vần-láp"], ["CEO", "xi i âu"]];
let seq = 1;
const row = (r?: Partial<Rule>): Row => ({ key: seq++, word: "", type: "alias", say: "", alphabet: "ipa", cs: false, ...r });

export function DictTool({ say, voice }: ToolProps) {
  const app = useApp();
  const list = useDicts(true);
  const [sel, setSel] = usePref<DictSel[]>("spDicts", []);
  const [edit, setEdit] = useState<{ id: string | null; name: string; desc: string; rows: Row[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [test, setTest] = useState<Item | null>(null);
  useEffect(() => { if (list && !list.length && !edit) setEdit({ id: null, name: "", desc: "", rows: [row(), row()] }); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (d: Dict) => {
    setBusy(d.id); setErr(""); setTest(null);
    try { const j = await api<{ dict: Dict }>(`dicts?id=${encodeURIComponent(d.id)}`); setEdit({ id: d.id, name: d.name, desc: d.desc, rows: (j.dict.rules ?? []).map((r) => row(r)).concat(row()) }); }
    catch (e) { say((e as Error).message); } finally { setBusy(""); }
  };
  const rules = () => (edit?.rows ?? []).filter((r) => r.word.trim() && r.say.trim()).map(({ word, type, say: s, alphabet, cs }) => ({ word: word.trim(), type, say: s.trim(), alphabet, cs }));
  const save = async () => {
    if (!edit) return;
    setBusy("save"); setErr("");
    try {
      if (edit.id) {
        const j = await post<{ dict: Dict }>("dicts/rules", { id: edit.id, rules: rules() });
        setDicts((l) => l.map((x) => (x.id === edit.id ? { ...x, version: j.dict.version, count: j.dict.count } : x)));
        setSel(sel.map((s) => (s.id === edit.id ? { ...s, version: j.dict.version } : s)));
        say("Đã lưu quy tắc");
      } else {
        const j = await post<{ dict: Dict }>("dicts", { name: edit.name.trim(), desc: edit.desc.trim(), rules: rules() });
        setDicts((l) => [{ ...j.dict, createdAt: Date.now() }, ...l]);
        if (sel.length < 3) setSel([...sel, { id: j.dict.id, version: j.dict.version, name: j.dict.name }]);
        setEdit({ ...edit, id: j.dict.id });
        say("Đã tạo từ điển và bật trong Đọc văn bản");
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const archive = (d: Dict) => app.confirm("Lưu trữ từ điển?", tr(`Lưu trữ từ điển “${d.name}”? Từ điển sẽ không còn dùng được khi đọc.`), "Lưu trữ", async () => {
    try { await post("dicts/archive", { id: d.id }); setDicts((l) => l.filter((x) => x.id !== d.id)); setSel(sel.filter((s) => s.id !== d.id)); if (edit?.id === d.id) setEdit(null); say("Đã lưu trữ từ điển"); }
    catch (e) { say((e as Error).message); }
  });
  const flip = (d: Dict) => {
    if (sel.some((s) => s.id === d.id)) setSel(sel.filter((s) => s.id !== d.id));
    else if (sel.length >= 3) say("Đọc văn bản dùng tối đa 3 từ điển cùng lúc");
    else setSel([...sel, { id: d.id, version: d.version, name: d.name }]);
  };
  // Nghe thử: đọc các từ trong từ điển bằng giọng đang chọn, có áp từ điển (tốn credit như Đọc văn bản).
  const listen = async () => {
    if (!edit?.id) return;
    const d = list?.find((x) => x.id === edit.id);
    if (!d) return;
    setBusy("test"); setErr("");
    try { const j = await post<{ item: Item }>("tts", { text: `Đọc thử: ${rules().map((r) => r.word).join(", ")}.`, voice: voice?.id, voiceName: voice?.name, dicts: [{ id: d.id, version: d.version }] }); setTest(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const setRow = (k: number, p: Partial<Row>) => setEdit((e) => (e ? { ...e, rows: e.rows.map((r) => (r.key === k ? { ...r, ...p } : r)) } : e));

  return (
    <Wide>
      <Head tool="dict"><button className="btn dark sp-go" onClick={() => { setEdit({ id: null, name: "", desc: "", rows: [row(), row()] }); setTest(null); setErr(""); }}><I.Plus size={14} />Tạo từ điển</button></Head>
      <div className="sp-two dict">
        <div className="sp-card">
          <div className="sp-card-h">Từ điển của bạn<button className="icon-btn" aria-label="Tải lại" title="Tải lại" onClick={() => void reloadDicts()}><I.Retry size={14} /></button></div>
          {list === null && <div className="sp-empty"><Spin /></div>}
          {list?.length === 0 && <div className="sp-empty">Chưa có từ điển nào. Tạo từ điển đầu tiên ở bên cạnh.</div>}
          {list?.map((d) => {
            const onIt = sel.some((s) => s.id === d.id);
            return (
              <div key={d.id} className={`sp-dict ${edit?.id === d.id ? "on" : ""}`}>
                <button className="sp-dict-t" onClick={() => open(d)}><I.Book size={16} /><span><b data-notr>{d.name}</b><small>{d.count} quy tắc{d.desc ? ` · ${d.desc}` : ""}</small></span>{busy === d.id && <Spin />}</button>
                <div className="sp-dict-a">
                  <label className="sp-check sm"><input type="checkbox" checked={onIt} onChange={() => flip(d)} /><span>Dùng khi đọc</span></label>
                  <button className="icon-btn" aria-label={`Lưu trữ ${d.name}`} title="Lưu trữ" onClick={() => archive(d)}><I.Trash size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
        {edit ? (
          <div className="sp-card">
            <div className="sp-card-h">{edit.id ? <span data-notr>{edit.name}</span> : "Từ điển mới"}</div>
            {!edit.id && (
              <>
                <Field label="Tên từ điển" htmlFor="dc-n"><input id="dc-n" className="sp-input" value={edit.name} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ví dụ: Tên sản phẩm công ty" /></Field>
                <Field label="Mô tả" hint="Không bắt buộc" htmlFor="dc-d"><input id="dc-d" className="sp-input" value={edit.desc} maxLength={500} onChange={(e) => setEdit({ ...edit, desc: e.target.value })} /></Field>
              </>
            )}
            <div className="sp-rules">
              <div className="sp-rule head"><span>Từ trong văn bản</span><span>Kiểu</span><span>Đọc là</span><span /></div>
              {edit.rows.map((r) => (
                <div key={r.key} className="sp-rule">
                  <input className="sp-input" value={r.word} maxLength={100} aria-label="Từ trong văn bản" placeholder="AI" onChange={(e) => setRow(r.key, { word: e.target.value })} />
                  <span className="sp-sel sm"><select aria-label="Kiểu quy tắc" value={r.type} onChange={(e) => setRow(r.key, { type: e.target.value as Rule["type"] })}><option value="alias">Đọc thay bằng</option><option value="phoneme">Phiên âm IPA</option></select><I.Chevron size={12} /></span>
                  <input className="sp-input" value={r.say} maxLength={200} aria-label="Đọc là" placeholder={r.type === "alias" ? "ây ai" : "/eɪ aɪ/"} onChange={(e) => setRow(r.key, { say: e.target.value })} />
                  <button className="icon-btn" aria-label="Xóa quy tắc" onClick={() => setEdit({ ...edit, rows: edit.rows.filter((x) => x.key !== r.key) })}><I.X size={14} /></button>
                </div>
              ))}
              <button className="sp-add" onClick={() => setEdit({ ...edit, rows: [...edit.rows, row()] })}><I.Plus size={14} />Thêm quy tắc</button>
            </div>
            <div className="sp-chips"><span className="sp-chips-l">Ví dụ</span>{EXAMPLES.map(([w, s]) => <button key={w} className="sp-tag" data-notr onClick={() => setEdit({ ...edit, rows: [...edit.rows.filter((x) => x.word.trim() || x.say.trim()), row({ word: w, say: s }), row()] })}>{w} → {s}</button>)}</div>
            <p className="sp-hint">“Đọc thay bằng” chạy với mọi model. Phiên âm IPA chính xác hơn nhưng chỉ một số model tiếng Anh (Flash v2, Turbo v2, English v1) hỗ trợ.</p>
            <div className="sp-gen">
              {edit.id && <button className="btn" disabled={!!busy || !rules().length || !voice} onClick={listen}>{busy === "test" ? <Spin /> : <I.Speaker size={14} />}Nghe thử</button>}
              <button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!!busy || !rules().length || (!edit.id && !edit.name.trim())} onClick={save}>{busy === "save" ? <Spin /> : <I.Check size={14} />}{edit.id ? "Lưu quy tắc" : "Tạo từ điển"}</button>
            </div>
            <ErrBox msg={err} />
            {test && <Player title="Nghe thử với từ điển" label={test.title} src={test.url} dl={test.url} />}
          </div>
        ) : (
          <div className="sp-card sp-detect"><span className="sp-tic big"><I.Book size={24} /></span><b>Chọn một từ điển để sửa quy tắc</b><p>Hoặc bấm “Tạo từ điển” để bắt đầu.</p></div>
        )}
      </div>
    </Wide>
  );
}
