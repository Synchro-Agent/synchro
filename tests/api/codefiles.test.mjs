// Tệp gửi kèm trong Synchro Code (npm run dev:mock): mọi loại tệp, cả thư mục và .zip nguyên khối được chép vào workspace
// (.synchro/uploads, git bỏ qua); ảnh, PDF, tệp chữ còn được gửi thẳng cho model (khóa API lẫn gói subscription).
// Kèm: gói ChatGPT (Codex) dùng được công cụ của Synchro (không bị "MCP tool call requires approval, but approval policy is never").
import JSZip from "jszip";
import zlib from "node:zlib";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
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
const upload = async (name, buf, type = "application/octet-stream", raw = true) => {
  const fd = new FormData(); fd.append("file", new File([buf], name, { type }));
  const r = await fetch(`${B}/api/files${raw ? "?raw=1" : ""}`, { method: "POST", headers: { origin: B, cookie }, body: fd });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const turn = async (model, text, sid, files) => {
  const r = await fetch(`${B}/api/agent`, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ sid, model, messages: [{ role: "user", content: text }], files }) });
  if (!r.ok) return { status: r.status, events: [], error: (await r.json().catch(() => ({}))).error };
  const t = await r.text();
  const events = t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { status: r.status, events, done: events.find((e) => e.t === "done"), error: events.find((e) => e.t === "error")?.error };
};
const last = async () => (await fetch(`${M}/_debug/last`)).json();

// Ảnh PNG 4×3 thật (đọc được kích thước), tệp chữ, PDF một trang, tệp nhị phân lạ, .zip và cả một thư mục (nén ở trình duyệt).
const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const h = Buffer.alloc(4); h.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([h, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(3, 4); ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(3 * 13, 120))), chunk("IEND", Buffer.alloc(0))]);
const txt = Buffer.from("dong 1\ndong 2\ndong 3\n");
const bin = Buffer.concat([Buffer.from("Cr24"), Buffer.from([3, 0, 0, 0, 0, 1, 2, 0, 255, 254, 0, 7])]);
const zipOf = async (files) => { const z = new JSZip(); for (const [p, c] of Object.entries(files)) z.file(p, c); return z.generateAsync({ type: "nodebuffer" }); };
const zip = await zipOf({ "manifest.json": '{"name":"Thu"}', "icons/a.txt": "x" });
const folder = await zipOf({ "README.md": "# Du an", "src/index.js": "console.log(1)", "src/lib/util.js": "export const a = 1" });

console.log("1. Tải lên mọi loại tệp (chế độ raw của Synchro Code)");
const up = {};
for (const [n, b, t] of [["anh.png", png, "image/png"], ["ghi-chu.txt", txt, "text/plain"], ["goi.crx", bin, "application/x-chrome-extension"], ["tien-ich.zip", zip, "application/zip"], ["du-an.zip", folder, "application/zip"]]) {
  const r = await upload(n, b, t);
  up[n] = r.j?.id;
  ok(r.s === 200 && /^[a-f0-9]{40}$/.test(r.j?.id ?? ""), `tải lên ${n}`, JSON.stringify(r.j));
}
const th = await fetch(`${B}/api/files/thumb?id=${up["anh.png"]}`, { headers: { cookie } });
const thTxt = await fetch(`${B}/api/files/thumb?id=${up["ghi-chu.txt"]}`, { headers: { cookie } });
const thAnon = await fetch(`${B}/api/files/thumb?id=${up["anh.png"]}`);
ok(th.status === 200 && /^image\//.test(th.headers.get("content-type") ?? "") && thTxt.status === 404 && thAnon.status === 401, "ảnh thu nhỏ lấy lại theo mã tệp (thẻ ảnh của tin cũ sau khi tải lại trang); chưa đăng nhập thì không lấy được", `${th.status} ${th.headers.get("content-type")} ${thTxt.status} ${thAnon.status}`);
const binChat = await upload("goi-chat.crx", Buffer.concat([bin, Buffer.from([9])]), "application/octet-stream", false);
ok(binChat.s === 422, "khung chat (không raw) vẫn báo rõ tệp nhị phân không đọc được", JSON.stringify(binChat.j));
const zipChat = await upload("tien-ich.zip", zip, "application/zip", false);
ok(zipChat.s === 200 && /manifest\.json/.test(zipChat.j?.preview ?? ""), "khung chat đọc được .zip: danh sách tệp và nội dung tệp chữ", JSON.stringify(zipChat.j).slice(0, 300));

console.log("2. Gửi kèm cho agent (khóa API Claude): tệp vào workspace, ảnh và chữ tới model");
const sid = String(1790000000000 + Math.floor(Math.random() * 1e6));
const files = [{ id: up["anh.png"], name: "anh.png" }, { id: up["ghi-chu.txt"], name: "ghi-chu.txt" }, { id: up["goi.crx"], name: "goi.crx" }, { id: up["tien-ich.zip"], name: "tien-ich.zip" }, { id: up["du-an.zip"], name: "du-an", folder: true }];
let r = await turn("anthropic/claude-haiku-5-5", "Xem các tệp mình gửi kèm", sid, files);
ok(r.status === 200 && !r.error, "agent chạy xong", JSON.stringify(r.error ?? r.events.slice(-2)));
const L = await last();
const first = L.anthropic?.messages?.[0]?.content;
const blocks = Array.isArray(first) ? first : [];
const note = blocks.find((b) => b.type === "text")?.text ?? "";
ok(/<attachments>/.test(note) && /\.synchro\/uploads\/anh\.png \(ảnh/.test(note) && /\.synchro\/uploads\/goi\.crx/.test(note) && /\.synchro\/uploads\/tien-ich\.zip \(tệp nén \.zip/.test(note), "tin nhắn liệt kê đường dẫn từng tệp trong workspace", note);
ok(/\.synchro\/uploads\/du-an\/ \(thư mục, 3 tệp\)/.test(note) && /src\/lib\/util\.js/.test(note), "thư mục hiện nguyên khối kèm danh sách tệp bên trong", note);
ok(blocks.some((b) => b.type === "image" && b.source?.type === "base64" && b.source.data.length > 20), "Claude nhận ảnh dạng khối image", JSON.stringify(blocks.map((b) => b.type)));
ok(blocks.some((b) => b.type === "text" && /<file name="ghi-chu\.txt"[^>]*>[\s\S]*dong 2/.test(b.text)), "Claude nhận nội dung tệp chữ", JSON.stringify(blocks.map((b) => b.text?.slice(0, 60))));
const ls = async (p) => (await api("POST", "/api/ws", { op: "list", sid, path: p })).j?.entries ?? [];
const names = (await ls(".synchro/uploads")).map((e) => e.name + (e.dir ? "/" : ""));
ok(["anh.png", "ghi-chu.txt", "goi.crx", "tien-ich.zip", "du-an/"].every((n) => names.includes(n)) && !names.some((n) => n.startsWith(".tai-len")), "workspace có đủ tệp, .zip giữ nguyên, thư mục đã giải nén (không còn tệp tạm)", JSON.stringify(names));
const sub = (await ls(".synchro/uploads/du-an/src/lib")).map((e) => e.name);
ok(sub.includes("util.js"), "thư mục giữ nguyên cấu trúc con", JSON.stringify(sub));
const crx = (await api("POST", "/api/ws", { op: "read", sid, path: ".synchro/uploads/goi.crx" })).j;
ok(crx?.binary === true && crx.size === bin.length, "tệp nhị phân chép nguyên byte", JSON.stringify(crx));
const big = Buffer.alloc(13 * 1048576); big.write("END", big.length - 3);
const bigUp = await upload("lon.bin", big);
r = await turn("anthropic/claude-haiku-5-5", "Tệp lớn", sid, [{ id: bigUp.j?.id, name: "lon.bin" }]);
const lon = (await api("POST", "/api/ws", { op: "read", sid, path: ".synchro/uploads/lon.bin" })).j;
ok(lon?.size === big.length, "tệp hơn 12 MB chép đủ (ghi nhiều khúc)", JSON.stringify(lon));

console.log("3. Git bỏ qua .synchro (không lọt vào commit)");
await api("POST", "/api/ws", { op: "git", sid, action: "init" });
const st = (await api("POST", "/api/ws", { op: "git", sid, action: "status" })).j;
ok(st && !JSON.stringify(st).includes(".synchro"), "git status không có .synchro/", JSON.stringify(st).slice(0, 300));

console.log("4. Gói subscription nhận ảnh nguyên dạng");
const C = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];
await api("POST", "/api/engines/claude/login/start", {});
await api("POST", "/api/engines/claude/login/code", { code: await C("claude") });
r = await turn("sub-claude/sonnet", "#media mô tả ảnh", sid, [{ id: up["anh.png"], name: "anh.png" }]);
ok(/MEDIA: image\/png 4x3 \(image\)/.test(r.done?.text ?? ""), "gói Claude (Claude Code) nhận khối ảnh 4×3", JSON.stringify(r.done ?? r.error));
const cx = await api("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${cx.j?.userCode}`);
for (let i = 0; i < 20; i++) { if ((await api("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn) break; await sleep(500); }
r = await turn("sub-codex/gpt-6.1-sol", "#media mô tả ảnh", sid, [{ id: up["anh.png"], name: "anh.png" }]);
ok(/MEDIA: image\/png 4x3 \(--image\)/.test(r.done?.text ?? ""), "gói ChatGPT (Codex) nhận ảnh qua --image", JSON.stringify(r.done ?? r.error));

console.log("5. Gói ChatGPT (Codex) dùng được mọi công cụ của Synchro");
r = await turn("sub-codex/gpt-6.1-sol", 'Đọc tệp #tool=read_file #args={"path":".synchro/uploads/ghi-chu.txt"}', sid);
ok(r.events.some((e) => e.t === "result" && e.ok && /dong 2/.test(e.output)) && !/requires approval/.test(JSON.stringify(r.events)), "Codex gọi read_file của Synchro, không bị chặn vì duyệt", JSON.stringify(r.done ?? r.error ?? r.events).slice(0, 400));

console.log("6. Chế độ Tự động nối mạch: tệp của lượt trước tới được model lượt sau (kể cả đổi hãng)");
const doc = await upload("ke-hoach.txt", Buffer.from("Kế hoạch quý 4: mở chi nhánh Đà Nẵng\n"), "text/plain", false);
const pic = await upload("so-do.png", png, "image/png", false);
const hist = [
  { role: "user", content: [{ type: "text", text: "Đọc kế hoạch và sơ đồ này" }, { type: "file_ref", id: doc.j?.id, name: "ke-hoach.txt" }, { type: "file_ref", id: pic.j?.id, name: "so-do.png" }] },
  { role: "assistant", content: "Mình đã đọc kế hoạch và sơ đồ." },
  { role: "user", content: "Giải thích thêm phần chi nhánh" },
];
r = await api("POST", "/api/llm", { system: "", model: "openai/gpt-6-luna", messages: hist });
const oin = JSON.stringify((await last()).openai?.input ?? []);
ok(r.s === 200 && /Đà Nẵng/.test(oin) && /input_image/.test(oin), "model khác hãng (ChatGPT) ở lượt sau vẫn nhận nội dung tệp và ảnh của lượt trước", oin.slice(0, 400));
r = await api("POST", "/api/llm", { system: "", model: "anthropic/claude-haiku-5-5", messages: hist });
const ain = JSON.stringify((await last()).anthropic?.messages ?? []);
ok(r.s === 200 && /Đà Nẵng/.test(ain) && /"type":"image"/.test(ain) && !/file_ref/.test(ain), "Claude cũng nhận đủ (thẻ tham chiếu đã được dựng lại thành nội dung)", ain.slice(0, 400));

for (const cli of ["claude", "codex"]) await api("POST", `/api/engines/${cli}/logout`);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
