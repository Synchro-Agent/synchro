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

// U10: lỗi công cụ model đã thử lại không tô đỏ; chỉ lượt kết thúc bằng lỗi mới đỏ.
{
  const { worktone: W, "i18n-dict": D } = await loadTs(["worktone", "i18n-dict"]);
  const en = (t) => D.VI2EN[t] ?? D.RULES_EN.map(([re, f]) => { const m = t.match(re); return m ? f(m) : null; }).find(Boolean);
  ok(W.toolErrNote(0, {}) === null, "không có lỗi: không hiện gì");
  const done = W.toolErrNote(1, {});
  ok(done?.text === "1 bước đã thử lại" && done.tone === "soft", "lượt xong bình thường: 1 bước đã thử lại, màu thường", JSON.stringify(done));
  const bad = W.toolErrNote(2, { failed: true });
  ok(bad?.text === "2 lỗi" && bad.tone === "bad", "lượt lỗi: 2 lỗi, màu đỏ", JSON.stringify(bad));
  ok(W.toolErrNote(1, { live: true })?.tone === "soft" && W.toolErrNote(1, { stopped: true })?.text === "1 lỗi", "đang chạy / bị dừng: chưa tô đỏ, chưa gọi là đã thử lại");
  ok(en("1 bước đã thử lại") === "1 step retried" && en("3 bước đã thử lại") === "3 steps retried" && en("2 lỗi") === "2 failed", "bản tiếng Anh: step / steps retried, failed");
}

// B1: giờ đặt lại hạn mức một nguồn, một định dạng (bảng Mức dùng và thẻ hết hạn mức); chữ tiếng Việt còn sót có bản tiếng Anh.
{
  const fs = await import("node:fs");
  const { resetfmt: R, "i18n-dict": D } = await loadTs(["resetfmt", "i18n-dict"]);
  const en = (t) => D.VI2EN[t] ?? D.RULES_EN.map(([re, f]) => { const m = t.match(re); return m ? f(m) : null; }).find(Boolean);
  const now = new Date(2026, 10, 12, 9, 0).getTime(); // thứ Năm 12/11/2026 9:00 giờ máy
  ok(R.resetWhen(now + 125 * 60_000, "en", now) === "Resets in 2 hr 5 min" && R.resetWhen(now + 125 * 60_000, "vi", now) === "Đặt lại sau 2 giờ 5 phút", "dưới 24 giờ: đếm ngược", R.resetWhen(now + 125 * 60_000, "en", now));
  const far = new Date(2026, 10, 19, 21, 55).getTime(); // thứ Năm tuần sau 21:55
  ok(R.resetWhen(far, "en", now) === "Resets Thu 9:55 PM" && R.resetWhen(far, "vi", now) === "Đặt lại T5 21:55", "xa hơn: thứ và giờ, một định dạng mỗi ngôn ngữ", `${R.resetWhen(far, "en", now)} | ${R.resetWhen(far, "vi", now)}`);
  ok(R.resetClock(far, "en") === "Thu 9:55 PM" && R.resetClock(far, "vi") === "T5 21:55", "thứ và giờ dùng chung", R.resetClock(far, "en"));
  const rd = (f) => fs.readFileSync(f, "utf8");
  const page = rd("app/page.tsx"), usage = rd("app/usageui.tsx");
  ok(/return resetWhen\(t, en\(\) \? "en" : "vi"\);/.test(usage) && /m\.notice\.at > Date\.now\(\) \? <p data-notr>\{resetWhen\(m\.notice\.at, getLang\(\)\)\}<\/p>/.test(page), "bảng Mức dùng và thẻ hết hạn mức cùng gọi resetWhen");
  ok(!/weekday: "short", hour: "2-d/.test(page + rd("app/providersui.tsx")), "không còn nơi tự định dạng giờ đặt lại kiểu khác (Thu 09:55 PM)");
  ok(/aria-label=\{tr\("Giao việc cho Synchro"\)\}/.test(rd("app/tasksui.tsx")), "ô Giao việc: aria-label dịch được (ô mang data-notr nên bộ dịch trang bỏ qua)");
  ok(/function ErrCard[^]*?useLangReady\(\);/.test(page), "thẻ lỗi lượt chat vẽ lại khi từ điển về");
  for (const [vi, want] of [["Câu trả lời chưa hoàn thành", "This reply didn't finish"], ["Quét skill rác", "Scan for junk skills"], ["Giao việc cho Synchro", "Give Synchro a job"], ["Không tải được thư viện chụp ảnh", "Couldn't load the screenshot library"], ["Gói subscription", "Subscription plan"], ["Hội thoại", "Dialogue"]])
    ok(en(vi) === want, `bản tiếng Anh: ${vi}`, en(vi));
}

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
