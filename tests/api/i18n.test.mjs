// Đồng bộ ngôn ngữ: mọi chữ giao diện trong app/ phải có bản dịch sang ngôn ngữ còn lại (từ điển app/i18n-dict.ts),
// bản dịch tiếng Anh không được sót chữ tiếng Việt, và các luật dịch chuỗi ghép cho ra đúng câu. Không cần máy chủ.
import { scan } from "../lib/i18n-scan.mjs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 1500)); };

console.log("1. Quét toàn bộ chữ giao diện");
const { total, missing } = await scan();
ok(total > 3000, `tìm thấy ${total} chuỗi giao diện`, total);
const show = (ms) => ms.slice(0, 25).map((m) => `\n     ${m.file}:${m.line} [${m.need}] ${m.text.slice(0, 100)}${m.partial ? ` → ${m.partial.slice(0, 60)}` : ""}`).join("");
ok(!missing.filter((m) => m.need === "en").length, "chữ tiếng Việt đều có bản tiếng Anh", show(missing.filter((m) => m.need === "en")));
ok(!missing.filter((m) => m.need === "vi").length, "chữ tiếng Anh đều có bản tiếng Việt (hoặc là tên riêng / thuật ngữ giữ nguyên)", show(missing.filter((m) => m.need === "vi")));

console.log("2. Dịch đúng câu");
const { "i18n-dict": D0, "i18n-vi": V } = await loadTs(["i18n-dict", "i18n-vi"]);
const D = { ...D0, EN2VI: V.EN2VI, RULES_VI: V.RULES_VI };
const tr = (s, lang) => {
  const map = lang === "en" ? D.VI2EN : D.EN2VI;
  if (Object.prototype.hasOwnProperty.call(map, s)) return map[s];
  for (const [re, f] of lang === "en" ? D.RULES_EN : D.RULES_VI) { const m = s.match(re); if (m) return f(m); }
  return s;
};
ok(tr("Cập nhật lần cuối:", "en") === "Last updated:", "trang điều khoản: “Cập nhật lần cuối:”", tr("Cập nhật lần cuối:", "en"));
ok(tr("Cập nhật 9 giờ trước", "en") === "Updated 9h ago" && tr("Cập nhật vừa xong", "en") === "Updated just now" && tr("Cập nhật", "en") === "Update", "nhãn thời gian “Updated”, nút vẫn là “Update”", tr("Cập nhật 9 giờ trước", "en"));
ok(tr("Giọng trong tài khoản ElevenLabs và thư viện cộng đồng. Đã dùng 3/10 chỗ lưu giọng.", "en") === "Voices in your ElevenLabs account and the community library. 3/10 voice slots used.", "Speech → Giọng nói: câu ghép có số", tr("Giọng trong tài khoản ElevenLabs và thư viện cộng đồng. Đã dùng 3/10 chỗ lưu giọng.", "en"));
ok(tr("Gói Claude của bạn đã hết hạn mức.", "en") === "Your Claude plan has hit its limit.", "thông báo máy chủ có tên gói", tr("Gói Claude của bạn đã hết hạn mức.", "en"));
ok(tr("Signed in with your ChatGPT account · 4 models", "vi") === "Đã đăng nhập bằng tài khoản ChatGPT · 4 model", "Providers: “Signed in with your … · n models”", tr("Signed in with your ChatGPT account · 4 models", "vi"));
ok(tr("Add a file to My Files", "vi") === "Thêm tệp vào Tệp của tôi", "nhãn ghép bằng +", tr("Add a file to My Files", "vi"));
ok(tr("Hội đồng phản biện", "en") === "Critic panel" && tr("Ngữ cảnh gửi cho model", "en") === "Context sent to the model", "chuỗi gọi qua tr(…)");
ok(tr("Nhật ký 2026-10-28", "en") === "Daily note 2026-10-28", "tên nhật ký hằng ngày của bộ não", tr("Nhật ký 2026-10-28", "en"));
ok(D.SAME_WORDS.has("Synchro") && D.SAME_WORDS.has("Claude") && !D.SAME_WORDS.has("Settings"), "tên riêng giữ nguyên, chữ thường vẫn phải dịch");

console.log("3. Câu có giá trị chèn (tf) và dịch ở máy chủ (trOn / tfOn)");
const { "i18n-core": C } = await loadTs(["i18n-core"]);
const EN = { map: { ...D.VI2EN, "{n} bước (thử)": "{n} step|{n} steps", "Gói {name} hết hạn (thử)": "Your {name} plan ran out" }, rules: D.RULES_EN };
ok(C.tfWith(EN, "{n} bước (thử)", { n: 1 }, "en") === "1 step" && C.tfWith(EN, "{n} bước (thử)", { n: 4 }, "en") === "4 steps", "tf chọn số ít / số nhiều theo n", C.tfWith(EN, "{n} bước (thử)", { n: 4 }, "en"));
ok(C.tfWith(EN, "Gói {name} hết hạn (thử)", { name: "Claude" }, "en") === "Your Claude plan ran out", "tf dịch nguyên mẫu rồi mới điền giá trị");
ok(C.tfWith(undefined, "{n} bước (thử)", { n: 3 }, "vi") === "3 bước (thử)" && C.tfWith(undefined, "Gói {name} hết hạn (thử)", { name: "$&x" }, "vi") === "Gói $&x hết hạn (thử)", "tiếng Việt / chưa có từ điển: điền vào câu gốc (giá trị có $ vẫn nguyên)");
ok(C.tfWith(EN, "Gói {name} của bạn đã hết hạn mức.", { name: "Claude" }, "en") === "Your Claude plan has hit its limit.", "mẫu chưa có khóa: điền rồi dịch bằng luật", C.tfWith(EN, "Gói {name} của bạn đã hết hạn mức.", { name: "Claude" }, "en"));
ok(C.trWith(EN, "Hội đồng phản biện", "en") === tr("Hội đồng phản biện", "en") && C.trWith(EN, "3 skill", "en") === "3 skills", "trWith dùng chung cho tr() và trOn()");
// Chữ ngắn dễ trùng dịch theo ngữ cảnh (trc): bộ dịch trang chỉ thấy khóa trần, nên khóa trần một từ không được có trong từ điển.
ok(C.trcWith(EN, "Lọc", "đồ thị", "en") === "Filters" && C.trcWith(undefined, "Lọc", "đồ thị", "vi") === "Lọc" && C.trcWith(EN, "Lọc", "ngữ cảnh chưa có", "en") === "Lọc", "trc tra khóa “chữ ‹ngữ cảnh›”, chưa có thì giữ chữ gốc");
const bare = ["Lọc", "Thuộc", "Nhóm", "Hiển thị", "Loại", "Tổng hợp", "Học", "Nối", "Bảng", "Việc dở", "Lực", "Chủ đề", "Tên riêng", "Bản đồ", "Hoạt động", "Đường dẫn", "Tiến", "Lùi", "liên kết", "chủ đề", "Trong gói", "Ghi chú của bạn"].filter((k) => Object.prototype.hasOwnProperty.call(D.VI2EN, k));
ok(!bare.length, "không còn khóa trần một hai từ của Bộ não (bộ dịch trang sẽ đổi mọi nút chữ trùng ở chỗ khác)", bare.join(", "));
const K = (s, c) => D.VI2EN[C.ctxKey(s, c)];
ok(K("Chủ đề", "loại ghi chú") === "Topic" && K("Tên riêng", "loại ghi chú") === "Entity" && K("Bản đồ", "loại ghi chú") === "Map" && K("Thẻ", "loại ghi chú") === "Tag" && K("Ghi chú của bạn", "loại ghi chú") === "Your note"
  && K("Chủ đề", "nhóm ghi chú") === "Topics" && K("Ghi chú của bạn", "nhóm ghi chú") === "Your notes" && K("Đoạn chat", "nhóm ghi chú") === "Chats" && K("Ghi chú", "trang bộ não") === "Note",
  "Bộ não: loại của một ghi chú số ít, tên nhóm số nhiều");
ok(D.VI2EN["Synchro tự viết phần còn lại của trang này từ các đoạn chat; phần bạn viết nằm ở mục “Ghi chú của bạn”."]?.includes(`“${K("Ghi chú của bạn", "loại ghi chú")}”`), "câu hướng dẫn gọi đúng tên nút “Your note”");
const { readFileSync: rf, readdirSync: rd, statSync: st } = await import("node:fs");
const { default: P } = await import("node:path");
const files = [];
const walk = (d) => { for (const f of rd(d)) { const p = P.join(d, f); if (st(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p); } };
walk(P.join(process.cwd(), "app"));
const src = new Map(files.map((f) => [f, rf(f, "utf8")]));
// Tệp nhập (không chỉ kiểu) từ tệp khác trong app/: mọi tệp mà một tệp "use client" kéo theo (kể cả gián tiếp) nằm trong gói tải về,
// nên không được tới i18n-server.ts (kéo cả từ điển vào gói tải về). Tệp máy chủ (route, trang máy chủ, chatengine…) dùng thoải mái.
const deps = (f, lazy = true) => [...src.get(f).matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s*"(\.{1,2}\/[^"]+)"|import\("(\.{1,2}\/[^"]+)"\)/g)]
  .filter((m) => (m[3] ? lazy : true) && (m[3] || !/^\{[^}]*\}$/.test(m[1].trim()) || !m[1].trim().slice(1, -1).split(",").every((x) => !x.trim() || /^type\s/.test(x.trim()))))
  .map((m) => { const b = P.resolve(P.dirname(f), m[2] ?? m[3]); return [b + ".ts", b + ".tsx", P.join(b, "index.ts")].find((x) => src.has(x)); }).filter(Boolean);
const srv = P.join(process.cwd(), "app", "i18n-server.ts");
const users = files.filter((f) => deps(f).includes(srv));
const client = new Map(files.filter((f) => /^\s*["']use client["']/.test(src.get(f))).map((f) => [f, [f]]));
for (const queue = [...client.keys()]; queue.length;) { const f = queue.shift(); for (const d of deps(f)) if (!client.has(d)) { client.set(d, [...client.get(f), d]); queue.push(d); } }
const leak = client.get(srv);
ok(users.length > 1 && !leak, `không tệp giao diện nào kéo theo i18n-server.ts (${users.length} tệp máy chủ nhập trực tiếp)`, leak?.map((f) => P.relative(process.cwd(), f)).join(" → "));
// Đường chat (chatengine.ts) không nhập tĩnh từ điển VI→EN: chỉ route cần dịch ở máy chủ (quét skill, xuất skill…) mới kéo nó vào, lúc được gọi.
const reach = (start) => { const seen = new Map([[start, [start]]]); for (const q = [start]; q.length;) { const f = q.shift(); for (const d of deps(f, false)) if (!seen.has(d)) { seen.set(d, [...seen.get(f), d]); q.push(d); } } return seen; };
const viaChat = reach(P.join(process.cwd(), "app", "chatengine.ts")).get(P.join(process.cwd(), "app", "i18n-dict.ts"));
ok(!viaChat, "chatengine.ts không nhập tĩnh từ điển VI→EN (i18n-dict.ts)", viaChat?.map((f) => P.relative(process.cwd(), f)).join(" → "));
// Mẫu tf để trong bảng (khóa động, bộ quét không thấy): mọi giá trị phải là khóa có bản dịch giữ {biến}.
const tbl = (file, name) => [...(rf(P.join(process.cwd(), file), "utf8").match(new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\};`))?.[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
for (const [file, name, v, min, what] of [["app/models.ts", "AUTO_PICK", "model", 16, "câu “Tự động chọn … cho việc …”"], ["app/healthui.tsx", "UNIT", "n", 15, "đơn vị số đếm ở Sức khỏe hệ thống"]]) {
  const keys = tbl(file, name), bad = keys.filter((k) => !new RegExp(`\\{${v}\\}`).test(D.VI2EN[k] ?? ""));
  ok(keys.length >= min && !bad.length, `${what} có bản dịch (${keys.length} mẫu)`, bad.join("; "));
}
// Ba khóa Blueprint B6 mục 3 từng thiếu: phải còn trong từ điển.
ok(["Không tải được thư viện chụp ảnh", "Gói subscription", "Hội thoại"].every((k) => D.VI2EN[k] && !/[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i.test(D.VI2EN[k])), "có bản tiếng Anh: “Không tải được thư viện chụp ảnh”, “Gói subscription”, “Hội thoại”");

console.log("4. Không còn tên mặc định của chủ dự án");
// Tên / cách xưng hô mặc định phải rỗng (lấy từ hồ sơ khi trống); tên thật chỉ được nằm trong chú thích.
const badPref = [], badName = [];
const tsc = (await import("node:module")).createRequire(P.join(process.cwd(), "package.json"))("typescript");
for (const [f, s] of src) {
  for (const m of s.matchAll(/usePref(?:<[^>]*>)?\(\s*"(name|call)"\s*,\s*(["'`])([^"'`]*)\2/g)) if (m[3].trim()) badPref.push(`${P.relative(process.cwd(), f)}: ${m[0]}`);
  if (!s.includes("Lâm Tùng")) continue;
  // Chỉ xét chữ trong mã (chuỗi, chữ JSX), bỏ qua chú thích.
  const sf = tsc.createSourceFile(f, s, tsc.ScriptTarget.Latest, true, f.endsWith(".tsx") ? tsc.ScriptKind.TSX : tsc.ScriptKind.TS);
  const look = (n) => { if ((tsc.isStringLiteralLike(n) || tsc.isJsxText(n) || tsc.isTemplateHead(n) || tsc.isTemplateMiddle(n) || tsc.isTemplateTail(n)) && n.text.includes("Lâm Tùng")) badName.push(P.relative(process.cwd(), f)); tsc.forEachChild(n, look); };
  look(sf);
}
ok(!badPref.length, "usePref(\"name\" | \"call\") mặc định là chuỗi rỗng", badPref.join("; "));
ok(!badName.length, "“Lâm Tùng” chỉ còn trong chú thích", badName.join(", "));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
