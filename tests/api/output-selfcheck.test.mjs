// W10 nhóm C (H1 lỗi 15, 16): tự kiểm sản phẩm sau run_code — tiêu đề Word lặp (T9), video tả là động mà đứng yên (T10) — và mốc thời gian
// của số liệu tra web phải chép đúng như nguồn (T6). Không cần máy chủ: hàm thuần trong server/docxcheck.ts, server/videomotion.ts + lời nhắc.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-selfcheck-")); process.env.DATA_KEY = "selfcheck-test";
const JSZip = createRequire(path.join(process.cwd(), "package.json"))("jszip");
const { docxcheck: D, videomotion: V } = await loadTs(["docxcheck", "videomotion"]);

// Tệp Word tối thiểu: các đoạn (chữ, kiểu, cỡ, đậm) và bảng.
const P = (text, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.right ? '<w:jc w:val="right"/>' : ""}</w:pPr><w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.sz ? `<w:sz w:val="${o.sz * 2}"/>` : ""}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const TBL = (rows) => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${P(c)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
const docx = async (body) => {
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return z.generateAsync({ type: "nodebuffer" });
};

console.log("1. Word: tiêu đề / đoạn lặp (docxcheck)");
{
  // Đúng hình T9: đoạn 1 chữ 9 pt căn phải (dòng đầu trang đặt nhầm vào thân), đoạn 2 tiêu đề 17 pt căn giữa, cùng chữ.
  const sign = TBL([["ĐẠI DIỆN [TÊN ĐƠN VỊ]", "ĐẠI DIỆN QUÝ ĐỐI TÁC"], ["(Ký, ghi rõ họ tên, đóng dấu nếu có)", "(Ký, ghi rõ họ tên, đóng dấu nếu có)"]]);
  const T9 = await docx(P("THƯ MỜI HỢP TÁC", { right: true, sz: 9 }) + P("THƯ MỜI HỢP TÁC", { b: true, sz: 17 }) + P("Kính gửi: Quý Đối tác") + TBL([["Nội dung", "[TÊN ĐƠN VỊ]", "Quý Đối tác"], ["Quyền lợi", "Có", "Có"]]) + P("Trân trọng.") + sign);
  const d = await D.docxIssues(T9);
  ok(d.length === 1 && d[0].text === "THƯ MỜI HỢP TÁC" && d[0].kind === "liền nhau" && d[0].at.join() === "1,2", "T9: tiêu đề “THƯ MỜI HỢP TÁC” ở hai đoạn liền nhau → báo", JSON.stringify(d));
  const note = await D.docxNote([{ path: "outputs/thu-moi-hop-tac.docx", data: T9 }]);
  ok(/<docx_check>/.test(note) && /thu-moi-hop-tac\.docx: “THƯ MỜI HỢP TÁC” lặp ở hai đoạn liền nhau/.test(note) && /header của section/.test(note), "thẻ <docx_check> gửi model nói tệp nào, chữ nào, cách sửa", note);
  const clean = await docx(P("THƯ MỜI HỢP TÁC", { b: true, sz: 17 }) + P("Kính gửi: Quý Đối tác") + P("Trân trọng.") + sign);
  ok((await D.docxIssues(clean)).length === 0 && (await D.docxNote([{ path: "outputs/a.docx", data: clean }])) === "", "tiêu đề một lần, hai cột ký giống nhau trong bảng → không báo");
  const heads = await docx(P("1. Phạm vi hợp tác", { style: "Heading1" }) + P("Nội dung A") + P("1. Phạm vi hợp tác", { style: "Heading1" }) + P("Nội dung B"));
  const h = await D.docxIssues(heads);
  ok(h.length === 1 && h[0].kind === "tiêu đề trùng" && h[0].at.join() === "1,3", "cùng một tiêu đề (Heading) xuất hiện hai lần cách nhau → báo", JSON.stringify(h));
  ok((await D.docxIssues(await docx(P("Có") + P("Có") + P("—") + P("—")))).length === 0, "đoạn ngắn (< 4 chữ cái) lặp như “Có”, “—” → không báo");
  ok((await D.docxIssues(Buffer.from("không phải zip"))).length === 0 && (await D.docxNote([{ path: "outputs/x.docx", data: Buffer.from("x") }])) === "", "tệp hỏng → bỏ qua im lặng");
  ok(D.stripTables("<a/><w:tbl><w:tbl>x</w:tbl>y</w:tbl><b/>").startsWith("<a/><w:p>") && D.stripTables("<a/><w:tbl><w:tbl>x</w:tbl>y</w:tbl><b/>").endsWith("<b/>"), "bỏ cả bảng lồng nhau");
}

console.log("2. Video: chuyển động thật theo thời gian (videomotion)");
{
  const W = V.MOTION_W, H = V.MOTION_H, px = W * H;
  // 8 giây, 4 khung/giây (33 khung): vòng sáng lan ra trong 2 giây đầu rồi đứng yên — đúng số đo T10 (lệch 28 / 4 rồi ~0).
  const frames = (n, f) => { const b = new Uint8Array(n * px); for (let k = 0; k < n; k++) for (let i = 0; i < px; i++) b[k * px + i] = f(k, i % W, Math.floor(i / W)); return b; };
  const ring = (k, x, y) => { const r = Math.min(k, 8) * 3, d = Math.hypot(x - W / 2, y - H / 2); return Math.abs(d - r) < 2 ? 230 : 40 + (k === 0 ? 50 : 0); };
  const T10 = frames(33, ring), rate = 4;
  const diffs = V.frameDiffs(T10, rate);
  ok(diffs.length === 32 && diffs[0].t === 0.25 && diffs[0].d > 20 && diffs.slice(9).every((x) => x.d === 0), "độ lệch giữa hai khung liền nhau theo thời gian", JSON.stringify(diffs.slice(0, 10).map((x) => x.d.toFixed(1))));
  const m = V.motionProfile(diffs, 8, rate);
  ok(m.flagged && m.stillFrom !== null && Math.abs(m.stillFrom - 2) < 0.3 && m.longestStill.to === 8, "T10: đứng yên từ khoảng 2 s đến hết → bị đánh dấu", JSON.stringify({ stillFrom: m.stillFrom, longest: m.longestStill, flagged: m.flagged }));
  ok(m.buckets.length === 8 && m.buckets[0].d > 5 && m.buckets.slice(3).every((b) => b.d < V.STILL), "hồ sơ theo từng giây: giây đầu động, từ giây 3 đứng yên", JSON.stringify(m.buckets.map((b) => b.d.toFixed(1))));
  const line = V.motionLine("synchro-logo.mp4", m, rate);
  console.log("    " + line);
  ok(/^synchro-logo\.mp4 \(8\.0 s, đo 4 khung\/giây\)/.test(line) && /GẦN NHƯ ĐỨNG YÊN từ 2\.0 s đến hết \(6\.0 s, 75% thời lượng\)/.test(line), "dòng cho model: tên, thời lượng, hồ sơ, đoạn đứng yên", line);
  const moving = frames(33, (k, x, y) => ((x + y + k * 5) % 32) * 6);
  const mm = V.motionProfile(V.frameDiffs(moving, 4), 8, 4);
  ok(!mm.flagged && mm.stillFrom === null && !/ĐỨNG YÊN/.test(V.motionLine("a.mp4", mm, 4)), "chuyển động suốt video → không đánh dấu");
  // Giữ khung logo 1,5 giây cuối là chủ ý, không phải lỗi.
  const hold = frames(33, (k, x, y) => (k <= 26 ? ((x + k * 3) % 40) * 5 : ((x + 26 * 3) % 40) * 5));
  const mh = V.motionProfile(V.frameDiffs(hold, 4), 8, 4);
  ok(!mh.flagged && mh.stillFrom !== null, "giữ khung cuối ~1,5 giây → không đánh dấu (vẫn ghi trong hồ sơ)", JSON.stringify({ stillFrom: mh.stillFrom, flagged: mh.flagged }));
  // Đứng yên ở giữa video dài: báo đúng đoạn.
  const mid = frames(81, (k, x) => (k < 20 || k > 50 ? ((x + k * 4) % 40) * 5 : ((x + 20 * 4) % 40) * 5));
  const md = V.motionProfile(V.frameDiffs(mid, 4), 20, 4);
  ok(md.flagged && Math.abs(md.longestStill.from - 5) < 0.3 && Math.abs(md.longestStill.to - 12.5) < 0.3 && md.stillFrom === null && /từ 5\.0 s đến 12\.5 s/.test(V.motionLine("b.mp4", md, 4)), "đoạn đứng yên giữa video (5–12,5 s) → báo đúng khoảng", V.motionLine("b.mp4", md, 4));
  const long = V.motionProfile(V.frameDiffs(frames(241, (k, x) => ((x + k) % 30) * 7), 2), 120, 2);
  ok(long.buckets.length <= 24 && long.buckets[0].to - long.buckets[0].from === 5, "video dài (120 s): gộp còn ≤ 24 khoảng", long.buckets.length);
  ok(V.frameDiffs(new Uint8Array(px), 4).length === 0, "một khung → không có gì để so");
}

console.log("3. Nối vào run_code và lời nhắc");
{
  const tools = fs.readFileSync("server/chat/tools.ts", "utf8"), code = fs.readFileSync("server/coderun.ts", "utf8"), kit = fs.readFileSync("server/videokit.ts", "utf8"), prompt = fs.readFileSync("server/chat/prompt.ts", "utf8");
  ok(/await docxNote\(r\.files\)/.test(tools) && /await videoMotionNote\(x\.uid, r\.files, runSignal\(\)\)/.test(tools) && /\$\{totals\}\$\{docx\}\$\{motion\}/.test(tools), "run_code gửi <docx_check> và <video_motion> cho model sau lần chạy thành công");
  ok(/r\.exit === 0 && !r\.timedOut \? await videoMotionNote/.test(tools), "chỉ đo video của lần chạy thành công");
  ok(/<video_motion>/.test(code) && /<docx_check>/.test(code), "quy tắc run_code nói về hai thẻ tự kiểm mới");
  ok(/7\) Chuyển động thật/.test(kit) && /tblend=all_mode=difference,signalstats/.test(kit) && /<video_motion>/.test(kit), "khối video_kit: bước tự đo chuyển động bằng ffmpeg trước khi tả");
  ok(/Mốc thời gian chép đúng như nguồn ghi/.test(prompt) && /không tự suy ra, đổi múi giờ/.test(prompt), "T6: số liệu tra web ghi đúng mốc thời gian của nguồn");
  const vm = fs.readFileSync("server/videomotion.ts", "utf8");
  ok(/net: false/.test(vm) && /timeout: 90/.test(vm) && /slice\(0, 2\)/.test(vm), "đo trong sandbox không mạng, có giới hạn thời gian, tối đa 2 video");
}

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
