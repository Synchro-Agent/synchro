// Chế độ Tự động qua cả một đoạn chat: bộ câu có nhãn nhiều lượt trên bộ định tuyến thật (router.inputOfChat, routeModel, needsNoTools), model của lượt trước đi tiếp vào lượt sau như trong sản phẩm.
// Nhãn là điều một người hiểu việc sẽ chọn: việc lớn giữ đúng model qua các câu nối tiếp ngắn, câu cảm ơn hay câu hỏi mới không kéo theo model mạnh, chê thì đổi model, chuyện nguy hiểm không bao giờ thành "làm tiếp".
// Hàm thuần, không cần máy chủ. Mỗi nhãn: t loại việc (hoặc danh sách), max / min hạng model, eMax / eMin nỗ lực, fast đường nhanh, keep giữ model lượt trước, change đổi model, f theo việc trước.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const out = [];
const ok = (c, n, x = "") => { c ? pass++ : fail++; if (!c) out.push(`  ✗ ${n}  ${String(x).slice(0, 220)}`); };
const { router: R } = await loadTs(["router"]);
const ALL = ["sub-claude/fable", "sub-claude/opus", "sub-claude/sonnet", "sub-claude/haiku", "sub-codex/gpt-6.1-astra", "sub-codex/gpt-6.1-sol", "sub-codex/gpt-6-luna", "sub-agy/gemini-3.8-argon", "sub-agy/gemini-3.8-pro", "sub-agy/gemini-3.8-flash", "sub-grok/grok-build", "sub-grok/grok-4.7"];
const CLAUDE = ALL.filter((k) => k.startsWith("sub-claude/")), CODEX = ALL.filter((k) => k.startsWith("sub-codex/"));
const TIER = ["fast", "balanced", "strong"], EFF = ["low", "medium", "high", "extra", "max"];
const DONE = "Đã xong, mình gửi bạn bản đầu tiên ở khung bên cạnh.";
const ART = '<artifact identifier="a" type="html" title="Trang">x</artifact>\nBản đầu tiên đã xong.';

// Mỗi đoạn chat: [tên, [câu người dùng, nhãn, câu trả lời của model (không có thì là DONE)], …]
const CONVS = [
  ["Làm web: hỏi lại, trả lời, chỉnh, chê, cảm ơn, hỏi chuyện khác", [
    ["Làm trang web cho quán cà phê", { t: "build", min: "strong", fast: false }, "Bạn muốn phong cách nào, hiện đại hay cổ điển?"],
    ["Hiện đại, tối giản", { t: "build", f: true, keep: true, min: "strong", fast: false }, ART],
    ["đổi màu xanh đi", { t: "build", f: true, keep: true, fast: false }, ART],
    ["chữ tiêu đề to quá", { t: "build", f: true, keep: true, fast: false }, ART],
    ["cho nó sang hơn", { t: "build", f: true, keep: true, fast: false }, ART],
    ["nút bấm không chạy", { t: "build", change: true, min: "strong", fast: false }, ART],
    ["cảm ơn nhé", { t: "chat", max: "fast", eMax: "low", fast: true }, "Không có gì!"],
    ["Thủ đô của Pháp là gì?", { t: "qa", max: "fast", eMax: "low", fast: true }],
  ]],
  ["Làm web rồi chuyển chuyện: không kéo theo model mạnh", [
    ["Làm website bán hàng cho shop quần áo", { t: "build", min: "strong" }, ART],
    ["giá vàng hôm nay", { t: "qa", max: "balanced", fast: false }, "Giá vàng hôm nay..."],
    ["mấy giờ rồi", { t: ["qa", "chat"], max: "fast", eMax: "low" }, "Bây giờ là 9 giờ."],
    ["mình đi ngủ đây", { max: "fast", eMax: "low" }, "Ngủ ngon nhé!"],
  ]],
  ["Câu trả lời ngắn không có hỏi lại: không thành dựng tiếp", [
    ["Làm app quản lý chi tiêu", { t: "build", min: "strong" }, ART],
    ["Hà Nội", { max: "balanced" }, "Bạn muốn biết gì về Hà Nội?"],
    ["chờ chút", { max: "fast", eMax: "low" }],
  ]],
  ["Làm web rồi than thở: không phải lời chỉnh sản phẩm", [
    ["Làm trang web cho tiệm bánh", { t: "build", min: "strong" }, ART],
    ["mệt quá", { max: "fast", eMax: "low" }, "Nghỉ một chút nhé."],
    ["hôm nay thấy khá hơn rồi", { max: "fast", eMax: "low" }],
  ]],
  ["Làm web rồi kể chuyện đời thường: \"hơn\", \"qua\", \"làm\" không phải lời chỉnh sản phẩm", [
    ["Làm trang web bán hàng cho shop quần áo", { t: "build", min: "strong" }, ART],
    ...["hôm nay em thấy đỡ hơn", "mình thấy buồn hơn", "tôi thấy khỏe hơn", "tối nay trời lạnh hơn", "em thấy đỡ hơn nhé", "toi lam ke toan", "toi qua minh ngu muon", "trong tuan qua co gi moi", "sang nay lam viec met"].map((x) => [x, { max: "fast", eMax: "low" }, "Vậy à."]),
  ]],
  ["Làm web rồi chỉnh bằng \"hơn\", có dấu và không dấu: vẫn là làm tiếp", [
    ["Làm trang web cho studio ảnh cưới", { t: "build", min: "strong" }, ART],
    ...["chữ tiêu đề to hơn", "nút bấm nổi hơn đi", "sang hơn đi", "làm nó gọn hơn", "giọng trang trọng hơn", "chu tieu de to hon", "cho no sang hon", "chu to qua"].map((x) => [x, { t: "build", f: true, keep: true, fast: false }, ART]),
  ]],
  ["Làm web rồi nói chuyện nguy hiểm: không bao giờ là làm tiếp", [
    ["Làm web bán hàng", { t: "build", min: "strong" }, ART],
    ["mình không muốn sống nữa", { t: "qa", fast: false, eMin: "medium", min: "balanced" }],
  ]],
  ["Dịch rồi chuyện sức khỏe", [
    ["Dịch sang tiếng Anh: hôm nay trời đẹp", { t: "translate", max: "fast", eMax: "low", fast: true }, "The weather is nice today."],
    // "còn câu: …" chưa nhận ra là dịch tiếp, nhưng vẫn đúng model và nỗ lực nên không cần đội thêm luật.
    ["còn câu: tôi đi học thì sao", { t: ["translate", "qa"], max: "fast", eMax: "low" }, "I go to school."],
    ["mình bị đau ngực khó thở từ sáng", { t: "qa", fast: false, min: "balanced", eMin: "medium" }, "Hãy gọi cấp cứu..."],
    ["còn trẻ em thì sao", { t: "qa", f: true, fast: false, min: "balanced" }],
  ]],
  ["Viết email ngắn và chỉnh", [
    ["Viết email xin nghỉ phép ngày mai", { t: "write", max: "fast", fast: true }, "Kính gửi anh Nam,\n\nEm xin phép nghỉ ngày mai..."],
    ["ngắn hơn đi", { t: "write", f: true, keep: true, max: "fast", fast: true }, "Em xin nghỉ ngày mai ạ."],
    ["giọng trang trọng hơn", { t: "write", f: true, keep: true, max: "fast", fast: true }, "Kính gửi..."],
    ["ok cảm ơn", { t: "chat", max: "fast", eMax: "low", fast: true }],
  ]],
  ["Slide", [
    ["Làm slide giới thiệu công ty", { t: "build", min: "strong", fast: false }, ART],
    ["thêm một slide về đội ngũ", { t: "build", f: true, keep: true, fast: false }, ART],
    ["slide 3 chữ nhỏ quá", { t: "build", keep: true, fast: false }, ART],
    ["xấu quá", { t: "build", change: true, fast: false }, ART],
  ]],
  // Chỉ có danh từ, không có động từ: vẫn là nhờ làm ra sản phẩm, không phải câu hỏi nhỏ.
  ...[
    ["Slide giới thiệu công ty cho nhà đầu tư", "build", "strong"], ["Landing page cho tiệm bánh", "build", "strong"], ["Poster khai trương quán cà phê", "act"], ["Logo quán trà sữa", "act"],
    ["Bảng lương tháng 10 cho 5 nhân viên", ["act", "data"]], ["Báo cáo doanh thu quý 3", "write"], ["CV xin việc cho lập trình viên", ["write", "code"]],
    ["Slide deck about climate change", "build", "strong"], ["Landing page for a bakery", "build", "strong"], ["Logo for a coffee shop", "act"], ["Excel budget tracker for a family", ["act", "data"]],
    ["Resume for a software engineer", ["write", "code"]], ["Press release for our product launch", "write"], ["Pitch deck for a fintech startup", "build", "strong"], ["Business plan for a bubble tea shop", "analyze"],
  ].map(([text, t, min]) => [`Danh từ: ${text}`, [[text, { t, fast: false, ...(min ? { min } : {}) }]]]),
  ["Code rồi chê", [
    ["Viết code Python đọc file CSV và in tổng từng cột", { t: "code", max: "balanced", fast: false }, "```python\nprint(1)\n```"],
    ["giải thích thêm", { t: "code", f: true, keep: true, fast: false }, "Đoạn này mở tệp..."],
    ["vẫn lỗi", { t: "code", change: true, fast: false }, "```python\nprint(2)\n```"],
    ["ok chạy rồi, cảm ơn", { max: "fast", eMax: "low" }],
  ]],
  ["Gỡ lỗi có dấu vết", [
    ["TypeError: Cannot read properties of undefined (reading 'map')\n    at App (App.jsx:12:5)\nsửa giúp mình", { t: "debug", min: "balanced", eMin: "high", fast: false }, "Lỗi do items chưa có giá trị..."],
    ["vẫn chưa được", { t: "debug", change: true, fast: false }],
  ]],
  ["Toán", [
    ["Giải phương trình x^2 - 5x + 6 = 0", { t: "reason", fast: false, min: "balanced" }, "x = 2 hoặc x = 3"],
    ["giải thích bước 2", { t: "reason", f: true, keep: true }, "Bước 2..."],
    ["Chứng minh căn bậc hai của 2 là số vô tỉ", { t: "reason", eMin: "high" }],
  ]],
  ["Ngôn ngữ", [
    ["Phân biệt make và do trong tiếng Anh", { t: "language", max: "fast", fast: true }, "Make dùng khi..."],
    ["cho thêm ví dụ", { t: "language", f: true, keep: true, max: "fast", fast: true }],
  ]],
  ["Ảnh", [
    ["vẽ con mèo đang ngủ", { t: "act", fast: false, eMin: "medium" }, "Đây là ảnh con mèo."],
    ["đổi nền xanh", { t: "act", f: true, keep: true, fast: false }, "Đã đổi nền."],
    ["đẹp đấy", { max: "fast", eMax: "low" }],
  ]],
  ["Connector", [
    ["đọc email mới trong gmail", { t: "act", fast: false, eMin: "medium" }, "Bạn có 3 email mới."],
    ["trả lời email đầu tiên giúp mình", { t: ["act", "write"], fast: false }, "Mình soạn xong, bạn duyệt nhé."],
  ]],
  ["Thẻ hỏi lại", [
    ["Làm trang web cho phòng khám nha khoa", { t: "build", min: "strong" }, "Chọn một:\n```ask\n{}\n```"],
    ["Phương án 2", { t: "build", f: true, keep: true, min: "strong", fast: false }],
  ]],
  ["Báo cáo dài", [
    ["Viết báo cáo 3000 từ về xu hướng AI", { t: "write", fast: false, eMin: "medium" }, "Phần 1..."],
    ["tiếp đi", { t: "write", f: true, keep: true, fast: false }, "Phần 2..."],
    ["ok", { t: "write", f: true, keep: true, fast: false }],
  ]],
  ["English: build, answer, tweak, complain, thanks, new question", [
    ["Build a landing page for my gym", { t: "build", min: "strong", fast: false }, "Which color scheme do you prefer?"],
    ["blue and white", { t: "build", f: true, keep: true, min: "strong", fast: false }, ART],
    ["make the header bigger", { t: "build", f: true, keep: true, fast: false }, ART],
    ["make it more modern", { t: "build", f: true, keep: true, fast: false }, ART],
    ["the button doesn't work", { t: "build", change: true, fast: false }, ART],
    ["thanks!", { t: "chat", max: "fast", eMax: "low", fast: true }, "You're welcome!"],
    ["What is the capital of Japan?", { t: "qa", max: "fast", eMax: "low", fast: true }],
  ]],
  ["English: writing", [
    ["Write a short thank-you note to my teacher", { t: "write", max: "fast", fast: true }, "Dear Ms. Lan,\n\nThank you..."],
    ["make it warmer", { t: "write", f: true, keep: true, max: "fast", fast: true }, "Dear Ms. Lan..."],
    ["shorter please", { t: "write", f: true, keep: true, max: "fast", fast: true }],
  ]],
  ["English: stakes follow-up", [
    ["I have a fever of 39 and a bad headache", { t: "qa", fast: false, min: "balanced" }, "Drink fluids..."],
    ["what about kids?", { t: "qa", f: true, fast: false, min: "balanced" }],
  ]],
  ["Gõ không dấu", [
    ["lam giup minh trang web ban hang", { t: "build", min: "strong", fast: false }, "Ban muon phong cach nao?"],
    ["hien dai", { t: "build", f: true, keep: true, fast: false }, ART],
    ["cam on nhieu", { t: "chat", max: "fast", eMax: "low", fast: true }],
  ]],
];

let turnsN = 0;
for (const [lists, listName] of [[ALL, "đủ các gói"], [CLAUDE, "chỉ Claude"], [CODEX, "chỉ ChatGPT"]]) {
  for (const [name, turns] of CONVS) {
    const msgs = [];
    let prevModel = null;
    for (const [text, want, reply] of turns) {
      msgs.push({ role: "user", content: text });
      const q = R.inputOfChat(msgs, { prev: prevModel }), r = R.routeModel(q, lists), tier = TIER.indexOf(R.profileOf(r.model).tier), task = R.taskOf(q);
      const tag = `[${listName}] ${name} › "${text.split("\n")[0].slice(0, 50)}"`, got = `${task} ${r.model} ${r.effort}${R.needsNoTools(q) ? " nhanh" : ""}`;
      turnsN++;
      if (want.t && listName === "đủ các gói") ok([].concat(want.t).includes(task), `${tag}: loại việc phải là ${want.t}`, got);
      if (want.max) ok(tier <= TIER.indexOf(want.max) || (want.max === "fast" && lists === CODEX && tier <= 1), `${tag}: model không quá hạng ${want.max}`, got);
      if (want.min && lists !== CODEX) ok(tier >= TIER.indexOf(want.min), `${tag}: model ít nhất hạng ${want.min}`, got);
      if (want.eMax) ok(EFF.indexOf(r.effort) <= EFF.indexOf(want.eMax), `${tag}: nỗ lực không quá ${want.eMax}`, got);
      if (want.eMin) ok(EFF.indexOf(r.effort) >= EFF.indexOf(want.eMin), `${tag}: nỗ lực ít nhất ${want.eMin}`, got);
      if (want.fast !== undefined) ok(R.needsNoTools(q) === want.fast, `${tag}: ${want.fast ? "đi đường nhanh" : "phải có công cụ"}`, got);
      if (want.keep && prevModel) ok(r.model === prevModel, `${tag}: giữ model lượt trước ${prevModel}`, got);
      // Một gói mà đang ở model mạnh nhất thì làm lại bằng chính model đó, nỗ lực nâng lên (không tụt xuống model yếu hơn).
      if (want.change && prevModel && lists === ALL) ok(r.model !== prevModel, `${tag}: bị chê thì đổi model khác ${prevModel}`, got);
      if (want.f) ok(R.isFollowUp(q), `${tag}: phải là câu nối tiếp`, got);
      // Không CLI nào bị chọn khi chuyện chỉ là trò chuyện: Fable tính tiền thật, Grok Build chỉ viết code.
      ok(!/fable/.test(r.model), `${tag}: Tự động không tiêu Fable`, got);
      msgs.push({ role: "assistant", content: reply ?? DONE });
      prevModel = r.model;
    }
  }
}
out.forEach((l) => console.log(l));
console.log(`${CONVS.length} đoạn chat, ${turnsN} lượt (ba bộ gói). Kết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
