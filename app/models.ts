"use client";
// Danh sách model ở trình duyệt: lấy từ /api/models (model quản trị viên cho hiện, model mặc định, quyền của tài khoản).
import { useSyncExternalStore } from "react";
import { allowsModel, equivalentModel, splitKey, vendorOf, type Effort, type ProviderInfo } from "./catalog";

// effort: mức nỗ lực cao nhất quản trị viên cho phép theo từng model ("*" là mọi model).
type State = { providers: ProviderInfo[]; default: string | null; allowed: string[]; effort: Record<string, Effort>; loaded: boolean };
let state: State = { providers: [], default: null, allowed: [], effort: {}, loaded: false };
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;
// Lần hỏi đầu có thể lỗi hoặc chưa có hãng nào (máy chủ vừa khởi động lại sau deploy, nginx nạp lại cấu hình, mạng chập chờn): bộ chọn
// model từng trống "đã kết nối ()" tới khi tải lại trang. Hỏi lại sau 2, 5, 10, 20 giây cho tới khi có danh sách.
// Mỗi lúc chỉ một hẹn giờ: nhiều thành phần cùng hỏi lúc trang mới mở mà lỗi dồn dập thì không tiêu hết các lần hỏi lại trong vài giây.
const RETRY_S = [2, 5, 10, 20];
let tries = 0, again: ReturnType<typeof setTimeout> | null = null;

/** Đã hỏi hết các lần mà vẫn chưa có hãng nào: danh sách trống là thật, không phải máy chủ vừa khởi động lại. */
export const modelsSettled = () => tries >= RETRY_S.length;

export function refreshModels() {
  inflight ??= fetch("/api/models", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j) { state = { providers: j.providers ?? [], default: j.default ?? null, allowed: j.allowed ?? [], effort: j.effort ?? {}, loaded: true }; subs.forEach((f) => f()); } return !!j?.providers?.length; })
    .catch(() => false)
    .then((ok) => {
      if (ok) tries = 0;
      else if (!again && tries < RETRY_S.length) again = setTimeout(() => { again = null; refreshModels(); }, RETRY_S[tries++] * 1000);
    })
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
  return id.replace(/^claude-/, "Claude ").replace(/^gpt/i, "GPT").replace(/^grok-/, "Grok ").replace(/^deepseek-/, "DeepSeek ").replace(/-/g, " ");
}

// Model nên dùng: giữ lựa chọn hiện tại nếu còn hiện và được phép, không thì model mặc định hoặc model đầu tiên được phép.
export function fitModel(cur: string, s: State = state) {
  const shown = s.providers.flatMap((p) => p.models.map((m) => m.key));
  const ok = (k: string | null): k is string => !!k && shown.includes(k) && allowsModel(s.allowed, k);
  if (ok(cur) || (cur === AUTO && shown.some((k) => allowsModel(s.allowed, k)))) return cur;
  // Nhóm của hãng vừa đổi giữa gói subscription và khóa API (người dùng đồng ý dùng API, hoặc gói đã hồi lại): chọn model tương đương.
  if (cur && cur !== AUTO) {
    const v = vendorOf(cur);
    const grp = s.providers.find((p) => p.id === v || (p.models[0] && vendorOf(p.models[0].key) === v));
    const eq = grp ? equivalentModel(cur, grp.models.filter((m) => allowsModel(s.allowed, m.key))) : null;
    if (eq) return eq;
  }
  if (ok(s.default)) return s.default;
  return shown.find((k) => allowsModel(s.allowed, k)) ?? cur;
}
