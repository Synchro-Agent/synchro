import { finishAuth } from "../../../../connectors";
import { randomToken } from "../../../../mcpauth";
import { RULES_EN, VI2EN } from "../../../../i18n-dict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const en = (s: string) => { if (Object.prototype.hasOwnProperty.call(VI2EN, s)) return VI2EN[s]; for (const [re, f] of RULES_EN) { const m = s.match(re); if (m) return f(m); } return s; };

// Máy chủ đăng nhập của connector chuyển về đây. Trang Synchro gửi header COOP same-origin (WebContainer cần), nên khi cửa sổ đăng nhập đi qua trang của hãng thì
// bị tách khỏi trang đã mở nó: không còn window.opener. Vì vậy báo kết quả qua BroadcastChannel (cùng nguồn, không cần opener), chờ trang chính xác nhận rồi tự đóng.
// Không trang nào xác nhận (mở ngay trong tab vì trình duyệt chặn cửa sổ bật lên, hay trang chính đã đóng) thì quay về Cài đặt → Connectors.
export async function GET(req: Request) {
  const r = await finishAuth(req, new URL(req.url).searchParams).catch((e) => ({ ok: false, id: undefined, message: `Lỗi không mong muốn: ${(e as Error).message}` }));
  const data = { type: "synchro-connector", ok: r.ok, id: r.id ?? null, message: r.message, nonce: randomToken(12) };
  const back = `/?settings=Connectors&connector=${r.ok ? "ok" : "error"}&msg=${encodeURIComponent(r.message)}`;
  const title = r.ok ? "Đã kết nối" : "Chưa kết nối được", hint = "Bạn có thể đóng cửa sổ này.";
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synchro</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,sans-serif;background:#EEECE5;color:#111210}
div{text-align:center;padding:24px;max-width:360px}b{display:block;font-size:17px;margin-bottom:6px}span{color:#64655E}p{margin:10px 0 0;font-size:13px;color:#64655E}@media(prefers-color-scheme:dark){body{background:#111210;color:#EEECE5}span,p{color:#8F9088}}</style></head>
<body><div><b id="t">${title}</b><span id="m">${esc(r.message)}</span><p id="h" hidden>${hint}</p></div>
<script>(function(){var d=${js(data)},acked=false,ch=null;
try{if(JSON.parse(localStorage.getItem("p:uilang")||'""')==="en"){var E=${js({ t: en(title), m: en(r.message), h: en(hint) })};["t","m","h"].forEach(function(k){document.getElementById(k).textContent=E[k]});document.documentElement.lang="en"}}catch(e){}
function done(){if(acked)return;acked=true;setTimeout(function(){window.close();setTimeout(function(){document.getElementById("h").hidden=false},300)},${r.ok ? 400 : 1800})}
try{ch=new BroadcastChannel("synchro-connector");ch.onmessage=function(e){if(e.data&&e.data.type==="synchro-connector-ack"&&e.data.nonce===d.nonce)done()};ch.postMessage(d);setTimeout(function(){if(!acked)ch.postMessage(d)},300)}catch(e){}
try{if(window.opener&&!window.opener.closed){window.opener.postMessage(d,location.origin);done()}}catch(e){}
setTimeout(function(){if(!acked)location.replace(${js(back)})},${700})})()</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
