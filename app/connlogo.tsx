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

// Logo connector: logo có sẵn của danh mục, logo Synchro tự tìm (data URI, chỉ hiện trong <img>), hoặc chữ cái đầu.
export function ConnLogo({ logo, color, icon, name, size = 36 }: { logo?: string; color?: string; icon?: string; name: string; size?: number }) {
  // undefined: chưa đo (ẩn ảnh một nhịp cho khỏi nhảy cỡ); string: ảnh là một ô, màu nền của nó; null: logo nét.
  const [tile, setTile] = useState<string | null | undefined>(() => (icon ? tiles.get(icon) : undefined));
  // Ảnh không tải được (logo Composio chưa có, mất mạng): quay về chữ cái đầu, không để ô ảnh vỡ.
  const [bad, setBad] = useState(false);
  useEffect(() => { setTile(icon ? tiles.get(icon) : undefined); setBad(false); }, [icon]);
  const measure = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (!icon) return;
    if (!tiles.has(icon)) tiles.set(icon, tileColor(e.currentTarget));
    setTile(tiles.get(icon));
  };
  const fill = !logo && !!icon && !bad && typeof tile === "string";
  const px = fill ? size : Math.round(size * 0.62);
  return (
    <span className={`cn-logo${fill ? " tile" : ""}`} style={{ width: size, height: size, borderRadius: "25%", background: fill ? tile! : undefined }} aria-hidden>
      {logo ? <img src={`/connectors/${logo}.svg`} alt="" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
        : icon && !bad ? <img src={icon} alt="" width={px} height={px} onLoad={measure} onError={() => { setTile(null); setBad(true); }} style={{ objectFit: fill ? "cover" : "contain", visibility: tile === undefined ? "hidden" : undefined }} />
        : <span className={`cn-mono ${color ? "" : "plain"}`} style={color ? { background: color } : undefined} data-notr>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
    </span>
  );
}
