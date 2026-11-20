// Ảnh tạo ra: tên tệp ngắn có nghĩa theo chủ thể của lời nhờ, đúng tỉ lệ xin, đúng số ảnh (gói trả thừa tệp thì
// chỉ giao tệp đúng tỉ lệ). Không cần máy chủ: imagegen / imagefiles qua loadTs, ảnh thử dựng bằng sharp.
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900));
};
const mods = await loadTs(["ai/imagegen", "ai/imagefiles"]);
const IG = mods["ai/imagegen"], IF = mods["ai/imagefiles"];

console.log("1. Ảnh: tên ngắn có nghĩa, đúng tỉ lệ, đúng số ảnh");
{
  const honey = "Tạo ảnh: ảnh chụp sản phẩm cho quảng cáo tạp chí, một lọ mật ong rừng thủy tinh không nhãn trên"
    + " mặt đá travertine sáng màu, bên cạnh là que lấy mật bằng gỗ và vài nhánh hoa cà phê trắng. Tỉ lệ 4:5.";
  const slug = IG.requestSlug(honey);
  ok(slug === "lo-mat-ong-rung-thuy-tinh", "đề ảnh mật ong → lo-mat-ong-rung-thuy-tinh", slug);
  const short = IG.requestSlug("Vẽ cho tôi một con mèo đội mũ") === "con-meo-doi-mu";
  ok(short && IG.requestSlug("Tạo ảnh quả táo đỏ trên bàn") === "qua-tao-do-tren-ban", "lời nhờ ngắn: tên như trước");
  const en = IG.requestSlug("Product photo for a magazine ad: a glass jar of wild honey on travertine, morning light");
  ok(en === "glass-jar-of-wild-honey", "tiếng Anh: bỏ vế chỉ loại ảnh", en);
  ok(["4:5", "2:3"].every((a) => IG.ASPECTS.includes(a)), "nhận tỉ lệ 4:5, 2:3 của ảnh tạp chí");
  const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");
  const img = (w, h, fmt = "jpeg") =>
    sharp({ create: { width: w, height: h, channels: 3, background: "#c98a2b" } })[fmt]().toBuffer();
  const sq = { name: "a.jpg", mime: "image/jpeg", data: await img(1024, 1024) };
  const r = await IF.fitAspect([sq], "4:5", 1);
  const m = await sharp(r.files[0].data).metadata();
  const cut = r.files.length === 1 && m.width === 819 && m.height === 1024 && /4:5/.test(r.notes[0] ?? "");
  ok(cut, "ảnh vuông khi xin 4:5 → cắt giữa còn 819×1024, báo cho model", { w: m.width, h: m.height, notes: r.notes });
  const right = { name: "b.png", mime: "image/png", data: await img(896, 1120, "png") };
  const twoFiles = await IF.fitAspect([sq, right], "4:5", 1);
  const [only] = twoFiles.files;
  const one = twoFiles.files.length === 1 && only.name === "b.png" && only.data.equals(right.data);
  ok(one && !twoFiles.notes.length, "gói trả hai tệp cho một ảnh → chỉ giao tệp đúng tỉ lệ, giữ nguyên byte");
  ok((await IF.fitAspect([sq], undefined, 1)).files[0].data.equals(sq.data), "không xin tỉ lệ: giữ nguyên ảnh");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
