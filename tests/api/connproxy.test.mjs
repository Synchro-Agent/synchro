// Connector có hàng trăm công cụ (Vercel, Higgsfield…): model không nhận đủ định nghĩa mỗi lượt (trên máy chủ thật 530 công cụ ≈ 465.000
// token, câu đầu của đoạn chat mới chờ ~18 giây) mà nhận danh mục tên + connector_tools / connector_call; gọi qua connector_call chạy đúng
// công cụ thật. Connector ít công cụ vẫn gửi trực tiếp như cũ.
const B = "http://localhost:3200", LLM = "http://127.0.0.1:4010", MCP = "http://127.0.0.1:4011";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const last = () => fetch(`${LLM}/_debug/last`).then((r) => r.json());
const C = "anthropic/claude-opus-5-5", G = "google/gemini-3.8-flash";
const chat = (model, text) => api("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model, skills: true });

console.log("1. Connector 300 công cụ");
let r = await api("POST", "/api/connectors", { name: "Mock Big", url: `${MCP}/big` });
const id = r.j?.connector?.id;
ok(r.s === 200 && r.j.connector?.status === "ok" && r.j.connector.tools?.length === 300, "kết nối được, đủ 300 công cụ", JSON.stringify(r.j).slice(0, 300));

try {
  console.log("2. Model nhận danh mục và hai công cụ, không phải 300 định nghĩa");
  r = await chat(C, "Chào bạn");
  let L = (await last()).anthropic;
  const names = (L?.tools ?? []).map((t) => t.name);
  ok(names.includes("connector_tools") && names.includes("connector_call"), "có connector_tools và connector_call", names.join(","));
  ok(!names.some((n) => n.startsWith("mock_big__")), "không gửi định nghĩa từng công cụ", names.filter((n) => n.startsWith("mock_big")).length);
  const sys = JSON.stringify(L?.system ?? "");
  ok(/Mock Big \(300 công cụ\)/.test(sys) && sys.includes("list_widget_0") && /và \d+ công cụ khác/.test(sys), "hướng dẫn có danh mục tên công cụ (cắt gọn)", sys.slice(0, 300));
  ok(JSON.stringify(L.tools).length < 21_000, "định nghĩa công cụ gọn", JSON.stringify(L.tools).length);

  console.log("3. Tìm rồi gọi công cụ");
  r = await chat(C, `#tool=connector_tools #args={"query":"list widget 10","connector":"Mock Big"}`);
  L = (await last()).anthropic;
  const res = JSON.stringify(L?.messages ?? []);
  ok(res.includes("## mock_big__list_widget_10") && res.includes("Project id or slug"), "connector_tools trả tên đầy đủ và tham số", res.slice(-600));
  r = await chat(C, `#tool=connector_call #args={"tool":"mock_big__list_widget_10","input":{"project":"synchro"}}`);
  L = (await last()).anthropic;
  const out = JSON.stringify(L?.messages ?? []);
  ok(out.includes("Big list_widget_10") && out.includes("synchro"), "connector_call chạy đúng công cụ với tham số", out.slice(-600));
  r = await chat(C, `#tool=connector_call #args={"tool":"mock_big__khong_co","input":{}}`);
  L = (await last()).anthropic;
  ok(JSON.stringify(L?.messages ?? []).includes("Tìm đúng tên bằng connector_tools"), "tên sai được chỉ cách tìm lại");

  console.log("4. Gemini: tham số dạng chuỗi JSON");
  r = await chat(G, "Chào bạn");
  L = (await last()).google;
  const call = (L?.tools ?? []).map((t) => t.function ?? t).find((t) => t.name === "connector_call");
  ok(call && call.parameters?.properties?.input_json?.type === "string" && !call.parameters.properties.input, "connector_call nhận input_json", JSON.stringify(call).slice(0, 300));
  r = await chat(G, `#tool=connector_call #args={"tool":"mock_big__get_widget_11","input_json":"{\\"project\\":\\"g\\"}"}`);
  L = (await last()).google;
  ok(JSON.stringify(L?.messages ?? []).includes("Big get_widget_11"), "gọi được qua input_json", JSON.stringify(L?.messages ?? []).slice(-400));
} finally {
  if (id) await api("DELETE", `/api/connectors/${id}`);
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
