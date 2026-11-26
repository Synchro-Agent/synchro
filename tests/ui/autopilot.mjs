// Autopilot trên npm run dev:mock (Chrome ẩn; BASE=… đổi máy, SHOTS=<thư mục> chụp ảnh), máy tính 1440 px và điện thoại
// 375 px, sáng và tối:
// - Địa chỉ cũ #v=inbox mở trang Autopilot và đổi sang #v=autopilot; tiêu đề "Autopilot" và dòng giới thiệu.
// - Form "Tự đặt": loại lịch cron hiện ô biểu thức và lời giải thích, ô múi giờ mặc định Asia/Ho_Chi_Minh, nút "Gửi
//   email khi xong"; form nằm trọn trong màn hình, không cuộn ngang. Cron chạy mỗi phút bị từ chối kèm lý do.
// - Lưu cron hợp lệ: thẻ việc hiện lịch "Cron …" và lần tới; Tạm dừng / Chạy tiếp đổi trạng thái trên thẻ.
// - Sửa việc, chọn "Một lần, vào lúc đã hẹn": hiện ô ngày và giờ. Sửa hướng dẫn rồi Lưu (lịch giữ nguyên) thì lưu được.
// - Trình duyệt ở múi giờ khác (New York): thẻ việc ghi lần tới theo múi giờ của việc, kèm tên múi giờ; bộ lên kế hoạch
//   nhận đúng múi giờ form sẽ lưu (Asia/Ho_Chi_Minh), không phải múi giờ của trình duyệt.
// - Việc chạy xong trên máy chủ khi người dùng đang ở chỗ khác: dòng thông báo "Autopilot đã xong" có nút "Mở đoạn
//   chat", bấm vào mở đúng đoạn chat kết quả và hỏi tiếp được (model giả lập trả lời); trên điện thoại tối, dòng thông
//   báo nằm trọn trong màn hình.
// Ảnh chỉ chụp khi mọi hiệu ứng (hộp hiện dần .3s, thẻ mờ dần) đã chạy xong. Việc của bài này bị xóa khi xong.
import os from "node:os";
import path from "node:path";
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), "synchro-ui", "autopilot");
const TITLE = "Bản tin đầu tháng (thử Autopilot)";
const RUN_TITLE = "Câu chào (thử kết quả Autopilot)";
const HCM = "Asia/Ho_Chi_Minh";
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
    if (x.title === TITLE || x.title === RUN_TITLE) await api(`/api/tasks/${x.id}`, undefined, "DELETE");
  }
};
await clear();

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9421), name: "autopilot", shots: SHOTS });
const { P, ev, until, size } = t;
// Hộp hiện dần trong .3s, thẻ việc mờ dần khi tạm dừng: chụp lúc đó thì nửa trong suốt, ảnh không chứng minh được gì.
// Chờ mọi hiệu ứng hữu hạn chạy xong (vòng quay đang tải chạy mãi nên bỏ qua) rồi mới chụp.
const settle = async () => {
  const done = `document.getAnimations().every((a) => a.playState !== "running"
    || a.effect?.getComputedTiming().iterations === Infinity)`;
  const ok = await until(done, 5000);
  await sleep(60);
  return ok;
};
const shot = async (name) => { await settle(); await t.shot(name); };
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

// Sửa hướng dẫn rồi Lưu: form gửi lại đúng lịch cũ, máy chủ lưu được. Rồi giao việc bằng câu thường: bộ lên kế
// hoạch nhận múi giờ form sẽ lưu, không phải múi giờ của trình duyệt (đang giả là New York).
async function editAndPlan() {
  await click(`[...(${job}).querySelectorAll(".tk-acts .btn")].find((b) => b.textContent.includes("Sửa"))`, "Sửa");
  ok(await until(`!!${MODAL}`, 5000), "mở lại form sửa");
  await fill(`${MODAL}.querySelector("textarea")`, "Tóm tắt tin công nghệ nổi bật của tháng trước, kèm nguồn.");
  await click(`${MODAL}.querySelector(".modal-foot .btn.dark")`, "Lưu");
  ok(await until(`!${MODAL} && /Đã lưu việc/.test(${toast})`, 8000), "sửa hướng dẫn, lịch giữ nguyên: lưu được",
    await ev(toast));
  const saved = ((await api("/api/tasks")).tasks ?? []).find((x) => x.title === TITLE);
  ok(/kèm nguồn/.test(saved?.prompt ?? "") && saved?.schedule.cron === "0 9 1 * *", "máy chủ có hướng dẫn mới", saved);

  await ev(`(() => { window.__plan = null; const f = window.fetch;
    window.fetch = (u, o) => { if (String(u).includes("/api/tasks/plan")) window.__plan = o?.body ?? null; return f(u, \
o); };
    return 1; })()`);
  await fill(`document.querySelector(".tk-comp textarea")`, "9h sáng mai tóm tắt tin công nghệ");
  await click(byText(".tk-comp .btn", "Lên kế hoạch"), "Lên kế hoạch");
  ok(await until(`!!${MODAL}`, 30000), "lên kế hoạch: mở thẻ kế hoạch");
  const sent = JSON.parse((await ev("window.__plan")) ?? "{}");
  const zone = await ev(`${MODAL}.querySelector(".tk-zone .dd-v")?.textContent ?? ""`);
  ok(sent.tz === HCM && zone.startsWith(HCM), "bộ lên kế hoạch và form cùng múi giờ Asia/Ho_Chi_Minh (máy ở New York)",
    { sent: sent.tz, zone });
  await click(`${MODAL}.querySelector(".modal-foot .btn:not(.dark)")`, "Hủy");
  await until(`!${MODAL}`, 4000);
}

// Việc "Một lần, chạy ngay" chạy trên máy chủ khi người dùng đang ở đoạn chat mới; xong thì dòng thông báo có nút mở
// đúng đoạn chat kết quả.
async function freshToast(tag) {
  const made = await api("/api/tasks", { title: RUN_TITLE, prompt: "Viết một câu chào ngắn.", schedule: { kind: "once",
    tz: HCM } });
  ok(!!made.task?.id, `${tag}: tạo việc chạy ngay`, made);
  let item;
  for (let i = 0; i < 75 && !item; i++) {
    item = ((await api("/api/autopilot")).items ?? []).find((x) => x.task === made.task?.id && x.status !== "running");
    if (!item) await sleep(2000);
  }
  ok(item?.status === "done" && !!item.chat, `${tag}: việc chạy xong trên máy chủ, có đoạn chat kết quả`, item);
  // Số đếm tự hỏi mỗi phút; phát sự kiện đổi Autopilot để hỏi ngay thay vì chờ.
  let seen = false;
  for (let i = 0; i < 10 && !seen; i++) {
    await ev(`window.dispatchEvent(new Event("synchro:inbox"))`);
    seen = await until(`/Autopilot đã xong/.test(${toast}) && !!document.querySelector(".toast.act .btn")`, 2000);
  }
  ok(seen, `${tag}: dòng thông báo "Autopilot đã xong" có nút mở`, await ev(toast));
  return item;
}
async function resultChat() {
  console.log("Kết quả thành đoạn chat, hỏi tiếp được");
  await size(1440, 900, false);
  await t.theme("light");
  await P("Page.navigate", { url: `${B}/?lan=ket-qua` });
  ok(await until(`!!document.querySelector("textarea")`, 60000), "mở đoạn chat mới");
  await freshToast("máy tính sáng");
  await shot("ket-qua-1-thong-bao");
  ok(/Mở đoạn chat/.test(await ev(`document.querySelector(".toast.act .btn")?.textContent ?? ""`)),
    "nút trên dòng thông báo là Mở đoạn chat");
  await click(`document.querySelector(".toast.act .btn")`, "Mở đoạn chat");
  const opened = `[...document.querySelectorAll(".user-msg")].some((e) => /Viết một câu chào ngắn/.test(e.innerText))
    && document.querySelectorAll(".ai-msg").length >= 1`;
  ok(await until(opened, 15000), "bấm Mở đoạn chat: mở đúng đoạn chat kết quả");
  const n0 = await ev(`document.querySelectorAll(".ai-msg").length`);
  await click(`document.querySelector("textarea")`, "ô soạn tin");
  await t.type("Tóm tắt lại trong một dòng.");
  await t.key("Enter", "Enter", 13);
  const replied = `document.querySelectorAll(".ai-msg").length > ${n0}
    && ([...document.querySelectorAll(".ai-msg")].pop()?.innerText.trim().length ?? 0) > 0
    && !document.querySelector(".chat-item .ct-run")`;
  ok(await until(replied, 60000), "hỏi tiếp trong đoạn chat kết quả: model trả lời",
    await ev(`[...document.querySelectorAll(".ai-msg")].pop()?.innerText.slice(0, 200) ?? ""`));
  await shot("ket-qua-2-hoi-tiep");

  await size(375, 812, true);
  await t.theme("dark");
  await P("Page.navigate", { url: `${B}/?lan=ket-qua-dt` });
  ok(await until(`!!document.querySelector("textarea")`, 60000), "điện thoại tối: mở đoạn chat mới");
  await freshToast("điện thoại tối");
  // Dòng thông báo chỉ ở 8 giây: không chờ các hiệu ứng khác của trang, chỉ chờ nó hiện xong (.2s).
  await sleep(400);
  const box = await ev(`(() => { const t = document.querySelector(".toast.act"), b = t?.querySelector(".btn");
    if (!t || !b) return null; const r = t.getBoundingClientRect(), q = b.getBoundingClientRect();
    return { l: r.left, r: r.right, w: innerWidth, inside: q.left >= r.left && q.right <= r.right + 0.5, h: q.height \
}; })()`);
  ok(box && box.l >= 0 && box.r <= box.w && box.inside && box.h >= 32, "điện thoại: dòng thông báo và nút nằm trọn",
    box);
  await t.shot("ket-qua-3-dien-thoai-toi");
  await click(`document.querySelector(".toast.act .btn")`, "Mở đoạn chat");
  ok(await until(opened, 15000), "điện thoại: bấm Mở đoạn chat mở đúng đoạn chat kết quả");
}

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  // Máy ở New York, việc ở Asia/Ho_Chi_Minh: giờ trên thẻ việc và giờ bộ lên kế hoạch dùng phải theo múi giờ của việc.
  await P("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" });
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
      ok(await ev(`getComputedStyle(${MODAL}).opacity === "1"`),
        `${tag}: lúc chụp form đã hiện hẳn (không trong suốt)`);
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
      ok(/Cron 0 9 1 \* \*/.test(line) && /lần tới 09:00 · 01\/\d\d \(Asia\/Ho_Chi_Minh\)/.test(line),
        `${tag}: thẻ việc hiện lịch cron, lần tới 09:00 theo múi giờ của việc kèm tên múi giờ (máy ở New York)`, line);
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
      if (tag === "may-tinh-light") await editAndPlan();
    }
  }
  await resultChat();
} catch (e) {
  fail++;
  console.log("  ✗", e.message);
  // Ảnh lỗi chỉ để xem lại; Chrome đã đóng kết nối thì không chụp được, lỗi chính đã ghi ở dòng trên.
  await t.shot("loi").catch((err) => console.log("  (không chụp được ảnh lỗi)", err.message));
} finally {
  t.close();
  await clear();
}
console.log(`\n${pass} đạt, ${fail} lỗi · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
