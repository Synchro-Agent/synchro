// Cài đặt của máy chủ (bảng settings) và nhật ký thao tác (bảng audit).
import "server-only";
import { db, stmt } from "./db";
import type { UserRow } from "../auth/types";

// ---- cài đặt + nhật ký ----
export const getSetting = (k: string, d: string) => (stmt("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? d;
export const setSetting = (k: string, v: string) => stmt("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
export const signupOpen = () => getSetting("signup_open", "1") === "1";

let auditN = 0;
export function audit(action: string, o: { actor?: UserRow | null; target?: UserRow | null; targetEmail?: string; ip?: string; detail?: string } = {}) {
  stmt("INSERT INTO audit (at, action, actor_id, actor_email, target_id, target_email, ip, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), action, o.actor?.id ?? null, o.actor?.email ?? null, o.target?.id ?? null, o.target?.email ?? o.targetEmail ?? null, o.ip ?? null, o.detail ?? null);
  if (++auditN % 200 === 0) db().prepare("DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit) - 50000").run();
}
