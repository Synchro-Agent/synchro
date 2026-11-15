"use client";
// Gói skill tải lên quá lớn (vd. "Download ZIP" cả một repo: hyperframes-main.zip 143 MB, 11 nghìn tệp, trong đó các skill chỉ ~5 MB) bị
// nginx chặn với lỗi 413 trước khi tới máy chủ. Trình duyệt mở gói ngay trên máy, chỉ giữ thư mục của các skill rồi mới tải lên.
// Lọc giống hệt máy chủ — "skill": parseUpload trong skillstore.ts (bỏ rác hệ điều hành và mọi thư mục ẩn: .git, .github…); "library":
// addZipToPlugin trong plugins.ts (bỏ .git, node_modules, dist…; giữ .claude / .agents / .claude-plugin / .codex). Skill là thư mục có
// SKILL.md (skill lồng trong skill khác thuộc skill ngoài); giữ nguyên đường dẫn nên danh sách skill để chọn và pick không đổi.
import { tf } from "./i18n";

const MB = 1024 * 1024;
/** Giới hạn mỗi lần tải lên của nginx (client_max_body_size). */
export const UPLOAD_MAX = 40 * MB;
const size = (n: number) => `${(n / MB).toFixed(1)} MB`;
export const tooLarge = () => tf("Tệp quá lớn để tải lên (tối đa {mb} MB mỗi lần).", { mb: UPLOAD_MAX / MB });

type Mode = "skill" | "library";
const SKIP_LIB = new Set([".git", ".github", "__MACOSX", "node_modules", ".DS_Store", ".venv", "venv", "__pycache__", "dist", "build"]);
const DOT_LIB = new Set([".claude", ".agents", ".claude-plugin", ".codex"]);
const okSeg: Record<Mode, (s: string) => boolean> = {
  skill: (s) => s !== "__MACOSX" && s !== "Thumbs.db" && !s.startsWith("."),
  library: (s) => !SKIP_LIB.has(s) && (!s.startsWith(".") || DOT_LIB.has(s)),
};
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const cache = new WeakMap<File, Promise<File>>();

/** Gói .zip lớn hơn max: trả gói mới chỉ gồm thư mục các skill (cùng tên tệp); gói nhỏ hoặc không phải .zip: trả nguyên tệp.
 *  Vẫn lớn hơn max sau khi lọc / không có SKILL.md / không đọc được: báo lỗi rõ ràng (không tải lên vô ích). */
export function slimSkillZip(f: File, max: number, mode: Mode = "skill"): Promise<File> {
  if (f.size <= max || !/\.zip$/i.test(f.name)) return Promise.resolve(f);
  let p = cache.get(f);
  if (!p) { p = slim(f, max, mode); cache.set(f, p); p.catch(() => cache.delete(f)); }
  return p;
}

async function slim(f: File, max: number, mode: Mode): Promise<File> {
  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try { zip = await JSZip.loadAsync(await f.arrayBuffer()); }
  catch { throw new Error(tf("Không đọc được {name} (tệp bị hỏng hoặc không phải zip).", { name: f.name })); }
  const all = Object.values(zip.files).filter((e) => !e.dir).map((e) => ({ e, p: e.name.replace(/\\/g, "/").replace(/^(\.\/)+/, "") })).filter(({ p }) => p.split("/").every(okSeg[mode]));
  let roots = all.filter(({ p }) => p === "SKILL.md" || p.endsWith("/SKILL.md")).map(({ p }) => dirOf(p));
  roots = roots.filter((r) => !roots.some((o) => o !== r && (o === "" || r.startsWith(o + "/"))));
  if (!roots.length) throw new Error(tf("Không tìm thấy SKILL.md trong {name} ({size}). Gói skill cần có thư mục chứa SKILL.md.", { name: f.name, size: size(f.size) }));
  const keep = all.filter(({ p }) => roots.some((r) => r === "" || p.startsWith(r + "/")));
  const out = new JSZip();
  for (const { e } of keep) out.file(e.name, await e.async("uint8array"));
  const data = await out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (data.length > max) throw new Error(tf("{name} quá lớn: {n} skill bên trong vẫn nặng {size} sau khi bỏ phần không thuộc skill (tối đa {max}). Hãy nén riêng thư mục của từng skill, hoặc dán link GitHub của repo.", { name: f.name, n: roots.length, size: size(data.length), max: size(max) }));
  return new File([data as BlobPart], f.name, { type: "application/zip" });
}
