// Tệp của đoạn chat trong thư mục chạy code: bản gốc người dùng gửi và ảnh đã tạo nằm ở inputs/<tên>. Không cần máy chủ; phần chạy thật dùng sandbox cục bộ của macOS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const XLSX = createRequire(path.join(process.cwd(), "package.json"))("xlsx");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-inputs-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "inputs-key";
process.env.CODE_RUN = "local";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { runinputs: RI, fileproc: FP, coderun: CR, authstore: AS, outputs: OUT, artimg: AI, artdoc: AD, "ai/imagegen": IG } = await loadTs(["runinputs", "fileproc", "coderun", "authstore", "outputs", "artimg", "artdoc", "ai/imagegen"]);
const U = AS.createUser({ email: "a@inputs.test", name: "A", verified: true });
const uid = U.id;
const written = [];
const CACHE = path.join(process.cwd(), ".cache", "files");

console.log("1. Tên tệp");
ok(RI.inputName("Báo cáo tháng 10.xlsx") === "Báo cáo tháng 10.xlsx", "giữ tiếng Việt và dấu cách");
ok(!RI.inputName("../../etc/passwd").includes("/"), "không có dấu gạch chéo", RI.inputName("../../etc/passwd"));
ok(!RI.inputName("..").startsWith(".") && RI.inputName("..").length > 0, "tên chỉ có dấu chấm thành tên hợp lệ", RI.inputName(".."));
ok(RI.inputName("x".repeat(400) + ".xlsx").endsWith(".xlsx") && RI.inputName("x".repeat(400) + ".xlsx").length <= 180, "cắt tên dài vẫn giữ đuôi");

console.log("2. Tệp người dùng gửi tới được inputs/");
const rows = [["Ngày", "Tiền"]]; for (let i = 0; i < 1000; i++) rows.push([`d${i}`, i]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
const rec = await FP.processFile(buf, "Doanh số.xlsx", uid);
written.push(rec.id);
const blocks = await FP.buildContext([rec.id], { [rec.id]: "Doanh số.xlsx" }, "", uid);
const msgs = [{ role: "user", content: [...blocks, { type: "text", text: "Thêm cột tổng" }] }];
let r = await RI.runInputs(uid, msgs, [], new Set());
ok(r.names.join() === "Doanh số.xlsx" && r.files[0].path === "inputs/Doanh số.xlsx" && r.files[0].data.equals(buf), "đúng bản gốc, đủ byte", r.names);
ok(/đã cắt, chỉ hiện 200\/1000/.test(rec.blocks[0].text) && /inputs\//.test(rec.blocks[0].text), "phần chữ trích báo rõ có bản gốc đủ dòng");
const other = AS.createUser({ email: "b@inputs.test", name: "B", verified: true });
r = await RI.runInputs(other.id, msgs, [], new Set());
ok(!r.files.length, "tài khoản khác không lấy được tệp qua id trong tin nhắn", r.names);

console.log("3. Chép mỗi tệp một lần trong lượt; không giữ thư mục thì chép mỗi lần");
const sent = new Set();
r = await RI.runInputs(uid, msgs, [], sent);
ok(r.files.length === 1, "lần đầu chép");
r = await RI.runInputs(uid, msgs, [], sent);
ok(!r.files.length && !r.names.length, "lần sau trong lượt không chép lại", r.names);
r = await RI.runInputs(uid, msgs, []);
ok(r.files.length === 1, "không có sent: chép lại");

console.log("4. Ảnh đã tạo: trong lượt và từ lượt trước");
const png = Buffer.from("89504e470d0a1a0a", "hex");
const [o1] = OUT.saveOutputs(uid, [{ path: "anh-moi.png", data: png }]);
r = await RI.runInputs(uid, [], [o1.id], new Set());
ok(r.names.join() === "anh-moi.png" && r.files[0].data.equals(png), "ảnh vừa tạo trong lượt vào inputs/", r.names);
const traced = [{ role: "assistant", content: "x", trace: [{ name: "generate_image", status: "ok", summary: "Đã tạo 1 ảnh.\n<files>\nanh-moi.png (8 B) — đã gửi cho người dùng\n</files>" }, { name: "run_code", status: "ok", summary: '<run_result>\n<files>\noutputs/khong-con.xlsx (1 KB) — đã gửi cho người dùng\n</files>' }, { name: "generate_image", status: "error", summary: "sai.png (1 B) — đã gửi cho người dùng" }] }];
ok(RI.tracedOutputs(traced).join() === "khong-con.xlsx,anh-moi.png", "đọc tên từ dấu vết, bỏ công cụ lỗi", RI.tracedOutputs(traced));
r = await RI.runInputs(uid, traced, [], new Set());
ok(r.names.join() === "anh-moi.png", "ảnh lượt trước vào inputs/, tệp đã hết hạn thì bỏ qua", r.names);

console.log("5. Quá dung lượng");
const big = Buffer.alloc(RI.INPUTS_MAX + 1, 1);
const [o2] = OUT.saveOutputs(uid, [{ path: "lon.bin", data: big }]);
r = await RI.runInputs(uid, [], [o2.id, o1.id], new Set());
ok(r.over.join() === "lon.bin" && r.names.join() === "anh-moi.png", "tệp quá lớn được báo, tệp khác vẫn chép", r);

console.log("6. Chạy thật");
if (process.platform === "darwin") {
  const inp = await RI.runInputs(uid, msgs, [], new Set());
  const keep = `inputs-test-${Date.now()}`;
  const run = await CR.execRun({ uid, keep, net: false, argv: ["node", "main.js"], files: [{ path: "main.js", data: Buffer.from('const fs=require("fs");const b=fs.readFileSync("inputs/Doanh số.xlsx");console.log(fs.readdirSync("inputs").join(),b.length);') }, ...inp.files] });
  ok(run.exit === 0 && run.stdout.includes(`Doanh số.xlsx ${buf.length}`), "code đọc được tệp ở inputs/, đúng số byte", run.stdout + run.stderr);
  const again = await CR.execRun({ uid, keep, net: false, argv: ["node", "main.js"], files: [{ path: "main.js", data: Buffer.from('console.log(require("fs").readdirSync("inputs").join())') }] });
  ok(again.stdout.includes("Doanh số.xlsx"), "lần chạy sau trong cùng đoạn chat vẫn thấy tệp", again.stdout + again.stderr);
  ok(!again.files.some((f) => f.path.includes("Doanh")), "tệp đầu vào không tự thành tệp giao cho người dùng", again.files.map((f) => f.path));
  fs.rmSync(path.join(os.tmpdir(), "synchro-keep", uid.replace(/[^\w-]/g, "_")), { recursive: true, force: true });
}

console.log("7. Tệp đã tải lên bằng bộ đọc cũ được đọc lại khi dùng tới");
const f = path.join(CACHE, rec.id + ".json"), old = JSON.parse(fs.readFileSync(f, "utf8"));
fs.writeFileSync(f, JSON.stringify({ ...old, v: undefined, blocks: [{ type: "text", text: "## Sheet: S (bản cũ sai)" }] }));
const ctx = await FP.buildContext([rec.id], { [rec.id]: "Doanh số.xlsx" }, "", uid);
ok(ctx.some((b) => b.type === "text" && /Tiền: min=0/.test(b.text)) && !ctx.some((b) => /bản cũ sai/.test(b.text ?? "")), "buildContext đọc lại bản mới", ctx.map((b) => (b.text ?? "").slice(0, 80)));

console.log("8. Ảnh đã tạo trong artifact");
const url = AD.genImageUrl(o1.id);
ok(AD.genImageId(url) === o1.id && !AD.genImageId("https://example.com/x.png") && !AD.genImageId("https://image.synchro.invalid/../x.png"), "nhận đúng địa chỉ ảnh đã tạo");
ok(AD.externalImageUrls(`<img src="${url}"><div style="background:url(${url})">`).join() === url, "đi chung đường với ảnh ngoài trong HTML");
ok(AD.externalImageUrls(`const hero = "${url}";`).join() === url, "chuỗi trong mã React cũng nhận ra");
const img = await AI.fetchImage(url, uid);
ok(img?.mime === "image/png" && img.data.equals(png), "chủ tài khoản đọc được ảnh", img?.mime);
ok(!(await AI.fetchImage(url, other.id)), "tài khoản khác không đọc được ảnh dù biết địa chỉ");
ok(!(await AI.fetchImage(url)), "không đăng nhập thì không đọc được");
const inl = await AI.inlineImages(`<img src="${url}">`, uid);
ok(inl.startsWith('<img src="data:image/png;base64,') && !inl.includes("invalid"), "máy kiểm tra hiển thị thấy ảnh thật", inl.slice(0, 80));
const shared = await AI.shareImageData(url, uid);
ok(shared?.startsWith("data:image/png"), "bản chia sẻ nhúng được ảnh");

console.log("9. Tên ảnh theo lời người dùng");
ok(IG.requestSlug("Vẽ cho tôi một con mèo đội mũ") === "con-meo-doi-mu", "bỏ phần xin, giữ nội dung", IG.requestSlug("Vẽ cho tôi một con mèo đội mũ"));
ok(IG.requestSlug("Tạo ảnh quả táo đỏ trên bàn #tool=generate_image") === "qua-tao-do-tren-ban", "bỏ thẻ #", IG.requestSlug("Tạo ảnh quả táo đỏ trên bàn #tool=generate_image"));
ok(IG.requestSlug("Draw me a cat in a hat") === "cat-in-a-hat", "tiếng Anh", IG.requestSlug("Draw me a cat in a hat"));
ok(IG.requestSlug("làm đi") === "" && IG.requestSlug("Tạo ảnh") === "" && IG.requestSlug("画一只猫") === "", "lời nhờ không đặt tên được thì dùng mô tả ảnh");
ok(IG.requestSlug("<current_time>10:00</current_time>\nVẽ một ngôi nhà gỗ") === "ngoi-nha-go", "không lấy nhầm khối hệ thống", IG.requestSlug("<current_time>10:00</current_time>\nVẽ một ngôi nhà gỗ"));
const longName = IG.requestSlug("Vẽ một bức tranh phong cảnh núi non hùng vĩ với dòng sông uốn lượn qua thung lũng xanh");
ok(longName.length <= 40 && !longName.endsWith("-") && longName.startsWith("phong-canh"), "tên dài cắt ở ranh giới từ", longName);

console.log("10. Cỡ ảnh để giữ chỗ trong tin nhắn");
const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");
const blank = sharp({ create: { width: 640, height: 360, channels: 3, background: "#123456" } });
for (const k of ["png", "jpeg", "webp"]) ok(JSON.stringify(OUT.imageSize(await blank.clone()[k]().toBuffer())) === '{"w":640,"h":360}', `đọc được cỡ ${k}`, OUT.imageSize(await blank.clone()[k]().toBuffer()));
const lossless = await blank.clone().webp({ lossless: true }).toBuffer();
ok(JSON.stringify(OUT.imageSize(lossless)) === '{"w":640,"h":360}', "đọc được cỡ WebP không nén mất", OUT.imageSize(lossless));
ok(OUT.imageSize(Buffer.from("không phải ảnh")) === null && OUT.imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0xff])) === null, "tệp hỏng không ném lỗi");
const [sized] = OUT.saveOutputs(uid, [{ path: "co.png", data: await blank.clone().png().toBuffer() }]);
ok(sized.w === 640 && sized.h === 360, "thẻ tệp mang theo cỡ ảnh", sized);
ok(!OUT.saveOutputs(uid, [{ path: "a.txt", data: Buffer.from("x") }])[0].w, "tệp khác không có cỡ");

for (const id of written) for (const x of [".bin", ".json"]) fs.rmSync(path.join(CACHE, id + x), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
