"use client";

// Ô kiểm tra Cloudflare Turnstile (app/turnstile.ts) cho đăng ký, đăng nhập sau nhiều lần sai và xin đặt lại mật khẩu.
// Chỉ tải mã của Cloudflare khi quản trị viên đã bật (có khóa site). Chế độ "interaction-only": đa số người dùng không thấy gì, chỉ khi
// Cloudflare cần hỏi thêm mới hiện ô, nằm trong khung nền đặc theo giao diện sáng / tối của Synchro.
import { useEffect, useRef, useState } from "react";

type TS = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
let loading: Promise<TS> | null = null;
function load(): Promise<TS> {
  const w = window as unknown as { turnstile?: TS };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return (loading ??= new Promise<TS>((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (w.turnstile ? ok(w.turnstile) : no(new Error("turnstile")));
    s.onerror = () => { loading = null; s.remove(); no(new Error("turnstile")); };
    document.head.appendChild(s);
  }));
}

/** Khóa site Turnstile từ /api/auth/me (null: chưa bật). */
export function useTurnstileKey() {
  const [k, setK] = useState<string | null>(null);
  useEffect(() => { let dead = false; void fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) setK(j?.turnstile || null); }).catch(() => {}); return () => { dead = true; }; }, []);
  return k;
}

/** Vẽ ô kiểm tra; onToken nhận mã (chuỗi rỗng khi hết hạn hoặc lỗi). Đổi nonce để lấy mã mới (mỗi mã chỉ dùng được một lần). */
export function TurnstileBox({ siteKey, action, onToken, nonce = 0 }: { siteKey: string; action: "signup" | "login" | "reset"; onToken: (t: string) => void; nonce?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let id = "", dead = false, ts: TS | null = null;
    cb.current("");
    void load().then((t) => {
      if (dead || !ref.current) return;
      ts = t;
      id = t.render(ref.current, {
        sitekey: siteKey, action, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", appearance: "interaction-only", size: "flexible",
        language: document.documentElement.lang || "auto",
        callback: (tok: string) => cb.current(tok),
        "expired-callback": () => cb.current(""),
        "error-callback": () => { cb.current(""); return false; },
        // Cloudflare cần hỏi thêm: ô có thể nằm dưới mép màn hình điện thoại (cuối bước điền hồ sơ), cuộn tới cho người dùng thấy.
        "before-interactive-callback": () => { setShown(true); setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); },
        "after-interactive-callback": () => setShown(false),
      });
    }, () => { if (!dead) setFailed(true); });
    return () => { dead = true; if (ts && id) try { ts.remove(id); } catch { /* đã gỡ */ } };
  }, [siteKey, action, nonce]);
  return <div className={`ts-box${shown ? " on" : ""}`} aria-live="polite">
    <div ref={ref} />
    {failed && <p className="ts-err" role="alert">Couldn&apos;t load the human check. Check your connection or turn off content blockers, then reload the page.</p>}
  </div>;
}
