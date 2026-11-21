// Đọc token thiết kế từ trang đang mở hoặc từ điểm ảnh của ảnh chụp: dùng chung cho bộ chụp mẫu, "Làm theo kiểu này"
// và vòng chấm (đo sản phẩm vừa dựng để so với mẫu).
import type {
  ColorRole,
  FontCat,
  KitFontId,
  PaletteColor,
  Probe,
  ProbeText,
  ProbeTokens,
  RefColor,
  RefFont,
  RefTokens,
  TokenField,
} from "./designrefs";
import { DARK_BG_MAX, KIT_FONTS, contrastRatio, isHex, luminance } from "./designrefs";

/** Mã nguồn một hàm chạy trong trang: (root: Element) => Probe | null. */
// Chạy trong trình duyệt nên phải tự chứa, không import gì. Toạ độ tính từ góc trên của root (cộng phần đã cuộn
// khi root là cả trang), nên "màn đầu" luôn là y < vh. Giới hạn số phần tử để trang nặng vẫn đo xong trong vài trăm
// mili giây.
export const TOKEN_PROBE = String.raw`(root) => {
  root = root || document.body;
  if (!root || !root.getBoundingClientRect) return null;
  const whole = root === document.body || root === document.documentElement;
  const box = root.getBoundingClientRect();
  const R = whole ? { left: 0, top: -scrollY, width: innerWidth, height: innerHeight } : box;
  const vw = Math.round(R.width);
  const vh = Math.round(whole ? innerHeight : box.height);
  if (vw < 50 || vh < 50) return null;
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // Màu máy tính trả về (rgb, color(srgb …), oklch) đọc qua canvas về [r, g, b, a].
  const rgba = (c) => {
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return [0, 0, 0, 0];
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = "#000";
    cv.fillStyle = c;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const hex = (c) => "#" + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, "0")).join("");
  const css = new Map();
  const st = (el) => {
    let s = css.get(el);
    if (!s) {
      s = getComputedStyle(el);
      css.set(el, s);
    }
    return s;
  };
  // Nền thật phía sau một phần tử: chồng các lớp màu của tổ tiên; gặp ảnh nền thì không biết màu ("").
  const bgMemo = new Map();
  const bgOf = (el) => {
    if (bgMemo.has(el)) return bgMemo.get(el);
    const layers = [];
    let onImage = false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = st(e);
      if (/url\(/.test(s.backgroundImage)) {
        onImage = true;
        break;
      }
      const c = rgba(s.backgroundColor);
      if (c[3] > 0.01) {
        layers.push(c);
        if (c[3] > 0.99) break;
      }
    }
    let base = [255, 255, 255, 1];
    for (const c of layers.reverse()) base = over(c, base);
    const out = onImage && !layers.length ? "" : hex(base);
    bgMemo.set(el, out);
    return out;
  };
  const shown = (el) => {
    const s = st(el);
    return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.05;
  };
  const rel = (r) => ({
    x: Math.round(r.left - R.left),
    y: Math.round(r.top - R.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  });
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const LIMIT_Y = vh * 3;
  // Tailwind chồng 4-5 lớp vòng trong suốt trước bóng thật: bỏ lớp không nhìn thấy, và chỉ cắt ở dấu phẩy giữa hai lớp
  // để bóng ghi lại luôn là CSS hợp lệ.
  const shadowOf = (v) => {
    if (!v || v === "none") return "";
    const layers = [];
    let depth = 0;
    let cur = "";
    for (const ch of v) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        layers.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    layers.push(cur.trim());
    let out = "";
    for (const layer of layers) {
      const fn = layer.match(/[a-z]+\([^()]*\)|#[0-9a-f]{3,8}/i);
      const color = fn ? fn[0] : layer.split(/\s+/).find((w) => /^[a-z]+$/i.test(w) && w !== "inset") || "";
      if (!layer || (color && rgba(color)[3] <= 0.01)) continue;
      const next = out ? out + ", " + layer : layer;
      if (next.length > 300) break;
      out = next;
    }
    return out;
  };

  // Chữ: gom theo phần tử cha của từng nút chữ, bỏ chữ ẩn, chữ nằm ngoài ba màn đầu.
  const textEls = new Map();
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let nodes = 0;
  for (let t; (t = tw.nextNode()) && nodes < 4000; ) {
    nodes++;
    const v = t.nodeValue.replace(/\s+/g, " ").trim();
    if (!v || !t.parentElement) continue;
    const el = t.parentElement;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName)) continue;
    textEls.set(el, (textEls.get(el) || "") + " " + v);
  }
  const texts = [];
  for (const [el, raw] of textEls) {
    if (texts.length >= 400) break;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const q = rel(r);
    if (q.y > LIMIT_Y || q.y + q.h < 0 || q.x > vw || q.x + q.w < 0) continue;
    const s = st(el);
    const size = px(s.fontSize);
    if (size < 6) continue;
    const v = raw.trim();
    const ls = s.letterSpacing === "normal" ? 0 : px(s.letterSpacing) / size;
    const lh = s.lineHeight === "normal" ? 1.2 : px(s.lineHeight) / size;
    const fg = rgba(s.webkitTextFillColor || s.color);
    const bg = bgOf(el);
    const under = bg ? rgba(bg) : [255, 255, 255, 1];
    const letters = v.replace(/[^\p{L}]/gu, "");
    const caps = letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    texts.push({
      tag: el.tagName.toLowerCase(),
      size: Math.round(size * 10) / 10,
      weight: parseInt(s.fontWeight, 10) || 400,
      family: s.fontFamily.slice(0, 120),
      tracking: Math.round(ls * 1000) / 1000,
      line: Math.round(lh * 100) / 100,
      upper: s.textTransform === "uppercase" || caps,
      color: hex(over(fg, under)),
      bg,
      chars: v.length,
      ...q,
    });
  }

  // Khối: phần tử có nền khác nền cha, có viền, bóng hoặc bo góc nhìn thấy được.
  const all = [...root.querySelectorAll("*")].slice(0, 6000);
  const boxes = [];
  for (const el of all) {
    if (boxes.length >= 600) break;
    if (/^(SCRIPT|STYLE|svg|path|IMG|VIDEO|CANVAS|BR|HTML|HEAD)$/i.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    const q = rel(r);
    if (q.y > vh * 2 || q.y + q.h < 0) continue;
    if (!shown(el)) continue;
    const s = st(el);
    const own = rgba(s.backgroundColor);
    const parentBg = el.parentElement ? bgOf(el.parentElement) : "#ffffff";
    const fill = own[3] > 0.05 ? bgOf(el) : "";
    const bw = px(s.borderTopWidth);
    const border = s.borderTopStyle !== "none" && bw > 0 && rgba(s.borderTopColor)[3] > 0.05
      ? Math.round(bw) + "px " + hex(over(rgba(s.borderTopColor), rgba(parentBg || "#ffffff")))
      : "";
    const shadow = shadowOf(s.boxShadow);
    const rad = s.borderTopLeftRadius.endsWith("%")
      ? (px(s.borderTopLeftRadius) / 100) * Math.min(r.width, r.height)
      : px(s.borderTopLeftRadius);
    const differs = fill && fill !== parentBg;
    if (!differs && !border && !shadow) continue;
    boxes.push({ ...q, radius: Math.round(rad), shadow, bg: fill, border });
  }

  // Hình: ảnh, video, canvas, SVG lớn và ảnh nền; data-sx-hero đánh dấu hình chủ đạo của sản phẩm Synchro.
  const media = [];
  for (const el of all) {
    if (media.length >= 120) break;
    const tag = el.tagName.toLowerCase();
    const s = st(el);
    let kind = "";
    if (tag === "img" || tag === "picture") kind = "img";
    else if (tag === "video") kind = "video";
    else if (tag === "canvas") kind = "canvas";
    else if (tag === "svg" && !el.parentElement?.closest("svg")) kind = "svg";
    else if (/url\(/.test(s.backgroundImage)) kind = "bg";
    if (!kind) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) continue;
    const q = rel(r);
    if (q.y > LIMIT_Y || q.y + q.h < 0 || !shown(el)) continue;
    media.push({ ...q, kind: kind === "picture" ? "img" : kind, hero: !!el.closest("[data-sx-hero]") });
  }

  // Khoảng cách: gap của lưới / flex và đệm trên dưới của các khối rộng (phần, băng ngang).
  const gaps = [];
  const paddings = [];
  const widths = new Map();
  let columns = 1;
  for (const el of all) {
    const s = st(el);
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    const q = rel(r);
    if (q.y > vh * 2 || q.y + q.h < 0) continue;
    if (/flex|grid/.test(s.display) && gaps.length < 300) {
      for (const g of [px(s.rowGap), px(s.columnGap)]) if (g > 0) gaps.push(Math.round(g));
    }
    if (r.width >= vw * 0.6 && paddings.length < 300) {
      for (const p of [px(s.paddingTop), px(s.paddingBottom)]) if (p >= 8) paddings.push(Math.round(p));
    }
    const mw = px(s.maxWidth);
    if (mw >= 320 && mw <= 2400 && r.width >= vw * 0.35 && r.width < vw - 8) {
      const k = Math.round(r.width / 10) * 10;
      widths.set(k, (widths.get(k) || 0) + r.height);
    }
    // Số cột: các con cùng hàng (đỉnh lệch dưới 8px), mỗi con đủ rộng và cao, cộng lại chiếm quá nửa bề ngang.
    if (el.children.length >= 2 && el.children.length <= 24 && r.width >= vw * 0.5) {
      const kids = [...el.children]
        .map((c) => c.getBoundingClientRect())
        .filter((b) => b.width >= 120 && b.height >= 40);
      const rows = new Map();
      for (const b of kids) {
        const key = [...rows.keys()].find((y) => Math.abs(y - b.top) < 8) ?? b.top;
        const row = rows.get(key) || [];
        row.push(b);
        rows.set(key, row);
      }
      for (const row of rows.values()) {
        const span = row.reduce((a, b) => a + b.width, 0);
        if (row.length > columns && row.length <= 6 && span >= vw * 0.5) columns = row.length;
      }
    }
  }
  let maxWidth = 0;
  let best = 0;
  for (const [w, weight] of widths) {
    if (weight > best) {
      best = weight;
      maxWidth = w;
    }
  }
  if (!maxWidth) {
    const first = texts.filter((t) => t.y < vh);
    const left = Math.min(...first.map((t) => t.x));
    const right = Math.max(...first.map((t) => t.x + t.w));
    maxWidth = first.length ? Math.min(vw, Math.round(right - Math.max(0, left))) : vw;
  }

  // Nền trang: màu nền gặp nhiều nhất trên lưới điểm của màn đầu (trang có băng tối toàn chiều ngang vẫn đúng).
  const votes = new Map();
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 10; j++) {
      const x = R.left + ((i + 0.5) / 16) * vw;
      const y = (whole ? 0 : box.top) + ((j + 0.5) / 10) * vh;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (!whole && !root.contains(hit))) continue;
      const c = bgOf(hit);
      if (c) votes.set(c, (votes.get(c) || 0) + 1);
    }
  }
  let pageBg = whole ? bgOf(document.body) : bgOf(root);
  let top = 0;
  for (const [c, n] of votes) {
    if (n > top) {
      top = n;
      pageBg = c;
    }
  }

  // Phông: họ phông khai báo cho chữ và mặt phông của trang. "loaded" chỉ đúng khi trình duyệt có phông đó thật:
  // fonts.check() trả true cả với tên không tồn tại, nên so thêm bề rộng chữ với phông dự phòng.
  const GENERIC =
    /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|-apple-system|blinkmacsystemfont|inherit)$/i;
  const fams = new Set();
  for (const t of texts) {
    const f = t.family.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (f && !GENERIC.test(f)) fams.add(f);
  }
  if (document.fonts) for (const f of document.fonts) fams.add(String(f.family).replace(/^["']|["']$/g, ""));
  const sample = "mmmmmmmmmmlli ẤỖự ởệ 0123";
  const width = (font) => {
    cv.font = font;
    return cv.measureText(sample).width;
  };
  const avail = (f) => width("72px monospace") !== width('72px "' + f + '", monospace')
    || width("72px serif") !== width('72px "' + f + '", serif');
  const fonts = [];
  for (const f of [...fams].slice(0, 30)) {
    let loaded = false;
    try {
      loaded = document.fonts.check('16px "' + f + '"') && avail(f);
    } catch (e) {
      // Tên phông có ký tự lạ làm check() ném lỗi cú pháp: coi là chưa tải, không làm hỏng cả lần đo.
      loaded = false;
    }
    fonts.push({ family: f, loaded });
  }

  return {
    url: location.href,
    vw,
    vh,
    scrollH: Math.round(whole ? document.documentElement.scrollHeight : root.scrollHeight),
    pageBg,
    texts,
    boxes,
    media,
    gaps,
    paddings,
    maxWidth,
    columns,
    fonts,
  };
}`;

/** Mã nguồn một hàm chạy trong trang: ẩn logo, dấu thương hiệu, hộp cookie trước khi chụp; trả số phần tử đã ẩn. */
// Logo chỉ ẩn bằng visibility để bố cục giữ nguyên chỗ trống; hộp cookie, khung chat, lớp phủ đăng ký thì bỏ hẳn
// vì chúng che nội dung. Dấu hiệu chung của mọi khung trang: tên lớp / id / alt có chữ logo, brand, wordmark; tên miền
// trong alt / aria-label; liên kết đầu tiên ở góc trên trái; dải logo khách hàng (nhiều hình nhỏ, gần như
// không có chữ).
export const HIDE_MARKS = String.raw`() => {
  let n = 0;
  const MARK = /(^|[^a-z])(logo|logos|logotype|wordmark|brand-?mark|site-?brand|navbar-brand|brand)([^a-z]|$)/i;
  const STRIP = /customer|client|partner|trusted|sponsor|featured-in|press-logos|as-seen/i;
  const OVERLAY = /cookie|consent|gdpr|onetrust|didomi|truste|cmp-|usercentrics|osano|termly|iubenda|klaro/i;
  const WIDGET = /intercom|drift-|crisp|hubspot-messages|zendesk|tawk|livechat|fb-customerchat|chat-widget|launcher/i;
  const labels = location.hostname.replace(/^www\./, "").split(".");
  const shortSld = labels.length > 2 && labels[labels.length - 2].length <= 3;
  const brand = (shortSld ? labels[labels.length - 3] : labels[0]) || "";
  const BRAND = brand.length >= 3 ? new RegExp(brand.replace(/[^a-z0-9]/gi, ".?"), "i") : null;
  const hide = (el, how) => {
    if (!el || el.dataset.sxHidden) return;
    el.dataset.sxHidden = how;
    if (how === "gone") el.style.setProperty("display", "none", "important");
    else el.style.setProperty("visibility", "hidden", "important");
    n++;
  };
  const tag = (el) => [el.id, el.getAttribute("class"), el.getAttribute("alt"), el.getAttribute("aria-label"),
    el.getAttribute("title"), el.getAttribute("src"), el.getAttribute("data-testid")].join(" ");
  const small = (el, w = 480, h = 220) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.width <= w && r.height <= h;
  };
  for (const el of document.querySelectorAll("img,svg,picture,a,div,span,figure,i")) {
    if (n > 600) break;
    const t = tag(el);
    // Khối lớn mang chữ "brand" thường là cả một phần trang, không phải logo.
    if (MARK.test(t) && small(el)) hide(el, "mark");
    else if (BRAND && /^(IMG|svg|PICTURE)$/.test(el.tagName) && BRAND.test(t) && small(el, 420, 180)) hide(el, "mark");
  }
  // Liên kết đầu tiên ở góc trên trái có hình hoặc chữ ngắn là logo dù không gắn tên.
  const top = [...document.querySelectorAll("a")]
    .map((a) => ({ a, r: a.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.top + scrollY < 140 && r.left < innerWidth * 0.4)
    .sort((x, y) => x.r.left - y.r.left)[0];
  if (top && (top.a.querySelector("img,svg,picture") || (top.a.innerText || "").trim().split(/\s+/).length <= 2)) {
    hide(top.a, "mark");
  }
  for (const a of document.querySelectorAll('header a[href="/"], nav a[href="/"], a[href="./"], a[rel="home"]')) {
    for (const el of a.querySelectorAll("img,svg,picture")) hide(el, "mark");
  }
  // Logo dạng "hình + chữ ngắn" (<a><svg/>Cursor</a>) không phải lúc nào cũng là liên kết đầu tiên bên trái (có nút
  // Menu, nút đổi ngôn ngữ đứng trước), và ẩn mỗi hình thì chữ thương hiệu vẫn còn. Ở dải 140 px trên cùng, liên kết
  // có hình kèm chữ ngắn mà trỏ về trang chủ hoặc mang tên miền thì ẩn cả liên kết; liên kết có biểu tượng khác (tài
  // liệu, tải về) giữ nguyên vì chúng là một phần thanh điều hướng.
  const LOOSE = brand.length >= 3
    ? new RegExp(brand.replace(/[^a-z0-9]/gi, "").split("").join("[\\s._-]?"), "i")
    : null;
  const homeLink = (a) => {
    const href = (a.getAttribute("href") || "").trim();
    if (/^(\.?\/|\/index\.html?|#|#top)$/i.test(href) || a.getAttribute("rel") === "home") return true;
    try {
      const u = new URL(href, location.href);
      return /^https?:$/.test(u.protocol) && u.host === location.host && /^\/?$/.test(u.pathname) && !u.hash;
    } catch (e) {
      // href hỏng thì không phải liên kết về trang chủ; bỏ qua, không dừng việc ẩn logo.
      return false;
    }
  };
  for (const a of document.querySelectorAll("a")) {
    const r = a.getBoundingClientRect();
    if (!r.width || r.top + scrollY >= 140 || !small(a, 360, 120)) continue;
    const words = (a.innerText || "").trim();
    const short = words.split(/\s+/).filter(Boolean).length <= 3;
    const named = LOOSE && LOOSE.test(words + " " + tag(a));
    if (a.querySelector("img,svg,picture") && short && (homeLink(a) || named)) hide(a, "mark");
  }
  // Dải logo khách hàng / đối tác: từ 4 hình nhỏ trở lên, gần như không có chữ.
  for (const el of document.querySelectorAll("section,div,ul")) {
    const pics = [...el.querySelectorAll("img,svg")]
      .filter((p) => !p.parentElement.closest("svg") && small(p, 260, 120) && p.getBoundingClientRect().width >= 40);
    if (pics.length < 4) continue;
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length > 90 && !STRIP.test(tag(el))) continue;
    if (!small(el, innerWidth + 40, 420)) continue;
    for (const p of pics) hide(p, "mark");
  }
  const POPUP =
    /modal|popup|pop-up|overlay|newsletter|geo-?|locale|country|region-?select|interstitial|lightbox|backdrop/i;
  const vpArea = innerWidth * innerHeight;
  for (const el of document.querySelectorAll("div,section,aside,iframe,dialog,form")) {
    const t = tag(el) + " " + (el.getAttribute("role") || "");
    if (OVERLAY.test(t) || WIDGET.test(t)) {
      hide(el, "gone");
      continue;
    }
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && !(s.position === "absolute" && POPUP.test(t))) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0))
      * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (area < 1) continue;
    const words = (el.innerText || "").toLowerCase();
    const notice = /cookie|consent|privacy|quyền riêng tư|newsletter|subscribe|đăng ký nhận/.test(words);
    const dialog = el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true"
      || el.tagName === "DIALOG" || POPUP.test(t);
    const asks = !!el.querySelector("button,input,select,a[role=button]");
    const media = !!el.querySelector("canvas,video");
    const tint = s.backgroundColor.match(/[\d.]+/g);
    const veil = tint && tint.length === 4 && +tint[3] > 0.15 && +tint[3] < 0.95;
    const scrim = !words.trim() && area > vpArea * 0.8 && veil;
    // Thanh điều hướng cố định ở đỉnh trang và nền WebGL toàn màn là một phần thiết kế; chỉ bỏ hộp nổi đòi người xem
    // bấm (cookie, chọn quốc gia, mời đăng ký) và lớp nền tối của chúng.
    const topBar = r.top <= 4 && r.height < 140;
    if (scrim || (!topBar && !media && ((notice && r.top > 40) || (dialog && asks) || (asks && area > vpArea * 0.15
      && +s.zIndex >= 10 && words.length < 1500)))) {
      hide(el, "gone");
    }
  }
  for (const el of document.querySelectorAll('iframe[src*="chat"], iframe[title*="chat" i]')) hide(el, "gone");
  document.documentElement.style.setProperty("overflow", "auto", "important");
  document.body.style.setProperty("overflow", "auto", "important");
  return n;
}`;

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: readonly number[]) =>
  "#" + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
// Khoảng cách màu "redmean": rẻ như RGB nhưng gần cảm nhận của mắt hơn, đủ để gộp nhiễu nén ảnh.
function dist(a: Rgb, b: Rgb): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
const chroma = (c: Rgb) => Math.max(...c) - Math.min(...c);
function hueOf(c: Rgb): number {
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
// Dưới ngưỡng này hai màu là một màu đã qua nén / khử răng cưa; trên đó mắt thấy khác.
const MERGE = 48;

/**
 * Bảng màu từ điểm ảnh RGBA (ảnh chụp, poster, trang PDF): gom màu gần nhau, xếp theo diện tích.
 * Màu nhấn chiếm ít diện tích vẫn được giữ chỗ, vì một nút cam 2% diện tích quyết định cả bảng màu hơn ba sắc xám nền.
 */
export function paletteFromPixels(rgba: Uint8Array, w: number, h: number, max = 8): PaletteColor[] {
  const total = w * h;
  if (!total || max < 1 || rgba.length < total * 4) return [];
  // Lấy mẫu thưa trên ảnh lớn: khoảng 160 nghìn điểm đủ ổn định cho tỉ lệ diện tích.
  const step = Math.max(1, Math.floor(Math.sqrt(total / 160_000)));
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let counted = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key);
      if (bin) {
        bin.n++;
        bin.r += r;
        bin.g += g;
        bin.b += b;
      } else {
        bins.set(key, { n: 1, r, g, b });
      }
      counted++;
    }
  }
  if (!counted) return [];
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  type Cluster = { n: number; sum: Rgb; c: Rgb };
  const clusters: Cluster[] = [];
  const nearest = (c: Rgb) => {
    let best: Cluster | null = null;
    let d = Infinity;
    for (const k of clusters) {
      const e = dist(c, k.c);
      if (e < d) {
        d = e;
        best = k;
      }
    }
    return { best, d };
  };
  for (const [i, bin] of sorted.entries()) {
    const c: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    const { best, d } = nearest(c);
    // Hàng nghìn ô lẻ cuối danh sách là nhiễu: chỉ gộp vào cụm có sẵn, không mở cụm mới.
    if (best && (d < MERGE || i >= 3000)) {
      best.n += bin.n;
      best.sum = [best.sum[0] + bin.r, best.sum[1] + bin.g, best.sum[2] + bin.b];
      best.c = [best.sum[0] / best.n, best.sum[1] / best.n, best.sum[2] / best.n];
    } else {
      clusters.push({ n: bin.n, sum: [bin.r, bin.g, bin.b], c });
    }
  }
  const rows = clusters
    .map((k) => ({ hex: toHex(k.c), share: k.n / counted, rgb: k.c }))
    .filter((k) => k.share >= 0.002)
    .sort((a, b) => b.share - a.share);
  const keep = rows.slice(0, Math.max(1, max - 2));
  const vivid = rows
    .filter((k) => !keep.includes(k) && chroma(k.rgb) >= 60 && k.share >= 0.003)
    .sort((a, b) => chroma(b.rgb) * Math.sqrt(b.share) - chroma(a.rgb) * Math.sqrt(a.share));
  for (const k of vivid) {
    if (keep.length >= max) break;
    if (keep.every((x) => dist(x.rgb, k.rgb) >= MERGE * 1.5)) keep.push(k);
  }
  for (const k of rows) {
    if (keep.length >= max) break;
    if (!keep.includes(k)) keep.push(k);
  }
  return keep
    .sort((a, b) => b.share - a.share)
    .map((k) => ({ hex: k.hex, share: Math.round(k.share * 10000) / 10000 }));
}

// Tách danh sách bóng CSS theo dấu phẩy nằm ngoài ngoặc của hàm màu.
function splitShadows(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of css) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
// Chrome ghi màu đã tính theo không gian màu của trang: rgb() cho sRGB, oklab() / oklch() / color() cho Tailwind 4 và
// CSS màu mới. Mọi hàm màu phải được tách ra trước khi đọc độ lệch, nếu không số bên trong bị đọc nhầm thành x/y/blur.
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gi;
const HEX_COLOR = /#[0-9a-f]{3,8}\b/gi;
const COLOR_WORDS = new Set(["transparent", "black", "white", "currentcolor"]);
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem)?$/i;
const numOf = (v: string) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));

function alphaOf(shadow: string): number {
  const fn = shadow.match(COLOR_FN)?.[0];
  if (fn) {
    const inner = fn.slice(fn.indexOf("(") + 1, -1);
    // Cú pháp mới "r g b / a"; cú pháp cũ rgba(r, g, b, a) / hsla(h, s, l, a) có đúng bốn thành phần.
    const slash = inner.split("/");
    if (slash.length === 2) return numOf(slash[1].trim());
    const parts = inner.split(",").map((x) => x.trim());
    return parts.length === 4 ? numOf(parts[3]) : 1;
  }
  const hex = shadow.match(HEX_COLOR)?.[0];
  if (hex && (hex.length === 5 || hex.length === 9)) {
    const a = hex.length === 5 ? hex[4] + hex[4] : hex.slice(7, 9);
    return parseInt(a, 16) / 255;
  }
  return /\btransparent\b/i.test(shadow) ? 0 : 1;
}

/**
 * Một lớp bóng đúng ngữ pháp box-shadow: tuỳ chọn inset, 2-4 độ dài, nhiều nhất một màu (hàm màu, #hex hoặc vài từ
 * khoá). Bóng đọc từ trang người dùng dán vào được dán thẳng vào CSS của sản phẩm, nên ký tự lạ (";", "}", url()) làm
 * cả lớp bị loại thay vì lọt vào.
 */
function shadowLayerOk(layer: string): boolean {
  if (layer.length > 160) return false;
  const fns = layer.match(COLOR_FN) ?? [];
  if (fns.some((f) => !/^[a-z]+\([a-z0-9.\s,%/+-]*\)$/i.test(f) || f.length > 90)) return false;
  const rest = layer.replace(COLOR_FN, " ").trim().split(/\s+/).filter(Boolean);
  let lengths = 0;
  let colors = fns.length;
  for (const tok of rest) {
    if (/^inset$/i.test(tok)) continue;
    if (LENGTH.test(tok)) {
      // Độ dài khác 0 phải có đơn vị: "2" (bị cắt từ "2px") là CSS hỏng, trình duyệt bỏ cả khai báo.
      if (parseFloat(tok) !== 0 && !/[a-z]$/i.test(tok)) return false;
      lengths++;
    } else if (/^#[0-9a-f]{3,8}$/i.test(tok) || COLOR_WORDS.has(tok.toLowerCase())) {
      colors++;
    } else {
      return false;
    }
  }
  return lengths >= 2 && lengths <= 4 && colors <= 1;
}

/**
 * box-shadow an toàn để dán vào CSS: bỏ lớp hỏng và lớp trong suốt, giữ tối đa 300 ký tự (cắt giữa hai lớp), không còn
 * lớp nào thì "none".
 */
export function cleanShadow(css: string): string {
  if (typeof css !== "string" || !css.trim() || /^\s*none\s*$/i.test(css)) return "none";
  let out = "";
  for (const layer of splitShadows(css.slice(0, 2000))) {
    if (!shadowLayerOk(layer) || alphaOf(layer) <= 0.01) continue;
    const next = out ? `${out}, ${layer}` : layer;
    if (next.length > 300) break;
    out = next;
  }
  return out || "none";
}

/** Chuỗi bóng đã lưu có dán được vào CSS không: đúng ngữ pháp từng lớp, ngoặc cân, "none" cũng hợp lệ. */
export function shadowCssOk(css: string): boolean {
  if (css === "none") return true;
  if (typeof css !== "string" || !css.trim()) return false;
  let depth = 0;
  for (const ch of css) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0 && splitShadows(css).every(shadowLayerOk);
}

/**
 * Bậc bóng 0-3 từ box-shadow: 0 không bóng (hoặc chỉ là viền vẽ bằng bóng), 1 bóng mịn sát thẻ,
 * 2 bóng nổi rõ hoặc bóng cứng kiểu in (lệch, không nhòe), 3 bóng sâu tỏa rộng.
 * Độ đậm (alpha) giảm bậc: bóng rộng nhưng gần trong suốt vẫn là bóng mịn.
 */
export function shadowLevel(css: string): 0 | 1 | 2 | 3 {
  if (!css || /^\s*none\s*$/i.test(css)) return 0;
  let level: 0 | 1 | 2 | 3 = 0;
  for (const s of splitShadows(css)) {
    if (/\binset\b/i.test(s)) continue;
    const nums = (s.replace(COLOR_FN, " ").replace(HEX_COLOR, " ").match(/-?\d*\.?\d+(px)?/g) ?? [])
      .map((v) => parseFloat(v));
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    const alpha = alphaOf(s);
    if (alpha <= 0.01) continue;
    if (!blur && !x && !y) continue;
    let l: 0 | 1 | 2 | 3;
    if (!blur) {
      l = Math.max(Math.abs(x), Math.abs(y)) >= 3 ? 2 : 1;
    } else {
      const strength = (blur + 2 * Math.abs(y) + Math.max(0, spread)) * Math.min(1, alpha * 4);
      l = strength <= 10 ? 1 : strength <= 40 ? 2 : 3;
    }
    if (l > level) level = l;
  }
  return level;
}

// Phông hay gặp trên trang thật → phông gần nhất trong bộ (cùng cấu trúc nét, độ rộng, độ tương phản).
// Phông độc quyền chỉ được ghi lại để biết trang dùng gì; sản phẩm luôn dùng phông trong bộ.
const words = (...parts: string[]) => new RegExp(parts.join("|"), "i");
const NEAR: [RegExp, KitFontId][] = [
  [/mono|code|consol|courier|menlo|monaco|sf mono|fira code|ibm plex mono|space mono/i, "jetbrains-mono"],
  [/be vietnam/i, "be-vietnam-pro"],
  [/plus jakarta|jakarta/i, "plus-jakarta-sans"],
  [words("ibm plex sans", "plex sans", "source sans", "fira sans", "open sans", "lato", "frutiger", "myriad", "segoe",
    "noto sans", "calibri"), "ibm-plex-sans"],
  [/bricolage|cabinet grotesk|neue machina|pp mori|obviously/i, "bricolage-grotesque"],
  [/space grotesk|neue montreal|basier|mona sans|hubot|right grotesk|clash grotesk/i, "space-grotesk"],
  [/lexend|atkinson|readex/i, "lexend"],
  [/unbounded|syne|clash display|monument extended|druk wide|krona|lexend zetta|dela gothic|righteous/i, "unbounded"],
  [/anton|druk|impact|tungsten|bebas kai|league gothic|knockout|haettenschweiler|six caps/i, "anton"],
  [words("oswald", "bebas", "barlow condensed", "roboto condensed", "fjalla", "antonio", "big shoulders", "condensed",
    "compressed", "narrow"), "oswald"],
  [/archivo|franklin|work sans|gt america|founders grotesk|die grotesk|public sans|chivo|national|untitled sans/i,
    "archivo"],
  [/montserrat|gotham|futura|proxima|avenir|nunito sans|raleway|josefin|brandon|gilroy|cera/i, "montserrat"],
  [words("circular|satoshi|dm sans|poppins|manrope|outfit|urbanist|general sans|sofia|product sans|google sans",
    "mark pro|eina|matter|aeonik|gilmer|switzer|roundhog|nunito"), "plus-jakarta-sans"],
  [/inter|helvetica|arial|sf pro|-apple-system|system-ui|roboto|haas|aktiv|söhne|sohne|graphik|suisse|geist|neue/i,
    "inter"],
  [words("fraunces", "cooper", "recoleta", "gt alpina", "tiempos headline", "lyon display", "roslindale", "gt sectra",
    "domaine", "reckless"), "fraunces"],
  [/garamond|cormorant|caslon|sabon|bembo|jenson|minion|perpetua/i, "cormorant-garamond"],
  [/playfair|didot|bodoni|canela|freight big|gt super|editorial new|ogg|chronicle display|abril|dm serif display/i,
    "playfair-display"],
  [words("source serif|georgia|times|tiempos|charter|merriweather|lora|pt serif|spectral|noto serif|publico",
    "freight text|literata|newsreader|crimson|baskerville|cambria"), "source-serif-4"],
];
const OPEN_SEEN = words(
  "inter|be vietnam|plus jakarta|montserrat|ibm plex|archivo|bricolage|space grotesk|lexend|unbounded|oswald|anton",
  "playfair|fraunces|source serif|source sans|cormorant|jetbrains|roboto|open sans|lato|poppins|dm sans|dm serif",
  "manrope|outfit|urbanist|work sans|public sans|nunito|raleway|merriweather|lora|pt serif|spectral|noto|fira|bebas",
  "syne|chivo|libre|eb garamond|crimson|newsreader|literata|geist|atkinson|barlow|josefin|space mono",
);
const PROPRIETARY_SEEN = words(
  "helvetica|arial|sf pro|söhne|sohne|graphik|circular|gotham|proxima|avenir|futura|tiempos|canela|gt |neue haas",
  "aktiv|suisse|druk|freight|publico|segoe|calibri|georgia|times|didot|bodoni|founders|untitled|national|brandon",
  "cera|gilroy|sofia pro|product sans|google sans|apercu|basier|domaine|reckless",
);

const firstFamily = (seen: string) =>
  seen
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .find((f) => f && !/^(serif|sans-serif|monospace|system-ui|ui-\w+|inherit|initial)$/i.test(f)) ?? "";

/** Phông trong bộ Synchro gần nhất với phông trang đang dùng (tên hoặc cả chuỗi font-family). */
export function nearestKitFont(seen: string, cat: FontCat): KitFontId {
  const name = firstFamily(seen) || seen;
  const exact = KIT_FONTS.find((f) => f.family.toLowerCase() === name.toLowerCase());
  if (exact) return exact.id;
  if (cat === "mono") return "jetbrains-mono";
  for (const [re, id] of NEAR) {
    if (!re.test(name)) continue;
    const kit = KIT_FONTS.find((f) => f.id === id);
    // Tên trùng một nhóm khác loại đã biết (vd. "Neue" trong tên một phông có chân) thì bỏ qua gợi ý đó.
    const fits = cat === "serif" ? kit?.cat === "serif" : kit?.cat !== "serif" && kit?.cat !== "mono";
    if (fits) return id;
  }
  if (cat === "serif") return /display|headline|poster/i.test(name) ? "playfair-display" : "source-serif-4";
  if (cat === "display") return /condensed|narrow|compressed/i.test(name) ? "oswald" : "bricolage-grotesque";
  return /grotesk|grotesque/i.test(name) ? "space-grotesk" : "inter";
}

/** Loại phông đoán từ tên và phông dự phòng chung của chuỗi font-family. */
export function fontCatOf(seen: string): FontCat {
  const name = firstFamily(seen);
  if (/mono|code|consol|courier|menlo/i.test(name) || /(^|,)\s*monospace\s*$/i.test(seen)) return "mono";
  const near = NEAR.find(([re]) => re.test(name))?.[1];
  const kit = near ? KIT_FONTS.find((f) => f.id === near) : undefined;
  if (/sans/i.test(name) && kit?.cat !== "display") return "sans";
  if (kit) return kit.cat;
  if (/serif/i.test(name) || /(^|,)\s*serif\s*$/i.test(seen)) return "serif";
  if (/display|condensed|compressed|poster|black/i.test(name)) return "display";
  return "sans";
}

const weighted = <T>(rows: { key: T; w: number }[]): T[] => {
  const m = new Map<T, number>();
  for (const r of rows) m.set(r.key, (m.get(r.key) ?? 0) + r.w);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
};
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

const mix = (a: string, b: string) => toHex(rgbOf(a).map((v, i) => (v + rgbOf(b)[i]) / 2));
const finite = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const hexOr = (v: unknown) => (typeof v === "string" && isHex(v) ? v : "");
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const list = <T>(v: unknown, max: number, each: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v.slice(0, max) : [])
    .map((x) => (x && typeof x === "object" ? each(x as Record<string, unknown>) : null))
    .filter((x): x is T => x !== null);
const MEDIA_KINDS = new Set(["img", "video", "canvas", "svg", "bg"]);

/**
 * Kết quả đo đến từ trang lạ (trang người dùng dán để "Làm theo kiểu này"): trang có thể ghi đè hàm của trình duyệt
 * và trả bất cứ thứ gì. Chỉ giữ đúng hình dạng Probe, số hữu hạn trong khoảng hợp lý, chuỗi có giới hạn, màu #rrggbb,
 * bóng đúng ngữ pháp; sai ở cấp trên cùng thì bỏ cả kết quả.
 */
export function cleanProbe(raw: unknown): Probe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.vw, 50, 20_000) || !finite(r.vh, 50, 50_000)) return null;
  const vw = r.vw;
  const vh = r.vh;
  const coord = (x: Record<string, unknown>) =>
    finite(x.x, -1e5, 1e5) && finite(x.y, -1e5, 1e6) && finite(x.w, 0, 1e5) && finite(x.h, 0, 1e6)
      ? { x: x.x, y: x.y, w: x.w, h: x.h }
      : null;
  const texts = list(r.texts, 2000, (t) => {
    const at = coord(t);
    if (!at || !finite(t.size, 1, 2000) || !finite(t.weight, 1, 1000) || !finite(t.chars, 0, 1e6)) return null;
    return {
      tag: /^[a-z][a-z0-9-]{0,19}$/i.test(String(t.tag)) ? String(t.tag).toLowerCase() : "span",
      size: t.size,
      weight: t.weight,
      family: str(t.family, 200),
      tracking: finite(t.tracking, -1, 2) ? t.tracking : 0,
      line: finite(t.line, 0.1, 10) ? t.line : 1.2,
      upper: t.upper === true,
      color: hexOr(t.color),
      bg: hexOr(t.bg),
      chars: t.chars,
      ...at,
    };
  });
  const boxes = list(r.boxes, 1000, (b) => {
    const at = coord(b);
    if (!at) return null;
    const border = typeof b.border === "string" && /^\d{1,3}px #[0-9a-f]{6}$/.test(b.border) ? b.border : "";
    return {
      ...at,
      // Tailwind rounded-full ra 33554400px (calc(infinity * 1px)): vẫn là viên thuốc, chỉ chặn số vô hạn và âm.
      radius: finite(b.radius, 0, Number.MAX_VALUE) ? Math.min(b.radius, 1e9) : 0,
      shadow: cleanShadow(str(b.shadow, 2000)),
      bg: hexOr(b.bg),
      border,
    };
  });
  const media = list(r.media, 300, (m) => {
    const at = coord(m);
    if (!at || !MEDIA_KINDS.has(String(m.kind))) return null;
    return { ...at, kind: String(m.kind) as Probe["media"][number]["kind"], hero: m.hero === true };
  });
  const nums = (v: unknown) => (Array.isArray(v) ? v.slice(0, 1000) : []).filter((n) => finite(n, 0, 5000));
  return {
    url: str(r.url, 2000),
    vw,
    vh,
    scrollH: finite(r.scrollH, 0, 1e6) ? r.scrollH : vh,
    pageBg: hexOr(r.pageBg),
    texts,
    boxes,
    media,
    gaps: nums(r.gaps),
    paddings: nums(r.paddings),
    maxWidth: finite(r.maxWidth, 0, 20_000) ? r.maxWidth : vw,
    columns: finite(r.columns, 1, 24) ? Math.round(r.columns) : 1,
    fonts: list(r.fonts, 100, (f) => ({ family: cleanSeen(str(f.family, 200)), loaded: f.loaded === true })),
  };
}

// Gán vai cho màu: nền, chữ, chữ phụ, nhấn, nhấn 2, bề mặt, viền. Mỗi bảng có đúng một nền, một chữ, một nhấn.
function colorsOf(p: Probe, palette: PaletteColor[]): RefColor[] {
  const pal = palette.filter((c) => isHex(c.hex));
  const bg = isHex(p.pageBg) ? p.pageBg : pal[0]?.hex;
  if (!bg) return [];
  const bgRgb = rgbOf(bg);
  const reading = p.texts.filter((t) => isHex(t.color) && t.chars >= 2 && t.y < p.vh * 2);
  const weightOf = (t: ProbeText) => t.chars * Math.min(3, t.size / 14);
  const textColors = weighted(reading.map((t) => ({ key: t.color, w: weightOf(t) })));
  const total = reading.reduce((a, t) => a + weightOf(t), 0) || 1;
  const shareText = (c: string) => reading.filter((t) => t.color === c).reduce((a, t) => a + weightOf(t), 0) / total;
  const fromPal = pal
    .filter((c) => dist(rgbOf(c.hex), bgRgb) >= MERGE)
    .sort((a, b) => contrastRatio(b.hex, bg) - contrastRatio(a.hex, bg))
    .map((c) => c.hex);
  // Chữ chính là màu tương phản cao nhất trong các màu chữ chiếm phần đáng kể; màu xám nhiều chữ hơn là chữ phụ.
  const major = textColors.filter((c, i) => i < 4 && shareText(c) >= 0.05 && contrastRatio(c, bg) >= 3);
  const ink = major.sort((a, b) => contrastRatio(b, bg) - contrastRatio(a, bg))[0] ?? textColors[0] ?? fromPal[0]
    ?? (luminance(bg) <= DARK_BG_MAX ? "#ffffff" : "#111111");
  const inkRgb = rgbOf(ink);
  const isNeutral = (hex: string) => chroma(rgbOf(hex)) < 40;
  const muted = textColors.find((c) => dist(rgbOf(c), inkRgb) >= 30 && isNeutral(c) && contrastRatio(c, bg) >= 2.2)
    ?? pal.map((c) => c.hex).find((c) => {
      const r = contrastRatio(c, bg);
      return isNeutral(c) && r >= 2.2 && r < contrastRatio(ink, bg) - 1 && dist(rgbOf(c), inkRgb) >= 30;
    });
  // Ứng viên màu nhấn: nền nút / thẻ nhỏ, chữ có màu, màu đậm sắc trong ảnh chụp; trọng số theo diện tích nhìn thấy.
  const vivid: { key: string; w: number }[] = [];
  for (const b of p.boxes) {
    if (!isHex(b.bg) || chroma(rgbOf(b.bg)) < 50 || b.y > p.vh * 2) continue;
    vivid.push({ key: b.bg, w: Math.min(b.w * b.h, 40_000) / 400 + 20 });
  }
  for (const t of p.texts) {
    if (isHex(t.color) && chroma(rgbOf(t.color)) >= 50) vivid.push({ key: t.color, w: t.chars * 2 });
  }
  for (const c of pal) if (chroma(rgbOf(c.hex)) >= 50) vivid.push({ key: c.hex, w: c.share * 3000 });
  const groups: { hex: string; w: number }[] = [];
  for (const v of vivid) {
    const g = groups.find((x) => dist(rgbOf(x.hex), rgbOf(v.key)) < MERGE);
    if (g) g.w += v.w;
    else groups.push({ hex: v.key, w: v.w });
  }
  groups.sort((a, b) => b.w - a.w);
  // Màu nhấn trùng nền thì không nhìn thấy, trùng chữ thì không còn là nhấn: nền đỏ của poster là nền, không phải nhấn.
  // Trang đơn sắc không có màu nào đủ sắc: nhấn là màu khác hẳn nền và chữ trong ảnh, hoặc chữ phụ.
  const apart = (hex: string) => dist(rgbOf(hex), bgRgb) >= MERGE && dist(rgbOf(hex), inkRgb) >= MERGE;
  const accent = groups.find((g) => apart(g.hex))?.hex
    ?? pal.map((c) => c.hex).find(apart)
    ?? muted
    ?? mix(ink, bg);
  const accentHue = hueOf(rgbOf(accent));
  const accent2 = groups.find((g) => g.hex !== accent && apart(g.hex)
    && hueGap(hueOf(rgbOf(g.hex)), accentHue) >= 40)?.hex;
  const darkBg = luminance(bg) <= DARK_BG_MAX;
  const surfaces = weighted(
    p.boxes
      .filter((b) => isHex(b.bg) && dist(rgbOf(b.bg), bgRgb) >= 8 && dist(rgbOf(b.bg), bgRgb) < 90)
      .filter((b) => chroma(rgbOf(b.bg)) < 50)
      .map((b) => ({ key: b.bg, w: b.w * b.h })),
  );
  const surface = surfaces[0];
  const raised = surfaces.slice(1).find((c) => {
    const lift = luminance(c) - luminance(surface ?? bg);
    return darkBg ? lift > 0 : Math.abs(lift) > 0.01;
  });
  const lines = weighted(
    p.boxes
      .filter((b) => b.border)
      .map((b) => ({ key: b.border.split(" ").pop() ?? "", w: b.w + b.h }))
      .filter((r) => isHex(r.key) && r.key !== bg),
  );
  const out: RefColor[] = [];
  const add = (hex: string | undefined, role: ColorRole) => {
    if (!hex || !isHex(hex) || out.some((c) => c.role === role)) return;
    out.push({ hex, role, share: 0 });
  };
  add(bg, "bg");
  add(surface, "surface");
  add(raised, "raised");
  add(ink, "ink");
  add(muted, "muted");
  add(accent, "accent");
  add(accent2, "accent2");
  add(lines[0], "line");
  const greens = groups.find((g) => g.hex !== accent && hueOf(rgbOf(g.hex)) >= 90 && hueOf(rgbOf(g.hex)) <= 165);
  const reds = groups.find((g) => {
    const h = hueOf(rgbOf(g.hex));
    return g.hex !== accent && (h >= 345 || h <= 15);
  });
  if (greens && reds) {
    add(greens.hex, "pos");
    add(reds.hex, "neg");
  }
  // Diện tích của mỗi màu trong ảnh chụp thuộc về vai gần nó nhất, để nền và bề mặt gần màu không cùng nhận 90%.
  for (const c of pal) {
    const rgb = rgbOf(c.hex);
    const near = out.reduce((a, b) => (dist(rgbOf(b.hex), rgb) < dist(rgbOf(a.hex), rgb) ? b : a), out[0]);
    if (near && dist(rgbOf(near.hex), rgb) < MERGE) near.share = round(near.share + c.share, 3);
  }
  return out;
}

// Chữ thân: ưu tiên cỡ 14-22px; ảnh giao diện dựng bằng HTML trong trang (bảng, danh sách 12-13px) không phải chữ thân.
function bodyTexts(p: Probe): ProbeText[] {
  const prose = (lo: number, hi: number) =>
    p.texts.filter((t) => t.size >= lo && t.size <= hi && !/^h[1-6]$/.test(t.tag) && t.chars >= 2);
  const main = prose(14, 22);
  return main.reduce((a, t) => a + t.chars, 0) >= 200 ? main : prose(11, 24);
}
/**
 * Tên phông đã thấy, rút về chữ, số, dấu cách và gạch nối (tối đa 4 từ, 40 ký tự): font-family do trang tự đặt, mà
 * tên này đi vào câu lệnh cho model, nên không để trang nhét câu lệnh hay mã vào đó.
 */
export function cleanSeen(name: string): string {
  return String(name ?? "")
    // next/font đặt tên kiểu "__GeistSans_fb8f2c": bỏ phần băm để còn tên phông thật.
    .replace(/^_+|_[0-9a-f]{5,8}$/gi, "")
    .replace(/_/g, " ")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ")
    .slice(0, 40)
    .trim();
}
function fontOf(t: ProbeText | undefined, cat?: FontCat): RefFont | null {
  if (!t) return null;
  const seen = cleanSeen(firstFamily(t.family) || t.family.split(",")[0]);
  const c = cat ?? fontCatOf(t.family);
  const kit = nearestKitFont(t.family, c);
  const sameAsKit = KIT_FONTS.some((f) => f.family.toLowerCase() === seen.toLowerCase());
  const closed = PROPRIETARY_SEEN.test(seen) ? "proprietary" : "unknown";
  const seenLicence = sameAsKit || OPEN_SEEN.test(seen) ? "open" : closed;
  return { kit, seen, seenLicence, weight: t.weight };
}

// Tỉ lệ thang chữ: căn bậc (số bậc) của tiêu đề lớn nhất chia chữ thân. Trang chỉ có hai cỡ (thân 18, tiêu đề 64)
// vẫn là một thang nhiều bậc bỏ trống, nên số bậc ít nhất bằng số bậc của thang 1.333 phủ cùng khoảng.
function ratioOf(sizes: number[], base: number): number {
  const steps = sizes.filter((s) => s >= base * 1.1);
  if (!steps.length || !base) return 1.25;
  const top = Math.max(...steps) / base;
  const n = Math.max(steps.length, Math.round(Math.log(top) / Math.log(1.333)));
  const r = top ** (1 / n);
  return round(Math.min(1.8, Math.max(1.067, r)), 3);
}

/**
 * Token đo được từ một lần chạy TOKEN_PROBE (và bảng màu điểm ảnh nếu có). Chỉ trả trường đo được; `measured` liệt kê
 * các trường đó để người duyệt biết trường nào còn phải chấm bằng mắt (ánh sáng, ống kính, chủ thể của hình).
 */
export function tokensFromProbe(raw: Probe, rawPalette: PaletteColor[]): ProbeTokens {
  const tokens: Partial<RefTokens> = {};
  const measured: TokenField[] = [];
  const p = cleanProbe(raw);
  if (!p) return { tokens, measured };
  const palette = (Array.isArray(rawPalette) ? rawPalette : [])
    .filter((c) => c && isHex(c.hex) && finite(c.share, 0, 1))
    .slice(0, 16);
  const colors = colorsOf(p, palette);
  const bg = colors.find((c) => c.role === "bg")?.hex;
  if (bg) {
    tokens.theme = luminance(bg) <= DARK_BG_MAX ? "dark" : "light";
    tokens.colors = colors;
    measured.push("theme", "colors");
  }
  const readable = p.texts.filter((t) => t.chars >= 2);
  if (!readable.length) return { tokens, measured };

  const body = bodyTexts(p);
  const bodyFamily = weighted(body.map((t) => ({ key: t.family, w: t.chars })))[0];
  const bodyRows = body.filter((t) => t.family === bodyFamily);
  const basePx = weighted(bodyRows.map((t) => ({ key: Math.round(t.size), w: t.chars })))[0] ?? 16;
  const bodyRef = bodyRows.find((t) => Math.round(t.size) === basePx) ?? bodyRows[0] ?? readable[0];
  const firstViews = readable.filter((t) => t.y < p.vh * 2);
  const head = [...(firstViews.length ? firstViews : readable)].sort((a, b) => b.size - a.size || b.chars - a.chars)[0];
  const mono = readable.find((t) => fontCatOf(t.family) === "mono" || /^(code|pre|kbd)$/.test(t.tag));
  const headFont = fontOf(head);
  const bodyFont = fontOf(bodyRef, fontCatOf(bodyRef.family) === "display" ? "sans" : undefined);
  if (headFont && bodyFont) {
    tokens.fonts = { head: headFont, body: bodyFont, mono: fontOf(mono, "mono") };
    measured.push("fonts");
  }

  const sizes = [...new Set(readable.map((t) => Math.round(t.size)))].sort((a, b) => b - a);
  const distinct: number[] = [];
  for (const s of sizes) if (!distinct.some((d) => Math.abs(d - s) <= 1)) distinct.push(s);
  tokens.type = {
    basePx,
    ratio: ratioOf(distinct, basePx),
    sizes: distinct.slice(0, 8),
    headLine: round(head.line, 2),
    bodyLine: round(bodyRef.line, 2),
    headCase: head.upper ? "upper" : "none",
  };
  const mean = (rows: ProbeText[], fallback: number) => {
    const w = rows.reduce((a, t) => a + t.chars, 0);
    return w ? round(rows.reduce((a, t) => a + t.tracking * t.chars, 0) / w, 3) : fallback;
  };
  const headings = readable.filter((t) => t.size >= 20 && t.size < 40);
  const labels = readable.filter((t) => t.size <= 14 && t.upper);
  const heading = mean(headings, head.tracking);
  tokens.tracking = {
    display: head.size >= 40 ? round(head.tracking, 3) : heading,
    heading,
    body: round(bodyRef.tracking, 3),
    label: mean(labels.length ? labels : readable.filter((t) => t.size <= 13), 0),
  };
  measured.push("type", "tracking");

  const isPill = (b: Probe["boxes"][number]) => b.h <= 72 && b.radius >= b.h / 2 - 1;
  const cards = p.boxes.filter((b) => b.w * b.h >= 20_000 && !isPill(b) && b.w < p.vw - 4);
  const small = p.boxes.filter((b) => b.h <= 64 && b.w <= 420 && !isPill(b));
  const outer = Math.round(median(cards.map((b) => b.radius)));
  const inner = small.length ? Math.round(median(small.map((b) => b.radius))) : Math.round(outer * 0.6);
  tokens.radius = { outer, inner: Math.min(inner, Math.max(outer, inner)), pill: p.boxes.some(isPill) };
  const shadows = weighted(p.boxes.filter((b) => b.shadow !== "none").map((b) => ({ key: b.shadow, w: b.w * b.h })));
  const shadowCss = shadows.find((s) => shadowLevel(s) > 0) ?? "none";
  tokens.shadow = { level: shadowLevel(shadowCss), css: shadowCss };
  measured.push("radius", "shadow");

  const values = [...p.gaps, ...p.paddings].filter((v) => v >= 4);
  const on8 = values.filter((v) => v % 8 === 0).length;
  const sections = p.paddings.filter((v) => v >= 40);
  const gutters = p.gaps.filter((v) => v >= 8 && v <= 80);
  const section = sections.length ? Math.round(median(sections)) : 64;
  tokens.spacing = {
    unit: values.length && on8 / values.length >= 0.6 ? 8 : 4,
    section,
    gutter: gutters.length ? Math.round(median(gutters)) : 24,
    density: section >= 96 ? "airy" : section < 56 ? "dense" : "balanced",
  };

  const { empty, media, kinds } = coverage(p);
  const firstMedia = p.media.filter((m) => m.y < p.vh);
  const cx = head.x + head.w / 2;
  const centred = Math.abs(cx - p.vw / 2) < p.vw * 0.06 && head.w < p.vw * 0.9;
  const mediaSide = firstMedia.some((m) => m.w * m.h >= p.vw * p.vh * 0.12
    && Math.abs(m.x + m.w / 2 - cx) > p.vw * 0.25);
  tokens.layout = {
    columns: Math.max(1, Math.min(6, p.columns)),
    maxWidth: Math.round(p.maxWidth || p.vw),
    align: centred ? "center" : mediaSide ? "asymmetric" : "left",
    emptyShare: round(empty, 2),
  };
  measured.push("spacing", "layout");

  const order = [...kinds.entries()].sort((a, b) => b[1] - a[1]);
  const kindOf = (k: string): RefTokens["imagery"]["kind"] =>
    k === "svg" ? "illustration" : k === "canvas" ? "3d" : "photo";
  const kind: RefTokens["imagery"]["kind"] = media < 0.06 || !order.length
    ? "type-only"
    : order.length > 1 && order[1][1] >= 0.1 && kindOf(order[0][0]) !== kindOf(order[1][0])
      ? "mixed"
      : kindOf(order[0][0]);
  tokens.imagery = { kind, share: round(media, 2), light: "", lens: "", grade: "", subject: "" };
  return { tokens, measured };
}

// Lưới 40×25 ô phủ màn đầu: ô có chữ, hình hoặc khối khác nền là ô có nội dung. Đủ chính xác cho tỉ lệ trống, rẻ hơn
// hợp diện tích hình chữ nhật thật nhiều.
function coverage(p: Probe): { empty: number; media: number; kinds: Map<string, number> } {
  const C = 40;
  const Rn = 25;
  const full = new Uint8Array(C * Rn);
  const pic = new Uint8Array(C * Rn);
  const kinds = new Map<string, number>();
  const mark = (r: { x: number; y: number; w: number; h: number }, grid: Uint8Array) => {
    let n = 0;
    const x0 = Math.max(0, Math.floor((r.x / p.vw) * C));
    const x1 = Math.min(C, Math.ceil(((r.x + r.w) / p.vw) * C));
    const y0 = Math.max(0, Math.floor((r.y / p.vh) * Rn));
    const y1 = Math.min(Rn, Math.ceil(((r.y + r.h) / p.vh) * Rn));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!grid[y * C + x]) n++;
        grid[y * C + x] = 1;
      }
    }
    return n;
  };
  for (const t of p.texts) mark(t, full);
  for (const b of p.boxes) if (b.bg && b.bg !== p.pageBg && b.w < p.vw - 4) mark(b, full);
  for (const m of p.media) {
    mark(m, full);
    const n = mark(m, pic);
    kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + n / (C * Rn));
  }
  const filled = full.reduce((a, v) => a + v, 0);
  const media = pic.reduce((a, v) => a + v, 0) / (C * Rn);
  return { empty: 1 - filled / (C * Rn), media, kinds };
}
