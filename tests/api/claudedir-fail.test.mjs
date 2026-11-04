// Skill Hub: thư viện cài lỗi vì lý do khác giấy phép được nhớ lại cho mọi người (không còn trông như cài được, không tính là còn phải cài),
// thư viện đóng có thư viện mở tương tự, "UNLICENSED" không bị tính là mở. Không cần máy chủ: danh mục và cơ sở dữ liệu riêng cho lượt kiểm thử.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-cdfail-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "cd-fail-key";
process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
process.env.SYNCHRO_DEFAULT_PLUGINS = "0";
process.env.CLAUDE_DIR_FILE = path.join(tmp, "dir.json");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const lib = (id, license, summary, skills, extra = {}) => ({ id, slug: id.replace(/\W/g, "-"), name: id, summary, author: "a", cats: ["legal"], license, repo: `a/${id}`, path: "", commit: `c-${id}`, homepage: "", skills, ...extra });
const CATALOG = { synced: "t", plugins: [
  lib("open-contract", "MIT", "Contract review clause redlining negotiation playbook", ["contract-review", "clause-redline"]),
  lib("open-other", "Apache-2.0", "Tax filing bookkeeping invoices", ["tax-filing"]),
  lib("no-license", "", "Contract review clause redlining negotiation playbook", ["contract-review"]),
  lib("closed-hand", "Proprietary", "Hand-picked closed", ["x"], { closed: true, alt: ["open-other"] }),
  lib("closed-auto", "LicenseRef-Secret", "Contract review clause redlining negotiation", ["contract-review"], { closed: true, alt: [] }),
  lib("npm-unlicensed", "UNLICENSED", "Contract clause redlining review", ["contract-review"]),
  lib("repo-gone", "MIT", "Contract clause redlining negotiation playbook", ["clause-redline"]),
  lib("blocked-late", "", "Contract clause redlining playbook review", ["clause-redline"]),
] };
fs.writeFileSync(process.env.CLAUDE_DIR_FILE, JSON.stringify(CATALOG));

const { claudedir: C, plugjob: J, authstore: AS, "api/plugins/catalog/route": R, "api/plugins/route": P } = await loadTs(["claudedir", "plugjob", "authstore", "api/plugins/catalog/route", "api/plugins/route"]);
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? "").split(",")[0];
const member = AS.createUser({ email: "m@cd.test", name: "M", verified: true });
const req = (u, url, init = {}) => { const s = AS.createSession(u, new Request("http://x/"), "password"); return new Request(`http://localhost${url}`, { ...init, headers: { ...(init.headers ?? {}), cookie: s.split(";")[0], origin: "http://localhost" } }); };
const cat = async (u, q = "") => { const r = await R.GET(req(u, `/api/plugins/catalog${q}`)); return r.json(); };

await P.GET(req(member, "/api/plugins?view=lite")); // tạo bảng plugins
console.log("1. Giấy phép");
ok(C.dirById("npm-unlicensed").closed === true, "UNLICENSED (npm) là đóng, không phải The Unlicense");
ok(!C.openLicense("UNLICENSED") && C.openLicense("Unlicense") && C.openLicense("MIT OR Apache-2.0") && !C.openLicense("") && !C.openLicense("BUSL-1.1"), "phân loại giấy phép mở");

console.log("2. Thư viện mở thay thế");
const near = C.similarOpen(C.dirById("closed-auto"));
ok(near.includes("open-contract"), "thư viện đóng không có thay thế chọn tay: tự tìm thư viện mở cùng việc", JSON.stringify(near));
ok(!near.includes("no-license") && !near.includes("open-other") && !near.includes("closed-hand"), "không gợi ý thư viện chưa rõ giấy phép, khác việc, hay cũng đóng", JSON.stringify(near));
ok(JSON.stringify(C.altsOf(C.dirById("closed-hand"))) === '["open-other"]', "có thay thế chọn tay thì dùng chọn tay");
ok(/Thay bằng thư viện mở: open-contract/.test(C.closedReason(C.dirById("closed-auto"))), "lý do từ chối chỉ ra thư viện mở", C.closedReason(C.dirById("closed-auto")));

console.log("3. Lỗi không phải giấy phép được nhớ lại");
J.noteInstallError("cd:repo-gone", "repo-gone", "Không tìm thấy repo a/repo-gone (404).");
J.noteInstallError("cd:open-other", "open-other", "fetch failed ECONNRESET");
J.noteInstallError("cd:blocked-late", "blocked-late", "Giấy phép độc quyền: tác giả không cho sao chép skill này ra ngoài dịch vụ của họ.");
ok(J.failedLibs().has("cd:repo-gone") && J.failedLibs().get("cd:repo-gone").kind === "missing", "repo đã xóa: nhớ lại với lý do", JSON.stringify([...J.failedLibs()]));
ok(!J.failedLibs().has("cd:open-other"), "lỗi mạng tạm thời: không nhớ, lần sau thử lại");
ok(J.blockedLibs().has("cd:blocked-late") && !J.failedLibs().has("cd:blocked-late"), "lỗi giấy phép vẫn vào danh sách giấy phép");

console.log("4. Danh mục cho thành viên");
let d = await cat(member, "?size=100");
const it = (id) => d.items.find((x) => x.id === `cd:${id}`);
ok(it("repo-gone").failed === true && it("repo-gone").closed === false && it("repo-gone").failedWhy === null, "thành viên thấy thư viện lỗi, không thấy lỗi thô", JSON.stringify(it("repo-gone")));
ok(it("repo-gone").alt.some((a) => a.id === "cd:open-contract"), "thư viện lỗi cũng có thư viện mở tương tự", JSON.stringify(it("repo-gone").alt));
ok(it("blocked-late").closed === true && it("blocked-late").alt.some((a) => a.id === "cd:open-contract") && it("blocked-late").altAuto === true, "thư viện chỉ lúc cài mới biết giấy phép đóng: có thư viện mở tương tự", JSON.stringify(it("blocked-late")));
ok(d.totals.failed === 1 && d.totals.closed === 4, "số đếm tách riêng đóng và lỗi", JSON.stringify(d.totals));
ok(d.cats.legal.failed === 1 && d.cats.legal.closed === 4, "số đếm theo mục cũng vậy", JSON.stringify(d.cats.legal));
ok(d.totals.plugins - d.totals.installed - d.totals.closed - d.totals.failed === 3, "còn phải cài: chỉ thư viện cài được", JSON.stringify(d.totals));
const miss = await cat(member, "?size=100&only=missing"), un = await cat(member, "?size=100&only=unavailable");
ok(miss.items.length === 3 && !miss.items.some((x) => x.failed || x.closed), "lọc Chưa cài: không còn thư viện không cài được", JSON.stringify(miss.items.map((x) => x.name)));
ok(un.items.length === 5 && un.items.every((x) => x.failed || x.closed), "lọc Không cài được: đủ thư viện đóng và lỗi", JSON.stringify(un.items.map((x) => x.name)));

const denied = await P.POST(req(member, "/api/plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "install", catalogId: "cd:repo-gone", scope: "personal" }) }));
ok(denied.status === 409 && /Quản trị viên/.test((await denied.json()).error), "thành viên cài thư viện đã lỗi: câu dễ hiểu, không thử tải lại");

console.log("5. Đã cài từ trước vẫn là đã cài");
AS.db().prepare("INSERT INTO plugins (id, owner, slug, name, catalog_id, description, sources, created_at, updated_at) VALUES ('p1', 'org', 'npm-unlicensed', 'npm-unlicensed', 'cd:npm-unlicensed', '', '[]', 0, 0)").run();
d = await cat(member, "?size=100");
ok(it("npm-unlicensed").installed === "p1" && it("npm-unlicensed").closed === false && d.totals.installed === 1 && d.totals.closed === 3, "giấy phép bị xếp lại là đóng không gỡ hay giấu thư viện đã cài", JSON.stringify(it("npm-unlicensed")));

console.log("6. Thử lại và đổi commit");
J.clearFailed("cd:repo-gone");
ok(!J.failedLibs().has("cd:repo-gone"), "cài được hoặc thử lại thì quên lỗi");
J.noteInstallError("cd:repo-gone", "repo-gone", "Không tìm thấy repo");
CATALOG.plugins.find((p) => p.id === "repo-gone").commit = "c-moi";
fs.writeFileSync(process.env.CLAUDE_DIR_FILE, JSON.stringify(CATALOG));
fs.utimesSync(process.env.CLAUDE_DIR_FILE, new Date(), new Date(Date.now() + 5000));
ok(!J.failedLibs().has("cd:repo-gone"), "danh mục đổi commit: xét lại từ đầu");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
