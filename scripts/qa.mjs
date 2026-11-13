// Kiểm tra toàn bộ trước khi deploy: npm run qa (cần npm run dev:mock:fast đang chạy ở http://localhost:3200, dựng từ đúng mã sẽ deploy).
// Chạy lần lượt các bộ kiểm giao diện bằng Chrome ẩn và toàn bộ bộ kiểm API; chỉ báo đạt khi không bộ nào lỗi. Bộ soát giao diện
// (audit.mjs) không trả mã lỗi nên đọc dòng "━━ Vấn đề (N)". Thêm bộ kiểm mới vào SUITES khi có loại lỗi mới (mỗi loại lỗi người dùng
// gặp phải có một phép thử tự động quét toàn trang).
import { spawn } from "node:child_process";

// Mỗi bộ: [tên, tệp, biến môi trường thêm (tùy chọn)]: một tệp chạy nhiều lần với biến khác nhau (vd. THEME sáng / tối) là nhiều bộ.
// Bộ API chạy trước: các bộ giao diện để lại việc chạy nền ở máy chủ (đặt tên đoạn chat, hội đồng phản biện…) gọi model giả lập liên tục,
// đẩy lời gọi mà bộ API cần kiểm ra khỏi lịch sử 30 lời gọi gần nhất của máy giả lập.
const SUITES = [
  // B3.7: ngân sách tải đầu của trang chủ (JS ≤ 350 KB, CSS ≤ 45 KB gzip) đọc từ bản build của dev:mock:fast; vượt trần chống tăng lại là lỗi.
  // Mã thoát 2: chưa đo được (không có bản build, hay bản build cũ hơn mã nguồn) — không báo đạt khi chưa đo đúng bản sẽ deploy.
  ["Ngân sách tải đầu: JS 350 KB gzip (bắt buộc), CSS 45 KB gzip (CHƯA BẮT BUỘC tới B5, chặn ở trần 100 KB)", "scripts/budget.mjs"],
  ["Toàn bộ bộ kiểm API", "tests/run-all.mjs"],
  ["Soát giao diện toàn trang (sáng/tối × 390/768/1440px)", "tests/ui/audit.mjs"],
  ["Một ca cho mỗi lỗi U2–U14 (390/768/1440px), giao diện sáng", "tests/ui/u-bugs.mjs", { THEME: "light" }],
  ["Một ca cho mỗi lỗi U2–U14 (390/768/1440px), giao diện tối", "tests/ui/u-bugs.mjs", { THEME: "dark" }],
  ["Menu, bảng nổi, gợi ý, vòng Mức dùng", "tests/ui/popovers.mjs"],
  ["Xuất PowerPoint", "tests/ui/pptx.mjs"],
  ["Bộ thiết kế trong khung artifact: chuyển động, phép đo tự kiểm tra, chụp PowerPoint", "tests/ui/design-kit.mjs"],
  ["Đồ họa nâng cao: ảnh chia sẻ và PNG 3x, PowerPoint Morph, biểu đồ ECharts, nền shader 3D", "tests/ui/media-kit.mjs"],
  ["Xem trước Word, Excel, PowerPoint, PDF", "tests/ui/officeview.mjs"],
  ["Quét skill rác", "tests/ui/skillscan.mjs"],
  ["Đoạn chat theo tài khoản, chia sẻ thật", "tests/ui/chatsync.mjs"],
  ["Hộp thoại giữ tiêu điểm, bảng lệnh, đọc to", "tests/ui/dialogs.mjs"],
  ["Chat chạy nền khi chuyển mục", "tests/ui/bgrun.mjs"],
  ["Chữ hiện dần, nút Dừng", "tests/ui/stream.mjs"],
  ["Lỗi, tiêu điểm, bàn phím, sửa tin, phiên hết hạn", "tests/ui/ux-states.mjs"],
  ["Tải lại giữ đoạn chat, mất mạng lúc mở, thẻ kết nối lại, nhãn Cần bạn, một từ điển", "tests/ui/states.mjs"],
  ["Tải lại trang khi đang trả lời", "tests/ui/runs-reload.mjs"],
  ["Khung phủ nằm trên thanh bên", "tests/ui/layers.mjs"],
  ["Khóa Anthropic không gắn với workspace", "tests/ui/wskey.mjs"],
  ["Danh sách model của từng hãng: đo đúng chiều cao, cuộn bên trong khung", "tests/ui/modelsub.mjs"],
  ["Chuyển cảnh đăng nhập → phim → trang chủ", "tests/ui/introfilm.mjs"],
  ["Màn Đăng nhập, Giới thiệu về bạn trên màn thấp", "tests/ui/authfit.mjs"],
  ["Danh sách model lỗi ở lần hỏi đầu", "tests/ui/models-retry.mjs"],
  ["Đăng nhập connector quay về dù có COOP", "tests/ui/connector-login.mjs"],
  ["Ảnh từ URL ngoài trong artifact", "tests/ui/artimg.mjs"],
  ["Tạo ảnh: chip, trạng thái, thẻ ảnh, tải về", "tests/ui/imagegen.mjs"],
  ["Nút studio của plugin, số skill và danh sách ở trang Artifacts", "tests/ui/studio-select.mjs"],
  ["Câu trả lời Markdown trên trang thật: danh sách, công thức, khối code, bảng", "tests/ui/markdown.mjs"],
  ["Bảng trong câu trả lời đo bằng CSS thật: không vỡ chữ, cuộn ngang", "tests/ui/mdtable.mjs"],
  ["Lượt Code mất mạng, gửi khi phiên đang chạy, lỗi lượt theo ngôn ngữ", "tests/ui/codereconnect.mjs"],
  ["Khung chờ đúng kích thước: mở app, danh sách đoạn chat, tin nhắn, khung artifact, cài đặt (đo vị trí và CLS)", "tests/ui/skeletons.mjs"],
];
const only = process.argv.slice(2);

const run = (file, env = {}) => new Promise((ok) => {
  const p = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  let out = "";
  p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
  p.on("close", (code) => ok({ code, out }));
});

const res = [];
for (const [name, file, env] of SUITES) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  console.log(`\n████ ${name} (${file})`);
  const t = Date.now();
  const { code, out } = await run(file, env);
  const issues = /━━ Vấn đề \((\d+)\)/.exec(out);
  const ok = code === 0 && (!issues || issues[1] === "0");
  res.push({ name, ok, s: Math.round((Date.now() - t) / 1000), note: issues ? `${issues[1]} vấn đề` : code === 2 && file === "scripts/budget.mjs" ? "chưa đo: không có bản build hoặc bản build cũ hơn mã nguồn" : code ? `mã thoát ${code}` : "" });
}
console.log("\n████ Tổng kết QA");
for (const r of res) console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${r.s}s)${r.ok ? "" : ` — ${r.note}`}`);
const bad = res.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} bộ chưa đạt: không deploy.` : "\nTất cả đạt.");
process.exitCode = bad ? 1 : 0;
