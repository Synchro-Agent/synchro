// Nối lại lượt Code sau khi mất mạng: chỉ dòng phát lại từ đầu mới được dựng lại lượt; các lần nối sau giữ phần đã hiện và thẻ đang chờ duyệt. Tự chạy được, fetch giả, không cần dev:mock.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : JSON.stringify(x).slice(0, 500)); };
const { wsclient: W, agentfold: F } = await loadTs(["wsclient", "agentfold"]);

const head = { t: "run", node: { id: 7 }, running: true, count: 3 };
// cut: gửi hết các dòng rồi đứt mạng ở lần đọc sau (lỗi ngay trong start sẽ làm mất các dòng đang xếp hàng).
const body = (lines, cut) => { let sent = false; return new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new TextEncoder().encode(lines.map((l) => JSON.stringify(l) + "\n").join(""))); return; } if (cut) c.error(new TypeError("network")); else c.close(); } }); };
const calls = [];
const reals = [
  (u) => { calls.push(u); return new Response(body([head, { t: "text", text: "phần đầu", s: 1 }, { t: "ask", id: "q", kind: "bash", title: "rm", s: 2 }], true)); },
  (u) => { calls.push(u); return new Response(body([head, { t: "asked", id: "q", ok: true, s: 3 }, { t: "end", s: 3 }])); },
];
let k = 0;
globalThis.fetch = async (u) => reals[k++](String(u));
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, Math.min(ms, 5), ...a); // follow chờ 3 giây giữa hai lần nối

// Đúng cách codeview dùng dòng này: fromStart thì xóa lượt, còn lại gộp sự kiện.
let node = { ai: "bản cũ trên thiết bị", steps: [{ k: "text", text: "bản cũ trên thiết bị" }] }, heads = [];
await W.attachAgent(9, (e) => {
  if (e.t === "run") { heads.push(e.fromStart); if (e.fromStart) node = { ...node, ai: "", steps: [] }; }
  else if (e.t !== "end") node = F.foldAgentEvent(node, e);
}, new AbortController().signal);
globalThis.setTimeout = realSetTimeout;

ok(calls[0].includes("after=0") && calls[1].includes("after=2"), "lần nối sau chỉ xin sự kiện sau mốc đã nhận", calls);
ok(heads[0] === true && heads[1] === false, "lần đầu phát lại từ đầu, lần nối lại thì không", heads);
ok(node.ai === "phần đầu", "phần chữ đã hiện còn nguyên sau khi nối lại", node);
const ask = node.steps.find((x) => x.k === "ask");
ok(ask && ask.state === "ok", "thẻ duyệt còn đó và nhận được kết quả", node.steps);

// Chưa nhận sự kiện nào mà đã mất mạng: máy chủ phát lại hết nên vẫn phải là từ đầu.
const seen = []; let n2 = 0;
globalThis.fetch = async () => (n2++ ? new Response(body([head, { t: "end", s: 3 }])) : new Response(body([head], true)));
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, Math.min(ms, 5), ...a);
await W.attachAgent(9, (e) => { if (e.t === "run") seen.push(e.fromStart); }, new AbortController().signal);
globalThis.setTimeout = realSetTimeout;
ok(seen.length === 2 && seen.every(Boolean), "chưa có sự kiện nào thì nối lại vẫn phát từ đầu", seen);

// Phiên đang có lượt: 409 kèm running được nhận ra để nối vào, các lỗi khác vẫn là lỗi.
globalThis.fetch = async () => Response.json({ error: "Phiên này đang có một lượt chạy.", running: true }, { status: 409 });
const err = await W.streamAgent({ sid: "9" }, () => {}, new AbortController().signal).then(() => null, (e) => e);
ok(W.alreadyRunning(err), "409: nhận ra phiên đang có lượt", String(err));
globalThis.fetch = async () => Response.json({ error: "Bạn gửi quá nhiều yêu cầu." }, { status: 429 });
const err2 = await W.streamAgent({ sid: "9" }, () => {}, new AbortController().signal).then(() => null, (e) => e);
ok(err2 && !W.alreadyRunning(err2) && err2.message === "Bạn gửi quá nhiều yêu cầu.", "429 vẫn là lỗi có lời báo", String(err2));
ok(!W.alreadyRunning(new Error("x")) && !W.alreadyRunning(null), "lỗi mạng không phải đang có lượt");
const view = readFileSync(new URL("../../ui/codeview.tsx", import.meta.url), "utf8");
const handler = /catch \(e\) \{\n\s*if \(alreadyRunning\(e\)[^\n]*\n/.exec(view)?.[0] ?? "";
ok(/joinRun\(/.test(handler) && /return;/.test(handler), "codeview: 409 nối vào lượt và không chạy nhánh kết thúc lượt (endAgent báo running:false)", handler);

// Lời báo của hệ thống theo ngôn ngữ giao diện, chữ của model giữ nguyên.
const dict = readFileSync(new URL("../../app/i18n-features.ts", import.meta.url), "utf8") + readFileSync(new URL("../../app/i18n-dict.ts", import.meta.url), "utf8");
const en = { [W.GONE]: "The server restarted", "Không có ai duyệt sau 30 phút nên lượt này đã dừng.": "Nobody approved" };
const t = (s) => en[s] ?? s;
const folded = F.foldAgentEvent({ ai: "", steps: [] }, { t: "error", error: W.GONE });
ok(folded.steps[0].text === "⚠️ " + W.GONE && F.localizeNote(folded.steps[0].text, t) === "⚠️ The server restarted", "lỗi lượt lưu chữ gốc, hiện theo ngôn ngữ", folded.steps);
ok(F.localizeNote("⚠️ Một câu model tự viết", t) === "⚠️ Một câu model tự viết" && F.localizeNote(W.GONE, t) === W.GONE, "chữ không phải lời báo thì giữ nguyên");
for (const s of [W.GONE, "Phiên này đang có một lượt chạy.", "Không có ai duyệt sau 30 phút nên lượt này đã dừng.", "Không kết nối được agent.", "Lỗi máy chủ", "Tài khoản của bạn đang chạy nhiều lượt cùng lúc. Lượt này đang xếp hàng và sẽ tự chạy khi có lượt xong.", "Máy chủ đang bận. Lượt này đang xếp hàng và sẽ tự chạy khi có chỗ."]) ok(dict.includes(`"${s}"`), "có bản tiếng Anh: " + s.slice(0, 40));
const ui = readFileSync(new URL("../../ui/agentui.tsx", import.meta.url), "utf8");
ok(/localizeNote\(b\.text, tr\)/.test(ui) && /tr\(b\.text\)/.test(ui), "AgentSteps dịch lời báo và ghi chú xếp hàng lúc vẽ");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
