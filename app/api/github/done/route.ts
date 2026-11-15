import { timed } from "../../../../server/servertiming";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trang đích của cửa sổ kết nối GitHub: báo kết quả cho tab Synchro (qua localStorage) rồi tự đóng.
export const GET = timed(async (req: Request) => {
  const error = new URL(req.url).searchParams.get("error") ?? "";
  const data = JSON.stringify({ at: Date.now(), error }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub</title>
<style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#EEECE5;color:#111210}@media(prefers-color-scheme:dark){body{background:#111210;color:#EEECE5}}p{max-width:420px;text-align:center;line-height:1.5}a{color:inherit}</style></head>
<body><p id="m"></p><script>
const d=${data};
try{localStorage.setItem("synchro:gh",JSON.stringify(d))}catch(e){}
document.getElementById("m").textContent=d.error?("Không kết nối được GitHub: "+d.error):"Đã kết nối GitHub. Bạn có thể đóng cửa sổ này.";
if(!d.error)setTimeout(()=>{window.close();setTimeout(()=>{location.href="/"},300)},600);
</script><noscript>Đã xử lý. <a href="/">Quay lại Synchro</a></noscript></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
