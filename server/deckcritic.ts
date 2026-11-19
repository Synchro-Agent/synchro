// Số đo thật của Synchro cho hội đồng phản biện bộ slide (app/api/critic/route.ts): slide tràn khung 1280×720 và đánh số slide lệch thành mục phản biện
// (không phải ý kiến model), số đo đưa cho model phản biện để không đoán lỗi tràn từ mã nguồn. Tệp riêng để kiểm thử thẳng: tests/api/deck-quality.test.mjs.
import "server-only";
import type { Finding } from "../shared/critic";
import { deckSlides, type NumIssue } from "../shared/decknum";
import { overflowing, overText } from "../shared/deckfit";
import type { Lang } from "../shared/i18n-core";
import type { DeckLayout } from "./artcheck";
import { tfOn, trOn } from "./i18n-server";

// Số đo thật của Synchro thành mục phản biện (không phải ý kiến model): slide tràn khung 1280×720 và đánh số slide lệch nhau.
// Nhiều slide cùng tràn (từ 4 slide) thì gộp thành một mục, không rải một mục "Nghiêm trọng" cho từng slide.
const OVER_MAX = 3;
export function deckFindings(content: string, lay: DeckLayout | null, nums: NumIssue[], lang: Lang): Finding[] {
  const slides = deckSlides(content), lineOf = (k: number) => slides[k - 1]?.line ?? 1;
  const out: Finding[] = [];
  const bad = lay ? overflowing(lay.fit) : [];
  if (bad.length > OVER_MAX) {
    const line = lineOf(bad[0].slide), v = bad[0];
    out.push({ line_start: line, line_end: line, severity: "high", by: ["Synchro"], suggested_fix: "", title: tfOn("{count} slide tràn khung khi trình chiếu", { count: bad.length }, lang),
      detail: tfOn("Đo thật ở {vw}×{vh}: slide {slides} cao hoặc rộng hơn khung, phần thừa bị cắt khi trình chiếu. Rút chữ, giảm khoảng trống hoặc tách slide.", { vw: v.vw, vh: v.vh, slides: bad.map((f) => f.slide).join(", ") }, lang) });
  } else for (const f of bad) {
    const tall = f.h > f.vh + 4, line = lineOf(f.slide);
    out.push({ line_start: line, line_end: line, severity: "high", by: ["Synchro"], suggested_fix: "", title: tfOn("Slide {n} tràn khung khi trình chiếu", { n: f.slide }, lang),
      detail: tall ? tfOn("Đo thật ở {vw}×{vh}: slide {n} cao {h}px, thừa {over}px so với khung, phần dưới bị cắt khi trình chiếu. Rút chữ, giảm khoảng trống hoặc tách thành hai slide.", { vw: f.vw, vh: f.vh, n: f.slide, h: f.h, over: f.h - f.vh }, lang)
        : tfOn("Đo thật ở {vw}×{vh}: slide {n} rộng {w}px, thừa {over}px so với khung, phần bên phải bị cắt khi trình chiếu. Rút chữ hoặc chia lại cột.", { vw: f.vw, vh: f.vh, n: f.slide, w: f.w, over: f.w - f.vw }, lang) });
  }
  for (const x of nums) {
    const v = x.vars;
    const detail = x.kind === "order" ? tfOn("Số trang không theo thứ tự slide ở slide {slides}.", { slides: v.slides }, lang)
      : x.kind === "total" ? tfOn("Tổng số trang ghi trên các slide không đồng nhất (slide {slides}).", { slides: v.slides }, lang)
      : x.kind === "count" ? tfOn("Chân trang ghi tổng {of} trang nhưng bộ slide có {total} slide.", { of: v.of, total: v.total }, lang)
      : x.kind === "brow" ? tfOn("Nhãn mục nhảy cóc hoặc đi lùi ở slide {slides} (theo thứ tự phải là {want}).", { slides: v.slides, want: v.want }, lang)
      : tfOn("Nhãn mục ({brows}) đã vượt lên trước số trang ({pages}) trên slide {slides}: đánh số lại cho cùng một dãy.", { brows: v.brows, pages: v.pages, slides: v.slides }, lang);
    // Nhiều kiểu lỗi đánh số cùng một slide (số trang sai thứ tự và nhãn mục nhảy cóc): một ghi chú, các câu nối nhau.
    const same = out.find((f) => f.line_start === x.line && f.by?.includes("Synchro") && f.severity === "medium");
    if (same) same.detail += ` ${detail}`;
    else out.push({ line_start: x.line, line_end: x.line, severity: "medium", by: ["Synchro"], suggested_fix: "", title: trOn("Đánh số slide không nhất quán", lang), detail });
  }
  return out;
}
// Số đo cho model phản biện: để không đoán lỗi tràn từ mã nguồn (từng báo "biểu đồ cột tràn ngang" trên slide vừa khung).
export function deckFacts(lay: DeckLayout | null, nums: NumIssue[]): string {
  const rows: string[] = [];
  if (lay?.fit.length) {
    const bad = overflowing(lay.fit);
    rows.push(bad.length ? `Synchro đã dựng từng slide ở ${lay.fit[0].vw}×${lay.fit[0].vh} và đo: ${bad.map((f) => `slide ${f.slide} ${overText(f)}`).join("; ")}; các slide khác vừa khung. Các lỗi tràn này Synchro tự báo, bạn không cần nêu lại.`
      : `Synchro đã dựng từng slide ở ${lay.fit[0].vw}×${lay.fit[0].vh} và đo: cả ${lay.fit.length} slide đều vừa khung, không phần tử nào tràn. Không nêu lỗi tràn khung / tràn ngang / bị cắt.`);
  }
  if (nums.length) rows.push(`Synchro đã báo lỗi đánh số slide: ${nums.map((x) => x.prompt).join("; ")}. Không nêu lại.`);
  return rows.length ? `\n<measured>\n${rows.join("\n")}\n</measured>` : "";
}
// Khi đã đo và không slide nào tràn: ý kiến "tràn / bị cắt" của model là đoán từ mã nguồn, trái với số đo thật.
const OVERFLOW_CLAIM = /tràn|bị cắt|overflow|clipped|cut off/i;
export const contradicts = (lay: DeckLayout | null, f: Finding) => !!lay?.fit.length && !overflowing(lay.fit).length && !lay.issues.some((x) => /tràn|cắt/.test(x.kind)) && OVERFLOW_CLAIM.test(`${f.title} ${f.detail}`);
