// Trên giao diện, bằng Chrome ẩn trên npm run dev:mock:
// 1. Brief mở bằng câu đóng vai ("Bạn là nhà thiết kế sản phẩm…"): tên đoạn chat ở thanh bên đặt theo sản phẩm,
//    không phải mấy chữ đầu ("Bạn là nhà thiết kế sản"), cả tên tạm lúc vừa gửi lẫn tên sau câu trả lời đầu.
// 2. Tệp quá giới hạn ở ô soạn: hộp "Gửi phần còn lại" dùng nút chính thường (btn dark), không phải màu đỏ của hành
//    động nguy hiểm.
// 3. Bộ slide đang dựng: đầu khung xem và thẻ artifact không lúc nào ghi "Trang web", xong thì ghi "Bản trình bày".
// Máy tính 1280 và điện thoại 375. Ảnh: SHOTS (mặc định <tmp>/synchro-ui/chat-titles).
// Chạy: node tests/ui/chat-titles.mjs.
import { mkdirSync, openSync, ftruncateSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openChrome, sleep, waitFor } from "../lib/cdp.mjs";
import { tempUser } from "../lib/tempuser.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "synchro-ui", "chat-titles");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
  return c;
};
const BRIEF = "Bạn là nhà thiết kế sản phẩm (UI/UX) cấp cao. Hãy thiết kế và dựng màn hình dashboard web "
  + "(1440x900, một tệp "
  + "HTML chạy được) cho chủ chuỗi 5 cửa hàng cà phê. Trả lời ngắn gọn.";
// Tên đoạn chat đang mở: tiêu đề ẩn của khung chat (cả điện thoại, khi thanh bên là ngăn kéo) và mục đang chọn ở
// thanh bên.
const NAME = `document.querySelector("h1.sr-only[data-notr]")?.textContent?.trim() ?? null`;
const SIDE = `document.querySelector(".chat-item[aria-current=page]")?.textContent?.trim() ?? null`;

const u = await tempUser(B, "chat-titles", { name: "Chat Titles", fullPerms: true, verified: true });
let t = null;
try {
  t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9378), name: "chat-titles", shots: SHOTS });
  await t.P("Network.setCookie", { name: "synchro_session", value: u.cookie.split("=")[1], url: B });
  for (const [w, h, label] of [[1280, 860, "máy tính"], [375, 812, "điện thoại"]]) {
    await t.size(w, h, w < 600);
    console.log(`━━ ${label}: tên đoạn chat theo sản phẩm`);
    await t.P("Page.navigate", { url: `${B}/?ct=${w}` });
    ok(await t.until(`!!document.querySelector("textarea")`, 180_000), `${label}: trang chủ mở được`);
    const tb = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await t.click(tb[0], tb[1]);
    // Bản nháp còn lại từ lần trước (hộp "Gửi phần còn lại" đã hủy) bị thay, không nối vào đầu brief.
    await t.ev(`document.querySelector("textarea").select()`);
    await t.type(BRIEF);
    await t.key("Enter", "Enter", 13);
    ok(await t.until(`location.hash.startsWith("#c=")`, 60_000), `${label}: gửi brief, đoạn chat mở`);
    const name = NAME;
    const rough = await waitFor(() => t.ev(name), 15_000);
    ok(!!rough && !/^Bạn là/.test(rough), `${label}: tên tạm không mở đầu bằng câu đóng vai`, rough);
    await t.until(`!document.querySelector(".stop-btn, [aria-label='Dừng']")`, 180_000);
    const renamed = async () => {
      const n = await t.ev(name);
      return n && n !== rough ? n : null;
    };
    const final = await waitFor(renamed, 20_000) ?? await t.ev(name);
    ok(!!final && !/^Bạn là/.test(final) && final.length <= 60, `${label}: tên sau câu trả lời đầu theo chủ đề`, final);
    if (w >= 600) {
      const side = await t.ev(SIDE);
      ok(!!side && !/^Bạn là/.test(side), `${label}: thanh bên không còn "Bạn là nhà thiết kế sản"`, side);
    }
    ok(await t.ev(`document.documentElement.scrollWidth <= innerWidth + 1`), `${label}: không cuộn ngang`);
    await t.shot(`title-${w}`);
    console.log(`  tên tạm: ${rough} · tên cuối: ${final}`);

    console.log(`━━ ${label}: hộp "Gửi phần còn lại" dùng nút chính thường`);
    await t.P("Page.navigate", { url: `${B}/?ctf=${w}` });
    await t.until(`!!document.querySelector("input[type=file][multiple]")`, 60_000);
    const dir = path.join(tmpdir(), "synchro-ui"); mkdirSync(dir, { recursive: true });
    const big = path.join(dir, "qua-lon-31mb.bin");
    const fd = openSync(big, "w"); ftruncateSync(fd, 31 * 1024 * 1024); closeSync(fd);
    const inp = await t.P("Runtime.evaluate", { expression: `document.querySelector("input[type=file][multiple]")` });
    await t.P("DOM.setFileInputFiles", { files: [big], objectId: inp.result.objectId });
    ok(await t.until(`!!document.querySelector(".ft.ft-err")`, 15_000), `${label}: thẻ tệp báo lỗi (quá 30 MB)`);
    const tb2 = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await t.click(tb2[0], tb2[1]);
    await t.type("Tóm tắt giúp mình");
    await t.key("Enter", "Enter", 13);
    const dlg = await waitFor(() => t.ev(`(() => { const d = document.querySelector(".cf-top"); if (!d) return null;
      const b = [...d.querySelectorAll(".modal-foot .btn")].pop();
      const bg = b ? getComputedStyle(b).backgroundColor : "";
      return { text: b?.textContent ?? "", cls: b?.className ?? "", bg }; })()`), 8000);
    const plain = !!dlg && /\bdark\b/.test(dlg.cls) && !/\bdanger\b/.test(dlg.cls);
    ok(plain && /Gửi phần còn lại|Send the rest/.test(dlg.text),
      `${label}: nút "Gửi phần còn lại" là nút chính thường, không đỏ`, dlg);
    await t.shot(`send-rest-${w}`);
    await t.ev(`[...document.querySelectorAll(".cf-top .modal-foot .btn")][0]?.click()`);
  }
  console.log("━━ máy tính: khung artifact ghi đúng loại khi bộ slide đang dựng");
  await t.size(1280, 860, false);
  await t.P("Page.navigate", { url: `${B}/?ctd=1` });
  await t.until(`!!document.querySelector("textarea")`, 120_000);
  await t.ev(`[...document.querySelectorAll(".hero-chip")]
    .find((e) => e.textContent.includes("Trang trình bày"))?.click()`);
  await sleep(400);
  await t.ev(`document.querySelector("textarea").focus()`);
  await t.type("Làm bộ slide giới thiệu quán cà phê");
  await t.key("Enter", "Enter", 13);
  // Lấy mẫu nhãn ở đầu khung xem và trên thẻ artifact suốt lúc viết, tới khi xong lượt.
  const LABELS = `[...document.querySelectorAll(".art-head-t span, .art-card-txt > span")].map((e) => e.textContent)`;
  const seen = new Set();
  const until = Date.now() + 120_000;
  let building = 0;
  while (Date.now() < until) {
    const s = await t.ev(`({ labels: ${LABELS}, busy: !!document.querySelector(".wl-status"),
      open: !!document.querySelector(".art-panel") })`);
    for (const l of s.labels) seen.add(l);
    if (s.busy && s.open) building++;
    if (!s.busy && s.open && s.labels.some((l) => /Bản trình bày/.test(l))) break;
    await sleep(150);
  }
  const all = [...seen];
  ok(building > 0, "khung xem mở trong lúc bộ slide đang viết (điều kiện của phép thử)", all);
  ok(!all.some((l) => /Trang web/.test(l)), "không lúc nào ghi \"Trang web\" cho bộ slide", all);
  ok(all.some((l) => /Bản trình bày/.test(l)), "đầu khung ghi \"Bản trình bày\"", all);
  await t.shot("deck-label");
  ok(!t.logs.length, "không có lỗi JavaScript", t.logs.slice(0, 3));
} catch (e) {
  ok(false, "chạy hết bộ kiểm", e.stack ?? String(e));
} finally {
  t?.close();
  await u.remove();
}
console.log(`\nẢnh: ${SHOTS}\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
