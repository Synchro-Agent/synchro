"use client";
import { useFileStatus, retryFile, hasBlob } from "./filestate";
import { tr } from "./i18n";
import * as I from "./icons";

const MAP: Record<string, string[]> = {
  txt: ["txt", "rtf", "log"], doc: ["doc", "docx", "odt", "pages"], pdf: ["pdf"], md: ["md"], mdx: ["mdx"],
  xls: ["xls", "xlsx", "ods", "numbers"], csv: ["csv", "tsv"], zip: ["zip", "rar", "7z"], tar: ["tar", "gz", "tgz", "bz2"],
  ppt: ["ppt", "key", "odp"], pptx: ["pptx"], json: ["json", "jsonl"], css: ["css", "scss", "sass", "less"],
  code: ["js", "jsx", "ts", "tsx", "py", "html", "htm", "java", "c", "cpp", "h", "cs", "go", "rs", "sh", "php", "rb", "swift", "kt", "sql", "yml", "yaml", "xml", "vue", "lua", "r", "ipynb"],
  png: ["png"], jpg: ["jpg", "jpeg"], img: ["gif", "webp", "svg", "heic", "bmp", "tiff", "avif", "ico"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "m4v", "mp3", "wav", "m4a"],
};
const COLOR: Record<string, string> = {
  txt: "#6b7280", doc: "#3b7cf6", pdf: "#ef4444", md: "#555a63", mdx: "#555a63", xls: "#2f9e6e", csv: "#2a7a6f", zip: "#a855f7", tar: "#c98a0a",
  ppt: "#f97316", pptx: "#f97316", json: "#e5b010", css: "#2f5ff5", code: "#ea580c", png: "#555a63", jpg: "#2f8a3e", img: "#ec4899", video: "#2f8a3e",
};

// Tên loại tệp và cỡ tệp hiện trên thẻ tệp và khung xem trước.
export const FILE_KIND: Record<string, string> = { docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel", csv: "CSV", tsv: "TSV", pptx: "PowerPoint", pdf: "PDF", png: "Ảnh", jpg: "Ảnh", jpeg: "Ảnh", gif: "Ảnh", webp: "Ảnh", svg: "SVG", json: "JSON", md: "Markdown", txt: "Văn bản", html: "HTML", zip: "ZIP", mp3: "Âm thanh", wav: "Âm thanh", mp4: "Video" };
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export function fileKind(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind = Object.keys(MAP).find((k) => MAP[k].includes(ext)) ?? "txt";
  return { ext, kind, label: (ext || "tệp").toUpperCase().slice(0, 5), color: COLOR[kind] };
}

/**
 * Thẻ tệp đính kèm giống hệt Claude: ô vuông 120 px bo góc 12 px. Tệp chữ / code: tên tệp, "N dòng", nhãn đuôi tệp viền tròn ở góc dưới;
 * ảnh: cả tấm ảnh (không cắt); PDF: trang đầu kèm nhãn PDF nền đặc; thư mục: tên, số tệp, biểu tượng thư mục. Nút × hiện khi rê chuột.
 */
export function FileCard({ name, onRemove, onContextMenu, onOpen, folder, count, fid }: { name: string; onRemove?: () => void; onContextMenu?: (e: React.MouseEvent) => void; onOpen?: () => void; folder?: boolean; count?: number; fid?: string }) {
  const st = useFileStatus(name);
  const dir = folder ?? !!st?.folder;
  const n = count ?? st?.count;
  const { ext } = fileKind(name);
  // Tin nhắn cũ sau khi tải lại trang: ảnh lấy lại từ máy chủ theo mã tệp.
  const thumb = st?.thumb ?? (fid && /^(png|jpe?g|gif|webp)$/.test(ext) ? `/api/files/thumb?id=${fid}` : undefined);
  const pdf = !dir && !!thumb && !!st?.pdf;
  const img = !dir && !!thumb && !st?.pdf;
  const err = st?.state === "error";
  return (
    <div className={`ft ${img ? "ft-img" : pdf ? "ft-pdf" : "ft-doc"} ${err ? "ft-err" : ""}`} title={st?.error ?? name} onContextMenu={onContextMenu}>
      <button type="button" className="ft-card" onClick={onOpen} aria-label={name} tabIndex={onOpen ? 0 : -1}>
        {img || pdf ? <img src={thumb} alt="" draggable={false} /> : (
          <span className="ft-body">
            <span className="ft-name"><bdi data-notr>{name}</bdi></span>
            {dir ? n !== undefined && <span className="ft-sub">{n} tệp</span> : st?.state === "uploading" && st.note ? <span className="ft-sub ft-note">{tr(st.note)}</span> : st?.lines ? <span className="ft-sub">{st.lines} dòng</span> : null}
            <span className="ft-ext" data-notr>{dir ? <I.Folder size={12} /> : (ext || "file").toUpperCase().slice(0, 6)}</span>
          </span>
        )}
        {pdf && <span className="ft-tag" data-notr>PDF</span>}
        {st?.state === "uploading" && <span className="ft-prog" role="progressbar" aria-valuenow={st.pct} aria-valuetext={st.note ? tr(st.note) : undefined}><i style={{ width: st.pct + "%" }} /></span>}
        {err && <span className="ft-bad" aria-label="Lỗi">!</span>}
      </button>
      {onRemove && <button type="button" className="ft-x" onClick={onRemove} aria-label={`Xóa ${name}`}><I.X size={12} /></button>}
      {/* Lỗi hiện ngay thành chữ (tối đa 2 dòng) dưới thẻ, không bắt người dùng rê chuột mới thấy lý do; kèm nút Thử lại / Bỏ. */}
      {err && (
        <div className="ft-err-box" role="alert">
          <span className="ft-err-msg">{st?.error}</span>
          <span className="ft-err-act">
            {hasBlob(name) && <button type="button" className="ft-retry" onClick={() => retryFile(name)}>{tr("Thử lại")}</button>}
            {onRemove && <button type="button" className="ft-drop" onClick={onRemove}>{tr("Bỏ")}</button>}
          </span>
        </div>
      )}
    </div>
  );
}
