// Mốc màn hình dùng chung cho mã (matchMedia) — khớp với chú thích trong app/_shell/tokens.css và danh sách WIDTHS của tools/css-metrics.mjs.
// drawer: ≤ 760px thanh bên thành ngăn kéo điện thoại (CSS: max-width:760px / min-width:761px). md: ≤ 860px thanh rail máy tính bảng.
export const BP = { xs: 480, sm: 640, drawer: 760, md: 860, lg: 1100 } as const;
/** Truy vấn @media "tới hết" một mốc, vd. maxW("drawer") = "(max-width: 760px)". */
export const maxW = (k: keyof typeof BP) => `(max-width: ${BP[k]}px)`;
