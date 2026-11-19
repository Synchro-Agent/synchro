"use client";
// Hội đồng phản biện trong khung artifact: nhãn trạng thái ở đầu khung và ghi chú ngay dưới các dòng có vấn đề (chế độ Mã).
import { useState } from "react";
import * as I from "./icons";
import { tr, trc } from "./i18n";
import { SEV_LABEL, type CriticEntry, type Finding } from "../shared/critic";
import { modelName } from "./models";

// Tên model như ở bộ chọn model ("Claude Sonnet 5.5"), không phải mã ("sub-claude/sonnet" → "sonnet").
const short = (key: string) => modelName(key);

export function CriticPill({ entry, findings, can, onRun, onShow }: { entry?: CriticEntry; findings: Finding[]; can: boolean; onRun: () => void; onShow: () => void }) {
  if (!entry) return can ? <button className="icon-btn" onClick={onRun} aria-label={tr("Phản biện")} data-tip={tr("Nhờ hội đồng phản biện đọc lại")}><I.Shield size={15} /></button> : null;
  const names = entry.by.map(short).join(", ");
  if (entry.status === "run") return <span className="cr-pill run" role="status"><span className="art-spin sm" />{tr("Đang phản biện")}</span>;
  if (entry.status === "error") return <button className="cr-pill err" onClick={onRun} data-tip={entry.error}><I.Alert size={13} />{tr("Phản biện lỗi, thử lại")}</button>;
  if (!findings.length) return <span className="cr-pill ok" data-tip={`${tr("Hội đồng phản biện không thấy lỗi")}${names ? ` (${names})` : ""}`}><I.ShieldCheck size={14} />{tr("Ổn")}</span>;
  return (
    <button className={`cr-pill has ${findings[0].severity}`} onClick={onShow} data-tip={`${tr("Hội đồng phản biện")}${names ? ` (${names})` : ""}`}>
      <I.Shield size={14} /><span data-notr>{findings.length}</span>{tr("vấn đề")}
    </button>
  );
}

export function CriticNote({ f, canFix, onFix, onSkip }: { f: Finding; canFix: boolean; onFix: () => void; onSkip: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`cr-note ${f.severity}`} role="note">
      <div className="cr-h">
        <em>{trc(SEV_LABEL[f.severity], "mức phản biện")}</em><b>{f.title}</b>
        {f.by?.length ? <span className="cr-by" data-notr>{f.by.map(short).join(" · ")}</span> : null}
      </div>
      {f.detail && <p>{f.detail}</p>}
      {show && f.suggested_fix && <pre className="cr-fix">{f.suggested_fix}</pre>}
      <div className="cr-acts">
        {canFix && <button className="btn dark" onClick={onFix}>{tr("Áp dụng sửa")}</button>}
        {f.suggested_fix && <button className="lnk" onClick={() => setShow(!show)}>{show ? tr("Ẩn bản sửa") : tr("Xem bản sửa")}</button>}
        <button className="lnk" onClick={onSkip}>{tr("Bỏ qua")}</button>
      </div>
    </div>
  );
}
