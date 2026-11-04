// Thư viện lớn của danh mục Claude trong ba mục ở trang Artifacts: tự xếp bằng bộ luật, không gọi model; prompt có giới hạn và vẫn có skill hợp yêu cầu;
// trang Artifacts nhận gói tin nhỏ, danh sách theo trang; nút studio Tự động nhận diện / Không / tên mục, giữ mục người dùng tự chọn.
// Chạy trên npm run dev:mock. Dữ liệu mẫu ghi thẳng vào data-mock (cài thật ~1.500 skill từ GitHub giả lập quá lâu) rồi gọi API để máy chủ xếp mục.
import { createRequire } from "node:module";
import path from "node:path";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", LLM = process.env.SYNCHRO_LLM_URL ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    return { s: r.status, j, size: text.length };
  };
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), me = client(), other = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const EMAIL = "studio-catalog@synchro.test", EMAIL2 = "studio-catalog2@synchro.test";
for (const [c, e] of [[me, EMAIL], [other, EMAIL2]]) {
  await c("POST", "/api/auth/signup", { email: e, password: "Member-pass-123", profile: { fullName: "Studio Catalog", birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email: e, password: "Member-pass-123" });
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === e);
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
for (const cli of ["claude", "codex", "agy"]) await me("POST", `/api/engines/${cli}/logout`);

const db = new (createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db"));
db.pragma("busy_timeout = 5000");
const uid = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL).id;
const PID = "pl_studiocatalogtest", ORG = "pl_studiocatalogorg";
const wipe = () => db.transaction(() => { for (const id of [PID, ORG]) { db.prepare("DELETE FROM skill_studios WHERE key >= ? AND key < ?").run(`p:${id}:`, `p:${id};`); db.prepare("DELETE FROM plugin_skills WHERE plugin_id = ?").run(id); db.prepare("DELETE FROM plugins WHERE id = ?").run(id); } })();
wipe();
const SLIDES = 300, DOCS = 300, OTHER = 900;
const now = Date.now(), report = JSON.stringify({ name: "x", risk: "none", license: "MIT" });
const insP = db.prepare("INSERT INTO plugins (id, owner, slug, catalog_id, name, description, sources, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)");
const insS = db.prepare("INSERT INTO plugin_skills (id, plugin_id, name, description, body, storage_path, files, report, enabled) VALUES (?, ?, ?, ?, ?, '', '[]', ?, 1)");
db.transaction(() => {
  insP.run(PID, uid, "catalog-big", "cd:test/studio-catalog", "Catalog Big", "Thư viện mẫu của danh mục", now, now);
  insP.run(ORG, "org", "catalog-org-mini", "cd:test/studio-catalog-org", "Catalog Org Mini", "Thư viện mẫu của tổ chức", now, now);
  insS.run(`${ORG}-1`, ORG, "org-pitch-deck-mini", "Build a pitch deck for a seed round.", "x", report);
  const pad = "Includes narrative arc, speaker notes, and a checklist of what investors and reviewers look for in every section of the material. ";
  for (let i = 0; i < SLIDES; i++) insS.run(`${PID}-s${i}`, PID, `sample-deck-${i}`, `Build a pitch deck for industry number ${i}. ${pad}`, "x".repeat(50), report);
  for (let i = 0; i < DOCS; i++) insS.run(`${PID}-d${i}`, PID, `sample-proposal-${i}`, `Draft a proposal for client segment ${i}. ${pad}`, "x".repeat(50), report);
  for (let i = 0; i < OTHER; i++) insS.run(`${PID}-o${i}`, PID, `sample-crypto-${i}`, `Track wallet balances on chain ${i}. Use when asked about swaps, fees or tokens.`, "Export a PDF report or slides of the wallet for your documentation.", report);
  // Skill đặc biệt để kiểm tra chọn đúng theo yêu cầu.
  insS.run(`${PID}-z1`, PID, "zebra-keynote-deck", "Build a keynote deck about zebra conservation for wildlife conferences.", "x", report);
  insS.run(`${PID}-z2`, PID, "manual-crypto-note", "Track wallet balances on one chain.", "x", report);
})();
const tag = (name) => db.prepare("SELECT studios, src, model_at FROM skill_studios WHERE key = ?").get(`p:${PID}:${name}`);
const LAST = () => fetch(`${LLM}/_debug/last`).then((r) => r.json());
const M = "anthropic/claude-sonnet-5-5";
const ask = (body) => me("POST", "/api/llm", { system: "", max_tokens: 300, skills: true, model: M, ...body });
const avail = (sys) => { const a = /<available_skills>([\s\S]*?)<\/available_skills>/.exec(sys)?.[1] ?? ""; return [...a.matchAll(/<name>(.*?)<\/name>/g)].map((m) => m[1]); };
const lastSys = async () => { const a = (await LAST()).anthropic; return JSON.stringify(a?.system ?? a ?? ""); };

console.log("1. Thư viện của danh mục: xếp bằng bộ luật, không nhờ model");
let r = await me("PATCH", `/api/plugins/${PID}`, { studio: "auto" });
ok(r.s === 200 && r.j.plugin.studioMode === "auto" && r.j.plugin.studio === null, "dòng cũ studio NULL là Tự động nhận diện", JSON.stringify(r.j?.plugin).slice(0, 200));
const det0 = r.j.plugin.detected;
ok(det0.slides === SLIDES + 1 && det0.docs === DOCS && !det0.design, `đếm đúng theo mục: ${JSON.stringify(det0)}`, JSON.stringify(det0));
const n = db.prepare("SELECT COUNT(*) n, SUM(src = 'rules') rules, SUM(model_at IS NOT NULL) asked FROM skill_studios WHERE key >= ? AND key < ?").get(`p:${PID}:`, `p:${PID};`);
ok(n.n === SLIDES + DOCS + OTHER + 2 && n.rules === n.n && !n.asked, "mọi skill có nhãn bộ luật, kể cả skill không thuộc mục nào", JSON.stringify(n));
ok(!(await me("GET", "/api/skills")).j?.refining, "không có việc nào chờ model");
ok(tag("sample-crypto-5")?.studios === "[]", "skill crypto nhắc pdf, slides trong nội dung: không thuộc mục nào", JSON.stringify(tag("sample-crypto-5")));

console.log("2. Trang Artifacts: số thật, gói tin nhỏ, danh sách theo trang");
r = await me("GET", "/api/plugins?view=meta");
ok(r.j.studios.slides?.skills >= SLIDES + 1 && r.j.studios.docs?.skills >= DOCS, `đếm đủ (${r.j.studios.slides?.skills} / ${r.j.studios.docs?.skills})`, JSON.stringify(r.j.studios).slice(0, 300));
ok(r.j.studios.slides.autoTotal >= SLIDES + 1 && r.j.studios.slides.auto.length <= 30, `auto có giới hạn, đủ số ở autoTotal (${r.j.studios.slides.auto.length} / ${r.j.studios.slides.autoTotal})`);
ok(r.size < 20_000, `?view=meta nhỏ: ${r.size} byte`, r.size);
ok(!/Catalog Org Mini|Catalog Big/.test(r.j.studios.slides.name) && r.j.studios.slides.catalogLibs >= 1, "không liệt kê tên từng thư viện của danh mục", JSON.stringify(r.j.studios.slides.name));
r = await me("GET", "/api/plugins?view=studio&studio=docs");
ok(r.j.total >= DOCS && r.j.skills.length === 40 && r.size < 20_000, `trang đầu 40 skill (${r.size} byte)`, r.size);
const p2 = await me("GET", "/api/plugins?view=studio&studio=docs&offset=40");
ok(p2.j.skills.length === 40 && p2.j.skills[0].name !== r.j.skills[0].name, "trang kế tiếp");
r = await me("GET", "/api/plugins?view=studio&studio=slides&q=zebra");
ok(r.j.matched === 1 && r.j.skills[0].name === "zebra-keynote-deck", "tìm trong mục", JSON.stringify(r.j));
r = await me("GET", "/api/plugins?view=studio&studio=video");
ok(r.s === 200 && r.j.total === 0, "mục không có thật: rỗng", JSON.stringify(r.j));

console.log("3. Bấm nút studio: prompt có giới hạn, có skill hợp yêu cầu, có lối tìm tiếp");
r = await ask({ studio: "slides", messages: [{ role: "user", content: "Làm deck về zebra conservation" }] });
ok(r.s === 200, "lượt chat chạy được", JSON.stringify(r.j).slice(0, 300));
let sys = await lastSys(), names = avail(sys);
const samples = names.filter((x) => /^sample-deck-/.test(x));
ok(names.includes("zebra-keynote-deck"), "có skill hợp nhất với yêu cầu", names.join());
ok(names.includes("studio-slides") && /library=\\?"studio-slides/.test(sys), "có mục lục và lối search_skills trong thư viện", names.slice(0, 5).join());
ok(samples.length <= 20 && names.filter((x) => !/^(cat|lib|studio)-/.test(x)).length <= 30, `không liệt kê cả thư viện (${samples.length} skill mẫu, ${names.length} mục)`, names.join());
const sized = await ask({ studio: "slides", estimate: true, messages: [{ role: "user", content: "Làm deck về zebra conservation" }] });
const sysB = sized.j.blocks.find((b) => b.key === "system").chars, skB = sized.j.blocks.find((b) => b.key === "skills").chars;
ok(skB < 45_000, `khối skill có giới hạn: ${skB} ký tự (system ${sysB})`, skB);
r = await ask({ studio: "slides", messages: [{ role: "user", content: "xin chào" }] });
names = avail(await lastSys());
ok(!names.some((x) => /^sample-deck-/.test(x)) && names.includes("studio-slides"), "câu không rõ việc: không kéo skill bất kỳ của danh mục vào prompt", names.join());

console.log("4. Chat thường: không liệt kê đôi");
r = await ask({ messages: [{ role: "user", content: "xin chào" }] });
names = avail(await lastSys());
ok(!names.some((x) => /^sample-/.test(x)), "skill của danh mục không nằm thẳng trong available_skills", names.join());
ok(names.filter((x) => x === "studio-slides").length === 1 && names.some((x) => x.startsWith("studio-")), "mỗi studio một mục lục");

console.log("5. Không xếp mục: bỏ nhãn tự động, giữ mục người dùng tự chọn");
db.prepare("INSERT INTO skill_studios (key, studios, src, sig, why, at) VALUES (?, '[\"docs\"]', 'manual', 'x', '', ?) ON CONFLICT(key) DO UPDATE SET studios = excluded.studios, src = 'manual'").run(`p:${PID}:manual-crypto-note`, now);
r = await me("PATCH", `/api/plugins/${PID}`, { studio: "none" });
ok(r.s === 200 && r.j.plugin.studioMode === "none" && r.j.plugin.studio === null, "lưu là none, cột studio vẫn rỗng", JSON.stringify({ m: r.j?.plugin?.studioMode, s: r.j?.plugin?.studio }));
ok(db.prepare("SELECT studio, auto_tag FROM plugins WHERE id = ?").get(PID).auto_tag === 0, "cột riêng auto_tag = 0");
ok(tag("sample-deck-1") === undefined && tag("manual-crypto-note")?.src === "manual", "nhãn tự động bị bỏ, mục tự chọn còn", JSON.stringify([tag("sample-deck-1"), tag("manual-crypto-note")]));
r = await me("GET", "/api/plugins?view=meta");
ok(!r.j.studios.slides?.autoTotal, "Trình bày không còn skill của thư viện này", JSON.stringify(r.j.studios.slides));
ok(r.j.studios.docs?.auto.some((a) => a.name === "manual-crypto-note"), "skill tự chọn vẫn ở Tài liệu", JSON.stringify(r.j.studios.docs));
r = await ask({ studio: "none", messages: [{ role: "user", content: "xin chào" }] });
ok(r.s === 200 && !r.j.libs?.some((l) => l.forced), "gửi studio=none trong chat không bị coi là một studio thật", JSON.stringify(r.j.libs));

console.log("6. Chuyển lại Tự động nhận diện: xếp lại");
r = await me("PATCH", `/api/plugins/${PID}`, { studio: "auto" });
ok(r.j.plugin.studioMode === "auto" && r.j.plugin.detected.slides === SLIDES + 1 && r.j.plugin.detected.docs === DOCS + 1, `xếp lại đủ, giữ mục tự chọn: ${JSON.stringify(r.j.plugin.detected)}`, JSON.stringify(r.j.plugin.detected));
ok(tag("manual-crypto-note")?.src === "manual" && tag("sample-deck-1")?.src === "rules", "nguồn nhãn đúng", JSON.stringify(tag("manual-crypto-note")));

console.log("7. Gắn tên mục: cả thư viện vào nút đó");
r = await me("PATCH", `/api/plugins/${PID}`, { studio: "design" });
ok(r.j.plugin.studio === "design" && r.j.plugin.studioMode === "design", "lưu đúng mục", JSON.stringify(r.j.plugin.studioMode));
r = await me("GET", "/api/plugins?view=meta");
ok(r.j.studios.design?.skills >= SLIDES + DOCS + OTHER + 2 && !r.j.studios.slides?.auto?.some((a) => a.name === "zebra-keynote-deck"), "cả thư viện ở Thiết kế, không còn tự thêm sang mục khác", JSON.stringify(r.j.studios.design).slice(0, 200));
r = await me("PATCH", `/api/plugins/${PID}`, { studio: "khong-co" });
ok(r.s === 200 && r.j.plugin.studio === "design", "giá trị lạ không đổi gì", JSON.stringify(r.j?.plugin?.studio));
r = await me("PATCH", `/api/plugins/${PID}`, { studio: null });
ok(r.j.plugin.studioMode === "auto" && r.j.plugin.studio === null, "null (bản cũ của trang) là Tự động nhận diện", JSON.stringify(r.j.plugin.studioMode));

console.log("8. Quyền giữ nguyên");
r = await other("PATCH", `/api/plugins/${PID}`, { studio: "none" });
ok(r.s === 403 || r.s === 404, `người khác không đổi được plugin riêng (${r.s})`);
await admin("GET", "/api/plugins");
r = await other("PATCH", `/api/plugins/${ORG}`, { studio: "none" });
ok(r.s === 403, `thành viên không đổi được plugin của tổ chức (${r.s})`, JSON.stringify(r.j));

await me("DELETE", `/api/plugins/${PID}`); await admin("DELETE", `/api/plugins/${ORG}`);
wipe();
r = await me("GET", "/api/plugins?view=meta");
ok(!r.j.studios.slides?.auto?.some((a) => a.name === "zebra-keynote-deck"), "gỡ thư viện: skill ra khỏi mục");
db.close();
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
