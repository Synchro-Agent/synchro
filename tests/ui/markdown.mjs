// Câu trả lời hiện đúng Markdown trong Chrome ẩn, trên trang chia sẻ (dùng chung thành phần với khung chat): số thứ tự, danh sách lồng,
// nhấn chữ, link, ảnh, bảng, công thức, khối code, nút theo ngôn ngữ, chuỗi dài không tràn, ở cả hai giao diện. Chạy tay: BASE=http://localhost:3200 node tests/ui/markdown.mjs
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";

const B = process.env.BASE ?? "http://localhost:3200", H = { "content-type": "application/json", origin: B };
const PROF = tmpdir() + "/synchro-ui/chrome-prof-md", PORT = 9347;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(B + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
const cookie = (login.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (!cookie) throw new Error("login failed");

const TEXT = [
  "## Các bước", "", "1. Bước **một**", "- chi tiết một", "2. Bước hai", "- chi tiết hai", "3. Bước ba", "",
  "Đoạn chen giữa.", "", "4. Bước bốn", "   ```bash", "   npm i", "   ```", "5. Bước năm", "",
  "- Cha", "  - Con", "    - Cháu", "- Cha hai", "", "- [x] Đã xong *nghiêng*", "- [ ] Chưa", "",
  "*nghiêng một* _nghiêng hai_ ***cả hai*** ~~gạch~~ **đậm *lồng* đậm** snake_case_name 2*3*4", "",
  "Xem https://example.com/a_b. và <https://example.org> và [chữ](https://example.net).", "",
  "Dòng một<br>Dòng hai", "Dòng ba", "", "![con mèo](https://example.com/meo.png)", "",
  "| Cột | Giá |", "|:---|--:|", "| *a*<br>b | 12.500 |", "| `c` | 9 |", "",
  "Công thức $E = mc^2$ và \\(a^2+b^2\\), giá $5 đến $10.", "", "$$", "\\sum_{i=1}^n i", "$$", "",
  "> Trích **dẫn**", "> - mục", "", "Câu có chú thích[^1].", "", "[^1]: Nguồn.", "",
  "```js", "const a = \"**không đậm**\";", "```", "",
  "Kính gửi \\[Tên khách hàng\\], phép nhân 5*x; x*5.", "", "- đầu", "- cuối", "Câu sau danh sách.", "",
  "```", "src/", "├── a/" + "x".repeat(300), "└── b", "```", "",
  "| Trạng thái | Mô tả | Ghi chú |", "|---|---|---|", `| Hoàn thành | ${"Mô tả dài của bước này. ".repeat(12)} | ${"Ghi chú dài của bước này. ".repeat(12)} |`, "",
  `| ${Array.from({ length: 8 }, (_, k) => `Cột${k}Tênrấtdàikhôngngắtđược`).join(" | ")} |`, `|${"---|".repeat(8)}`, `| ${Array.from({ length: 8 }, (_, k) => `giá_trị_dài_liền_nhau_${k}`).join(" | ")} |`, "",
  "A".repeat(600), "", "Hết. " + "https://example.com/" + "b".repeat(400),
].join("\n");
const sh = await fetch(B + "/api/share", { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ conv: `md-${Date.now()}`, title: "Markdown", msgs: [{ role: "user", text: "U".repeat(600) }, { role: "ai", text: TEXT }] }) }).then((r) => r.json());
const token = sh?.share?.token;
if (!token) throw new Error("không tạo được bản chia sẻ");

rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), reqs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
  if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
});
const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S);
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } return false; };

try {
  await P("Page.enable"); await P("Runtime.enable"); await P("Network.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [theme, lang] of [["dark", "vi"], ["light", "en"]]) {
    console.log(`\n━━ ${theme} / ${lang}`);
    reqs.length = 0;
    await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", "${theme}"); localStorage.setItem("p:uilang", '"${lang}"'); } catch {}` });
    await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await P("Page.navigate", { url: `${B}/share/${token}` });
    ok(await until(`document.querySelectorAll(".katex .katex-html").length === 3`), "trang hiện, công thức đã vẽ");
    if (process.env.SHOT) { const { data } = await P("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); (await import("node:fs")).writeFileSync(`${process.env.SHOT}/md-${theme}.png`, Buffer.from(data, "base64")); }
    const r = JSON.parse(await ev(`JSON.stringify((() => {
      const q = (s) => [...document.querySelectorAll(s)];
      const root = q(".codeblock")[0]?.closest("div").parentElement ?? document.body;
      const top = q("ol").filter((o) => !o.parentElement.closest("li"));
      const code = q(".codeblock");
      return {
        ols: top.map((o) => [o.getAttribute("start"), o.children.length]),
        nested: q("ol > li > ul").length,
        deep: q("li ul li ul").length,
        li: q("li").map((l) => l.firstChild?.textContent?.slice(0, 12)),
        task: q("li.task").length, on: q("li.task .tick.on").length,
        em: q("em").map((e) => e.textContent), del: q("del").map((e) => e.textContent), strong: q("strong").map((e) => e.textContent),
        links: q("a[href^='http']").map((a) => a.getAttribute("href")),
        raw: (() => { const c = document.body.cloneNode(true); c.querySelectorAll("pre").forEach((e) => e.remove()); document.body.append(c); const v = c.innerText; c.remove(); return v; })().match(/\\*\\*|~~|<br>|\\[\\^1\\]|\\\\\\(/g),
        snake: document.body.innerText.includes("snake_case_name 2*3*4"),
        br: q("p br").length + q("td br").length,
        imgLink: q(".md-img-link").map((a) => a.getAttribute("href")), imgs: q("main img, .md-img").length,
        align: q("td").map((t) => t.style.textAlign),
        tdEm: q("td em").length,
        money: document.body.innerText.includes("$5 đến $10"),
        katex: q(".katex").length, display: q(".md-math .katex-display").length,
        quote: q("blockquote strong").length + q("blockquote li").length,
        fn: q(".md-fnref").length, fns: q(".md-fns").length,
        codes: code.map((c) => c.querySelector("pre").textContent),
        copy: code[0]?.querySelector("button")?.textContent, sortTip: q(".md-th")[0]?.title,
        bracket: document.body.innerText.includes("Kính gửi [Tên khách hàng], phép nhân 5*x; x*5."),
        after: q("p").some((e) => e.textContent === "Câu sau danh sách.") && !q("li").some((e) => e.textContent.includes("Câu sau danh sách")),
        tree: (() => { const p = code[2]?.querySelector("pre"); return p ? { wrap: p.classList.contains("cb-wrap"), ws: getComputedStyle(p).whiteSpace, over: p.scrollWidth > p.clientWidth } : null; })(),
        tbl: q(".md-tbl").map((t) => [t.scrollWidth, t.clientWidth]),
        tight: (() => { const td = q(".md-tbl")[1]?.querySelector("td"); if (!td) return null; const r = document.createRange(), n = td.firstChild, i = n.nodeValue.indexOf("thành"); r.setStart(n, i); r.setEnd(n, i + 5); return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size; })(),
        scroll: [document.documentElement.scrollWidth, innerWidth],
        over: q(".user-msg, .ai-msg, .sh-msg, p").filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName),
      };
    })())`));
    ok(JSON.stringify(r.ols) === '[[null,3],["4",2]]', "số thứ tự chạy tiếp: 1 2 3 rồi 4 5", r.ols);
    ok(r.nested === 2 && r.deep === 1, "chi tiết nằm dưới từng bước; ba cấp lồng", [r.nested, r.deep]);
    ok(r.task === 2 && r.on === 1, "checklist", [r.task, r.on]);
    ok(["nghiêng một", "nghiêng hai", "cả hai", "lồng"].every((x) => r.em.includes(x)), "chữ nghiêng", r.em);
    ok(r.del.includes("gạch") && r.strong.includes("đậm lồng đậm"), "gạch ngang, đậm lồng nghiêng", [r.del, r.strong]);
    ok(!r.raw && r.snake, "không lộ ký hiệu; snake_case và phép nhân giữ nguyên", r.raw);
    ok(["https://example.com/a_b", "https://example.org", "https://example.net"].every((x) => r.links.includes(x)), "link trần, <link>, [chữ](link)", r.links);
    ok(r.br >= 3, "<br>, xuống dòng trong đoạn, <br> trong ô bảng", r.br);
    ok(r.imgLink[0] === "https://example.com/meo.png" && !reqs.some((u) => u.includes("meo.png")), "ảnh ngoài là link, trình duyệt không tự tải", [r.imgLink, reqs.filter((u) => u.includes("meo"))]);
    ok(r.align.includes("right") && r.tdEm === 1, "căn cột, nhấn chữ trong ô", r.align);
    ok(r.katex === 3 && r.display === 1 && r.money, "công thức nội dòng, khối; giá tiền không thành công thức", [r.katex, r.display, r.money]);
    ok(r.quote === 2 && r.fn === 1 && r.fns === 1, "trích dẫn có danh sách; chú thích", [r.quote, r.fn, r.fns]);
    ok(r.codes.length === 3 && r.codes[0].trim() === "npm i" && r.codes[1].includes("**không đậm**"), "khối code giữ nguyên", r.codes);
    ok(r.bracket, "ngoặc thoát và phép nhân viết thẳng giữ nguyên chữ");
    ok(r.after, "câu sau danh sách là đoạn riêng");
    ok(r.tree && !r.tree.wrap && r.tree.ws === "pre" && r.tree.over, "khối không nhãn giữ hàng, cuộn ngang", r.tree);
    ok(r.tight === 1 && r.tbl[1][0] <= r.tbl[1][1] + 1, "bảng cột ngắn cột dài: chữ không vỡ giữa từ", [r.tight, r.tbl]);
    ok(r.tbl[2]?.[0] > r.tbl[2]?.[1] + 50, "bảng rộng cuộn ngang được", r.tbl);
    ok(lang === "en" ? r.copy.includes("Copy") && r.sortTip === "Click to sort" : r.copy.includes("Sao chép") && r.sortTip === "Bấm để sắp xếp", "nút trên khối code và bảng theo ngôn ngữ", [r.copy, r.sortTip]);
    ok(r.scroll[0] <= r.scroll[1] && !r.over.length, "chuỗi dài không tràn", [r.scroll, r.over]);
  }
} finally { chrome.kill(); }
console.log(`\n${pass} đúng, ${fail} sai`);
if (fail) process.exit(1);
process.exit(0);
