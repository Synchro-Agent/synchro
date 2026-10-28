import JSZip from "jszip";
import { appUrl, handle } from "../../../../authstore";
import { extensionFiles } from "../../../../../extension/build.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải tiện ích Synchro (.zip) đã gắn sẵn địa chỉ máy chủ này: giải nén rồi "Load unpacked" trong chrome://extensions (bật Developer mode).
// Không chứa bí mật nào (mỗi tài khoản tự ghép nối bằng mã riêng), nên ai có đường dẫn cũng tải được để cài trên máy của mình.
export const GET = handle(async (req) => {
  const zip = new JSZip();
  const dir = zip.folder("synchro-chrome")!;
  for (const [p, data] of extensionFiles(process.cwd(), appUrl(req))) dir.file(p, data);
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(new Blob([buf as BlobPart], { type: "application/zip" }), {
    headers: { "content-disposition": 'attachment; filename="synchro-chrome.zip"', "cache-control": "no-store" },
  });
});
