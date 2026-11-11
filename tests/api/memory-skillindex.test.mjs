// Bộ nhớ của chỉ mục skill: mỗi lần bộ đệm plugin dựng lại (tạo ~18.000 đối tượng skill mới) chỉ mục được dựng mới rồi thay chỗ, không chồng
// thêm bản cũ. Máy chủ từng hết 2 GB heap sau ~56 giờ một phần vì chỉ mục giữ hai ba bản cũ của cả kho. Tự chạy được, không cần dev:mock.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const { skillroute: SR } = await loadTs(["skillroute"]);
const N = 4000;
const kho = (tag) => Array.from({ length: N }, (_, i) => ({ name: `kho-${i}`, description: `Skill mẫu số ${i} về zebra ${tag} và giraffe.` }));
const postTotal = (ix) => { let n = 0; for (const l of ix.post.values()) n += l.length; return n; };

console.log("1. Dựng lại nhiều lần: chỉ mục không lớn dần");
{
  let first = 0, last;
  for (let r = 0; r < 8; r++) {
    last = kho(`r${r}`);
    await SR.warmSkillIndex(last);
    const ix = globalThis.__skillIx;
    if (r === 0) first = postTotal(ix);
    ok(ix.n === N, `lần ${r + 1}: chỉ mục có đúng ${N} skill (${ix.n})`, ix.n);
  }
  const ix = globalThis.__skillIx;
  ok(postTotal(ix) <= first + N, `số mục trong chỉ mục giữ nguyên cỡ (${first} → ${postTotal(ix)})`);
  ok(ix.post.get("zebra").length === N && ix.post.get("zebra").every((k) => last.includes(k)), "chỉ còn đối tượng skill của lần dựng mới nhất");
  ok(globalThis.__skillNext == null, "không còn bản đang dựng dở");
  const hits = SR.rank("zebra giraffe", last.slice(0, 50).map((skill) => ({ skill })), 5);
  ok(hits.length > 0 && globalThis.__skillIx.n === N, "chấm sau khi dựng vẫn ra kết quả, không thêm gì vào chỉ mục", { hits: hits.length, n: globalThis.__skillIx.n });
}

console.log("2. Hai lần dựng chồng nhau: bản mới nhất thắng, bản cũ bỏ dở");
{
  const a = kho("a"), b = kho("b");
  const pa = SR.warmSkillIndex(a), pb = SR.warmSkillIndex(b);
  await Promise.all([pa, pb]);
  const ix = globalThis.__skillIx;
  ok(ix.n === N && ix.post.get("zebra").every((k) => b.includes(k)), "chỉ mục là của lần dựng sau", ix.n);
}

console.log("3. Chấm giữa lúc đang dựng: dùng bản đang dựng, không đổ cả kho mới vào chỉ mục cũ");
{
  const old = globalThis.__skillIx, c = kho("c");
  const p = SR.warmSkillIndex(c);
  const hits = SR.rank("zebra", c.map((skill) => ({ skill })), 3);
  ok(hits.length === 3, "chấm vẫn ra kết quả", hits.length);
  ok(old.n === N, `chỉ mục cũ không bị thêm (${old.n})`, old.n);
  await p;
  ok(globalThis.__skillIx !== old && globalThis.__skillIx.n === N, "dựng xong thì thay chỗ, cỡ đúng bằng kho", globalThis.__skillIx.n);
}

console.log("4. Skill đọc mới mỗi lượt (skill người dùng tự viết) không tích mãi");
{
  const base = kho("d");
  await SR.warmSkillIndex(base);
  for (let r = 0; r < 40; r++) {
    const mine = Array.from({ length: 500 }, (_, i) => ({ name: `rieng-${i}`, description: `Skill riêng ${i} về zebra.` }));
    SR.rank("zebra", [...base, ...mine].map((skill) => ({ skill })), 3);
  }
  const n = globalThis.__skillIx.n;
  ok(n <= (N + 500) * 3 + 2000 + 500, `chỉ mục có trần (${n})`, n);
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
