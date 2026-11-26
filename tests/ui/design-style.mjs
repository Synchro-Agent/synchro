// "Làm theo kiểu này" và "Phong cách của tôi" trên npm run dev:mock (Chrome ẩn, BASE=… đổi máy, SHOTS=<thư mục>
// chụp ảnh):
// - Menu + có mục "Làm theo kiểu này…"; bảng chọn nằm trọn trong màn hình, không bị lớp nào che, ở 1440 và 375 px,
//   sáng và tối; điện thoại là tấm phủ cả chiều ngang ở đáy (cách mép 8px như mọi khung nổi).
// - Dán liên kết khi máy không đọc được trang: báo lỗi trong bảng, không tràn. Dùng ảnh đính kèm: thành chip hoặc
//   báo lỗi.
// - Chọn phong cách đã lưu: chip "Kiểu: …" trong ô soạn tin, đi kèm lượt gửi (body.designStyle), còn sau khi tải
//   lại trang, bỏ chip thì lượt sau không còn. Đổi tên, xóa trong bảng. Esc đóng bảng.
// - Menu Phong cách của artifact có "Lưu làm phong cách của tôi": lưu xong có trong danh sách.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), "synchro-ui", "design-style");
mkdirSync(SHOTS, { recursive: true });
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
  const list = (await api("/api/design-styles")).styles ?? [];
  for (const s of list) await api(`/api/design-styles/${s.id}`, undefined, "DELETE");
};
await clear();
const seedHtml = (preset) => `<html data-sx-preset="${preset}"><body><h1>Thử</h1></body></html>`;
const seed = (name, preset) => api("/api/design-styles", { from: "artifact", conv: "ds-ui", ident: `x-${preset}`,
  content: seedHtml(preset), name, save: true });
let NAME = "Thô mộc thử";
const s1 = (await seed(NAME, "neo-brutalist")).style;
if (!s1) throw new Error("không tạo được phong cách mẫu");

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9396), name: "design-style", shots: SHOTS });
const { P, ev, until, size, shot } = t;
const bodies = [];
t.on("Network.requestWillBeSent", async (p) => {
  if (p.request.method !== "POST" || !/\/api\/llm$/.test(p.request.url)) return;
  let data = p.request.postData;
  if (!data && p.request.hasPostData) data = (await P("Network.getRequestPostData",
    { requestId: p.requestId })).postData;
  try {
    bodies.push(JSON.parse(data));
  } catch {
    // Lượt tiếp tục (duyệt quyền, resume) không phải JSON của một tin nhắn mới: bỏ qua.
  }
});
// Vòng tải của bảng (đang tải danh sách, đang lưu, đang đọc liên kết) chỉ hiện trong chốc lát: ghi lại mọi vòng *-spin
// lúc nó xuất hiện, kèm nó có viền và có quay không, để cuối bài kiểm tra xem có vòng nào trống trơn. Giữ trong
// sessionStorage vì mỗi cỡ màn hình nạp lại trang.
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const keep = (x) => { const a = JSON.parse(sessionStorage.getItem("__spins") || "[]"); a.push(x);
    sessionStorage.setItem("__spins", JSON.stringify(a)); };
  const look = (el) => { if (!(el instanceof Element)) return;
    for (const s of [el, ...el.querySelectorAll("[class*='-spin']")]) {
      if (![...s.classList].some((c) => c.endsWith("-spin"))) continue;
      const cs = getComputedStyle(s);
      keep({ cls: s.className, anim: cs.animationName, border: cs.borderTopStyle,
        where: s.parentElement?.className ?? "" });
    } };
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(look); })
    .observe(document, { childList: true, subtree: true });
})()` });
const click = async (expr, what) => {
  const js = `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "nearest" });`
    + " const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()";
  const r = await ev(js);
  if (!r) throw new Error("không thấy: " + what);
  await t.click(r[0], r[1]);
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})]`
  + `.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0)`;
const POP = `document.querySelector(".menu.sty-pop:not(.out)")`;
const openPop = async () => {
  // Bảng vừa đóng còn chạy hiệu ứng đóng (lớp .out) thì đợi xong, khỏi đọc nhầm danh sách cũ.
  await until(`!document.querySelector(".menu.sty-pop.out")`, 2000);
  await click(`document.querySelector('.composer button[aria-label="Thêm"]')`, "nút +");
  await until(`!!document.querySelector(".plus-menu")`, 4000);
  // Menu + mở bằng hiệu ứng trượt: đợi đứng yên rồi mới lấy toạ độ mục cần bấm.
  await sleep(350);
  await click(byText(".plus-menu .menu-item", "Làm theo kiểu này"), "mục Làm theo kiểu này");
  // Mock chạy chế độ dev dịch /api/design-styles ở lần gọi đầu (có khi quá 10 giây): chờ đủ lâu cho lần đó.
  return until(`!!${POP}?.querySelector(".sty-list .sty-row, .sty-list .sty-empty")`, 25000);
};
// Hiệu ứng mở của khung nổi dùng đường lò xo (vượt quá rồi về): đo khi còn chạy thì lệch vài px. Đợi mọi hiệu ứng có
// hạn của phần tử xong; hiệu ứng lặp mãi (vòng quay đang tải) không tính.
const settled = (sel) => ev(`(() => { const el = ${sel}; if (!el) return null;
  const run = el.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity);
  // Hiệu ứng bị hủy giữa chừng (phần tử đóng) cũng là xong: chỉ cần biết lúc nó dừng.
  return Promise.all(run.map((a) => a.finished.catch(() => null))).then(() => true); })()`);
// Bảng nằm trọn trong màn hình, không bị phần tử khác che (dò lưới điểm), trang không cuộn ngang.
const GEOM = `(() => {
  const m = ${POP}; if (!m) return null;
  const q = m.getBoundingClientRect(); let pts = 0; const by = [];
  // Lùi 10px khỏi mép: góc bo 16px của tấm phủ điện thoại không tính là vùng của bảng khi dò điểm.
  for (let x = q.left + 10; x < q.right - 10; x += 12) for (let y = q.top + 10; y < q.bottom - 10; y += 12) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    pts++; const e = document.elementFromPoint(x, y);
    if (e && !m.contains(e)) by.push(Math.round(x) + "," + Math.round(y) + ":" + e.tagName + "." + e.className);
  }
  const over = [...m.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1
    && getComputedStyle(e).overflowX === "visible" && e.children.length === 0).length;
  return { l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom), w: innerWidth,
    h: innerHeight, covered: by.length, by: by.slice(0, 3), pts,
    page: document.documentElement.scrollWidth <= innerWidth + 1, over };
})()`;
const chipText = `document.querySelector(".composer .sty-chip")?.textContent.trim() ?? ""`;
const sendMsg = async (text) => {
  await click(`document.querySelector(".composer textarea")`, "ô soạn tin");
  await t.type(text);
  await t.key("Enter", "Enter", 13);
};
const waitBody = async (n) => {
  for (let i = 0; i < 60 && bodies.length === n; i++) await sleep(200);
  return bodies.length > n;
};
const newChat = async () => {
  await click(byText(".nav-item", "Mới"), "Mới");
  await sleep(700);
};

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  const views = [
    { name: "may-tinh", w: 1440, h: 900, mobile: false },
    { name: "dien-thoai", w: 375, h: 812, mobile: true },
  ];
  let first = true;
  for (const v of views) {
    for (const theme of ["light", "dark"]) {
      const tag = `${v.name}-${theme}`;
      console.log(`${v.w} px, ${theme === "light" ? "sáng" : "tối"}`);
      await size(v.w, v.h, v.mobile);
      await t.theme(theme);
      await P("Page.navigate", { url: B + "/" });
      if (!(await until(`!!document.querySelector(".composer textarea")`, 60000))) throw new Error("app không mở");
      await sleep(1200);
      if (await ev(`!!document.querySelector(".side-scrim")`)) await t.click(v.w - 8, v.h - 120);
      ok(await openPop(), `${tag}: mở bảng "Làm theo kiểu này"`);
      await settled(POP);
      const g = await ev(GEOM);
      const inView = g && g.l >= 0 && g.r <= g.w && g.t >= 0 && g.b <= g.h;
      ok(inView && g.page, `${tag}: bảng nằm trọn trong màn hình, trang không cuộn ngang`, g);
      ok(g && g.covered === 0 && g.pts > 20, `${tag}: không bị lớp nào che`, g);
      ok(g && g.over === 0, `${tag}: không có chữ tràn khỏi ô`, g);
      const sheet = g && g.l === 8 && g.r === g.w - 8 && g.b === g.h - 8;
      if (v.mobile) ok(sheet, `${tag}: điện thoại là tấm phủ cả chiều ngang ở đáy, cách mép 8px`, g);
      const row = await ev(`(() => { const r = ${byText(".sty-row", NAME)}; return r ? {
        sw: r.querySelectorAll(".sty-sw i").length, fonts: r.querySelector(".sty-t em")?.textContent } : null; })()`);
      ok(row && row.sw === 5 && /Space Grotesk/.test(row.fonts),
        `${tag}: phong cách đã lưu có ô màu và tên phông`, row);
      await shot(`${tag}-1-bang`);
      if (first) {
        await click(`document.querySelector(".sty-url input")`, "ô liên kết");
        await t.type("https://example.com/");
        await click(byText(".sty-url button", "Đọc"), "Đọc");
        ok(await until(`!!document.querySelector(".sty-err")`, 70000),
          "dán liên kết mà máy không đọc được: báo lỗi trong bảng");
        const ge = await ev(GEOM);
        ok(ge && ge.b <= ge.h && ge.over === 0, "lỗi xuống dòng, bảng vẫn trong màn hình", ge);
        console.log("     lỗi:", await ev(`document.querySelector(".sty-err").textContent`));
        await shot(`${tag}-2-loi-lien-ket`);
        await t.key("Escape", "Escape", 27);
        ok(await until(`!${POP}`, 3000), "Esc đóng bảng");
        await openPop();
      }
      await click(`${byText(".sty-row", NAME)}?.querySelector(".sty-use")`, "chọn phong cách");
      const picked = await until(`!${POP} && (${chipText}).includes(${JSON.stringify(NAME)})`, 4000);
      ok(picked, `${tag}: chọn xong thành chip trong ô soạn tin`, await ev(chipText));
      const chip = await ev(`(() => { const c = document.querySelector(".composer .sty-chip"),
        box = document.querySelector(".composer"); const a = c.getBoundingClientRect(), b = box.getBoundingClientRect();
        return { inside: a.left >= b.left && a.right <= b.right,
          page: document.documentElement.scrollWidth <= innerWidth + 1 };
      })()`);
      ok(chip.inside && chip.page, `${tag}: chip nằm trong ô soạn tin`, chip);
      // Bảng còn đang mờ dần (lớp .out) thì che ô soạn tin trong ảnh: đợi hiệu ứng đóng xong rồi mới chụp.
      await until(`!document.querySelector(".menu.sty-pop.out")`, 2000);
      await sleep(150);
      await shot(`${tag}-3-chip`);
      if (first) {
        console.log("Chip đi theo đoạn chat");
        const n0 = bodies.length;
        await sendMsg("xin chào");
        ok(await waitBody(n0), "gửi tin: có lượt /api/llm");
        ok(bodies.at(-1)?.designStyle?.id === s1.id && bodies.at(-1)?.designStyle?.kind === "mine",
          "lượt gửi mang body.designStyle của chip", bodies.at(-1)?.designStyle);
        await until(`!document.querySelector(".ai-msg.ai-streaming")`, 30000);
        ok(/Thô mộc thử/.test(await ev(chipText)), "chip còn trên đoạn chat sau khi gửi");
        const url = await ev("location.href");
        await P("Page.navigate", { url });
        await until(`!!document.querySelector(".composer textarea") && !!document.querySelector(".ai-msg")`, 30000);
        await sleep(800);
        ok(/Thô mộc thử/.test(await ev(chipText)), "tải lại trang: chip vẫn còn trên đoạn chat đó");
        const n1 = bodies.length;
        await sendMsg("cảm ơn");
        await waitBody(n1);
        ok(bodies.at(-1)?.designStyle?.id === s1.id, "lượt sau vẫn mang phong cách", bodies.at(-1)?.designStyle);
        await until(`!document.querySelector(".ai-msg.ai-streaming")`, 30000);
        await click(`document.querySelector('.composer .sty-chip button')`, "bỏ chip");
        ok(await until(`!document.querySelector(".composer .sty-chip")`, 2000), "bấm × bỏ chip");
        const n2 = bodies.length;
        await sendMsg("lượt không kiểu");
        ok((await waitBody(n2)) && !bodies.at(-1)?.designStyle, "bỏ chip: lượt sau không còn designStyle",
          bodies.at(-1));
        await until(`!document.querySelector(".ai-msg.ai-streaming")`, 30000);
        await newChat();
        ok(!(await ev(`!!document.querySelector(".composer .sty-chip")`)),
          "đoạn chat mới không mang chip của đoạn khác");

        console.log("Chip ở trang chủ không sang đoạn chat có sẵn");
        await openPop();
        await click(`${byText(".sty-row", NAME)}?.querySelector(".sty-use")`, "chọn phong cách ở trang chủ");
        await until(`!${POP} && (${chipText}).includes(${JSON.stringify(NAME)})`, 4000);
        await P("Page.navigate", { url });
        await until(`!!document.querySelector(".composer textarea") && !!document.querySelector(".ai-msg")`, 30000);
        await sleep(800);
        ok(!(await ev(`!!document.querySelector(".composer .sty-chip")`)),
          "mở đoạn chat có sẵn: ô soạn tin không có chip của trang chủ");
        const n3 = bodies.length;
        await sendMsg("lượt ở đoạn cũ");
        ok((await waitBody(n3)) && !bodies.at(-1)?.designStyle,
          "gửi ở đoạn chat có sẵn: lượt không mang chip của trang chủ", bodies.at(-1)?.designStyle);
        await until(`!document.querySelector(".ai-msg.ai-streaming")`, 30000);
        await newChat();
        ok((await ev(chipText)).includes(NAME), "về trang chủ: chip vẫn chờ đoạn chat mới", await ev(chipText));
        await click(`document.querySelector('.composer .sty-chip button')`, "bỏ chip trang chủ");

        console.log("Đổi tên, xóa, ảnh đính kèm");
        await openPop();
        await click(`${byText(".sty-row", "Thô mộc thử")}?.querySelector('[aria-label^="Đổi tên"]')`, "đổi tên");
        ok(await until(`document.activeElement?.matches(".sty-rename input")`, 2000), "ô đổi tên nhận con trỏ ngay");
        await t.type("Thô mộc mới");
        await click(byText(".sty-rename button", "Lưu"), "lưu tên");
        // PATCH /api/design-styles/[id] cũng được dịch ở lần gọi đầu trên mock dev.
        ok(await until(`!!${byText(".sty-row", "Thô mộc mới")}`, 20000), "đổi tên xong hiện tên mới");
        NAME = "Thô mộc mới";
        await shot(`${tag}-4-doi-ten`);
        await seed("Để xóa", "soft-bento");
        await until(`!!${byText(".sty-row", "Thô mộc mới")}`, 2000);
        await t.key("Escape", "Escape", 27);
        await openPop();
        const fresh = await until(`!!${byText(".sty-row", "Để xóa")}`, 5000);
        ok(fresh, "mở lại bảng: danh sách tải lại, có phong cách vừa thêm");
        await click(`${byText(".sty-row", "Để xóa")}?.querySelector('[aria-label^="Xóa"]')`, "xóa");
        await until(`!!${byText(".overlay button, [role=dialog] button", "Xóa")}`, 3000);
        await click(byText(".overlay button, [role=dialog] button", "Xóa"), "xác nhận xóa");
        ok(await until(`!${byText(".sty-row", "Để xóa")}`, 20000), "xóa: phong cách biến khỏi danh sách");
        await t.key("Escape", "Escape", 27);
        const png = path.join(SHOTS, "mau.png");
        const { data } = await P("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 400, height: 300,
          scale: 1 } });
        writeFileSync(png, Buffer.from(data, "base64"));
        const { root } = await P("DOM.getDocument", { depth: 1 });
        const { nodeId } = await P("DOM.querySelector", { nodeId: root.nodeId,
          selector: ".composer input[type=file]" });
        await P("DOM.setFileInputFiles", { nodeId, files: [png] });
        await until(`!!document.querySelector(".composer .file-card, .composer [class*=file]")`, 8000);
        await sleep(800);
        await openPop();
        ok(await ev(`!document.querySelector(".sty-img").disabled`), "có ảnh đính kèm: nút Dùng ảnh đính kèm bật");
        await click(`document.querySelector(".sty-img")`, "dùng ảnh");
        const done = await until(`/Kiểu:/.test(${chipText}) || !!document.querySelector(".sty-err")`, 20000);
        const how = await ev(`document.querySelector(".sty-err")?.textContent ?? ${chipText}`);
        ok(done, "dùng ảnh đính kèm: thành chip, hoặc báo lỗi rõ trong bảng", how);
        console.log("     ảnh:", how);
        await shot(`${tag}-5-anh`);
        const chipBtn = `document.querySelector('.composer .sty-chip button')`;
        if (await ev(`!!${chipBtn}`)) await click(chipBtn, "bỏ chip ảnh");
        await t.key("Escape", "Escape", 27);
        first = false;
      } else {
        await click(`document.querySelector('.composer .sty-chip button')`, "bỏ chip");
      }
    }
  }

  console.log("Lưu từ menu Phong cách của artifact");
  await size(1440, 900, false);
  await t.theme("light");
  const spec = { styleArchetype: "linear-dark", pages: [
    { templateId: "slide-cover", props: { badge: "2026", title: "Trà sớm về phố", subtitle: "Ra mắt", author: "A",
      date: "11/2026" } },
  ] };
  const json = `<script type="application/json" data-sx-template>${JSON.stringify(spec)}</script>`;
  const html = `<html><body>${json}</body></html>`;
  const ai = `Bộ slide.\n<artifact identifier="tra-som" type="text/html" title="Trà sớm">${html}</artifact>`;
  const now = Date.now();
  const chat = { id: now, title: "Trà sớm thử", msgs: [{ role: "user", text: "Làm slide", time: now, done: true },
    { role: "ai", text: ai, time: now + 1, done: true }] };
  await api("/api/chats", { items: [{ kind: "chat", id: String(now), upd: now + 1, data: JSON.stringify(chat) }] },
    "PUT");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector(".composer textarea")`, 30000);
  await until(`!!${byText("a,button,[role=button],li,div,span", "Trà sớm thử")}`, 20000);
  await click(`[...document.querySelectorAll("a,button,[role=button],li,div,span")].filter((e) => e.textContent.trim()
    === "Trà sớm thử" && e.getBoundingClientRect().width > 0).pop()`, "đoạn chat");
  await until(`!!document.querySelector(".art-card")`, 15000);
  if (!(await ev(`!!document.querySelector(".art-panel")`))) await click(`document.querySelector(".art-card")`, "thẻ");
  await until(`!!document.querySelector('.art-acts [aria-label="Đổi phong cách"]')`, 20000);
  await sleep(1500);
  await click(`document.querySelector('.art-acts [aria-label="Đổi phong cách"]')`, "menu phong cách");
  await until(`!!document.querySelector(".art-style-menu .sty-save")`, 4000);
  await sleep(500);
  await shot("artifact-1-menu");
  await click(`document.querySelector(".art-style-menu .sty-save")`, "Lưu làm phong cách của tôi");
  ok(await until(`document.activeElement?.matches(".sty-savef input")`, 2000),
    "ô tên phong cách nhận con trỏ, điền sẵn tên");
  const menuGeom = await ev(`(() => { const r = document.querySelector(".art-style-menu").getBoundingClientRect();
    return { r: Math.round(r.right), b: Math.round(r.bottom), w: innerWidth, h: innerHeight }; })()`);
  ok(menuGeom.r <= menuGeom.w && menuGeom.b <= menuGeom.h, "menu vẫn trong màn hình khi mở ô tên", menuGeom);
  await sleep(500);
  const form = await ev(`(() => { const f = document.querySelector(".sty-savef"); if (!f) return null;
    const r = f.getBoundingClientRect(), i = f.querySelector("input").getBoundingClientRect();
    return { h: Math.round(r.height), iw: Math.round(i.width), op: getComputedStyle(f).opacity }; })()`);
  ok(form && form.h >= 34 && form.iw >= 100, "ô tên hiện đủ (cao, rộng) trong menu", form);
  await shot("artifact-2-ten");
  await click(byText(".sty-savef button", "Lưu"), "lưu phong cách");
  await sleep(1500);
  const names = ((await api("/api/design-styles")).styles ?? []).map((s) => s.name);
  ok(names.includes("Trà sớm"), "đã lưu vào Phong cách của tôi", names);
  const spins = await ev(`JSON.parse(sessionStorage.getItem("__spins") || "[]")`);
  const bare = spins.filter((x) => x.anim === "none" || x.border === "none");
  ok(spins.length > 0 && bare.length === 0, `vòng tải của bảng có viền và đang quay (${spins.length} lần thấy)`,
    bare.slice(0, 3));
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
