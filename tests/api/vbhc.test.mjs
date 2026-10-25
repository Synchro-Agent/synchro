// Văn bản hành chính (NĐ 30/2020): tạo .docx từ JSON, kiểm tra khổ giấy, lề, phông, quốc hiệu, tiêu ngữ, số ký hiệu, ngày tháng, nơi nhận.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import os from "node:os";
const R = createRequire(process.cwd() + "/package.json");
const JSZip = R("jszip");
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
let cookie = "";
const call = async (p, body, raw) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return raw ? r : { s: r.status, j: await r.json().catch(() => null) };
};
await call("/api/auth/signup", { email: "vbhc-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Văn thư", birthDate: "2000-01-01" } });
await call("/api/auth/login", { email: "vbhc-member@synchro.test", password: "Member-pass-123" });
const CV = { loai: "cong-van", coQuanChuQuan: "UBND tỉnh Bắc Ninh", coQuan: "Sở Thông tin và Truyền thông", so: "", kyHieu: "sttt-cđs", diaDanh: "Bắc Ninh", ngay: "2026-02-05",
  trichYeu: "đề nghị bố trí kinh phí", kinhGui: ["Sở Tài chính"], noiDung: ["Đoạn một.", "Đề nghị **1.250.000.000 đồng**./."], quyenHan: "KT. Giám đốc", chucVu: "Phó Giám đốc", nguoiKy: "Nguyễn Văn An", noiNhan: ["Như trên;", "Lưu: VT, CĐS."] };
const docx = async (spec) => { const r = await call("/api/vbhc", { content: JSON.stringify(spec), name: "cong-van.docx" }, true); return { r, buf: Buffer.from(await r.arrayBuffer()) }; };

console.log("1. Công văn → .docx");
let { r, buf } = await docx(CV);
ok(r.status === 200 && /wordprocessingml/.test(r.headers.get("content-type") ?? "") && /attachment; filename="cong-van.docx"/.test(r.headers.get("content-disposition") ?? ""), "trả về tệp Word để tải", r.status);
const zip = await JSZip.loadAsync(buf);
const xml = await zip.file("word/document.xml").async("string");
const text = xml.replace(/<[^>]+>/g, "");
writeFileSync(os.tmpdir() + "/synchro-vbhc-cong-van.docx", buf);
ok(/w:pgSz w:w="11906" w:h="16838"|w:pgSz w:w="11906"[^>]*w:h="16838"/.test(xml) || /w:w="11906"/.test(xml), "khổ A4 (210 × 297 mm)", xml.match(/<w:pgSz[^>]*>/)?.[0]);
const mar = xml.match(/<w:pgMar[^>]*>/)?.[0] ?? "";
ok(/w:top="1134"/.test(mar) && /w:bottom="1134"/.test(mar) && /w:left="1701"/.test(mar) && /w:right="850"/.test(mar), "lề trên, dưới 20 mm, trái 30 mm, phải 15 mm", mar);
const styles = await zip.file("word/styles.xml").async("string");
ok(/Times New Roman/.test(styles) && /Times New Roman/.test(xml), "phông Times New Roman");
ok(text.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM") && text.includes("Độc lập - Tự do - Hạnh phúc"), "có quốc hiệu và tiêu ngữ");
ok(text.includes("UBND TỈNH BẮC NINH") && text.includes("SỞ THÔNG TIN VÀ TRUYỀN THÔNG"), "tên cơ quan chủ quản và cơ quan ban hành in hoa");
ok(/Số:\s+\/STTT-CĐS/.test(text), "số để trống chờ cấp, ký hiệu in hoa: " + (text.match(/Số:[^V]*/)?.[0] ?? ""), text.slice(0, 300));
ok(text.includes("V/v đề nghị bố trí kinh phí") && !text.includes("CÔNG VĂN"), "công văn: trích yếu sau V/v, không có tên loại");
ok(text.includes("Bắc Ninh, ngày 05 tháng 02 năm 2026"), "ngày dưới 10 và tháng 1, 2 thêm số 0 (NĐ 30)", text.match(/Bắc Ninh, ngày[^<]{0,30}/)?.[0]);
ok(text.includes("Kính gửi: Sở Tài chính"), "kính gửi");
ok(/<w:b\/>[\s\S]{0,200}1\.250\.000\.000 đồng/.test(xml), "chữ **đậm** trong nội dung");
ok(text.includes("KT. GIÁM ĐỐC") && text.includes("PHÓ GIÁM ĐỐC") && text.includes("Nguyễn Văn An"), "quyền hạn, chức vụ in hoa, họ tên người ký");
ok(text.includes("Nơi nhận:") && text.includes("- Như trên;") && text.includes("- Lưu: VT, CĐS."), "nơi nhận có gạch đầu dòng");
ok(/w:jc w:val="both"/.test(xml), "nội dung căn đều hai lề");

console.log("2. Quyết định");
({ r, buf } = await docx({ ...CV, loai: "quyet-dinh", kyHieu: "QĐ-UBND", ngay: "2026-11-20", trichYeu: "Về việc thành lập Tổ công tác", thamQuyen: "Chủ tịch Ủy ban nhân dân tỉnh", canCu: ["Căn cứ Luật Tổ chức chính quyền địa phương;"], noiDung: ["Điều 1. Thành lập Tổ công tác.", "Điều 2. Hiệu lực./."], kinhGui: [] }));
const t2 = (await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string"));
const tx2 = t2.replace(/<[^>]+>/g, "");
ok(tx2.includes("QUYẾT ĐỊNH") && tx2.includes("Về việc thành lập Tổ công tác") && tx2.includes("CHỦ TỊCH ỦY BAN NHÂN DÂN TỈNH") && tx2.includes("QUYẾT ĐỊNH:"), "tên loại, trích yếu, thẩm quyền, \"QUYẾT ĐỊNH:\"");
ok(tx2.includes("ngày 20 tháng 11 năm 2026"), "tháng 11 không thêm số 0");
ok(/<w:i\/>[\s\S]{0,200}Căn cứ Luật/.test(t2), "căn cứ in nghiêng");
ok(/<w:b\/>[\s\S]{0,120}Điều 1\./.test(t2), "\"Điều 1.\" in đậm");

console.log("3. Nội dung sai");
let e = await call("/api/vbhc", { content: "không phải json" });
ok(e.s === 400 && /JSON/.test(e.j.error), "không phải JSON → báo lỗi rõ", JSON.stringify(e.j));
e = await call("/api/vbhc", { content: JSON.stringify({ loai: "cong-van", coQuan: "X" }) });
ok(e.s === 400 && /Thiếu trường bắt buộc/.test(e.j.error), "thiếu trường → liệt kê trường thiếu: " + e.j?.error);
e = await call("/api/vbhc", { content: JSON.stringify({ ...CV, loai: "thu-tinh-cam" }) });
ok(e.s === 400 && /loai/.test(e.j.error), "loại văn bản lạ → báo lỗi");

console.log("4. Model tạo văn bản trong chat");
const c = await call("/api/llm", { system: "", model: "anthropic/claude-haiku-5-5", skills: true, messages: [{ role: "user", content: "Soạn công văn đề nghị Sở Tài chính bố trí kinh phí" }] });
ok(/type="application\/vnd\.synchro\.vbhc\+json"/.test(c.j?.text ?? ""), "câu trả lời có artifact văn bản hành chính", (c.j?.text ?? JSON.stringify(c.j)).slice(0, 300));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
