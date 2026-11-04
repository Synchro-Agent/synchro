// Tài liệu Markdown → tệp Word thật (.docx, chỉ chạy ở máy chủ). Trước đây "Word" là HTML đổi tên .doc: Word mở được nhưng biểu mẫu nộp tệp có thể từ chối.
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { DocBlock, Run } from "./htmlblocks";

const FONT = "Calibri", MONO = "Consolas";
// A4, lề 2,54 cm: vùng chữ 9026 twip (dùng chung cho độ rộng bảng, ảnh tối đa ~ 600 px).
const TEXT_W = 9026, IMG_W = 600;
const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const LINE = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const str = (v: unknown, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : "");

function textRun(r: Run) {
  return new TextRun({ text: str(r.t), bold: !!r.b, italics: !!r.i, strike: !!r.s, break: r.br ? 1 : undefined,
    ...(r.u || r.href ? { underline: {} } : {}), ...(r.href ? { color: "0563C1" } : {}),
    ...(r.code ? { font: MONO, size: 20, shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" } } : {}) });
}
function runs(list: unknown) {
  return (Array.isArray(list) ? (list as Run[]) : []).slice(0, 5000).map((r) => {
    const href = str(r?.href, 2000);
    return /^(https?:|mailto:)/i.test(href) ? new ExternalHyperlink({ link: href, children: [textRun(r)] }) : textRun(r);
  });
}
// Ảnh: chỉ nhận ảnh nhúng; webp, gif đổi sang PNG vì Word không đọc được hết. Rộng hơn vùng chữ thì thu lại.
async function image(src: string): Promise<Paragraph | null> {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) return null;
  try {
    const sharp = (await import("sharp")).default;
    let data: Buffer = Buffer.from(m[2], "base64");
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return null;
    const jpg = m[1] === "jpeg" || m[1] === "jpg";
    if (!jpg && m[1] !== "png") data = await sharp(data).png().toBuffer();
    const w = Math.min(meta.width, IMG_W), h = Math.round((meta.height * w) / meta.width);
    return new Paragraph({ spacing: { before: 80, after: 120 }, children: [new ImageRun({ type: jpg ? "jpg" : "png", data, transformation: { width: w, height: h } })] });
  } catch { return null; }
}

export async function blocksToDocx(blocks: DocBlock[], title: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const b of Array.isArray(blocks) ? blocks.slice(0, 20_000) : []) {
    switch (b?.k) {
      case "h": children.push(new Paragraph({ heading: HEAD[Math.max(0, Math.min(5, (Number(b.level) || 1) - 1))], children: runs(b.runs) })); break;
      case "p": children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.runs) })); break;
      case "quote": children.push(new Paragraph({ spacing: { after: 120 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 8 } }, children: runs(b.runs) })); break;
      case "li": {
        const level = Math.max(0, Math.min(8, Number(b.level) || 0));
        children.push(new Paragraph({ spacing: { after: 60 }, ...(b.ordered ? { numbering: { reference: "ol", level, instance: Number(b.list) || 0 } } : { bullet: { level } }), children: runs(b.runs) }));
        break;
      }
      case "code": str(b.text).split("\n").forEach((l) => children.push(new Paragraph({ spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, color: "auto", fill: "F6F6F6" }, children: [new TextRun({ text: l, font: MONO, size: 20 })] }))); children.push(new Paragraph({ spacing: { after: 60 }, children: [] })); break;
      case "hr": children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } }, children: [] })); break;
      case "table": {
        const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000);
        const n = rows.reduce((a, r) => Math.max(a, Array.isArray(r?.cells) ? r.cells.length : 0), 0);
        if (!n) break;
        const w = Math.floor(TEXT_W / n);
        children.push(new Table({ width: { size: w * n, type: WidthType.DXA }, columnWidths: Array(n).fill(w), borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE },
          rows: rows.map((r) => new TableRow({ tableHeader: !!r.head, children: Array.from({ length: n }, (_, i) => new TableCell({
            width: { size: w, type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 90, right: 90 }, ...(r.head ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" } } : {}),
            children: [new Paragraph({ children: runs((r.cells?.[i] ?? []).map((x) => (r.head ? { ...x, b: 1 as const } : x))) })],
          })) })) }));
        children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
        break;
      }
      case "img": {
        const p = await image(str(b.src, 40_000_000));
        if (p) children.push(p);
        else if (str(b.alt)) children.push(new Paragraph({ children: [new TextRun({ text: str(b.alt), italics: true })] }));
        break;
      }
    }
  }
  const lv = (level: number, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) => ({ level, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 360 } } } });
  const doc = new Document({
    creator: "Synchro", title: title.slice(0, 200),
    styles: { default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 276 } } },
      heading1: { run: { font: FONT, size: 40, bold: true, color: "1F1F1F" }, paragraph: { spacing: { before: 240, after: 160 } } },
      heading2: { run: { font: FONT, size: 30, bold: true, color: "1F1F1F" }, paragraph: { spacing: { before: 280, after: 120 } } },
      heading3: { run: { font: FONT, size: 26, bold: true, color: "1F1F1F" }, paragraph: { spacing: { before: 220, after: 100 } } },
      heading4: { run: { font: FONT, size: 24, bold: true, color: "1F1F1F" }, paragraph: { spacing: { before: 180, after: 80 } } } } },
    numbering: { config: [{ reference: "ol", levels: [lv(0, LevelFormat.DECIMAL, "%1."), lv(1, LevelFormat.LOWER_LETTER, "%2."), lv(2, LevelFormat.LOWER_ROMAN, "%3."), lv(3, LevelFormat.DECIMAL, "%4."), lv(4, LevelFormat.LOWER_LETTER, "%5."), lv(5, LevelFormat.LOWER_ROMAN, "%6."), lv(6, LevelFormat.DECIMAL, "%7."), lv(7, LevelFormat.LOWER_LETTER, "%8."), lv(8, LevelFormat.LOWER_ROMAN, "%9.")] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBuffer(doc);
}
