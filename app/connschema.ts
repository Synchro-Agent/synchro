// Schema công cụ MCP → schema gửi cho model. Hàm thuần, không phụ thuộc cơ sở dữ liệu nên kiểm thử chạy thẳng được (tests/api/connschema.test.mjs).
// Thư viện sinh schema (Pydantic, zod-to-json-schema…) hay đặt phần lồng nhau trong $defs rồi trỏ bằng $ref: xóa $ref thì tham số còn lại {} và model phải đoán.
// Vì vậy thay $ref bằng nội dung thật, có giới hạn cho schema tự tham chiếu. Sau đó chuẩn hóa theo hãng: cấp cao nhất phải là object có properties
// (hãng từ chối anyOf / oneOf / allOf ở cấp cao nhất, một công cụ sai có thể làm hỏng cả lượt), Gemini chỉ nhận một tập khóa OpenAPI.
type Obj = Record<string, unknown>;
export type SchemaVendor = "gemini" | "other";

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const META = new Set(["$schema", "$id", "$comment", "$anchor", "$defs", "definitions", "$dynamicAnchor", "$vocabulary"]);
const MAX_REF_DEPTH = 6, MAX_NODES = 20_000;

// Trỏ JSON Pointer trong cùng tài liệu: #/$defs/Page, #/definitions/Page, #/properties/a/items…
function pointer(root: unknown, ref: string): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let cur = root;
  for (const raw of ref.slice(2).split("/")) {
    let part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    try { part = decodeURIComponent(part); } catch {}
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isObj(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

// Thay $ref bằng nội dung, bỏ khóa siêu dữ liệu và khóa riêng x-. Khóa bên trong properties là tên tham số nên giữ nguyên (tham số có thể tên "$ref", "definitions").
// Tự tham chiếu hoặc lồng quá sâu: dừng ở một object không khai báo chi tiết, mô tả phần lồng giữ nguyên.
export function resolveRefs(schema: unknown): unknown {
  let nodes = 0;
  const walk = (s: unknown, trail: string[], depth: number): unknown => {
    if (Array.isArray(s)) return s.map((v) => walk(v, trail, depth + 1));
    if (!isObj(s)) return s;
    if (++nodes > MAX_NODES || depth > 60) return {};
    let base = s;
    let chain = trail;
    // Một $ref có thể trỏ tới $ref khác: đi tới cùng, vẫn đếm để không lặp vô hạn.
    while (typeof base.$ref === "string") {
      const ref = base.$ref as string;
      const { $ref: _r, ...site } = base;
      const hit = !chain.includes(ref) && chain.length < MAX_REF_DEPTH ? pointer(schema, ref) : undefined;
      // Trỏ ra ngoài, trỏ sai hay tự tham chiếu: không có gì để thay, giữ khóa đi kèm (mô tả…) và ghi rõ là object.
      if (!isObj(hit)) { const cut = chain.includes(ref) || chain.length >= MAX_REF_DEPTH; base = cut && !("type" in site) ? { type: "object", ...site } : site; break; }
      chain = [...chain, ref];
      // Khóa đi kèm ngay tại chỗ (description, default) ưu tiên hơn khóa trong định nghĩa.
      base = { ...hit, ...site };
    }
    const out: Obj = {};
    for (const [k, v] of Object.entries(base)) {
      if (META.has(k) || k.startsWith("x-") || k === "$ref") continue;
      if ((k === "properties" || k === "patternProperties" || k === "dependentSchemas") && isObj(v)) { out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv, chain, depth + 1)])); continue; }
      // Giá trị dữ liệu, không phải schema: giữ nguyên.
      if (k === "enum" || k === "const" || k === "default" || k === "examples" || k === "example" || k === "required") { out[k] = v; continue; }
      out[k] = walk(v, chain, depth + 1);
    }
    return out;
  };
  return walk(schema, [], 0);
}

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isType = (t: unknown, name: string) => t === name || (Array.isArray(t) && t.includes(name));

// Gộp anyOf / oneOf / allOf ở cấp cao nhất thành một object: đủ mọi tham số của mọi nhánh. required: allOf cộng dồn; anyOf / oneOf chỉ giữ khóa nhánh nào cũng bắt buộc
// (khóa của riêng một nhánh mà để bắt buộc thì model không gọi được nhánh kia). Máy chủ vẫn tự kiểm tra tham số khi công cụ chạy.
function flatten(s: Obj, depth = 0): { props: Obj; required: string[]; ok: boolean } {
  const props: Obj = isObj(s.properties) ? { ...s.properties } : {};
  let required = strs(s.required);
  let ok = true;
  if (s.type !== undefined && !isType(s.type, "object")) ok = false;
  if (depth < 6) {
    for (const k of ["allOf", "anyOf", "oneOf"] as const) {
      const list = Array.isArray(s[k]) ? (s[k] as unknown[]).filter(isObj) : [];
      if (!list.length) continue;
      // Nhánh chỉ cho phép kiểu khác object (vd. anyOf [{type:"object"}, {type:"null"}]) không góp tham số; allOf mà sai kiểu thì cả schema sai.
      const subs = list.map((x) => flatten(x, depth + 1));
      const usable = subs.filter((x) => x.ok);
      if (k === "allOf" && usable.length < subs.length) ok = false;
      if (!usable.length) { if (k !== "allOf" && !isObj(s.properties)) ok = false; continue; }
      for (const u of usable) for (const [pk, pv] of Object.entries(u.props)) if (!(pk in props)) props[pk] = pv;
      if (k === "allOf") required = [...required, ...usable.flatMap((u) => u.required)];
      else {
        const shared = usable[0].required.filter((r) => usable.every((u) => u.required.includes(r)));
        required = [...required, ...shared];
      }
    }
  }
  return { props, required: [...new Set(required)], ok };
}

// Gemini: chỉ một tập khóa OpenAPI; kiểu dạng mảng ["string","null"] thành type + nullable; const thành enum; oneOf thành anyOf; allOf gộp lại; enum chỉ cho chuỗi;
// format của chuỗi chỉ nhận enum / date-time; required chỉ được nhắc tham số có thật (không thì hãng từ chối cả yêu cầu).
const GEMINI_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "format", "nullable", "anyOf", "minimum", "maximum", "minItems", "maxItems", "title", "minLength", "maxLength", "pattern", "default"]);
function forGemini(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.map((x) => forGemini(x, depth + 1));
  if (!isObj(v) || depth > 60) return v;
  let s: Obj = { ...v };
  if (Array.isArray(s.allOf)) {
    const f = flatten(s);
    const { allOf: _a, ...rest } = s;
    s = Object.keys(f.props).length ? { ...rest, type: "object", properties: f.props, ...(f.required.length ? { required: f.required } : {}) } : { ...(s.allOf as Obj[]).filter(isObj).reduce((a, b) => ({ ...a, ...b }), {}), ...rest };
  }
  if (Array.isArray(s.oneOf) && !Array.isArray(s.anyOf)) s.anyOf = s.oneOf;
  if (s.const !== undefined && s.enum === undefined) s.enum = [s.const];
  if (Array.isArray(s.type)) {
    const real = (s.type as unknown[]).filter((t) => t !== "null");
    if (real.length < s.type.length) s.nullable = true;
    s.type = real[0] ?? "string";
  }
  if (Array.isArray(s.anyOf)) {
    // anyOf [X, {type:"null"}]: dạng thường gặp của tham số tùy chọn, gọn lại thành X + nullable.
    const real = (s.anyOf as unknown[]).filter((x) => !(isObj(x) && x.type === "null"));
    if (real.length < s.anyOf.length) s.nullable = true;
    if (real.length === 1 && isObj(real[0])) { const { anyOf: _o, ...rest } = s; s = { ...real[0], ...rest }; }
    else s.anyOf = real;
  }
  if (Array.isArray(s.enum)) {
    const names = s.enum.filter((x): x is string => typeof x === "string");
    if (names.length === s.enum.length && names.length) { s.enum = names; s.type ??= "string"; } else delete s.enum;
  }
  if (s.type === "string" && typeof s.format === "string" && s.format !== "date-time" && s.format !== "enum") delete s.format;
  const out: Obj = {};
  for (const [k, x] of Object.entries(s)) {
    if (!GEMINI_KEYS.has(k)) continue;
    if (k === "properties" && isObj(x)) { out[k] = Object.fromEntries(Object.entries(x).map(([pk, pv]) => [pk, forGemini(pv, depth + 1)])); continue; }
    if (k === "enum" || k === "required" || k === "default") { out[k] = x; continue; }
    out[k] = forGemini(x, depth + 1);
  }
  if (Array.isArray(out.required)) {
    const have = isObj(out.properties) ? out.properties : {};
    const req = strs(out.required).filter((r) => r in have);
    if (req.length) out.required = req; else delete out.required;
  }
  return out;
}

/** Schema công cụ MCP → schema gửi cho model, luôn là object ở cấp cao nhất. null: không chuẩn hóa được (công cụ không nhận đối tượng tham số), bỏ qua công cụ đó. */
export function normalizeSchema(schema: unknown, vendor: SchemaVendor = "other"): Obj | null {
  if (schema !== undefined && schema !== null && !isObj(schema)) return null;
  const raw = resolveRefs(schema ?? {}) as Obj;
  const f = flatten(raw);
  if (!f.ok) return null;
  const known = new Set(Object.keys(f.props));
  const required = f.required.filter((r) => known.has(r));
  // Cấp cao nhất chỉ giữ các khóa mọi hãng đều nhận; tổ hợp, enum, if / then / else, not đã gộp hoặc bỏ.
  const top: Obj = { type: "object", properties: f.props, ...(required.length ? { required } : {}) };
  if (typeof raw.description === "string") top.description = raw.description;
  if (raw.additionalProperties !== undefined && vendor !== "gemini") top.additionalProperties = raw.additionalProperties;
  if (vendor !== "gemini") return top;
  const g = forGemini(top) as Obj;
  return { ...g, type: "object", properties: isObj(g.properties) ? g.properties : {} };
}
