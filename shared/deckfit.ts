// Số đo khung từng slide của check_artifact (dựng ở cửa sổ 1280×720): slide nào vừa, slide nào tràn và tràn bao nhiêu.
// Dùng cho kết quả check_artifact gửi model và cho hội đồng phản biện (critic) — để cả hai dựa trên số đo thật, không đoán từ mã nguồn.
// Tệp thuần: tests/api/deck-quality.test.mjs.

export type SlideFit = { slide: number; h: number; w: number; vh: number; vw: number };

/** Slide tràn khung (cao hoặc rộng hơn cửa sổ quá dung sai px). */
export const overflowing = (fit: SlideFit[], tol = 4) => fit.filter((f) => f.h > f.vh + tol || f.w > f.vw + tol);

const spans = (xs: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < xs.length; ) { let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++; out.push(j > i ? `${xs[i]}–${xs[j]}` : String(xs[i])); i = j + 1; }
  return out.join(", ");
};
/** Một slide tràn: "slide 6 cao 869px (thừa 149px so với khung 720px)". */
export const overText = (f: SlideFit) => [f.h > f.vh + 4 ? `cao ${f.h}px (thừa ${f.h - f.vh}px so với khung ${f.vh}px)` : "", f.w > f.vw + 4 ? `rộng ${f.w}px (thừa ${f.w - f.vw}px so với khung ${f.vw}px)` : ""].filter(Boolean).join(", ");

/** Dòng tóm tắt cho model: từng slide vừa hay tràn khung. Rỗng khi không có số đo. */
export function fitSummary(fit: SlideFit[]): string {
  if (!fit.length) return "";
  const v = fit[0], bad = overflowing(fit), good = fit.filter((f) => !bad.includes(f)).map((f) => f.slide);
  const head = `Đo khung từng slide ở ${v.vw}×${v.vh}:`;
  if (!bad.length) return `${head} cả ${fit.length} slide đều vừa khung.`;
  return `${head} ${bad.map((f) => `slide ${f.slide} TRÀN — ${overText(f)}`).join("; ")}${good.length ? `; vừa khung: slide ${spans(good)}` : ""}. Slide tràn thì phần dưới bị cắt khi trình chiếu: rút chữ, giảm khoảng trống, hoặc tách thành hai slide, rồi kiểm tra lại.`;
}
