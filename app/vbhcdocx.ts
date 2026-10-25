// Tệp Word (.docx) của văn bản hành chính, đúng thể thức Nghị định 30/2020 (chỉ chạy ở máy chủ).
// Khổ A4; lề trên, dưới 20 mm, trái 30 mm, phải 15 mm; Times New Roman; cỡ chữ từng thành phần theo Phụ lục I.
// Đường kẻ dưới tên cơ quan, tiêu ngữ và trích yếu là viền dưới của một đoạn trống có thụt lề hai bên (độ dài 1/3 - 1/2 dòng chữ).
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import { dateLine, noiNhanLines, paras, soLine, tenLoai, type Vbhc } from "./vbhc";

// mm → twip, làm tròn (hàm của thư viện làm tròn xuống: A4 ra 11905 thay vì 11906 chuẩn).
const mm = (n: number) => Math.round((n * 1440) / 25.4);
const FONT = "Times New Roman";
const pt = (n: number) => n * 2; // cỡ chữ docx tính bằng nửa point
type RunOpt = { size: number; bold?: boolean; italics?: boolean; caps?: boolean };
const run = (t: string, o: RunOpt) => new TextRun({ text: o.caps ? t.toUpperCase() : t, font: FONT, size: pt(o.size), bold: o.bold, italics: o.italics });
const center = (t: string, o: RunOpt, before = 0, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: before * 20, after: after * 20 }, children: [run(t, o)] });
// Đoạn (một khoảng trắng 1pt, vì vài trình đọc bỏ viền của đoạn rỗng) có viền dưới, thụt lề hai bên để đường kẻ dài vừa phải, nằm giữa cột.
const rule = (sideMm: number, before = 0) => new Paragraph({ spacing: { before: before * 20, after: 0, line: 120 }, indent: { left: mm(sideMm), right: mm(sideMm) }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } }, children: [new TextRun({ text: "\u00A0", size: 2 })] });
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NOB = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const cell = (wMm: number, children: Paragraph[]) => new TableCell({ width: { size: mm(wMm), type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children });
const twoCols = (l: number, r: number, left: Paragraph[], right: Paragraph[]) =>
  new Table({ layout: TableLayoutType.FIXED, width: { size: mm(l + r), type: WidthType.DXA }, columnWidths: [mm(l), mm(r)], borders: NOB, rows: [new TableRow({ children: [cell(l, left), cell(r, right)] })] });

// Khổ giấy A4 210 mm, lề trái 30 + phải 15 → vùng chữ rộng 165 mm.
const W = 165, HL = 70, HR = W - HL, FL = 75, FR = W - FL;

export async function vbhcDocx(v: Vbhc): Promise<Buffer> {
  const cv = v.loai === "cong-van", qd = v.loai === "quyet-dinh";
  const body = (p: ReturnType<typeof paras>[number]) => new Paragraph({
    alignment: p.kind === "h" ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    indent: p.kind === "h" ? undefined : { firstLine: mm(10) },
    spacing: { before: 120, after: 0, line: 288 },
    children: p.runs.map((r) => run(r.t, { size: 14, bold: r.b, italics: r.i })),
  });
  const header = twoCols(HL, HR, [
    ...(v.coQuanChuQuan ? [center(v.coQuanChuQuan, { size: 13 })] : []),
    center(v.coQuan, { size: 13, bold: true }),
    rule(24),
    center(soLine(v), { size: 13 }, 6),
    ...(cv ? [center(`V/v ${v.trichYeu}`, { size: 12 }, 2)] : []),
  ], [
    center("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { size: 12, bold: true }),
    center("Độc lập - Tự do - Hạnh phúc", { size: 13, bold: true }),
    rule(17),
    center(dateLine(v), { size: 14, italics: true }, 12),
  ]);
  const kinhGui = v.kinhGui?.length ? (v.kinhGui.length === 1
    ? [center(`Kính gửi: ${v.kinhGui[0]}`, { size: 14 }, 12, 6)]
    : [center("Kính gửi:", { size: 14 }, 12), ...v.kinhGui.map((k) => new Paragraph({ indent: { left: mm(55) }, children: [run(`- ${k.replace(/^[-–•]\s*/, "")}`, { size: 14 })] }))]) : [];
  const children = [
    header,
    ...(cv ? [] : [center(tenLoai(v), { size: 14, bold: true }, 18), center(v.trichYeu, { size: 14, bold: true }), rule(62, 2)]),
    ...(qd && v.thamQuyen ? [center(v.thamQuyen, { size: 14, bold: true }, 12)] : []),
    ...(qd ? (v.canCu ?? []).map((c) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: mm(10) }, spacing: { before: 120, line: 288 }, children: [run(c, { size: 14, italics: true })] })) : []),
    ...(qd ? [center("QUYẾT ĐỊNH:", { size: 14, bold: true }, 12, 6)] : kinhGui),
    ...paras(v.noiDung).map(body),
    new Paragraph({ spacing: { before: 240 }, children: [] }),
    twoCols(FL, FR, [
      new Paragraph({ children: [run("Nơi nhận:", { size: 12, bold: true, italics: true })] }),
      ...noiNhanLines(v).map((x) => new Paragraph({ children: [run(x, { size: 11 })] })),
    ], [
      ...(v.quyenHan ? [center(v.quyenHan, { size: 14, bold: true })] : []),
      center(v.chucVu, { size: 14, bold: true }),
      ...[0, 1, 2, 3].map(() => new Paragraph({ children: [] })),
      center(v.nguoiKy, { size: 14, bold: true }),
    ]),
  ];
  const doc = new Document({
    creator: "Synchro", title: `${tenLoai(v) || "Công văn"} ${v.trichYeu}`.trim(),
    styles: { default: { document: { run: { font: FONT, size: pt(14) } } } },
    sections: [{ properties: { page: { size: { width: mm(210), height: mm(297) }, margin: { top: mm(20), bottom: mm(20), left: mm(30), right: mm(15) } } }, children }],
  });
  return Packer.toBuffer(doc);
}
