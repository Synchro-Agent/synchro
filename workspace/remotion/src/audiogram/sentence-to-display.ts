// Chuyển từ remotion-dev/template-audiogram src/Audiogram/sentence-to-display.ts (Remotion License, xem ATTRIBUTION.md).
import { Caption } from "@remotion/captions";
import { msToFrame } from "./ms";

export const getSentenceToDisplay = ({
  windowedFrameSubs,
  onlyDisplayCurrentSentence,
  frame,
  fps,
}: {
  windowedFrameSubs: Caption[];
  onlyDisplayCurrentSentence: boolean;
  frame: number;
  fps: number;
}) => {
  // If we don't want to only display the current sentence, return all the words
  if (!onlyDisplayCurrentSentence) return windowedFrameSubs;

  const indexOfCurrentSentence =
    windowedFrameSubs.findLastIndex((w, i) => {
      const nextWord = windowedFrameSubs[i + 1];

      return (
        nextWord &&
        (w.text.endsWith("?") ||
          w.text.endsWith(".") ||
          w.text.endsWith("!")) &&
        msToFrame(nextWord.startMs, fps) < frame
      );
    }) + 1;

  return windowedFrameSubs.slice(indexOfCurrentSentence);
};
