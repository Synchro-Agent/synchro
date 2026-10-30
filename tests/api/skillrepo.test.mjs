// Kho kỹ năng: dán link repo git bất kỳ (GitHub, GitLab, Bitbucket, Codeberg, máy chủ git riêng). Repo không có SKILL.md: Synchro đọc
// toàn bộ repo (mọi tệp văn bản, kể cả đuôi lạ / không đuôi) rồi tự viết skill — model của người dùng viết SKILL.md, không có model thì
// dựng từ README; mọi tệp văn bản vào references/, cây thư mục đầy đủ ở references/repo-tree.md. Repo có SKILL.md vẫn cài như trước.
// An toàn: chỉ https tới địa chỉ công khai (dev:mock cho phép máy chủ git giả lập ở 127.0.0.1).
import { loadTs } from "../lib/ts.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const GH = process.env.MOCK_GH ?? "http://127.0.0.1:4013";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), me = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await me("POST", "/api/auth/signup", { email: "skillrepo@synchro.test", password: "Member-pass-123", profile: { fullName: "Skill Repo", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: "skillrepo@synchro.test", password: "Member-pass-123" });
const row = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "skillrepo@synchro.test");
// Thành viên không được dùng model nào (chưa đăng nhập gói, không có khóa API): skill dựng từ README.
await admin("PATCH", `/api/admin/users/${row.id}`, { action: "set_perms", perms: { models: [], features: Object.fromEntries(Object.keys(row.perms.features).map((k) => [k, true])) } });
for (const who of [admin, me]) for (const n of ["plain-repo", "docs", "real-skill"]) await who("DELETE", `/api/skills/${n}`);
// Thư viện chung từ lần chạy trước của bài này.
for (const x of (await admin("GET", "/api/plugins")).j?.plugins ?? []) if (x.scope === "org" && x.slug === "skill-plain-repo") await admin("DELETE", `/api/plugins/${x.id}`);

const repo = async (name, files) => fetch(`${GH}/_mock/repo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: name, files }) });
const FILES = {
  "README.md": "# Plain Repo\n\nA small toolkit that converts temperatures between Celsius and Fahrenheit for weather dashboards and teaching.\n\n## Install\n\npip install plain-repo\n\n## Usage\n\nCall convert(30, 'C') to get Fahrenheit.\n",
  "docs/guide.md": "# Guide\n\nUse convert() for single values and convert_many() for lists.\n",
  "docs/api.md": "# API\n\nconvert(value, unit) -> float\n",
  "src/convert.py": "def convert(value, unit):\n    return value * 9 / 5 + 32 if unit == 'C' else (value - 32) * 5 / 9\n",
  "src/util/format.ts": "export const fmt = (n: number) => n.toFixed(1);\n",
  "infra/main.tf": "resource \"null_resource\" \"demo\" {}\n",
  "Procfile": "web: python -m plain_repo\n",
  "assets/logo.png": "\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\u0000\u0000\u0000\u0001",
};
await repo("mock-dev/plain-repo", FILES);
await repo("mock-dev/real-skill", { "SKILL.md": "---\nname: real-skill\ndescription: Skill có sẵn SKILL.md.\n---\n# Real\n\nLàm theo hướng dẫn.\n", "references/notes.md": "ghi chú\n" });

// Gửi link, chờ máy chủ đọc repo (pending) tới khi có bản xem trước / lỗi.
async function inspect(who, url, pick) {
  let first = null;
  for (let i = 0; i < 90; i++) {
    const r = await who("POST", "/api/skills/import", { url, pick, dry: true });
    first ??= r;
    if (!r.j?.pending) return { ...r, first };
    await sleep(1000);
  }
  return { s: 0, j: { error: "quá giờ" }, first };
}
const fileNames = (pv) => (pv?.files ?? []).map((f) => f.path);

console.log("1. Repo GitHub không có SKILL.md: đọc toàn bộ repo, model viết SKILL.md");
{
  const r = await inspect(admin, "https://github.com/mock-dev/plain-repo");
  const pv = r.j?.preview;
  ok(r.first?.j?.pending === true, "máy chủ đọc repo ở nền (giao diện chờ, không quá thời gian của proxy)", r.first?.j);
  ok(pv?.generated && pv.name === "plain-repo" && /references\//.test(pv.body), "bản xem trước: skill Synchro tự viết, tên theo repo, hướng dẫn chỉ tới tệp trong references/", pv && { name: pv.name, body: pv.body?.slice(0, 200), w: pv.warnings });
  const names = fileNames(pv);
  ok(["references/README.md", "references/docs/guide.md", "references/docs/api.md", "references/src/convert.py", "references/src/util/format.ts", "references/infra/main.tf", "references/Procfile", "references/repo-tree.md"].every((f) => names.includes(f)) && !names.includes("references/assets/logo.png"),
    "đóng gói mọi tệp văn bản của repo (cả đuôi lạ .tf, tệp không đuôi Procfile); ảnh chỉ có tên trong cây thư mục", names);
  ok(/đã thấy nội dung 7 tệp văn bản trên tổng 8 tệp/.test(pv?.body ?? ""), "model nhận bản đọc phủ toàn bộ repo (nội dung cả 7 tệp văn bản, cây 8 tệp)", pv?.body?.slice(0, 300));
  ok(/^Repo không có SKILL\.md: Synchro đã đọc toàn bộ 8 tệp của repo và nhờ model viết SKILL\.md/.test(pv?.warnings?.[0] ?? "") && pv.warnings.some((w) => /^1 tệp nhị phân/.test(w)), "cảnh báo rõ: skill do Synchro viết từ repo, tệp nhị phân không đóng gói", pv?.warnings);
  // Bấm Thêm: dùng đúng bản đã tạo (không đọc / viết lại).
  const sv = await admin("POST", "/api/skills/import", { url: "https://github.com/mock-dev/plain-repo", dry: false });
  ok(sv.s === 200 && sv.j?.created && sv.j.skill?.name === "plain-repo", "thêm skill vào Kỹ năng", sv.j);
  const d = (await admin("GET", "/api/skills/plain-repo")).j?.skill;
  ok(d && d.files.length >= 8 && d.files.find((f) => f.path === "references/src/convert.py")?.kind === "reference", "tệp mã nguồn của repo là tài liệu tham khảo (không phải script để chạy)", d?.files);
}

console.log("2. Repo git bất kỳ (không phải GitHub), tài khoản chưa có model: dựng skill từ README");
{
  const r = await inspect(me, `${GH}/public-git/mock-dev/plain-repo.git`);
  const pv = r.j?.preview;
  ok(pv?.generated && pv.name === "plain-repo" && /## Nội dung chính của repo/.test(pv.body) && /- Install/.test(pv.body) && /- Usage/.test(pv.body), "clone repo git ngoài GitHub, SKILL.md dựng từ README (mục lục, chỉ dẫn tới references/)", pv && { body: pv.body?.slice(0, 400), err: r.j?.error });
  ok(pv?.warnings?.some((w) => /^Chưa có model nào để viết SKILL\.md/.test(w)) && fileNames(pv).includes("references/infra/main.tf"), "báo rõ chưa có model; vẫn đọc toàn bộ repo", pv?.warnings ?? r.j);
  const sv = await me("POST", "/api/skills/import", { url: `${GH}/public-git/mock-dev/plain-repo.git`, dry: false });
  ok(sv.s === 200 && sv.j?.skill?.name === "plain-repo", "thêm được skill từ repo git ngoài GitHub", sv.j);
}

console.log("3. Link tới một thư mục trong repo: chỉ đọc thư mục đó");
{
  const r = await inspect(admin, "https://github.com/mock-dev/plain-repo/tree/main/docs");
  const pv = r.j?.preview, names = fileNames(pv);
  ok(pv?.generated && names.includes("references/guide.md") && names.includes("references/api.md") && !names.some((f) => /convert\.py|README/.test(f)), "chỉ tệp trong docs/", names);
}

console.log("4. Repo có SKILL.md: cài như trước");
{
  const r = await inspect(admin, "https://github.com/mock-dev/real-skill");
  ok(r.j?.preview?.name === "real-skill" && !r.j.preview.generated && r.first?.j?.pending === undefined, "SKILL.md có sẵn: xem trước ngay, không tự viết", r.j);
}

console.log("5b. Tạo skill cho mọi người: vào Thư viện cho mọi người (chỉ quản trị viên), mọi tài khoản dùng được");
{
  // Thành viên: không được đưa vào thư viện chung.
  const deny = await me("POST", "/api/skills/plain-repo/share", {});
  ok(deny.s === 403, "tài khoản thường không thêm được vào Thư viện cho mọi người", deny);
  const sh = await admin("POST", "/api/skills/plain-repo/share", { source: "https://github.com/mock-dev/plain-repo" });
  const pl = sh.j?.plugin;
  ok(sh.s === 200 && pl?.scope === "org" && pl.skills?.some?.((k) => k.name === "plain-repo") !== false && /plain/i.test(pl.name + pl.slug), "quản trị viên: skill thành thư viện của tổ chức", sh.j && { scope: pl?.scope, slug: pl?.slug, name: pl?.name });
  ok((await admin("GET", "/api/skills/plain-repo")).s === 404, "bản riêng trong Skill của bạn được bỏ (không trùng hai nơi)");
  const seen = (await me("GET", "/api/plugins")).j?.plugins ?? [];
  ok(seen.some((x) => x.scope === "org" && x.slug === pl?.slug), "tài khoản khác thấy thư viện mới trong Thư viện cho mọi người", seen.map((x) => `${x.scope}:${x.slug}`));
}

console.log("5. An toàn và nhận đúng link của các nơi lưu git");
{
  delete process.env.GIT_ALLOW_PRIVATE;
  const { parseGitLink, fetchGitRepo } = await loadTs(["repofetch"]).then((m) => m.repofetch);
  const gl = parseGitLink("https://gitlab.com/group/sub/proj/-/tree/main/docs/x");
  ok(gl.url === "https://gitlab.com/group/sub/proj" && gl.segs.join("/") === "main/docs/x", "GitLab: nhóm lồng nhau, /-/tree/<nhánh>/<thư mục>", gl);
  const bb = parseGitLink("https://bitbucket.org/ws/proj/src/main/docs");
  const cb = parseGitLink("https://codeberg.org/owner/proj/src/branch/dev/lib");
  ok(bb.url === "https://bitbucket.org/ws/proj" && bb.segs.join("/") === "main/docs" && cb.url === "https://codeberg.org/owner/proj" && cb.segs.join("/") === "dev/lib", "Bitbucket /src/<nhánh>/…, Codeberg / Gitea /src/branch/<nhánh>/…", { bb, cb });
  const err = async (f) => { try { await f(); return ""; } catch (e) { return e.message; } };
  ok(/Chỉ nhận link https/.test(await err(() => parseGitLink("http://example.com/a/b.git"))), "chỉ nhận https");
  ok(/tên đăng nhập/.test(await err(() => parseGitLink("https://u:p@gitlab.com/a/b"))), "không nhận link chứa mật khẩu");
  ok(/địa chỉ nội bộ/.test(await err(() => fetchGitRepo("https://127.0.0.1/a/b.git"))) && /địa chỉ nội bộ/.test(await err(() => fetchGitRepo("https://localhost/a/b.git"))), "không cho clone vào địa chỉ nội bộ (IP và tên miền trỏ về máy chủ)");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
