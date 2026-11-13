import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AuthError, limit } from "../../authstore";
import { route } from "../../../server/route";
import { diskLow } from "../../diskfloor";
import { lowPriority, parserEnv, withConvertSlot } from "../../fileproc/sandbox";
import { FileError } from "../../fileproc/types";

export const runtime = "nodejs";
const run = promisify(execFile);
const MAX = 50 * 1024 * 1024;
// Ưu tiên thấp và không có biến môi trường bí mật: chương trình Python đọc tệp người dùng không làm chậm web, lỗi của nó cũng không đọc được khóa của máy chủ.
const convert = (file: string, args: string[], timeout: number) => {
  const p = run(file, args, { maxBuffer: 64 * 1024 * 1024, timeout, killSignal: "SIGKILL", env: parserEnv() });
  lowPriority(p.child.pid);
  return p;
};

export const POST = route({ feature: "files" }, async ({ req, user }) => {
  const uid = user.id;
  const bin = process.env.MARKITDOWN_BIN || path.join(process.cwd(), ".mkvenv", "bin", "markitdown");
  if (!existsSync(bin) && !process.env.MARKITDOWN_BIN)
    return Response.json({ error: "Chưa cài MarkItDown. Chạy: python3 -m venv .mkvenv && .mkvenv/bin/pip install 'markitdown[all]'" }, { status: 501 });
  // Kiểm tra trước khi đọc thân yêu cầu: script gửi hàng loạt tệp 50 MB không được giữ bộ nhớ.
  try { limit("markitdown:" + uid, 30, 3_600_000); }
  catch (e) { if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  if (Number(req.headers.get("content-length") ?? 0) > MAX + 1048576) return Response.json({ error: "Tệp quá lớn (tối đa 50MB)" }, { status: 413 });
  if (diskLow(tmpdir())) return Response.json({ error: "Máy chủ sắp hết dung lượng nên tạm thời chưa nhận tệp mới. Hãy thử lại sau." }, { status: 507 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Thiếu tệp" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "Tệp quá lớn (tối đa 50MB)" }, { status: 413 });
  try {
    return await withConvertSlot(uid, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "mkd-"));
      try {
        const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/) ?? [""])[0];
        const src = path.join(dir, "input" + ext);
        await writeFile(src, Buffer.from(await file.arrayBuffer()));
        const { stdout } = await convert(bin, [src], 120_000);
        let markdown = stdout;
        let ocr = false;
        if (markdown.replace(/\s+/g, "").length < 20 && /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(ext)) {
          const py = path.join(path.dirname(bin), "python");
          try {
            const r = await convert(py, [path.join(process.cwd(), "scripts", "ocr.py"), src], 600_000);
            if (r.stdout.trim()) { markdown = r.stdout; ocr = true; }
          } catch {}
        }
        return Response.json({ markdown, ocr });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  } catch (e) {
    if (e instanceof FileError) return Response.json({ error: e.message }, { status: 429 });
    const msg = String((e as { stderr?: string; message?: string }).stderr || (e as Error).message || e);
    const last = msg.trim().split("\n").filter(Boolean).pop() ?? "Lỗi không xác định";
    return Response.json({ error: "Không chuyển được: " + last.slice(0, 300) }, { status: 422 });
  }
});
