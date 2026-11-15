// Vẽ một icon Phosphor tĩnh (tên Phosphor) từ ui/phosphor-data.ts: hình tô gốc trên lưới 256 + viền STROKE để nét dày bằng bộ icon cũ.
// Dùng chung cho ui/icons.tsx (icon tĩnh) và ui/morph.tsx (lúc đứng yên trước / sau khi biến hình).
import React from "react";
import { PH } from "./phosphor-data";

/** Viền thêm quanh nét của Phosphor Regular (16 → 18 đơn vị trên lưới 256, ~1,27px ở cỡ 18). */
export const STROKE = 2;

export function PhIcon({ ph, size = 18, svgRef }: { ph: string; size?: number; svgRef?: React.Ref<SVGSVGElement> }) {
  const els = PH[ph] ?? [];
  return (
    <svg ref={svgRef} width={size} height={size} viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" aria-hidden className="ph">
      {els.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
