// Một lệnh khởi động thay cho tám (blueprint A3): mọi thứ trang chủ cần trước khi dùng được, từ một lần tra phiên.
// Trang chủ (app/page.tsx, server component) dựng sẵn gói này ở máy chủ và truyền vào <Home boot>; /api/bootstrap trả cùng gói cho lần hỏi lại.
// Thay cho: /api/auth/me, /api/models, /api/caps, /api/plugins?view=meta, /api/inbox?count=1 lúc mở trang.
import "server-only";
import { createHash } from "node:crypto";
import { can, current, isAdmin, publicUser, signupOpen, type UserRow } from "./authstore";
import { turnstileSiteKey } from "./turnstile";
import { providerStatus } from "./oauth";
import { hasSharedChat, serviceKey } from "./providers";
import { capsState } from "./caps";
import { inboxCount } from "./tasks";
import { studioSummary, studioSummaryCached } from "./plugins";
import { getPrefs } from "./codestore";
import { modelsFor, prewarmLater } from "./modelslist";

/** Phần của /api/auth/me (không cần đăng nhập). */
export const authPart = (user: UserRow | null) => ({
  user: user ? publicUser(user) : null, providers: providerStatus(), signupOpen: signupOpen(), speechReady: !!serviceKey("elevenlabs"),
  plansOnly: !hasSharedChat(), turnstile: turnstileSiteKey(), support: process.env.SUPPORT_EMAIL || null,
});

// Mỗi phần hỏng riêng thì phần đó là null: trình duyệt tự hỏi lại phần ấy như trước (không vì một phần lỗi mà mất cả trang).
const safe = <T>(f: () => T): T | null => { try { return f(); } catch (e) { console.error("[bootstrap]", e); return null; } };

/** Hạn chờ danh sách model khi dựng HTML của trang chủ. Danh sách model có thể phải hỏi mạng (envModels hết hạn 6 giờ) hay khởi động CLI
 *  để đọc model của gói (sau mỗi lần deploy / khởi động lại, codex tới 20 giây): HTML không chờ những việc đó. Quá hạn thì models là null,
 *  trình duyệt tự hỏi /api/models như trước; việc đang chạy vẫn chạy tiếp và làm ấm bộ đệm cho lần hỏi đó. */
export const BOOT_DEADLINE_MS = 300;
const TIMED_OUT = Symbol("timeout");
/** p xong trong ms thì lấy kết quả, không thì TIMED_OUT (p vẫn chạy tiếp ở nền). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof TIMED_OUT>((r) => { t = setTimeout(() => r(TIMED_OUT), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** fast (trang chủ dựng HTML ở máy chủ): không bao giờ chặn HTML. Danh sách model có hạn BOOT_DEADLINE_MS; số skill của studio chỉ lấy khi
 *  đã tính sẵn (studioSummaryCached). Phần nào chưa có thì là null và trình duyệt tự hỏi phần đó. /api/bootstrap dựng đủ (không fast). */
export async function bootOf(user: UserRow | null, o: { fast?: boolean; deadlineMs?: number } = {}) {
  const base = authPart(user);
  if (!user) return { ...base, models: null, caps: null, studios: null, inboxCount: null, codePrefs: null };
  const skills = can(user, "skills");
  const mp = modelsFor(user).catch((e: unknown) => { console.error("[bootstrap]", e); return null; });
  const m = o.fast ? await within(mp, o.deadlineMs ?? BOOT_DEADLINE_MS) : await mp;
  const models = m === TIMED_OUT ? null : m;
  const summary = (uid: string) => (o.fast ? studioSummaryCached(uid) : studioSummary(uid));
  const studioPart = () => {
    if (!skills) return { admin: isAdmin(user), canInstall: false, studios: {} };
    const s = summary(user.id);
    return s ? { admin: isAdmin(user), canInstall: true, studios: s } : null;
  };
  return {
    ...base, models,
    caps: safe(() => capsState(user)),
    // Cùng nội dung với /api/plugins?view=meta (nút studio, quyền cài skill).
    studios: safe(studioPart),
    inboxCount: safe(() => inboxCount(user.id)),
    // Cài đặt Synchro Code (cùng nội dung /api/code/prefs): bật "Đồng bộ phiên" thì danh sách phiên Code đồng bộ ngay từ lúc mở trang, kể cả
    // thiết bị mới chưa có phiên nào, mà không cần thêm một lệnh hỏi (blueprint A3.5 hoãn /api/code/prefs tới khi mở Code).
    codePrefs: safe(() => getPrefs(user.id)),
  };
}
export type BootData = Awaited<ReturnType<typeof bootOf>>;

/** Gói khởi động của yêu cầu (đọc cookie phiên synchro_session). Có người dùng thì khởi động sẵn tiến trình chat như /api/models vẫn làm
 *  (models null vì quá hạn: /api/models của trình duyệt sẽ làm việc đó). */
export async function bootFor(req: Request, o: { fast?: boolean; deadlineMs?: number } = {}): Promise<BootData> {
  const c = current(req);
  const b = await bootOf(c?.user ?? null, o);
  if (c && b.models) prewarmLater(c.user);
  return b;
}

/** ETag theo người dùng: cùng tài khoản, cùng nội dung thì trùng; khác tài khoản không bao giờ trùng. */
export const bootEtag = (uid: string | null, body: string) => `W/"${createHash("sha256").update(`${uid ?? "anon"}\n${body}`).digest("base64url").slice(0, 27)}"`;

/** If-None-Match có khớp ETag không (danh sách nhiều giá trị, dấu *). */
export const etagMatch = (header: string | null, tag: string) => !!header && header.split(",").some((t) => { const s = t.trim(); return s === "*" || s === tag || s.replace(/^W\//, "") === tag.replace(/^W\//, ""); });
