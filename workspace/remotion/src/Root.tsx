// 4 composition, id trùng tên mẫu chủ dịch vụ nêu: tiktok, next-tailwind, audiogram, github-unwrapped.
// calculateMetadata kiểm tra lại props bằng đúng schema của CLI, rồi đặt fps (mặc định 60), kích thước và thời lượng.
import React from "react";
import { type CalculateMetadataFunction, Composition } from "remotion";
import { Audiogram } from "./audiogram/Audiogram";
import EXAMPLES from "./examples.json";
import { Promo } from "./promo/Promo";
import { DEFAULT_SIZE, plannedSeconds, SCHEMAS, sizeOf } from "./schemas.mjs";
import { TikTok } from "./tiktok/TikTok";
import { Recap } from "./unwrapped/Recap";

type Id = keyof typeof SCHEMAS;
const meta = (id: Id): CalculateMetadataFunction<Record<string, unknown>> => async ({ props }) => {
  const r = SCHEMAS[id].safeParse(props);
  if (!r.success) throw new Error(`Props của mẫu ${id} không hợp lệ: ${r.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ")}`);
  const p = r.data as Record<string, unknown> & { fps: number; size?: string; durationSec?: number };
  const sec = p.durationSec ?? plannedSeconds(id, p) ?? 5;
  return { props: p, fps: p.fps, durationInFrames: Math.max(1, Math.round(sec * p.fps)), ...sizeOf(id, p.size ?? DEFAULT_SIZE[id]) };
};
const C = Composition as unknown as React.FC<Record<string, unknown>>;

export const RemotionRoot: React.FC = () => (
  <>
    <C id="tiktok" component={TikTok} width={1080} height={1920} fps={60} durationInFrames={300} defaultProps={EXAMPLES.tiktok} calculateMetadata={meta("tiktok")} />
    <C id="next-tailwind" component={Promo} width={1920} height={1080} fps={60} durationInFrames={300} defaultProps={EXAMPLES["next-tailwind"]} calculateMetadata={meta("next-tailwind")} />
    <C id="audiogram" component={Audiogram} width={1080} height={1080} fps={60} durationInFrames={300} defaultProps={EXAMPLES.audiogram} calculateMetadata={meta("audiogram")} />
    <C id="github-unwrapped" component={Recap} width={1080} height={1080} fps={60} durationInFrames={300} defaultProps={EXAMPLES["github-unwrapped"]} calculateMetadata={meta("github-unwrapped")} />
  </>
);
