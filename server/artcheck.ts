// Model tự đọc lại và tự kiểm tra artifact của chính mình (chỉ chạy ở máy chủ).
// - read_artifact: bản hiện tại của một artifact trong đoạn chat (kể cả bản vừa viết trong lượt này), kèm số dòng. Lịch sử gửi cho model
//   chỉ giữ vài artifact gần nhất và tối đa 60 KB (<current_artifacts>): bộ slide lớn bị lược, model từng trả lời "không đọc được artifact".
// - check_artifact: dựng artifact trong Chromium (container chạy code, image workspace) đúng như khung xem trước (cùng trang, cùng CSP),
//   chụp từng slide / trang ở máy tính và điện thoại, đo lỗi hiển thị (chữ đè chữ, tràn khung, chữ bị cắt, ảnh không tải được, chữ quá nhỏ,
//   trang tràn ngang, lỗi script) rồi trả ảnh ghép + danh sách lỗi để model tự sửa trước khi báo xong.
import "server-only";
import { buildDocCore, isDeck } from "../shared/artdoc";
import { DESIGN_PROBE } from "./artprobe";
import { getArtifactByIdent } from "./artifactstore";
import { inlineImages } from "./artimg";
import { splitArtifacts, type ArtType } from "../shared/artifacts";
import { execRun, runner } from "./coderun";
import { artState, cleanBase, type ArtVersion } from "../shared/vfs";
import { fitSummary, overflowing, type SlideFit } from "../shared/deckfit";
import { numberingIssues, type NumIssue } from "../shared/decknum";
import { hashOf } from "../shared/critic";
import { KEEP } from "../shared/turnfold";
import { withinCheckBudget } from "./checkbudget";

export const READ_ARTIFACT_TOOL = {
  name: "read_artifact",
  description: "Đọc bản hiện tại (mới nhất, đã áp mọi khối sửa khớp) của một artifact trong đoạn chat này, kèm số"
    + " dòng — kể cả artifact vừa viết trong lượt này hay đã bị lược khỏi lịch sử. Bản sửa mode=\"patch\" gần nhất"
    + " có khối không khớp thì kết quả có <patch_failed> nêu khối nào và chỗ gần giống nhất: chỉ gửi lại các khối"
    + " đó. Dùng trước khi sửa, khi người dùng báo lỗi, hoặc khi cần xem lại sản phẩm đã giao.",
  input_schema: {
    type: "object",
    properties: {
      identifier: { type: "string", description: "identifier của artifact (bỏ trống: artifact mới nhất)" },
      offset: { type: "number", description: "Dòng bắt đầu (từ 1), cho artifact rất dài" },
    },
  },
};

export const CHECK_ARTIFACT_TOOL = {
  name: "check_artifact",
  description: "Kiểm tra hiển thị thật của artifact (trang web, bản trình bày, ứng dụng React, SVG): Synchro dựng artifact trong Chromium đúng như khung xem trước, chụp từng slide / trang (máy tính và điện thoại) và đo lỗi: chữ đè chữ, phần tử tràn khỏi slide, thẻ hoặc màn hình, chữ bị cắt, ảnh không tải được, chữ quá nhỏ, tiêu đề rớt một chữ, tương phản thấp (WCAG), trang tràn ngang, lỗi JavaScript; với bản trình bày còn đo khung từng slide ở 1280×720 (slide nào cao / rộng hơn khung, thừa bao nhiêu px) và đánh số slide không nhất quán. Trả về ảnh ghép các slide / trang và danh sách lỗi theo vị trí. Gọi sau khi viết xong hoặc sửa artifact, sửa hết lỗi rồi kiểm tra lại trước khi báo xong.",
  input_schema: {
    type: "object",
    properties: {
      identifier: { type: "string", description: "identifier của artifact (bỏ trống: artifact mới nhất)" },
      slide: {
        type: "number",
        description: "Chỉ chụp to một slide (đánh số từ 1) để xem kỹ một chỗ cụ thể; bỏ trống: kiểm tra mọi slide, trả"
          + " ảnh ghép. Ảnh ghép đã có mọi slide: đừng chụp to lần lượt từng slide (tự kiểm tối đa 2 phút mỗi lượt).",
      },
    },
  },
};

export const ARTCHECK_RULES = (check: boolean) => `<self_check>
Bạn chịu trách nhiệm về chất lượng sản phẩm mình giao, như một người làm nghề cẩn thận:
${check ? "- Sau khi viết hoặc sửa artifact dạng trang web, bản trình bày (slide), ứng dụng React hay SVG: gọi check_artifact, xem ảnh chụp và danh sách lỗi, sửa hết (chữ đè chữ, tràn khung, slide nào báo TRÀN trong dòng “Đo khung từng slide”, phần tử tràn khỏi slide, chữ bị cắt, ảnh hỏng, chữ quá nhỏ, tiêu đề rớt chữ, tương phản thấp, đánh số slide lệch nhau, lỗi script) rồi kiểm tra lại, tới khi sạch lỗi (tối đa 2 vòng kiểm tra - sửa) mới báo xong. Tự nhìn ảnh chụp: bố cục, căn lề, khoảng cách, độ tương phản phải chỉn chu như sản phẩm thật."
    : "- Sau khi viết hoặc sửa artifact: đọc lại bằng read_artifact và tự rà bố cục (chữ đè chữ, tràn khung, chữ bị cắt, ảnh hỏng, đánh số slide báo trong <deck_numbering>) trước khi báo xong."}
- Bản sửa (mode="patch") thêm, bớt hay đổi chỗ slide: đánh số lại MỌI nhãn số (số mục "01 ·", chân trang "02 / 06", mục lục) cho cùng một dãy, không chỉ vài chỗ.
- Bố cục bền: dùng flex / grid và khoảng cách đều, không đặt chữ bằng position:absolute chồng lên nhau; slide 16:9 chừa lề, chữ dài thì giảm chữ hoặc chia slide thay vì để tràn; ảnh có kích thước và object-fit rõ ràng.
- Người dùng báo sản phẩm có lỗi: không đổ cho công cụ hay nói "không làm được". Đọc lại bằng read_artifact${check ? ", tái hiện bằng check_artifact" : ""}, tìm nguyên nhân, sửa, kiểm tra lại, rồi báo ngắn gọn đã sửa gì và đã kiểm tra thế nào.
- Không khẳng định đã xong hay đã sửa khi chưa kiểm tra. Còn điều chưa làm được thì nói rõ là gì, đã thử những cách nào, và giao bản tốt nhất có thể.
</self_check>`;

/** Slide tràn khung: chiều cao / rộng thật (scrollHeight/scrollWidth) vượt khung (clientHeight/clientWidth) quá dung sai px.
 *  Dùng chung quy tắc với PROBE (chạy trong Chromium, chỗ này để kiểm thử thuần). */
export function slideOverflows(m: { scrollH: number; clientH: number; scrollW: number; clientW: number }, tol = 4): boolean {
  return m.scrollH > m.clientH + tol || m.scrollW > m.clientW + tol;
}

type Msg = { role: string; content: unknown };
const textOf = (c: unknown) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text ?? "") : "")).join("") : "";

/** Bản hiện tại của artifact: lịch sử đoạn chat + phần model đang viết trong lượt này; không có thì tìm trong kho artifact của tài khoản. */
export function findArtifact(o: { uid: string; conv?: string; messages: Msg[]; base?: unknown; live?: string }, ident?: string): ArtVersion | null {
  const texts = o.messages.filter((m) => m.role === "assistant" || m.role === "ai").map((m) => textOf(m.content));
  if (o.live) texts.push(o.live);
  const st = artState(texts, cleanBase(o.base));
  // Bỏ trống identifier: artifact được viết / sửa gần nhất.
  let want = (ident ?? "").trim().toLowerCase();
  if (!want) for (let i = texts.length - 1; i >= 0 && !want; i--) { const arts = splitArtifacts(texts[i]).filter((g) => g.kind === "art"); const g = arts[arts.length - 1]; if (g?.kind === "art") want = g.art.ident; }
  if (want && st.get(want)) return st.get(want)!;
  if (want && o.conv) {
    const row = getArtifactByIdent(o.uid, o.conv, want);
    const last = row?.versions[row.versions.length - 1];
    if (row && last) return { ident: row.ident, title: row.title, type: row.type, lang: row.lang, content: last.content, complete: true, v: row.versions.length };
  }
  return null;
}

const notFound = (ident?: string) => ({ content: ident ? `Không thấy artifact "${ident}" trong đoạn chat này. Kiểm tra lại identifier (đúng như thẻ <artifact identifier="…">).` : "Đoạn chat này chưa có artifact nào.", is_error: true });

export function readArtifact(a: ArtVersion | null, input: Record<string, unknown>) {
  if (!a) return notFound(typeof input.identifier === "string" ? input.identifier : undefined);
  const lines = a.content.split("\n");
  const from = Math.max(1, Math.floor(Number(input.offset) || 1));
  let out = "", n = from;
  for (; n <= lines.length && out.length < 60_000; n++) out += `${String(n).padStart(4)} | ${lines[n - 1]}\n`;
  const more = n <= lines.length ? `\n[Còn ${lines.length - n + 1} dòng: gọi lại với offset=${n}]` : "";
  // Bộ slide: báo luôn đánh số lệch nhau (đọc mã, không cần Chromium), để bản sửa mode="patch" đánh số lại một phần vẫn bị phát hiện
  // cả khi máy chủ không có check_artifact.
  const nums = a.complete && a.type === "html" && isDeck(a) ? numberingNote(numberingIssues(a.content)) : [];
  const numTag = nums.length ? `\n<deck_numbering>\nĐánh số slide không nhất quán, sửa cho cùng một dãy trước khi báo xong:\n${nums.join("\n")}\n</deck_numbering>` : "";
  // Thẻ artifact_source (không phải <artifact>): model trích lại kết quả này thì không bị hiểu nhầm thành artifact mới.
  return { content: `<artifact_source identifier="${a.ident}" type="${a.type}" title="${a.title}" version="${a.v}" lines="${lines.length}"${a.complete ? "" : ' complete="false"'}>\n${out}</artifact_source>${more}${numTag}`, is_error: false };
}

// Cầu nối thay thế ở máy kiểm tra: không có khung cha, window.synchro / storage trả về rỗng để artifact vẫn dựng được.
const CHECK_BRIDGE = `<script>(function(){var none=function(){return Promise.resolve(null)};var storage={get:none,set:none,"delete":none,list:function(){return Promise.resolve([])},onChange:function(){return function(){}}};
var api={complete:function(){return Promise.resolve("")},storage:storage};window.synchro=api;window.claude=api;try{window.storage=storage}catch(e){}})();</script>`;

// Đo lỗi hiển thị trong một vùng (slide đang hiện, hoặc cả trang). Chạy trong Chromium.
const PROBE = String.raw`(root, deck) => {
  // Đo ở trạng thái cuối: chữ đang hiện dần (stagger chưa tới lượt) không phải lỗi tương phản, và vẫn phải đo chồng lấn. Lặp vô hạn thì về trạng thái gốc.
  for (const a of document.getAnimations()) { try { a.finish(); } catch { a.cancel(); } }
  const out = [], seen = new Set();
  const add = (kind, detail) => { const k = kind + detail; if (!seen.has(k) && out.length < 30) { seen.add(k); out.push({ kind, detail }); } };
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05; };
  const say = (el) => (el.innerText || el.textContent || el.getAttribute("alt") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 60);
  const R = root.getBoundingClientRect();
  const clipped = (el, r) => { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY) && p !== root) { const b = p.getBoundingClientRect(); if (r.bottom <= b.top + 1 || r.top >= b.bottom - 1 || r.right <= b.left + 1 || r.left >= b.right - 1) return true; } } return false; };
  // Khối chữ: mỗi nút chữ một hộp (theo từng dòng).
  const boxes = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t; (t = tw.nextNode());) {
    const el = t.parentElement; if (!t.nodeValue.trim() || !el || !vis(el) || el.closest("script,style,noscript,[aria-hidden=true]")) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    for (const r of rg.getClientRects()) if (r.width > 2 && r.height > 2) boxes.push({ el, r });
    if (boxes.length > 600) break;
  }
  // Chữ đè chữ: hai dòng chữ của hai phần tử khác nhau chồng lên nhau quá 25% dòng nhỏ hơn.
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]; if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 4 && h > 4 && w * h > 0.25 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) add("chữ đè chữ", "“" + say(a.el) + "” chồng lên “" + say(b.el) + "”");
  }
  // Khung của một slide là cửa sổ 1280×720: slide cao theo nội dung (min-height:100vh rồi dài ra 869px, H1 T8) vẫn có scrollHeight = clientHeight
  // và mọi chữ vẫn nằm trong hộp của slide, nhưng người xem chỉ thấy 720px đầu. Đo theo khung đó, không theo hộp của slide.
  const F = { left: R.left, top: R.top, right: Math.min(R.right, R.left + innerWidth), bottom: Math.min(R.bottom, R.top + innerHeight) };
  // Chữ / ảnh ra ngoài vùng (slide hoặc chiều ngang màn hình): bị cắt hoặc phải cuộn ngang.
  const W = deck ? F : { left: 0, right: innerWidth, top: -1e9, bottom: 1e9 };
  // Slide cao hơn khung: phần dưới báo một lần ở mục "phần tử tràn khỏi slide" bên dưới, không liệt kê từng dòng chữ.
  const tallSlide = deck && R.height > innerHeight + 4;
  for (const { el, r } of boxes) if (r.right > W.right + 3 || r.left < W.left - 3 || (deck && !tallSlide && (r.bottom > W.bottom + 3 || r.top < W.top - 3))) { if (!clipped(el, r)) add(deck ? "chữ tràn ra ngoài slide" : "chữ tràn ra ngoài màn hình", "“" + say(el) + "”"); }
  // Khung cắt mất chữ (overflow hidden mà nội dung dài hơn), trừ cắt có chủ ý bằng dấu … hay line-clamp.
  for (const el of root.querySelectorAll("*")) {
    if (!vis(el)) continue; const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp) continue;
    if ((el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4) && el.innerText && el.innerText.trim() && el.clientHeight > 0) add("chữ bị khung cắt mất", "“" + say(el) + "”");
  }
  for (const img of root.querySelectorAll("img")) if (vis(img) && img.complete && !img.naturalWidth) add("ảnh không tải được", (img.getAttribute("src") || "").slice(0, 120) + " (khung artifact chỉ hiện ảnh nhúng sẵn hoặc ảnh từ URL https công khai)");
  // Slide, poster, ảnh chia sẻ của bộ thiết kế là hình co theo khung: đo ở cỡ thật (rộng 1280, 1080, 1200), ở khung điện thoại chữ co theo là đúng.
  for (const { el, r } of boxes) {
    const fs = parseFloat(getComputedStyle(el).fontSize), art = el.closest(".sx-poster,.sx-og,.sx-slide");
    if (art) { const full = art.matches(".sx-poster") ? 1080 : art.matches(".sx-og") ? 1200 : 1280, px = fs * full / art.getBoundingClientRect().width; if (px < 12 * (full === 1080 ? 4 / 3 : 1) && r.width > 8) add("chữ quá nhỏ", Math.round(px) + "px ở cỡ thật rộng " + full + ": “" + say(el) + "”"); continue; }
    if (fs < (deck ? 12 : 10) && r.width > 8) add("chữ quá nhỏ", Math.round(fs) + "px: “" + say(el) + "”");
  }
  // Slide tràn nội dung: so chiều cao / rộng thật của slide với khung (scrollHeight vs clientHeight). Bắt được cả khi khung slide cắt mất (overflow hidden)
  // mà vẫn còn phần tử thò ra — khó thấy bằng mắt trên ảnh chụp. Trả về các phần tử ngoài cùng tràn ra để model biết chỗ nào phải thu gọn hoặc chia slide.
  // Một hệ tọa độ: slide thu nhỏ bằng transform (khung 1920×1080 co về 1280×720) có scrollHeight theo cỡ chưa co, nhân với tỉ lệ co để so với khung.
  const sx = root.offsetWidth ? R.width / root.offsetWidth : 1, sy = root.offsetHeight ? R.height / root.offsetHeight : 1;
  const tallH = Math.max(root.scrollHeight * sy, R.height), tallW = Math.max(root.scrollWidth * sx, R.width);
  if (deck && (root.scrollHeight > root.clientHeight + 4 || root.scrollWidth > root.clientWidth + 4 || R.height > innerHeight + 4 || R.width > innerWidth + 4)) {
    const over = [];
    for (const el of root.querySelectorAll("*")) {
      if (!vis(el) || el.closest("script,style,noscript,[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && (r.bottom > F.bottom + 2 || r.right > F.right + 2 || r.top < F.top - 2 || r.left < F.left - 2) && !clipped(el, r)) over.push({ el, r });
    }
    const outer = over.filter(({ el }) => !over.some((o) => o.el !== el && o.el.contains(el)));
    const frameH = Math.round(Math.min(root.clientHeight * sy, innerHeight)), frameW = Math.round(Math.min(root.clientWidth * sx, innerWidth));
    const extent = "slide " + Math.round(tallH) + "×" + Math.round(tallW) + "px > khung " + frameH + "×" + frameW + "px";
    // Không thấy phần tử nào thò ra mà slide tự cắt (overflow hidden / clip): phần cuộn thừa chỉ là hình trang trí (aria-hidden) hay phần đã bị cắt có chủ ý,
    // người xem không mất gì (review W10: hình tròn trang trí thò mép phải từng bị báo "slide tràn nội dung" ở mọi slide).
    const rcs = getComputedStyle(root);
    if (outer.length) for (const { el } of outer.slice(0, 6)) add("phần tử tràn khỏi slide", "“" + say(el) + "” (" + extent + ")");
    else if (!/(hidden|clip)/.test(rcs.overflowX + rcs.overflowY)) add("slide tràn nội dung", "nội dung vượt khung (" + extent + "); thu gọn chữ hoặc chia slide");
  }
  if (deck && !boxes.length && !root.querySelector("img,svg,canvas,video")) add("slide trống", "không có chữ hay hình");
  if (!deck && document.documentElement.scrollWidth > innerWidth + 2) add("trang tràn ngang", "rộng " + document.documentElement.scrollWidth + "px trên màn " + innerWidth + "px");
  (${DESIGN_PROBE})(root, deck, boxes, add, say);
  return out;
}`;

// Số đo khung của một slide (chạy trong Chromium): cao / rộng thật so với cửa sổ 1280×720, kể cả khi slide tự dài ra theo nội dung (H1 T8).
// Một hệ tọa độ (review W10): hộp đã co theo transform (getBoundingClientRect) và scrollHeight / scrollWidth chưa co nhân với tỉ lệ co, không lấy
// max của hai cỡ khác hệ (khung 1920×1080 co về 1280×720 từng bị báo "TRÀN 1080px" ở mọi slide). Slide tự cắt (overflow hidden / clip, vd. hình
// trang trí thò ra mép) thì người xem chỉ thấy đúng hộp của slide: lấy hộp, không lấy phần cuộn bị cắt.
const FIT = String.raw`(el) => {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const sx = el.offsetWidth ? r.width / el.offsetWidth : 1, sy = el.offsetHeight ? r.height / el.offsetHeight : 1;
  const clipX = /hidden|clip/.test(cs.overflowX), clipY = /hidden|clip/.test(cs.overflowY);
  return { h: Math.round(clipY ? r.height : Math.max(r.height, el.scrollHeight * sy)), w: Math.round(clipX ? r.width : Math.max(r.width, el.scrollWidth * sx)), vh: innerHeight, vw: innerWidth };
}`;

// Script chạy trong container: dựng trang, đi từng slide / từng cỡ màn hình, đo lỗi, chụp ảnh, ghép ảnh.
const CHECK_JS = String.raw`const fs = require("fs"), puppeteer = require("puppeteer-core");
const cfg = JSON.parse(fs.readFileSync("check.json", "utf8")), html = fs.readFileSync("page.html", "utf8");
const PROBE = ${PROBE};
const FIT = ${FIT};
(async () => {
  const px = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium", headless: true,
    // Trang có nền shader / cảnh 3D: Chromium không còn tự rơi về WebGL phần mềm (từ khoảng bản 137), phải bật SwiftShader thì mới đo, chụp được canvas WebGL.
    // Chỉ cho trang của chính người dùng, chạy trong container sandbox.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--hide-scrollbars", ...(/synchro-3d|data-sx-shader/.test(html) ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : []), ...(px ? ["--proxy-server=" + px.protocol + "//" + px.host] : [])] });
  const report = { slides: 0, views: [], issues: [], errors: [], fit: [] };
  const shots = [];
  const open = async (w, h, mobile) => {
    const page = await browser.newPage();
    if (px && px.username) await page.authenticate({ username: decodeURIComponent(px.username), password: decodeURIComponent(px.password) });
    page.on("pageerror", (e) => report.errors.push(String(e.message || e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text().slice(0, 300)); });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45000 }).catch((e) => report.errors.push("Trang tải quá lâu: " + e.message));
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    return page;
  };
  // puppeteer-core 23 trả Uint8Array: đổi sang Buffer để mã hóa base64 đúng.
  const shot = async (page, label, full) => shots.push({ label, buf: Buffer.from(await page.screenshot({ type: "jpeg", quality: 80, fullPage: !!full })) });
  if (cfg.deck) {
    const page = await open(1280, 720);
    const n = await page.evaluate(() => (window.__sxAll ? window.__sxAll().length : 0));
    report.slides = n;
    const only = cfg.slide ? [cfg.slide - 1] : [...Array(Math.min(n, 30)).keys()];
    for (const i of only) {
      if (i < 0 || i >= n) continue;
      await page.evaluate((k) => window.__sxGo(k), i);
      await new Promise((r) => setTimeout(r, 650));
      const found = await page.evaluate((src) => { const el = window.__sxCur && window.__sxCur(); return el ? (0, eval)("(" + src + ")")(el, true) : []; }, PROBE.toString());
      for (const f of found) report.issues.push({ where: "Slide " + (i + 1), ...f });
      // Số đo khung của từng slide (FIT) để báo từng slide vừa hay tràn.
      const fit = await page.evaluate((src) => { const el = window.__sxCur && window.__sxCur(); return el ? (0, eval)("(" + src + ")")(el) : null; }, FIT.toString()).catch(() => null);
      if (fit) report.fit.push({ slide: i + 1, ...fit });
      await shot(page, "Slide " + (i + 1));
    }
    report.views.push("1280×720");
  } else {
    for (const v of [{ w: 1366, h: 768, name: "Máy tính 1366×768" }, { w: 390, h: 844, name: "Điện thoại 390×844", m: true }]) {
      const page = await open(v.w, v.h, v.m);
      const found = await page.evaluate((src) => (0, eval)("(" + src + ")")(document.body, false), PROBE.toString());
      for (const f of found) report.issues.push({ where: v.name, ...f });
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      if (tall > v.h * 3) await page.setViewport({ width: v.w, height: Math.min(tall, v.h * 3) });
      await shot(page, v.name + (tall > v.h * 3 ? " (3 màn đầu)" : ""), tall <= v.h * 3);
      report.views.push(v.name);
      await page.close();
    }
  }
  // Ảnh ghép: mọi slide / màn hình trong một ảnh, có nhãn, để model xem một lần.
  const one = shots.length === 1;
  const cols = one ? 1 : cfg.deck ? (shots.length > 9 ? 4 : 3) : 2;
  const cw = one ? 1280 : cfg.deck ? 420 : 520;
  const grid = await browser.newPage();
  await grid.setViewport({ width: cols * (cw + 12) + 12, height: 400, deviceScaleFactor: 1 });
  await grid.setContent('<body style="margin:0;padding:12px;background:#d9d9d9;font:600 14px sans-serif;display:grid;grid-template-columns:repeat(' + cols + ',' + cw + 'px);gap:12px;align-items:start">' +
    shots.map((s) => '<figure style="margin:0"><figcaption style="margin:0 0 4px">' + s.label + '</figcaption><img style="width:' + cw + 'px;display:block;border:1px solid #999;background:#fff" src="data:image/jpeg;base64,' + s.buf.toString("base64") + '"></figure>').join("") + "</body>", { waitUntil: "load" });
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync("outputs/sheet.jpg", Buffer.from(await grid.screenshot({ type: "jpeg", quality: 78, fullPage: true })));
  report.errors = [...new Set(report.errors)].slice(0, 12);
  fs.writeFileSync("outputs/report.json", JSON.stringify(report));
  await browser.close();
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
`;

// W23-17 (Blueprint G4.5): "Kiểm tra hiển thị, sửa lỗi" tối đa 2 vòng cho mỗi artifact trong một lượt — đếm thật, không chỉ nhắc trong prompt.
// Một vòng = kiểm tra một bản mới của artifact; gọi lại trên cùng bản (vd. chụp to một slide) không tính thêm vòng.
export const MAX_CHECK_ROUNDS = 2;
const rounds = new WeakMap<object, Map<string, { n: number; last: string }>>();
const fingerprint = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return `${s.length}:${(h >>> 0).toString(36)}`; };
/** Ghi một vòng kiểm tra của artifact trong lượt `turn` (đối tượng ngữ cảnh của lượt). Trả null nếu còn được kiểm tra, hoặc lời báo đã đủ vòng. */
export function checkRoundGate(turn: object, a: ArtVersion): string | null {
  if (!a.complete) return null; // chưa viết xong: checkArtifact tự từ chối, không tính vòng
  let m = rounds.get(turn);
  if (!m) rounds.set(turn, (m = new Map()));
  const fp = fingerprint(a.content), r = m.get(a.ident);
  if (r && r.last === fp) return null;
  if (r && r.n >= MAX_CHECK_ROUNDS) return `Đã đủ ${MAX_CHECK_ROUNDS} vòng kiểm tra - sửa cho artifact "${a.ident}" trong lượt này nên không kiểm tra thêm. Báo xong cho người dùng; nếu lần kiểm tra trước còn lỗi chưa sửa được thì nói rõ là lỗi gì.`;
  m.set(a.ident, { n: (r?.n ?? 0) + 1, last: fp });
  return null;
}

// Số đo bố cục của từng bản bộ slide (theo mã băm nội dung), để hội đồng phản biện dùng lại số đo thật của check_artifact thay vì đoán từ mã nguồn.
// Trong bộ nhớ của tiến trình: mất khi khởi động lại thì phản biện tự đo lại (measureDeck).
export type DeckLayout = { at: number; fit: SlideFit[]; issues: { where: string; kind: string; detail: string }[] };
const layouts = new Map<string, DeckLayout>();
const LAYOUT_TTL = 2 * 3600_000, LAYOUT_MAX = 300;
export function rememberLayout(content: string, l: Omit<DeckLayout, "at">) {
  const k = hashOf(content) + ":" + content.length;
  layouts.delete(k); layouts.set(k, { at: Date.now(), ...l });
  for (const key of layouts.keys()) { if (layouts.size <= LAYOUT_MAX) break; layouts.delete(key); }
}
export function layoutOf(content: string): DeckLayout | null {
  const k = hashOf(content) + ":" + content.length, l = layouts.get(k);
  if (!l || Date.now() - l.at > LAYOUT_TTL) { layouts.delete(k); return null; }
  return l;
}
/** Lỗi đánh số slide dạng dòng cho model (rỗng nếu không có). */
export const numberingNote = (issues: NumIssue[]) => issues.map((x) => `- Slide ${x.slides.length > 1 ? x.slides.join(", ") : x.slides[0]}: đánh số slide không nhất quán — ${x.prompt}`);

/** Bản này của artifact đã được check_artifact kiểm tra trong lượt `turn` (model đã thấy kết quả). */
export function checkedInTurn(turn: object, a: ArtVersion): boolean {
  return rounds.get(turn)?.get(a.ident)?.last === fingerprint(a.content);
}

// Tự kiểm bộ slide lúc model định trả lời xong (W10 nhóm C, H1 T8): model không gọi check_artifact, hoặc gọi trên bản cũ rồi sửa tiếp,
// thì slide tràn khung 1280×720 và đánh số lệch sau bản sửa tới thẳng người dùng. Synchro tự đo bản cuối (đánh số: đọc mã, luôn có;
// khung từng slide: dựng trong Chromium khi máy chủ có workspace) và trả lời nhắc cho model sửa trước khi giao. null: không có gì phải sửa.
// Bản đã kiểm tra trong lượt thì bỏ qua (model đã thấy kết quả), không tính thêm vòng khi đã đủ MAX_CHECK_ROUNDS.
export async function autoDeckCheck(uid: string, turn: object, a: ArtVersion, origin: string, signal?: AbortSignal): Promise<string | null> {
  if (!a.complete || a.type !== "html" || !isDeck(a) || checkedInTurn(turn, a)) return null;
  const nums = numberingNote(numberingIssues(a.content));
  let fit: SlideFit[] = layoutOf(a.content)?.fit ?? [];
  if (!fit.length && runner() === "workspace" && !checkRoundGate(turn, a)) {
    // checkArtifact tự đổi lỗi thành kết quả; lỗi ném ra chỉ làm thiếu số đo khung, phần đánh số (đọc mã) vẫn báo
    // được.
    await withinCheckBudget(turn, signal, (s) => checkArtifact(uid, a, {}, origin, s)).catch(() => null);
    fit = layoutOf(a.content)?.fit ?? [];
  }
  const bad = overflowing(fit);
  if (!bad.length && !nums.length) return null;
  const rows = [...(bad.length ? [fitSummary(fit)] : []), ...(nums.length ? ["Đánh số slide không nhất quán:", ...nums] : [])];
  return `Bộ slide "${a.title}" (identifier "${a.ident}", phiên bản ${a.v}):\n${rows.join("\n")}`;
}
/** Lời nhắc gửi model khi tự kiểm thấy lỗi (một lần mỗi lượt). */
export const AUTO_CHECK = (rows: string[]) => `<auto_check>
Synchro đã tự kiểm bản cuối của bộ slide trước khi giao cho người dùng và thấy lỗi:
${rows.join("\n\n")}
Người dùng không thấy tin nhắn này. Câu trả lời bạn vừa viết được giữ nguyên và giao cho họ; lần trả lời này chỉ để sửa bộ slide:
- Sửa được: trả về artifact cùng identifier, sửa đúng các slide nêu trên (bản sửa mode="patch" được; slide tràn thì rút chữ, giảm khoảng trống hoặc tách slide; đánh số thì đánh số lại MỌI nhãn số cho cùng một dãy), kèm nhiều nhất một câu cho người dùng nói đã chỉnh gì trong bộ slide. Không nhắc tới bước tự kiểm, lời nhắc này hay Synchro.
- Cách hiện tại là cố ý (vd. bìa không đánh số mục): chỉ trả lời đúng ${KEEP}, không viết gì thêm.
</auto_check>`;

/** Đo bố cục bộ slide cho hội đồng phản biện: dùng số đo sẵn của check_artifact nếu có, chưa có thì dựng một lần (chỉ khi có Chromium). */
// signal: hủy cả lượt dựng (rời hàng chờ của workspace / dừng container) khi người gọi không chờ nữa.
export async function measureDeck(uid: string, a: { ident: string; title: string; content: string }, origin: string, signal?: AbortSignal): Promise<DeckLayout | null> {
  const have = layoutOf(a.content);
  if (have || runner() !== "workspace" || signal?.aborted) return have;
  const r = await checkArtifact(uid, { ident: a.ident, title: a.title, type: "html", lang: null, content: a.content, complete: true, v: 1 }, {}, origin, signal).catch(() => null);
  return r && !r.is_error ? layoutOf(a.content) : null;
}

export async function checkArtifact(uid: string, a: ArtVersion | null, input: Record<string, unknown>, origin: string, signal?: AbortSignal): Promise<{ content: string; is_error: boolean; image?: string }> {
  if (!a) return notFound(typeof input.identifier === "string" ? input.identifier : undefined);
  const kinds: ArtType[] = ["html", "react", "svg"];
  if (!kinds.includes(a.type)) return { content: `Artifact "${a.ident}" là ${a.type}: check_artifact kiểm tra hiển thị trang web, bản trình bày, ứng dụng React và SVG. Với loại này, đọc lại bằng read_artifact.`, is_error: true };
  if (runner() !== "workspace") return { content: "Máy chủ này chưa có Chromium để kiểm tra hiển thị (cần dịch vụ workspace). Tự rà lại bằng read_artifact.", is_error: true };
  if (!a.complete) return { content: `Artifact "${a.ident}" chưa viết xong (thiếu thẻ đóng </artifact>): viết xong rồi kiểm tra.`, is_error: true };
  const deck = isDeck(a);
  const slide = Number(input.slide) > 0 ? Math.floor(Number(input.slide)) : 0;
  // Ảnh từ URL ngoài được nhúng như ở khung xem trước, để kết quả kiểm tra khớp với điều người dùng thấy.
  const doc = buildDocCore(a.type, await inlineImages(a.content, uid), origin, "check", false, CHECK_BRIDGE, deck ? { fixed: null } : undefined, a.title);
  let r;
  try {
    r = await execRun({ uid, net: true, web: true, timeout: 150, signal, argv: ["node", "check.js"], files: [
      { path: "page.html", data: Buffer.from(doc) }, { path: "check.js", data: Buffer.from(CHECK_JS) }, { path: "check.json", data: Buffer.from(JSON.stringify({ deck, slide })) },
    ] });
  } catch (e) {
    return { content: `Chưa kiểm tra được hiển thị: ${(e as Error).message}`, is_error: true };
  }
  const rep = r.files.find((f) => f.path === "report.json"), sheet = r.files.find((f) => f.path === "sheet.jpg");
  if (!rep) return { content: `Chưa kiểm tra được hiển thị (trình kiểm tra lỗi): ${(r.stderr || r.stdout).slice(-600)}`, is_error: true };
  const j = JSON.parse(rep.data.toString("utf8")) as { slides: number; views: string[]; issues: { where: string; kind: string; detail: string }[]; errors: string[]; fit?: SlideFit[] };
  const fit = Array.isArray(j.fit) ? j.fit : [];
  // Cả bộ (không chỉ chụp to một slide): lưu số đo cho hội đồng phản biện của đúng bản này.
  if (deck && !slide) rememberLayout(a.content, { fit, issues: j.issues });
  const nums = deck ? numberingNote(numberingIssues(a.content)) : [];
  const head = deck ? `Bản trình bày "${a.title}" (phiên bản ${a.v}): ${j.slides} slide, dựng ở 1280×720${slide ? `, chụp to slide ${slide}` : ""}.${fit.length ? `\n${fitSummary(fit)}` : ""}` : `"${a.title}" (phiên bản ${a.v}) dựng ở ${j.views.join(" và ")}.`;
  const all = [...j.issues.map((x) => `- ${x.where}: ${x.kind} — ${x.detail}`), ...nums];
  const issues = all.length ? `\nLỗi hiển thị cần sửa (${all.length}):\n${all.join("\n")}` : "\nKhông đo thấy lỗi (chữ đè, tràn, cắt, ảnh hỏng, chữ quá nhỏ, tiêu đề rớt chữ, tương phản, đánh số slide).";
  const errs = j.errors.length ? `\nLỗi khi chạy trang:\n${j.errors.map((e) => `- ${e}`).join("\n")}` : "";
  const tail = "\nẢnh ghép đi kèm: tự xem thêm bố cục, căn lề, khoảng cách, độ tương phản và chỗ nào trông chưa chỉn chu.";
  return { content: head + issues + errs + tail, is_error: false, ...(sheet ? { image: sheet.data.toString("base64") } : {}) };
}
