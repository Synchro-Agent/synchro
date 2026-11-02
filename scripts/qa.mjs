// Kiểm tra toàn bộ trước khi deploy: npm run qa (cần npm run dev:mock:fast đang chạy ở http://localhost:3200, dựng từ đúng mã sẽ deploy).
// Chạy lần lượt các bộ kiểm giao diện bằng Chrome ẩn và toàn bộ bộ kiểm API; chỉ báo đạt khi không bộ nào lỗi. Bộ soát giao diện
// (audit.mjs) không trả mã lỗi nên đọc dòng "━━ Vấn đề (N)". Thêm bộ kiểm mới vào SUITES khi có loại lỗi mới (mỗi loại lỗi người dùng
// gặp phải có một phép thử tự động quét toàn trang).
import { spawn } from "node:child_process";

// Bộ API chạy trước: các bộ giao diện để lại việc chạy nền ở máy chủ (đặt tên đoạn chat, hội đồng phản biện…) gọi model giả lập liên tục,
// đẩy lời gọi mà bộ API cần kiểm ra khỏi lịch sử 30 lời gọi gần nhất của máy giả lập.
const SUITES = [
  ["Toàn bộ bộ kiểm API", "tests/run-all.mjs"],
  ["Soát giao diện toàn trang (sáng/tối × máy tính/điện thoại)", "tests/ui/audit.mjs"],
  ["Menu, bảng nổi, gợi ý, vòng Mức dùng", "tests/ui/popovers.mjs"],
  ["Xuất PowerPoint", "tests/ui/pptx.mjs"],
  ["Quét skill rác", "tests/ui/skillscan.mjs"],
  ["Chat chạy nền khi chuyển mục", "tests/ui/bgrun.mjs"],
  ["Chữ hiện dần, nút Dừng", "tests/ui/stream.mjs"],
  ["Tải lại trang khi đang trả lời", "tests/ui/runs-reload.mjs"],
  ["Khung phủ nằm trên thanh bên", "tests/ui/layers.mjs"],
  ["Chuyển cảnh đăng nhập → phim → trang chủ", "tests/ui/introfilm.mjs"],
];
const only = process.argv.slice(2);

const run = (file) => new Promise((ok) => {
  const p = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
  p.on("close", (code) => ok({ code, out }));
});

const res = [];
for (const [name, file] of SUITES) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  console.log(`\n████ ${name} (${file})`);
  const t = Date.now();
  const { code, out } = await run(file);
  const issues = /━━ Vấn đề \((\d+)\)/.exec(out);
  const ok = code === 0 && (!issues || issues[1] === "0");
  res.push({ name, ok, s: Math.round((Date.now() - t) / 1000), note: issues ? `${issues[1]} vấn đề` : code ? `mã thoát ${code}` : "" });
}
console.log("\n████ Tổng kết QA");
for (const r of res) console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${r.s}s)${r.ok ? "" : ` — ${r.note}`}`);
const bad = res.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} bộ chưa đạt: không deploy.` : "\nTất cả đạt.");
process.exitCode = bad ? 1 : 0;
