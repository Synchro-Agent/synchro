// Chuyển từ remotion-dev/template-audiogram src/Audiogram/Captions.tsx (Remotion License, xem ATTRIBUTION.md).
import { Caption } from "@remotion/captions";
import React, { useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { msToFrame } from "./ms";
import {
  filterCurrentlyDisplayedLines,
  layoutText,
} from "./get-number-of-lines-for-text";
import { getSentenceToDisplay } from "./sentence-to-display";
import { Word } from "./Word";

const useWindowedFrameCaptions = ({
  captions,
  windowStart,
  windowEnd,
  fps,
}: {
  captions: Caption[];
  windowStart: number;
  windowEnd: number;
  fps: number;
}) => {
  return useMemo(() => {
    return captions.filter(({ startMs, endMs }) => {
      return msToFrame(startMs, fps) >= windowStart && msToFrame(endMs, fps) <= windowEnd;
    });
  }, [captions, windowEnd, windowStart, fps]);
};

export const PaginatedCaptions: React.FC<{
  readonly captions: Caption[];
  readonly startFrame: number;
  readonly endFrame: number;
  readonly linesPerPage: number;
  readonly subtitlesTextColor: string;
  readonly onlyDisplayCurrentSentence: boolean;
  readonly textBoxWidth: number;
  readonly fontFamily: string;
  readonly fontSize: number;
}> = ({
  startFrame,
  endFrame,
  captions,
  subtitlesTextColor: transcriptionColor,
  onlyDisplayCurrentSentence,
  textBoxWidth,
  linesPerPage,
  fontFamily,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const windowRef = useRef<HTMLDivElement>(null);
  const windowedFrameSubs = useWindowedFrameCaptions({
    captions,
    windowStart: startFrame,
    windowEnd: endFrame,
    fps,
  });

  const currentSentence = useMemo(() => {
    return getSentenceToDisplay({
      frame,
      onlyDisplayCurrentSentence,
      windowedFrameSubs,
      fps,
    });
  }, [frame, onlyDisplayCurrentSentence, windowedFrameSubs, fps]);

  const lines = useMemo(() => {
    return layoutText({
      captions: currentSentence,
      textBoxWidth,
      fontFamily,
      fontSize,
    });
  }, [currentSentence, textBoxWidth, fontFamily, fontSize]);

  const currentlyShownLines = filterCurrentlyDisplayedLines({
    lines,
    frame,
    fps,
    linesPerPage,
  });

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        paddingBottom: "20px",
      }}
    >
      <div ref={windowRef}>
        {currentlyShownLines.map((line) => (
          <div key={line.map((item) => item.text).join(" ")}>
            {line.map((item) => (
              <span
                key={item.startMs + item.endMs}
                id={String(item.startMs + item.endMs)}
              >
                <Word
                  frame={frame}
                  item={item}
                  transcriptionColor={transcriptionColor}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
