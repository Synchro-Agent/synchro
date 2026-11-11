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
    // Mảng không khai báo items: hãng có thể từ chối cả yêu cầu vì một tham số; khai báo rỗng có nghĩa y hệt theo chuẩn.
    if (isType(out.type, "array") && out.items === undefined && out.prefixItems === undefined) out.items = {};
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
// Tham số object không khai báo thuộc tính và tham số không có kiểu: Gemini không nhận, nên gửi dạng chuỗi; coerceArgs đổi chuỗi JSON lại thành đối tượng trước khi gọi máy chủ.
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
  if (Array.isArray(s.anyOf)) {
    // anyOf [X, {type:"null"}]: dạng thường gặp của tham số tùy chọn, gọn lại thành X + nullable.
    const real = (s.anyOf as unknown[]).filter((x) => !(isObj(x) && x.type === "null"));
    if (real.length < s.anyOf.length) s.nullable = true;
    if (real.length === 1 && isObj(real[0])) { const { anyOf: _o, ...rest } = s; s = { ...real[0], ...rest }; }
    else s.anyOf = real;
  }
  if (Array.isArray(s.type)) {
    const real = (s.type as unknown[]).filter((t) => t !== "null");
    if (real.length < s.type.length) s.nullable = true;
    s.type = real[0] ?? "string";
  }
  if (Array.isArray(s.enum)) {
    const names = s.enum.filter((x): x is string => typeof x === "string");
    if (names.length === s.enum.length && names.length) { s.enum = names; s.type ??= "string"; } else delete s.enum;
  }
  // Mảng theo vị trí (tuple): Gemini chỉ nhận một schema cho mọi phần tử.
  if (s.type === "array") {
    const first = Array.isArray(s.items) ? s.items[0] : s.items === undefined && Array.isArray(s.prefixItems) ? s.prefixItems[0] : s.items;
    s.items = first ?? {};
  }
  if (depth > 0 && !Array.isArray(s.anyOf) && (s.type === undefined || s.type === "object")) {
    const has = isObj(s.properties) && Object.keys(s.properties).length > 0;
    if (has) s.type = "object";
    else {
      const { properties: _p, default: _d, ...rest } = s;
      s = { ...rest, type: "string", ...(s.type === "object" ? { description: `${typeof s.description === "string" ? `${s.description} ` : ""}(object, written as a JSON string)` } : {}) };
    }
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

// Model hay gửi đối tượng / mảng dưới dạng chuỗi JSON (với Gemini thì chính Synchro yêu cầu vậy, xem forGemini): gửi nguyên cho máy chủ thì công cụ báo sai kiểu.
// Chỉ đổi khi schema khai báo rõ là object hay array, không nhận chuỗi, và chuỗi đọc ra đúng loại đó; còn lại giữ nguyên, máy chủ tự kiểm tra.
function coerce(v: unknown, s: unknown, depth: number): unknown {
  if (!isObj(s) || depth > 30) return v;
  const forms = [s, ...["anyOf", "oneOf", "allOf"].flatMap((k) => (Array.isArray(s[k]) ? (s[k] as unknown[]).filter(isObj) : []))];
  if (typeof v === "string") {
    if (forms.some((f) => isType(f.type, "string"))) return v;
    const obj = forms.some((f) => isType(f.type, "object") || isObj(f.properties)), arr = forms.some((f) => isType(f.type, "array"));
    if (!obj && !arr) return v;
    let j: unknown;
    try { j = JSON.parse(v); } catch { return v; }
    if (Array.isArray(j) ? !arr : !isObj(j) || !obj) return v;
    v = j;
  }
  if (Array.isArray(v)) { const items = forms.map((f) => f.items).find(isObj); return items ? v.map((x) => coerce(x, items, depth + 1)) : v; }
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => {
    const prop = forms.map((f) => (isObj(f.properties) ? f.properties[k] : undefined)).find(isObj);
    return [k, prop ? coerce(x, prop, depth + 1) : x];
  }));
}
/** Tham số model đưa → tham số gửi cho máy chủ MCP, theo schema gốc của công cụ. */
export const coerceArgs = (schema: unknown, args: Record<string, unknown>) => coerce(args, resolveRefs(schema ?? {}), 0) as Record<string, unknown>;

// ---- kiểm tra tham số theo schema (người dùng sửa tham số trên thẻ duyệt: trình duyệt kiểm tra khi gõ, máy chủ kiểm tra lại trước khi chạy) ----
// Tập con JSON Schema thường gặp ở công cụ MCP: type, required, properties, additionalProperties, items, enum, const, minLength / maxLength,
// minimum / maximum, minItems / maxItems, pattern, anyOf / oneOf (một nhánh đúng là được), allOf (mọi nhánh), $ref (đã thay bằng nội dung).
// Không chắc thì cho qua: máy chủ MCP vẫn tự kiểm tra lần cuối. Trả về danh sách lỗi (rỗng: hợp lệ), mỗi lỗi kèm đường dẫn tham số.
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
const fits = (t: string, v: unknown) => { const k = typeOf(v); return t === k || (t === "number" && k === "integer"); };
const TYPE_VI: Record<string, string> = { object: "đối tượng", array: "danh sách", string: "chuỗi", number: "số", integer: "số nguyên", boolean: "true / false", null: "null" };
const TYPE_EN: Record<string, string> = { object: "an object", array: "a list", string: "a string", number: "a number", integer: "a whole number", boolean: "true / false", null: "null" };
// Câu lỗi theo ngôn ngữ giao diện (trình duyệt hiện cho người dùng; máy chủ dùng tiếng Việt như các lỗi khác).
const MSG = {
  vi: { any: "không khớp kiểu nào được phép", type: (t: string[]) => `phải là ${t.map((x) => TYPE_VI[x] ?? x).join(" hoặc ")}`, enum: (l: string) => `chỉ nhận ${l}`, cnst: (v: string) => `phải là ${v}`,
    minLen: (n: number) => `cần ít nhất ${n} ký tự`, maxLen: (n: number) => `tối đa ${n} ký tự`, pattern: "không đúng định dạng", min: (n: number) => `nhỏ nhất là ${n}`, max: (n: number) => `lớn nhất là ${n}`,
    minItems: (n: number) => `cần ít nhất ${n} mục`, maxItems: (n: number) => `tối đa ${n} mục`, required: "thiếu (bắt buộc)", extra: "công cụ không nhận tham số này", top: "Tham số phải là một đối tượng JSON ({ … }).", root: "tham số" },
  en: { any: "doesn't match any allowed type", type: (t: string[]) => `must be ${t.map((x) => TYPE_EN[x] ?? x).join(" or ")}`, enum: (l: string) => `must be one of ${l}`, cnst: (v: string) => `must be ${v}`,
    minLen: (n: number) => `needs at least ${n} characters`, maxLen: (n: number) => `at most ${n} characters`, pattern: "has the wrong format", min: (n: number) => `must be at least ${n}`, max: (n: number) => `must be at most ${n}`,
    minItems: (n: number) => `needs at least ${n} items`, maxItems: (n: number) => `at most ${n} items`, required: "missing (required)", extra: "this tool doesn't take this input", top: "Inputs must be a JSON object ({ … }).", root: "inputs" },
};
type Msg = typeof MSG.vi;
type Opts = { pattern?: boolean };
// "pattern" là biểu thức chính quy do máy chủ MCP (người nối connector tự khai) đặt: mẫu như ^(a+)+$ gặp chuỗi dài chạy hàng giờ và khóa cả tiến trình.
// Máy chủ Synchro không bao giờ chạy nó (máy chủ MCP tự kiểm tham số của mình); khung sửa tham số trong trình duyệt chạy với chuỗi ngắn để báo sớm.
const PATTERN_MAX_LEN = 200;
// Mẫu có nhóm lặp chứa lượng từ ((a+)+, (\w*)*…) hay tham chiếu ngược: dạng gây chạy hàm mũ thường gặp, trình duyệt cũng không chạy.
const risky = (p: string) => /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p) || /\\[1-9]|\\k</.test(p);
function check(v: unknown, s: unknown, path: string, out: string[], depth: number, M: Msg, o: Opts) {
  if (!isObj(s) || depth > 30 || out.length >= 20) return;
  const at = path || M.root;
  for (const k of ["anyOf", "oneOf"] as const) if (Array.isArray(s[k]) && (s[k] as unknown[]).length) {
    const ok = (s[k] as unknown[]).some((b) => { const e: string[] = []; check(v, b, path, e, depth + 1, M, o); return !e.length; });
    if (!ok) { out.push(`${at}: ${M.any}`); return; }
  }
  if (Array.isArray(s.allOf)) for (const b of s.allOf) check(v, b, path, out, depth + 1, M, o);
  const types = Array.isArray(s.type) ? (s.type as unknown[]).filter((x): x is string => typeof x === "string") : typeof s.type === "string" ? [s.type] : [];
  if (types.length && !types.some((t) => fits(t, v))) { out.push(`${at}: ${M.type(types)}`); return; }
  if (Array.isArray(s.enum) && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) out.push(`${at}: ${M.enum(s.enum.slice(0, 8).map((x) => JSON.stringify(x)).join(", "))}`);
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) out.push(`${at}: ${M.cnst(JSON.stringify(s.const))}`);
  if (typeof v === "string") {
    if (typeof s.minLength === "number" && v.length < s.minLength) out.push(`${at}: ${M.minLen(s.minLength)}`);
    if (typeof s.maxLength === "number" && v.length > s.maxLength) out.push(`${at}: ${M.maxLen(s.maxLength)}`);
    if (o.pattern && typeof s.pattern === "string" && v.length <= PATTERN_MAX_LEN && !risky(s.pattern)) { try { if (!new RegExp(s.pattern, "u").test(v)) out.push(`${at}: ${M.pattern}`); } catch {} }
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) out.push(`${at}: ${M.min(s.minimum)}`);
    if (typeof s.maximum === "number" && v > s.maximum) out.push(`${at}: ${M.max(s.maximum)}`);
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems) out.push(`${at}: ${M.minItems(s.minItems)}`);
    if (typeof s.maxItems === "number" && v.length > s.maxItems) out.push(`${at}: ${M.maxItems(s.maxItems)}`);
    if (isObj(s.items)) v.forEach((x, i) => check(x, s.items, `${path}[${i}]`, out, depth + 1, M, o));
  }
  if (isObj(v)) {
    const props = isObj(s.properties) ? s.properties : {};
    if (Array.isArray(s.required)) for (const r of s.required) if (typeof r === "string" && !(r in v)) out.push(`${path ? `${path}.` : ""}${r}: ${M.required}`);
    for (const [k, x] of Object.entries(v)) {
      const p = `${path ? `${path}.` : ""}${k}`;
      if (k in props) check(x, props[k], p, out, depth + 1, M, o);
      else if (s.additionalProperties === false) out.push(`${p}: ${M.extra}`);
      else if (isObj(s.additionalProperties)) check(x, s.additionalProperties, p, out, depth + 1, M, o);
    }
  }
}
/**
 * Lỗi của tham số theo schema công cụ; [] là hợp lệ. Tham số cấp cao nhất luôn phải là đối tượng. lang: ngôn ngữ câu lỗi.
 * opts.pattern: kiểm cả "pattern" (chỉ khung sửa trong trình duyệt bật, với chuỗi tới PATTERN_MAX_LEN ký tự; máy chủ không bao giờ bật).
 */
export function validateArgs(schema: unknown, args: unknown, lang: "vi" | "en" = "vi", opts: Opts = {}): string[] {
  const M = MSG[lang];
  if (!isObj(args)) return [M.top];
  const out: string[] = [];
  check(args, resolveRefs(schema ?? {}), "", out, 0, M, opts);
  return out;
}
