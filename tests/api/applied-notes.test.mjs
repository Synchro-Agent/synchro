// Hướng dẫn cá nhân không lọt vào câu trả lời: không ghép "Đã áp dụng hướng dẫn của bạn: “…”" vào chữ tin nhắn (chỉ cờ + chip trung tính), lọc dòng đó nếu model
// tự viết, bỏ khỏi lịch sử gửi model và bản chia sẻ công khai, lời nhắc hệ thống cấm trích lại. Hàm thuần và đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { turnctx: T, sharesnap: S, history: H, "i18n-dict": D } = await loadTs(["turnctx", "sharesnap", "history", "i18n-dict"]);
const SECRET = "Tôi là bác sĩ ở Đà Nẵng, luôn trả lời thật ngắn và xưng em";

console.log("1. Lọc dòng cũ khỏi câu trả lời");
const body = "Thủ đô của Pháp là Paris.";
for (const [name, line] of [
  ["tiếng Việt, in nghiêng", `_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_`],
  ["tiếng Anh", `_Applied your instructions: “${SECRET}”_`],
  ["không in nghiêng, ngoặc kép thường", `Đã áp dụng hướng dẫn của bạn: "${SECRET}"`],
  ["in đậm", `**Đã áp dụng hướng dẫn cá nhân: “${SECRET}”**`],
]) {
  const t = T.stripAppliedNotes(`${body}\n\n${line}`);
  ok(t === body, `${name}: chỉ còn câu trả lời`, JSON.stringify(t));
}
const pj = T.stripAppliedNotes(`${body}\n\n_Đã áp dụng ngữ cảnh dự án: hướng dẫn, bộ nhớ, tài liệu_\n\n_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_`);
ok(pj === body, "dòng ngữ cảnh dự án kiểu cũ cũng bỏ", JSON.stringify(pj));
ok(T.stripAppliedNotes(`${body}\n\n_Project context applied: instructions, documents_`) === body, "bản tiếng Anh của dòng dự án");
const mid = T.stripAppliedNotes(`Đoạn 1.\n\n_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_\n\nĐoạn 2.`);
ok(mid === "Đoạn 1.\n\nĐoạn 2.", "dòng nằm giữa: bỏ dòng, không để thừa dòng trống", JSON.stringify(mid));
const keep = "Mình đã áp dụng hướng dẫn của bạn: rút gọn đoạn 2 và đổi giọng văn.\n\n  Mã:   x = 1";
ok(T.stripAppliedNotes(keep) === keep, "câu bình thường có chữ “áp dụng hướng dẫn” (không trích nguyên văn): giữ nguyên, không đổi khoảng trắng", T.stripAppliedNotes(keep));
ok(T.stripAppliedNotes("Đã áp dụng ngữ cảnh dự án: đã đọc hợp đồng mới") === "Đã áp dụng ngữ cảnh dự án: đã đọc hợp đồng mới", "câu khác bắt đầu giống dòng dự án: giữ nguyên");
ok(T.stripAppliedNotes(body) === body && T.stripAppliedNotes("") === "", "không có dòng nào: trả nguyên chữ");

console.log("2. Lời nhắc hệ thống cấm trích lại hướng dẫn cá nhân");
ok(/Không bao giờ trích lại/.test(T.NO_QUOTE_INS) && /Đã áp dụng hướng dẫn của bạn/.test(T.NO_QUOTE_INS), "câu cấm trích lại, nêu cả dòng kiểu cũ", T.NO_QUOTE_INS);
const mem = fs.readFileSync("server/memory.ts", "utf8");
ok(/<how_to_use>[\s\S]*\$\{NO_QUOTE_INS\}[\s\S]*<\/how_to_use>/.test(mem), "câu đó nằm trong phần cách dùng hướng dẫn cá nhân (userContext)");

console.log("3. Câu trả lời không còn ghép nội dung hướng dẫn");
// Trang chủ tách thành home.tsx (lượt chat) và Thread.tsx (dòng tin, blueprint B2): đọc cả hai.
const page = fs.readFileSync("app/home.tsx", "utf8") + fs.readFileSync("app/Thread.tsx", "utf8");
ok(!/ins\.trim\(\)\.slice\(/.test(page) && !/Applied your instructions/.test(page) && !/Đã áp dụng hướng dẫn của bạn/.test(page), "page.tsx không còn ghép đoạn đầu hướng dẫn cá nhân vào chữ câu trả lời");
ok(/insApplied/.test(page) && /tr\("Đã áp dụng hướng dẫn cá nhân"\)/.test(page) && /tr\("Đã áp dụng ngữ cảnh dự án"\)/.test(page), "chỉ còn cờ trên tin nhắn và chip trung tính qua tr()");
ok(D.VI2EN["Đã áp dụng hướng dẫn cá nhân"] === "Personal instructions applied" && D.VI2EN["Đã áp dụng ngữ cảnh dự án"] === "Project context applied", "chip có bản tiếng Anh");
ok(!("Đã áp dụng hướng dẫn của bạn" in D.VI2EN) && !D.RULES_EN.some(([re]) => String(re).includes("Đã áp dụng hướng dẫn của bạn")), "từ điển bỏ mục của dòng cũ");

console.log("3b. Chip hiện trên câu trả lời truyền theo thời gian thực (mọi câu trả lời thật đều streamed)");
const insLine = /const insApplied = ([^;]+);/.exec(page)?.[1] ?? "";
ok(insLine.includes("!cancelled") && insLine.includes("ins.trim()") && !insLine.includes("streamed"), "insApplied: chỉ cần lượt xong, không bị Dừng — KHÔNG xét streamed (nếu xét thì chip không bao giờ hiện)", insLine);
ok(!/const fresh = !streamed/.test(page), "không còn cờ fresh gắn chip với !streamed", page.slice(page.indexOf("insApplied") - 200, page.indexOf("insApplied")));
const pjLine = /const pjApplied = ([^;]+);/.exec(page)?.[1] ?? "";
ok(pjLine.includes("!cancelled") && pjLine.includes("getRelevantContext(pr, text)") && !pjLine.includes("hasLLM") && !pjLine.includes("streamed"), "pjApplied: !cancelled && pr có hướng dẫn/bộ nhớ/tài liệu — KHÔNG xét hasLLM (luôn true ở bản thật nên chip chết) hay streamed", pjLine);
ok(!/hasLLM/.test(page), "page.tsx không còn dùng hasLLM (đã gỡ cả import)");

console.log("4. Bản chia sẻ và lịch sử gửi model");
const old = { role: "ai", text: `${body}\n\n_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_`, insApplied: true, pjApplied: true, done: true, time: 1 };
const snap = S.snapshotOf("Chat", [{ role: "user", text: "Thủ đô của Pháp?", time: 0 }, old]);
const raw = JSON.stringify(snap);
ok(!raw.includes(SECRET) && !raw.includes("Đã áp dụng") && raw.includes("Paris"), "bản chia sẻ không có nội dung hướng dẫn (kể cả câu trả lời cũ), vẫn có câu trả lời", raw);
ok(!/insApplied|pjApplied/.test(raw), "bản chia sẻ không mang cờ của chip", raw);
const userSaid = S.snapshotOf("Chat", [{ role: "user", text: `_Đã áp dụng hướng dẫn của bạn: “tự gõ”_`, time: 0 }]);
ok(JSON.stringify(userSaid).includes("tự gõ"), "tin người dùng tự gõ giữ nguyên", JSON.stringify(userSaid));
const hist = H.chatHistory([{ role: "user", text: "Thủ đô của Pháp?", time: 0 }, old, { role: "user", text: "Còn Ý?", time: 2 }]);
ok(hist.length === 3 && hist[1].content === body && !JSON.stringify(hist).includes(SECRET), "lịch sử gửi model không có dòng cũ (model không bắt chước được)", JSON.stringify(hist));

console.log("5. Lọc theo thời gian thực trên luồng trực tiếp (SSE delta)");
// Mô phỏng người xem: nhận t / reset như trình duyệt, dựng lại chữ đang hiện. Luôn khớp stripAppliedNotes(chữ thô tới lúc này), không lộ secret.
function playStream(chunks) {
  let shown = "", client = "", raw = "";
  const steps = [];
  for (const c of chunks) { raw += c; const d = T.appliedDelta(shown, raw); client = d.reset ? d.t : client + d.t; shown = d.text; steps.push(client); }
  return { client, steps };
}
const full = `Thủ đô của Pháp là Paris.\n\n_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_`;
const perChar = playStream([...full]);
ok(perChar.client === T.stripAppliedNotes(full) && perChar.client === "Thủ đô của Pháp là Paris.", "từng ký tự: chữ hiện cuối = bản đã lọc, hết dòng ghi chú", perChar.client);
ok(!perChar.steps.some((s) => s.includes(SECRET)), "không bước nào lộ nội dung hướng dẫn cá nhân", perChar.steps.find((s) => s.includes(SECRET)));
const chunky = playStream(["Thủ đô của Pháp là Paris.", "\n\n_Đã áp dụng hướng dẫn của bạn: ", `“${SECRET}”_`]);
ok(chunky.client === "Thủ đô của Pháp là Paris." && !chunky.steps.some((s) => s.includes(SECRET)), "mẩu lớn (mẩu cuối cả dòng ghi chú): cũng không lộ", JSON.stringify(chunky.steps));
const normal = playStream([..."Xin chào bạn, hôm nay thế nào?"]);
ok(normal.client === "Xin chào bạn, hôm nay thế nào?" && normal.steps.every((s) => "Xin chào bạn, hôm nay thế nào?".startsWith(s)), "chữ thường: chỉ nối thêm, không reset, không mất chữ", normal.client);
ok(T.appliedDelta("Paris.", "Paris.").t === "" && !T.appliedDelta("Paris.", "Paris.").reset && T.appliedDelta("", "Paris.").t === "Paris.", "không có ghi chú: chỉ gửi phần nối thêm");

console.log("5b. Máy chủ lọc luồng trực tiếp (lượt chat) và lời dẫn 'say'");
const runsSrc = fs.readFileSync("server/runs.ts", "utf8");
ok(/appliedDelta\(/.test(runsSrc) && /l\.kind === "chat"/.test(runsSrc), "runs.delta lọc dòng cũ trên luồng trực tiếp, chỉ lượt chat");
ok(/l\.raw = "";\s*l\.applied = false/.test(runsSrc), "deltaStep đặt lại trạng thái lọc theo từng bước");
ok(/stripAppliedNotes\(scrubServerPaths\(/.test(fs.readFileSync("server/chatengine.ts", "utf8")), "sayOut lọc dòng cũ khỏi sự kiện 'say'");

console.log("6. Đoạn chat cũ: bỏ dòng khi vẽ và khi sao chép (W1-08)");
ok(/const cleanAiMsg = \(m: Msg\): Msg => \{ if \(m\.role !== "ai"\) return m; const text = stripAppliedNotes\(m\.text\); return text === m\.text \? m : \{ \.\.\.m, text \}; \};/.test(page), "page.tsx: cleanAiMsg lọc tin AI, giữ nguyên đối tượng khi không đổi");
ok(/MsgRow\(\{ m: raw,/.test(page) && /const m = useMemo\(\(\) => cleanAiMsg\(raw\), \[raw\]\);/.test(page), "MsgRow vẽ và sao chép bản đã lọc");
const legacy = `Thủ đô của Pháp là Paris.\n\n_Đã áp dụng hướng dẫn của bạn: “${SECRET}”_`;
ok(T.stripAppliedNotes(legacy) === "Thủ đô của Pháp là Paris." && T.stripAppliedNotes(body) === body, "tin cũ được lọc, tin sạch giữ nguyên chuỗi");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
