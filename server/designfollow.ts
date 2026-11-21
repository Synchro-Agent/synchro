// "Làm theo kiểu này": đọc phong cách từ một trang người dùng dán liên kết, từ ảnh chụp họ gửi, hoặc từ một artifact
// của chính họ, thành token Synchro dùng được (màu, phông trong bộ của Synchro, thang chữ, hình khối) và lưu thành
// phong cách "follow". Trang lạ chỉ được mở trong Chromium của sandbox workspace (mạng của sandbox chặn sẵn địa chỉ nội
// bộ), không bao giờ trên máy chủ. Ảnh chụp chỉ đi vào ngữ cảnh của model và ô xem trước của chính người đó; logo, chữ
// của trang không được đưa vào sản phẩm.
import "server-only";
import { isIP } from "node:net";
import type { BriefFacets, Probe, RefTokens, TurnImageIn } from "../shared/designrefs";
import { kitFont, luminance } from "../shared/designrefs";
import { HIDE_MARKS, paletteFromPixels, TOKEN_PROBE, tokensFromProbe } from "../shared/designextract";
import { followTokens, NEUTRAL_TOKENS, rolesFromPalette } from "../shared/designpick";
import { FONT_SPEC, presetOf, type Preset } from "../shared/designpresets";
import { execRun, runner } from "./coderun";
import { isPrivate } from "./safefetch";
import { limit } from "./ratelimit";
import { AuthError } from "./auth/errors";
import { addStyle, StyleError, type StoredStyle } from "./designstyles";

/**
 * Lỗi nói được cho người dùng (và cho model, để model báo lại đúng lý do). tpl là một câu mẫu cố định có chỗ trống
 * {host}, {n}, {code}: giao diện dịch câu mẫu rồi mới điền, nên bản tiếng Anh không lẫn tiếng Việt. Giá trị điền chỉ là
 * tên máy người dùng đã gõ hoặc con số, không bao giờ là chữ của trang lạ hay của sandbox.
 */
const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
export class FollowError extends Error {
  constructor(public tpl: string, public vars: Record<string, string | number> = {}) {
    super(fill(tpl, vars));
  }
  /** Câu cho model: không nêu tên trang (model không được "làm giống <hãng>"), chỉ lý do. */
  forModel(): string {
    return fill(this.tpl, { ...this.vars, host: "đó" });
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
  /** Tên người dùng đặt; không đặt thì để trống, giao diện tự gọi tên theo nguồn bằng ngôn ngữ của người xem. */
  name?: string;
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
};
/** Phong cách vừa đọc, chưa lưu: lượt ẩn danh dùng thẳng trong bộ nhớ, lượt thường lưu bằng followStyle. */
export type FollowRead = {
  name: string;
  source: "url" | "image";
  sourceUrl: string | null;
  tokens: RefTokens;
  image: Buffer;
};

/** Đọc phong cách từ liên kết hoặc ảnh, không ghi gì xuống đĩa hay cơ sở dữ liệu. */
export async function readFollow(i: FollowInput): Promise<FollowRead> {
  const r = i.url ? await fromUrl(i) : i.image ? await fromImage(i, i.image) : null;
  if (!r) throw new FollowError("không có liên kết hay ảnh để đọc phong cách");
  return { ...r, tokens: unseen(r.tokens) };
}
/** Đọc phong cách từ liên kết hoặc ảnh và lưu thành phong cách "follow" (hết hạn sau 30 ngày nếu không lưu). */
export async function followStyle(i: FollowInput): Promise<StoredStyle> {
  const r = await readFollow(i);
  return addStyle(i.uid, { kind: "follow", ...r });
}
// Tên phông trang nguồn tự khai (font-family) là chữ của trang lạ và có thể là phông độc quyền: token chỉ giữ phông
// trong bộ của Synchro (kit), bỏ tên đã thấy trước khi lưu hay đưa vào lời nhắc.
const unseen = (t: RefTokens): RefTokens => {
  const clear = <F extends { seen: string; seenLicence: string }>(f: F): F => ({ ...f, seen: "", seenLicence: "open" });
  const fonts = { head: clear(t.fonts.head), body: clear(t.fonts.body), mono: t.fonts.mono && clear(t.fonts.mono) };
  return { ...t, fonts };
};

async function fromImage(i: FollowInput, img: TurnImageIn): Promise<FollowRead> {
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
  return { name: i.name ?? "", source: "image", sourceUrl: null, tokens, image: buf };
}

// Chạy trong container: mở trang, ẩn logo / hộp cookie, chờ phông và ảnh lười tải, chụp 1280 × tối đa 1600, đo token.
// UA chung, không mang thông tin người dùng; một trang, một lần mở. Lỗi chỉ ra một mã cố định (status, timeout, open):
// lời nhắn lỗi do trang tự đặt (getter ném lỗi tùy ý) chỉ nằm ở detail để máy chủ ghi nhật ký, không tới model hay
// giao diện.
const FOLLOW_JS = String.raw`const fs = require("fs");
const puppeteer = require("puppeteer-core");
const cfg = JSON.parse(fs.readFileSync("follow.json", "utf8"));
const HIDE = ${HIDE_MARKS};
const PROBE = ${TOKEN_PROBE};
(async () => {
  const px = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
      ...(px ? ["--proxy-server=" + px.protocol + "//" + px.host] : [])] });
  const out = { ok: false, reason: "", status: 0, detail: "", probe: null, hidden: 0, height: 0 };
  try {
    const page = await browser.newPage();
    if (px && px.username) await page.authenticate({ username: decodeURIComponent(px.username),
      password: decodeURIComponent(px.password) });
    await page.setUserAgent("Mozilla/5.0 (compatible; SynchroRefCapture/1.0)");
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const res = await page.goto(cfg.url, { waitUntil: "networkidle2", timeout: 30000 });
    if (res && res.status() >= 400) {
      out.status = res.status();
      throw new Error("http " + res.status());
    }
    // Cuộn xuống để ảnh lười tải hiện ra. Trang chặn cuộn (script lỗi, khung cố định) thì vẫn chụp phần đầu trang.
    await page.evaluate(() => window.scrollTo(0, 1600)).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    // Về đầu trang không được thì ảnh chụp lệch xuống một đoạn, màu và chữ vẫn đọc được.
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    // Không ẩn được logo (trang chặn eval): vẫn chụp; ảnh chỉ vào ngữ cảnh model kèm lời dặn không chép logo.
    out.hidden = await page.evaluate((src) => (0, eval)("(" + src + ")")(), HIDE.toString()).catch(() => 0);
    // Phông chưa tải xong thì chụp với phông dự phòng: màu và bố cục vẫn đúng, phông lấy theo bộ của Synchro.
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    // Trang tự đặt scrollHeight ném lỗi hay trả giá trị lạ: chụp đúng một khung nhìn.
    const tall = await page.evaluate(() => Math.min(1600, document.documentElement.scrollHeight)).catch(() => 800);
    out.height = Number.isFinite(tall) ? tall : 800;
    const clip = { x: 0, y: 0, width: 1280, height: Math.max(400, out.height) };
    const shot = await page.screenshot({ type: "png", clip });
    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/shot.png", Buffer.from(shot));
    const probe = (src) => (0, eval)("(" + src + ")")(document.body);
    // Đo token hỏng trên trang này: máy chủ đọc màu từ điểm ảnh của ảnh chụp thay cho số đo.
    out.probe = await page.evaluate(probe, PROBE.toString()).catch(() => null);
    out.ok = true;
  } catch (e) {
    out.reason = out.status ? "status" : e && e.name === "TimeoutError" ? "timeout" : "open";
    out.detail = String((e && e.message) || e).slice(0, 300);
  }
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync("outputs/report.json", JSON.stringify(out));
  await browser.close();
})();`;

const LOCAL_NAME = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal)$/i;
/**
 * Liên kết người dùng dán: chỉ http(s) tới máy công khai. Địa chỉ IP dùng đúng bộ kiểm địa chỉ nội bộ của safefetch;
 * tên miền trỏ vào mạng trong và chuyển hướng sang địa chỉ nội bộ do tường lửa của sandbox chặn.
 */
export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new FollowError("liên kết không hợp lệ");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FollowError("chỉ đọc được liên kết http hoặc https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const inside = isIP(host) ? isPrivate(host) : LOCAL_NAME.test(host) || !host.includes(".");
  if (inside || u.username || u.password) throw new FollowError("chỉ đọc được trang công khai");
  u.hash = "";
  return u.toString();
}

type Report = { ok: boolean; reason: string; status: number; detail: string; probe: Probe | null };
/** Lỗi trang về một câu mẫu cố định; mã HTTP chỉ nhận số hợp lệ. */
function pageError(host: string, j: Report | null, timedOut: boolean): FollowError {
  const code = j?.status ?? 0;
  if (j?.reason === "status" && Number.isInteger(code) && code >= 400 && code <= 599) {
    return new FollowError("trang {host} trả mã lỗi {code}", { host, code });
  }
  if (j?.reason === "timeout" || timedOut) return new FollowError("trang {host} tải quá lâu", { host });
  return new FollowError("chưa mở được trang {host}", { host });
}

async function fromUrl(i: FollowInput): Promise<FollowRead> {
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
  let j: Report | null = null;
  try {
    j = rep ? JSON.parse(rep.data.toString("utf8")) : null;
  } catch (e) {
    console.error("[designfollow] báo cáo hỏng", e);
  }
  if (!j?.ok || !shot) {
    // Chữ lỗi của trang và đuôi stderr chỉ vào nhật ký máy chủ; người dùng và model nhận lý do cố định.
    const tail = (r.stderr || r.stdout || "").slice(-300);
    console.error("[designfollow] không đọc được trang", host, j?.reason, j?.detail ?? "", tail);
    throw pageError(host, j, r.timedOut);
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
  return { name: i.name ?? "", source: "url", sourceUrl: url, tokens, image: shot.data };
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
