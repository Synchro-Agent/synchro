import JSZip from "jszip";
import { appUrl, handle } from "../../../../../server/authstore";
import { extensionFiles } from "../../../../../extension/build.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải tiện ích Synchro (.zip) đã gắn sẵn địa chỉ máy chủ này: giải nén rồi "Load unpacked" trong chrome://extensions (bật Developer mode).
// Không chứa bí mật nào (mỗi tài khoản tự ghép nối bằng mã riêng), nên ai có đường dẫn cũng tải được để cài trên máy của mình.
// Các tệp nằm ngay ở gốc .zip, không lồng thêm thư mục: công cụ giải nén mặc định của Windows ("Extract All") và macOS tự tạo một thư mục
// theo tên tệp (synchro-chrome, synchro-chrome (1)…), nên thư mục đó luôn có manifest.json ngay bên trong. Lồng thêm thư mục thì Windows
// ra synchro-chrome (1)\synchro-chrome\manifest.json, chọn thư mục ngoài là Chrome báo "Manifest file is missing or unreadable".
export const GET = handle(async (req) => {
  const zip = new JSZip();
  for (const [p, data] of extensionFiles(process.cwd(), appUrl(req))) zip.file(p, data);
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(new Blob([buf as BlobPart], { type: "application/zip" }), {
    headers: { "content-disposition": 'attachment; filename="synchro-chrome.zip"', "cache-control": "no-store" },
  });
});
