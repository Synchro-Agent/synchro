// Mỗi người tự bỏ hay thêm skill ở một mục của trang Artifacts, không ảnh hưởng người khác. Chạy với dev:mock.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const name = `bao-cao-thu-${Date.now()}`;
const fd = new FormData();
fd.append("file", new File([`---\nname: ${name}\ndescription: Write a report as a Word document (.docx) for the board\n---\n\nViết báo cáo.\n`], "SKILL.md"));
const mk = await fetch(B + "/api/skills", { method: "POST", headers: { origin: B, cookie }, body: fd });
ok(mk.status === 200, "tạo skill", mk.status);
const list = async (q = name) => (await api("GET", `/api/plugins?view=studio&studio=docs&q=${encodeURIComponent(q)}`)).j;
await api("PATCH", `/api/skills/${encodeURIComponent(name)}`, { studios: ["docs"] });
ok((await list()).skills?.some((s) => s.name === name), "skill có trong mục Tài liệu", await list());
ok((await api("POST", "/api/plugins/studio", { studio: "docs", name, on: false })).s === 200, "bỏ khỏi mục");
ok(!(await list()).skills?.some((s) => s.name === name), "không còn trong mục");
ok((await api("POST", "/api/plugins/studio", { studio: "docs", name, on: null })).s === 200, "hoàn tác");
ok((await list()).skills?.some((s) => s.name === name), "quay lại như Synchro tự xếp");
ok((await api("POST", "/api/plugins/studio", { studio: "khong-co", name, on: true })).s === 400, "mục sai: 400");
ok((await api("POST", "/api/plugins/studio", { studio: "docs", name, on: "x" })).s === 400, "giá trị sai: 400");
ok((await api("POST", "/api/plugins/studio", { studio: "docs", name: `khong-co-${Date.now()}`, on: true })).s === 200 && Array.isArray((await list("")).skills), "thêm tên không còn tồn tại: không làm hỏng danh sách");
await api("DELETE", `/api/skills/${encodeURIComponent(name)}`);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
