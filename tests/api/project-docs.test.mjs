// Tài liệu dự án tới được model: tài liệu dài + yêu cầu chung, gõ không dấu, tên tệp luôn có. Chế độ Tự động là mặc định của người dùng mới. Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { llm: L, models: M } = await loadTs(["llm", "models"]);
const clause = (i) => `Điều ${i}. Bên A có trách nhiệm bàn giao tài sản đúng hạn cho bên B theo phụ lục số ${i}.`;
const big = Array.from({ length: 900 }, (_, i) => clause(i + 1)).join("\n\n") + "\n\nĐiều cuối. Tiền đặt cọc là 50 triệu đồng.";
const doc = (name, text) => ({ id: 1, name, kind: "file", text, chars: text.length });
const P = (ctx) => ({ id: 1, name: "p", desc: "", ctx });

console.log("1. Tài liệu dài");
let s = L.buildSystemPrompt(P([doc("hop-dong.pdf", big)]), "Tóm tắt giúp mình");
ok(big.length > 60_000, `tài liệu thử dài ${big.length} ký tự`);
ok(s.includes("hop-dong.pdf") && s.includes("Điều 1.") && s.length > 40_000, "“Tóm tắt giúp mình”: có tên tệp và phần đầu tài liệu", s.slice(0, 200));
ok(s.includes("ký tự đầu"), "cắt ở đâu thì nói rõ cho model");
s = L.buildSystemPrompt(P([doc("hop-dong.pdf", big)]), "abc xyz qqq");
ok(s.includes("Điều 1."), "không khớp đoạn nào: vẫn có phần đầu tài liệu");
s = L.buildSystemPrompt(P([doc("hop-dong.pdf", big)]), "tien dat coc la bao nhieu");
ok(s.includes("50 triệu") && s.length < 30_000, "gõ không dấu vẫn tìm được đoạn có dấu, chỉ gửi các đoạn khớp", s.length);
s = L.buildSystemPrompt(P([doc("hop-dong.pdf", big)]), "Chào bạn");
ok(s.includes("hop-dong.pdf") && !s.includes("Điều 1."), "câu chào: chỉ có tên tệp, không gửi cả tài liệu");
s = L.buildSystemPrompt(P([doc("a.txt", "Nội dung ngắn"), doc("b.txt", big)]), "Tóm tắt các tệp");
ok(s.includes("Nội dung ngắn") && s.includes("Điều 1.") && s.length < L.DOC_HEAD_BUDGET + 5000, "nhiều tệp: tệp ngắn đủ, tệp dài dùng phần còn lại, không vượt ngân sách", s.length);
s = L.buildSystemPrompt(P([doc("ngan.txt", "Hợp đồng ngắn")]), "abc");
ok(s.includes("Hợp đồng ngắn") && s.includes("ngan.txt"), "tài liệu ngắn: đưa hết như cũ");
s = L.buildSystemPrompt(P([{ id: 2, name: "cu.txt", kind: "file", chars: 20000, chunks: ["Đoạn cũ một", "Đoạn cũ hai"] }]), "Tóm tắt");
ok(s.includes("Đoạn cũ một"), "tài liệu cũ chỉ lưu đoạn đã chia vẫn dùng được");

console.log("1b. Trích ngắn tin cũ khi đoạn chat dài đổi model");
{
  const msgs = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `tin số ${i} ${"x".repeat(500)}` }));
  const d = L.olderDigest(msgs);
  ok(d.length <= 8400 && d.includes("tin số 199") && !d.includes("tin số 0 ") && d.split("\n").every((l) => l.length <= 220) && /^(user|assistant):/.test(d), "giới hạn dung lượng, ưu tiên tin gần, mỗi tin một dòng ngắn", d.slice(0, 300));
  ok(L.olderDigest([]) === "", "không có tin cũ: rỗng");
}
console.log("2. Người dùng mới bắt đầu ở Tự động");
const st = (o) => ({ providers: [{ id: "x", name: "Claude", models: [{ key: "sub-claude/fable", name: "Fable" }, { key: "sub-claude/haiku", name: "Haiku" }] }], default: null, allowed: ["*"], effort: {}, loaded: true, ...o });
ok(M.fitModel("", st()) === "auto", "chưa chọn gì, không có mặc định → Tự động");
ok(M.fitModel("", st({ default: "sub-claude/haiku" })) === "sub-claude/haiku", "quản trị viên đặt mặc định → theo mặc định");
ok(M.fitModel("sub-claude/haiku", st()) === "sub-claude/haiku", "đã chọn model → giữ nguyên");
ok(M.fitModel("auto", st()) === "auto", "đang Tự động → giữ nguyên");
ok(M.fitModel("", st({ providers: [] })) === "", "chưa có model nào → để trống");
ok(M.fitModel("", st({ allowed: ["khac/model"] })) === "", "không model nào được phép → để trống");
ok(M.fitModel("hang-da-go/model", st()) === "auto", "model đã chọn không còn: về Tự động");
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
