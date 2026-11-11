// Chuyển từ remotion-dev/template-audiogram src/Audiogram/Word.tsx (Remotion License, xem ATTRIBUTION.md).
import { Caption } from "@remotion/captions";
import React, { useMemo } from "react";
import { Easing, interpolate, useVideoConfig } from "remotion";
import { msToFrame } from "./ms";

export const Word: React.FC<{
  readonly item: Caption;
  readonly frame: number;
  readonly transcriptionColor: string;
}> = ({ item, frame, transcriptionColor }) => {
  const { fps } = useVideoConfig();
  const opacity = interpolate(
    frame,
    [msToFrame(item.startMs, fps), msToFrame(item.startMs, fps) + Math.round(fps / 2)],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const translateY = interpolate(
    frame,
    [msToFrame(item.startMs, fps), msToFrame(item.startMs, fps) + Math.round(fps / 3)],
    [0.25, 0],
    {
      easing: Easing.out(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const style: React.CSSProperties = useMemo(() => {
    return {
      display: "inline-block",
      whiteSpace: "pre",
      opacity,
      translate: `0 ${translateY}em`,
      color: transcriptionColor,
    };
  }, [opacity, transcriptionColor, translateY]);

  return <span style={style}>{item.text}</span>;
};
