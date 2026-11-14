"use client";
// Danh sách model ở trình duyệt: lấy từ /api/models (model quản trị viên cho hiện, model mặc định, quyền của tài khoản).
import { useSyncExternalStore } from "react";
import { allowsModel, equivalentModel, splitKey, vendorOf, type Effort, type ProviderInfo } from "./catalog";
import { userScope } from "./userscope";

// effort: mức nỗ lực cao nhất quản trị viên cho phép theo từng model ("*" là mọi model).
// replaced: model hãng đã gỡ hoặc đã cũ → bản mới nhất cùng dòng (sổ model, app/modelreg.ts), kèm tên model cũ để báo người dùng.
// why: "gone" hãng đã gỡ, "old" dòng đã có bản mới hơn (vẫn chạy được nhưng không còn ở bộ chọn).
export type Replaced = Record<string, { to: string; name: string; why?: "gone" | "old" }>;
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

/** bg: lần hỏi lại nền của tab để mở lâu (máy chủ không khởi động sẵn tiến trình chat cho lần này). */
type Payload = { providers?: ProviderInfo[]; sharedApi?: boolean; default?: string | null; allowed?: string[]; effort?: Record<string, Effort>; replaced?: Replaced };
const put = (j: Payload) => { fetchedAt = Date.now(); state = { providers: j.providers ?? [], sharedApi: !!j.sharedApi, default: j.default ?? null, allowed: j.allowed ?? [], effort: j.effort ?? {}, replaced: j.replaced ?? {}, loaded: true }; subs.forEach((f) => f()); };
/** Gieo danh sách model từ gói khởi động dựng sẵn ở máy chủ (app/bootdata.ts): bộ chọn model đúng ngay, không hỏi /api/models lần đầu.
 *  Danh sách trống (máy chủ vừa khởi động lại, chưa có hãng nào) thì không gieo: trả false để trang tự hỏi lại như trước. */
export function seedModels(j: Payload | null | undefined) {
  if (!j?.providers?.length) return false;
  put(j);
  return true;
}

export function refreshModels(o: { bg?: boolean } = {}) {
  inflight ??= fetch(o.bg ? "/api/models?bg=1" : "/api/models", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: Payload | null) => { if (j) put(j); return !!j?.providers?.length; })
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
  setInterval(() => { if (stale(REFRESH_MS - 5000)) refreshModels({ bg: true }); }, REFRESH_MS);
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
// Mỗi loại một câu trọn vẹn làm khóa dịch (không thêm từ lẻ như "dịch", "viết" vào từ điển chung, bộ dịch DOM sẽ áp cho mọi chỗ).
const AUTO_PICK: Record<string, string> = {
  chat: "Tự động chọn {model} cho việc trò chuyện", qa: "Tự động chọn {model} cho việc hỏi đáp", lookup: "Tự động chọn {model} cho việc tra cứu",
  language: "Tự động chọn {model} cho việc học ngôn ngữ", translate: "Tự động chọn {model} cho việc dịch", summarize: "Tự động chọn {model} cho việc tóm tắt",
  write: "Tự động chọn {model} cho việc viết", code: "Tự động chọn {model} cho việc viết code", debug: "Tự động chọn {model} cho việc gỡ lỗi",
  reason: "Tự động chọn {model} cho việc suy luận", analyze: "Tự động chọn {model} cho việc phân tích", build: "Tự động chọn {model} cho việc tạo sản phẩm",
  act: "Tự động chọn {model} cho việc thao tác nhiều bước", vision: "Tự động chọn {model} cho việc đọc ảnh", longdoc: "Tự động chọn {model} cho việc tài liệu dài",
  data: "Tự động chọn {model} cho việc số liệu",
};
/** Mẫu câu "Tự động chọn {model} cho việc …" (dịch bằng tf ở nơi hiện); loại việc lạ thì rỗng.
 *  Tệp này không nhập i18n.tsx để kiểm thử nạp được không cần trình duyệt (tests/lib/ts.mjs). */
export const autoPickKey = (task: string) => AUTO_PICK[task] ?? "";

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
