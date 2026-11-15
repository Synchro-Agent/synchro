// Replicate giả lập cho npm run dev:mock và kiểm thử (tests/api/replicate.test.mjs): cùng đường dẫn, tiêu đề, trạng thái như API thật (replicate.com/docs/reference/http),
// không bao giờ gọi Replicate thật, không tốn tiền. Khóa hợp lệ: có chữ "mock" (vd r8_mock_0001).
// Mô phỏng: lược đồ OpenAPI của FLUX 1.1 Pro Ultra (model chính thức) và zsxkib/ic-light (model cộng đồng, gọi theo version, tên tham số subject_image / light_source),
// Prefer: wait (xong ngay), chạy lâu phải hỏi lại (#slowrep trong prompt), lỗi (#failrep), từ chối an toàn (#nsfwrep), treo tới khi bị hủy (#hangrep), giữ yêu cầu tạo 8 giây (#waitrep), 402 hết số dư (#402rep),
// Files API cho ảnh gốc lớn. Ảnh kết quả ở /replicate/delivery/… cần tiêu đề Authorization như replicate.delivery.
// Bài thử đọc nhật ký ở GET /replicate/_log (không có khóa), xóa bằng DELETE /replicate/_log. Đổi tên tham số ic-light sang bản cũ: POST /replicate/_cfg { icLight: "v2" } (input_fg, bg_source).
import zlib from "node:zlib";

const V_FLUX = "f1a2" + "0".repeat(60), V_IC = "644802f7" + "1".repeat(56), V_IC2 = "58734c46" + "2".repeat(56);
const st = { log: [], preds: new Map(), files: new Map(), cfg: { icLight: "v1" } };
const ref = (n) => ({ allOf: [{ $ref: `#/components/schemas/${n}` }] });
const FLUX = {
  Input: { type: "object", properties: { prompt: { type: "string" }, aspect_ratio: ref("aspect_ratio"), raw: { type: "boolean" }, seed: { type: "integer" }, safety_tolerance: { type: "integer" }, output_format: ref("output_format"), image_prompt: { type: "string", format: "uri" }, image_prompt_strength: { type: "number" } } },
  aspect_ratio: { enum: ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21"] },
  output_format: { enum: ["jpg", "png"] },
};
const IC1 = {
  Input: { type: "object", properties: { subject_image: { type: "string", format: "uri" }, prompt: { type: "string" }, appended_prompt: { type: "string", default: "best quality" }, negative_prompt: { type: "string" }, light_source: ref("light_source"), width: ref("width"), height: ref("height"), steps: { type: "integer" }, cfg: { type: "number" }, number_of_images: { type: "integer" }, output_format: ref("output_format") } },
  light_source: { enum: ["None", "Left Light", "Right Light", "Top Light", "Bottom Light"] },
  width: { enum: [256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024] }, height: { enum: [256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024] },
  output_format: { enum: ["webp", "jpg", "png"] },
};
const IC2 = { Input: { type: "object", properties: { input_fg: { type: "string", format: "uri" }, prompt: { type: "string" }, a_prompt: { type: "string" }, n_prompt: { type: "string" }, bg_source: ref("bg_source"), num_samples: { type: "integer" } } }, bg_source: { enum: ["None", "Left Light", "Right Light", "Top Light", "Bottom Light"] } };

function png(w = 64, h = 48, rgb = [180, 140, 90]) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; rows[o] = rgb[0]; rows[o + 1] = (rgb[1] + y * 2) & 255; rows[o + 2] = (rgb[2] + x * 2) & 255; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
const hostOf = (req) => `http://${req.headers.host}`;
const view = (req, p) => ({ id: p.id, model: p.model, version: p.version, status: p.status, input: p.input, output: p.status === "succeeded" ? p.output : null, error: p.error ?? null,
  urls: { get: `${hostOf(req)}/replicate/v1/predictions/${p.id}`, cancel: `${hostOf(req)}/replicate/v1/predictions/${p.id}/cancel` }, metrics: p.status === "succeeded" ? { predict_time: p.model.includes("ic-light") ? 7.4 : 9.1 } : {} });
// Tiến trình của một lượt chạy: mỗi lần hỏi lại thì tiến một bước.
function advance(req, p) {
  const text = JSON.stringify(p.input);
  if (p.status === "canceled" || p.status === "succeeded" || p.status === "failed") return;
  if (/#hangrep/.test(text)) { p.status = "processing"; return; }
  if (/#slowrep/.test(text) && p.polls++ < 2) { p.status = "processing"; return; }
  if (/#failrep/.test(text)) { p.status = "failed"; p.error = "CUDA out of memory (mock)"; return; }
  if (/#nsfwrep/.test(text)) { p.status = "failed"; p.error = "Flagged as sensitive (E005). Please try a different prompt."; return; }
  const n = p.model.includes("ic-light") ? Math.max(1, Number(p.input.number_of_images ?? p.input.num_samples ?? 1)) : 1;
  const outs = Array.from({ length: n }, (_, i) => `${hostOf(req)}/replicate/delivery/${p.id}/out-${i}.png`);
  p.status = "succeeded"; p.output = p.model.includes("ic-light") ? outs : outs[0];
}

/** Trả true khi đã trả lời (đường dẫn /replicate/…). */
export async function replicateHandler(req, res, p, b, raw, valid) {
  if (!p.startsWith("/replicate/")) return false;
  if (p === "/replicate/_log") { if (req.method === "DELETE") { st.log = []; st.preds.clear(); } return json(res, 200, { log: st.log, files: [...st.files.keys()] }), true; }
  if (p === "/replicate/_cfg" && req.method === "POST") { st.cfg = { ...st.cfg, ...b }; return json(res, 200, st.cfg), true; }
  const auth = String(req.headers.authorization ?? "");
  const key = auth.replace(/^Bearer\s+/i, "");
  const entry = { at: Date.now(), method: req.method, path: p, prefer: req.headers.prefer ?? null, cancelAfter: req.headers["cancel-after"] ?? null, bearer: /^Bearer /.test(auth), body: req.method === "POST" && !/multipart/.test(String(req.headers["content-type"])) ? b : undefined };
  st.log.push(entry); if (st.log.length > 200) st.log.shift();
  if (!valid(key)) return json(res, 401, { title: "Unauthenticated", detail: "You did not pass a valid authentication token", status: 401 }), true;
  const m = /^\/replicate\/(v1\/.*|delivery\/.*)$/.exec(p)?.[1] ?? "";
  if (m.startsWith("delivery/")) {
    const id = m.split("/")[1];
    if (!st.preds.has(id)) return json(res, 404, { detail: "Not found" }), true;
    res.writeHead(200, { "content-type": "image/png" }); res.end(png(64, 48, st.preds.get(id).model.includes("ic-light") ? [230, 220, 200] : [40, 60, 120])); return true;
  }
  if (m === "v1/account" && req.method === "GET") return json(res, 200, { type: "user", username: "mock-owner", name: "Mock Owner", github_url: null }), true;
  const mm = /^v1\/models\/([\w.-]+)\/([\w.-]+)$/.exec(m);
  if (mm && req.method === "GET") {
    const id = `${mm[1]}/${mm[2]}`;
    if (id === "black-forest-labs/flux-1.1-pro-ultra") return json(res, 200, { owner: mm[1], name: mm[2], latest_version: { id: V_FLUX, openapi_schema: { components: { schemas: FLUX } } } }), true;
    if (id === "zsxkib/ic-light") { const v2 = st.cfg.icLight === "v2"; return json(res, 200, { owner: mm[1], name: mm[2], latest_version: { id: v2 ? V_IC2 : V_IC, openapi_schema: { components: { schemas: v2 ? IC2 : IC1 } } } }), true; }
    return json(res, 404, { detail: "Model not found" }), true;
  }
  const create = (model, version) => {
    const text = JSON.stringify(b.input ?? {});
    if (/#402rep/.test(text)) return json(res, 402, { title: "Insufficient credit", detail: "You have insufficient credit to run this model. Go to https://replicate.com/account/billing#billing to purchase credit.", status: 402 }), true;
    if (typeof b.input?.prompt !== "string" || !b.input.prompt) return json(res, 422, { title: "Input validation failed", detail: "- input: prompt is required", status: 422 }), true;
    const imgKey = Object.keys(b.input).find((k) => /subject_image|input_fg|image_prompt/.test(k));
    if (imgKey && !/^(data:image\/(png|jpeg|webp);base64,|http:\/\/[^/]+\/replicate\/v1\/files\/)/.test(String(b.input[imgKey]))) return json(res, 422, { detail: `- input.${imgKey}: Does not match format 'uri'`, status: 422 }), true;
    const pred = { id: `mock${Math.random().toString(36).slice(2, 10)}`, model, version, input: b.input, status: "starting", polls: 0 };
    st.preds.set(pred.id, pred);
    // Prefer: wait → chờ trong cùng lời gọi (lượt nhanh thì xong luôn).
    if (/wait/.test(String(req.headers.prefer ?? ""))) advance(req, pred);
    // #waitrep: Replicate giữ yêu cầu tạo trong lúc chờ (Prefer: wait) rồi mới trả lời; Synchro bấm Dừng giữa lúc đó thì không bao giờ thấy mã lượt chạy.
    if (/#waitrep/.test(text)) { setTimeout(() => { if (!res.writableEnded && !res.destroyed) json(res, 201, view(req, pred)); }, 8000); return true; }
    return json(res, 201, view(req, pred)), true;
  };
  const om = /^v1\/models\/([\w.-]+)\/([\w.-]+)\/predictions$/.exec(m);
  if (om && req.method === "POST") {
    if (`${om[1]}/${om[2]}` !== "black-forest-labs/flux-1.1-pro-ultra") return json(res, 404, { detail: "This model is not an official model; create predictions with a version" }), true;
    return create(`${om[1]}/${om[2]}`, V_FLUX);
  }
  if (m === "v1/predictions" && req.method === "POST") {
    const v = String(b.version ?? "").split(":").pop();
    if (v === V_IC || v === V_IC2) return create("zsxkib/ic-light", v);
    return json(res, 422, { detail: "Invalid version or not permitted", status: 422 }), true;
  }
  const pm = /^v1\/predictions\/(\w+)(\/cancel)?$/.exec(m);
  if (pm) {
    const pred = st.preds.get(pm[1]);
    if (!pred) return json(res, 404, { detail: "Not found" }), true;
    if (pm[2] && req.method === "POST") { if (pred.status === "starting" || pred.status === "processing") pred.status = "canceled"; return json(res, 200, view(req, pred)), true; }
    advance(req, pred);
    return json(res, 200, view(req, pred)), true;
  }
  if (m === "v1/files" && req.method === "POST") {
    if (!/multipart\/form-data/.test(String(req.headers["content-type"]))) return json(res, 400, { detail: "multipart/form-data required" }), true;
    const id = `file${Math.random().toString(36).slice(2, 10)}`;
    st.files.set(id, raw.length);
    return json(res, 201, { id, size: raw.length, urls: { get: `${hostOf(req)}/replicate/v1/files/${id}` } }), true;
  }
  const fm = /^v1\/files\/(\w+)$/.exec(m);
  if (fm && req.method === "DELETE") { st.files.delete(fm[1]); res.writeHead(204); res.end(); return true; }
  return json(res, 404, { detail: "Not found" }), true;
}
