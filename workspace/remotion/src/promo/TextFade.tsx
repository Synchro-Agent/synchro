// Chuyển từ remotion-dev/template-next-app-dir-tailwind src/remotion/MyComp/TextFade.tsx (Remotion License): thời lượng tính theo giây để đúng ở 30 và 60 fps.
import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const TextFade: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const progress = spring({ fps, frame, config: { damping: 200 }, durationInFrames: Math.round(fps * 1.6), delay: Math.round(delay * fps) });
  const rightStop = interpolate(progress, [0, 1], [200, 0]);
  const leftStop = Math.max(0, rightStop - 60);
  const maskImage = `linear-gradient(-45deg, transparent ${leftStop}%, black ${rightStop}%)`;
  const content: React.CSSProperties = useMemo(() => ({ maskImage, WebkitMaskImage: maskImage }), [maskImage]);
  return <div style={content}>{children}</div>;
};
