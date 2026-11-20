// Chụp một mẫu thiết kế tham chiếu cho catalog/design-refs: Chrome trên máy (CDP), ẩn logo / hộp cookie, đo token bằng
// TOKEN_PROBE, nén WebP 60-90 KB. Ảnh chỉ để model nhìn nguyên tắc; trường chấm bằng mắt (tên, vì sao, tâm trạng…)
// do người duyệt điền sau khi xem ảnh, công cụ không tự đoán.
//
// node tools/design-refs/capture.mjs --id web-001 --domain web --url https://…          trang công khai
//   --image-url https://…        ảnh công khai (poster, ảnh slide)
//   --pdf-url https://… --page 3  một trang PDF, dựng bằng pdf.js trong Chrome
//   --pdf-url https://… --pages 1,4,6,9 --grid   bốn trang của một bộ slide ghép 2×2 (thấy nhịp cả bộ)
//   --image-page https://…       trang trưng bày một ảnh: lấy ảnh lớn nhất (--image-selector để chọn)
//   --grid u1 u2 u3 u4           bốn ảnh ghép 2×2 (page:https://… là ảnh lớn nhất của trang đó)
//   --grid-page https://… [--slide-match chuỗi]  trang mẫu trình chiếu: ghép 4 ảnh slide rải đều trong bộ
//   --source-url https://…       trang công bố mẫu, khi ảnh nằm ở máy chủ khác
//   --retoken all|id1,id2        đo lại token từ kết quả đo đã lưu, giữ trường đã chấm
//   --width 700 --selector main --wait 4000 --scroll 0 --no-hide  tuỳ chọn cho trang khó
//   --mask "x,y,w,h;…"           làm nhoè logo / chữ thương hiệu còn sót (tỉ lệ 0-1 của ảnh)
//   --scheme dark                 chụp giao diện tối của trang (prefers-color-scheme)
//   --frame 1 [--selector iframe]  đo và chụp nội dung iframe lớn nhất (email trong trang trưng bày)
//   --batch tools/design-refs/sources.json --only web-001,web-002 --jobs 3   chụp theo danh sách nguồn
// Thư mục làm việc (ảnh PNG gốc, kết quả đo): --work hoặc REF_WORK, mặc định thư mục tạm của máy.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../../tests/lib/ts.mjs";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const sharp = require("sharp");
const mods = await loadTs(["shared/designextract", "shared/designrefs"]);
const X = mods["shared/designextract"];
const D = mods["shared/designrefs"];

const CATALOG = path.join(ROOT, "catalog/design-refs");
const UA_TOKEN = "SynchroRefCapture/1.0";
const VIEW = { width: 1280, height: 800 };
const HOST_GAP_MS = 10_000;
const AI_AGENTS = ["claudebot", "claude-web", "claude-user", "anthropic-ai", "gptbot", "ccbot", "google-extended"];
const LICENCE = "Ảnh chụp thu nhỏ của trang công khai, chỉ để model tham khảo nguyên tắc. "
  + "Không chép logo, chữ, ảnh hay phông độc quyền của trang.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { grid: [], jobs: 2 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--grid") {
      a.gridMode = true;
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) a.grid.push(next());
    } else if (k === "--no-hide") a.noHide = true;
    else if (k === "--force") a.force = true;
    else if (k.startsWith("--")) a[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = next();
  }
  return a;
}

// robots.txt: nhóm của "*" hoặc của chính bộ chụp; luật dài nhất thắng, Allow thắng khi dài bằng nhau.
const robotsMemo = new Map();
async function robotsFor(url) {
  const u = new URL(url);
  if (robotsMemo.has(u.origin)) return robotsMemo.get(u.origin);
  let text = "";
  try {
    const r = await fetch(u.origin + "/robots.txt", { headers: { "user-agent": UA_TOKEN }, redirect: "follow" });
    text = r.ok ? await r.text() : "";
  } catch (e) {
    // Không đọc được robots.txt (máy chủ chặn, hết giờ): coi như không có luật, ghi lại để người duyệt biết.
    console.warn(`  robots.txt ${u.origin}: ${e.cause?.code ?? e.message}`);
  }
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
  }
  const mine = groups.filter((g) => g.agents.some((x) => x && UA_TOKEN.toLowerCase().startsWith(x)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  // Trang đã chặn các bộ thu thập cho AI ở mọi đường dẫn thì cũng không lấy làm mẫu, dù bộ chụp này không bị nêu tên.
  const aiOptOut = groups.some((g) => g.agents.some((x) => AI_AGENTS.includes(x))
    && g.rules.some((r) => !r.allow && r.path === "/"));
  const res = { text: !!text, rules, aiOptOut };
  robotsMemo.set(u.origin, res);
  return res;
}
function pathMatches(rulePath, p) {
  if (!rulePath) return false;
  const body = rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
  const re = new RegExp("^" + body);
  return re.test(p);
}
export async function robotsStatus(url) {
  const r = await robotsFor(url);
  if (!r.text) return "none";
  if (r.aiOptOut) return "ai-optout";
  const u = new URL(url);
  const p = u.pathname + u.search;
  let best = null;
  for (const rule of r.rules) {
    if (!pathMatches(rule.path, p)) continue;
    const longer = !best || rule.path.length > best.path.length;
    if (longer || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow ? "allowed" : "disallowed";
}

// Mỗi máy chủ cách nhau ít nhất 10 giây giữa hai lần mở trang, kể cả khi chạy song song.
const hostNext = new Map();
async function politeWait(url) {
  const host = new URL(url).host;
  const at = hostNext.get(host) ?? 0;
  const now = Date.now();
  hostNext.set(host, Math.max(now, at) + HOST_GAP_MS);
  if (at > now) await sleep(at - now);
}

async function openBrowser() {
  const port = 9500 + (process.pid % 400);
  const prof = path.join(tmpdir(), `synchro-refcap-${port}`);
  rmSync(prof, { recursive: true, force: true });
  const bin = process.env.CHROME_PATH ?? (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
  const args = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--lang=vi-VN,en-US",
    // Trang có cảnh WebGL (3D, shader) chỉ hiện khi Chrome ẩn có GPU phần mềm.
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const proc = spawn(bin, args, { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 80 && !ver; i++) {
    await sleep(200);
    // Cổng gỡ lỗi chưa mở khi Chrome đang khởi động: lỗi kết nối là bình thường, thử lại sau 200 ms.
    ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!ver) {
    proc.kill();
    throw new Error("Chrome không mở được");
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const waits = new Map();
  const hooks = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) {
      const [ok, bad] = waits.get(m.id);
      waits.delete(m.id);
      if (m.error) bad(new Error(JSON.stringify(m.error)));
      else ok(m.result);
      return;
    }
    for (const h of hooks) h(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
    const id = ++seq;
    waits.set(id, [ok, bad]);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const uaBase = ver["User-Agent"].replace("HeadlessChrome", "Chrome");
  async function tab(width = VIEW.width, height = VIEW.height) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const P = (m, p) => send(m, p, sessionId);
    await P("Page.enable");
    await P("Runtime.enable");
    await P("Network.enable");
    const acceptLanguage = "vi-VN,vi;q=0.9,en;q=0.8";
    await P("Network.setUserAgentOverride", { userAgent: `${uaBase} ${UA_TOKEN}`, acceptLanguage });
    await P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const ev = async (expr, timeout = 30_000, contextId = undefined) => {
      const r = await Promise.race([
        P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, contextId }),
        sleep(timeout).then(() => ({ exceptionDetails: { text: "evaluate timeout" } })),
      ]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const loaded = () => new Promise((ok) => {
      const h = (m) => {
        if (m.sessionId === sessionId && m.method === "Page.loadEventFired") {
          hooks.splice(hooks.indexOf(h), 1);
          ok(true);
        }
      };
      hooks.push(h);
    });
    const go = async (url, ms = 35_000) => {
      const wait = loaded();
      await P("Page.navigate", { url });
      await Promise.race([wait, sleep(ms)]);
    };
    // Thẻ đã tự đóng (trang lỗi, Chrome thoát) thì không còn gì để đóng; bỏ qua để dọn các thẻ khác.
    const close = () => send("Target.closeTarget", { targetId }).catch(() => {});
    return { P, ev, go, close };
  }
  const quit = () => {
    try {
      ws.close();
    } catch (e) {
      // Cửa sổ đã đóng thì không còn gì để dọn.
      console.warn(`  đóng CDP: ${e.message}`);
    }
    proc.kill();
  };
  return { tab, quit };
}

// pdf.js chạy trong Chrome qua một máy chủ cục bộ ngắn hạn: PDF tải về được phục vụ cùng nguồn với thư viện.
let pdfServer = null;
const pdfFiles = new Map();
async function pdfHost() {
  if (pdfServer) return pdfServer;
  const dist = path.join(ROOT, "node_modules/pdfjs-dist");
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>pdf</title>");
      return;
    }
    if (u.pathname.startsWith("/doc/")) {
      const buf = pdfFiles.get(u.pathname.slice(5));
      res.writeHead(buf ? 200 : 404, { "content-type": "application/pdf" });
      res.end(buf ?? "");
      return;
    }
    const file = path.join(dist, path.normalize(u.pathname).replace(/^\/+/, ""));
    if (!file.startsWith(dist) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(readFileSync(file));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  pdfServer = { base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
  return pdfServer;
}
async function fetchBytes(url) {
  await politeWait(url);
  const r = await fetch(url, { headers: { "user-agent": UA_TOKEN }, redirect: "follow" });
  if (!r.ok) throw new Error(`tải ${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function renderPdfPages(browser, url, pages, width) {
  const host = await pdfHost();
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  pdfFiles.set(key, await fetchBytes(url));
  const t = await browser.tab(width, 800);
  try {
    await t.go(`${host.base}/`);
    const out = [];
    for (const n of pages) {
      const script = `(async () => {
        const lib = await import("${host.base}/legacy/build/pdf.mjs");
        lib.GlobalWorkerOptions.workerSrc = "${host.base}/legacy/build/pdf.worker.mjs";
        const doc = await lib.getDocument({ url: "${host.base}/doc/${key}",
          standardFontDataUrl: "${host.base}/standard_fonts/", cMapUrl: "${host.base}/cmaps/",
          cMapPacked: true }).promise;
        const page = await doc.getPage(${n});
        const v1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: ${width} / v1.width });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        return c.toDataURL("image/png");
      })()`;
      const data = await t.ev(script, 90_000);
      out.push(Buffer.from(data.split(",")[1], "base64"));
    }
    return out;
  } finally {
    pdfFiles.delete(key);
    await t.close();
  }
}

async function largestFrame(t) {
  const { frameTree } = await t.P("Page.getFrameTree");
  let best = null;
  for (const f of frameTree.childFrames ?? []) {
    const { executionContextId } = await t.P("Page.createIsolatedWorld", { frameId: f.frame.id, worldName: "refcap" });
    // Khung quảng cáo khác nguồn hoặc đã bị gỡ thì không đo được: coi như khung trống, không chọn.
    const area = await t.ev("innerWidth * Math.min(document.body ? document.body.scrollHeight : 0, 4000)", 10_000,
      executionContextId).catch(() => 0);
    if (!best || area > best.area) best = { area, executionContextId };
  }
  if (!best?.area) throw new Error("không thấy iframe có nội dung");
  return best.executionContextId;
}

async function capturePage(browser, a) {
  const width = Number(a.width ?? VIEW.width);
  const t = await browser.tab(width, VIEW.height);
  try {
    const scheme = [{ name: "prefers-color-scheme", value: a.scheme }];
    if (a.scheme) await t.P("Emulation.setEmulatedMedia", { features: scheme });
    await politeWait(a.url);
    await t.go(a.url);
    await sleep(Number(a.wait ?? 2500));
    // Cuộn một lượt để ảnh tải lười hiện ra, rồi về đầu trang trước khi đo và chụp.
    const scrolls = Number(a.scroll ?? 3);
    for (let i = 1; i <= scrolls; i++) {
      await t.ev(`window.scrollTo(0, ${i * VIEW.height})`);
      await sleep(500);
    }
    await t.ev("window.scrollTo(0, 0)");
    const hidden = a.noHide ? 0 : await t.ev(`(${X.HIDE_MARKS})()`, 60_000);
    // fonts.ready có trang không bao giờ xong (phông tải lười): chờ tối đa 6 giây.
    await t.ev("Promise.race([document.fonts ? document.fonts.ready : 0, new Promise((r) => setTimeout(r, 6000))])");
    await sleep(2500);
    // Email trong trang trưng bày nằm trong iframe: đo trong chính khung đó (thế giới riêng của frame lớn nhất).
    const ctx = a.frame ? await largestFrame(t) : undefined;
    if (ctx && !a.noHide) await t.ev(`(${X.HIDE_MARKS})()`, 30_000, ctx);
    const root = a.selector && !a.frame ? `document.querySelector(${JSON.stringify(a.selector)})` : "document.body";
    const probe = await t.ev(`(${X.TOKEN_PROBE})(${root})`, 90_000, ctx);
    if (!probe) throw new Error("TOKEN_PROBE không đo được trang");
    // Khung lớn nhất trên trang được kéo cao bằng nội dung email (tối đa 1600 px) để ảnh chụp thấy cả thư.
    const frameEl = a.selector
      ? `document.querySelector(${JSON.stringify(a.selector)})`
      : `[...document.querySelectorAll("iframe")].sort((x, y) => y.clientWidth * y.clientHeight
        - x.clientWidth * x.clientHeight)[0]`;
    const frameH = Math.min(probe.scrollH, 1600);
    if (a.frame) await t.ev(`${frameEl}.style.setProperty("height", "${frameH}px", "important")`);
    if (a.frame) await sleep(800);
    const boxOf = a.frame ? frameEl : root;
    const rect = a.selector || a.frame
      ? await t.ev(`(() => {
        const r = ${boxOf}.getBoundingClientRect();
        return [r.x, r.y + scrollY, r.width, r.height];
      })()`)
      : [0, 0, width, probe.scrollH];
    const clip = { x: rect[0], y: rect[1], width: Math.min(rect[2], 1280), height: Math.min(rect[3], 1600), scale: 1 };
    const shot = await t.P("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    return { png: Buffer.from(shot.data, "base64"), probe, hidden, title: await t.ev("document.title") };
  } finally {
    await t.close();
  }
}

// Trang trưng bày một ảnh (poster trong kho lưu trữ, ảnh slide): lấy ảnh lớn nhất trên trang ở độ phân giải gốc.
async function largestImage(browser, page, selector = "img") {
  const t = await browser.tab();
  try {
    await politeWait(page);
    await t.go(page);
    await sleep(3000);
    const src = await t.ev(`(() => {
      const imgs = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .map((i) => ({ i, r: i.getBoundingClientRect() }))
        .filter((x) => x.i.currentSrc || x.i.src)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
      return imgs[0] ? imgs[0].i.currentSrc || imgs[0].i.src : null;
    })()`);
    if (!src) throw new Error(`không thấy ảnh trên ${page}`);
    return src;
  } finally {
    await t.close();
  }
}
// Trang mẫu trình chiếu: bốn ảnh slide khung ngang (tỉ lệ 1.6-1.9, rộng từ 400 px) rải trong nửa đầu bộ (bìa và
// ba trang nội dung) để thấy nhịp cả bộ. Trang thường kèm ảnh của mẫu khác bên dưới: chỉ giữ ảnh cùng tên tệp với ảnh
// đầu tiên (khác nhau ở số thứ tự), hoặc ảnh có chuỗi --slide-match trong địa chỉ.
async function slideImages(browser, page, match) {
  const t = await browser.tab();
  try {
    await politeWait(page);
    await t.go(page);
    await sleep(5000);
    // Ảnh slide thường tải lười: cuộn từng đoạn để cả bộ hiện ra.
    for (let y = 800; y <= 8000; y += 800) {
      await t.ev(`window.scrollTo(0, ${y})`);
      await sleep(400);
    }
    const all = await t.ev(`[...new Set([...document.querySelectorAll("img")]
      .filter((i) => i.naturalWidth >= 400)
      .filter((i) => i.naturalWidth / i.naturalHeight > 1.6 && i.naturalWidth / i.naturalHeight < 1.9)
      .map((i) => i.currentSrc || i.src))]`);
    // Băng chuyền slide chỉ tải vài ảnh đang hiện: khi biết tên bộ, đọc thêm mọi địa chỉ trong srcset / data-src
    // (kể cả ảnh chưa tải) rồi giữ bản rộng nhất của mỗi slide.
    const declared = match ? await t.ev(`[...document.querySelectorAll("img,source")].flatMap((i) => {
      const set = i.getAttribute("srcset") || i.getAttribute("data-srcset") || "";
      return [i.currentSrc, i.getAttribute("src"), i.getAttribute("data-src"),
        ...set.split(",").map((x) => x.trim().split(" ")[0])];
    }).filter(Boolean)`) : [];
    const stem = (u) => decodeURIComponent(u.split("?")[0].split("/").pop() ?? "").replace(/\d+/g, "#");
    const deck = match
      ? [...new Set([...all, ...declared])].filter((u) => u.includes(match))
      : all.filter((u) => stem(u) === stem(all[0] ?? ""));
    const width = (u) => Number(/_(\d+)_\d+(?=\.\w+$)/.exec(u.split("?")[0])?.[1] ?? 0);
    const widest = [...deck].sort((x, y) => width(y) - width(x));
    const slideKey = (u) => u.split("?")[0].replace(/_\d+_\d+(?=\.\w+$)/, "");
    const byKey = new Map();
    for (const u of widest) if (!byKey.has(slideKey(u))) byKey.set(slideKey(u), u);
    // Thứ tự slide theo số đầu tên tệp (0-ten-bo, 1-ten-bo…), không theo thứ tự xuất hiện trong trang.
    const order = (u) => Number(/\/(\d+)-[^/]*$/.exec(u.split("?")[0])?.[1] ?? 0);
    const ids = match ? [...byKey.values()].sort((x, y) => order(x) - order(y)) : [...byKey.values()];
    if (ids.length < 4) throw new Error(`chỉ thấy ${ids.length} ảnh slide cùng bộ trên ${page}`);
    const n = ids.length;
    // Bộ mẫu bán sẵn để nửa cuối cho trang hướng dẫn, kho biểu tượng, bản đồ: chỉ lấy trong nửa đầu.
    return [0, Math.floor(n / 6), Math.floor(n / 3), Math.floor(n / 2)].map((i) => ids[i]);
  } finally {
    await t.close();
  }
}
const imageBytes = async (browser, u, selector) =>
  fetchBytes(u.startsWith("page:") ? await largestImage(browser, u.slice(5), selector) : u);

// WebP nhỏ nhất vẫn rõ: chất lượng cao nhất còn dưới 90 KB; vượt trần 100 KB thì thu nhỏ bề ngang.
async function toWebp(png) {
  for (const w of [1280, 1120, 960, 800, 640]) {
    let lo = 30;
    let hi = 92;
    let best = null;
    while (lo <= hi) {
      const q = Math.floor((lo + hi) / 2);
      const buf = await sharp(png)
        .resize({ width: w, height: D.REF_LIMITS.imageMaxHeight, fit: "inside", withoutEnlargement: true })
        .webp({ quality: q, effort: 6, smartSubsample: true })
        .toBuffer();
      if (buf.length <= 90_000) {
        best = buf;
        lo = q + 1;
      } else {
        hi = q - 1;
      }
    }
    if (best && best.length <= D.REF_LIMITS.imageMaxBytes) return best;
  }
  throw new Error("không nén được ảnh dưới 100 KB");
}
async function grid4(tiles) {
  const fit = { fit: "cover", position: "top" };
  const cells = await Promise.all(tiles.slice(0, 4).map((b) => sharp(b).resize(640, 360, fit)
    .png().toBuffer()));
  return sharp({ create: { width: 1280, height: 720, channels: 3, background: "#ffffff" } })
    .composite(cells.map((input, i) => ({ input, left: (i % 2) * 640, top: Math.floor(i / 2) * 360 })))
    .png()
    .toBuffer();
}
async function paletteOf(png, firstViewHeight = VIEW.height) {
  const img = sharp(png);
  const meta = await img.metadata();
  const h = Math.min(meta.height, firstViewHeight);
  const { data, info } = await sharp(png)
    .extract({ left: 0, top: 0, width: meta.width, height: h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return X.paletteFromPixels(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, 8);
}
// Logo, chữ thương hiệu còn sót (bìa báo cáo, góc slide) được làm nhoè tại chỗ: giữ bố cục và khối màu cho model
// nhìn, bỏ dấu nhận diện. --mask "x,y,w,h;…" theo tỉ lệ 0-1 của ảnh đã ghép.
async function blurMarks(png, mask) {
  const meta = await sharp(png).metadata();
  const parts = [];
  for (const box of String(mask).split(";").filter(Boolean)) {
    const [x, y, w, h] = box.split(",").map(Number);
    const left = Math.max(0, Math.round(x * meta.width));
    const top = Math.max(0, Math.round(y * meta.height));
    const width = Math.min(meta.width - left, Math.max(1, Math.round(w * meta.width)));
    const height = Math.min(meta.height - top, Math.max(1, Math.round(h * meta.height)));
    const input = await sharp(png).extract({ left, top, width, height }).blur(Math.max(8, height / 6)).toBuffer();
    parts.push({ input, left, top });
  }
  return sharp(png).composite(parts).png().toBuffer();
}
const blankProbe = (w, h) => ({ url: "", vw: w, vh: h, scrollH: h, pageBg: "", texts: [], boxes: [], media: [],
  gaps: [], paddings: [], maxWidth: w, columns: 1, fonts: [] });

// Giá trị mặc định cho trường chưa đo được: người duyệt sửa lại bằng mắt, kiểm tra ở build-index.mjs.
function defaultTokens(theme) {
  const font = (kit) => ({ kit, seen: "", seenLicence: "unknown", weight: 400 });
  return {
    theme,
    colors: [],
    fonts: { head: font("inter"), body: font("inter"), mono: null },
    type: { basePx: 16, ratio: 1.25, sizes: [], headLine: 1.1, bodyLine: 1.5, headCase: "none" },
    tracking: { display: 0, heading: 0, body: 0, label: 0 },
    radius: { outer: 0, inner: 0, pill: false },
    shadow: { level: 0, css: "none" },
    spacing: { unit: 8, section: 64, gutter: 24, density: "balanced" },
    layout: { columns: 1, maxWidth: 1280, align: "left", emptyShare: 0 },
    imagery: { kind: "type-only", share: 0, light: "", lens: "", grade: "", subject: "" },
  };
}

export async function captureOne(browser, a, work) {
  if (!a.id || !D.REF_DOMAINS.includes(a.domain)) throw new Error("cần --id và --domain hợp lệ");
  const first = a.url ?? a.imageUrl ?? a.imagePage ?? a.pdfUrl ?? a.gridPage ?? a.grid[0];
  if (!first) throw new Error("cần --url, --image-url, --image-page, --pdf-url hoặc --grid");
  const src = a.sourceUrl ?? first.replace(/^page:/, "");
  const robots = await robotsStatus(src);
  if ((robots === "disallowed" || robots === "ai-optout") && !a.force) throw new Error(`robots.txt: ${robots} ${src}`);
  let png;
  let probe = null;
  let hidden = 0;
  let layout = "single";
  const pages = String(a.pages ?? a.page ?? "1").split(",").map(Number);
  if (a.gridPage) layout = "grid4";
  if (a.url && !a.gridMode) {
    const r = await capturePage(browser, a);
    png = r.png;
    probe = r.probe;
    hidden = r.hidden;
  } else if (a.pdfUrl) {
    const shots = await renderPdfPages(browser, a.pdfUrl, pages, a.gridMode ? 1280 : Number(a.width ?? 1280));
    png = a.gridMode ? await grid4(shots) : shots[0];
    layout = a.gridMode ? "grid4" : "single";
  } else if (a.imageUrl || a.imagePage) {
    const u = a.imageUrl ?? `page:${a.imagePage}`;
    png = await sharp(await imageBytes(browser, u, a.imageSelector)).png().toBuffer();
  } else {
    const tiles = [];
    const urls = a.gridPage ? await slideImages(browser, a.gridPage, a.slideMatch) : a.grid;
    for (const u of urls) tiles.push(await imageBytes(browser, u, a.imageSelector));
    png = await grid4(tiles);
    layout = "grid4";
  }
  // Ảnh dài (email, trang tài liệu cuộn): giữ bề ngang gốc, chỉ lấy phần đầu cao tối đa 1600 px như ảnh chụp trang.
  const raw = await sharp(png).metadata();
  const scroll = a.domain === "email" || a.domain === "doc";
  if (scroll && !probe && raw.width <= D.REF_LIMITS.imageMaxWidth && raw.height > D.REF_LIMITS.imageMaxHeight) {
    const top = { left: 0, top: 0, width: raw.width, height: D.REF_LIMITS.imageMaxHeight };
    png = await sharp(png).extract(top).png().toBuffer();
  }
  if (a.mask) png = await blurMarks(png, a.mask);
  const meta = await sharp(png).metadata();
  const palette = await paletteOf(png, probe ? probe.vh : Math.min(meta.height, 1600));
  const measuredBy = probe ?? blankProbe(meta.width, Math.min(meta.height, 1600));
  const { tokens, measured } = X.tokensFromProbe(measuredBy, palette);
  const webp = await toWebp(png);
  const wm = await sharp(webp).metadata();
  const dir = path.join(CATALOG, a.domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${a.id}.webp`), webp);
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, `${a.id}.png`), png);
  writeFileSync(path.join(work, `${a.id}.probe.json`), JSON.stringify({ probe, palette, hidden }, null, 1));
  const file = path.join(dir, `${a.id}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const base = prev?.tokens ?? defaultTokens(tokens.theme ?? "light");
  // Chụp lại giữ trường người duyệt đã chấm; chỉ thay các trường đo được của lần chụp này.
  const merged = { ...base };
  for (const k of measured) merged[k] = tokens[k];
  if (tokens.imagery && !prev) {
    merged.imagery = { ...base.imagery, kind: tokens.imagery.kind, share: tokens.imagery.share };
  }
  const host = new URL(src).host.replace(/^www\./, "");
  const ref = {
    v: 1,
    id: a.id,
    domain: a.domain,
    title: prev?.title ?? "",
    moods: prev?.moods ?? [],
    industries: prev?.industries ?? [],
    audience: prev?.audience ?? [],
    source_url: src,
    source_host: host,
    source_kind: a.sourceKind ?? prev?.source_kind ?? (a.url && !a.gridMode ? "public-page" : "public-image"),
    captured_at: new Date().toISOString().slice(0, 10),
    image: { file: `${a.domain}/${a.id}.webp`, width: wm.width, height: wm.height, bytes: webp.length, layout },
    tokens: merged,
    measured: [...new Set([...(prev?.measured ?? []).filter((m) => !measured.includes(m)), ...measured])],
    why: prev?.why ?? "",
    licence: prev?.licence ?? LICENCE,
  };
  writeFileSync(file, JSON.stringify(ref, null, 2) + "\n");
  return { id: a.id, bytes: webp.length, w: wm.width, h: wm.height, hidden, robots, measured };
}

// Kiểm nguồn trước khi chụp: robots.txt (kể cả chặn bộ thu thập AI) và trang còn mở được không. Chạy 4 luồng:
// mở quá nhiều kết nối cùng lúc thì mạng của máy chụp từ chối và kết quả sai.
async function checkSources(src, only) {
  const rows = src.candidates.filter((c) => !only || only.has(c.id));
  let i = 0;
  const one = async (c) => {
    const url = c.url ?? c.pdfUrl ?? c.imageUrl ?? c.imagePage ?? c.gridPage ?? c.grid?.[0]?.replace(/^page:/, "");
    try {
      // Ảnh nằm ở máy chủ khác trang công bố: cả hai phải cho phép.
      const pages = [...new Set([c.sourceUrl, url].filter(Boolean))];
      const all = await Promise.all(pages.map((u) => robotsStatus(u)));
      c.robots = all.find((r) => r === "ai-optout" || r === "disallowed") ?? all[0];
      await politeWait(url);
      const r = await fetch(url, { method: "GET", headers: { "user-agent": UA_TOKEN }, redirect: "follow",
        signal: AbortSignal.timeout(20_000) });
      c.http = r.status;
      await r.body?.cancel();
    } catch (e) {
      c.http = 0;
      c.note = `không mở được: ${String(e.cause?.code ?? e.message).slice(0, 80)}`;
    }
    console.log(`${c.id.padEnd(14)} ${String(c.http).padEnd(4)} ${String(c.robots).padEnd(10)} ${url}`);
  };
  const worker = async () => {
    while (i < rows.length) await one(rows[i++]);
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// Đo lại token từ PNG và kết quả TOKEN_PROBE đã lưu khi cách suy token đổi: không mở lại trang nguồn.
async function retoken(ids, work) {
  for (const d of D.REF_DOMAINS) {
    const dir = path.join(CATALOG, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const file = path.join(dir, f);
      const ref = JSON.parse(readFileSync(file, "utf8"));
      const saved = path.join(work, `${ref.id}.probe.json`);
      if ((ids && !ids.has(ref.id)) || !existsSync(saved)) continue;
      const { probe } = JSON.parse(readFileSync(saved, "utf8"));
      const png = readFileSync(path.join(work, `${ref.id}.png`));
      const meta = await sharp(png).metadata();
      const palette = await paletteOf(png, probe ? probe.vh : Math.min(meta.height, 1600));
      const measuredBy = probe ?? blankProbe(meta.width, Math.min(meta.height, 1600));
      const { tokens, measured } = X.tokensFromProbe(measuredBy, palette);
      // Trường người duyệt đã sửa tay (không còn trong measured) giữ nguyên.
      for (const k of measured) if (ref.measured.includes(k)) ref.tokens[k] = tokens[k];
      writeFileSync(file, JSON.stringify(ref, null, 2) + "\n");
      console.log(`đo lại ${ref.id}`);
    }
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const work = a.work ?? process.env.REF_WORK ?? path.join(tmpdir(), "synchro-refs");
  if (a.retoken) {
    await retoken(a.retoken === "all" ? null : new Set(a.retoken.split(",")), work);
    return;
  }
  const browser = a.check ? null : await openBrowser();
  try {
    if (!a.batch) {
      console.log(JSON.stringify(await captureOne(browser, a, work)));
      return;
    }
    const src = JSON.parse(readFileSync(a.batch, "utf8"));
    if (a.check) {
      await checkSources(src, a.check === "all" ? null : new Set(a.check.split(",")));
      writeFileSync(a.batch, JSON.stringify(src, null, 1) + "\n");
      return;
    }
    const only = a.only ? new Set(a.only.split(",")) : null;
    const todo = src.candidates.filter((c) => (only ? only.has(c.id) : c.decision === "capture"));
    let i = 0;
    const fails = [];
    const worker = async () => {
      while (i < todo.length) {
        const c = todo[i++];
        const args = { ...c, grid: c.grid ?? [], gridMode: !!c.gridMode, noHide: !!c.noHide, force: a.force };
        try {
          const r = await captureOne(browser, args, work);
          c.robots = r.robots;
          const kb = Math.round(r.bytes / 1000);
          console.log(`✓ ${c.id} ${r.w}×${r.h} ${kb} KB, ẩn ${r.hidden}, đo ${r.measured.length}`);
        } catch (e) {
          fails.push(c.id);
          console.log(`✗ ${c.id}: ${String(e.message).slice(0, 200)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Number(a.jobs) }, worker));
    writeFileSync(a.batch, JSON.stringify(src, null, 1) + "\n");
    if (fails.length) console.log(`lỗi: ${fails.join(",")}`);
  } finally {
    browser?.quit();
    pdfServer?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
