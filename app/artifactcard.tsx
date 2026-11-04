"use client";
// Phần artifact hiện ngay trong tin nhắn: thẻ artifact, tệp code đã tạo. Nằm riêng để trang chat tải đầu không phải kéo theo khung xem artifact và trang Artifacts (artifactui.tsx, tải khi mở).
import * as I from "./icons";
import { tr } from "./i18n";
import { isDeck } from "./artdoc";
import type { OutFile } from "./llm";
import { FILE_KIND as KIND, fileKind, fmtSize } from "./fileicon";
import { ART_LABEL, type ArtBlock, type ArtType } from "./artifacts";

// ---------------------------------------------------------------- biểu tượng theo loại
export function ArtIcon({ type, size = 18 }: { type: ArtType; size?: number }) {
  if (type === "react") return <I.AppWindow size={size} />;
  if (type === "html") return <I.Globe size={size} />;
  if (type === "svg") return <I.Image size={size} />;
  if (type === "markdown") return <I.FileText size={size} />;
  if (type === "mermaid") return <I.Flow size={size} />;
  if (type === "vbhc") return <I.FileDoc size={size} />;
  return <I.Code size={size} />;
}

// ---------------------------------------------------------------- thẻ trong tin nhắn
// fix: phiên bản là bản sửa (SEARCH/REPLACE) — số chỗ đã sửa, hoặc các chỗ không khớp (onRedo: nhờ model viết lại toàn bộ).
export function ArtifactCard({ art, version, total, active, onOpen, fix, onRedo }: { art: ArtBlock; version: number; total: number; active: boolean; onOpen: () => void; fix?: { applied: number; failed: string[] }; onRedo?: () => void }) {
  const bad = !!fix?.failed.length && art.complete;
  return (
    <div className="art-card-wrap">
      <button className={`art-card ${active ? "on" : ""} ${art.complete ? "" : "busy"} ${bad ? "warn" : ""}`} onClick={onOpen}>
        <span className="art-card-ic"><ArtIcon type={art.type} size={20} />{!art.complete && <span className="art-spin sm" />}</span>
        <span className="art-card-txt">
          <b>{art.title}</b>
          <span>{tr(!art.complete ? (fix ? "Đang sửa…" : "Đang tạo…") : isDeck(art) ? "Bản trình bày" : ART_LABEL[art.type])}{total > 1 && <> · {tr("Phiên bản")} {version}</>}{fix && art.complete && !bad && <> · {tr("Đã sửa")} {fix.applied} {tr("chỗ")}</>}{art.complete && !bad && <> · <em>{tr(active ? "Đang mở" : "Nhấn để mở")}</em></>}{bad && <> · <em className="art-bad">{tr("Bản sửa chưa khớp")} {fix!.failed.length} {tr("chỗ")}</em></>}</span>
        </span>
      </button>
      {bad && onRedo && <button className="lnk art-redo" onClick={onRedo}>{tr("Nhờ viết lại toàn bộ")}</button>}
    </div>
  );
}

// ---------------------------------------------------------------- lưu artifact lên máy chủ (trang Artifacts)
export async function saveArtifacts(conv: string, items: ArtBlock[]) {
  const list = items.filter((a) => a.complete).map((a) => ({ ident: a.ident, title: a.title, type: a.type, lang: a.lang, content: a.content }));
  if (!list.length) return;
  await fetch("/api/artifacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conv, items: list }) }).catch(() => {});
}

// ---------------------------------------------------------------- tệp code đã tạo (run_code → outputs/)
// Bấm thẻ để xem trước trong khung bên cạnh; nút mũi tên tải thẳng về máy.
// Video MP4 / WebM phát ngay trong tin nhắn như ảnh (chỉ tải phần đầu để lấy khung đầu và thời lượng).
export function OutputFiles({ files, onOpen, active }: { files: OutFile[]; onOpen?: (f: OutFile) => void; active?: string }) {
  const imgs = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.mime));
  const vids = files.filter((f) => /^video\/(mp4|webm|quicktime)$/.test(f.mime));
  return (
    <div className="outs">
      {imgs.length > 0 && <div className="outs-imgs">{imgs.map((f) => <button key={f.id} onClick={() => onOpen?.(f)} aria-label={f.name}><img src={`/api/outputs/${f.id}?inline=1`} alt={f.name} loading="lazy" /></button>)}</div>}
      {vids.length > 0 && <div className="outs-imgs outs-vids">{vids.map((f) => <video key={f.id} controls playsInline preload="metadata" src={`/api/outputs/${f.id}?inline=1`} aria-label={f.name} />)}</div>}
      {files.map((f) => {
        const k = fileKind(f.name);
        return (
          <div key={f.id} className={`out-card ${active === f.id ? "on" : ""}`} role="button" tabIndex={0} onClick={() => onOpen?.(f)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen?.(f); } }} title={tr("Xem trước")}>
            <span className="out-badge" style={{ background: k.color }}>{k.label}</span>
            <span className="out-txt"><b data-notr>{f.name}</b><span>{tr(KIND[k.ext] ?? "Tệp")} · {fmtSize(f.size)}</span></span>
            <a className="out-dl" href={`/api/outputs/${f.id}`} download={f.name} onClick={(e) => e.stopPropagation()} aria-label={tr("Tải về")} data-tip="Tải về"><I.Download size={15} /></a>
          </div>
        );
      })}
    </div>
  );
}
