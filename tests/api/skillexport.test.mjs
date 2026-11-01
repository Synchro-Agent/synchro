// Kho kỹ năng: xuất skill / thư viện thành .zip không mất thông tin (npm run dev:mock, GitHub giả lập ở 127.0.0.1:4013).
// Skill lẻ thêm từ link repo: thư mục skill đúng từng byte (cả tệp nhị phân), mọi phiên bản cũ, link repo, bật / tắt, dự án,
// mục Artifacts, SHA-256 từng tệp, README theo ngôn ngữ; tải tệp xuất lên lại thì được đúng skill đó, không cảnh báo thừa.
// Thư viện: mọi skill, nguồn + commit, giấy phép, rủi ro, tùy chọn; thư viện riêng của người khác thì không xuất được.
import { createRequire } from "node:module";
import crypto from "node:crypto";
const JSZip = createRequire(process.cwd() + "/package.json")("jszip");
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const GH = process.env.MOCK_GH ?? "http://127.0.0.1:4013";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.upload = async (name, buf) => {
    const fd = new FormData(); fd.append("file", new File([buf], name));
    const r = await fetch(B + "/api/skills", { method: "POST", headers: { origin: B, cookie }, body: fd });
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  f.jar = () => cookie;
  f.raw = async (p) => {
    const r = await fetch(B + p, { headers: { origin: B, cookie } });
    return { s: r.status, type: r.headers.get("content-type") ?? "", disp: r.headers.get("content-disposition") ?? "", buf: Buffer.from(await r.arrayBuffer()) };
  };
  return f;
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const users = {};
for (const k of ["a", "b"]) {
  const c = client(), email = `exp-${k}@synchro.test`;
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: `Exp ${k.toUpperCase()}`, birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
  const row = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  await admin("PATCH", `/api/admin/users/${row.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(row.perms.features).map((f) => [f, true])) } });
  users[k] = c;
}
const { a: memA, b: memB } = users;
// Bắt đầu sạch.
for (const who of [memA, memB]) {
  await who("DELETE", "/api/skills/exp-one");
  for (const x of (await who("GET", "/api/plugins")).j?.plugins ?? []) if (x.scope === "personal") await who("DELETE", `/api/plugins/${x.id}`);
}
const repo = (name, files) => fetch(`${GH}/_mock/repo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: name, files }) });
const files = (z, prefix) => Object.values(z.files).filter((f) => !f.dir && f.name.startsWith(prefix)).map((f) => f.name.slice(prefix.length)).sort();

const MD1 = "---\nname: exp-one\ndescription: Lập báo cáo tuần từ bảng số liệu bán hàng, có biểu đồ và nhận xét.\n---\n# Báo cáo tuần\n\nĐọc references/guide.md rồi chạy scripts/run.py.\n";
const REPO1 = { "SKILL.md": MD1, "scripts/run.py": "print('báo cáo')\n", "references/guide.md": "# Hướng dẫn\n\nCột A là ngày.\n", "LICENSE": "MIT License\n\nCopyright (c) Mock Dev\n" };
await repo("mock-dev/exp-one", REPO1);

console.log("1. Skill thêm từ link repo, rồi tải lên phiên bản 2 có tệp nhị phân");
const add = await memA("POST", "/api/skills/import", { url: "https://github.com/mock-dev/exp-one", dry: false });
ok(add.s === 200 && add.j?.skill?.name === "exp-one" && add.j.skill.source === "github.com/mock-dev/exp-one", "thêm từ link, lưu link nguồn", add.j);
const PNG = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const MD2 = MD1.replace("# Báo cáo tuần", "# Báo cáo tuần (v2)");
const z2 = new JSZip();
z2.file("exp-one/SKILL.md", MD2); z2.file("exp-one/scripts/run.py", "print('báo cáo v2')\n"); z2.file("exp-one/assets/logo.png", PNG); z2.file("exp-one/references/guide.md", REPO1["references/guide.md"]);
const up = await memA.upload("exp-one.zip", await z2.generateAsync({ type: "nodebuffer" }));
ok(up.s === 200 && up.j?.skill?.version === 2 && up.j.skill.source === "github.com/mock-dev/exp-one", "phiên bản 2, vẫn giữ link nguồn", up.j);
await memA("PATCH", "/api/skills/exp-one", { project: "p-exp", enabled: true });
await memA("PATCH", "/api/skills/exp-one", { studios: ["docs"] });
await memA("PATCH", "/api/skills/exp-one", { enabled: false });

console.log("2. Xuất skill");
const ex = await memA.raw("/api/skills/exp-one/export");
ok(ex.s === 200 && /application\/zip/.test(ex.type) && /filename\*=UTF-8''exp-one\.zip/.test(ex.disp), "tải về exp-one.zip", { s: ex.s, type: ex.type, disp: ex.disp });
const z = await JSZip.loadAsync(ex.buf);
ok(JSON.stringify(files(z, "exp-one/")) === JSON.stringify(["SKILL.md", "assets/logo.png", "references/guide.md", "scripts/run.py"]), "thư mục skill đủ tệp của bản đang dùng", files(z, "exp-one/"));
ok((await z.file("exp-one/SKILL.md").async("string")) === MD2, "SKILL.md đúng từng chữ");
ok(Buffer.compare(await z.file("exp-one/assets/logo.png").async("nodebuffer"), PNG) === 0, "tệp nhị phân đúng từng byte");
const meta = JSON.parse(await z.file("_synchro/skill.json").async("string"));
ok(meta.format === "synchro-skill-export" && meta.skill.name === "exp-one" && meta.skill.currentVersion === 2 && JSON.stringify(meta.skill.versions) === "[1,2]", "thông tin skill và các phiên bản", meta.skill);
ok(meta.source?.key === "github.com/mock-dev/exp-one" && meta.source.url === "https://github.com/mock-dev/exp-one" && meta.source.owner === "mock-dev" && meta.source.repo === "exp-one", "link repo nguồn", meta.source);
ok(meta.skill.enabled === false && JSON.stringify(meta.skill.enabledInProjects) === '["p-exp"]', "bật / tắt và dự án", meta.skill);
ok(meta.skill.artifactsSections?.src === "manual" && JSON.stringify(meta.skill.artifactsSections.studios) === '["docs"]', "mục Artifacts tự chọn", meta.skill.artifactsSections);
const shaOk = await Promise.all(meta.skill.files.map(async (f) => sha(await z.file(`exp-one/${f.path}`).async("nodebuffer")) === f.sha256));
ok(meta.skill.files.length === 4 && shaOk.every(Boolean), "SHA-256 khớp mọi tệp", meta.skill.files);
ok(meta.skill.files.find((f) => f.path === "scripts/run.py")?.kind === "script" && meta.skill.files.find((f) => f.path === "assets/logo.png")?.mimeType === "image/png", "loại tệp và kiểu MIME", meta.skill.files);
const v1 = meta.versions.find((v) => v.version === 1);
ok(v1 && v1.archive === "_synchro/versions/v1.zip" && meta.versions.find((v) => v.version === 2)?.current, "phiên bản 1 lưu riêng, phiên bản 2 là bản đang dùng", meta.versions);
const zv1 = await JSZip.loadAsync(await z.file("_synchro/versions/v1.zip").async("nodebuffer"));
const v1files = files(zv1, "exp-one/");
ok(JSON.stringify(v1files) === JSON.stringify(Object.keys(REPO1).sort()), "phiên bản 1 đủ tệp lấy từ repo (cả LICENSE)", v1files);
ok((await zv1.file("exp-one/SKILL.md").async("string")) === MD1 && (await zv1.file("exp-one/LICENSE").async("string")) === REPO1.LICENSE, "nội dung phiên bản 1 đúng như trong repo");
const SKILL_MD_COUNT = Object.values(z.files).filter((f) => f.name.endsWith("SKILL.md")).length;
ok(SKILL_MD_COUNT === 1, "chỉ một SKILL.md ở ngoài (phiên bản cũ nằm trong .zip riêng)", SKILL_MD_COUNT);
const readme = await z.file("_synchro/README.md").async("string");
ok(/Skill xuất từ Synchro/.test(readme) && /https:\/\/github\.com\/mock-dev\/exp-one/.test(readme) && /_synchro\/versions/.test(readme), "README tiếng Việt có link repo và phiên bản cũ", readme);
const en = await memA.raw("/api/skills/exp-one/export?lang=en");
const ren = await (await JSZip.loadAsync(en.buf)).file("_synchro/README.md").async("string");
ok(/Skill exported from Synchro/.test(ren), "README tiếng Anh khi giao diện tiếng Anh", ren.slice(0, 200));

console.log("3. Tải tệp xuất lên lại (tài khoản khác)");
const back = await memB.upload("exp-one.zip", ex.buf);
ok(back.s === 200 && back.j?.created && back.j.skill?.name === "exp-one" && back.j.skill.fileCount === 3, "thêm lại được đúng skill", back.j);
ok(!(back.j?.warnings ?? []).some((w) => /Bỏ qua/.test(w)), "không cảnh báo bỏ qua tệp (_synchro/ là thông tin xuất)", back.j?.warnings);
const ex2 = await JSZip.loadAsync((await memB.raw("/api/skills/exp-one/export")).buf);
ok(Buffer.compare(await ex2.file("exp-one/assets/logo.png").async("nodebuffer"), PNG) === 0 && (await ex2.file("exp-one/SKILL.md").async("string")) === MD2, "skill thêm lại giống hệt bản gốc");

console.log("4. Xuất thư viện cài từ repo");
await repo("mock-dev/exp-lib", {
  "skills/alpha/SKILL.md": "---\nname: exp-alpha\ndescription: Soạn thư mời họp ngắn gọn, có giờ và địa điểm.\n---\n# Alpha\n\nViết thư mời.\n",
  "skills/alpha/templates/invite.md": "Kính mời {ten}\n",
  "skills/beta/SKILL.md": "---\nname: exp-beta\ndescription: Tóm tắt biên bản họp thành việc cần làm có người phụ trách.\n---\n# Beta\n\nTóm tắt.\n",
  "skills/beta/scripts/sum.py": "import sys\nprint(sys.argv)\n",
  "LICENSE": "MIT License\n\nCopyright (c) Mock Dev\n",
});
const ins = await memA("POST", "/api/plugins", { action: "install", url: "https://github.com/mock-dev/exp-lib", scope: "personal" });
const pl = ins.j?.plugin;
ok(ins.s === 200 && pl?.skills?.length === 2, "cài thư viện 2 skill", ins.j);
await memA("PATCH", `/api/plugins/${pl.id}`, { skills: { "exp-beta": false } });
const lx = await memA.raw(`/api/plugins/${pl.id}/export`);
ok(lx.s === 200 && /filename\*=UTF-8''exp-lib\.zip/.test(lx.disp), "tải về exp-lib.zip", { s: lx.s, disp: lx.disp });
const lz = await JSZip.loadAsync(lx.buf);
ok(JSON.stringify(files(lz, "exp-lib/skills/")) === JSON.stringify(["exp-alpha/SKILL.md", "exp-alpha/templates/invite.md", "exp-beta/SKILL.md", "exp-beta/scripts/sum.py"]), "mọi skill, mọi tệp", files(lz, "exp-lib/skills/"));
const lm = JSON.parse(await lz.file("_synchro/library.json").async("string"));
ok(lm.format === "synchro-library-export" && lm.library.name === pl.name && lm.library.scope === "personal" && lm.library.createdAt, "thông tin thư viện", lm.library);
ok(lm.sources[0]?.repo === "mock-dev/exp-lib" && JSON.stringify(lm.commits) === JSON.stringify(pl.commits) && lm.sources[0].commit === pl.commits["mock-dev/exp-lib"], "nguồn và commit đã cài", { sources: lm.sources, commits: lm.commits });
const beta = lm.skills.find((s) => s.name === "exp-beta");
ok(beta?.enabled === false && lm.skills.find((s) => s.name === "exp-alpha")?.enabled === true, "bật / tắt từng skill", lm.skills.map((s) => [s.name, s.enabled]));
ok(beta?.report?.license && beta.report.dir === "skills/beta" && beta.origin.repo === "mock-dev/exp-lib" && beta.origin.folderInRepo === "skills/beta" && beta.report.scripts === 1, "giấy phép, thư mục gốc trong repo, script", beta);
const lsha = await Promise.all(lm.skills.flatMap((s) => s.files.map(async (f) => sha(await lz.file(`${s.folder}${f.path}`).async("nodebuffer")) === f.sha256)));
ok(lsha.length === 4 && lsha.every(Boolean), "SHA-256 khớp mọi tệp của thư viện", lsha);
ok(/Thư viện skill xuất từ Synchro/.test(await lz.file("_synchro/README.md").async("string")), "README của thư viện");

console.log("5. Skill thêm vào thư viện từ file zip: còn nguyên tệp sau khi thư viện cập nhật, và có trong tệp xuất");
{
  const zu = new JSZip();
  zu.file("exp-gamma/SKILL.md", "---\nname: exp-gamma\ndescription: Đặt tên tệp báo cáo theo quy ước ngày-tháng-năm của phòng.\n---\n# Gamma\n\nĐặt tên.\n");
  zu.file("exp-gamma/assets/mark.png", PNG);
  const fd = new FormData(); fd.append("file", new File([await zu.generateAsync({ type: "nodebuffer" })], "exp-gamma.zip"));
  const r = await fetch(`${B}/api/plugins/${pl.id}`, { method: "POST", headers: { origin: B, cookie: memA.jar() }, body: fd });
  const j = await r.json().catch(() => null);
  ok(r.status === 200 && j?.added?.includes("exp-gamma"), "thêm skill từ file zip vào thư viện", j);
  await repo("mock-dev/exp-lib", { "skills/alpha/SKILL.md": "---\nname: exp-alpha\ndescription: Soạn thư mời họp ngắn gọn, có giờ và địa điểm.\n---\n# Alpha\n\nViết thư mời (bản mới).\n", "skills/beta/SKILL.md": "---\nname: exp-beta\ndescription: Tóm tắt biên bản họp thành việc cần làm có người phụ trách.\n---\n# Beta\n\nTóm tắt.\n", "LICENSE": "MIT License\n" });
  const upd = await memA("POST", `/api/plugins/${pl.id}`, { action: "update" });
  ok(upd.s === 200 && upd.j?.plugin?.skills?.some((x) => x.name === "exp-gamma"), "cập nhật thư viện từ repo, skill tải lên vẫn còn trong danh sách", upd.j);
  const gz = await JSZip.loadAsync((await memA.raw(`/api/plugins/${pl.id}/export`)).buf);
  const gm = JSON.parse(await gz.file("_synchro/library.json").async("string")).skills.find((x) => x.name === "exp-gamma");
  const png = gz.file("exp-lib/skills/exp-gamma/assets/mark.png");
  ok(gm && gm.origin?.uploaded && !gm.skillMdRebuilt && !gm.missingOnServer && png && Buffer.compare(await png.async("nodebuffer"), PNG) === 0, "tệp của skill tải lên còn nguyên sau khi cập nhật (trước đây bị xóa khỏi đĩa)", gm);
  ok(/Viết thư mời \(bản mới\)/.test(await gz.file("exp-lib/skills/exp-alpha/SKILL.md").async("string")), "skill từ repo là bản mới sau khi cập nhật");
}

console.log("6. Skill mất tệp trên máy chủ (dữ liệu cũ): vẫn xuất được, ghi rõ phần thiếu");
{
  const me = (await memB("GET", "/api/auth/me")).j?.user?.id;
  const sk = (await memB("GET", "/api/skills/exp-one")).j?.skill;
  const fs = await import("node:fs");
  const dir = `${process.cwd()}/data-mock/skills/${me}/${sk?.id}/v${sk?.version}`;
  ok(!!me && !!sk && fs.existsSync(dir), "tìm thấy thư mục skill (dữ liệu giả lập)", dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const mx = await memB.raw("/api/skills/exp-one/export");
  ok(mx.s === 200, "vẫn tải về được", mx.s);
  const mz = await JSZip.loadAsync(mx.buf);
  const mm = JSON.parse(await mz.file("_synchro/skill.json").async("string"));
  const md = await mz.file("exp-one/SKILL.md").async("string");
  ok(mm.skill.skillMdRebuilt === true && JSON.stringify(mm.skill.missingOnServer) === JSON.stringify(["assets/logo.png", "references/guide.md", "scripts/run.py"]), "ghi rõ tệp không còn", mm.skill);
  ok(/^---\nname: exp-one\ndescription: "Lập báo cáo tuần/.test(md) && /# Báo cáo tuần \(v2\)/.test(md), "SKILL.md dựng lại từ tên, mô tả và nội dung còn giữ", md);
  ok(/Lưu ý: exp-one thiếu tệp/.test(await mz.file("_synchro/README.md").async("string")), "README có lưu ý");
}

console.log("7. Quyền và lỗi");
ok((await memB.raw(`/api/plugins/${pl.id}/export`)).s === 404, "thư viện riêng của người khác: không xuất được");
const org = (await memB("GET", "/api/plugins")).j?.plugins?.find((x) => x.scope === "org");
if (org) { const ox = await memB.raw(`/api/plugins/${org.id}/export`); ok(ox.s === 200 && /application\/zip/.test(ox.type), `thư viện cho mọi người (${org.name}): ai cũng xuất được`, ox.s); }
ok((await memB.raw("/api/skills/khong-co/export")).s === 404, "skill không có: 404");
ok((await client().raw("/api/skills/exp-one/export")).s === 401, "chưa đăng nhập: 401");
ok((await client().raw(`/api/plugins/${pl.id}/export`)).s === 401, "chưa đăng nhập (thư viện): 401");

// Dọn dẹp.
for (const who of [memA, memB]) { await who("DELETE", "/api/skills/exp-one"); for (const x of (await who("GET", "/api/plugins")).j?.plugins ?? []) if (x.scope === "personal") await who("DELETE", `/api/plugins/${x.id}`); }
// Dòng kết quả theo đúng mẫu run-all.mjs đọc ("N/M đạt"); trước đây "skillexport: 44/44" nên bị tính là lỗi dù đạt hết.
console.log(`\nskillexport: ${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
