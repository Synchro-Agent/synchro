"use client";
// Danh sách model ở trình duyệt: lấy từ /api/models (model đang hiện ở bộ chọn, model mặc định).
import { useSyncExternalStore } from "react";
import { splitKey, type ProviderInfo } from "./catalog";

type State = { providers: ProviderInfo[]; default: string | null; loaded: boolean };
let state: State = { providers: [], default: null, loaded: false };
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;

export function refreshModels() {
  inflight ??= fetch("/api/models", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j) { state = { providers: j.providers ?? [], default: j.default ?? null, loaded: true }; subs.forEach((f) => f()); } })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

export function useModels() {
  return useSyncExternalStore(
    (f) => { subs.add(f); if (!state.loaded) refreshModels(); return () => subs.delete(f); },
    () => state,
    () => state,
  );
}

// "auto": Synchro tự chọn model theo độ khó của yêu cầu (máy chủ chọn, xem router.ts).
export const AUTO = "auto";
// Tên hiển thị của một khóa model ("openai/gpt-5.1" → "GPT-5.1").
export function modelName(key: string) {
  if (key === AUTO) return "Tự động";
  for (const p of state.providers) for (const m of p.models) if (m.key === key) return m.name;
  const id = splitKey(key).id || key;
  return id.replace(/^claude-/, "Claude ").replace(/^gpt/i, "GPT").replace(/-/g, " ");
}

// Model nên dùng: giữ lựa chọn hiện tại nếu còn hiện ở bộ chọn, không thì model mặc định hoặc model đầu tiên.
export function fitModel(cur: string, s: State = state) {
  const shown = s.providers.flatMap((p) => p.models.map((m) => m.key));
  const ok = (k: string | null): k is string => !!k && shown.includes(k);
  if (ok(cur) || (cur === AUTO && shown.length)) return cur;
  if (ok(s.default)) return s.default;
  return shown[0] ?? cur;
}
