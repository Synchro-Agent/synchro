// Mẫu "audiogram": chuyển từ remotion-dev/template-audiogram src/Audiogram/Main.tsx (Remotion License, xem ATTRIBUTION.md).
// Khác mẫu gốc: tiêu đề, tên chương trình, bìa là props (mẫu gốc cố định "Ep 550 - Supper Club × Remotion React" và podcast-cover.jpeg);
// fps theo props; phông có dấu tiếng Việt nạp từ bundle thay IBM Plex Sans của @remotion/google-fonts (cần mạng); cắt một đoạn âm thanh
// bằng trimBefore (clip); màu theo style; bố cục theo khung vuông / dọc / ngang. Phụ đề (Caption[]) do CLI chuẩn bị, không fetch tệp.
import type { Caption } from "@remotion/captions";
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";
import type { z } from "zod";
import { stack, useFonts } from "../common/fonts";
import { Music } from "../common/media";
import { fontsFor, headingStack, themeOf } from "../common/theme";
import type { audiogramSchema } from "../schemas.mjs";
import { PaginatedCaptions } from "./Captions";
import { BASE_SIZE, CAPTIONS_FONT_SIZE, CAPTIONS_FONT_WEIGHT, LINE_HEIGHT, LINES_PER_PAGE } from "./constants";
import { Oscilloscope } from "./Oscilloscope";
import { Spectrum } from "./Spectrum";

export type AudiogramProps = z.infer<typeof audiogramSchema>;

const Cover: React.FC<{ src?: string; label: string; size: number; accent: string; accent2: string; family: string }> = ({ src, label, size, accent, accent2, family }) => src
  ? <Img src={src} style={{ width: size, height: size, objectFit: "cover", borderRadius: 6 }} />
  : (
    <div style={{ width: size, height: size, borderRadius: 6, background: `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`, display: "flex", alignItems: "flex-end", padding: size * 0.08, boxSizing: "border-box" }}>
      <div style={{ fontFamily: family, fontWeight: 800, fontSize: size * 0.16, lineHeight: 1.1, color: "#fff" }}>{label}</div>
    </div>
  );

export const Audiogram: React.FC<AudiogramProps> = (p) => {
  const { durationInFrames, width, height, fps } = useVideoConfig();
  const t = themeOf(p.style, p.accent);
  const ready = useFonts(fontsFor(t, p.font));
  const family = stack(p.font);
  const captions: Caption[] = Array.isArray(p.captions) ? (p.captions as Caption[]) : [];
  const offset = Math.round((p.clip?.startSec ?? 0) * fps);
  const landscape = width > height * 1.2, portrait = height > width * 1.2;
  const pad = BASE_SIZE * (portrait ? 1.5 : 1);
  const textBoxWidth = (landscape ? width * 0.5 : width) - pad * 2;
  const v = p.visualizer;
  const n = Number(v.numberOfSamples);
  const titleColor = p.titleColor ?? t.text, capColor = p.captionsTextColor ?? t.text;
  const viz = v.type === "oscilloscope"
    ? <Oscilloscope waveColor={v.color} padding={v.padding} audioSrc={p.audio} key={p.audio} numberOfSamples={n} windowInSeconds={v.windowInSeconds} posterization={v.posterization} amplitude={v.amplitude} frameOffset={offset} />
    : <Spectrum barColor={v.color} audioSrc={p.audio} key={p.audio} mirrorWave={v.mirrorWave} numberOfSamples={n * 4} freqRangeStartIndex={v.freqRangeStartIndex} waveLinesToDisplay={v.linesToDisplay} frameOffset={offset} />;
  const header = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
      <Cover src={p.cover} label={p.show ?? p.title} size={portrait ? 300 : 250} accent={t.accent} accent2={t.accent2} family={headingStack(t, p.font)} />
      <div style={{ marginLeft: 48, display: "flex", flexDirection: "column", gap: 12 }}>
        {p.show ? <div style={{ fontWeight: 600, fontSize: 30, letterSpacing: "0.06em", textTransform: "uppercase", color: t.accent }}>{p.show}</div> : null}
        <div style={{ lineHeight: 1.25, fontWeight: 800, color: titleColor, fontSize: p.title.length > 60 ? 40 : 48, fontFamily: headingStack(t, p.font) }}>{p.title}</div>
      </div>
    </div>
  );
  const caps = ready && captions.length ? (
    <div style={{ lineHeight: `${LINE_HEIGHT}px`, width: textBoxWidth, fontWeight: CAPTIONS_FONT_WEIGHT, fontSize: CAPTIONS_FONT_SIZE, marginTop: BASE_SIZE * 0.5 }}>
      <PaginatedCaptions captions={captions} startFrame={0} endFrame={durationInFrames} linesPerPage={portrait ? 7 : landscape ? 4 : LINES_PER_PAGE} subtitlesTextColor={capColor}
        onlyDisplayCurrentSentence={p.onlyDisplayCurrentSentence} textBoxWidth={textBoxWidth} fontFamily={family} fontSize={CAPTIONS_FONT_SIZE} />
    </div>
  ) : null;
  return (
    <AbsoluteFill style={{ background: t.backdrop }}>
      <Audio src={p.audio} trimBefore={offset || undefined} />
      {p.music ? <Music src={p.music.src} volumeDb={p.music.volumeDb} durationInFrames={durationInFrames} fps={fps} /> : null}
      {ready ? (
        <div style={{ display: "flex", flexDirection: landscape ? "row" : "column", justifyContent: portrait ? "center" : undefined, width: "100%", height: "100%", color: t.text,
          padding: pad, boxSizing: "border-box", fontFamily: family, gap: landscape ? pad : 0 }}>
          {landscape ? (
            <>
              <div style={{ width: width * 0.5 - pad * 1.5, display: "flex", flexDirection: "column", justifyContent: "center" }}>{header}<div>{viz}</div></div>
              <div style={{ display: "flex", alignItems: "center" }}>{caps}</div>
            </>
          ) : (
            <>{header}<div>{viz}</div>{caps}</>
          )}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
