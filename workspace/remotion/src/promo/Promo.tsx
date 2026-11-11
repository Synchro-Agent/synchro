// Mẫu "next-tailwind": dựng từ remotion-dev/template-next-app-dir-tailwind (Remotion License, xem ATTRIBUTION.md).
// Giữ phần video của mẫu gốc (Rings, TextFade, spring, Tailwind qua @remotion/tailwind-v4) và mở rộng thành video giới thiệu sản phẩm:
// 7 loại cảnh do model chọn trong props, chuyển cảnh bằng @remotion/transitions. Bỏ logo Next.js (logo là của người dùng), bỏ phần
// Next.js / Lambda (Synchro dựng bằng CLI trong sandbox), bỏ @remotion/google-fonts (cần mạng) — phông nạp từ bundle.
import "../style.css";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { linearTiming, type TransitionPresentation, TransitionSeries } from "@remotion/transitions";
import { Audio } from "@remotion/media";
import type { Caption } from "@remotion/captions";
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import { stack, useFonts } from "../common/fonts";
import { Music } from "../common/media";
import { SubtitleBar } from "../common/subtitles";
import { fontsFor, headingStack, type Theme, themeOf } from "../common/theme";
import { type promoSceneSchema, type promoSchema, sceneSeconds } from "../schemas.mjs";
import { Icon } from "./icons";
import { Rings } from "./Rings";
import { TextFade } from "./TextFade";

export type PromoProps = z.infer<typeof promoSchema>;
type Scene = z.infer<typeof promoSceneSchema>;
type Ctx = { t: Theme; body: string; head: string; brand: PromoProps["brand"]; u: number; portrait: boolean };

const useEnter = (delaySec = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame, fps, config: { damping }, delay: Math.round(delaySec * fps) });
};
const Rise: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ delay = 0, children, style, className }) => {
  const p = useEnter(delay);
  return <div className={className} style={{ ...style, opacity: p, transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)` }}>{children}</div>;
};

const Wordmark: React.FC<{ c: Ctx; size: number }> = ({ c, size }) => c.brand.logo
  ? <Img src={c.brand.logo} style={{ height: size, maxWidth: size * 5, objectFit: "contain" }} />
  : <div style={{ fontFamily: c.head, fontWeight: 800, fontSize: size * 0.8, letterSpacing: "-0.02em", color: c.t.text }}>{c.brand.name}</div>;

const Corner: React.FC<{ c: Ctx }> = ({ c }) => {
  const { width, height } = useVideoConfig();
  return <div className="absolute flex items-center" style={{ left: width * 0.05, top: height * 0.05, opacity: 0.85 }}><Wordmark c={c} size={44 * c.u} /></div>;
};

const LogoReveal: React.FC<{ s: Extract<Scene, { type: "logo-reveal" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = spring({ fps, frame, config: { damping: 200 }, durationInFrames: fps, delay: Math.round(fps * 0.4) });
  const pop = spring({ fps, frame, config: { damping: 12, stiffness: 120 }, delay: Math.round(fps * 0.15) });
  const tagline = s.tagline ?? c.brand.tagline;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - out * 0.6 }}><Rings outProgress={out * 0.55} from={c.t.surface} to={c.t.bg} border={c.t.border} /></AbsoluteFill>
      <AbsoluteFill className="flex flex-col items-center justify-center" style={{ gap: 36 * c.u }}>
        <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, opacity: pop }}><Wordmark c={c} size={150 * c.u} /></div>
        {tagline ? <TextFade delay={0.6}><div style={{ fontFamily: c.body, fontSize: 44 * c.u, color: c.t.muted, textAlign: "center", maxWidth: 1400 * c.u }}>{tagline}</div></TextFade> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Headline: React.FC<{ s: Extract<Scene, { type: "headline" }>; c: Ctx }> = ({ s, c }) => (
  <AbsoluteFill className="flex flex-col justify-center" style={{ padding: `0 ${(c.portrait ? 80 : 160) * c.u}px`, gap: 32 * c.u }}>
    {s.eyebrow ? <Rise><span className="inline-block uppercase" style={{ fontFamily: c.body, fontWeight: 700, letterSpacing: "0.14em", fontSize: 26 * c.u, color: c.t.accent,
      border: `2px solid ${c.t.accent}`, borderRadius: 999, padding: `${8 * c.u}px ${22 * c.u}px` }}>{s.eyebrow}</span></Rise> : null}
    <TextFade delay={0.15}><h1 className="m-0" style={{ fontFamily: c.head, fontWeight: c.t.headingWeight, fontSize: (c.portrait ? 104 : 116) * c.u, lineHeight: 1.08, letterSpacing: "-0.02em", color: c.t.text, maxWidth: 1500 * c.u }}>{s.title}</h1></TextFade>
    {s.body ? <Rise delay={0.6}><p className="m-0" style={{ fontFamily: c.body, fontSize: 46 * c.u, lineHeight: 1.45, color: c.t.muted, maxWidth: 1250 * c.u }}>{s.body}</p></Rise> : null}
  </AbsoluteFill>
);

const FeatureGrid: React.FC<{ s: Extract<Scene, { type: "feature-grid" }>; c: Ctx }> = ({ s, c }) => {
  const cols = c.portrait ? 1 : s.items.length === 4 ? 2 : Math.min(3, s.items.length);
  return (
    <AbsoluteFill className="flex flex-col justify-center" style={{ padding: `${130 * c.u}px ${(c.portrait ? 70 : 140) * c.u}px`, gap: 44 * c.u }}>
      {s.title ? <Rise><h2 className="m-0" style={{ fontFamily: c.head, fontWeight: c.t.headingWeight, fontSize: 84 * c.u, lineHeight: 1.1, color: c.t.text, letterSpacing: "-0.015em" }}>{s.title}</h2></Rise> : null}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 28 * c.u }}>
        {s.items.map((it, i) => (
          <Rise key={i} delay={0.25 + i * 0.12} style={{ background: c.t.surface, border: `${c.t.radius === 0 || c.t.border.startsWith("#") ? 3 : 1.5}px solid ${c.t.border}`, borderRadius: c.t.radius,
            padding: `${44 * c.u}px ${40 * c.u}px`, minHeight: c.portrait ? undefined : 330 * c.u, display: "flex", flexDirection: c.portrait ? "row" : "column", gap: 22 * c.u, alignItems: c.portrait ? "center" : "flex-start" }}>
            <div className="flex items-center justify-center shrink-0" style={{ width: 92 * c.u, height: 92 * c.u, borderRadius: Math.min(c.t.radius, 22) * c.u, background: `${c.t.accent}22` }}>
              <Icon name={it.icon} size={52 * c.u} color={c.t.accent} />
            </div>
            <div>
              <div style={{ fontFamily: c.head, fontWeight: 700, fontSize: 48 * c.u, lineHeight: 1.2, color: c.t.text }}>{it.title}</div>
              {it.text ? <div style={{ fontFamily: c.body, fontSize: 34 * c.u, lineHeight: 1.45, color: c.t.muted, marginTop: 12 * c.u }}>{it.text}</div> : null}
            </div>
          </Rise>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Screenshot: React.FC<{ s: Extract<Scene, { type: "screenshot" }>; c: Ctx }> = ({ s, c }) => {
  const p = useEnter(0.1);
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const drift = interpolate(frame, [0, 8 * fps], [1, 1.04]);
  const w = width * (c.portrait ? 0.86 : 0.62);
  return (
    <AbsoluteFill className="flex items-center justify-center" style={{ flexDirection: c.portrait ? "column" : "row", gap: 70 * c.u, padding: 100 * c.u }}>
      {s.title || s.caption ? (
        <div style={{ maxWidth: c.portrait ? w : width * 0.26 }}>
          {s.title ? <TextFade><h2 className="m-0" style={{ fontFamily: c.head, fontWeight: c.t.headingWeight, fontSize: 68 * c.u, lineHeight: 1.1, color: c.t.text }}>{s.title}</h2></TextFade> : null}
          {s.caption ? <Rise delay={0.5}><p style={{ fontFamily: c.body, fontSize: 32 * c.u, lineHeight: 1.45, color: c.t.muted, marginTop: 24 * c.u }}>{s.caption}</p></Rise> : null}
        </div>
      ) : null}
      <div style={{ width: w, borderRadius: 18 * c.u, overflow: "hidden", border: `1.5px solid ${c.t.border}`, background: c.t.surface,
        boxShadow: "0 30px 60px -20px rgba(0,0,0,0.45)", opacity: p,
        transform: `perspective(1800px) rotateX(${interpolate(p, [0, 1], [18, 0])}deg) translateY(${interpolate(p, [0, 1], [80, 0])}px) scale(${drift})` }}>
        <div className="flex items-center" style={{ height: 44 * c.u, gap: 10 * c.u, padding: `0 ${18 * c.u}px`, borderBottom: `1px solid ${c.t.border}` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((x) => <span key={x} style={{ width: 13 * c.u, height: 13 * c.u, borderRadius: 99, background: x }} />)}
        </div>
        <Img src={s.image} style={{ display: "block", width: "100%", height: "auto" }} />
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ s: Extract<Scene, { type: "stat" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = interpolate(frame, [0.2 * fps, 1.8 * fps], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const n = (s.value * k).toLocaleString("vi-VN", { minimumFractionDigits: s.decimals, maximumFractionDigits: s.decimals });
  return (
    <AbsoluteFill className="flex flex-col items-center justify-center" style={{ gap: 26 * c.u, padding: 100 * c.u }}>
      <div style={{ fontFamily: c.head, fontWeight: 800, fontSize: (c.portrait ? 200 : 260) * c.u, lineHeight: 1, letterSpacing: "-0.04em", color: c.t.accent, fontVariantNumeric: "tabular-nums" }}>
        {s.prefix ?? ""}{n}{s.suffix ?? ""}
      </div>
      <Rise delay={0.5}><div style={{ fontFamily: c.body, fontWeight: 500, fontSize: 46 * c.u, lineHeight: 1.35, color: c.t.text, textAlign: "center", maxWidth: 1300 * c.u }}>{s.label}</div></Rise>
    </AbsoluteFill>
  );
};

const Quote: React.FC<{ s: Extract<Scene, { type: "quote" }>; c: Ctx }> = ({ s, c }) => (
  <AbsoluteFill className="flex flex-col justify-center" style={{ padding: `0 ${(c.portrait ? 80 : 200) * c.u}px`, gap: 40 * c.u }}>
    <Rise><div style={{ fontFamily: "Playfair Display, serif", fontSize: 220 * c.u, lineHeight: 0.6, color: c.t.accent, height: 110 * c.u }}>“</div></Rise>
    <TextFade delay={0.2}><blockquote className="m-0" style={{ fontFamily: c.head, fontWeight: 600, fontSize: (s.text.length > 140 ? 52 : 64) * c.u, lineHeight: 1.3, color: c.t.text }}>{s.text}</blockquote></TextFade>
    <Rise delay={0.8}><div style={{ fontFamily: c.body, fontSize: 34 * c.u, color: c.t.muted }}><b style={{ color: c.t.text }}>{s.author}</b>{s.role ? ` · ${s.role}` : ""}</div></Rise>
  </AbsoluteFill>
);

const Cta: React.FC<{ s: Extract<Scene, { type: "cta" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2 * 0.8) * interpolate(frame, [fps, 1.5 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill className="flex flex-col items-center justify-center" style={{ gap: 48 * c.u, padding: 100 * c.u }}>
      <Wordmark c={c} size={90 * c.u} />
      <TextFade delay={0.2}><h2 className="m-0 text-center" style={{ fontFamily: c.head, fontWeight: c.t.headingWeight, fontSize: (c.portrait ? 92 : 100) * c.u, lineHeight: 1.1, color: c.t.text, maxWidth: 1500 * c.u }}>{s.title}</h2></TextFade>
      <Rise delay={0.6}><div style={{ transform: `scale(${pulse})`, background: c.t.accent, color: "#FFFFFF", fontFamily: c.body, fontWeight: 700,
        fontSize: 40 * c.u, padding: `${24 * c.u}px ${60 * c.u}px`, borderRadius: Math.max(10, c.t.radius) * c.u, border: c.t.border.startsWith("#") ? `3px solid ${c.t.border}` : "none" }}>{s.button}</div></Rise>
      {s.url ? <Rise delay={0.9}><div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 30 * c.u, color: c.t.muted }}>{s.url}</div></Rise> : null}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ s: Scene; c: Ctx }> = ({ s, c }) => {
  const inner = s.type === "logo-reveal" ? <LogoReveal s={s} c={c} /> : s.type === "headline" ? <Headline s={s} c={c} /> : s.type === "feature-grid" ? <FeatureGrid s={s} c={c} />
    : s.type === "screenshot" ? <Screenshot s={s} c={c} /> : s.type === "stat" ? <Stat s={s} c={c} /> : s.type === "quote" ? <Quote s={s} c={c} /> : <Cta s={s} c={c} />;
  return <AbsoluteFill style={{ background: c.t.backdrop }}>{inner}{s.type !== "logo-reveal" && s.type !== "cta" ? <Corner c={c} /> : null}</AbsoluteFill>;
};

export const Promo: React.FC<PromoProps> = (p) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = themeOf(p.style, p.accent);
  const ready = useFonts(fontsFor(t, p.font));
  const c: Ctx = { t, body: stack(p.font), head: headingStack(t, p.font), brand: p.brand, u: Math.min(width, height) / 1080, portrait: height > width * 1.1 };
  const tr = Math.round(p.transitionSeconds * fps);
  const pres = (p.transition === "slide" ? slide({ direction: "from-right" }) : p.transition === "wipe" ? wipe({ direction: "from-left" }) : fade()) as unknown as TransitionPresentation<Record<string, unknown>>;
  const items: React.ReactNode[] = [];
  p.scenes.forEach((s, i) => {
    items.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={Math.round(sceneSeconds(s) * fps)}><SceneView s={s} c={c} /></TransitionSeries.Sequence>);
    if (i < p.scenes.length - 1 && p.transition !== "none") items.push(<TransitionSeries.Transition key={`t${i}`} presentation={pres} timing={linearTiming({ durationInFrames: tr })} />);
  });
  return (
    <AbsoluteFill style={{ background: t.bg }}>
      {ready ? <TransitionSeries>{items}</TransitionSeries> : null}
      {p.voiceover ? <Audio src={p.voiceover} /> : null}
      {p.music ? <Music src={p.music.src} volumeDb={p.music.volumeDb} durationInFrames={durationInFrames} fps={fps} /> : null}
      {ready && Array.isArray(p.captions) ? <SubtitleBar captions={p.captions as Caption[]} family={c.body} /> : null}
    </AbsoluteFill>
  );
};
