// Điểm chất lượng skill (👍 / 👎 dưới câu trả lời) và "lưu cách làm thành skill" (tải SKILL.md tạo từ lời dặn).
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const form = body instanceof FormData;
    const r = await fetch(B + p, { method, headers: { ...(form ? {} : { "content-type": "application/json" }), origin: B, cookie }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  return f;
}
// Web dùng cá nhân: mọi lượt chấm đều của chủ sở hữu (a và b chỉ là hai tên gọi cho cùng một phiên).
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const a = admin, b = admin;
const NAME = "fb-test-ngan-gon";
await a("DELETE", `/api/skills/${NAME}`);
const md = (body) => { const fd = new FormData(); fd.append("file", new Blob([`---\nname: ${NAME}\ndescription: ${JSON.stringify("Cách làm người dùng đã dặn: luôn trả lời ngắn gọn, có gạch đầu dòng. Áp dụng cho mọi câu trả lời có liên quan.")}\n---\n\n${body}\n`], { type: "text/markdown" }), "SKILL.md"); return fd; };

console.log("1. Lưu lời dặn thành skill (SKILL.md)");
let fd = md("# Trả lời ngắn gọn\n\n- Từ giờ luôn trả lời ngắn gọn, có gạch đầu dòng."); fd.append("dry", "1");
let r = await a("POST", "/api/skills", fd);
ok(r.s === 200 && r.j.preview?.exists === false && r.j.preview.name === NAME, "xem trước: skill mới, đúng tên", JSON.stringify(r.j));
r = await a("POST", "/api/skills", md("# Trả lời ngắn gọn\n\n- Từ giờ luôn trả lời ngắn gọn, có gạch đầu dòng."));
ok(r.s === 200 && r.j.created === true && r.j.skill.name === NAME, "lưu được skill", JSON.stringify(r.j));
fd = md("# Trả lời ngắn gọn\n\n- Luôn trả lời ngắn gọn.\n- Đừng mở đầu bằng lời chào."); fd.append("dry", "1");
r = await a("POST", "/api/skills", fd);
ok(r.j.preview?.exists === true && r.j.preview.version === 2, "trùng tên → báo đã có, lưu sẽ thành v2", JSON.stringify(r.j));
r = await a("POST", "/api/skills", md("# Trả lời ngắn gọn\n\n- Luôn trả lời ngắn gọn.\n- Đừng mở đầu bằng lời chào."));
ok(r.s === 200 && r.j.created === false && r.j.skill.version === 2, "lưu lần hai thành phiên bản mới", JSON.stringify(r.j));

console.log("2. Chấm điểm câu trả lời");
const score = async () => (await a("GET", "/api/feedback")).j.scores[NAME];
for (const [c, msg] of [[a, "t1:1"], [a, "t1:2"], [b, "t2:1"]]) await c("POST", "/api/feedback", { msg, skills: [NAME], value: 1 });
for (const [c, msg] of [[a, "t1:1"], [a, "t1:2"], [b, "t2:1"]]) await c("POST", "/api/feedback", { msg, skills: [NAME], value: -1 });
let s = await score();
ok(s?.up === 0 && s?.down === 3, "chấm lại cùng câu trả lời thì thay điểm cũ, không cộng dồn", JSON.stringify(s));
ok(s?.low === true, "3 lượt chê, không lượt khen → đánh dấu hay bị chê");
await a("POST", "/api/feedback", { msg: "t1:1", skills: [NAME], value: 1 });
s = await score();
ok(s.up === 1 && s.down === 2 && s.low === false, "1 khen 2 chê: chưa đủ 3 lượt chê nên chưa đánh dấu", JSON.stringify(s));
await b("POST", "/api/feedback", { msg: "t2:2", skills: [NAME], value: -1 });
s = await score();
ok(s.up === 1 && s.down === 3 && s.low === true, "1 khen 3 chê (75% chê) → đánh dấu", JSON.stringify(s));
await b("POST", "/api/feedback", { msg: "t2:2", skills: [NAME], value: 0 });
await a("POST", "/api/feedback", { msg: "t1:2", skills: [NAME], value: 0 });
s = await score();
ok(s.up === 1 && s.down === 1 && s.low === false, "bỏ chấm → điểm giảm, hết đánh dấu", JSON.stringify(s));
r = await a("POST", "/api/feedback", { msg: "t1:3", skills: ["tên có dấu cách", "<script>", NAME, NAME], value: 1 });
ok(r.j.n === 1, "bỏ tên skill không hợp lệ và tên trùng", JSON.stringify(r.j));
ok((await a("POST", "/api/feedback", { msg: "t1:4", skills: "x", value: 1 })).s === 400, "dữ liệu sai → 400");
ok((await fetch(`${B}/api/feedback`)).status === 401, "chưa đăng nhập → 401");
ok((await fetch(`${B}/api/feedback`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })).status >= 400, "khác nguồn gốc → bị chặn");

// Dọn: bỏ điểm và xóa skill test.
for (const [c, msg] of [[a, "t1:1"], [a, "t1:3"], [b, "t2:1"]]) await c("POST", "/api/feedback", { msg, skills: [NAME], value: 0 });
await a("DELETE", `/api/skills/${NAME}`);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
