// Schema công cụ connector gửi cho model: $ref / $defs được thay bằng nội dung thật (trước đây bị xóa nên tham số lồng còn {}), tổ hợp ở cấp cao nhất được gộp,
// Gemini nhận đúng tập khóa của nó. Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const J = (x) => JSON.stringify(x);
const { connschema: S } = await loadTs(["connschema"]);

console.log("1. $ref và $defs");
let r = S.normalizeSchema({ $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { page: { $ref: "#/$defs/Page", description: "Trang cần tạo" } }, required: ["page"], $defs: { Page: { type: "object", properties: { title: { type: "string" }, parent: { $ref: "#/definitions/Parent" } }, required: ["title"], description: "gốc" } }, definitions: { Parent: { type: "object", properties: { id: { type: "string" } } } } });
ok(r.properties.page.properties?.title?.type === "string", "$ref được thay bằng nội dung", J(r));
ok(r.properties.page.properties.parent.properties.id.type === "string", "$ref lồng trong $ref, cả #/definitions", J(r));
ok(r.properties.page.description === "Trang cần tạo", "mô tả ngay tại chỗ ưu tiên hơn mô tả của định nghĩa", J(r));
ok(!J(r).includes("$defs") && !J(r).includes("$schema") && !J(r).includes("$ref"), "không còn $defs, $schema, $ref", J(r));
r = S.normalizeSchema({ type: "object", properties: { node: { $ref: "#/$defs/Node" } }, $defs: { Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" }, name: { type: "string" } } } } });
ok(r.properties.node.properties.name.type === "string" && J(r).length < 2000 && !J(r).includes("$ref"), "tự tham chiếu: dừng được, không lặp vô hạn", J(r));
r = S.normalizeSchema({ $ref: "#/$defs/A", $defs: { A: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } } });
ok(r.properties.x.type === "number" && r.required[0] === "x", "$ref ở cấp cao nhất", J(r));
r = S.normalizeSchema({ type: "object", properties: { a: { $ref: "https://example.com/schema.json", description: "ngoài" }, b: { $ref: "#/$defs/Missing" } } });
ok(r.properties.a.description === "ngoài" && !J(r).includes("$ref"), "$ref trỏ ra ngoài hay trỏ sai: bỏ $ref, giữ mô tả", J(r));
r = S.normalizeSchema({ type: "object", properties: { $ref: { type: "string" }, definitions: { type: "string" }, "x-id": { type: "string" } } });
ok(r.properties.$ref?.type === "string" && r.properties.definitions?.type === "string" && r.properties["x-id"]?.type === "string", "tham số tên $ref, definitions, x-… vẫn giữ", J(r));
r = S.normalizeSchema({ type: "object", properties: { a: { "x-mcp-header": "A", type: "string", enum: ["$ref", "x"], default: { $ref: "giữ" } } } });
ok(r.properties.a["x-mcp-header"] === undefined && r.properties.a.enum[0] === "$ref" && r.properties.a.default.$ref === "giữ", "khóa riêng x- bị bỏ; giá trị dữ liệu giữ nguyên", J(r));

console.log("2. Tổ hợp ở cấp cao nhất");
r = S.normalizeSchema({ anyOf: [{ type: "object", properties: { id: { type: "string" }, q: { type: "string" } }, required: ["id", "q"] }, { type: "object", properties: { slug: { type: "string" }, q: { type: "string" } }, required: ["slug", "q"] }] });
ok(r.type === "object" && !r.anyOf && r.properties.id && r.properties.slug, "anyOf: gộp đủ tham số, không còn anyOf", J(r));
ok(J(r.required) === '["q"]', "anyOf: chỉ giữ khóa nhánh nào cũng bắt buộc", J(r));
r = S.normalizeSchema({ oneOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, { type: "object", properties: { b: { type: "string" } }, required: ["b"] }] });
ok(r.properties.a && r.properties.b && !r.required && !r.oneOf, "oneOf: không còn khóa bắt buộc riêng của một nhánh", J(r));
r = S.normalizeSchema({ allOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, { $ref: "#/$defs/B" }], $defs: { B: { type: "object", properties: { b: { type: "number" } }, required: ["b"] } } });
ok(r.properties.a && r.properties.b?.type === "number" && J(r.required) === '["a","b"]' && !r.allOf, "allOf: cộng dồn tham số và required, kể cả qua $ref", J(r));
ok(S.normalizeSchema({ type: "string" }) === null, "schema không phải object: bỏ công cụ");
ok(S.normalizeSchema("x") === null, "schema không phải đối tượng JSON: bỏ công cụ");
ok(J(S.normalizeSchema({})) === '{"type":"object","properties":{}}', "công cụ không tham số vẫn hợp lệ");
ok(J(S.normalizeSchema(undefined)) === '{"type":"object","properties":{}}', "thiếu schema vẫn hợp lệ");
r = S.normalizeSchema({ type: "object", properties: { a: { type: "string" } }, required: ["a", "ghost"], enum: [1], not: {}, if: {} });
ok(J(r.required) === '["a"]' && r.enum === undefined && r.not === undefined && r.if === undefined, "cấp cao nhất bỏ enum, not, if; required chỉ nhắc tham số có thật", J(r));

console.log("3. Gemini");
r = S.normalizeSchema({ type: "object", additionalProperties: false, properties: {
  a: { type: ["string", "null"], format: "uuid", $comment: "x" },
  b: { anyOf: [{ type: "string" }, { type: "null" }], description: "tùy chọn" },
  c: { oneOf: [{ type: "string" }, { type: "number" }] },
  d: { const: "x" },
  e: { type: "number", enum: [1, 2] },
  f: { type: "object", additionalProperties: true, properties: { g: { $ref: "#/$defs/G" } }, required: ["g", "ghost"] },
  h: { allOf: [{ type: "object", properties: { i: { type: "string" } } }] },
}, $defs: { G: { type: "string", examples: ["x"] } } }, "gemini");
ok(r.additionalProperties === undefined && r.properties.f.additionalProperties === undefined, "bỏ additionalProperties", J(r));
ok(r.properties.a.type === "string" && r.properties.a.nullable === true && r.properties.a.format === undefined, "kiểu mảng thành type + nullable; format lạ của chuỗi bị bỏ", J(r.properties.a));
ok(r.properties.b.type === "string" && r.properties.b.nullable === true && !r.properties.b.anyOf && r.properties.b.description === "tùy chọn", "anyOf [X, null] gọn lại", J(r.properties.b));
ok(r.properties.c.anyOf?.length === 2 && !r.properties.c.oneOf, "oneOf thành anyOf", J(r.properties.c));
ok(J(r.properties.d.enum) === '["x"]' && r.properties.d.const === undefined, "const thành enum", J(r.properties.d));
ok(r.properties.e.enum === undefined && r.properties.e.type === "number", "enum số bị bỏ (Gemini chỉ nhận chuỗi)", J(r.properties.e));
ok(r.properties.f.properties.g.type === "string" && J(r.properties.f.required) === '["g"]' && r.properties.f.properties.g.examples === undefined, "$ref được thay rồi lọc khóa; required chỉ nhắc tham số có thật", J(r.properties.f));
ok(r.properties.h.properties?.i?.type === "string" && !r.properties.h.allOf, "allOf lồng được gộp", J(r.properties.h));
r = S.normalizeSchema({ oneOf: [{ type: "object", properties: { a: { type: "string" } } }] }, "gemini");
ok(r.type === "object" && r.properties.a.type === "string" && !r.oneOf, "cấp cao nhất của Gemini cũng là object", J(r));

console.log("4. Mảng thiếu items, tham số tự do trên Gemini");
r = S.normalizeSchema({ type: "object", properties: { ids: { type: "array", description: "Danh sách" }, tags: { type: ["array", "null"] } } });
ok(J(r.properties.ids.items) === "{}" && J(r.properties.tags.items) === "{}", "mảng thiếu items được khai báo items rỗng", J(r));
r = S.normalizeSchema({ type: "object", properties: { meta: { type: "object", description: "Dữ liệu thêm", default: {}, additionalProperties: true }, any: {}, ids: { type: "array" }, pair: { type: "array", items: [{ type: "number" }, { type: "string" }] }, keep: { type: "object", properties: { a: { type: "string" } } }, opt: { anyOf: [{ type: "object" }, { type: "null" }] } } }, "gemini");
ok(r.properties.meta.type === "string" && /JSON string/.test(r.properties.meta.description) && /Dữ liệu thêm/.test(r.properties.meta.description) && r.properties.meta.default === undefined, "object không khai báo thuộc tính: thành chuỗi JSON, giữ mô tả", J(r));
ok(r.properties.any.type === "string" && r.properties.ids.items.type === "string", "tham số và phần tử không có kiểu: thành chuỗi", J(r));
ok(r.properties.pair.items.type === "number" && !Array.isArray(r.properties.pair.items), "mảng theo vị trí: một schema cho mọi phần tử", J(r));
ok(r.properties.keep.type === "object" && r.properties.keep.properties.a.type === "string", "object có thuộc tính giữ nguyên", J(r));
ok(r.properties.opt.type === "string" && r.properties.opt.nullable === true && !r.properties.opt.anyOf, "anyOf object tự do + null: chuỗi, nullable", J(r));
ok(S.normalizeSchema({ type: "object", properties: {} }, "gemini").type === "object", "cấp cao nhất không bị đổi thành chuỗi");

console.log("5. Đổi chuỗi JSON lại thành đối tượng trước khi gọi máy chủ");
const sc = { type: "object", properties: { meta: { type: "object" }, ids: { type: "array", items: { type: "object", properties: { x: { type: "object" } } } }, name: { type: "string" }, either: { anyOf: [{ type: "string" }, { type: "object" }] }, ref: { $ref: "#/$defs/R" }, n: { type: "object", properties: { inner: { type: "array" } } } }, $defs: { R: { type: "object", properties: { a: { type: "string" } } } } };
let a = S.coerceArgs(sc, { meta: '{"a":1}', ids: '[{"x":"{\\"b\\":2}"}]', name: '{"giữ":"nguyên"}', either: '{"giữ":1}', ref: '{"a":"b"}', n: { inner: "[1,2]" }, khac: '{"la":1}' });
ok(a.meta.a === 1, "object: chuỗi JSON thành đối tượng", J(a));
ok(a.ids[0].x.b === 2, "lồng trong mảng cũng đổi", J(a));
ok(a.name === '{"giữ":"nguyên"}' && a.either === '{"giữ":1}', "tham số nhận chuỗi: giữ nguyên", J(a));
ok(a.ref.a === "b" && a.n.inner[1] === 2, "qua $ref và object lồng", J(a));
ok(a.khac === '{"la":1}', "tham số không khai báo: giữ nguyên", J(a));
a = S.coerceArgs(sc, { meta: "không phải JSON", ids: '{"sai":"loại"}' });
ok(a.meta === "không phải JSON" && a.ids === '{"sai":"loại"}', "chuỗi hỏng hay sai loại: giữ nguyên để máy chủ báo", J(a));
ok(J(S.coerceArgs(undefined, { a: 1 })) === '{"a":1}', "công cụ không có schema: giữ nguyên");

console.log("9. pattern của máy chủ MCP không khóa được máy chủ Synchro (ReDoS)");
{
  const evil = { type: "object", properties: { q: { type: "string", pattern: "^(a+)+$" } } };
  const t0 = Date.now();
  const e1 = S.validateArgs(evil, { q: "a".repeat(40) + "!" });
  ok(!e1.length && Date.now() - t0 < 200, "máy chủ: không chạy pattern (mẫu lồng lượng từ với 41 ký tự xong ngay)", { e1, ms: Date.now() - t0 });
  const t1 = Date.now();
  const e2 = S.validateArgs(evil, { q: "a".repeat(5000) + "!" }, "vi", { pattern: true });
  ok(!e2.length && Date.now() - t1 < 200, "trình duyệt: chuỗi dài quá 200 ký tự thì bỏ qua pattern", { ms: Date.now() - t1 });
  const t2 = Date.now();
  const e3 = ["^(a+)+$", "^(\\w*)*x$", "^([a-z]+\\d?)+$", "^(a|a)\\1$"].map((pt) => S.validateArgs({ type: "object", properties: { q: { type: "string", pattern: pt } } }, { q: "a".repeat(40) + "!" }, "vi", { pattern: true }));
  ok(e3.every((e) => !e.length) && Date.now() - t2 < 200, "trình duyệt: mẫu có nhóm lặp chứa lượng từ hay tham chiếu ngược thì bỏ qua", { ms: Date.now() - t2 });
  const fmt = { type: "object", properties: { d: { type: "string", pattern: "^\\d{4}-\\d{2}$" } } };
  ok(S.validateArgs(fmt, { d: "x" }, "en", { pattern: true }).some((m) => /wrong format/.test(m)) && S.validateArgs(fmt, { d: "2026-11" }, "en", { pattern: true }).length === 0, "trình duyệt: chuỗi ngắn vẫn báo sai định dạng");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
if (fail) process.exit(1);
