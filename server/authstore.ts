// Tài khoản, mật khẩu, phiên đăng nhập, nhật ký (chỉ chạy ở server): mặt tiền chuyển tiếp, giữ nguyên mọi tên đã export để nơi gọi không đổi.
// Mã ở server/db/ (kết nối SQLite, cài đặt, nhật ký), server/ratelimit.ts và server/auth/ (cấu hình, lỗi, yêu cầu, mật khẩu, người dùng, phiên, luồng tài khoản, quản trị).
import "server-only";
export { COOKIE, SESSION_TTL, PW_MIN, ADMIN_EMAILS, OWNER_EMAILS, reservedEmail, ALERT_EMAILS } from "./auth/config";
export { AuthError } from "./auth/errors";
export type { UserRow, SessionRow } from "./auth/types";
export { DATA_DIR, db, stmt, stmtCacheSize, healAdminEmails, needDisk } from "./db/db";
export { getSetting, setSetting, signupOpen, audit } from "./db/settings";
export { limit } from "./ratelimit";
export { hashPassword, checkPassword, normEmail } from "./auth/passwords";
export { clientIp, appUrl, allowedOriginHosts, sameOrigin, readCookie, cookie, handle, withCookies } from "./auth/request";
export { getUser, findByEmail, isOwner, isAdmin, roleOf, adminRole, OWNER_ONLY, ownerOnly, createUser, publicUser, defaultPerms, basePerms, permsOf, can, canModel, modelDeniedMsg, cleanProfile, setInstructions, forgetProfile, updateProfile, VERIFY_FIRST, verifyGateOn, setVerifyGate, needsVerify, verifyLocked } from "./auth/users";
export type { Role, PublicUser } from "./auth/users";
export { featureGate, passkeySignIn, mfaTicketUser, clearMfaCookie, createSession, clearSessionCookie, markReauth, recentlyReauthed, requireRecentReauth, reauthPassword, stepUp, sweepSessions, current, sessionUser, requireUser, requireAdmin, requireOwner, device, publicSession, sessionsOf, authGate } from "./auth/sessions";
export { lookup, login, signup, resendVerify, checkVerifyLink, confirmVerify, onAccountGone, denyVerify, oauthLogin, connectIdentity, disconnectIdentity, changePassword, requestPasswordReset, dropEmailChange, requestEmailChange, checkEmailChange, confirmEmailChange, hasSecondFactors, checkResetLink, createResetLink, redeemResetLink, deleteOwnAccount } from "./auth/flows";
export type { OAuthProfile } from "./auth/flows";
export { adminStats, adminUsers, adminAudit, adminAct, adminDelete, adminRevokeSession } from "./auth/admin";
