// Vai trò của tiến trình web khi deploy xanh/lam (docs/van-hanh.md, "Deploy xanh/lam"). Mô-đun thuần (chỉ node:fs) để kiểm thử không cần máy chủ.
// - Một tiến trình (staging, máy dev, production chưa chuyển): SYNCHRO_ROLE trống hoặc "primary" → là primary ngay, chạy việc nền như trước,
//   trừ khi một tiến trình khác còn sống đang giữ khóa primary của cùng thư mục dữ liệu (ví dụ ai đó lỡ bật thêm "npm start" cạnh production
//   xanh/lam): khi đó chờ như secondary, không bao giờ có hai primary trên một cơ sở dữ liệu.
// - Xanh/lam (ecosystem.config.cjs đặt SYNCHRO_ROLE=secondary, SYNCHRO_COLOR=blue|green): khởi động là secondary, chỉ phục vụ yêu cầu.
//   Mỗi vài giây xem tệp màu đang sống (do scripts/server-build.sh ghi, dòng "<màu> <cổng>"): đã là màu của mình và tiến trình giữ khóa
//   primary đã thoát thì nhận vai primary và chạy việc nền đúng một lần. Nhờ vậy litestream, bộ hẹn giờ, chạy lại lượt dở dang… không bao giờ
//   chạy ở hai tiến trình, và resumeInterrupted chỉ chạy khi tiến trình cũ đã xong các lượt của nó.
import fs from "node:fs";
import path from "node:path";

export type Role = "primary" | "secondary";
export type RoleConfig = { bluegreen: boolean; color: string; liveFile: string; lockFile: string; pollMs: number };
type State = { role: Role; promoted: boolean; timer: ReturnType<typeof setInterval> | null; lockFile: string | null; hooked: boolean };

const g = globalThis as unknown as { __synchroRole?: State };
const st = (g.__synchroRole ??= { role: "primary", promoted: false, timer: null, lockFile: null, hooked: false });

export function roleConfig(env: NodeJS.ProcessEnv = process.env): RoleConfig {
  const mode = (env.SYNCHRO_ROLE ?? "").trim().toLowerCase();
  return {
    bluegreen: mode === "secondary",
    color: (env.SYNCHRO_COLOR ?? "").trim(),
    liveFile: env.SYNCHRO_LIVE_FILE || "/var/lib/synchro-ops/live-color",
    lockFile: env.SYNCHRO_PRIMARY_LOCK || path.join(env.DATA_DIR ?? path.join(process.cwd(), "data"), ".primary.pid"),
    pollMs: Number(env.SYNCHRO_ROLE_POLL_MS) || 3000,
  };
}

/** Màu đang nhận lưu lượng theo tệp trạng thái của deploy ("green 3002" → "green"). Không đọc được: null. */
export function liveColor(file: string): string | null {
  try { return fs.readFileSync(file, "utf8").trim().split(/\s+/)[0] || null; } catch { return null; }
}

const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** pid đang giữ vai primary (tệp khóa "<pid> <màu>"), hoặc null nếu không có / đã chết. */
export function primaryHolder(lockFile: string, alive: (pid: number) => boolean = pidAlive): number | null {
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8").trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 1 && alive(pid) ? pid : null;
  } catch { return null; }
}

/** Nhận vai khi không còn tiến trình nào khác giữ khóa primary; xanh/lam thì còn phải là màu đang sống. */
export function canPromote(c: Pick<RoleConfig, "bluegreen" | "color" | "liveFile" | "lockFile">, pid = process.pid, alive: (pid: number) => boolean = pidAlive): boolean {
  if (c.bluegreen && (!c.color || liveColor(c.liveFile) !== c.color)) return false;
  const holder = primaryHolder(c.lockFile, alive);
  return holder === null || holder === pid;
}

export const role = (): Role => st.role;
export const isPrimary = () => st.role === "primary";

/** Ghi khóa primary; trả về false nếu không ghi được (thư mục chỉ đọc…): khi đó vẫn nhận vai như trước, chỉ không có khóa. */
function takeLock(file: string, color: string): boolean {
  if (!st.hooked) { st.hooked = true; process.on("exit", releasePrimary); }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${process.pid} ${color}\n`);
    fs.renameSync(tmp, file);
    st.lockFile = file;
    return true;
  } catch (e) { console.error("[role] không ghi được khóa primary", e); return false; }
}

/** Bỏ khóa primary nếu đang giữ (lúc thoát): secondary kế tiếp nhận vai ngay ở nhịp kiểm tra sau. */
export function releasePrimary() {
  const f = st.lockFile;
  if (!f) return;
  st.lockFile = null;
  try { if (primaryHolder(f, () => true) === process.pid) fs.rmSync(f, { force: true }); } catch { /* bỏ qua */ }
}

/**
 * Gọi một lần lúc khởi động (instrumentation.ts). duties: mọi việc chỉ được chạy ở một tiến trình; được gọi đúng một lần, ngay (một tiến trình)
 * hoặc khi secondary nhận vai. Gọi lại startRole không chạy duties lần nữa.
 */
export function startRole(duties: () => void | Promise<void>, o: { env?: NodeJS.ProcessEnv; alive?: (pid: number) => boolean; pid?: number } = {}): Role {
  if (st.promoted || st.timer) return st.role;
  const env = o.env ?? process.env, c = roleConfig(env), pid = o.pid ?? process.pid;
  const become = () => {
    if (st.promoted) return;
    // Ghi khóa rồi đọc lại: hai tiến trình cùng thấy khóa trống thì chỉ tiến trình ghi sau cùng được nhận vai.
    if (takeLock(c.lockFile, c.color || "single") && primaryHolder(c.lockFile, () => true) !== process.pid) return;
    st.promoted = true;
    st.role = "primary";
    env.SYNCHRO_ROLE = "primary";
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (c.bluegreen || waited) console.log(`[role] ${c.color || "web"} (pid ${pid}) nhận vai primary`);
    try { void Promise.resolve(duties()).catch((e) => console.error("[role]", e)); } catch (e) { console.error("[role]", e); }
  };
  let waited = false;
  if (!c.bluegreen && canPromote(c, pid, o.alive)) { become(); if (st.promoted) return st.role; }
  st.role = "secondary";
  if (c.bluegreen && !c.color) console.error("[role] SYNCHRO_ROLE=secondary nhưng thiếu SYNCHRO_COLOR: không bao giờ nhận vai primary");
  if (!c.bluegreen) { waited = true; console.error(`[role] tiến trình ${primaryHolder(c.lockFile, o.alive)} đang giữ khóa primary (${c.lockFile}): chỉ phục vụ yêu cầu, không chạy việc nền`); }
  const check = () => { if (canPromote(c, pid, o.alive)) become(); };
  st.timer = setInterval(check, c.pollMs);
  st.timer.unref?.();
  check();
  return st.role;
}

/** Chỉ cho kiểm thử: về trạng thái ban đầu. */
export function resetRoleForTest() {
  if (st.timer) clearInterval(st.timer);
  st.role = "primary"; st.promoted = false; st.timer = null; st.lockFile = null;
}
