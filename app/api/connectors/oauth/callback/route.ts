import { finishAuth } from "../../../../connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Máy chủ đăng nhập của connector chuyển về đây. Mở trong cửa sổ bật lên thì báo kết quả cho trang Synchro rồi tự đóng;
// mở ngay trong tab (trình duyệt chặn cửa sổ bật lên) thì quay về Cài đặt → Connectors.
export async function GET(req: Request) {
  const r = await finishAuth(req, new URL(req.url).searchParams).catch((e) => ({ ok: false, id: undefined, message: `Lỗi không mong muốn: ${(e as Error).message}` }));
  const data = JSON.stringify({ type: "synchro-connector", ok: r.ok, id: r.id ?? null, message: r.message }).replace(/</g, "\\u003c");
  const back = `/?settings=Connectors&connector=${r.ok ? "ok" : "error"}&msg=${encodeURIComponent(r.message)}`;
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synchro</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,sans-serif;background:#fcfcfa;color:#141413}
div{text-align:center;padding:24px;max-width:360px}b{display:block;font-size:17px;margin-bottom:6px}span{color:#6b6a65}@media(prefers-color-scheme:dark){body{background:#121212;color:#faf9f5}span{color:#a3a29b}}</style></head>
<body><div><b>${r.ok ? "Đã kết nối" : "Chưa kết nối được"}</b><span>${esc(r.message)}</span></div>
<script>(function(){var d=${data};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(d,location.origin);setTimeout(function(){window.close()},${r.ok ? 600 : 2500});return}}catch(e){}location.replace(${JSON.stringify(back)})})()</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
