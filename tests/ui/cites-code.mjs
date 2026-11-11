// Nguồn trích dẫn và tô màu code trong Chrome ẩn (npm run dev:mock):
// - chip nguồn có favicon (tải qua /api/favicon, không gọi thẳng trang lạ), số thứ tự, tiêu đề; trang không có icon hiện chữ cái đầu;
// - số [n] trong câu trả lời: rê chuột / Tab hiện thẻ tiêu đề + tên miền nền đặc, nằm trọn trong màn hình (cả ở 375px); bấm thì cuộn tới chip;
// - khối code đã đóng được tô màu (Shiki), màu đổi theo giao diện sáng / tối; trang không có khối code thì không tải Shiki.
// Chạy tay: BASE=http://localhost:3500 SHOTS=/tmp/x node tests/ui/cites-code.mjs
import { login, openChrome, sleep } from "../lib/cdp.mjs";

const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };

const { cookie, uid } = await login(B);
const t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9361), name: "cites", shots: process.env.SHOTS });
const { P, ev, until } = t;
const now = Date.now();
const webs = [
  { title: "Giá xăng hôm nay tăng mạnh theo thị trường thế giới — báo cáo chi tiết", url: "https://vnexpress.net/gia-xang" },
  { title: "Lãi suất", url: "https://www.sbv.gov.vn/lai-suat" },
  { title: "", url: "https://noicon.vn/x" },
];
const text = "Giá xăng tăng 5%[1] trong khi lãi suất giữ nguyên[2][3]. Mảng a[9] không phải trích dẫn.\n\n```ts\nconst giá: number = 5; // ghi chú\nfunction f(x: string) { return x.length }\n```\n\n```khongbiet\nchữ thường\n```";
const chats = [
  { id: now, title: "Có nguồn", msgs: [{ role: "user", text: "Tin #web", time: now }, { role: "ai", text, done: true, time: now + 1, webs }] },
  { id: now + 5, title: "Không có code", msgs: [{ role: "user", text: "Chào", time: now + 5 }, { role: "ai", text: "Chào bạn, không có khối code nào ở đây.", done: true, time: now + 6 }] },
];
try {
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector(".sidebar")`, 60000);
  // Chờ lần lưu định kỳ của trang mới mở xong, không thì nó ghi đè đoạn chat dựng sẵn.
  await sleep(2000);
  await ev(`localStorage.setItem("u:${uid}:chats", ${JSON.stringify(JSON.stringify(chats))}); localStorage.setItem("theme", "light")`);
  for (const [w, h, label] of [[1280, 860, "máy tính"], [375, 760, "điện thoại 375px"]]) {
    console.log(`\n━━ ${label}`);
    await t.size(w, h, w < 500);
    t.reqs.length = 0;
    // Mở đoạn chat không có code trước: Shiki không được tải.
    await P("Page.navigate", { url: `${B}/?o=0#c=${now + 5}` });
    await until(`document.body.innerText.includes("không có khối code")`, 60000);
    await sleep(1500);
    ok(!t.reqs.some((u) => /shiki|engine-javascript|langs/i.test(u)), "đoạn chat không có khối code: không tải Shiki", t.reqs.filter((u) => /shiki/i.test(u)));
    await P("Page.navigate", { url: `${B}/?o=1#c=${now}` });
    ok(await until(`document.querySelectorAll(".msg-sources .src-chip").length === 3`, 15000), "3 chip nguồn");
    ok(await until(`[...document.querySelectorAll(".src-chip img.src-fav")].filter((i) => i.complete && i.naturalWidth > 0).length === 2`, 15000), "favicon của 2 trang tải qua /api/favicon", await ev(`[...document.querySelectorAll(".src-chip img")].map((i) => i.src + ":" + i.naturalWidth)`));
    ok(await until(`document.querySelectorAll(".src-chip .src-fav-l").length === 1`, 8000), "trang không có icon: chữ cái đầu");
    ok(!t.reqs.some((u) => /vnexpress\.net|sbv\.gov\.vn|duckduckgo|google\.com\/s2/.test(u) && !u.startsWith(B)), "trình duyệt không gọi thẳng trang nguồn hay dịch vụ favicon bên thứ ba");
    const chips = await ev(`[...document.querySelectorAll(".src-chip")].map((a) => ({ n: a.querySelector(".src-n")?.textContent, t: a.querySelector(".src-t")?.textContent, w: a.getBoundingClientRect().width, r: a.getBoundingClientRect().right }))`);
    ok(chips.map((c) => c.n).join() === "1,2,3" && chips[2].t === "noicon.vn" && chips.every((c) => c.r <= w), "số thứ tự, tiêu đề (không có thì tên miền), không tràn ngang", chips);
    const cites = await ev(`[...document.querySelectorAll(".ai-msg a.cite")].map((a) => a.textContent)`);
    ok(cites.join() === "1,2,3", "số [1] [2] [3] thành nút trích dẫn; [9] (không có nguồn 9) giữ nguyên chữ", cites);
    ok(await ev(`document.querySelector(".ai-msg").innerText.includes("a[9]")`), "[9] vẫn là chữ thường");
    // Rê chuột vào [1]
    const r1 = await ev(`(() => { const a = document.querySelector(".ai-msg a.cite"); a.scrollIntoView({ block: "center" }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.hover(r1.x, r1.y);
    ok(await until(`!!document.querySelector(".cite-pop")`, 3000), "rê chuột: thẻ nguồn hiện");
    await sleep(250);
    const pop = await ev(`(() => { const p = document.querySelector(".cite-pop"); const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return { txt: p.innerText, l: r.left, r: r.right, t: r.top, b: r.bottom, bg: cs.backgroundColor, img: !!p.querySelector("img") }; })()`);
    const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m ? m[1].split(",").map(Number) : []; return p.length === 4 ? p[3] : 1; };
    ok(pop.txt.includes("Giá xăng hôm nay") && pop.txt.includes("vnexpress.net") && pop.img, "thẻ có tiêu đề + tên miền + favicon", pop);
    ok(pop.l >= 0 && pop.r <= w && pop.t >= 0 && pop.b <= h, "thẻ nằm trọn trong màn hình", pop);
    ok(alpha(pop.bg) === 1, "nền thẻ đặc (không trong suốt)", pop.bg);
    await t.shot(`cite-pop-${w}`);
    await t.hover(5, 5);
    ok(await until(`!document.querySelector(".cite-pop")`, 3000), "rời chuột: thẻ ẩn");
    // Bàn phím: focus vào số [2] → thẻ hiện; Enter/bấm → chip 2 được làm nổi.
    await ev(`document.querySelectorAll(".ai-msg a.cite")[1].focus()`);
    ok(await until(`document.querySelector(".cite-pop")?.innerText.includes("sbv.gov.vn")`, 3000), "Tab tới [2]: thẻ hiện tiêu đề + tên miền nguồn 2");
    await ev(`document.querySelectorAll(".ai-msg a.cite")[1].click()`);
    ok(await until(`document.activeElement?.id?.endsWith("-2") && document.activeElement.classList.contains("flash")`, 3000), "bấm [2]: tới chip 2 và làm nổi chip");
    // Shiki
    ok(await until(`document.querySelectorAll(".codeblock pre.shiki span").length > 5`, 20000), "khối ```ts đã đóng được tô màu (Shiki)");
    const col = async () => ev(`(() => { const s = [...document.querySelectorAll(".codeblock pre.shiki span")]; const kw = s.find((x) => x.textContent.trim() === "const") ?? s[0]; return { kw: getComputedStyle(kw).color, txt: getComputedStyle(document.querySelector(".codeblock pre.shiki")).color, n: new Set(s.map((x) => getComputedStyle(x).color)).size }; })()`);
    const light = await col();
    ok(light.n >= 3 && light.kw !== light.txt, "nhiều màu, từ khóa khác màu chữ thường", light);
    ok(await ev(`[...document.querySelectorAll(".codeblock pre")].some((p) => !p.classList.contains("shiki") && p.textContent.includes("chữ thường"))`), "ngôn ngữ lạ: giữ chữ đơn sắc");
    ok(await ev(`document.querySelector(".codeblock pre.shiki").textContent === "const giá: number = 5; // ghi chú\\nfunction f(x: string) { return x.length }"`), "nội dung code giữ nguyên (sao chép đúng)");
    await t.shot(`code-light-${w}`);
    await t.theme("dark");
    await sleep(300);
    const dark = await col();
    ok(dark.kw !== light.kw, "giao diện tối: màu đổi theo", { light, dark });
    await t.shot(`code-dark-${w}`);
    const pw = await ev(`document.documentElement.scrollWidth <= innerWidth`);
    ok(pw, "không cuộn ngang trang");
    await t.theme("light");
  }
  ok(!t.logs.length, "không có lỗi JavaScript", t.logs);
} finally {
  t.close();
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
