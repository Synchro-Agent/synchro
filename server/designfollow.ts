// "Làm theo kiểu này": đọc phong cách từ một trang người dùng dán liên kết, từ ảnh chụp họ gửi, hoặc từ một artifact
// của chính họ, thành token Synchro dùng được (màu, phông trong bộ của Synchro, thang chữ, hình khối) và lưu thành
// phong cách "follow". Trang lạ chỉ được mở trong Chromium của sandbox workspace (mạng của sandbox chặn sẵn địa chỉ nội
// bộ), không bao giờ trên máy chủ. Ảnh chụp chỉ đi vào ngữ cảnh của model và ô xem trước của chính người đó; logo, chữ
// của trang không được đưa vào sản phẩm.
import "server-only";
import type { BriefFacets, Probe, RefTokens, TurnImageIn } from "../shared/designrefs";
import { kitFont, luminance } from "../shared/designrefs";
import { HIDE_MARKS, paletteFromPixels, TOKEN_PROBE, tokensFromProbe } from "../shared/designextract";
import { followTokens, NEUTRAL_TOKENS, rolesFromPalette } from "../shared/designpick";
import { FONT_SPEC, presetOf, type Preset } from "../shared/designpresets";
import { execRun, runner } from "./coderun";
import { limit } from "./ratelimit";
import { AuthError } from "./auth/errors";
import { addStyle, StyleError, type StoredStyle } from "./designstyles";

/**
 * Lỗi nói được cho người dùng (và cho model, để model báo lại đúng lý do). tpl là câu mẫu có chỗ trống {host},
 * {n}: giao diện dịch câu mẫu rồi mới điền, nên bản tiếng Anh không lẫn tiếng Việt.
 */
export class FollowError extends Error {
  constructor(public tpl: string, public vars: Record<string, string | number> = {}) {
    super(tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")));
  }
}
const PER_HOUR = 20;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_MAX = 12 * 1024 * 1024;

function gate(uid: string) {
  try {
    limit(`design-follow:${uid}`, PER_HOUR, 3_600_000);
  } catch (e) {
    const msg = "đã đọc phong cách {n} lần trong một giờ, hãy thử lại sau";
    if (e instanceof AuthError) throw new FollowError(msg, { n: PER_HOUR });
    throw e;
  }
}

/** Màu đọc từ điểm ảnh: thu ảnh về 320 px rồi gom màu (đủ cho bảng màu, nhanh). */
async function pixelsOf(img: Buffer) {
  const sharp = (await import("sharp")).default;
  const small = sharp(img).resize({ width: 320, withoutEnlargement: true }).flatten({ background: "#ffffff" });
  const { data, info } = await small.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return paletteFromPixels(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

export type FollowInput = {
  uid: string;
  facets: BriefFacets;
  /** Token của mẫu thư viện hợp đề nhất: cho thang chữ, hình khối khi ảnh không nói được những điều đó. */
  base: RefTokens | null;
  url?: string;
  image?: TurnImageIn;
  name?: string;
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
};

/** Đọc phong cách từ liên kết hoặc ảnh và lưu thành phong cách "follow" (hết hạn sau 30 ngày nếu không lưu). */
export async function followStyle(i: FollowInput): Promise<StoredStyle> {
  if (i.url) return fromUrl(i);
  if (i.image) return fromImage(i, i.image);
  throw new FollowError("không có liên kết hay ảnh để đọc phong cách");
}

async function fromImage(i: FollowInput, img: TurnImageIn): Promise<StoredStyle> {
  if (!IMAGE_TYPES.has(img.media_type)) throw new FollowError("ảnh phải là PNG, JPEG, WebP hoặc GIF");
  const buf = Buffer.from(img.data, "base64");
  if (!buf.length || buf.length > IMAGE_MAX) throw new FollowError("ảnh trống hoặc lớn hơn 12 MB");
  gate(i.uid);
  let colors;
  try {
    colors = rolesFromPalette(await pixelsOf(buf));
  } catch (e) {
    console.error("[designfollow] đọc điểm ảnh", e);
    throw new FollowError("không mở được ảnh này");
  }
  if (!colors) throw new FollowError("không đọc được màu từ ảnh này");
  const tokens = followTokens(colors, {}, i.base, i.facets);
  const d = new Date();
  const name = i.name ?? `Ảnh gửi ngày ${d.getDate()}/${d.getMonth() + 1}`;
  return addStyle(i.uid, { kind: "follow", name, source: "image", tokens, image: buf });
}

// Chạy trong container: mở trang, ẩn logo / hộp cookie, chờ phông và ảnh lười tải, chụp 1280 × tối đa 1600, đo token.
// UA chung, không mang thông tin người dùng; một trang, một lần mở.
const FOLLOW_JS = String.raw`const fs = require("fs"), puppeteer = require("puppeteer-core");
const cfg = JSON.parse(fs.readFileSync("follow.json", "utf8"));
const HIDE = ${HIDE_MARKS};
const PROBE = ${TOKEN_PROBE};
(async () => {
  const px = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
      ...(px ? ["--proxy-server=" + px.protocol + "//" + px.host] : [])] });
  const out = { ok: false, error: "", probe: null, hidden: 0, height: 0 };
  try {
    const page = await browser.newPage();
    if (px && px.username) await page.authenticate({ username: decodeURIComponent(px.username),
      password: decodeURIComponent(px.password) });
    await page.setUserAgent("Mozilla/5.0 (compatible; SynchroRefCapture/1.0)");
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const res = await page.goto(cfg.url, { waitUntil: "networkidle2", timeout: 30000 });
    if (res && res.status() >= 400) throw new Error("trang trả mã " + res.status());
    await page.evaluate(() => window.scrollTo(0, 1600)).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    out.hidden = await page.evaluate((src) => (0, eval)("(" + src + ")")(), HIDE.toString()).catch(() => 0);
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    out.height = await page.evaluate(() => Math.min(1600, document.documentElement.scrollHeight));
    const clip = { x: 0, y: 0, width: 1280, height: Math.max(400, out.height) };
    const shot = await page.screenshot({ type: "png", clip });
    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/shot.png", Buffer.from(shot));
    const probe = (src) => (0, eval)("(" + src + ")")(document.body);
    out.probe = await page.evaluate(probe, PROBE.toString()).catch(() => null);
    out.ok = true;
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 300);
  }
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync("outputs/report.json", JSON.stringify(out));
  await browser.close();
})();`;

const PRIVATE_HOST = new RegExp("^(?:localhost|.*\\.local|.*\\.internal|0\\.0\\.0\\.0|127\\.|10\\.|192\\.168\\."
  + "|169\\.254\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.|\\[)", "i");
/** Liên kết người dùng dán: chỉ http(s) tới máy công khai (sandbox còn chặn lần nữa ở tầng mạng). */
export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new FollowError("liên kết không hợp lệ");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FollowError("chỉ đọc được liên kết http hoặc https");
  if (PRIVATE_HOST.test(u.hostname) || u.username || u.password) throw new FollowError("chỉ đọc được trang công khai");
  u.hash = "";
  return u.toString();
}

async function fromUrl(i: FollowInput): Promise<StoredStyle> {
  const url = cleanUrl(i.url!);
  if (runner() !== "workspace") {
    throw new FollowError("máy chủ này chưa mở được trang web để đọc phong cách; hãy gửi ảnh chụp màn hình trang đó");
  }
  gate(i.uid);
  const host = new URL(url).hostname;
  i.onStatus?.(`Đang đọc phong cách từ trang ${host}`);
  let r;
  try {
    const files = [
      { path: "follow.js", data: Buffer.from(FOLLOW_JS) },
      { path: "follow.json", data: Buffer.from(JSON.stringify({ url })) },
    ];
    const argv = ["node", "follow.js"];
    r = await execRun({ uid: i.uid, net: true, web: true, timeout: 60, signal: i.signal, argv, files });
  } catch (e) {
    console.error("[designfollow] chạy trình duyệt", e);
    throw new FollowError("chưa mở được trang {host}", { host });
  }
  const rep = r.files.find((f) => f.path === "report.json");
  const shot = r.files.find((f) => f.path === "shot.png");
  let j: { ok: boolean; error: string; probe: Probe | null } | null = null;
  try {
    j = rep ? JSON.parse(rep.data.toString("utf8")) : null;
  } catch (e) {
    console.error("[designfollow] báo cáo hỏng", e);
  }
  if (!j?.ok || !shot) {
    const why = j?.error || (r.timedOut ? "trang tải quá lâu" : (r.stderr || r.stdout).slice(-200));
    throw new FollowError("chưa đọc được trang {host}: {why}", { host, why });
  }
  const palette = await pixelsOf(shot.data);
  const measured = j.probe ? tokensFromProbe(j.probe, palette) : { tokens: {}, measured: [] };
  const fromProbe = measured.tokens.colors ?? [];
  const colors = ["bg", "ink", "accent"].every((role) => fromProbe.some((c) => c.role === role))
    ? fromProbe
    : rolesFromPalette(palette);
  const noColor = "không đọc được màu của trang {host}; hãy gửi ảnh chụp màn hình thay thế";
  if (!colors) throw new FollowError(noColor, { host });
  const tokens = followTokens(colors, { ...measured.tokens, colors }, i.base, i.facets);
  const name = i.name ?? host;
  return addStyle(i.uid, { kind: "follow", name, source: "url", sourceUrl: url, tokens, image: shot.data });
}

// ---------------------------------------------------------------- từ artifact của chính người dùng
const familyKit = (family: string) => {
  const id = family.toLowerCase().replace(/\s+/g, "-");
  return kitFont(id) ? (id as RefTokens["fonts"]["head"]["kit"]) : "inter";
};
/** Token của một phong cách có sẵn (artifact không có bản trộn nhưng dùng data-sx-preset). */
export function presetTokens(p: Preset): RefTokens {
  const roles = ["bg", "surface", "raised", "ink", "muted", "accent", "accent2", "line", "pos", "neg"] as const;
  const hexOf = (role: (typeof roles)[number]) => (role === "accent" ? p.vivid ?? p.accent : role === "accent2"
    ? p.vivid2 ?? p.accent2 : p[role]);
  const colors = roles.map((role) => ({ hex: hexOf(role).toLowerCase(), role, share: 0 }));
  const f = (family: string, weight: number) => ({ kit: familyKit(family), seen: "", seenLicence: "open" as const,
    weight });
  return {
    theme: luminance(p.bg.toLowerCase()) < 0.18 ? "dark" : "light",
    colors,
    fonts: { head: f(p.head, 700), body: f(p.body, 400), mono: f(FONT_SPEC[p.mono] ? p.mono : "JetBrains Mono", 500) },
    type: { ...NEUTRAL_TOKENS.type, headLine: p.lh ?? 1.2 },
    tracking: { display: -0.025, heading: -0.02, body: 0, label: 0.1 },
    radius: { outer: p.r, inner: p.ri, pill: false },
    shadow: { level: p.shadow === "none" ? 0 : /5px 5px 0/.test(p.shadow) ? 2 : 1, css: p.shadow },
    spacing: { ...NEUTRAL_TOKENS.spacing },
    layout: { ...NEUTRAL_TOKENS.layout },
    imagery: { ...NEUTRAL_TOKENS.imagery, kind: "mixed", share: 0.3 },
  };
}

export type ArtifactSource = {
  content: string;
  /** Phong cách đang hiện trong khung (người dùng vừa thử đổi trong menu): khác bản trộn thì lấy phong cách đó. */
  preset?: string;
  png?: TurnImageIn;
};
/**
 * Token của một artifact: bản trộn đã ghi (data-sx-mix), không có thì phong cách có sẵn (data-sx-preset), không có nữa
 * thì màu đọc từ ảnh PNG trình duyệt gửi kèm. Không có gì cả: báo lỗi cần ảnh (StyleError 422).
 */
export async function artifactTokens(
  uid: string,
  a: ArtifactSource,
  mixOf: (uid: string, id: string) => { tokens: RefTokens; preset: string } | null,
  facets: BriefFacets,
): Promise<RefTokens> {
  const mixId = /data-sx-mix=["'](m-[0-9a-f]{8})["']/.exec(a.content)?.[1];
  const shown = a.preset ?? /data-sx-preset=["']([\w-]+)["']/.exec(a.content)?.[1];
  const rec = mixId ? mixOf(uid, mixId) : null;
  if (rec && (!shown || shown === rec.preset)) return rec.tokens;
  const p = shown ? presetOf(shown) : undefined;
  if (p) return presetTokens(p);
  if (a.png) {
    const colors = rolesFromPalette(await pixelsOf(Buffer.from(a.png.data, "base64")));
    if (colors) return followTokens(colors, {}, null, facets);
  }
  throw new StyleError("Artifact này không dùng bộ phong cách của Synchro: cần ảnh của artifact để đọc màu.", 422);
}
