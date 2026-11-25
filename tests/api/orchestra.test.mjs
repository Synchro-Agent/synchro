// Orchestra (nhiều model làm việc như một công ty): đọc kế hoạch JSON của trưởng nhóm, hồ sơ năng lực, giao việc theo
// thế mạnh / chi phí / hạn mức, quyết định có chia hay không (luật rẻ, không gọi model), và bộ chạy với model giả: song
// song theo tầng, chuyển model dự phòng khi lỗi, trần chi phí, bước duyệt trả lại đúng một lần, dừng giữa chừng. Hàm
// thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 700));
};
const M = await loadTs([
  "server/orchestra/plan", "server/orchestra/profile", "server/orchestra/assign", "server/orchestra/decide",
  "server/orchestra/engine", "router", "shared/orchestra",
]);
const P = M["server/orchestra/plan"], C = M["server/orchestra/profile"], A = M["server/orchestra/assign"];
const D = M["server/orchestra/decide"], E = M["server/orchestra/engine"], R = M.router, S = M["shared/orchestra"];
const J = (x) => JSON.stringify(x);

console.log("1. Đọc kế hoạch của trưởng nhóm");
const goodJson = [
  '{"split": true, "tasks": [',
  ' {"id": "T1", "title": "Tra số liệu", "role": "intern", "needs": ["search", "bogus"], "size": "s",',
  '  "do": "Tìm số liệu xe điện 2025", "out": "bảng", "deps": []},',
  ' {"id": "t2", "title": "Phân tích", "role": "staff", "needs": ["reason"], "size": "l", "do": "Phân tích xu hướng",',
  '  "deps": ["t1"],},',
  "]}",
].join("\n");
let r = P.parsePlan(`Đây là kế hoạch:\n\`\`\`json\n${goodJson}\n\`\`\``);
ok(r.ok && r.plan.split && r.plan.tasks.length === 2, "JSON trong khối ```json, dấu phẩy thừa: đọc được", J(r));
ok(r.ok && r.plan.tasks[0].id === "t1" && r.plan.tasks[1].deps[0] === "t1",
  "id viết hoa được chuẩn hóa, phụ thuộc trỏ đúng",
  J(r.plan?.tasks));
ok(r.ok && r.plan.tasks[0].needs.join() === "search", "thế mạnh lạ bị bỏ", J(r.plan?.tasks[0]));
r = P.parsePlan('{"split": false}');
ok(r.ok && r.plan.split === false, "split false: không chia");
r = P.parsePlan('{"tasks":[{"id":"a","do":"x"}]}');
ok(r.ok && !r.plan.split, "chỉ một nhánh: coi như không chia", J(r));
ok(!P.parsePlan("không có JSON").ok, "không có JSON: báo lỗi để viết lại");
r = P.parsePlan('{"tasks":[{"id":"a","do":"x","deps":["zz"]},{"id":"b","do":"y"}]}');
ok(!r.ok && /zz/.test(r.why), "phụ thuộc không tồn tại: lý do cụ thể", J(r));
r = P.parsePlan('{"tasks":[{"id":"a","do":"x","deps":["b"]},{"id":"b","do":"y","deps":["a"]}]}');
ok(!r.ok && /vòng/.test(r.why), "phụ thuộc vòng tròn bị từ chối", J(r));
r = P.parsePlan('{"tasks":[{"id":"a","title":"A"},{"id":"b","do":"y"}]}');
ok(!r.ok && /"a"/.test(r.why), "nhánh thiếu việc cần làm bị từ chối", J(r));
r = P.parsePlan(J({ tasks: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, do: "x" })) }));
ok(!r.ok && /tối đa/.test(r.why), "quá nhiều nhánh bị từ chối", J(r));
r = P.parsePlan('{"tasks":[{"id":"a","do":"x","role":"ceo"},{"id":"a","do":"y","deps":["a"]}]}');
ok(r.ok && r.plan.tasks[0].role === "staff" && r.plan.tasks[1].id !== "a" && r.plan.tasks[1].deps[0] === "a",
  "vai lạ thành nhân viên; id trùng có hậu tố, phụ thuộc trỏ nhánh đầu", J(r.plan?.tasks));
r = P.parsePlan('{"tasks":[{"id":"a","do":"x"},{"id":"a-2","do":"y"},{"id":"a","do":"z"}]}');
ok(r.ok && new Set(r.plan.tasks.map((t) => t.id)).size === 3, "hậu tố của id trùng không đụng id có sẵn",
  J(r.plan?.tasks));
const lay = P.layers([
  { id: "a", deps: [] }, { id: "b", deps: ["a"] }, { id: "c", deps: [] }, { id: "d", deps: ["b", "c"] },
]);
ok(J(lay) === '[["a","c"],["b"],["d"]]', "xếp tầng: nhánh độc lập cùng tầng", J(lay));

console.log("2. Hồ sơ năng lực");
const opus = C.baseCaps("sub-claude/opus"), apiOpus = C.baseCaps("anthropic/claude-opus-5-5");
const flash = C.baseCaps("google/gemini-3.8-flash"), haiku = C.baseCaps("sub-claude/haiku");
ok(flash.vision > haiku.vision && flash.longctx > haiku.longctx, "Gemini đọc ảnh, tài liệu dài giỏi hơn Haiku",
  J({ flash, haiku }));
ok(opus.search > apiOpus.search && opus.cost > apiOpus.cost, "gói có tìm web dựng sẵn và rẻ hơn khóa API cùng model");
ok(opus.reason > haiku.reason && haiku.speed > opus.speed && haiku.cost > opus.cost,
  "hạng mạnh suy luận giỏi hơn, hạng nhanh nhanh và rẻ hơn");
ok(C.baseCaps("xai/grok-build-0.1").write_vi < 5, "model chỉ viết code không giỏi việc viết");
let L = {};
for (let i = 0; i < 12; i++) L = C.noteStat(L, "sub-claude/haiku", ["search"], i < 6, 30_000);
const learned = C.capsOf("sub-claude/haiku", L);
ok(learned.search < haiku.search - 1, "hay hỏng việc tra cứu: điểm tra cứu tụt", `${haiku.search} → ${learned.search}`);
ok(learned.code === haiku.code, "thế mạnh không liên quan giữ nguyên");
let L2 = {};
for (let i = 0; i < 4; i++) L2 = C.noteStat(L2, "sub-claude/haiku", ["write_vi"], true, 200_000);
ok(C.capsOf("sub-claude/haiku", L2).speed < haiku.speed, "chạy chậm thật: điểm tốc độ giảm");
let L3 = {};
for (let i = 0; i < 300; i++) L3 = C.noteStat(L3, "x", ["code"], true, 1);
ok(L3.x.code.n <= 200, "chỉ giữ chừng 200 lần gần nhất", L3.x.code.n);

console.log("3. Chọn đội và giao việc");
const vendorOf = (key) => (key.startsWith("sub-claude") || key.startsWith("anthropic") ? "anthropic"
  : key.includes("gemini") ? "google" : key.includes("gpt") ? "openai" : "xai");
const mem = (key, o = {}) => {
  const tier = R.tierOf(key);
  return {
    key, vendor: vendorOf(key), cli: /^sub-(\w+)/.exec(key)?.[1] ?? null, caps: C.baseCaps(key),
    level: tier === "fast" ? 0 : tier === "balanced" ? 1 : 2, usdPer1k: key.startsWith("sub-") ? 0 : 0.01,
    low: false, credit: false, codeOnly: /build/.test(key), steady: !key.startsWith("sub-agy"), ...o,
  };
};
const pool = [
  mem("sub-claude/opus"), mem("sub-claude/haiku"), mem("sub-codex/gpt-6-sol"), mem("sub-codex/gpt-6-luna"),
  mem("sub-agy/gemini-3.8-flash"), mem("anthropic/claude-opus-5-5"),
];
const team = A.pickTeam(pool);
ok(team.boss === "sub-claude/opus", "trưởng nhóm: model mạnh nhất, gói trước khóa API", J(team));
ok(team.manager === "sub-codex/gpt-6-sol", "quản lý: hạng cân bằng của hãng khác", J(team));
const creditBoss = A.pickTeam([mem("sub-claude/fable-5-1", { credit: true, level: 3 }), mem("sub-claude/sonnet")]);
ok(creditBoss.boss === "sub-claude/sonnet", "model tính tiền ngoài gói không làm trưởng nhóm");
ok(A.pickTeam([mem("sub-claude/haiku")]).manager === "sub-claude/haiku", "chỉ một model: trưởng nhóm tự duyệt");
ok(A.pickTeam(pool, "sub-codex/gpt-6-sol").boss === "sub-codex/gpt-6-sol",
  "model bộ định tuyến chọn (đủ mạnh) làm trưởng nhóm: câu trả lời cuối không đắt hơn khi không chia");
ok(A.pickTeam(pool, "sub-claude/haiku").boss === "sub-claude/opus",
  "model định tuyến hạng nhanh: chọn model mạnh làm trưởng nhóm");
const lowSol = pool.map((m) => (m.key === "sub-codex/gpt-6-sol" ? { ...m, low: true } : m));
ok(A.pickTeam(lowSol, "sub-codex/gpt-6-sol").boss === "sub-claude/opus",
  "model định tuyến sắp hết hạn mức: không làm trưởng nhóm");
const tk = (id, role, needs, size, deps = []) => ({ id, title: id, role, needs, size, do: "x", out: "", deps });
const tasks = [
  tk("r1", "intern", ["search"], "s"), tk("r2", "intern", ["search"], "s"), tk("r3", "intern", ["search"], "s"),
  tk("img", "staff", ["vision"], "m"), tk("big", "manager", ["reason", "code"], "l", ["r1", "r2"]),
  tk("fmt", "intern", ["cost", "write_vi"], "s", ["big"]),
];
const order = P.layers(tasks);
let pick = A.assign(tasks, order, pool, team);
const tier = (k) => R.tierOf(k);
const small = ["r1", "r2", "r3", "fmt"];
ok(small.every((id) => tier(pick[id].model) === "fast"), "việc thực tập về model nhanh, rẻ", J(pick));
ok(small.every((id) => pick[id].model.startsWith("sub-")), "việc nhỏ chạy trên gói, không tốn khóa API", J(pick));
ok(new Set(["r1", "r2", "r3"].map((id) => pick[id].model)).size >= 2,
  "nhánh cùng tầng chia cho nhiều model để chạy song song",
  J(pick));
ok(pick.img.model.includes("gemini"), "việc đọc ảnh về Gemini", J(pick.img));
ok(tier(pick.big.model) === "strong", "việc nặng, khó về model mạnh", J(pick.big));
ok(!Object.values(pick).some((p) => p.model === "anthropic/claude-opus-5-5"),
  "khóa API đắt không nhận việc khi gói làm được",
  J(pick));
ok(Object.values(pick).every((p) => p.alt.length >= 1 && !p.alt.includes(p.model)),
  "mỗi nhánh có model dự phòng khác model chính");
const cliOf = (k) => /^sub-(\w+)/.exec(k)?.[1] ?? "api";
ok(pick.r1.alt[0] && cliOf(pick.r1.alt[0]) !== cliOf(pick.r1.model),
  "dự phòng đầu tiên ở gói khác (lỗi của một gói không kéo cả hai lần)", J(pick.r1));
const lowKeys = ["sub-claude/haiku", "sub-codex/gpt-6-luna"];
const lowPool = pool.map((m) => (lowKeys.includes(m.key) ? { ...m, low: true } : m));
pick = A.assign(tasks, order, lowPool, team);
ok(!["r1", "r2", "r3"].some((id) => lowKeys.includes(pick[id].model)),
  "gói sắp hết hạn mức không nhận việc khi còn gói khác",
  J(pick));
pick = A.assign([tasks[0], tasks[1]], [["r1", "r2"]], [mem("sub-claude/opus"), mem("sub-claude/haiku")],
  { boss: "sub-claude/opus", manager: "sub-claude/opus" });
ok(pick.r1.model === "sub-claude/haiku" && pick.r2.model === "sub-claude/haiku",
  "một model nhận nhiều việc khi hợp nhất; trưởng nhóm không làm việc vặt", J(pick));
pick = A.assign([{ ...tasks[0], needs: ["code"] }, { ...tasks[1], needs: ["write_vi"] }], [["r1", "r2"]],
  [...pool, mem("xai/grok-build-0.1")], team);
ok(pick.r2.model !== "xai/grok-build-0.1", "model chỉ viết code không nhận việc viết", J(pick));
ok(A.missing([mem("anthropic/claude-haiku-5-5")], ["search", "vision"]).join() === "search,vision",
  "báo thế mạnh hiếm không ai có");

console.log("4. Có chia việc không (luật rẻ, không gọi model)");
const q = (text, o = {}) => ({ ...R.inputOfChat([{ role: "user", content: text }]), ...o });
const split = (text, o = {}, n = 4) => D.shouldSplit(q(text, o), { pool: n, autopilot: !!o.autopilot });
const simple = [
  "2+2 bằng mấy", "Xin chào", "Dịch sang tiếng Anh: Tôi yêu Việt Nam", "Thủ đô của Pháp là gì?",
  "Viết email xin nghỉ phép ngày mai", "So sánh iPhone 16 và Galaxy S25", "Giải thích đệ quy là gì",
  "Viết hàm Python đảo ngược chuỗi", "Tóm tắt đoạn văn này giúp mình: Hôm nay trời đẹp, mình đi chơi công viên.",
  "So sánh hai mẫu điện thoại này giúp mình, người lớn tuổi nên dùng cái nào cho dễ đọc chữ?",
];
for (const t of simple) ok(!split(t).split, `một nhánh, chạy một model: "${t}"`, J(split(t)));
const multi = [
  "Tìm hiểu thị trường xe điện ở Việt Nam năm 2025 (doanh số, các hãng chính, chính sách ưu đãi) rồi viết báo cáo"
    + " 2 trang có bảng so sánh và khuyến nghị cho nhà đầu tư",
  "Research the top 5 project management tools, compare pricing and features, then write a recommendation report"
    + " for a 20-person startup",
  "Hãy nghiên cứu đối thủ cạnh tranh của quán cà phê mình ở Quận 1, thu thập giá và menu, sau đó lập kế hoạch"
    + " marketing 3 tháng và kiểm tra lại các con số",
];
for (const t of multi) ok(split(t).split, `nhiều nhánh, chia cho nhóm: "${t.slice(0, 60)}…"`, J(split(t)));
ok(!split(multi[0], {}, 1).split, "chỉ một model dùng được: không chia");
ok(!split(multi[0], { images: 1, attachments: 1 }).split, "có ảnh đính kèm: một model đọc ảnh");
ok(!split(multi[0], { answeredAsk: true }).split, "trả lời thẻ hỏi lại: không chia");
ok(!D.shouldSplit(q("tiếp đi", { prevAsk: multi[0] }), { pool: 4 }).split, "câu nối tiếp ngắn: không chia");
const job = "Mỗi sáng tổng hợp tin tức công nghệ mới nhất rồi viết bản tin ngắn gửi cho mình";
ok(D.shouldSplit(q(job), { pool: 4, autopilot: true }).split, "việc Autopilot nhiều bước: chia cho nhóm",
  J(D.shouldSplit(q(job), { pool: 4, autopilot: true })));
let t0 = performance.now();
for (let i = 0; i < 200; i++) split(simple[i % simple.length]);
ok((performance.now() - t0) / 200 < 5, "quyết định rẻ: dưới 5 ms mỗi lượt",
  `${((performance.now() - t0) / 200).toFixed(2)} ms`);

console.log("5. Bộ chạy với model giả");
const PLAN = J({ split: true, tasks: [
  { id: "a", title: "Tra A", role: "intern", needs: ["search"], size: "s", do: "tra A", out: "ý chính", deps: [] },
  { id: "b", title: "Tra B", role: "intern", needs: ["search"], size: "s", do: "tra B", out: "ý chính", deps: [] },
  { id: "c", title: "Tra C", role: "intern", needs: ["search"], size: "s", do: "tra C", out: "ý chính", deps: [] },
  { id: "d", title: "Phân tích", role: "staff", needs: ["reason"], size: "m", do: "phân tích A B C", out: "nhận định",
    deps: ["a", "b", "c"] },
] });
const BUDGET = { maxUsd: 1, maxCalls: 20, deadlineMs: 60_000, parallel: 3 };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const idOf = (c) => /<phan_viec id="(\w+)"/.exec(c.prompt)?.[1];
// Model giả: plan → kế hoạch; review → theo hàm; còn lại → chữ của nhánh, có thể lỗi theo model.
const fake = (o = {}) => {
  const log = [], states = [], learnt = [];
  let live = 0, peak = 0;
  const plans = () => log.filter((x) => x.job === "orchestra-plan").length;
  const deps = {
    call: async (c) => {
      log.push(c);
      if (c.job === "orchestra-plan") return { text: o.plan ? o.plan(plans()) : PLAN, tokens: 100, usd: 0 };
      if (c.job === "orchestra-review") return { text: o.review ? o.review(c) : '{"reviews":[]}', tokens: 50, usd: 0 };
      live++; peak = Math.max(peak, live);
      await sleep(o.ms ?? 30);
      live--;
      if (o.fail?.(c)) throw new Error(`lỗi giả của ${c.model}`);
      const fixed = c.prompt.includes("<quan_ly_yeu_cau_sua>") ? " (đã sửa)" : "";
      return { text: `kết quả ${idOf(c)} bởi ${c.model}${fixed}`, tokens: 40, usd: o.usd ?? 0 };
    },
    emit: (s) => states.push(s), name: (k) => k.split("/").pop(), learn: (k, n, good) => learnt.push([k, good]),
    aborted: o.aborted ?? (() => false),
  };
  return { deps, log, states, learnt, peak: () => peak };
};
const go = (f, o = {}) => E.orchestrate({ ask: "việc lớn", pool: o.pool ?? pool, team: o.team ?? team,
  budget: o.budget ?? BUDGET },
  f.deps);
let f = fake();
let out = await go(f);
ok(out.ok && out.results.length === 4, "chạy hết các nhánh, kết quả chuyển lên trưởng nhóm", J(out).slice(0, 400));
ok(f.peak() === 3, "ba nhánh độc lập chạy song song", f.peak());
const dCall = f.log.find((c) => idOf(c) === "d");
ok(dCall && ["a", "b", "c"].every((x) => dCall.prompt.includes(`<ket_qua_nhanh id="${x}"`)),
  "nhánh sau nhận kết quả của các nhánh nó phụ thuộc");
const research = f.log.filter((c) => c.job === "orchestra" && ["a", "b", "c"].includes(idOf(c)));
ok(research.every((c) => c.web && c.effort === "low"), "việc tra cứu bật tìm web trên gói, nỗ lực thấp");
ok(f.log[0].model === team.boss && f.log.some((c) => c.job === "orchestra-review" && c.model === team.manager),
  "trưởng nhóm lập kế hoạch, quản lý duyệt");
const last = f.states.at(-1);
const roles = new Set(last.members.map((m) => m.role));
ok(last.phase === "final" && last.tasks.every((t) => t.status === "done") && roles.has("boss") && roles.has("manager"),
  "sơ đồ tổ chức: đủ vai, mọi việc xong", J(last).slice(0, 500));
ok(last.tokens > 0 && last.members.every((m) => typeof m.tokens === "number"), "đếm token theo thành viên");
ok(f.learnt.length === 4 && f.learnt.every(([, x]) => x === true), "ghi kết quả để học hồ sơ năng lực", J(f.learnt));
const block = E.teamBlock(out.plan, out.results);
ok(block.startsWith("<orchestra_results>") && block.includes('id="d"') && block.includes("kết quả a"),
  "khối kết quả cho trưởng nhóm viết câu trả lời cuối");

// Chuyển model dự phòng khi lỗi.
const planTasks = P.parsePlan(PLAN).plan.tasks;
const firstPick = A.assign(planTasks, P.layers(planTasks), pool, team).a.model;
f = fake({ fail: (c) => idOf(c) === "a" && c.model === firstPick });
out = await go(f);
const work = (id) => f.log.filter((c) => c.job === "orchestra" && idOf(c) === id);
const aCalls = work("a");
ok(out.ok && aCalls.length === 2 && aCalls[0].model !== aCalls[1].model && out.results.find((x) => x.id === "a"),
  "model lỗi: nhánh chuyển sang model dự phòng", J(aCalls.map((c) => c.model)));
ok(f.learnt.some(([k, x]) => k === aCalls[0].model && x === false), "lỗi được ghi vào hồ sơ học");
ok(f.states.at(-1).tasks.find((t) => t.id === "a").model === aCalls[1].model, "sơ đồ hiện đúng model đã làm");

// Mọi model của một nhánh đều lỗi: nhánh hỏng, việc vẫn tiếp tục.
f = fake({ fail: (c) => idOf(c) === "b" });
out = await go(f);
ok(out.ok && !out.results.find((x) => x.id === "b")
  && f.states.at(-1).tasks.find((t) => t.id === "b").status === "fail",
  "nhánh hỏng hết dự phòng: đánh dấu lỗi, các nhánh khác vẫn xong");
ok(work("b").length === 3, "tối đa ba lần thử (model chính + hai dự phòng)");
ok(E.teamBlock(out.plan, out.results).includes("bạn tự làm"), "phần thiếu được giao lại cho trưởng nhóm");
ok(work("d")[0].prompt.includes("không có kết quả"), "nhánh sau biết nhánh trước không có kết quả");

// Bước duyệt: trả lại một lần, không lần thứ hai.
f = fake({ review: () => '{"reviews":[{"id":"a","ok":false,"fix":"thiếu số liệu năm 2025"},{"id":"b","ok":true}]}' });
out = await go(f);
const redo = work("a");
ok(redo.length === 2 && redo[1].prompt.includes("thiếu số liệu năm 2025") && redo[1].prompt.includes("<ban_truoc>"),
  "quản lý trả lại: làm lại kèm bản trước và yêu cầu sửa", J(redo.map((c) => c.prompt.slice(-200))));
ok(redo[1].model === redo[0].model, "làm lại trên đúng model đã làm bản trước");
ok(f.log.filter((c) => c.job === "orchestra-review").length === 1, "duyệt đúng một lần");
ok(out.results.find((x) => x.id === "a").text.includes("(đã sửa)")
  && f.states.at(-1).tasks.find((t) => t.id === "a").redo,
  "bản sửa thay bản cũ, sơ đồ ghi đã làm lại");
ok(f.learnt.some(([, x]) => x === false), "bị trả lại tính là chưa đạt khi học");
ok(E.parseReviews("hỏng", ["a"]).size === 0 && E.parseReviews('{"reviews":[{"id":"a","ok":false}]}', ["a"]).get("a").ok,
  "kết quả duyệt hỏng hoặc không nói cần sửa gì: coi như đạt");

// Làm lại hỏng: giữ bản trước.
f = fake({ review: () => '{"reviews":[{"id":"a","ok":false,"fix":"thiếu"}]}',
  fail: (c) => c.prompt.includes("<ban_truoc>") });
out = await go(f);
ok(out.ok && out.results.find((x) => x.id === "a") && f.states.at(-1).tasks.find((t) => t.id === "a").status === "done",
  "lần làm lại hỏng hết: giữ bản trước, nhánh vẫn xong");

// Trần chi phí khóa API: model đắt bị bỏ qua, nhánh chuyển sang gói.
const apiPool = [
  mem("sub-claude/opus"), mem("openai/gpt-6-luna", { usdPer1k: 5 }), mem("google/gemini-3.8-flash", { usdPer1k: 5 }),
  mem("sub-claude/haiku", { low: true }),
];
const apiTeam = { boss: "sub-claude/opus", manager: "sub-claude/opus" };
f = fake();
out = await go(f, { pool: apiPool, team: apiTeam, budget: { ...BUDGET, maxUsd: 0.5 } });
ok(out.ok && f.log.every((c) => c.model.startsWith("sub-")),
  "vượt trần chi phí: không gọi model khóa API, dùng gói còn lại",
  J(f.log.map((c) => c.model)));
f = fake();
out = await go(f, { pool: apiPool, team: apiTeam, budget: { ...BUDGET, maxCalls: 3 } });
const end = f.states.at(-1);
ok(f.log.length <= 3 && end?.tasks.some((t) => t.status === "skip") && !end?.tasks.some((t) => t.status === "fail"),
  "hết số lời gọi: nhánh còn lại bị bỏ qua (không phải lỗi), không gọi thêm", J(end?.tasks));

// Kế hoạch hỏng: viết lại một lần; vẫn hỏng thì không chia.
f = fake({ plan: (n) => (n === 1 ? "không phải JSON" : PLAN) });
out = await go(f);
ok(out.ok && f.log.filter((c) => c.job === "orchestra-plan").length === 2
  && f.log[1].prompt.includes("không dùng được"),
  "kế hoạch hỏng: nhờ viết lại kèm lý do");
f = fake({ plan: () => "vẫn hỏng" });
out = await go(f);
ok(!out.ok && out.why === "noplan" && f.log.length === 2 && !f.states.length,
  "hỏng hai lần: không chia, không hiện sơ đồ");
f = fake({ plan: () => '{"split": false}' });
out = await go(f);
ok(!out.ok && out.why === "nosplit" && f.log.length === 1, "trưởng nhóm thấy không có nhánh: chạy một model");

// Bấm Dừng giữa chừng.
let stop = false;
f = fake({ ms: 60, aborted: () => stop });
setTimeout(() => { stop = true; }, 20);
out = await go(f);
ok(!out.ok && out.why === "aborted" && !work("d").length, "Dừng: không chạy tầng sau", J(out.why));

console.log("6. Đính kết quả vào tin nhắn, bản chụp cuối");
const msgs = [{ role: "user", content: "cũ" }, { role: "assistant", content: "đáp" }, { role: "user",
  content: [{ type: "text", text: "mới" }] }];
const w = E.withTeam(msgs, "<orchestra_results>x</orchestra_results>");
ok(w[2].content.length === 2 && w[2].content[1].text.includes("orchestra_results") && msgs[2].content.length === 1,
  "khối kết quả đính vào tin mới nhất, không sửa mảng gốc");
ok(E.withTeam([{ role: "user", content: "a" }], "B")[0].content === "a\n\nB", "tin nhắn chữ thường");
ok(E.contextOf(msgs).includes("đáp"), "ngữ cảnh gồm câu trả lời trước của trợ lý");
const fin = E.finishState(last, true, "câu trả lời cuối dài dài");
ok(fin.phase === "done" && fin.ended && fin.members.find((m) => m.role === "boss").status === "done"
  && fin.tokens > last.tokens,
  "xong: trưởng nhóm xong, cộng token câu trả lời cuối");
ok(S.parseOrch(J(fin))?.phase === "done" && S.parseOrch("{") === null && S.parseOrch('{"v":2}') === null,
  "giao diện đọc được bản chụp, bỏ bản hỏng");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
