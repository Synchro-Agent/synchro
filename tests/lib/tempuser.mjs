// Người dùng tạm cho từng bộ kiểm thử (H2.4) thay cho tài khoản quản trị dùng chung: bộ này đổi cài đặt, đoạn chat, thẻ… của chính nó,
// không làm bẩn admin@synchro.test mà các bộ khác (và người đang thử tay trên bản giả lập) cùng dùng.
// Dùng: const u = await tempUser(B, "tags"); … u.cookie / u.uid / u.api("GET", "/api/…") … finally await u.remove();
// Chỉ cho bản giả lập (dev:mock): tạo bằng /api/auth/signup như người thật, quản trị viên cấp đủ quyền (mặc định thành viên có thể bị tắt
// Skills, model…) rồi xóa hẳn khi xong. Email mang dấu thời gian nên hai lần chạy liền nhau không đụng nhau.
import { createRequire } from "node:module";
import path from "node:path";

const J = { "content-type": "application/json" };
function client(base, init = "") {
  let cookie = init;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { ...J, origin: base, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  return { api, cookie: () => cookie };
}

/** Phiên quản trị: dùng phiên run-all chia sẵn (SYNCHRO_ADMIN_COOKIE) nếu có, không thì đăng nhập (giới hạn số lần đăng nhập). */
export async function adminClient(base) {
  const c = client(base, process.env.SYNCHRO_ADMIN_COOKIE ?? "");
  if (!c.cookie()) await c.api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
  if (!c.cookie()) throw new Error("Không đăng nhập được tài khoản quản trị thử nghiệm");
  return c;
}

/**
 * @param {string} base địa chỉ Synchro giả lập
 * @param {string} tag tên ngắn của bộ kiểm thử (vào email)
 * @param {{ fullPerms?: boolean, verified?: boolean, name?: string }} [o] fullPerms (mặc định true): cấp mọi model và tính năng; false: giữ quyền
 *   mặc định của thành viên mới (default_perms của máy chủ, như tài khoản miễn phí thật). verified (mặc định false): quản trị viên đánh dấu email
 *   đã xác minh (Cài đặt → Quản trị → Đánh dấu đã xác minh), như người dùng thật đã bấm liên kết trong thư; bản giả lập tắt cổng xác minh nên
 *   không đánh dấu thì tài khoản vẫn "chưa xác minh" (hạn mức giọng AI, tệp… tính theo mức chưa xác minh).
 */
export async function tempUser(base, tag, o = {}) {
  const email = `${tag.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "suite"}-${Date.now().toString(36)}@synchro.test`;
  const password = "Temp-pass-123";
  const me = client(base);
  const su = await me.api("POST", "/api/auth/signup", { email, password, profile: { fullName: o.name ?? `Test ${tag}`, birthDate: "2000-01-01" } });
  if (!me.cookie()) await me.api("POST", "/api/auth/login", { email, password });
  if (!me.cookie()) throw new Error(`Không tạo được người dùng tạm ${email} (${su.s}: ${JSON.stringify(su.j).slice(0, 200)})`);
  const uid = (await me.api("GET", "/api/auth/me")).j?.user?.id;
  const admin = await adminClient(base);
  if (o.fullPerms !== false || o.verified) {
    const u = (await admin.api("GET", "/api/admin")).j?.users?.find((x) => x.email === email);
    if (!u) throw new Error(`Không thấy người dùng tạm ${email} trong danh sách quản trị`);
    if (o.fullPerms !== false) await admin.api("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms?.features ?? {}).map((k) => [k, true])) } });
    if (o.verified) {
      const r = await admin.api("PATCH", `/api/admin/users/${u.id}`, { action: "mark_verified" });
      if (r.s !== 200) throw new Error(`Không đánh dấu xác minh được ${email} (${r.s}: ${JSON.stringify(r.j).slice(0, 200)})`);
    }
  }
  return {
    email, password, uid,
    get cookie() { return me.cookie(); },
    api: me.api,
    admin: admin.api,
    /** Ghi thẳng vào cơ sở dữ liệu của bản giả lập (data-mock/) cho phần không có API (vd. mức dùng). Chỉ trên máy chạy dev:mock. */
    db() {
      const R = createRequire(path.join(process.cwd(), "package.json"));
      const d = new (R("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db"));
      d.pragma("busy_timeout = 5000");
      return d;
    },
    /** Xóa hẳn người dùng tạm (đoạn chat, tệp, mức dùng đi theo). Không ném lỗi: dọn dẹp không được làm hỏng kết quả của bộ kiểm. */
    async remove() {
      const u = (await admin.api("GET", "/api/admin").catch(() => ({ j: null }))).j?.users?.find((x) => x.email === email);
      if (u) await admin.api("DELETE", `/api/admin/users/${u.id}`, { confirm: email }).catch(() => {});
    },
  };
}
