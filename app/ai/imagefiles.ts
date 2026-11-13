// Tệp ảnh do CLI chính chủ tạo ra: tìm, đọc bytes, kiểm tra đúng là ảnh. Thư mục đăng nhập thuộc user riêng của engine (web không đọc thẳng được) nên mọi lệnh ở đây đi qua
// spawnCli với đúng env của tài khoản: cùng user, cùng hộp bubblewrap như chính CLI, nên có bị đánh lừa bởi đường dẫn thì cũng chỉ thấy thư mục của tài khoản đó.
// Tách khỏi imagegen.ts vì subs.ts cũng cần phần này (ảnh Antigravity tự tạo trong lượt chat) mà imagegen.ts lại cần subs.ts.
import crypto from "node:crypto";
import path from "node:path";
import { engineHome, spawnCli, writeEngineFile } from "./cli_runtime";

export type ImgFile = { name: string; mime: string; data: Buffer };
export const IMAGE_MAX_MB = () => Number(process.env.SYNCHRO_IMAGE_MAX_MB) || 25;

/** Loại ảnh theo đúng các byte đầu tệp (đuôi tệp do model đặt thì không đáng tin). */
export function imageKind(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export type FileCtx = { env: Record<string, string>; cwd: string; /** Chỉ đọc tệp nằm trong các thư mục này (thư mục đăng nhập của đúng tài khoản, thư mục tạm của lượt). */ roots: string[]; signal?: AbortSignal };
const inside = (root: string, p: string) => path.resolve(p).startsWith(path.resolve(root) + path.sep);

// Đường dẫn có thể do model nói ra nên kiểm tra cả ở đây, sau khi đã giải liên kết: liên kết mềm trỏ sang thư mục đăng nhập của người khác không qua được.
// Mã thoát: 3 không có / là liên kết, 4 quá cỡ, 5 ngoài thư mục được phép.
const READ_SH = `f=$1; max=$2; shift 2
[ -f "$f" ] && [ ! -L "$f" ] || exit 3
r=$(realpath "$f" 2>/dev/null) || exit 3
ok=
for d in "$@"; do d=$(realpath "$d" 2>/dev/null) || continue; case "$r" in "$d"/*) ok=1;; esac; done
[ -n "$ok" ] || exit 5
[ "$(wc -c < "$f" | tr -d ' ')" -le "$max" ] || exit 4
exec cat -- "$f"`;
export type ReadWhy = "missing" | "big" | "outside";
export async function readImageFile(file: string, c: FileCtx, maxBytes = IMAGE_MAX_MB() * 1048576): Promise<{ data?: Buffer; why?: ReadWhy }> {
  if (!path.isAbsolute(file) || !c.roots.some((r) => inside(r, file))) return { why: "outside" };
  const p = spawnCli("/bin/sh", ["-c", READ_SH, "sh", path.resolve(file), String(maxBytes), ...c.roots], { env: c.env, cwd: c.cwd, stdin: "", timeoutMs: 60_000, signal: c.signal });
  const chunks: Buffer[] = [];
  let size = 0;
  p.child.stdout!.on("data", (d: Buffer) => { size += d.length; if (size <= maxBytes) chunks.push(d); });
  const e = await p.done;
  if (e.code === 4 || size > maxBytes) return { why: "big" };
  if (e.code === 5) return { why: "outside" };
  return e.code === 0 ? { data: Buffer.concat(chunks) } : { why: "missing" };
}

// -type f của find không đi theo liên kết mềm. newer: chỉ tệp mới hơn tệp mốc của lượt.
const LIST_SH = `d=$1; depth=$2; stamp=$3
[ -d "$d" ] || exit 0
if [ -n "$stamp" ] && [ -e "$stamp" ]; then find "$d" -maxdepth "$depth" -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) -newer "$stamp" 2>/dev/null
else find "$d" -maxdepth "$depth" -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) 2>/dev/null; fi | head -n 60`;
/** Tệp ảnh trong một thư mục (tối đa 60 tệp, sâu depth tầng). Tệp trong thư mục ẩn của CLI (.tempmediaStorage, .system_generated…) chỉ dùng khi không còn tệp nào khác. */
export async function listImageFiles(dir: string, c: FileCtx, o: { depth?: number; stamp?: string } = {}): Promise<string[]> {
  if (!c.roots.some((r) => inside(r, dir) || path.resolve(r) === path.resolve(dir))) return [];
  const p = spawnCli("/bin/sh", ["-c", LIST_SH, "sh", dir, String(o.depth ?? 3), o.stamp ?? ""], { env: c.env, cwd: c.cwd, stdin: "", timeoutMs: 30_000, signal: c.signal });
  const out: string[] = [];
  for await (const l of p.lines) if (l.trim()) out.push(l.trim());
  await p.done;
  const seen = [...new Set(out)].sort();
  const plain = seen.filter((f) => !path.relative(dir, f).split(path.sep).some((s) => s.startsWith(".")));
  return plain.length ? plain : seen;
}

/** Đường dẫn tệp ảnh tuyệt đối nhắc tới trong kết quả công cụ hay câu trả lời của CLI (chuỗi, JSON lồng nhau, link markdown, file://). */
export function namedPaths(v: unknown, out = new Set<string>(), depth = 0): string[] {
  if (depth > 8 || out.size > 40) return [...out];
  if (typeof v === "string") {
    for (const m of v.matchAll(/(?:file:\/\/)?(\/[^\s"'<>()[\]`]+\.(?:png|jpe?g|webp))/gi)) { try { out.add(decodeURI(m[1])); } catch { out.add(m[1]); } }
  } else if (Array.isArray(v)) for (const x of v) namedPaths(x, out, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) namedPaths(x, out, depth + 1);
  return [...out];
}

export type Gathered = { files: ImgFile[]; bad: number; big: number };
/** Đọc các tệp, chỉ giữ ảnh thật trong cỡ cho phép. skip: dấu băm của tệp không phải kết quả (ảnh gốc người dùng gửi được CLI chép lại). */
export async function gatherImages(paths: string[], c: FileCtx, o: { max?: number; skip?: string } = {}): Promise<Gathered> {
  const files: ImgFile[] = [], seen = new Set<string>();
  let bad = 0, big = 0;
  for (const f of paths) {
    if (files.length >= (o.max ?? 8)) break;
    const r = await readImageFile(f, c);
    if (r.why === "big") { big++; continue; }
    if (!r.data) continue;
    const kind = imageKind(r.data);
    if (!kind) { bad++; continue; }
    const hash = crypto.createHash("sha1").update(r.data).digest("hex");
    if (hash === o.skip || seen.has(hash)) continue;
    seen.add(hash);
    files.push({ name: path.basename(f), mime: kind.mime, data: r.data });
  }
  return { files, bad, big };
}

/** Xóa tệp tạm bằng chính user của engine. */
export async function removeFile(file: string, c: Pick<FileCtx, "env" | "cwd">) {
  await spawnCli("/bin/sh", ["-c", 'rm -f -- "$1"', "sh", file], { env: c.env, cwd: c.cwd, stdin: "" }).done;
}

/** Xóa tệp ảnh CLI để lại trong thư mục đăng nhập sau khi đã đọc vào bộ nhớ: không có hạn sử dụng, không tính vào dung lượng của người dùng. Chỉ tệp mới hơn tệp mốc của lượt:
 *  đường dẫn có thể do model nói ra, ảnh của đoạn chat khác không được đụng tới. */
export async function removeNewFiles(files: string[], stamp: string, c: FileCtx) {
  const list = [...new Set(files)].filter((f) => path.isAbsolute(f) && c.roots.some((r) => inside(r, f)));
  if (list.length) await spawnCli("/bin/sh", ["-c", 'stamp=$1; shift; find "$@" -maxdepth 0 -type f -newer "$stamp" -exec rm -f -- {} +', "sh", stamp, ...list.map((f) => path.resolve(f))], { env: c.env, cwd: c.cwd, stdin: "", timeoutMs: 30_000 }).done;
}

/** Thư mục Antigravity lưu mọi thứ của một hội thoại, kể cả ảnh image-generator của nó tạo. */
export const agyBrainDir = (home: string, conv: string) => path.join(home, ".gemini", "antigravity-cli", "brain", conv);

// ---------------------------------------------------------------- ảnh Antigravity tự tạo trong lượt chat
// Antigravity có thể tự gọi image-generator của nó thay vì generate_image: ảnh nằm trong thư mục hội thoại trên máy chủ, người dùng không mở được đường dẫn đó.
/** Tệp mốc đặt trước lượt: ảnh mới của lượt là ảnh mới hơn tệp này (hội thoại nối tiếp có sẵn ảnh của các lượt trước). */
export async function nativeStamp(workdir: string): Promise<string | null> {
  const f = path.join(workdir, `.synchro-stamp-${crypto.randomBytes(5).toString("hex")}`);
  try { await writeEngineFile(f, Buffer.alloc(0)); return f; } catch { return null; }
}
export async function agyNativeImages(o: { env: Record<string, string>; workdir: string; session: string; stamp: string }): Promise<ImgFile[]> {
  const home = o.env.HOME;
  if (!home || !/^[\w-]{8,100}$/.test(o.session)) return [];
  const c: FileCtx = { env: o.env, cwd: o.workdir, roots: [home] };
  const paths = await listImageFiles(agyBrainDir(home, o.session), c, { stamp: o.stamp });
  return paths.length ? (await gatherImages(paths, c)).files : [];
}

// ---------------------------------------------------------------- đường dẫn máy chủ lọt vào chữ
// Câu trả lời của CLI có thể ghi đường dẫn trên máy chủ ("[quả táo](/…/brain/<id>/x.jpg)", file://…): người dùng không mở được và không nên thấy. Ảnh đã thành thẻ tệp.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_END = "[^\\s)\\]>\"'`]";
const pathRe = (home: string) => `(?:file://${NOT_END}+\\.(?:png|jpe?g|webp)|file://${NOT_END}*${esc(home)}${NOT_END}*|${esc(home)}/${NOT_END}*|/${NOT_END}*?/(?:\\.gemini/antigravity-cli/brain|generated_images)/${NOT_END}*)`;
const base = (p: string) => { const n = p.replace(/[/.,;:]+$/, "").split("/").pop() ?? ""; try { return decodeURI(n); } catch { return n; } };
/** Bỏ đường dẫn máy chủ khỏi chữ, chừa khối code và artifact: link thành tên hiện, ảnh markdown bỏ hẳn, đường dẫn trần thành tên tệp. */
export function scrubServerPaths(text: string, home = engineHome()): string {
  const P = pathRe(home);
  const link = new RegExp(`(!?)\\[([^\\]\\n]*)\\]\\(<?(${P})>?\\)`, "g"), bare = new RegExp(P, "g");
  return text.split(/(```[\s\S]*?(?:```|$)|<artifact\b[\s\S]*?(?:<\/artifact>|$))/g).map((part, i) => (i % 2 ? part
    : part.replace(link, (_m, img: string, label: string, p: string) => (img ? "" : label || base(p))).replace(bare, (p) => base(p)))).join("");
}
