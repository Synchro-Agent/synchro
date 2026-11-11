// Nhạc nền và tiện ích chung cho cả 4 mẫu.
import { Audio } from "@remotion/media";
import React from "react";

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Nhạc nền lặp lại hết video, thấp hơn giọng (mặc định -18 dB), mờ dần 1 giây cuối. */
export const Music: React.FC<{ src: string; volumeDb: number; durationInFrames: number; fps: number }> = ({ src, volumeDb, durationInFrames, fps }) => {
  const g = dbToGain(volumeDb);
  return (
    <Audio src={src} loop volume={(f) => {
      const fadeIn = Math.min(1, f / (fps * 0.5));
      const fadeOut = Math.min(1, Math.max(0, (durationInFrames - f) / fps));
      return g * fadeIn * fadeOut;
    }} />
  );
};
