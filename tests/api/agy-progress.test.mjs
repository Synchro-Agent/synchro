// Lượt Antigravity không gửi chữ dần: dòng "vẫn đang viết" kèm điều Synchro đã biết (shared/turnpulse.ts) — bước đang
// làm trong danh sách việc và artifact đã nhận — có bản tiếng Anh. Khung artifact của bộ slide đang dựng ghi "Bản trình
// bày", không "Trang web". Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const mods = await loadTs(["shared/turnpulse", "shared/i18n-dict", "shared/artifacts", "chat/prompt"]);
const { "shared/turnpulse": P, "shared/i18n-dict": D, "shared/artifacts": A, "chat/prompt": PR } = mods;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x)); };
const en = (t) => { for (const [re, f] of D.RULES_EN) { const m = re.exec(t); if (m) return f(m); } return null; };

const plan = [
  { content: "Đọc brief", status: "completed" },
  { content: "Dựng 8 slide", status: "in_progress" },
  { content: "Tự kiểm hiển thị", status: "pending" },
];
ok(P.turnPulse(undefined, []) === "", "chưa biết gì: rỗng (dòng chỉ đếm giây)");
ok(P.turnPulse(plan, []) === "bước 2/3: Dựng 8 slide", "danh sách việc: bước đang làm", P.turnPulse(plan, []));
const allDone = plan.map((i) => ({ ...i, status: "completed" }));
ok(P.turnPulse(allDone, []) === "xong 3/3 việc", "không bước nào đang làm: số việc đã xong", P.turnPulse(allDone, []));
const open = `<artifact identifier="moc" type="text/html" title="Mộc — Hồ sơ gọi vốn 2026">`;
const deck = `${open}${"x".repeat(23410)}</artifact>`;
const both = P.turnPulse(plan, ["Lời dẫn.", `Bản đã giữ:\n${deck}\nHết.`]);
ok(both === "bước 2/3: Dựng 8 slide · đã nhận “Mộc — Hồ sơ gọi vốn 2026”, 23.410 ký tự",
  "artifact đã nhận: tên và số ký tự (chỉ phần trong thẻ)", both);
ok(P.turnPulse(undefined, ["<artifact identifier=\"a\">abc"]) === "đã nhận 3 ký tự artifact",
  "artifact chưa đóng thẻ, không tên");

const line = `Antigravity vẫn đang viết, đã 95 giây · ${both}`;
const want = "Antigravity is still writing, 95 seconds so far · step 2/3: Dựng 8 slide"
  + " · received “Mộc — Hồ sơ gọi vốn 2026”, 23,410 characters";
ok(en(line) === want, "bản tiếng Anh: tên bước và tên artifact giữ nguyên chữ model viết", en(line));
ok(en("Antigravity vẫn đang viết, đã 30 giây") === "Antigravity is still writing, 30 seconds so far",
  "dòng chỉ đếm giây vẫn dịch như trước");
const done2 = en("Antigravity vẫn đang viết, đã 60 giây · xong 2/2 việc");
ok(done2 === "Antigravity is still writing, 60 seconds so far · 2/2 tasks done", "số việc đã xong", done2);

console.log("Tên loại trên khung artifact");
const bare = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Mộc</title>";
ok(A.artKindLabel({ type: "html", content: bare, complete: false }) === "Đang tạo…",
  "mới có phần đầu tệp: chưa đoán loại");
const head = "<!doctype html><html><head><style>body{margin:0}.slide{width:1280px;height:720px}</style></head><body>";
ok(A.artKindLabel({ type: "html", content: head, complete: false }) === "Bản trình bày",
  "bộ slide mới viết phần <style>: Bản trình bày");
const one = `${head}<section class="slide cover"><h1>Mộc</h1></section>`;
ok(A.artKindLabel({ type: "html", content: one, complete: false }) === "Bản trình bày",
  "mới có trang bìa: Bản trình bày");
const page = "<!doctype html><html><body><header>Nếp</header><section class=\"hero\"><h1>Nếp</h1></section>";
ok(A.artKindLabel({ type: "html", content: page, complete: false }) === "Trang web",
  "landing page đang viết: Trang web");
// Carousel lời khen / dự án của landing page có luật ".slide {": vẫn là trang web.
const carousel = "<!doctype html><html><head><style>.hero{padding:80px}.track{display:flex;overflow:hidden}"
  + ".slide{flex:0 0 100%;padding:24px}.slide img{width:100%}</style></head><body><header>Nếp</header>"
  + "<section class=\"testimonials\"><div class=\"track\"><div class=\"slide\">“Tuyệt vời”</div>";
ok(A.artKindLabel({ type: "html", content: carousel, complete: false }) === "Trang web",
  "landing page có carousel .slide đang viết: Trang web", A.artKindLabel({ type: "html", content: carousel }));
const full = "<!doctype html><html><head><style>.slide{width:100vw;height:100vh;padding:8vh}</style></head><body>";
ok(A.artKindLabel({ type: "html", content: full, complete: false }) === "Bản trình bày",
  "slide cả màn hình (100vw x 100vh) trong <style>: Bản trình bày");
const ratio = "<!doctype html><html><head><style>.slide { aspect-ratio: 16 / 9 }</style></head><body>";
ok(A.artKindLabel({ type: "html", content: ratio, complete: false }) === "Bản trình bày",
  "slide khổ 16:9: Bản trình bày");
ok(A.artKindLabel({ type: "html", content: one, complete: true }) === "Trang web",
  "trang xong chỉ có một section: theo isDeck (Trang web)");
ok(A.artKindLabel({ type: "svg", content: "<svg/>", complete: true }) === "Hình SVG", "loại khác giữ tên loại");

console.log("Lời nhắc của Antigravity: danh sách việc có giới hạn số lần gọi");
// Mỗi lần gọi công cụ là thêm một lượt model trên hạn mức gói Google của người dùng.
const agyNote = PR.CLI_TOOLS_NOTE("agy", false, false);
ok(agyNote.includes("mcp_synchro_update_plan một lần trước khi viết") && agyNote.includes("nhiều nhất 3 lần"),
  "Antigravity: gọi danh sách việc một lần trước khi viết, cả lượt nhiều nhất 3 lần", agyNote.slice(-400));
ok(!agyNote.includes("gọi lại khi xong mỗi bước"), "không còn yêu cầu gọi lại sau mỗi bước");
ok(!PR.CLI_TOOLS_NOTE("claude", false, false).includes("nhiều nhất 3 lần"), "CLI khác không nhận giới hạn này");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
