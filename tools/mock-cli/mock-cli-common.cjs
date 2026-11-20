// Phần dùng chung của CLI giả lập (claude, codex, agy, grok) cho npm run dev:mock: không gọi mạng thật, không cần tài khoản.
// dev:mock chép các tệp này vào <engine home>/.local/bin kèm mock-cli.json ({ base: địa chỉ máy chủ giả lập }).
const fs = require("fs"), path = require("path"), crypto = require("crypto"), readline = require("readline");

// Linux không cho một tham số dòng lệnh dài quá 128 KB (MAX_ARG_STRLEN): CLI thật không khởi động được ("spawn E2BIG"). macOS không có
// giới hạn này nên CLI giả lập tự làm như Linux, để kiểm thử bắt được chỗ còn nhét prompt / hướng dẫn dài vào tham số.
if (process.argv.some((x) => Buffer.byteLength(x, "utf8") > 131072)) { process.stderr.write("spawn E2BIG\n"); process.exit(126); }

const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "mock-cli.json"), "utf8")); } catch { return { base: "http://127.0.0.1:4010" }; } })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const uuid = () => crypto.randomUUID();
const readStdin = () => new Promise((r) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => r(s)); });
const readLine = (prompt) => new Promise((r) => {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin });
  rl.once("line", (l) => { rl.close(); r(l.trim()); });
});
const flag = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

/** Đếm lượt trong một phiên (để kiểm tra resume nối tiếp đúng hội thoại). */
function bumpSession(dir, id) {
  const f = path.join(dir, "mock-sessions.json"), s = readJson(f, {});
  s[id] = (s[id] ?? 0) + 1;
  writeJson(f, s);
  return s[id];
}
/** [mock:stall]: lượt đầu chỉ báo "Mình sẽ…" rồi dừng, không gọi công cụ. Synchro nhắc làm tiếp (<synchro_continue>) thì làm thật:
 *  CLI thật nhớ yêu cầu trước trong phiên, giả lập đọc lại yêu cầu đã lưu của phiên (lượt nối tiếp chỉ nhận lời nhắc). */
function stallTurn(dir, id, prompt) {
  const f = path.join(dir, "mock-prompts.json"), s = readJson(f, {});
  const nudge = prompt.includes("<synchro_continue>");
  if (!nudge) { s[id] = prompt; writeJson(f, s); }
  return { stall: prompt.includes("[mock:stall]") && !nudge, prompt: nudge && !/#tool=/.test(prompt) ? `${s[id] ?? ""}\n${prompt}` : prompt };
}
const STALL_TEXT = "Mình sẽ mở trình duyệt và làm ngay.";
/** Hạn mức giả lập: mỗi lượt dùng 7% phiên 5 giờ và 2% tuần. */
function bumpUsage(dir) {
  const f = path.join(dir, "mock-usage.json"), now = Date.now();
  const u = readJson(f, { n: 0, five: now + 5 * 3600e3, week: now + 7 * 86400e3 });
  if (u.five < now) { u.five = now + 5 * 3600e3; u.n = 0; }
  u.n += 1;
  writeJson(f, u);
  return { five: Math.min(1, u.n * 0.07), week: Math.min(1, u.n * 0.02), fiveReset: u.five, weekReset: u.week };
}
/** Lời gọi đặt tên đoạn chat (app/api/title): tên ngắn từ tin đầu của người dùng, như model thật. */
function mockTitle(prompt) {
  const m = /\[Người dùng\]\n([^\n]+)/.exec(prompt);
  const first = (m?.[1] ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!first || /^(xin )?ch[àa]o|^(hi|hello|hey)\b/i.test(first) && first.split(" ").length <= 3) return /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(first) || !first ? "Lời chào" : "Greeting";
  const w = first.replace(/^(cho (tôi|mình|em) hỏi|giúp (tôi|mình|em)|làm ơn|hãy|please|can you|could you)\s+/i, "").split(" ").slice(0, 6).join(" ");
  return w[0].toUpperCase() + w.slice(1);
}
const isTitleAsk = (prompt) => prompt.includes("Đoạn chat cần đặt tên:");
/**
 * Bộ não tổng hợp (server/brain.ts): chưng cất một đoạn chat thành JSON ghi chú, hoặc tổng hợp trung tâm, như model thật.
 * Trả về null khi không phải lời gọi của bộ não.
 */
// Bộ não (dev:mock): trả JSON đúng định dạng cho từng bước học / chăm sóc, suy ra từ chính dữ liệu được gửi (không bịa thêm).
const fold = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const AREAS = [["Học tập", /ielts|thpt|toan|du hoc|tieng anh|on thi/], ["Lập trình", /lap trinh|python|javascript|cyber|code|bao mat/], ["Sức khỏe", /gym|tap luyen|suc khoe|chay bo/]];
// Viết SKILL.md từ bản đọc toàn repo (server/skillgen.ts): như model thật — tên theo gợi ý, mô tả và hướng dẫn chỉ tới tệp có thật trong repo.
// Ghi số tệp đã thấy nội dung để kiểm thử biết bản đọc phủ hết repo.
function mockSkillGen(prompt) {
  const i = prompt.indexOf("Viết SKILL.md cho repo dưới đây.");
  if (i < 0) return null;
  const q = prompt.slice(i);
  const name = /Tên gợi ý: ([a-z0-9-]+)/.exec(q)?.[1] ?? "repo-skill";
  const source = /^Repo: (.+)$/m.exec(q)?.[1] ?? "repo";
  const files = [...q.matchAll(/<tep path="([^"]+)">/g)].map((m) => m[1]);
  const total = /^Tổng (\d+) tệp/m.exec(q)?.[1] ?? "?";
  return `---\nname: ${name}\ndescription: "Kiến thức từ repo ${source} (mock). Dùng khi người dùng hỏi về ${name} hoặc cần làm việc với repo này."\n---\n# ${name}\n\nSkill viết từ bản đọc toàn repo ${source}: đã thấy nội dung ${files.length} tệp văn bản trên tổng ${total} tệp. Khi người dùng hỏi về repo, mở đúng tệp liên quan trong references/ trước khi trả lời và trích tên tệp.\n\n## Quy trình\n1. Đọc references/repo-tree.md để biết cấu trúc.\n2. Mở tệp liên quan nhất.\n3. Trả lời dựa đúng nội dung tệp.\n\n## Tệp tham khảo\n${files.slice(0, 5).map((f) => "- references/" + f).join("\n")}\n`;
}

// Xếp skill vào Tài liệu / Trình bày / Thiết kế (server/skillstudio.ts): như model thật — đọc tên, mô tả, nội dung rồi trả một dòng JSON.
// Hiểu theo nghĩa chứ không chỉ khớp chữ: "pitch" / "thuyết trình" là Trình bày, "giao diện" / "logo" / "màu" là Thiết kế…
function mockStudio(prompt) {
  const i = prompt.indexOf("Skill cần phân loại:");
  if (i < 0) return null;
  const t = fold(prompt.slice(i));
  const any = (...ws) => ws.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t));
  const docs = any("bao cao", "de xuat", "hop dong", "tai lieu", "van ban", "bien ban", "report", "proposal", "document", "docx", "memo", "contract", "documentation", "newsletter");
  const slides = any("slide", "slides", "thuyet trinh", "trinh chieu", "presentation", "deck", "pitch", "pptx", "powerpoint", "keynote");
  const design = any("thiet ke", "giao dien", "logo", "mau sac", "phong chu", "do hoa", "poster", "banner", "ui", "ux", "typography", "animation", "brand", "thuong hieu", "figma", "mockup");
  const code = !docs && !slides && !design;
  return JSON.stringify({ docs, slides, design, why: code ? "(mock) Skill về việc khác, không thuộc mục nào." : `(mock) Thuộc ${[docs && "Tài liệu", slides && "Trình bày", design && "Thiết kế"].filter(Boolean).join(", ")}.` });
}

// Quét skill rác (server/skillscan.ts): như model thật — đọc từng skill trong lô rồi trả JSON đủ mọi số thứ tự.
// Chữ mẫu / tên skill thử → rác; chỉ dặn điều model vốn đã làm → không có tác dụng; còn lại → ổn, kèm ngành nghề.
// Tên có "noverdict" thì bỏ qua skill đó (kiểm thử mục "Chưa đọc được").
function mockSkillScan(prompt) {
  const i = prompt.indexOf("Các skill cần thẩm định:");
  if (i < 0) return null;
  const en = /bằng tiếng Anh \(English\)/.test(prompt);
  const blocks = prompt.slice(i).split(/\n\n---\n\n/);
  const items = [];
  for (const b of blocks) {
    const m = /\[(\d+)\] ([^\n]+)/.exec(b);
    if (!m || /noverdict/.test(m[2])) continue;
    const t = fold(b);
    const hint = /Dấu hiệu: ([^\n]*)/.exec(b)?.[1] ?? "";
    let verdict = "ok", field = "", why = "";
    if (/chữ mẫu|skill thử/.test(hint)) { verdict = "junk"; why = en ? "(mock) Placeholder or test content with no real instructions." : "(mock) Chỉ là chữ mẫu hoặc skill thử, không có hướng dẫn thật nào."; }
    else if (/be (polite|helpful)|think step by step|lich su|suy nghi tung buoc|tro ly chung|general assistant/.test(t)) { verdict = "useless"; why = en ? "(mock) Only repeats what the model already does and serves no profession." : "(mock) Chỉ dặn điều model vốn đã làm, không phục vụ ngành nghề hay công việc cụ thể nào."; }
    else {
      field = /ke toan|thue|accounting|tax/.test(t) ? (en ? "Accounting" : "Kế toán") : /thiet ke|design|giao dien|\bui\b/.test(t) ? (en ? "Design" : "Thiết kế") : /slide|thuyet trinh|presentation/.test(t) ? (en ? "Presentations" : "Trình bày") : /code|lap trinh|test|api/.test(t) ? (en ? "Software" : "Lập trình") : (en ? "Specialist work" : "Chuyên môn");
      why = en ? `(mock) Concrete instructions for ${field.toLowerCase()} work.` : `(mock) Có hướng dẫn cụ thể cho công việc ${field.toLowerCase()}.`;
    }
    items.push({ i: Number(m[1]), verdict, field, why });
  }
  return "```json\n" + JSON.stringify({ items }) + "\n```";
}

function mockBrain(prompt) {
  const sg = mockSkillGen(prompt);
  if (sg) return sg;
  const sc = mockSkillScan(prompt);
  if (sc) return sc;
  const st = mockStudio(prompt);
  if (st) return st;
  if (prompt.includes("Đoạn chat cần chưng cất:")) {
    const body = prompt.split("Đoạn chat cần chưng cất:")[1] ?? "";
    const users = [...body.matchAll(/\[Người dùng\]\n([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
    const first = (users[0] ?? "Đoạn chat").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() || "Đoạn chat";
    const all = users.join(" ");
    const KNOWN = [["Luyện IELTS", /luyện ielts/i], ["IELTS", /ielts/i], ["Ôn thi THPT", /thpt|ôn thi|đề thi/i], ["Toán", /\btoán\b|phương trình|đạo hàm/i], ["Lập trình", /python|javascript|\bcode\b|lập trình/i], ["Gym", /\bgym\b|tập luyện/i], ["Du học", /du học/i], ["Cyber security", /cyber|bảo mật/i]];
    // Điều đã biết về chủ đề: câu của người dùng có nhắc chủ đề đó (đúng như nội dung đoạn chat).
    const topics = KNOWN.filter(([, r]) => r.test(all)).map(([n, r]) => ({ name: n, desc: `Chủ đề ${n}.`, facts: users.filter((u) => r.test(u)).slice(0, 2).map((u) => `Đã bàn: ${u.slice(0, 90)}`) })).slice(0, 3);
    const NAMES = [["Python", "công cụ"], ["Hà Lan", "nơi chốn"], ["IELTS Writing", "tài liệu"], ["Casio", "công cụ"], ["Synchro", "công cụ"], ["JavaScript", "công cụ"], ["Next.js", "công cụ"]];
    const entities = NAMES.filter(([n]) => all.toLowerCase().includes(n.toLowerCase())).slice(0, 4).map(([n, type]) => ({ name: n, type, desc: "", facts: users.filter((u) => u.toLowerCase().includes(n.toLowerCase())).slice(0, 1).map((u) => `Được nhắc khi: ${u.slice(0, 80)}`) }));
    // Hồ sơ: câu tự giới thiệu ("mình là / mình đang / mình thích / mỗi sáng…") thành điều biết về người dùng.
    const profile = [];
    for (const u of users) {
      const m = /(?:mình|tôi|em) (là|đang|thích|muốn|hay|thường) ([^.,!?]{3,80})/iu.exec(u);
      if (m) profile.push({ cat: /thích|muốn/.test(m[1]) ? "interest" : /hay|thường/.test(m[1]) ? "habit" : /đang/.test(m[1]) ? "work" : "who", text: `Người dùng ${m[1]} ${m[2].trim()}.` });
      if (/trả lời ngắn|ngắn gọn|không giải thích/i.test(u)) profile.push({ cat: "style", text: "Người dùng muốn được trả lời ngắn gọn, đi thẳng vào ý." });
    }
    const title = first.split(" ").slice(0, 6).join(" ");
    return JSON.stringify({
      title: title[0].toUpperCase() + title.slice(1), gist: `Người dùng hỏi: ${first.slice(0, 120)}. Trợ lý đã trả lời và gợi ý cách làm.`,
      points: users.slice(0, 3).map((u) => u.slice(0, 100)), decisions: [], tasks: /mai|làm tiếp|chưa xong/i.test(all) ? [`Làm tiếp: ${first.slice(0, 60)}`] : [],
      topics: topics.length ? topics : [{ name: "Chung", desc: "Những câu hỏi chung.", facts: [] }], entities, profile: profile.slice(0, 4), importance: users.length > 1 ? 4 : 3,
    });
  }
  if (prompt.includes("Trang cần biên soạn:")) {
    const pages = JSON.parse(prompt.split("Trang cần biên soạn:")[1].trim());
    return JSON.stringify({ pages: pages.map((p) => {
      const seen = new Set(), facts = p.facts.filter((f) => { const k = fold(f.t); if (seen.has(k)) return false; seen.add(k); return true; });
      return { title: p.title, summary: `${p.title}: ${facts.length} điều đã biết${facts[0] ? `, mới nhất là “${facts[facts.length - 1].t.slice(0, 60)}”` : ""}.`, facts };
    }) });
  }
  if (prompt.includes("Các tên trong bộ não:")) {
    // Trùng: một tên chứa trọn tên kia (vd. "Luyện IELTS" và "IELTS"), cùng loại.
    const rows = [...prompt.matchAll(/^- (.+?) \((chủ đề|tên riêng)\)/gm)].map((m) => ({ name: m[1], kind: m[2] }));
    const groups = [];
    for (const a of rows) for (const b of rows) if (a !== b && a.kind === b.kind && fold(b.name).length >= 3 && fold(a.name) !== fold(b.name) && fold(a.name).split(/\s+/).includes(fold(b.name))) groups.push({ keep: b.name, merge: [a.name] });
    return JSON.stringify({ groups });
  }
  if (prompt.includes("Các chủ đề cần xếp bản đồ:")) {
    const names = [...prompt.matchAll(/^- ([^:\n]+):/gm)].map((m) => m[1].trim());
    const maps = AREAS.map(([name, re]) => ({ name, desc: `Các chủ đề về ${name.toLowerCase()}.`, topics: names.filter((n) => re.test(fold(n))) })).filter((m) => m.topics.length >= 2);
    return JSON.stringify({ maps });
  }
  if (prompt.includes("Những điều đã biết về người dùng:")) {
    const d = JSON.parse(prompt.split("Những điều đã biết về người dùng:")[1].trim());
    const seen = new Set(), profile = d.profile.filter((f) => { const k = fold(f.t); if (seen.has(k)) return false; seen.add(k); return true; });
    return JSON.stringify({ portrait: `Bạn là người ${profile.map((f) => f.t.replace(/^Người dùng /, "").replace(/\.$/, "")).slice(0, 3).join(", ") || "đang làm quen Synchro"}.`, profile });
  }
  if (prompt.includes("Bản người dùng tự viết:")) {
    const own = (/Bản người dùng tự viết:\n([\s\S]*?)\n\n(?:Hồ sơ tài khoản|Chân dung|Điều đã biết)/.exec(prompt)?.[1] ?? "").trim();
    const facts = [...prompt.matchAll(/^- \[(\w+)\] (.+)$/gm)].map((m) => ({ cat: m[1], t: m[2].replace(/^Người dùng /, "Tôi ") }));
    const sec = (h, cat) => { const xs = facts.filter((f) => f.cat === cat); return xs.length ? `\n\n## ${h}\n${xs.map((f) => `- ${f.t}`).join("\n")}` : ""; };
    const who = facts.filter((f) => f.cat === "who").map((f) => f.t).join(" ");
    return `## Về tôi\n${own && own !== "(chưa viết gì)" ? own : "Tôi dùng Synchro hằng ngày."}${who ? `\n${who}` : ""}${sec("Công việc & chuyên môn", "work")}${sec("Thói quen & cách tôi làm việc", "habit")}${sec("Mối quan tâm hiện nay", "interest")}${sec("Cách tôi muốn Synchro trả lời", "style")}`;
  }
  if (prompt.includes("Các đoạn chat gần đây (mới trước):")) {
    const chats = [...prompt.matchAll(/^- \S+ ([^:\n]+):/gm)].map((m) => m[1]).slice(0, 3);
    const topics = (/Chủ đề: ([^\n]+)/.exec(prompt)?.[1] ?? "").split(", ").filter((x) => x && x !== "(chưa có)").slice(0, 4);
    return JSON.stringify({ overview: `Người dùng đang dùng Synchro cho ${topics.join(", ") || "nhiều việc"}. Gần đây họ làm: ${chats.join("; ") || "chưa có"}.`, focus: topics.length ? topics.map((x) => `Tiến bộ về ${x}`) : ["Làm quen Synchro"] });
  }
  return null;
}
/** "#prefs" trong tin nhắn → nhắc lại khối <user_preferences> model nhận được (kiểm thử Hướng dẫn cho Synchro). */
function prefsEcho(all) {
  const m = /<user_preferences>([\s\S]*?)<\/user_preferences>/.exec(all);
  return m ? `PREFS: ${m[1].trim().replace(/\s+/g, " ")}` : "PREFS: none";
}
// Cho kiểm thử biết quy tắc hàng đầu có mở đầu lời nhắc Synchro gửi kèm không, và nội dung quy tắc (một dòng).
function ruleEcho(sys) {
  const m = /<top_rule>([\s\S]*?)<\/top_rule>/.exec(sys);
  return m ? `TOPRULE: ${sys.trimStart().startsWith("<top_rule>") ? "first" : "inside"} ${m[1].trim().replace(/\s+/g, " ").slice(0, 600)}` : "TOPRULE: none";
}
// "#pjins": nhắc lại phần hướng dẫn dự án trong lời nhắc hệ thống (và có mấy lần), để kiểm thử hướng dẫn dự án tới được model ở mọi đường đi.
function pjEcho(sys) {
  const parts = sys.split("## Hướng dẫn của dự án (hãy luôn tuân theo)\n");
  return parts.length > 1 ? `PJINS x${parts.length - 1}: ${parts[1].split(/\n\s*\n/)[0].trim().replace(/\s+/g, " ").slice(0, 300)}` : "PJINS: none";
}
// "#pjins" của CLI chỉ nhận hướng dẫn ở lượt mở phiên (Codex, Antigravity): lượt nối tiếp Synchro chỉ gửi phần
// hướng dẫn mới, phần cũ nằm trong lịch sử phiên của CLI thật. Giả lập nhớ phần dự án theo phiên để lượt
// nối tiếp nhắc lại đúng thứ phiên đang có.
function pjSession(dir, id, prompt) {
  const f = path.join(dir, "mock-pjins.json"), s = readJson(f, {});
  const now = pjEcho(prompt);
  if (now === "PJINS: none") return s[id] ?? now;
  s[id] = now;
  writeJson(f, s);
  return now;
}
// "#sxkit": câu trả lời có sơ đồ ```d2 và bản trình bày dùng bộ CSS: nền shader 3D (data-sx-shader), biểu đồ ECharts (data-sx-chart), khối kính khúc xạ.
// Dùng chung cho CLI giả lập và khóa API giả lập (mock-providers.mjs) để xem các tính năng đồ họa trên trang thật.
function sxKit() {
  const ch = (s) => `<div class="sx-chart" style="height:calc(300*var(--sx-u))" data-sx-chart='${JSON.stringify(s)}'></div>`;
  return `Sơ đồ hệ thống:\n\n\`\`\`d2\nweb: Trình duyệt\napi: Máy chủ Synchro\ndb: Cơ sở dữ liệu {shape: cylinder}\nsb: Sandbox chạy code\nweb -> api: HTTPS\napi -> db: Truy vấn\napi -> sb: Dựng SVG, video\n\`\`\`\n\nBản trình bày:\n<artifact identifier="media-kit" type="text/html" title="Ra mắt quý 4">\n<!doctype html><html data-sx-preset="midnight-tech"><body>
<section class="slide sx-slide"><div class="sx-shader" data-sx-shader="silk"></div><p class="sx-eyebrow">Ra mắt 2026</p><h1 class="sx-display">Synchro quý 4</h1><p class="sx-kicker">Nền sóng lụa ba chiều, chữ vẫn sửa được trong PowerPoint</p></section>
<section class="slide sx-slide"><p class="sx-eyebrow">Kết quả</p><h2 class="sx-title">Doanh thu 2026 vượt 2025 ở mọi quý</h2><div class="sx-grid-3 sx-grow">${ch({ type: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", data: [120, 132, 101, 134] }, { name: "2026", data: [140, 152, 171, 190] }], highlight: "2026", unit: " tỷ" })}${ch({ type: "waterfall", labels: ["Đầu kỳ", "Doanh thu", "Giá vốn", "Chi phí", "Cuối kỳ"], series: [{ name: "Dòng tiền", data: [500, 320, -180, -90, 0] }], total: true })}${ch({ type: "doughnut", labels: ["Bắc", "Trung", "Nam"], series: [{ name: "Tỷ trọng", data: [42, 18, 40] }] })}</div></section>
<section class="slide sx-slide"><h2 class="sx-title">Kính khúc xạ</h2><div data-sx-shader="glass" style="height:calc(440*var(--sx-u))"></div></section>
</body></html>\n</artifact>`;
}
function reply(name, prompt, turn) {
  if (prompt.includes("#sxkit")) return sxKit();
  if (isTitleAsk(prompt)) return mockTitle(prompt);
  if (prompt.includes("#nowcheck")) return `NOW: ${/<current_time>([^<]*)<\/current_time>/.exec(prompt)?.[1] ?? "-"}`;
  // Dòng giờ hiện tại Synchro ghép vào cuối tin nhắn: không phải câu người dùng gõ.
  const last = prompt.replace(/<current_time>[^<]*<\/current_time>/g, "").trim().split("\n").filter(Boolean).pop() ?? "";
  return `Chào bạn! Mình là ${name} chạy qua CLI giả lập (lượt ${turn} của hội thoại). Bạn vừa nói: "${last.slice(0, 120)}".`;
}
// "#clipatch <kiểu>": bản sửa artifact "cli-doc" có một khối chép sai chữ (như model thật), để thử bước Synchro nhắc
// gửi lại khối hỏng trên đường CLI. Lời nhắc <patch_failed> của Synchro trích dòng đầu của SEARCH hỏng, nên kiểu đi
// theo lời nhắc: "healerror" → lần gửi lại lỗi phía hãng, "healslow" → lần gửi lại chờ 4 giây (thử bấm Dừng), còn
// lại gửi lại đúng khối. Mỗi lời nhắc ghi một dòng vào mock-heal.log cạnh CLI giả lập (kiểm thử đếm số lần nhắc).
function cliPatch(prompt) {
  const pblk = (s, r) => `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;
  const wrap = (b) => `<artifact identifier="cli-doc" mode="patch">\n${b}\n</artifact>`;
  if (prompt.includes('<patch_failed identifier="cli-doc"')) {
    fs.appendFileSync(path.join(__dirname, "mock-heal.log"), "heal\n");
    const kind = /<h1>Chao ban<\/h1><!--(\w+)-->/.exec(prompt)?.[1] ?? "ok";
    if (kind === "healerror") return { error: "API Error: 500 Internal server error" };
    const text = wrap(pblk("<h1>Chào bạn</h1>", "<h1>Xin chào bạn</h1>"));
    return { waitMs: kind === "healslow" ? 4000 : 0, text };
  }
  const m = /#clipatch (\w+)/.exec(prompt);
  if (!m) return null;
  const blocks = `${pblk("<title>Bản gốc</title>", "<title>Bản mới</title>")}\n`
    + pblk(`<h1>Chao ban</h1><!--${m[1]}-->`, "<h1>Xin chào bạn</h1>");
  return { waitMs: 0, text: `Đã đổi tiêu đề và lời chào.\n\n${wrap(blocks)}` };
}
/** Tổng số lượt đã chat (mọi phiên) trong thư mục cấu hình: dùng để giả lập phần trăm hạn mức đã dùng. */
const totalTurns = (dir) => Object.values(readJson(path.join(dir, "mock-sessions.json"), {})).reduce((x, y) => x + y, 0);
const chunks = (t, n = 12) => Array.from({ length: Math.ceil(t.length / n) }, (_, i) => t.slice(i * n, i * n + n));

// Gọi cầu nối MCP của Synchro như CLI thật (Streamable HTTP, JSON-RPC): initialize → tools/list → (tools/call).
// limitMs: CLI tự cắt mỗi lần chờ công cụ sau chừng này (agy thật: khoảng 190 giây), model thấy lỗi dù công cụ vẫn chạy.
async function mcp(url, call, o = {}) {
  const rpc = async (method, params, id) => {
    const lim = method === "tools/call" && o.limitMs ? { signal: AbortSignal.timeout(o.limitMs) } : {};
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), ...lim });
    // Công cụ chạy lâu: cầu nối trả qua luồng SSE; kết quả là sự kiện cuối có đúng id của yêu cầu (bỏ qua nhịp giữ kết nối, thông báo tiến độ).
    if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const msgs = (await r.text()).split("\n\n").flatMap((b) => b.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))));
      return msgs.find((m) => m.id === id) ?? {};
    }
    return r.json();
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mock-cli", version: "1" } }, 1);
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const tools = (await rpc("tools/list", {}, 2)).result?.tools ?? [];
  if (!call) return { tools };
  const r = await rpc("tools/call", { name: call.name, arguments: call.args ?? {} }, 3);
  return { tools, result: r.result, error: r.error };
}
/** "#tool=tên #args={...}" trong prompt → lời gọi công cụ giả lập. */
function toolAsk(prompt) {
  const m = /#tool=([\w.-]+)/.exec(prompt);
  if (!m) return null;
  let args = {};
  const a = /#args=(\{.*\})/.exec(prompt);
  if (a) { try { args = JSON.parse(a[1]); } catch {} }
  return { name: m[1], args };
}

// "#media": model giả mô tả đúng các tệp nhận được (loại, kích thước ảnh đọc từ chính các byte) — chứng minh ảnh / PDF tới nơi nguyên vẹn.
function mediaDesc(buf, hint = "") {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return `image/png ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 5).toString() === "%PDF-") return `application/pdf ${buf.length}B`;
  return `${hint || "unknown"} ${buf.length}B`;
}
const mediaReply = (items) => `MEDIA: ${items.length ? items.join("; ") : "không có tệp nào"}`;

// ---------------------------------------------------------------- tạo ảnh (server/ai/imagegen.ts)
// Lượt tạo ảnh ghi tệp ảnh thật, rất nhỏ, đúng chỗ CLI thật ghi. Chế độ lấy từ <thư mục đăng nhập>/mock-image.json ({ "mode": "…" }) hoặc mock-cli.json ({ "image": { "agy": "…" } }):
// ok, quota (hết hạn mức), fail (lỗi khác), none (không có công cụ), text (nói xong mà không có tệp), bad (tệp không phải ảnh), big (quá cỡ), slow (chạy tới khi bị dừng), other (nói
// đường dẫn otherPath của tài khoản khác), symlink (liên kết mềm tới otherPath). Mỗi lượt ghi cờ đã nhận vào mock-image-log.json để kiểm thử xem.
const TINY_JPEG = Buffer.from("/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABgAGADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AjAIGuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/9k=", "base64");
function tinyPng(w = 96, h = 96) {
  const zlib = require("zlib");
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 90); for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const isImageTurn = (p) => p.includes("<image_description>");
const imageCount = (p) => Number(/exactly (\d) separate/.exec(p)?.[1] ?? 1);
const imageMode = (dir, cli) => { const j = readJson(path.join(dir, "mock-image.json"), {}); return { ...j, mode: j.mode ?? cfg.image?.[cli] ?? "ok" }; };
function imageLog(dir, rec) { const f = path.join(dir, "mock-image-log.json"); writeJson(f, [...readJson(f, []), { at: Date.now(), ...rec }]); }
function saveImage(file, kind = "jpg") { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, kind === "png" ? tinyPng() : kind === "bad" ? "<html>không phải ảnh</html>" : kind === "big" ? Buffer.concat([TINY_JPEG, Buffer.alloc(3 * 1048576, 7)]) : TINY_JPEG); }

// Bản phát hành giả cho bộ cập nhật CLI (server/ai/cliupdate.ts, nguồn SYNCHRO_CLI_UPDATE_SOURCE): tệp mock-version cạnh lệnh đổi dòng --version;
// tệp mock-break làm hỏng bản đó: "smoke" mọi lệnh trừ --version đều lỗi (không qua kiểm tra trước khi dùng), "turn" lệnh xem đăng nhập vẫn chạy
// nhưng lượt chat thật lỗi (qua kiểm tra, rồi tự trả về bản trước).
// Máy chủ token giả lập (kiểm thử HOME riêng của lượt, Blueprint G1): chỉ chạy khi tệp đăng nhập là JSON có mock_oauth và mock-cli.json có tokenServer
// (tệp trạng thái). Như OAuth có xoay vòng refresh token: token hết hạn (exp) thì CLI đổi refresh token cũ lấy cái mới (ghi tệp tạm rồi đổi tên, như CLI thật);
// token vừa bị thay còn dùng được tokenGraceMs (hai lượt làm mới cùng lúc nhận cùng một token mới); dùng lại token cũ hơn nữa là "tái sử dụng":
// hãng thu hồi cả họ token, mọi lượt sau báo lỗi đăng nhập. Trả chuỗi lỗi, hoặc null khi được phép chạy tiếp.
function oauthTurn(file) {
  let tok;
  try { tok = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  if (!tok || tok.mock_oauth !== true || !cfg.tokenServer) return null;
  const st = cfg.tokenServer, lk = `${st}.lock`, now = Date.now();
  const locked = (fn) => {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lk); break; } catch { if (i > 4000) throw new Error("token server busy"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    }
    try { return fn(readJson(st, {})); } finally { fs.rmdirSync(lk); }
  };
  if (tok.exp > now) return readJson(st, {}).revoked ? "authentication failed: invalid_grant (token family revoked)" : null;
  const r = locked((s) => {
    s.log ??= [];
    if (s.revoked) return { err: "authentication failed: invalid_grant (token family revoked)" };
    if (tok.rt === s.current) {
      s.gen = (s.gen ?? 0) + 1; s.prev = s.current; s.prevUntil = now + (cfg.tokenGraceMs ?? 2000); s.current = `rt-${s.gen}-${uuid().slice(0, 8)}`;
      s.log.push({ at: now, from: tok.rt, to: s.current, pid: process.pid });
    } else if (tok.rt === s.prev && now < s.prevUntil) s.log.push({ at: now, from: tok.rt, to: s.current, grace: true, pid: process.pid });
    else { s.revoked = true; s.log.push({ at: now, from: tok.rt, reuse: true, pid: process.pid }); writeJson(st, s); return { err: "authentication failed: invalid_grant (refresh token reuse detected, token family revoked)" }; }
    writeJson(st, s);
    return { rt: s.current, gen: s.gen };
  });
  if (r.err) return r.err;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...tok, rt: r.rt, gen: r.gen, exp: Date.now() + (cfg.tokenTtlMs ?? 3_600_000) }));
  fs.renameSync(tmp, file);
  return null;
}
const local = (f) => { try { return fs.readFileSync(path.join(__dirname, f), "utf8").trim(); } catch { return ""; } };
const version = (line) => local("mock-version") || line;
function gate(a) {
  const m = local("mock-break");
  if (!m || a[0] === "--version" || a[0] === "version") return;
  const status = (a[0] === "auth" && a[1] === "status") || (a[0] === "login" && a[1] === "status") || a[0] === "models";
  if (m === "smoke" || (m === "turn" && !status)) { console.error("mock: broken build (segmentation fault)"); process.exit(3); }
}
module.exports = { oauthTurn, version, gate, sxKit, TINY_JPEG, tinyPng, isImageTurn, imageCount, imageMode, imageLog, saveImage, stallTurn, STALL_TEXT, mediaDesc, mediaReply, mcp, isTitleAsk, mockTitle, mockBrain, prefsEcho, ruleEcho, pjEcho, toolAsk, cfg, sleep, out, uuid, readStdin, readLine, flag, bumpSession, bumpUsage, totalTurns, reply, chunks, fs, path, crypto };
module.exports.pjSession = pjSession;
module.exports.cliPatch = cliPatch;
