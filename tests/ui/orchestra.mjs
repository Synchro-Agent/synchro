// Orchestra trên bản chạy giả lập (npm run dev:mock, Chrome ẩn): việc có nhiều nhánh ở chế độ Tự động hiện thẻ sơ đồ tổ
// chức sống trong lượt (vai, model, trạng thái, token), xong thì gọn thành một dòng bấm để xem lại; tải lại trang vẫn còn;
// câu đơn giản không có thẻ; giao diện tiếng Anh dịch đủ; lần chạy Autopilot hiện cùng thẻ trong Hộp thư. Máy tính (sáng)
// và 375px (tối), không cuộn ngang. CLI / API giả lập trả kế hoạch, phần việc và kết quả duyệt (mock-cli-common.cjs
// mockOrchestra).
// Chạy tay: BASE=http://localhost:3200 SHOTS=/tmp/orc node tests/ui/orchestra.mjs
import { createRequire } from "node:module";
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const { cookie, uid } = await login(B);
// Lượt bằng khóa API tính vào hạn mức chi phí của tài khoản quản trị thử: bắt đầu từ mức dùng 0 như các bộ khác.
if (!process.env.BASE) {
  const db = new (createRequire(process.cwd() + "/package.json")("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db");
  db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(uid); db.close();
}
const api = (method, p, body) => fetch(B + p, {
  method, headers: { "content-type": "application/json", origin: B, cookie }, body: body && JSON.stringify(body),
}).then((r) => r.json().catch(() => null));

const R = Date.now() % 100000;
const ASK = (k) => `Tìm hiểu thị trường xe điện ở Việt Nam năm 2025 (doanh số, các hãng chính, chính sách ưu đãi) rồi viết`
  + ` báo cáo 2 trang có bảng so sánh và khuyến nghị cho nhà đầu tư. #slow mã ${R}${k}`;
const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9371), name: "orchestra", shots: process.env.SHOTS });
const { P, ev, until } = t;
const lastAi = `[...document.querySelectorAll(".ai-msg")].at(-1)`;
const card = `${lastAi}?.querySelector(".orc")`;
const send = async (text) => {
  await ev(`document.querySelector(".composer textarea").focus()`);
  await t.type(text);
  await t.key("Enter", "Enter", 13);
};
const open = async (theme, lang = "vi") => {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector(".composer textarea")`, 60000);
  await ev(`localStorage.setItem("u:${uid}:model", "auto"); localStorage.setItem("theme", "${theme}");
    localStorage.setItem("p:uilang", ${JSON.stringify(JSON.stringify(lang))})`);
  await P("Page.reload", {});
  await until(`!!document.querySelector(".composer textarea")`, 60000);
  await P("Page.bringToFront");
  await sleep(800);
};
const fits = (w) => ev(`(() => { const c = ${card}; if (!c) return null; const r = c.getBoundingClientRect();
  return { l: r.left, r: r.right, page: document.documentElement.scrollWidth, w: ${w} }; })()`);
try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  for (const [w, h, theme, label] of [[1280, 860, "light", "máy tính, sáng"], [375, 760, "dark", "375px, tối"]]) {
    console.log(`━━ ${label}`);
    await t.size(w, h, w < 500);
    await open(theme);
    await send(ASK(w));
    ok(await until(`!!${card}`, 90000), "việc nhiều nhánh: thẻ Orchestra hiện trong lượt đang chạy");
    const live = await ev(`(() => { const c = ${card}; return c && { live: c.classList.contains("live"),
      open: c.classList.contains("open"), members: c.querySelectorAll(".orc-m").length,
      boss: !!c.querySelector(".orc-m.boss"), tasks: c.querySelectorAll(".orc-t").length,
      head: c.querySelector(".orc-h")?.innerText }; })()`);
    ok(live?.open && live.members >= 2 && live.boss && live.tasks === 3,
      "đang chạy: mở sẵn, có trưởng nhóm, các thành viên và 3 nhánh việc", live);
    await t.shot(`orchestra-live-${w}`);
    ok(await until(`!!${card} && !${card}.classList.contains("live") && !${lastAi}.classList.contains("ai-streaming")`, 120000),
      "lượt xong: thẻ thôi chạy");
    const done = await ev(`(() => { const c = ${card}; return { open: c.classList.contains("open"),
      head: c.querySelector(".orc-h").innerText, text: ${lastAi}.innerText.length }; })()`);
    ok(!done.open && /Orchestra/.test(done.head) && /Nhóm đã xong/.test(done.head) && /3\/3 việc/.test(done.head),
      "xong: gọn thành một dòng (Orchestra · Nhóm đã xong · 3/3 việc)", done);
    ok(done.text > 40, "câu trả lời cuối là tin nhắn thường bên dưới thẻ", done);
    await ev(`${card}.querySelector(".orc-h").click()`);
    ok(await until(`${card}.querySelectorAll(".orc-t.done").length === 3`, 3000), "bấm: mở lại nhật ký, ba nhánh đã xong");
    const roles = await ev(`[...${card}.querySelectorAll(".orc-m small")].map((x) => x.textContent)`);
    ok(roles.includes("Trưởng nhóm") && roles.includes("Thực tập"), "sơ đồ có vai trưởng nhóm và thực tập", roles);
    const box = await fits(w);
    ok(box && box.l >= 0 && box.r <= w + 0.5 && box.page <= w, "thẻ nằm trọn chiều ngang, trang không cuộn ngang", box);
    await t.shot(`orchestra-done-${w}`);
    await P("Page.reload", {});
    ok(await until(`!!${card}`, 30000), "tải lại trang: thẻ vẫn còn cùng câu trả lời");

    await send(`2+2 bằng mấy? ${R}${w}`);
    await until(`${lastAi}?.innerText.includes("${R}${w}") || false`, 5000);
    ok(await until(`[...document.querySelectorAll(".ai-msg")].length >= 2 && !${lastAi}.classList.contains("ai-streaming")
      && ${lastAi}.innerText.length > 5`, 60000), "câu đơn giản có câu trả lời");
    ok(await ev(`!${card}`), "câu đơn giản: chạy một model, không có thẻ Orchestra");
  }

  console.log("━━ tiếng Anh");
  await t.size(1280, 860);
  await open("light", "en");
  await send(ASK("en"));
  ok(await until(`!!${card} && !${card}.classList.contains("live") && !${lastAi}.classList.contains("ai-streaming")`, 150000),
    "lượt xong");
  await ev(`${card}.querySelector(".orc-h").click()`);
  await sleep(300);
  const en = await ev(`${card}.innerText`);
  ok(/The team is done/.test(en) && /Lead/.test(en) && /Intern/.test(en) && /Assignments/.test(en) && /3\/3 tasks/.test(en),
    "giao diện tiếng Anh: nhãn đã dịch", en);
  ok(!/Trưởng nhóm|Thực tập|Nhóm đã xong|Phân công/.test(en), "không sót chữ tiếng Việt trong thẻ", en);
  await t.shot("orchestra-en");

  console.log("━━ Autopilot");
  await open("light");
  const title = `Orchestra Autopilot ${R}`;
  const tz = "Asia/Ho_Chi_Minh";
  const made = await api("POST", "/api/tasks", { title, prompt: ASK("ap"), schedule: { kind: "daily", time: "07:00", tz } });
  ok(!!made?.task?.id, "tạo việc Autopilot", made);
  const ran = await api("POST", `/api/tasks/${made.task.id}/run`, {});
  ok(!!ran?.run, "chạy ngay", ran);
  await P("Page.navigate", { url: B + "/#inbox" });
  await until(`!!document.querySelector(".pl-seg")`, 30000);
  await ev(`[...document.querySelectorAll(".pl-seg button")].find((b) => /Kết quả/.test(b.textContent))?.click()`);
  const row = `[...document.querySelectorAll(".tk-item")].find((e) => e.textContent.includes(${JSON.stringify(title)}))`;
  ok(await until(`!!${row}`, 30000), "lần chạy có trong Kết quả");
  await ev(`${row}.querySelector(".tk-row").click()`);
  ok(await until(`!!${row}?.querySelector(".tk-body .orc")`, 120000), "đang chạy hoặc xong: thẻ Orchestra trong kết quả");
  ok(await until(`!${row}.querySelector(".orc.live") && /Nhóm đã xong/.test(${row}.querySelector(".orc-h").innerText)`, 150000),
    "Autopilot xong: thẻ ghi Nhóm đã xong");
  await t.shot("orchestra-autopilot");
  await api("DELETE", `/api/tasks/${made.task.id}`);
  ok(!t.logs.length, "không có lỗi JavaScript trên trang", t.logs);
} finally {
  t.close();
}
console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
