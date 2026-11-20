// Tệp đính kèm cần xử lý riêng, đi đúng đường người dùng trên npm run dev:mock (Chrome ẩn):
// - Hai tệp cùng tên khác nội dung trong một tin: hai thẻ riêng ("ghichu.txt", "ghichu (2).txt"), cả hai tải lên xong,
//   và yêu cầu gửi lên /api/llm chứa nội dung của CẢ HAI dưới hai tên khác nhau.
// - Ảnh HEIC (iPhone): máy có bộ giải (heif-dec / heif-convert, hay sips trên macOS) thì thẻ sẵn sàng và model nhận
//   ảnh PNG; máy không có thì thẻ báo lỗi kèm lý do "chưa cài bộ giải mã" (không treo, không lỗi chung chung).
// - Cài đặt → Sức khỏe hệ thống → Đọc tệp đặc biệt: đủ ba dòng, không tràn ở 1280px và 375px.
// - Synchro Code: thả cùng lúc một tệp lẻ và một thư mục (tệp đứng trước) thì còn đủ cả hai thẻ. Thư mục được nén
//   (await) nên thẻ thư mục được xếp cập nhật ngay trước thẻ tệp lẻ, khi React chưa vẽ lại.
// Chạy tay: node tests/ui/attach-media.mjs   (BASE=… đổi máy, SHOTS=<thư mục> chụp ảnh, CDP_PORT đổi cổng Chrome)
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0;
let fail = 0;
const ok = (c, n, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};

const tag = Date.now().toString(36);
const dir = path.join(tmpdir(), "synchro-ui", `attach-media-${tag}`);
for (const d of ["a", "b"]) mkdirSync(path.join(dir, d), { recursive: true });
const fileA = path.join(dir, "a", "ghichu.txt");
const fileB = path.join(dir, "b", "ghichu.txt");
writeFileSync(fileA, `Tệp thứ nhất. DAUHIEU_A_${tag}\n`);
writeFileSync(fileB, `Tệp thứ hai, nội dung khác. DAUHIEU_B_${tag}\n`);
const heic = path.join(dir, `IMG_${tag}.HEIC`);
copyFileSync(path.join(process.cwd(), "tests", "fixtures", "media", "tiny.heic"), heic);

const { cookie } = await login(B);
const port = Number(process.env.CDP_PORT ?? 9391);
const t = await openChrome({ base: B, port, name: "attach-media", shots: process.env.SHOTS });
const { P, ev, until, size, shot } = t;
const click = async (expr, what) => {
  const js = `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" });`
    + " const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()";
  const r = await ev(js);
  if (!r) throw new Error("không thấy: " + what);
  await t.click(r[0], r[1]);
};
const attach = async (list) => {
  const inp = await P("Runtime.evaluate", { expression: `document.querySelector("input[type=file][multiple]")` });
  if (!inp.result.objectId) throw new Error("không thấy ô chọn tệp của ô soạn");
  await P("DOM.setFileInputFiles", { files: list, objectId: inp.result.objectId });
};
const CHIPS = `[...document.querySelectorAll(".composer .attach .ft")].map((e) => ({
  name: e.querySelector(".ft-name")?.textContent.trim(), err: e.querySelector(".ft-err-msg")?.textContent.trim() ?? "",
  busy: !!e.querySelector(".ft-prog") }))`;
const clearChips = async () => {
  for (let i = 0; i < 10 && (await ev(`!!document.querySelector(".composer .attach .ft-x")`)); i++) {
    await click(`document.querySelector(".composer .attach .ft-x")`, "nút bỏ tệp");
    await sleep(200);
  }
};
// Thân các yêu cầu POST /api/llm gửi lượt của trang (ghi lại trước khi gửi đi, không đổi gì). Bỏ yêu cầu ước tính
// ngữ cảnh (estimate): nó cũng đi /api/llm khi soạn tin nhưng thay nội dung tệp bằng "…", không phải lượt thật.
const HOOK = `(() => { const f = window.fetch; window.__llmBodies = []; window.fetch = (u, o) => {
  if (String(u).startsWith("/api/llm") && typeof o?.body === "string" && !o.body.includes('"estimate":true')) {
    window.__llmBodies.push(o.body);
  }
  return f(u, o); }; })()`;
const send = async (text) => {
  await click(`document.querySelector(".composer textarea")`, "ô soạn tin");
  await t.type(text);
  await t.key("Enter", "Enter", 13);
};
const lastBody = () => ev(`window.__llmBodies[window.__llmBodies.length - 1] ?? ""`);

try {
  await size(1440, 900);
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await P("Page.navigate", { url: B + "/" });
  if (!(await until(`!!document.querySelector(".composer textarea")`, 60000))) throw new Error("app không mở");
  await sleep(1200);

  console.log("1. Hai tệp cùng tên, khác nội dung, trong một tin");
  await clearChips();
  await attach([fileA, fileB]);
  const both = `(() => { const c = ${CHIPS}; return c.length === 2 && c.every((x) => !x.busy && !x.err); })()`;
  ok(await until(both, 30000), "hai thẻ tải lên xong, không lỗi", await ev(CHIPS));
  const names = (await ev(CHIPS)).map((c) => c.name);
  ok(names.join("|") === "ghichu.txt|ghichu (2).txt", "tên thẻ: ghichu.txt và ghichu (2).txt", names);
  await shot("1-hai-the");
  await send("Hai tệp này khác nhau thế nào?");
  ok(await until(`window.__llmBodies.length > 0`, 30000), "đã gửi lượt lên /api/llm");
  const body = await lastBody();
  ok(body.includes(`DAUHIEU_A_${tag}`) && body.includes(`DAUHIEU_B_${tag}`), "model nhận nội dung của cả hai tệp",
    body.slice(0, 300));
  ok(body.includes(`<file name=\\"ghichu.txt\\"`) && body.includes(`<file name=\\"ghichu (2).txt\\"`),
    "hai khối <file> mang hai tên khác nhau", body.match(/<file name=[^>]{0,60}/g));
  await until(`!document.querySelector(".ai-msg.ai-streaming")`, 60000);

  console.log("2. Ảnh HEIC");
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Mới"))`, "Mới");
  await sleep(800);
  await clearChips();
  await attach([heic]);
  const settled = `(() => { const c = ${CHIPS}; return c.length === 1 && !c[0].busy; })()`;
  ok(await until(settled, 60000), "thẻ HEIC tải xong (không treo)", await ev(CHIPS));
  const chip = (await ev(CHIPS))[0] ?? {};
  await shot("2-heic");
  if (chip.err) {
    ok(/chưa cài bộ giải mã/.test(chip.err), "máy này không có bộ giải HEIC: thẻ báo đúng lý do", chip.err);
    console.log("  - máy mock không có bộ giải HEIC, chỉ kiểm được lời báo lỗi");
  } else {
    const before = await ev(`window.__llmBodies.length`);
    await send("Ảnh này màu gì?");
    ok(await until(`window.__llmBodies.length > ${before}`, 30000), "đã gửi lượt kèm ảnh HEIC");
    const b2 = await lastBody();
    ok(/"media_type":\s*"image\/png"/.test(b2) && b2.includes(`IMG_${tag}.HEIC`), "model nhận ảnh PNG giải từ HEIC",
      b2.slice(0, 300));
    await until(`!document.querySelector(".ai-msg.ai-streaming")`, 60000);
  }

  console.log("3. Cài đặt → Sức khỏe hệ thống → Đọc tệp đặc biệt");
  for (const [w, h, mobile] of [[1280, 860, false], [375, 812, true]]) {
    await P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector(".composer textarea")`, 60000);
    await sleep(900);
    if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) {
      // Ở 375px thanh bên là ngăn kéo, có bản không có nút này; bước sau tự báo lỗi nếu không mở được menu tài khoản.
      await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "thanh bên").catch(() => {});
      await sleep(600);
    }
    await click(`document.querySelector(".rail .user")`, "tài khoản");
    await sleep(500);
    await click(`[...document.querySelectorAll(".menu-item")].find((e) => e.textContent.trim().startsWith("Cài đặt"))`,
      "Cài đặt");
    await sleep(900);
    const tab = `[...document.querySelectorAll(".modal.settings .s-item")].find((e) => ["Health", "Sức khỏe hệ thống"]`
      + ".some((x) => e.getAttribute('title') === x || e.textContent.trim() === x))";
    await click(tab, "Sức khỏe hệ thống");
    const HEAD = `[...document.querySelectorAll(".modal.settings h3.sec")]`
      + `.find((e) => e.textContent.trim() === "Đọc tệp đặc biệt")`;
    ok(await until(`!!${HEAD}`, 30000), `${w}px: có mục "Đọc tệp đặc biệt"`);
    await ev(`${HEAD}.scrollIntoView({ block: "start" })`);
    await sleep(500);
    const rows = await ev(`(() => { const h = ${HEAD}; const out = []; let el = h?.nextElementSibling;
      while (el && !el.matches("h3")) {
        if (el.matches(".row")) {
          const badge = el.querySelector(".s-badge");
          out.push({ t: el.querySelector(".t")?.textContent.trim(), badge: badge?.textContent.trim(),
            r: Math.max(el.getBoundingClientRect().right, badge?.getBoundingClientRect().right ?? 0) });
        }
        el = el.nextElementSibling;
      }
      return { rows: out, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; })()`);
    const full = rows.rows.length === 3 && rows.rows.every((r) => r.t && r.badge);
    ok(full, `${w}px: ba dòng HEIC / Office cũ / OCR có trạng thái`, rows.rows);
    const fits = rows.sw <= rows.vw + 1 && rows.rows.every((r) => r.r <= rows.vw + 1);
    ok(fits, `${w}px: không tràn, không cuộn ngang`, rows);
    console.log("   ", rows.rows.map((r) => `${r.t}: ${r.badge}`).join(" · "));
    await shot(`3-suc-khoe-${w}`);
  }

  console.log("4. Synchro Code: thả cùng lúc tệp lẻ và thư mục");
  await size(1440, 900);
  await P("Page.navigate", { url: B + "/" });
  const codeNav = `[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`;
  await until(`!!${codeNav}`, 60000);
  await click(codeNav, "Code");
  ok(await until(`!!document.querySelector(".cv-dock textarea")`, 30000), "mở được Synchro Code");
  // Trình duyệt không cho dựng DataTransfer có thư mục bằng script: thả một sự kiện drop mang các mục giả theo đúng
  // giao diện FileSystemEntry mà ui/codeview.tsx đọc (webkitGetAsEntry, file, createReader / readEntries).
  await ev(`(() => {
    const file = (name, text) => ({ isFile: true, isDirectory: false, name,
      file: (ok) => ok(new File([text], name, { type: "text/plain", lastModified: 5 })) });
    const dir = (name, kids) => ({ isFile: false, isDirectory: true, name, createReader: () => {
      let left = kids;
      return { readEntries: (ok) => { ok(left); left = []; } };
    } });
    const entries = [file("README-${tag}.md", "# đọc tôi"), dir("src-${tag}", [file("main.js", "console.log(1)")])];
    const dt = { items: entries.map((en) => ({ webkitGetAsEntry: () => en })), files: [], types: ["Files"] };
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    document.querySelector(".cv").dispatchEvent(drop);
  })()`);
  const CV_CHIPS = `[...document.querySelectorAll(".cv-attach .ft-name")].map((e) => e.textContent.trim())`;
  const two = `(() => { const c = ${CV_CHIPS}; return c.includes("src-${tag}") && c.includes("README-${tag}.md"); })()`;
  ok(await until(two, 20000), "còn đủ thẻ thư mục và thẻ tệp lẻ", await ev(CV_CHIPS));
  await sleep(800);
  ok((await ev(CV_CHIPS)).length === 2, "đúng hai thẻ, không thêm, không mất sau khi vẽ lại", await ev(CV_CHIPS));
  await shot("4-code-tha-thu-muc");
} catch (e) {
  ok(false, "chạy được tới cuối", e.message.split("\n")[0]);
  // Lỗi chính đã ghi ở dòng trên; ảnh chụp lúc lỗi chỉ để xem thêm, chụp hỏng (trang đã đóng) không đổi kết quả.
  await shot("loi").catch(() => {});
} finally {
  t.close();
}
ok(!t.logs.length, "không có lỗi JavaScript", t.logs.slice(0, 3));
console.log(`\n${fail ? "✗" : "✓"} ${pass}/${pass + fail} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
