// Hàm thuần dùng chung của giao diện: phím của hàng có vai trò nút, câu báo khi không tới được máy chủ. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { a11y: A, apierr: E } = await loadTs(["a11y", "apierr"]);

const row = {}, inner = {};
const press = (key, target) => { let hit = 0, prevented = false; A.rowKeys(() => hit++)({ key, target, currentTarget: row, preventDefault: () => { prevented = true; } }); return { hit, prevented }; };
ok(press("Enter", row).hit === 1, "Enter trên hàng mở hàng");
const sp = press(" ", row);
ok(sp.hit === 1 && sp.prevented, "Space trên hàng cũng mở, không cuộn trang");
ok(press("Enter", inner).hit === 0 && !press("Enter", inner).prevented, "Enter trên nút ⋮ bên trong không mở hàng, để nút tự xử lý");
ok(press(" ", inner).hit === 0, "Space trên nút bên trong không mở hàng");
ok(press("a", row).hit === 0, "phím khác không làm gì");

const real = globalThis.fetch;
globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
const m = await E.apiFetch("/x").catch((e) => e.message);
ok(m === E.NO_SERVER, "mất mạng: câu dễ hiểu thay cho Failed to fetch", m);
globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
const ab = await E.apiFetch("/x").catch((e) => e.name);
ok(ab === "AbortError", "tự hủy thì giữ nguyên AbortError", ab);
globalThis.fetch = real;
ok(/khởi động lại/.test(E.statusText(502)) && /quá lâu/.test(E.statusText(504)) && /máy chủ/.test(E.statusText(500)) && E.statusText(418) === "Lỗi 418", "câu báo theo mã lỗi HTTP");

ok(/mất mạng/.test(E.termDown(null, false)) && /máy chủ/.test(E.termDown(null, true)), "terminal: chỉ nói mất mạng khi trình duyệt thật sự mất mạng");
ok(E.termDown({ available: false, reason: "Máy chủ chưa bật workspace." }, true) === "Máy chủ chưa bật workspace.", "terminal: nói đúng lý do máy chủ báo");
ok(/đang tắt/.test(E.termDown({ available: true, running: false }, true)) && /vẫn chạy/.test(E.termDown({ available: true, running: true }, true)), "terminal: phân biệt workspace tắt và đang chạy");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
