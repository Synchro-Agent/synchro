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

console.log(`\n${pass} đạt, ${fail} lỗi`);
if (fail) process.exit(1);
