// Xóa đoạn chat dọn hết phần sinh ra từ nó (tệp chỉ nó dùng, tệp do code tạo, kết quả công cụ, lượt chạy), giữ tệp còn được chỗ khác dùng; tự xóa từng tệp tải lên;
// lượt của đoạn chat ẩn danh không ở lại máy chủ. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-chatpurge-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
process.env.DATA_KEY = "chatpurge-key";
process.env.SYNCHRO_EPHEMERAL_MS = "60";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
// .cache/files nằm theo thư mục đang chạy: tách ra thư mục tạm, không đụng dữ liệu thật của máy phát triển.
const root = process.cwd();
const m = await loadTs(["authstore", "chatstore", "fileproc/owners", "outputs", "refs", "runs", "artifactstore", "api/chats/route", "api/files/mine/route", "api/artifacts/route"]);
const { authstore: AS, chatstore: CS, "fileproc/owners": OWN, outputs: OUT, refs: REF, runs: RUN, artifactstore: ART, "api/chats/route": CR, "api/files/mine/route": FR, "api/artifacts/route": AR } = m;
const CACHE = path.join(root, ".cache", "files");
fs.mkdirSync(CACHE, { recursive: true });

const B = "http://localhost:3200";
const u = AS.createUser({ email: `a-${Date.now()}@purge.test`, name: "A", verified: true }), v = AS.createUser({ email: `b-${Date.now()}@purge.test`, name: "B", verified: true });
const mkReq = (method, p, cookie, body) => new Request(B + p, { method, headers: { origin: B, host: "localhost:3200", cookie, "content-type": "application/json", "user-agent": "t" }, body: body === undefined ? undefined : JSON.stringify(body) });
const cookieOf = (user) => AS.createSession(user, mkReq("GET", "/", ""), "password").split(";")[0];
const ca = cookieOf(u), cb = cookieOf(v);
const hex = (c) => c.repeat(40);
const ids = { only: hex("1"), both: hex("2"), proj: hex("3"), other: hex("4"), wiped: hex("5") };
const put = (id) => { fs.writeFileSync(path.join(CACHE, id + ".bin"), "x".repeat(100)); fs.writeFileSync(path.join(CACHE, id + ".json"), JSON.stringify({ name: "ten-goc.txt", kind: "text/plain", blocks: [] })); };
const has = (id) => fs.existsSync(path.join(CACHE, id + ".bin"));
for (const id of Object.values(ids)) put(id);
const chat = (id, msgs) => ({ kind: "chat", id, upd: Date.now(), data: JSON.stringify({ id, title: "t", msgs }) });

try {
  console.log("1. Tệp đã tải lên: liệt kê, tên riêng, xóa từng tệp");
  OWN.claimFile(u.id, ids.only, 100, "hop-dong.pdf");
  OWN.claimFile(u.id, ids.both, 100, "ten-cua-a.txt"); OWN.claimFile(v.id, ids.both, 100, "ten-cua-b.txt");
  OWN.claimFile(u.id, ids.proj, 100, "du-an.txt");
  OWN.claimFile(u.id, ids.other, 100, "rieng.txt");
  let list = await (await FR.GET(mkReq("GET", "/api/files/mine", ca))).json();
  ok(list.files.length === 4 && list.used === 400 && list.quota > 0, "thấy đủ tệp và dung lượng đã dùng", list);
  const lb = await (await FR.GET(mkReq("GET", "/api/files/mine", cb))).json();
  ok(lb.files.length === 1 && lb.files[0].name === "ten-cua-b.txt", "mỗi người thấy tên do chính mình đặt, không thấy tệp người khác", lb);
  const r0 = await FR.DELETE(mkReq("DELETE", `/api/files/mine?id=${ids.only}`, cb));
  ok(r0.status === 404 && has(ids.only), "không xóa được tệp của người khác", r0.status);
  const out = await FR.DELETE(new Request(`${B}/api/files/mine?id=${ids.other}`, { method: "DELETE", headers: { origin: "https://evil.test", host: "localhost:3200", cookie: ca } }));
  ok(out.status === 403 && has(ids.other), "yêu cầu từ trang khác bị từ chối", out.status);

  console.log("2. Xóa đoạn chat");
  const [o1, o2] = OUT.saveOutputs(u.id, [{ path: "a.txt", data: Buffer.from("a") }, { path: "b.txt", data: Buffer.from("b") }]);
  const c1 = chat("111", [{ role: "user", text: "x", fids: { "hop-dong.pdf": ids.only, "ten-cua-a.txt": ids.both, "du-an.txt": ids.proj }, files: ["hop-dong.pdf"] }, { role: "ai", text: "y", outs: [{ id: o1.id }, { id: o2.id }] }]);
  const c2 = chat("222", [{ role: "ai", text: "z", outs: [{ id: o2.id }] }]);
  const p1 = { kind: "project", id: "333", upd: Date.now(), data: JSON.stringify({ id: 333, note: ids.proj }) };
  let r = await CR.PUT(mkReq("PUT", "/api/chats", ca, { items: [c1, c2, p1] }));
  ok(r.status === 200, "đồng bộ đoạn chat", r.status);
  const ref = REF.storeRef(u.id, "111", "tool", "kết quả rất dài");
  const refKeep = REF.storeRef(u.id, "222", "tool", "kết quả khác");
  ART.saveArtifact(u.id, "111", { ident: "a1", title: "A", type: "html", content: "<p>x</p>" });
  r = await CR.PUT(mkReq("PUT", "/api/chats", ca, { items: [{ kind: "chat", id: "111", upd: Date.now() + 5, deleted: true }] }));
  ok(r.status === 200, "xóa đoạn chat", r.status);
  await sleep(100);
  ok(!has(ids.only), "tệp chỉ đoạn chat này dùng: xóa khỏi đĩa");
  ok(has(ids.both) && OWN.mayUse(v.id, ids.both) && !OWN.myFiles(u.id).files.some((f) => f.id === ids.both), "tệp người khác cũng có: chỉ bỏ quyền của người xóa");
  ok(has(ids.proj) && OWN.myFiles(u.id).files.some((f) => f.id === ids.proj), "tệp dự án còn nhắc tới: giữ");
  ok(!OUT.outputFile(u.id, o1.id), "tệp do code tạo chỉ đoạn chat này dùng: xóa");
  ok(OUT.outputFile(u.id, o2.id), "tệp do code tạo còn trong đoạn chat khác (tách nhánh): giữ");
  const refs = AS.db().prepare("SELECT id FROM tool_refs WHERE user_id = ?").all(u.id).map((x) => x.id);
  ok(!refs.includes(ref) && refs.includes(refKeep), "kết quả công cụ theo đoạn chat: xóa đúng của nó", refs);
  ok(ART.listArtifacts(u.id).length === 1, "artifact còn nguyên nếu không chọn xóa (hộp thoại nói rõ)");
  r = await AR.DELETE(mkReq("DELETE", "/api/artifacts?conv=111", ca));
  ok((await r.json()).removed === 1 && !ART.listArtifacts(u.id).length, "chọn xóa cả artifact");

  console.log("3. Xóa tệp một mình, và xóa tất cả");
  r = await FR.DELETE(mkReq("DELETE", `/api/files/mine?id=${ids.other}`, ca));
  ok(r.status === 200 && !has(ids.other), "xóa từng tệp: mất khỏi đĩa ngay", r.status);
  ok(!OWN.mayUse(v.id, ids.other), "tệp đã xóa hẳn: người biết mã băm không nhận làm chủ được");
  OWN.claimFile(u.id, ids.wiped, 100, "w.txt");
  await CR.PUT(mkReq("PUT", "/api/chats", ca, { items: [chat("444", [{ role: "user", text: "x", fids: { "w.txt": ids.wiped } }])] }));
  await CR.PUT(mkReq("PUT", "/api/chats", ca, { wipe: Date.now() + 1000 }));
  await sleep(100);
  ok(!has(ids.wiped), "xóa tất cả đoạn chat: tệp của chúng cũng đi");

  console.log("4. Lượt của đoạn chat ẩn danh");
  RUN.registerExec("t-inc", async () => ({ http: 200, json: { text: "đáp" } }));
  const a = RUN.startRun(u, "t-inc", { incognito: true, messages: ["bí mật"] }, "555");
  ok(AS.db().prepare("SELECT req FROM runs WHERE id = ?").get(a)?.req === null, "không lưu yêu cầu");
  const n = RUN.startRun(u, "t-inc", { messages: ["thường"] }, "666");
  REF.storeRef(u.id, "555", "tool", "kết quả ẩn danh");
  await sleep(20);
  ok(RUN.getRun(a, u.id)?.status === "done", "ngay sau khi xong: trình duyệt vẫn lấy được kết quả");
  await sleep(200);
  ok(!RUN.getRun(a, u.id), "ít phút sau: lượt ẩn danh không còn trên máy chủ");
  ok(!AS.db().prepare("SELECT 1 FROM tool_refs WHERE user_id = ? AND conv = '555'").get(u.id), "kết quả công cụ của nó cũng mất");
  ok(RUN.getRun(n, u.id)?.status === "done", "lượt thường giữ nguyên");
} finally {
  for (const id of Object.values(ids)) for (const x of [".bin", ".json"]) fs.rmSync(path.join(CACHE, id + x), { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
