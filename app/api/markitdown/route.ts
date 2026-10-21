import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
const run = promisify(execFile);
const MAX = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const bin = process.env.MARKITDOWN_BIN || path.join(process.cwd(), ".mkvenv", "bin", "markitdown");
  if (!existsSync(bin) && !process.env.MARKITDOWN_BIN)
    return Response.json({ error: "Chưa cài MarkItDown. Chạy: python3 -m venv .mkvenv && .mkvenv/bin/pip install 'markitdown[all]'" }, { status: 501 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Thiếu tệp" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "Tệp quá lớn (tối đa 50MB)" }, { status: 413 });
  const dir = await mkdtemp(path.join(tmpdir(), "mkd-"));
  try {
    const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/) ?? [""])[0];
    const src = path.join(dir, "input" + ext);
    await writeFile(src, Buffer.from(await file.arrayBuffer()));
    const { stdout } = await run(bin, [src], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    let markdown = stdout;
    let ocr = false;
    if (markdown.replace(/\s+/g, "").length < 20 && /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(ext)) {
      const py = path.join(path.dirname(bin), "python");
      try {
        const r = await run(py, [path.join(process.cwd(), "scripts", "ocr.py"), src], { maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
        if (r.stdout.trim()) { markdown = r.stdout; ocr = true; }
      } catch {}
    }
    return Response.json({ markdown, ocr });
  } catch (e) {
    const msg = String((e as { stderr?: string; message?: string }).stderr || (e as Error).message || e);
    const last = msg.trim().split("\n").filter(Boolean).pop() ?? "Lỗi không xác định";
    return Response.json({ error: "Không chuyển được: " + last.slice(0, 300) }, { status: 422 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
