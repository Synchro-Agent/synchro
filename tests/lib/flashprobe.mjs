// Bộ lấy mẫu chữ nháy dùng chung cho tests/ui/lang.mjs và tests/ui/langflash.mjs (Blueprint B6 bước 10).
// flashProbe(): mã cài bằng Page.addScriptToEvaluateOnNewDocument, chạy trước mọi mã của trang. Mỗi khung hình trong ms đầu, ghi mọi chữ
// tiếng Việt đang hiện trên màn hình vào window.__flash (Map chữ → [lần đầu, lần cuối] tính bằng ms từ lúc trang bắt đầu).
// Chỉ requestAnimationFrame, không MutationObserver: bộ theo dõi cài ở đây chạy trước bộ dịch của trang nên sẽ thấy chữ chưa dịch mà chưa bao giờ
// được vẽ; lúc requestAnimationFrame chạy thì bộ dịch (chạy trong lượt gọi lại của MutationObserver) đã xong, chữ đúng như sắp vẽ.
export const flashProbe = (sameWords = [], ms = 8000) => `(() => {
  const VI = /[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i;
  const sameW = new Set(${JSON.stringify(sameWords)});
  const SKIP = "script,style,pre,code,textarea,input,[data-notr],.ai-msg,.user-msg,.mdx,.art-code,.sk-pre,.chat-item,.title-edit,iframe,.cr-by,.cm-editor,.monaco-editor,.xterm,.codebox";
  const strip = (v) => v.split(/[\\s+&/()·:;,.\\-–—|•@#'"“”!?…×=*%$€£¥→←↑↓~≈]+/).filter((w) => w && !sameW.has(w)).join(" ");
  const seen = new Map(), t0 = performance.now();
  window.__flash = seen;
  const tick = () => {
    const t = Math.round(performance.now() - t0);
    if (document.body) {
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        const n = tw.currentNode, v = n.nodeValue, p = n.parentElement;
        if (!v || !p || !VI.test(strip(v)) || p.closest(SKIP)) continue;
        if (!p.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        const r = p.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        const k = v.trim().slice(0, 90), s = seen.get(k);
        if (s) s[1] = t; else seen.set(k, [t, t]);
      }
    }
    if (t < ${ms}) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** Biểu thức đọc kết quả trong trang: ["chữ   @đầu–cuối ms", …]. */
export const FLASH_READ = `[...(window.__flash ?? new Map())].map(([k, [a, b]]) => k + "   @" + a + "–" + b + "ms")`;
