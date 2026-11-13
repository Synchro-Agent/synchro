// G4: xuất bản trình bày (slide) HTML thành PowerPoint (.pptx) Ở MÁY CHỦ, chạy chính deckpptx.ts trong Chromium của dịch vụ workspace.
// Khung xem trước (artifactui.tsx) đã xuất được ngay trong trình duyệt người dùng; tệp này làm điều đó không cần trình duyệt mở, để
// việc tự động chạy nền và Hộp thư cũng xuất được PowerPoint.
//
// Cách làm giống máy kiểm tra hiển thị (artcheck.ts): dựng trang slide trong Chromium (puppeteer-core, /usr/bin/chromium của container),
// nạp đúng ba thư viện khung xem dùng (html-to-image, pptxgenjs, JSZip ở public/vendor) cùng mã deckpptx đã biên dịch sang JS, rồi:
//   1) sxPptx (PPTX_FRAME_JS) đi từng slide, đo hộp chữ + chụp ảnh nền → dữ liệu slide;
//   2) buildPptx dựng tệp .pptx (ảnh nền + hộp chữ sửa được + biểu đồ gốc + Morph) ngay trong trang.
// deckpptx.ts không có import nào nên biên dịch bằng transpileModule rồi gắn vào window.__deck là đủ (không cần bundler).
import fs from "node:fs";
import path from "node:path";
import { buildDocCore, isDeck } from "./artdoc";
import { inlineImages } from "./artimg";
import { execRun, runner } from "./coderun";
import type { ArtType } from "./artifacts";

export type DeckInput = { type: ArtType; content: string; title: string; complete?: boolean };

// Cầu nối giả: không có khung cha, window.synchro / storage trả rỗng để script của slide vẫn chạy (giống CHECK_BRIDGE của artcheck.ts).
const EXPORT_BRIDGE = `<script>(function(){var none=function(){return Promise.resolve(null)};var storage={get:none,set:none,"delete":none,list:function(){return Promise.resolve([])},onChange:function(){return function(){}}};var api={complete:function(){return Promise.resolve("")},storage:storage};window.synchro=api;window.claude=api;try{window.storage=storage}catch(e){}})();</script>`;

// Ba thư viện khung xem dùng để xuất PowerPoint (bản trình duyệt ở public/vendor, không cài npm).
const VENDOR = { "html-to-image.js": "html-to-image-1.11.11.js", "jszip.js": "jszip-3.10.1.min.js", "pptxgen.js": "pptxgen-4.0.1.bundle.js" } as const;

// deckpptx.ts biên dịch sang JS trình duyệt (gắn mọi export vào window.__deck). Dùng typescript lúc chạy; nhớ lại để không biên dịch mỗi lần.
type Ts = {
  transpileModule: (input: string, opts: { compilerOptions: { module: number; target: number; removeComments?: boolean } }) => { outputText: string };
  ModuleKind: { CommonJS: number };
  ScriptTarget: { ES2019: number };
};
let deckJsCache: string | null = null;
/** deckpptx.ts biên dịch sang JS trình duyệt, bọc để gắn mọi export vào window.__deck (dùng để tiêm vào Chromium; export riêng để kiểm thử). */
export async function deckBrowserJs(): Promise<string> {
  if (deckJsCache) return deckJsCache;
  const mod = (await import(/* webpackIgnore: true */ "typescript")) as unknown as { default?: Ts } & Ts;
  const ts: Ts = mod.default ?? mod;
  const src = fs.readFileSync(path.join(process.cwd(), "app", "deckpptx.ts"), "utf8").replace(/^\s*"use client";?\s*/, "");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, removeComments: true } }).outputText;
  deckJsCache = `(function(){var exports={},module={exports:exports};\n${out}\n;window.__deck=module.exports;})();`;
  return deckJsCache;
}

// Script node chạy trong container: dựng slide, nạp thư viện, đo rồi dựng .pptx, ghi ra outputs/deck.pptx (và outputs/report.json khi lỗi).
const PPTX_JS = String.raw`const fs = require("fs"), puppeteer = require("puppeteer-core");
const html = fs.readFileSync("page.html", "utf8");
const lib = (f) => fs.readFileSync(f, "utf8");
(async () => {
  const errors = [];
  const px = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium", headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--hide-scrollbars", ...(px ? ["--proxy-server=" + px.protocol + "//" + px.host] : [])] });
  try {
    const page = await browser.newPage();
    if (px && px.username) await page.authenticate({ username: decodeURIComponent(px.username), password: decodeURIComponent(px.password) });
    page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 }).catch((e) => errors.push("Trang tải quá lâu: " + e.message));
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    await page.addScriptTag({ content: lib("html-to-image.js") });
    await page.addScriptTag({ content: lib("jszip.js") });
    await page.addScriptTag({ content: lib("pptxgen.js") });
    await page.addScriptTag({ content: lib("deck.js") });
    const b64 = await page.evaluate(async () => {
      if (!window.htmlToImage && self.htmlToImage) window.htmlToImage = self.htmlToImage;
      if (!window.__deck || typeof window.__deck.buildPptx !== "function") throw new Error("Không nạp được deckpptx");
      const result = {};
      window.post = (m) => { if (m && m.t === "pptx") result.done = m; };
      (0, eval)(window.__deck.PPTX_FRAME_JS);
      if (typeof window.sxPptx !== "function") throw new Error("Không có sxPptx");
      await new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error("Quá thời gian đo slide")), 180000);
        const iv = setInterval(() => { if (result.done) { clearInterval(iv); clearTimeout(t); ok(); } }, 50);
        try { window.sxPptx("x", ""); } catch (e) { clearInterval(iv); clearTimeout(t); no(e); }
      });
      const r = result.done;
      if (r.error) throw new Error(r.error);
      if (!r.slides || !r.slides.length) throw new Error("Không có slide nào để xuất");
      const blob = await window.__deck.buildPptx(r.slides, r.w, r.h, (document.title || "presentation").slice(0, 120));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      return btoa(bin);
    });
    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/deck.pptx", Buffer.from(b64, "base64"));
    if (errors.length) fs.writeFileSync("outputs/report.json", JSON.stringify({ errors: [...new Set(errors)].slice(0, 12) }));
  } finally { await browser.close(); }
})().catch((e) => { try { fs.mkdirSync("outputs", { recursive: true }); fs.writeFileSync("outputs/report.json", JSON.stringify({ error: String(e && e.stack || e).slice(0, 600) })); } catch {} console.error(String(e && e.stack || e)); process.exit(1); });
`;

export type DeckExport = { ok: true; data: Buffer; name: string } | { ok: false; error: string };

const slug = (s: string) => (s || "ban-trinh-bay").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ban-trinh-bay";

/** Xuất bản trình bày HTML thành .pptx ở máy chủ (dùng được trong việc tự động chạy nền và Hộp thư). origin: để nhúng ảnh ngoài đúng như khung xem. */
export async function exportDeckPptx(uid: string, a: DeckInput, origin: string): Promise<DeckExport> {
  if (a.type !== "html" || !isDeck({ type: a.type, content: a.content })) return { ok: false, error: "Chỉ xuất PowerPoint được từ bản trình bày (slide) dạng HTML." };
  if (a.complete === false) return { ok: false, error: "Bản trình bày chưa viết xong." };
  if (runner() !== "workspace") return { ok: false, error: "Máy chủ này chưa có Chromium để xuất PowerPoint (cần dịch vụ workspace)." };
  const vendorDir = path.join(process.cwd(), "public", "vendor");
  let vendorFiles: { path: string; data: Buffer }[];
  try {
    vendorFiles = Object.entries(VENDOR).map(([name, file]) => ({ path: name, data: fs.readFileSync(path.join(vendorDir, file)) }));
  } catch (e) {
    return { ok: false, error: `Thiếu thư viện xuất PowerPoint trên máy chủ: ${(e as Error).message}` };
  }
  const deckJs = await deckBrowserJs().catch((e) => { throw new Error(`Không biên dịch được deckpptx: ${(e as Error).message}`); });
  // Nhúng ảnh ngoài thành data: như khung xem, để ảnh nền chụp ra khớp điều người dùng thấy.
  const doc = buildDocCore(a.type, await inlineImages(a.content, uid), origin, "pptx", false, EXPORT_BRIDGE, { fixed: null }, a.title);
  let r;
  try {
    r = await execRun({ uid, net: true, web: true, timeout: 300, argv: ["node", "pptx.js"], files: [
      { path: "page.html", data: Buffer.from(doc) }, { path: "pptx.js", data: Buffer.from(PPTX_JS) }, { path: "deck.js", data: Buffer.from(deckJs) }, ...vendorFiles,
    ] });
  } catch (e) {
    return { ok: false, error: `Chưa xuất được PowerPoint: ${(e as Error).message}` };
  }
  const out = r.files.find((f) => f.path === "deck.pptx");
  if (!out || !out.data.length) {
    const rep = r.files.find((f) => f.path === "report.json");
    let detail = (r.stderr || r.stdout).slice(-600);
    if (rep) { try { const j = JSON.parse(rep.data.toString("utf8")) as { error?: string; errors?: string[] }; detail = j.error || (j.errors || []).join("; ") || detail; } catch { /* giữ detail */ } }
    return { ok: false, error: `Chưa xuất được PowerPoint (trình dựng lỗi): ${detail}` };
  }
  return { ok: true, data: out.data, name: `${slug(a.title)}.pptx` };
}
