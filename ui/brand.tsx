// Logo Synchro — bộ nhận diện v4 "Lệch pha": hai nửa của một vòng tròn lệch nhau đúng một bán kính R và đọc thành chữ S; khi khớp pha
// (đồng bộ xong) hai nửa ghép thành vòng tròn. Hình học lấy từ public/brand/*.svg: R = 350, mark cao 3R, khe R/6 (cỡ ≤ 32px nới thành R/4
// cho khỏi dính), chữ "synchro" là Unbounded Regular đã chuyển nét (7 chữ cái tách riêng để hiện lần lượt). Mọi hình vẽ bằng currentColor:
// Carbon trên nền sáng, Ivory trên nền tối, theo màu chữ xung quanh. Chuyển động trong globals.css (mk-*, lk-*), tắt khi giảm chuyển động.

// Hai nửa đĩa quanh tâm mark (0, 0): nửa trái nhô lên, nửa phải hạ xuống, mỗi nửa lệch R/2. g = nửa khe.
const halves = (g: number) => [`M${-g} -525A350 350 0 0 0 ${-g} 175Z`, `M${g} -175A350 350 0 0 1 ${g} 525Z`] as const;
const MARK = halves(29.17), MARK_SMALL = halves(43.75);
// Chữ "synchro" trong toạ độ lockup ngang (viewBox 0 0 5719.33 1050; tâm mark ở 379.17, 525).
const LETTERS = [
  "M1733.33 636Q1733.33 693 1701.33 735Q1669.33 777 1604.33 799.5Q1539.33 822 1441.33 822Q1340.33 822 1266.33 796.5Q1192.33 771 1151.83 724.5Q1111.33 678 1108.33 617H1240.33Q1246.33 649 1272.83 673.5Q1299.33 698 1342.83 711Q1386.33 724 1442.33 724Q1523.33 724 1564.33 704.5Q1605.33 685 1605.33 645Q1605.33 618 1577.83 604Q1550.33 590 1474.33 583L1363.33 573Q1273.33 565 1221.33 540.5Q1169.33 516 1147.33 480.5Q1125.33 445 1125.33 405Q1125.33 347 1161.33 308Q1197.33 269 1261.33 248.5Q1325.33 228 1410.33 228Q1498.33 228 1567.33 252.5Q1636.33 277 1677.33 320.5Q1718.33 364 1723.33 421H1591.33Q1587.33 398 1567.83 376.5Q1548.33 355 1508.83 340.5Q1469.33 326 1403.33 326Q1333.33 326 1293.83 344Q1254.33 362 1254.33 397Q1254.33 419 1278.33 434.5Q1302.33 450 1367.33 456L1510.33 469Q1596.33 477 1644.83 499.5Q1693.33 522 1713.33 557Q1733.33 592 1733.33 636Z",
  "M1920.33 987Q1870.33 987 1829.83 974.5Q1789.33 962 1754.33 940V841Q1792.33 865 1826.83 876Q1861.33 887 1904.33 887Q1945.33 887 1977.33 868.5Q2009.33 850 2030.33 804L2285.33 242H2423.33L2130.33 848Q2106.33 898 2073.83 928.5Q2041.33 959 2002.83 973Q1964.33 987 1920.33 987ZM1985.33 790 1725.33 242H1868.33L2114.33 790Z",
  "M2447.33 242H2577.33L2611.33 446V808H2481.33V427ZM2836.33 228Q2916.33 228 2972.33 260Q3028.33 292 3057.83 351.5Q3087.33 411 3087.33 495V808H2957.33V516Q2957.33 427 2915.83 381.5Q2874.33 336 2794.33 336Q2739.33 336 2697.83 360.5Q2656.33 385 2633.83 429Q2611.33 473 2611.33 532L2565.33 507Q2574.33 419 2611.33 357Q2648.33 295 2706.33 261.5Q2764.33 228 2836.33 228Z",
  "M3817.33 585Q3807.33 655 3762.33 708.5Q3717.33 762 3647.33 792Q3577.33 822 3491.33 822Q3393.33 822 3318.83 784.5Q3244.33 747 3202.33 680Q3160.33 613 3160.33 525Q3160.33 437 3202.33 370Q3244.33 303 3318.83 265.5Q3393.33 228 3491.33 228Q3577.33 228 3647.33 258Q3717.33 288 3762.33 341.5Q3807.33 395 3817.33 466H3686.33Q3672.33 402 3619.33 366Q3566.33 330 3491.33 330Q3431.33 330 3386.33 353.5Q3341.33 377 3316.83 420.5Q3292.33 464 3292.33 525Q3292.33 585 3316.83 629Q3341.33 673 3386.33 696.5Q3431.33 720 3491.33 720Q3567.33 720 3620.33 683Q3673.33 646 3686.33 585Z",
  "M3891.33 38H4021.33V808H3891.33ZM4246.33 228Q4326.33 228 4382.33 260Q4438.33 292 4467.83 351.5Q4497.33 411 4497.33 495V808H4367.33V516Q4367.33 427 4325.83 381.5Q4284.33 336 4204.33 336Q4149.33 336 4107.83 360.5Q4066.33 385 4043.83 429Q4021.33 473 4021.33 532L3975.33 507Q3984.33 419 4021.33 357Q4058.33 295 4116.33 261.5Q4174.33 228 4246.33 228Z",
  "M4575.33 242H4705.33L4739.33 448V808H4609.33V423ZM5026.33 238V352Q5004.33 346 4978.33 343Q4952.33 340 4929.33 340Q4874.33 340 4831.33 364Q4788.33 388 4763.83 435.5Q4739.33 483 4739.33 552L4709.33 515Q4713.33 455 4729.83 402.5Q4746.33 350 4775.83 311Q4805.33 272 4848.33 250Q4891.33 228 4948.33 228Q4968.33 228 4989.33 230.5Q5010.33 233 5026.33 238Z",
  "M5374.33 822Q5271.33 822 5193.83 784.5Q5116.33 747 5072.83 680Q5029.33 613 5029.33 525Q5029.33 436 5072.83 369.5Q5116.33 303 5193.83 265.5Q5271.33 228 5374.33 228Q5477.33 228 5554.83 265.5Q5632.33 303 5675.83 369.5Q5719.33 436 5719.33 525Q5719.33 613 5675.83 680Q5632.33 747 5554.83 784.5Q5477.33 822 5374.33 822ZM5374.33 720Q5440.33 720 5487.83 696Q5535.33 672 5561.33 628.5Q5587.33 585 5587.33 525Q5587.33 465 5561.33 421.5Q5535.33 378 5487.83 354Q5440.33 330 5374.33 330Q5309.33 330 5261.33 354Q5213.33 378 5187.33 421.5Q5161.33 465 5161.33 525Q5161.33 585 5187.33 628.5Q5213.33 672 5261.33 696Q5309.33 720 5374.33 720Z"
];

type MarkState = "s" | "sync" | "intro" | "close";

/** Biểu tượng (mark). size: chiều cao (px). state: "s" chữ S (mặc định), "sync" khớp thành vòng tròn (đổi qua lại có chuyển động),
 *  "intro" vòng tròn hiện ra rồi tách thành S,
 *  "close" vừa xong việc: chữ S khớp pha thành vòng tròn. */
export function Mark({ size = 20, state = "s", title, className = "" }: { size?: number; state?: MarkState; title?: string; className?: string }) {
  const [a, b] = size <= 32 ? MARK_SMALL : MARK;
  const g = size <= 32 ? 43.75 : 29.17, w = 700 + 2 * g;
  return (
    <svg className={`mk mk-${state} ${className}`} viewBox={`${-w / 2} -525 ${w} 1050`} height={size} width={Math.round((size * w) / 1050 * 100) / 100}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g className="mk-r"><path className="mk-a" d={a} /><path className="mk-b" d={b} /></g>
    </svg>
  );
}

/** Lockup ngang (mark + chữ). height: chiều cao (px). intro: chuyển động mở đầu 2,7 giây (vòng tròn → lệch pha thành S → trượt sang trái
 *  → từng chữ hiện, cách nhau 45ms). Rê chuột (lớp .lk-hover) thì hai nửa khớp thành vòng tròn. */
export function Lockup({ height = 20, intro = false, className = "" }: { height?: number; intro?: boolean; className?: string }) {
  return (
    <svg className={`lk ${intro ? "lk-intro" : ""} ${className}`} viewBox="0 0 5719.33 1050" height={height} width={Math.round(height * 5.4470 * 100) / 100} role="img" aria-label="Synchro">
      <g className="lk-slide"><g transform="translate(379.17 525)"><g className="lk-in"><g className="mk-r"><path className="mk-a" d={MARK[0]} /><path className="mk-b" d={MARK[1]} /></g></g></g></g>
      {LETTERS.map((d, i) => <path key={i} className="lk-l" style={{ "--i": i } as React.CSSProperties} d={d} />)}
    </svg>
  );
}

/** Chữ "synchro" đứng riêng (thanh bên: chỉ chữ, không kèm mark). */
export const Wordmark = ({ height = 16, className = "" }: { height?: number; className?: string }) => (
  <svg className={`lk ${className}`} viewBox="1108.33 38 4611 949" height={height} width={Math.round((height * 4611) / 949 * 100) / 100} role="img" aria-label="Synchro">
    {LETTERS.map((d, i) => <path key={i} d={d} />)}
  </svg>
);

/** Nút mở thanh bên khi thanh bên đang đóng — chính là logo. Trên máy tính logo ở đầu thanh điều hướng là chỗ duy nhất mở / đóng bảng đoạn chat,
 *  nên nút này chỉ hiện trên điện thoại (thanh điều hướng nằm trong ngăn kéo, đóng thì logo hiện ở góc trái trên của trang). */
export function SideToggle({ onClick }: { onClick: () => void }) {
  return <button className="side-toggle" onClick={onClick} aria-label="Mở thanh bên"><Mark size={18} /></button>;
}
