"use client";
// Danh sách model ở trình duyệt: lấy từ /api/models (model quản trị viên cho hiện, model mặc định, quyền của tài khoản).
import { useSyncExternalStore } from "react";
import { allowsModel, equivalentModel, splitKey, vendorOf, type Effort, type ProviderInfo } from "./catalog";
import { userScope } from "./userscope";

// effort: mức nỗ lực cao nhất quản trị viên cho phép theo từng model ("*" là mọi model).
// replaced: model hãng đã gỡ hoặc đã cũ → bản mới nhất cùng dòng (sổ model, app/modelreg.ts), kèm tên model cũ để báo người dùng.
export type Replaced = Record<string, { to: string; name: string }>;
type State = { providers: ProviderInfo[]; sharedApi: boolean; default: string | null; allowed: string[]; effort: Record<string, Effort>; replaced: Replaced; loaded: boolean };
let state: State = { providers: [], sharedApi: false, default: null, allowed: [], effort: {}, replaced: {}, loaded: false };
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
    .then((j) => { if (j) { fetchedAt = Date.now(); state = { providers: j.providers ?? [], sharedApi: !!j.sharedApi, default: j.default ?? null, allowed: j.allowed ?? [], effort: j.effort ?? {}, replaced: j.replaced ?? {}, loaded: true }; subs.forEach((f) => f()); } return !!j?.providers?.length; })
    .catch(() => false)
    .then((ok) => {
      if (ok) tries = 0;
      else if (!again && tries < RETRY_S.length) again = setTimeout(() => { again = null; refreshModels(); }, RETRY_S[tries++] * 1000);
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Tab để mở lâu vẫn thấy model hãng vừa ra (Synchro tự dò mỗi 6 giờ): hỏi lại mỗi 15 phút khi tab đang hiện, và khi quay lại tab sau hơn 5 phút.
let fetchedAt = 0, watching = false;
const REFRESH_MS = 15 * 60_000;
function watchFresh() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const stale = (ms: number) => state.loaded && userScope() !== "anon" && document.visibilityState === "visible" && Date.now() - fetchedAt > ms;
  setInterval(() => { if (stale(REFRESH_MS - 5000)) refreshModels(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (stale(5 * 60_000)) refreshModels(); });
}

export function useModels() {
  return useSyncExternalStore(
    // Chưa biết tài khoản (trang vừa mở): chờ, page.tsx hỏi ngay khi đăng nhập xong. Hỏi sớm vừa trùng vừa nhận 401 ở màn hình đăng nhập.
    (f) => { subs.add(f); watchFresh(); if (!state.loaded && userScope() !== "anon") refreshModels(); return () => subs.delete(f); },
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

// Loại việc chế độ Tự động nhận ra (router.ts Task), để hiện "Tự động chọn … cho việc …" dưới câu trả lời.
const TASK_NAME: Record<string, [string, string]> = {
  chat: ["trò chuyện", "chat"], qa: ["hỏi đáp", "questions"], language: ["học ngôn ngữ", "language learning"], translate: ["dịch", "translation"],
  summarize: ["tóm tắt", "summarizing"], write: ["viết", "writing"], code: ["viết code", "coding"], debug: ["gỡ lỗi", "debugging"], reason: ["suy luận", "reasoning"],
  analyze: ["phân tích", "analysis"], build: ["tạo sản phẩm", "building"], act: ["thao tác nhiều bước", "multi-step actions"], vision: ["đọc ảnh", "reading images"],
  longdoc: ["tài liệu dài", "long documents"], data: ["số liệu", "data"],
};
export const autoTaskName = (task: string, en: boolean) => TASK_NAME[task]?.[en ? 1 : 0] ?? "";

// Model nên dùng: giữ lựa chọn hiện tại nếu còn hiện và được phép, không thì model mặc định của quản trị viên, không có thì Tự động.
export function fitModel(cur: string, s: State = state) {
  const shown = s.providers.flatMap((p) => p.models.map((m) => m.key));
  const ok = (k: string | null): k is string => !!k && shown.includes(k) && allowsModel(s.allowed, k);
  if (ok(cur) || (cur === AUTO && shown.some((k) => allowsModel(s.allowed, k)))) return cur;
  // Hãng gỡ model người dùng đã chọn tay (hoặc model đã cũ): bản mới nhất cùng dòng. "Tự động" không bao giờ bị đổi.
  const rep = s.replaced?.[cur];
  if (rep && ok(rep.to)) return rep.to;
  // Nhóm của hãng vừa đổi giữa gói subscription và khóa API (người dùng đồng ý dùng API, hoặc gói đã hồi lại): chọn model tương đương.
  if (cur && cur !== AUTO) {
    const v = vendorOf(cur);
    const grp = s.providers.find((p) => p.id === v || (p.models[0] && vendorOf(p.models[0].key) === v));
    const eq = grp ? equivalentModel(cur, grp.models.filter((m) => allowsModel(s.allowed, m.key))) : null;
    if (eq) return eq;
  }
  if (ok(s.default)) return s.default;
  // Chưa chọn gì và quản trị viên không đặt mặc định: Tự động (model đầu danh sách từng là Fable, đắt nhất và có thể tính credits, lại không tự chuyển khi treo).
  return shown.some((k) => allowsModel(s.allowed, k)) ? AUTO : cur;
}
