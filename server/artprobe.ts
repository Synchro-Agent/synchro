// Đo thêm cho check_artifact (artcheck.ts), chạy trong Chromium cùng PROBE: chữ tràn khỏi thẻ, tiêu đề rớt một chữ, tương phản theo WCAG.
// Chỉ báo cho model tự sửa, không tự thu nhỏ chữ: thu nhỏ âm thầm che lỗi bố cục, chữ về 11px vẫn "vừa khung" mà người xem không đọc nổi (đo ở tests/ui/design-kit.mjs).
// Không đo được thì bỏ qua (chữ trên ảnh, gradient, video): model tự nhìn ảnh chụp. Báo nhầm tốn cả một vòng sửa của model, sót thì còn ảnh chụp.
// Tệp thuần, không phụ thuộc gì: chạy được cả trong kiểm thử bằng Chrome.
import "server-only";
export const DESIGN_PROBE = String.raw`(root, deck, boxes, add, say) => {
  const TITLE = "h1,h2,h3,h4,.sx-title,.sx-display,.sx-h2,.sx-h3";
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // Màu máy tính trả về (rgb, color(srgb …), oklch) đọc qua canvas về [r, g, b, a].
  const rgba = (c) => { if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return [0, 0, 0, 0]; cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (a, b) => [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  // Nền thật phía sau chữ: các lớp nằm dưới ở đúng điểm đó (kể cả hình đặt tuyệt đối), trang cuộn chưa tới thì theo cha. null: không đo được.
  const under = (el, r) => {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementsFromPoint(x, y) : [];
    const i = hit.indexOf(el);
    const stack = i >= 0 ? hit.slice(i) : []; if (!stack.length) for (let p = el; p; p = p.parentElement) stack.push(p);
    const layers = [];
    for (const e of stack) {
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|svg|image)$/.test(e.tagName)) return null;
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") return null;
      const c = rgba(cs.backgroundColor); c[3] *= +cs.opacity;
      if (c[3] > 0.01) { layers.push(c); if (c[3] > 0.99) break; }
    }
    let base = [255, 255, 255, 1];
    for (const c of layers.reverse()) base = over(c, base);
    return base;
  };
  const seen = new Set(), low = [];
  for (const { el, r } of boxes) {
    if (seen.has(el) || seen.size > 200) continue; seen.add(el);
    const label = say(el); if (!/[\p{L}\p{N}]{2}/u.test(label) || el.closest("button[disabled],[aria-disabled=true]")) continue;
    const cs = getComputedStyle(el);
    if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") continue;
    const fg = rgba(cs.webkitTextFillColor || cs.color); if (fg[3] < 0.05) continue;
    for (let p = el; p; p = p.parentElement) fg[3] *= +getComputedStyle(p).opacity;
    const bg = under(el, r); if (!bg) continue;
    const fs = parseFloat(cs.fontSize), big = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700), need = big ? 3 : 4.5;
    const v = ratio(over(fg, bg), bg);
    if (v < need - 0.05) low.push({ v, need, label, fg: hex(over(fg, bg)), bg: hex(bg) });
  }
  low.sort((a, b) => a.v - b.v);
  for (const x of low.slice(0, 8)) add("tương phản thấp", x.v.toFixed(1) + ":1, cần " + x.need + ":1 (chữ " + x.fg + " trên nền " + x.bg + "): “" + x.label + "”");

  // Tiêu đề rớt một chữ xuống dòng cuối. Chữ cuối dài gần bằng dòng trên thì không tính.
  for (const el of [...root.querySelectorAll(TITLE)].slice(0, 40)) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), words = [], rg = document.createRange();
    for (let t; (t = tw.nextNode());) for (const m of t.nodeValue.matchAll(/\S+/g)) { rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length); const q = rg.getClientRects()[0]; if (q && q.width > 0) words.push(q); }
    if (words.length < 3) continue;
    const h = parseFloat(getComputedStyle(el).fontSize) * 0.6, last = words[words.length - 1], rows = new Map();
    for (const w of words) { const k = [...rows.keys()].find((y) => Math.abs(y - w.top) < h) ?? w.top; const a = rows.get(k) ?? { n: 0, l: 1e9, r: -1e9 }; a.n++; a.l = Math.min(a.l, w.left); a.r = Math.max(a.r, w.right); rows.set(k, a); }
    const list = [...rows.values()];
    if (list.length >= 2 && list[list.length - 1].n === 1 && last.width < 0.4 * Math.max(...list.map((a) => a.r - a.l))) add("tiêu đề rớt một chữ", "“" + say(el) + "”: thêm text-wrap:balance hoặc đổi câu");
  }

  // Chữ thò ra khỏi thẻ chứa nó (thẻ có viền hoặc nền, không cắt nội dung): vẫn nằm trong slide nên phần đo tràn slide không thấy.
  const boxOf = new Map();
  const cardOf = (el) => {
    if (boxOf.has(el)) return boxOf.get(el);
    let card = null;
    for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (rgba(cs.backgroundColor)[3] > 0.01 || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) { card = /(hidden|clip)/.test(cs.overflowX + cs.overflowY) ? null : p; break; } if (cs.position === "absolute" || cs.position === "fixed") break; }
    boxOf.set(el, card); return card;
  };
  for (const { el, r } of boxes) {
    if (/^(absolute|fixed)$/.test(getComputedStyle(el).position)) continue;
    const card = cardOf(el); if (!card) continue;
    const b = card.getBoundingClientRect();
    if (b.height > 8 && (r.bottom > b.bottom + 3 || r.right > b.right + 3)) add("chữ tràn khỏi thẻ", "“" + say(el) + "” thò ra ngoài khung chứa: rút chữ, cho thẻ cao hơn hoặc chia slide, đừng thu nhỏ dưới thang chữ");
  }
}`;
