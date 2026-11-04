// Tệp, thư mục, .zip người dùng gửi kèm trong Synchro Code: chép nguyên vẹn vào workspace (.synchro/uploads/…, git bỏ qua) để agent
// dùng được bằng mọi công cụ (đọc, giải nén, chạy), như khi kéo tệp vào Claude Code. Ảnh, PDF, tệp chữ còn được gửi thẳng cho model.
import crypto from "node:crypto";
import { storedFile } from "./fileproc";
import { AuthError } from "./authstore";
import { exec, putFile } from "./workspace";

export const UPLOADS = ".synchro/uploads";
export type Upload = { id: string; name: string; folder?: boolean };
/** Thêm .synchro/ vào .git/info/exclude của repo trong phiên (không lọt vào git status, commit). */
export const EXCLUDE_SYNCHRO = 'if [ -d .git ]; then mkdir -p .git/info && (grep -qx ".synchro/" .git/info/exclude 2>/dev/null || echo ".synchro/" >> .git/info/exclude); fi';

const safe = (n: string) => n.normalize("NFC").replace(/[\\/\0]/g, "_").replace(/^\.+/, "_").slice(0, 160) || "tep";
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// Giải nén thư mục (đã nén ở trình duyệt) đúng chỗ, thay bản cũ cùng tên; in số tệp và danh sách cho model.
const UNZIP_PY = `import sys,zipfile,os,shutil
z,t=sys.argv[1],sys.argv[2]
shutil.rmtree(t,ignore_errors=True)
with zipfile.ZipFile(z) as f:
  names=sorted(n for n in f.namelist() if not n.endswith('/'))
  f.extractall(t)
os.remove(z)
print(len(names))
print("\\n".join(names[:80]))`;

export function kindLabel(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (/^(png|jpe?g|gif|webp|bmp|svg|heic|avif|ico)$/.test(ext)) return "ảnh";
  if (ext === "pdf") return "PDF";
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz|crx|jar)$/.test(ext)) return `tệp nén .${ext}`;
  return ext ? `tệp .${ext}` : "tệp";
}

/** Chép các tệp gửi kèm vào workspace; trả mô tả (đường dẫn, loại, cỡ, nội dung thư mục) để ghép vào tin nhắn cho model. */
export async function placeUploads(u: string, d: string, list: Upload[]) {
  const lines: string[] = [], errors: string[] = [];
  if (!list.length) return { lines, errors };
  await exec(u, d, { cmd: `mkdir -p ${UPLOADS} && ${EXCLUDE_SYNCHRO}`, timeout: 20 });
  for (const f of list) {
    const s = await storedFile(f.id, u);
    const name = safe(f.name);
    if (!s) { errors.push(`"${f.name}" không còn trên máy chủ, hãy tải lên lại.`); continue; }
    try {
      if (f.folder) {
        const tmp = `${UPLOADS}/.tai-len-${crypto.randomBytes(5).toString("hex")}.zip`;
        await putFile(u, d, tmp, s.buf);
        const r = await exec(u, d, { argv: ["python3", "-c", UNZIP_PY, tmp, `${UPLOADS}/${name}`], timeout: 300 });
        if (r.code) throw new AuthError((r.err || r.out).trim().split("\n").pop()?.slice(0, 200) || "giải nén lỗi", 500);
        const [n, ...files] = r.out.trim().split("\n");
        lines.push(`- ${UPLOADS}/${name}/ (thư mục, ${n} tệp)${files.length ? "\n" + files.map((x) => `    ${x}`).join("\n") + (Number(n) > files.length ? `\n    … và ${Number(n) - files.length} tệp khác` : "") : ""}`);
      } else {
        await putFile(u, d, `${UPLOADS}/${name}`, s.buf);
        lines.push(`- ${UPLOADS}/${name} (${kindLabel(name)}, ${size(s.buf.length)})`);
      }
    } catch (e) { errors.push(`Không chép được "${f.name}" vào workspace: ${(e as Error).message}`); }
  }
  return { lines, errors };
}
