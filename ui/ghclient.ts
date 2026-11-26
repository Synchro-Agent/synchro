"use client";
// Kết nối và đọc kho GitHub từ trình duyệt (hộp thoại Repo GitHub, "Thêm từ GitHub" của Dự án). Tách khỏi wsclient.ts
// để phần này chỉ nạp cùng các màn hình đó, không vào phần tải đầu của trang chat.
import { json, type GhRepoPage, type GhStatus } from "./wsclient";

export const ghStatus = () => fetch("/api/github", { cache: "no-store" }).then((r) => json<GhStatus>(r));
export const ghRepos = (q = "", page = 1, refresh = false) =>
  fetch(`/api/github?repos=1&q=${encodeURIComponent(q)}&page=${page}${refresh ? "&refresh=1" : ""}`,
    { cache: "no-store" }).then((r) => json<GhRepoPage>(r));
export const ghUnlink = () => fetch("/api/github", { method: "DELETE" }).then((r) => json(r));

/** Đang chạy trong ứng dụng máy tính: trang cấp quyền GitHub mở ở trình duyệt của máy, không ở cửa sổ con. */
export const ghOutside = () =>
  typeof window !== "undefined" && !!(window as { synchroDesktop?: unknown }).synchroDesktop;

// Kết nối GitHub. Kết quả: null = đã kết nối, "timeout" = chưa có tin (nơi gọi đọc lại trạng thái),
// "cancel" = người dùng thôi chờ (signal), còn lại là lời báo lỗi.
export function ghConnect(signal?: AbortSignal): Promise<string | null> {
  return ghOutside() ? ghConnectOutside(signal) : ghConnectPopup(signal);
}

// Web: cửa sổ nhỏ dùng chung cookie với trang; trang /api/github/done báo kết quả qua localStorage rồi tự đóng.
function ghConnectPopup(signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const w = window.open("/api/github/connect", "synchro-gh", "width=760,height=780");
    // Trình duyệt chặn cửa sổ bật lên: đi thẳng tới trang GitHub trong tab này, xong quay về trang chủ.
    if (!w) { location.href = "/api/github/connect"; return; }
    let done = false;
    const finish = (err: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("storage", onStore);
      window.removeEventListener("focus", onBack);
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(t);
      resolve(err);
    };
    const onStore = (e: StorageEvent) => {
      if (e.key !== "synchro:gh" || !e.newValue) return;
      try { finish((JSON.parse(e.newValue) as { error?: string }).error || null); } catch (x) {
        console.warn("[github] tin kết nối hỏng", x);
        finish(null);
      }
    };
    // Người dùng có thể đóng cửa sổ con giữa chừng: quay lại trang mà chưa có kết quả thì thôi chờ
    // ("timeout": nơi gọi tự đọc lại trạng thái kết nối), chừa một nhịp cho tin nhắn đến trước.
    const onBack = () => setTimeout(() => finish("timeout"), 1500);
    const onAbort = () => finish("cancel");
    window.addEventListener("storage", onStore);
    window.addEventListener("focus", onBack);
    signal?.addEventListener("abort", onAbort);
    // COOP tách cửa sổ con khỏi trang này nên không đọc được w.closed; hết 10 phút thì thôi chờ.
    const t = setTimeout(() => finish("timeout"), 600_000);
  });
}

type HandoffInfo = { state: "wait" | "open" | "done" | "error" | "gone"; error: string | null; login: string | null };
// Ứng dụng máy tính: trình duyệt của máy có thể đăng nhập tài khoản Synchro khác hoặc chưa đăng nhập, nên app xin
// đường dẫn trao tay gắn với tài khoản của app (server/ghlink.ts), mở nó ở trình duyệt (app chuyển mọi cửa sổ mới
// ra trình duyệt của máy) và hỏi máy chủ kết quả tới khi xong, lỗi, hết hạn hay người dùng thôi chờ.
async function ghConnectOutside(signal?: AbortSignal): Promise<string | null> {
  let h: { id: string; url: string };
  try {
    h = await fetch("/api/github/connect", { method: "POST" }).then((r) => json<{ id: string; url: string }>(r));
  } catch (e) { return (e as Error).message; }
  window.open(h.url, "_blank");
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 600_000;
  let misses = 0;
  while (Date.now() < until) {
    await wait(2000);
    if (signal?.aborted) return "cancel";
    const s = await fetch(`/api/github?handoff=${encodeURIComponent(h.id)}`, { cache: "no-store" })
      .then((r) => json<HandoffInfo>(r))
      // Mất mạng một nhịp: hỏi lại; mất hẳn (nhiều lần liền) thì thôi, nơi gọi đọc lại trạng thái.
      .catch((e) => { console.warn("[github] hỏi kết quả kết nối", (e as Error).message); return null; });
    if (!s) { if (++misses > 5) return "timeout"; continue; }
    misses = 0;
    if (s.state === "done") return null;
    if (s.state === "error") return s.error || "GitHub chưa kết nối được. Thử lại.";
    if (s.state === "gone") {
      // Máy chủ khởi động lại giữa chừng thì lượt không còn: có thể kết nối vẫn đã xong, nơi gọi đọc lại trạng thái.
      const st = await ghStatus().catch((e) => {
        console.warn("[github] trạng thái", (e as Error).message);
        return null;
      });
      return st?.linked ? null : "Lượt kết nối GitHub đã hết hạn. Bấm Kết nối GitHub lại.";
    }
  }
  return "timeout";
}

