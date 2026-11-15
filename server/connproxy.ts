// Hàm thuần của lối gọi connector qua proxy (connector_tools / connector_call): xếp hạng công cụ theo từ khóa, rút gọn schema mà vẫn hợp lệ,
// đọc tham số của connector_call, danh mục tên. Không phụ thuộc cơ sở dữ liệu nên kiểm thử chạy thẳng được (tests/api/connrank.test.mjs).

import "server-only";
export type ToolLike = { fq: string; cname: string; tool: { name: string; title?: string; description?: string; annotations?: { title?: string } } };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
// Tách tên công cụ thành từ: list_deployments, listDeployments, list-deployments đều thành list + deployment.
const nameWords = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => stem(fold(w)));
const textWords = (s: string) => new Set(fold(s).split(/[^a-z0-9]+/).filter(Boolean).map(stem));

// Từ không mang nghĩa khi tìm công cụ (tiếng Anh và tiếng Việt đã bỏ dấu): "an" từng khớp giữa các tên như "plan", "scan".
const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "for", "from", "by", "with", "and", "or", "is", "are", "my", "me", "our", "your", "this", "that", "it", "i", "we", "you", "please",
  "can", "do", "does", "how", "what", "which", "new", "all", "some", "cho", "toi", "minh", "cua", "va", "voi", "trong", "tren", "mot", "cac", "nhung", "giup", "hay", "la", "co", "khong", "nay", "do", "de", "ve", "o", "ban"]);
// Từ đồng nghĩa khi tìm (cả tiếng Việt đã bỏ dấu) → từ thường thấy trong tên công cụ.
const SYN: Record<string, string[]> = {
  create: ["add", "new", "insert", "post"], add: ["create", "insert"], make: ["create"], write: ["create", "update"], tao: ["create", "add"], them: ["add", "create"], viet: ["write", "create"],
  update: ["edit", "modify", "patch", "set"], edit: ["update", "modify"], change: ["update", "edit"], sua: ["update", "edit"], doi: ["update", "change"], capnhat: ["update"],
  delete: ["remove", "archive", "destroy"], remove: ["delete"], xoa: ["delete", "remove"],
  search: ["find", "query", "lookup"], find: ["search", "query", "lookup"], lookup: ["search", "find", "get"], tim: ["search", "find"], kiem: ["search"], tra: ["search", "lookup"],
  list: ["search", "all"], show: ["get", "list"], view: ["get", "read"], danh: ["list"], sach: ["list"], liet: ["list"], ke: ["list"], xem: ["get", "list", "read"],
  get: ["fetch", "read", "retrieve"], read: ["get", "fetch"], fetch: ["get"], lay: ["get", "fetch"], doc: ["read", "get"],
  send: ["post", "create", "message"], gui: ["send", "post"], message: ["chat", "comment"], tin: ["message"], nhan: ["message"],
  page: ["doc", "document"], document: ["doc", "page", "file"], trang: ["page"], tai: ["file", "document"], lieu: ["document"], file: ["document", "attachment"], tep: ["file"],
  task: ["issue", "todo", "item", "ticket"], issue: ["task", "ticket", "bug"], ticket: ["issue", "task"], bug: ["issue"], viec: ["task", "issue"], loi: ["issue", "error"],
  deploy: ["deployment", "release"], deployment: ["deploy"], trien: ["deploy"], khai: ["deploy"], project: ["repo", "workspace"], user: ["member", "people", "customer"],
  customer: ["user", "contact"], khach: ["customer"], hang: ["customer"], payment: ["charge", "transaction"], thanh: ["payment"], toan: ["payment"], invoice: ["bill"], hoa: ["invoice"], don: ["order", "invoice"], order: ["purchase"],
};

/** query không có từ nào (vd. "*"): liệt kê theo trang, more là số công cụ còn lại sau trang này. */
export function rankTools<T extends ToolLike>(tools: T[], query: string, connector = "", top = 8, offset = 0): { hits: T[]; note: string; more: number } {
  const cf = fold(connector).trim();
  let pool = tools;
  let note = "";
  if (cf) {
    // Tên gần đúng: "Audit MCP" khớp "Audit", "notion" khớp "Notion của tôi".
    const inC = tools.filter((t) => { const n = fold(t.cname); return n.includes(cf) || cf.includes(n) || t.fq.startsWith(cf.replace(/[^a-z0-9]+/g, "_")); });
    if (inC.length) pool = inC;
    else note = `Không có connector "${connector}", đã tìm trong tất cả connector.\n`;
  }
  const words = [...new Set(fold(query).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem))];
  if (!words.length) return { hits: pool.slice(offset, offset + top), note, more: Math.max(0, pool.length - offset - top) };
  const scored = pool.map((t, i) => {
    const nw = new Set(nameWords(t.tool.name));
    const tw = textWords(`${t.tool.title ?? t.tool.annotations?.title ?? ""} ${t.tool.description ?? ""}`);
    let score = 0, full = true;
    for (const w of words) {
      const syn = (SYN[w] ?? []).map(stem);
      if (nw.has(w)) score += 6;
      else if (syn.some((x) => nw.has(x))) score += 4;
      else if (tw.has(w)) score += 2;
      else if (syn.some((x) => tw.has(x))) score += 1;
      else if (w.length >= 4 && [...nw].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) score += 2;
      else full = false;
      if (!nw.has(w) && !syn.some((x) => nw.has(x))) full = false;
    }
    // Mọi từ đều nằm trong tên: gần như chắc chắn đúng công cụ. Hòa điểm thì tên ngắn hơn (ít việc thừa hơn).
    if (full && words.length > 1) score += 8;
    return { t, i, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.t.tool.name.length - b.t.tool.name.length || a.i - b.i);
  // Cùng cách phân trang với query="*": không có offset thì model tưởng công cụ thứ 9 trở đi không tồn tại.
  return { hits: scored.slice(offset, offset + top).map((x) => x.t), note, more: Math.max(0, scored.length - offset - top) };
}

// ---- schema gọn: giữ đúng JSON, required đứng đầu, đủ tên và kiểu mọi tham số ----
type Obj = Record<string, unknown>;
const ENUM_MAX = 20, DESC_MAX = 200, DEPTH_MAX = 5, ANY_MAX = 6;
// Khóa giữ nguyên ở mọi mức: quyết định giá trị có hợp lệ không, ngắn nên không đáng bỏ.
const KEEP = ["type", "format", "const", "default", "minimum", "maximum", "pattern", "minLength", "maxLength", "minItems", "maxItems"];
// Khóa không ảnh hưởng tới lời gọi: bỏ đi không tính là mất chi tiết.
const HARMLESS = new Set(["title", "$comment", "$schema", "examples", "example", "deprecated", "readOnly", "writeOnly"]);
// lost: có chi tiết không còn trong bản gọn. Báo thật để model biết phải xem đủ định nghĩa, không đoán rồi bị hãng từ chối hay ghi sai dạng.
type Slim = { lost: boolean };
function slimProp(v: unknown, depth: number, desc: boolean, n: Slim): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const p = v as Obj, out: Obj = {};
  for (const k of KEEP) if (p[k] !== undefined && typeof p[k] !== "object") out[k] = p[k];
  if (Array.isArray(p.type)) out.type = p.type;
  if (desc && depth === 0 && typeof p.description === "string") { out.description = p.description.slice(0, DESC_MAX); if (p.description.length > DESC_MAX) n.lost = true; }
  if (Array.isArray(p.enum)) { out.enum = p.enum.slice(0, ENUM_MAX); if (p.enum.length > ENUM_MAX) { out.enum_total = p.enum.length; n.lost = true; } }
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(p[k])) { out[k] = (p[k] as unknown[]).slice(0, ANY_MAX).map((x) => slimProp(x, depth + 1, false, n)); if ((p[k] as unknown[]).length > ANY_MAX) n.lost = true; }
  if (p.items) out.items = slimProp(p.items, depth + 1, false, n);
  if (p.additionalProperties !== undefined) out.additionalProperties = slimProp(p.additionalProperties, depth + 1, false, n);
  if (p.properties && typeof p.properties === "object") {
    if (depth >= DEPTH_MAX) { out.properties = Object.fromEntries(Object.keys(p.properties).slice(0, 60).map((k) => [k, {}])); n.lost = true; }
    else out.properties = orderProps(p, depth + 1, false, n);
    if (Array.isArray(p.required)) out.required = p.required;
  }
  for (const k of Object.keys(p)) if (!(k in out) && !HARMLESS.has(k)) n.lost = true;
  return out;
}
function orderProps(s: Obj, depth: number, desc: boolean, n: Slim) {
  const props = (s.properties ?? {}) as Obj, req = Array.isArray(s.required) ? (s.required as string[]) : [];
  const keys = [...req.filter((k) => k in props), ...Object.keys(props).filter((k) => !req.includes(k))];
  return Object.fromEntries(keys.map((k) => [k, slimProp(props[k], depth, desc, n)]));
}
/** Schema gọn dưới max ký tự: không bao giờ cắt ngang JSON. trimmed: đã bỏ bớt chi tiết (mô tả, cấu trúc sâu, ràng buộc lạ). */
export function compactSchema(schema: unknown, max = 4000): { schema: Obj; trimmed: boolean } {
  const s = (schema && typeof schema === "object" ? schema : {}) as Obj;
  const req = Array.isArray(s.required) ? (s.required as string[]) : [];
  // additionalProperties ở cấp trên cùng (false, hay kiểu của khóa tự do) và $defs mà tham số trỏ tới.
  const top: Slim = { lost: Object.keys(s).some((k) => !["type", "required", "properties", "additionalProperties", "description"].includes(k) && !HARMLESS.has(k)) };
  const extra = s.additionalProperties !== undefined ? { additionalProperties: s.additionalProperties === true || s.additionalProperties === false ? s.additionalProperties : slimProp(s.additionalProperties, 1, false, top) } : {};
  const build = (desc: boolean, n: Slim): Obj => ({ type: "object", ...(req.length ? { required: req } : {}), properties: orderProps(s, 0, desc, n), ...extra });
  const n = { lost: top.lost };
  const full = build(true, n);
  if (JSON.stringify(full).length <= max) return { schema: full, trimmed: n.lost };
  const noDesc = build(false, { lost: true });
  if (JSON.stringify(noDesc).length <= max) return { schema: noDesc, trimmed: true };
  // Vẫn quá dài: chỉ còn tên và kiểu mức đầu; required luôn còn đủ.
  const props = (s.properties ?? {}) as Obj;
  const keys = [...req.filter((k) => k in props), ...Object.keys(props).filter((k) => !req.includes(k))];
  const flat: Obj = {};
  let size = JSON.stringify(req).length + 60;
  for (const k of keys) {
    const t = (props[k] as Obj | undefined)?.type;
    const v = { type: typeof t === "string" || Array.isArray(t) ? t : "any" };
    size += k.length + JSON.stringify(v).length + 4;
    if (size > max && !req.includes(k)) continue;
    flat[k] = v;
  }
  return { schema: { type: "object", ...(req.length ? { required: req } : {}), properties: flat }, trimmed: true };
}

/** Tham số của connector_call: input (đối tượng), input_json (chuỗi JSON), hoặc model để thẳng ở cấp trên cùng. JSON hỏng thì báo lỗi, không chạy với tham số rỗng. */
export function callArgs(input: Record<string, unknown> | undefined, schema?: unknown): { args: Record<string, unknown> } | { error: string } {
  const c = input ?? {};
  let raw: unknown = c.input ?? c.input_json;
  if (raw === undefined || raw === null) {
    const { tool: _t, input: _i, input_json: _j, ...rest } = c;
    // Model hay bọc tham số trong arguments / params / args / parameters: gửi nguyên thì công cụ nhận một tham số lạ. Chỉ gỡ khi đó là khóa duy nhất, đúng là một đối tượng, và công cụ không thật sự có tham số tên đó.
    const keys = Object.keys(rest), only = keys.length === 1 ? rest[keys[0]] : undefined;
    const real = !!(schema as { properties?: Obj } | undefined)?.properties && keys[0] in (schema as { properties: Obj }).properties;
    if (only && typeof only === "object" && !Array.isArray(only) && !real && ["arguments", "params", "args", "parameters"].includes(keys[0])) return { args: only as Record<string, unknown> };
    return { args: rest };
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return { args: {} };
    try { raw = JSON.parse(t); } catch (e) { return { error: `Tham số không phải JSON hợp lệ (${(e as Error).message.slice(0, 120)}). Công cụ chưa chạy; hãy gửi lại đúng một đối tượng JSON.` }; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Tham số phải là một đối tượng JSON. Công cụ chưa chạy; hãy gửi lại." };
  return { args: raw as Record<string, unknown> };
}

/** Tên công cụ model đưa → tên đầy đủ: chấp nhận thêm tiền tố của CLI, hoặc tên trần (không kèm connector) nếu chỉ một connector có công cụ đó. */
export function resolveTool<T extends ToolLike>(tools: T[], name: string): T | null {
  // Thử tên nguyên văn trước: connector tên "Synchro Docs" có tên đầy đủ bắt đầu bằng synchro_, bỏ tiền tố trước thì không bao giờ khớp.
  const same = tools.find((t) => t.fq === name);
  if (same) return same;
  const n = name.replace(/^(mcp_+)?synchro_+/, "");
  const exact = tools.find((t) => t.fq === n);
  if (exact) return exact;
  const bare = tools.filter((t) => t.tool.name === n);
  return bare.length === 1 ? bare[0] : null;
}

/** Danh mục tên công cụ của một connector trong budget ký tự. Không vừa thì lấy lần lượt từng nhóm (cùng tiền tố), để nhóm nào cũng có mặt thay vì chỉ thấy nhóm đầu. */
export function catalogLine(names: string[], budget = 2000): { line: string; shown: number } {
  if (names.join(", ").length <= budget) return { line: names.join(", "), shown: names.length };
  const groups = new Map<string, string[]>();
  for (const n of names) { const p = /^[a-zA-Z0-9]+/.exec(n)?.[0] ?? n; groups.set(p, [...(groups.get(p) ?? []), n]); }
  const queues = [...groups.values()], taken = new Map<string[], string[]>();
  let size = 0, shown = 0;
  for (let round = 0, more = true; more && size < budget; round++) {
    more = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      more = true;
      if (size + q[round].length + 2 > budget) { more = false; break; }
      size += q[round].length + 2; shown++;
      taken.set(q, [...(taken.get(q) ?? []), q[round]]);
    }
  }
  return { line: queues.flatMap((q) => taken.get(q) ?? []).join(", "), shown };
}
