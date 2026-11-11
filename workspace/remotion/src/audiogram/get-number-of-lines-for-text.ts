// Chuyển từ remotion-dev/template-audiogram src/Audiogram/get-number-of-lines-for-text.ts (Remotion License, xem ATTRIBUTION.md).
import { Caption } from "@remotion/captions";
import { fillTextBox } from "@remotion/layout-utils";
import { msToFrame } from "./ms";

export const layoutText = ({
  captions,
  textBoxWidth,
  fontFamily,
  fontSize,
}: {
  captions: Caption[];
  textBoxWidth: number;
  fontFamily: string;
  fontSize: number;
}) => {
  let box = fillTextBox({
    maxBoxWidth: textBoxWidth,
    maxLines: 1_000,
  });

  const lines: Caption[][] = [[]];

  for (const [index, caption] of captions.entries()) {
    const isFirstCaption = index === 0;
    const previousCaption = captions[index - 1];
    const startsNewPage = Boolean(previousCaption?.pageBreakAfter);
    if (startsNewPage) {
      lines.push([]);
      box = fillTextBox({
        maxBoxWidth: textBoxWidth,
        maxLines: 1_000,
      });
    }
    const { newLine } = box.add({
      text:
        isFirstCaption || startsNewPage
          ? caption.text.trimStart()
          : caption.text,
      fontFamily,
      fontSize,
    });

    if (newLine) {
      lines.push([]);
    }

    const newCaption = { ...caption };
    if (newLine || isFirstCaption || startsNewPage) {
      newCaption.text = newCaption.text.trimStart();
      box.add({
        text: " ".repeat(caption.text.length - newCaption.text.length),
        fontFamily,
        fontSize,
      });
    }

    lines[lines.length - 1].push(newCaption);
  }

  return lines;
};

export const filterCurrentlyDisplayedLines = ({
  lines,
  frame,
  fps,
  linesPerPage,
}: {
  lines: Caption[][];
  frame: number;
  fps: number;
  linesPerPage: number;
}) => {
  const currentlyActiveLines = lines.filter((line) => {
    return line.some((item) => {
      return msToFrame(item.startMs, fps) < frame;
    });
  });

  const lastPageBreak = currentlyActiveLines.findLastIndex((line, index) => {
    return (
      index < currentlyActiveLines.length - 1 &&
      Boolean(line.at(-1)?.pageBreakAfter)
    );
  });
  const currentPageLines = currentlyActiveLines.slice(lastPageBreak + 1);

  // Return the last 4 lines
  return currentPageLines.slice(-linesPerPage);
};
