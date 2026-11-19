// Số đo khung từng slide của check_artifact (dựng ở cửa sổ 1280×720): slide nào vừa, slide nào tràn và tràn bao nhiêu.
// Dùng cho kết quả check_artifact gửi model và cho hội đồng phản biện (critic) — để cả hai dựa trên số đo thật, không đoán từ mã nguồn.
// Tệp thuần: tests/api/deck-quality.test.mjs.

// over: nội dung tràn mà bộ tự co chữ (FIT_JS) không co vừa được, hoặc slide không có ô chữ nào co được. Slide của
// bộ thiết kế tự cắt phần thừa (overflow hidden) nên cao / rộng đo được luôn bằng khung; không có cờ này thì slide
// tràn được báo là vừa.
// title, body, lead: cỡ tiêu đề lớn nhất, cỡ chữ thân chiếm nhiều chữ nhất, cỡ chữ thân lớn nhất (thường là dòng mô
// tả dưới tiêu đề), px ở khung rộng 1280.
export type SlideFit = {
  slide: number; h: number; w: number; vh: number; vw: number;
  over?: boolean; title?: number; body?: number; lead?: number;
};

/** Slide tràn khung (cao hoặc rộng hơn cửa sổ quá dung sai px, hoặc bộ tự co không co vừa được). */
export const overflowing = (fit: SlideFit[], tol = 4) =>
  fit.filter((f) => f.over || f.h > f.vh + tol || f.w > f.vw + tol);

/** Cỡ tiêu đề nhỏ nhất bộ tự co được thu tới, px ở khung rộng 1280: nhỏ hơn thì ảnh thu nhỏ không đọc được tiêu đề. */
export const TITLE_FLOOR = 28;
/** Tiêu đề phải lớn ít nhất ngần này lần chữ thân thì người xem mới thấy ngay đâu là ý chính. */
export const TYPE_RATIO = 1.4;
// Dòng mô tả dưới tiêu đề thường lớn hơn chữ thân một bậc. Thang 1,333 (bậc liền kề) vẫn đạt; tiêu đề bằng dòng mô
// tả thì không, đó đúng là lỗi chủ dự án gặp ở bìa bộ slide (tiêu đề không nổi hơn dòng mô tả bên dưới).
export const LEAD_RATIO = 1.2;
export const TITLE_SEL = "h1,h2,.sx-title,.sx-display,.typo-action-title";
const BODY_SEL = "p,li,dd,td,figcaption,.sx-text,.sx-lead,.body-copy";
// Ô tiêu đề và ô chữ thân của một vùng, chạy trong trang. ES5, không dấu backtick: được nhúng nguyên văn vào bộ
// tự co FIT_JS. Chữ thân chỉ gồm đoạn từ 4 từ trở lên, ngoài tiêu đề và trích dẫn: số KPI, nhãn ngắn, chữ trang trí
// khổng lồ hay câu trích lớn mà tính là chữ thân thì sàn của tiêu đề bị đẩy lên theo chúng, tiêu đề không co được
// nữa dù slide còn chỗ.
// sxTitleMin: cỡ tiêu đề nhỏ nhất bộ tự co được để lại so với chữ thân lớn nhất b. Bộ kiểm tra đo cỡ đã làm tròn,
// nên làm tròn lên cả hai lần: tiêu đề bộ tự co để lại luôn đạt weakType, cả với tỉ lệ dòng mô tả (LEAD_RATIO nhỏ
// hơn TYPE_RATIO, b là chữ thân lớn nhất). Bộ tự co mà tự tạo lỗi thứ bậc thì bộ kiểm tra lại bắt model sửa lỗi
// Synchro gây ra.
export const TYPE_ELS_JS = String.raw`function sxTypeEls(root){
var T="${TITLE_SEL}",B="${BODY_SEL}";
function shown(e){return e.getClientRects().length>0&&!e.closest("[aria-hidden=true]")}
function words(e){return(e.textContent||"").trim().split(/\s+/).filter(Boolean).length}
var t=[].slice.call(root.querySelectorAll(T)).filter(function(e){return shown(e)&&words(e)>0});
var b=[].slice.call(root.querySelectorAll(B)).filter(function(e){
return shown(e)&&!e.closest(T)&&!e.closest("blockquote")&&words(e)>=4});
return{t:t,b:b,T:T}}
function sxTitleMin(b){return Math.ceil(${TYPE_RATIO}*Math.ceil(b))}`;
// Đo thứ bậc cỡ chữ của một slide (chạy trong trang, sau bộ tự co): cỡ quy về khung rộng 1280 để so được giữa
// slide 1280 và khung 1920 thu nhỏ. Chữ thân lấy cỡ chiếm nhiều ký tự nhất (cỡ người xem đọc nhiều nhất), dòng mô
// tả lớn nhất đo riêng (lead).
export const TYPE_JS = String.raw`function(root){${TYPE_ELS_JS}
var e=sxTypeEls(root),k=1280/(root.offsetWidth||1280),chars={},title=0,lead=0,body=0,most=0;
function px(x){return Math.round(parseFloat(getComputedStyle(x).fontSize)*k)}
e.t.forEach(function(x){title=Math.max(title,px(x))});
e.b.forEach(function(x){
var p=px(x);
lead=Math.max(lead,p);
chars[p]=(chars[p]||0)+(x.textContent||"").trim().length});
for(var p in chars){
if(chars[p]<=most)continue;
most=chars[p];
body=+p}
return{title:title,body:body,lead:lead}}`;

const leadWeak = (f: SlideFit) => !!f.lead && (f.lead > (f.body ?? 0)) && (f.title ?? 0) < LEAD_RATIO * f.lead;
/** Slide có tiêu đề không nổi hơn chữ thân: dưới TYPE_RATIO lần chữ thân hoặc dưới LEAD_RATIO lần dòng mô tả. */
export const weakType = (fit: SlideFit[]) =>
  fit.filter((f) => !!f.title && !!f.body && (f.title < TYPE_RATIO * f.body || leadWeak(f)));
/** Chữ đem so với tiêu đề của slide yếu: dòng mô tả khi tiêu đề không đủ lớn hơn nó, không thì chữ thân. */
export const typeWhy = (f: SlideFit) => leadWeak(f)
  ? { lead: true, size: f.lead ?? 0, ratio: LEAD_RATIO }
  : { lead: false, size: f.body ?? 0, ratio: TYPE_RATIO };
/** Số thập phân viết kiểu Việt (1,4) cho lời nhắc model. */
export const viNum = (n: number) => String(n).replace(".", ",");
/** Dòng cho model: slide có thứ bậc cỡ chữ yếu (rỗng nếu không có). */
export const typeNote = (fit: SlideFit[]) => weakType(fit).map((f) => {
  const w = typeWhy(f), what = w.lead ? "dòng mô tả" : "chữ thân";
  return `- Slide ${f.slide}: thứ bậc cỡ chữ yếu — tiêu đề ${f.title}px, ${what} ${w.size}px; tiêu đề cần lớn ít nhất `
    + `${viNum(w.ratio)} lần ${what}. Tăng cỡ tiêu đề, rút chữ thân hoặc tách slide.`;
});

const spans = (xs: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < xs.length; ) { let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++; out.push(j > i ? `${xs[i]}–${xs[j]}` : String(xs[i])); i = j + 1; }
  return out.join(", ");
};
/** Một slide tràn: "slide 6 cao 869px (thừa 149px so với khung 720px)". */
export const overText = (f: SlideFit) => {
  const tall = f.h > f.vh + 4 ? `cao ${f.h}px (thừa ${f.h - f.vh}px so với khung ${f.vh}px)` : "";
  const wide = f.w > f.vw + 4 ? `rộng ${f.w}px (thừa ${f.w - f.vw}px so với khung ${f.vw}px)` : "";
  const stuck = f.over && !tall && !wide
    ? "nội dung tràn và bị khung cắt mất; co chữ cũng không vừa nên Synchro giữ nguyên cỡ chữ" : "";
  return [tall, wide, stuck].filter(Boolean).join(", ");
};

/** Dòng tóm tắt cho model: từng slide vừa hay tràn khung. Rỗng khi không có số đo. */
export function fitSummary(fit: SlideFit[]): string {
  if (!fit.length) return "";
  const v = fit[0], bad = overflowing(fit), good = fit.filter((f) => !bad.includes(f)).map((f) => f.slide);
  const head = `Đo khung từng slide ở ${v.vw}×${v.vh}:`;
  if (!bad.length) return `${head} cả ${fit.length} slide đều vừa khung.`;
  return `${head} ${bad.map((f) => `slide ${f.slide} TRÀN — ${overText(f)}`).join("; ")}${good.length ? `; vừa khung: slide ${spans(good)}` : ""}. Slide tràn thì phần dưới bị cắt khi trình chiếu: rút chữ, giảm khoảng trống, hoặc tách thành hai slide, rồi kiểm tra lại.`;
}
