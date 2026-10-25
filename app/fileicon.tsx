"use client";
import { useFileStatus } from "./filestate";

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

const G = "var(--fa)";
const Lines = ({ y = 24, rows = [[40, 30], [60, 24], [50, 40], [58, 26], [30]] as number[][] }) => (
  <>
    <rect x="18" y="18" width="30" height="3.5" rx="1.7" fill={G} />
    {rows.map((r, i) => r.map((w, j) => <rect key={i + "-" + j} x={18 + (j ? r[0] + 6 : 0)} y={y + 10 + i * 13} width={w} height="3.5" rx="1.7" fill={G} opacity=".7" />))}
  </>
);
const Pic = ({ play }: { play?: boolean }) => (
  <>
    <rect x="16" y="18" width="84" height="60" rx="7" fill="none" stroke={G} strokeWidth="2" />
    {play ? <path d="M30 30l11 7-11 7z" fill="#4c9a6a" /> : <circle cx="58" cy="38" r="9" fill="var(--fb)" />}
    <rect x="44" y={play ? 52 : 54} width="28" height="3.5" rx="1.7" fill={G} />
    <rect x="28" y={play ? 62 : 63} width="60" height="3.5" rx="1.7" fill={G} />
  </>
);
const Zip = () => (
  <>{Array.from({ length: 9 }).map((_, i) => <g key={i}><rect x="50" y={16 + i * 13} width="14" height="12" rx="3" fill={G} /><rect x="60" y={22 + i * 13} width="14" height="12" rx="3" fill={G} opacity=".6" /></g>)}</>
);
const Table = ({ head, cols = 3, rows = 5 }: { head?: boolean; cols?: number; rows?: number }) => (
  <>{Array.from({ length: rows }).map((_, r) => Array.from({ length: cols }).map((_, c) => (
    <rect key={r + "-" + c} x={18 + c * 28} y={18 + r * 19} width="24" height={r === 0 && head ? 11 : 13} rx={r === 0 && head ? 5 : 2} fill={G} opacity={r === 0 ? 1 : .6} />
  )))}</>
);

function Art({ kind }: { kind: string }) {
  switch (kind) {
    case "md": case "mdx":
      return <><text x="16" y="34" fontSize="17" fontWeight="700" fill={G}>#</text><rect x="36" y="25" width="40" height="3.5" rx="1.7" fill={G} />{[[36, 56], [30, 70], [42, 0], [26, 56], [22, 42]].map(([w], i) => <rect key={i} x="18" y={56 + i * 12} width={w + 20} height="3.5" rx="1.7" fill={G} opacity=".7" />)}</>;
    case "xls": return <Table head rows={5} />;
    case "csv": return <><Table head rows={6} /></>;
    case "zip": case "tar": return <Zip />;
    case "ppt": case "pptx": return <><Pic /><rect x="18" y="90" width="44" height="3.5" rx="1.7" fill={G} /><rect x="18" y="102" width="30" height="3.5" rx="1.7" fill={G} opacity=".7" /><rect x="68" y="90" width="20" height="3.5" rx="1.7" fill={G} opacity=".7" /></>;
    case "json": case "css":
      return <><text x="16" y="30" fontSize="12" fill={G}>{"{"}</text>{[[22, 34], [28, 14], [20, 34], [28, 20], [20, 0]].map(([x, w], i) => w ? <rect key={i} x={20 + x} y={40 + i * 13} width={w + 10} height="3.5" rx="1.7" fill={kind === "css" ? "#3f86b8" : G} opacity={kind === "css" ? 1 : .8} /> : null)}<text x="16" y="116" fontSize="12" fill={G}>{"}"}</text></>;
    case "code":
      return <>{[["<", 26, ">"], ["<", 34, ">"], ["</", 30, ">"], ["<", 6, "/>"]].map(([a, w, b], i) => (
        <g key={i}><text x={14 + (i === 1 ? 8 : 0)} y={30 + i * 15} fontSize="9" fill={G}>{a}</text><rect x={26 + (i === 1 ? 8 : 0)} y={25 + i * 15} width={w as number} height="5" rx="2.5" fill={["#4c9a6a", "#3f86b8", "#3f86b8", "#4c9a6a"][i]} /><text x={(i === 3 ? 38 : 56) + (i === 1 ? 8 : 0)} y={30 + i * 15} fontSize="9" fill={G}>{b}</text></g>
      ))}</>;
    case "png": case "jpg": case "img": return <Pic />;
    case "video": return <Pic play />;
    default: return <Lines />;
  }
}

export function FileCard({ name, onRemove, onContextMenu }: { name: string; onRemove?: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const { kind, label, color } = fileKind(name);
  const st = useFileStatus(name);
  return (
    <div className={`fc ${st?.state === "error" ? "fc-err" : ""}`} title={st?.error ?? name} onContextMenu={onContextMenu}>
      <div className="fc-doc">
        {st?.thumb ? <img className="fc-thumb" src={st.thumb} alt={name} /> : <svg viewBox="0 0 116 148" aria-hidden><Art kind={kind} /></svg>}
        {!st?.thumb && <span className="fc-badge" style={{ background: color }}>{label}</span>}
        {st?.state === "uploading" && <div className="fc-prog" role="progressbar" aria-valuenow={st.pct}><i style={{ width: st.pct + "%" }} /></div>}
        {st?.state === "error" && <span className="fc-bad" aria-label="Lỗi">!</span>}
        {onRemove && <button className="att-x" onClick={onRemove} aria-label="Xóa">×</button>}
      </div>
      <span className="fc-name">{st?.state === "error" ? "Lỗi — " + name : name}</span>
    </div>
  );
}
