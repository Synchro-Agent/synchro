// Mẫu "tiktok": chuyển từ remotion-dev/template-tiktok (Remotion License, xem ATTRIBUTION.md).
// Khác mẫu gốc: phụ đề đến từ props (CLI đã chuyển .srt / whisper / edge-tts thành Caption[]) thay vì fetch tệp .json cạnh video;
// fps theo props (mặc định 60); phông Be Vietnam Pro Black có dấu tiếng Việt thay TheBoldFont (không có chữ Việt); thêm nền ảnh Ken Burns,
// nền màu, câu mở đầu (hook), nhạc nền. Sửa lỗi mẫu gốc: thời gian tối đa một trang chữ tính bằng khung, không lấy số mili giây làm số khung.
import { makeTransform, scale, translateY } from "@remotion/animation-utils";
import { type Caption, createTikTokStyleCaptions, type TikTokPage } from "@remotion/captions";
import { Audio } from "@remotion/media";
import { fitText } from "@remotion/layout-utils";
import React, { useMemo } from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import { stack, useFonts } from "../common/fonts";
import { Music } from "../common/media";
import { headingStack, themeOf } from "../common/theme";
import type { tiktokSchema } from "../schemas.mjs";

export type TikTokProps = z.infer<typeof tiktokSchema>;
type Cap = TikTokProps["caption"];

const Page: React.FC<{ enterProgress: number; page: TikTokPage; cap: Cap; family: string }> = ({ enterProgress, page, cap, family }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const timeInMs = (frame / fps) * 1000;
  const fitted = fitText({ fontFamily: family, fontWeight: cap.weight, text: page.text, withinWidth: width * 0.86, textTransform: cap.uppercase ? "uppercase" : "none" });
  const fontSize = Math.min(cap.maxFontSize * (width / 1080), fitted.fontSize);
  const container: React.CSSProperties = cap.position === "center"
    ? { justifyContent: "center", alignItems: "center" }
    : { justifyContent: "center", alignItems: "center", top: undefined, bottom: height * 0.17, height: fontSize * 2.6 };
  return (
    <AbsoluteFill style={container}>
      <div style={{
        fontSize, lineHeight: 1.25, color: cap.textColor, fontFamily: family, fontWeight: cap.weight, textAlign: "center", width: width * 0.9,
        WebkitTextStroke: `${Math.round(fontSize * 0.16)}px black`, paintOrder: "stroke", textTransform: cap.uppercase ? "uppercase" : "none",
        transform: makeTransform([scale(interpolate(enterProgress, [0, 1], [0.8, 1])), translateY(interpolate(enterProgress, [0, 1], [50, 0]))]),
      }}>
        {page.tokens.map((t, i) => {
          const active = t.fromMs - page.startMs <= timeInMs && t.toMs - page.startMs > timeInMs;
          return <span key={`${t.fromMs}-${i}`} style={{ display: "inline", whiteSpace: "pre", color: active ? cap.highlightColor : cap.textColor }}>{t.text}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

const SubtitlePage: React.FC<{ page: TikTokPage; cap: Cap; family: string }> = ({ page, cap, family }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps / 6) });
  return <AbsoluteFill><Page enterProgress={enter} page={page} cap={cap} family={family} /></AbsoluteFill>;
};

/** Ảnh nền chuyển động chậm (Ken Burns), đổi ảnh bằng hòa tan 0,4 giây. */
const KenBurns: React.FC<{ images: string[]; seconds: number }> = ({ images, seconds }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const each = Math.max(1, Math.round(seconds * fps)), fade = Math.round(fps * 0.4);
  const count = Math.max(images.length, Math.ceil(durationInFrames / each));
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {Array.from({ length: count }, (_, i) => (
        <Sequence key={i} from={i * each} durationInFrames={each + fade}>
          <KenBurnsImage src={images[i % images.length]} i={i} len={each + fade} fade={fade} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
const KenBurnsImage: React.FC<{ src: string; i: number; len: number; fade: number }> = ({ src, i, len, fade }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, len], [1.04, 1.16]);
  const dx = interpolate(f, [0, len], i % 2 ? [-2, 2] : [2, -2]);
  const opacity = i === 0 ? 1 : interpolate(f, [0, fade], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}><Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z}) translateX(${dx}%)` }} /></AbsoluteFill>;
};

const Hook: React.FC<{ text: string; family: string; accent: string; seconds: number }> = ({ text, family, accent, seconds }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 160 } });
  const out = interpolate(frame, [seconds * fps - fps * 0.3, seconds * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fitted = fitText({ fontFamily: family, fontWeight: 900, text, withinWidth: width * 0.78, textTransform: "uppercase" });
  const fontSize = Math.min(130 * (width / 1080), fitted.fontSize);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])}) rotate(-2deg)`, background: accent, padding: `${fontSize * 0.25}px ${fontSize * 0.4}px`,
        borderRadius: fontSize * 0.2, border: `${Math.round(fontSize * 0.06)}px solid #000`, boxShadow: `${fontSize * 0.08}px ${fontSize * 0.08}px 0 #000` }}>
        <div style={{ fontFamily: family, fontWeight: 900, fontSize, lineHeight: 1.2, color: "#0A0A0A", textTransform: "uppercase", textAlign: "center", maxWidth: width * 0.8 }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};

export const TikTok: React.FC<TikTokProps> = (p) => {
  const { fps, durationInFrames } = useVideoConfig();
  const theme = themeOf(p.style, p.accent);
  const ready = useFonts([p.font, theme.headingFamily ?? p.font]);
  const family = stack(p.font);
  const caps: Caption[] = Array.isArray(p.captions) ? (p.captions as Caption[]) : [];
  const { pages } = useMemo(() => createTikTokStyleCaptions({ combineTokensWithinMilliseconds: p.caption.switchEveryMs, captions: caps }), [caps, p.caption.switchEveryMs]);
  const maxFrames = (p.caption.switchEveryMs / 1000) * fps;
  return (
    <AbsoluteFill style={{ background: p.background ?? theme.backdrop }}>
      {p.video ? (
        <AbsoluteFill><OffthreadVideo src={p.video} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></AbsoluteFill>
      ) : p.images?.length ? <KenBurns images={p.images} seconds={p.imageSeconds} /> : null}
      {/* Lớp tối nhẹ ở nửa dưới để chữ trắng viền đen luôn đọc được trên nền sáng. */}
      {p.video || p.images?.length ? <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.35) 100%)" }} /> : null}
      {p.audio ? <Audio src={p.audio} /> : null}
      {p.music ? <Music src={p.music.src} volumeDb={p.music.volumeDb} durationInFrames={durationInFrames} fps={fps} /> : null}
      {ready ? pages.map((page, i) => {
        const next = pages[i + 1] ?? null;
        const start = Math.round((page.startMs / 1000) * fps);
        // Trang chữ giữ tới trang sau (không để khoảng trống giữa hai trang); khoảng lặng dài thì tắt sau khi đọc xong + 0,8 giây.
        const end = Math.round(Math.min(next ? (next.startMs / 1000) * fps : Infinity, start + Math.max(maxFrames, ((page.durationMs + 800) / 1000) * fps)));
        if (end - start <= 0) return null;
        return <Sequence key={i} from={start} durationInFrames={end - start}><SubtitlePage page={page} cap={p.caption} family={family} /></Sequence>;
      }) : null}
      {ready && p.hook ? <Sequence durationInFrames={Math.round(p.hook.seconds * fps)}><Hook text={p.hook.text} seconds={p.hook.seconds} family={headingStack(theme, p.font)} accent={theme.accent} /></Sequence> : null}
    </AbsoluteFill>
  );
};
