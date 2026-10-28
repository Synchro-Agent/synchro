// Phần dùng chung của CLI giả lập (claude, codex, agy) cho npm run dev:mock: không gọi mạng thật, không cần tài khoản.
// dev:mock chép các tệp này vào <engine home>/.local/bin kèm mock-cli.json ({ base: địa chỉ máy chủ giả lập }).
const fs = require("fs"), path = require("path"), crypto = require("crypto"), readline = require("readline");

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
 * Bộ não tổng hợp (app/brain.ts): chưng cất một đoạn chat thành JSON ghi chú, hoặc tổng hợp trung tâm, như model thật.
 * Trả về null khi không phải lời gọi của bộ não.
 */
function mockBrain(prompt) {
  if (prompt.includes("Đoạn chat cần chưng cất:")) {
    const body = prompt.split("Đoạn chat cần chưng cất:")[1] ?? "";
    const users = [...body.matchAll(/\[Người dùng\]\n([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
    const first = (users[0] ?? "Đoạn chat").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() || "Đoạn chat";
    const all = users.join(" ");
    const KNOWN = [["IELTS", /ielts/i], ["Ôn thi THPT", /thpt|ôn thi|đề thi/i], ["Toán", /\btoán\b|phương trình|đạo hàm/i], ["Lập trình", /python|javascript|\bcode\b|lập trình/i], ["Gym", /\bgym\b|tập luyện/i], ["Du học", /du học/i], ["Cyber security", /cyber|bảo mật/i]];
    const topics = KNOWN.filter(([, r]) => r.test(all)).map(([n]) => ({ name: n, desc: `Chủ đề ${n}.` })).slice(0, 3);
    const NAMES = ["Python", "Hà Lan", "IELTS Writing", "Casio", "Synchro", "JavaScript", "Next.js"];
    const entities = NAMES.filter((n) => all.toLowerCase().includes(n.toLowerCase())).slice(0, 4);
    const title = first.split(" ").slice(0, 6).join(" ");
    return JSON.stringify({
      title: title[0].toUpperCase() + title.slice(1), gist: `Người dùng hỏi: ${first.slice(0, 120)}. Trợ lý đã trả lời và gợi ý cách làm.`,
      points: users.slice(0, 3).map((u) => u.slice(0, 100)), decisions: [], tasks: /mai|làm tiếp|chưa xong/i.test(all) ? [`Làm tiếp: ${first.slice(0, 60)}`] : [],
      topics: topics.length ? topics : [{ name: "Chung", desc: "Những câu hỏi chung." }], entities, importance: users.length > 1 ? 4 : 3,
    });
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
function reply(name, prompt, turn) {
  if (isTitleAsk(prompt)) return mockTitle(prompt);
  const last = prompt.trim().split("\n").filter(Boolean).pop() ?? "";
  return `Chào bạn! Mình là ${name} chạy qua CLI giả lập (lượt ${turn} của hội thoại). Bạn vừa nói: "${last.slice(0, 120)}".`;
}
/** Tổng số lượt đã chat (mọi phiên) trong thư mục cấu hình: dùng để giả lập phần trăm hạn mức đã dùng. */
const totalTurns = (dir) => Object.values(readJson(path.join(dir, "mock-sessions.json"), {})).reduce((x, y) => x + y, 0);
const chunks = (t, n = 12) => Array.from({ length: Math.ceil(t.length / n) }, (_, i) => t.slice(i * n, i * n + n));

// Gọi cầu nối MCP của Synchro như CLI thật (Streamable HTTP, JSON-RPC): initialize → tools/list → (tools/call).
async function mcp(url, call) {
  const rpc = async (method, params, id) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
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

module.exports = { mediaDesc, mediaReply, mcp, isTitleAsk, mockTitle, mockBrain, prefsEcho, toolAsk, cfg, sleep, out, uuid, readStdin, readLine, flag, bumpSession, bumpUsage, totalTurns, reply, chunks, fs, path, crypto };
