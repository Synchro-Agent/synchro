// Bộ phông Synchro tự phục vụ (/kitfonts/v1/, tools/fetch-kit-fonts.mjs): đủ 17 phông, đủ bộ tiếng Việt, khớp mã băm đã
// ghim, giấy phép đi kèm, trong ngân sách; xuất PNG / SVG nhúng đúng phông của Synchro thay cho Google Fonts; chữ logo
// SVG thành đường nét. Không cần máy chủ, không cần mạng. Trình duyệt thật với Google Fonts bị chặn:
// tests/ui/design-kit.mjs.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-kitfonts-"));
process.env.DATA_DIR = path.join(tmp, "data");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
delete process.env.CODE_RUN;
const M = await loadTs(["shared/kitfonts", "shared/designrefs", "shared/designpresets", "artfonts", "artdoc",
  "server/fontoutline", "artkit"]);
const KF = M["shared/kitfonts"], RF = M["shared/designrefs"], DP = M["shared/designpresets"];
const AF = M.artfonts, AD = M.artdoc, FO = M["server/fontoutline"], AK = M.artkit;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const DIR = "public/kitfonts/v1";

console.log("1. Tệp phông khớp danh sách đã ghim");
{
  const ids = RF.KIT_FONTS.map((f) => f.id);
  ok(ids.length === 17 && ids.every((id) => KF.KIT_FONT_FILES[id]?.length),
    "đủ 17 phông của bộ", ids.filter((id) => !KF.KIT_FONT_FILES[id]));
  let total = 0;
  const bad = [];
  for (const [id, files] of Object.entries(KF.KIT_FONT_FILES)) {
    for (const f of files) {
      const p = path.join(DIR, id, f.file);
      if (!fs.existsSync(p)) {
        bad.push(`${id}/${f.file}: thiếu`);
        continue;
      }
      const buf = fs.readFileSync(p);
      total += buf.length;
      if (buf.length !== f.bytes || sha(buf) !== f.sha256) bad.push(`${id}/${f.file}: khác mã băm`);
      if (buf.subarray(0, 4).toString("latin1") !== "wOF2") bad.push(`${id}/${f.file}: không phải woff2`);
    }
  }
  ok(!bad.length, "mọi tệp có mặt, đúng woff2, khớp sha256 và kích thước", bad);
  ok(total === KF.KIT_FONT_BYTES && total <= 8 * 1024 * 1024,
    `cả bộ ${(total / 1048576).toFixed(2)} MB, trong ngân sách 8 MB`, total);
  const noVi = ids.filter((id) => !KF.KIT_FONT_FILES[id].some((f) => f.subset === "vietnamese"));
  ok(!noVi.length, "phông nào cũng có bộ ký tự tiếng Việt", noVi);
  const serif = RF.KIT_FONTS.filter((f) => f.italic).map((f) => f.id);
  ok(serif.length === 4 && serif.every((id) => KF.KIT_FONT_FILES[id].some((f) => f.style === "italic")),
    "4 phông có chân có bản nghiêng", serif);
  const ofl = (id) => fs.readFileSync(path.join(DIR, id, "OFL.txt"), "utf8");
  const oflBad = ids.filter((id) => !/SIL OPEN FONT LICENSE/i.test(ofl(id)));
  ok(!oflBad.length && RF.KIT_FONTS.every((f) => f.licence === "OFL-1.1"),
    "mọi phông là OFL-1.1, OFL.txt đi kèm", oflBad);
}

console.log("2. face.css");
for (const f of RF.KIT_FONTS) {
  const css = fs.readFileSync(path.join(DIR, f.id, "face.css"), "utf8");
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  const fam = [...css.matchAll(/font-family:"([^"]+)"/g)].map((m) => m[1]);
  const faces = (css.match(/@font-face/g) ?? []).length;
  const real = (u) => /^\.\/[\w.-]+\.woff2$/.test(u) && fs.existsSync(path.join(DIR, f.id, u));
  const ranges = (css.match(/unicode-range:/g) ?? []).length;
  ok(faces === KF.KIT_FONT_FILES[f.id].length && urls.every(real) && fam.every((x) => x === f.family)
    && ranges === faces,
    `${f.family}: mỗi tệp một mặt, đường dẫn tương đối có thật, đúng tên họ, có unicode-range`,
    { faces, urls: urls.slice(0, 2), fam: fam[0] });
}
const spec = (f) => DP.FONT_SPEC[f.family];
ok(RF.KIT_FONTS.every((f) => spec(f)?.id === f.id && spec(f).stack === RF.fontStack(f.id)),
  "FONT_SPEC có đủ 17 phông, chuỗi dự phòng theo fontStack()");
ok(KF.kitFaceUrl("https://s.example", "inter") === "https://s.example/kitfonts/v1/inter/face.css",
  "địa chỉ face.css theo origin");

console.log("3. Xuất ảnh, SVG nhúng phông của Synchro");
{
  const origin = "https://s.example";
  const asked = [];
  // fetch giả: đọc đúng tệp trong public/; Google Fonts không được gọi khi đã có bộ của Synchro.
  const get = async (u) => {
    asked.push(String(u));
    const p = String(u).startsWith(origin) ? path.join("public", String(u).slice(origin.length)) : "";
    if (!p || !fs.existsSync(p)) return { ok: false };
    const buf = fs.readFileSync(p);
    const arrayBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    return { ok: true, text: async () => buf.toString("utf8"), arrayBuffer };
  };
  const page = `<html data-sx-preset="editorial-serif"><body><h1 class="sx-title">Lò Ấm</h1></body></html>`;
  const withLink = AK.withKitFontLink(page, origin);
  ok(withLink.includes(`${origin}/kitfonts/v1/playfair-display/face.css`) && withLink.includes("fonts.googleapis.com"),
    "trang có preset: ghi face.css của Synchro và địa chỉ Google dự phòng", withLink.slice(-300));
  const css = await AF.fontEmbedCss(withLink, get);
  const faces = css.match(/@font-face/g) ?? [];
  const inlined = (css.match(/url\(data:font\/woff2;base64,d09GMg/g) ?? []).length;
  ok(faces.length >= 3 && !/url\(\.\//.test(css) && inlined === faces.length,
    "mặt phông nhúng dạng data: woff2 (đường dẫn tương đối đã giải theo face.css)",
    { n: faces.length, head: css.slice(0, 200) });
  ok(!asked.some((u) => u.includes("googleapis") || u.includes("gstatic")),
    "có bộ của Synchro: không gọi Google Fonts", asked.filter((u) => /google|gstatic/.test(u)));
  ok(/Playfair Display/.test(css) && /Be Vietnam Pro/.test(css),
    "đúng hai họ phông của preset (tiêu đề, thân) có ký tự trang dùng");
  asked.length = 0;
  const latin = `<html data-sx-preset="editorial-serif"><body>Lo Am</body></html>`;
  await AF.fontEmbedCss(AK.withKitFontLink(latin, origin), get);
  const woff = asked.filter((u) => u.endsWith(".woff2"));
  ok(woff.some((u) => u.endsWith("-latin.woff2")) && !woff.some((u) => u.endsWith("-vietnamese.woff2")),
    "trang không có chữ có dấu: không tải bộ tiếng Việt (chia theo unicode-range)", woff);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">`
    + `<text x="10" y="60" font-family="Fraunces" font-size="48">Lò Ấm</text></svg>`;
  ok(AF.svgKitFonts(svg).join() === "fraunces", "SVG: nhận phông viết thẳng trong font-family", AF.svgKitFonts(svg));
  const out = await AF.svgDownload(svg, origin, get);
  const head = /<svg[^>]*><style><!\[CDATA\[@font-face\{font-family:"Fraunces"/.test(out);
  ok(head && out.includes("data:font/woff2;base64,"),
    "tệp SVG tải về mang phông nhúng trong <style>", out.slice(0, 200));
  const bare = `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
  ok(AD.svgExport(bare) === bare, "SVG không dùng bộ, không phông nhúng: giữ nguyên từng byte");
}

console.log("4. Chữ logo thành nét");
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-sx-preset="editorial-serif" viewBox="0 0 600 300">`
    + `<text data-sx-logo x="300" y="120" text-anchor="middle" font-family="var(--sx-head)" font-size="96"`
    + ` font-weight="700" letter-spacing="-0.02em" fill="#1b1b1b">Lò Ấm</text>`
    + `<text data-sx-logo x="10" y="200" style="font-family:'Fraunces';font-size:40px;font-style:italic;`
    + `font-weight:500">Ỗ &amp; ự</text>`
    + `<text x="10" y="280" font-family="Inter" font-size="16">chữ thường giữ nguyên</text>`
    + `<text data-sx-logo x="10" y="290" font-family="Comic Sans MS" font-size="16">phông ngoài bộ</text></svg>`;
  const found = FO.logoTexts(svg);
  ok(found.length === 2, "chỉ chữ data-sx-logo, phông trong bộ, có cỡ chữ", found.map((x) => x.logo.text));
  const [a, b] = found.map((x) => x.logo);
  ok(a.font === "playfair-display" && a.weight === 700 && a.size === 96 && a.anchor === "middle"
    && Math.abs(a.tracking + 0.02) < 1e-9 && a.fill === "#1b1b1b",
  "var(--sx-head) theo preset của hình, đọc đủ độ đậm, cỡ, căn, giãn chữ, màu", a);
  ok(b.font === "fraunces" && b.italic && b.weight === 500 && b.text === "Ỗ & ự",
    "đọc thuộc tính trong style, giải mã &amp;", b);
  const italic = FO.filesFor("fraunces", 500, true);
  ok(italic.every((p) => /^fraunces\/italic-100-900-/.test(p)) && italic.length === 3,
    "phông biến thiên: đủ 3 bộ ký tự của bản chứa độ đậm", italic);
  const semi = FO.filesFor("be-vietnam-pro", 650, false);
  const black = FO.filesFor("be-vietnam-pro", 900, false)[0];
  ok(semi.every((p) => /normal-(600|700)-/.test(p)) && black.includes("normal-800-"),
    "phông tĩnh: độ đậm gần nhất", semi);
  const mixSvg = `<svg data-sx-mix="m-1"><style data-sx-mix="m-1">[data-sx-mix="m-1"]`
    + `{--sx-head:"Unbounded","Noto Sans",sans-serif}</style></svg>`;
  ok(FO.kitFamilyOf("var(--sx-head)", mixSvg) === "unbounded" && FO.kitFamilyOf("Arial", mixSvg) === null,
    "var(--sx-head) theo khối token trộn trước preset");
  ok((await FO.outlineLogos("u", svg)) === null, "không có sandbox: không đổi được, nơi gọi giữ chữ kèm phông nhúng");
  const plain = `<svg><text x="1" y="1" font-family="Inter" font-size="9">x</text></svg>`;
  ok((await FO.outlineLogos("u", plain)) === plain, "không có chữ logo: trả nguyên hình");
  // Phần fontTools chạy trong sandbox (có fontTools và brotli). Máy thử có cả hai thì chạy thật trên tệp woff2 của bộ.
  const py = spawnSync("python3", ["-c", "import fontTools, brotli"], { encoding: "utf8" });
  if (py.status !== 0) console.log("  (bỏ qua bước fontTools: máy này không có fontTools / brotli, sandbox có sẵn)");
  else {
    const dir = fs.mkdtempSync(path.join(tmp, "outline-"));
    fs.writeFileSync(path.join(dir, "outline.py"), FO.OUTLINE_PY);
    const files = FO.filesFor("fraunces", 700, false);
    for (const f of files) {
      fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
      fs.copyFileSync(path.join(DIR, f), path.join(dir, f));
    }
    const items = [{ text: "Lò Ấm", weight: 700, size: 96, tracking: -0.02, files }];
    fs.writeFileSync(path.join(dir, "outline.json"), JSON.stringify({ items }));
    const r = spawnSync("python3", ["outline.py"], { cwd: dir, encoding: "utf8" });
    const res = r.status === 0 ? JSON.parse(r.stdout.trim()) : [];
    ok(res[0]?.d.startsWith("M") && res[0].width > 200 && !res[0].missing.length,
      "fontTools dựng nét đủ ký tự có dấu", r.stderr || res);
  }
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
