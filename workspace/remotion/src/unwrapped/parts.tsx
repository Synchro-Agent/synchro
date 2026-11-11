// Thành phần đồ họa của mẫu "github-unwrapped". Hình hành tinh (StandardPlanet), dải màu nền, màu khung (pane) và cách cột / ô sáng dần
// lấy từ remotion-dev/github-unwrapped (mã MIT, commit ece8397d, xem ATTRIBUTION.md). Không dùng tài sản có bản quyền riêng của dự án đó:
// nhạc SmartSound, Octocat / logo GitHub, ảnh PNG đèn 7 đoạn và phông "Seven Segment" (không rõ giấy phép) — chữ số 7 đoạn vẽ lại bằng SVG.
import { noise2D } from "@remotion/noise";
import React, { useState } from "react";
import { AbsoluteFill, interpolate, interpolateColors, random, useCurrentFrame, useVideoConfig } from "remotion";

export const PANE_BACKGROUND = "rgba(230, 225, 252, 0.8)";
export const PANE_TEXT_COLOR = "#01064A";
export const PANE_BORDER = "2px solid rgba(255, 255, 255, 0.1)";

// Dải nền theo chủ đề: "blue" và "green" đúng blueRadial / greenAlient của mẫu gốc.
export const THEMES = {
  blue: { bg: "linear-gradient(180deg, #060842 0%, #474280 50%, #396A91 100%)", planets: ["#E7D541", "#BACCE5", "#9E9BAE"], glow: "#7DB7FF" },
  red: { bg: "linear-gradient(180deg, #1A0610 0%, #5C1A2B 50%, #B5432F 100%)", planets: ["#F2B04B", "#F2D1C9", "#CF3336"], glow: "#FF8C6B" },
  gold: { bg: "linear-gradient(180deg, #120D03 0%, #4A3712 50%, #A27A2A 100%)", planets: ["#FFE07A", "#E9DCC0", "#C9A64B"], glow: "#FFD86B" },
  purple: { bg: "linear-gradient(180deg, #0D0420 0%, #3E1441 50%, #6B3FA0 100%)", planets: ["#E7D541", "#D7C8FF", "#B07CFF"], glow: "#C9A6FF" },
  green: { bg: "linear-gradient(180deg, #051F0F 0%, #1A4F2E 50%, #39B77F 100%)", planets: ["#E7D541", "#B1DEC0", "#39B77F"], glow: "#8CF5B8" },
} as const;
export type ThemeName = keyof typeof THEMES;

/** Sao lấp lánh: vị trí cố định theo hạt giống, độ sáng theo nhiễu. */
export const Stars: React.FC<{ count?: number; seed?: string }> = ({ count = 90, seed = "stars" }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const x = random(`${seed}x${i}`) * width, y = random(`${seed}y${i}`) * height, r = 1 + random(`${seed}r${i}`) * 2.4;
        const o = 0.35 + 0.65 * ((noise2D(`${seed}${i}`, frame / (fps * 1.2), 0) + 1) / 2);
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: r, height: r, borderRadius: 99, background: "#fff", opacity: o }} />;
      })}
    </AbsoluteFill>
  );
};

/** StandardPlanet của github-unwrapped (TopLanguages/svgs/planets/StandardPlanet.tsx), tô theo màu. */
export const Planet: React.FC<{ color: string; size: number; style?: React.CSSProperties }> = ({ color, size, style }) => {
  const [id] = useState(() => "p" + random(null).toString().replace(".", ""));
  const mix = (k: number) => interpolateColors(k, [0, 1], [color, "white"]);
  return (
    <svg viewBox="0 0 672 715" width={size} height={size * (715 / 672)} fill="none" style={style}>
      <path fill={`url(#${id})`} d="M238.7 702.2c36.8 13.5 67.9 13 75.3 12.7 30.1-1 54.2-9.3 131-50.9 69.3-37.5 104-56.3 119.3-70.4 51.9-47.9 73.1-102.7 84-131.8 23.4-62.6 20-112.2 22.9-173.5 1.9-41.4 2-86.5-23.4-119.2-16.4-21.2-41.2-33.9-61.5-51.4C546 83.1 521.1 28.5 471.7 9 454.8 2.3 436.3.5 418.1.8c-39 .7-77.1 10.6-114.7 20.7-94.1 25-193.8 54.1-257.8 127.6-24.9 28.6-33.5 52.3-36.4 60.4-11.3 31.4-9.6 60.8-5.8 118.4 3 45.6 5.1 76.6 16.2 118.6 7.6 28.7 15.4 58.3 35.3 92.4 21.3 36.5 45.1 57.6 92.7 99.7 38.7 34.3 58.7 51.7 91.1 63.6Z" />
      <path fill={mix(0.1)} opacity={0.36} d="M111.2 440.5c-.7 3-.2 6.2.2 9.3 1.2 8.3 2.6 17 7.7 23.6 3.2 4.1 7.5 7 11.8 9.9 2.4 1.6 5.1 3.3 8 2.8 4.3-.7 6.4-5.6 7.4-9.8 1.6-6.6 2.5-13.5 1.4-20.3-1.1-7.3-4.5-14-8-20.5-2.4-4.4-5.1-9-9.6-11.1-9-4.3-17.2 8.7-18.9 16.1ZM60.1 227.1c10.2 7.4 23.2 13.7 35 9.3 9.8-3.6 15.8-13.5 20.6-22.8 10-19.4 18.6-39.5 25.7-60.1 1.2-3.6 2.5-7.3 2.2-11.2-.7-9.9-11.7-16.6-21.7-15.9-9.9.7-18.6 6.7-26.2 13.1-19.3 16.4-70 62.5-35.6 87.6ZM105 268.5c-2 9.4.4 20.1 7.8 26.2 3.5 2.9 7.9 4.6 12.3 5.8 9.5 2.4 20.3 2 28.3-3.7 8.4-6 12.4-16.7 13-27 .4-6.2-.3-12.7-2.9-18.3-4-8.7-12.7-15-22.1-16.2-19.1-2.5-32.7 16.4-36.4 33.2ZM407.7 537.7c-2.6 5.2-5.2 10.6-5.4 16.4-.6 16.3 17.1 27.3 33.2 30.3 28.8 5.5 59.3-2.7 83.2-19.5 23.9-16.9 41.5-41.9 52.1-69.2 5.1-13.2 8.4-28.9.6-40.7-6.1-9.3-17.4-13.5-28-17.1-13.9-4.8-28.8-9.6-43.1-6.1-16.5 4-28.4 17.9-39 31.1-19.9 24.5-39.3 46.2-53.6 74.8ZM619.5 445.4c2.7-4.2 3.6-9.4 4.1-14.4 1.1-11.6.4-23.4-2.1-34.8-1.3-6-3.3-12.1-7.3-16.8-4-4.7-10.6-7.6-16.5-5.8-2.6.8-4.9 2.4-7 4.2-13.1 11.4-22 35.4-16.8 52.4 5.3 17.4 32.1 36.2 45.6 15.2ZM538.799 270.5c2.2 6.9 5.9 13.8 12 17.6 6.1 3.8 15.2 3.7 19.9-1.9 5.3-6.2 3.1-15.5.7-23.3-1.9-6.3-4.2-13.1-9.5-17.1-5.2-3.9-23.1-8.7-27.8-2.2-2.8 4.2 3.3 22.6 4.7 26.9ZM567.6 235.1c6.9 4.7 15 9.6 23.1 7.6 4.9-1.2 12.9-6 16.2-10 4.2-5.1 3.2-14.2 2.2-20.3-3.1-18.4-12.3-35.2-23.6-50.1-2.3-3-4.6-5.9-7.1-8.7-9.4-10.5-20.7-20-34.2-24.8-8.5-3-22.5-6.3-30.5-.4-12.7 9.5-5.2 33.1.1 44.7 13.1 28.2 27.9 44.5 53.8 62Z" />
      <path fill={mix(0.1)} opacity={0.18} d="M586.2 117.7c-39.3-33.8-63.9-86.5-111-107.2 4.9 7.3 9.3 14.9 12.8 23 10.7 24.5 13.5 51.6 21.3 77.1 9.1 29.6 24.9 56.7 35.5 85.8 15.6 42.6 19.7 88.8 16 133.9-3.5 42.6-14 85.1-34.8 122.4-34.9 62.7-96.8 107-163.6 133.1-30.4 11.9-62.4 19.9-94.9 23.8-57.1 6.9-116.5 1.1-169.8-21.3-2.8-1.2-5.6-2.4-8.4-3.7 14.9 15.7 33.2 32 58.1 53.9 38.7 34.3 58.7 51.7 91.1 63.6 36.8 13.5 67.9 13 75.3 12.7 30.1-1 54.2-9.3 131-50.9 69.3-37.5 104-56.3 119.3-70.4 51.9-47.9 73.1-102.7 84-131.8 23.4-62.6 20-112.2 22.9-173.5 1.9-41.4 2-86.5-23.4-119.2-16.3-21.1-41-33.8-61.4-51.3Z" />
      <defs>
        <radialGradient id={id} cx={0} cy={0} r={1} gradientTransform="translate(248.22 263.815) scale(686.769)" gradientUnits="userSpaceOnUse">
          {[[0.122, 0.9], [0.273, 0.7], [0.406, 0.5], [0.548, 0.4], [0.584, 0.3], [0.621, 0.2], [0.658, 0.1]].map(([o, k]) => <stop key={o} offset={o} stopColor={mix(k)} />)}
          <stop offset={0.667} stopColor={color} />
        </radialGradient>
      </defs>
    </svg>
  );
};

// Chữ số 7 đoạn vẽ bằng SVG (thay ảnh PNG của mẫu gốc). Đoạn: a trên, b phải trên, c phải dưới, d dưới, e trái dưới, f trái trên, g giữa.
const hseg = (y: number) => `M14 ${y} L22 ${y - 8} L78 ${y - 8} L86 ${y} L78 ${y + 8} L22 ${y + 8} Z`;
const vseg = (x: number, y0: number, y1: number) => `M${x} ${y0} L${x + 8} ${y0 + 8} L${x + 8} ${y1 - 8} L${x} ${y1} L${x - 8} ${y1 - 8} L${x - 8} ${y0 + 8} Z`;
const SEG: Record<string, string> = { a: hseg(9), g: hseg(85), d: hseg(161), f: vseg(9, 14, 80), b: vseg(91, 14, 80), e: vseg(9, 90, 156), c: vseg(91, 90, 156) };
const DIGITS: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
export const SevenSegment: React.FC<{ num: number; fontSize: number; color: string }> = ({ num, fontSize, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const full = String(num);
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      {full.split("").map((d, i) => {
        // Nhấp nháy nhẹ như đèn LED (giữ công thức nhiễu của mẫu gốc, tính theo giây thay vì khung 30 fps).
        const opacity = ((noise2D(i + "x", frame / (fps / 2), 0) + 1) / 2) * 0.3 + 0.7;
        return (
          <svg key={i} viewBox="-6 -2 116 174" height={fontSize} width={fontSize * (116 / 174)} style={{ marginLeft: fontSize / 40, marginRight: fontSize / 40 }}>
            {Object.entries(SEG).map(([k, path]) => <path key={k} d={path} fill={color} opacity={DIGITS[d]?.includes(k) ? opacity : 0.07} transform="translate(9 0) skewX(-6)" />)}
          </svg>
        );
      })}
    </div>
  );
};

export const Pane: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: PANE_BACKGROUND, color: PANE_TEXT_COLOR, border: PANE_BORDER, borderRadius: 50, padding: "28px 44px", ...style }}>{children}</div>
);

export const fadeInOut = (frame: number, dur: number, fps: number) =>
  interpolate(frame, [0, fps * 0.35, dur - fps * 0.4, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
