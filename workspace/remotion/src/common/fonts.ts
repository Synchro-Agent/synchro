// Phông có đủ dấu tiếng Việt, nạp từ public/fonts trong bundle (Dockerfile chép từ /usr/share/fonts/truetype/synchro, đã ghim mã băm):
// không dùng @remotion/google-fonts vì lúc dựng không có mạng. Mỗi composition chờ phông xong mới cho chụp khung đầu (delayRender).
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

type Face = { file: string; weight: string };
const FACES: Record<string, Face[]> = {
  "Be Vietnam Pro": [
    { file: "BeVietnamPro-Regular.ttf", weight: "400" },
    { file: "BeVietnamPro-Medium.ttf", weight: "500" },
    { file: "BeVietnamPro-SemiBold.ttf", weight: "600" },
    { file: "BeVietnamPro-Bold.ttf", weight: "700" },
    { file: "BeVietnamPro-ExtraBold.ttf", weight: "800" },
    { file: "BeVietnamPro-Black.ttf", weight: "900" },
  ],
  Inter: [{ file: "Inter.ttf", weight: "100 900" }],
  "Plus Jakarta Sans": [{ file: "PlusJakartaSans.ttf", weight: "200 800" }],
  "Space Grotesk": [{ file: "SpaceGrotesk.ttf", weight: "300 700" }],
  "Playfair Display": [{ file: "PlayfairDisplay.ttf", weight: "400 900" }],
  "JetBrains Mono": [{ file: "JetBrainsMono.ttf", weight: "100 800" }],
};
export const FALLBACK = `"Be Vietnam Pro", "Noto Sans", sans-serif`;
export const stack = (family: string) => `"${family}", ${FALLBACK}`;

const loading = new Map<string, Promise<void>>();
function load(family: string): Promise<void> {
  const faces = FACES[family] ?? [];
  let p = loading.get(family);
  if (!p) {
    p = Promise.all(faces.map(async (f) => {
      const face = new FontFace(family, `url('${staticFile(`fonts/${f.file}`)}') format('truetype')`, { weight: f.weight, style: "normal" });
      await face.load();
      (document.fonts as unknown as Set<FontFace>).add(face);
    })).then(() => undefined);
    loading.set(family, p);
  }
  return p;
}

/** Chờ các phông (luôn có Be Vietnam Pro làm phông dự phòng có dấu) rồi mới hiện nội dung: fitText và fillTextBox đo chữ cần phông thật. */
export function useFonts(families: string[]): boolean {
  const key = [...new Set(["Be Vietnam Pro", ...families])].join("|");
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`Nạp phông ${key}`));
  useEffect(() => {
    let alive = true;
    Promise.all(key.split("|").map(load))
      .then(() => { if (alive) { setReady(true); continueRender(handle); } })
      .catch((e) => cancelRender(e));
    return () => { alive = false; };
  }, [key, handle]);
  return ready;
}
