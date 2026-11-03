// Model tự đọc lại artifact (read_artifact) và ảnh từ URL ngoài trong artifact (/api/artimg) — npm run dev:mock.
// Từng sót (synchro.net.nz): bộ slide lớn bị lược khỏi lịch sử gửi model, model trả lời "công cụ không cho mình đọc artifact";
// ảnh Wikimedia trong slide "biến mất" vì khung artifact chỉ cho ảnh nhúng.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
if (!cookie) {
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
}
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const M = "anthropic/claude-opus-5-5";

console.log("1. read_artifact: bản hiện tại, đã áp bản sửa");
await api("PATCH", "/api/caps", { art: true, code: true });
const deck = `<artifact identifier="bao-cao-quy" type="text/html" title="Báo cáo quý">\n<!doctype html><html><body>\n<section class="slide"><h1>Doanh thu quý III</h1></section>\n<section class="slide"><h1>Kế hoạch quý IV</h1></section>\n</body></html>\n</artifact>`;
const patch = `<artifact identifier="bao-cao-quy" mode="patch">\n<<<<<<< SEARCH\n<h1>Kế hoạch quý IV</h1>\n=======\n<h1>Kế hoạch quý IV và năm sau</h1>\n>>>>>>> REPLACE\n</artifact>`;
const conv = "artcheck-" + Date.now().toString(36);
const msgs = [
  { role: "user", content: "Làm bộ slide báo cáo quý" }, { role: "assistant", content: `Đây là bộ slide.\n${deck}` },
  { role: "user", content: "Sửa tiêu đề slide 2" }, { role: "assistant", content: `Đã sửa.\n${patch}` },
  { role: "user", content: `Đọc lại #tool=read_artifact #args=${JSON.stringify({ identifier: "bao-cao-quy" })}` },
];
let r = await api("POST", "/api/llm", { system: "", conv, messages: msgs, model: M, skills: true });
const t = JSON.stringify(r.j ?? {});
ok(r.s === 200 && /Kế hoạch quý IV và năm sau/.test(t) && /version=\\"2\\"/.test(t) && /Doanh thu quý III/.test(t), "đọc được bản hiện tại (phiên bản 2, đã áp bản sửa) kèm số dòng", t.slice(0, 500));
r = await api("POST", "/api/llm", { system: "", conv, messages: [...msgs.slice(0, 4), { role: "user", content: `#tool=read_artifact #args=${JSON.stringify({ identifier: "khong-co" })}` }], model: M, skills: true });
ok(/Không thấy artifact \\"khong-co\\"/.test(JSON.stringify(r.j ?? {})), "identifier sai → báo rõ, không đoán", JSON.stringify(r.j).slice(0, 300));

console.log("2. Artifact viết giữa lượt (trước khi gọi công cụ)");
// Từng sót: model viết bộ slide trong câu dẫn rồi gọi công cụ kiểm tra → slide hiện thành mã CSS thô trong nhật ký (cắt ở 4000 ký tự),
// không có trong câu trả lời cuối, check_artifact báo chưa có artifact.
r = await api("POST", "/api/llm", { system: "", conv: conv + "-mid", messages: [{ role: "user", content: `Làm slide #artmid #tool=read_artifact #args=${JSON.stringify({ identifier: "giua-luot" })}` }], model: M, skills: true });
const mid = r.j?.text ?? "";
ok(r.s === 200 && /^<artifact identifier="giua-luot" type="text\/html"[\s\S]*Slide hai[\s\S]*<\/artifact>/.test(mid), "artifact viết trong câu dẫn được đưa vào câu trả lời cuối", mid.slice(0, 300));
ok(/<artifact_source identifier="giua-luot"[^>]*version="1"[\s\S]*Slide hai/.test(mid), "read_artifact trong cùng lượt đọc được artifact vừa viết", mid.slice(0, 600));

console.log("3. Ảnh từ URL ngoài cho khung artifact (/api/artimg)");
const img = async (u, c = cookie) => fetch(`${B}/api/artimg?u=${encodeURIComponent(u)}`, { headers: { cookie: c } });
let res = await img(`${B}/icon-192.png`);
let buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && res.headers.get("content-type") === "image/png" && buf.subarray(1, 4).toString() === "PNG", "ảnh PNG: tải được, đúng kiểu", `${res.status} ${res.headers.get("content-type")}`);
res = await img(`${B}/file.svg`);
ok(res.status === 200 && /svg/.test(res.headers.get("content-type") ?? "") && /sandbox/.test(res.headers.get("content-security-policy") ?? ""), "ảnh SVG: tải được, kèm CSP sandbox", `${res.status} ${res.headers.get("content-type")}`);
res = await img(`${B}/`);
ok(res.status === 404, "trang HTML (không phải ảnh) → từ chối", String(res.status));
res = await img("javascript:alert(1)");
ok(res.status === 400, "địa chỉ không phải http(s) → 400", String(res.status));
res = await img(`${B}/icon-192.png`, "");
ok(res.status === 401, "chưa đăng nhập → 401", String(res.status));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exitCode = fail ? 1 : 0;
