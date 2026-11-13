// D4: nguồn embed kho skill tuân hợp đồng pending(owner, model, limit) như brain / file: chỉ trả skill chưa có vector (hoặc đổi nội dung),
// tối đa limit mục; embedPending tôn trọng trần max (không embed cả kho ~18.000 skill trong một nhịp). API embedding giả lập, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { startMock } from "../../scripts/mock-providers.mjs";
import { EMBED_LOG } from "../../scripts/mock-embed.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-skillvec-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "skillvec-test";
delete process.env.SYNCHRO_EMBED_MODEL; delete process.env.SYNCHRO_EMBED_DAY_USD; delete process.env.LLM_PROVIDER; delete process.env.LLM_API_KEY;
const srv = await startMock(0);
const M = `http://127.0.0.1:${srv.address().port}`;
const { vecstore: V, authstore: AU, providers: P } = await loadTs(["vecstore", "authstore", "providers"]);
const payer = AU.createUser({ email: `skillvec${Date.now()}@synchro.test`, name: "S", verified: true });
await P.saveProvider({ id: "openai", key: "sk-mock-openai-0001", baseUrl: `${M}/openai/v1` });
const model = P.embedTarget()?.model;
ok(!!model, "có model embedding giả lập", model);

let kho = Array.from({ length: 300 }, (_, i) => ({ item: `skill-${i}`, text: `skill-${i} Mô tả skill số ${i} về công việc ${i % 7}`, srcAt: 1 }));
V.registerSkillVecSource(() => kho, () => payer.id);
const src = globalThis.__vecSources.get(V.SKILL_SCOPE);

console.log("1. pending tôn trọng limit");
ok((await src.pending(V.SKILL_OWNER, model, 50)).length === 50, "limit = 50 → đúng 50 mục");
ok((await src.pending(V.SKILL_OWNER, model, 0)).length === 0, "limit = 0 → không mục nào");

console.log("2. embedPending tôn trọng trần max");
const calls0 = EMBED_LOG.calls;
const n1 = await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 100);
ok(n1 === 100, `max = 100 → chỉ embed 100 mục (được ${n1})`, n1);
ok(V.vecCount(V.SKILL_SCOPE, V.SKILL_OWNER) === 100, "đúng 100 vector trong kho", V.vecCount(V.SKILL_SCOPE, V.SKILL_OWNER));
ok((await src.pending(V.SKILL_OWNER, model, 1000)).length === 200, "pending sau đó chỉ còn 200 mục chưa embed");

console.log("3. Đã embed hết: lần gọi sau trả 0, không gọi API");
const n2 = await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 1000);
ok(n2 === 200, `embed nốt 200 mục (được ${n2})`, n2);
const calls1 = EMBED_LOG.calls;
ok((await src.pending(V.SKILL_OWNER, model, 1000)).length === 0, "pending trả 0 khi mọi skill đã có vector");
ok(await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 1000) === 0 && EMBED_LOG.calls === calls1, "embedPending lần hai trả 0, không gọi API", `${EMBED_LOG.calls} ${calls1} ${calls0}`);

console.log("4. Thế hệ bộ đệm đổi (srcAt khác) nhưng nội dung không đổi: vẫn bỏ qua; đổi mô tả: embed lại đúng mục đó");
kho = kho.map((x) => ({ ...x, srcAt: 2 }));
ok((await src.pending(V.SKILL_OWNER, model, 1000)).length === 0, "srcAt đổi, nội dung giữ nguyên → không mục nào");
kho[5] = { ...kho[5], text: "skill-5 Mô tả mới hoàn toàn" };
const p = await src.pending(V.SKILL_OWNER, model, 1000);
ok(p.length === 1 && p[0].item === "skill-5", "chỉ skill-5 cần embed lại", p.map((x) => x.item).join());
ok(await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER) === 1, "embed lại đúng 1 mục");

console.log("5. Trùng tên giữa các thư viện (mô tả khác nhau): giữ bản đầu, không embed lại mỗi nhịp, các skill phía sau vẫn tới lượt");
const dupKho = [];
for (let i = 0; i < 130; i++) dupKho.push({ item: `dup-${i}`, text: `dup-${i} bản thư viện A số ${i}`, srcAt: 3 }, { item: `dup-${i}`, text: `dup-${i} bản thư viện B khác hẳn ${i}`, srcAt: 3 });
for (let j = 0; j < 200; j++) dupKho.push({ item: `uniq-${j}`, text: `uniq-${j} Skill riêng số ${j}`, srcAt: 3 });
kho = dupKho;
const pd = await src.pending(V.SKILL_OWNER, model, 1000);
ok(pd.length === 330 && new Set(pd.map((x) => x.item)).size === 330, "pending không trả trùng tên (330 tên khác nhau)", pd.length);
ok(pd.find((x) => x.item === "dup-7")?.text.includes("thư viện A"), "giữ bản đầu tiên của tên trùng", pd.find((x) => x.item === "dup-7")?.text);
const nd = await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 1000);
ok(nd === 330, `lần đầu embed đủ 330 tên (được ${nd})`, nd);
ok(Array.from({ length: 200 }, (_, j) => V.vecInfo(V.SKILL_SCOPE, `uniq-${j}`)).every((x) => x && x.dim > 0), "mọi skill phía sau các tên trùng đều có vector");
ok(V.vecInfo(V.SKILL_SCOPE, "dup-7")?.hash === V.vecHash("dup-7 bản thư viện A số 7"), "vector của tên trùng là của bản đầu");
const calls2 = EMBED_LOG.calls;
ok((await src.pending(V.SKILL_OWNER, model, 1000)).length === 0, "sau đó pending trả 0 (bản trùng không bị coi là đã đổi)");
ok(await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 1000) === 0 && await V.embedPending(V.SKILL_SCOPE, V.SKILL_OWNER, 1000) === 0 && EMBED_LOG.calls === calls2, "hai lần drain sau: 0 mục, không gọi API", EMBED_LOG.calls - calls2);

console.log("6. Nguồn có mục kẹt ở đầu (pending luôn trả lại): embedPending vẫn đi tiếp tới các mục phía sau");
const SC = "stuck-test", stuckItems = Array.from({ length: 130 }, (_, i) => ({ item: `stuck-${i}`, text: `stuck ${i} nội dung`, srcAt: 1 }));
const rest = Array.from({ length: 200 }, (_, j) => ({ item: `later-${j}`, text: `later ${j} nội dung`, srcAt: 1 }));
V.registerVecSource(SC, { pending: (_o, _m, limit) => [...stuckItems, ...rest.filter((x) => !V.vecInfo(SC, x.item))].slice(0, limit), userOf: () => payer.id, shared: true });
await V.embedPending(SC, "o1", 2000);
const later = rest.filter((x) => V.vecInfo(SC, x.item)?.dim > 0).length;
ok(later === 200, `200 mục phía sau 130 mục kẹt đều được embed (được ${later})`, later);

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
