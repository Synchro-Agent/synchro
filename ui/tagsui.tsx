"use client";
// Giao diện thẻ (tag) của đoạn chat: khung chọn / tạo thẻ trong menu ⋮ của thanh bên và menu tiêu đề, chip thẻ ở đầu trang chat,
// hàng lọc theo thẻ ở thanh bên. Dữ liệu: ui/chattags.ts.
import { useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { hasTag, normTag, TAG_MAX, tagKey, toggleTag } from "./chattags";

/** Khung "Gắn thẻ" trong menu: ô tìm / tạo thẻ, danh sách thẻ đang dùng có dấu chọn. Enter: bật / tắt thẻ đang gõ (tạo mới nếu chưa có). */
export function TagPicker({ tags, all, onChange, onBack }: { tags: string[]; all: { tag: string; n: number }[]; onChange: (tags: string[]) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const t = normTag(q);
  const names = all.map((x) => x.tag);
  // Thẻ của đoạn chat này luôn có trong danh sách (kể cả khi chưa đoạn chat nào khác dùng).
  const list = [...all, ...tags.filter((x) => !all.some((a) => tagKey(a.tag) === tagKey(x))).map((tag) => ({ tag, n: 1 }))];
  const shown = list.filter((x) => !t || tagKey(x.tag).includes(tagKey(t)));
  const exists = list.some((x) => tagKey(x.tag) === tagKey(t));
  const full = tags.length >= TAG_MAX;
  const flip = (x: string) => { if (!hasTag(tags, x) && full) return; onChange(toggleTag(tags, x, names)); };
  return (
    <div className="tag-pick">
      <div className="tag-pick-h">
        <button type="button" className="icon-btn" onClick={onBack} aria-label={tr("Quay lại")}><I.Icon name="ChevronL" size={15} /></button>
        <b>{tr("Gắn thẻ")}</b>
      </div>
      {/* cm-find: mũi tên xuống từ ô tìm đi vào danh sách thẻ (ui/a11y.ts), cùng kiểu ô tìm của menu +. */}
      <div className="cm-find"><I.Search size={14} /><input autoFocus value={q} maxLength={40} placeholder={tr("Tìm hoặc tạo thẻ…")} aria-label={tr("Tìm hoặc tạo thẻ")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (t) { flip(exists ? list.find((x) => tagKey(x.tag) === tagKey(t))!.tag : t); setQ(""); } }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (q) setQ(""); else onBack(); }
        }} /></div>
      <div className="tag-list" role="group" aria-label={tr("Thẻ")}>
        {t && !exists && <button type="button" className="menu-item" disabled={full} onClick={() => { flip(t); setQ(""); }}><I.Plus size={16} /><span>{tr("Tạo thẻ")} <b data-notr>{t}</b></span></button>}
        {shown.map((x) => {
          const on = hasTag(tags, x.tag);
          return (
            <button type="button" key={tagKey(x.tag)} className="menu-item" role="menuitemcheckbox" aria-checked={on} disabled={!on && full} onClick={() => flip(x.tag)}>
              <I.Icon name="Tag" size={16} /><span className="tag-nm" data-notr>{x.tag}</span><span className="tag-cnt">{x.n}</span><span className="ck">{on && <I.Check size={16} />}</span>
            </button>
          );
        })}
        {!list.length && !t && <p className="tag-empty">{tr("Chưa có thẻ nào. Gõ tên rồi nhấn Enter để tạo.")}</p>}
        {full && <p className="tag-empty">{tr("Mỗi đoạn chat có tối đa 8 thẻ.")}</p>}
      </div>
    </div>
  );
}

/** Chip thẻ ở đầu trang chat: bấm để lọc thanh bên theo thẻ đó. Màn hình hẹp: một chip gọn (biểu tượng thẻ + số thẻ) mở khung Gắn thẻ. */
export function TagChips({ tags, onPick, onOpen, max = 3 }: { tags: string[]; onPick: (t: string) => void; onOpen: () => void; max?: number }) {
  if (!tags.length) return null;
  const more = tags.length - max;
  return (
    <div className="tb-tags" role="list" aria-label={tr("Thẻ")}>
      <button type="button" role="listitem" className="tag-chip compact" onClick={onOpen} aria-label={`${tr("Thẻ")}: ${tags.join(", ")}`} title={tags.map((t) => `#${t}`).join(" ")}><I.Icon name="Tag" size={13} /><span>{tags.length}</span></button>
      {tags.slice(0, max).map((t) => <button type="button" role="listitem" key={tagKey(t)} className="tag-chip full" onClick={() => onPick(t)} title={`${tr("Lọc đoạn chat có thẻ")} #${t}`}><span aria-hidden>#</span><span data-notr>{t}</span></button>)}
      {more > 0 && <span className="tag-chip full more" title={tags.slice(max).map((t) => `#${t}`).join(" ")} data-notr>+{more}</span>}
    </div>
  );
}

/** Hàng lọc theo thẻ ở thanh bên: "Tất cả" và từng thẻ (số đoạn chat). */
export function TagFilter({ all, cur, onPick }: { all: { tag: string; n: number }[]; cur: string | null; onPick: (t: string | null) => void }) {
  if (!all.length) return null;
  return (
    <div className="tag-filter" role="toolbar" aria-label={tr("Lọc theo thẻ")}>
      <button type="button" className={`tag-chip ${cur === null ? "on" : ""}`} aria-pressed={cur === null} onClick={() => onPick(null)}>{tr("Tất cả")}</button>
      {all.map((x) => {
        const on = cur !== null && tagKey(cur) === tagKey(x.tag);
        return <button type="button" key={tagKey(x.tag)} className={`tag-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onPick(on ? null : x.tag)}><span aria-hidden>#</span><span data-notr>{x.tag}</span><em>{x.n}</em></button>;
      })}
    </div>
  );
}
