// Chuyển từ remotion-dev/template-next-app-dir-tailwind src/remotion/MyComp/Rings.tsx (Remotion License): màu vòng theo theme thay vì trắng cố định.
import React from "react";
import { AbsoluteFill, interpolateColors, useVideoConfig } from "remotion";

const RadialGradient: React.FC<{ radius: number; color: string; border: string }> = ({ radius, color, border }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <div style={{ height: radius * 2, width: radius * 2, backgroundColor: color, border: `1px solid ${border}` }} className="rounded-[50%] absolute" />
  </AbsoluteFill>
);

export const Rings: React.FC<{ outProgress: number; from: string; to: string; border: string }> = ({ outProgress, from, to, border }) => {
  const scale = 1 / Math.max(0.05, 1 - outProgress);
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      {new Array(5).fill(true).map((_, i) => <RadialGradient key={i} radius={height * 0.3 * i} color={interpolateColors(i, [0, 4], [from, to])} border={border} />).reverse()}
    </AbsoluteFill>
  );
};
