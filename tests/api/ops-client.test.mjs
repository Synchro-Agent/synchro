// Lỗi trình duyệt báo về không được đẩy lỗi máy chủ khỏi trang Sức khỏe, và người chưa đăng nhập gửi được ít hơn nhiều. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-opsc-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "opsc"; process.env.SYNCHRO_OPS_DIR = path.join(tmp, "ops");
const { ops: OPS, authstore: AS, "api/client-error/route": R } = await loadTs(["ops", "authstore", "api/client-error/route"]);
const B = "http://localhost:3200";
const post = (msg, ip, cookie = "") => R.POST(new Request(B + "/api/client-error", { method: "POST", headers: { origin: B, host: "localhost:3200", "content-type": "application/json", "x-forwarded-for": ip, cookie }, body: JSON.stringify({ message: msg }) }));
try {
  OPS.opsEvent("error", "server", "lỗi máy chủ thật");
  let codes = [];
  for (let i = 0; i < 8; i++) codes.push((await post(`rác ${i}`, "7.7.7.7")).status);
  ok(codes.filter((c) => c === 200).length === 5 && codes.at(-1) === 429, "khách chưa đăng nhập: tối đa 5 báo cáo mỗi 10 phút mỗi IP", codes);
  const u = AS.createUser({ email: "c@ops.test", name: "C", verified: true, passwordHash: "x" });
  const cookie = AS.createSession(u, new Request(B + "/", { headers: { origin: B, host: "localhost:3200", "user-agent": "t", "x-forwarded-for": "8.8.8.8" } }), "password").split(";")[0];
  codes = [];
  for (let i = 0; i < 12; i++) codes.push((await post(`báo ${i}`, "8.8.8.8", cookie)).status);
  ok(codes.every((c) => c === 200), "đã đăng nhập: được gửi nhiều hơn", codes);
  const snap = OPS.opsSnapshot();
  ok(snap.errors.length === 1 && snap.errors[0].detail === "lỗi máy chủ thật", "danh sách lỗi máy chủ không lẫn báo cáo trình duyệt", snap.errors);
  ok(snap.errors24 === 1, "đếm lỗi máy chủ 24 giờ không tính báo cáo trình duyệt", snap.errors24);
  ok(snap.clientErrors.length >= 5 && snap.client24 === 17, "báo cáo trình duyệt nằm ở danh sách riêng", snap.client24);
  // Hàng cũ ghi chung sổ: đọc đúng chỗ mà không cần chuyển dữ liệu.
  OPS.opsEvent("error", "browser", "hàng cũ");
  const again = OPS.opsSnapshot();
  ok(again.errors.every((e) => e.source !== "browser") && again.clientErrors.some((e) => e.detail === "hàng cũ"), "hàng cũ của trình duyệt được xếp đúng chỗ", again.clientErrors);
  ok(typeof again.turns?.running === "number" && typeof again.isolation?.bwrap === "boolean", "có số lượt đang chạy và trạng thái cách ly CLI", again.isolation);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
