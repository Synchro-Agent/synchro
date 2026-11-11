// Hội đồng phản biện (Giai đoạn 3): đọc JSON lỗi theo dòng, gộp ý kiến của nhiều model, bản sửa SEARCH/REPLACE áp đúng chỗ;
// API chọn model của hãng khác với model vừa viết, chạy song song, trả kết quả có cấu trúc.
// Chạy trên npm run dev:mock (web 3200, LLM giả 4010).
import { loadTs } from "../lib/ts.mjs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", LLM = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
// loadTs theo cả các import của artifacts.ts (designtemplates…), không chỉ một tệp.
const { vfs, critic } = await loadTs(["artifacts", "vfs", "critic"]);
const { applyPatches, parsePatches } = vfs;
const { parseFindings, mergeFindings, fixPatch, important, numbered } = critic;

console.log("1. Đọc kết quả của model");
let f = parseFindings('Đây là kết quả:\n```json\n{"findings":[{"line_start":3,"line_end":99,"severity":"low","title":"Gợi ý","detail":"d","suggested_fix":"x"},{"line_start":1,"line_end":1,"severity":"high","title":"Lỗi nặng","detail":"d","suggested_fix":"y"},{"line_start":50,"title":"ngoài tệp"},{"line_start":2,"severity":"bad"}]}\n```', 10);
ok(f.length === 2 && f[0].severity === "high" && f[1].line_end === 10, "đọc JSON trong khối ```json, bỏ mục sai, nặng nhất trước, giới hạn dòng trong tệp", JSON.stringify(f));
ok(parseFindings('[{"line_start":2,"title":"A"}]', 5)[0]?.severity === "medium" && parseFindings("không phải JSON", 5) === null && parseFindings('{"findings":[{"line_start":1', 5) === null && parseFindings('{"ok":true}', 5) === null && parseFindings('{"findings":[]}', 5)?.length === 0, "câu trả lời không đọc được là null, khác với không có lỗi nào; nhận cả dạng mảng; mức độ lạ → Nên sửa; chữ thường → không có lỗi");
const m = mergeFindings([
  { by: "openai/gpt-6-sol", findings: [{ line_start: 4, line_end: 5, severity: "medium", title: "A", detail: "", suggested_fix: "" }, { line_start: 9, line_end: 9, severity: "low", title: "B", detail: "", suggested_fix: "b" }] },
  { by: "google/gemini-3.8-flash", findings: [{ line_start: 5, line_end: 5, severity: "high", title: "A nặng", detail: "", suggested_fix: "fix" }] },
]);
ok(m.length === 2 && m[0].severity === "high" && m[0].by.length === 2 && m[0].suggested_fix === "fix" && m[1].by[0] === "openai/gpt-6-sol", "hai model thấy cùng chỗ: gộp lại, giữ mức nặng hơn, ghi cả hai", JSON.stringify(m));

console.log("2. Bản sửa áp đúng chỗ");
const CODE = ["function a() {", "  return 1;", "}", "function b() {", "  return 1;", "}", "const x = undefined;", "x.length;", "", "", "", "// hết"].join("\n");
let p = fixPatch(CODE, { line_start: 5, line_end: 5, severity: "high", title: "t", detail: "", suggested_fix: "  return 2;" });
let r = applyPatches(CODE, parsePatches(p));
ok(r.ok && r.content.split("\n")[4] === "  return 2;" && r.content.split("\n")[1] === "  return 1;", "dòng trùng nội dung ở chỗ khác: nới thêm dòng làm mốc, chỉ sửa đúng dòng 5", p);
p = fixPatch(CODE, { line_start: 7, line_end: 7, severity: "high", title: "t", detail: "", suggested_fix: "const x = [];" });
r = applyPatches(CODE, parsePatches(p));
ok(r.ok && r.content.includes("const x = [];") && !r.content.includes("undefined") && r.content.split("\n").length === 12, "sửa một dòng duy nhất: SEARCH/REPLACE gọn");
ok(fixPatch(CODE, { line_start: 7, line_end: 7, severity: "low", title: "t", detail: "", suggested_fix: "" }) === null && fixPatch(CODE, { line_start: 7, line_end: 7, severity: "low", title: "t", detail: "", suggested_fix: "const x = undefined;" }) === null, "không có bản sửa hoặc bản sửa y hệt → không áp");
ok(important({ type: "html", content: "<p>\n".repeat(12), complete: true }) && !important({ type: "markdown", content: "a\n".repeat(50) }) && !important({ type: "react", content: "x" }) && !important({ type: "code", content: "a\n".repeat(20), complete: false }), "chỉ phản biện code, trang web, ứng dụng React đã viết xong và đủ dài");
ok(numbered("a\nb").split("\n")[1] === "   2 | b", "gửi kèm số dòng cho model");

console.log("3. API hội đồng phản biện");
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, pth, body) => {
  const res = await fetch(B + pth, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await res.json(); } catch {}
  return { s: res.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const BUGGY = `import { useState } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  const items = undefined;
  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-semibold">Bộ đếm: {n}</h1>
      <p className="text-slate-500">Có {items.length} mục</p>
      <button onClick={() => setN(n + 1)} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white">Tăng</button>
    </div>
  );
}`;
// Hội đồng chỉ dùng model đang hiện ở bộ chọn: tạm hiện một model của mỗi hãng, xong trả lại như cũ.
const keys = await api("GET", "/api/admin/apikeys");
const mainBefore = keys.j?.main ?? [];
const oneEach = ["anthropic", "openai", "google"].map((id) => keys.j.providers.find((x) => x.id === id)?.models?.[0]?.key).filter(Boolean);
await api("POST", "/api/admin/apikeys", { action: "main", main: oneEach });
r = await api("POST", "/api/critic", { title: "Bộ đếm", type: "react", content: BUGGY, model: "anthropic/claude-fable-5-1", question: "Làm bộ đếm" });
const F = r.j?.findings ?? [];
ok(r.s === 200 && F[0]?.severity === "high" && F[0].line_start === 5 && F[0].suggested_fix.trim() === "const items = [];", "tìm đúng lỗi nặng ở dòng 5 kèm bản sửa", JSON.stringify(r.j));
ok(r.j?.by?.length === 2 && r.j.by.every((k) => !k.startsWith("anthropic/")) && new Set(r.j.by.map((k) => k.split("/")[0])).size === 2, `hai model của hai hãng khác với model vừa viết: ${r.j?.by?.join(", ")}`, JSON.stringify(r.j?.by));
ok(F[0]?.by?.length === 2, "cả hai model cùng thấy lỗi → gộp thành một ý kiến");
const L = (await fetch(`${LLM}/_debug/last`).then((x) => x.json()));
const sentAll = JSON.stringify([L.openai, L.google]);
ok(sentAll.includes("<critic_review>") && sentAll.includes("   5 |   const items = undefined;"), "model nhận mã kèm số dòng và hướng dẫn trả JSON", sentAll.slice(0, 200));
const fixed = applyPatches(BUGGY, parsePatches(fixPatch(BUGGY, F[0]))).content;
r = await api("POST", "/api/critic", { title: "Bộ đếm", type: "react", content: fixed, model: "openai/gpt-6-sol" });
ok(r.s === 200 && r.j.findings.length === 0 && !r.j.by.some((k) => k.startsWith("openai/")), "bản đã sửa: không còn lỗi; model vừa viết là OpenAI thì không tự chấm", JSON.stringify(r.j));
r = await api("POST", "/api/critic", { title: "x", type: "code", content: "   " });
ok(r.s === 400, "không có nội dung → 400");
r = await api("POST", "/api/critic", { title: "x", type: "code", content: "a\n".repeat(5000) });
ok(r.s === 413, "quá dài → 413");
ok((await fetch(`${B}/api/critic`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ content: "x" }) })).status === 401, "chưa đăng nhập → 401");
await api("POST", "/api/admin/apikeys", { action: "main", main: [oneEach[0]] });
r = await api("POST", "/api/critic", { title: "Bộ đếm", type: "react", content: BUGGY, model: oneEach[0] });
ok(r.s === 200 && r.j.by.length === 1 && r.j.findings[0]?.line_start === 5, "chỉ có một hãng: vẫn phản biện bằng model đang có", JSON.stringify(r.j?.by));
await api("POST", "/api/admin/apikeys", { action: "main", main: mainBefore });
r = await api("GET", "/api/caps");
ok(r.j?.caps?.crit === true, "Cài đặt → Khả năng: Hội đồng phản biện bật sẵn", JSON.stringify(r.j?.caps));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
