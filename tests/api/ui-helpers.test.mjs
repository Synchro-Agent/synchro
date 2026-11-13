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

// U10: lỗi công cụ xét theo TỪNG lỗi, không theo cả lượt. Lỗi đã được gọi lại thành công (cùng tên, về sau, ok) mới là "đã thử lại";
// lỗi còn lại tô đỏ kể cả khi lượt kết thúc bình thường.
{
  const { worktone: W, "i18n-dict": D } = await loadTs(["worktone", "i18n-dict"]);
  const en = (t) => D.VI2EN[t] ?? D.RULES_EN.map(([re, f]) => { const m = t.match(re); return m ? f(m) : null; }).find(Boolean);
  const T = (...items) => items; // các mục công cụ theo thứ tự seq
  ok(W.toolErrNote(T({ seq: 1, label: "read", ok: true }), T({ seq: 1, label: "read", ok: true }), {}) === null, "không có lỗi: không hiện gì");
  // Lỗi được gọi lại thành công: "1 bước đã thử lại", màu thường.
  const recov = T({ seq: 1, label: "fetch", ok: false }, { seq: 2, label: "fetch", ok: true });
  const done = W.toolErrNote(recov, recov, {});
  ok(done?.text === "1 bước đã thử lại" && done.tone === "soft", "lỗi đã gọi lại thành công: 1 bước đã thử lại, màu thường", JSON.stringify(done));
  // FIX U10: lỗi KHÔNG được gọi lại, trong một lượt KẾT THÚC BÌNH THƯỜNG, vẫn phải tô đỏ (trước đây bị gọi nhầm là "đã thử lại").
  const leak = T({ seq: 1, label: "fetch", ok: false }, { seq: 2, label: "write", ok: true });
  const rem = W.toolErrNote(leak, leak, {});
  ok(rem?.text === "1 lỗi" && rem.tone === "bad", "lỗi chưa gọi lại trong lượt đã xong: 1 lỗi, màu đỏ", JSON.stringify(rem));
  // Lần gọi lại nằm ở DÒNG công cụ sau (sau một lời dẫn) vẫn tính là đã thử lại khi xét trên cả lượt (turn).
  const g1 = T({ seq: 1, label: "fetch", ok: false });
  const turn = T({ seq: 1, label: "fetch", ok: false }, { seq: 5, label: "fetch", ok: true });
  ok(W.toolErrNote(g1, turn, {})?.text === "1 bước đã thử lại", "gọi lại ở dòng sau trong cùng lượt vẫn là đã thử lại");
  // Lượt kết thúc bằng lỗi, còn lỗi: đỏ.
  const fail = T({ seq: 1, label: "a", ok: false }, { seq: 2, label: "b", ok: false });
  const bad = W.toolErrNote(fail, fail, { failed: true });
  ok(bad?.text === "2 lỗi" && bad.tone === "bad", "lượt lỗi, còn 2 lỗi: 2 lỗi, màu đỏ", JSON.stringify(bad));
  // Đang chạy / bị dừng giữa chừng: lỗi chưa gọi lại chưa tô đỏ (model còn có thể gọi lại).
  const one = T({ seq: 1, label: "a", ok: false });
  ok(W.toolErrNote(one, one, { live: true })?.tone === "soft" && W.toolErrNote(one, one, { stopped: true })?.text === "1 lỗi", "đang chạy / bị dừng: chưa tô đỏ, chưa gọi là đã thử lại");
  // R2: gọi lại với THAM SỐ KHÁC (câu tìm đã sửa, trang khác) vẫn là đã thử lại — xét theo loại công cụ, không theo nguyên nhãn.
  const q2 = T({ seq: 1, label: "tìm trên web: tỷ giá usd", ok: false }, { seq: 2, label: "tìm trên web: tỷ giá USD hôm nay vietcombank", ok: true });
  ok(JSON.stringify(W.toolErrNote(q2, q2, {})) === JSON.stringify({ text: "1 bước đã thử lại", tone: "soft" }), "R2: tìm web lỗi rồi tìm lại bằng câu khác thành công: đã thử lại, màu thường");
  const pg = T({ seq: 1, label: "đọc trang web: https://a.example/x", ok: false }, { seq: 2, label: "đọc trang web: https://b.example/y", ok: true });
  ok(W.toolErrNote(pg, pg, {})?.text === "1 bước đã thử lại", "R2: trang A bị chặn, trang B đọc được: đã thử lại");
  const br = T({ seq: 1, label: "mở a.example", ok: false }, { seq: 2, label: "mở b.example", ok: true }, { seq: 3, label: "tìm “giá” trên trang", ok: false }, { seq: 4, label: "tìm “vé” trên trang", ok: true });
  ok(W.toolErrNote(br, br, {})?.text === "2 bước đã thử lại", "R2: bước trình duyệt gọi lại với đích khác vẫn là đã thử lại");
  // Lần gọi cùng loại sau đó cũng lỗi (lần cuối của loại đó lỗi): vẫn đỏ. Khác loại thành công không bù được.
  const still = T({ seq: 1, label: "tìm trên web: A", ok: false }, { seq: 2, label: "tìm trên web: B", ok: false }, { seq: 3, label: "đọc trang web: https://c.example", ok: true });
  const st = W.toolErrNote(still, still, {});
  ok(st?.text === "2 lỗi" && st.tone === "bad", "R2: lần gọi cùng loại cuối cùng vẫn lỗi: còn lỗi, màu đỏ", JSON.stringify(st));
  const other = T({ seq: 1, label: "tạo ảnh: con mèo", ok: false }, { seq: 2, label: "tìm trên web: mèo", ok: true });
  ok(W.toolErrNote(other, other, {})?.tone === "bad", "R2: công cụ khác loại thành công không tính là gọi lại");
  ok(W.toolKind({ label: "x", name: "web_search" }) === "web_search" && W.toolKind({ label: "đọc tệp dự án a.md" }) === W.toolKind({ label: "đọc tệp dự án b.md" }), "R2: loại công cụ: ưu tiên tên, nhãn không dấu ':' vẫn bỏ tham số");
  ok(en("1 bước đã thử lại") === "1 step retried" && en("3 bước đã thử lại") === "3 steps retried" && en("2 lỗi") === "2 failed", "bản tiếng Anh: step / steps retried, failed");
}

// B1: giờ đặt lại hạn mức một nguồn, một định dạng (bảng Mức dùng và thẻ hết hạn mức); chữ tiếng Việt còn sót có bản tiếng Anh.
{
  const fs = await import("node:fs");
  const { resetfmt: R, "i18n-dict": D } = await loadTs(["resetfmt", "i18n-dict"]);
  const en = (t) => D.VI2EN[t] ?? D.RULES_EN.map(([re, f]) => { const m = t.match(re); return m ? f(m) : null; }).find(Boolean);
  const far = new Date(2026, 10, 19, 21, 55).getTime(); // thứ Năm tuần sau 21:55
  ok(R.resetAt(far, "en") === "Resets Thu 9:55 PM" && R.resetAt(far, "vi") === "Đặt lại T5 21:55", "giờ đặt lại tuyệt đối: thứ và giờ, một định dạng mỗi ngôn ngữ", `${R.resetAt(far, "en")} | ${R.resetAt(far, "vi")}`);
  const soon = new Date(2026, 10, 12, 11, 5).getTime(); // cùng ngày 11:05 — vẫn tuyệt đối, không đếm ngược (thẻ memo không có đồng hồ nên không cũ đi)
  ok(R.resetAt(soon, "en") === "Resets Thu 11:05 AM" && R.resetAt(soon, "vi") === "Đặt lại T5 11:05", "dưới 24 giờ vẫn tuyệt đối, không đếm ngược", `${R.resetAt(soon, "en")} | ${R.resetAt(soon, "vi")}`);
  ok(R.resetClock(far, "en") === "Thu 9:55 PM" && R.resetClock(far, "vi") === "T5 21:55", "thứ và giờ dùng chung", R.resetClock(far, "en"));
  const rd = (f) => fs.readFileSync(f, "utf8");
  const page = rd("app/page.tsx"), usage = rd("app/usageui.tsx");
  ok(/return resetAt\(t, en\(\) \? "en" : "vi"\);/.test(usage) && /m\.notice\.at > Date\.now\(\) \? <p data-notr>\{resetAt\(m\.notice\.at, getLang\(\)\)\}<\/p>/.test(page), "bảng Mức dùng và thẻ hết hạn mức cùng gọi resetAt (tuyệt đối, một nguồn)");
  ok(!/weekday: "short", hour: "2-d/.test(page + rd("app/providersui.tsx")), "không còn nơi tự định dạng giờ đặt lại kiểu khác (Thu 09:55 PM)");
  ok(/aria-label=\{tr\("Giao việc cho Synchro"\)\}/.test(rd("app/tasksui.tsx")), "ô Giao việc: aria-label dịch được (ô mang data-notr nên bộ dịch trang bỏ qua)");
  ok(/function ErrCard[^]*?useLangReady\(\);/.test(page), "thẻ lỗi lượt chat vẽ lại khi từ điển về");
  for (const [vi, want] of [["Câu trả lời chưa hoàn thành", "This reply didn't finish"], ["Quét skill rác", "Scan for junk skills"], ["Giao việc cho Synchro", "Give Synchro a job"], ["Không tải được thư viện chụp ảnh", "Couldn't load the screenshot library"], ["Gói subscription", "Subscription plan"], ["Hội thoại", "Dialogue"]])
    ok(en(vi) === want, `bản tiếng Anh: ${vi}`, en(vi));
}

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
