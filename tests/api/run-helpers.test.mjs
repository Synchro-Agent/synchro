// Công cụ đi kèm image workspace và ảnh xem lại của run_code: chạy trực tiếp, không cần máy chủ.
// subfit.py (phụ đề đúng cỡ), xlsx_recalc.py (ghi giá trị công thức vào tệp gốc; LibreOffice giả lập bằng SYNCHRO_SOFFICE), runpreview.ts (ghép nhiều ảnh).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-run-helpers-"));
const py = spawnSync("python3", ["--version"]).status === 0;

console.log("1. Phụ đề theo độ phân giải");
if (py) {
  const long = "Đây là một câu thật dài được edge-tts ghi nguyên vào một phụ đề duy nhất và nếu không chia ra thì sẽ che gần hết khung hình của video khi xem trên điện thoại";
  fs.writeFileSync(path.join(tmp, "a.srt"), `1\n00:00:01,000 --> 00:00:09,000\n${long}\n\n2\n00:00:09,500 --> 00:00:10,500\nNgắn {gọn}\n`);
  const sub = (size) => {
    const out = path.join(tmp, `${size}.ass`);
    const r = spawnSync("python3", ["workspace/subfit.py", path.join(tmp, "a.srt"), out, size], { encoding: "utf8" });
    return { r, text: r.status === 0 ? fs.readFileSync(out, "utf8") : "" };
  };
  const font = (t) => Number(/Style: Default,[^,]+,(\d+),/.exec(t)?.[1]);
  const land = sub("1920x1080"), vert = sub("1080x1920"), small = sub("1280x720");
  ok(land.r.status === 0 && /PlayResX: 1920/.test(land.text) && /PlayResY: 1080/.test(land.text), "PlayRes bằng đúng kích thước video", land.r.stderr);
  ok(font(land.text) >= 36 && font(land.text) <= 54, "1080p: cỡ chữ vừa (không còn ~82 px)", font(land.text));
  ok(font(vert.text) >= 36 && font(vert.text) <= 54, "video dọc: cỡ chữ vừa (không còn ~147 px)", font(vert.text));
  ok(font(small.text) < font(land.text), "720p chữ nhỏ hơn 1080p", font(small.text));
  const cues = (t) => t.split("\n").filter((l) => l.startsWith("Dialogue:")).map((l) => l.split(",").slice(9).join(","));
  for (const [nm, x] of [["1080p", land], ["dọc", vert]]) {
    const c = cues(x.text);
    ok(c.length >= 3, `${nm}: câu dài được chia thành nhiều phụ đề`, c.length);
    ok(c.every((t) => t.split("\\N").length <= 2 && t.split("\\N").every((l) => l.length <= 42)), `${nm}: tối đa 2 dòng, mỗi dòng tối đa 42 ký tự`, JSON.stringify(c));
  }
  ok(cues(land.text).at(-1) === "Ngắn (gọn)", "ngoặc nhọn không thành mã điều khiển của phụ đề", cues(land.text).at(-1));
  ok(spawnSync("python3", ["workspace/subfit.py", path.join(tmp, "a.srt"), path.join(tmp, "x.ass")]).status === 2, "thiếu kích thước thì báo cách dùng");
} else console.log("  (bỏ qua: máy không có python3)");

console.log("2. Tính lại công thức Excel");
if (py) {
  const dir = path.join(tmp, "x", "outputs");
  fs.mkdirSync(dir, { recursive: true });
  const mk = path.join(tmp, "mk.py");
  fs.writeFileSync(mk, String.raw`
import sys, zipfile
CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
REL = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
WB = '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Doanh thu" sheetId="1" r:id="rId1"/></sheets></workbook>'
def book(path, cells, extra=b""):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", CT); z.writestr("xl/workbook.xml", WB); z.writestr("xl/_rels/workbook.xml.rels", REL)
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1">' + cells + '</row></sheetData></worksheet>')
        if extra: z.writestr("xl/charts/chart1.xml", extra)
# Tệp gốc: như xlsxwriter (giá trị 0) và openpyxl (không có giá trị), có ô trống tự đóng, ô chuỗi, biểu đồ
book(sys.argv[1] + "/bao-cao.xlsx", '<c r="A1"><v>5</v></c><c r="B1"/><c r="C1" s="2"><f>A1*2</f><v>0</v></c><c r="D1" s="3"><f>A1*3</f></c><c r="E1" t="str"><f>"x"&amp;A1</f><v></v></c><c r="F1"><f>XLOOKUP(A1,A1,A1)</f><v>0</v></c>', b"<chart-giu-nguyen/>")
book(sys.argv[1] + "/khong-cong-thuc.xlsx", '<c r="A1"><v>5</v></c>')
# Bản LibreOffice xuất ra: giá trị đã tính
book(sys.argv[2], '<c r="A1"><v>5</v></c><c r="C1" s="9" t="n"><f aca="false">A1*2</f><v>10</v></c><c r="D1" s="9" t="n"><f aca="false">A1*3</f><v>15</v></c><c r="E1" s="9" t="str"><f aca="false">"x"&amp;A1</f><v>x5</v></c><c r="F1" s="9" t="e"><f aca="false">XLOOKUP(A1,A1,A1)</f><v>#NAME?</v></c>')
`);
  const lo = path.join(tmp, "lo-result.xlsx");
  ok(spawnSync("python3", [mk, dir, lo]).status === 0, "tạo tệp mẫu");
  // LibreOffice giả: chép bản đã tính vào --outdir, đồng thời ghi lại đối số để kiểm tra có bật chế độ luôn tính lại không.
  const fake = path.join(tmp, "soffice");
  fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > ${tmp}/args\nwhile [ $# -gt 0 ]; do case "$1" in -env:UserInstallation=file://*) P="\${1#-env:UserInstallation=file://}";; --outdir) O="$2"; shift;; esac; L="$1"; shift; done\ncat "$P/user/registrymodifications.xcu" > ${tmp}/xcu\ncp ${lo} "$O/$(basename "$L")"\n`, { mode: 0o755 });
  const r = spawnSync("python3", ["workspace/xlsx_recalc.py", dir], { encoding: "utf8", env: { ...process.env, SYNCHRO_SOFFICE: fake } });
  let rep = {}; try { rep = JSON.parse(r.stdout); } catch {}
  const b = rep.files?.[0];
  ok(rep.files?.length === 1 && b.path.endsWith("bao-cao.xlsx"), "chỉ xử lý sổ tính có công thức", r.stdout + r.stderr);
  ok(b?.formulas === 4 && b?.filled === 3, "báo đúng số công thức và số ô đã có giá trị", JSON.stringify(b));
  ok(b?.errors?.[0]?.cell === "F1" && b.errors[0].value === "#NAME?" && /XLOOKUP/.test(b.errors[0].formula), "ô LibreOffice báo lỗi được báo về cho model", JSON.stringify(b?.errors));
  ok(b?.sample?.includes("Doanh thu!C1=10"), "có vài giá trị để đối chiếu", JSON.stringify(b?.sample));
  ok(/OOXMLRecalcMode[\s\S]*<value>0<\/value>/.test(fs.readFileSync(path.join(tmp, "xcu"), "utf8")), "LibreOffice luôn tính lại khi mở (xlsxwriter tự xưng Excel)");
  const read = path.join(tmp, "rd.py");
  fs.writeFileSync(read, `import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(z.read(sys.argv[2]).decode())\n`);
  const part = (n) => spawnSync("python3", [read, path.join(dir, "bao-cao.xlsx"), n], { encoding: "utf8" }).stdout;
  const sh = part("xl/worksheets/sheet1.xml");
  ok(/<c r="C1" s="2"><f>A1\*2<\/f><v>10<\/v><\/c>/.test(sh), "xlsxwriter: số 0 được thay bằng giá trị thật, giữ kiểu ô của tệp gốc", sh);
  ok(/<c r="D1" s="3"><f>A1\*3<\/f><v>15<\/v><\/c>/.test(sh), "openpyxl: ô chưa có giá trị được điền", sh);
  ok(/<c r="E1" t="str"><f>"x"&amp;A1<\/f><v>x5<\/v><\/c>/.test(sh), "công thức ra chữ giữ kiểu str", sh);
  ok(/<c r="F1"><f>XLOOKUP\(A1,A1,A1\)<\/f><v>0<\/v><\/c>/.test(sh), "ô lỗi giữ nguyên, không ghi lỗi của LibreOffice vào tệp", sh);
  ok(/<c r="B1"\/>/.test(sh) && /<c r="A1"><v>5<\/v><\/c>/.test(sh), "ô không công thức giữ nguyên", sh);
  ok(part("xl/charts/chart1.xml").includes("<chart-giu-nguyen/>"), "biểu đồ và phần khác của tệp giữ nguyên");
  ok(/fullCalcOnLoad="1"/.test(part("xl/workbook.xml")), "Excel vẫn tự tính lại khi mở");
  // LibreOffice hỏng: tệp giữ nguyên, báo lý do cho model, không dừng các tệp khác.
  const before = fs.readFileSync(path.join(dir, "bao-cao.xlsx"));
  const bad = path.join(tmp, "soffice-bad");
  fs.writeFileSync(bad, "#!/bin/sh\necho hong >&2\nexit 3\n", { mode: 0o755 });
  const r2 = spawnSync("python3", ["workspace/xlsx_recalc.py", dir], { encoding: "utf8", env: { ...process.env, SYNCHRO_SOFFICE: bad } });
  const rep2 = JSON.parse(r2.stdout);
  ok(rep2.failed?.[0]?.path.endsWith("bao-cao.xlsx") && /hong/.test(rep2.failed[0].reason) && fs.readFileSync(path.join(dir, "bao-cao.xlsx")).equals(before), "LibreOffice lỗi: giữ nguyên tệp, báo lý do", r2.stdout);
} else console.log("  (bỏ qua: máy không có python3)");

console.log("3. Model xem được nhiều ảnh trong một lần");
const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");
const { runpreview: P } = await loadTs(["runpreview"]);
const png = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const meta = (b64) => sharp(Buffer.from(b64, "base64")).metadata();
ok((await P.previewOf([{ path: "a.txt", data: Buffer.from("x") }])) === undefined, "không có ảnh thì không kèm gì");
const one = await P.previewOf([{ path: "chart.png", data: await png(3000, 1000, "#f00") }]);
ok(one?.shown.join() === "chart.png" && (await meta(one.image)).width === 1600 && (await meta(one.image)).format === "jpeg", "một ảnh: thu nhỏ, đổi sang JPEG", JSON.stringify(one?.shown));
const frames = [];
for (let i = 0; i < 14; i++) frames.push({ path: `_preview/f${String(i).padStart(2, "0")}.png`, data: await png(640, 360, i % 2 ? "#0f0" : "#00f") });
const many = await P.previewOf([{ path: "bieu-do.png", data: await png(100, 100, "#f00") }, ...frames]);
ok(many?.shown.length === P.PREVIEW_MAX && many.shown[0] === "_preview/f00.png" && many.rest.includes("bieu-do.png") && many.rest.includes("_preview/f13.png"), "ưu tiên _preview/, tối đa 12 ảnh, nói rõ ảnh chưa xem", JSON.stringify(many?.rest));
const mm = await meta(many.image);
ok(mm.width <= 1800 && mm.height <= 2200 && mm.format === "jpeg", "tấm ghép không quá lớn", `${mm.width}x${mm.height}`);
const note = P.previewNote(many);
ok(/1\. _preview\/f00\.png/.test(note) && /12\. _preview\/f11\.png/.test(note) && /Chưa xem 3 ảnh/.test(note), "thẻ <preview> liệt kê đúng ảnh đã ghép", note);
// Ảnh thứ hai của tấm ghép phải thật sự có mặt: ô 1 xanh dương, ô 2 xanh lá.
const two = await P.previewOf([{ path: "_preview/a.png", data: await png(400, 400, "#00f") }, { path: "_preview/b.png", data: await png(400, 400, "#0f0") }, { path: "_preview/hong.png", data: Buffer.from("khong phai anh") }]);
ok(two?.shown.join() === "_preview/a.png,_preview/b.png", "ảnh hỏng bị bỏ, không làm mất các ảnh khác", JSON.stringify(two?.shown));
const raw = await sharp(Buffer.from(two.image, "base64")).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => [...raw.data.subarray((y * raw.info.width + x) * raw.info.channels, (y * raw.info.width + x) * raw.info.channels + 3)];
const W = raw.info.width, H = raw.info.height;
ok(px(Math.floor(W * .25), Math.floor(H * .5))[2] > 200 && px(Math.floor(W * .75), Math.floor(H * .5))[1] > 200, "cả hai ảnh đều nằm trong tấm ghép", JSON.stringify([px(Math.floor(W * .25), Math.floor(H * .5)), px(Math.floor(W * .75), Math.floor(H * .5))]));
const tall = await P.previewOf([{ path: "_preview/p1.png", data: await png(1080, 1920, "#00f") }, { path: "_preview/p2.png", data: await png(1080, 1920, "#0f0") }]);
const tm = await meta(tall.image);
ok(tm.height > 1400, "video dọc: ô cao theo ảnh, không thu bé lại thành một vệt", `${tm.width}x${tm.height}`);

console.log("4. Chạy lại cùng đường dẫn");
{
  const outs = [], by = new Map(), gone = [];
  const rm = (id) => gone.push(id);
  P.mergeOuts(outs, by, ["bao-cao.xlsx", "a/x.png"], [{ id: "1" }, { id: "2" }], rm);
  P.mergeOuts(outs, by, ["khac.pdf"], [{ id: "3" }], rm);
  P.mergeOuts(outs, by, ["bao-cao.xlsx"], [{ id: "4" }], rm);
  ok(outs.map((o) => o.id).join() === "4,2,3", "bản mới thay bản cũ tại chỗ, không thêm thẻ trùng", JSON.stringify(outs));
  ok(gone.join() === "1", "bản cũ bị xóa khỏi kho", gone.join());
  P.mergeOuts(outs, by, ["b/x.png"], [{ id: "5" }], rm);
  ok(outs.length === 4, "cùng tên nhưng khác thư mục: hai tệp khác nhau");
}

console.log("5. Quy tắc cho model khớp với thực tế");
const rules = fs.readFileSync("app/coderun.ts", "utf8"), docker = fs.readFileSync("workspace/Dockerfile", "utf8"), setup = fs.readFileSync("workspace/setup.sh", "utf8"), engine = fs.readFileSync("app/chatengine.ts", "utf8");
ok(!/công thức \([^)]*XLOOKUP/.test(rules) && /không dùng hàm mới \(XLOOKUP/.test(rules), "không khuyên XLOOKUP (LibreOffice trong image không tính được)");
ok(rules.includes('#,##0 "₫"') && !rules.includes('"#,##0 ₫"'), "định dạng tiền có ngoặc kép");
ok(/\.last_outputs/.test(rules) && !/FontSize=22,Outline=2'"; /.test(rules) && /subfit\.py/.test(rules), "nói đúng nơi đọc tệp lần trước và cách làm phụ đề");
ok(!/ảnh đầu tiên/.test(rules) && /PREVIEW_MAX/.test(rules), "nói đúng số ảnh model được xem");
ok(/fonts-crosextra-carlito/.test(docker) && /fonts-crosextra-caladea/.test(docker), "image có font thay thế Calibri, Cambria");
ok(/libreoffice-calc-nogui/.test(docker) && /COPY[^\n]*subfit\.py[^\n]*xlsx_recalc\.py/.test(docker) && /xlsx_recalc\.py --write-profile/.test(docker), "image có LibreOffice, công cụ đi kèm, hồ sơ luôn tính lại");
ok(/subfit\.py/.test(setup) && /xlsx_recalc\.py/.test(setup), "đổi công cụ đi kèm thì image được build lại");
ok(/recalc: true/.test(engine) && /Synchro chưa có công cụ tạo ảnh/.test(engine), "run_code bật tính lại; model nói thật về việc tạo ảnh");

console.log("6. Log dài không che lỗi và trạng thái");
{
  const { runtext: X } = await loadTs(["runtext"]);
  const { clipSink: wsSink } = await import("../../workspace/safefs.mjs");
  const log = "x".repeat(200_000) + "\nRuntimeError: hết bộ nhớ";
  const c = X.clipOut(log, 60_000);
  ok(c.length < 41_000 && c.endsWith("RuntimeError: hết bộ nhớ") && /Đã bỏ \d+ KB ở giữa/.test(c), "cắt giữ đầu và cuối, lỗi ở cuối còn nguyên", c.length);
  ok(X.clipOut("ngắn", 60_000) === "ngắn", "log ngắn giữ nguyên");
  ok(X.tidyLog("a\nframe=1\rframe=2\rframe=3\r\nb\r\n") === "a\nframe=3\nb\n", "thanh tiến trình chỉ còn trạng thái cuối", X.tidyLog("a\nframe=1\rframe=2\rframe=3\r\nb\r\n"));
  for (const [name, mk] of [["app/runtext.ts", X.clipSink], ["workspace/safefs.mjs", wsSink]]) {
    const s = mk();
    for (let i = 0; i < 3000; i++) s.push(Buffer.from(`status line ${i} ${"-".repeat(120)}\n`));
    s.push(Buffer.from("RuntimeError: moov atom not found\n"));
    const t = s.text();
    ok(t.startsWith("status line 0 ") && t.endsWith("moov atom not found\n") && /Đã bỏ \d+ KB ở giữa/.test(t) && t.length < 41_000, `${name}: 3000 dòng trạng thái rồi lỗi: model vẫn thấy lỗi`, t.length);
    const short = mk(); short.push(Buffer.from("xin chào")); short.push(Buffer.from(" bạn"));
    ok(short.text() === "xin chào bạn", `${name}: log ngắn không có dấu cắt`, short.text());
    const big = mk(); big.push(Buffer.alloc(100_000, 97)); big.push(Buffer.from("END"));
    ok(big.text().endsWith("END") && big.text().length < 41_000, `${name}: một khối rất lớn vẫn bị giới hạn`, big.text().length);
  }
  const tags = "\n<files>\noutputs/video.mp4 (20.0 MB) — đã gửi cho người dùng\n</files>\n<excel_recalc>\nx.xlsx\n</excel_recalc>\n<preview>Ảnh a.png đi kèm để bạn tự xem.</preview>";
  const b = X.runBlocks({ open: '<run_result language="python" exit_code="0">', close: "</run_result>", tags, stdout: "bắt đầu\n" + "o".repeat(8000) + "\nxong", stderr: "e".repeat(8000) + "\nCẢNH BÁO cuối" });
  ok(b.content.indexOf("<files>") < b.content.indexOf("<stdout>"), "thẻ trạng thái đứng trước log");
  ok(["<files>", "<excel_recalc>", "<preview>", "bắt đầu", "xong", "CẢNH BÁO cuối"].every((k) => b.brief.includes(k)) && b.brief.length < 3500, "bản rút gọn giữ thẻ trạng thái, đầu và cuối stdout, cuối stderr", b.brief.length);
  const R = fs.readFileSync("app/refs.ts", "utf8");
  ok(/summarize\(content, ref, brief\)/.test(R) && /r\.brief/.test(engine), "kết quả dài dùng bản rút gọn thay vì 30 dòng đầu");
  ok(X.plainSummary('<ref id="ref_1" chars="9">\n<run_result language="python" exit_code="0">\n<files>\noutputs/a.xlsx (1 KB) — đã gửi\n</files>') === "outputs/a.xlsx (1 KB) — đã gửi", "nhật ký làm việc không hiện thẻ nội bộ");
}

console.log("7. Mạng cho giọng đọc");
{
  const { catalog: K } = await loadTs(["catalog"]);
  const agentSrc = fs.readFileSync("workspace/agent.mjs", "utf8");
  const wsHosts = [...(/const PKG_HOSTS = \[([\s\S]*?)\];/.exec(agentSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok(wsHosts.join() === K.PKG_HOSTS.join(), "danh sách tên miền ở workspace và app giống nhau", wsHosts.join());
  ok(K.pkgHostAllowed("speech.platform.bing.com") && K.pkgHostAllowed("translate.google.com"), "edge-tts, gTTS ra được khi chỉ bật truy cập mạng");
  ok(!K.pkgHostAllowed("bing.com") && !K.pkgHostAllowed("www.bing.com") && !K.pkgHostAllowed("google.com") && !K.pkgHostAllowed("mail.google.com"), "không mở rộng hơn đúng hai dịch vụ đó");
  ok(/lồng tiếng trước hết bằng edge-tts/.test(rules) && /edge-tts --proxy "\$HTTPS_PROXY"/.test(rules) && /proxy=os\.environ\.get\("HTTPS_PROXY"\)/.test(rules) && !/cần quyền web/.test(rules), "quy tắc: edge-tts trước, đúng cờ proxy, không đòi quyền web");
  ok(/-loglevel error -stats/.test(rules) && /-crf 23 -preset veryfast/.test(rules) && /image2pipe/.test(rules), "quy tắc: log gọn, đĩa và dung lượng");
  ok(/espeak-ng/.test(docker) && /espeak-ng/.test(rules) && /"moviepy<2"/.test(docker), "image có giọng không cần mạng, ghim moviepy 1.x");
  ok(/RUN_PREVIEWS = 12/.test(agentSrc) && /PREVIEW_MAX = 12/.test(fs.readFileSync("app/runpreview.ts", "utf8")), "số ảnh tự xem khớp giữa workspace và quy tắc");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
