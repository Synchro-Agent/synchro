// D5: thư viện danh mục phải ghim commit mới cài được — dirDef từ chối thư viện không có commit (không cài theo HEAD của nhánh).
// Không cần máy chủ: đọc một tệp danh mục tạm qua CLAUDE_DIR_FILE.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-dir-"));
const file = path.join(dir, "claude-directory.json");
const entry = (id, commit, extra = {}) => ({ id, slug: id, name: id, summary: `Thư viện ${id}`, author: "acme", cats: ["engineering"], license: "MIT", repo: `acme/${id}`, path: "", commit, homepage: `https://example.com/${id}`, skills: ["a", "b"], ...extra });
fs.writeFileSync(file, JSON.stringify({ synced: new Date().toISOString(), source: "test", plugins: [
  entry("pinned", "0123456789abcdef0123456789abcdef01234567"),
  entry("nocommit", ""),
  entry("ghalt", "", { github: true, altFor: ["x"] }),
] }));
process.env.CLAUDE_DIR_FILE = file;

const { claudedir: C } = await loadTs(["claudedir"]);

console.log("1. Thư viện đã ghim commit: cài được, ref đúng bằng commit");
const def = C.dirDef(C.dirEntry("cd:pinned"));
ok(def.sources[0].ref === "0123456789abcdef0123456789abcdef01234567", "ref = commit đã ghim", JSON.stringify(def.sources));
ok(def.catalogId === "cd:pinned", "catalogId đúng");

console.log("2. Thư viện không có commit: dirDef ném lỗi (không cài)");
for (const id of ["cd:nocommit", "cd:ghalt"]) {
  let threw = false, msg = "";
  try { C.dirDef(C.dirEntry(id)); } catch (e) { threw = true; msg = e.message; }
  ok(threw, `${id} bị từ chối`, "không ném lỗi");
  ok(threw && !/giấy phép|độc quyền|404|Không tìm thấy|Không tải/.test(msg), `${id}: lỗi không bị phân loại nhầm là mạng/giấy phép`, msg);
}

console.log("3. dirStudios: trả nhãn đã lưu, null khi chưa có");
fs.writeFileSync(file, JSON.stringify({ synced: new Date().toISOString(), source: "test", plugins: [
  entry("s1", "a".repeat(40), { studios: { a: ["docs"], b: ["design", "slides"] } }),
  entry("s2", "b".repeat(40)),
] }));
delete globalThis.__claudeDir; // buộc nạp lại tệp mới
const st = C.dirStudios("cd:s1");
ok(st && JSON.stringify(st.b) === JSON.stringify(["design", "slides"]), "dirStudios đọc nhãn đã lưu", JSON.stringify(st));
ok(C.dirStudios("cd:s2") === null, "không có studios → null");
ok(C.dirStudios(null) === null, "catalogId null → null");

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
