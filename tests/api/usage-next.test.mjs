// Vòng mức dùng ở chế độ Tự động hiện phần trăm của nguồn sẽ chạy lượt kế tiếp (shared/usagenext.ts). Tài khoản miễn
// phí từng thấy "100%" đỏ vì gói Gemini đã hết, trong khi khóa API chung vẫn chạy lượt sau và mới dùng 2%. Hàm thuần,
// không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const { "shared/usagenext": U } = await loadTs(["shared/usagenext"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x)); };
const G = U.AGY_GROUPS;

console.log("1. Gói Google: mỗi nhóm model một hạn mức");
const agy = [
  { group: G.gemini, usedPct: 100, status: "rejected" },
  { group: G.gemini, usedPct: 64 },
  { group: G.other, usedPct: 30 },
  { group: G.other, usedPct: 12 },
];
ok(U.planPct(agy, G.gemini) === 100, "model Gemini sẽ chạy: nhóm Gemini đã hết là 100%", U.planPct(agy, G.gemini));
ok(U.planPct(agy, G.other) === 30,
  "model Claude / GPT sẽ chạy: phần của nhóm đó (30%), không phải 100%", U.planPct(agy, G.other));
const blocked = [{ usedPct: 100, status: "rejected" }, { group: G.other, usedPct: 5 }];
ok(U.planPct(blocked, G.other) === 5,
  "dòng \"Hạn mức gói\" không ghi nhóm (Gemini bị chặn) không tính cho nhóm Claude / GPT");
ok(U.planPct(blocked, G.gemini) === 100, "… nhưng tính cho nhóm Gemini");
ok(U.planPct([{ usedPct: 20 }, { usedPct: 70, status: "allowed_warning" }]) === 70,
  "gói không chia nhóm: cửa sổ gần chạm nhất");
ok(U.planPct([]) === 0, "chưa đọc được hạn mức: 0");

console.log("2. Khóa API: hạn mức chi phí của Synchro, hạn mức gọi, số dư");
const limits = [{ pct: 2, limit: 2 }, { pct: 1.5, limit: 20 }, { pct: 90, limit: null }];
ok(U.apiPct(limits) === 2,
  "khóa API chung đã dùng 2%: vòng hiện 2% (dòng không giới hạn không tính)", U.apiPct(limits));
ok(U.apiPct(limits, { pct: 40 }, { pct: 10 }) === 40, "hạn mức gọi của hãng gần chạm hơn thì lấy phần đó");
ok(U.apiPct([], null, null) === 0, "không có giới hạn nào: 0");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
