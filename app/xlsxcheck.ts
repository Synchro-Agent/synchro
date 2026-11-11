// Chốt "ô tổng phải là công thức sống" cho tệp Excel model tạo bằng run_code: đọc thẳng XML trong tệp .xlsx (không cần LibreOffice),
// tìm hàng có nhãn tổng / tổng phụ / chênh lệch / tăng trưởng và cột có tiêu đề như vậy, báo các ô số ghi cứng (không có công thức) trong đó.
// Kết quả đi vào <excel_totals> của kết quả run_code để model sửa thành =SUM(…), =(D11-C11)/C11… trước khi giao (chatengine.ts).
// Chỉ báo, không sửa tệp. Tệp hỏng, không phải xlsx: bỏ qua im lặng (kiểm tra khác đã báo).
import JSZip from "jszip";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
// Nhãn của hàng / cột tổng hợp. "Tổng" đứng đầu nhãn ("Tổng doanh thu", "TỔNG CỘNG"), hoặc từ khóa tiếng Anh ở bất kỳ đâu.
// Không tính "Tổng quan", "Tổng giám đốc", "Công ty…": chữ "tổng" đứng một mình chỉ tính khi không phải các từ ghép đó.
const TOTAL = /(?:^|[\s(])(?:tong(?! (?:quan|giam doc|thong|bien tap|dai ly|cuc|hop tac))|ca nam|luy ke|chenh lech|tang truong|bien loi nhuan|loi nhuan rong|total|subtotal|sub-total|grand total|sum|net|variance|growth|cagr)(?:$|[\s):])/;
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml: string) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

type Cell = { ref: string; col: number; row: number; formula: boolean; num: number | null; text: string };
export type HardTotal = { sheet: string; ref: string; label: string; value: number };

function cellsOf(xml: string, shared: string[]): Cell[] {
  const out: Cell[] = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1], inner = m[2] ?? "";
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const t = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n", v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const formula = /<f\b/.test(inner);
    const text = t === "s" && v !== undefined ? shared[Number(v)] ?? "" : t === "inlineStr" ? textOf(inner) : t === "str" ? decode(v ?? "") : "";
    const num = (t === "n" || t === "") && v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    out.push({ ref: `${ref[1]}${ref[2]}`, col: colNum(ref[1]), row: Number(ref[2]), formula, num, text });
  }
  return out;
}

/** Ô số ghi cứng nằm ở hàng hay cột tổng hợp, theo từng sheet. */
export async function hardTotals(buf: Buffer | Uint8Array, max = 12): Promise<HardTotal[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { return []; }
  const sst = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  // Tên sheet theo workbook.xml + quan hệ; không đọc được thì dùng tên tệp.
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "", rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(?:xl\/)?/, "xl/")]));
  const names = new Map([...wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)].map((m) => [target.get(m[2]) ?? "", decode(m[1])]));
  const out: HardTotal[] = [];
  for (const path of Object.keys(zip.files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()) {
    const xml = await zip.file(path)!.async("string");
    const sheet = names.get(path) ?? path.replace(/^.*\//, "").replace(/\.xml$/, "");
    const cells = cellsOf(xml, shared), seen = new Set<string>();
    const flag = (c: Cell, label: string) => { if (seen.has(c.ref) || c.formula || c.num === null) return; seen.add(c.ref); out.push({ sheet, ref: c.ref, label: label.slice(0, 40), value: c.num }); };
    const byRow = new Map<number, Cell[]>(), byCol = new Map<number, Cell[]>();
    for (const c of cells) { (byRow.get(c.row) ?? byRow.set(c.row, []).get(c.row)!).push(c); (byCol.get(c.col) ?? byCol.set(c.col, []).get(c.col)!).push(c); }
    for (const row of byRow.values()) {
      const label = row.find((c) => c.text && TOTAL.test(fold(c.text.trim())));
      // Hàng tổng: mọi ô số bên phải nhãn. Hàng không có công thức nào và chỉ một số (vd. "Tổng số nhân viên: 12") vẫn báo: model tự xem có nên là =COUNTA(…) không.
      if (label) for (const c of row) if (c.col > label.col) flag(c, label.text);
    }
    for (const col of byCol.values()) {
      const head = col.find((c) => c.text && TOTAL.test(fold(c.text.trim())));
      if (!head) continue;
      // Cột tổng: các ô số bên dưới tiêu đề, trong cùng khối (dừng ở ô trống đầu tiên cách hơn 1 hàng).
      let last = head.row;
      for (const c of col.filter((x) => x.row > head.row).sort((a, b) => a.row - b.row)) { if (c.row - last > 2) break; last = c.row; flag(c, head.text); }
    }
  }
  return out.slice(0, max);
}

/** Thẻ gửi model sau run_code: liệt kê ô tổng ghi cứng trong các tệp Excel vừa tạo (rỗng nếu không có). */
export async function totalsNote(files: { path: string; data: Buffer }[]): Promise<string> {
  const rows: string[] = [];
  for (const f of files.filter((x) => /\.xlsx$/i.test(x.path) && !/(?:^|\/)_preview\//.test(x.path)).slice(0, 6)) {
    const bad = await hardTotals(f.data).catch(() => []);
    if (bad.length) rows.push(`${f.path.replace(/^outputs\//, "")}: ${bad.map((b) => `${b.sheet}!${b.ref} (${b.label}) = ${b.value}`).join("; ")}`);
  }
  return rows.length ? `\n<excel_totals>\nÔ tổng / tổng phụ / chênh lệch / tăng trưởng đang là SỐ GHI CỨNG, không phải công thức sống: ${rows.join(" | ")}. Sửa thành công thức (=SUM(…), =(D11-C11)/C11…) trỏ về ô nhập rồi chạy lại; số đúng ngẫu nhiên vẫn sai khi người dùng đổi dữ liệu.\n</excel_totals>` : "";
}
