// Mẫu tham chiếu theo lượt và phong cách của người dùng (server/designrefs.ts, server/designstyles.ts,
// server/designfollow.ts, /api/design-styles): chọn mẫu trên thư viện thử, lịch sử không lặp, ẩn danh không ghi, ảnh
// JPEG cho model, "Phong cách của tôi" (lưu, đổi tên, tối đa 20, xóa), phong cách đọc từ ảnh, từ artifact, xóa tài
// khoản. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { loadTs } from "../lib/ts.mjs";
import { makeCatalog, writeCatalog } from "../fixtures/designpick/catalog.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-dstyles-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "k";
process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
process.env.DESIGN_REFS_DIR = path.join(tmp, "refs");
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
delete process.env.WS_AGENT_URL;
delete process.env.CODE_RUN;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const mods = await loadTs(["authstore", "server/designrefs", "server/designstyles", "server/designfollow",
  "shared/designrefs",
  "shared/designpick", "shared/designextract", "artifactstore", "purge", "api/design-styles/route",
  "api/design-styles/[id]/route", "api/design-styles/[id]/image/route"]);
const AS = mods.authstore;
const DR = mods["server/designrefs"];
const DS = mods["server/designstyles"];
const DF = mods["server/designfollow"];
const R = mods["shared/designrefs"];
const P = mods["shared/designpick"];
const X = mods["shared/designextract"];
const ART = mods.artifactstore;
const API = mods["api/design-styles/route"];
const API1 = mods["api/design-styles/[id]/route"];
const IMG = mods["api/design-styles/[id]/image/route"];
const cat = makeCatalog(R);
await writeCatalog(process.env.DESIGN_REFS_DIR, cat, sharp);
const briefs = JSON.parse(fs.readFileSync("tests/fixtures/designpick/owner-briefs.json", "utf8"));
const A = AS.createUser({ email: "a@dstyles.test", name: "A", verified: true });
const B = AS.createUser({ email: "b@dstyles.test", name: "B", verified: true });
const turn = (uid, b, o = {}) => DR.styleForTurn({ uid, conv: "c1", typed: b.text, format: b.format, ownBrand: false,
  sel: null, images: [], incognito: false, ...o });
const histN = (uid) => AS.db().prepare("SELECT COUNT(*) AS n FROM design_history WHERE user_id = ?").get(uid).n;
const req = (u, url, init = {}) => {
  const s = AS.createSession(u, new Request("http://localhost/"), "password");
  const headers = { cookie: s.split(";")[0], origin: "http://localhost", "content-type": "application/json" };
  return new Request(`http://localhost${url}`, { ...init, headers });
};
const png = async (bg, accent) => {
  const base = sharp({ create: { width: 400, height: 300, channels: 3, background: bg } });
  const bar = await sharp({ create: { width: 400, height: 40, channels: 3, background: accent } }).png().toBuffer();
  return base.composite([{ input: bar, top: 130, left: 0 }]).png().toBuffer();
};

try {
  console.log("1. Lượt thiết kế chọn mẫu từ thư viện");
  ok(DR.refRows().length === cat.rows.length, `đọc thư viện (${DR.refRows().length} mẫu)`);
  ok(DR.getRef("web-001")?.id === "web-001" && DR.getRef("../x") === null && DR.getRef("web-999") === null,
    "getRef: mã hợp lệ đọc được, mã lạ / không có thì null");
  const t1 = await turn(A.id, briefs[0]);
  ok(t1 && t1.refs.length === 3 && t1.refs.every((r) => r.source === "catalog"), "3 mẫu thư viện", t1?.refs);
  ok(t1.refs.map((r) => r.label).join() === "Mẫu 1,Mẫu 2,Mẫu 3", "nhãn Mẫu 1-3");
  ok(t1.mix.css.includes(`data-sx-mix="${t1.mix.id}"`) && t1.mix.domain === "slide", "bản trộn có khối CSS");
  ok(!JSON.stringify(t1.refs).includes("example"), "khối gửi model không có địa chỉ / tên trang nguồn");
  ok(histN(A.id) === 1, "ghi lịch sử sản phẩm");
  const same = await turn(A.id, briefs[0]);
  ok(same.refs.map((r) => r.id).join() === t1.refs.map((r) => r.id).join(), "cùng thương hiệu: giữ đúng bộ mẫu cũ");
  const other = { ...briefs[0], text: briefs[0].text.replace("Sương Sớm", "Mây Ngàn") };
  const t2 = await turn(A.id, other, { conv: "c2" });
  ok(t2.refs.every((r) => !t1.refs.some((x) => x.id === r.id)),
    "thương hiệu khác: không dùng lại mẫu của sản phẩm trước",
    [t1.refs.map((r) => r.id), t2.refs.map((r) => r.id)]);
  ok(P.mixKeys(t2.mix.tokens).paletteKey !== P.mixKeys(t1.mix.tokens).paletteKey, "bảng màu khác sản phẩm trước");
  const rec = DR.mixRecord(A.id, t1.mix.id);
  ok(rec && JSON.stringify(rec.tokens) === JSON.stringify(t1.mix.tokens) && rec.preset === t1.mix.preset,
    "mixRecord tìm lại token theo mã bản trộn");
  ok(DR.mixRecord(B.id, t1.mix.id) === null, "người khác không đọc được bản trộn của mình");
  const n0 = histN(A.id);
  await turn(A.id, briefs[1], { incognito: true });
  ok(histN(A.id) === n0, "ẩn danh: không ghi lịch sử");
  for (let k = 0; k < 52; k++) await turn(B.id, briefs[k % 7], { conv: `b${k}` });
  ok(histN(B.id) === 50, "giữ 50 sản phẩm mới nhất mỗi người", histN(B.id));
  ok(await turn(A.id, { text: "Tạo file Excel ngân sách", format: "sheet" }) === null, "bảng tính: null");
  const own = await turn(A.id, briefs[1], { ownBrand: true });
  ok(own.mix.tokens.colors.length === 0 && !/--sx-bg/.test(own.mix.css), "thương hiệu riêng: bản trộn không đặt màu");

  console.log("2. Ảnh mẫu cho model");
  const imgs = await DR.turnImages(t1, [1280, 800, 800]);
  ok(imgs.length === 3, "3 ảnh", imgs.length);
  const meta = await Promise.all(imgs.map((i) => sharp(i.jpeg).metadata()));
  ok(meta.every((m) => m.format === "jpeg"), "ảnh JPEG");
  ok(meta.every((m) => m.width === 320), "ảnh nhỏ hơn chiều rộng yêu cầu thì không phóng to", meta.map((m) => m.width));
  const label1 = `Mẫu tham chiếu 1 (không phải ảnh người dùng gửi): ${t1.refs[0].title}`;
  ok(imgs[0].label === label1, "nhãn ảnh", imgs[0].label);
  const again = await DR.turnImages(t1, [1280, 800, 800]);
  ok(again[0].jpeg === imgs[0].jpeg, "lần sau đọc từ bộ đệm");
  const big = path.join(process.env.DESIGN_REFS_DIR, t1.refs[1].id.split("-")[0], `${t1.refs[1].id}.webp`);
  fs.writeFileSync(big, await sharp({ create: { width: 1600, height: 900, channels: 3,
    background: "#123456" } }).webp().toBuffer());
  const resized = await DR.turnImages(t1, [1280, 800, 800]);
  ok((await sharp(resized[1].jpeg).metadata()).width === 800, "ảnh lớn thu về đúng chiều rộng (mẫu phụ 800)");

  console.log("3. Phong cách của tôi");
  const toks = t1.mix.tokens;
  const s1 = await DS.addStyle(A.id, { kind: "mine", name: "  Trà   đêm ", source: "artifact", tokens: toks });
  ok(s1.name === "Trà đêm" && s1.kind === "mine" && s1.expiresAt === null, "lưu, gọn tên", s1);
  const pub = DS.publicStyle(s1);
  ok(pub.swatches.length === 5 && pub.swatches.every(R.isHex) && pub.fonts.head && !("tokens" in pub),
    "dạng công khai", pub);
  ok(DS.getStyle(B.id, s1.id) === null, "người khác không đọc được");
  const t3 = await turn(A.id, briefs[2], { sel: { kind: "mine", id: s1.id } });
  ok(t3.refs[0].source === "mine" && t3.refs[0].roles.join() === "palette,type,shape",
    "chip phong cách: mẫu 1 là phong cách đó");
  ok(t3.refs.length === 2 && t3.refs[1].roles.join() === "layout", "kèm một mẫu thư viện chỉ cho bố cục", t3.refs);
  ok(t3.mix.tokens.fonts.head.kit === toks.fonts.head.kit, "giữ phông của phong cách đã lưu");
  const bgOf = (t) => JSON.stringify(t.colors.find((c) => c.role === "bg"));
  ok(bgOf(t3.mix.tokens) === bgOf(toks),
    "giữ màu nền của phong cách đã lưu");
  const t4 = await turn(A.id, briefs[2], { sel: { kind: "mine", id: "ds-0000000000000000" } });
  ok(t4.refs[0].source === "catalog" && /không còn/.test(t4.note ?? ""),
    "phong cách đã xóa: dùng thư viện, có ghi chú", t4.note);
  for (let k = 0; k < 19; k++) await DS.addStyle(A.id, { kind: "mine",
    name: `S${k}`, source: "artifact", tokens: toks });
  let full = null;
  try {
    await DS.addStyle(A.id, { kind: "mine", name: "thừa", source: "artifact", tokens: toks });
  } catch (e) {
    full = e;
  }
  ok(full instanceof DS.StyleError && full.status === 409, "tối đa 20 phong cách", full?.message);
  const r1 = DS.updateStyle(A.id, s1.id, { name: "Trà sáng" });
  ok(r1.name === "Trà sáng", "đổi tên");
  ok(DS.deleteStyle(A.id, s1.id) && DS.getStyle(A.id, s1.id) === null && !DS.deleteStyle(A.id, s1.id), "xóa");

  console.log("4. Phong cách đọc từ ảnh người dùng gửi");
  const shot = await png("#101418", "#ff5a1f");
  const real = X.paletteFromPixels(new Uint8Array(4 * 4 * 4).fill(200), 4, 4).length > 0;
  const facets = P.briefFacets(briefs[2].text, "graphic");
  let follow = null, ferr = null;
  try {
    follow = await DF.followStyle({ uid: B.id, facets, base: null, image: { media_type: "image/png",
      data: shot.toString("base64") } });
  } catch (e) {
    ferr = e;
  }
  if (real) {
    ok(follow?.kind === "follow" && follow.expiresAt > Date.now() && follow.tokens.theme === "dark",
      "ảnh nền tối: phong cách tối",
      follow);
    ok(fs.statSync(DS.styleImageFile(follow.id)).size <= 150_000, "ảnh lưu WebP dưới 150 KB");
    const tf = await turn(B.id, { text: `${briefs[2].text} Làm theo phong cách ảnh này.`, format: "graphic" },
      { images: [{ media_type: "image/png", data: shot.toString("base64") }] });
    ok(tf.refs[0].source === "follow", "câu gõ \"theo phong cách ảnh này\" + ảnh: mẫu 1 là ảnh người dùng", tf.refs);
    const fi = await DR.turnImages(tf, [1280, 800]);
    ok(fi[0]?.label === "Mẫu người dùng gửi: làm theo phong cách này", "nhãn ảnh người dùng gửi", fi[0]?.label);
  } else {
    ok(ferr instanceof DF.FollowError && /màu/.test(ferr.message), "chưa có bộ đọc điểm ảnh: báo không đọc được màu",
      ferr);
    const tf = await turn(B.id, { text: `${briefs[2].text} Làm theo phong cách ảnh này.`, format: "graphic" },
      { images: [{ media_type: "image/png", data: shot.toString("base64") }] });
    ok(tf.refs[0].source === "catalog" && /Không đọc được phong cách/.test(tf.note ?? ""),
      "câu gõ theo ảnh mà không đọc được: dùng thư viện, ghi chú cho model", tf.note);
  }
  let bad = null;
  try {
    await DF.followStyle({ uid: B.id, facets, base: null, image: { media_type: "text/html", data: "PGh0bWw+" } });
  } catch (e) {
    bad = e;
  }
  ok(bad instanceof DF.FollowError, "ảnh sai loại: báo lỗi");
  let nourl = null;
  try {
    await DF.followStyle({ uid: B.id, facets, base: null, url: "https://example.com/" });
  } catch (e) {
    nourl = e;
  }
  ok(nourl instanceof DF.FollowError && /ảnh chụp màn hình/.test(nourl.message),
    "không có sandbox: đề nghị gửi ảnh chụp", nourl);
  for (const u of ["file:///etc/passwd", "http://127.0.0.1:3200/", "http://localhost/", "http://192.168.1.2/",
    "https://u:p@x.vn/"]) {
    let e1 = null;
    try {
      DF.cleanUrl(u);
    } catch (e) {
      e1 = e;
    }
    ok(e1 instanceof DF.FollowError, `từ chối ${u}`);
  }
  ok(DF.cleanUrl("https://Example.com/a#b") === "https://example.com/a", "liên kết công khai: bỏ phần #");

  console.log("5. Lưu từ artifact");
  const content = `<html data-sx-preset="${t2.mix.preset}" data-sx-mix="${t2.mix.id}"><body>x</body></html>`;
  ART.saveArtifact(A.id, "c9", { ident: "deck", title: "Bộ trà", type: "html", content });
  const facetsG = P.briefFacets("", "graphic");
  const fromMix = await DF.artifactTokens(A.id, { content }, DR.mixRecord, facetsG);
  ok(JSON.stringify(fromMix) === JSON.stringify(t2.mix.tokens), "artifact có bản trộn: đúng token đã ghi");
  const shown = await DF.artifactTokens(A.id, { content, preset: "neo-brutalist" }, DR.mixRecord, facetsG);
  ok(shown.colors.find((c) => c.role === "bg").hex === "#fffdf5" && shown.fonts.head.kit === "space-grotesk",
    "đang thử phong cách khác: lấy phong cách đang hiện", shown.fonts);
  let need = null;
  try {
    await DF.artifactTokens(A.id, { content: "<div>trống</div>" }, DR.mixRecord, facetsG);
  } catch (e) {
    need = e;
  }
  ok(need instanceof DS.StyleError && need.status === 422, "artifact tự do, không ảnh: cần ảnh", need?.message);

  console.log("6. API");
  const list = await (await API.GET(req(A, "/api/design-styles"))).json();
  ok(list.styles.length === 19 && list.styles.every((s) => !s.tokens), "GET danh sách, không có token thô",
    list.styles.length);
  const post = (u, body) => API.POST(req(u, "/api/design-styles", { method: "POST", body: JSON.stringify(body) }));
  ok((await post(A, { from: "artifact", conv: "c9", ident: "deck", name: "Thứ 20" })).status === 200,
    "phong cách thứ 20");
  const r0 = await post(A, { from: "artifact", conv: "c9", ident: "deck", name: "Bộ trà" });
  ok(r0.status === 409, "đủ 20 phong cách: 409", r0.status);
  const ids = list.styles.slice(0, 3).map((s) => s.id);
  for (const id of ids) await API1.DELETE(req(A,
    `/api/design-styles/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
  const r2 = await post(A, { from: "artifact", conv: "c9", ident: "deck" });
  const j2 = await r2.json();
  ok(r2.status === 200 && j2.style.kind === "mine" && j2.style.name === "Bộ trà", "lưu artifact thành phong cách", j2);
  const r3 = await post(A, { from: "artifact", conv: "c9", ident: "khong-co" });
  ok(r3.status === 404, "artifact không có: 404");
  const r4 = await post(A, { from: "url", url: "https://example.com/" });
  ok(r4.status === 422 && /Không đọc được phong cách/.test((await r4.json()).error),
    "liên kết khi không có sandbox: 422");
  const r5 = await post(A, { from: "gì" });
  ok(r5.status === 400, "dữ liệu sai: 400");
  const ctx = (id) => ({ params: Promise.resolve({ id }) });
  const patch = (u, id, body) => API1.PATCH(req(u,
    `/api/design-styles/${id}`, { method: "PATCH", body: JSON.stringify(body) }), ctx(id));
  const p1 = await (await patch(A, j2.style.id, { name: "Trà đêm" })).json();
  ok(p1.style.name === "Trà đêm", "PATCH đổi tên");
  ok((await patch(B, j2.style.id, { name: "x" })).status === 404, "người khác không sửa được: 404");
  ok((await API1.DELETE(req(B,
    `/api/design-styles/${j2.style.id}`, { method: "DELETE" }), ctx(j2.style.id))).status === 404,
    "người khác không xóa được");
  const img = await IMG.GET(req(A, `/api/design-styles/${j2.style.id}/image`), ctx(j2.style.id));
  ok(img.status === 404, "phong cách không có ảnh: 404");
  const withImg = await DS.addStyle(B.id, { kind: "follow", name: "Ảnh", source: "image", tokens: toks, image: shot });
  const gi = await IMG.GET(req(B, `/api/design-styles/${withImg.id}/image`), ctx(withImg.id));
  ok(gi.status === 200 && gi.headers.get("content-type") === "image/webp", "chủ xem được ảnh");
  ok((await IMG.GET(req(A,
    `/api/design-styles/${withImg.id}/image`), ctx(withImg.id))).status === 404, "người khác: 404");
  const saved = await (await patch(B, withImg.id, { save: true, name: "Giữ lại" })).json();
  ok(saved.style.kind === "mine" && saved.style.expiresAt === null, "lưu phong cách đọc từ ảnh thành của tôi", saved);
  const old = await DS.addStyle(B.id, { kind: "follow", name: "Cũ", source: "image", tokens: toks, image: shot });
  AS.db().prepare("UPDATE design_styles SET expires_at = ? WHERE id = ?").run(Date.now() - 1, old.id);
  const oldFile = DS.styleImageFile(old.id);
  ok(!DS.listStyles(B.id).some((s) => s.id === old.id) && !fs.existsSync(oldFile), "hết 30 ngày: tự dọn dòng và ảnh");

  console.log("7. Xóa tài khoản");
  const dir = path.dirname(DS.styleImageFile(withImg.id));
  ok(fs.existsSync(dir), "có thư mục ảnh của B");
  AS.db().prepare("DELETE FROM users WHERE id = ?").run(B.id);
  await mods.purge.purgeUser(B.id);
  ok(!fs.existsSync(dir), "xóa thư mục ảnh");
  const left = AS.db().prepare("SELECT (SELECT COUNT(*) FROM design_styles WHERE user_id = ?) + "
    + "(SELECT COUNT(*) FROM design_history WHERE user_id = ?) AS n").get(B.id, B.id).n;
  ok(left === 0, "xóa dòng phong cách và lịch sử", left);
  ok(DS.listStyles(A.id).length > 0 && histN(A.id) > 0, "dữ liệu của người khác còn nguyên");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
