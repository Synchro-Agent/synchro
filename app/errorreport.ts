"use client";
// Báo lỗi hiển thị về máy chủ của chính Synchro để quản trị viên biết (Cài đặt → Quản trị), thay vì chỉ nằm trong console của người dùng. Chỉ gửi thông báo lỗi và vài dòng vị trí, không gửi tin nhắn.
const seen = new Set<string>();
const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|AbortError/i;

export function reportError(e: unknown, where: string) {
  try {
    const err = e as { message?: unknown; stack?: unknown; digest?: unknown };
    const message = String(err?.message ?? e ?? "").slice(0, 300);
    if (!message || NOISE.test(message) || seen.has(message) || seen.size >= 5) return;
    seen.add(message);
    const stack = typeof err?.stack === "string" ? err.stack.split("\n").slice(1, 6).map((l) => l.trim()).join(" ") : "";
    void fetch("/api/client-error", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ where: `${where} ${location.pathname}${err?.digest ? ` ${String(err.digest)}` : ""}`, message, stack }) }).catch(() => {});
  } catch {}
}
