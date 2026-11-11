"use client";
// Phần artifact hiện ngay trong tin nhắn: thẻ artifact, tệp code đã tạo. Nằm riêng để trang chat tải đầu không phải kéo theo khung xem artifact và trang Artifacts (artifactui.tsx, tải khi mở).
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { isDeck } from "./artdoc";
import type { OutFile } from "./llm";
import { FILE_KIND as KIND, fileKind, fmtSize } from "./fileicon";
import { imgVerdict } from "./outimg";
import { ART_LABEL, type ArtBlock, type ArtType } from "./artifacts";

// ---------------------------------------------------------------- biểu tượng theo loại
export function ArtIcon({ type, size = 18 }: { type: ArtType; size?: number }) {
  if (type === "react") return <I.AppWindow size={size} />;
  if (type === "html") return <I.Globe size={size} />;
  if (type === "svg") return <I.Image size={size} />;
  if (type === "markdown") return <I.FileText size={size} />;
  if (type === "mermaid" || type === "d2") return <I.Flow size={size} />;
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
  await fetch("/api/artifacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conv, items: list }) })
    // Hết dung lượng thì artifact vẫn ở trong đoạn chat nhưng không vào trang Artifacts: phải nói cho người dùng biết.
    .then(async (r) => { if ((r.status === 413 || r.status === 507) && typeof window !== "undefined") { const j = await r.json().catch(() => null); if (j?.error) window.dispatchEvent(new CustomEvent("synchro:notice", { detail: j.error })); } }).catch(() => {});
}

// ---------------------------------------------------------------- tệp code đã tạo (run_code → outputs/)
// Bấm thẻ để xem trước trong khung bên cạnh; nút mũi tên tải thẳng về máy.
// Video MP4 / WebM phát ngay trong tin nhắn như ảnh (chỉ tải phần đầu để lấy khung đầu và thời lượng).
// Ảnh trong tin nhắn: giữ chỗ đúng tỉ lệ (không xô đẩy tin nhắn lúc ảnh về) bằng nền trung tính theo giao diện. Nền trắng chỉ sau khi ảnh đã tải, để PNG trong suốt vẫn đọc được;
// trước đó, trên giao diện tối, nền trắng hiện thành một khung trắng chói vài giây. Tệp hết hạn thì nói rõ, không để biểu tượng ảnh hỏng.
// Thẻ <img> lỗi không cho biết vì sao: mạng chập chờn, máy chủ đang khởi động lại (502), hết phiên đăng nhập cũng rơi vào đây. Hỏi lại máy chủ, chỉ 404 mới nói hết hạn; còn lại tự thử lại rồi để nút Thử lại.
const OUT_IMG_H = 360;
function OutImage({ f, onOpen }: { f: OutFile; onOpen?: (f: OutFile) => void }) {
  const [state, setState] = useState<"wait" | "ok" | "gone" | "fail">("wait");
  const [tries, setTries] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  const again = () => { setState("wait"); setTries((t) => t + 1); };
  const failed = () => {
    void fetch(`/api/outputs/${f.id}?inline=1`, { method: "HEAD", cache: "no-store" }).then((r) => r.status, () => null).then((status) => {
      if (!alive.current) return;
      const v = imgVerdict(status, tries);
      if (v === "retry") timer.current = setTimeout(again, 2000 * (tries + 1)); else setState(v);
    });
  };
  const ratio = f.w && f.h ? f.w / f.h : 0;
  const box = ratio ? { width: `min(100%, ${Math.round(Math.min(f.w!, OUT_IMG_H * ratio))}px)` } : undefined;
  if (state === "gone") return <div className="out-img-gone" role="status"><I.Image size={18} /><span>{tr("Không tải được ảnh. Tệp có thể đã hết hạn (tự xóa sau 30 ngày).")}</span></div>;
  if (state === "fail") return <div className="out-img-gone" role="status"><I.Image size={18} /><span>{tr("Chưa tải được ảnh. Có thể do mạng hoặc máy chủ đang khởi động lại.")}</span><button className="btn sm" onClick={again}>{tr("Thử lại")}</button>{onOpen && <button className="btn sm" onClick={() => onOpen(f)}>{tr("Mở")}</button>}</div>;
  return (
    <button onClick={() => onOpen?.(f)} aria-label={f.name} style={box} className={state === "wait" ? "out-img-wait" : undefined}>
      <img src={`/api/outputs/${f.id}?inline=1${tries ? `&r=${tries}` : ""}`} alt={f.name} loading="lazy" data-ready={state === "ok" ? "" : undefined} style={ratio ? { width: "100%", aspectRatio: `${f.w} / ${f.h}` } : undefined}
        ref={(el) => { if (el?.complete && el.naturalWidth > 0 && state === "wait") setState("ok"); }} onLoad={() => setState("ok")} onError={failed} />
    </button>
  );
}

export function OutputFiles({ files: all, onOpen, active }: { files: OutFile[]; onOpen?: (f: OutFile) => void; active?: string }) {
  const files = all.filter((f) => !f.skipped), missed = all.filter((f) => f.skipped);
  const imgs = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.mime));
  const vids = files.filter((f) => /^video\/(mp4|webm|quicktime)$/.test(f.mime));
  return (
    <div className="outs">
      {imgs.length > 0 && <div className="outs-imgs">{imgs.map((f) => <OutImage key={f.id} f={f} onOpen={onOpen} />)}</div>}
      {vids.length > 0 && <div className="outs-imgs outs-vids">{vids.map((f) => <video key={f.id} controls playsInline preload="metadata" src={`/api/outputs/${f.id}?inline=1`} aria-label={f.name} />)}</div>}
      {missed.map((f) => {
        const k = fileKind(f.name);
        return (
          <div key={f.id} className="out-card out-missed" role="status">
            <span className="out-badge" style={{ background: k.color }}>{k.label}</span>
            <span className="out-txt"><b data-notr>{f.name}</b><span>{tr("Chưa giao được: vượt giới hạn dung lượng hoặc số tệp")}{f.size ? ` · ${fmtSize(f.size)}` : ""}</span></span>
          </div>
        );
      })}
      {files.map((f) => {
        const k = fileKind(f.name);
        return (
          <div key={f.id} className={`out-card ${active === f.id ? "on" : ""}`} onClick={() => onOpen?.(f)} title={tr("Xem trước")}>
            <span className="out-badge" style={{ background: k.color }}>{k.label}</span>
            <span className="out-txt"><b data-notr><button type="button" className="art-tile-open">{f.name}</button></b><span>{tr(KIND[k.ext] ?? "Tệp")} · {fmtSize(f.size)}</span></span>
            <a className="out-dl" href={`/api/outputs/${f.id}`} download={f.name} onClick={(e) => e.stopPropagation()} aria-label={tr("Tải về")} data-tip="Tải về"><I.Download size={15} /></a>
          </div>
        );
      })}
    </div>
  );
}
