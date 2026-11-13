// Xóa sạch dữ liệu của một tài khoản (tự xóa và quản trị viên xóa dùng chung): trang quyền riêng tư hứa xóa vĩnh viễn, nên không được sót
// đoạn chat, bộ nhớ, bộ não, đăng nhập CLI hay tệp trên đĩa. Bảng SQLite quét theo tên cột (user_id, owner): bảng thêm sau này tự được xóa theo.
// Chỉ đụng tới dữ liệu của đúng uid này: tệp dùng chung với người khác giữ nguyên.
import path from "node:path";
import { db } from "./authstore";
import { opsEvent } from "./ops";
import { removeUserSkillFiles } from "./skillstore";
import { removeUserDevices } from "./browserext";
import { removeUserOutputs } from "./outputs";
import { removeUserApps } from "./appstore";
import { removeUserPlugins } from "./plugins";
import { dropTag, userKey } from "./skillstudio";
import { cancelUserRuns } from "./runs";
import { stopUserAgentRuns } from "./agentruns";
import { purgeUserVoices, removeUserSpeech } from "./speechapi";
import { destroyWorkspace } from "./workspace";
import { releaseUserFiles } from "./fileproc/owners";
import { logout, safeScope } from "./ai/cli_auth";
import { CLIS, engineHome, listEngineDir, removeDir } from "./ai/cli_runtime";

const USER_COLS = ["user_id", "owner"];

/** Xóa mọi dòng có cột user_id / owner bằng uid trong toàn bộ cơ sở dữ liệu. Trả về số dòng theo từng bảng.
 *  Bọc trong một transaction: xóa dở nửa chừng (lỗi giữa chừng) không để lại tài khoản xóa một phần — hoặc xong hết, hoặc không đổi gì. */
export function purgeRows(uid: string) {
  const d = db(), out: Record<string, number> = {};
  d.transaction(() => {
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) {
      const cols = (d.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
      for (const c of USER_COLS) {
        if (!cols.includes(c)) continue;
        const n = d.prepare(`DELETE FROM "${name}" WHERE "${c}" = ?`).run(uid).changes;
        if (n) out[name] = (out[name] ?? 0) + n;
      }
    }
    d.prepare("DELETE FROM settings WHERE key = ?").run(`mem:${uid}`);
    // Dữ liệu chung người này ghi trong ứng dụng của người khác thuộc về ứng dụng đó: chỉ bỏ dấu "ai ghi".
    try { d.prepare("UPDATE app_data SET updated_by = '' WHERE updated_by = ?").run(uid); } catch { /* chưa có bảng */ }
    // Nhật ký bảo mật giữ lại sự kiện nhưng bỏ email, IP; riêng dòng "đã xóa tài khoản" giữ email để quản trị viên đối chiếu khi có khiếu nại.
    d.prepare("UPDATE audit SET actor_email = NULL, target_email = NULL, ip = NULL WHERE (actor_id = ? OR target_id = ?) AND action NOT IN ('account_deleted', 'admin_delete')").run(uid, uid);
    // Hai sự kiện đổi email ghi địa chỉ mới ở detail.
    d.prepare("UPDATE audit SET detail = NULL WHERE (actor_id = ? OR target_id = ?) AND action IN ('email_changed', 'admin_set_email')").run(uid, uid);
  })();
  return out;
}

/** Đăng xuất mọi CLI (xóa cả token đã lưu), xóa thư mục làm việc của CLI. Thư mục nằm trong nhà engine, thuộc user riêng của engine. */
async function purgeEngine(uid: string) {
  const scope = safeScope(uid), root = path.join(engineHome(), "logins");
  for (const cli of CLIS) if ((await listEngineDir(path.join(root, cli))).includes(scope)) await logout(cli, uid).catch((e) => console.error("[purge] logout", cli, e));
  await removeDir(path.join(engineHome(), "work", scope));
}

export async function purgeUser(uid: string) {
  // uid rỗng hay lạ thì path.join(ROOT, uid) có thể trỏ vào thư mục chung của mọi người.
  if (!/^[\w-]{8,64}$/.test(uid)) throw new Error("purgeUser: invalid uid");
  // Một bước lỗi không được làm sót các bước sau; ghi log VÀ nổi lên trang Sức khỏe hệ thống (ops) để quản trị viên thấy tài khoản xóa chưa trọn.
  const step = async (name: string, f: () => unknown) => {
    try { await f(); } catch (e) {
      console.error(`[purge] ${name}`, e);
      try { opsEvent("error", "purge", `${name}: ${String((e as Error)?.message ?? e).slice(0, 200)}`, uid); } catch { /* ops lỗi cũng không được làm hỏng việc xóa */ }
    }
  };
  // Lượt đang chạy phải dừng trước, nếu không nó ghi tiếp sau khi đã xóa. Một bước lỗi không được làm sót các bước sau.
  await step("runs", () => cancelUserRuns(uid));
  await step("agent runs", () => stopUserAgentRuns(uid));
  await step("skills", async () => {
    const ids = db().prepare("SELECT id FROM skills WHERE user_id = ?").all(uid) as { id: string }[];
    for (const s of ids) dropTag(userKey(s.id));
    await removeUserSkillFiles(uid);
  });
  await step("devices", () => removeUserDevices(uid));
  await step("outputs", () => removeUserOutputs(uid));
  await step("apps", () => removeUserApps(uid));
  await step("plugins", () => removeUserPlugins(uid));
  await step("speech", () => removeUserSpeech(uid));
  // Trước bước rows: bước đó xóa mất dòng chủ của giọng, không còn biết giọng nào là của người này.
  await step("voices", () => purgeUserVoices(uid));
  await step("uploads", () => releaseUserFiles(uid));
  await step("engine", () => purgeEngine(uid));
  await step("workspace", () => destroyWorkspace(uid));
  await step("rows", () => purgeRows(uid));
}
