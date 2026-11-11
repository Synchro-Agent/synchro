// Sửa tham số trước khi cho phép, trên thẻ duyệt trong khung chat (Chrome ẩn, npm run dev:mock, Claude Code giả lập):
// nút Sửa mở ô JSON, lỗi cú pháp / sai schema hiện ngay và khóa nút cho phép, sửa đúng thì "Cho phép với tham số đã sửa", thẻ ghi "đã sửa tham số",
// công cụ chạy với tham số mới. Máy tính (sáng) và 375px (tối), không cuộn ngang. Cần connector Mock Notes đã kết nối (tests/api/approve-edit.test.mjs tự thêm).
// Chạy tay: BASE=http://localhost:3500 SHOTS=/tmp/x node tests/ui/approve-edit.mjs
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const { cookie, uid } = await login(B);
const api = (method, p, body) => fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body && JSON.stringify(body) }).then((r) => r.json().catch(() => null));
const notesId = (await api("GET", "/api/connectors")).connectors?.find((x) => x.name === "Mock Notes" && x.status === "ok")?.id;
if (!notesId) { console.log("Thiếu connector Mock Notes: chạy tests/api/approve-edit.test.mjs trước."); process.exit(1); }
await api("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "ask" } });

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9363), name: "approve-edit", shots: process.env.SHOTS });
const { P, ev, until } = t;
const R = Date.now() % 100000;
const setText = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const btn = (label) => `[...document.querySelectorAll(".ag-ask .btn")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  for (const [w, h, theme, label] of [[1280, 860, "light", "máy tính, sáng"], [375, 760, "dark", "375px, tối"]]) {
    console.log(`━━ ${label}`);
    await t.size(w, h, w < 500);
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector(".composer textarea")`, 60000);
    await sleep(1500);
    await ev(`localStorage.setItem("u:${uid}:model", "sub-claude/sonnet"); localStorage.setItem("theme", "${theme}")`);
    await P("Page.reload", {});
    await until(`!!document.querySelector(".composer textarea")`, 60000);
    await P("Page.bringToFront");
    await sleep(800);
    await ev(`document.querySelector(".composer textarea").focus()`);
    await t.type(`#tool=mock_notes__create_note #args={"title":"UI gốc ${R}${w}"}`);
    await t.key("Enter", "Enter", 13);
    ok(await until(`!!document.querySelector(".ag-ask")`, 60000), "thẻ duyệt hiện trong khung chat");
    ok(await until(`!!${btn("Sửa")}`, 3000), "có nút Sửa (công cụ connector, tham số đầy đủ)");
    await ev(`${btn("Sửa")}.click()`);
    ok(await until(`!!document.querySelector(".ag-ask .args-ed textarea")`, 3000), "bấm Sửa: ô JSON hiện với tham số hiện tại");
    ok(await ev(`JSON.parse(document.querySelector(".ag-ask .args-ed textarea").value).title === "UI gốc ${R}${w}"`), "ô chứa đúng tham số model đề xuất");
    await setText(".ag-ask .args-ed textarea", `{ "title": `);
    ok(await until(`!!document.querySelector(".ag-ask .args-err")`, 2000) && await ev(`document.querySelector(".ag-ask .ag-ask-a .btn.dark").disabled === true`), "JSON hỏng: báo lỗi cú pháp, nút cho phép bị khóa");
    await setText(".ag-ask .args-ed textarea", `{ "body": "không có tiêu đề", "title": 5 }`);
    ok(await until(`/title: phải là chuỗi/.test(document.querySelector(".ag-ask .args-err")?.textContent || "")`, 2000), "sai schema (title là số): lỗi theo đường dẫn, kiểm tra ngay khi gõ", await ev(`document.querySelector(".ag-ask .args-err")?.textContent`));
    await t.shot(`approve-edit-error-${w}`);
    await setText(".ag-ask .args-ed textarea", JSON.stringify({ title: `UI đã sửa ${R}${w}`, body: "từ thẻ duyệt" }, null, 2));
    ok(await until(`!document.querySelector(".ag-ask .args-err") && !!${btn("Cho phép với tham số đã sửa")}`, 2000), "sửa đúng: hết lỗi, nút đổi thành “Cho phép với tham số đã sửa”");
    const box = await ev(`(() => { const r = document.querySelector(".ag-ask").getBoundingClientRect(); const e = document.querySelector(".ag-ask .args-ed textarea").getBoundingClientRect(); return { l: r.left, r: r.right, er: e.right }; })()`);
    ok(box.l >= 0 && box.r <= w && box.er <= w, "thẻ và ô sửa nằm trọn chiều ngang", box);
    ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), "không cuộn ngang trang");
    await t.shot(`approve-edit-valid-${w}`);
    await ev(`${btn("Cho phép với tham số đã sửa")}.click()`);
    ok(await until(`/đã sửa tham số/.test(document.querySelector(".ag-asked")?.textContent || "")`, 30000), "thẻ chuyển sang “Đã cho phép … · đã sửa tham số”", await ev(`document.querySelector(".ag-asked")?.textContent`));
    ok(await until(`document.querySelector(".ai-msg:last-of-type, .ai-msg")?.closest("main")?.innerText.includes("UI đã sửa ${R}${w}")`, 40000), "câu trả lời có kết quả công cụ chạy với tham số đã sửa");
    await t.shot(`approve-edit-done-${w}`);
  }
  // Lượt bằng khóa API (OpenAI giả lập): thẻ duyệt ApprovalCard, cùng ô sửa.
  const apBtn = (label) => `[...document.querySelectorAll(".ap-card .btn")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
  for (const [w, h, theme, label] of [[1280, 860, "light", "khóa API · máy tính, sáng"], [375, 760, "dark", "khóa API · 375px, tối"]]) {
    console.log(`━━ ${label}`);
    await t.size(w, h, w < 500);
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector(".composer textarea")`, 60000);
    await sleep(1500);
    await ev(`localStorage.setItem("u:${uid}:model", "openai/gpt-6.1-sol"); localStorage.setItem("theme", "${theme}")`);
    await P("Page.reload", {});
    await until(`!!document.querySelector(".composer textarea")`, 60000);
    await sleep(800);
    await ev(`document.querySelector(".composer textarea").focus()`);
    await t.type(`#tool=create_note #args={"title":"API UI gốc ${R}${w}"}`);
    await t.key("Enter", "Enter", 13);
    ok(await until(`!!${apBtn("Sửa")}`, 60000), "thẻ duyệt (khóa API) có nút Sửa");
    await ev(`${apBtn("Sửa")}.click()`);
    ok(await until(`!!document.querySelector(".ap-card .args-ed textarea")`, 3000), "ô JSON hiện");
    await setText(".ap-card .args-ed textarea", `{"title": ""}`);
    ok(await until(`/title: cần ít nhất|title/.test(document.querySelector(".ap-card .args-err")?.textContent || "") || !!document.querySelector(".ap-card .args-ok")`, 2000), "kiểm tra theo schema khi gõ");
    await setText(".ap-card .args-ed textarea", JSON.stringify({ title: `API UI đã sửa ${R}${w}` }, null, 2));
    ok(await until(`!!${apBtn("Cho phép với tham số đã sửa")} && !${apBtn("Cho phép với tham số đã sửa")}.disabled`, 2000), "nút “Cho phép với tham số đã sửa”");
    const box = await ev(`(() => { const r = document.querySelector(".ap-card").getBoundingClientRect(); return { l: r.left, r: r.right }; })()`);
    ok(box.l >= 0 && box.r <= w && await ev(`document.documentElement.scrollWidth <= innerWidth`), "thẻ nằm trọn, không cuộn ngang", box);
    await t.shot(`approve-edit-api-${w}`);
    await ev(`${apBtn("Cho phép với tham số đã sửa")}.click()`);
    ok(await until(`document.querySelector("main")?.innerText.includes("API UI đã sửa ${R}${w}")`, 40000), "công cụ chạy với tham số đã sửa");
  }
  ok(!t.logs.length, "không có lỗi JavaScript", t.logs);
} finally {
  t.close();
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
