// Skill tự sửa lỗi (Giai đoạn 3): script chỉ đọc hỏng vì lỗi của chính nó → tự sửa và chạy lại (tối đa 2 lần), lưu vào skill_patches,
// lần sau dùng luôn; script có thể gửi / ghi dữ liệu ra ngoài → chỉ chuẩn bị bản sửa, chờ duyệt; gọi sai tham số → không sửa.
// Chạy trên npm run dev:mock (web 3200, LLM giả 4010, chạy code ở máy cục bộ).
import { createRequire } from "node:module";
import path from "node:path";
const R = createRequire(path.join(process.cwd(), "package.json"));
const JSZip = R("jszip");
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { ...(body instanceof FormData ? {} : { "content-type": "application/json" }), origin: B, cookie }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
// Chạy script cần nơi chạy code: bản giả lập dùng sandbox-exec của macOS (CODE_RUN=local), máy CI Linux bỏ qua bộ này.
if (process.platform !== "darwin") { console.log("(bỏ qua: chạy script cục bộ chỉ có trên macOS)"); console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`); process.exit(0); }
const caps = (await api("GET", "/api/caps")).j?.caps ?? {};
if (!caps.code) await api("PATCH", "/api/caps", { code: true });

const NAME = "heal-demo";
const SCRIPTS = {
  "scripts/count.py": `import sys\nwords = sys.argv[1:]\ntotal = len(words)\nprint("So tu:", totl)  # BUG FIX: print("So tu:", total)\n`,
  "scripts/two.py": `import sys\nn = len(sys.argv) - 1\nprint("Tham so:", m)  # BUG FIX: print("Tham so:", n)\nprint("Gap doi:", n * 2.)upper())  # BUG FIX: print("Gap doi:", n * 2)\n`,
  "scripts/three.py": `a = 1\nprint(b)  # BUG FIX: print(a)\nprint(c)  # BUG FIX: print(a)\nprint(d)  # BUG FIX: print(a)\n`,
  "scripts/post.py": `# Gửi kết quả lên máy chủ khách hàng: requests.post(URL, json=data)\nprint("Da gui", cnt)  # BUG FIX: print("Da gui", 0)\n`,
  "scripts/usage.py": `import argparse\np = argparse.ArgumentParser()\np.add_argument("file")\na = p.parse_args()\nprint(a.file)  # BUG FIX: print("khong dung toi")\n`,
};
const upload = async (scripts, desc = "Kiểm thử skill tự sửa lỗi: đếm từ, gấp đôi.") => {
  const z = new JSZip();
  z.file(`${NAME}/SKILL.md`, `---\nname: ${NAME}\ndescription: "${desc}"\n---\n\n# Heal demo\n\nChạy các script trong scripts/.\n`);
  for (const [p, t] of Object.entries(scripts)) z.file(`${NAME}/${p}`, t);
  const fd = new FormData();
  fd.append("file", new Blob([await z.generateAsync({ type: "nodebuffer" })]), `${NAME}.zip`);
  return api("POST", "/api/skills", fd);
};
const run = async (cmd) => {
  let r = await api("POST", "/api/llm", { system: "", max_tokens: 1500, skills: true, model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: cmd }] });
  for (let i = 0; i < 120 && r.j?.run && !r.j.done; i++) { await new Promise((x) => setTimeout(x, 500)); r = await api("GET", `/api/runs/${r.j.run ?? r.j.id}?json=1`); }
  return String(r.j?.text ?? JSON.stringify(r.j));
};
const patches = async () => (await api("GET", `/api/skills/${NAME}`)).j?.skill?.patches ?? [];

await api("DELETE", `/api/skills/${NAME}`);
let r = await upload(SCRIPTS);
ok(r.s === 200 && r.j?.skill?.scripts === 5, "thêm skill có 5 script", JSON.stringify(r.j).slice(0, 300));
if (!r.j?.skill?.enabled) await api("PATCH", `/api/skills/${NAME}`, { enabled: true });

console.log("1. Script chỉ đọc: tự sửa và chạy lại");
let t = await run(`#skillrun ${NAME} scripts/count.py mot hai ba`);
ok(/Script chạy xong: So tu: 3/.test(t) && /\[healed\]/.test(t) && /NameError/.test(t), "lỗi NameError → tự sửa 1 lần, chạy lại ra đúng kết quả", t);
t = await run(`#skillrun ${NAME} scripts/count.py a b`);
ok(/Script chạy xong: So tu: 2/.test(t) && /\[patched\]/.test(t), "lần sau: dùng luôn bản sửa đã lưu (không sửa lại)", t);
t = await run(`#skillrun ${NAME} scripts/two.py x y`);
ok(/Script chạy xong: Tham so: 2\s+Gap doi: 4/.test(t) && /\[healed\]/.test(t), "hai lỗi liên tiếp → sửa trong 2 lần thử", t);
t = await run(`#skillrun ${NAME} scripts/three.py`);
ok(/Script lỗi/.test(t) && /\[failed\]/.test(t), "ba lỗi → dừng sau 2 lần thử (MAX_RETRIES = 2), báo lỗi thật", t);
t = await run(`#skillrun ${NAME} scripts/usage.py`);
ok(/Script lỗi/.test(t) && !/\[(healed|failed|needs_approval)\]/.test(t), "gọi thiếu tham số (usage:) → không phải lỗi script, không sửa", t);

console.log("2. Script có thể thay đổi dữ liệu bên ngoài: chờ duyệt");
t = await run(`#skillrun ${NAME} scripts/post.py`);
ok(/Script lỗi/.test(t) && /\[needs_approval\]/.test(t) && /Kho kỹ năng/.test(t), "không tự chạy bản sửa, báo người dùng duyệt", t);
let P = await patches();
const by = (p) => P.filter((x) => x.path === p);
ok(by("scripts/count.py")[0]?.status === "active" && by("scripts/count.py")[0].attempts === 1 && by("scripts/count.py")[0].uses === 1, "bản sửa count.py: đang dùng, 1 lần thử, đã dùng lại 1 lần", JSON.stringify(by("scripts/count.py")));
ok(by("scripts/two.py")[0]?.attempts === 2 && !by("scripts/three.py").length && !by("scripts/usage.py").length, "two.py lưu bản sửa (2 lần thử); three.py, usage.py không lưu gì");
const pend = by("scripts/post.py")[0];
ok(pend?.status === "pending" && pend.mutating && pend.content.includes('print("Da gui", 0)') && pend.original.includes("cnt"), "post.py: bản sửa chờ duyệt, kèm bản gốc để xem khác biệt", JSON.stringify(pend));
r = await api("PATCH", `/api/skills/${NAME}`, { patch: pend?.id, action: "approve" });
ok(r.s === 200 && r.j.patches.find((x) => x.id === pend?.id)?.status === "active", "duyệt bản sửa");
t = await run(`#skillrun ${NAME} scripts/post.py`);
ok(/Script chạy xong: Da gui 0/.test(t) && /\[patched\]/.test(t), "sau khi duyệt: chạy bằng bản sửa", t);
r = await api("PATCH", `/api/skills/${NAME}`, { patch: pend?.id, action: "approve" });
ok(r.s === 409, "duyệt lại bản đã dùng → 409");

console.log("3. Hoàn tác, cập nhật skill, xóa skill");
const cnt = by("scripts/count.py")[0];
r = await api("PATCH", `/api/skills/${NAME}`, { patch: cnt.id, action: "revert" });
ok(r.s === 200 && r.j.patches.find((x) => x.id === cnt.id)?.status === "reverted", "hoàn tác bản sửa count.py");
t = await run(`#skillrun ${NAME} scripts/count.py q`);
ok(/\[healed\]/.test(t), "đã hoàn tác: lần chạy sau tự sửa lại từ bản gốc", t);
r = await upload({ ...SCRIPTS, "scripts/count.py": SCRIPTS["scripts/count.py"].replaceAll("So tu", "Tong so tu") }, "Bản mới của skill kiểm thử tự sửa lỗi.");
P = await patches();
ok(P.filter((x) => x.path === "scripts/count.py").every((x) => x.stale) && P.filter((x) => x.path === "scripts/two.py").every((x) => !x.stale), "cập nhật skill (count.py đổi): bản sửa cũ của count.py không còn áp dụng; two.py giữ nguyên");
t = await run(`#skillrun ${NAME} scripts/count.py a`);
ok(/Tong so tu: 1/.test(t) && /\[healed\]/.test(t), "bản mới của script hỏng tiếp → tự sửa trên bản mới", t);
await api("DELETE", `/api/skills/${NAME}`);
{ const db = new (R("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db")); db.pragma("busy_timeout = 5000");
  const n = db.prepare("SELECT COUNT(*) AS n FROM skill_patches WHERE skill_name = ?").get(NAME).n; db.close();
  ok(n === 0, "xóa skill: xóa luôn các bản tự sửa", n); }
if (!caps.code) await api("PATCH", "/api/caps", { code: false });

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
