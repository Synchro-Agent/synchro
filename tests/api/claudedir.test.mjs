// Danh mục skill của Claude trong Skill Hub — npm run dev:mock (cần mạng tới GitHub: cài thật một mục nhỏ của danh mục).
// Từng thiếu: Synchro chỉ có ~12 thư viện chọn lọc, không có các mục ngành nghề và ~18.000 skill của thư mục Claude; mỗi lượt chat đọc lại
// toàn bộ nội dung mọi skill (không chịu được kho lớn); mỗi tài khoản tối đa 200 thư viện.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
if (!cookie) {
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
}
const api = async (method, p, body) => {
  const t = Date.now();
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j, ms: Date.now() - t, bytes: Number(r.headers.get("content-length") ?? 0) };
};
const CAT = "nonprofit";
await api("PATCH", "/api/caps", { art: true, code: true });
// Dọn lần chạy trước: gỡ thư viện của mục thử.
const clean = async () => {
  const l = await api("GET", `/api/plugins/catalog?cat=${CAT}&only=installed&size=100`);
  for (const x of l.j?.items ?? []) await api("DELETE", `/api/plugins/${x.installed}`);
};
await clean();

console.log("1. Duyệt danh mục: mục ngành nghề, trang, tìm kiếm");
let r = await api("GET", "/api/plugins/catalog");
ok(r.s === 200 && r.j.totals.plugins > 3000 && r.j.totals.skills > 17000, "đủ danh mục của Claude (> 3.000 thư viện, > 17.000 skill)", JSON.stringify(r.j?.totals));
ok(Object.keys(r.j.cats).length >= 50 && r.j.cats.engineering?.plugins > 1000 && r.j.cats.legal?.plugins > 50, "chia theo các mục ngành nghề của Claude", Object.keys(r.j.cats).join(","));
ok(r.j.items.length === 24 && r.j.pages > 100, "trả về theo trang (24 thư viện mỗi trang), không gửi cả danh mục", `${r.j.items.length} / ${r.j.pages} trang`);
ok(r.ms < 1500, `trả lời nhanh (${r.ms}ms)`, r.ms);
r = await api("GET", "/api/plugins/catalog?q=pdf&cat=docs");
ok(r.j.total > 0 && r.j.total < 400 && r.j.items.every((x) => x.cats.includes("docs")) && r.j.items.some((x) => /pdf/i.test(`${x.name} ${x.summary} ${x.skills.join(" ")}`)), "lọc theo mục + từ khóa", JSON.stringify(r.j.items.slice(0, 3).map((x) => x.name)));
r = await api("GET", `/api/plugins/catalog?cat=${CAT}&size=100`);
const items = r.j.items;
ok(items.length >= 3 && items.every((x) => !x.installed), `mục ${CAT}: ${items.length} thư viện, chưa cài`, JSON.stringify(items.map((x) => x.name)));

console.log("2. Cài một thư viện (đúng commit Anthropic đã duyệt)");
const one = [...items].sort((a, b) => a.skillCount - b.skillCount)[0];
r = await api("POST", "/api/plugins", { action: "install", catalogId: one.id, scope: "org" });
ok(r.s === 200 && r.j.plugin?.catalogId === one.id && r.j.plugin.skills.length >= 1, `cài ${one.name}`, JSON.stringify(r.j).slice(0, 400));
const pid = r.j.plugin?.id;
ok(/^[0-9a-f]{40}$/.test(Object.values(r.j.plugin?.commits ?? {})[0] ?? ""), "ghim commit", JSON.stringify(r.j.plugin?.commits));
r = await api("GET", "/api/plugins");
const sum = r.j.plugins.find((p) => p.id === pid);
ok(sum && sum.skills.length >= 1 && !("report" in sum.skills[0]) && !("description" in sum.skills[0]), "danh sách thư viện chỉ có tên skill (nhẹ)", JSON.stringify(sum?.skills?.[0]));
r = await api("GET", `/api/plugins/${pid}`);
ok(r.s === 200 && r.j.plugin.skills[0].report?.license, "mở chi tiết: đủ mô tả, giấy phép, rủi ro", JSON.stringify(r.j).slice(0, 300));
r = await api("GET", `/api/plugins/catalog?cat=${CAT}&only=installed`);
ok(r.j.items.length === 1 && r.j.items[0].installed === pid && r.j.cats[CAT].installed === 1, "danh mục đánh dấu đã cài", JSON.stringify(r.j.cats[CAT]));

console.log("3. Cài tất cả một mục ở nền");
r = await api("POST", "/api/plugins/catalog", { action: "install-all", cat: CAT });
ok(r.s === 200 && r.j.job?.total === items.length - 1, `bắt đầu cài ${items.length - 1} thư viện còn lại`, JSON.stringify(r.j));
let job = null;
for (let t = Date.now(); Date.now() - t < 240_000; await sleep(1500)) { job = (await api("GET", `/api/plugins/catalog?cat=${CAT}`)).j?.job; if (job && !job.running) break; }
ok(job && !job.running && job.finished && job.done === job.total, "cài xong ở nền", JSON.stringify(job));
ok(job && job.installed + job.failed.length === job.total && job.failed.every((f) => f.reason && f.kind), "mỗi thư viện hoặc đã cài, hoặc có lý do", JSON.stringify(job?.failed));
r = await api("GET", `/api/plugins/catalog?cat=${CAT}`);
ok(r.j.cats[CAT].installed === 1 + (job?.installed ?? 0), "số đã cài của mục khớp", JSON.stringify(r.j.cats[CAT]));
r = await api("POST", "/api/plugins/catalog", { action: "install-all", cat: CAT });
ok(r.j.job?.total === (job?.failed.length ?? 0) || r.j.job?.total === 0, "cài lại không cài trùng thư viện đã có", JSON.stringify(r.j.job));
for (let t = Date.now(); Date.now() - t < 120_000 && (await api("GET", "/api/plugins/catalog?size=1")).j?.job?.running; ) await sleep(1000);

console.log("4. Model dùng skill như Claude: mục ngành nghề → thư viện → skill (nội dung chỉ đọc khi mở)");
const M = "anthropic/claude-opus-5-5";
const ask = (content) => api("POST", "/api/llm", { system: "", conv: "cd-" + Date.now().toString(36), messages: [{ role: "user", content }], model: M, skills: true });
r = await ask(`Mở mục #tool=load_skill #args=${JSON.stringify({ name: `cat-${CAT}` })}`);
const t1 = JSON.stringify(r.j ?? {});
// (máy giả lập cắt ngắn kết quả công cụ: kiểm phần đầu — tên mục và số thư viện đã cài của mục)
ok(r.s === 200 && /<category name=\\"nonprofit\\"/.test(t1) && t1.includes(`Mục Nonprofit: ${1 + (job?.installed ?? 0)} thư viện`), "load_skill(cat-…) mở mục ngành nghề", t1.slice(0, 500));
ok(r.ms < 20_000, `lượt chat với kho lớn vẫn nhanh (${r.ms}ms)`, r.ms);
const full = (await api("GET", `/api/plugins/${pid}`)).j.plugin;
const sk = full.skills[0].name;
r = await ask(`Tìm #tool=search_skills #args=${JSON.stringify({ query: full.skills[0].name.replace(/-/g, " ") })}`);
ok(JSON.stringify(r.j ?? {}).includes(sk), "search_skills tìm được skill của danh mục", JSON.stringify(r.j).slice(0, 400));
r = await ask(`Đọc #tool=load_skill #args=${JSON.stringify({ name: sk })}`);
const t3 = JSON.stringify(r.j ?? {});
ok(new RegExp(`<skill name=\\\\"[^"\\\\]*${sk.replace(/[-]/g, "\\-")}`).test(t3) && t3.length > 400, "load_skill đọc đủ nội dung skill", t3.slice(0, 400));

console.log("5. Giấy phép đóng: không cài, có thư viện mở thay thế");
r = await api("GET", "/api/plugins/catalog?q=legalzoom");
const cl = r.j.items.find((x) => x.closed);
ok(cl && cl.alt.length >= 1 && cl.alt.every((a) => a.id.startsWith("cd:")), "thư viện đóng được đánh dấu, kèm thư viện mở thay thế", JSON.stringify(cl));
r = await api("POST", "/api/plugins", { action: "install", catalogId: cl?.id, scope: "org" });
ok(r.s === 403 && /Giấy phép đóng/.test(r.j?.error ?? "") && r.j.error.includes(cl?.alt?.[0]?.name ?? "§"), "không cài thư viện đóng, chỉ ra thư viện thay thế", JSON.stringify(r.j));
r = await api("GET", "/api/plugins/catalog?q=dbt-labs");
ok(r.j.items.some((x) => x.github && x.altFor.includes("dbt-toolkit")), "repo mở từ GitHub thay cho thư viện đóng (dbt-labs thay dbt-toolkit)", JSON.stringify(r.j.items.map((x) => x.name)));

console.log("6. Không giới hạn số thư viện (như Claude)");
r = await api("GET", "/api/plugins");
ok(r.s === 200 && r.ms < 1500, `danh sách thư viện nhanh (${r.ms}ms)`, r.ms);

await clean();
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exitCode = fail ? 1 : 0;
