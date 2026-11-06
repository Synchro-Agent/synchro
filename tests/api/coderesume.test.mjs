// Lượt Synchro Code chạy tách khỏi kết nối: ngắt kết nối không dừng lượt, nối lại nhận đủ sự kiện, kết quả được lưu vào phiên, chỉ nút Dừng mới dừng.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const HAIKU = "anthropic/claude-haiku-5-5";
const newSid = () => String(1796000000000 + Math.floor(Math.random() * 1e9));
const seq = (steps) => `Làm theo các bước #seq=${JSON.stringify(steps)}`;
const post = (sid, text, node, signal) => fetch(`${B}/api/agent`, { method: "POST", signal, headers: { "content-type": "application/json", origin: B, cookie },
  body: JSON.stringify({ sid, model: HAIKU, messages: [{ role: "user", content: text }], skills: false, perm: { mode: "auto", allow: [] }, node }) });
const readAll = async (r) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const attach = (sid, after = 0) => fetch(`${B}/api/agent?sid=${sid}&after=${after}`, { headers: { cookie } });
const info = async (sid) => (await api("GET", `/api/agent?sid=${sid}&json=1`));
const until = async (f, ms = 30000) => { const t = Date.now(); for (;;) { const v = await f(); if (v || Date.now() - t > ms) return v; await sleep(250); } };
const SLOW = seq([{ tool: "bash", args: { command: "sleep 2 && echo xong-cham > cham.txt", description: "Chờ rồi ghi" } }]);

console.log("1. Ngắt kết nối không dừng lượt");
{
  const sid = newSid(), nodeId = Date.now();
  const node = { id: nodeId, parent: 0, user: "việc chậm", atts: [], mode: "auto", time: nodeId };
  const ac = new AbortController();
  const r = await post(sid, SLOW, node, ac.signal);
  ok(r.ok, "bắt đầu lượt", r.status);
  const rd = r.body.getReader(), first = new TextDecoder().decode((await rd.read()).value);
  ok(JSON.parse(first.split("\n")[0]).t === "run", "dòng đầu báo lượt", first);
  ac.abort();
  const during = await info(sid);
  ok(during.j?.running === true && during.j?.node === nodeId, "ngắt kết nối xong lượt vẫn chạy", JSON.stringify(during.j));
  ok((await post(sid, SLOW)).status === 409, "phiên đang chạy không nhận lượt thứ hai");
  const ev = await readAll(await attach(sid));
  ok(ev[0].t === "run" && ev.at(-1).t === "end", "nối lại: có mở đầu và kết thúc", ev.map((e) => e.t).join());
  ok(ev.some((e) => e.t === "result" && e.ok) && ev.some((e) => e.t === "done"), "nối lại nhận đủ kết quả dù đã ngắt giữa chừng", ev.map((e) => e.t).join());
  const seqs = ev.filter((e) => e.s && e.t !== "end").map((e) => e.s);
  ok(seqs.every((s, i) => s === i + 1), "sự kiện đánh số liên tục", seqs.join());
  const later = await readAll(await attach(sid, seqs.length - 1));
  ok(later.filter((e) => e.t !== "run" && e.t !== "end").length === 1, "after: chỉ gửi phần chưa nhận", later.map((e) => e.t).join());
  ok((await info(sid)).j?.running === false, "lượt xong thì báo đã xong");
  const saved = await until(async () => { const s = await api("GET", `/api/code/sessions?id=${sid}`); const n = s.j?.data?.nodes?.find((x) => x.id === nodeId); return n?.done ? n : null; });
  ok(saved?.done && saved.user === "việc chậm" && saved.steps?.some((x) => x.k === "tool" && x.done), "máy chủ tự lưu lượt vào phiên khi không còn ai xem", JSON.stringify(saved)?.slice(0, 300));
  await api("DELETE", `/api/code/sessions?id=${sid}`);
}

console.log("2. Chỉ nút Dừng mới dừng");
{
  const sid = newSid(), nodeId = Date.now();
  const r = await post(sid, seq([{ tool: "bash", args: { command: "sleep 8", description: "Chờ lâu" } }]), { id: nodeId, parent: 0, user: "dừng", atts: [], mode: "auto", time: nodeId });
  const read = readAll(r);
  ok((await api("DELETE", `/api/agent?sid=${sid}`)).j?.stopped === true, "bấm Dừng");
  const t = Date.now();
  const ev = await read;
  ok(Date.now() - t < 7000 && ev.at(-1).t === "end" && ev.at(-1).stopped === true, "lượt kết thúc sớm, báo đã dừng", JSON.stringify(ev.at(-1)));
  ok((await api("DELETE", `/api/agent?sid=${sid}`)).j?.stopped === false, "không còn gì để dừng");
  const saved = (await api("GET", `/api/code/sessions?id=${sid}`)).j?.data?.nodes?.find((x) => x.id === nodeId);
  ok(saved?.stopped === true && saved?.done === true, "lượt lưu ở trạng thái đã dừng", JSON.stringify(saved)?.slice(0, 200));
  await api("DELETE", `/api/code/sessions?id=${sid}`);
}

console.log("3. Xóa phiên thì dừng lượt và không tạo lại phiên");
{
  const sid = newSid(), nodeId = Date.now();
  const r = await post(sid, seq([{ tool: "bash", args: { command: "sleep 8", description: "Chờ lâu" } }]), { id: nodeId, parent: 0, user: "xóa", atts: [], mode: "auto", time: nodeId });
  const read = readAll(r);
  await until(async () => (await api("GET", `/api/code/sessions?id=${sid}`)).s === 200, 5000);
  await api("DELETE", `/api/code/sessions?id=${sid}`);
  const ev = await read;
  ok(ev.at(-1).stopped === true, "lượt dừng khi phiên bị xóa", JSON.stringify(ev.at(-1)));
  ok((await api("GET", `/api/code/sessions?id=${sid}`)).s === 404, "phiên đã xóa không sống lại");
}

console.log("4. Phiên không có lượt, người khác không xem được");
{
  ok((await fetch(`${B}/api/agent?sid=${newSid()}`, { headers: { cookie } })).status === 204, "không có lượt: 204");
  ok((await fetch(`${B}/api/agent?sid=${newSid()}`)).status === 401, "chưa đăng nhập: 401");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
