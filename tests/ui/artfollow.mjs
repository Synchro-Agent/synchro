// Khung đoạn chat (Thread.tsx) chỉ gắn ở trang chat, nên các trạng thái phải sống qua lúc rời trang (Chrome ẩn trên npm run dev:mock):
// - Artifact đang viết, người dùng đóng khung xem, sang Dự án rồi quay lại khi câu trả lời vẫn chảy: khung vẫn đóng (không tự mở lại).
// - Artifact bắt đầu viết trong lúc người dùng ở trang khác: quay lại thì khung xem đã mở sẵn artifact đó (như trước khi tách Thread.tsx).
// - Đổi ngôn ngữ trong đoạn chat đang mở: vòng Mức dùng ở khối soạn tin (phần tử đã memo ở Home) đổi nhãn theo (aria-label / data-tip).
// - Lời chào trang chủ 375px đã thu nhỏ (FitLine) rồi đổi sang câu dài hơn (bộ dịch, đổi tên gọi): thu nhỏ lại, không tràn mép phải.
// Chạy tay: node tests/ui/artfollow.mjs   (BASE=… đổi máy, SHOTS=<thư mục> chụp ảnh)
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
const MOCK = process.env.MOCK_API ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };

const { cookie } = await login(B);
await fetch(B + "/api/caps", { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ art: true }) });
const streams = () => fetch(MOCK + "/_debug/streams").then((r) => r.json()).catch(() => null);

const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9389), name: "artfollow", shots: process.env.SHOTS });
const { P, ev, until, size, shot } = t;
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("không thấy: " + what);
  await t.click(r[0], r[1]);
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const sendMsg = async (text) => {
  await click(`document.querySelector("textarea")`, "ô soạn tin");
  await t.type(text);
  await t.key("Enter", "Enter", 13);
};
const PANEL = `!!document.querySelector("aside.art-panel:not(.fp)")`;
const STREAMING = `!!document.querySelector(".ai-msg.ai-streaming")`;
const newChat = async () => { await click(byText(".nav-item", "Mới"), "Mới"); await sleep(700); };
const toProjects = async () => { await click(byText(".nav-item", "Dự án"), "Dự án"); await until(`!document.querySelector(".thread")`, 5000); await sleep(400); };
// Quay lại đoạn chat bằng nút Back (địa chỉ #c= của trang chat).
const backToChat = async () => { await ev(`history.back(), 1`); return until(`!!document.querySelector(".ai-msg")`, 8000); };
const stopRun = async () => { if (await ev(STREAMING)) { await click(`document.querySelector("button.send")`, "Dừng").catch(() => {}); await until(`!document.querySelector(".ai-msg.ai-streaming")`, 8000); } };

try {
  await size(1440, 900);
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Page.navigate", { url: B + "/" });
  if (!(await until(`!!document.querySelector("textarea")`, 60000))) throw new Error("app không mở");
  await sleep(1200);

  console.log("Đóng khung artifact đang viết, sang Dự án rồi quay lại");
  await newChat();
  await sendMsg("viết trang dài #artlong #streamslow");
  ok(await until(PANEL, 20000), "artifact đang viết: khung xem tự mở");
  await click(`document.querySelector('aside.art-panel [aria-label="Đóng"]')`, "đóng khung");
  ok(await until(`!(${PANEL})`, 4000), "bấm Đóng: khung đóng trong lúc artifact vẫn đang viết");
  await toProjects();
  ok(await backToChat(), "quay lại đoạn chat");
  await sleep(1500);
  ok(await ev(STREAMING), "câu trả lời vẫn đang chảy khi quay lại (điều kiện của phép thử)");
  ok(!(await ev(PANEL)), "khung đã đóng vẫn đóng, không tự mở lại sau khi rời trang chat");
  await shot("artfollow-1-dismissed");
  await stopRun();

  console.log("Artifact bắt đầu viết khi đang ở trang khác");
  await newChat();
  const s0 = await streams();
  await sendMsg("viết trang #artlong #artlate #streamslow");
  await until(`!!document.querySelector(".ai-msg")`, 10000);
  ok(!(await ev(PANEL)), "lúc rời trang chat artifact chưa bắt đầu (điều kiện của phép thử)");
  await toProjects();
  // Chờ luồng chạy hết ở máy giả lập (không có đoạn chat trên màn hình để nhìn).
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) { const s = await streams(); if (s && s0 && s.completed > s0.completed) break; await sleep(500); }
  await sleep(800);
  ok(await backToChat(), "quay lại đoạn chat");
  ok(await until(PANEL, 4000), "quay lại: khung xem đã mở artifact vừa viết trong lúc vắng mặt");
  ok(await until(`!!document.querySelector("main.has-art")`, 2000), "vùng chính có lớp has-art cùng lúc với khung");
  await shot("artfollow-2-late");

  console.log("Đổi ngôn ngữ trong đoạn chat đang mở");
  const ring = `[...document.querySelectorAll(".us-ring")].map((b) => [b.getAttribute("aria-label"), b.getAttribute("data-tip")])`;
  await until(`[...document.querySelectorAll(".us-ring")].length > 0`, 8000);
  const vi = await ev(ring);
  ok(vi.length && vi.every(([a, d]) => /^Mức dùng/.test(a) && /^Mức dùng/.test(d)), "tiếng Việt: vòng Mức dùng ghi Mức dùng", vi);
  const pickLang = async (name) => {
    await click(`document.querySelector("button.user")`, "menu tài khoản");
    // until trả false (không ném) khi hết giờ: menu chưa mở thì bấm lại một lần (lượt chat của đoạn trước có thể vẫn đang chạy và vẽ lại trang).
    if (!(await until(`!!document.querySelector(".usermenu .menu-item")`, 3000))) await click(`document.querySelector("button.user")`, "menu tài khoản (lần 2)");
    // Chờ đúng mục Ngôn ngữ / Language: ngay sau khi đổi ngôn ngữ, chữ các mục có thể chưa dịch xong lúc menu vừa hiện.
    await until(`[...document.querySelectorAll(".usermenu .menu-item")].some((e) => /Ngôn ngữ|Language/.test(e.textContent))`, 3000);
    await click(`[...document.querySelectorAll(".usermenu .menu-item")].find((e) => /Ngôn ngữ|Language/.test(e.textContent))`, "Ngôn ngữ");
    await until(`!!document.querySelector(".sy-langs button")`, 3000);
    await click(byText(".sy-langs button", name.slice(0, 2)), name);
  };
  await pickLang("En");
  ok(await until(`document.documentElement.lang === "en"`, 5000), "giao diện chuyển sang tiếng Anh");
  ok(await until(`(${ring}).every(([a, d]) => /^Usage/.test(a) && /^Usage/.test(d))`, 5000), "tiếng Anh: vòng Mức dùng đổi nhãn sang Usage (aria-label, data-tip)", await ev(ring));
  await pickLang("Vi");
  ok(await until(`document.documentElement.lang === "vi"`, 5000), "về tiếng Việt");
  ok(await until(`(${ring}).every(([a, d]) => /^Mức dùng/.test(a) && /^Mức dùng/.test(d))`, 5000), "về tiếng Việt: nhãn vòng Mức dùng về Mức dùng", await ev(ring));

  console.log("Lời chào trang chủ 375px đổi chữ sau khi đã thu nhỏ");
  await size(375, 812, true);
  // Về trang chủ (không tải lại: địa chỉ đang là #c= của đoạn chat ở phần trên, tải lại thì mở lại đoạn chat, không có lời chào).
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("h1.greeting .greet-t")`, 30000);
  await sleep(1200);
  // Chữ vượt khung: phần chữ (Range) tràn mép phải của h1 trừ padding.
  const fit = `(() => {
    const el = document.querySelector("h1.greeting .greet-t"), box = el.parentElement, r = document.createRange();
    r.selectNodeContents(el);
    const right = box.getBoundingClientRect().right - (parseFloat(getComputedStyle(box).paddingRight) || 0);
    return { over: Math.round(r.getBoundingClientRect().right - right), lines: r.getClientRects().length && Math.round(r.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), fs: getComputedStyle(el).fontSize, text: el.textContent };
  })()`;
  // Đặt cả câu chào: nút chữ đầu nhận câu mới, các nút chữ sau (", " và tên gọi, chỉ có từ 5 giờ tới 18 giờ) để rỗng, không gỡ nút của React.
  // Trước đây chỉ đổi nút đầu nên ban ngày tên gọi nối thêm vào câu thử dài, quá 60% cỡ chữ thì FitLine để xuống dòng (đúng thiết kế): lỗi theo giờ chạy.
  const setText = (s) => ev(`(() => { const el = document.querySelector("h1.greeting .greet-t"), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let first = true, n; while ((n = w.nextNode())) { n.nodeValue = first ? ${JSON.stringify(s)} : ""; first = false; } return 1; })()`);
  await setText("Chào buổi tối, mọi thứ thế nào?");
  await sleep(400);
  const a = await ev(fit);
  ok(a.over <= 1 && a.lines === 1, "câu dài: thu nhỏ vừa một dòng", a);
  // Câu dài hơn nhưng vẫn trong mức FitLine thu nhỏ được (≥ 60% cỡ chữ). Câu cũ "…hôm nay mọi thứ của bạn thế nào rồi?" cần 735px ở 26px
  // trên khung 343px (47%): FitLine để xuống dòng đúng thiết kế (tên rất dài), phép thử không bao giờ đạt ở 375px.
  await setText("Chào buổi tối, hôm nay bạn thế nào?");
  await sleep(400);
  const b = await ev(fit);
  ok(b.over <= 1 && b.lines === 1 && parseFloat(b.fs) < parseFloat(a.fs), "đổi sang câu dài hơn khi đã thu nhỏ: thu nhỏ thêm, không tràn mép phải", b);
  await setText("Chào bạn");
  await sleep(400);
  const c = await ev(fit);
  ok(c.over <= 1 && parseFloat(c.fs) > parseFloat(b.fs), "đổi sang câu ngắn: cỡ chữ lớn lại", c);
  await shot("artfollow-3-greet");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("artfollow-fail").catch(() => {}); }

const errs = t.logs.filter((l) => !/ResizeObserver loop/.test(l));
ok(!errs.length, "không có lỗi JS trên trang", errs);
console.log(`${pass}/${pass + fail} đạt`);
t.close();
process.exit(fail ? 1 : 0);
