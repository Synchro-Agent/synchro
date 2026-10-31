// Kiểm tra Synchro tự nhận diện skill thuộc Tài liệu / Trình bày / Thiết kế (ba mục tạo mới ở trang Artifacts) và tự thêm vào thư viện
// của mục đó: skill của người dùng (Kho kỹ năng) và skill của plugin không gắn studio; model xếp lại ở nền; người dùng tự chọn mục.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { ...(body instanceof FormData ? {} : { "content-type": "application/json" }), origin: B, cookie }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), me = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const EMAIL = "studio-member@synchro.test";
await me("POST", "/api/auth/signup", { email: EMAIL, password: "Member-pass-123", profile: { fullName: "Studio Member", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: EMAIL, password: "Member-pass-123" });
{ // Mọi model, mọi tính năng (không phụ thuộc quyền mặc định của thành viên).
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === EMAIL);
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
// Chạy lại từ đầu: bỏ skill và plugin riêng của lần chạy trước.
for (const s of (await me("GET", "/api/skills")).j?.skills ?? []) await me("DELETE", `/api/skills/${s.name}`);
for (const p of ((await me("GET", "/api/plugins")).j?.plugins ?? []).filter((p) => p.scope === "personal")) await me("DELETE", `/api/plugins/${p.id}`);

const md = (name, description, body) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n# ${name}\n\n${body}\n`;
const upload = async (name, description, body) => {
  const fd = new FormData();
  fd.append("file", new File([md(name, description, body)], "SKILL.md", { type: "text/markdown" }));
  return me("POST", "/api/skills", fd);
};
const studiosOf = async () => (await me("GET", "/api/plugins")).j?.studios ?? {};
const settle = async () => { for (let i = 0; i < 60; i++) { if (!(await me("GET", "/api/skills")).j?.refining) return; await sleep(500); } };
const tagOf = async (name) => (await me("GET", "/api/skills")).j.skills.find((s) => s.name === name)?.studio;
const same = (a, b) => [...(a ?? [])].sort().join() === [...b].sort().join();

console.log("1. Tạo skill: tự nhận diện ngay khi lưu");
const CASES = [
  ["bao-cao-tuan", "Viết báo cáo công việc tuần cho sếp theo mẫu của công ty: kết quả, chỉ số, vướng mắc, kế hoạch tuần tới.", "Soạn báo cáo ngắn gọn, có bảng số liệu.", ["docs"]],
  ["slide-ban-hang", "Làm bài thuyết trình bán hàng 10 trang chiếu cho khách hàng doanh nghiệp.", "Mỗi slide một ý, có ghi chú cho người trình bày.", ["slides"]],
  ["nhan-dien-thuong-hieu", "Thiết kế logo, bảng màu và phông chữ cho bộ nhận diện thương hiệu.", "Đưa ra 3 hướng thiết kế, mỗi hướng có mockup.", ["design"]],
  ["pitch-deck-dep", "Create a fundraising pitch deck with a polished visual design: layout, typography and color palette for every slide.", "Use a consistent design system across the deck.", ["slides", "design"]],
  ["toi-uu-sql", "Tối ưu câu truy vấn SQL chậm trên PostgreSQL: đọc EXPLAIN, thêm chỉ mục, viết lại truy vấn.", "Luôn đo thời gian trước và sau.", []],
];
for (const [name, desc, body, want] of CASES) {
  const r = await upload(name, desc, body);
  ok(r.s === 200 && same(r.j?.skill?.studio?.studios, want) && r.j.skill.studio.src === "rules", `${name} → ${want.join(", ") || "không thuộc mục nào"} (ngay khi lưu)`, JSON.stringify(r.j?.skill?.studio ?? r.j));
}

console.log("2. Model của người dùng xếp lại ở nền");
await settle();
for (const [name, , , want] of CASES) {
  const t = await tagOf(name);
  ok(t?.src === "model" && same(t.studios, want) && /\(mock\)/.test(t.why), `${name}: model xác nhận ${want.join(", ") || "không thuộc mục nào"}`, JSON.stringify(t));
}

console.log("3. Thêm vào thư viện của mục ở trang Artifacts");
let st = await studiosOf();
const autoNames = (k) => (st[k]?.auto ?? []).map((a) => a.name);
ok(autoNames("docs").includes("bao-cao-tuan") && st.docs.auto.find((a) => a.name === "bao-cao-tuan").from === "Kho kỹ năng của bạn", "Tài liệu: có bao-cao-tuan (từ Kho kỹ năng của bạn)", JSON.stringify(st.docs));
ok(autoNames("slides").includes("slide-ban-hang") && autoNames("slides").includes("pitch-deck-dep"), "Trình bày: có slide-ban-hang và pitch-deck-dep", JSON.stringify(st.slides?.auto));
ok(autoNames("design").includes("nhan-dien-thuong-hieu") && autoNames("design").includes("pitch-deck-dep"), "Thiết kế: có nhan-dien-thuong-hieu và pitch-deck-dep (một skill ở hai mục)", JSON.stringify(st.design?.auto));
ok(!["docs", "slides", "design"].some((k) => autoNames(k).includes("toi-uu-sql")), "toi-uu-sql không vào mục nào", JSON.stringify(st));
ok(/Kho kỹ năng của bạn/.test(st.design?.name ?? "") && st.design.skills >= 30, `số skill của Thiết kế gồm cả skill tự thêm (${st.design?.skills})`, JSON.stringify(st.design));

console.log("4. Trong chat: skill vừa tạo thuộc thư viện Tài liệu");
let r = await me("POST", "/api/llm", { system: "", messages: [{ role: "user", content: "Viết báo cáo công việc tuần cho sếp" }], model: "anthropic/claude-opus-5-5", skills: true });
const read = (r) => (r.j?.skills ?? []).filter((u) => u.kind === "skill").map((u) => u.name);
ok(read(r).includes("bao-cao-tuan") && r.j.libs?.[0]?.key === "studio-docs" && r.j.libs[0].skills.includes("bao-cao-tuan"), `Synchro tự chọn ${read(r).join(", ")}, chip ghi thư viện ${r.j.libs?.[0]?.label}`, JSON.stringify(r.j).slice(0, 400));

console.log("5. Tắt skill thì ra khỏi mục; tự chọn mục thì giữ nguyên");
await me("PATCH", "/api/skills/bao-cao-tuan", { enabled: false });
st = await studiosOf();
ok(!autoNames("docs").includes("bao-cao-tuan"), "tắt bao-cao-tuan: không còn ở Tài liệu", JSON.stringify(st.docs?.auto));
await me("PATCH", "/api/skills/bao-cao-tuan", { enabled: true });
r = await me("PATCH", "/api/skills/toi-uu-sql", { studios: ["docs"] });
ok(r.s === 200 && r.j.skill.studio.src === "manual" && same(r.j.skill.studio.studios, ["docs"]), "tự chọn: toi-uu-sql vào Tài liệu", JSON.stringify(r.j));
await upload("toi-uu-sql", "Tối ưu câu truy vấn SQL chậm trên PostgreSQL (bản 2).", "Thêm phần VACUUM.");
await settle();
let t = await tagOf("toi-uu-sql");
ok(t?.src === "manual" && same(t.studios, ["docs"]), "lưu phiên bản mới: vẫn giữ mục người dùng chọn", JSON.stringify(t));
r = await me("PATCH", "/api/skills/toi-uu-sql", { studios: null });
await settle();
t = await tagOf("toi-uu-sql");
ok(t && t.src !== "manual" && same(t.studios, []), "Để Synchro tự nhận diện: về lại không thuộc mục nào", JSON.stringify(t));
r = await me("PATCH", "/api/skills/toi-uu-sql", { studios: ["video"] });
ok(r.s === 400, "mục không hợp lệ bị từ chối", JSON.stringify(r.j));

console.log("6. Nội dung đổi thì nhận diện lại");
await upload("tro-ly-tuan", "Nhắc lịch họp và tổng hợp email quan trọng mỗi sáng.", "Chỉ đọc hộp thư, không gửi gì.");
await settle();
t = await tagOf("tro-ly-tuan");
ok(t && same(t.studios, []), "tro-ly-tuan v1 (nhắc lịch): không thuộc mục nào", JSON.stringify(t));
await upload("tro-ly-tuan", "Làm bài thuyết trình kết quả tuần 8 trang chiếu cho cả nhóm.", "Mỗi trang một ý chính.");
await settle();
t = await tagOf("tro-ly-tuan");
ok(t?.src === "model" && same(t.studios, ["slides"]), "tro-ly-tuan v2 (bài thuyết trình): nhận diện lại → Trình bày", JSON.stringify(t));

console.log("7. Skill của plugin không gắn studio cũng được tự thêm");
r = await me("POST", "/api/plugins", { action: "install", url: "https://github.com/anthropics/skills/tree/main/skills/brand-guidelines", scope: "personal" });
const pl = r.j?.plugin;
ok(pl && !pl.studio && pl.skills.some((s) => s.name === "brand-guidelines"), "cài plugin brand-guidelines (không gắn studio)", JSON.stringify(r.j).slice(0, 300));
await settle();
st = await studiosOf();
const a = st.design?.auto?.find((x) => x.name === "brand-guidelines");
ok(a && a.from === pl?.name, `Thiết kế: có brand-guidelines (từ ${a?.from})`, JSON.stringify(st.design?.auto));
if (pl) await me("DELETE", `/api/plugins/${pl.id}`);
st = await studiosOf();
ok(!st.design?.auto?.some((x) => x.name === "brand-guidelines"), "gỡ plugin: brand-guidelines ra khỏi Thiết kế", JSON.stringify(st.design?.auto));

console.log("8. Xóa skill thì ra khỏi mục");
await me("DELETE", "/api/skills/nhan-dien-thuong-hieu");
st = await studiosOf();
ok(!autoNames("design").includes("nhan-dien-thuong-hieu"), "xóa nhan-dien-thuong-hieu: không còn ở Thiết kế", JSON.stringify(st.design?.auto));

console.log("9. Danh mục studio mới (sau lượt rà các repo) đã vào plugin studio cài sẵn");
// Máy chủ cập nhật studio đã cài ngay sau khi khởi động (tải lại từ GitHub): chờ tối đa 3 phút.
let plugins = [];
const by = (s) => plugins.find((p) => p.studio === s && p.scope === "org");
for (let i = 0; i < 90; i++) { plugins = (await admin("GET", "/api/plugins")).j.plugins; if (by("docs")?.skills.some((s) => s.name === "doc-coauthoring")) break; await sleep(2000); }
ok(by("docs")?.skills.some((s) => s.name === "doc-coauthoring"), "Docs Studio có doc-coauthoring", JSON.stringify(by("docs")?.skills.map((s) => s.name)));
ok(["slack-gif-creator", "remove-animations"].every((n) => by("design")?.skills.some((s) => s.name === n)) && !by("design")?.skills.some((s) => s.name === "slides"), "Design Studio có slack-gif-creator, remove-animations (skill slides chỉ ở Trình bày)", JSON.stringify(by("design")?.skills.map((s) => s.name)));

for (const s of (await me("GET", "/api/skills")).j?.skills ?? []) await me("DELETE", `/api/skills/${s.name}`);
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
