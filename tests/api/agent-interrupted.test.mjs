// Lượt Code chết cùng máy chủ: khi quay lại phải hiện "Đã dừng" kèm lý do, giữ phần đã viết, không trông như đã xong. Tự chạy được, không cần dev:mock.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const { agentfold: F, codemerge: M } = await loadTs(["agentfold", "codemerge"]);
const WHY = "Máy chủ vừa khởi động lại";
const n = { id: 1, parent: 0, ai: "Đang sửa", done: true, steps: [{ k: "text", text: "Đang sửa" }, { k: "tool", id: "a", name: "bash", input: {} }, { k: "ask", id: "q", kind: "bash", title: "x", state: "wait" }] };
const r = F.interruptFolded(n, WHY);
ok(r.done === true && r.stopped === true, "lượt được đánh dấu đã dừng (hiện nhãn Đã dừng)", r);
ok(r.ai.startsWith("Đang sửa") && r.ai.includes(WHY), "giữ phần đã viết, thêm lý do", r.ai);
ok(r.steps.find((x) => x.k === "tool").done === true, "công cụ dở không còn quay mãi", r.steps);
ok(r.steps.find((x) => x.k === "ask").state === "gone", "câu hỏi duyệt cũ không còn chờ", r.steps);
// Bản đã đánh dấu đi lên máy chủ: thiết bị khác còn giữ bản dở cũng nhận đúng.
const stale = { nodes: [{ id: 1, parent: 0, ai: "Đang sửa thêm rất nhiều chữ nữa", done: false, steps: [] }] };
ok(M.mergeData(stale, { nodes: [r] }, false).nodes[0].stopped === true, "gộp với bản dở ở thiết bị khác: bản đã dừng thắng", M.mergeData(stale, { nodes: [r] }, false));
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
