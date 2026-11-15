"use client";
// Logo connector: tách khỏi connectorsui.tsx (nặng, tải chậm khi mở Kết nối) vì menu + của ô soạn tin luôn cần.
import { useEffect, useState } from "react";

// Logo Synchro tự tìm nhiều khi là cả một biểu tượng ứng dụng có nền riêng (apple-touch-icon: ô chanh của Higgsfield…): đặt nhỏ giữa ô trắng
// thì thành "ô lồng trong ô". Đo một lần mỗi ảnh (canvas 32×32): viền trong của ảnh (cách mép 3px, bỏ góc bo) kín màu thì ảnh là một ô
// → phủ kín ô logo, nền ô lấy màu viền ảnh (góc bo của ảnh không lộ nền trắng). Logo nét trên nền trong suốt: null, vẫn đặt giữa ô trắng.
const tiles = new Map<string, string | null>();
function tileColor(img: HTMLImageElement): string | null {
  const N = 32, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  if (!cx || !img.naturalWidth) return null;
  let d: Uint8ClampedArray;
  try { cx.drawImage(img, 0, 0, N, N); d = cx.getImageData(0, 0, N, N).data; } catch { return null; }
  let n = 0, full = 0, r = 0, g = 0, b = 0;
  for (let i = 8; i < N - 8; i++) for (const [x, y] of [[i, 3], [i, N - 4], [3, i], [N - 4, i]]) {
    const k = (y * N + x) * 4; n++;
    if (d[k + 3] > 230) { full++; r += d[k]; g += d[k + 1]; b += d[k + 2]; }
  }
  return full >= n * 0.9 ? `rgb(${Math.round(r / full)}, ${Math.round(g / full)}, ${Math.round(b / full)})` : null;
}

// Logo connector (server/connlogos.ts quyết định ở máy chủ): logo có sẵn (public/connectors), logo Synchro tự tìm (data URI) hoặc ảnh tải hộ
// (/api/favicon?app=… của ứng dụng Composio), rồi biểu tượng trang của máy chủ MCP / máy chủ đăng nhập (site, /api/favicon?d=…), cuối cùng là chữ cái đầu.
// Ảnh nào không tải được thì chuyển sang ảnh kế tiếp, không để ô ảnh vỡ. Mọi ảnh chỉ hiện trong <img> nên SVG có script cũng không chạy được.
export function ConnLogo({ logo, color, icon, site, name, size = 36 }: { logo?: string; color?: string; icon?: string; site?: string; name: string; size?: number }) {
  const srcs = [icon, site].filter((x): x is string => !!x);
  const sig = srcs.join("\n");
  // Ảnh đang thử (vị trí trong srcs); quá số ảnh là hết ảnh, hiện chữ cái đầu.
  const [at, setAt] = useState(0);
  const cur = srcs[at];
  // undefined: chưa đo (ẩn ảnh một nhịp cho khỏi nhảy cỡ); string: ảnh là một ô, màu nền của nó; null: logo nét.
  const [tile, setTile] = useState<string | null | undefined>(() => (cur ? tiles.get(cur) : undefined));
  useEffect(() => { setAt(0); }, [sig]);
  useEffect(() => { setTile(cur ? tiles.get(cur) : undefined); }, [cur]);
  const measure = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (!cur) return;
    if (!tiles.has(cur)) tiles.set(cur, tileColor(e.currentTarget));
    setTile(tiles.get(cur));
  };
  const fill = !logo && !!cur && typeof tile === "string";
  const px = fill ? size : Math.round(size * 0.62);
  return (
    <span className={`cn-logo${fill ? " tile" : ""}`} style={{ width: size, height: size, borderRadius: "25%", background: fill ? tile! : undefined }} aria-hidden>
      {logo ? <img src={`/connectors/${logo}.svg`} alt="" width={Math.round(size * (logo === "composio" ? 0.66 : 0.55))} height={Math.round(size * (logo === "composio" ? 0.66 : 0.55))} />
        : cur ? <img key={cur} src={cur} alt="" width={px} height={px} onLoad={measure} onError={() => { setTile(undefined); setAt((i) => i + 1); }} style={{ objectFit: fill ? "cover" : "contain", visibility: tile === undefined ? "hidden" : undefined }} />
        : <span className={`cn-mono ${color ? "" : "plain"}`} style={{ ...(color ? { background: color } : {}), ...(size <= 16 ? { fontSize: Math.round(size * 0.6) } : {}) }} data-notr>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
    </span>
  );
}
