// Đặt lại mật khẩu khi mất thiết bị: trang /reset hỏi có gỡ khóa truy cập và xác minh hai bước cũ không (mặc định giữ), lựa chọn đi qua
// route /api/auth/reset tới redeemResetLink. Tự chạy được, không cần máy chủ (loadTs), không gửi thư thật.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-resetf-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "resetf-test"; process.env.SYNCHRO_RELAX_LIMITS = "1";
process.env.MAIL_CAPTURE_DIR = path.join(tmp, "mail");
delete process.env.APP_URL;

const { authstore: AS, mfa: M, passkeys: PK, "api/auth/reset/route": RR } = await loadTs(["authstore", "mfa", "passkeys", "api/auth/reset/route"]);
const B = "http://synchro.test";
const d = AS.db();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const post = async (body) => {
  const res = await RR.POST(new Request(B + "/api/auth/reset", { method: "POST", headers: { origin: B, host: "synchro.test", "content-type": "application/json", "user-agent": "t" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let n = 0;
const withFactors = async () => {
  const u = AS.createUser({ email: `r${++n}@resetf.test`, name: "R", verified: true, passwordHash: await AS.hashPassword("Mat-khau-cu-123") });
  PK.listPasskeys(u.id); // tạo bảng
  d.prepare("INSERT INTO user_passkeys (id, user_id, name, public_key, created_at) VALUES (?, ?, 'K', x'00', ?)").run(`k-${n}`, u.id, Date.now());
  M.mfaStatus(u.id); // tạo bảng
  d.prepare("INSERT INTO user_mfa (user_id, secret, enabled_at, recovery) VALUES (?, 'x', ?, '[]')").run(u.id, Date.now());
  const token = crypto.randomBytes(16).toString("hex");
  d.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(sha(token), u.id, Date.now() + 3_600_000, u.id);
  return { u, token };
};
const has = (u) => ({ keys: PK.listPasskeys(u.id).length, mfa: M.mfaStatus(u.id).enabled });

try {
  console.log("1. Kiểm tra đường dẫn cho biết có cách đăng nhập cũ");
  {
    const { token } = await withFactors();
    const c = await post({ token, check: true });
    ok(c.status === 200 && c.json.factors === true, "check → factors: true", c);
  }
  console.log("2. Chọn gỡ: dropFactors tới redeemResetLink");
  {
    const { u, token } = await withFactors();
    const r = await post({ token, password: "Mat-khau-moi-456", dropFactors: true });
    ok(r.status === 200 && has(u).keys === 0 && has(u).mfa === false, "dropFactors: true → gỡ khóa truy cập và xác minh hai bước", { r, h: has(u) });
    ok(!!d.prepare("SELECT 1 FROM audit WHERE action = 'password_reset' AND target_id = ? AND detail = 'drop_factors'").get(u.id), "nhật ký ghi drop_factors");
  }
  console.log("3. Mặc định giữ");
  for (const v of [undefined, false, "true", 1]) {
    const { u, token } = await withFactors();
    const r = await post({ token, password: "Mat-khau-moi-456", ...(v === undefined ? {} : { dropFactors: v }) });
    ok(r.status === 200 && has(u).keys === 1 && has(u).mfa === true, `dropFactors ${JSON.stringify(v)} → giữ nguyên (chỉ true mới gỡ)`, { r, h: has(u) });
  }
  console.log("4. Trang /reset gửi đúng lựa chọn");
  {
    const src = fs.readFileSync("app/reset/page.tsx", "utf8");
    ok(/check: true \}\)\.then\(\(j[^)]*\) => \{ setFactors\(j\?\.factors === true\)/.test(src), "đọc factors từ lần kiểm tra đường dẫn");
    ok(/\[dropFactors, setDropFactors\] = useState\(false\)/.test(src), "ô chọn mặc định không chọn");
    ok(src.includes("dropFactors: factors && dropFactors") && src.includes('type="checkbox" checked={dropFactors}'), "gửi dropFactors theo ô chọn, chỉ khi có cách đăng nhập cũ");
  }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
