// Sơ đồ D2 (app/d2render.ts, /api/d2): dựng SVG trong sandbox run_code, không mạng, bố cục elk, nhớ theo mã băm, lỗi gọn không lộ đường dẫn máy chủ.
// Phần 1-2 không cần máy chủ: chạy bằng CODE_RUN=local (sandbox-exec của macOS). D2 thật nếu đặt SYNCHRO_D2_BIN=<đường dẫn d2 v0.9.0>
// (bản macOS tải từ trang phát hành, kiểm SHA256SUMS), không thì một tệp d2 giả ghi lại tham số. Phần 3 chạy trên npm run dev:mock (SYNCHRO_URL),
// bỏ qua khi máy chủ không chạy; máy chủ cần SYNCHRO_D2_BIN để vẽ được.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const REAL = process.env.SYNCHRO_D2_BIN && fs.existsSync(process.env.SYNCHRO_D2_BIN) ? process.env.SYNCHRO_D2_BIN : "";
// d2 giả: ghi tham số vào SVG; nguồn có "boom" thì báo lỗi kiểu d2 kèm đường dẫn tuyệt đối của thư mục chạy; "slow" thì treo.
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-d2-fake-"));
const FAKE = path.join(fakeDir, "d2");
fs.writeFileSync(FAKE, `#!/bin/sh
src=""; out=""; args="$*"
for a in "$@"; do case "$a" in -*) ;; *) if [ -z "$src" ]; then src="$a"; else out="$a"; fi ;; esac; done
if grep -q boom "$src"; then echo "err: failed to compile in.d2: $PWD/in.d2:2:3: unknown shape \\"boom\\"" >&2; exit 1; fi
if grep -q slow "$src"; then sleep 60; fi
printf '<?xml version="1.0" encoding="utf-8"?><svg xmlns="http://www.w3.org/2000/svg" data-args="%s"><text>%s</text></svg>' "$args" "$(cat "$src" | head -c 200)" > "$out"
`, { mode: 0o755 });
process.env.CODE_RUN = "local";
process.env.SYNCHRO_D2_BIN = REAL || FAKE;
const { d2render: D } = await loadTs(["d2render"]);
const SRC = "khach: Khách hàng\nmay: Máy chủ dữ liệu {shape: cylinder}\nkhach -> may: Truy vấn\n";

// CODE_RUN=local là sandbox-exec của macOS: máy Linux (CI) chỉ kiểm phần không cần chạy.
const MAC = process.platform === "darwin";
console.log(`1. Dựng SVG trong sandbox (${!MAC ? "bỏ qua: không phải macOS" : REAL ? "D2 thật" : "d2 giả"})`);
if (MAC) {
  const r = await D.renderD2("u-d2", SRC, false);
  ok("svg" in r && /^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(r.svg), "ra SVG", r);
  ok("svg" in r && /Máy chủ dữ liệu/.test(r.svg) && /Khách hàng/.test(r.svg), "chữ tiếng Việt giữ nguyên dấu trong SVG");
  if (!REAL && "svg" in r) ok(/--layout=elk/.test(r.svg) && /--theme=0/.test(r.svg) && !/tala/i.test(r.svg), "bố cục elk, chủ đề sáng; không TALA", r.svg.slice(0, 300));
  if (REAL && "svg" in r) ok(!/<script/i.test(r.svg), "SVG của D2 không có thẻ script");
  const dark = await D.renderD2("u-d2", SRC, true);
  ok("svg" in dark && dark.svg !== r.svg, "nền tối là bản vẽ riêng (chủ đề tối)", REAL ? "" : dark.svg?.slice(0, 200));
  if (!REAL && "svg" in dark) ok(/--theme=200/.test(dark.svg), "nền tối: chủ đề 200");
  // Nhớ theo mã băm: lần sau không chạy sandbox (bỏ d2 đi vẫn ra đúng bản cũ).
  process.env.SYNCHRO_D2_BIN = "/khong-co/d2";
  const again = await D.renderD2("u-khac", SRC, false);
  ok("svg" in again && "svg" in r && again.svg === r.svg, "vẽ lại cùng sơ đồ: lấy bản đã nhớ, không chạy sandbox", again);
  ok(D.cachedD2(SRC, false) === r.svg && D.cachedD2(SRC + " ", false) === null, "cachedD2 (trang chia sẻ) chỉ trả sơ đồ đã vẽ đúng từng ký tự");
  const miss = await D.renderD2("u-d2", "x -> y", false);
  ok("error" in miss && /Sandbox chưa có D2/.test(miss.error), "sandbox chưa có D2: báo rõ cần image mới", miss);
  process.env.SYNCHRO_D2_BIN = REAL || FAKE;
}

console.log("2. Lỗi gọn, giới hạn");
{
  if (MAC) {
    const bad = REAL ? await D.renderD2("u-d2", "a -> {", false) : await D.renderD2("u-d2", "a: boom", false);
    ok("error" in bad && /^dòng \d+:\d+: /.test(bad.error), "lỗi cú pháp ghi theo dòng:cột", bad);
    ok("error" in bad && !/\/(tmp|private|var|Users|home|srv)\//.test(bad.error) && !/in\.d2/.test(bad.error), "lỗi không lộ đường dẫn thư mục chạy", bad);
  }
  ok("error" in await D.renderD2("u-d2", "   \n", false), "sơ đồ trống bị từ chối");
  const long = await D.renderD2("u-d2", "a -> b\n".repeat(4000), false);
  ok("error" in long && /tối đa 20000 ký tự/.test(long.error), "quá 20.000 ký tự bị từ chối", long);
  const tala = await D.renderD2("u-d2", "vars: {\n  d2-config: {\n    layout-engine: tala\n  }\n}\na -> b", false);
  ok("error" in tala && /TALA/.test(tala.error), "bố cục TALA (thương mại) bị từ chối", tala);
  if (!REAL && MAC) {
    const t0 = Date.now(), slow = await D.renderD2("u-d2", "slow -> x", false);
    ok("error" in slow && /20 giây/.test(slow.error) && Date.now() - t0 < 30_000, "treo quá 20 giây thì dừng", slow);
  }
  delete process.env.CODE_RUN;
  const off = await D.renderD2("u-d2", "khong -> chay", false);
  ok("error" in off && /chưa có nơi chạy code/.test(off.error), "máy chủ không có nơi chạy code: báo rõ, không lỗi 500", off);
  process.env.CODE_RUN = "local";
  const src = fs.readFileSync("app/d2render.ts", "utf8");
  ok(/net: false/.test(src) && /timeout: 20/.test(src), "chạy không mạng, tối đa 20 giây");
}

console.log("3. /api/d2 trên máy chủ giả lập");
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const up = await fetch(B + "/api/health").then(() => true).catch(() => false);
if (!up) console.log("  (bỏ qua: máy chủ giả lập không chạy)");
else {
  let cookie = "";
  const api = async (p, body, withCookie = true) => { const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, ...(withCookie && cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0]; return r; };
  const email = `d2-${Date.now().toString(36)}@synchro.test`, password = "D2-test-12345";
  await api("/api/auth/signup", { email, password, profile: { fullName: "D2 Tester", birthDate: "2000-01-01" } });
  await api("/api/auth/login", { email, password });
  await api("/api/auth/profile", { fullName: "D2 Tester", birthDate: "2000-01-01" });
  const code = `web: Trình duyệt ${Date.now()}\napi: Máy chủ API\nweb -> api: HTTPS\n`;
  const anon0 = await api("/api/d2", { code }, false);
  ok(anon0.status === 401, "người lạ (chưa đăng nhập) không chạy được sandbox", anon0.status);
  const r = await api("/api/d2", { code });
  const j = await r.json();
  // Máy chủ giả lập không có D2 (không đặt SYNCHRO_D2_BIN khi chạy npm run dev:mock): chỉ kiểm lời báo rõ ràng, không lỗi 500.
  const noD2 = r.status === 422 && /Sandbox chưa có D2|chưa có nơi chạy code|chỉ chạy được trên macOS/.test(j.error ?? "");
  if (noD2) {
    console.log("  (máy chủ giả lập chưa có D2: đặt SYNCHRO_D2_BIN khi chạy dev:mock để kiểm phần vẽ)");
    ok(true, "chưa có D2: 422 kèm lời báo cần image mới");
  } else {
    ok(r.status === 200 && /<svg\b/.test(j.svg ?? "") && /Máy chủ API/.test(j.svg ?? ""), "đăng nhập: ra SVG", j.error ?? r.status);
    const anon = await api("/api/d2", { code }, false);
    const aj = await anon.json();
    ok(anon.status === 200 && aj.svg === j.svg, "trang chia sẻ: người lạ xem được sơ đồ chủ artifact đã vẽ", anon.status);
    const bad = await api("/api/d2", { code: "a -> {" });
    ok(bad.status === 422 && typeof (await bad.json()).error === "string", "lỗi cú pháp: 422 kèm lời báo");
  }
  const cross = await fetch(B + "/api/d2", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie }, body: JSON.stringify({ code }) });
  ok(cross.status === 403, "khác nguồn gốc bị chặn", cross.status);
}
fs.rmSync(fakeDir, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
