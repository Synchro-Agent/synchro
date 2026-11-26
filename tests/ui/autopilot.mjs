// Autopilot trên npm run dev:mock (Chrome ẩn; BASE=… đổi máy, SHOTS=<thư mục> chụp ảnh), máy tính 1440 px và điện thoại
// 375 px, sáng và tối:
// - Địa chỉ cũ #v=inbox mở trang Autopilot và đổi sang #v=autopilot; tiêu đề "Autopilot" và dòng giới thiệu.
// - Form "Tự đặt": loại lịch cron hiện ô biểu thức và lời giải thích, ô múi giờ mặc định Asia/Ho_Chi_Minh, nút "Gửi
//   email khi xong"; form nằm trọn trong màn hình, không cuộn ngang. Cron chạy mỗi phút bị từ chối kèm lý do.
// - Lưu cron hợp lệ: thẻ việc hiện lịch "Cron …" và lần tới; Tạm dừng / Chạy tiếp đổi trạng thái trên thẻ.
// - Sửa việc, chọn "Một lần, vào lúc đã hẹn": hiện ô ngày và giờ.
// Không chạy model nào (việc tạo tay, lần tới ở tương lai); việc của bài này bị xóa khi xong.
import os from "node:os";
import path from "node:path";
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), "synchro-ui", "autopilot");
const TITLE = "Bản tin đầu tháng (thử Autopilot)";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};
const { cookie } = await login(B);
const api = async (p, body, method = body ? "POST" : "GET") => {
  const headers = { "content-type": "application/json", origin: B, cookie };
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
};
const clear = async () => {
  for (const x of (await api("/api/tasks")).tasks ?? []) {
    if (x.title === TITLE) await api(`/api/tasks/${x.id}`, undefined, "DELETE");
  }
};
await clear();

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9421), name: "autopilot", shots: SHOTS });
const { P, ev, until, size, shot } = t;
const click = async (expr, what) => {
  const js = `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "nearest" });`
    + " const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()";
  const r = await ev(js);
  if (!r) throw new Error("không thấy: " + what);
  await t.click(r[0], r[1]);
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})]`
  + `.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0)`;
const MODAL = `document.querySelector(".tk-modal")`;
// Ô chọn của app (ui/listbox.tsx): bấm nút, chờ danh sách, bấm mục có data-value cần chọn.
const pick = async (btn, v) => {
  await click(btn, "ô chọn " + v);
  const opt = `document.querySelector('.dd-pop [role=option][data-value=${JSON.stringify(String(v))}]')`;
  if (!(await until(`!!${opt}`, 5000))) throw new Error("không thấy mục " + v);
  await click(opt, "mục " + v);
  await sleep(250);
};
// Gõ vào ô (React): đặt giá trị qua setter gốc rồi phát sự kiện input.
const fill = (sel, value) => ev(`(() => { const i = ${sel};
  const proto = i.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
// Hộp nằm trọn trong màn hình, trang không cuộn ngang, không ô nào tràn khỏi hộp.
const GEOM = `(() => { const m = ${MODAL}; if (!m) return null; const q = m.getBoundingClientRect();
  const wide = [...m.querySelectorAll(".tk-l, .field, .dd")]
    .filter((e) => e.getBoundingClientRect().right > q.right + 1).length;
  return { l: Math.round(q.left), r: Math.round(q.right), w: innerWidth,
    page: document.documentElement.scrollWidth <= innerWidth + 1, wide }; })()`;
const toast = `document.querySelector(".toast")?.textContent ?? ""`;
const job = `${byText(".tk-job", TITLE)}`;
const jobLine = `(${job})?.querySelector(".tk-t em")?.textContent ?? ""`;

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  const views = [
    { name: "may-tinh", w: 1440, h: 900, mobile: false }, { name: "dien-thoai", w: 375, h: 812, mobile: true },
  ];
  let first = true;
  for (const v of views) {
    for (const theme of ["light", "dark"]) {
      const tag = `${v.name}-${theme}`;
      console.log(`${v.w} px, ${theme === "light" ? "sáng" : "tối"}`);
      await size(v.w, v.h, v.mobile);
      await t.theme(theme);
      // Mỗi lượt tải lại hẳn trang (khác ?lan=): đổi mỗi phần # thì trình duyệt giữ nguyên trang của lượt trước.
      await P("Page.navigate", { url: `${B}/?lan=${tag}#v=inbox` });
      ok(await until(`!!document.querySelector(".tk-top h1") && location.hash === "#v=autopilot"`, 90000),
        `${tag}: địa chỉ cũ #v=inbox mở Autopilot, đổi sang #v=autopilot`, await ev("location.hash").catch(() => ""));
      if (first) {
        // Bấm địa chỉ cũ khi đang ở Autopilot (không tải lại trang): địa chỉ vẫn đổi sang #v=autopilot.
        await ev(`location.hash = "#v=inbox"`);
        ok(await until(`location.hash === "#v=autopilot" && !!document.querySelector(".tk-top h1")`, 5000),
          "đang ở Autopilot, bấm #v=inbox: vẫn ở Autopilot, địa chỉ đổi sang #v=autopilot", await ev("location.hash"));
      }
      const head = await ev(`[".tk-top h1", ".tk-top p"].map((s) => document.querySelector(s)?.textContent)`);
      ok(head[0] === "Autopilot" && /tắt tab hay gập máy/.test(head[1] ?? ""), `${tag}: tiêu đề và dòng giới thiệu`,
        head);
      if (!v.mobile) ok(await ev(`!!${byText(".rail .nav-item", "Autopilot")}`), `${tag}: thanh bên có mục Autopilot`);
      await sleep(600);
      await shot(`${tag}-1-trang`);

      await click(byText(".tk-comp .btn", "Tự đặt"), "Tự đặt");
      ok(await until(`!!${MODAL}`, 5000), `${tag}: mở form việc mới`);
      await pick(`${MODAL}.querySelector(".tk-kind")`, "cron");
      const f = await ev(`(() => { const m = ${MODAL}; return {
        cron: !!m.querySelector(".tk-cron input"), help: m.textContent.includes("Năm trường"),
        zone: m.querySelector(".tk-zone .dd-v")?.textContent ?? "",
        email: !!m.querySelector('[aria-label="Gửi email khi xong"]'),
      }; })()`);
      ok(f.cron && f.help && f.zone.startsWith("Asia/Ho_Chi_Minh") && f.email,
        `${tag}: cron có ô biểu thức và lời giải thích, múi giờ mặc định Asia/Ho_Chi_Minh, có nút gửi email`, f);
      const g = await ev(GEOM);
      ok(g && g.l >= 0 && g.r <= g.w && g.page && g.wide === 0,
        `${tag}: form nằm trọn trong màn hình, không ô nào tràn`, g);
      await shot(`${tag}-2-form-cron`);
      if (first) {
        await fill(`${MODAL}.querySelector("input.field")`, TITLE);
        await fill(`${MODAL}.querySelector("textarea")`, "Tóm tắt tin công nghệ nổi bật của tháng trước.");
        await fill(`${MODAL}.querySelector(".tk-cron input")`, "* * * * *");
        await click(`${MODAL}.querySelector(".modal-foot .btn.dark")`, "Lên lịch");
        ok(await until(`/mỗi giờ một lần/.test(${toast})`, 8000) && (await ev(`!!${MODAL}`)),
          "cron chạy mỗi phút bị từ chối, form vẫn mở", await ev(toast));
        await fill(`${MODAL}.querySelector(".tk-cron input")`, "0 9 1 * *");
        await click(`${MODAL}.querySelector('[aria-label="Gửi email khi xong"]')`, "Gửi email khi xong");
        await click(`${MODAL}.querySelector(".modal-foot .btn.dark")`, "Lên lịch");
        ok(await until(`!${MODAL}`, 8000), "lưu cron hợp lệ: form đóng");
        const saved = ((await api("/api/tasks")).tasks ?? []).find((x) => x.title === TITLE);
        const s = saved?.schedule;
        ok(s?.kind === "cron" && s.cron === "0 9 1 * *" && s.tz === "Asia/Ho_Chi_Minh" && saved.email === true,
          "máy chủ lưu đúng lịch, múi giờ và email", saved);
        first = false;
      } else {
        await click(`${MODAL}.querySelector(".modal-foot .btn:not(.dark)")`, "Hủy");
        await until(`!${MODAL}`, 4000);
      }

      await click(byText(".tk-tabs [role=tab]", "Việc tự động"), "thẻ Việc tự động");
      ok(await until(`!!${job}`, 8000), `${tag}: việc có trong thẻ Việc tự động`);
      const line = await ev(jobLine);
      ok(/Cron 0 9 1 \* \*/.test(line) && /lần tới/.test(line), `${tag}: thẻ việc hiện lịch cron và lần tới`, line);
      await shot(`${tag}-3-viec`);
      await click(`(${job}).querySelector('.toggle[role=switch]')`, "Tạm dừng");
      ok(await until(`/tạm dừng/.test(${jobLine})`, 6000), `${tag}: Tạm dừng → thẻ ghi đang tạm dừng`,
        await ev(jobLine));
      await click(`(${job}).querySelector('.toggle[role=switch]')`, "Chạy tiếp");
      ok(await until(`/lần tới/.test(${jobLine})`, 6000), `${tag}: Chạy tiếp → có lần tới`, await ev(jobLine));

      await click(`[...(${job}).querySelectorAll(".tk-acts .btn")].find((b) => b.textContent.includes("Sửa"))`, "Sửa");
      ok(await until(`!!${MODAL}`, 5000), `${tag}: mở form sửa`);
      await pick(`${MODAL}.querySelector(".tk-kind")`, "at");
      const at = await ev(`(() => { const m = ${MODAL};
        return { date: !!m.querySelector("input.tk-date"), cron: !!m.querySelector(".tk-cron") }; })()`);
      ok(at.date && !at.cron, `${tag}: một lần vào lúc hẹn có ô ngày, không còn ô cron`, at);
      const g2 = await ev(GEOM);
      ok(g2 && g2.page && g2.wide === 0, `${tag}: form sửa nằm trọn, không ô nào tràn`, g2);
      await shot(`${tag}-4-hen-gio`);
      await click(`${MODAL}.querySelector(".modal-foot .btn:not(.dark)")`, "Hủy");
      await until(`!${MODAL}`, 4000);
    }
  }
} catch (e) {
  fail++;
  console.log("  ✗", e.message);
  // Ảnh lỗi chỉ để xem lại; Chrome đã đóng kết nối thì không chụp được, lỗi chính đã ghi ở dòng trên.
  await shot("loi").catch(() => {});
} finally {
  t.close();
  await clear();
}
console.log(`\n${pass} đạt, ${fail} lỗi · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
