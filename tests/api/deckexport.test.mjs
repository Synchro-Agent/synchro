// G4: xuất PowerPoint ở máy chủ (deckexport.ts) — chạy deckpptx.ts trong Chromium của workspace.
// Thuần, không cần máy chủ Chromium: kiểm tra các điều kiện chặn, và quan trọng nhất là deckpptx.ts biên dịch sang JS trình duyệt
// rồi gắn vào window.__deck có buildPptx (đúng cơ chế sẽ chạy trong Chromium). Đường chạy đầy đủ (dựng .pptx thật) do orchestrator chạy sau.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-deckexport-")));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "deckexport-test"; process.env.CODE_RUN = "off";

const { deckexport: D } = await loadTs(["deckexport"]);

const DECK = `<!doctype html><html><body><section class="slide"><h1>Một</h1></section><section class="slide"><h1>Hai</h1></section></body></html>`;

console.log("1. Điều kiện chặn");
let r = await D.exportDeckPptx("u", { type: "react", content: "x", title: "T" }, "https://synchro.net.nz");
ok(!r.ok && /slide|bản trình bày/i.test(r.error), "không phải slide HTML → từ chối", r);
r = await D.exportDeckPptx("u", { type: "html", content: "<p>chỉ một trang</p>", title: "T" }, "https://synchro.net.nz");
ok(!r.ok, "HTML không phải bộ slide → từ chối", r);
r = await D.exportDeckPptx("u", { type: "html", content: DECK, title: "T", complete: false }, "https://synchro.net.nz");
ok(!r.ok && /chưa viết xong/.test(r.error), "bản trình bày chưa xong → từ chối", r);
r = await D.exportDeckPptx("u", { type: "html", content: DECK, title: "T" }, "https://synchro.net.nz");
ok(!r.ok && /Chromium|workspace/.test(r.error), "không có workspace → báo rõ, không treo", r);

console.log("2. deckpptx biên dịch sang JS trình duyệt (window.__deck)");
const js = await D.deckBrowserJs();
ok(typeof js === "string" && js.includes("window.__deck"), "có mã gắn window.__deck", js.slice(0, 80));
// Chạy thử với shim window: lúc nạp chỉ chạy hằng số ở cấp ngoài (không đụng DOM); buildPptx dùng window khi gọi.
const win = {};
new Function("window", "self", "document", js)(win, win, { title: "x" });
ok(win.__deck && typeof win.__deck.buildPptx === "function", "window.__deck.buildPptx là hàm", Object.keys(win.__deck || {}).slice(0, 8));
ok(typeof win.__deck.PPTX_FRAME_JS === "string" && /sxPptx/.test(win.__deck.PPTX_FRAME_JS), "window.__deck.PPTX_FRAME_JS có sxPptx", typeof win.__deck.PPTX_FRAME_JS);
ok(typeof win.__deck.boxOptions === "function" && typeof win.__deck.chartArgs === "function", "các hàm phụ cũng có mặt");
// Nạp lần hai dùng bộ nhớ đệm.
ok((await D.deckBrowserJs()) === js, "biên dịch được nhớ lại, không làm lại mỗi lần");

console.log("3. SEC-5: chỉ xuất nội dung của chính người dùng, mạng theo quyền");
{
  const text = `Xong.\n<artifact identifier="q3-deck" type="text/html" title="Báo cáo Q3">${DECK}</artifact>\n<artifact identifier="q3-deck" mode="patch">x</artifact>`;
  const d = D.deckFromText(text, "Q3-Deck");
  ok(d && d.type === "html" && d.content === DECK && d.title === "Báo cáo Q3" && d.complete === true, "lấy đúng bản đầy đủ trong kết quả lượt (bỏ bản vá)", JSON.stringify(d)?.slice(0, 200));
  ok(D.deckFromText(text, "khac") === null, "identifier không có → null");
  // W23-11: bản vá sau bản đầy đủ được áp (xuất đúng bản người dùng đang thấy, không phải bản cũ); vá hỏng / vá mà không có bản đầy đủ → null.
  const patched = `<artifact identifier="q3-deck" type="text/html" title="Báo cáo Q3">${DECK}</artifact>\nSửa:\n<artifact identifier="q3-deck" mode="patch">\n<<<<<<< SEARCH\n<h1>Hai</h1>\n=======\n<h1>Hai (đã sửa)</h1>\n>>>>>>> REPLACE\n</artifact>`;
  const dp = D.deckFromText(patched, "q3-deck");
  ok(dp && dp.content.includes("<h1>Hai (đã sửa)</h1>") && !dp.content.includes("<h1>Hai</h1>") && dp.title === "Báo cáo Q3" && dp.type === "html" && dp.complete === true, "W23-11: bản vá sau cùng được áp vào bản đầy đủ", dp?.content);
  const broken = `<artifact identifier="q3-deck" type="text/html" title="Báo cáo Q3">${DECK}</artifact>\n<artifact identifier="q3-deck" mode="patch">\n<<<<<<< SEARCH\n<h1>Không có</h1>\n=======\n<h1>X</h1>\n>>>>>>> REPLACE\n</artifact>`;
  ok(D.deckFromText(broken, "q3-deck") === null, "W23-11: bản vá áp không được → không xuất bản cũ");
  ok(D.deckFromText(`<artifact identifier="q3-deck" mode="patch">\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n</artifact>`, "q3-deck") === null, "W23-11: chỉ có bản vá, không có bản đầy đủ → null");
  ok(D.deckFromText(`<artifact identifier="Q3 Deck" type="text/html" title="T">${DECK}</artifact>`, "Q3 Deck")?.content === DECK, "identifier chuẩn hóa như khi tách artifact");
  // W23-11: Hộp thư có nút "Tải PowerPoint" gọi đúng route xuất ở máy chủ với { run, identifier }.
  const inbox = fs.readFileSync(path.join(process.cwd(), "app/tasksui.tsx"), "utf8");
  ok(/apiFetch\("\/api\/artifacts\/pptx"/.test(inbox) && /JSON\.stringify\(\{ run, identifier: ident \}\)/.test(inbox) && /tr\("Tải PowerPoint"\)/.test(inbox), "W23-11: Hộp thư gọi /api/artifacts/pptx với { run, identifier }");
  ok(/isDeck\(sg\.art\)/.test(inbox) && /!sg\.art\.patch/.test(inbox), "W23-11: nút chỉ hiện cho bản trình bày slide HTML trong kết quả");
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/artifacts/pptx/route.ts"), "utf8");
  ok(!/body\.content|body\.type/.test(route), "route không còn nhận HTML thô từ trình duyệt");
  ok(/featureGate\(req, "sandbox"\)/.test(route) && /caps\.code/.test(route), "route cần quyền sandbox + Chạy code của người dùng");
  ok(/getArtifactByIdent\(user\.id/.test(route) && /getRun\(body\.run, user\.id\)/.test(route), "nội dung nạp ở máy chủ, của đúng người dùng");
  ok(/net: caps\.net, web: caps\.web/.test(route), "mạng đi theo quyền net / web của người dùng");
  const src = fs.readFileSync(path.join(process.cwd(), "server/deckexport.ts"), "utf8");
  ok(/caps: \{ net: boolean; web: boolean \} = \{ net: false, web: false \}/.test(src) && !/net: true/.test(src), "exportDeckPptx mặc định tắt mạng, không còn net: true cứng");
  ok(/inflight\.has\(uid\)/.test(src), "mỗi người một lần xuất đang chạy");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
