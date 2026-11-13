// Trần bộ nhớ theo RAM thật (G3): cổng lượt (turngate.globalLimit) tính mức cả máy từ RAM thật thay vì ước lượng 400 MB cố định.
// Không cần máy chủ: nạp turngate bằng loadTs với các biến môi trường khác nhau rồi kiểm công thức, kẹp và việc đặt tay ghi đè.
import os from "node:os";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

// Mỗi lần nạp lại turngate cho một cấu hình (module nhớ kết quả lần đầu nên phải nạp mới để đo lại).
const loadGate = async (envs) => {
  for (const k of ["SYNCHRO_TURNS_GLOBAL", "SYNCHRO_SERVER_RESERVE_MB", "SYNCHRO_CLI_BUDGET_MB", "SYNCHRO_RELAX_LIMITS"]) delete process.env[k];
  Object.assign(process.env, envs);
  return (await loadTs(["turngate"])).turngate;
};

// RAM thật dùng để tính kỳ vọng: trên máy dev (macOS) turngate dùng os.totalmem (không có /proc/meminfo).
const totalMB = Math.round(os.totalmem() / 1048576);

console.log("1. Mức cả máy tính theo RAM thật, kẹp [4, 64]");
{
  const g = await loadGate({ SYNCHRO_SERVER_RESERVE_MB: "2560", SYNCHRO_CLI_BUDGET_MB: "400" });
  // Hồ CLI lấy cả ngân sách (tổng − chừa), không chia phần với workspace / chạy code (W23-1 / R7: bỏ CLI_SHARE 0,5 không có trong Blueprint).
  const want = Math.max(4, Math.min(64, Math.floor((totalMB - 2560) / 400)));
  ok(g.globalLimit() === want, `globalLimit khớp công thức floor((${totalMB}-2560)/400) kẹp [4,64] = ${want}`, g.globalLimit());
  ok(Number.isInteger(g.globalLimit()) && g.globalLimit() >= 4 && g.globalLimit() <= 64, "luôn là số nguyên trong [4, 64]", g.globalLimit());
}

console.log("2. Ngân sách mỗi lượt lớn → kẹp sàn 4; nhỏ → kẹp trần 64");
{
  const big = await loadGate({ SYNCHRO_CLI_BUDGET_MB: String(totalMB * 2), SYNCHRO_SERVER_RESERVE_MB: "0" });
  ok(big.globalLimit() === 4, "ngân sách quá lớn: về sàn 4", big.globalLimit());
  const small = await loadGate({ SYNCHRO_CLI_BUDGET_MB: "20", SYNCHRO_SERVER_RESERVE_MB: "0" });
  ok(small.globalLimit() === 64, "ngân sách rất nhỏ: chạm trần 64", small.globalLimit());
}

console.log("3. Ngân sách lớn hơn thì mức không tăng (đơn điệu)");
{
  // Phải chốt giá trị của a NGAY sau khi nạp a, trước khi nạp b: loadGate ghi đè process.env dùng chung, mà globalLimit() đọc env lúc
  // được gọi — gọi a.globalLimit() sau khi nạp b thì a lại đọc đúng env của b nên hai bên bằng nhau, phép kiểm thành vô nghĩa.
  const a = await loadGate({ SYNCHRO_CLI_BUDGET_MB: "300", SYNCHRO_SERVER_RESERVE_MB: "1024" });
  const av = a.globalLimit();
  const b = await loadGate({ SYNCHRO_CLI_BUDGET_MB: "800", SYNCHRO_SERVER_RESERVE_MB: "1024" });
  ok(b.globalLimit() <= av, "ngân sách 800 ≤ mức của 300", `${b.globalLimit()} vs ${av}`);
}

console.log("4. Đặt tay SYNCHRO_TURNS_GLOBAL ghi đè hoàn toàn (hành vi cũ giữ nguyên)");
{
  const g = await loadGate({ SYNCHRO_TURNS_GLOBAL: "9", SYNCHRO_CLI_BUDGET_MB: "20" });
  ok(g.globalLimit() === 9, "mức đặt tay thắng mọi phép tính", g.globalLimit());
  const bad = await loadGate({ SYNCHRO_TURNS_GLOBAL: "0" });
  ok(bad.globalLimit() === 4, "đặt tay không hợp lệ (0): về 4 như trước", bad.globalLimit());
}

console.log("5. accountTotal không quá 60% mức cả máy");
{
  const g = await loadGate({ SYNCHRO_CLI_BUDGET_MB: "400", SYNCHRO_SERVER_RESERVE_MB: "2560" });
  ok(g.accountTotal() <= Math.ceil(g.globalLimit() * 0.6), "accountTotal ≤ 60% global", `${g.accountTotal()} vs ${g.globalLimit()}`);
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
