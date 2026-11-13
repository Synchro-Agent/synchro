// Thẻ (tag) của đoạn chat trong Chrome ẩn (npm run dev:mock): menu ⋮ → Gắn thẻ (tạo / chọn / bỏ, không phân biệt dấu), chip thẻ ở đầu trang chat,
// lọc theo thẻ ở thanh bên, tìm "#thẻ" trong bảng lệnh ⌘K, thẻ lên máy chủ cùng đoạn chat; menu nền đặc, nằm trọn màn hình ở 375px và giao diện tối.
// Chạy tay: BASE=http://localhost:3500 SHOTS=/tmp/x node tests/ui/tags.mjs
import { openChrome, sleep } from "../lib/cdp.mjs";
import { tempUser } from "../lib/tempuser.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };

// Người dùng tạm của riêng bộ này (H2.4): đoạn chat, thẻ dựng sẵn không lẫn vào tài khoản quản trị dùng chung; xóa khi xong.
const u = await tempUser(B, "tags");
const { cookie, uid } = { cookie: u.cookie, uid: u.uid };
const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9362), name: "tags", shots: process.env.SHOTS });
const { P, ev, until } = t;
const now = Date.now();
const A = now, Bc = now + 10, C = now + 20;
// Mỗi lần chạy một bộ tên riêng: đoạn chat của lần chạy trước còn trên máy chủ (đồng bộ) không làm sai số đếm.
const R = String(now % 100000);
const W = `Công việc ${R}`, WF = `cong viec ${R}`, H = `Nhà ${R}`, G = `Gia đình ${R}`;
const chats = [
  { id: A, title: `Kế hoạch quý ${R}`, tags: [W], msgs: [{ role: "user", text: "Lập kế hoạch", time: A }, { role: "ai", text: "Đây là kế hoạch.", done: true, time: A + 1 }] },
  { id: Bc, title: `Công thức nấu ăn ${R}`, msgs: [{ role: "user", text: "Nấu phở", time: Bc }, { role: "ai", text: "Cách nấu phở.", done: true, time: Bc + 1 }] },
  { id: C, title: `Bài tập toán ${R}`, msgs: [{ role: "user", text: "Giải bài", time: C }, { role: "ai", text: "Lời giải.", done: true, time: C + 1 }] },
];
const LS = `JSON.parse(localStorage.getItem("u:${uid}:chats") || "[]")`;
const row = (title) => `[...document.querySelectorAll(".chat-wrap")].find((w) => w.querySelector(".ct-t")?.textContent === ${JSON.stringify(title)})`;
const menuBox = `(() => { const m = [...document.querySelectorAll(".menu")].find((x) => !x.classList.contains("out") && x.querySelector(".tag-pick")); if (!m) return null; const r = m.getBoundingClientRect(); const own = getComputedStyle(m).backgroundColor, pre = getComputedStyle(m, "::before").backgroundColor; const bg = own === "rgba(0, 0, 0, 0)" || own === "transparent" ? pre : own; return { l: r.left, r: r.right, t: r.top, b: r.bottom, bg }; })()`;
const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c ?? ""); const p = m ? m[1].split(",").map(Number) : []; return p.length === 4 ? p[3] : 1; };
const openPicker = async (title) => {
  await ev(`${row(title)}.querySelector(".dots").click()`);
  await until(`!!${row(title)}.querySelector(".menu:not(.out)")`, 3000);
  await ev(`[...${row(title)}.querySelectorAll(".menu-item")].find((b) => b.textContent.includes("Gắn thẻ") || b.textContent.includes("Add tags")).click()`);
  return until(`!!document.querySelector(".tag-pick input")`, 3000);
};
const typeTag = async (s) => { await ev(`document.querySelector(".tag-pick input").focus()`); await t.type(s); await t.key("Enter", "Enter", 13); await sleep(150); };
const tagsOf = async (id) => ev(`(${LS}.find((c) => c.id === ${id}) || {}).tags || []`);
// Trang lưu localStorage sau một nhịp: chờ tới khi thẻ đúng như mong đợi (tối đa 3 giây).
const tagsBe = async (id, want) => { for (let i = 0; i < 30; i++) { const v = await tagsOf(id); if (JSON.stringify(v) === JSON.stringify(want)) return v; await sleep(100); } return tagsOf(id); };

try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await t.size(1280, 860);
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector(".sidebar")`, 60000);
  await sleep(2000);
  await ev(`localStorage.setItem("u:${uid}:chats", ${JSON.stringify(JSON.stringify(chats))}); localStorage.setItem("theme", "light")`);
  await P("Page.navigate", { url: `${B}/?t=1#c=${A}` });
  await until(`!!${row(`Bài tập toán ${R}`)}`, 30000);

  console.log("━━ Máy tính");
  ok(await until(`document.querySelector(".tag-filter .tag-chip.on")?.textContent === "Tất cả" && [...document.querySelectorAll(".tag-filter .tag-chip")].some((b) => b.textContent === ${JSON.stringify(`#${W}1`)})`, 5000), "thanh bên có hàng lọc: Tất cả + #Công việc (1)", await ev(`[...document.querySelectorAll(".tag-filter .tag-chip")].map((b) => b.textContent)`));
  ok(await until(`[...document.querySelectorAll(".tb-tags .tag-chip.full")].map((b) => b.textContent).join() === ${JSON.stringify(`#${W}`)}`, 5000), "đầu trang chat có chip #Công việc", await ev(`document.querySelector(".tb-tags")?.textContent`));
  ok(await openPicker(`Công thức nấu ăn ${R}`), "menu ⋮ → Gắn thẻ mở khung chọn thẻ");
  const box = await ev(menuBox);
  ok(box && alpha(box.bg) >= 0.99, "khung Gắn thẻ nền đặc", box);
  ok(await ev(`[...document.querySelectorAll(".tag-pick .menu-item")].some((b) => b.textContent.includes(${JSON.stringify(W)}))`), "danh sách có thẻ đang dùng ở đoạn chat khác");
  await typeTag(`  #${H}  `);
  ok(JSON.stringify(await tagsBe(Bc, [H])) === JSON.stringify([H]), "gõ “#Nhà” + Enter: tạo thẻ Nhà (bỏ # và khoảng trắng)", await tagsOf(Bc));
  await typeTag(WF);
  ok(JSON.stringify(await tagsBe(Bc, [H, W])) === JSON.stringify([H, W]), "gõ “cong viec” (không dấu): gắn đúng thẻ Công việc đã có", await tagsOf(Bc));
  ok(await ev(`[...document.querySelectorAll(".tag-pick .menu-item[aria-checked=true]")].length === 2`), "hai thẻ có dấu chọn");
  await t.shot("tags-picker-light");
  // Bấm lại để bỏ thẻ Nhà
  await ev(`[...document.querySelectorAll(".tag-pick .menu-item")].find((b) => b.textContent.includes(${JSON.stringify(H)})).click()`);
  await sleep(150);
  ok(JSON.stringify(await tagsBe(Bc, [W])) === JSON.stringify([W]), "bấm thẻ đã chọn: bỏ thẻ", await tagsOf(Bc));
  await typeTag(H);
  await t.key("Escape", "Escape", 27);
  ok(await until(`!document.querySelector(".tag-pick")`, 2000), "Esc: quay lại menu");
  await t.click(700, 400);
  await sleep(300);

  console.log("Lọc theo thẻ");
  await ev(`[...document.querySelectorAll(".tag-filter .tag-chip")].find((b) => b.textContent.includes(${JSON.stringify(W)})).click()`);
  ok(await until(`!!document.querySelector(".tag-sec")`, 3000), "bấm #Công việc: thanh bên lọc theo thẻ");
  const listed = await ev(`[...document.querySelectorAll(".chat-scroll .ct-t")].map((x) => x.textContent)`);
  ok(listed.length === 2 && listed.includes(`Kế hoạch quý ${R}`) && listed.includes(`Công thức nấu ăn ${R}`), "chỉ còn 2 đoạn chat có thẻ", listed);
  ok(new RegExp(`${W} · 2`).test(await ev(`document.querySelector(".tag-sec").textContent`)), "tiêu đề mục: #Công việc · 2");
  await t.shot("tags-filter");
  await ev(`document.querySelector(".tag-sec .icon-btn").click()`);
  ok(await until(`!document.querySelector(".tag-sec") && !!${row(`Bài tập toán ${R}`)}`, 3000), "bỏ lọc: hiện lại tất cả");

  console.log("Chip ở đầu trang chat");
  await ev(`${row(`Công thức nấu ăn ${R}`)}.querySelector(".chat-item").click()`);
  ok(await until(`[...document.querySelectorAll(".tb-tags .tag-chip.full")].map((b) => b.textContent).join() === ${JSON.stringify(`#${W},#${H}`)}`, 5000), "đầu trang: #Công việc, #Nhà", await ev(`document.querySelector(".tb-tags")?.textContent`));
  await ev(`document.querySelector(".tb-tags .tag-chip.full").click()`);
  ok(await until(`(document.querySelector(".tag-sec")?.textContent || "").includes(${JSON.stringify(W)})`, 3000), "bấm chip ở đầu trang: lọc thanh bên theo thẻ đó");
  await ev(`document.querySelector(".tag-sec .icon-btn").click()`);
  // Menu tiêu đề cũng có Gắn thẻ
  await ev(`document.querySelector(".title-wrap .sel").click()`);
  await until(`!!document.querySelector(".title-wrap .menu:not(.out)")`, 2000);
  await ev(`[...document.querySelectorAll(".title-wrap .menu-item")].find((b) => b.textContent.includes("Gắn thẻ")).click()`);
  ok(await until(`!!document.querySelector(".title-wrap .tag-pick input")`, 2000), "menu tiêu đề → Gắn thẻ");
  await typeTag(G);
  ok(JSON.stringify(await tagsBe(Bc, [W, H, G])) === JSON.stringify([W, H, G]), "gắn thẻ từ menu tiêu đề", await tagsOf(Bc));
  await t.key("Escape", "Escape", 27); await t.click(700, 400); await sleep(200);

  console.log("Bảng lệnh ⌘K");
  await ev(`document.querySelector(".side-search").click()`);
  await until(`!!document.querySelector(".pal input")`, 3000);
  await t.type(`#${WF}`);
  await sleep(500);
  const pal = await ev(`[...document.querySelectorAll(".pal .s-row")].map((r) => r.textContent)`);
  ok(pal.some((x) => x.includes(`#${W}`) && x.includes("2 đoạn chat")), "nhóm Thẻ: #Công việc — 2 đoạn chat", pal);
  ok(pal.some((x) => x.includes(`Kế hoạch quý ${R}`)) && pal.some((x) => x.includes(`Công thức nấu ăn ${R}`)) && !pal.some((x) => x.includes(`Bài tập toán ${R}`)), "gõ #cong tìm được đoạn chat mang thẻ", pal);
  await t.key("Enter", "Enter", 13);
  ok(await until(`(document.querySelector(".tag-sec")?.textContent || "").includes(${JSON.stringify(W)})`, 3000), "Enter trên dòng thẻ: lọc thanh bên");
  await ev(`document.querySelector(".tag-sec .icon-btn")?.click()`);

  console.log("Máy chủ");
  const synced = await (async () => { for (let i = 0; i < 40; i++) { const j = await (await fetch(`${B}/api/chats?keys=chat:${Bc}`, { headers: { cookie } })).json(); const d = j.items?.[0]?.data; if (d && JSON.parse(d).tags?.includes(G)) return JSON.parse(d).tags; await sleep(500); } return null; })();
  ok(synced && synced.includes(W) && synced.includes(H), "thẻ lên máy chủ cùng đoạn chat (thiết bị khác thấy)", synced);

  console.log("━━ Điện thoại 375px, giao diện tối");
  await t.size(375, 760, true);
  await t.theme("dark");
  await P("Page.navigate", { url: `${B}/?t=2#c=${Bc}` });
  await until(`!!document.querySelector(".tb-tags .tag-chip")`, 30000);
  const vis = await ev(`[...document.querySelectorAll(".tb-tags .tag-chip")].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, r: r.right }; })`);
  ok(vis.length === 1 && vis[0].t === "3" && vis[0].r <= 375, "đầu trang hẹp: một chip gọn (biểu tượng thẻ + 3), không tràn", vis);
  await ev(`document.querySelector(".tb-tags .tag-chip.compact").click()`);
  ok(await until(`!!document.querySelector(".title-wrap .tag-pick input")`, 3000), "bấm chip gọn: mở khung Gắn thẻ ở menu tiêu đề");
  const tb = await ev(`(() => { const r = document.querySelector(".title-wrap .menu:not(.out)").getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; })()`);
  ok(tb.l >= 0 && tb.r <= 375 && tb.b <= 760, "khung nằm trọn màn hình", tb);
  await t.shot("tags-title-picker-375-dark");
  await t.key("Escape", "Escape", 27); await t.click(200, 400); await sleep(300);
  ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), "không cuộn ngang trang");
  await t.shot("tags-header-375-dark");
  await ev(`document.querySelector(".side-toggle, [aria-label='Mở thanh bên'], .topbar .left button")?.click()`);
  await until(`getComputedStyle(document.querySelector(".sidebar")).visibility !== "hidden" && document.querySelector(".sidebar").getBoundingClientRect().right > 100`, 3000);
  await sleep(400);
  ok(await openPicker(`Công thức nấu ăn ${R}`), "điện thoại: mở Gắn thẻ");
  await sleep(300);
  const mb = await ev(menuBox);
  ok(mb && mb.l >= 0 && mb.r <= 375 && mb.t >= 0 && mb.b <= 760, "khung Gắn thẻ nằm trọn màn hình 375px", mb);
  ok(mb && alpha(mb.bg) >= 0.99, "nền đặc ở giao diện tối", mb);
  await t.shot("tags-picker-375-dark");
  ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), "không cuộn ngang khi mở menu");
  ok(!t.logs.length, "không có lỗi JavaScript", t.logs);
} finally {
  t.close();
  await u.remove();
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
