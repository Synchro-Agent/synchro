// Chốt "ô tổng phải là công thức sống" cho tệp Excel model tạo bằng run_code: đọc thẳng XML trong tệp .xlsx (không cần LibreOffice),
// tìm hàng có nhãn tổng / tổng phụ / chênh lệch / tăng trưởng và cột có tiêu đề như vậy, báo các ô số ghi cứng (không có công thức) trong đó.
// Kết quả đi vào <excel_totals> của kết quả run_code để model sửa thành =SUM(…), =(D11-C11)/C11… trước khi giao (chatengine.ts).
// Chỉ báo, không sửa tệp. Tệp hỏng, không phải xlsx: bỏ qua im lặng (kiểm tra khác đã báo).
import JSZip from "jszip";
import { readCapped, ZipTooBig } from "../scripts/zipguard.mjs";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
// Nhãn của hàng / cột tổng hợp. "Tổng" đứng đầu nhãn ("Tổng doanh thu", "TỔNG CỘNG"), hoặc từ khóa tiếng Anh ở bất kỳ đâu.
// Không tính "Tổng quan", "Tổng giám đốc", "Công ty…": chữ "tổng" đứng một mình chỉ tính khi không phải các từ ghép đó.
const TOTAL = /(?:^|[\s(])(?:tong(?! (?:quan|giam doc|thong|bien tap|dai ly|cuc|hop tac))|ca nam|luy ke|chenh lech|tang truong|bien loi nhuan|loi nhuan rong|total|subtotal|sub-total|grand total|sum|net|variance|growth|cagr)(?:$|[\s):])/;
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// Đọc XML bằng indexOf, không dùng regex lười kiểu <c…>([\s\S]*?)</c>: tệp do code người dùng viết, một sheet "<c r="A1">" lặp 1 MB không có </c>
// làm regex đó dò tới cuối chuỗi ở mỗi vị trí (bậc hai, vài chục giây chặn cả tiến trình chung). Ở đây mỗi byte chỉ đi qua một lần:
// không còn thẻ đóng phía sau thì dừng hẳn.
const isWord = (ch: string | undefined) => !!ch && /\w/.test(ch);
/** Các thẻ <name …> / <name …/> (kèm nội dung tới </name> nếu có): trả về phần thuộc tính và nội dung. */
function* elems(xml: string, name: string, body: boolean): Generator<{ attrs: string; inner: string }> {
  const open = `<${name}`, close = `</${name}>`;
  for (let i = xml.indexOf(open); i >= 0; ) {
    if (isWord(xml[i + open.length])) { i = xml.indexOf(open, i + open.length); continue; }
    const gt = xml.indexOf(">", i);
    if (gt < 0) return;
    const selfClose = xml[gt - 1] === "/", attrs = xml.slice(i + open.length, selfClose ? gt - 1 : gt);
    if (selfClose || !body) { yield { attrs, inner: "" }; i = xml.indexOf(open, gt + 1); continue; }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) return;
    yield { attrs, inner: xml.slice(gt + 1, end) };
    i = xml.indexOf(open, end + close.length);
  }
}
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); if (i < 0) return undefined; const j = s.indexOf(b, i + a.length); return j < 0 ? undefined : s.slice(i + a.length, j); };
// Thuộc tính của một thẻ (đã tách sẵn, nên regex chỉ chạy trên đoạn ngắn và không lùi lại).
const ATTR = new Map<string, RegExp>();
const attr = (attrs: string, name: string) => { let re = ATTR.get(name); if (!re) ATTR.set(name, (re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`))); return re.exec(attrs)?.[1]; };
// Chữ của <t>…</t> (rich text có nhiều đoạn <r><t>…</t></r>).
const textOf = (xml: string) => decode([...elems(xml, "t", true)].map((e) => e.inner).join(""));

// Giới hạn đọc: mỗi phần XML (sheet, sharedStrings…) tối đa 8 MB sau giải nén, cả tệp 24 MB, tối đa 32 sheet, nhãn dài nhất 300 ký tự.
// Đếm byte giải nén thật (scripts/zipguard.mjs), không tin kích thước khai trong zip: tệp nén vài KB nở thành vài GB thì dừng ở trần, không chiếm bộ nhớ.
// Vượt trần thì bỏ qua cả tệp (mô hình tài chính model tạo nhỏ hơn nhiều; đây là kiểm tra phụ, không phải chốt bắt buộc).
export const XLSX_LIMITS = { part: 8 * 1048576, total: 24 * 1048576, sheets: 32, label: 300 };
class TooBig extends Error {}

type Cell = { ref: string; col: number; row: number; formula: boolean; num: number | null; text: string };
export type HardTotal = { sheet: string; ref: string; label: string; value: number };

function cellsOf(xml: string, shared: string[]): Cell[] {
  const out: Cell[] = [];
  for (const { attrs, inner } of elems(xml, "c", true)) {
    const ref = /^([A-Z]{1,3})(\d{1,7})$/.exec(attr(attrs, "r") ?? "");
    if (!ref) continue;
    const t = attr(attrs, "t") ?? "n", v = between(inner, "<v>", "</v>");
    const formula = /<f[\s>/]/.test(inner);
    const text = (t === "s" && v !== undefined ? shared[Number(v)] ?? "" : t === "inlineStr" ? textOf(inner) : t === "str" ? decode(v ?? "") : "").slice(0, XLSX_LIMITS.label);
    const num = (t === "n" || t === "") && v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    out.push({ ref: `${ref[1]}${ref[2]}`, col: colNum(ref[1]), row: Number(ref[2]), formula, num, text });
  }
  return out;
}

/** Ô số ghi cứng nằm ở hàng hay cột tổng hợp, theo từng sheet. */
export async function hardTotals(buf: Buffer | Uint8Array, max = 12): Promise<HardTotal[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { return []; }
  const budget = { left: XLSX_LIMITS.total };
  // Một phần XML, đọc có trần (byte giải nén thật); vượt trần thì bỏ cả tệp.
  const read = async (p: string) => {
    const f = zip.file(p);
    if (!f) return "";
    const r = await readCapped(f, XLSX_LIMITS.part, budget).catch((e) => { throw e instanceof ZipTooBig ? new TooBig() : e; });
    if (r.cut) throw new TooBig();
    return r.data.toString("utf8");
  };
  try { return await scan(zip, read, max); } catch (e) { if (e instanceof TooBig) return []; throw e; }
}

async function scan(zip: JSZip, read: (p: string) => Promise<string>, max: number): Promise<HardTotal[]> {
  const sheets = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort();
  if (sheets.length > XLSX_LIMITS.sheets) return [];
  const shared = [...elems(await read("xl/sharedStrings.xml"), "si", true)].map((e) => textOf(e.inner).slice(0, XLSX_LIMITS.label));
  // Tên sheet theo workbook.xml + quan hệ; không đọc được thì dùng tên tệp.
  const wb = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels");
  const target = new Map([...elems(rels, "Relationship", false)].flatMap(({ attrs }) => { const id = attr(attrs, "Id"), t = attr(attrs, "Target"); return id && t ? [[id, t.replace(/^\/?(?:xl\/)?/, "xl/")] as const] : []; }));
  const names = new Map([...elems(wb, "sheet", false)].flatMap(({ attrs }) => { const n = attr(attrs, "name"), id = attr(attrs, "r:id"); return n && id ? [[target.get(id) ?? "", decode(n)] as const] : []; }));
  const out: HardTotal[] = [];
  for (const path of sheets) {
    const xml = await read(path);
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
