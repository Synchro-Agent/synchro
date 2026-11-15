"use client";
// Phiên đăng nhập hết hạn khi app đang mở: mọi lệnh gọi /api của app đều đi qua đây, gặp 401 thì hỏi lại /api/auth/me cho chắc (vài API có thể trả 401
// vì lý do riêng) rồi báo cho trang. Trang giữ nguyên mọi thứ đang mở, chỉ phủ màn hình đăng nhập lên trên; thay cho từng chỗ hiện "Bạn cần đăng nhập." hay sập.
import { tr } from "./i18n";
let installed = false;
let raw: typeof fetch | null = null;
let notify: (() => void) | null = null;
let checking = false;

const isApi = (u: string) => { try { const x = new URL(u, location.href); return x.origin === location.origin && x.pathname.startsWith("/api/") && !x.pathname.startsWith("/api/auth/"); } catch { return false; } };

function check() {
  if (checking || !raw || !notify) return;
  checking = true;
  raw("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && !j.user) notify?.(); }).catch(() => {}).finally(() => { checking = false; });
}

/** Gắn một lần cho cả trang. onExpired: phiên đã thật sự hết hạn. */
export function watchSession(onExpired: () => void) {
  notify = onExpired;
  if (installed || typeof window === "undefined") return () => { notify = null; };
  installed = true;
  raw = window.fetch.bind(window);
  const orig = raw;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => orig(input, init).then((r) => {
    if (r.status === 401 && isApi(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)) check();
    return r;
  });
  return () => { notify = null; };
}

// Mất mạng: trình duyệt ném "Failed to fetch" / "Load failed" / "NetworkError…" và nhiều nơi hiện thẳng e.message cho người dùng. Đổi ở một chỗ thành câu đọc được, theo ngôn ngữ giao diện.
const NET = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed)$/i;
let netWrapped = false;
export function installNetError() {
  if (netWrapped || typeof window === "undefined") return;
  netWrapped = true;
  const orig = window.fetch;
  window.fetch = function (this: unknown, ...a: Parameters<typeof fetch>) {
    return orig.apply(this === undefined ? window : (this as typeof window), a).catch((e: unknown) => {
      if (e instanceof TypeError && NET.test(e.message)) throw new TypeError(tr("Không kết nối được tới Synchro. Kiểm tra mạng rồi thử lại."), { cause: e });
      throw e;
    });
  } as typeof fetch;
}

/** Lần đọc đầu lúc mở trang: máy chủ đang khởi động lại (502, HTML thay vì JSON) không có nghĩa là đã đăng xuất. Thử lại vài lần rồi mới coi như chưa đăng nhập. */
export async function loadMe<T>(tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (r.ok) return (await r.json()) as T;
      if (r.status < 500) throw new Error(String(r.status));
    } catch (e) { if (i >= tries || /^4\d\d$/.test((e as Error).message)) throw e; }
    if (i >= tries) throw new Error("me");
    await new Promise((f) => setTimeout(f, 700 * (i + 1)));
  }
}
