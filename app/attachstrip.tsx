"use client";
// Dải thẻ đính kèm dùng chung cho mọi ô soạn tin (chat thường và Synchro Code), U2 của blueprint: quá CHIP_LIMIT thẻ thì dải một hàng chỉ dựng
// những thẻ hiện trọn được (tối đa CHIP_LIMIT) rồi "+N" ở mép phải: dải không tràn, không thẻ nào bị mép cắt ngang hay mờ đi, "+N" luôn thấy dù
// màn hẹp. Bấm "+N" thì trải ra lưới nhiều hàng; "Thu gọn" của lưới đứng ngoài khung cuộn. Logic đo đạc ở app/composerchips.ts.
import { useRef, type ReactElement, type ReactNode } from "react";
import { CHIP_LIMIT, hiddenCards, useEdgeFade, useFitCount } from "./composerchips";
import { tr } from "./i18n";

export function AttachStrip({ cards, open, setOpen, lead, className = "" }: {
  /** Thẻ theo thứ tự (mỗi thẻ có key riêng, gốc là .ft hoặc .pick-chip). */
  cards: ReactElement[];
  /** Đang trải lưới (trạng thái do ô soạn giữ để đặt lại khi gửi tin / còn ít thẻ). */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Phần tử phụ dựng trong dải trước các thẻ (vd. menu chuột phải của tệp). */
  lead?: ReactNode;
  /** Lớp thêm cho khung dải (.cv-attach của Synchro Code). */
  className?: string;
}) {
  const chipsExpanded = open && cards.length > CHIP_LIMIT;
  const stripRef = useRef<HTMLDivElement>(null);
  const chipsFit = useFitCount(stripRef, cards.length > CHIP_LIMIT && !chipsExpanded, cards.map((c) => String(c.key)));
  const chipsHidden = hiddenCards(cards.length, chipsExpanded, cards.length > CHIP_LIMIT ? Math.min(CHIP_LIMIT, chipsFit) : CHIP_LIMIT);
  // Mờ mép chỉ khi dải (hay lưới) thật sự còn thẻ bị khuất ở mép đó.
  const [, stripFade] = useEdgeFade<HTMLDivElement>(chipsExpanded ? "y" : "x", `${cards.length}-${chipsHidden}${chipsExpanded ? "g" : ""}`, stripRef);
  if (!cards.length) return null;
  return (
    <div className={`attach-wrap${chipsExpanded ? " open" : ""}`}>
      <div ref={stripRef} className={`attach${className ? ` ${className}` : ""}${chipsExpanded ? " attach-grid" : ""}${stripFade ? ` ${stripFade}` : ""}`}>{lead}
        {chipsHidden > 0 ? cards.slice(0, cards.length - chipsHidden) : cards}
        {chipsHidden > 0 && <button type="button" className="attach-more" onClick={() => setOpen(true)} aria-label={`${tr("Hiện thêm")} ${chipsHidden} ${tr("mục")}`} data-tip={`${tr("Hiện thêm")} ${chipsHidden} ${tr("mục")}`}>+{chipsHidden}</button>}</div>
      {chipsExpanded && <button type="button" className="attach-more attach-less" onClick={() => setOpen(false)} aria-label={tr("Thu gọn")} data-tip={tr("Thu gọn")}>{tr("Thu gọn")}</button>}
    </div>
  );
}
