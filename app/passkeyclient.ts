"use client";

// Phần trình duyệt của khóa truy cập (app/passkeys.ts). Thư viện @simplewebauthn/browser chỉ tải khi cần (trang đăng nhập nhẹ như cũ).
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

const lib = () => import("@simplewebauthn/browser");

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status });
  return j as T;
}

/** Trình duyệt có WebAuthn không (Safari, Chrome, Firefox, Edge đời mới đều có; trang http không phải localhost thì không). */
export const passkeySupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
/** Gợi ý khóa ngay trong ô email (conditional UI). */
export const passkeyAutofill = async () => passkeySupported() && (await lib()).browserSupportsWebAuthnAutofill().catch(() => false);
/** Người dùng tự đóng hộp thoại, hết giờ, hoặc lần hỏi bị huỷ để mở lần khác: không phải lỗi cần báo. */
export const passkeyCancelled = (e: unknown) => ["NotAllowedError", "AbortError"].includes((e as { name?: string })?.name ?? "") || (e as { code?: string })?.code === "ERROR_CEREMONY_ABORTED";

/** Lấy chữ ký đăng nhập từ thiết bị. conditional: chờ người dùng chọn khóa trong gợi ý của ô email (không mở hộp thoại). */
export async function passkeyAssert(conditional = false): Promise<AuthenticationResponseJSON> {
  const { startAuthentication } = await lib();
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>({ op: "login-options" });
  return startAuthentication({ optionsJSON, useBrowserAutofill: conditional });
}
/** Huỷ lần hỏi khóa đang chờ (gợi ý trong ô email) khi rời trang đăng nhập. */
export async function passkeyAbort() { try { (await lib()).WebAuthnAbortService.cancelCeremony(); } catch { /* chưa tải */ } }

/** Thêm khóa cho tài khoản đang đăng nhập: trả về danh sách mới. */
export async function passkeyRegister<T>(): Promise<T> {
  const { startRegistration } = await lib();
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>({ op: "reg-options" });
  const response = await startRegistration({ optionsJSON });
  return post<T>({ op: "register", response });
}
