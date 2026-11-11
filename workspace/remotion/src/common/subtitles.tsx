// Phụ đề dạng dải dưới đáy (cho giọng đọc của video giới thiệu): mỗi trang gom các từ trong ~2,4 giây, tối đa 2 dòng, trong vùng an toàn 5%.
import { type Caption, createTikTokStyleCaptions } from "@remotion/captions";
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const SubtitleBar: React.FC<{ captions: Caption[]; family: string }> = ({ captions, family }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { pages } = useMemo(() => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 2400 }), [captions]);
  const ms = (frame / fps) * 1000;
  const page = pages.find((p, i) => p.startMs <= ms && ms < Math.min(pages[i + 1]?.startMs ?? Infinity, p.startMs + p.durationMs + 400));
  if (!page) return null;
  const fs = Math.round(Math.min(width, height) * 0.036);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.07 }}>
      <div style={{ maxWidth: width * 0.84, background: "rgba(0,0,0,0.62)", color: "#fff", fontFamily: family, fontWeight: 600, fontSize: fs, lineHeight: 1.35,
        padding: `${fs * 0.35}px ${fs * 0.7}px`, borderRadius: fs * 0.4, textAlign: "center", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {page.text.trim()}
      </div>
    </AbsoluteFill>
  );
};
