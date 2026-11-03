// Kiểm tra Cài đặt → Khả năng: lưu theo tài khoản, Artifacts, artifact dùng AI, hình minh họa, chạy code + tạo tệp, mạng, quyền quản trị viên.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body, raw) => {
    const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await member("POST", "/api/auth/signup", { email: "cap-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "cap-member@synchro.test", password: "Member-pass-123" });
// Tài khoản test có quyền riêng (mọi model, mọi tính năng) để không phụ thuộc quyền mặc định quản trị viên đặt cho thành viên.
async function fullPerms(email) {
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  if (u) await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
await fullPerms("cap-member@synchro.test");

const M = "anthropic/claude-opus-5-5";
const chat = (c, text, model = M) => c("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model, skills: true, max_tokens: 1500 });
const setCaps = (c, p) => c("PATCH", "/api/caps", p);
const ALL_ON = { art: true, ai: true, inl: true, code: true, net: false, sw: true };

console.log("1. Lưu cài đặt theo tài khoản");
let r = await setCaps(admin, ALL_ON);
ok(r.s === 200 && r.j.caps.code && r.j.runner === "local", "lưu được, máy chủ chạy code ở chế độ giả lập cục bộ", JSON.stringify(r.j));
r = await setCaps(admin, { art: false, bogus: true, code: "yes" });
ok(r.j.caps.art === false && r.j.caps.ai === false && r.j.caps.code === true && !("bogus" in r.j.caps), "tắt Artifacts thì artifact dùng AI cũng tắt; khóa lạ và giá trị sai bị bỏ qua", JSON.stringify(r.j.caps));
r = await member("GET", "/api/caps");
ok(r.j.caps.art === true && r.j.caps.ai === false, "tài khoản khác có cài đặt riêng (mặc định)", JSON.stringify(r.j.caps));
r = await member("PATCH", "/api/caps", { art: false });
ok(r.s === 200, "người dùng thường tự đổi được");
await member("PATCH", "/api/caps", { art: true });
r = await fetch(B + "/api/caps", { method: "PATCH", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
ok(r.status === 401 || r.status === 403, "yêu cầu từ trang khác bị từ chối");

console.log("2. Artifacts");
await setCaps(admin, ALL_ON);
r = await chat(admin, "Tạo ứng dụng todo cho tôi");
ok(/<artifact identifier="todo-app" type="application\/vnd.react"/.test(r.j?.text ?? ""), "model tạo artifact React", JSON.stringify(r.j).slice(0, 200));
r = await admin("POST", "/api/llm", { system: "", messages: [{ role: "user", content: "Tạo ứng dụng todo" }, { role: "assistant", content: r.j.text }, { role: "user", content: "Đổi màu xanh lá" }], model: M, skills: true });
ok(/identifier="todo-app"/.test(r.j?.text ?? "") && /emerald-/.test(r.j.text), "sửa artifact: cùng identifier (phiên bản mới)", (r.j?.text ?? "").slice(0, 200));
r = await chat(admin, "Làm máy tính bỏ túi", "openai/gpt-6-astra");
ok(/type="text\/html"/.test(r.j?.text ?? ""), "artifact HTML qua OpenAI (Responses API)", (r.j?.text ?? "").slice(0, 200));
r = await chat(admin, "Vẽ logo svg", "google/gemini-4-argon");
ok(/type="image\/svg\+xml"/.test(r.j?.text ?? ""), "artifact SVG qua Gemini", (r.j?.text ?? "").slice(0, 200));
await setCaps(admin, { art: false });
r = await chat(admin, "Tạo ứng dụng todo cho tôi");
ok(!/<artifact/.test(r.j?.text ?? "") && /```jsx/.test(r.j.text), "tắt Artifacts: model không dùng artifact, gửi code thường", (r.j?.text ?? "").slice(0, 200));
await setCaps(admin, ALL_ON);

console.log("3. Lưu artifact (trang Artifacts)");
const item = { ident: "todo-app", title: "Danh sách việc", type: "react", content: "export default () => null" };
r = await admin("POST", "/api/artifacts", { conv: "c1", items: [item] });
const aid = r.j?.ids?.[0];
ok(r.s === 200 && aid, "lưu artifact", JSON.stringify(r.j));
await admin("POST", "/api/artifacts", { conv: "c1", items: [item] });
await admin("POST", "/api/artifacts", { conv: "c1", items: [{ ...item, content: "export default () => 1" }] });
r = await admin("GET", `/api/artifacts/${aid}`);
ok(r.j?.artifact?.versions?.length === 2, "nội dung trùng không thêm phiên bản; nội dung mới thêm phiên bản", JSON.stringify(r.j?.artifact?.versions?.length));
r = await admin("GET", "/api/artifacts");
ok(r.j.artifacts.some((a) => a.id === aid && a.count === 2), "danh sách artifact");
r = await member("GET", `/api/artifacts/${aid}`);
ok(r.s === 404, "tài khoản khác không xem được");
r = await admin("POST", "/api/artifacts", { conv: "c1", items: [{ ...item, type: "exe" }, { ...item, ident: "../x" }] });
ok(r.j.ids.every((x) => x === null), "artifact sai kiểu / sai tên bị bỏ", JSON.stringify(r.j));
r = await admin("DELETE", `/api/artifacts/${aid}`);
ok(r.s === 200 && (await admin("GET", `/api/artifacts/${aid}`)).s === 404, "xóa artifact");

console.log("4. Artifact dùng AI");
const ask = (c, prompt) => c("POST", "/api/llm", { feature: "artifact", prompt, model: M });
r = await ask(admin, "Dịch sang English, chỉ trả về bản dịch:\n\nXin chào! Hôm nay bạn thế nào?");
ok(r.j?.text === "Hello! How are you today?", "window.synchro.complete trả lời", JSON.stringify(r.j));
r = await ask(admin, [{ role: "user", content: "Chào" }, { role: "assistant", content: "Chào bạn" }, { role: "user", content: "Kể chuyện" }]);
ok(r.s === 200 && r.j.text, "gửi được hội thoại nhiều lượt", JSON.stringify(r.j));
r = await ask(admin, [{ role: "system", content: "x" }]);
ok(r.s === 400, "dữ liệu sai bị từ chối", JSON.stringify(r.j));
r = await ask(member, "Chào");
ok(r.s === 403 && /Artifact dùng AI/.test(r.j.error), "tài khoản chưa bật Artifact dùng AI bị chặn", JSON.stringify(r.j));

console.log("5. Hình minh họa trong chat");
r = await chat(admin, "Vẽ biểu đồ doanh thu 6 tháng");
ok(/```chart\n\{"type":"bar"/.test(r.j?.text ?? ""), "biểu đồ cột", (r.j?.text ?? "").slice(0, 120));
r = await chat(admin, "Tỷ lệ doanh thu theo kênh");
ok(/"type":"donut"/.test(r.j?.text ?? ""), "biểu đồ tròn");
r = await chat(admin, "Vẽ sơ đồ quy trình đặt hàng");
ok(/```mermaid/.test(r.j?.text ?? ""), "sơ đồ mermaid");
r = await chat(admin, "Mô phỏng tính lãi vay");
ok(/```widget/.test(r.j?.text ?? ""), "widget tương tác");
await setCaps(admin, { inl: false });
r = await chat(admin, "Vẽ biểu đồ doanh thu 6 tháng");
ok(!/```chart/.test(r.j?.text ?? ""), "tắt hình minh họa: không có biểu đồ", (r.j?.text ?? "").slice(0, 120));
await setCaps(admin, ALL_ON);

// Chạy code cục bộ dùng sandbox-exec của macOS: máy khác (CI Linux) dừng ở đây.
if (process.platform !== "darwin") { console.log("(bỏ qua mục 6-9: chạy code cục bộ chỉ có trên macOS)"); console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0); }
console.log("6. Chạy code và tạo tệp");
const fileTest = async (q, ext, magic) => {
  const t0 = Date.now();
  const x = await chat(admin, q);
  const f = x.j?.files?.find((y) => y.name.endsWith("." + ext));
  let good = false;
  if (f) {
    const d = await admin("GET", `/api/outputs/${f.id}`, undefined, true);
    const buf = Buffer.from(await d.arrayBuffer());
    good = d.status === 200 && buf.subarray(0, magic.length).toString("latin1") === magic && buf.length === f.size;
  }
  ok(good, `${q} → ${f?.name ?? "(không có tệp)"} ${f ? Math.round(f.size / 1024) + " KB" : ""}, ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(x.j).slice(0, 400));
  return f;
};
const xl = await fileTest("Tạo file Excel báo cáo doanh thu", "xlsx", "PK");
await fileTest("Viết báo cáo tuần ra file Word", "docx", "PK");
await fileTest("Làm slide PowerPoint giới thiệu", "pptx", "PK");
await fileTest("Xuất hóa đơn PDF", "pdf", "%PDF");
await fileTest("Xuất dữ liệu mẫu ra csv", "csv", "ma_don");
const png = await fileTest("Vẽ ảnh biểu đồ png bằng matplotlib", "png", "\x89PNG");
r = await chat(admin, "Tạo file Excel báo cáo doanh thu");
ok(/Mình đã chạy code và tạo \*\*bao-cao-doanh-thu.xlsx\*\*/.test(r.j?.text ?? "") && r.j.skills.some((u) => u.kind === "code"), "model tóm tắt kết quả và ghi nhận đã chạy code", (r.j?.text ?? "").slice(0, 200));
r = await member("GET", `/api/outputs/${xl?.id}`, undefined, true);
ok(r.status === 404, "tài khoản khác không tải được tệp");
r = await admin("GET", `/api/outputs/${png?.id}?inline=1`, undefined, true);
ok(r.headers.get("content-type") === "image/png" && /^inline/.test(r.headers.get("content-disposition") ?? ""), "ảnh xem được ngay trong chat");
r = await admin("GET", `/api/outputs/${xl?.id}?inline=1`, undefined, true);
ok(/^attachment/.test(r.headers.get("content-disposition") ?? ""), "tệp không phải ảnh luôn tải về");
{
  // Tải theo đoạn (Range): trình phát video tua được, Safari mới phát MP4.
  const res = await fetch(`${B}/api/outputs/${png?.id}`, { headers: { cookie: admin.cookie(), range: "bytes=0-7" } });
  const buf = Buffer.from(await res.arrayBuffer());
  ok(res.status === 206 && /^bytes 0-7\/\d+$/.test(res.headers.get("content-range") ?? "") && buf.length === 8 && buf.subarray(0, 4).toString("latin1") === "\x89PNG", "tải theo đoạn: 206, đúng 8 byte đầu", `${res.status} ${res.headers.get("content-range")} ${buf.length}`);
  const bad = await fetch(`${B}/api/outputs/${png?.id}`, { headers: { cookie: admin.cookie(), range: "bytes=999999999-" } });
  ok(bad.status === 416, "đoạn ngoài tệp: 416", String(bad.status));
}
r = await chat(admin, "Đếm số nguyên tố dưới 1 triệu");
ok(/78,498 số nguyên tố/.test(r.j?.text ?? ""), "tính toán thật", (r.j?.text ?? "").slice(0, 200));

console.log("7. Sandbox cô lập");
const run = async (code) => {
  const x = await admin("POST", "/api/llm", { system: "", messages: [{ role: "user", content: `#tool=run_code #args=${JSON.stringify({ language: "python", code })}` }], model: M, skills: true });
  return x.j?.text ?? "";
};
let t = await run(`print(open('${process.cwd()}/package.json').read()[:40])`);
ok(!/"name": "claude-clone"/.test(t) && /PermissionError|Operation not permitted/i.test(t), "không đọc được tệp trong thư mục cá nhân", t.slice(-300));
t = await run(`open('${(await import("node:os")).tmpdir()}/synchro-escape.txt','w').write('x')`);
ok(/PermissionError|lỗi/i.test(t), "không ghi được ra ngoài thư mục chạy", t.slice(0, 300));
t = await run("import os; print(sorted(os.listdir('.')))");
ok(/main\.py/.test(t) && /outputs/.test(t), "mỗi lần chạy là thư mục trống mới", t.slice(0, 200));
// Trong một đoạn chat, thư mục làm việc giữ nguyên giữa các lần chạy (bước sau dùng lại tệp bước trước); đoạn chat khác không thấy.
const runIn = async (conv, code, extra = {}) => {
  const x = await admin("POST", "/api/llm", { system: "", conv, messages: [{ role: "user", content: `#tool=run_code #args=${JSON.stringify({ language: "python", code, ...extra })}` }], model: M, skills: true });
  return x.j ?? {};
};
const keepConv = "keep-" + Date.now().toString(36);
let k = await runIn(keepConv, "import os\nos.makedirs('assets', exist_ok=True)\nopen('assets/frame.txt','w').write('buoc-1')\nopen('outputs/a.txt','w').write('a')\nprint('xong buoc 1')");
ok((k.files ?? []).some((f) => f.name === "a.txt"), "bước 1 gửi tệp outputs/a.txt", JSON.stringify(k).slice(0, 300));
k = await runIn(keepConv, "import os\nprint('doc lai:', open('assets/frame.txt').read())\nprint('outputs cu:', sorted(os.listdir('outputs')))");
ok(/doc lai: buoc-1/.test(k.text ?? "") && /outputs cu: \[\]/.test(k.text ?? ""), "bước 2 cùng đoạn chat đọc lại được tệp bước 1; outputs/ không gửi lại tệp cũ", (k.text ?? "").slice(0, 300));
k = await runIn("khac-" + Date.now().toString(36), "import os\nprint('co assets:', os.path.exists('assets'))");
ok(/co assets: False/.test(k.text ?? ""), "đoạn chat khác không thấy thư mục của đoạn chat này", (k.text ?? "").slice(0, 300));
k = await runIn(keepConv, "import time\ntime.sleep(20)", { timeout: 6 });
ok(/quá 6 giây/.test(k.text ?? ""), "tham số timeout của run_code được áp dụng", (k.text ?? "").slice(0, 300));

console.log("8. Mạng");
r = await chat(admin, "Thử truy cập mạng");
ok(/pypi.org\S* → bị chặn/.test(r.j?.text ?? "") && /example.com\S* → bị chặn/.test(r.j.text), "tắt mạng: mọi địa chỉ bị chặn", (r.j?.text ?? "").slice(0, 400));
r = await chat(admin, "Cài thư viện humanize bằng pip");
ok(/pip exit code: [1-9]/.test(r.j?.text ?? "") || /lỗi/.test(r.j?.text ?? ""), "tắt mạng: pip install thất bại", (r.j?.text ?? "").slice(0, 300));
await setCaps(admin, { net: true, web: false });
r = await chat(admin, "Thử truy cập mạng");
ok(/pypi.org\S* → truy cập được/.test(r.j?.text ?? "") && /example.com\S* → bị chặn/.test(r.j.text), "bật mạng, tắt “mọi trang web công khai”: kho thư viện được, trang khác bị chặn", (r.j?.text ?? "").slice(0, 400));
r = await chat(admin, "Cài thư viện humanize bằng pip");
ok(/Đã cài humanize/.test(r.j?.text ?? ""), "bật mạng: pip install được", (r.j?.text ?? "").slice(0, 400));
await setCaps(admin, { web: true });
r = await chat(admin, "Thử truy cập mạng");
ok(/pypi.org\S* → truy cập được/.test(r.j?.text ?? "") && /example.com\S* → truy cập được/.test(r.j.text), "bật “mọi trang web công khai”: trang web thường cũng tải được", (r.j?.text ?? "").slice(0, 400));
r = await admin("GET", "/api/caps");
ok(r.j.caps.web === true, "lưu được “mọi trang web công khai”");
await setCaps(admin, { net: false });
r = await admin("GET", "/api/caps");
ok(r.j.caps.web === false, "tắt mạng thì “mọi trang web công khai” cũng tắt", JSON.stringify(r.j.caps));
await setCaps(admin, { web: false });

console.log("9. Tắt chạy code / quyền quản trị viên");
await setCaps(admin, { code: false });
r = await chat(admin, "Tạo file Excel báo cáo doanh thu");
ok(!(r.j?.files ?? []).length, "tắt chạy code: model không chạy code", JSON.stringify(r.j).slice(0, 200));
r = await admin("GET", "/api/caps");
ok(r.j.caps.net === false, "tắt chạy code thì mạng cũng tắt");
await setCaps(admin, ALL_ON);
const me = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "cap-member@synchro.test");
r = await admin("PATCH", `/api/admin/users/${me.id}`, { action: "set_perms", perms: { models: ["*"], features: { ...me.perms.features, sandbox: false } } });
r = await member("GET", "/api/caps");
ok(r.j.locks.code === "admin" && r.j.caps.code === false, "quản trị viên tắt Cloud sandbox: chạy code bị khóa", JSON.stringify(r.j));
r = await chat(member, "Tạo file Excel báo cáo doanh thu");
ok(!(r.j?.files ?? []).length, "tài khoản bị khóa không chạy được code", JSON.stringify(r.j).slice(0, 200));
await fullPerms("cap-member@synchro.test");
r = await member("GET", "/api/caps");
ok(!r.j.locks.code && r.j.caps.code === true, "về quyền mặc định: dùng lại được");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
