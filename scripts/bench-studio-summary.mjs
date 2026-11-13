// Đo studioSummary (trang Artifacts, GET /api/plugins?view=meta) trên một kho giả cỡ danh mục của Claude (~3.000 thư viện, ~18.000 skill).
// Không chạy trong CI, không cần máy chủ: dữ liệu nằm trong thư mục tạm, xong thì xóa.
// Dùng: node scripts/bench-studio-summary.mjs [số thư viện=3000] [skill mỗi thư viện=6] [số lần gọi lặp=50]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadTs } from "../tests/lib/ts.mjs";

const LIBS = Number(process.argv[2] ?? 3000), PER = Number(process.argv[3] ?? 6), REPEAT = Number(process.argv[4] ?? 50);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-bench-studio-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "bench";
process.env.SYNCHRO_DEFAULT_PLUGINS = "0";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

try {
  const { plugins: P, authstore: AS } = await loadTs(["plugins", "authstore"]);
  const u = AS.createUser({ email: "bench@studio.test", name: "Bench", verified: true });
  P.listPlugins(u.id); // tạo bảng
  const d = AS.db();
  d.exec("CREATE TABLE IF NOT EXISTS skill_studios (key TEXT PRIMARY KEY, studios TEXT NOT NULL, src TEXT NOT NULL, sig TEXT NOT NULL, why TEXT, model_at INTEGER, at INTEGER NOT NULL)");
  const report = JSON.stringify({ risk: "none", license: "MIT" });
  const insP = d.prepare("INSERT INTO plugins (id, owner, slug, catalog_id, name, description, sources, created_at, updated_at) VALUES (?, 'org', ?, ?, ?, '', '[]', ?, ?)");
  const insS = d.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report) VALUES (?, ?, ?, ?, '', '', '[]', ?)");
  const insT = d.prepare("INSERT INTO skill_studios (key, studios, src, sig, at) VALUES (?, ?, 'rules', '', 0)");
  const kinds = [["design"], ["slides"], ["docs"], ["design", "docs"], [], []];
  d.transaction(() => {
    for (let i = 0; i < LIBS; i++) {
      const id = `p${i}`;
      insP.run(id, `lib-${i}`, i < 10 ? null : `cd:lib-${i}`, `Library ${i}`, i, i);
      for (let j = 0; j < PER; j++) {
        const name = `skill-${i}-${j}`;
        insS.run(`${id}-${j}`, id, name, `Skill ${j} of library ${i}`, report);
        const k = kinds[(i + j) % kinds.length];
        if (k.length) insT.run(`p:${id}:${name}`, JSON.stringify(k));
      }
    }
  })();
  P.setBulk(false); // dữ liệu ghi thẳng vào bảng: bỏ bộ đệm thư viện để lần gọi đầu dựng lại
  const t0 = performance.now();
  const first = P.studioSummary(u.id);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < REPEAT; i++) P.studioSummary(u.id);
  const warm = (performance.now() - t1) / REPEAT;
  // Đổi lựa chọn riêng của người dùng: lần gọi sau phải tính lại và thấy thay đổi.
  P.setPref(u.id, "p11", { enabled: false });
  const t2 = performance.now();
  const after = P.studioSummary(u.id);
  const changed = performance.now() - t2;
  const total = (s) => Object.values(s).reduce((a, v) => a + v.skills, 0);
  console.log(JSON.stringify({ libraries: LIBS, skills: LIBS * PER, repeat: REPEAT, coldMs: +cold.toFixed(1), repeatAvgMs: +warm.toFixed(3), afterPrefChangeMs: +changed.toFixed(1),
    skillsBefore: total(first), skillsAfterPref: total(after) }));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
