// studioSummary (trang Artifacts) giữ kết quả theo (người dùng, plRev, tagRev, prefsRev) và dấu skill riêng của người dùng: gọi lại không tính
// lại cả kho, nhưng mọi thay đổi (thư viện, nhãn mục, lựa chọn riêng, thêm / bỏ skill ở mục, skill trong Kho kỹ năng) đều thấy ngay.
// Tự chạy được, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-summemo-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
process.env.SYNCHRO_DEFAULT_PLUGINS = "0";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

try {
  const { plugins: P, authstore: AS, skillstudio: ST } = await loadTs(["plugins", "authstore", "skillstudio"]);
  const u = AS.createUser({ email: "a@summemo.test", name: "A", verified: true });
  P.listPlugins(u.id);
  ST.getTag("x");
  const d = AS.db();
  const report = JSON.stringify({ risk: "none", license: "MIT" });
  const insP = d.prepare("INSERT INTO plugins (id, owner, slug, catalog_id, name, description, sources, created_at, updated_at) VALUES (?, 'org', ?, ?, ?, '', '[]', ?, ?)");
  const insS = d.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report) VALUES (?, ?, ?, ?, '', '', '[]', ?)");
  const insT = d.prepare("INSERT INTO skill_studios (key, studios, src, sig, at) VALUES (?, ?, 'rules', '', 0)");
  for (let i = 0; i < 40; i++) {
    insP.run(`p${i}`, `lib-${i}`, i < 4 ? null : `cd:lib-${i}`, `Library ${i}`, i, i);
    for (let j = 0; j < 3; j++) { insS.run(`p${i}-${j}`, `p${i}`, `s-${i}-${j}`, "d", report); insT.run(`p:p${i}:s-${i}-${j}`, JSON.stringify([["design"], ["slides"], ["docs"]][j])); }
  }
  P.setBulk(false);
  const count = (s) => Object.values(s).reduce((a, v) => a + v.skills, 0);

  console.log("1. Gọi lại: cùng kết quả, không tính lại");
  const a = P.studioSummary(u.id), b = P.studioSummary(u.id);
  ok(count(a) === 120 && a.design?.skills === 40, "kết quả đúng (120 skill, 40 ở Thiết kế)", a);
  ok(a === b, "lần gọi thứ hai trả lại đúng kết quả đã giữ");

  console.log("2. Lựa chọn riêng đổi (plugin_prefs): tính lại");
  P.setPref(u.id, "p5", { enabled: false });
  const c = P.studioSummary(u.id);
  ok(c !== b && count(c) === 117, "tắt một thư viện cho mình: bớt 3 skill", count(c));
  P.setPref(u.id, "p5", { enabled: true });
  ok(count(P.studioSummary(u.id)) === 120, "bật lại: đủ 120");

  console.log("3. Thêm / bỏ skill ở một mục (skill_studio_user): tính lại");
  P.setStudioOverride(u.id, "design", "s-6-0", false);
  ok(P.studioSummary(u.id).design?.skills === 39, "bỏ một skill khỏi Thiết kế");
  P.setStudioOverride(u.id, "design", "s-6-0", null);
  ok(P.studioSummary(u.id).design?.skills === 40, "trả lại như Synchro tự xếp");

  console.log("4. Thư viện đổi (plRev): tính lại");
  P.setPlugin("p7", { enabled: false });
  ok(count(P.studioSummary(u.id)) === 117, "tắt thư viện cho cả tổ chức: bớt 3 skill");
  P.setPlugin("p7", { enabled: true });
  ok(count(P.studioSummary(u.id)) === 120, "bật lại");

  console.log("5. Nhãn mục đổi (tagRev): tính lại");
  d.prepare("UPDATE skill_studios SET studios = '[\"slides\"]' WHERE key = 'p:p8:s-8-0'").run();
  ST.bumpTags();
  const e = P.studioSummary(u.id);
  ok(e.design?.skills === 39 && e.slides?.skills === 41, "một skill chuyển từ Thiết kế sang Trình bày", e);

  console.log("6. Skill riêng của người dùng (Kho kỹ năng): tính lại theo dấu của bảng skills");
  d.prepare("INSERT INTO skills (id, user_id, name, description, body, storage_path, enabled, version, created_at, updated_at) VALUES ('us1', ?, 'my-doc', 'x', 'x', 'x', 1, 1, 1, 1)").run(u.id);
  d.prepare("INSERT INTO skill_studios (key, studios, src, sig, at) VALUES ('u:us1', '[\"docs\"]', 'manual', '', 0)").run();
  ok(P.studioSummary(u.id).docs?.skills === 41, "thêm skill vào Tài liệu: thấy ngay (không cần báo đổi nhãn)");
  d.prepare("UPDATE skills SET enabled = 0, updated_at = 2 WHERE id = 'us1'").run();
  ok(P.studioSummary(u.id).docs?.skills === 40, "tắt skill: bớt đi");

  console.log("7. Mỗi người một kết quả, tối đa 500 người");
  const other = AS.createUser({ email: "b@summemo.test", name: "B", verified: true });
  P.setPref(other.id, "p9", { enabled: false });
  ok(count(P.studioSummary(other.id)) === 117 && count(P.studioSummary(u.id)) === 120, "lựa chọn của người này không lẫn sang người kia");
  for (let i = 0; i < 520; i++) P.studioSummary(`ghost-user-${i}`);
  ok(P.studioSummaryMemoSize() === 500, "giữ tối đa 500 người", P.studioSummaryMemoSize());
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
