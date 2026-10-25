// Văn bản hành chính theo thể thức Nghị định 30/2020/NĐ-CP (Phụ lục I): model viết nội dung dạng JSON có cấu trúc,
// Synchro tự dàn trang đúng thể thức (khổ A4, lề, phông Times New Roman, cỡ chữ, quốc hiệu, tiêu ngữ, đường kẻ, chữ ký, nơi nhận).
// Dùng chung cho trình duyệt (bản xem trước HTML, in PDF) và máy chủ (tạo tệp .docx, xem vbhcdocx.ts).

export const LOAI = ["cong-van", "quyet-dinh", "to-trinh", "thong-bao", "bao-cao", "ke-hoach", "giay-moi", "bien-ban", "chi-thi", "huong-dan"] as const;
export type Loai = (typeof LOAI)[number];
export const TEN_LOAI: Record<Loai, string> = {
  "cong-van": "", "quyet-dinh": "QUYẾT ĐỊNH", "to-trinh": "TỜ TRÌNH", "thong-bao": "THÔNG BÁO", "bao-cao": "BÁO CÁO", "ke-hoach": "KẾ HOẠCH",
  "giay-moi": "GIẤY MỜI", "bien-ban": "BIÊN BẢN", "chi-thi": "CHỈ THỊ", "huong-dan": "HƯỚNG DẪN",
};
export type Vbhc = {
  loai: Loai;
  coQuanChuQuan?: string;   // cơ quan chủ quản (nếu có), ví dụ "UBND TỈNH BẮC NINH"
  coQuan: string;           // cơ quan ban hành, ví dụ "SỞ TÀI CHÍNH"
  so?: string;              // số văn bản, để trống thì chừa chỗ ghi tay
  kyHieu: string;           // ví dụ "QĐ-UBND", "STC-NS" (công văn: chữ viết tắt cơ quan - đơn vị soạn)
  diaDanh: string;          // ví dụ "Bắc Ninh"
  ngay?: string;            // YYYY-MM-DD; trống thì chừa chỗ "ngày … tháng … năm …"
  trichYeu: string;         // nội dung tóm tắt; công văn ghi sau "V/v"
  thamQuyen?: string;       // quyết định: thẩm quyền ban hành, ví dụ "CHỦ TỊCH ỦY BAN NHÂN DÂN TỈNH BẮC NINH"
  canCu?: string[];         // quyết định: các dòng "Căn cứ …;"
  kinhGui?: string[];       // công văn, tờ trình, giấy mời
  noiDung: string[];        // các đoạn; "# Tiêu đề mục" là đề mục; "Điều 1. …" in đậm phần "Điều 1."; **chữ đậm**
  quyenHan?: string;        // "TM. ỦY BAN NHÂN DÂN", "KT. GIÁM ĐỐC"…
  chucVu: string;           // "CHỦ TỊCH", "PHÓ GIÁM ĐỐC"…
  nguoiKy: string;          // họ tên người ký
  noiNhan?: string[];       // mỗi dòng một nơi nhận, dòng cuối thường là "Lưu: VT, …"
};

const s = (v: unknown, max = 400) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const arr = (v: unknown, max = 60, len = 2000) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim().slice(0, len) : "")).filter(Boolean).slice(0, max) : []);

/** Đọc JSON model viết; thiếu trường bắt buộc thì báo rõ để model sửa. */
export function parseVbhc(raw: string): { spec: Vbhc | null; error?: string } {
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { spec: null, error: "Nội dung văn bản không phải JSON hợp lệ." }; }
  const loai = (LOAI as readonly string[]).includes(String(o.loai)) ? (o.loai as Loai) : null;
  if (!loai) return { spec: null, error: `Thiếu "loai" (một trong: ${LOAI.join(", ")}).` };
  const spec: Vbhc = {
    loai, coQuanChuQuan: s(o.coQuanChuQuan, 120).toUpperCase() || undefined, coQuan: s(o.coQuan, 160).toUpperCase(), so: s(o.so, 20) || undefined, kyHieu: s(o.kyHieu, 40).toUpperCase(),
    diaDanh: s(o.diaDanh, 60), ngay: /^\d{4}-\d{2}-\d{2}$/.test(String(o.ngay ?? "")) ? String(o.ngay) : undefined, trichYeu: s(o.trichYeu, 400),
    thamQuyen: s(o.thamQuyen, 200).toUpperCase() || undefined, canCu: arr(o.canCu, 20, 600), kinhGui: arr(o.kinhGui, 20, 200), noiDung: arr(o.noiDung, 200, 4000),
    quyenHan: s(o.quyenHan, 80).toUpperCase() || undefined, chucVu: s(o.chucVu, 80).toUpperCase(), nguoiKy: s(o.nguoiKy, 80), noiNhan: arr(o.noiNhan, 30, 200),
  };
  const miss = [!spec.coQuan && "coQuan", !spec.kyHieu && "kyHieu", !spec.diaDanh && "diaDanh", !spec.trichYeu && "trichYeu", !spec.noiDung.length && "noiDung", !spec.chucVu && "chucVu", !spec.nguoiKy && "nguoiKy"].filter(Boolean);
  if (miss.length) return { spec: null, error: `Thiếu trường bắt buộc: ${miss.join(", ")}.` };
  return { spec };
}

// "Hà Nội, ngày 05 tháng 3 năm 2026": ngày dưới 10 và tháng 1, 2 thêm số 0 phía trước (Phụ lục I, NĐ 30/2020).
export function dateLine(v: Vbhc) {
  if (!v.ngay) return `${v.diaDanh}, ngày     tháng     năm ${new Date().getFullYear()}`;
  const [y, m, d] = v.ngay.split("-").map(Number);
  return `${v.diaDanh}, ngày ${String(d).padStart(2, "0")} tháng ${m <= 2 ? String(m).padStart(2, "0") : m} năm ${y}`;
}
export const soLine = (v: Vbhc) => `Số: ${v.so ? v.so : "       "}/${v.kyHieu}`;
export const tenLoai = (v: Vbhc) => TEN_LOAI[v.loai];
export const noiNhanLines = (v: Vbhc) => (v.noiNhan?.length ? v.noiNhan : ["Như trên;", "Lưu: VT."]).map((x) => `- ${x.replace(/^[-–•]\s*/, "")}`);

// Đoạn nội dung → các mảnh chữ (đậm / thường): "Điều 1." đậm, **…** đậm.
export type Run = { t: string; b?: boolean; i?: boolean };
export type Para = { kind: "p" | "h"; runs: Run[] };
export function paras(lines: string[]): Para[] {
  return lines.map((l) => {
    if (/^#{1,3}\s+/.test(l)) return { kind: "h", runs: [{ t: l.replace(/^#{1,3}\s+/, ""), b: true }] };
    const out: Run[] = [];
    const m = /^(Điều\s+\d+\.)\s*/.exec(l);
    let rest = l;
    if (m) { out.push({ t: m[1] + " ", b: true }); rest = l.slice(m[0].length); }
    for (const part of rest.split(/(\*\*[^*]+\*\*)/)) if (part) out.push(part.startsWith("**") && part.endsWith("**") ? { t: part.slice(2, -2), b: true } : { t: part });
    return { kind: "p", runs: out };
  });
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const runs = (r: Run[]) => r.map((x) => (x.b ? `<b>${esc(x.t)}</b>` : x.i ? `<i>${esc(x.t)}</i>` : esc(x.t))).join("");

/** Bản xem trước khổ A4 (cũng dùng để in ra PDF), đúng các thông số thể thức như tệp .docx.
 *  zoom: thu nhỏ trang cho vừa bề ngang khung xem (khi in luôn đúng khổ A4). */
export function vbhcHtml(v: Vbhc, title = "Văn bản", zoom = 1): string {
  const cv = v.loai === "cong-van", qd = v.loai === "quyet-dinh";
  const kinhGui = v.kinhGui?.length ? (v.kinhGui.length === 1
    ? `<p class="kg">Kính gửi: ${esc(v.kinhGui[0])}</p>`
    : `<div class="kgm"><span>Kính gửi:</span><div>${v.kinhGui.map((k) => `<p>- ${esc(k.replace(/^[-–•]\s*/, ""))}</p>`).join("")}</div></div>`) : "";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:20mm 15mm 20mm 30mm}
*{box-sizing:border-box}html{background:#e9e9e6}body{margin:0;font-family:"Times New Roman",Times,serif;color:#000}
.page{width:210mm;min-height:297mm;margin:12px auto;padding:20mm 15mm 20mm 30mm;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18)}
@media screen{body{zoom:${zoom > 0 && zoom < 1 ? zoom.toFixed(3) : 1}}}
@media print{html{background:#fff}.page{margin:0;padding:0;box-shadow:none;width:auto;min-height:0}}
p{margin:0}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:0}
.hd td{text-align:center}.hd .l{width:42%}.hd .r{width:58%}
.cq0{font-size:13pt;text-transform:uppercase}.cq{font-size:13pt;font-weight:bold;text-transform:uppercase}
.qh{font-size:12pt;font-weight:bold;white-space:nowrap}.tn{font-size:13pt;font-weight:bold}
.ln{height:0;border-top:1px solid #000;margin:2px auto 0}.ln.cq-l{width:32%}.ln.tn-l{width:63%}.ln.ty-l{width:30%;margin-top:3px}
.so{font-size:13pt;margin-top:6pt}.vv{font-size:12pt;margin-top:2pt;padding:0 6pt}.dt{font-size:14pt;font-style:italic;margin-top:12pt}
.loai{font-size:14pt;font-weight:bold;text-align:center;margin-top:18pt}.ty{font-size:14pt;font-weight:bold;text-align:center}
.tq{font-size:14pt;font-weight:bold;text-align:center;text-transform:uppercase;margin-top:12pt}
.cc{font-size:14pt;font-style:italic;text-align:justify;text-indent:1cm;margin-top:6pt;line-height:1.2}
.qdl{font-size:14pt;font-weight:bold;text-align:center;margin:12pt 0 6pt}
.kg{font-size:14pt;text-align:center;margin:12pt 0 6pt}.kgm{display:flex;justify-content:center;gap:6pt;font-size:14pt;margin:12pt 0 6pt}.kgm p{text-align:left}
.nd p{font-size:14pt;text-align:justify;text-indent:1cm;margin-top:6pt;line-height:1.2}.nd p.h{text-indent:0;font-weight:bold}
.ft{margin-top:12pt}.ft .l{width:45%}.ft .r{width:55%;text-align:center}
.nn{font-size:12pt;font-weight:bold;font-style:italic}.nn-i{font-size:11pt}
.qh2{font-size:14pt;font-weight:bold}.ky{height:22mm}.ng{font-size:14pt;font-weight:bold}
</style></head><body><div class="page">
<table class="hd"><tr>
<td class="l">${v.coQuanChuQuan ? `<p class="cq0">${esc(v.coQuanChuQuan)}</p>` : ""}<p class="cq">${esc(v.coQuan)}</p><div class="ln cq-l"></div>
<p class="so">${esc(soLine(v))}</p>${cv ? `<p class="vv">V/v ${esc(v.trichYeu)}</p>` : ""}</td>
<td class="r"><p class="qh">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p><p class="tn">Độc lập - Tự do - Hạnh phúc</p><div class="ln tn-l"></div><p class="dt">${esc(dateLine(v))}</p></td>
</tr></table>
${cv ? "" : `<p class="loai">${esc(tenLoai(v))}</p><p class="ty">${esc(v.trichYeu)}</p><div class="ln ty-l"></div>`}
${qd && v.thamQuyen ? `<p class="tq">${esc(v.thamQuyen)}</p>` : ""}
${qd ? (v.canCu ?? []).map((c) => `<p class="cc">${esc(c)}</p>`).join("") : ""}
${qd ? `<p class="qdl">QUYẾT ĐỊNH:</p>` : ""}
${!qd ? kinhGui : ""}
<div class="nd">${paras(v.noiDung).map((p) => `<p${p.kind === "h" ? ' class="h"' : ""}>${runs(p.runs)}</p>`).join("")}</div>
<table class="ft"><tr>
<td class="l"><p class="nn">Nơi nhận:</p>${noiNhanLines(v).map((x) => `<p class="nn-i">${esc(x)}</p>`).join("")}</td>
<td class="r">${v.quyenHan ? `<p class="qh2">${esc(v.quyenHan)}</p>` : ""}<p class="qh2">${esc(v.chucVu)}</p><div class="ky"></div><p class="ng">${esc(v.nguoiKy)}</p></td>
</tr></table>
</div></body></html>`;
}
