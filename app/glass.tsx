"use client";
import { useEffect } from "react";

/*
 * Liquid glass runtime.
 *  - Builds a per-element displacement map (rounded-rect SDF -> bezel refraction profile),
 *    wraps it in an SVG filter (with slight chromatic dispersion) and exposes it as --lens.
 *    Only the bezel bends light, the centre stays undistorted (same idea as Vaso / Figma glass).
 *  - Tracks the pointer for the specular glow and the pressed state.
 *  - Marks glass that has content scrolling beneath it.
 */

const LENS = ".dock .composer,.send,.scroll-down";
const GLOW = ".dock .composer,.hero .composer,.send,.scroll-down,.chip,.btn,.seg,.mic-wrap,.topbar .icon-btn,.menu,.modal";
const NS = "http://www.w3.org/2000/svg";

function mapFor(w: number, h: number, r: number, bezel: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hx = w / 2, hy = h / 2, qx0 = hx - r, qy0 = hy - r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx, py = y + 0.5 - hy;
      const qx = Math.abs(px) - qx0, qy = Math.abs(py) - qy0;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const out = Math.hypot(ox, oy);
      const dist = -(out + Math.min(Math.max(qx, qy), 0) - r); // distance to edge, >0 inside
      let nx = 0, ny = 0, m = 0;
      if (dist > 0 && dist < bezel) {
        if (qx > 0 && qy > 0) { nx = -(ox / out) * Math.sign(px); ny = -(oy / out) * Math.sign(py); }
        else if (qx > qy) nx = -Math.sign(px);
        else ny = -Math.sign(py);
        const t = dist / bezel;
        const s = 1 - t;
        m = s * s * s * (0.35 + 0.65 * s); // strongest at the rim, eases to zero inward
        m *= Math.min(1, dist / 1.2 + 0.15); // soften the very last pixel to avoid aliasing
      }
      const i = (y * w + x) * 4;
      d[i] = Math.round(127.5 + 127.5 * nx * m);
      d[i + 1] = Math.round(127.5 + 127.5 * ny * m);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export default function GlassFX() {
  useEffect(() => {
    const root = document.documentElement;
    const chromium = /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
    if (chromium) root.dataset.lens = "1";

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;pointer-events:none";
    document.body.appendChild(svg);
    const cg = document.createElementNS(NS, "filter");
    cg.setAttribute("id", "container-glass");
    cg.setAttribute("x", "0%"); cg.setAttribute("y", "0%"); cg.setAttribute("width", "100%"); cg.setAttribute("height", "100%");
    cg.setAttribute("color-interpolation-filters", "sRGB");
    cg.innerHTML = `<feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence"/>
      <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise"/>
      <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced"/>
      <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur"/>
      <feComposite in="finalBlur" in2="finalBlur" operator="over"/>`;
    svg.appendChild(cg);
    const made = new Map<string, string>();

    const filterFor = (w: number, h: number, r: number) => {
      const bezel = Math.max(6, Math.min(Math.min(w, h) * 0.5, 22));
      const key = `${w}x${h}r${Math.round(r)}b${Math.round(bezel)}`;
      const hit = made.get(key);
      if (hit) return hit;
      const id = `lg-${made.size}`;
      const k = Math.min(30, bezel * 1.15) * 2; // feDisplacementMap uses scale * (c - .5)
      const f = document.createElementNS(NS, "filter");
      f.setAttribute("id", id);
      f.setAttribute("filterUnits", "userSpaceOnUse");
      f.setAttribute("primitiveUnits", "userSpaceOnUse");
      f.setAttribute("x", "0"); f.setAttribute("y", "0");
      f.setAttribute("width", String(w)); f.setAttribute("height", String(h));
      f.setAttribute("color-interpolation-filters", "sRGB");
      const uri = mapFor(w, h, r, bezel);
      const ch = (name: string, scale: number, row: string) => `
        <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d${name}"/>
        <feColorMatrix in="d${name}" type="matrix" values="${row}" result="c${name}"/>`;
      f.innerHTML = `
        <feImage href="${uri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
        ${ch("r", k, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0")}
        ${ch("g", k * 0.94, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0")}
        ${ch("b", k * 0.88, "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0")}
        <feBlend in="cr" in2="cg" mode="screen" result="rg"/>
        <feBlend in="rg" in2="cb" mode="screen"/>`;
      svg.appendChild(f);
      made.set(key, id);
      return id;
    };

    const apply = (el: HTMLElement) => {
      if (!root.dataset.lens) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w < 8 || h < 8 || w > 1400 || h > 1200) return;
      const cs = getComputedStyle(el);
      const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
      const id = filterFor(w, h, r);
      if (el.dataset.lensId !== id) { el.dataset.lensId = id; el.style.setProperty("--lens", `url(#${id})`); }
    };

    const ro = new ResizeObserver((es) => es.forEach((e) => apply(e.target as HTMLElement)));
    const seen = new WeakSet<Element>();
    const scan = (n: ParentNode) => {
      n.querySelectorAll?.(LENS).forEach((el) => { if (!seen.has(el)) { seen.add(el); apply(el as HTMLElement); ro.observe(el); } });
    };
    scan(document);
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const el = n as HTMLElement;
      if (el.matches?.(LENS) && !seen.has(el)) { seen.add(el); apply(el); ro.observe(el); }
      scan(el);
    })));
    mo.observe(document.body, { childList: true, subtree: true });

    const near = (e: Event) => (e.target as HTMLElement)?.closest?.(GLOW) as HTMLElement | null;
    let pressed: HTMLElement | null = null;
    const down = (e: PointerEvent) => { const el = near(e); if (el) { pressed = el; el.dataset.press = "1"; } };
    const up = () => { if (pressed) { delete pressed.dataset.press; pressed = null; } };
    const scroll = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t?.classList?.contains("thread")) return;
      const under = t.scrollHeight - t.scrollTop - t.clientHeight > 4;
      document.querySelectorAll<HTMLElement>(".dock .composer").forEach((c) => { c.dataset.under = under ? "1" : "0"; });
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      ro.disconnect(); mo.disconnect(); svg.remove();
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);
  return null;
}
