// Mẫu "github-unwrapped": video tổng kết số liệu năm theo phong cách remotion-dev/github-unwrapped (mã MIT, xem ATTRIBUTION.md).
// Mẫu gốc chỉ nhận số liệu GitHub (ngôn ngữ, issue, pull request, sao…) với hằng số khung 30 fps; ở đây mỗi cảnh là dữ liệu bất kỳ do model
// điền (top 3, bộ đếm, lưới đóng góp, theo giờ, theo thứ, so sánh) và mọi mốc thời gian tính bằng giây × fps nên đúng ở cả 30 và 60 fps.
import React from "react";
import { AbsoluteFill, Easing, interpolate, random, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import { stack, useFonts } from "../common/fonts";
import { Music } from "../common/media";
import { type recapSceneSchema, type recapSchema, sceneSeconds } from "../schemas.mjs";
import { fadeInOut, Pane, Planet, SevenSegment, Stars, THEMES, type ThemeName } from "./parts";

export type RecapProps = z.infer<typeof recapSchema>;
type Scene = z.infer<typeof recapSceneSchema>;
type Ctx = { family: string; theme: (typeof THEMES)[ThemeName]; accent: string; u: number; p: RecapProps };

const fmt = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const useSec = () => { const { fps } = useVideoConfig(); return (s: number) => Math.round(s * fps); };
const Title: React.FC<{ c: Ctx; children: React.ReactNode; size?: number }> = ({ c, children, size = 64 }) => (
  <div style={{ fontFamily: c.family, fontWeight: 800, fontSize: size * c.u, lineHeight: 1.15, color: "#fff", textAlign: "center", letterSpacing: "-0.01em" }}>{children}</div>
);

const Opening: React.FC<{ s: Extract<Scene, { type: "opening" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const { durationInFrames } = useVideoConfig();
  // Thu nhỏ từ 1,3 về 1 như thẻ tiêu đề của mẫu gốc (TopLanguages/TitleCard.tsx).
  const scale = interpolate(frame, [0, durationInFrames], [1.3, 1]);
  const rise = spring({ frame, fps: sec(1), config: { damping: 200 }, durationInFrames: sec(1.6) });
  const year = c.p.year ?? new Date().getFullYear();
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, alignItems: "center", justifyContent: "center" }}>
      <Planet color={c.theme.planets[0]} size={560 * c.u} style={{ position: "absolute", bottom: interpolate(rise, [0, 1], [-560, -300]) * c.u, opacity: 0.95 }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * c.u, transform: `translateY(${interpolate(rise, [0, 1], [60, -80]) * c.u}px)`, opacity: rise }}>
        <div style={{ fontFamily: c.family, fontWeight: 900, fontSize: 210 * c.u, lineHeight: 1, color: "transparent", WebkitTextStroke: `${3 * c.u}px #fff`, letterSpacing: "0.02em" }}>{year}</div>
        <Title c={c} size={76}>{s.title ?? c.p.title}</Title>
        {s.subtitle ?? c.p.subject ? <div style={{ fontFamily: c.family, fontWeight: 500, fontSize: 36 * c.u, color: "rgba(255,255,255,0.8)", textAlign: "center", maxWidth: 900 * c.u }}>{s.subtitle ?? c.p.subject}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const TopList: React.FC<{ s: Extract<Scene, { type: "top-list" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const { width, height } = useVideoConfig();
  const portrait = height > width * 1.1;
  const sizes = [330, 240, 190];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 * c.u, flexDirection: "column", padding: 60 * c.u }}>
      <Title c={c}>{s.title}</Title>
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", alignItems: "center", justifyContent: "center", gap: 46 * c.u }}>
        {s.items.map((it, i) => {
          const pop = spring({ frame, fps: sec(1), config: { damping: 12, stiffness: 90 }, delay: sec(0.4 + i * 0.35) });
          const spin = interpolate(frame, [0, sec(10)], [0, 25]) * (i % 2 ? -1 : 1);
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * c.u, transform: `scale(${pop})`, opacity: Math.min(1, pop * 1.5) }}>
              <div style={{ transform: `rotate(${spin}deg)` }}><Planet color={c.theme.planets[i % 3]} size={sizes[i] * c.u * (portrait ? 0.8 : 1)} /></div>
              <Pane style={{ padding: `${14 * c.u}px ${30 * c.u}px`, borderRadius: 40 * c.u, textAlign: "center" }}>
                <div style={{ fontFamily: c.family, fontWeight: 700, fontSize: 34 * c.u, whiteSpace: "nowrap" }}>{i + 1}. {it.label}</div>
                <div style={{ fontFamily: c.family, fontWeight: 500, fontSize: 28 * c.u, opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>{fmt(it.value)}{it.unit ? ` ${it.unit}` : ""}</div>
              </Pane>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Counter: React.FC<{ s: Extract<Scene, { type: "counter" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const k = interpolate(frame, [sec(0.3), sec(2)], [0, 1], { easing: Easing.out(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shown = Math.round(s.value * k);
  const digits = String(s.value).length;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 * c.u }}>
      <Title c={c}>{s.label}</Title>
      <Pane style={{ background: "rgba(5,8,40,0.55)", padding: `${30 * c.u}px ${50 * c.u}px`, borderRadius: 30 * c.u }}>
        <SevenSegment num={Number(String(shown).padStart(digits, "0"))} fontSize={Math.min(260, 1300 / Math.max(3, digits)) * c.u} color={c.accent} />
      </Pane>
      {s.unit || s.note ? <div style={{ fontFamily: c.family, fontWeight: 500, fontSize: 36 * c.u, color: "rgba(255,255,255,0.85)", textAlign: "center", maxWidth: 900 * c.u }}>{[s.unit, s.note].filter(Boolean).join(" · ")}</div> : null}
    </AbsoluteFill>
  );
};

// Lưới đóng góp 7 hàng: từng cột sáng dần từ trái qua (giống Contributions/index.tsx), ô có giá trị cao nhất phát sáng.
const Heatmap: React.FC<{ s: Extract<Scene, { type: "heatmap" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const { width } = useVideoConfig();
  const cols = Math.ceil(s.values.length / 7);
  const size = Math.min(54 * c.u, (width * 0.9) / cols);
  const max = Math.max(1, ...s.values);
  const sweep = interpolate(frame, [sec(0.3), sec(2.2)], [0, cols + 6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const total = s.total ?? s.values.reduce((a, b) => a + b, 0);
  const k = interpolate(frame, [sec(0.3), sec(2.4)], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 * c.u }}>
      <Title c={c}>{s.label}</Title>
      <div style={{ position: "relative", width: cols * size, height: 7 * size }}>
        {s.values.map((v, i) => {
          const col = Math.floor(i / 7), row = i % 7;
          const on = Math.min(1, Math.max(0, sweep - col - random(`d${i}`) * 4));
          const level = v <= 0 ? 0.1 : Math.max(0.25, v / max);
          return <div key={i} style={{ position: "absolute", left: col * size + size * 0.1, top: row * size + size * 0.1, width: size * 0.8, height: size * 0.8, borderRadius: size * 0.2,
            background: v >= max ? c.accent : `rgba(255,255,255,${level * on})`, opacity: v >= max ? on : 1, transform: `scale(${0.4 + 0.6 * on})`,
            boxShadow: v >= max ? `0 0 ${size * 0.6}px ${c.accent}` : undefined }} />;
        })}
      </div>
      <div style={{ fontFamily: c.family, fontWeight: 700, fontSize: 54 * c.u, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(Math.round(total * k))}{s.unit ? ` ${s.unit}` : ""}</div>
    </AbsoluteFill>
  );
};

// Cột mọc lên theo lò xo, cột cao nhất màu khung sáng (Productivity/Productivity.tsx); trễ 2 khung mỗi cột của mẫu gốc đổi thành 1/15 giây.
const Bars: React.FC<{ label: string; values: number[]; names: string[]; c: Ctx; best: (i: number) => string }> = ({ label, values, names, c, best }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const { width } = useVideoConfig();
  const max = Math.max(1e-9, ...values), top = values.indexOf(Math.max(...values));
  const gap = (values.length > 12 ? 8 : 18) * c.u;
  const bw = Math.min(90 * c.u, (width * 0.86 - gap * values.length) / values.length);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 * c.u }}>
      <Title c={c}>{label}</Title>
      <div style={{ display: "flex", alignItems: "flex-end", gap, height: 480 * c.u }}>
        {values.map((v, i) => {
          const h = spring({ fps: sec(1), frame, config: { mass: (v / max) * 10 + 0.1, damping: 200 }, delay: sec(0.5) + Math.round(i * sec(1) / 15) });
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 * c.u }}>
              <div style={{ width: bw, height: 440 * c.u, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", height: `${(v / max) * 100 * h}%`, borderRadius: 6 * c.u, background: i === top ? "rgba(230,225,252,0.85)" : "#181B28", border: "3px solid rgba(255,255,255,0.1)" }} />
              </div>
              <div style={{ fontFamily: c.family, fontSize: (values.length > 12 ? 18 : 28) * c.u, fontWeight: i === top ? 700 : 500, color: i === top ? "#fff" : "rgba(255,255,255,0.65)" }}>{names[i]}</div>
            </div>
          );
        })}
      </div>
      <Pane style={{ padding: `${12 * c.u}px ${34 * c.u}px`, borderRadius: 40 * c.u, opacity: interpolate(frame, [sec(1.6), sec(2.1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <div style={{ fontFamily: c.family, fontWeight: 700, fontSize: 32 * c.u }}>{best(top)}</div>
      </Pane>
    </AbsoluteFill>
  );
};

// So sánh hai số bằng hai cột phát sáng (ý từ cảnh Issues mở / đóng với GlowStick của mẫu gốc).
const Compare: React.FC<{ s: Extract<Scene, { type: "compare" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const max = Math.max(1e-9, ...s.items.map((x) => x.value));
  const colors = [c.accent, c.theme.planets[1]];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 * c.u }}>
      <Title c={c}>{s.title}</Title>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 120 * c.u, height: 560 * c.u }}>
        {s.items.map((it, i) => {
          const k = interpolate(frame, [sec(0.4 + i * 0.3), sec(2 + i * 0.3)], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * c.u }}>
              <div style={{ fontFamily: c.family, fontWeight: 800, fontSize: 64 * c.u, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(Math.round(it.value * k))}</div>
              <div style={{ width: 110 * c.u, height: 400 * c.u * (it.value / max) * k, borderRadius: 60 * c.u, background: `linear-gradient(180deg, #fff 0%, ${colors[i]} 35%, ${colors[i]}55 100%)`, boxShadow: `0 0 ${40 * c.u}px ${colors[i]}88` }} />
              <div style={{ fontFamily: c.family, fontWeight: 600, fontSize: 32 * c.u, color: "rgba(255,255,255,0.9)" }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const End: React.FC<{ s: Extract<Scene, { type: "end" }>; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const sec = useSec();
  const pop = spring({ frame, fps: sec(1), config: { damping: 200 }, durationInFrames: sec(1.2) });
  const shine = 0.5 + 0.5 * Math.sin(frame / sec(0.5));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 * c.u }}>
      <div style={{ position: "relative", transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})` }}>
        <div style={{ position: "absolute", inset: -60 * c.u, borderRadius: 999, background: `radial-gradient(circle, ${c.theme.glow}${Math.round(40 + 40 * shine).toString(16)} 0%, transparent 65%)` }} />
        <Planet color={c.theme.planets[0]} size={330 * c.u} />
      </div>
      <div style={{ opacity: pop }}><Title c={c} size={72}>{s.title}</Title></div>
      {s.cta ? <Pane style={{ opacity: interpolate(frame, [sec(0.8), sec(1.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), padding: `${16 * c.u}px ${40 * c.u}px` }}>
        <div style={{ fontFamily: c.family, fontWeight: 700, fontSize: 36 * c.u }}>{s.cta}</div></Pane> : null}
    </AbsoluteFill>
  );
};

const HOURS = Array.from({ length: 24 }, (_, i) => String(i));
const SceneView: React.FC<{ s: Scene; c: Ctx }> = ({ s, c }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const o = fadeInOut(frame, durationInFrames, fps);
  const inner = s.type === "opening" ? <Opening s={s} c={c} /> : s.type === "top-list" ? <TopList s={s} c={c} /> : s.type === "counter" ? <Counter s={s} c={c} />
    : s.type === "heatmap" ? <Heatmap s={s} c={c} />
    : s.type === "by-hour" ? <Bars label={s.label} values={s.values} names={HOURS} c={c} best={(i) => `Cao nhất lúc ${i}h`} />
    : s.type === "by-weekday" ? <Bars label={s.label} values={s.values} names={s.dayNames} c={c} best={(i) => `Cao nhất: ${s.dayNames[i]}`} />
    : s.type === "compare" ? <Compare s={s} c={c} /> : <End s={s} c={c} />;
  return <AbsoluteFill style={{ opacity: o }}>{inner}</AbsoluteFill>;
};

export const Recap: React.FC<RecapProps> = (p) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const ready = useFonts([p.font]);
  const theme = THEMES[p.theme];
  const c: Ctx = { family: stack(p.font), theme, accent: p.accent ?? theme.planets[0], u: Math.min(width, height) / 1080, p };
  let at = 0;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Stars />
      {ready ? p.scenes.map((s, i) => {
        const d = Math.round(sceneSeconds(s) * fps), from = at;
        at += d;
        return <Sequence key={i} from={from} durationInFrames={d}><SceneView s={s} c={c} /></Sequence>;
      }) : null}
      {p.music ? <Music src={p.music.src} volumeDb={p.music.volumeDb} durationInFrames={durationInFrames} fps={fps} /> : null}
    </AbsoluteFill>
  );
};
