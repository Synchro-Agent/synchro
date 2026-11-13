// Một lệnh khởi động thay cho tám (blueprint A3): mọi thứ trang chủ cần trước khi dùng được, từ một lần tra phiên.
// Trang chủ (app/page.tsx, server component) dựng sẵn gói này ở máy chủ và truyền vào <Home boot>; /api/bootstrap trả cùng gói cho lần hỏi lại.
// Thay cho: /api/auth/me, /api/models, /api/caps, /api/plugins?view=meta, /api/inbox?count=1 lúc mở trang.
import { createHash } from "node:crypto";
import { can, current, isAdmin, publicUser, signupOpen, type UserRow } from "./authstore";
import { turnstileSiteKey } from "./turnstile";
import { providerStatus } from "./oauth";
import { hasSharedChat, serviceKey } from "./providers";
import { capsState } from "./caps";
import { inboxCount } from "./tasks";
import { studioSummary } from "./plugins";
import { modelsFor, prewarmLater } from "./modelslist";

/** Phần của /api/auth/me (không cần đăng nhập). */
export const authPart = (user: UserRow | null) => ({
  user: user ? publicUser(user) : null, providers: providerStatus(), signupOpen: signupOpen(), speechReady: !!serviceKey("elevenlabs"),
  plansOnly: !hasSharedChat(), turnstile: turnstileSiteKey(), support: process.env.SUPPORT_EMAIL || null,
});

// Mỗi phần hỏng riêng thì phần đó là null: trình duyệt tự hỏi lại phần ấy như trước (không vì một phần lỗi mà mất cả trang).
const safe = <T>(f: () => T): T | null => { try { return f(); } catch (e) { console.error("[bootstrap]", e); return null; } };

export async function bootOf(user: UserRow | null) {
  const base = authPart(user);
  if (!user) return { ...base, models: null, caps: null, studios: null, inboxCount: null };
  const skills = can(user, "skills");
  const models = await modelsFor(user).catch((e: unknown) => { console.error("[bootstrap]", e); return null; });
  return {
    ...base, models,
    caps: safe(() => capsState(user)),
    // Cùng nội dung với /api/plugins?view=meta (nút studio, quyền cài skill).
    studios: safe(() => ({ admin: isAdmin(user), canInstall: skills, studios: skills ? studioSummary(user.id) : {} })),
    inboxCount: safe(() => inboxCount(user.id)),
  };
}
export type BootData = Awaited<ReturnType<typeof bootOf>>;

/** Gói khởi động của yêu cầu (đọc cookie phiên synchro_session). Có người dùng thì khởi động sẵn tiến trình chat như /api/models vẫn làm. */
export async function bootFor(req: Request): Promise<BootData> {
  const c = current(req);
  const b = await bootOf(c?.user ?? null);
  if (c && b.models) prewarmLater(c.user);
  return b;
}

/** ETag theo người dùng: cùng tài khoản, cùng nội dung thì trùng; khác tài khoản không bao giờ trùng. */
export const bootEtag = (uid: string | null, body: string) => `W/"${createHash("sha256").update(`${uid ?? "anon"}\n${body}`).digest("base64url").slice(0, 27)}"`;

/** If-None-Match có khớp ETag không (danh sách nhiều giá trị, dấu *). */
export const etagMatch = (header: string | null, tag: string) => !!header && header.split(",").some((t) => { const s = t.trim(); return s === "*" || s === tag || s.replace(/^W\//, "") === tag.replace(/^W\//, ""); });
