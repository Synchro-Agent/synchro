// Mẫu điền sẵn (app/designtemplates.ts và các mô-đun mẫu): model viết JSON, Synchro dựng HTML. Không cần máy chủ.
// Trình duyệt thật (co chữ, đổi màu chữ, ảnh chụp): tests/ui/design-templates.mjs.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { designtemplates: T, artifacts: AR, vfs: V, artdoc: D, designkit: K, artkit: A, deckpptx: X } = await loadTs(["designtemplates", "artifacts", "vfs", "artdoc", "designkit", "artkit", "deckpptx"]);
const block = (spec) => `<script type="application/json" data-sx-template>${JSON.stringify(spec)}</script>`;

console.log("1. Slide theo mẫu");
const deck = {
  styleArchetype: "linear-dark",
  pages: [
    { templateId: "slide-apple-intro", props: { badge: "Báo cáo Q3", title: "Doanh thu quý 3 vượt kế hoạch", subtitle: "Tổng kết cho ban điều hành", author: "Phòng Tài chính", date: "11/2026" } },
    { templateId: "slide-fact", props: { eyebrow: "Tăng trưởng Q3", bigMetric: "+142%", description: "Gấp đôi mục tiêu nhờ tự động hóa phễu khách hàng." }, morphId: "!!kpi" },
    { templateId: "slide-quote", props: { quote: "Khách hàng ở lại vì **tốc độ**.", author: "Nguyễn An", role: "Giám đốc vận hành" } },
    { templateId: "slide-section", props: { number: "02", title: "Kế hoạch quý 4", subtitle: "Ba ưu tiên" } },
    { templateId: "slide-two-cols", props: { eyebrow: "So sánh", title: "Kênh trực tiếp lãi gấp đôi", left: { heading: "Trực tiếp", bullets: ["Biên 32%", "CAC thấp"] }, right: { heading: "Đại lý", body: "Biên 15%.\n\nPhụ thuộc chiết khấu." } } },
    { templateId: "slide-image-right", props: { eyebrow: "Sản phẩm", title: "Ra mắt dòng mới", bullets: ["Nhẹ hơn 20%"], image: "https://images.unsplash.com/photo-1?w=1600", caption: "Ảnh minh họa" } },
    { templateId: "slide-depth-hero", props: { eyebrow: "Ra mắt", giantBehindText: "TỐC ĐỘ", subtitle: "Mẫu xe mới", image: "https://images.unsplash.com/photo-2?w=1600", cutout: "data:image/png;base64,iVBORw0KGgo=" }, morphId: "hero" },
    { templateId: "slide-bento-3", props: { eyebrow: "Kết quả", actionTitle: "Ba trụ cột đều tăng", heroCard: { title: "Doanh thu", metric: "$14.8M", detail: "Tăng 142% so với Q2" }, sideCardTop: { title: "Khách mới", bullet: "+3.200 tài khoản" }, sideCardBottom: { title: "Giữ chân", bullet: "92% sau 90 ngày" } } },
  ],
};
const html = T.expandTemplates(`<html><body>${block(deck)}</body></html>`);
const sections = html.match(/<section\b/g) ?? [];
ok(sections.length === 8, "8 trang thành 8 slide", sections.length);
ok(/<html data-sx-preset="midnight-tech"/.test(html), "styleArchetype linear-dark gắn thành phong cách midnight-tech trên <html>", html.slice(0, 120));
ok(D.isDeck({ type: "html", content: html }), "trang dựng ra là bản trình bày (trình chiếu, PDF, PowerPoint như thường)");
for (const id of ["slide-cover", "slide-fact", "slide-quote", "slide-section", "slide-two-cols", "slide-image-right", "slide-depth-hero", "slide-bento-3"]) ok(html.includes(`data-sx-template="${id}"`), `có mẫu ${id}`);
ok(/data-node-id="p2\.bigMetric"/.test(html) && /data-node-id="p8\.heroCard\.metric"/.test(html) && /data-node-id="p5\.left\.bullets\.0"/.test(html), "mỗi ô chữ có data-node-id theo trang.trường");
ok(/data-pptx-object-name="!!kpi"/.test(html) && /data-pptx-object-name="!!hero"/.test(html), "morphId thành tên đối tượng !!… cho PowerPoint Morph (tự thêm !! khi thiếu)");
ok(/sx-tpl-depth-giant"[^>]*data-pptx-flat/.test(html) && /class="sx-tpl-depth-cut"/.test(html), "chữ lồng sau vật thể: có ảnh tách nền thì chữ ở lại lớp ảnh khi xuất PowerPoint");
const plain = T.expandTemplates(block([{ templateId: "slide-depth-hero", props: { giantBehindText: "AI", subtitle: "x" } }]));
ok(/sx-tpl-depth-plain/.test(plain) && !/data-pptx-flat/.test(plain) && !/<img/.test(plain), "không có ảnh: nền cực quang tối, chữ là hộp chữ thường");
ok(/<strong class="sx-accent">tốc độ<\/strong>/.test(html), "**chữ** thành chữ nhấn");
ok(/Biên 15%\.<\/p><p class="sx-text"/.test(html), "dòng trống tách đoạn");

console.log("2. Dữ liệu của model là dữ liệu, không phải mã");
const evil = T.expandTemplates(block({ pages: [{ templateId: "slide-cover", props: { title: `<img src=x onerror=alert(1)>"'`, badge: "</script><script>alert(2)</script>", image: "javascript:alert(3)" } }, { templateId: "slide-image-right", props: { title: "x", image: `https://a.b/c.png" onload="alert(4)` } }] }));
ok(!/<img src=x|<script>alert|javascript:|onload=/.test(evil), "chữ được thoát HTML, ảnh chỉ nhận https / data:image", evil.slice(0, 400));
ok(T.expandTemplates(block({ pages: [{ templateId: "slide-khong-co", props: {} }] })).includes("không có mẫu"), "mẫu không có: để lại chú thích, không vỡ trang");
ok(T.expandTemplates(block({ pages: [{ templateId: "slide-fact", props: { bigMetric: { x: 1 }, description: 42 } }] })).includes(">42<"), "sai kiểu không làm hỏng: đối tượng bỏ qua, số thành chữ");
const big = T.expandTemplates(block({ pages: [{ templateId: "slide-quote", props: { quote: "a".repeat(100000) } }] }));
ok(big.length < 20000, "chuỗi quá dài bị cắt", big.length);

console.log("3. Đang stream, sửa tiếp, không đổi trang cũ");
const full = JSON.stringify(deck);
const cut = full.slice(0, full.indexOf('"slide-quote"') + 30);
const partial = T.expandTemplates(`<script type="application/json" data-sx-template>${cut}`);
ok((partial.match(/<section\b/g) ?? []).length === 2, "JSON chưa trọn: 2 trang đã đủ hiện trước", (partial.match(/<section\b/g) ?? []).length);
ok(T.expandTemplates(html) === html, "dựng lại trang đã dựng: không đổi");
const old = `<html><body><section class="slide">A</section></body></html>`;
ok(T.expandTemplates(old) === old, "trang không có khối mẫu: giữ nguyên từng byte");
const msg = `Đây là bộ slide.\n<artifact identifier="q3" type="text/html" title="Q3"><html><body>${block(deck)}</body></html></artifact>`;
const seg = AR.splitArtifacts(msg).find((s) => s.kind === "art");
ok(seg.art.content === html && seg.art.complete, "tách artifact: nội dung là trang đã dựng");
const streaming = AR.splitArtifacts(msg.slice(0, msg.indexOf('"slide-section"'))).find((s) => s.kind === "art");
ok(!streaming.art.complete && (streaming.art.content.match(/<section\b/g) ?? []).length === 3, "artifact đang viết: các trang đã đủ hiện dần", (streaming.art.content.match(/<section\b/g) ?? []).length);
const patch = `<artifact identifier="q3" mode="patch">\n<<<<<<< SEARCH\n</body>\n=======\n${block([{ templateId: "slide-fact", props: { bigMetric: "92%", description: "Giữ chân" } }])}</body>\n>>>>>>> REPLACE\n</artifact>`;
const st = V.artState([msg, patch]);
const v2 = st.get("q3");
ok(v2.v === 2 && (v2.content.match(/<section\b/g) ?? []).length === 9 && !/data-sx-template>\{/.test(v2.content) && v2.content.includes("92%"), "bản sửa thêm trang bằng khối mẫu: dựng luôn", v2.content.length);
ok(T.parseSpec('[{"templateId":"slide-fact","props":{"bigMetric":"1"}}]').pages.length === 1 && T.parseSpec('{"templateId":"slide-fact","props":{}}').pages.length === 1 && T.parseSpec('{"pages":[{"pageId":"a","layout":{"templateId":"slide-apple-fact","props":{"bigMetric":"2"}}}]}').pages[0].templateId === "slide-apple-fact", "nhận mảng trang, một trang, và dạng pages[].layout của bảng chủ dự án");

console.log("4. Model biết dùng mẫu, sửa tiếp nhận ra loại sản phẩm");
const t = K.designTurn({ typed: "Làm bộ slide báo cáo doanh thu", art: true, code: true, seed: "a" });
ok(t.block.includes("data-sx-template") && t.block.includes("slide-depth-hero") && t.block.includes("slide-bento-3") && t.block.includes("morphId"), "khối slide có thực đơn mẫu", t.bytes);
ok(t.bytes <= K.DESIGN_BUDGET && /Bộ CSS sẵn/.test(t.block), `vẫn trong trần, bộ CSS còn nguyên (${t.bytes} byte)`);
ok(!K.designTurn({ typed: "viết báo cáo thị trường", art: true, code: true, seed: "a" }).block.includes("slide-bento-3"), "tài liệu không nạp thực đơn slide");
ok(!/apple|linear|seriph|mckinsey|stripe|vercel/i.test(t.block.replace(/Google Fonts/g, "")), "thực đơn không nhắc tên hãng");
const prior = K.priorDesign([msg]);
ok(prior?.format === "slide" && prior.preset === "midnight-tech", "lượt sau nhận ra bộ slide viết bằng mẫu và phong cách của nó", JSON.stringify(prior));

console.log("5. Bộ CSS và xuất PowerPoint");
ok(A.usesKit(html) && A.KIT_CSS.includes(".sx-tpl-depth-giant{") && A.KIT_CSS.includes(".sx-tpl-fact-num{"), "trang dựng ra dùng bộ CSS, có CSS của mẫu");
ok(X.PPTX_FRAME_JS.includes("[data-pptx-flat]") && X.PPTX_FRAME_JS.includes("data-pptx-object-name"), "bộ đo PowerPoint: bỏ chữ data-pptx-flat, đọc tên đối tượng");
console.log("6. Thư HTML: chỉ bảng, style nội dòng");
const mail = (id, props, style = "exec-navy") => T.expandTemplates(`<html><body>${block({ styleArchetype: style, pages: [{ templateId: id, props }] })}</body></html>`);
const mails = {
  receipt: mail("email-apple-receipt", { brand: "Cửa hàng Mộc", orderId: "DH-20931", date: "11/11/2026", customer: "Trần Bảo Ngọc", paymentMethod: "Thẻ Visa ••4242", currency: "VND", items: [{ name: "Gói Pro 12 tháng", detail: "Gia hạn tự động", price: 1990000 }, { name: "Thêm 2 thành viên", qty: 2, price: 250000 }], tax: 249000, supportUrl: "https://example.com/ho-tro" }),
  welcome: mail("email-welcome", { brand: "Synchro", heading: "Chào mừng Lan tới Synchro", intro: "Tài khoản của bạn đã sẵn sàng.", steps: [{ title: "Tạo dự án đầu tiên", text: "Gom tệp và chỉ dẫn vào một chỗ." }, { title: "Mời đồng đội", text: "Cùng làm trên một đoạn chat." }], ctaLabel: "Bắt đầu", ctaUrl: "https://example.com/start", signoff: "Đội ngũ Synchro" }, "soft-bento"),
  code: mail("email-login-code", { brand: "Synchro", code: "482 913", expires: "Mã hết hạn sau 10 phút." }, "midnight-tech"),
  invite: mail("email-vercel-invite", { brand: "Synchro", inviter: "Phạm Minh Đức", inviterEmail: "duc@example.com", team: "Nhóm Tăng trưởng", role: "Thành viên", ctaUrl: "https://example.com/join?t=1" }, "neo-brutalist"),
};
for (const [k, h] of Object.entries(mails)) {
  const body = h.replace(/<head>[\s\S]*?<\/head>/, "");
  ok(h.startsWith("<!doctype html>") && !/<style|<link|class=|<div|<script|data-sx-|var\(--/i.test(h) && /<table role="presentation"/.test(h) && /max-width:600px/.test(h), `${k}: thư độc lập, không CSS ngoài, không class, không <div>, chỉ bố cục bảng`, h.slice(0, 300));
  ok(!/<(?!\/?(?:table|tr|td|a|span|strong|p|h1|br|html|body|head|meta|title)\b)[a-z]/i.test(body.replace(/<!doctype html>/i, "")), `${k}: chỉ các thẻ thư an toàn`, (/<(?!\/?(?:table|tr|td|a|span|strong|p|h1|br|html|body|head|meta|title)\b)[a-z][^>]*>/i.exec(body) ?? [""])[0]);
}
ok(/1\.990\.000 ₫/.test(mails.receipt) && /2 × 250\.000 ₫/.test(mails.receipt) && /2\.739\.000 ₫/.test(mails.receipt), "biên lai: tiền Việt viết 1.990.000 ₫, tổng tự cộng khi thiếu");
ok(/482 913/.test(mails.code) && /background:#F4F5F7/.test(mails.code) && !/#08090E/.test(mails.code) && /#4338CA/.test(mail("email-welcome", { ctaLabel: "Mở", ctaUrl: "https://example.com" }, "midnight-tech")), "phong cách tối: thư dùng nền sáng và màu nhấn của bảng in");
ok(/href="https:\/\/example\.com\/join\?t=1"/.test(mails.invite) && /PĐ|MĐ/.test(mails.invite), "lời mời: nút và liên kết dự phòng, chữ cái đầu của người mời");
ok(!/javascript:/.test(mail("email-welcome", { ctaLabel: "x", ctaUrl: "javascript:alert(1)" })), "liên kết chỉ https / mailto");
const mt = K.designTurn({ typed: "Thiết kế email chào mừng khách hàng mới", art: true, code: true, seed: "a" });
ok(mt?.format === "graphic" && mt.block.includes("email-receipt") && mt.block.includes("email-invite"), "yêu cầu thiết kế thư HTML: khối có thực đơn mẫu thư", mt?.format);
for (const q of ["Viết email xin nghỉ phép", "Viết email gửi sếp nói báo cáo sẽ trễ", "viết email mời họp thứ hai"]) ok(K.designTurn({ typed: q, art: true, code: true, seed: "a" }) === null, `viết một lá thư thường: không có khối ("${q}")`);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
