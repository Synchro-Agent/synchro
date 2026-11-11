// Gọi lại kết hợp (BM25 + embedding + xếp lại) của bộ não và tài liệu lớn, với API embedding giả lập (scripts/mock-embed.mjs qua mock-providers):
// tìm được ghi chú cùng nghĩa khác chữ (tiếng Việt, tiếng Anh, chéo hai thứ tiếng) mà BM25 bỏ sót; không có khóa thì như cũ; hạn mức chi phí;
// đổi model thì embed lại; quá ngân sách thời gian thì dùng BM25; vector trong RAM có trần và tự bỏ khi rảnh. Không cần máy chủ Synchro.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { startMock } from "../../scripts/mock-providers.mjs";
import { EMBED_LOG } from "../../scripts/mock-embed.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-hybrid-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "hybrid-test"; process.env.SYNCHRO_LLM_RERANK = "0";
delete process.env.SYNCHRO_EMBED_MODEL; delete process.env.SYNCHRO_EMBED_DAY_USD; delete process.env.LLM_PROVIDER; delete process.env.LLM_API_KEY;
const srv = await startMock(0);
const M = `http://127.0.0.1:${srv.address().port}`;
const { brain: B, vecstore: V, authstore: AU, providers: P, usage: US, fileproc: FP } = await loadTs(["brain", "vecstore", "authstore", "providers", "usage", "fileproc"]);
const mk = (n) => AU.createUser({ email: `hybrid${n}${Date.now()}@synchro.test`, name: "H", verified: true });
const recall = async (u, q, o = {}) => { let tr = null; const s = await B.brainRecallHybrid(u, q, undefined, { ...o, trace: (t) => { tr = t; } }); return { s, tr }; };

const u = mk(1);
const notes = [
  ["Mua xe", "Đang tính mua một chiếc ô tô điện cho cả nhà, ưu tiên đi được xa."],
  ["Lập kế hoạch chi tiêu", "Lập ngân sách hằng tháng, ghi lại từng khoản."],
  ["Health check", "My physician told me to cut caffeine and go to bed earlier."],
  ["Thú nuôi", "My puppy has been unwell all week, vomiting twice."],
  ["Wedding plan", "We are planning the marriage ceremony for next spring."],
];
for (const [t, b] of notes) B.saveNote(u, t, { body: b });
for (let i = 0; i < 12; i++) B.saveNote(u, `Ghi chú ${i}`, { body: `Nội dung thường ngày số ${i} về công việc văn phòng, họp nhóm và báo cáo.` });

// ---- 1. Chưa có khóa OpenAI / Gemini: như trước, chỉ BM25, không gọi API nào.
{
  ok(P.embedTarget() === null, "chưa có khóa: không có model embedding");
  ok(await V.drainEmbedQueue() === 0 && EMBED_LOG.calls === 0, "chưa có khóa: hàng embed bỏ qua, không gọi API", JSON.stringify(EMBED_LOG));
  const r = await recall(u, "automobile purchase");
  ok(r.s === "" && r.tr?.mode === "bm25", "chưa có khóa: gọi lại chỉ dùng BM25", JSON.stringify(r.tr));
  const k = await recall(u, "ô tô điện");
  ok(/Mua xe/.test(k.s), "chưa có khóa: từ khóa vẫn gọi lại được", k.s);
}

// ---- 2. Có khóa OpenAI (khóa quản trị viên đã nhập): embed ở nền, gọi lại theo nghĩa.
await P.saveProvider({ id: "openai", key: "sk-mock-openai-0001", baseUrl: `${M}/openai/v1` });
const tg = P.embedTarget();
ok(tg?.model === "text-embedding-3-small" && tg.provider === "openai", "có khóa OpenAI: dùng text-embedding-3-small", JSON.stringify(tg && { ...tg, key: "…" }));
{
  B.warmRecall(u.id);
  const n = await V.drainEmbedQueue();
  ok(n === notes.length + 12 && V.vecCount("brain", u.id) === n, `embed ở nền theo lô: ${n} ghi chú`, `${n} ${V.vecCount("brain", u.id)}`);
  ok(EMBED_LOG.calls === 1, "17 ghi chú gửi trong một lô", JSON.stringify(EMBED_LOG));
  const id = B.getNote(u.id, "Mua xe").id;
  ok(V.vecInfo("brain", id)?.dim === 64, "lưu Float32 kèm số chiều và model", JSON.stringify(V.vecInfo("brain", id)));
  ok(await V.drainEmbedQueue() === 0 && EMBED_LOG.calls === 1, "không đổi gì: không embed lại");
  const cases = [
    ["automobile purchase", /Mua xe/, "tiếng Anh tìm ghi chú tiếng Việt (ô tô ↔ automobile)"],
    ["quản lý tiền bạc", /Lập kế hoạch chi tiêu/, "tiếng Việt, từ đồng nghĩa (tiền ↔ ngân sách)"],
    ["what did the doctor say", /Health check/, "tiếng Anh, từ đồng nghĩa (doctor ↔ physician)"],
    ["chó bị ốm", /Thú nuôi/, "tiếng Việt tìm ghi chú tiếng Anh (chó ốm ↔ puppy unwell)"],
    ["đám cưới", /Wedding plan/, "đám cưới ↔ marriage"],
  ];
  for (const [q, re, name] of cases) {
    const bm = B.brainRecall(u.id, q);
    const r = await recall(u, q);
    ok(!re.test(bm) && re.test(r.s) && r.tr.mode === "hybrid", `${name}: BM25 bỏ sót, kết hợp tìm thấy`, `bm=${bm.slice(0, 120)} | hy=${r.s.slice(0, 300)} ${JSON.stringify(r.tr)}`);
  }
  const both = await recall(u, "ô tô điện");
  ok(/Mua xe/.test(both.s) && /Mua xe/.test(both.s.split("\n")[2] ?? ""), "khớp cả chữ lẫn nghĩa: đứng đầu", both.s);
  const none = await recall(u, "xyzzy quasar");
  ok(none.s === "", "không liên quan: không gọi lại", none.s);
  const one = await recall(u, "automobile purchase");
  ok(one.tr.ids.length >= 1 && one.tr.ids.length <= 4, "tối đa 4 ghi chú", JSON.stringify(one.tr));
  // Câu hỏi đã embed thì lần sau không gọi API nữa.
  const c0 = EMBED_LOG.calls; await recall(u, "automobile purchase");
  ok(EMBED_LOG.calls === c0, "câu hỏi lặp lại: dùng vector đã có");
  // Sửa ghi chú: embed lại đúng ghi chú đó.
  B.saveNote(u, "Mua xe", { body: "Đã bỏ ý định mua ô tô, chuyển sang đi du lịch Đà Lạt." });
  const re = await V.drainEmbedQueue();
  ok(re === 1, "sửa một ghi chú: chỉ embed lại ghi chú đó", re);
  const trip = await recall(u, "vacation plans");
  ok(/Mua xe/.test(trip.s), "nội dung mới tìm được theo nghĩa (du lịch ↔ vacation)", trip.s);
  // Ngân sách thời gian: embed câu hỏi quá chậm thì dùng BM25, không bắt lượt chat chờ.
  const t0 = Date.now();
  const slow = await recall(u, "#embedslow automobile", { budgetMs: 300 });
  ok(Date.now() - t0 < 1500 && slow.tr.mode === "bm25", `embed câu hỏi quá hạn: trả BM25 sau ${Date.now() - t0} ms`, JSON.stringify(slow.tr));
  ok(V.vecStats().queryTimeouts >= 1, "quá hạn được đếm trong số liệu", JSON.stringify(V.vecStats()));
  // Hãng vẫn tính tiền lệnh gọi quá hạn: nó chạy xong ở nền, chi phí vào Mức dùng, vector vào bộ đệm; lượt sau không gửi lại.
  const cost0 = US.featureCost(u.id, "embed", 0), calls0 = EMBED_LOG.calls;
  const again = await recall(u, "#embedslow automobile", { budgetMs: 300 });
  ok(again.tr.mode === "bm25" && EMBED_LOG.calls === calls0, "hỏi lại khi lệnh trước còn chạy: không gửi lần nữa", `${EMBED_LOG.calls} ${calls0}`);
  await new Promise((r) => setTimeout(r, 3300));
  ok(US.featureCost(u.id, "embed", 0) > cost0, "lệnh quá hạn chạy xong ở nền: chi phí vẫn ghi vào Mức dùng", `${US.featureCost(u.id, "embed", 0)} ${cost0}`);
  const calls1 = EMBED_LOG.calls;
  const warm = await recall(u, "#embedslow automobile", { budgetMs: 300 });
  ok(warm.tr.mode === "hybrid" && EMBED_LOG.calls === calls1, "lượt sau dùng vector đã có, không gửi lại", JSON.stringify(warm.tr));
  // Xóa ghi chú: vector đi theo.
  B.deleteNote(u, "Wedding plan");
  ok(!(await recall(u, "đám cưới")).s.includes("Wedding"), "xóa ghi chú: không gọi lại nữa");
}

// ---- 3. Hạn mức chi phí embed mỗi ngày, tính vào Mức dùng.
{
  const spent = US.featureCost(u.id, "embed", 0);
  ok(spent > 0, `chi phí embed tính vào Mức dùng (${spent.toExponential(2)} USD)`, spent);
  const u2 = mk(2);
  for (let i = 0; i < 20; i++) B.saveNote(u2, `Trang ${i}`, { body: `Chuyện số ${i} về ô tô và du lịch.` });
  process.env.SYNCHRO_EMBED_DAY_USD = "0.0000000001";
  const before = V.vecStats().skippedCap;
  ok(await V.embedPending("brain", u2.id) === 0 && V.vecCount("brain", u2.id) === 0, "hết hạn mức: không embed");
  ok(V.vecStats().skippedCap > before, "bị chặn vì hạn mức được đếm", JSON.stringify(V.vecStats()));
  const r = await recall(u2, "automobile");
  ok(r.tr.mode === "bm25", "hết hạn mức: gọi lại vẫn chạy bằng BM25", JSON.stringify(r.tr));
  delete process.env.SYNCHRO_EMBED_DAY_USD;
  ok(await V.embedPending("brain", u2.id) === 20, "trong hạn mức: embed bình thường");
}

// ---- 3b. Hãng từ chối một mục (400): chia lô tìm đúng mục đó, các mục khác vẫn được embed; mục bị xóa trong lúc chờ API không quay lại.
{
  const u4 = mk(4);
  for (let i = 0; i < 6; i++) B.saveNote(u4, `Việc ${i}`, { body: i === 3 ? "Đoạn quá dài #embed400 về ô tô." : `Chuyện số ${i} về du lịch.` });
  const n = await V.embedPending("brain", u4.id);
  const bad = B.getNote(u4.id, "Việc 3").id;
  ok(n === 5 && V.vecCount("brain", u4.id) === 5 && V.vecInfo("brain", bad)?.dim === 0, `lô bị từ chối 400: ${n}/6 mục embed được, mục lỗi ghi dim = 0`, `${n} ${JSON.stringify(V.vecInfo("brain", bad))}`);
  const c0 = EMBED_LOG.calls;
  ok(await V.embedPending("brain", u4.id) === 0 && EMBED_LOG.calls === c0, "lần sau không thử lại mãi mục lỗi, không chặn mục khác");
  B.saveNote(u4, "Việc 3", { body: "Đã sửa: chuyện về ô tô." });
  ok(await V.embedPending("brain", u4.id) === 1 && V.vecInfo("brain", bad)?.dim > 0, "sửa nội dung mục lỗi: embed lại được");

  const u6 = mk(6);
  B.saveNote(u6, "Chậm", { body: "Ghi chú #embedslow về ô tô." });
  B.saveNote(u6, "Khác", { body: "Ghi chú về du lịch." });
  const ids = ["Chậm", "Khác"].map((t) => B.getNote(u6.id, t).id);
  const p = V.embedPending("brain", u6.id);
  await new Promise((r) => setTimeout(r, 300));
  B.deleteNote(u6, "Chậm");
  await p;
  ok(!V.vecInfo("brain", ids[0]) && V.vecInfo("brain", ids[1])?.dim > 0, "ghi chú bị xóa trong lúc chờ API: vector của nó không được ghi lại", JSON.stringify([V.vecInfo("brain", ids[0]), V.vecInfo("brain", ids[1])]));

  const u7 = mk(7);
  B.saveNote(u7, "Chậm", { body: "Ghi chú #embedslow về chó." });
  const p7 = V.embedPending("brain", u7.id);
  await new Promise((r) => setTimeout(r, 300));
  AU.db().prepare("DELETE FROM users WHERE id = ?").run(u7.id);
  AU.db().prepare("DELETE FROM brain_notes WHERE user_id = ?").run(u7.id);
  await p7;
  const left = AU.db().prepare("SELECT (SELECT COUNT(*) FROM vec_items WHERE owner = ?) + (SELECT COUNT(*) FROM usage_events WHERE user_id = ?) AS n").get(u7.id, u7.id).n;
  ok(left === 0, "tài khoản bị xóa trong lúc chờ API: không ghi lại vector hay dòng Mức dùng", left);
}

// ---- 4. Đổi model: embed lại toàn bộ, số chiều mới được ghi lại.
{
  process.env.SYNCHRO_EMBED_MODEL = "openai/text-embedding-3-large";
  ok(V.vecCount("brain", u.id) === 0, "model mới: chưa có vector nào của model này");
  const r0 = await recall(u, "automobile purchase");
  ok(r0.tr.mode === "bm25", "trong lúc chưa embed lại: dùng BM25", JSON.stringify(r0.tr));
  const n = await V.embedPending("brain", u.id);
  const id = B.getNote(u.id, "Health check").id;
  ok(n >= 15 && V.vecInfo("brain", id)?.model === "text-embedding-3-large" && V.vecInfo("brain", id)?.dim === 96, `đổi model: embed lại ${n} ghi chú (96 chiều)`, JSON.stringify(V.vecInfo("brain", id)));
  ok(/Health check/.test((await recall(u, "what did the doctor say")).s), "model mới: gọi lại theo nghĩa vẫn đúng");
  delete process.env.SYNCHRO_EMBED_MODEL;
  // Chỉ có khóa Gemini: dùng gemini-embedding-001 qua lối tương thích OpenAI.
  P.removeProvider("openai");
  await P.saveProvider({ id: "google", key: "AIza-mock-gemini-0001", baseUrl: `${M}/google/v1beta/openai` });
  ok(P.embedTarget()?.model === "gemini-embedding-001", "chỉ có khóa Gemini: dùng gemini-embedding-001");
  const g = await V.embedPending("brain", u.id);
  ok(g >= 15 && V.vecInfo("brain", id)?.dim === 80, `Gemini: embed lại ${g} ghi chú`, JSON.stringify(V.vecInfo("brain", id)));
  const r = await recall(u, "chó bị ốm");
  ok(/Thú nuôi/.test(r.s) && r.tr.mode === "hybrid", "Gemini: gọi lại theo nghĩa đúng (ngưỡng cosine riêng của Gemini)", r.s);
}

// ---- 4b. Câu hỏi mơ hồ: nhờ model rẻ nhất qua khóa API xếp lại, trong ngân sách thời gian; trả lời không dùng được thì giữ thứ tự cũ.
{
  const ux = mk(5);
  for (let i = 0; i < 8; i++) B.saveNote(ux, `Xe ${i}`, { body: `Chuyện số ${i} về chiếc ô tô của gia đình.` });
  await V.embedPending("brain", ux.id);
  process.env.SYNCHRO_LLM_RERANK = "1";
  const t0 = Date.now();
  const r = await recall(ux, "ô tô", { budgetMs: 900 });
  const ms = Date.now() - t0;
  process.env.SYNCHRO_LLM_RERANK = "0";
  const hist = await (await fetch(`${M}/_debug/hist`)).json();
  const asked = Object.values(hist).flat().some((b) => JSON.stringify(b).includes("brain_rerank"));
  ok(asked, "câu hỏi mơ hồ (2 từ, nhiều ứng viên): hỏi model rẻ xếp lại", Object.keys(hist).join(","));
  ok(r.tr.ids.length === 4 && ms < 1300, `xếp lại trong ngân sách (${ms} ms, ${r.tr.reranked})`, JSON.stringify(r.tr));
  // Lệnh xếp lại quá ngân sách không bị hủy: chạy xong ở nền nên chi phí vẫn vào Mức dùng của người hỏi.
  for (let i = 0; i < 40 && !(US.featureCost(ux.id, "brain-rerank", 0) > 0); i++) await new Promise((x) => setTimeout(x, 100));
  ok(US.featureCost(ux.id, "brain-rerank", 0) > 0, "lệnh xếp lại (kể cả quá ngân sách) được tính vào Mức dùng", US.featureCost(ux.id, "brain-rerank", 0));
  // Model xếp lại thường chậm hơn ngân sách: bỏ bước này thay vì bắt lượt chat chờ hết ngân sách (thử lại mỗi 5 phút).
  process.env.SYNCHRO_LLM_RERANK = "1";
  for (let i = 0; i < 2; i++) { await recall(ux, "ô tô", { budgetMs: 320 }); await new Promise((x) => setTimeout(x, 1500)); }
  const t1 = Date.now();
  const fast = await recall(ux, "ô tô", { budgetMs: 320 });
  const ms2 = Date.now() - t1;
  process.env.SYNCHRO_LLM_RERANK = "0";
  ok(fast.tr.ids.length === 4 && ms2 < 150, `model xếp lại chậm hơn ngân sách: bỏ qua, không chờ (${ms2} ms)`, JSON.stringify(fast.tr));
}

// ---- 5. Bộ nhớ: vector nạp theo người khi cần, trần dung lượng, bỏ khi rảnh, báo cho memstat.
{
  const st = V.vecStats();
  ok(st.sets >= 1 && st.vectors >= 15 && st.kb > 0, `số liệu vector trong RAM: ${JSON.stringify(st)}`);
  ok(V.evictVecs(Date.now()) === 0, "vừa dùng: không bỏ");
  ok(V.evictVecs(Date.now() + 21 * 60_000) >= 1 && V.vecStats().sets === 0, "rảnh quá 20 phút: bỏ khỏi RAM");
  ok(/Thú nuôi/.test((await recall(u, "chó bị ốm")).s), "bỏ rồi vẫn gọi lại đúng (nạp lại từ SQLite)");
  const u3 = mk(3);
  for (let i = 0; i < 10; i++) B.saveNote(u3, `Mục ${i}`, { body: `Ghi chép ${i} về tài chính gia đình.` });
  await V.embedPending("brain", u3.id);
  process.env.SYNCHRO_VEC_RAM_MB = "0.001";
  await recall(u, "chó bị ốm"); await recall(u3, "money");
  ok(V.vecStats().sets === 1, "vượt trần RAM: chỉ giữ người dùng gần nhất", JSON.stringify(V.vecStats()));
  delete process.env.SYNCHRO_VEC_RAM_MB;
  const { memstat: MS } = await loadTs(["memstat"]);
  ok(typeof MS.cacheStats().vectors?.kb === "number", "Sức khỏe hệ thống thấy cỡ vector (memstat)", JSON.stringify(MS.cacheStats()));
}

// ---- 6. Tài liệu lớn của dự án: chọn đoạn bằng BM25 + nghĩa.
{
  const filler = (i) => Array.from({ length: 450 }, (_, k) => `mục${i}x${k % 37} báo cáo quý`).join(" ");
  const paras = Array.from({ length: 16 }, (_, i) => (i === 11 ? `Phần này nói về đội xe hơi của công ty và lịch bảo dưỡng ô tô. ${filler(i)}` : filler(i)));
  const text = paras.join("\n\n") + `\n\n(${Date.now()})`;
  const rec = await FP.processFile(Buffer.from(text), "baocao.txt", u.id);
  const { chunkForRag } = await loadTs(["fileproc/rag"]).then((m) => m["fileproc/rag"]);
  const parts = chunkForRag(text);
  const hit = parts.findIndex((p) => p.includes("xe hơi"));
  const k0 = await FP.pickChunks(rec.id, u.id, parts, "automobile fleet", 3);
  ok(!k0.includes(hit), "tài liệu chưa embed: BM25 không thấy đoạn nói về xe", JSON.stringify(k0));
  await V.drainEmbedQueue({ maxOwners: 50 });
  ok(V.vecCount("file", rec.id) === parts.length, `embed các đoạn của tài liệu (${parts.length} đoạn)`, V.vecCount("file", rec.id));
  const k1 = await FP.pickChunks(rec.id, u.id, parts, "automobile fleet", 3);
  ok(k1.includes(hit), "đã embed: chọn đúng đoạn nói về ô tô dù câu hỏi tiếng Anh", JSON.stringify(k1));
  // Vector của tài liệu dùng chung không gắn với người trả tiền: xóa tài khoản người đó không xóa vector người khác đang dùng.
  const tagged = AU.db().prepare("SELECT COUNT(*) AS n FROM vec_items WHERE scope = 'file' AND owner = ? AND user_id != ''").get(rec.id).n;
  ok(tagged === 0, "vector đoạn tài liệu không ghi người trả tiền (xóa tài khoản không xóa theo)", tagged);
  // Tệp được đọc lại (bộ đọc mới): đoạn đổi chữ được embed lại, đoạn thừa bị xóa.
  const jp = path.join(process.cwd(), ".cache", "files", rec.id + ".json");
  const stored = JSON.parse(fs.readFileSync(jp, "utf8"));
  const parts2 = parts.slice(0, -1).map((p, i) => (i === 2 ? p.replace("báo cáo quý", "chuyến du lịch") : p));
  stored.blocks = [{ type: "text", text: parts2.join("\n\n") }];
  fs.writeFileSync(jp, JSON.stringify(stored));
  const real2 = (await loadTs(["fileproc/rag"]))["fileproc/rag"].chunkForRag(parts2.join("\n\n"));
  const h2 = V.vecInfo("file", `${rec.id}#2`)?.hash;
  const c2 = EMBED_LOG.inputs;
  await V.embedPending("file", rec.id);
  ok(V.vecInfo("file", `${rec.id}#2`)?.hash !== h2 && V.vecCount("file", rec.id) === real2.length, `tệp đọc lại: đoạn đổi chữ embed lại, còn ${real2.length} đoạn`, `${EMBED_LOG.inputs - c2} ${V.vecCount("file", rec.id)} ${real2.length}`);

  // Người hỏi gần nhất (còn giữ tệp) trả phần embed tiếp theo, không phải người hỏi đầu tiên.
  const text3 = paras.map((p) => p.replace("báo cáo", "biên bản")).join("\n\n") + `\n\n(${Date.now()}b)`;
  const ua = mk(8), ub = mk(9);
  const r3 = await FP.processFile(Buffer.from(text3), "chung.txt", ua.id);
  await FP.processFile(Buffer.from(text3), "chung.txt", ub.id);
  const parts3 = chunkForRag(text3);
  await FP.pickChunks(r3.id, ua.id, parts3, "automobile", 3);
  await FP.pickChunks(r3.id, ub.id, parts3, "automobile", 3);
  const a0 = US.featureCost(ua.id, "embed", 0), b0 = US.featureCost(ub.id, "embed", 0);
  await V.drainEmbedQueue({ maxOwners: 50 });
  ok(V.vecCount("file", r3.id) === parts3.length && US.featureCost(ub.id, "embed", 0) > b0 && US.featureCost(ua.id, "embed", 0) === a0, "tài liệu chung: người hỏi gần nhất trả chi phí embed", `${US.featureCost(ua.id, "embed", 0)} ${a0} ${US.featureCost(ub.id, "embed", 0)} ${b0}`);
  for (const ext of [".json", ".bin"]) fs.rmSync(path.join(process.cwd(), ".cache", "files", r3.id + ext), { force: true });
  fs.rmSync(path.join(process.cwd(), ".cache", "files", rec.id + ".json"), { force: true });
  fs.rmSync(path.join(process.cwd(), ".cache", "files", rec.id + ".bin"), { force: true });
}

// ---- 7. Truy vấn đếm vector chỉ đọc chỉ mục (không nạp từng vector ~3 KB); Sức khỏe hệ thống có tên cho mọi số liệu vector.
{
  const plan = AU.db().prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) AS n, MAX(at) AS m FROM vec_items WHERE scope = ? AND owner = ? AND model = ? AND dim > 0").all("brain", "x", "m").map((r) => r.detail).join(" | ");
  ok(/COVERING INDEX/.test(plan), "đếm vector dùng chỉ mục phủ", plan);
  const src = fs.readFileSync(path.join(process.cwd(), "app", "healthui.tsx"), "utf8");
  const unit = src.slice(src.indexOf("const UNIT"), src.indexOf("const cacheText"));
  const miss = Object.keys(V.vecStats()).filter((k) => !new RegExp(`\\b${k}:`).test(unit));
  ok(!miss.length, "mọi số liệu vector có tên dễ hiểu ở Sức khỏe hệ thống", miss.join(","));
}

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
