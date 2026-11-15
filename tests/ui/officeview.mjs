// Khung xem trước tệp Office chạy thật trong Chrome ẩn, không cần máy chủ Synchro: máy chủ tĩnh chỉ phát public/vendor và trang của officeDoc.
// Tệp mẫu tự dựng bằng JSZip, có đúng các ca từng lỗi: công thức trống / bằng 0, ₫ không ngoặc kép, biểu đồ, hình chevron, chữ đỏ 20 pt, ngắt trang,
// sheet 3.000 dòng, PDF hơn giới hạn trang. Chạy tay: node tests/ui/officeview.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

const R = createRequire(path.join(process.cwd(), "package.json"));
const JSZip = R("jszip");
const { officeview: V } = await loadTs(["officeview"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- tệp mẫu
const zip = async (files) => { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: "nodebuffer" }); };
const H = '<?xml version="1.0" encoding="UTF-8"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (list) => `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, t]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${t}"/>`).join("")}</Relationships>`;
const CT = `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
const SM = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CHARTNS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const barChart = (val, cache = "") => `${H}<c:chartSpace ${CHARTNS}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Doanh thu năm</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:tx><c:v>DT</c:v></c:tx><c:val>${val}</c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
async function xlsxBook() {
  const row1 = `<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Tên</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>Tiền</t></is></c></row>`;
  const rows = [2, 3].map((r) => `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>Dòng ${r}</t></is></c><c r="B${r}" s="2"><v>${r * 1000000}</v></c></row>`).join("");
  const sheet1 = `${H}<worksheet ${SM}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20" customWidth="1"/></cols><sheetData>${row1}${rows}<row r="4"><c r="A4" t="inlineStr"><is><t>Tổng có giá trị</t></is></c><c r="B4" s="2"><f>SUM(B2:B3)</f><v>5000000</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>Openpyxl</t></is></c><c r="B5"><f>SUM(B2:B3)</f><v></v></c></row><row r="6"><c r="B6" s="3"><v>7000</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>`;
  const sheet2 = `${H}<worksheet ${SM}><sheetData><row r="1"><c r="A1"><f>1+1</f><v>0</v></c><c r="B1"><f>2+2</f><v>0</v></c></row></sheetData></worksheet>`;
  const hidden = `${H}<worksheet ${SM}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>bí mật</t></is></c></row></sheetData></worksheet>`;
  return zip({
    "[Content_Types].xml": CT, "_rels/.rels": rels([["rId1", "officeDocument", "xl/workbook.xml"]]),
    "xl/workbook.xml": `${H}<workbook ${SM}><sheets><sheet name="Báo cáo" sheetId="1" r:id="rId1"/><sheet name="Chưa tính" sheetId="2" r:id="rId2"/><sheet name="Ẩn" sheetId="3" state="hidden" r:id="rId3"/></sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([["rId1", "worksheet", "worksheets/sheet1.xml"], ["rId2", "worksheet", "worksheets/sheet2.xml"], ["rId3", "worksheet", "worksheets/sheet3.xml"], ["rId4", "styles", "styles.xml"]]),
    "xl/styles.xml": `${H}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0 ₫"/><numFmt numFmtId="165" formatCode="#,##0 [$₫-42A]"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEEFF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet1, "xl/worksheets/sheet2.xml": sheet2, "xl/worksheets/sheet3.xml": hidden,
    "xl/worksheets/_rels/sheet1.xml.rels": rels([["rId1", "drawing", "../drawings/drawing1.xml"]]),
    "xl/drawings/drawing1.xml": `${H}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:row>14</xdr:row></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels([["rId1", "chart", "../charts/chart1.xml"]]),
    // openpyxl: biểu đồ chỉ có tham chiếu ô, không có số lưu sẵn.
    "xl/charts/chart1.xml": barChart(`<c:numRef><c:f>'Báo cáo'!$B$2:$B$3</c:f></c:numRef>`),
  });
}
async function xlsxBig(n) {
  const rows = []; for (let r = 1; r <= n; r++) rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c></row>`);
  return zip({
    "[Content_Types].xml": CT.replace(/<Override PartName="\/xl\/(worksheets\/sheet[23]|styles)\.xml"[^>]*>/g, ""), "_rels/.rels": rels([["rId1", "officeDocument", "xl/workbook.xml"]]),
    "xl/workbook.xml": `${H}<workbook ${SM}><sheets><sheet name="Lớn" sheetId="1" r:id="rId1"/></sheets></workbook>`, "xl/_rels/workbook.xml.rels": rels([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
    "xl/worksheets/sheet1.xml": `${H}<worksheet ${SM}><dimension ref="A1:A${n}"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
  });
}
const WN = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function docx() {
  const longP = Array.from({ length: 80 }, (_, i) => `<w:p><w:r><w:t>Đoạn dài số ${i} để tràn trang.</w:t></w:r></w:p>`).join("");
  return zip({
    "[Content_Types].xml": `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": rels([["rId1", "officeDocument", "word/document.xml"]]),
    "word/_rels/document.xml.rels": rels([["rId1", "styles", "styles.xml"], ["rId2", "header", "header1.xml"], ["rId3", "footer", "footer1.xml"]]),
    "word/styles.xml": `${H}<w:styles ${WN}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`,
    "word/header1.xml": `${H}<w:hdr ${WN}><w:p><w:r><w:t>ĐẦU TRANG</w:t></w:r></w:p></w:hdr>`,
    "word/footer1.xml": `${H}<w:ftr ${WN}><w:p><w:r><w:t xml:space="preserve">Trang </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
    "word/document.xml": `${H}<w:document ${WN}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Tiêu đề</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="C80000"/><w:sz w:val="40"/></w:rPr><w:t>Chữ đỏ 20</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="1F4E79"/></w:tcPr><w:p><w:r><w:t>Ô nền</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Trang hai</w:t></w:r></w:p>${longP}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1701" w:right="1134" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`,
  });
}
const PN = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function pptx() {
  const title = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>`;
  return zip({
    "[Content_Types].xml": `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "ppt/presentation.xml": `${H}<p:presentation ${PN}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "theme", "theme/theme1.xml"]]),
    "ppt/theme/theme1.xml": `${H}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="112233"/></a:accent1></a:clrScheme><a:fontScheme name="x"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    "ppt/slideMasters/slideMaster1.xml": `${H}<p:sldMaster ${PN}><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="3200"/></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`,
    "ppt/slideLayouts/slideLayout1.xml": `${H}<p:sldLayout ${PN}><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    "ppt/slides/_rels/slide1.xml.rels": rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "chart", "../charts/chart1.xml"]]),
    "ppt/charts/chart1.xml": barChart(`<c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numCache></c:numRef>`),
    "ppt/slides/slide1.xml": `${H}<p:sld ${PN}><p:cSld><p:spTree>${title}<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Tiêu đề căn giữa</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="c"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1500000"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="C81E1E"/></a:solidFill></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Mũi tên</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="2500000"/><a:ext cx="800000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="g"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="3000000" y="1500000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  });
}
// Định dạng có điều kiện kiểu xlsxwriter, biểu đồ có nhãn theo chuỗi và tiêu đề trục.
const DEF = `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`;
const stackChart = `${H}<c:chartSpace ${CHARTNS}><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>${[["A", [10, 20]], ["B", [30, 40]]].map(([n, vs], i) => `<c:ser><c:idx val="${i}"/><c:tx><c:v>${n}</c:v></c:tx><c:dLbls><c:showVal val="1"/></c:dLbls><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="2"/>${vs.map((v, k) => `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit></c:val></c:ser>`).join("")}</c:barChart><c:catAx><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Quý trong năm</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx><c:valAx><c:axPos val="l"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Triệu đồng</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
async function xlsxCF() {
  const rows = [10, 50, 100, 200].map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${v}</v></c><c r="B${i + 1}"><v>${v}</v></c><c r="C${i + 1}"><v>${v}</v></c><c r="D${i + 1}"><v>${v}</v></c><c r="E${i + 1}"><v>${v}</v></c></row>`).join("");
  const cf = `<conditionalFormatting sqref="A1:A4"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>100</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="B1:B4"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FF00FF00"/></colorScale></cfRule></conditionalFormatting><conditionalFormatting sqref="C1:C4"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting><conditionalFormatting sqref="D1:D4"><cfRule type="expression" dxfId="0" priority="4"><formula>$A1&gt;=100</formula></cfRule><cfRule type="expression" dxfId="0" priority="5"><formula>SUM($A$1:$A1)&gt;10</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="E1:E4"><cfRule type="top10" dxfId="0" priority="6" rank="1"/></conditionalFormatting>`;
  return zip({
    "[Content_Types].xml": DEF, "_rels/.rels": rels([["rId1", "officeDocument", "xl/workbook.xml"]]),
    "xl/workbook.xml": `${H}<workbook ${SM}><sheets><sheet name="CF" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([["rId1", "worksheet", "worksheets/sheet1.xml"], ["rId2", "styles", "styles.xml"]]),
    "xl/styles.xml": `${H}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `${H}<worksheet ${SM}><sheetData>${rows}</sheetData>${cf}<drawing r:id="rId1"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rels([["rId1", "drawing", "../drawings/drawing1.xml"]]),
    "xl/drawings/drawing1.xml": `${H}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:row>0</xdr:row></xdr:from><xdr:to><xdr:col>14</xdr:col><xdr:row>20</xdr:row></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels([["rId1", "chart", "../charts/chart1.xml"]]),
    "xl/charts/chart1.xml": stackChart,
  });
}
// Phụ lục xoay ngang của python-docx: mục sau không ghi lại đầu / chân trang; mục giữa có hai cột.
async function docxSections() {
  const para = (t, n) => Array.from({ length: n }, (_, i) => `<w:p><w:r><w:t>${t} ${i}</w:t></w:r></w:p>`).join("");
  const refs = `<w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/>`;
  return zip({
    "[Content_Types].xml": DEF, "_rels/.rels": rels([["rId1", "officeDocument", "word/document.xml"]]),
    "word/_rels/document.xml.rels": rels([["rId1", "header", "header1.xml"], ["rId2", "footer", "footer1.xml"]]),
    "word/header1.xml": `${H}<w:hdr ${WN}><w:p><w:r><w:t>ĐẦU TRANG CHUNG</w:t></w:r></w:p></w:hdr>`,
    "word/footer1.xml": `${H}<w:ftr ${WN}><w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
    "word/document.xml": `${H}<w:document ${WN}><w:body>${para("Mục một", 3)}<w:p><w:pPr><w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="500" w:footer="500"/></w:sectPr></w:pPr></w:p>${para("Hai cột", 120)}<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="500" w:footer="500"/><w:cols w:num="2" w:space="400"/></w:sectPr></w:pPr></w:p>${para("Phụ lục", 3)}<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>`,
  });
}
// Kiểu tệp của thư viện docx (synchro-doc docx): mục lục là tab phải có dấu chấm dẫn, trang mục lục đánh số i, ii; thân bài đếm lại từ 1.
async function docxToc() {
  const toc = (t, n) => `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000" w:leader="dot"/></w:tabs></w:pPr><w:hyperlink w:anchor="_Toc1"><w:r><w:t>${t}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve">PAGEREF _Toc1 \\h</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>${n}</w:t><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>`;
  const sect = (start, fmt) => `<w:footerReference w:type="default" r:id="rId1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="500" w:footer="500"/><w:pgNumType w:start="${start}" w:fmt="${fmt}"/>`;
  return zip({
    "[Content_Types].xml": DEF, "_rels/.rels": rels([["rId1", "officeDocument", "word/document.xml"]]),
    "word/_rels/document.xml.rels": rels([["rId1", "footer", "footer1.xml"]]),
    "word/footer1.xml": `${H}<w:ftr ${WN}><w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
    "word/document.xml": `${H}<w:document ${WN}><w:body><w:sdt><w:sdtContent>${toc("1. Tóm tắt", 1)}${toc("2. Số liệu chính", 2)}</w:sdtContent></w:sdt><w:p><w:pPr><w:sectPr>${sect(1, "lowerRoman")}</w:sectPr></w:pPr></w:p><w:p><w:r><w:t>Thân bài</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>Trang hai của thân bài</w:t></w:r></w:p><w:sectPr>${sect(1, "decimal")}</w:sectPr></w:body></w:document>`,
  });
}
async function pptxShapes() {
  const shape = (id, prst, x, y, extra = "") => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${prst}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000000" cy="800000"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst>${extra}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="2255AA"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:sp>`;
  const names = ["cloud", "heart", "star8", "donut", "wedgeRectCallout", "wave", "flowChartDocument", "mathMultiply", "leftBrace", "can", "pie", "lightningBolt"];
  return zip({
    "[Content_Types].xml": DEF,
    "ppt/presentation.xml": `${H}<p:presentation ${PN}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"]]),
    "ppt/slides/_rels/slide1.xml.rels": rels([["rId2", "chart", "../charts/chart1.xml"]]),
    "ppt/charts/chart1.xml": stackChart,
    "ppt/slides/slide1.xml": `${H}<p:sld ${PN}><p:cSld><p:spTree>${names.map((n, i) => shape(i + 2, n, 100000 + (i % 4) * 1200000, 100000 + Math.floor(i / 4) * 1100000)).join("")}<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="50" name="g"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5000000" y="100000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  });
}
function pdfBook(n) {
  // PDF tối thiểu: mỗi trang một đối tượng; pdf.js tự dựng lại bảng xref khi thiếu.
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${n} /Kids [${Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(" ")}] >>`];
  for (let i = 0; i < n; i++) objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>");
  return Buffer.from(`%PDF-1.4\n${objs.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj`).join("\n")}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

// ---------------------------------------------------------------- Chrome
const docs = new Map();
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname === "/htmlblocks.mjs") { r.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" }); return r.end(R("typescript").transpileModule(fs.readFileSync("ui/htmlblocks.ts", "utf8"), { compilerOptions: { module: 99, target: 9 } }).outputText); }
  if (u.pathname.startsWith("/vendor/")) { const f = path.join(process.cwd(), "public", "vendor", path.basename(u.pathname)); if (fs.existsSync(f)) { r.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" }); return r.end(fs.readFileSync(f)); } r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(docs.get(u.pathname) ?? "<!doctype html>");
});
await new Promise((o) => srv.listen(0, "127.0.0.1", o));
const B = `http://127.0.0.1:${srv.address().port}`;
const PROF = path.join(os.tmpdir(), "synchro-ui", "chrome-prof-officeview");
fs.rmSync(PROF, { recursive: true, force: true }); fs.mkdirSync(PROF, { recursive: true });
const PORT = 9361;
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const quit = (c) => { chrome.kill(); srv.close(); console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`); process.exit(c); };
chrome.on("error", () => { console.log("  (bỏ qua: máy không có Chrome)"); srv.close(); process.exit(0); });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [a, b] = waits.get(m.id); waits.delete(m.id); m.error ? b(new Error(m.error.message)) : a(m.result); } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const send = (method, params = {}, sessionId) => new Promise((a, b) => { const id = ++seq; waits.set(id, [a, b]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" }); const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S); await P("Runtime.enable"); await P("Page.enable"); await P("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (x) => { const r = await P("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
// Mở trang của officeDoc trực tiếp (parent === window), đưa tệp vào như filepreview.tsx. Trả thông điệp done / error và thời gian.
let nth = 0;
async function open(name, buf, t) {
  const p = `/d${++nth}`, ch = `c${nth}`;
  docs.set(p, V.officeDoc(V.officeKind(name), name, B, ch, t).replace("<script>", `<script>window.__st=[];addEventListener("message",function(e){if(e.data&&e.data.__synchro==="${ch}"&&e.data.t!=="file")window.__st.push(e.data)});</script><script>`));
  await P("Page.navigate", { url: B + p });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await ev("!!(window.__st&&window.__st.some(function(x){return x.t==='ready'}))").catch(() => false)) break; }
  const t0 = Date.now();
  await ev(`(()=>{const b=Uint8Array.from(atob(${JSON.stringify(buf.toString("base64"))}),c=>c.charCodeAt(0)).buffer;window.postMessage({__synchro:"${ch}",t:"file",buf:b},"*",[b])})();0`);
  let st = null; for (let i = 0; i < 300 && !st; i++) { await sleep(50); st = await ev("window.__st.find(function(x){return x.t==='done'||x.t==='error'})||null"); }
  return { st, ms: Date.now() - t0 };
}
// OV_SHOT=<thư mục>: lưu ảnh khung xem để tự nhìn bằng mắt.
const shot = async (n) => { if (!process.env.OV_SHOT) return; const { data } = await P("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(process.env.OV_SHOT, n + ".png"), Buffer.from(data, "base64")); };
try {
  console.log("1. Excel");
  let r = await open("bao-cao.xlsx", await xlsxBook());
  ok(r.st?.t === "done" && r.st.pages === 2, "mở được, không đếm trang tính ẩn", JSON.stringify(r.st));
  const tabs = await ev(`[...document.querySelectorAll(".tabs button")].map(b=>b.textContent)`);
  ok(tabs.join() === "Báo cáo,Chưa tính", "trang tính ẩn không hiện", tabs);
  const cell = (a) => ev(`(()=>{const m=/([A-Z]+)(\\d+)/.exec(${JSON.stringify(a)}),c=m[1].charCodeAt(0)-65,rows=[...document.querySelectorAll(".sheet tr")],td=rows[+m[2]].children[c+1],s=getComputedStyle(td);return {t:td.textContent,fw:s.fontWeight,color:s.color,bg:s.backgroundColor,al:s.textAlign,cls:td.className,top:s.position}})()`);
  ok((await cell("B4")).t === "5,000,000 ₫", "ô công thức có giá trị hiện giá trị, định dạng ₫ không ngoặc kép vẫn đúng", JSON.stringify(await cell("B4")));
  ok((await cell("B6")).t === "7,000 ₫", "định dạng tiền kiểu [$₫-42A] vẫn đúng", JSON.stringify(await cell("B6")));
  ok((await cell("B2")).al === "right", "số căn phải");
  const hd = await cell("A1");
  ok(+hd.fw >= 700 && hd.color === "rgb(255, 0, 0)" && hd.bg === "rgb(221, 238, 255)" && hd.al === "center", "định dạng ô: đậm, màu chữ, nền, căn giữa", JSON.stringify(hd));
  ok(hd.top === "sticky", "dòng cố định (freeze panes) dính khi cuộn", JSON.stringify(hd));
  const nv = await cell("B5");
  ok(nv.t === "=SUM(B2:B3)" && /nv/.test(nv.cls), "công thức openpyxl không có giá trị: hiện công thức, có đánh dấu, không hiện 0", JSON.stringify(nv));
  ok(/1 ô công thức chưa có giá trị/.test(await ev(`document.querySelector(".note")?.textContent||""`)), "có dòng báo ô chưa tính");
  await sleep(300);
  const ch = await ev(`(()=>{const s=document.querySelector(".ch svg");return s?{bars:s.querySelectorAll("rect").length,text:s.textContent}:null})()`);
  ok(ch && ch.bars >= 2 && /Doanh thu năm/.test(ch.text), "biểu đồ vẽ từ ô sống (tệp chỉ có tham chiếu, không có số lưu sẵn)", JSON.stringify(ch));
  await ev(`document.querySelectorAll(".tabs button")[1].click()`); await sleep(200);
  ok(/chưa được tính/.test(await ev(`document.querySelector(".note")?.textContent||""`)), "xlsxwriter chưa tính (toàn bộ công thức bằng 0): có dòng báo");

  r = await open("lon.xlsx", await xlsxBig(3000));
  ok(r.st?.t === "done" && (await ev(`document.querySelectorAll(".sheet tr").length`)) === 2001, "3.000 dòng: chỉ dựng 2.000 dòng", JSON.stringify(r.st) + (await ev(`document.querySelectorAll(".sheet tr").length`)));
  ok(/2\.000 \/ 3\.000 dòng/.test(await ev(`document.querySelector(".note")?.textContent||""`)), "nói rõ đang hiện bao nhiêu dòng", await ev(`document.querySelector(".note")?.textContent||""`));
  r = await open("lon2.xlsx", await xlsxBig(3000), (s) => (s.startsWith("Đang hiện {n} / {m} dòng") ? "Showing the first {n} of {m} rows" : s));
  ok(/Showing the first .* of .* rows/.test(await ev(`document.querySelector(".note")?.textContent||""`)), "chuỗi trong khung dịch được");
  const csv = await open("a.csv", Buffer.from("ten,so\nAo,1\n"));
  ok(csv.st?.t === "done" && /Ao/.test(await ev(`document.querySelector(".sheet").textContent`)), "CSV vẫn mở được");

  console.log("1b. Excel: định dạng có điều kiện, nhãn biểu đồ");
  r = await open("cf.xlsx", await xlsxCF());
  ok(r.st?.t === "done", "mở được", JSON.stringify(r.st));
  const cfv = await ev(`(()=>{const cell=(c,rr)=>{const t=document.querySelector(".sheet table");const i=c.charCodeAt(0)-64;return t.querySelectorAll("tr")[rr].children[i]};const s=(e)=>getComputedStyle(e);return {a3:s(cell("A",3)).backgroundColor,a4:s(cell("A",4)).backgroundColor,a4c:s(cell("A",4)).color,a4w:s(cell("A",4)).fontWeight,b1:s(cell("B",1)).backgroundColor,b4:s(cell("B",4)).backgroundColor,c1:s(cell("C",1)).backgroundImage,c4:s(cell("C",4)).backgroundImage,d2:s(cell("D",2)).backgroundColor,d3:s(cell("D",3)).backgroundColor,e4:s(cell("E",4)).backgroundColor,e3:s(cell("E",3)).backgroundColor,note:document.querySelector(".note")?.textContent||""}})()`);
  ok(cfv.a4 === "rgb(255, 199, 206)" && cfv.a4c === "rgb(156, 0, 6)" && Number(cfv.a4w) >= 700 && cfv.a3 !== cfv.a4, "cellIs: chỉ ô vượt hạn mức tô đỏ, đậm", JSON.stringify(cfv));
  ok(cfv.b1 === "rgb(255, 255, 255)" && cfv.b4 === "rgb(0, 255, 0)", "thang màu đúng hai đầu", JSON.stringify(cfv));
  ok(/gradient/.test(cfv.c1) && /gradient/.test(cfv.c4) && /10(\.0)?%/.test(cfv.c1) && /90(\.0)?%/.test(cfv.c4), "thanh dữ liệu dài theo giá trị", JSON.stringify(cfv));
  ok(cfv.d3 === "rgb(255, 199, 206)" && cfv.d2 !== cfv.d3, "công thức so sánh có ô tương đối tính theo từng dòng", JSON.stringify(cfv));
  ok(cfv.e4 === "rgb(255, 199, 206)" && cfv.e3 !== cfv.e4, "top 1 chỉ tô giá trị lớn nhất", JSON.stringify(cfv));
  ok(/^1 quy tắc định dạng có điều kiện chưa hiện được/.test(cfv.note), "quy tắc chưa vẽ được thì nói rõ, không im lặng", cfv.note);
  await sleep(300);
  const xc = await ev(`(()=>{const s=document.querySelector(".ch svg");return s?[...s.querySelectorAll("text")].map(t=>({t:t.textContent,tr:t.getAttribute("transform")||""})):null})()`);
  ok(xc && xc.some((t) => t.t === "Quý trong năm") && xc.some((t) => t.t === "Triệu đồng" && /rotate/.test(t.tr)), "tiêu đề trục ngang, trục dọc", JSON.stringify(xc));
  ok(xc && ["10", "20", "30", "40"].every((v) => xc.some((t) => t.t === v)), "nhãn ghi ở từng chuỗi: đủ nhãn của mọi đoạn trong cột chồng", JSON.stringify(xc));
  const lastIsLabel = await ev(`(()=>{const k=[...document.querySelector(".ch svg").children];const li=k.map((e,i)=>e.textContent==="10"?i:-1).filter(i=>i>=0).pop();const lr=k.map((e,i)=>e.tagName==="rect"?i:-1).filter(i=>i>=0).pop();return li>lr})()`);
  ok(lastIsLabel, "nhãn vẽ sau mọi cột nên không bị đoạn trên che");
  await shot("cf");

  console.log("2. Word");
  r = await open("bao-cao.docx", await docx());
  ok(r.st?.t === "done" && r.st.pages >= 3, "chia trang: ngắt trang chủ động và tràn trang", JSON.stringify(r.st));
  const red = await ev(`(()=>{const e=[...document.querySelectorAll(".dp span")].find(x=>x.textContent==="Chữ đỏ 20"),s=getComputedStyle(e),p=getComputedStyle(e.parentElement);return {c:s.color,sz:parseFloat(s.fontSize),al:p.textAlign}})()`);
  ok(red.c === "rgb(200, 0, 0)" && Math.abs(red.sz - 26.67) < 1 && red.al === "center", "màu, cỡ chữ, căn lề giữ đúng", JSON.stringify(red));
  const pgs = await ev(`[...document.querySelectorAll(".dp")].map(p=>({w:p.offsetWidth,h:p.offsetHeight,head:p.querySelector(".dph")?.textContent,foot:p.querySelector(".dpf")?.textContent,body:p.querySelector(".dpb").textContent.slice(0,12),over:p.querySelector(".dpb").scrollHeight>p.querySelector(".dpb").clientHeight+1}))`);
  ok(Math.abs(pgs[0].w - 794) < 2 && Math.abs(pgs[0].h - 1123) < 2, "đúng khổ A4", JSON.stringify(pgs[0]));
  ok(pgs.every((p) => p.head === "ĐẦU TRANG") && pgs.every((p, i) => p.foot === `Trang ${i + 1}`), "đầu / chân trang và số trang đúng từng trang", JSON.stringify(pgs));
  ok(pgs[1].body.startsWith("Trang hai"), "ngắt trang chủ động sang trang mới", JSON.stringify(pgs[1]));
  ok(pgs.every((p) => !p.over), "không trang nào tràn nội dung", JSON.stringify(pgs));
  ok((await ev(`getComputedStyle([...document.querySelectorAll(".dp td")].find(x=>x.textContent==="Ô nền")).backgroundColor`)) === "rgb(31, 78, 121)", "nền ô bảng");
  const h1 = await ev(`(()=>{const e=document.querySelector(".dp h1");return e?{c:getComputedStyle(e.firstElementChild).color,b:getComputedStyle(e).fontWeight}:null})()`);
  ok(h1?.c === "rgb(46, 116, 181)" && +h1.b >= 700, "kiểu Heading 1 thừa kế từ styles.xml", JSON.stringify(h1));

  // Khung hẹp (bảng xem cạnh chat): trang thu nhỏ cho vừa, số trang giữ nguyên, không tràn.
  const wide = pgs.length;
  await P("Emulation.setDeviceMetricsOverride", { width: 520, height: 800, deviceScaleFactor: 1, mobile: false });
  r = await open("hep.docx", await docx());
  const narrow = await ev(`(()=>{const d=[...document.querySelectorAll(".dp")];return {n:d.length,w:d[0].getBoundingClientRect().width,sw:document.documentElement.scrollWidth,over:d.some(p=>{const b=p.querySelector(".dpb");return b.scrollHeight>b.clientHeight+1})}})()`);
  ok(narrow.n === wide && narrow.w <= 520 && narrow.sw <= 520 && !narrow.over, "khung hẹp: trang thu lại vừa khung, số trang không đổi", JSON.stringify(narrow));
  await P("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log("2b. Word: nhiều mục");
  r = await open("muc.docx", await docxSections());
  const ds = await ev(`[...document.querySelectorAll(".dp")].map(p=>({w:parseFloat(p.style.width),hd:p.querySelector(".dph")?.textContent||"",ft:p.querySelector(".dpf")?.textContent||"",cols:p.querySelector(".dpb > div")?.style.columnCount||"",over:p.querySelector(".dpb").scrollHeight>p.querySelector(".dpb").clientHeight+1,txt:p.querySelector(".dpb").textContent.slice(0,12)}))`);
  ok(ds.length >= 3 && ds.every((p) => p.hd === "ĐẦU TRANG CHUNG"), "mục sau không khai báo vẫn có đầu trang của mục trước", JSON.stringify(ds));
  ok(ds.every((p, i) => p.ft === String(i + 1)), "chân trang và số trang đúng ở mọi mục", JSON.stringify(ds));
  ok(ds[ds.length - 1].w > ds[0].w, "mục cuối xoay ngang", JSON.stringify(ds));
  ok(ds.some((p) => p.cols === "2" && /^Hai cột/.test(p.txt)), "w:cols num=2 hiện hai cột", JSON.stringify(ds));
  ok(ds.every((p) => !p.over), "không trang nào tràn", JSON.stringify(ds));
  await shot("docx");

  console.log("2c. Word: mục lục có dấu chấm dẫn, số trang theo mục");
  r = await open("muc-luc.docx", await docxToc());
  ok(r.st?.t === "done" && r.st.pages === 3, "3 trang: mục lục + 2 trang thân bài", JSON.stringify(r.st));
  const tl = await ev(`[...document.querySelectorAll(".dp .rtab")].map(p=>{const a=p.querySelector(".tl1").getBoundingClientRect(),d=p.querySelector(".tld"),c=p.querySelector(".tl3").getBoundingClientRect(),b=p.getBoundingClientRect();return {t:p.textContent,dot:d.classList.contains("dot"),lw:d.getBoundingClientRect().width,right:Math.round(b.right-c.right),gap:Math.round(c.left-a.right)}})`);
  ok(tl.length === 2 && tl.every((x) => x.dot && x.lw > 100 && x.right <= 1) && tl[0].t.replace(/\s/g, "") === "1.Tómtắt1", "dòng mục lục: số trang sát lề phải, khoảng giữa kẻ dấu chấm", JSON.stringify(tl));
  const pn = await ev(`[...document.querySelectorAll(".dp")].map(p=>p.querySelector(".dpf")?.textContent||"")`);
  ok(pn.join() === "i,1,2", "trang mục lục số i, thân bài đếm lại từ 1", JSON.stringify(pn));

  console.log("3. PowerPoint");
  r = await open("deck.pptx", await pptx());
  ok(r.st?.t === "done" && r.st.pages === 1, "mở được", JSON.stringify(r.st));
  ok((await ev(`document.querySelectorAll(".ph").length`)) === 0, "không còn ô xám 'Biểu đồ / đối tượng'");
  const cs = await ev(`(()=>{const s=document.querySelector(".sl svg:not(.geo)");return s?{bars:s.querySelectorAll("rect").length,text:s.textContent}:null})()`);
  ok(cs && cs.bars >= 3 && /Doanh thu năm/.test(cs.text), "biểu đồ vẽ từ số lưu sẵn trong tệp", JSON.stringify(cs));
  const geo = await ev(`(()=>{const g=document.querySelector(".geo");return g?{pts:g.querySelector("polygon")?.getAttribute("points").split(" ").length,fill:g.querySelector("polygon")?.getAttribute("fill"),text:g.parentElement.textContent,tc:getComputedStyle(g.parentElement.querySelector("span")).color}:null})()`);
  ok(geo && geo.pts === 6 && /^#c81e1e$/i.test(geo.fill) && geo.text === "Mũi tên", "chevron vẽ đúng hình, không phải hình chữ nhật", JSON.stringify(geo));
  ok(geo?.tc === "rgb(255, 255, 255)", "chữ trong hình lấy màu từ kiểu hình (fontRef)", JSON.stringify(geo));
  ok((await ev(`getComputedStyle([...document.querySelectorAll(".sh p")].find(p=>p.textContent==="Tiêu đề căn giữa")).textAlign`)) === "center", "tiêu đề thừa kế căn giữa từ master");
  ok((await ev(`[...document.querySelectorAll(".sh")].some(d=>getComputedStyle(d).backgroundColor==="rgb(17, 34, 51)")`)), "hình không tô riêng lấy màu chủ đề từ kiểu hình (fillRef)");

  console.log("3b. PowerPoint: thêm hình, nhãn cột chồng");
  r = await open("hinh.pptx", await pptxShapes());
  const sh = await ev(`[...document.querySelectorAll(".sl .sh")].slice(0,12).map(d=>{const g=d.querySelector("svg.geo");const p=g&&g.querySelector("polygon,polyline,path");return {pts:p?(p.getAttribute("points")||p.getAttribute("d")).split(" ").length:0,fill:p?p.getAttribute("fill"):"",stroke:p?p.getAttribute("stroke"):"",bg:getComputedStyle(d).backgroundColor,ov:getComputedStyle(d).overflow,tag:p?p.tagName:""}})`);
  ok(sh.length === 12 && sh.every((s) => s.pts >= 4 && s.bg === "rgba(0, 0, 0, 0)"), "cloud, heart, star8, donut, khung thoại, wave… không còn là hình chữ nhật", JSON.stringify(sh));
  ok(sh.filter((s) => s.tag !== "polyline").every((s) => /^#2255aa$/i.test(s.fill) && /^#ff0000$/i.test(s.stroke)), "hình có cả màu tô và viền", JSON.stringify(sh[0]));
  ok(sh[4].ov === "visible", "mũi khung thoại thò ra ngoài khung hình vẫn hiện", JSON.stringify(sh[4]));
  ok(sh[8].tag === "polyline" && sh[8].fill === "none", "ngoặc nhọn chỉ có nét, không tô", JSON.stringify(sh[8]));
  const pc = await ev(`[...document.querySelector(".sl svg:not(.geo)").querySelectorAll("text")].map(t=>t.textContent)`);
  ok(["10", "20", "30", "40"].every((v) => pc.includes(v)), "slide: cột chồng có nhãn từng đoạn", JSON.stringify(pc));
  await shot("shapes");

  console.log("4. PDF");
  r = await open("dai.pdf", pdfBook(1005));
  ok(r.st?.t === "done" && r.st.pages === 1005, "báo đúng tổng số trang", JSON.stringify(r.st));
  ok(/1000 \/ 1005 trang/.test(await ev(`document.querySelector(".note")?.textContent||""`)), "nói rõ giới hạn, không cắt im lặng", await ev(`document.querySelector(".note")?.textContent||""`));
  await sleep(800);
  const lazy = await ev(`(()=>{const c=[...document.querySelectorAll(".pdfs canvas")];return {n:c.length,first:c[0].width,last:c[c.length-1].width}})()`);
  ok(lazy.n === 1000 && lazy.first > 100 && lazy.last === 1, "chỉ vẽ trang gần chỗ đang xem", JSON.stringify(lazy));
  await ev(`document.querySelectorAll(".pdfs canvas")[600].scrollIntoView()`); await sleep(800);
  ok((await ev(`document.querySelectorAll(".pdfs canvas")[600].width`)) > 100, "cuộn tới thì vẽ trang đó");
  r = await open("ngan.pdf", pdfBook(3));
  ok(r.st?.pages === 3 && (await ev(`document.querySelector(".note")`)) === null, "tệp ngắn không có dòng báo");

  console.log("5. Tài liệu đã dựng → khối cho tệp Word");
  await P("Page.navigate", { url: `${B}/blank` }); await sleep(200);
  const blocks = await ev(`import("${B}/htmlblocks.mjs").then((m)=>{const d=new DOMParser().parseFromString(${JSON.stringify(`<div><h1>Tiêu <span class="w">đề</span></h1><p>Đoạn <strong>đậm</strong> <em>nghiêng</em> <a href="https://a.vn/x">link</a> <a href="javascript:alert(1)">xấu</a> <code>mã</code></p><div class="wrap"><button>Sao chép</button><pre><code>dòng 1\ndòng 2\n</code></pre></div><ul><li>Một<ul><li>Con</li></ul></li><li><p>Hai</p></li></ul><ol><li>A</li></ol><ol><li>B</li></ol><blockquote><p>Trích</p></blockquote><hr><div><table><thead><tr><th>C1</th></tr></thead><tbody><tr><td>v <strong>1</strong></td></tr></tbody></table></div><p><img src="data:image/png;base64,AAAA" alt="Ảnh A"></p><div><svg viewBox="0 0 1 1"></svg></div>chữ rời</div>`)},"text/html");return m.htmlToBlocks(d.body)})`);
  const kinds = blocks.map((b) => b.k).join();
  ok(kinds === "h,p,code,li,li,li,li,li,quote,hr,table,img,img,p", "đủ loại khối, đúng thứ tự, nút giao diện bị bỏ", kinds);
  ok(blocks[0].level === 1 && blocks[0].runs.map((r) => r.t).join("") === "Tiêu đề", "tiêu đề đúng cấp", JSON.stringify(blocks[0]));
  const rs = blocks[1].runs;
  ok(rs.find((r) => r.t === "đậm")?.b === 1 && rs.find((r) => r.t === "nghiêng")?.i === 1 && rs.find((r) => r.t === "link")?.href === "https://a.vn/x" && rs.find((r) => r.t === "mã")?.code === 1, "định dạng trong đoạn", JSON.stringify(rs));
  ok(!rs.find((r) => r.t === "xấu")?.href, "link javascript: bị bỏ", JSON.stringify(rs));
  ok(blocks[2].text === "dòng 1\ndòng 2", "khối mã giữ xuống dòng", JSON.stringify(blocks[2]));
  ok(blocks[3].level === 0 && blocks[4].level === 1 && blocks[4].runs[0].t === "Con" && blocks[5].runs[0].t === "Hai", "danh sách lồng nhau đúng cấp", JSON.stringify(blocks.slice(3, 6)));
  ok(blocks[6].ordered && blocks[7].ordered && blocks[6].list !== blocks[7].list, "hai danh sách số là hai danh sách riêng (đánh số lại từ 1)", JSON.stringify(blocks.slice(6, 8)));
  ok(blocks[10].rows[0].head && !blocks[10].rows[1].head && blocks[10].rows[1].cells[0].some((r) => r.b), "bảng có dòng tiêu đề", JSON.stringify(blocks[10]));
  ok(blocks[11].src?.startsWith("data:image/png") && blocks[12].svg?.includes("svg"), "ảnh và sơ đồ giữ lại", JSON.stringify(blocks.slice(11, 13)));

  console.log("6. Bản dịch");
  const dict = fs.readFileSync("shared/i18n-dict.ts", "utf8");
  const missing = V.STRINGS.filter((s) => !dict.includes(JSON.stringify(s) + ":"));
  ok(!missing.length, "mọi chuỗi của khung xem có tiếng Anh", missing.join(" | "));
  ok(!errors.length, "không có lỗi JavaScript", errors.join(" | "));
} catch (e) { ok(false, "lỗi khi chạy kiểm thử", e.stack); }
quit(fail ? 1 : 0);
