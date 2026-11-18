// Model giả lập cho Cài đặt → Khả năng: trả lời như model thật khi system prompt có hướng dẫn tương ứng.
//  - <artifacts>: tạo artifact (ứng dụng React, trang HTML, SVG, tài liệu), sửa thành phiên bản mới, artifact dùng AI.
//  - <inline_visuals>: biểu đồ ```chart, sơ đồ ```mermaid, hình tương tác ```widget.
//  - công cụ run_code: viết code Python tạo tệp (Excel, Word, PowerPoint, PDF, CSV, ảnh), tính toán, cài gói.
// Không có hướng dẫn nào khớp thì trả về null để model giả trả lời bình thường.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
const has = (t, re) => re.test(t);

// ---------------------------------------------------------------- artifact mẫu
const TODO = `import { useState } from "react";
import { Check, Plus, Trash2, ListTodo } from "lucide-react";

export default function TodoApp() {
  const [items, setItems] = useState([
    { id: 1, text: "Đọc lại báo cáo quý", done: true },
    { id: 2, text: "Gửi email cho nhóm thiết kế", done: false },
    { id: 3, text: "Chuẩn bị slide họp thứ Hai", done: false },
  ]);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const add = () => {
    if (!text.trim()) return;
    setItems([...items, { id: Date.now(), text: text.trim(), done: false }]);
    setText("");
  };
  const shown = items.filter((i) => (filter === "all" ? true : filter === "done" ? i.done : !i.done));
  const left = items.filter((i) => !i.done).length;
  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <ListTodo className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold text-slate-800">Việc cần làm</h1>
          <span className="ml-auto text-sm text-slate-500">{left} việc còn lại</span>
        </div>
        <div className="flex gap-2 mb-4">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Thêm việc mới…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          <button onClick={add} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Thêm
          </button>
        </div>
        <div className="flex gap-1 mb-3 text-sm">
          {[["all", "Tất cả"], ["todo", "Chưa xong"], ["done", "Đã xong"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={"rounded-md px-3 py-1 " + (filter === k ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-500 hover:bg-slate-100")}>{l}</button>
          ))}
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5 group">
              <button onClick={() => setItems(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))}
                className={"w-5 h-5 rounded-md border flex items-center justify-center " + (i.done ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300")}>
                {i.done && <Check className="w-3.5 h-3.5" />}
              </button>
              <span className={"flex-1 text-sm " + (i.done ? "line-through text-slate-400" : "text-slate-700")}>{i.text}</span>
              <button onClick={() => setItems(items.filter((x) => x.id !== i.id))} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
          {!shown.length && <li className="py-8 text-center text-sm text-slate-400">Không có việc nào</li>}
        </ul>
      </div>
    </div>
  );
}`;

const DASH = `import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Users, ShoppingCart } from "lucide-react";

const months = ["T1", "T2", "T3", "T4", "T5", "T6"];
const data = months.map((m, i) => ({ thang: m, doanhThu: [320, 410, 380, 520, 610, 690][i], donHang: [120, 150, 140, 190, 230, 260][i] }));

function Stat({ icon: Icon, label, value, delta }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
      <div className="flex items-center gap-2 text-slate-500 text-sm"><Icon className="w-4 h-4" />{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-800">{value}</div>
      <div className="text-xs text-emerald-600 mt-1">{delta} so với tháng trước</div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-5">
      <h1 className="text-xl font-semibold text-slate-800">Tổng quan kinh doanh</h1>
      <div className="grid grid-cols-3 gap-4">
        <Stat icon={TrendingUp} label="Doanh thu" value="690 tr₫" delta="+13%" />
        <Stat icon={ShoppingCart} label="Đơn hàng" value="260" delta="+13%" />
        <Stat icon={Users} label="Khách mới" value="84" delta="+9%" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 h-72">
          <div className="text-sm font-medium text-slate-600 mb-2">Doanh thu (triệu ₫)</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={data}><CartesianGrid stroke="#eef0f3" vertical={false} /><XAxis dataKey="thang" /><YAxis /><Tooltip /><Bar dataKey="doanhThu" fill="#2a78d6" radius={[4, 4, 0, 0]} barSize={22} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 h-72">
          <div className="text-sm font-medium text-slate-600 mb-2">Số đơn hàng</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={data}><CartesianGrid stroke="#eef0f3" vertical={false} /><XAxis dataKey="thang" /><YAxis /><Tooltip /><Line dataKey="donHang" stroke="#eb6834" strokeWidth={2} dot={{ r: 4 }} /></LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}`;

const CALC = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Máy tính</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#eef2ff,#f8fafc);font-family:system-ui,sans-serif}
  .calc{width:300px;background:#111827;border-radius:22px;padding:18px;box-shadow:0 20px 50px rgba(17,24,39,.35)}
  .screen{color:#fff;text-align:right;padding:18px 8px 14px;min-height:76px}
  .prev{color:#9ca3af;font-size:14px;min-height:18px}
  .cur{font-size:40px;font-weight:300;word-break:break-all}
  .keys{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  button{height:58px;border:0;border-radius:16px;font-size:20px;background:#374151;color:#fff;cursor:pointer;transition:filter .1s,transform .05s}
  button:hover{filter:brightness(1.15)} button:active{transform:scale(.96)}
  .op{background:#2f7bf6}.fn{background:#9ca3af;color:#111827}.zero{grid-column:span 2}
</style>
</head>
<body>
<div class="calc">
  <div class="screen"><div class="prev" id="prev"></div><div class="cur" id="cur">0</div></div>
  <div class="keys" id="keys"></div>
</div>
<script>
  const keys = ["C","±","%","÷","7","8","9","×","4","5","6","−","1","2","3","+","0",".","="];
  let cur = "0", prev = "", op = null, fresh = false;
  const $ = (id) => document.getElementById(id);
  const show = () => { $("cur").textContent = cur; $("prev").textContent = prev && op ? prev + " " + op : ""; };
  const calc = (a, b, o) => ({ "+": a + b, "−": a - b, "×": a * b, "÷": b === 0 ? NaN : a / b })[o];
  function press(k) {
    if (/[0-9]/.test(k)) { cur = fresh || cur === "0" ? k : cur + k; fresh = false; }
    else if (k === ".") { if (!cur.includes(".")) cur += "."; }
    else if (k === "C") { cur = "0"; prev = ""; op = null; }
    else if (k === "±") cur = String(-parseFloat(cur));
    else if (k === "%") cur = String(parseFloat(cur) / 100);
    else if (k === "=") { if (op) { cur = String(+calc(parseFloat(prev), parseFloat(cur), op).toFixed(10)); prev = ""; op = null; fresh = true; } }
    else { if (op && !fresh) cur = String(+calc(parseFloat(prev), parseFloat(cur), op).toFixed(10)); prev = cur; op = k; fresh = true; }
    if (cur === "NaN") cur = "Lỗi";
    show();
  }
  keys.forEach((k) => { const b = document.createElement("button"); b.textContent = k; b.className = "÷×−+=".includes(k) ? "op" : "C±%".includes(k) ? "fn" : k === "0" ? "zero" : ""; b.onclick = () => press(k); $("keys").appendChild(b); });
  addEventListener("keydown", (e) => { const m = { "/": "÷", "*": "×", "-": "−", "+": "+", Enter: "=", Escape: "C" }; const k = m[e.key] ?? e.key; if (keys.includes(k)) press(k); });
</script>
</body>
</html>`;

const LANDING = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumen Coffee</title>
<style>
  *{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;color:#2b2118;background:#fbf7f2}
  header{display:flex;align-items:center;justify-content:space-between;padding:22px 6vw}
  .logo{font-size:22px;font-weight:700;letter-spacing:.02em}nav a{margin-left:22px;color:#6b5847;text-decoration:none;font-family:system-ui,sans-serif;font-size:14px}
  .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;padding:40px 6vw 70px}
  h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 18px}p{font-family:system-ui,sans-serif;color:#6b5847;line-height:1.6}
  .cta{display:inline-block;margin-top:14px;padding:13px 22px;border-radius:999px;background:#2b2118;color:#fbf7f2;font-family:system-ui,sans-serif;text-decoration:none}
  .cup{aspect-ratio:1;border-radius:32px;background:radial-gradient(circle at 50% 42%,#c58b55 0 22%,#5b3a22 23% 34%,#fff 35% 48%,#e9dccd 49%);box-shadow:0 30px 60px rgba(91,58,34,.25)}
  .feat{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:0 6vw 70px}
  .card{background:#fff;border-radius:18px;padding:22px;border:1px solid #efe4d7}.card h3{margin:0 0 6px}
  @media(max-width:700px){.hero,.feat{grid-template-columns:1fr}}
</style>
</head>
<body>
  <header><div class="logo">Lumen</div><nav><a href="#">Thực đơn</a><a href="#">Cửa hàng</a><a href="#">Liên hệ</a></nav></header>
  <section class="hero">
    <div>
      <h1>Cà phê rang mộc, pha chậm mỗi sáng.</h1>
      <p>Hạt Arabica Cầu Đất rang trong ngày, xay theo từng ly. Ghé Lumen để có một buổi sáng chậm rãi giữa lòng thành phố.</p>
      <a class="cta" href="#">Đặt bàn ngay</a>
    </div>
    <div class="cup" role="img" aria-label="Ly cà phê nhìn từ trên xuống"></div>
  </section>
  <section class="feat">
    <div class="card"><h3>Rang trong ngày</h3><p>Mẻ rang nhỏ mỗi sáng để giữ trọn hương thơm.</p></div>
    <div class="card"><h3>Pha thủ công</h3><p>Pour-over, phin và espresso do barista pha từng ly.</p></div>
    <div class="card"><h3>Không gian yên tĩnh</h3><p>Ghế êm, ổ cắm ở mọi bàn, Wi-Fi nhanh.</p></div>
  </section>
</body>
</html>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f7bf6"/><stop offset="1" stop-color="#6250d6"/></linearGradient></defs>
  <rect x="20" y="20" width="200" height="200" rx="48" fill="url(#g)"/>
  <path d="M78 150c0-36 28-64 64-64" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
  <path d="M162 90c0 36-28 64-64 64" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="16" stroke-linecap="round"/>
  <circle cx="142" cy="86" r="11" fill="#fff"/><circle cx="98" cy="154" r="11" fill="#fff" fill-opacity=".55"/>
</svg>`;

const PLAN = `# Kế hoạch ra mắt sản phẩm

## 1. Mục tiêu
- Đạt **1.000 người dùng** trong 30 ngày đầu
- Tỷ lệ giữ chân tuần 4 trên **35%**

## 2. Lịch trình
| Tuần | Việc chính | Người phụ trách |
|---|---|---|
| 1 | Hoàn thiện bản beta, kiểm thử nội bộ | Nhóm sản phẩm |
| 2 | Mời 200 người dùng sớm, thu phản hồi | Nhóm tăng trưởng |
| 3 | Sửa lỗi, chuẩn bị trang giới thiệu | Cả nhóm |
| 4 | Ra mắt công khai | Marketing |

## 3. Rủi ro
- Máy chủ quá tải ngày ra mắt → chuẩn bị tự mở rộng
- Phản hồi tiêu cực về giá → có gói miễn phí

## 4. Đo lường
Theo dõi hằng ngày: lượt đăng ký, người dùng hoạt động, tỷ lệ chuyển đổi.`;

const TRANSLATOR = `import { useState } from "react";
import { Languages, ArrowRightLeft, Loader2 } from "lucide-react";

export default function Translator() {
  const [src, setSrc] = useState("Xin chào! Hôm nay bạn thế nào?");
  const [out, setOut] = useState("");
  const [to, setTo] = useState("English");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try {
      const r = await window.synchro.complete("Dịch sang " + to + ", chỉ trả về bản dịch:\\n\\n" + src);
      setOut(r.trim());
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-indigo-50 p-6 flex justify-center">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center gap-2"><Languages className="w-6 h-6 text-indigo-600" /><h1 className="text-xl font-semibold text-slate-800">Trợ lý dịch</h1></div>
        <div className="grid grid-cols-2 gap-3">
          <textarea value={src} onChange={(e) => setSrc(e.target.value)} className="h-44 rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200" />
          <div className="h-44 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">{busy ? <span className="inline-flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Đang dịch…</span> : out || <span className="text-slate-400">Bản dịch sẽ hiện ở đây</span>}</div>
        </div>
        <div className="flex items-center gap-2">
          <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {["English", "日本語", "한국어", "Français", "Tiếng Việt"].map((l) => <option key={l}>{l}</option>)}
          </select>
          <button onClick={run} disabled={busy || !src.trim()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"><ArrowRightLeft className="w-4 h-4" />Dịch</button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
    </div>
  );
}`;

const BUGGY = `import { useState } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  const items = undefined;
  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-semibold">Bộ đếm: {n}</h1>
      <p className="text-slate-500">Có {items.length} mục</p>
      <button onClick={() => setN(n + 1)} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">Tăng</button>
    </div>
  );
}`;
const FIXED = BUGGY.replace("const items = undefined;", "const items = [\"Táo\", \"Cam\", \"Xoài\"];");

// Ứng dụng có lưu dữ liệu chung (window.storage, shared = true): thử xuất bản thành ứng dụng cho cả tổ chức.
const NOTES = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Bảng tin nhóm</title>
<style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f7f7f5;color:#1f1f1d}
  main{max-width:560px;margin:32px auto;padding:0 18px}h1{font-size:22px;margin:0 0 4px}p.d{margin:0 0 16px;color:#6b6b66;font-size:14px}
  form{display:flex;gap:8px}input{flex:1;height:40px;border:1px solid #d8d8d2;border-radius:10px;padding:0 12px;font:inherit}
  button{height:40px;border:0;border-radius:10px;padding:0 16px;background:#1f1f1d;color:#fff;font:inherit;cursor:pointer}
  ul{list-style:none;padding:0;margin:18px 0 0;display:flex;flex-direction:column;gap:8px}
  li{background:#fff;border:1px solid #ecece7;border-radius:12px;padding:10px 12px;display:flex;justify-content:space-between;gap:10px}
  li small{color:#8a8a84}#st{font-size:12.5px;color:#8a8a84;margin-top:10px}
</style></head><body><main>
<h1>Bảng tin nhóm</h1><p class="d">Ghi chú dùng chung: ai mở ứng dụng cũng thấy và thêm được.</p>
<form id="f"><input id="t" placeholder="Viết ghi chú…" maxlength="200" required><button>Đăng</button></form>
<div id="st">Đang tải…</div><ul id="list"></ul>
<script>
const KEY = "notes";
const list = document.getElementById("list"), st = document.getElementById("st");
async function load() {
  try { const r = await window.storage.get(KEY, true); return r ? JSON.parse(r.value) : []; } catch (e) { st.textContent = "Không đọc được dữ liệu: " + e.message; return []; }
}
function render(items) {
  list.innerHTML = "";
  for (const n of items.slice().reverse()) { const li = document.createElement("li"); li.innerHTML = "<span></span><small></small>"; li.firstChild.textContent = n.text; li.lastChild.textContent = new Date(n.at).toLocaleTimeString("vi-VN"); list.appendChild(li); }
  st.textContent = items.length + " ghi chú";
}
document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault(); const t = document.getElementById("t"); const text = t.value.trim(); if (!text) return;
  st.textContent = "Đang lưu…";
  try { const items = await load(); items.push({ text, at: Date.now() }); await window.storage.set(KEY, JSON.stringify(items), true); t.value = ""; render(items); }
  catch (err) { st.textContent = "Không lưu được: " + err.message; }
};
load().then(render);
// Người khác vừa đăng ghi chú (đang mở cùng ứng dụng) → nạp lại ngay.
if (window.storage.onChange) window.storage.onChange(({ key }) => { if (key === KEY) load().then(render); });
</script></main></body></html>`;
// Văn bản hành chính (NĐ 30/2020): model viết JSON, Synchro tự dàn trang và xuất Word / PDF.
const CONG_VAN = JSON.stringify({
  loai: "cong-van", coQuanChuQuan: "UBND TỈNH BẮC NINH", coQuan: "SỞ THÔNG TIN VÀ TRUYỀN THÔNG", so: "", kyHieu: "STTTT-CĐS", diaDanh: "Bắc Ninh", ngay: "2026-03-05",
  trichYeu: "đề nghị bố trí kinh phí triển khai nền tảng trợ lý AI nội bộ", kinhGui: ["Sở Tài chính tỉnh Bắc Ninh"],
  noiDung: [
    "Thực hiện Kế hoạch chuyển đổi số năm 2026 của Ủy ban nhân dân tỉnh, Sở Thông tin và Truyền thông đã thử nghiệm nền tảng trợ lý AI nội bộ tại 05 đơn vị trong quý I/2026, bước đầu rút ngắn 30% thời gian soạn thảo văn bản.",
    "Để triển khai chính thức cho các cơ quan, đơn vị trên địa bàn tỉnh, Sở Thông tin và Truyền thông đề nghị Sở Tài chính xem xét, tham mưu Ủy ban nhân dân tỉnh bố trí kinh phí năm 2026 với tổng số tiền **1.250.000.000 đồng** (Một tỷ hai trăm năm mươi triệu đồng), chi tiết tại phụ lục kèm theo.",
    "Sở Thông tin và Truyền thông trân trọng đề nghị Sở Tài chính quan tâm, phối hợp./.",
  ],
  quyenHan: "KT. GIÁM ĐỐC", chucVu: "PHÓ GIÁM ĐỐC", nguoiKy: "Nguyễn Văn An", noiNhan: ["Như trên;", "UBND tỉnh (để b/c);", "Giám đốc Sở (để b/c);", "Lưu: VT, CĐS."],
}, null, 2);
const QUYET_DINH = JSON.stringify({
  loai: "quyet-dinh", coQuan: "ỦY BAN NHÂN DÂN TỈNH BẮC NINH", so: "", kyHieu: "QĐ-UBND", diaDanh: "Bắc Ninh", ngay: "2026-01-08",
  trichYeu: "Về việc thành lập Tổ công tác triển khai trợ lý AI trong cơ quan nhà nước", thamQuyen: "CHỦ TỊCH ỦY BAN NHÂN DÂN TỈNH BẮC NINH",
  canCu: ["Căn cứ Luật Tổ chức chính quyền địa phương ngày 19 tháng 6 năm 2015;", "Theo đề nghị của Giám đốc Sở Thông tin và Truyền thông."],
  noiDung: [
    "Điều 1. Thành lập Tổ công tác triển khai trợ lý AI trong cơ quan nhà nước tỉnh Bắc Ninh (sau đây gọi là Tổ công tác), gồm các thành viên có tên tại danh sách kèm theo.",
    "Điều 2. Tổ công tác có nhiệm vụ xây dựng kế hoạch, hướng dẫn và theo dõi việc sử dụng trợ lý AI tại các cơ quan, đơn vị; định kỳ hằng quý báo cáo Chủ tịch Ủy ban nhân dân tỉnh.",
    "Điều 3. Quyết định này có hiệu lực kể từ ngày ký. Chánh Văn phòng Ủy ban nhân dân tỉnh, Giám đốc Sở Thông tin và Truyền thông và các thành viên Tổ công tác chịu trách nhiệm thi hành Quyết định này./.",
  ],
  quyenHan: "", chucVu: "CHỦ TỊCH", nguoiKy: "Trần Thị Bình", noiNhan: ["Như Điều 3;", "TT Tỉnh ủy, TT HĐND tỉnh (để b/c);", "Lưu: VT, KGVX."],
}, null, 2);
// Bộ slide đánh số lại dở dang sau một bản sửa (H1 T8): bỏ mục 03 mà nhãn mục còn 01, 02, 04, 05 (chân trang 02 / 05 – 05 / 05 đã đánh lại).
// Bìa không đánh số mục nên nhãn chênh số trang một đơn vị: đó là thiết kế, không phải lỗi. Thêm một nút CTA trỏ tới # để
// hội đồng phản biện (model giả) có thêm một ý kiến của chính nó. Dùng cho tests/ui/critic.mjs ("#decknum").
const DECKNUM = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;font:22px/1.45 system-ui,sans-serif;color:#1d1d1b}
.slide{width:100vw;height:100vh;padding:8vh 8vw;display:flex;flex-direction:column;justify-content:center;gap:16px;position:relative;background:#fbf7f0}
.k{font:600 14px/1 system-ui;letter-spacing:.12em;color:#b23a12;margin:0}
h1,h2{margin:0;font-size:52px;line-height:1.1}
.foot{position:absolute;left:8vw;right:8vw;bottom:5vh;display:flex;justify-content:space-between;font-size:14px;color:#555}
a.cta{align-self:flex-start;background:#b23a12;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none}
</style></head><body>
<section class="slide"><h1>Trà Một Chạm</h1><p>Giao trà sữa bằng xe điện trong 18 phút.</p></section>
<section class="slide"><p class="k">01 · Vấn đề</p><h2>Khách chờ quá lâu</h2><p>Đơn giờ cao điểm trễ trung bình 41 phút.</p><div class="foot"><span>Trà Một Chạm</span><span>02 / 05</span></div></section>
<section class="slide"><p class="k">02 · Giải pháp</p><h2>Micro-hub trong ngõ</h2><p>Mỗi hub phục vụ bán kính 1,5 km.</p><div class="foot"><span>Trà Một Chạm</span><span>03 / 05</span></div></section>
<section class="slide"><p class="k">04 · Kinh tế đơn vị</p><h2>Lãi 6.000 ₫ mỗi đơn</h2><p>Giá 32.000 ₫, chi phí 26.000 ₫.</p><div class="foot"><span>Trà Một Chạm</span><span>04 / 05</span></div></section>
<section class="slide"><p class="k">05 · Gọi vốn</p><h2>3 tỷ cho 3 hub</h2>
<a class="cta" href="#">Đặt lịch gặp</a>
<div class="foot"><span>Trà Một Chạm</span><span>05 / 05</span></div></section>
</body></html>`;
const art = (ident, type, title, content, extra = "") => `<artifact identifier="${ident}" type="${type}" title="${title}"${extra}>\n${content}\n</artifact>`;

// Bản hiện tại của artifact: Synchro gửi ở <current_artifacts> (các bản cũ trong lịch sử chỉ còn thẻ tham chiếu).
function currentArtifact(sys) {
  // Khối thật luôn xuống dòng ngay sau thẻ mở (hướng dẫn hệ thống chỉ nhắc tên thẻ giữa câu).
  const blk = /<current_artifacts>\n([\s\S]*?)<\/current_artifacts>/.exec(sys ?? "");
  const m = blk && /<artifact\b([^>]*)>\n?([\s\S]*?)\n?<\/artifact>/.exec(blk[1]);
  if (!m) return null;
  const g = (k) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1] ?? "";
  return { ident: g("identifier"), type: g("type"), title: g("title").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), body: m[2] };
}
// Như model thật khi được dặn sửa bằng SEARCH/REPLACE: chỉ gửi các đoạn đổi, mỗi đoạn kèm một dòng ngữ cảnh.
function patchOf(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const hunks = [];
  if (A.length === B.length) {
    for (let i = 0; i < A.length; i++) {
      if (A[i] === B[i]) continue;
      let j = i; while (j + 1 < A.length && A[j + 1] !== B[j + 1]) j++;
      const from = Math.max(0, i - 1);
      hunks.push([A.slice(from, j + 1).join("\n"), B.slice(from, j + 1).join("\n")]);
      i = j;
    }
  } else {
    let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let q = 0; while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
    const from = Math.max(0, p - 1);
    hunks.push([A.slice(from, A.length - q).join("\n"), B.slice(from, B.length - q).join("\n")]);
  }
  return hunks.map(([x, y]) => `<<<<<<< SEARCH\n${x}\n=======\n${y}\n>>>>>>> REPLACE`).join("\n");
}
const wantsPatch = (sys) => String(sys ?? "").includes('mode="patch"');
// Artifact sửa: bản patch nếu Synchro yêu cầu (và có bản hiện tại), không thì viết lại toàn bộ như trước.
const edited = (sys, prev, body) => (wantsPatch(sys) && prev.fromCurrent ? `<artifact identifier="${prev.ident}" mode="patch">\n${patchOf(prev.body, body)}\n</artifact>` : art(prev.ident, prev.type, prev.title, body));
/** #rev N: sửa nhỏ, xác định được (dùng để thử sửa artifact nhiều lần liên tiếp, kể cả sau khi gọi công cụ). */
export function revReply(sys, q, msgs) {
  // #badpatch: bản sửa có SEARCH không khớp (thử bước tự vá); Synchro nhắc lại thì viết lại toàn bộ như model thật.
  const prev0 = lastArtifact(msgs, sys);
  if (prev0 && /ban sua artifact chua ap duoc|bản sửa artifact chưa áp được/.test(String(q))) return `Mình viết lại toàn bộ cho chắc:\n\n${art(prev0.ident, prev0.type, prev0.title, prev0.body.replace(/<\/title>/, "</title><!-- healed -->"))}`;
  if (prev0 && /#badpatch/.test(String(q)) && wantsPatch(sys)) return `Đã sửa.\n\n<artifact identifier="${prev0.ident}" mode="patch">\n<<<<<<< SEARCH\ndòng này không có trong tệp\n=======\nthay thế\n>>>>>>> REPLACE\n</artifact>`;
  const n = /#rev\s*(\d+)/.exec(String(q))?.[1];
  const prev = n && lastArtifact(msgs, sys);
  if (!prev) return null;
  const lines = prev.body.split("\n");
  let i = lines.findIndex((l) => /<title>|export default function/.test(l));
  if (i < 0) i = 0;
  lines[i] = /<title>/.test(lines[i]) ? lines[i].replace(/<\/title>.*$/, `</title><!-- rev ${n} -->`) : lines[i].replace(/\s*\/\/ rev \d+$/, "") + ` // rev ${n}`;
  return `Đã sửa lần ${n}.\n\n${edited(sys, prev, lines.join("\n"))}`;
}

function lastArtifact(msgs, sys) {
  const cur = currentArtifact(sys);
  if (cur) return { ...cur, fromCurrent: true };
  for (const m of [...(msgs ?? [])].reverse()) {
    if (m.role !== "assistant") continue;
    const t = typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => b.text ?? "").join("");
    const all = [...t.matchAll(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/g)];
    if (all.length) {
      const [, attrs, body] = all[all.length - 1];
      const g = (k) => new RegExp(`${k}="([^"]*)"`).exec(attrs)?.[1] ?? "";
      return { ident: g("identifier"), type: g("type"), title: g("title"), body: body.replace(/^\n|\n$/g, "") };
    }
  }
  return null;
}

function artifactReply(t, sys, msgs) {
  const ai = !sys.includes("KHÔNG gọi được model AI");
  const prev = lastArtifact(msgs, sys);
  const rev = revReply(sys, t, msgs);
  if (rev) return rev;
  // Sửa lỗi / chỉnh artifact đã có → phiên bản mới cùng identifier (bản sửa SEARCH/REPLACE khi Synchro yêu cầu).
  if (prev && has(t, /\b(gap loi|sua loi|loi)\b/) && prev.body.includes("const items = undefined"))
    return `Lỗi do \`items\` chưa có giá trị nên không đọc được \`.length\`. Mình đã gán danh sách mẫu cho \`items\`:\n\n${edited(sys, { ...prev, type: prev.type || "application/vnd.react" }, prev.body.replace("const items = undefined;", "const items = [\"Táo\", \"Cam\", \"Xoài\"];"))}\n\nGiờ artifact chạy bình thường.`;
  if (prev && has(t, /\b(doi mau|mau xanh la|mau khac|sua|chinh|cap nhat|them|lam lai|giao dien toi|dark)\b/)) {
    let body = prev.body.replace(/blue-/g, "emerald-").replace(/#2f7bf6/gi, "#16a34a").replace(/indigo-/g, "emerald-");
    if (body === prev.body) body = body.replace(/(<\/style>)/, "  body{filter:hue-rotate(110deg)}\n$1");
    return `Đã cập nhật **${prev.title}** sang tông xanh lá. Bạn có thể dùng mũi tên phiên bản ở khung bên phải để so với bản trước.\n\n${edited(sys, prev, body)}`;
  }
  if (has(t, /\b(bang tin nhom|ghi chu nhom|ghi chu chung)\b/)) return `Mình đã làm bảng tin nhóm, ghi chú được lưu lại và dùng chung cho mọi người (window.storage). Bấm nút tên lửa trên khung xem trước để xuất bản thành ứng dụng cho cả tổ chức.\n\n${art("bang-tin-nhom", "text/html", "Bảng tin nhóm", NOTES)}`;
  if (has(t, /#decknum/)) return `Đây là bộ slide gọi vốn:\n\n${art("pitch-tra", "text/html", "Gọi vốn Trà Một Chạm", DECKNUM)}`;
  if (has(t, /#artbug/)) return `Đây là bộ đếm đơn giản:\n\n${art("bo-dem", "application/vnd.react", "Bộ đếm", BUGGY)}`;
  if (has(t, /\b(dich|translat|tro ly|chatbot)\b/) && has(t, /\b(app|ung dung|cong cu)\b/))
    return ai ? `Mình đã làm ứng dụng dịch dùng model AI ngay bên trong artifact. Nhập câu, chọn ngôn ngữ rồi bấm **Dịch**:\n\n${art("tro-ly-dich", "application/vnd.react", "Trợ lý dịch", TRANSLATOR)}`
      : `Mình đã làm giao diện ứng dụng dịch, nhưng **Artifact dùng AI** đang tắt nên nút Dịch sẽ báo lỗi. Bật ở Cài đặt → Khả năng → Artifact dùng AI rồi thử lại.\n\n${art("tro-ly-dich", "application/vnd.react", "Trợ lý dịch", TRANSLATOR)}`;
  if (has(t, /\b(todo|viec can lam|danh sach viec)\b/)) return `Đây là ứng dụng danh sách việc cần làm: thêm việc bằng Enter, đánh dấu xong, lọc và xóa.\n\n${art("todo-app", "application/vnd.react", "Danh sách việc cần làm", TODO)}\n\nMuốn mình thêm hạn chót hay nhãn ưu tiên không?`;
  if (has(t, /\b(dashboard|bang dieu khien|tong quan kinh doanh)\b/)) return `Mình đã dựng bảng điều khiển kinh doanh với số liệu mẫu 6 tháng:\n\n${art("dashboard", "application/vnd.react", "Tổng quan kinh doanh", DASH)}`;
  if (has(t, /\b(may tinh|calculator)\b/) && !has(t, /\b(lai|vay)\b/)) return `Đây là máy tính bỏ túi, dùng được cả bàn phím (Enter để tính, Esc để xóa):\n\n${art("may-tinh", "text/html", "Máy tính", CALC)}`;
  if (has(t, /\b(landing|trang gioi thieu|trang web|website)\b/)) return `Mình đã làm trang giới thiệu cho một quán cà phê mẫu:\n\n${art("landing-cafe", "text/html", "Trang giới thiệu Lumen Coffee", LANDING)}`;
  if (has(t, /\b(logo|svg|bieu tuong)\b/)) return `Đây là logo dạng SVG, phóng to không vỡ nét:\n\n${art("logo", "image/svg+xml", "Logo Synchro", LOGO)}`;
  if (has(t, /\b(cong van)\b/)) return `Mình đã soạn công văn đúng thể thức Nghị định 30/2020; bạn xem trước dạng trang A4 và tải về Word hoặc PDF ở khung bên cạnh:\n\n${art("cong-van-kinh-phi", "application/vnd.synchro.vbhc+json", "Công văn đề nghị bố trí kinh phí", CONG_VAN)}\n\nSố văn bản để trống để văn thư cấp số khi phát hành.`;
  if (has(t, /\b(quyet dinh)\b/)) return `Mình đã soạn quyết định theo thể thức Nghị định 30/2020:\n\n${art("quyet-dinh-to-cong-tac", "application/vnd.synchro.vbhc+json", "Quyết định thành lập Tổ công tác", QUYET_DINH)}\n\nCác căn cứ pháp lý bạn kiểm tra lại cho đúng văn bản đang có hiệu lực.`;
  if (has(t, /\b(ke hoach|tai lieu|soan)\b/) && !has(t, /\b(word|docx|pdf|file|tep)\b/)) return `Mình đã soạn bản kế hoạch, bạn có thể tải về dạng Markdown:\n\n${art("ke-hoach", "text/markdown", "Kế hoạch ra mắt sản phẩm", PLAN)}`;
  return null;
}

// Artifact tắt: trả lời bằng khối code thường, nhắc bật Artifacts.
function noArtifactReply(t) {
  if (has(t, /\b(todo|viec can lam|ung dung|app|trang web|landing|may tinh)\b/) && has(t, /\b(tao|lam|viet|xay)\b/))
    return `Đây là code ứng dụng (Artifacts đang tắt nên mình gửi dạng code; bật ở Cài đặt → Khả năng → Artifacts để xem trước và chạy thử ngay trong chat):\n\n\`\`\`jsx\n${TODO}\n\`\`\``;
  return null;
}

// ---------------------------------------------------------------- hình minh họa trong chat
function vizReply(t) {
  if (has(t, /\b(so do|quy trinh|flowchart|luong|kien truc)\b/))
    return "Quy trình xử lý đơn hàng gồm 5 bước, có nhánh khi thanh toán thất bại:\n\n```mermaid\nflowchart LR\n  A[Khách đặt hàng] --> B{Thanh toán}\n  B -- Thành công --> C[Đóng gói]\n  B -- Thất bại --> D[Gửi nhắc thanh toán]\n  D --> B\n  C --> E[Giao hàng]\n  E --> F[Hoàn tất]\n```\n\nBước dễ nghẽn nhất thường là thanh toán, nên có vòng nhắc lại.";
  if (has(t, /\b(mo phong|tinh lai|vay|widget|thanh truot|tuong tac)\b/))
    return "Kéo các thanh trượt để xem tiền trả hằng tháng thay đổi thế nào:\n\n```widget\n<div style=\"font-family:system-ui;padding:16px 18px;color:#1f2937\">\n  <style>label{display:flex;justify-content:space-between;font-size:13px;margin-top:12px}input{width:100%}.big{font-size:28px;font-weight:600;margin-top:14px}.sub{color:#6b7280;font-size:13px}</style>\n  <label>Số tiền vay <b id=\"pv\"></b></label><input id=\"p\" type=\"range\" min=\"100\" max=\"5000\" step=\"50\" value=\"1500\">\n  <label>Lãi suất / năm <b id=\"rv\"></b></label><input id=\"r\" type=\"range\" min=\"4\" max=\"18\" step=\"0.1\" value=\"9.5\">\n  <label>Thời hạn <b id=\"nv\"></b></label><input id=\"n\" type=\"range\" min=\"1\" max=\"30\" value=\"15\">\n  <div class=\"big\" id=\"m\"></div><div class=\"sub\" id=\"t\"></div>\n  <script>\n    const $=(i)=>document.getElementById(i);\n    function upd(){const P=$('p').value*1e6,r=$('r').value/1200,n=$('n').value*12;const m=P*r/(1-Math.pow(1+r,-n));\n      $('pv').textContent=(+$('p').value).toLocaleString('vi-VN')+' triệu';$('rv').textContent=$('r').value+'%';$('nv').textContent=$('n').value+' năm';\n      $('m').textContent=Math.round(m).toLocaleString('vi-VN')+' ₫ / tháng';$('t').textContent='Tổng lãi phải trả: '+Math.round(m*n-P).toLocaleString('vi-VN')+' ₫';}\n    document.querySelectorAll('input').forEach(i=>i.oninput=upd);upd();\n  </script>\n</div>\n```\n\nLãi suất tăng 1% với khoản vay 1,5 tỷ trong 15 năm làm tiền trả hằng tháng tăng khoảng 900 nghìn đồng.";
  if (has(t, /\b(ty le|ti le|co cau|ti trong|phan tram|thi phan)\b/))
    return "Cơ cấu doanh thu theo kênh bán:\n\n```chart\n{\"type\":\"donut\",\"title\":\"Doanh thu theo kênh\",\"x\":\"kenh\",\"y\":[\"doanhThu\"],\"unit\":\"tr₫\",\"data\":[{\"kenh\":\"Cửa hàng\",\"doanhThu\":420},{\"kenh\":\"Website\",\"doanhThu\":310},{\"kenh\":\"Sàn TMĐT\",\"doanhThu\":260},{\"kenh\":\"Mạng xã hội\",\"doanhThu\":120}]}\n```\n\nCửa hàng vẫn chiếm phần lớn nhất (khoảng 38%), nhưng kênh online cộng lại đã vượt quá nửa.";
  if (has(t, /\b(bieu do|chart|thong ke|doanh thu|xu huong|so lieu)\b/)) {
    const line = has(t, /\b(xu huong|duong|theo thang|tang truong)\b/);
    return `Doanh thu và chi phí 6 tháng đầu năm:\n\n\`\`\`chart\n{"type":"${line ? "line" : "bar"}","title":"Doanh thu và chi phí","x":"thang","y":["Doanh thu","Chi phí"],"unit":"tr₫","data":[{"thang":"T1","Doanh thu":320,"Chi phí":240},{"thang":"T2","Doanh thu":410,"Chi phí":260},{"thang":"T3","Doanh thu":380,"Chi phí":270},{"thang":"T4","Doanh thu":520,"Chi phí":300},{"thang":"T5","Doanh thu":610,"Chi phí":330},{"thang":"T6","Doanh thu":690,"Chi phí":350}]}\n\`\`\`\n\nDoanh thu tăng đều từ tháng 3 và đến tháng 6 đã gấp đôi chi phí.`;
  }
  return null;
}

// ---------------------------------------------------------------- chạy code
const PY = {
  excel: `from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.chart import BarChart, Reference

wb = Workbook()
ws = wb.active
ws.title = "Doanh thu"
ws.append(["Tháng", "Doanh thu (tr₫)", "Chi phí (tr₫)", "Lợi nhuận (tr₫)"])
for i, (dt, cp) in enumerate([(320, 240), (410, 260), (380, 270), (520, 300), (610, 330), (690, 350)], start=2):
    ws.append([f"Tháng {i - 1}", dt, cp, f"=B{i}-C{i}"])
ws.append(["Tổng", "=SUM(B2:B7)", "=SUM(C2:C7)", "=SUM(D2:D7)"])
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="2A78D6")
    c.alignment = Alignment(horizontal="center")
for c in ws[8]:
    c.font = Font(bold=True)
for col, w in zip("ABCD", (12, 18, 16, 18)):
    ws.column_dimensions[col].width = w
chart = BarChart()
chart.title = "Doanh thu và chi phí"
chart.add_data(Reference(ws, min_col=2, max_col=3, min_row=1, max_row=7), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=7))
ws.add_chart(chart, "F2")
wb.save("outputs/bao-cao-doanh-thu.xlsx")
print("Đã tạo outputs/bao-cao-doanh-thu.xlsx: 6 tháng, có công thức và biểu đồ")`,
  word: `from docx import Document
from docx.shared import Pt

doc = Document()
doc.add_heading("Báo cáo tuần", 0)
doc.add_paragraph("Tóm tắt công việc của nhóm trong tuần qua.")
doc.add_heading("Việc đã xong", level=1)
for x in ["Hoàn thiện trang Cài đặt → Khả năng", "Ra mắt Artifacts", "Thêm chạy code và tạo tệp"]:
    doc.add_paragraph(x, style="List Bullet")
doc.add_heading("Số liệu", level=1)
t = doc.add_table(rows=1, cols=3)
t.style = "Light Grid Accent 1"
for c, h in zip(t.rows[0].cells, ["Chỉ số", "Tuần trước", "Tuần này"]):
    c.text = h
for row in [("Người dùng hoạt động", "1.240", "1.410"), ("Tin nhắn", "18.300", "21.050"), ("Artifact đã tạo", "—", "312")]:
    cells = t.add_row().cells
    for c, v in zip(cells, row):
        c.text = v
doc.add_heading("Kế hoạch tuần tới", level=1)
doc.add_paragraph("Tối ưu tốc độ khung xem artifact và thêm mẫu biểu đồ.")
doc.save("outputs/bao-cao-tuan.docx")
print("Đã tạo outputs/bao-cao-tuan.docx")`,
  pptx: `from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = "Synchro — Khả năng mới"
s.placeholders[1].text = "Artifacts · Hình minh họa · Chạy code"
for title, points in [
    ("Artifacts", ["Ứng dụng, trang web, tài liệu trong khung riêng", "Nhiều phiên bản, xem trước và tải về"]),
    ("Hình minh họa trong chat", ["Biểu đồ, sơ đồ, widget tương tác", "Không cần rời cuộc trò chuyện"]),
    ("Chạy code và tạo tệp", ["Word, Excel, PowerPoint, PDF", "Sandbox cô lập, mạng được kiểm soát"]),
]:
    sl = prs.slides.add_slide(prs.slide_layouts[1])
    sl.shapes.title.text = title
    body = sl.placeholders[1].text_frame
    body.text = points[0]
    for p in points[1:]:
        body.add_paragraph().text = p
prs.save("outputs/gioi-thieu-kha-nang.pptx")
print("Đã tạo outputs/gioi-thieu-kha-nang.pptx: 4 slide")`,
  pdf: `from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

c = canvas.Canvas("outputs/hoa-don.pdf", pagesize=A4)
w, h = A4
c.setFillColor(HexColor("#2A78D6")); c.rect(0, h - 90, w, 90, fill=1, stroke=0)
c.setFillColor(HexColor("#FFFFFF")); c.setFont("Helvetica-Bold", 22); c.drawString(40, h - 55, "INVOICE #2026-1025")
c.setFillColor(HexColor("#111111")); c.setFont("Helvetica", 11)
rows = [("Synchro Pro - 1 month", 1, 20.0), ("Extra storage 50 GB", 2, 2.5), ("Priority support", 1, 5.0)]
y = h - 140
c.drawString(40, y, "Item"); c.drawString(360, y, "Qty"); c.drawString(440, y, "Amount")
y -= 20
total = 0
for name, q, p in rows:
    c.drawString(40, y, name); c.drawString(360, y, str(q)); c.drawRightString(520, y, f"\${q * p:.2f}")
    total += q * p; y -= 18
c.line(40, y, 520, y); y -= 20
c.setFont("Helvetica-Bold", 12); c.drawString(360, y, "Total"); c.drawRightString(520, y, f"\${total:.2f}")
c.save()
print(f"Đã tạo outputs/hoa-don.pdf, tổng {total:.2f} USD")`,
  csv: `import csv, random
random.seed(7)
with open("outputs/du-lieu-mau.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["ma_don", "khach_hang", "so_luong", "don_gia", "thanh_tien"])
    for i in range(1, 51):
        q, p = random.randint(1, 9), random.choice([45000, 79000, 120000, 250000])
        w.writerow([f"DH{i:03}", f"Khách {i}", q, p, q * p])
print("Đã tạo outputs/du-lieu-mau.csv với 50 dòng")`,
  png: `import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
thang = ["T1", "T2", "T3", "T4", "T5", "T6"]
dt = [320, 410, 380, 520, 610, 690]
cp = [240, 260, 270, 300, 330, 350]
fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
ax.plot(thang, dt, color="#2a78d6", linewidth=2, marker="o", label="Doanh thu")
ax.plot(thang, cp, color="#eb6834", linewidth=2, marker="o", label="Chi phí")
ax.set_title("Doanh thu và chi phí (triệu ₫)")
ax.grid(axis="y", color="#e5e7eb"); ax.spines[["top", "right"]].set_visible(False)
ax.legend(frameon=False)
fig.tight_layout()
fig.savefig("outputs/bieu-do-doanh-thu.png")
print("Đã lưu outputs/bieu-do-doanh-thu.png")`,
  primes: `import math, time
t = time.time()
N = 1_000_000
sieve = bytearray([1]) * (N + 1)
sieve[0:2] = b"\\x00\\x00"
for i in range(2, int(math.isqrt(N)) + 1):
    if sieve[i]:
        sieve[i * i :: i] = bytearray(len(range(i * i, N + 1, i)))
primes = [i for i in range(N + 1) if sieve[i]]
print(f"Có {len(primes):,} số nguyên tố nhỏ hơn {N:,}")
print("10 số lớn nhất:", primes[-10:])
print(f"Thời gian: {time.time() - t:.3f} giây")`,
  pip: `import subprocess, sys
r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "humanize"], capture_output=True, text=True)
print("pip exit code:", r.returncode)
if r.returncode == 0:
    import importlib, site
    sys.path.insert(0, __import__("os").environ.get("PIP_TARGET", site.getusersitepackages()))
    humanize = importlib.import_module("humanize")
    print("Đã cài humanize", humanize.__version__ if hasattr(humanize, "__version__") else "")
    print("Ví dụ:", humanize.naturalsize(123456789))
else:
    print((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "pip failed")`,
  net: `import urllib.request
for url in ["https://pypi.org/simple/humanize/", "https://example.com/"]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            print(url, "→ truy cập được, HTTP", r.status)
    except Exception as e:
        print(url, "→ bị chặn:", type(e).__name__, str(e)[:120])`,
};

function codeCall(t) {
  const py = (k) => ({ name: "run_code", args: { language: "python", code: PY[k] } });
  if (has(t, /\b(excel|xlsx|bang tinh)\b/)) return py("excel");
  if (has(t, /\b(word|docx)\b/)) return py("word");
  if (has(t, /\b(powerpoint|pptx|slide|thuyet trinh)\b/)) return py("pptx");
  if (has(t, /\b(pdf|hoa don)\b/)) return py("pdf");
  if (has(t, /\b(csv)\b/)) return py("csv");
  if (has(t, /\b(png|anh bieu do|matplotlib)\b/)) return py("png");
  if (has(t, /\b(pip|cai thu vien|cai goi|cai dat goi)\b/)) return py("pip");
  if (has(t, /\b(truy cap mang|thu mang|internet)\b/)) return py("net");
  if (has(t, /\b(so nguyen to|chay code|chay thu code|tinh toan)\b/)) return py("primes");
  return null;
}

// Trả lời sau khi run_code chạy xong: tóm tắt kết quả như model thật.
export function codeDone(out) {
  const o = String(out ?? "");
  if (/^Chạy code đang tắt|^Không chạy được code/.test(o)) return `Mình chưa chạy được code: ${o.slice(0, 300)}`;
  const exit = /exit_code="(-?\d+)"/.exec(o)?.[1];
  const stdout = /<stdout>\n([\s\S]*?)\n<\/stdout>/.exec(o)?.[1]?.trim() ?? "";
  const stderr = /<stderr>\n([\s\S]*?)\n<\/stderr>/.exec(o)?.[1]?.trim() ?? "";
  const files = [...o.matchAll(/outputs\/(\S+) \(([^)]+)\)/g)].map((m) => `**${m[1]}** (${m[2]})`);
  if (exit !== "0") return `Code chạy lỗi (mã thoát ${exit}):\n\n\`\`\`\n${(stderr || stdout).split("\n").slice(-8).join("\n")}\n\`\`\`\n\nNếu lỗi do thiếu thư viện hoặc mạng, hãy kiểm tra Cài đặt → Khả năng.`;
  return `${files.length ? `Mình đã chạy code và tạo ${files.join(", ")}. Tệp ở ngay bên dưới để bạn tải về.` : "Mình đã chạy code, kết quả:"}\n\n\`\`\`\n${stdout.split("\n").slice(0, 12).join("\n")}\n\`\`\``;
}

// Artifact dùng AI (window.synchro.complete): trả lời ngắn gọn như model thật được ứng dụng gọi tới.
const PHRASES = {
  English: { "xin chao! hom nay ban the nao?": "Hello! How are you today?", "cam on ban rat nhieu": "Thank you very much", "chuc mot ngay tot lanh": "Have a nice day" },
  "日本語": { "xin chao! hom nay ban the nao?": "こんにちは！今日はお元気ですか？" },
  "한국어": { "xin chao! hom nay ban the nao?": "안녕하세요! 오늘 어떠세요?" },
  "Français": { "xin chao! hom nay ban the nao?": "Bonjour ! Comment allez-vous aujourd'hui ?" },
};
function artifactAi(q) {
  const m = /^Dịch sang (.+?),[^\n]*\n\n([\s\S]+)$/.exec(q.trim());
  if (m) return PHRASES[m[1]]?.[norm(m[2]).trim()] ?? `[${m[1]}] ${m[2].trim()}`;
  return `Câu trả lời giả lập cho: “${q.trim().slice(0, 160)}”`;
}

// Trả về { text } (trả lời luôn) hoặc { tool: { name, args } } (gọi công cụ), hoặc null.
// "Chỉ và sửa": người dùng chỉ vào một phần tử trong artifact và yêu cầu sửa riêng phần đó → phiên bản mới, chỉ phần đó đổi.
function pointEdit(q, msgs, sys) {
  const prev = lastArtifact(msgs, sys);
  const blk = /<point_edit>([\s\S]*?)<\/point_edit>/.exec(q);
  if (!prev || !blk) return null;
  const get = (k) => new RegExp(`${k}:\\s*([^\\n]*)`).exec(blk[1])?.[1]?.trim() ?? "";
  const sel = get("vị trí"), shown = get("nội dung đang hiện");
  const req = /Yêu cầu:\s*([\s\S]*)$/.exec(q)?.[1]?.trim() ?? "";
  let body = prev.body, what = "";
  // Có số dòng (Alt+Click): như model thật, sửa đúng các dòng đó (kể cả khi cùng nội dung xuất hiện ở chỗ khác).
  const ln = /dòng:\s*(\d+)-(\d+)/.exec(blk[1]);
  const inLines = (fn) => {
    const L = body.split("\n"), a = Number(ln[1]) - 1, b = Math.max(a + 1, Number(ln[2]));
    const seg = L.slice(a, b).join("\n"), next = fn(seg);
    if (next === seg) return false;
    L.splice(a, b - a, ...next.split("\n")); body = L.join("\n"); return true;
  };
  const to = /(?:thành|sang|là)\s*["“'](.+?)["”']\s*$/i.exec(req) ?? /(?:thành|sang|là)\s+(.+)$/i.exec(req);
  if (to && shown && !/\bmàu\b/i.test(req)) {
    const old = shown.split("\n")[0].trim();
    if (ln) { if (inLines((x) => x.replace(old, to[1].trim()))) what = `đổi nội dung “${old.slice(0, 40)}” ở dòng ${ln[1]} thành “${to[1].trim()}”`; }
    else if (body.includes(old)) { body = body.replace(old, to[1].trim()); what = `đổi nội dung “${old.slice(0, 40)}” thành “${to[1].trim()}”`; }
  }
  if (!what && ln && /màu|mau/i.test(req)) {
    const color = /đỏ|do\b/i.test(req) ? "#dc2626" : /xanh lá|xanh la/i.test(req) ? "#16a34a" : /cam/i.test(req) ? "#ea580c" : "#2563eb";
    const style = /react/.test(prev.type) ? `style={{ color: "${color}" }}` : `style="color:${color}"`;
    // Đúng phần tử đã chỉ (mã của nó nằm trong các dòng đó), không thì thẻ đầu tiên của dòng.
    const own = get("mã của phần tử"), tag = /^<([a-zA-Z][\w-]*)/.exec(own)?.[0];
    const mark = (x) => (own && tag && x.includes(own) ? x.replace(own, own.replace(tag, `${tag} ${style}`)) : x.replace(/<([a-zA-Z][\w-]*)/, `<$1 ${style}`));
    if (inLines(mark)) what = `đổi màu phần tử ở dòng ${ln[1]}`;
  }
  if (!what && /màu|mau/i.test(req)) {
    const color = /đỏ|do\b/i.test(req) ? "#dc2626" : /xanh lá|xanh la/i.test(req) ? "#16a34a" : /cam/i.test(req) ? "#ea580c" : "#2563eb";
    body = body.replace(/(<\/style>)/, `  ${sel}{color:${color}!important}\n$1`);
    what = `đổi màu phần tử ${sel.split(" > ").pop()}`;
  }
  if (!what && /(ẩn|xóa|xoá|bỏ)/i.test(req)) { body = body.replace(/(<\/style>)/, `  ${sel}{display:none!important}\n$1`); what = `ẩn phần tử ${sel.split(" > ").pop()}`; }
  if (!what) return null;
  return `Mình chỉ sửa đúng phần bạn chỉ vào (${what}), mọi phần khác giữ nguyên:\n\n${edited(sys, prev, body)}`;
}

// Hỏi lại như model thật: yêu cầu làm sản phẩm lớn mà chưa nói gì về mục đích / phong cách → khối ```ask.
// Lượt ngay sau khi người dùng trả lời thì làm luôn (không hỏi lại).
const ASK = {
  web: [
    { q: "Trang web dùng để làm gì?", options: ["Giới thiệu công ty", "Bán hàng online", "Sự kiện, hội thảo", "Hồ sơ cá nhân"] },
    { q: "Phong cách bạn thích?", options: ["Tối giản, sáng sủa", "Hiện đại, nhiều màu", "Sang trọng, tông tối"] },
    { q: "Cần những phần nào?", options: ["Bảng giá", "Form liên hệ", "Câu hỏi thường gặp", "Đánh giá khách hàng"], multi: true },
  ],
  slides: [
    { q: "Bài thuyết trình cho ai xem?", options: ["Ban giám đốc", "Khách hàng", "Nội bộ nhóm", "Nhà đầu tư"] },
    { q: "Dài khoảng bao nhiêu?", options: ["5 trang", "10 trang", "15 trang trở lên"] },
  ],
};
const askMatch = (t) => t.trim().match(/^(hay |giup (toi|minh) )?(lam|tao|thiet ke|dung|viet)( giup)?( cho (toi|minh|em))?( mot| 1)? (trang web|website|landing page|bai thuyet trinh|slide|bo slide)( (di|nhe|nha|voi|giup))*[.!]?$/);
function askReply(t, msgs) {
  const prev = [...(msgs ?? [])].reverse().find((m) => m.role === "assistant");
  const pt = typeof prev?.content === "string" ? prev.content : Array.isArray(prev?.content) ? prev.content.map((b) => b.text ?? "").join("") : "";
  if (pt.includes("```ask")) return null;
  const m = askMatch(t);
  if (!m) return null;
  const kind = /slide|thuyet trinh/.test(m[8]) ? "slides" : "web";
  return `Để làm đúng ý ngay lần đầu, bạn chọn nhanh giúp mình vài điều:\n\n\`\`\`ask\n${JSON.stringify({ questions: ASK[kind] }, null, 1)}\n\`\`\``;
}

// Nén lịch sử (bàn trộn ngữ cảnh): như model thật, tóm tắt yêu cầu và sản phẩm thành vài gạch đầu dòng ngắn.
function compactReply(q) {
  const asks = [...String(q).matchAll(/Người dùng: ([^\n]+)/g)].map((m) => m[1].trim().slice(0, 120));
  const arts = [...new Set([...String(q).matchAll(/\[artifact "([^"]+)"\]/g)].map((m) => m[1]))];
  return [`- Mục tiêu: ${asks[0] ?? "trò chuyện chung"}.`, ...asks.slice(1, 6).map((x) => `- Người dùng yêu cầu thêm: ${x}.`), ...(arts.length ? [`- Sản phẩm đã tạo: ${arts.join(", ")} (bản hiện tại gửi kèm ở mỗi lượt).`] : []), `- Đã nén ${asks.length} lượt hỏi đáp.`].join("\n");
}

// Giọng nói hai luồng: như model thật, tóm câu trả lời đã viết thành 1–2 câu nói, nhắc xem chi tiết trong khung chat nếu có sản phẩm.
function voiceBrief(q) {
  const ans = /Câu trả lời đã viết:\n([\s\S]*)$/.exec(String(q))?.[1] ?? "";
  const rich = /\[(sản phẩm|khối code)/.test(ans);
  const plain = ans.replace(/\[(sản phẩm|khối code)[^\]]*\]/g, " ").replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
  const first = (plain.match(/[^.!?]+[.!?]?/) ?? [""])[0].trim().replace(/:$/, ".");
  return `${first}${rich ? " Chi tiết mình để trong khung chat." : ""}`.trim() || "Xong rồi.";
}

// Synchro tự kiểm bộ slide lúc model định trả lời xong (server/artcheck.ts AUTO_CHECK). Câu trả lời đã viết được giữ cho người dùng; lần trả lời
// này chỉ để sửa. "#decknum fix": sửa như model thật — đánh số lại nhãn mục sau chỗ nhảy cóc bằng bản sửa SEARCH/REPLACE, kèm một câu cho người dùng.
// "#decknum" thường: giữ nguyên (<keep/>), tests/ui/critic.mjs cần bộ slide còn lệch số để thử phản biện.
function autoCheckReply(msgs) {
  const prev = lastArtifact(msgs, "");
  if (!prev || !JSON.stringify(msgs ?? []).includes("#decknum fix")) return "<keep/>";
  const blocks = [...prev.body.matchAll(/^.*<p class="k">(\d\d) · .*$/gm)].filter(([, n]) => +n >= 4).map(([line, n]) => `<<<<<<< SEARCH\n${line}\n=======\n${line.replace(`>${n} · `, `>${String(+n - 1).padStart(2, "0")} · `)}\n>>>>>>> REPLACE`);
  return `Mình đã chỉnh lại nhãn mục cho liền mạch 01–04.\n\n<artifact identifier="${prev.ident}" mode="patch">\n${blocks.join("\n")}\n</artifact>`;
}

// Hội đồng phản biện: như model thật, đọc mã có số dòng và trả JSON lỗi theo dòng kèm bản sửa (bọc trong khối ```json).
function criticReply(q, sys = "") {
  // Như model thật: viết title / detail theo ngôn ngữ giao diện mà lời nhắc yêu cầu (app/api/critic/route.ts WRITE_IN).
  const en = /Write title and detail in English/.test(sys);
  const out = [];
  for (const [, n, l] of String(q).matchAll(/^\s*(\d+) \| (.*)$/gm)) {
    const line = Number(n);
    if (/=\s*undefined;/.test(l)) out.push({ line_start: line, line_end: line, severity: "high", title: en ? "The variable has no value, so reading .length fails" : "Biến chưa có giá trị nên đọc .length sẽ lỗi", detail: en ? "The variable is set to undefined and a property is read right away when rendering, so the app throws and does not run." : "Biến được gán undefined rồi đọc thuộc tính ngay khi hiển thị, ứng dụng sẽ báo lỗi và không chạy.", suggested_fix: l.replace(/=\s*undefined;/, "= [];") });
    else if (/<input\b/.test(l) && !/aria-label/.test(l)) out.push({ line_start: line, line_end: line, severity: "low", title: en ? "The input has no label for screen readers" : "Ô nhập thiếu nhãn cho trình đọc màn hình", detail: en ? "The input only has placeholder text, so a screen reader cannot tell what it is for." : "Ô nhập chỉ có chữ gợi ý, trình đọc màn hình không đọc được ô này dùng để làm gì.", suggested_fix: l.replace("<input", '<input aria-label="Việc mới"') });
    else if (/class="cta" href="#"/.test(l)) out.push({ line_start: line, line_end: line, severity: "medium", title: en ? "The call-to-action button goes nowhere" : "Nút “Đặt bàn ngay” chưa dẫn tới đâu", detail: en ? "The link points to #, so clicking it only jumps to the top of the page." : "Liên kết trỏ tới # nên bấm vào chỉ nhảy lên đầu trang, khách không đặt bàn được.", suggested_fix: l.replace('href="#"', 'href="tel:0900000000"') });
  }
  return "```json\n" + JSON.stringify({ findings: out }, null, 1) + "\n```";
}

// Skill tự sửa lỗi: như model thật, đọc lỗi và sửa đúng dòng hỏng. Bản giả lập nhận dòng hỏng qua chú thích "BUG … FIX: <dòng đúng>"
// (mỗi lần sửa một dòng, theo thứ tự), không có thì trả KHONG_SUA.
function healReply(q) {
  const src = /<script>\n([\s\S]*?)\n<\/script>/.exec(String(q))?.[1];
  if (!src) return "KHONG_SUA";
  const L = src.split("\n");
  const i = L.findIndex((l) => /(#|\/\/) BUG\b.*FIX: /.test(l));
  if (i < 0) return "KHONG_SUA";
  L[i] = (/^\s*/.exec(L[i])[0]) + L[i].split("FIX: ").pop().trim();
  return "```python\n" + L.join("\n") + "\n```";
}

export function capsReply(sys, q, msgs, toolNames) {
  const t = norm(q);
  const s = String(sys ?? "");
  if (s.includes("<compact_history>")) return { text: compactReply(q) };
  if (s.includes("<skill_heal>")) return { text: healReply(q) };
  // Thử chạy script của skill: "#skillrun <skill> <đường dẫn> [tham số…]".
  // Chỉ đọc trên cùng dòng lệnh: phần ghép thêm phía sau tin nhắn (ghi chú nhớ lại từ bộ não…) không phải tham số.
  const sr = /#skillrun[ \t]+(\S+)[ \t]+(\S+)([^\n]*)/.exec(String(q));
  if (sr && toolNames.includes("run_skill_script")) return { tool: { name: "run_skill_script", args: { name: sr[1], path: sr[2], args: sr[3].trim() ? sr[3].trim().split(/\s+/) : [] } } };
  if (s.includes("<critic_review>")) return { text: criticReply(q, s) };
  if (String(q).includes("<auto_check>")) return { text: autoCheckReply(msgs) };
  if (s.includes("<voice_brief>")) return { text: voiceBrief(q) };
  if (s.includes("<artifacts>") && String(q).includes("<point_edit>")) { const pe = pointEdit(String(q), msgs, s); if (pe) return { text: pe }; }
  if (s.includes("(artifact) gọi tới")) return { text: artifactAi(q) };
  if (s.includes("<ask_user>")) { const a = askReply(t, msgs); if (a) return { text: a }; }
  if (toolNames.includes("run_code")) { const c = codeCall(t); if (c) return { tool: c }; }
  if (s.includes("<artifacts>")) { const a = artifactReply(t, s, msgs); if (a) return { text: a }; }
  else { const a = noArtifactReply(t); if (a) return { text: a }; }
  // Bộ não công ty: trả lời từ đoạn tài liệu được đưa vào, ghi số nguồn như model thật (trừ khi người dùng muốn vẽ biểu đồ, sơ đồ).
  const kn = [...s.matchAll(/<source n="(\d+)" title="([^"]*)">\n([\s\S]*?)\n<\/source>/g)];
  if (kn.length && !/\b(ve|bieu do|so do|chart)\b/.test(t)) {
    const first = (x) => x.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0].slice(0, 300);
    const lines = kn.slice(0, 2).map(([, n, title, body]) => `- Theo **${title}**: ${first(body)} [${n}]`);
    return { text: `Mình tìm thấy trong kho tài liệu của tổ chức:\n\n${lines.join("\n")}\n\nBạn mở phần Nguồn bên dưới để xem nguyên văn.` };
  }
  if (s.includes("<inline_visuals>")) { const v = vizReply(t); if (v) return { text: v }; }
  return null;
}

// ---------------------------------------------------------------- chế độ studio (nút Thiết kế / Trình bày / Tài liệu)
// Như model thật: đọc thư viện skill trong available_skills, tự chọn và load_skill 1-2 skill hợp nhất, rồi làm sản phẩm hoàn chỉnh.
const PREFER = {
  design: ["frontend-design", "design-taste-frontend", "ui-ux-pro-max", "emil-design-eng", "ux-designer", "canvas-design"],
  slides: ["slides", "theme-factory", "design-system", "frontend-design"],
  docs: ["internal-comms", "writing-guidelines", "theme-factory", "brand"],
};
// MOCK_DECK_FILE: dùng tệp HTML này làm bộ slide (thử xuất PowerPoint với bản trình bày bất kỳ, vd. bản dùng bộ CSS thiết kế).
const DECK = process.env.MOCK_DECK_FILE ? process.getBuiltinModule("fs").readFileSync(process.env.MOCK_DECK_FILE, "utf8") : `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Synchro 2026</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;background:#0f172a;font-family:system-ui,sans-serif;color:#f8fafc}
  .slide{width:100vw;height:100vh;padding:8vh 9vw;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(120% 90% at 85% 0%,#1e293b 0%,#0f172a 60%)}
  h1{font-size:6vw;margin:0 0 1.5vh;letter-spacing:-.02em;line-height:1.05}h2{font-size:4vw;margin:0 0 3vh}
  p,li{font-size:2vw;color:#cbd5e1;line-height:1.5}.k{color:#f97316;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:1.4vw}.big{font-size:11vw;font-weight:700;color:#f97316;line-height:1}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2vw}.card{background:#1e293b;border-radius:1.4vw;padding:2.2vw}.card b{display:block;font-size:2.2vw;margin-bottom:.6vw}.card p{font-size:1.5vw;margin:0}
</style></head><body>
<section class="slide"><p class="k">Báo cáo quý III</p><h1>Synchro tăng trưởng<br>nhờ AI có kỷ luật</h1><p>Ba con số, một câu chuyện, một quyết định.</p></section>
<section class="slide"><h2>Người dùng hoạt động</h2><div class="big">+38%</div><p>so với quý trước, chủ yếu từ Artifacts và Synchro Code.</p></section>
<section class="slide"><h2>Ba động lực</h2><div class="grid"><div class="card"><b>Artifacts</b><p>Ứng dụng chạy ngay trong chat.</p></div><div class="card"><b>Plugins</b><p>Thư viện skill cài một lần.</p></div><div class="card"><b>Mức dùng</b><p>Chi phí API minh bạch.</p></div></div></section>
<section class="slide"><h2>Đề xuất</h2><ul><li>Mở Plugins cho mọi nhóm</li><li>Đặt hạn mức theo phòng ban</li><li>Đo hiệu quả theo tuần</li></ul></section>
</body></html>`;
const DOC = `# Đề xuất: Triển khai Plugins cho toàn công ty

**Tóm tắt.** Cài sẵn ba thư viện (Thiết kế, Trình bày, Tài liệu) cho mọi người để sản phẩm làm bằng Synchro đạt chuẩn ngay lần đầu.

## Bối cảnh
- 60% yêu cầu thiết kế phải sửa lại ít nhất hai lần.
- Mỗi nhóm tự viết hướng dẫn riêng, không thống nhất.

## Đề xuất
| Hạng mục | Nội dung | Phụ trách |
|---|---|---|
| Thư viện | Cài Design / Slides / Docs Studio cho cả tổ chức | Quản trị viên |
| Hạn mức | $20 mỗi tuần cho mỗi người | Tài chính |
| Đào tạo | Buổi 30 phút cho từng phòng | Nhóm sản phẩm |

## Kết quả mong đợi
1. Giảm 50% số lần sửa lại.
2. Thời gian ra bản đầu tiên dưới 5 phút.

## Bước tiếp theo
Phê duyệt trước thứ Sáu để bắt đầu từ tuần sau.`;

// Nhận ra loại việc từ câu hỏi (chat thường không bấm nút studio).
const INTENT = [
  ["design", /\b(thiet ke|giao dien|trang web|website|landing|logo|banner|poster|bang mau|ui)\b/],
  ["slides", /\b(slide|trinh bay|thuyet trinh|pitch|deck)\b/],
  ["docs", /\b(tai lieu|de xuat|ke hoach|van ban|thong bao)\b/],
];
const overlap = (t, desc) => { const d = norm(desc); return t.split(/\s+/).some((w) => w.length >= 5 && d.includes(w)); };
// Đã mở một thư viện "lib-…": đọc một skill hợp nhất với yêu cầu rồi trả lời.
function libStep(S, M, t, toolNames) {
  const m = /<library name=\\?"([a-z0-9-]+)\\?">/.exec(M);
  if (!m) return null;
  const lines = [...M.matchAll(/(?:\\n|\n)- ([a-z0-9-]+): ([^\\\n]*)/g)].map((x) => [x[1], x[2]]);
  const loaded = [...M.matchAll(/<skill name=\\?"([^"\\]+)/g)].map((x) => x[1]).filter((n) => !/^(studio|lib)-/.test(n));
  if (!loaded.length && toolNames.includes("load_skill") && lines.length) return { tool: { name: "load_skill", args: { name: (lines.find(([, d]) => overlap(t, d)) ?? lines[0])[0] } } };
  return { text: `Mình đã mở thư viện **${m[1]}**, đọc skill **${loaded.join("**, **") || "(không có)"}** và áp dụng.\n\n\`\`\`css\n.button {\n  transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);\n}\n.button:active {\n  transform: scale(0.97);\n}\n\`\`\`\n\nNhấn xuống thu nhỏ 3% trong 160ms với đường cong ease-out mạnh, đủ để có cảm giác phản hồi mà không rề rà.` };
}
// Sản phẩm mẫu theo loại thư viện: Trình bày → bản trình chiếu, Tài liệu → tài liệu, Thiết kế → logo hoặc landing page.
function product(st, used, q) {
  if (st === "slides") return { text: `${used}\n\n${art("bao-cao-quy-3", "text/html", "Báo cáo quý III", DECK)}\n\nQuyết định chính: một ý mỗi slide, số liệu lớn làm điểm nhấn, nền tối tương phản cao. Xem từng slide, trình chiếu toàn màn hình hoặc tải PDF / PowerPoint ngay trong khung xem trước.` };
  if (st === "docs") return { text: `${used}\n\n${art("de-xuat-plugins", "text/markdown", "Đề xuất triển khai Plugins", DOC)}\n\nQuyết định chính: tóm tắt một câu ở đầu, bảng phân công rõ người chịu trách nhiệm, kết thúc bằng hạn chót. Cần bản Word hoặc PDF thì nói mình nhé.` };
  if (st === "design" && /\b(logo|svg|bieu tuong)\b/.test(norm(q))) return { text: `${used}\n\n${art("logo", "image/svg+xml", "Logo Synchro", LOGO)}\n\nQuyết định chính: hai nét cong lồng nhau thể hiện "đồng bộ", gradient xanh sang tím, góc bo lớn để dùng tốt làm icon ứng dụng.` };
  if (st === "design" && !/\b(hieu ung|chuyen dong|animation|muot)\b/.test(norm(q))) return { text: `${used}\n\n${art("landing-cafe", "text/html", "Trang giới thiệu Lumen Coffee", LANDING)}\n\nQuyết định chính: font serif ấm cho thương hiệu cà phê, bảng màu kem và nâu, nhiều khoảng trắng; bố cục hai cột co về một cột trên điện thoại. Muốn đổi tông màu hay thêm mục thực đơn không?` };
  return { text: `${used}\n\n\`\`\`css\n.button {\n  transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);\n}\n.button:active {\n  transform: scale(0.97);\n}\n\`\`\`\n\nNhấn xuống thu nhỏ 3% trong 160ms với đường cong ease-out mạnh, đủ để có cảm giác phản hồi mà không rề rà.` };
}
// Gợi ý định tuyến của máy chủ (<skill_routing>): đọc thẳng 1-2 skill được gợi ý rồi làm. Yêu cầu sửa / tiếp nối thì ưu tiên
// skill lượt trước đã dùng. Giống model thật: không cần mở thư viện trước khi đã biết tên skill.
function routeStep(S, M, q, toolNames) {
  const r = /<skill_routing>([\s\S]*?)<\/skill_routing>/.exec(S);
  if (!r || !toolNames.includes("load_skill")) return null;
  // Như model thật tự cân nhắc: biểu đồ, sơ đồ trong chat hay chạy code thì làm luôn, không cần đọc skill thiết kế được gợi ý.
  if (/\b(bieu do|so do|mermaid|matplotlib|png|chart|python|cong van|to trinh|bien ban)\b/.test(norm(q))) return null;
  const item = /([a-z0-9-]+)(?: \(thư viện ([^·)]+) · ([a-z0-9-]+)\))?/;
  const hinted = [...r[1].matchAll(/^- ([a-z0-9-]+(?::[a-z0-9-]+)?)(?: \(thư viện ([^·)]+) · ([a-z0-9-]+)\))?:/gm)].map((x) => ({ name: x[1], label: x[2]?.trim(), key: x[3] }));
  const recent = (/đã dùng: ([^\n]*?)\. Nếu/.exec(r[1])?.[1] ?? "").split(/, (?=[a-z0-9-]+(?: \(|$))/).map((p) => item.exec(p)).filter(Boolean).map((x) => ({ name: x[1], label: x[2]?.trim(), key: x[3] }));
  const edit = /\b(doi|sua|them|bot|lam lai|chinh|tong mau)\b/.test(norm(q));
  const want = (edit && recent.length ? [...recent, ...hinted] : [...hinted, ...recent]).slice(0, 2);
  if (!want.length) return null;
  const loaded = [...M.matchAll(/<skill name=\\?"([^"\\]+)/g)].map((x) => x[1]);
  const next = want.find((w) => !loaded.includes(w.name));
  if (next) return { tool: { name: "load_skill", args: { name: next.name } } };
  const st = { "studio-design": "design", "studio-slides": "slides", "studio-docs": "docs" }[want[0].key] ?? "";
  return product(st, `Mình đã tự chọn và đọc skill **${want.map((w) => w.name).join("**, **")}**${want[0].label ? ` (thư viện ${want[0].label})` : ""} rồi áp dụng.`, q);
}
export function studioStep(sys, msgsJson, q, toolNames) {
  if (String(q ?? "").includes("<point_edit>")) return null; // sửa đúng một phần tử: làm luôn, không đọc skill
  if (String(q ?? "").includes("<auto_check>")) return null; // Synchro tự kiểm bộ slide và nhắc sửa: sửa luôn bộ đã viết, không mở thư viện Trình bày làm bộ mới
  if (/#(rev\s*\d+|badpatch|skillrun|longmd\b)/.test(String(q ?? ""))) return null; // lệnh thử: sửa artifact (SEARCH/REPLACE), chạy script skill, câu dài cho bài đo vẽ lại
  if (/#tool=|#media/.test(String(q ?? "")) || /^(Đoạn chat cần (chưng cất|đặt tên):|Hồ sơ:|Trang cần biên soạn:|Các tên trong bộ não:|Các chủ đề cần xếp bản đồ:|Những điều đã biết về người dùng:|Bản người dùng tự viết:|Các skill cần thẩm định:)/.test(String(q ?? ""))) return null; // ép gọi đúng một công cụ / chỉ mô tả tệp nhận được: không mở thư viện skill trước
  const S = String(sys ?? ""), M = String(msgsJson ?? "");
  const m = /<studio name=\\?"(design|slides|docs)\\?">/.exec(S) ?? /<studio name=\\?"(design|slides|docs)\\?">/.exec(M);
  if (!m) {
    // Chat thường: có thư viện studio trong available_skills và câu hỏi đúng loại thì mở thư viện trước.
    const t = norm(q);
    // Yêu cầu mơ hồ (sẽ hỏi lại bằng thẻ lựa chọn): chưa đọc skill.
    if (S.includes("<ask_user>") && !M.includes("```ask") && askMatch(t)) return null;
    // Yêu cầu tạo tệp (Word, PowerPoint, PDF…) đi thẳng tới chạy code.
    if (/\b(word|docx|excel|xlsx|powerpoint|pptx|pdf|csv|file|tep)\b/.test(t)) return null;
    const lib = libStep(S, M, t, toolNames);
    if (lib) return lib;
    const routed = routeStep(S, M, q, toolNames);
    if (routed) return routed;
    const hit = INTENT.find(([k, re]) => S.includes(`<name>studio-${k}</name>`) && re.test(t));
    if (hit && toolNames.includes("load_skill")) return { tool: { name: "load_skill", args: { name: `studio-${hit[0]}` } } };
    // Thư viện của plugin khác ("lib-…"): mở khi từ khóa của yêu cầu có trong mô tả thư viện.
    if (toolNames.includes("load_skill")) for (const x of S.matchAll(/<name>(lib-[a-z0-9-]+)<\/name><description>([^<]*)</g)) if (overlap(t, x[2])) return { tool: { name: "load_skill", args: { name: x[1] } } };
    return null;
  }
  const st = m[1];
  const avail = [...S.matchAll(/<name>([^<]+)<\/name>/g), ...M.matchAll(/(?:\\n|\n)- ([a-z0-9-]+): /g)].map((x) => x[1]);
  const loaded = [...M.matchAll(/<skill name=\\?"([^"\\]+)/g)].map((x) => x[1]).filter((n) => !n.startsWith("studio-"));
  const want = PREFER[st].filter((n) => avail.includes(n));
  const next = want.find((n) => !loaded.includes(n));
  if (toolNames.includes("load_skill") && next && loaded.length < 2) return { tool: { name: "load_skill", args: { name: next } } };
  const used = loaded.length ? `Mình đã mở thư viện ${st === "design" ? "Thiết kế" : st === "slides" ? "Trình bày" : "Tài liệu"}, đọc skill **${loaded.join("**, **")}** và áp dụng.` : "Chưa có thư viện skill cho studio này, mình dùng kinh nghiệm thiết kế chung.";
  return product(st, used, q);
}
