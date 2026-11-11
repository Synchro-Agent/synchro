// Poster dựng ở máy chủ bằng Satori (next/og): mẫu MasterPosterTemplate của chủ dự án → PNG 1200×630 × scale, chữ tiếng Việt đúng, không cần gói tạo ảnh.
// Chạy trên Synchro giả lập (npm run dev:mock; đổi địa chỉ bằng SYNCHRO_URL). Đi qua cả /api/poster và generate_image (template "poster-master-og") của lượt chat.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const R = createRequire(path.join(process.cwd(), "package.json")), sharp = R("sharp");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
const api = async (method, p, body) => { const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0]; return r; };
const email = `poster-${Date.now().toString(36)}@synchro.test`, password = "Poster-test-123";
await api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Poster Tester", birthDate: "2000-01-01" } });
await api("POST", "/api/auth/login", { email, password });
await api("POST", "/api/auth/profile", { fullName: "Poster Tester", birthDate: "2000-01-01" });
if (!cookie) { console.error("Không đăng nhập được trên", B); process.exit(1); }
const props = { tag: "Báo cáo quý 3", title: "Tự động hóa đưa biên ròng lên mức kỷ lục", metricValue: "+14,2%", metricLabel: "Biên lợi nhuận ròng", author: "Synchro Research" };

console.log("1. Phông của poster: tệp tĩnh, đủ chữ tiếng Việt, đúng mã băm ghim");
{
  const VN = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ";
  const all = [...new Set([...VN, ...VN.toUpperCase()])];
  const pins = Object.fromEntries([...fs.readFileSync("scripts/fetch-poster-fonts.sh", "utf8").matchAll(/^([0-9a-f]{64}) \S+ (\S+\.ttf)$/gm)].map((m) => [m[2], m[1]]));
  for (const f of ["PlusJakartaSans-Regular.ttf", "PlusJakartaSans-Bold.ttf", "PlusJakartaSans-ExtraBold.ttf"]) {
    const b = fs.readFileSync(path.join("app/design-engine/fonts", f)), u16 = (o) => b.readUInt16BE(o), u32 = (o) => b.readUInt32BE(o), t = {};
    for (let i = 0; i < u16(4); i++) { const o = 12 + i * 16; t[b.toString("latin1", o, o + 4)] = u32(o + 8); }
    const chars = new Set(), cm = t.cmap;
    for (let i = 0; i < u16(cm + 2); i++) { const s = cm + u32(cm + 4 + i * 8 + 4); if (u16(s) !== 4) continue; const n = u16(s + 6) / 2, end = s + 14, start = end + n * 2 + 2, delta = start + n * 2, range = delta + n * 2;
      for (let k = 0; k < n; k++) for (let c = u16(start + k * 2); c <= u16(end + k * 2) && c < 0xffff; c++) { const ro = u16(range + k * 2); const g = ro ? u16(range + k * 2 + ro + (c - u16(start + k * 2)) * 2) : (c + u16(delta + k * 2)) & 0xffff; if (g) chars.add(c); } }
    const miss = all.filter((c) => !chars.has(c.codePointAt(0)));
    const sha = (await import("node:crypto")).createHash("sha256").update(b).digest("hex");
    ok(!miss.length && !t.fvar && pins[f] === sha, `${f}: tĩnh (không fvar), đủ ${all.length} chữ cái tiếng Việt, đúng mã băm ghim`, { miss: miss.join(""), fvar: !!t.fvar, sha });
  }
}

console.log("2. /api/poster");
{
  const r = await api("POST", "/api/poster", { templateId: "poster-master-og", props, scale: 3 });
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = r.ok ? await sharp(buf).metadata() : {};
  ok(r.ok && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && meta.width === 3600 && meta.height === 1890, "PNG 3x đúng 3600×1890", { s: r.status, w: meta.width, h: meta.height, t: buf.subarray(0, 120).toString() });
  if (process.env.SHOTS && r.ok) fs.writeFileSync(path.join(process.env.SHOTS, "poster-satori-3x.png"), buf);
  // Chữ có thật: vùng tiêu đề (trái, giữa dưới) nhiều điểm sáng trên nền tối, ô KPI có màu xanh lục #34D399.
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let bright = 0, green = 0;
  for (let y = Math.round(info.height * 0.45); y < info.height * 0.9; y += 3) for (let x = 0; x < info.width; x += 3) { const i = (y * info.width + x) * 3, [rr, g, bb] = [data[i], data[i + 1], data[i + 2]]; if (rr > 200 && g > 200 && bb > 200) bright++; if (g > 180 && rr < 100 && bb > 120 && bb < 190) green++; }
  ok(bright > 5000 && green > 1000, "tiêu đề trắng và con số KPI xanh lục được vẽ ra", { bright, green });
  const r1 = await api("POST", "/api/poster", { props, scale: 1 }), m1 = r1.ok ? await sharp(Buffer.from(await r1.arrayBuffer())).metadata() : {};
  ok(m1.width === 1200 && m1.height === 630, "scale 1: 1200×630", m1);
  // Lưới nền (mô tả poster của chủ dự án, giống .sx-tpl-poster-grid bản HTML): đường kẻ ô 56px sáng hơn hẳn trong ô ở vùng trống giữa trên, mờ dần ra mép
  // (góc dưới trái gần như không còn), không đổi vùng chữ.
  {
    const { data: d1, info: i1 } = r1.ok ? await sharp(Buffer.from(await (await api("POST", "/api/poster", { props, scale: 1 })).arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : { data: Buffer.alloc(0), info: { width: 0 } };
    const lum = (x, y) => { const i = (y * i1.width + x) * 3; return (d1[i] + d1[i + 1] + d1[i + 2]) / 3; };
    const avg = (f, n) => { let t = 0; for (let k = 0; k < n; k++) t += f(k); return t / n; };
    const vLine = avg((k) => lum(728, 150 + k) - lum(742, 150 + k), 180), hLine = avg((k) => lum(500 + k, 224) - lum(500 + k, 238), 320);
    const edge = avg((k) => lum(56, 590 + (k % 30)) - lum(70, 590 + (k % 30)), 30);
    ok(vLine > 6 && hLine > 6 && vLine < 30 && Math.abs(edge) < 3, "lưới nền mờ: đường kẻ ô 56px thấy rõ ở giữa, nhạt dần ra mép", { vLine: vLine.toFixed(1), hLine: hLine.toFixed(1), edge: edge.toFixed(1) });
  }
  // Dấu tiếng Việt: chữ có dấu khác chữ bỏ dấu ở đúng chỗ (phông dự phòng thiếu chữ thì ra ô vuông giống nhau hoặc mất chữ).
  const a = Buffer.from(await (await api("POST", "/api/poster", { props: { ...props, title: "Đường ưu tiên ệ ữ ặ ỡ" }, scale: 1 })).arrayBuffer());
  const b2 = Buffer.from(await (await api("POST", "/api/poster", { props: { ...props, title: "Duong uu tien e u a o" }, scale: 1 })).arrayBuffer());
  const da = await sharp(a).raw().toBuffer(), db = await sharp(b2).raw().toBuffer();
  let diff = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 60) diff++;
  ok(diff > 400, "tiêu đề tiếng Việt có dấu vẽ đúng dấu (khác hẳn bản không dấu)", diff);
  const bad = await api("POST", "/api/poster", { props: { ...props, title: "x".repeat(200) } });
  ok(bad.status === 400 && /tối đa 90/.test((await bad.json()).error), "tiêu đề quá dài: báo lỗi rõ, không vẽ chữ tràn khung", bad.status);
  const miss = await api("POST", "/api/poster", { props: { tag: "a" } });
  ok(miss.status === 400, "thiếu trường: 400", miss.status);
  const other = await api("POST", "/api/poster", { templateId: "khong-co", props });
  ok(other.status === 400, "mẫu không có: 400", other.status);
  const anon = await fetch(B + "/api/poster", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ props }) });
  ok(anon.status === 401, "chưa đăng nhập: 401", anon.status);
}

console.log("3. generate_image với mẫu poster trong lượt chat (không cần gói tạo ảnh nào)");
{
  const r0 = await (await api("POST", "/api/llm", { async: true, skills: true, model: "auto", conv: `poster-${Date.now()}`, messages: [{ role: "user", content: `Làm poster #tool=generate_image #args=${JSON.stringify({ prompt: "poster báo cáo", template: "poster-master-og", poster: props })}` }] })).json();
  let rn = null; for (const t0 = Date.now(); Date.now() - t0 < 90_000;) { rn = (await (await api("GET", `/api/runs/${r0.run}?json=1`)).json())?.run; if (rn && !["running", "queued", "pending"].includes(rn.status)) break; await sleep(300); }
  const f = rn?.result?.files?.[0];
  ok(rn?.http === 200 && f && f.mime === "image/png", "có đúng một tệp PNG trong câu trả lời", rn?.result ?? rn);
  if (f) {
    const dl = await api("GET", `/api/outputs/${f.id}`), m = await sharp(Buffer.from(await dl.arrayBuffer())).metadata();
    ok(dl.ok && m.width === 3600 && m.height === 1890, "tệp của người dùng là poster 3600×1890", m);
  }
  const res = (rn?.events ?? []).find((e) => e.kind === "res" && /mẫu poster của Synchro/.test(e.text));
  ok(!!res, "kết quả công cụ nói rõ dựng bằng mẫu poster, không nhận là gói tạo ảnh", (rn?.events ?? []).filter((e) => e.kind === "res").map((e) => e.text));
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
