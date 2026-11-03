"use client";
// Cài đặt → Khả năng ở trình duyệt: đọc/ghi /api/caps (máy chủ là nơi lưu và áp dụng), giữ bản sao trong
// localStorage của tài khoản để giao diện hiện đúng ngay khi mở trang, trước khi máy chủ trả lời.
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_CAPS, type Caps, type CapsState } from "./catalog";
import { ls, userScope } from "./userscope";

const FALLBACK: CapsState = { caps: DEFAULT_CAPS, locks: {}, runner: null };
let state: CapsState | null = null;
let loadedFor = "";
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

// Bản sao đã lưu của tài khoản hiện tại (nhớ lại theo tài khoản để useSyncExternalStore nhận cùng một đối tượng).
let memo: { scope: string; v: CapsState } | null = null;
function cached(): CapsState {
  if (memo?.scope === userScope()) return memo.v;
  let v = FALLBACK;
  try { const j = JSON.parse(ls.get("caps-state") ?? "null"); if (j?.caps) v = { ...FALLBACK, ...j, caps: { ...DEFAULT_CAPS, ...j.caps } }; } catch {}
  memo = { scope: userScope(), v };
  return v;
}
const put = (s: CapsState) => { state = s; memo = { scope: userScope(), v: s }; ls.set("caps-state", JSON.stringify(s)); emit(); };

export function loadCaps(force = false) {
  if (!force && loadedFor === userScope() && (state || inflight)) return inflight ?? Promise.resolve();
  loadedFor = userScope();
  inflight = fetch("/api/caps", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    if (j?.caps) { put(j); return; }
    // Lỗi (máy chủ vừa khởi động lại…): đang dùng bản sao đã lưu; thử lại một lần sau 3 giây để lấy trạng thái thật (khóa, nơi chạy code).
    if (!state && !retried) { retried = true; setTimeout(() => loadCaps(true), 3000); }
  }).finally(() => { inflight = null; });
  return inflight;
}
let retried = false;

// Đổi một khả năng. Trả về null nếu thành công, hoặc thông báo lỗi.
export async function setCaps(patch: Partial<Caps>): Promise<string | null> {
  const prev = state ?? cached();
  put({ ...prev, caps: { ...prev.caps, ...patch } });
  try {
    const r = await fetch("/api/caps", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.caps) { put(prev); return j.error || "Không lưu được cài đặt."; }
    put(j);
    return null;
  } catch { put(prev); return "Không kết nối được máy chủ."; }
}

export function useCaps(): CapsState {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => (loadedFor === userScope() && state ? state : cached()), () => FALLBACK);
  useEffect(() => { loadCaps(); }, []);
  return s;
}
