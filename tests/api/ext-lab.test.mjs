// Mọi thao tác trên trình duyệt, như người thật: gõ (kể cả ô kiểu React, ô soạn thư, phím từng ký tự), chọn (ô chọn, danh sách tự làm, đánh dấu,
// nút gạt, thanh trượt), chuột (bấm, bấm đúp, chuột phải, giữ Shift, rê để mở menu, bấm theo tọa độ trên ảnh chụp), cuộn (khung riêng, cuộn vô tận),
// kéo thả (HTML5 và kéo bằng chuột), tải tệp lên / về, hộp thoại, chờ nội dung, phím tắt, khung con, shadow DOM, nút cố định nằm dưới dải
// "Synchro đang điều khiển", tab mới, biểu mẫu, lùi / tiến, JavaScript, console, mạng, gộp nhiều thao tác. Trang thử: tests/fixtures/browser-lab.html.
// Chạy cùng một chuỗi thao tác ở:
//   ext-mock  tiện ích giả lập (scripts/mock-extension.mjs: mã của tiện ích trên Chrome thật qua lớp giả chrome.*);
//   ext-real  tiện ích thật (Manifest V3) nạp vào Chrome thật bằng Extensions.loadUnpacked, màn hình độ phân giải cao (tỉ lệ 2) như Retina;
//   synchro   trình duyệt của Synchro trong workspace (đối chiếu: hai nơi phải làm được như nhau).
// Lệnh đi thẳng qua cầu nối như máy chủ Synchro gửi (/ext hoặc /browser của dịch vụ workspace). Chọn nơi chạy: LAB_TARGETS=ext-mock,synchro.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CDP, devJson } from "../../workspace/browser-core.mjs";
import { writeExtension } from "../../extension/build.mjs";
import { findChrome } from "../../scripts/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
const WS = process.env.WS_AGENT_URL ?? "http://127.0.0.1:4012", WS_SECRET = process.env.WS_AGENT_SECRET ?? "mock-workspace-secret-for-dev-only-0123456789";
const LAB = `${MOCK}/_fixture/browser-lab`;
const TARGETS = (process.env.LAB_TARGETS ?? "ext-mock,ext-real,synchro").split(",").map((s) => s.trim()).filter(Boolean);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => null) };
};
const EMAIL = "ext-lab@synchro.test";
await api("POST", "/api/auth/signup", { email: EMAIL, password: "Member-pass-123", profile: { fullName: "Ext Lab", birthDate: "2000-01-01" } });
await api("POST", "/api/auth/login", { email: EMAIL, password: "Member-pass-123" });
// Quyền rõ ràng (không dựa vào quyền mặc định của tài khoản mới, có thể đã bị bộ kiểm thử khác đổi): mọi model, mọi tính năng
// (Synchro Code + Cloud sandbox để có trình duyệt của Synchro).
{
  let ac = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  const admin = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie: ac }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) ac = c.split(";")[0];
    return r.json().catch(() => null);
  };
  if (!ac) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
  const u = (await admin("GET", "/api/admin")).users.find((x) => x.email === EMAIL);
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
const U = (await api("GET", "/api/auth/me")).j?.user?.id;
if (!U) { console.error("Không đăng nhập được tài khoản thử."); process.exit(1); }
const removeAll = async () => { for (const d of (await api("GET", "/api/browser/ext")).j?.devices ?? []) await api("POST", "/api/browser/ext", { op: "remove", id: d.id }); };
const chromeBin = findChrome();
const UPLOAD = path.join(os.tmpdir(), `synchro-lab-${process.pid}.txt`);
fs.writeFileSync(UPLOAD, "Tệp thử của Synchro\n".repeat(10));

// Một thao tác browser_* gửi thẳng tới nơi chạy (cùng đường máy chủ Synchro dùng).
function runner(target) {
  const turn = `lab-${target}-${Date.now()}`;
  return async (a) => {
    const [p, body] = target === "synchro" ? ["/browser", { u: U, ...a }] : ["/ext", { u: U, op: "call", a, turn, timeout: 60_000 }];
    const r = await fetch(WS + p, { method: "POST", headers: { authorization: `Bearer ${WS_SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { ...j, error: j.error || `HTTP ${r.status}`, status: r.status };
  };
}
const jpegSize = (b64) => {
  const b = Buffer.from(b64, "base64");
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

// Chuỗi thao tác của một người dùng thật trên trang thử.
async function lab(name, act, o = {}) {
  console.log(`\n== ${name} ==`);
  const st = async () => { const r = await act({ action: "eval", expression: "window.lab()" }); try { return JSON.parse(r.value); } catch { return {}; } };
  const evs = async () => { const r = await act({ action: "eval", expression: "window.__ev" }); try { return JSON.parse(r.value); } catch { return []; } };
  const ref = async (q, role) => {
    const r = await act({ action: "find", query: q });
    const line = (r.matches ?? []).find((l) => !role || new RegExp(`^\\[\\d+\\] ${role}\\b`).test(l));
    return line ? Number(/^\[(\d+)\]/.exec(line)[1]) : null;
  };
  let r = await act({ action: "navigate", url: LAB });
  ok(r.title === "Phòng thử trình duyệt", "mở trang", r);

  console.log("1. Đọc trang");
  r = await act({ action: "read" });
  const tree = String(r.tree ?? "");
  ok(/textbox "Họ và tên \(React\)"/.test(tree) && /combobox "Tỉnh \/ thành"/.test(tree) && /switch "Chế độ tối"/.test(tree), "đọc trang: ô nhập, ô chọn, nút gạt có [ref] kèm nhãn", tree.slice(0, 300));
  ok(/textbox "Mã giảm giá"/.test(tree) && /textbox "Số điện thoại"/.test(tree), "đọc được cả khung con cùng nguồn và shadow DOM");
  ok(!/Synchro (đang điều khiển|is controlling)|"Dừng"|"Stop"/.test(tree), "dải “Synchro đang điều khiển” không lẫn vào nội dung model đọc");
  const inter = await act({ action: "read", filter: "interactive" });
  ok(String(inter.tree).length < tree.length && !/Trang thử mọi kiểu/.test(String(inter.tree)), "chỉ đọc phần tử tương tác (gọn hơn)");
  r = await act({ action: "text", offset: 0, limit: 1000 });
  ok(r.total > 1000 && String(r.text).length === 1000, "đọc chữ theo đoạn (offset, limit)", { total: r.total, len: String(r.text).length });

  console.log("2. Gõ như người thật");
  r = await act({ action: "type", ref: await ref("Họ và tên", "textbox"), text: "Nguyễn Thị Hương", clear: true });
  let s = await st();
  ok(s.react === "Nguyễn Thị Hương", "ô kiểu React nhận đúng chữ tiếng Việt có dấu", s.react);
  ok(s.clickOrder.join(",").startsWith("pointerdown,mousedown,pointerup,mouseup,click"), "bấm vào ô: đủ chuỗi sự kiện thật pointerdown → mousedown → pointerup → mouseup → click", s.clickOrder);
  await act({ action: "type", ref: await ref("Ô thường", "textbox"), text: "Ab 12" });
  s = await st();
  ok(s.keys.join("") === "Ab 12", "gõ từng phím: trang nhận keydown thật cho từng ký tự (ô tìm kiếm, OTP nghe phím vẫn chạy)", s.keys);
  await act({ action: "type", ref: await ref("Ghi chú", "textbox"), text: "Dòng 1\nDòng 2" });
  r = await act({ action: "eval", expression: "document.getElementById('area').value" });
  ok(JSON.parse(r.value) === "Dòng 1\nDòng 2", "ô nhiều dòng: xuống dòng đúng", r.value);
  await act({ action: "type", ref: await ref("Nội dung thư", "textbox"), text: "Chào anh, em gửi báo giá." });
  r = await act({ action: "eval", expression: "document.getElementById('rich').innerText.trim()" });
  ok(JSON.parse(r.value) === "Chào anh, em gửi báo giá.", "ô soạn thư (contenteditable) như Gmail", r.value);
  await act({ action: "click", ref: await ref("Ô 1", "textbox") });
  await act({ action: "key", key: "Tab" });
  s = await st();
  ok(s.focus.at(-1) === "f2", "phím Tab chuyển sang ô kế tiếp", s.focus);

  console.log("3. Chọn");
  r = await act({ action: "select", ref: await ref("Tỉnh / thành", "combobox"), value: "Đà Nẵng" });
  s = await st();
  ok(s.city === "dn" && r.value === "Đà Nẵng", "ô chọn: chọn theo chữ hiện ra", r);
  await act({ action: "click", ref: await ref("Chọn ngân hàng", "button") });
  await act({ action: "click", ref: await ref("Techcombank", "option") });
  s = await st();
  ok(s.bank === "tcb", "danh sách tự làm (mở bằng nút, chọn mục)", s.bank);
  await act({ action: "select", ref: await ref("Nhận bản tin", "checkbox"), value: "true" });
  await act({ action: "select", ref: await ref("Tiết kiệm", "radio"), value: "true" });
  await act({ action: "select", ref: await ref("Chế độ tối", "switch"), value: "true" });
  s = await st();
  ok(s.chk === true && s.ship === "eco" && s.sw === true, "ô đánh dấu, nút chọn một, nút gạt", { chk: s.chk, ship: s.ship, sw: s.sw });
  await act({ action: "select", ref: await ref("Nhận bản tin", "checkbox"), value: "false" });
  ok((await st()).chk === false, "bỏ đánh dấu");
  await act({ action: "select", ref: await ref("Âm lượng", "slider"), value: "75" });
  ok((await st()).range === 75, "thanh trượt (input range)");

  console.log("4. Chuột");
  await act({ action: "click", ref: await ref("Bấm đúp để sửa"), double: true });
  await act({ action: "click", ref: await ref("Chuột phải vào đây"), button: "right" });
  await act({ action: "click", ref: await ref("Xóa mục này") });
  await act({ action: "click", ref: await ref("Giữ Shift khi bấm"), modifiers: "shift" });
  s = await st();
  ok(s.dbl === 1, "bấm đúp", s.dbl);
  ok(s.ctx && s.ctxDel, "chuột phải mở menu riêng của trang rồi chọn mục", { ctx: s.ctx, del: s.ctxDel });
  ok(s.shift === true, "giữ Shift khi bấm");
  ok(!(await ref("Cài đặt nâng cao")), "menu ẩn: chưa rê chuột thì chưa thấy mục con");
  await act({ action: "hover", ref: await ref("Tài khoản") });
  const adv = await ref("Cài đặt nâng cao");
  ok(!!adv, "rê chuột mở menu (CSS :hover)");
  if (adv) await act({ action: "click", ref: adv });
  ok((await st()).adv === true, "bấm mục trong menu vừa mở");
  // Bấm theo tọa độ lấy từ ảnh chụp (canvas, chỗ không có phần tử nào để bấm theo ref).
  await act({ action: "scroll", ref: await ref("Bảng vẽ") });
  const shot = await act({ action: "screenshot" });
  const vp = JSON.parse((await act({ action: "eval", expression: "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, pad: (() => { const r = document.getElementById('pad').getBoundingClientRect(); return { x: r.left, y: r.top }; })() })" })).value);
  const dim = jpegSize(shot.image ?? "");
  ok(dim && Math.abs(dim.w - vp.w) <= 2 && Math.abs(dim.h - vp.h) <= 2, `ảnh chụp theo pixel CSS (${dim?.w}×${dim?.h}, khung nhìn ${vp.w}×${vp.h}, tỉ lệ màn hình ${vp.dpr}): tọa độ trên ảnh bấm đúng chỗ`, { dim, vp });
  await act({ action: "click", x: Math.round(vp.pad.x + 180), y: Math.round(vp.pad.y + 80) });
  s = await st();
  ok(s.pad && Math.abs(s.pad.x - 180) <= 2 && Math.abs(s.pad.y - 80) <= 2, "bấm theo tọa độ x, y trúng chấm đỏ trên canvas", s.pad);

  console.log("5. Cuộn");
  await act({ action: "click", ref: await ref("Mục 47") });
  ok((await st()).listClick === "Mục 47", "khung cuộn riêng: tự cuộn tới “Mục 47” rồi bấm");
  const top0 = JSON.parse((await act({ action: "eval", expression: "scrollY" })).value);
  r = await act({ action: "scroll", dy: 700 });
  const top1 = JSON.parse((await act({ action: "eval", expression: "scrollY" })).value);
  ok(top1 > top0 + 300, "cuộn trang bằng con lăn", { top0, top1, r: r.scroll });
  for (let i = 0; i < 6; i++) await act({ action: "scroll", dy: 4000 });
  await sleep(300);
  ok((await st()).feed > 10, "cuộn vô tận: cuộn xuống cuối thì trang tải thêm bài", (await st()).feed);

  console.log("6. Kéo thả");
  r = await act({ action: "drag", from_ref: await ref("Thẻ công việc"), to_ref: await ref("Thả vào đây") });
  s = await st();
  ok(s.drop === "the-cong-viec", "kéo thả kiểu HTML5 (thẻ Trello / Jira): trang nhận đúng dữ liệu kéo", { drop: s.drop, r: r.error });
  const tr = JSON.parse((await act({ action: "eval", expression: "(() => { document.getElementById('track').scrollIntoView({ block: 'center' }); const t = document.getElementById('track').getBoundingClientRect(), k = document.getElementById('knob').getBoundingClientRect(); return { x: k.left + k.width / 2, y: k.top + k.height / 2, tx: t.left + t.width * 0.75, ty: t.top + t.height / 2 }; })()" })).value);
  await act({ action: "drag", x: Math.round(tr.x), y: Math.round(tr.y), to_x: Math.round(tr.tx), to_y: Math.round(tr.ty) });
  s = await st();
  ok(Math.abs(s.knob - 75) <= 4, "kéo bằng chuột (nút trượt tự làm) tới 75%", s.knob);

  console.log("7. Tải tệp lên, tải về");
  r = await act({ action: "upload", ref: await ref("Ảnh đại diện"), path: UPLOAD });
  s = await st();
  ok(s.files.length === 1 && s.files[0] === `${path.basename(UPLOAD)}:${fs.statSync(UPLOAD).size}`, "chọn tệp trên máy cho ô tải lên", { files: s.files, err: r.error });
  if (o.downloads) {
    r = await act({ action: "click", ref: await ref("Tải ghi chú") });
    await sleep(800);
    r = await act({ action: "wait", ms: 300 });
    const d = await act({ action: "downloads" });
    ok((d.downloads ?? []).some((x) => /ghi-chu-synchro/.test(x.name)), "tải tệp về: Synchro biết tệp vừa tải", d);
  }

  console.log("8. Hộp thoại, chờ, phím");
  r = await act({ action: "click", ref: await ref("Thông báo", "button") });
  ok((r.dialogs ?? []).some((x) => /Đã lưu thay đổi.*OK/.test(x)) && (await st()).dialogs.alert, "alert tự bấm OK và báo lại cho model", r.dialogs);
  r = await act({ action: "click", ref: await ref("Xác nhận", "button") });
  ok((await st()).dialogs.confirm === true && (r.dialogs ?? []).length === 1, "confirm", r.dialogs);
  r = await act({ action: "click", ref: await ref("Nhập mã", "button") });
  ok((await st()).dialogs.prompt === "000000", "prompt nhận giá trị mặc định", r.dialogs);
  await act({ action: "click", ref: await ref("Tải dữ liệu", "button") });
  r = await act({ action: "wait", text: "Đã tải xong", timeout: 5000 });
  ok(r.found === true && (await st()).loaded, "chờ nội dung đến chậm (wait text)", r);
  r = await act({ action: "wait", selector: "#spin:not([hidden])", gone: true, timeout: 3000 });
  ok(r.found === false && !r.timeout, "chờ biểu tượng đang tải biến mất (gone)", r);
  await act({ action: "click", ref: await ref("Mở hộp", "button") });
  ok((await st()).modal === true, "mở hộp");
  await act({ action: "key", key: "Escape" });
  ok((await st()).modal === false, "phím Esc đóng hộp");
  await act({ action: "key", key: "ctrl+k" });
  ok((await st()).palette === true, "phím tắt ctrl+k");

  console.log("9. Khung con, shadow DOM, nút nằm dưới dải điều khiển");
  await act({ action: "type", ref: await ref("Mã giảm giá", "textbox"), text: "SALE50" });
  await act({ action: "click", ref: await ref("Áp dụng", "button") });
  ok((await evs()).includes("apply:SALE50"), "gõ và bấm trong khung con (iframe)");
  await act({ action: "type", ref: await ref("Số điện thoại", "textbox"), text: "0912345678" });
  await act({ action: "click", ref: await ref("Gửi mã", "button") });
  ok((await st()).card === "0912345678", "gõ và bấm trong shadow DOM (web component)");
  await act({ action: "click", ref: await ref("Thanh toán", "button") });
  ok((await st()).fixed === 1, "nút cố định ở cuối trang (ngay dưới dải “Synchro đang điều khiển”): bấm trúng nút, không trúng nút Dừng");

  console.log("10. Tab, biểu mẫu, lịch sử");
  const before = (await act({ action: "tabs", op: "list" })).tabs ?? [];
  r = await act({ action: "click", ref: await ref("Mở trang khuyến mãi", "link") });
  ok(r.title === "Khuyến mãi" && /tab mới/.test(r.note ?? ""), "liên kết mở tab mới: Synchro chuyển sang tab đó", r);
  r = await act({ action: "read" });
  ok(/Trang khuyến mãi/.test(String(r.tree)), "đọc được trang ở tab mới");
  let tabs = (await act({ action: "tabs", op: "list" })).tabs ?? [];
  ok(tabs.length === before.length + 1 && tabs.find((t) => t.active)?.title === "Khuyến mãi", "danh sách tab có tab mới, đang ở tab đó", tabs);
  const labTab = tabs.find((t) => t.title === "Phòng thử trình duyệt");
  r = await act({ action: "tabs", op: "close" });
  tabs = (await act({ action: "tabs", op: "list" })).tabs ?? [];
  ok(tabs.length === before.length, "đóng tab", tabs);
  if (labTab) r = await act({ action: "tabs", op: "switch", id: labTab.id });
  ok(r.title === "Phòng thử trình duyệt", "chuyển về tab cũ", r);
  r = await act({ action: "click", ref: await ref("Mở cửa sổ", "button") });
  ok(r.title === "Khuyến mãi", "window.open mở tab mới: Synchro chuyển theo", r);
  await act({ action: "tabs", op: "close" });
  if (labTab) await act({ action: "tabs", op: "switch", id: labTab.id });
  r = await act({ action: "tabs", op: "new", url: `${LAB}?page=new&from=tabs` });
  ok(r.title === "Khuyến mãi", "mở tab mới theo địa chỉ", r);
  await act({ action: "tabs", op: "close" });
  if (labTab) await act({ action: "tabs", op: "switch", id: labTab.id });
  r = await act({ action: "type", ref: await ref("Tìm sản phẩm", "textbox"), text: "áo khoác", submit: true });
  ok(r.title === "Kết quả tìm kiếm", "gõ rồi Enter gửi biểu mẫu, sang trang kết quả", r);
  r = await act({ action: "text" });
  ok(/Kết quả cho: áo khoác/.test(String(r.text)), "trang kết quả đúng từ khóa", String(r.text).slice(0, 120));
  r = await act({ action: "navigate", url: "back" });
  ok(r.title === "Phòng thử trình duyệt", "lùi trang", r);
  r = await act({ action: "navigate", url: "forward" });
  ok(r.title === "Kết quả tìm kiếm", "tiến trang", r);
  r = await act({ action: "navigate", url: "reload" });
  ok(r.title === "Kết quả tìm kiếm", "tải lại trang", r);

  console.log("11. JavaScript, console, mạng, gộp nhiều thao tác");
  await act({ action: "navigate", url: LAB });
  r = await act({ action: "eval", expression: "document.querySelectorAll('section').length" });
  ok(JSON.parse(r.value) === 10, "chạy JavaScript trong trang", r);
  await act({ action: "click", ref: await ref("Gọi máy chủ", "button") });
  await sleep(500);
  r = await act({ action: "console" });
  ok((r.logs ?? []).some((l) => /lab fetch 200/.test(l)) && (r.requests ?? []).some((l) => /browser-quiz/.test(l)), "console và yêu cầu mạng của trang", r);
  const reread = String((await act({ action: "read", filter: "interactive" })).tree);
  const R = (label) => Number(new RegExp(`\\[(\\d+)\\] [a-z]+ "${label.replace(/[()]/g, "\\$&")}`).exec(reread)?.[1]);
  r = await act({ action: "batch", actions: [
    { action: "type", ref: R("Họ và tên (React)"), text: "Trần Văn Bình", clear: true },
    { action: "select", ref: R("Tỉnh / thành"), value: "Hà Nội" },
    { action: "select", ref: R("Nhận bản tin"), value: "true" },
    { action: "select", ref: R("Giao nhanh"), value: "true" },
    { action: "click", ref: R("Thanh toán") },
    { action: "read", filter: "interactive" },
  ] });
  s = await st();
  ok(r.done === 6 && r.total === 6 && s.react === "Trần Văn Bình" && s.city === "hn" && s.chk && s.ship === "fast" && s.fixed === 1, "gộp 6 thao tác trong một lần gọi (điền cả biểu mẫu)", { done: r.done, s: { react: s.react, city: s.city, chk: s.chk, ship: s.ship, fixed: s.fixed }, err: (r.results ?? []).find((x) => x.error) });
}

// ---------------------------------------------------------------- nơi chạy
for (const target of TARGETS) {
  if (target !== "synchro" && !chromeBin) { console.log(`\n(${target}: máy này không có Chrome, bỏ qua)`); continue; }
  if (target === "ext-mock") {
    await removeAll();
    const code = (await api("POST", "/api/browser/ext", { op: "code" })).j.code;
    const prof = path.resolve("data-mock/ext-lab-mock");
    fs.rmSync(prof, { recursive: true, force: true });
    const proc = spawn(process.execPath, ["scripts/mock-extension.mjs", "--server", B, "--code", code, "--headless", "--quiet", "--profile", prof], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((res) => { let buf = ""; proc.stdout.on("data", (d) => { buf += d; if (buf.includes("{\"ready\"")) res(); }); proc.on("exit", res); setTimeout(res, 30_000); });
    for (let i = 0; i < 40 && !(await api("GET", "/api/browser/ext")).j?.connected; i++) await sleep(250);
    try { await lab("Tiện ích giả lập (ext-mock)", runner("ext"), { downloads: false }); }
    finally { proc.kill("SIGTERM"); await removeAll(); }
  }
  if (target === "ext-real") {
    await removeAll();
    const dir = path.resolve("data-mock/ext-lab-real");
    const ext = writeExtension(process.cwd(), B, path.join(dir, "extension"));
    const prof = path.join(dir, "chrome");
    fs.rmSync(prof, { recursive: true, force: true });
    // Chrome thật, chạy ẩn, màn hình tỉ lệ 2 như Retina; nạp tiện ích qua đường ống DevTools (Chrome có thương hiệu không còn --load-extension).
    const proc = spawn(chromeBin, ["--headless=new", "--enable-unsafe-extension-debugging", "--remote-debugging-pipe", "--remote-debugging-port=0", "--force-device-scale-factor=2",
      "--no-first-run", "--no-default-browser-check", `--user-data-dir=${prof}`, "--window-size=1280,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    let n = 0, buf = Buffer.alloc(0);
    const wait = new Map();
    proc.stdio[4].on("data", (d) => { buf = Buffer.concat([buf, d]); let i; while ((i = buf.indexOf(0)) >= 0) { const m = JSON.parse(buf.subarray(0, i).toString()); buf = buf.subarray(i + 1); const w = m.id && wait.get(m.id); if (w) { wait.delete(m.id); m.error ? w.no(new Error(m.error.message)) : w.ok(m.result); } } });
    const cdp = (method, params = {}, sessionId) => new Promise((ok2, no) => { const id = ++n; wait.set(id, { ok: ok2, no }); proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0"); });
    try {
      let extId;
      try { extId = (await cdp("Extensions.loadUnpacked", { path: ext })).id; }
      catch (e) { console.log(`\n(ext-real: Chrome này không nạp được tiện ích qua DevTools: ${e.message}; bỏ qua)`); continue; }
      await sleep(1200);
      // Ghép nối qua chính cửa sổ của tiện ích, như người dùng.
      const code = (await api("POST", "/api/browser/ext", { op: "code" })).j.code;
      const { targetId } = await cdp("Target.createTarget", { url: `chrome-extension://${extId}/popup.html` });
      const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
      await sleep(600);
      await cdp("Runtime.evaluate", { expression: `(() => { document.querySelector('#code').value = ${JSON.stringify(code)}; document.querySelector('button.pri').click(); })()` }, sessionId);
      for (let i = 0; i < 40 && !(await api("GET", "/api/browser/ext")).j?.connected; i++) await sleep(250);
      ok((await api("GET", "/api/browser/ext")).j?.connected, "tiện ích thật: ghép nối qua cửa sổ tiện ích");
      await cdp("Target.closeTarget", { targetId });
      await lab("Tiện ích thật trong Chrome, màn hình tỉ lệ 2 (ext-real)", runner("ext"), { downloads: true });
    } finally { proc.kill("SIGTERM"); await removeAll(); }
  }
  if (target === "synchro") await lab("Trình duyệt của Synchro (synchro)", runner("synchro"), { downloads: true });
}
fs.rmSync(UPLOAD, { force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
