// Kiểm tra Plugins: cài bộ skill từ GitHub, giấy phép, rủi ro, phạm vi tổ chức / cá nhân, studio trong chat, cập nhật, gỡ.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  return f;
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await member("POST", "/api/auth/signup", { email: "plugin-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Plugin Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "plugin-member@synchro.test", password: "Member-pass-123" });
// Tài khoản test có quyền riêng (mọi model, mọi tính năng) để không phụ thuộc quyền mặc định quản trị viên đặt cho thành viên.
async function fullPerms(email) {
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  if (u) await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
await fullPerms("plugin-member@synchro.test");

// Tài khoản test chạy nhiều lần sẽ chạm hạn mức dùng của chính nó: xóa mức dùng cũ trước mỗi lần chạy.
{ const { createRequire } = await import("node:module"); const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run("plugin-member@synchro.test"); db.close(); }
for (const p of (await member("GET", "/api/plugins")).j.plugins.filter((p) => p.scope === "personal")) await member("DELETE", `/api/plugins/${p.id}`);

console.log("1. Ba studio cài sẵn cho cả tổ chức");
let r = await admin("GET", "/api/plugins");
const byStudio = (s) => r.j.plugins.find((p) => p.studio === s);
const ds = byStudio("design");
ok(ds && ds.scope === "org" && ds.skills.length >= 25, `Design Studio: ${ds?.skills.length} skill`, JSON.stringify(r.j.plugins.map((p) => [p.name, p.skills.length])));
ok(byStudio("slides")?.skills.length >= 5 && byStudio("docs")?.skills.length >= 4, `Slides ${byStudio("slides")?.skills.length} skill, Docs ${byStudio("docs")?.skills.length} skill`);
// Danh sách thư viện chỉ có tên skill (nhẹ); giấy phép, số tệp… ở chi tiết GET /api/plugins/[id].
const dsFull = (await admin("GET", `/api/plugins/${ds.id}`)).j.plugin;
ok(dsFull.skills.every((s) => s.report.licenseKind === "open" || s.report.repo === "upload"), "mọi skill có giấy phép mở", JSON.stringify(dsFull.skills.filter((s) => s.report.licenseKind !== "open").map((s) => [s.name, s.report.license])));
ok(dsFull.skills.some((s) => s.name === "awesome-design-html" && s.report.files > 100), "skill nhiều file (118 mẫu HTML) cài được", JSON.stringify(dsFull.skills.find((s) => s.name === "awesome-design-html")?.report));
// Skill Vox chỉ được cài khi máy có ~/Downloads/Vox Animations.zip (dev:mock tự thêm lúc khởi tạo).
if ((await import("node:fs")).existsSync(`${process.env.HOME}/Downloads/Vox Animations.zip`)) ok(ds.skills.some((s) => s.name === "vox-animation"), "đã thêm skill Vox Animation từ file zip vào Design Studio", ds.skills.map((s) => s.name).join(","));
ok(new Set(ds.skills.map((s) => s.name)).size === ds.skills.length, "không có skill trùng tên");

console.log("2. Xem trước: giấy phép và rủi ro");
r = await admin("POST", "/api/plugins", { action: "preview", catalogId: "anthropic-skills" });
const pv = r.j.preview;
const blocked = pv.skills.filter((s) => s.blocked).map((s) => s.name);
ok(["docx", "pdf", "pptx", "xlsx"].every((n) => blocked.includes(n)), `skill độc quyền của Anthropic bị chặn: ${blocked.join(", ")}`, JSON.stringify(pv.skills.map((s) => [s.name, s.licenseKind, s.blocked])));
ok(pv.skills.find((s) => s.name === "webapp-testing")?.licenseKind === "open" && !pv.skills.find((s) => s.name === "webapp-testing").blocked, "skill Apache-2.0 vẫn cài được");
ok(pv.skills.some((s) => s.risk !== "none" && s.scripts > 0), "báo rủi ro cho skill có script", JSON.stringify(pv.skills.map((s) => [s.name, s.risk, s.flags])));
r = await admin("POST", "/api/plugins", { action: "preview", url: "https://gitlab.com/a/b" });
ok(r.s === 400, "chỉ nhận link GitHub", JSON.stringify(r.j));
r = await admin("POST", "/api/plugins", { action: "preview", url: "https://github.com/nonexistent-owner-xyz123/nothing-here" });
ok(r.s === 404, "repo không tồn tại: báo rõ", JSON.stringify(r.j));

console.log("3. Plugin cá nhân và quyền");
r = await member("POST", "/api/plugins", { action: "install", url: "https://github.com/emilkowalski/skills", scope: "org" });
ok(r.s === 403, "người thường không cài được cho cả tổ chức");
// Repo thật trên GitHub (số skill đổi theo tác giả): đếm từ bản xem trước rồi trừ skill đã bỏ chọn.
const total = (await member("POST", "/api/plugins", { action: "preview", url: "https://github.com/emilkowalski/skills" })).j?.preview?.skills?.filter((s) => !s.blocked).length ?? 0;
r = await member("POST", "/api/plugins", { action: "install", url: "https://github.com/emilkowalski/skills", scope: "personal", skip: ["write-swift"] });
const mine = r.j?.plugin;
ok(r.s === 200 && mine.scope === "personal" && total > 1 && mine.skills.length === total - 1 && !mine.skills.some((s) => s.name === "write-swift"), `cài từ link GitHub: ${mine?.skills.length}/${total} skill, bỏ skill đã bỏ chọn`, JSON.stringify(r.j).slice(0, 300));
r = await member("GET", "/api/plugins");
ok(r.j.plugins.some((p) => p.id === mine.id) && r.j.plugins.some((p) => p.studio === "design"), "người thường thấy plugin của tổ chức và của mình");
r = await admin("GET", "/api/plugins");
ok(!r.j.plugins.some((p) => p.id === mine.id), "plugin cá nhân không lộ sang tài khoản khác");
r = await member("PATCH", `/api/plugins/${ds.id}`, { studio: null });
ok(r.s === 403, "người thường không đổi được plugin của tổ chức");
r = await member("PATCH", `/api/plugins/${ds.id}`, { mine: { enabled: false } });
ok(r.s === 200 && r.j.plugin.mine.enabled === false && r.j.plugin.enabled === true, "người thường tắt plugin tổ chức cho riêng mình");

console.log("4. Studio trong chat");
const studioChat = (c, studio, text) => c("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model: "anthropic/claude-opus-5-5", skills: true, studio });
r = await studioChat(member, "design", "Làm trang web cho quán cà phê");
// Skill thiết kế của plugin Emil (cá nhân, không gắn studio) được Synchro tự xếp vào Thiết kế (skillstudio.ts): tắt Design Studio thì thư viện
// Thiết kế chỉ còn những skill đó.
const offSk = (r.j?.skills ?? []).filter((u) => u.kind === "skill").map((u) => u.name);
ok(offSk.length > 0 && offSk.every((n) => mine.skills.some((s) => s.name === n)), `đã tắt Design Studio: thư viện Thiết kế chỉ còn skill tự thêm từ plugin của bạn (${offSk.join(", ")})`, (r.j?.text ?? "").slice(0, 200));
await member("PATCH", `/api/plugins/${ds.id}`, { mine: { enabled: true } });
r = await studioChat(member, "design", "Làm trang web cho quán cà phê");
const usedSk = (r.j?.skills ?? []).filter((u) => u.kind === "skill").map((u) => u.name);
ok(usedSk.length === 2 && /<artifact identifier="landing-cafe"/.test(r.j.text), `bấm Thiết kế: model tự đọc ${usedSk.join(", ")} rồi làm artifact`, JSON.stringify(r.j).slice(0, 400));
ok(r.j.libs?.length === 1 && r.j.libs[0].key === "studio-design" && r.j.libs[0].forced && r.j.libs[0].label === "Thiết kế" && r.j.libs[0].skills.join() === usedSk.join(), "chip: Chế độ Thiết kế kèm skill đã đọc", JSON.stringify(r.j.libs));
r = await studioChat(member, "slides", "Báo cáo quý");
ok(/type="text\/html" title="Báo cáo quý III"/.test(r.j?.text ?? "") && r.j.skills.some((u) => u.name === "slides"), "Trình bày: đọc skill slides, làm bản trình chiếu HTML", (r.j?.text ?? "").slice(0, 200));
ok(r.j.libs?.[0]?.key === "studio-slides" && r.j.libs[0].skills.includes("theme-factory"), "skill có ở nhiều thư viện (theme-factory) được gán vào thư viện đang dùng", JSON.stringify(r.j.libs));
r = await studioChat(member, "docs", "Viết đề xuất");
ok(/type="text\/markdown"/.test(r.j?.text ?? ""), "Tài liệu: làm tài liệu Markdown", (r.j?.text ?? "").slice(0, 200));
r = await admin("GET", "/api/plugins");
ok(r.j.plugins.find((p) => p.studio === "design").skills.some((s) => s.useCount > 0), "đếm số lần dùng từng skill của plugin");
const plain = (text, extra = {}) => member("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model: "anthropic/claude-opus-5-5", skills: true, ...extra });
const read = (r) => (r.j?.skills ?? []).filter((u) => u.kind === "skill").map((u) => u.name);
console.log("4b. Chỉ nhắn yêu cầu: model tự nhận diện và chọn skill");
r = await plain("Làm trang web cho quán cà phê");
let names = read(r);
const cafe = names;
ok(names.length === 2 && !names.some((n) => /^(studio|lib)-/.test(n)) && /landing-cafe/.test(r.j.text), `trang web: đọc thẳng ${names.join(", ")} (không cần mở thư viện trước)`, JSON.stringify(r.j).slice(0, 300));
ok(r.j.libs?.length === 1 && !r.j.libs[0].forced && r.j.libs[0].key === "studio-design" && r.j.libs[0].skills.join() === names.join(), "chip: Thư viện Thiết kế kèm 2 skill đã đọc", JSON.stringify(r.j.libs));
r = await plain("Làm slide thuyết trình về Synchro");
ok(read(r).includes("slides") && r.j.libs?.[0]?.key === "studio-slides" && /Báo cáo quý III/.test(r.j.text), `slide: ${read(r).join(", ")} → bản trình chiếu`, JSON.stringify(r.j).slice(0, 300));
r = await plain("Viết đề xuất dự án chăm sóc khách hàng");
ok(r.j.libs?.[0]?.key === "studio-docs" && /type="text\/markdown"/.test(r.j.text), `đề xuất: ${read(r).join(", ")} (thư viện ${r.j.libs?.[0]?.label})`, JSON.stringify(r.j).slice(0, 300));
r = await plain("Thêm hiệu ứng chuyển động mượt cho menu");
names = read(r);
ok(names.length >= 1 && names.every((n) => ds.skills.some((s) => s.name === n)) && /cubic-bezier/.test(r.j.text), `không có từ "thiết kế" vẫn nhận ra: ${names.join(", ")}`, JSON.stringify(r.j).slice(0, 300));
for (const q of ["Xin chào, hôm nay thế nào?", "Thủ đô của Pháp là gì?", "Tính 15% của 2 triệu"]) {
  r = await plain(q);
  ok(!read(r).length && !r.j.libs?.length, `"${q}": không dùng skill`, JSON.stringify([read(r), r.j.libs]));
}
r = await member("POST", "/api/llm", { system: "", model: "anthropic/claude-opus-5-5", skills: true, recentSkills: cafe,
  messages: [{ role: "user", content: "Làm trang web cho quán cà phê" }, { role: "assistant", content: "Đây là trang giới thiệu Lumen Coffee." }, { role: "user", content: "Đổi sang tông màu xanh lá" }] });
ok(read(r).join() === cafe.join() && r.j.libs?.[0]?.key === "studio-design", `lượt tiếp nối: đọc lại ${read(r).join(", ")} để giữ nhất quán`, JSON.stringify(r.j).slice(0, 300));
r = await member("POST", "/api/plugins", { action: "install", catalogId: "vercel-agent-skills", scope: "personal" });
const vc = r.j?.plugin;
r = await plain("Tối ưu hiệu năng React cho trang Next.js");
names = read(r);
ok(vc && names.some((n) => vc.skills.some((s) => s.name === n)) && r.j.libs?.some((l) => l.label === vc.name), `plugin không gắn studio cũng tự dùng: ${names.join(", ")} (${r.j.libs?.map((l) => l.label).join(", ")})`, JSON.stringify(r.j).slice(0, 400));
if (vc) await member("DELETE", `/api/plugins/${vc.id}`);

console.log("5. Cập nhật và gỡ");
r = await member("POST", `/api/plugins/${mine.id}`, { action: "check" });
ok(r.s === 200 && Array.isArray(r.j.changed) && r.j.changed.length === 0, "kiểm tra cập nhật: đang là bản mới nhất", JSON.stringify(r.j).slice(0, 200));
r = await member("PATCH", `/api/plugins/${mine.id}`, { skills: { animate: false }, everywhere: true });
ok(r.j.plugin.skills.find((s) => s.name === "animate").enabled === false && r.j.plugin.mine.everywhere, "tắt từng skill, bật dùng trong mọi cuộc trò chuyện");
// Xóa skill khỏi thư viện (Quét skill rác → Xóa): xóa hẳn, cập nhật lại từ repo không thêm lại; xóa hết thì gỡ cả thư viện.
r = await member("POST", `/api/plugins/${mine.id}`, { action: "remove-skills", names: ["animate"] });
ok(r.s === 200 && r.j.removed?.join() === "animate" && !r.j.uninstalled && !r.j.plugin.skills.some((s) => s.name === "animate") && r.j.plugin.skills.length === total - 2, "xóa một skill khỏi thư viện", JSON.stringify(r.j).slice(0, 300));
r = await member("POST", `/api/plugins/${mine.id}`, { action: "update" });
ok(r.s === 200 && !r.j.plugin.skills.some((s) => s.name === "animate") && r.j.plugin.skills.length === total - 2, "cập nhật lại từ repo: skill đã xóa không quay lại", JSON.stringify(r.j.plugin?.skills?.map((s) => s.name)));
r = await admin("POST", `/api/plugins/${mine.id}`, { action: "remove-skills", names: ["animate"] });
ok(r.s === 404, "tài khoản khác không xóa được skill trong thư viện của người này");
r = await member("POST", `/api/plugins/${ds.id}`, { action: "remove-skills", names: [ds.skills[0].name] });
ok(r.s === 403, "người thường không xóa được skill trong thư viện của tổ chức");
r = await member("POST", `/api/plugins/${mine.id}`, { action: "remove-skills", names: [] });
ok(r.s === 400, "không chọn skill nào → 400");
const rest = (await member("GET", "/api/plugins")).j.plugins.find((p) => p.id === mine.id).skills.map((s) => s.name);
r = await member("POST", `/api/plugins/${mine.id}`, { action: "remove-skills", names: rest });
ok(r.s === 200 && r.j.uninstalled === true && r.j.plugin === null && !r.j.plugins.some((p) => p.id === mine.id), "xóa hết skill: thư viện trống được gỡ luôn", JSON.stringify({ uninstalled: r.j.uninstalled, n: rest.length }));
r = await member("DELETE", `/api/plugins/${mine.id}`);
ok(r.s === 404, "thư viện đã gỡ thì không còn");
r = await member("DELETE", `/api/plugins/${ds.id}`);
ok(r.s === 403, "người thường không gỡ được plugin của tổ chức");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
