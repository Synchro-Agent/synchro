// Sửa tham số công cụ ghi trước khi cho phép: máy chủ kiểm tra lại theo schema của công cụ (sai thì 400, câu hỏi vẫn chờ), chỉ lời gọi đang chờ
// chạy với tham số đã sửa, model được báo, nhật ký bảo mật ghi lại việc sửa. Hai đường: thẻ duyệt của lượt CLI (/api/approve) và thẻ duyệt
// của lượt khóa API (resume + inputs). Cần npm run dev:mock. Chạy tay: BASE=http://localhost:3500 MCP=http://127.0.0.1:4311 MOCK=http://127.0.0.1:4310 node tests/api/approve-edit.test.mjs
import { loadTs } from "../lib/ts.mjs";
const B = process.env.BASE ?? "http://localhost:3200", MCP = process.env.MCP ?? "http://127.0.0.1:4011", M = process.env.MOCK ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("1. Kiểm tra tham số theo schema (hàm dùng chung trình duyệt / máy chủ)");
const { connschema: S } = await loadTs(["connschema"]);
const sch = { type: "object", properties: { title: { type: "string", minLength: 1 }, n: { type: "integer", minimum: 1, maximum: 5 }, tags: { type: "array", items: { type: "string" }, maxItems: 2 }, mode: { enum: ["a", "b"] }, sub: { $ref: "#/$defs/Sub" } }, required: ["title"], additionalProperties: false, $defs: { Sub: { type: "object", properties: { x: { type: "boolean" } }, required: ["x"] } } };
ok(S.validateArgs(sch, { title: "ok", n: 3, tags: ["a"], mode: "a", sub: { x: true } }).length === 0, "tham số đúng: không lỗi");
const e1 = S.validateArgs(sch, { n: 2.5, tags: ["a", 1, "c"], mode: "z", sub: {}, extra: 1 });
ok(e1.some((e) => /^title: thiếu/.test(e)) && e1.some((e) => /^n: phải là số nguyên/.test(e)) && e1.some((e) => /^tags\[1\]: phải là chuỗi/.test(e)) && e1.some((e) => /^tags: tối đa 2 mục/.test(e))
  && e1.some((e) => /^mode: chỉ nhận/.test(e)) && e1.some((e) => /^sub\.x: thiếu/.test(e)) && e1.some((e) => /^extra: công cụ không nhận/.test(e)), "lỗi kèm đường dẫn: thiếu, sai kiểu, mảng, enum, $ref, thừa", e1);
ok(S.validateArgs(sch, { title: "" })[0] === "title: cần ít nhất 1 ký tự" && S.validateArgs(sch, { title: "x", n: 9 })[0] === "n: lớn nhất là 5", "minLength, maximum");
ok(S.validateArgs(sch, [1])[0].includes("đối tượng JSON") && S.validateArgs(sch, null).length === 1, "không phải đối tượng: báo lỗi");
ok(S.validateArgs(sch, { n: "x" }, "en").some((e) => e === "n: must be a whole number") && S.validateArgs(sch, {}, "en")[0] === "title: missing (required)", "câu lỗi tiếng Anh cho giao diện tiếng Anh");
ok(S.validateArgs({ anyOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] }, { b: 1 }).length === 0 && S.validateArgs({ anyOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] }, { c: 1 }).length === 1, "anyOf: một nhánh đúng là được");
ok(S.validateArgs(undefined, { anything: 1 }).length === 0, "công cụ không có schema: chỉ cần là đối tượng");

let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const until = async (f, ms = 30_000, step = 250) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const code = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];
async function oauth(url) {
  const page = await fetch(url).then((r) => r.text());
  const link = /id="allow" href="([^"]+)"/.exec(page)[1].replace(/&amp;/g, "&");
  const back = (await fetch(link, { redirect: "manual" })).headers.get("location");
  return fetch(back, { headers: { cookie } }).then((r) => r.text());
}
const events = async (run) => (await api("GET", `/api/runs/${run}?json=1`)).j?.run;
const askOf = async (run) => { const ev = await until(async () => (await events(run))?.events?.find((e) => e.kind === "ask")); return ev ? JSON.parse(ev.text) : null; };
const finished = (run) => until(async () => { const x = await events(run); return x?.status !== "running" ? x : null; }, 40_000);
const textOf = (fin) => String(fin?.result?.text ?? fin?.result?.json?.text ?? JSON.stringify(fin?.result ?? ""));
const notes = async (q) => { const r = await api("POST", "/api/llm", { system: "", messages: [{ role: "user", content: `#tool=search_notes #args=${JSON.stringify({ query: q })}` }], model: "anthropic/claude-opus-5-5", skills: true }); return String(r.j?.text ?? ""); };
const auditHas = async (since) => ((await api("GET", "/api/admin")).j?.audit ?? []).filter((a) => a.action === "tool_args_edited" && a.at >= since);

let notesId = (await api("GET", "/api/connectors")).j.connectors?.find((x) => x.name === "Mock Notes" && x.status === "ok")?.id;
if (!notesId) {
  const r = await api("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
  notesId = r.j.connector?.id;
  await oauth(r.j.authorizeUrl);
}
await api("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "ask" } });
const R = Date.now() % 100000;

try {
  console.log("2. Thẻ duyệt của lượt CLI (Claude Code giả lập): /api/approve kèm tham số đã sửa");
  await api("POST", "/api/engines/claude/login/start", {});
  await api("POST", "/api/engines/claude/login/code", { code: await code("claude") });
  await until(async () => (await api("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn, 15_000, 500);
  const t0 = Date.now();
  let r = await api("POST", "/api/llm", { async: true, conv: `edit-${R}`, model: "sub-claude/sonnet", skills: true, system: "", messages: [{ role: "user", content: `#tool=mock_notes__create_note #args={"title":"Gốc ${R}"}` }] });
  const run = r.j?.run;
  const a = await askOf(run);
  ok(a?.kind === "connector" && JSON.parse(a.detail).title === `Gốc ${R}`, "thẻ duyệt hiện tham số đầy đủ (JSON đọc lại được để sửa)", a);
  ok(a?.schema?.properties?.title?.type === "string" && a.schema.required?.includes("title"), "thẻ có schema của công cụ để kiểm tra ngay khi gõ", a?.schema);
  r = await api("POST", "/api/approve", { id: a.id, ok: true, input: { body: "thiếu tiêu đề" } });
  ok(r.s === 400 && /title/.test(r.j?.error ?? ""), "tham số sửa sai schema (thiếu title): máy chủ từ chối 400 kèm lỗi", r);
  r = await api("POST", "/api/approve", { id: a.id, ok: true, input: { title: 123 } });
  ok(r.s === 400 && /title: phải là chuỗi/.test(r.j?.error ?? ""), "sai kiểu: 400", r);
  r = await api("POST", "/api/approve", { id: a.id, ok: true, input: ["x"] });
  ok(r.s === 400, "không phải đối tượng: 400", r);
  ok(!(await events(run))?.events?.some((e) => e.kind === "asked"), "sau các lần sai, câu hỏi vẫn chờ (chưa trả lời)");
  r = await api("POST", "/api/approve", { id: a.id, ok: true, input: { title: `Đã sửa ${R}`, body: "nội dung thêm" } });
  ok(r.s === 200, "tham số đúng: nhận", r);
  const fin = await finished(run);
  ok(fin?.status === "done" && new RegExp(`Đã tạo ghi chú n\\d+: Đã sửa ${R}`).test(textOf(fin)), "công cụ chạy với tham số đã sửa", textOf(fin));
  ok(fin?.events?.some((e) => e.kind === "asked" && JSON.parse(e.text).edited === true), "sự kiện đã duyệt ghi là đã sửa tham số (thẻ hiện “đã sửa tham số”)");
  ok(/Người dùng đã sửa tham số/.test(JSON.stringify(fin)), "model được báo công cụ chạy với tham số đã sửa");
  ok(/Đã sửa/.test(await notes(`Đã sửa ${R}`)) && /Không có ghi chú/.test(await notes(`Gốc ${R}`)), "ghi chú tạo theo tham số đã sửa, không theo tham số model đề xuất");
  const au = await auditHas(t0);
  ok(au.length >= 1 && /create_note/.test(au[0].detail) && /"changed":\["title","body"\]/.test(au[0].detail) && !/Đã sửa/.test(au[0].detail), "nhật ký bảo mật: ghi đã sửa tham số (tên tham số, không ghi giá trị)", au);
  // Lượt sau cùng đoạn chat: tham số gốc của model, không dính bản sửa trước.
  r = await api("POST", "/api/llm", { async: true, conv: `edit-${R}`, model: "sub-claude/sonnet", skills: true, system: "", messages: [{ role: "user", content: `#tool=mock_notes__create_note #args={"title":"Lần hai ${R}"}` }] });
  const a2 = await askOf(r.j?.run);
  ok(a2 && JSON.parse(a2.detail).title === `Lần hai ${R}`, "bản sửa chỉ áp cho đúng lời gọi đã duyệt", a2?.detail);
  if (a2) await api("POST", "/api/approve", { id: a2.id, ok: false });
  await finished(r.j?.run);

  console.log("3. Thẻ duyệt của lượt khóa API: resume kèm inputs");
  const O = "openai/gpt-6.1-sol";
  const t1 = Date.now();
  r = await api("POST", "/api/llm", { system: "", messages: [{ role: "user", content: `#tool=create_note #args={"title":"API gốc ${R}"}` }], model: O, skills: true });
  let ap = r.j?.approval;
  ok(ap?.calls?.[0]?.editable === true && ap.calls[0].schema?.required?.includes("title"), "lời gọi chờ duyệt cho sửa, kèm schema", ap);
  r = await api("POST", "/api/llm", { resume: ap.id, decisions: { [ap.calls[0].id]: "allow" }, inputs: { [ap.calls[0].id]: { title: `API đã sửa ${R}` } } });
  ok(r.s === 200 && new RegExp(`Đã tạo ghi chú n\\d+: API đã sửa ${R}`).test(r.j?.text ?? ""), "cho phép với tham số đã sửa: công cụ chạy với tham số mới", r.j?.text);
  ok((await auditHas(t1)).length >= 1, "nhật ký bảo mật ghi lại");
  r = await api("POST", "/api/llm", { system: "", messages: [{ role: "user", content: `#tool=create_note #args={"title":"API sai ${R}"}` }], model: O, skills: true });
  ap = r.j?.approval;
  r = await api("POST", "/api/llm", { resume: ap.id, decisions: { [ap.calls[0].id]: "allow" }, inputs: { [ap.calls[0].id]: { body: "không có title" } } });
  ok(r.s === 200 && !/Đã tạo ghi chú/.test(r.j?.text ?? "") && /không hợp lệ|từ chối/.test(r.j?.text ?? ""), "tham số sửa sai: máy chủ kiểm tra lại, công cụ không chạy", r.j?.text);
  ok(/Không có ghi chú/.test(await notes(`API sai ${R}`)), "không tạo ghi chú nào với tham số sai");
} finally {
  await api("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "ask" } });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
