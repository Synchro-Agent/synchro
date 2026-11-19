// Lượt Antigravity không gửi chữ dần: dòng "vẫn đang viết" kèm điều Synchro đã biết (shared/turnpulse.ts) — bước đang
// làm trong danh sách việc và artifact đã nhận — có bản tiếng Anh. Khung artifact của bộ slide đang dựng ghi "Bản trình
// bày", không "Trang web". Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const mods = await loadTs(["shared/turnpulse", "shared/i18n-dict", "shared/artifacts"]);
const { "shared/turnpulse": P, "shared/i18n-dict": D, "shared/artifacts": A } = mods;
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
ok(A.artKindLabel({ type: "html", content: one, complete: true }) === "Trang web",
  "trang xong chỉ có một section: theo isDeck (Trang web)");
ok(A.artKindLabel({ type: "svg", content: "<svg/>", complete: true }) === "Hình SVG", "loại khác giữ tên loại");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
