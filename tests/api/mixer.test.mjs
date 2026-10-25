// Bàn trộn ngữ cảnh (Giai đoạn 2): ước tính token từng khối của lượt tiếp theo, tắt khối tầng động, chỉ gửi N tin gần nhất,
// tài liệu ghim ở tầng cố định, phần đầu prompt giữ nguyên giữa các lượt (đọc từ bộ đệm), nén lịch sử thành tóm tắt.
// Chạy trên npm run dev:mock (web 3200, LLM giả 4010).
const B = "http://localhost:3200", LLM = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const last = () => fetch(`${LLM}/_debug/last`).then((r) => r.json());
const M = "anthropic/claude-sonnet-5-5";
const ask = (body) => api("POST", "/api/llm", { system: "", max_tokens: 1500, skills: true, model: M, ...body });
const block = (j, k) => j.blocks.find((b) => b.key === k);
// Gợi ý skill theo câu hỏi chỉ có khi tài khoản có skill đang bật: tạo một skill thử (xóa khi xong).
const SKILL = "mixer-cafe-landing";
const upload = (name, desc) => {
  const fd = new FormData();
  fd.append("file", new Blob([`---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${name}\n\nHướng dẫn thử.\n`]), "SKILL.md");
  return fetch(B + "/api/skills", { method: "POST", headers: { origin: B, cookie }, body: fd }).then((r) => r.json());
};
await api("DELETE", `/api/skills/${SKILL}`);
const up = await upload(SKILL, "Thiết kế trang web, landing page cho quán cà phê và nhà hàng: bố cục, màu sắc, thực đơn.");
if (up.skill && !up.skill.enabled) await api("PATCH", `/api/skills/${SKILL}`, { enabled: true });

console.log("1. Ước tính token từng khối");
const ART = `Đây là trang:\n\n<artifact identifier="trang" type="text/html" title="Trang">\n<!doctype html><title>T</title>\n${"<p>đoạn văn dài</p>\n".repeat(200)}</artifact>`;
const TRACE = [{ id: "c1", name: "list_orders", label: "Cửa hàng: List orders", input: "{}", status: "ok", summary: "400 đơn hàng " + "x".repeat(500), ref: "ref_abcdefgh" }];
const hist = [{ role: "user", content: "Làm trang web" }, { role: "assistant", content: ART, trace: TRACE }, { role: "user", content: "Liệt kê đơn hàng" }, { role: "assistant", content: "Đã liệt kê." }, { role: "user", content: "…" }];
let r = await ask({ messages: hist, estimate: true });
ok(r.s === 200 && Array.isArray(r.j?.blocks) && r.j.total > 0, `trả về các khối và tổng ≈ ${r.j?.total} token`, JSON.stringify(r.j));
ok(["system", "skills", "pinned", "summary", "history", "tools", "artifacts", "dynamic"].every((k) => block(r.j, k)), "đủ 8 khối, chia ba tầng", JSON.stringify(r.j?.blocks?.map((b) => b.key)));
ok(block(r.j, "artifacts").tokens > 1000 && block(r.j, "tools").tokens > 50, `artifact hiện tại ≈ ${block(r.j, "artifacts").tokens}, kết quả công cụ ≈ ${block(r.j, "tools").tokens}`);
const L0 = await last();
ok(!JSON.stringify(L0.anthropic ?? {}).includes('"estimate"') && r.j.blocks.every((b) => typeof b.tokens === "number"), "ước tính không gọi model");

console.log("2. Tắt khối tầng động, chỉ gửi N tin gần nhất");
r = await ask({ messages: hist, estimate: true, mixer: { artifacts: false, tools: false } });
ok(block(r.j, "artifacts").tokens === 0 && block(r.j, "tools").tokens === 0, "tắt artifact và kết quả công cụ: hai khối về 0", JSON.stringify(r.j?.blocks));
r = await ask({ messages: hist, estimate: true, mixer: { recent: 2 } });
ok(r.j.dropped === 3 && block(r.j, "artifacts").tokens > 1000, `chỉ gửi 2 tin: bỏ ${r.j.dropped} tin cũ, artifact hiện tại vẫn còn`, JSON.stringify(r.j));
await ask({ messages: hist.slice(0, -1).concat([{ role: "user", content: "xin chào" }]), mixer: { artifacts: false } });
let L = (await last()).anthropic;
ok(!JSON.stringify(L.messages).includes("<current_artifacts>\\n"), "lượt thật: tắt artifact thì không gửi bản hiện tại", JSON.stringify(L.messages).slice(0, 200));

console.log("3. Tài liệu ghim và phần đầu prompt ổn định");
const PIN = [{ name: "quy-dinh.md", text: "Quy định nội bộ: nghỉ phép 12 ngày mỗi năm. " + "Chi tiết. ".repeat(300) }];
r = await ask({ messages: [{ role: "user", content: "…" }], estimate: true, pinned: PIN });
ok(block(r.j, "pinned").tokens > 500, `tài liệu ghim ≈ ${block(r.j, "pinned").tokens} token ở tầng cố định`);
await ask({ messages: [{ role: "user", content: "Làm trang web cho quán cà phê" }], pinned: PIN });
const A = (await last()).anthropic;
await ask({ messages: [{ role: "user", content: "Viết đề xuất dự án chăm sóc khách hàng" }], pinned: PIN });
const Bq = (await last()).anthropic;
const sysA = JSON.stringify(A.system), sysB = JSON.stringify(Bq.system);
ok(sysA.includes("<pinned_documents>") && /cache_control/.test(JSON.stringify(A.system.at(-1))), "tài liệu ghim nằm trong phần đầu, trước điểm đệm", sysA.slice(0, 200));
ok(sysA === sysB, "hai câu hỏi khác nhau: phần đầu prompt giống hệt (đọc lại từ bộ đệm)", `${sysA.length} vs ${sysB.length}`);
const msgsA = JSON.stringify(A.messages);
ok(!sysA.includes("<skill_routing>") && msgsA.includes("<skill_routing>"), "gợi ý skill theo câu hỏi ở tin nhắn người dùng (tầng động), không ở phần đầu", msgsA.slice(0, 200));

console.log("4. Nén lịch sử");
const long = [];
for (let i = 1; i <= 6; i++) long.push({ role: "user", content: `Yêu cầu số ${i}: sửa trang` }, { role: "assistant", content: i === 1 ? ART : `Đã sửa lần ${i}.` });
r = await api("POST", "/api/context/compact", { messages: long });
ok(r.s === 200 && /Mục tiêu/.test(r.j?.summary ?? "") && /Trang/.test(r.j.summary), "tóm tắt các lượt cũ (kèm tên sản phẩm đã tạo)", JSON.stringify(r.j));
const summary = r.j?.summary ?? "";
r = await api("POST", "/api/context/compact", { messages: [{ role: "user", content: "x" }] });
ok(r.s === 400, "quá ít nội dung → báo lỗi");
r = await ask({ messages: [{ role: "user", content: "Tiếp tục" }], estimate: true, summary });
ok(block(r.j, "summary").tokens > 10, `tóm tắt đã nén ≈ ${block(r.j, "summary").tokens} token ở tầng lịch sử`);
await ask({ messages: [{ role: "user", content: "Tiếp tục" }], summary });
L = (await last()).anthropic;
ok(JSON.stringify(L.messages[0]).includes("<conversation_summary>"), "lượt thật: tóm tắt đặt ở đầu tin nhắn đầu tiên", JSON.stringify(L.messages[0]).slice(0, 200));
ok((await fetch(`${B}/api/context/compact`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: "{}" })).status === 401, "chưa đăng nhập → 401");

await api("DELETE", `/api/skills/${SKILL}`);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
