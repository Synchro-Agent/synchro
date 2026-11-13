// Nút Chế độ / Quyền của Synchro Code (R11, W1-06, LIVE-5): dưới 1100px chỉ còn icon nên aria-label và chú thích phải mang giá trị đang chọn;
// Chế độ Tự động không dùng cùng icon tia sáng với Model Tự động. Chỉ đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const cv = fs.readFileSync("app/codeview.tsx", "utf8"), page = fs.readFileSync("app/home.tsx", "utf8");
const { "i18n-dict": D } = await loadTs(["i18n-dict"]);

const modeBtn = cv.match(/<button className="cv-modebtn"[^>]*>/)?.[0] ?? "";
ok(/aria-label=\{`\$\{tr\("Chế độ"\)\}: \$\{m\.short\}`\}/.test(modeBtn), "nút Chế độ: aria-label có giá trị, đúng chữ đang hiện", modeBtn);
ok(/data-tip=\{`\$\{tr\("Chế độ"\)\}: \$\{tr\(m\.label\)\}`\}/.test(modeBtn), "nút Chế độ: chú thích có giá trị (Chế độ: Tự động)", modeBtn);
const permBtn = cv.match(/<button className=\{`cv-modebtn cv-perm[^\n]*?>\{permIcon/)?.[0] ?? "";
ok(/aria-label=\{`\$\{tr\("Quyền"\)\}: \$\{tr\(permShort\)\}`\}/.test(permBtn) && /data-tip=\{`\$\{tr\("Quyền"\)\}: \$\{tr\(permShort\)\}`\}/.test(permBtn), "nút Quyền: aria-label và chú thích có giá trị", permBtn);
ok(!/aria-label="Chế độ (làm việc|quyền)"/.test(cv), "không còn nhãn chung không có giá trị");
const modeIcon = cv.match(/const modeIcon = [^\n]*/)?.[0] ?? "";
ok(/k === "auto" \? <I\.Flow /.test(modeIcon), "Chế độ Tự động dùng icon riêng", modeIcon);
ok(/model === AUTO \? <span className="vlogo"[^>]*><I\.Sparkle/.test(page), "Model Tự động vẫn là tia sáng (khác icon chế độ)");
for (const k of ["Chế độ", "Quyền", "Tự động", "Hỏi trước", "Tự sửa tệp"]) ok(typeof D.VI2EN[k] === "string", `có bản tiếng Anh: ${k}`);

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
