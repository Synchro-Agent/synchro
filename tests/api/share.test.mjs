// Chia sẻ đoạn chat: bản chụp lọc đúng (thuần, không máy chủ) và luồng thật: tạo liên kết, trang công khai không cần đăng nhập, chỉ chủ mới dừng được, dừng thì 404.
// Chạy trên npm run dev:mock (web 3200).
import { loadTs } from "../lib/ts.mjs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const client = () => {
  let cookie = "";
  return async (m, p, b, raw = false) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
};

console.log("1. Bản chụp chỉ giữ vai, chữ, artifact mới nhất");
const { sharesnap: { snapshotOf } } = await loadTs(["sharesnap"]);
const art = (v, body) => `Bản ${v}\n<artifact identifier="a1" type="text/html" title="Trang ${v}">${body}</artifact>`;
const snap = snapshotOf("  Tên   chat <!-- meta --> ", [
  { role: "user", text: "Mật mã <artifact identifier=\"x\" type=\"text/html\" title=\"t\"><script>alert(1)</script></artifact>", files: ["bi-mat.pdf"], fids: { "bi-mat.pdf": "fid_secret" }, trace: [{ secret: "trace" }], sys: "SYS_SECRET", via: "model-x" },
  { role: "ai", text: art(1, "<p>cu</p>") + "<!-- meta: an -->", skills: ["skill-secret"], outs: [{ id: "out_secret", name: "x.pdf" }], parts: [{ k: "tool", name: "tool-secret" }] },
  { role: "ai", text: art(2, "<p>moi</p>") },
]);
const raw = JSON.stringify(snap);
ok(snap.title === "Tên chat", "tiêu đề đã làm sạch", snap.title);
ok(snap.msgs[0].segs.length === 1 && snap.msgs[0].segs[0].k === "text", "tin của người dùng luôn là chữ thuần, thẻ <artifact> không thành khung chạy", raw);
ok(snap.msgs[0].files === 1 && !raw.includes("bi-mat") && !raw.includes("fid_secret"), "chỉ giữ số lượng tệp, không có tên hay mã tệp", raw);
ok(!/SYS_SECRET|trace|skill-secret|out_secret|tool-secret|model-x|meta: an/.test(raw), "không lọt dấu vết công cụ, skill, model, lời nhắc hệ thống, chú thích ẩn", raw);
ok(snap.msgs[1].segs.some((s) => s.k === "old") && !raw.includes("<p>cu</p>") && raw.includes("<p>moi</p>"), "artifact bản cũ chỉ còn một dòng nhắc, bản mới nhất giữ nguyên", raw);
ok(snapshotOf("", "không phải mảng").msgs.length === 0, "dữ liệu sai không làm hỏng máy chủ");

console.log("2. Tạo liên kết, xem công khai, dừng chia sẻ");
const owner = client(), other = client(), anon = client();
const email = `share-${Date.now()}@synchro.test`;
await owner("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Share Tester", birthDate: "2000-01-01" } });
await owner("POST", "/api/auth/login", { email, password: "Member-pass-123" });
await other("POST", "/api/auth/signup", { email: `other-${email}`, password: "Member-pass-123", profile: { fullName: "Other", birthDate: "2000-01-01" } });
await other("POST", "/api/auth/login", { email: `other-${email}`, password: "Member-pass-123" });
const conv = String(Date.now());
const msgs = [{ role: "user", text: "Câu hỏi công khai XYZ123" }, { role: "ai", text: "Trả lời **đậm** ABC789", done: true, via: "model-bi-mat" }];
ok((await anon("POST", "/api/share", { conv, title: "T", msgs })).s === 401, "chưa đăng nhập không tạo được liên kết");
ok((await owner("POST", "/api/share", { conv, title: "T", msgs: [] })).s === 400, "đoạn chat rỗng thì báo lỗi");
const c1 = await owner("POST", "/api/share", { conv, title: "Tên đoạn chat", msgs });
const token = c1.j?.share?.token;
ok(c1.s === 200 && /^[\w-]{30,}$/.test(token ?? ""), "tạo được liên kết với mã ngẫu nhiên dài", JSON.stringify(c1));
const c2 = await owner("POST", "/api/share", { conv: conv + "2", title: "Tên đoạn chat", msgs });
ok(c2.j?.share?.token !== token, "hai đoạn chat cùng tên có hai địa chỉ khác nhau");
const page = await anon("GET", `/share/${token}`, undefined, true), html = await page.text();
ok(page.status === 200 && html.includes("XYZ123") && html.includes("ABC789"), "người chưa đăng nhập xem được", page.status);
ok(!html.includes(email) && !html.includes("Share Tester") && !html.includes("model-bi-mat") && !html.includes(conv), "trang không lộ email, tên, model hay mã đoạn chat");
ok(/noindex/.test(html) && /no-referrer/.test(html), "trang không cho công cụ tìm kiếm lưu và không gửi referrer");
ok((await anon("GET", "/share/abc", undefined, true)).status === 404, "mã không tồn tại trả 404");
const up = await owner("POST", "/api/share", { conv, title: "Tên mới", msgs: [...msgs, { role: "user", text: "Câu thứ hai QQQ" }] });
ok(up.j?.share?.token === token, "cập nhật bản chụp giữ nguyên địa chỉ");
ok((await (await anon("GET", `/share/${token}`, undefined, true)).text()).includes("QQQ"), "bản chụp đã cập nhật");
const list = await owner("GET", "/api/share");
ok(list.j?.shares?.some((s) => s.token === token), "Cài đặt liệt kê được liên kết", JSON.stringify(list.j));
ok(!(await other("GET", "/api/share")).j?.shares?.length, "người khác không thấy liên kết của mình");
await other("DELETE", `/api/share?token=${token}`);
ok((await anon("GET", `/share/${token}`, undefined, true)).status === 200, "người khác không dừng được liên kết của mình");
const noOrigin = await fetch(`${B}/api/share?token=${token}`, { method: "DELETE" });
ok(noOrigin.status === 401 || noOrigin.status === 403, "yêu cầu chéo trang không dừng được");
ok((await owner("DELETE", `/api/share?token=${token}`)).j?.ok === true, "chủ dừng được liên kết");
ok((await anon("GET", `/share/${token}`, undefined, true)).status === 404, "dừng rồi thì liên kết 404");
await owner("DELETE", `/api/share?conv=${conv}2`);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
