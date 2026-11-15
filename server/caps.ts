// Cài đặt → Khả năng của từng tài khoản (chỉ chạy ở máy chủ). Lưu trên máy chủ để máy chủ tự áp dụng khi chat
// (không tin giá trị trình duyệt gửi lên) và để cài đặt đi theo tài khoản trên mọi thiết bị.
import "server-only";
import { can, db, type UserRow } from "./authstore";
import { hasDevice } from "./browserext";
import { CAP_KEYS, DEFAULT_CAPS, type Caps, type CapsState } from "../shared/catalog";
import { runner } from "./coderun";
import { wsConfigured } from "./workspace";

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec("CREATE TABLE IF NOT EXISTS user_caps (user_id TEXT PRIMARY KEY, caps TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    ready = true;
  }
  return d;
}

// Lựa chọn của người dùng (chưa tính quyền quản trị viên hay máy chủ).
export function userCaps(uid: string): Caps {
  const r = init().prepare("SELECT caps FROM user_caps WHERE user_id = ?").get(uid) as { caps: string } | undefined;
  let raw: Record<string, unknown> = {};
  try { raw = r ? JSON.parse(r.caps) : {}; } catch {}
  return Object.fromEntries(CAP_KEYS.map((k) => [k, typeof raw[k] === "boolean" ? raw[k] : DEFAULT_CAPS[k]])) as Caps;
}

export function setUserCaps(uid: string, patch: Record<string, unknown>): Caps {
  const cur = userCaps(uid);
  for (const k of CAP_KEYS) if (typeof patch[k] === "boolean") cur[k] = patch[k] as boolean;
  init().prepare("INSERT INTO user_caps (user_id, caps, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET caps = excluded.caps, updated_at = excluded.updated_at")
    .run(uid, JSON.stringify(cur), Date.now());
  return cur;
}

export function removeUserCaps(uid: string) {
  init().prepare("DELETE FROM user_caps WHERE user_id = ?").run(uid);
}

// Khả năng thực sự dùng được: chạy code cần quản trị viên cho phép Cloud sandbox và máy chủ có nơi chạy code;
// artifact dùng AI cần bật Artifacts; truy cập mạng cần bật chạy code; trình duyệt của Synchro chạy trong workspace của người dùng
// nên cần máy chủ có dịch vụ workspace và quản trị viên cho phép Synchro Code + Cloud sandbox. Chrome của người dùng (tiện ích Synchro)
// cần quản trị viên cho phép (Quyền truy cập → Your Chrome), dịch vụ workspace (nơi tiện ích nối tới) và đã ghép nối ít nhất một trình duyệt;
// có nó thì điều khiển trình duyệt vẫn dùng được khi trình duyệt của Synchro bị khóa.
export function capsState(u: UserRow): CapsState {
  const mine = userCaps(u.id);
  const locks: CapsState["locks"] = {};
  const run = runner();
  if (!can(u, "sandbox")) { locks.code = "admin"; locks.net = "admin"; locks.web = "admin"; }
  else if (!run) { locks.code = "server"; locks.net = "server"; locks.web = "server"; }
  const caps: Caps = { ...mine };
  if (!can(u, "code") || !can(u, "sandbox")) locks.browse = "admin";
  else if (!wsConfigured()) locks.browse = "server";
  if (!can(u, "chrome")) locks.mine = "admin";
  else if (!wsConfigured()) locks.mine = "server";
  const paired = !locks.mine && hasDevice(u.id);
  if (locks.code) { caps.code = false; caps.net = false; caps.web = false; }
  if (!paired) caps.mine = false;
  if (locks.browse && !paired) caps.browse = false;
  if (!caps.code) caps.net = false;
  if (!caps.net) caps.web = false;
  if (!caps.art) caps.ai = false;
  return { caps, locks, runner: run, paired };
}

// Skills cần "Chạy code và tạo tệp": người dùng tắt mục này thì model không dùng skill nữa
// (máy chủ chưa có nơi chạy code thì skill vẫn dùng được, chỉ không chạy được script).
export const skillsOn = (u: UserRow) => userCaps(u.id).code;

/** Trình duyệt model dùng khi không nói rõ: Chrome của người dùng nếu họ chọn (hoặc trình duyệt của Synchro bị khóa), không thì của Synchro. */
export const browserDefault = (st: CapsState): "synchro" | "user" => (st.caps.mine || (st.locks.browse && st.caps.browse) ? "user" : "synchro");
