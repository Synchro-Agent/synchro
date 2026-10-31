// Kho kỹ năng: không cho thêm skill trùng link (npm run dev:mock, GitHub giả lập ở 127.0.0.1:4013).
// Trùng là trùng nguyên link (cả repo, hoặc cùng một thư mục skill trong repo), bất kể cách viết (dấu "/" cuối, .git, /tree/<nhánh>,
// hoa thường, www, link tới SKILL.md). Quản trị viên: so với skill riêng của mình và Thư viện cho mọi người. Tài khoản thường: so với
// skill / thư viện của chính mình và Thư viện cho mọi người (skill riêng của quản trị viên không tính). Skill thêm trước khi Synchro lưu link:
// nội dung SKILL.md giống hệt thì cũng là trùng. Cả hai cửa thêm từ link (skill lẻ và cài thư viện) đều chặn.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const GH = process.env.MOCK_GH ?? "http://127.0.0.1:4013";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.upload = async (name, text) => {
    const fd = new FormData(); fd.append("file", new File([text], name));
    const r = await fetch(B + "/api/skills", { method: "POST", headers: { origin: B, cookie }, body: fd });
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  return f;
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const users = {};
for (const k of ["a", "b", "c"]) {
  const c = client(), email = `dup-${k}@synchro.test`;
  await c("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: `Dup ${k.toUpperCase()}`, birthDate: "2000-01-01" } });
  await c("POST", "/api/auth/login", { email, password: "Member-pass-123" });
  const row = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  await admin("PATCH", `/api/admin/users/${row.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(row.perms.features).map((f) => [f, true])) } });
  users[k] = c;
}
const { a: memA, b: memB, c: memC } = users;
// Bắt đầu sạch.
for (const who of [admin, memA, memB, memC]) for (const n of ["dup-one", "dup-two-a", "dup-two-b"]) await who("DELETE", `/api/skills/${n}`);
for (const x of (await admin("GET", "/api/plugins")).j?.plugins ?? []) if (x.scope === "org" && /dup-one/.test(x.slug)) await admin("DELETE", `/api/plugins/${x.id}`);

const repo = (name, files) => fetch(`${GH}/_mock/repo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: name, files }) });
const ONE = "---\nname: dup-one\ndescription: Viết lời chào ngắn cho khách hàng mới theo giọng thân thiện của công ty.\n---\n# Dup one\n\nChào khách bằng tên, một câu cảm ơn, một câu mời quay lại.\n";
await repo("mock-dev/dup-one", { "SKILL.md": ONE, "README.md": "# dup-one\n" });
await repo("mock-dev/dup-two", {
  "skills/a/SKILL.md": "---\nname: dup-two-a\ndescription: Tóm tắt biên bản họp thành ba ý chính và việc cần làm.\n---\n# A\n\nTóm tắt ngắn.\n",
  "skills/b/SKILL.md": "---\nname: dup-two-b\ndescription: Soạn email nhắc hạn thanh toán lịch sự.\n---\n# B\n\nNhắc nhẹ nhàng.\n",
});
const imp = (who, url, dry = true) => who("POST", "/api/skills/import", { url, dry });
const L1 = "https://github.com/mock-dev/dup-one";
const isDup = (r, where, name = "dup-one") => r.s === 409 && r.j?.duplicate?.where === where && r.j.duplicate.name === name && /Skill từ link này đã có/.test(r.j.error ?? "");

console.log("1. Quản trị viên: thêm lại đúng link đã thêm → báo trùng, không thêm");
{
  const pv = await imp(admin, L1);
  ok(pv.s === 200 && pv.j?.preview?.name === "dup-one", "lần đầu: xem trước bình thường", pv.j);
  const sv = await imp(admin, L1, false);
  ok(sv.s === 200 && sv.j?.created && sv.j.skill?.source === "github.com/mock-dev/dup-one", "lưu skill, ghi lại link nguồn", sv.j);
  for (const u of [L1, `${L1}/`, `${L1}.git`, `${L1}/tree/main`, "https://www.github.com/Mock-Dev/DUP-ONE", `${L1}/blob/main/SKILL.md`, `${L1}?tab=readme-ov-file`]) {
    const r = await imp(admin, u);
    ok(isDup(r, "skill"), `trùng: ${u.replace("https://", "")}`, r);
  }
  const r = await imp(admin, L1);
  ok(r.j?.error === 'Skill từ link này đã có: "dup-one" trong Skill của bạn. Synchro không thêm skill trùng.', "thông báo ghi rõ skill nào, ở đâu", r.j);
  const direct = await imp(admin, L1, false);
  const s = (await admin("GET", "/api/skills/dup-one")).j?.skill;
  ok(isDup(direct, "skill") && s?.version === 1, "gọi thẳng lệnh lưu (bỏ qua bước xem trước) cũng bị chặn; skill vẫn là v1", { direct, v: s?.version });
}

console.log("2. Cùng repo nhưng thư mục khác là skill khác: vẫn thêm được");
{
  const a1 = await imp(admin, "https://github.com/mock-dev/dup-two/tree/main/skills/a", false);
  ok(a1.s === 200 && a1.j?.skill?.name === "dup-two-a", "thêm skills/a", a1.j);
  ok(isDup(await imp(admin, "https://github.com/mock-dev/dup-two/tree/main/skills/a/"), "skill", "dup-two-a"), "thêm lại skills/a → trùng");
  const b1 = await imp(admin, "https://github.com/mock-dev/dup-two/tree/main/skills/b");
  ok(b1.s === 200 && b1.j?.preview?.name === "dup-two-b", "skills/b (link khác) → xem trước bình thường", b1.j);
  const whole = await imp(admin, "https://github.com/mock-dev/dup-two");
  ok(whole.s === 200 && !whole.j?.duplicate, "cả repo (link khác với link thư mục) → không tính là trùng", whole.j);
}

console.log("3. Tài khoản thường: skill riêng của quản trị viên không tính; link chính mình đã thêm thì trùng");
{
  const pv = await imp(memA, L1);
  ok(pv.s === 200 && pv.j?.preview?.name === "dup-one", "thành viên thêm được link mà quản trị viên chỉ dùng riêng", pv.j);
  const sv = await imp(memA, L1, false);
  ok(sv.s === 200 && sv.j?.created, "thành viên lưu skill của mình", sv.j);
  ok(isDup(await imp(memA, `${L1}/`), "skill"), "thành viên thêm lại link của chính mình → trùng");
}

console.log("4. Skill thêm trước khi Synchro lưu link: nội dung giống hệt → trùng");
{
  const up = await memB.upload("SKILL.md", ONE);
  ok(up.s === 200 && up.j?.skill?.name === "dup-one" && up.j.skill.source === null, "skill cũ (tải lên, chưa có link nguồn)", up.j);
  const r = await imp(memB, L1);
  ok(isDup(r, "skill"), "dán link có SKILL.md giống hệt → báo trùng", r);
  ok((await memB("GET", "/api/skills/dup-one")).j?.skill?.source === "github.com/mock-dev/dup-one", "ghi lại link nguồn cho skill cũ");
  ok(isDup(await imp(memB, L1, false), "skill"), "lưu thẳng cũng bị chặn");
}

console.log("5. Thư viện cho mọi người: chặn cả quản trị viên lẫn tài khoản thường, ở cả hai cửa thêm từ link");
{
  const sh = await admin("POST", "/api/skills/dup-one/share", { source: L1 });
  ok(sh.s === 200 && sh.j?.plugin?.scope === "org" && (await admin("GET", "/api/skills/dup-one")).s === 404, "quản trị viên đưa dup-one vào Thư viện cho mọi người", sh.j);
  const ad = await imp(admin, L1);
  ok(isDup(ad, "org", sh.j?.plugin?.name), "quản trị viên dán lại link → trùng với Thư viện cho mọi người", ad);
  const mc = await imp(memC, L1);
  ok(isDup(mc, "org", sh.j?.plugin?.name) && /Thư viện cho mọi người/.test(mc.j.error), "tài khoản thường dán link quản trị viên đã thêm cho mọi người → trùng", mc);
  const pl = await memC("POST", "/api/plugins", { action: "preview", url: `${L1}/` });
  ok(pl.s === 409 && pl.j?.duplicate?.where === "org", "cài thành thư viện riêng từ cùng link → cũng bị chặn", pl);
  const pa = await admin("POST", "/api/plugins", { action: "install", url: L1, scope: "org" });
  ok(pa.s === 409 && pa.j?.duplicate?.where === "org", "quản trị viên cài lại thành thư viện cho mọi người → bị chặn", pa);
  const other = await imp(memC, "https://github.com/mock-dev/dup-two/tree/main/skills/b");
  ok(other.s === 200 && other.j?.preview, "link khác vẫn thêm bình thường", other.j);
}

// Dọn
for (const who of [admin, memA, memB, memC]) for (const n of ["dup-one", "dup-two-a", "dup-two-b"]) await who("DELETE", `/api/skills/${n}`);
for (const x of (await admin("GET", "/api/plugins")).j?.plugins ?? []) if (x.scope === "org" && /dup-one/.test(x.slug)) await admin("DELETE", `/api/plugins/${x.id}`);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
